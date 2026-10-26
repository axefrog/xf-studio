// Device worker: the existing sector cache and decode pool retain sole ownership here.
import { createGameSolidSource, type SolidPort } from "./solid-source.ts";
declare const self: Worker;
let source: SolidPort;
const jobs = new Map<number, AbortController>();
self.onmessage = event => {
  const p = event.data;
  if (p.cacheDir) { source = createGameSolidSource(p.cacheDir, p.gameRoot === undefined ? undefined : () => p.gameRoot); return; }
  if (p.cancel !== undefined) { jobs.get(p.cancel)?.abort(); return; }
  const ctl = new AbortController(); jobs.set(p.id, ctl);
  void (async () => {
    try {
      const result = p.method === "status" ? await source.status!(p.path, ctl.signal) : await source.around(p.path, p.margin, ctl.signal);
      ctl.signal.throwIfAborted(); self.postMessage({ id: p.id, result });
    } catch (e: any) { self.postMessage({ id: p.id, error: { message: String(e?.message ?? e), code: e?.code } }); }
    finally { jobs.delete(p.id); }
  })();
};
