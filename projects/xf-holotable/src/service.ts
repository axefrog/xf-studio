// The headless Holotable service: one owner of loaded sessions and the world pack, spoken to as JSON lines over stdio (no port).
// The Studio's host starts it on demand; agent tools can start it the same way.
//   request  {"id": 1, "method": "session.open", "params": {...}}
//   response {"id": 1, "ok": true, "result": ...} or {"id": 1, "ok": false, "error": {"code": ..., "message": ...}}
//   cancel   {"id": 2, "method": "cancel", "params": {"id": 1}}
import { join } from "node:path";
import { listRuns, readRunAsync } from "./recording.ts";
import { sessionAtLevel } from "./query.ts";
import { report } from "./report.ts";
import { boxOf, loadWorldPack, region } from "./world.ts";
import type { ContentLevel, Session, WorldPack } from "./model.ts";

export const PROTOCOL = "xfh/service-1";
/** The longest request line accepted; a longer one is refused and dropped without growing the buffer. */
export const FRAME_LIMIT = 1024 * 1024;

export interface ServiceOptions { recordingsRoot: string; worldPackPath: string }

export function defaultOptions(env = process.env): ServiceOptions {
  const local = env.LOCALAPPDATA ?? "";
  return {
    recordingsRoot: env.HOLOTABLE_RECORDINGS ?? join(local, "XFStudio", "runtime-bridge", "recordings"),
    worldPackPath: env.HOLOTABLE_WORLD_PACK ?? join(import.meta.dir, "..", "..", "..", "local", "holotable", "world-pack.json"),
  };
}

type Handler = (params: Record<string, unknown>, signal: AbortSignal) => unknown | Promise<unknown>;
const coded = (code: string, message: string) => Object.assign(new Error(message), { code });

/** Waits for a promise, or rejects as soon as `signal` aborts (the work itself is the owner's to stop). */
const until = <T>(p: Promise<T>, signal: AbortSignal) => new Promise<T>((resolve, reject) => {
  if (signal.aborted) return reject(coded("cancelled", "Cancelled."));
  const abort = () => reject(coded("cancelled", "Cancelled."));
  signal.addEventListener("abort", abort, { once: true });
  p.then(v => { signal.removeEventListener("abort", abort); resolve(v); }, e => { signal.removeEventListener("abort", abort); reject(e); });
});

/** Holds sessions by folder (loaded once, shared by every requester) and the world pack. */
export function createService(options: ServiceOptions) {
  const sessions = new Map<string, Session>();
  // One load per folder in flight, shared; it stops only when every requester waiting on it has cancelled.
  const loads = new Map<string, { promise: Promise<Session>; ctl: AbortController; waiters: number }>();
  let world: WorldPack | undefined | null = null;
  const pack = () => (world === null ? (world = loadWorldPack(options.worldPackPath)) : world);
  async function open(dir: string, signal: AbortSignal): Promise<Session> {
    const ready = sessions.get(dir);
    if (ready) { signal.throwIfAborted(); return ready; }
    let load = loads.get(dir);
    if (!load) {
      const ctl = new AbortController();
      const promise = readRunAsync(dir, ctl.signal).then(s => { sessions.set(dir, s); return s; }).finally(() => loads.delete(dir));
      promise.catch(() => { /* each waiter sees the failure; an abandoned load's rejection is expected */ });
      load = { promise, ctl, waiters: 0 };
      loads.set(dir, load);
    }
    const mine = load; mine.waiters++;
    try { return await until(mine.promise, signal); }
    finally { if (--mine.waiters === 0 && loads.get(dir) === mine && signal.aborted) { mine.ctl.abort(); loads.delete(dir); } }
  }
  const level = (l: unknown): ContentLevel => (l === "full" ? "full" : "structure");
  const known = (dir: unknown) => {
    if (typeof dir !== "string") throw coded("bad_request", "No recording named");
    const run = listRuns(options.recordingsRoot).find(r => r.dir === dir);
    if (!run) throw coded("unknown_run", "That recording isn't in the recordings folder");
    return run.dir;
  };
  const handlers: Record<string, Handler> = {
    "service.info": () => ({ protocol: PROTOCOL, recordingsRoot: options.recordingsRoot, worldPack: Boolean(pack()) }),
    "runs.list": () => listRuns(options.recordingsRoot),
    "session.open": async (p, signal) => sessionAtLevel(await open(known(p.dir), signal), level(p.level)),
    "world.around": async (p, signal) => {
      const s = await open(known(p.dir), signal), w = pack();
      if (!w) return { schema: "xfh/world-pack-1", provenance: null, areas: [], cells: [] };
      return region(w, boxOf(s.v.map(x => x.position)), typeof p.margin === "number" ? p.margin : 250);
    },
    "session.report": async (p, signal) => {
      if (typeof p.t !== "number") throw coded("bad_request", "No moment given");
      return report(await open(known(p.dir), signal), p.t, level(p.level), pack() ?? undefined);
    },
  };
  return { handlers, sessions };
}

/** Runs the service over stdin and stdout until stdin closes. */
export async function serve(options = defaultOptions()) {
  const { handlers } = createService(options);
  const inflight = new Map<number, AbortController>();
  const write = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");
  let buffer = "", dropping = false;
  const handle = (line: string) => {
    let req: unknown;
    try { req = JSON.parse(line); } catch { write({ id: null, ok: false, error: { code: "bad_request", message: "Not JSON" } }); return; }
    if (!req || typeof req !== "object" || Array.isArray(req)) { write({ id: null, ok: false, error: { code: "bad_request", message: "Not a request" } }); return; }
    const { id, method, params } = req as { id?: unknown; method?: unknown; params?: unknown };
    if (!Number.isSafeInteger(id) || typeof method !== "string") { write({ id: null, ok: false, error: { code: "bad_request", message: "A request needs an integer id and a method" } }); return; }
    const p = params && typeof params === "object" && !Array.isArray(params) ? params as Record<string, unknown> : {};
    if (method === "cancel") { inflight.get(p.id as number)?.abort(); return; }
    const handler = handlers[method];
    if (!handler) { write({ id, ok: false, error: { code: "unknown_method", message: method } }); return; }
    const ctl = new AbortController(); inflight.set(id as number, ctl);
    void (async () => {
      try {
        const result = await handler(p, ctl.signal);
        ctl.signal.throwIfAborted();
        write({ id, ok: true, result });
      } catch (e: any) {
        write({ id, ok: false, error: { code: ctl.signal.aborted ? "cancelled" : e?.code ?? "failed", message: String(e?.message ?? e) } });
      } finally { inflight.delete(id as number); }
    })();
  };
  for await (const chunk of process.stdin) {
    buffer += chunk.toString();
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
      if (dropping) { dropping = false; continue; } // the tail of an over-long frame
      if (line) handle(line);
    }
    if (buffer.length > FRAME_LIMIT) { write({ id: null, ok: false, error: { code: "too_large", message: "Request line too long" } }); buffer = ""; dropping = true; }
  }
}

if (import.meta.main) await serve();
