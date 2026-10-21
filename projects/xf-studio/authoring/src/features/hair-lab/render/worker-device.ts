/** Worker transport/source adapter. Persistent per-scene workers retain geometry-revision contact caches. */
import type { Generation, GenerationDevice } from "../service";
import type { Groom, HeadSurface } from "../types";
export function workerGeneration(lifetime: AbortSignal, options: { shape?: string } = {}): GenerationDevice {
  const workers = new Map<string, Worker>(), pending = new Map<number, { publish(result: Generation): void; resolve(): void; reject(error: Error): void }>();
  let sequence = 0;
  lifetime.addEventListener("abort", () => { for (const worker of workers.values()) worker.terminate(); workers.clear(); for (const item of pending.values()) item.resolve(); pending.clear(); });
  return { generate(target, surface: HeadSurface, groom: Groom | null, signal, publish, previous) {
    if (signal.aborted || lifetime.aborted) return Promise.resolve();
    let worker = workers.get(target);
    if (!worker) {
      worker = new Worker(`/build/hair-worker.js?shape=${encodeURIComponent(options.shape ?? "face-frame")}`, { type: "module" }); workers.set(target, worker);
      worker.onmessage = event => {
        const message = event.data as { id: number; result?: Generation; done?: boolean; error?: string }, job = pending.get(message.id);
        if (!job) return;
        if (message.error) { pending.delete(message.id); job.reject(Error(message.error)); }
        else {
          try { if (message.result) job.publish(message.result); if (message.done) { pending.delete(message.id); job.resolve(); } }
          catch (error) { pending.delete(message.id); worker!.postMessage({ cancel: message.id }); job.reject(error instanceof Error ? error : Error(String(error))); }
        }
      };
      worker.onerror = event => { for (const job of pending.values()) job.reject(Error(event.message)); pending.clear(); worker!.terminate(); workers.delete(target); };
    }
    const id = ++sequence, activeWorker = worker;
    return new Promise<void>((resolve, reject) => {
      pending.set(id, { publish, resolve, reject });
      signal.addEventListener("abort", () => { pending.delete(id); activeWorker.postMessage({ cancel: id }); resolve(); });
      activeWorker.postMessage({ id, surface, groom, previous });
    });
  } };
}
