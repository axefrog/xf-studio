import { raster, type Layer } from "./recipe";
self.onmessage = (
  e: MessageEvent<{ i: number; version: number; layer: Layer; size: number }>,
) => {
  const start = performance.now(),
    { i, version, layer, size } = e.data;
  const data = raster(layer, size);
  self.postMessage(
    { i, version, data, ms: performance.now() - start },
    { transfer: [data.buffer] },
  );
};
