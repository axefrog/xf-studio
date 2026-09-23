import { createRasterJob, type Layer } from "./recipe";

export type RasterRequest = { i: number; version: number; layer: Layer; size: number };
export type RasterResponse = { i: number; version: number } & (
  { cancelled: true } | { cancelled?: false; data: Uint8ClampedArray<ArrayBuffer>; ms: number }
);

/** One current job with cooperative cancellation. Only complete masks publish;
 * yielding changes scheduling, never sample positions or pixel arithmetic.
 */
export function createRasterProcessor(post: (result: RasterResponse) => void,
  pause: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 0)),
  now: () => number = () => performance.now()) {
  let active: { i: number; version: number; cancelled: boolean } | undefined;
  return {
    cancel(version: number) { if (active?.version === version) active.cancelled = true; },
    async start(request: RasterRequest) {
      if (active) active.cancelled = true;
      const token = { i: request.i, version: request.version, cancelled: false };
      active = token;
      const start = now(), job = createRasterJob(request.layer, request.size);
      while (!job.done && !token.cancelled) {
        const deadline = now() + 8;
        do { job.advance(16); } while (!job.done && now() < deadline);
        if (!job.done) await pause();
      }
      if (active === token) active = undefined;
      if (token.cancelled) post({ i: token.i, version: token.version, cancelled: true });
      else post({ i: token.i, version: token.version, data: job.data, ms: now() - start });
    },
  };
}
