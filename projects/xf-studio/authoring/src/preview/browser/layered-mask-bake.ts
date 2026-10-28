/** The registered layered feature owns mask-worker inputs; the file device owns picker/download mechanics. */
import type { BrowserMaskBake } from "../../app/browser/browser-file-device";
import type { Layer } from "../../engines/layered-makeup/recipe";
import { rasterRegion, type LayeredMakeupRegion } from "../../engines/layered-makeup/region";
import type { RasterResponse } from "../../engines/layered-makeup/raster-processor";
export function layeredMaskBake(region: LayeredMakeupRegion): BrowserMaskBake {
  return { create(options) { return (value, signal) => new Promise<Blob>((resolve, reject) => {
    signal?.throwIfAborted();
    const bake = new Worker(options.workerUrl ?? "/build/raster-worker.js", { type: "module" });
    let settled = false, terminated = false;
    const stopWorker = () => { if (!terminated) { terminated = true; bake.terminate(); } };
    const cleanup = () => { stopWorker(); signal?.removeEventListener("abort", abort); };
    const fail = (reason: unknown) => { if (settled) return; settled = true; cleanup(); reject(reason); };
    const abort = () => fail(signal!.reason);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    bake.onmessage = (event: MessageEvent<RasterResponse>) => {
      if (settled) return;
      try {
        const response = event.data;
        if (!("data" in response) || response.size !== 2048 || response.data.length !== 2048 * 2048 * 4)
          throw Error("Mask export failed.");
        const canvas = options.document.createElement("canvas"); canvas.width = canvas.height = 2048;
        canvas.getContext("2d")!.putImageData(new ImageData(response.data, 2048, 2048), 0, 0);
        stopWorker();
        canvas.toBlob(blob => {
          if (settled) return;
          if (!blob) { fail(Error("Mask export failed.")); return; }
          settled = true; cleanup(); resolve(blob);
        });
      } catch (error) { fail(error); }
    };
    bake.onerror = () => fail(Error("Mask export failed."));
    try { bake.postMessage({ i: 0, version: 0, layer: { ...value as Layer, enabled: true }, size: 2048, region: rasterRegion(region) }); }
    catch (error) { fail(error); }
  }); } };
}
