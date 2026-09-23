import { createRasterJob, type Layer } from "./recipe";
import {createFlakeJob,defaultFlakes,type FlakeMaps} from "./finish";

export type RasterRequest = { i: number; version: number; layer: Layer; size: number; bakeOptics?: boolean };
export type RasterResponse = { i: number; version: number } & (
  { cancelled: true } | { cancelled?: false; size: number; data: Uint8ClampedArray<ArrayBuffer>; optics?: FlakeMaps; ms: number }
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
      const snapshot = structuredClone(request);
      const token = { i: snapshot.i, version: snapshot.version, cancelled: false };
      active = token;
      const drain = async (job: {done: boolean; advance(work: number): boolean}, work: number) => {
        while (!job.done && !token.cancelled) {
          const deadline = now() + 8;
          do { job.advance(work); } while (!job.done && now() < deadline);
          if (!job.done) await pause();
        }
      };
      try {
        const start = now(), job = createRasterJob(snapshot.layer, snapshot.size);
        await drain(job,16);
        let optics: FlakeMaps | undefined;
        const finish = snapshot.layer.finish;
        if (!token.cancelled && snapshot.bakeOptics && snapshot.layer.enabled && (finish === "shimmer" || finish === "glitter")) {
          // Let a pending cancellation arrive before allocating the next phase.
          await pause();
          if (!token.cancelled) {
            const optical = createFlakeJob(snapshot.size,finish,snapshot.layer.flakes ?? defaultFlakes());
            await drain(optical,256);
            if (!token.cancelled) optics = {size: optical.size,normal: optical.normal,surface: optical.surface};
          }
        }
        if (token.cancelled) post({ i: token.i, version: token.version, cancelled: true });
        else post({ i: token.i, version: token.version, size: snapshot.size, data: job.data, ...(optics ? {optics} : {}), ms: now() - start });
      } finally {
        if (active === token) active = undefined;
      }
    },
  };
}
