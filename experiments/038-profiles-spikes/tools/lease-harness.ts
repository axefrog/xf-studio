/**
 * The workspace lease harness (profiles design §2.3, phase 1's first gate): two windows on each host, the holder killed while it
 * drains, a holder that hangs, and a late write after release refused by fencing.
 *
 * - **Desktop:** the real desktop server (`createDesktopServer`, scratch data) with each page a process of its own
 *   (`harness/lease-desktop-page.ts`); killing one is a real process termination, which ends its lease stream.
 * - **Localhost:** the real library routes (`/api/workspace-lease`, `/api/documents`) served as the dev server serves them, with
 *   each window a worker (`harness/lease-browser-page.ts`), this process as the browser holding the Web Locks
 *   (`harness/web-locks-model.ts`) and `localStorage`; terminating a worker ends its window.
 *
 * `bun tools/lease-harness.ts <scratch>` prints one line per check and exits 1 when any fails; `tests/lease-harness.test.ts` runs it.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDesktopServer } from "../../../projects/xf-studio/authoring/desktop/server";
import { openLibraryFiles } from "../../../projects/xf-studio/authoring/src/library/host/library-files";
import { hostClock } from "../../../projects/xf-studio/authoring/src/platform/core/clock";
import { STUDIO_PARTS } from "../../../projects/xf-studio/authoring/src/compose/studio-registry";
import { LEASE_MESSAGES } from "../../../projects/xf-studio/authoring/src/app/workspace/workspace-lease";
import { LEASE_DOC, type LeaseDoc } from "../harness/lease-page";
import { WebLocksModel, type LockMessage } from "../harness/web-locks-model";

type Event = { window: string; at: number; event: string; [key: string]: unknown };
type Win = { name: string; events: Event[]; command(name: string): void; kill(): Promise<void>; alive(): boolean;
  wait(match: (event: Event) => boolean, ms?: number): Promise<Event | null> };
type Host = { name: "desktop" | "localhost"; open(name: string, options?: { hang?: boolean; editMs?: number }): Promise<Win>;
  doc(): Promise<{ revision: number; value: LeaseDoc } | null>; workspace(): Promise<string | null>;
  /** The window the host (or the browser) has as holder now, or null. */
  holder(): string | null; close(): Promise<void> };
export type Check = { host: string; scenario: string; check: string; ok: boolean; detail: string };

const HARNESS = join(import.meta.dir, "..", "harness");

function windowOf(name: string, kill: () => void, alive: () => boolean): Win & { push(event: Event): void } {
  const events: Event[] = [], watchers: { match(event: Event): boolean; resolve(event: Event | null): void }[] = [];
  return { name, events, alive, command: () => {}, async kill() { kill(); },
    push(event) { events.push(event); for (const watcher of [...watchers]) if (watcher.match(event)) { watchers.splice(watchers.indexOf(watcher), 1); watcher.resolve(event); } },
    wait(match, ms = 10_000) {
      const found = events.find(match);
      if (found) return Promise.resolve(found);
      return new Promise(resolve => { const watcher = { match, resolve }; watchers.push(watcher);
        setTimeout(() => { const at = watchers.indexOf(watcher); if (at >= 0) { watchers.splice(at, 1); resolve(null); } }, ms); });
    } };
}

