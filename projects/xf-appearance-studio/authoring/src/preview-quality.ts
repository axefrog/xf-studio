import type { Recipe } from "./recipe";

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

export type PreviewQualityAssessment = {
  accepted: boolean;
  error?: string;
  textureSize?: PreviewTextureSize;
  estimatedBytes: number;
  cpuBytes: number;
  gpuBytes: number;
  stagingBytes: number;
  workerBytes: number;
  enabledLayers: number;
  plainLayers: number;
  opticalLayers: number;
  generatedMaps: number;
  budgetBytes: number;
};

/** Generated-resource allocation estimate, not available VRAM or a hardware guarantee.
 * Each enabled layer keeps one RGBA8 CPU mask and its complete GPU mip pyramid.
 * Shimmer/glitter add two maps (normal and shared roughness/metalness), each with
 * the same CPU/GPU cost. Account for one largest-layer replacement bundle and
 * one mask worker output concurrently. Disabled layers use tiny placeholders.
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
  const opticalLayers = enabled.filter(layer => layer.finish === "shimmer" || layer.finish === "glitter").length;
  const plainLayers = enabled.length - opticalLayers, generatedMaps = plainLayers + opticalLayers * 3;
  const result: PreviewQualityAssessment = {
    accepted: false, estimatedBytes: 0, cpuBytes: 0, gpuBytes: 0, stagingBytes: 0, workerBytes: 0,
    enabledLayers: enabled.length, plainLayers, opticalLayers, generatedMaps, budgetBytes,
  };
  if (!isPreviewTextureSize(requestedSize))
    return { ...result, error: "Choose a preview size of 512, 1024, 2048 or 4096 pixels." };
  result.textureSize = requestedSize;
  const baseBytes = requestedSize ** 2 * 4;
  // All supported sizes are powers of two; this sums every RGBA8 mip exactly.
  let gpuMapBytes = 0;
  for (let side: number = requestedSize; side >= 1; side /= 2) gpuMapBytes += side ** 2 * 4;
  result.cpuBytes = generatedMaps * baseBytes;
  result.gpuBytes = generatedMaps * gpuMapBytes;
  const largestBundleMaps = opticalLayers ? 3 : plainLayers ? 1 : 0;
  result.stagingBytes = largestBundleMaps * (baseBytes + gpuMapBytes);
  result.workerBytes = enabled.length ? baseBytes : 0;
  result.estimatedBytes = result.cpuBytes + result.gpuBytes + result.stagingBytes + result.workerBytes;
  if (!Number.isSafeInteger(hardwareMaxTextureSize) || hardwareMaxTextureSize < 1)
    return { ...result, error: "The renderer's maximum texture size is unavailable." };
  if (requestedSize > hardwareMaxTextureSize)
    return { ...result, error: `This renderer supports textures up to ${hardwareMaxTextureSize} pixels; ${requestedSize} is unavailable.` };
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 0)
    return { ...result, error: "The generated-texture memory budget is invalid." };
  if (result.estimatedBytes > budgetBytes)
    return { ...result, error: `This preview needs about ${(result.estimatedBytes / 1024 ** 2).toFixed(0)} MiB of generated textures, above the ${(budgetBytes / 1024 ** 2).toFixed(0)} MiB budget. Choose a smaller preview size or disable layers.` };
  return { ...result, accepted: true };
}
