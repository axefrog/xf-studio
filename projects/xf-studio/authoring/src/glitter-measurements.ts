import { FLAKE_LIMITS } from "./engines/layered-makeup/flake-field";
import { isIrregular } from "./engines/layered-makeup/finish";
import { maskAlphaKey, previewOpticalKey } from "./engines/layered-makeup/makeup-dependencies";
import type { GlitterPreviewMeasurement } from "./presentation-status";
import type { GlitterStats } from "./engines/layered-makeup/raster-processor";
import type { Layer } from "./engines/layered-makeup/recipe";
import type { ReadonlyDeep } from "./read-only";
import type { FineGlitterScope } from "./engines/layered-makeup/region";

/** Trusted reads the service needs; the composition root supplies the live document and preview tier. */
export type GlitterMeasurementPort = {
  layers(): readonly ReadonlyDeep<Layer>[];
  /** Current preview texture size; a measurement taken at another tier is historical. */
  size(): number;
  /** The live feature's fine-Glitter scope (its region's), part of each optical identity. */
  readonly fineGlitter: FineGlitterScope;
};

/**
 * Application service for irregular-Glitter preview measurements. The preview
 * device records worker statistics; presentations read detached
 * `GlitterPreviewMeasurement`s that state whether the figures still describe
 * the layer's current optical and mask identity at the current tier. Only
 * irregular Glitter layers are reported; a count is not a visible sparkle count.
 */
export class GlitterMeasurements {
  private entries = new Map<string, { opticalKey: string; maskKey: string; size: number; stats: GlitterStats }>();
  constructor(private port: GlitterMeasurementPort) {}

  record(layer: ReadonlyDeep<Layer>, size: number, stats: GlitterStats) {
    this.entries.set(layer.id, { opticalKey: previewOpticalKey(layer, size, this.port.fineGlitter), maskKey: maskAlphaKey(layer, size), size, stats: { ...stats } });
  }

  /** Measurement for one layer, or undefined when it is not irregular Glitter or was never measured. */
  forLayer(layer: ReadonlyDeep<Layer>): GlitterPreviewMeasurement | undefined {
    const measured = this.entries.get(layer.id);
    if (!measured || layer.finish !== "glitter" || !isIrregular(layer.flakes)) return undefined;
    const size = this.port.size();
    return { layerId: layer.id, size: measured.size, maskCentres: measured.stats.maskCentres,
      regionRetained: measured.stats.regionRetained, coveredPixels: measured.stats.coveredPixels,
      dense: layer.flakes.count > FLAKE_LIMITS.count,
      current: measured.opticalKey === previewOpticalKey(layer, size, this.port.fineGlitter) && measured.maskKey === maskAlphaKey(layer, size) };
  }

  /** Detached measurements for every measured irregular-Glitter layer, in stack order. */
  snapshot(): GlitterPreviewMeasurement[] {
    return this.port.layers().flatMap(layer => this.forLayer(layer) ?? []);
  }
}
