import type { Layer } from "./engines/layered-makeup/recipe";
import type { RasterRequest, RasterResponse } from "./engines/layered-makeup/raster-processor";
import {isIrregular} from "./engines/layered-makeup/finish";
import {isDirectGlint} from "./engines/layered-makeup/direct-glint-settings";
import {maskAlphaKey,studioIrregularOpticalKey,irregularAlbedoKey} from "./engines/layered-makeup/makeup-dependencies";
import type { RasterRegion } from "./engines/layered-makeup/region";

export type RasterPort = {
  onmessage: ((event: MessageEvent<RasterResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: RasterRequest | { cancel: number }): void;
  terminate(): void;
};
type Completed = Extract<RasterResponse, { data: unknown }>;

function validResult(data: Completed, request: RasterRequest): boolean {
  const length = request.size * request.size * 4;
  if (data.size !== request.size || !(data.data instanceof Uint8ClampedArray) || data.data.length !== length ||
    !Number.isFinite(data.ms) || data.ms < 0) return false;
  const expectsOptics = !!request.bakeOptics && request.layer.enabled &&
    (request.layer.finish === "shimmer" || request.layer.finish === "glitter" && !isDirectGlint(request.layer.flakes));
  const settings=request.layer.flakes;
  const irregular = request.layer.enabled && request.layer.finish === "glitter" && isIrregular(settings);
  if (expectsOptics && !data.optics) return false;
  if (!irregular && expectsOptics !== !!data.optics) return false;
  if (data.optics && (data.optics.size !== request.size ||
    !(data.optics.normal instanceof Uint8Array) || data.optics.normal.length !== length ||
    !(data.optics.surface instanceof Uint8Array) || data.optics.surface.length !== length)) return false;
  if (irregular) {
    const candidate=settings as import("./engines/layered-makeup/flake-field").IrregularFlakes;
    const optical=studioIrregularOpticalKey(candidate,request.size,request.region.fineGlitter);
    const expected=irregularAlbedoKey(optical,maskAlphaKey(request.layer,request.size),request.layer.color,candidate.color);
    if (!data.albedo || data.albedo.key!==expected || !(data.albedo.data instanceof Uint8Array) || data.albedo.data.length!==length) return false;
    if(data.glitterStats){
      const s=data.glitterStats;
      if(![s.generated,s.regionRetained,s.maskCentres,s.paintedPixels,s.coveredPixels,
        s.quarterCoveragePixels,s.halfCoveragePixels].every(x=>Number.isInteger(x)&&x>=0) ||
        s.generated!==candidate.count || s.regionRetained>s.generated || s.maskCentres>s.regionRetained ||
        s.paintedPixels>request.size*request.size || s.coveredPixels>s.paintedPixels ||
        s.quarterCoveragePixels>s.coveredPixels || s.halfCoveragePixels>s.quarterCoveragePixels)return false;
    }
  } else if (data.albedo) return false;
  return true;
}

/** Latest pending snapshot per slot, with cancellation for obsolete running work.
 * Versions never reset, so an old message cannot apply to a replacement preset.
 * `region` (the live feature's mirror and fine-Glitter scope) travels with every request.
 */
export function createRasterClient(makeWorker: () => RasterPort,
  publish: (result: Completed) => void, failed: (reason?: string) => void, region: RasterRegion, size = 1024) {
  region = structuredClone(region);
  const queue = new Map<number, RasterRequest>(), versions = new Map<number, number>();
  let running: RasterRequest | undefined, cancelSent = false, sequence = 0;
  let cancellations = 0, completed = 0, discarded = 0, failures = 0;
  let worker: RasterPort | undefined;
  function recover(port: RasterPort | undefined) {
    if (port !== worker) return;
    if (running && queue.get(running.i)?.version === running.version) queue.delete(running.i);
    failures++; running = undefined; cancelSent = false; worker = undefined;
    // Construction and message delivery can throw before an error event exists.
    // Clear scheduling first, and never requeue the failed snapshot itself.
    try {port?.terminate();} catch { /* A dead port must not prevent recovery. */ }
    failed(); dispatch();
  }
  function cancelRunning() {
    if (!running || cancelSent) return;
    cancelSent = true; cancellations++;
    const port = worker, request = running;
    try {port?.postMessage({ cancel: request.version });}
    catch {if (running === request) recover(port);}
  }
  function dispatch() {
    if (running || !queue.size) return;
    const [i, request] = queue.entries().next().value!;
    queue.delete(i); running = request; cancelSent = false;
    try {
      worker ??= connect();
      worker.postMessage(request);
    } catch {
      // A synchronous mock/adapter may already have delivered the result; do
      // not tear down a replacement request if only that old send then throws.
      if (running === request) recover(worker);
    }
  }
  function connect() {
    const port = makeWorker();
    port.onmessage = ({ data }) => {
      if (port !== worker || !running) return;
      if (!data || typeof data !== "object") {recover(port); return;}
      if (running.version !== data.version || running.i !== data.i) return;
      if ("error" in data) {
        if (typeof data.error !== "string" || !data.error || data.error.length > 200) {recover(port);return;}
        running=undefined;cancelSent=false;failures++;
        failed(data.error);dispatch();return;
      }
      if (!data.cancelled && !validResult(data,running)) {recover(port); return;}
      running = undefined; cancelSent = false;
      if (!data.cancelled && versions.get(data.i) === data.version) {
        if (queue.get(data.i)?.version === data.version) queue.delete(data.i);
        completed++; publish(data);
      }
      else discarded++;
      dispatch();
    };
    port.onerror = () => recover(port);
    return port;
  }
  return {
    request(i: number, layer: Layer, prioritize = true, sizeOverride?: number, bakeOptics = false) {
      const requestedSize = sizeOverride ?? size;
      if (!Number.isInteger(requestedSize) || requestedSize < 1 || requestedSize > 4096 || typeof bakeOptics !== "boolean" ||
        (bakeOptics && layer.enabled && (layer.finish === "shimmer" || layer.finish === "glitter" && !isDirectGlint(layer.flakes)) && requestedSize < 32))
        throw Error("Invalid preview raster request.");
      const version = ++sequence;
      versions.set(i, version);
      const request = { i, version, layer: structuredClone(layer), size: requestedSize, region, bakeOptics };
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
      queued: queue.size, queuedIndices: [...queue.keys()], cancelling: cancelSent,
      cancellations, completed, discarded, failures }),
  };
}
