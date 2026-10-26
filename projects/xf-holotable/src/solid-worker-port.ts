// One worker owns geometry preparation for both replay and live requests. Even cold metadata and
// assembling a large sector cannot block the JSON-lines service's retained-data polls.
import type { SolidPort } from "./solid-source.ts";
import type { SolidRegion, Vec3 } from "./model.ts";

export function createSolidWorkerPort(cacheDir: string, options: { gameRoot?: string } = {}): SolidPort & { close(): void } {
  let worker: Worker | undefined, next = 0;
  const pending = new Map<number, { finish(error?: Error, result?: unknown): void }>();
  const ensure = () => {
    if (worker) return worker;
    const mine = worker = new Worker(new URL("./solid-worker.ts", import.meta.url).href);
    // Bun extends the DOM Worker at runtime; the shared TS declarations expose only the DOM surface.
    (mine as Worker & { unref?(): void }).unref?.();
    mine.onmessage = event => {
      const { id, error, result } = event.data;
      pending.get(id)?.finish(error ? Object.assign(new Error(error.message), { code: error.code }) : undefined, result);
    };
    mine.onerror = event => {
      for (const job of [...pending.values()]) job.finish(new Error(event.message));
      mine.terminate(); if (worker === mine) worker = undefined;
    };
    mine.postMessage({ cacheDir, gameRoot: options.gameRoot }); return mine;
  };
  const call = <T>(method: "status" | "around", path: readonly Vec3[], margin: number, signal: AbortSignal) => new Promise<T>((resolve, reject) => {
    signal.throwIfAborted(); const mine = ensure(), id = ++next;
    const abort = () => { mine.postMessage({ cancel: id }); pending.get(id)?.finish(new DOMException("Cancelled.", "AbortError")); };
    const deadline = setTimeout(() => { mine.postMessage({ cancel: id }); pending.get(id)?.finish(new Error("City preparation exceeded its 45 second deadline.")); }, 45000);
    pending.set(id, { finish(error, result) {
      if (!pending.delete(id)) return;
      clearTimeout(deadline);
      signal.removeEventListener("abort", abort); if (error) reject(error); else resolve(result as T);
    } });
    signal.addEventListener("abort", abort, { once: true }); mine.postMessage({ id, method, path, margin });
  });
  return {
    status: (path, signal) => call<{ cold: boolean }>("status", path, 250, signal),
    around: (path, margin, signal) => call<SolidRegion>("around", path, margin, signal),
    close() { for (const job of [...pending.values()]) job.finish(new DOMException("Closed.", "AbortError")); worker?.terminate(); worker = undefined; },
  };
}
