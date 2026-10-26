// Publication admission is shared by every layer of a producer's standalone set.
import { readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const turns = new Map<string, Promise<void>>();
export class SetPublishBusy extends Error { constructor() { super("Another batch is publishing this set; try again."); } }
const staleMs = 30_000, waitMs = 5_000;

function stale(path: string) {
  try {
    if (Date.now() - statSync(path).mtimeMs <= staleMs) return false;
    const text = readFileSync(path, "utf8");
    let pid: number | undefined; try { pid = JSON.parse(text).pid; } catch { /* A crashed creation can leave an empty file. */ }
    if (Number.isSafeInteger(pid) && pid! > 0) {
      try { process.kill(pid!, 0); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false; }
    }
    // Recheck ownership before removing an abandoned lease; never remove a live publisher's lock.
    if (readFileSync(path, "utf8") === text && Date.now() - statSync(path).mtimeMs > staleMs) unlinkSync(path);
    return true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; }
}

export async function acquireSetPublishLock(path: string, signal: AbortSignal): Promise<() => void> {
  const key = process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
  const previous = turns.get(key) ?? Promise.resolve();
  let finish!: () => void;
  const gate = new Promise<void>(done => { finish = done; }), tail = previous.then(() => gate);
  turns.set(key, tail);
  const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(new SetPublishBusy()), waitMs);
  const cancel = AbortSignal.any([signal, timeout.signal]), owner = JSON.stringify({ pid: process.pid, token: randomUUID() });
  let held = false, released = false;
  const release = () => {
    if (released) return; released = true;
    try { if (held && readFileSync(path, "utf8") === owner) unlinkSync(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    finally {
      finish();
      void tail.then(() => { if (turns.get(key) === tail) turns.delete(key); });
    }
  };
  try {
    await new Promise<void>((done, reject) => {
      if (cancel.aborted) { reject(cancel.reason); return; }
      const abort = () => reject(cancel.reason); cancel.addEventListener("abort", abort, { once: true });
      previous.then(() => { cancel.removeEventListener("abort", abort); done(); });
    });
    while (true) {
      cancel.throwIfAborted();
      try { writeFileSync(path, owner, { flag: "wx" }); held = true; break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      if (stale(path)) continue;
      await delay(10, undefined, { signal: cancel });
    }
    return release;
  } catch (error) { release(); if (timeout.signal.aborted && !signal.aborted) throw timeout.signal.reason; throw error; }
  finally { clearTimeout(timer); }
}
