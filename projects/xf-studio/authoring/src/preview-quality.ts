import type { Recipe } from "./engines/layered-makeup/recipe";
import {isDirectGlint} from "./engines/layered-makeup/direct-glint-settings";

export const PREVIEW_TEXTURE_SIZES = [512, 1024, 2048, 4096] as const;
export type PreviewTextureSize = (typeof PREVIEW_TEXTURE_SIZES)[number];
export const DEFAULT_PREVIEW_TEXTURE_SIZE: PreviewTextureSize = 1024;
export const DEFAULT_PREVIEW_BUDGET_BYTES = 1024 ** 3;

export function isPreviewTextureSize(value: unknown): value is PreviewTextureSize {
  return typeof value === "number" && (PREVIEW_TEXTURE_SIZES as readonly number[]).includes(value);
}
/** Saved preferences fall back; an explicit quality request must use assessment. */
export function parsePreviewTextureSize(value: unknown): PreviewTextureSize {
  return isPreviewTextureSize(value) ? value : DEFAULT_PREVIEW_TEXTURE_SIZE;
}

/** Why a size is refused: not a supported size, beyond the renderer, or over the generated-texture budget. */
export type PreviewQualityRefusal = "invalid_value" | "unavailable" | "limit";
export type PreviewQualityAssessment = {
  accepted: boolean;
  error?: string;
  /** Present with `error`: the refusal's reason code. */
  code?: PreviewQualityRefusal;
  textureSize?: PreviewTextureSize;
  estimatedBytes: number;
  cpuBytes: number;
  gpuBytes: number;
  stagingBytes: number;
  workerBytes: number;
  enabledLayers: number;
  plainLayers: number;
  opticalLayers: number;
  irregularLayers: number;
  generatedMaps: number;
  budgetBytes: number;
};

/** Generated-resource allocation estimate, not available VRAM or a hardware guarantee.
 * Each enabled layer keeps one RGBA8 CPU mask and its complete GPU mip pyramid.
 * Shimmer and legacy Glitter add normal and packed surface maps; irregular
 * Glitter also owns a separate sRGB albedo map. Account for the largest
 * replacement bundle and conservative worker/cache/catalogue peak.
 * Disabled layers use tiny placeholders.
 * Native game assets, meshes, framebuffers, browser/driver overhead, compression
 * and delayed GPU disposal are outside this operational budget.
 */
export function assessPreviewQuality(
  recipe: Pick<Recipe, "layers">,
  requestedSize: unknown,
  hardwareMaxTextureSize: number,
  budgetBytes = DEFAULT_PREVIEW_BUDGET_BYTES,
): PreviewQualityAssessment {
  const enabled = recipe.layers.filter(layer => layer.enabled);
  const opticalLayers = enabled.filter(layer => layer.finish === "shimmer" ||
    layer.finish === "glitter" && !isDirectGlint(layer.flakes)).length;
  const irregularLayers=enabled.filter(layer=>layer.finish==="glitter" && layer.flakes && "model" in layer.flakes && layer.flakes.model==="irregular-planar-1").length;
  const plainLayers = enabled.length - opticalLayers, generatedMaps = plainLayers + opticalLayers * 3 + irregularLayers;
  const result: PreviewQualityAssessment = {
    accepted: false, estimatedBytes: 0, cpuBytes: 0, gpuBytes: 0, stagingBytes: 0, workerBytes: 0,
    enabledLayers: enabled.length, plainLayers, opticalLayers, irregularLayers, generatedMaps, budgetBytes,
  };
  if (!isPreviewTextureSize(requestedSize))
    return { ...result, code: "invalid_value", error: "Choose a preview size of 512, 1024, 2048 or 4096 pixels." };
  result.textureSize = requestedSize;
  const baseBytes = requestedSize ** 2 * 4;
  // All supported sizes are powers of two; this sums every RGBA8 mip exactly.
  let gpuMapBytes = 0;
  for (let side: number = requestedSize; side >= 1; side /= 2) gpuMapBytes += side ** 2 * 4;
  result.cpuBytes = generatedMaps * baseBytes;
  result.gpuBytes = generatedMaps * gpuMapBytes;
  const largestBundleMaps = irregularLayers ? 4 : opticalLayers ? 3 : plainLayers ? 1 : 0;
  result.stagingBytes = largestBundleMaps * (baseBytes + gpuMapBytes);
  // Candidate peak includes mask, two optics, one temporary packed coverage
  // surface, albedo, compact channel, bounded cache/catalogue and tile scratch.
  result.workerBytes = irregularLayers ? Math.ceil(baseBytes*5.25) + 64*1024**2 + 128*1024**2 + 64*1024
    : enabled.length ? baseBytes : 0;
  result.estimatedBytes = result.cpuBytes + result.gpuBytes + result.stagingBytes + result.workerBytes;
  if (!Number.isSafeInteger(hardwareMaxTextureSize) || hardwareMaxTextureSize < 1)
    return { ...result, code: "unavailable", error: "The renderer's maximum texture size is unavailable." };
  if (requestedSize > hardwareMaxTextureSize)
    return { ...result, code: "unavailable", error: `This renderer supports textures up to ${hardwareMaxTextureSize} pixels; ${requestedSize} is unavailable.` };
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 0)
    return { ...result, code: "limit", error: "The generated-texture memory budget is invalid." };
  if (result.estimatedBytes > budgetBytes)
    return { ...result, code: "limit", error: `This preview needs about ${(result.estimatedBytes / 1024 ** 2).toFixed(0)} MiB of generated textures, above the ${(budgetBytes / 1024 ** 2).toFixed(0)} MiB budget. Choose a smaller preview size or disable layers.` };
  return { ...result, accepted: true };
}
