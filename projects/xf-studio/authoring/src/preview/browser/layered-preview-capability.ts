/** The registered layered-makeup preview owns its raster device, worker and measurements. CORE-03 compatibility placement. */
import { createBrowserPreviewDevice } from "../../legacy/eye-makeup/browser/browser-preview-device";
import { GlitterMeasurements } from "../../legacy/eye-makeup/glitter-measurements";
import { rasterRegion, type LayeredMakeupRegion } from "../../engines/layered-makeup/region";
import type { BrowserPreviewCapability } from "./preview-capabilities";
import type { PreviewLayerSource } from "../../legacy/eye-makeup/preview/authoring-render-scheduler";
export function createLayeredPreviewCapability(region: LayeredMakeupRegion): BrowserPreviewCapability {
  return { create(state, options) {
    const { document: source } = state as { readonly document: PreviewLayerSource };
    const measurements = new GlitterMeasurements({ layers: () => source.recipe.layers,
      size: () => device.coordinator.size, fineGlitter: region.fineGlitter });
    const device = createBrowserPreviewDevice({ ...options, document: source, region: rasterRegion(region),
      makeWorker: options.makeWorker ?? (() => new Worker("/build/raster-worker.js", { type: "module" })),
      measurement: (layer, size, stats) => { measurements.record(layer, size, stats); options.changed(); } });
    return { ...device, feature: region.id, measurements: () => measurements.snapshot(),
      start() { for (let i = 0; i < source.recipe.layers.length; i++) device.coordinator.render(i); } };
  } };
}
