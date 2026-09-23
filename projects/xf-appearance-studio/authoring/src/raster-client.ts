import type { Layer } from "./recipe";
import type { RasterRequest, RasterResponse } from "./raster-processor";

export type RasterPort = {
  onmessage: ((event: MessageEvent<RasterResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: RasterRequest | { cancel: number }): void;
  terminate(): void;
};
type Completed = Extract<RasterResponse, { data: unknown }>;

/** Latest pending snapshot per slot, with cancellation for obsolete running work.
 * Versions never reset, so an old message cannot apply to a replacement preset.
 */
export function createRasterClient(makeWorker: () => RasterPort,
  publish: (result: Completed) => void, failed: () => void, size = 1024) {
  const queue = new Map<number, RasterRequest>(), versions = new Map<number, number>();
  let running: RasterRequest | undefined, cancelSent = false, sequence = 0;
  let cancellations = 0, completed = 0, discarded = 0, failures = 0;
  let worker: RasterPort | undefined;
  function cancelRunning() {
    if (!running || cancelSent) return;
    cancelSent = true; cancellations++;
    worker?.postMessage({ cancel: running.version });
  }
  function dispatch() {
    if (running || !queue.size) return;
    const [i, request] = queue.entries().next().value!;
    queue.delete(i); running = request; cancelSent = false;
    worker ??= connect();
    worker.postMessage(request);
  }
  function connect() {
    const port = makeWorker();
    port.onmessage = ({ data }) => {
      if (port !== worker || !running || running.version !== data.version || running.i !== data.i) return;
      running = undefined; cancelSent = false;
      if (!data.cancelled && versions.get(data.i) === data.version) {
        if (queue.get(data.i)?.version === data.version) queue.delete(data.i);
        completed++; publish(data);
      }
      else discarded++;
      dispatch();
    };
    port.onerror = () => {
      if (port !== worker) return;
      if (running && queue.get(running.i)?.version === running.version) queue.delete(running.i);
      failures++; port.terminate(); running = undefined; cancelSent = false;
      // Do not automatically repeat the failing snapshot. A pending newer edit
      // may continue; otherwise the next user edit starts in a fresh worker.
      worker = undefined; failed(); dispatch();
    };
    return port;
  }
  return {
    request(i: number, layer: Layer, prioritize = true) {
      const version = ++sequence;
      versions.set(i, version);
      const request = { i, version, layer: structuredClone(layer), size };
      if (prioritize) {
        if (running && running.i !== i && versions.get(running.i) === running.version && !queue.has(running.i))
          queue.set(running.i, running);
        queue.delete(i);
        const pending = [...queue]; queue.clear(); queue.set(i, request);
        for (const [slot, job] of pending) queue.set(slot, job);
      } else queue.set(i, request);
      if (running?.i === i || prioritize) cancelRunning();
      dispatch();
    },
    reset() { queue.clear(); versions.clear(); cancelRunning(); },
    diagnostics: () => ({ running: running ? { i: running.i, version: running.version } : null,
      queued: queue.size, cancelling: cancelSent, cancellations, completed, discarded, failures }),
  };
}
