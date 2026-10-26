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
import type { SolidPort } from "./solid-source.ts";
import { createSolidWorkerPort } from "./solid-worker-port.ts";
import { createLiveBridge, type LiveBridge } from "./live-bridge.ts";
import { createLiveSource, type LiveClock, type LiveCursor } from "./live.ts";
import { createLayerSpool } from "./layer-spool.ts";
import { evaluateLayers, whatsHere, PROJECTION_SPECS } from "./layers.ts";
import { layerExtent, standaloneSession, standaloneSets } from "./layer-timelines.ts";

export const PROTOCOL = "xfh/service-1";
/** The longest request line accepted; a longer one is refused and dropped without growing the buffer. */
export const FRAME_LIMIT = 1024 * 1024;

export interface ServiceOptions { recordingsRoot: string; worldPackPath: string; layersRoot?: string; solidSource?: SolidPort; solidCacheDir?: string; liveBridge?: LiveBridge; liveClock?: LiveClock }

export function defaultOptions(env = process.env): ServiceOptions {
  const local = env.LOCALAPPDATA ?? "";
  return {
    recordingsRoot: env.HOLOTABLE_RECORDINGS ?? join(local, "XFStudio", "runtime-bridge", "recordings"),
    worldPackPath: env.HOLOTABLE_WORLD_PACK ?? join(import.meta.dir, "..", "..", "..", "local", "holotable", "world-pack.json"),
    layersRoot: env.HOLOTABLE_LAYERS ?? join(import.meta.dir, "../../../local/holotable/layers"),
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
  const layers = createLayerSpool(options.layersRoot ?? defaultOptions().layersRoot!);
  const solids = options.solidSource ?? createSolidWorkerPort(options.solidCacheDir ?? join(import.meta.dir, "..", "..", "..", "local", "holotable", "cache"));
  const sessions = new Map<string, Session>();
  // One load per folder in flight, shared; it stops only when every requester waiting on it has cancelled.
  const loads = new Map<string, { promise: Promise<Session>; ctl: AbortController; waiters: number }>();
  let world: WorldPack | undefined | null = null;
  const pack = () => (world === null ? (world = loadWorldPack(options.worldPackPath)) : world);
  let liveWorld: unknown = null, worldVersion = 0, worldPending = false, worldCold = false;
  let worldCtl = new AbortController(), worldIdentity = "", covered: Session["v"][number]["position"][] = [];
  let requested: Session | undefined;
  // Source updates only enqueue a want. The retained-data poll never awaits geometry.
  function wantWorld(s: Session) {
    requested = s;
    const identity = `${s.meta.session}:${s.meta.run}:${s.meta.worldGeneration}`;
    if (worldIdentity !== identity) {
      worldCtl.abort(); worldCtl = new AbortController(); worldIdentity = identity;
      liveWorld = null; covered = []; worldVersion++; worldPending = false;
    }
    const newest = s.v.at(-1)?.position;
    if (!newest || worldPending || covered.some(p => Math.hypot(...p.map((v, i) => v - newest[i])) < 100)) return;
    const signal = worldCtl.signal, path = s.v.map(v => v.position);
    worldPending = true;
    setImmediate(() => { void (async () => {
      try {
        worldCold = (await solids.status?.(path, signal))?.cold ?? false;
        const geometry = await solids.around(path, 250, signal); signal.throwIfAborted();
        const w = pack();
        liveWorld = { ...(w ? region(w, boxOf(path), 250) : { provenance: null, areas: [], cells: [] }), ...geometry };
        covered = path; worldVersion++;
      } catch { /* Keep previous geometry; the next region want can retry. */ }
      finally {
        if (!signal.aborted) { worldPending = false; worldCold = false; }
      }
      if (!signal.aborted && covered === path && requested) wantWorld(requested);
    })(); });
  }
  const live = createLiveSource(options.liveBridge ?? createLiveBridge(), { clock: options.liveClock, changed: wantWorld,
    idle() { worldCtl.abort(); worldCtl = new AbortController(); worldPending = false; } });
  async function open(dir: string, signal: AbortSignal): Promise<Session> {
    if (dir.startsWith("layers:")) return standaloneSession(layers.snapshot(), dir, pack() ?? undefined);
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
  const known = (dir: unknown, scanLayers = true) => {
    if (typeof dir !== "string") throw coded("bad_request", "No recording named");
    if (dir.startsWith("layers:") && standaloneSets(scanLayers ? layers.read() : layers.snapshot()).some(s => s.dir === dir)) return dir;
    const run = listRuns(options.recordingsRoot).find(r => r.dir === dir);
    if (!run) throw coded("unknown_run", "That recording isn't in the recordings folder");
    return run.dir;
  };
  const pathFor = (s: Session) => s.meta.standalone ? layerExtent(layers.read(), s, pack() ?? undefined) : s.v.map(x => x.position);
  async function layerAnswer(p: Record<string, unknown>, signal: AbortSignal, watching = false) {
    if (watching) layers.renew(String(p.watch));
    const s = typeof p.liveWatch === "string" ? (live.renew(p.liveWatch), live.session()) : await open(known(p.dir, !watching), signal);
    if (!s) return { layers: [], here: [], specs: PROJECTION_SPECS };
    const t = typeof p.t === "number" && Number.isFinite(p.t) ? p.t : s.meta.to;
    const hidden = Array.isArray(p.hidden) ? p.hidden.filter((s): s is string => typeof s === "string") : [];
    const views = evaluateLayers(watching ? layers.snapshot() : layers.read(), s, t, level(p.level), hidden, pack() ?? undefined, typeof p.branch === "string" ? p.branch : s.meta.standalone?.branches[0]);
    const position = Array.isArray(p.position) && p.position.length === 3 && p.position.every(Number.isFinite) ? p.position as [number, number, number] : undefined;
    return { layers: views, here: position ? whatsHere(views, position, hidden) : [], specs: PROJECTION_SPECS };
  }
  const handlers: Record<string, Handler> = {
    "layers.publish": p => {
      if (typeof p.layer !== "string" || !Array.isArray(p.lines)) throw coded("bad_request", "Publish needs a producer/layer and lines array.");
      return layers.publish(p.layer, p.lines);
    },
    "layers.watch": () => layers.watch(),
    "layers.renew": p => { layers.renew(String(p.watch)); return { renewed: true }; },
    "layers.stop": p => { layers.stop(String(p.watch)); return { stopped: true }; },
    "layers.poll": (p, signal) => layerAnswer(p, signal, true),
    "layers.at": (p, signal) => layerAnswer(p, signal),
    "live.status": (_p, signal) => live.status(signal),
    "live.watch": () => live.watch(),
    "live.stop": p => { live.stop(String(p.watch)); return { stopped: true }; },
    "live.poll": p => live.poll(String(p.watch), p.since as LiveCursor | undefined, level(p.level)),
    "service.info": () => ({ protocol: PROTOCOL, recordingsRoot: options.recordingsRoot, worldPack: Boolean(pack()) }),
    "runs.list": () => [...listRuns(options.recordingsRoot), ...standaloneSets(layers.read()).map(s => ({ session: s.dir, run: 0, dir: s.dir, start: s.from, end: s.to, bytes: 0, complete: true, title: s.title, standalone: true, clock: s.clock }))],
    "session.open": async (p, signal) => sessionAtLevel(await open(known(p.dir), signal), level(p.level)),
    "world.status": async (p, signal) => {
      const s = await open(known(p.dir), signal);
      return solids.status ? solids.status(pathFor(s), signal) : { cold: false };
    },
    "world.around": async (p, signal) => {
      if (typeof p.watch === "string") {
        // Validate and renew this watch without asking the bridge for anything.
        live.renew(p.watch);
        return { version: worldVersion, world: p.since === worldVersion ? null : liveWorld, pending: worldPending, cold: worldCold };
      }
      const s = await open(known(p.dir), signal), w = pack();
      const margin = typeof p.margin === "number" ? p.margin : 250;
      if (!Number.isFinite(margin) || margin < 0 || margin > 1000) throw coded("bad_request", "Margin must be between 0 and 1000 metres.");
      const path = pathFor(s), geometry = await solids.around(path, margin, signal);
      signal.throwIfAborted();
      return { ...(w ? region(w, boxOf(path), margin) : { schema: "xfh/world-pack-1", provenance: null, areas: [], cells: [] }), ...geometry };
    },
    "session.report": async (p, signal) => {
      if (typeof p.t !== "number") throw coded("bad_request", "No moment given");
      const s = typeof p.liveWatch === "string" ? (live.renew(p.liveWatch), live.session()) : await open(known(p.dir), signal);
      if (!s) throw coded("bad_request", "No live recording yet.");
      const answer = await layerAnswer(p, signal);
      return report(s, p.t, level(p.level), pack() ?? undefined, answer.layers, Array.isArray(p.position) ? p.position as [number, number, number] : undefined, Array.isArray(p.hidden) ? p.hidden as string[] : []);
    },
  };
  return { handlers, sessions, close() { layers.close(); live.close(); worldCtl.abort(); solids.close?.(); }, live, layers };
}

/** Runs the service over stdin and stdout until stdin closes. */
export async function serve(options = defaultOptions()) {
  const service = createService(options), { handlers } = service;
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
  for (const ctl of inflight.values()) ctl.abort();
  service.close();
}

if (import.meta.main) await serve();