async function desktopHost(scratch: string): Promise<Host> {
  const root = join(scratch, "desktop"), staticRoot = join(root, "static");
  mkdirSync(join(staticRoot, "build"), { recursive: true });
  writeFileSync(join(staticRoot, "index.html"), "<!doctype html><title>Studio</title>");
  const app = createDesktopServer(staticRoot, join(root, "data"), { version: "0.0.1", channel: "dev", buildHash: "dev", metadataStatus: "ready" });
  const base = `http://127.0.0.1:${app.port}`;
  const cookie = (await fetch(app.url)).headers.get("set-cookie")!.split(";")[0];
  const pages = new Map<string, string>();
  const get = (path: string) => fetch(base + path, { headers: { Cookie: cookie } });
  return {
    name: "desktop",
    async open(name, { hang = false, editMs = 15 } = {}) {
      const proc = Bun.spawn([process.execPath, join(HARNESS, "lease-desktop-page.ts"), base, cookie, name, hang ? "1" : "0", String(editMs)],
        { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
      const win = windowOf(name, () => proc.kill(9), () => proc.exitCode === null && !proc.killed);
      win.command = command => { proc.stdin.write(`${command}\n`); proc.stdin.flush(); };
      win.kill = async () => { proc.kill(9); await proc.exited; };
      (async () => {
        let rest = "";
        for await (const chunk of proc.stdout) {
          rest += new TextDecoder().decode(chunk);
          const lines = rest.split("\n"); rest = lines.pop()!;
          for (const line of lines) if (line.trim()) try { win.push(JSON.parse(line)); } catch { /* Not an event. */ }
        }
      })();
      void new Response(proc.stderr).text().then(text => { if (text.trim()) process.stderr.write(`[${name}] ${text.slice(0, 1500)}\n`); });
      const started = await win.wait(event => event.event === "phase" && ["holder", "read-only"].includes(event.phase as string), 15_000);
      if (!started) throw Error(`Desktop page ${name} didn't start.`);
      // The host names pages by their own IDs; the harness learns which is which from who holds the lease right after.
      if (started.phase === "holder") pages.set(app.leases.holder(false)?.page ?? "", name);
      return win;
    },
    async doc() {
      const { documents } = await (await get(`/api/documents?kind=${LEASE_DOC.kind}`)).json() as { documents: { id: string; revision: number; value: LeaseDoc }[] };
      return documents.find(item => item.id === LEASE_DOC.id) ?? null;
    },
    async workspace() {
      const { workspace } = await (await get("/api/desktop/workspace")).json() as { workspace: string | null };
      // The marker is the first layer's name (`lease-desktop-page.ts`).
      return workspace === null ? null : /"([A-Z]#\d+(?:#last)?|[A-Z]#late)"/.exec(workspace)?.[1] ?? "(no marker)";
    },
    holder() { const held = app.leases.holder(false); return held ? pages.get(held.page) ?? `page ${held.page}` : null; },
    async close() { app.stop(); },
  };
}

async function localhostHost(scratch: string): Promise<Host> {
  mkdirSync(join(scratch, "localhost"), { recursive: true });
  const files = openLibraryFiles(join(scratch, "localhost"), { clock: hostClock(), parts: STUDIO_PARTS, isolated: true });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => files.handle(request) ?? new Response("Not found", { status: 404 }) });
  const base = `http://127.0.0.1:${server.port}`, workspace = `browser-${crypto.randomUUID()}`;
  const workers = new Map<string, Worker>();
  const locks = new WebLocksModel((window, message) => workers.get(window)?.postMessage(message));
  const storage: { value: string | null } = { value: null };
  const late: string[] = [];
  return {
    name: "localhost",
    async open(name, { hang = false, editMs = 15 } = {}) {
      const worker = new Worker(join(HARNESS, "lease-browser-page.ts"));
      let alive = true;
      workers.set(name, worker);
      const win = windowOf(name, () => {}, () => alive);
      win.kill = async () => { alive = false; worker.terminate(); workers.delete(name); locks.ended(name); };
      win.command = command => worker.postMessage({ op: "command", name: command });
      worker.onmessage = (event: MessageEvent) => {
        const message = event.data as { op: "event"; event: Event } | { op: "locks"; message: LockMessage } | { op: "setItem"; value: string };
        if (!alive) return;
        if (message.op === "event") win.push(message.event);
        else if (message.op === "locks") locks.message(name, message.message);
        else { storage.value = message.value; if (locks.holder(`xfs.workspace.${workspace}`) !== name) late.push(`${name}: ${message.value}`); }
      };
      worker.postMessage({ op: "init", base, name, hang, workspace, editMs });
      const started = await win.wait(event => event.event === "phase" && ["holder", "read-only"].includes(event.phase as string), 15_000);
      if (!started) throw Error(`Window ${name} didn't start.`);
      return win;
    },
    async doc() { return files.main.documents.get<LeaseDoc>(LEASE_DOC.kind, LEASE_DOC.id); },
    async workspace() { return storage.value; },
    holder: () => locks.holder(`xfs.workspace.${workspace}`),
    async close() {
      for (const worker of workers.values()) worker.terminate();
      server.stop(true); files.close();
      if (late.length) throw Error(`A window without the lease wrote localStorage: ${late.join("; ")}`);
    },
  };
}

const phase = (name: string) => (event: Event) => event.event === "phase" && event.phase === name;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const lastAck = (win: Win) => Math.max(0, ...win.events.filter(event => event.event === "ack").map(event => event.seq as number));

