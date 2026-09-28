import { createRasterProcessor, type RasterRequest } from "./engines/layered-makeup/raster-processor";
import { isGrainOptics } from "./engines/layered-makeup/shimmer-grain";
import { createRasterTaskYield } from "./raster-task-yield";
const processor = createRasterProcessor(result => self.postMessage(result,
  { transfer: result.cancelled || "error" in result ? [] : [result.data.buffer, ...(isGrainOptics(result.optics) ? [...result.optics.normal, ...result.optics.surface].map(level => level.buffer)
      : result.optics ? [result.optics.normal.buffer,result.optics.surface.buffer] : []),
    ...(result.albedo ? [result.albedo.data.buffer] : [])] }),createRasterTaskYield());
self.onmessage = (e: MessageEvent<RasterRequest | { cancel: number }>) => {
  if ("cancel" in e.data) processor.cancel(e.data.cancel);
  // Surface asynchronous errors through the worker's standard error event.
  else void processor.start(e.data).catch(error => setTimeout(() => { throw error; }, 0));
};
