import { createRasterProcessor, type RasterRequest } from "./raster-processor";
import { createRasterTaskYield } from "./raster-task-yield";
const processor = createRasterProcessor(result => self.postMessage(result,
  { transfer: result.cancelled ? [] : [result.data.buffer, ...(result.optics ? [result.optics.normal.buffer,result.optics.surface.buffer] : [])] }),createRasterTaskYield());
self.onmessage = (e: MessageEvent<RasterRequest | { cancel: number }>) => {
  if ("cancel" in e.data) processor.cancel(e.data.cancel);
  // Surface asynchronous errors through the worker's standard error event.
  else void processor.start(e.data).catch(error => setTimeout(() => { throw error; }, 0));
};
