// The headless Holotable service: one owner of loaded sessions and the world pack, spoken to as JSON lines over
// stdio (no port). The Studio's host starts it on demand; agent tools can start it the same way.
//   request  {"id": 1, "method": "session.open", "params": {...}}
//   response {"id": 1, "ok": true, "result": ...} or {"id": 1, "ok": false, "error": {"code": ..., "message": ...}}
//   cancel   {"id": 2, "method": "cancel", "params": {"id": 1}}
import { join } from "node:path";
import { listRuns, readRun } from "./recording.ts";
import { sessionAtLevel } from "./query.ts";
import { report } from "./report.ts";
import { boxOf, loadWorldPack, region } from "./world.ts";
import type { ContentLevel, Session, WorldPack } from "./model.ts";

export const PROTOCOL = "xfh/service-1";

export interface ServiceOptions { recordingsRoot: string; worldPackPath: string }

export function defaultOptions(env = process.env): ServiceOptions {
  const local = env.LOCALAPPDATA ?? "";
  return {
    recordingsRoot: env.HOLOTABLE_RECORDINGS ?? join(local, "XFStudio", "runtime-bridge", "recordings"),
    worldPackPath: env.HOLOTABLE_WORLD_PACK ?? join(import.meta.dir, "..", "..", "..", "local", "holotable", "world-pack.json"),
  };
}

type Handler = (params: any, signal: AbortSignal) => unknown;

/** Holds sessions by folder (loaded once, shared by every requester) and the world pack. */
export function createService(options: ServiceOptions) {
  const sessions = new Map<string, Session>();
  let world: WorldPack | undefined | null = null;
  const pack = () => (world === null ? (world = loadWorldPack(options.worldPackPath)) : world);
  const open = (dir: string, signal: AbortSignal) => {
    let s = sessions.get(dir);
    if (!s) { s = readRun(dir, signal); sessions.set(dir, s); }
    return s;
  };
  const level = (l: unknown): ContentLevel => (l === "full" ? "full" : "structure");
  const known = (dir: unknown) => {
    const run = listRuns(options.recordingsRoot).find(r => r.dir === dir);
    if (!run) throw Object.assign(new Error("That recording isn't in the recordings folder"), { code: "unknown_run" });
    return run.dir;
  };
  const handlers: Record<string, Handler> = {
    "service.info": () => ({ protocol: PROTOCOL, recordingsRoot: options.recordingsRoot, worldPack: Boolean(pack()) }),
    "runs.list": () => listRuns(options.recordingsRoot),
    "session.open": (p, signal) => sessionAtLevel(open(known(p.dir), signal), level(p.level)),
    "world.around": (p, signal) => {
      const w = pack();
      if (!w) return { schema: "xfh/world-pack-1", provenance: null, areas: [], cells: [] };
      return region(w, boxOf(open(known(p.dir), signal).v.map(x => x.position)), p.margin ?? 250);
    },
    "session.report": (p, signal) => report(open(known(p.dir), signal), p.t, level(p.level), pack() ?? undefined),
  };
  return { handlers, sessions };
}

/** Runs the service over stdin and stdout until stdin closes. */
export async function serve(options = defaultOptions()) {
  const { handlers } = createService(options);
  const inflight = new Map<number, AbortController>();
  const write = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += chunk.toString();
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let req: { id: number; method: string; params?: any };
      try { req = JSON.parse(line); } catch { write({ id: null, ok: false, error: { code: "bad_request", message: "Not JSON" } }); continue; }
      if (req.method === "cancel") { inflight.get(req.params?.id)?.abort(); continue; }
      const handler = handlers[req.method];
      if (!handler) { write({ id: req.id, ok: false, error: { code: "unknown_method", message: req.method } }); continue; }
      const ctl = new AbortController(); inflight.set(req.id, ctl);
      queueMicrotask(() => {
        try { write({ id: req.id, ok: true, result: handler(req.params ?? {}, ctl.signal) }); }
        catch (e: any) { write({ id: req.id, ok: false, error: { code: e?.code ?? (ctl.signal.aborted ? "cancelled" : "failed"), message: String(e?.message ?? e) } }); }
        finally { inflight.delete(req.id); }
      });
    }
  }
}

if (import.meta.main) await serve();