async function scenarios(host: Host, record: (scenario: string, check: string, ok: boolean, detail: string) => void) {
  // 1. Two windows: the second opens read-only, then takes over through the holder's release.
  {
    const s = "two windows";
    const a = await host.open("A");
    await a.wait(event => event.event === "ack" && (event.seq as number) >= 8);
    const b = await host.open("B");
    record(s, "the second window opens read-only", b.events.some(phase("read-only")), `B: ${b.events.find(e => e.event === "phase")?.phase}`);
    b.command("probe");
    const probe = await b.wait(event => event.event === "probe");
    record(s, "a read-only window refuses dispatch and sends no write", probe?.code === "unavailable" && probe.edited === false && probe.put === "superseded",
      JSON.stringify(probe && { code: probe.code, edited: probe.edited, put: probe.put }));
    const aGeneration = a.events.find(phase("holder"))?.generation as number;
    const asked = performance.timeOrigin + performance.now();
    b.command("takeover");
    const released = await a.wait(phase("read-only"));
    const granted = await b.wait(phase("taken-over"));
    const last = a.events.find(event => event.event === "last-write");
    record(s, "the holder drains, writes last and releases; then the new window is granted", !!released && !!granted && !!last &&
      last.at <= released.at && released.at <= granted.at + 50, `release ${released ? Math.round(released.at - asked) : "-"} ms, grant ${granted ? Math.round(granted.at - asked) : "-"} ms after asking`);
    const doc = await host.doc(), ws = await host.workspace();
    record(s, "everything the holder acknowledged, and its last workspace, are stored", !!doc && doc.value.by === "A" && doc.value.seq === last?.seq &&
      doc.value.seq >= lastAck(a) && ws === `A#${last?.seq}#last`, `doc ${JSON.stringify(doc?.value)}, last ${last?.seq}, acked ${lastAck(a)}, workspace ${ws}`);
    a.command("late");
    const late = await a.wait(event => event.event === "late");
    const after = await host.doc(), wsAfter = await host.workspace();
    record(s, "a late write from the released window is refused by fencing", late?.document === "superseded" &&
      (late.workspace === null || late.workspace === 409) && after?.revision === doc?.revision && wsAfter === ws,
      `generation ${aGeneration}: document ${late?.document}, workspace ${late?.workspace ?? "n/a (localStorage, gated in the window)"}`);
    await a.kill(); await b.kill();
    await sleep(100);
  }
  // 2. The holder is killed while it drains: the lease moves when its window ends, and nothing it acknowledged is lost.
  {
    const s = "holder killed while draining";
    // Editing every millisecond, so a save is almost always in flight when the release starts.
    const a = await host.open("C", { editMs: 1 });
    await a.wait(event => event.event === "ack" && (event.seq as number) >= 8);
    const b = await host.open("D");
    b.command("takeover");
    const draining = await a.wait(event => event.event === "draining");
    await a.kill();
    const granted = await b.wait(phase("taken-over"));
    const doc = await host.doc();
    record(s, "the waiting window is granted once the holder's window ends", !!draining && !!granted,
      `killed with ${draining?.pending ?? "?"} write(s) in flight; granted ${granted && draining ? Math.round(granted.at - draining.at) : "-"} ms after draining began`);
    record(s, "every acknowledged save survives", !!doc && (doc.value.by !== "C" || doc.value.seq >= lastAck(a)), `stored ${JSON.stringify(doc?.value)}, C acked ${lastAck(a)}`);
    await sleep(300);
    const later = await host.doc();
    record(s, "nothing from the killed holder lands after the grant", later?.revision === doc?.revision || later?.value.by !== "C",
      `revision ${doc?.revision} at the grant, ${later?.revision} 300 ms later`);
    await b.kill();
    await sleep(100);
  }
  // 3. A hung holder: never stolen from; the waiting window says so, and is granted once the hung window ends.
  {
    const s = "hung holder";
    const a = await host.open("E", { hang: true });
    await a.wait(event => event.event === "ack" && (event.seq as number) >= 4);
    const b = await host.open("F");
    b.command("takeover");
    await a.wait(event => event.event === "draining");
    const waiting = await b.wait(phase("waiting"), 3000);
    await sleep(3000);
    record(s, "the waiting window says it is waiting, and the lease isn't taken by time", !!waiting && waiting.message === LEASE_MESSAGES.waiting &&
      !b.events.some(phase("taken-over")) && host.holder() !== null && host.holder() !== "F", `holder after 3.5 s: ${host.holder()}; B says "${waiting?.message}"`);
    await a.kill();
    const granted = await b.wait(phase("taken-over"));
    record(s, "once the hung window ends, the waiting window is granted", !!granted, granted ? "granted" : "not granted");
    await b.kill();
  }
}

export async function runLeaseHarness(scratch: string): Promise<Check[]> {
  const checks: Check[] = [];
  for (const make of [desktopHost, localhostHost]) {
    const host = await make(scratch);
    try { await scenarios(host, (scenario, check, ok, detail) => checks.push({ host: host.name, scenario, check, ok, detail })); }
    catch (error) { checks.push({ host: host.name, scenario: "harness", check: "ran to the end", ok: false, detail: String(error) }); }
    finally {
      try { await host.close(); } catch (error) { checks.push({ host: host.name, scenario: "harness", check: "no write without the lease", ok: false, detail: String(error) }); }
    }
  }
  return checks;
}

if (import.meta.main) {
  const scratch = process.argv[2];
  if (!scratch) throw Error("Usage: bun tools/lease-harness.ts <scratch folder>");
  rmSync(scratch, { recursive: true, force: true });
  const started = performance.now();
  const checks = await runLeaseHarness(scratch);
  for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.host.padEnd(9)} ${check.scenario}: ${check.check} (${check.detail})`);
  console.log(`${checks.filter(check => check.ok).length}/${checks.length} checks passed in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  process.exit(checks.every(check => check.ok) ? 0 : 1);
}
