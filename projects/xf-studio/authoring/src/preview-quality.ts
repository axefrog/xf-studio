import type { Recipe } from "./engines/layered-makeup/recipe";
import {isDirectGlint} from "./engines/layered-makeup/direct-glint-settings";
import { canonicalFinish } from "./engines/layered-makeup/finish";
import { SHIMMER_GRAIN } from "./engines/layered-makeup/shimmer-grain";

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
  /** Of the optical layers, game-matched Shimmer's: their grain maps have a fixed size, whatever the preview size. */
  grainLayers: number;
  irregularLayers: number;
  generatedMaps: number;
  budgetBytes: number;
};

/** Generated-resource allocation estimate, not available VRAM or a hardware guarantee.
 * Each enabled layer keeps one RGBA8 CPU mask and its complete GPU mip pyramid.
 * Shimmer and legacy Glitter add normal and packed surface maps; irregular
 * Glitter also owns a separate sRGB albedo map. Account for the largest
 * replacement bundle and conservative worker/cache/catalogue peak.
 * Game-matched Shimmer's two grain maps are not at the preview size: they are complete chains over the region's
 * optics window, bounded by SHIMMER_GRAIN.previewMaxTexels, held once on the CPU (the uploaded mip arrays) and once
 * on the GPU; the worker's bake and chain build peak near 25 bytes per grain texel; and with any grain merged, the
 * plate composite runs at the grain's density (bounded here by the same texel count, half-float, 10 channels plus
 * an 11-channel mip chain).
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
  const grainLayers = enabled.filter(layer => canonicalFinish(layer.finish) === "shimmer" && !!layer.optics).length;
  const plainLayers = enabled.length - opticalLayers, generatedMaps = plainLayers + opticalLayers * 3 + irregularLayers;
  const result: PreviewQualityAssessment = {
    accepted: false, estimatedBytes: 0, cpuBytes: 0, gpuBytes: 0, stagingBytes: 0, workerBytes: 0,
    enabledLayers: enabled.length, plainLayers, opticalLayers, grainLayers, irregularLayers, generatedMaps, budgetBytes,
  };
  if (!isPreviewTextureSize(requestedSize))
    return { ...result, code: "invalid_value", error: "Choose a preview size of 512, 1024, 2048 or 4096 pixels." };
  result.textureSize = requestedSize;
  const baseBytes = requestedSize ** 2 * 4;
  // All supported sizes are powers of two; this sums every RGBA8 mip exactly.
  let gpuMapBytes = 0;
  for (let side: number = requestedSize; side >= 1; side /= 2) gpuMapBytes += side ** 2 * 4;
  // Grain maps: an RGBA chain over at most previewMaxTexels (2048 × 1024 halves exactly to 1 × 1).
  let grainChain = 0;
  for (let w = 2048, h = SHIMMER_GRAIN.previewMaxTexels / 2048; ; w = Math.max(1, w / 2), h = Math.max(1, h / 2)) {
    grainChain += w * h * 4; if (w === 1 && h === 1) break;
  }
  const sizedMaps = generatedMaps - 2 * grainLayers;
  const composite = grainLayers ? Math.round(SHIMMER_GRAIN.previewMaxTexels * 2 * (10 + 11 * 4 / 3)) : 0;
  result.cpuBytes = sizedMaps * baseBytes + grainLayers * 2 * grainChain;
  result.gpuBytes = sizedMaps * gpuMapBytes + grainLayers * 2 * grainChain + composite;
  const largestBundleMaps = irregularLayers ? 4 : opticalLayers > grainLayers ? 3 : plainLayers || grainLayers ? 1 : 0;
  result.stagingBytes = Math.max(largestBundleMaps * (baseBytes + gpuMapBytes), grainLayers ? baseBytes + gpuMapBytes + 4 * grainChain : 0);
  // Candidate peak includes mask, two optics, one temporary packed coverage
  // surface, albedo, compact channel, bounded cache/catalogue and tile scratch.
  // A grain bake holds its two-channel maps (4 bytes a texel), both chains and the level-1 planes (10 bytes a texel).
  const grainWorker = grainLayers ? baseBytes + 2 * grainChain + 14 * SHIMMER_GRAIN.previewMaxTexels : 0;
  result.workerBytes = Math.max(grainWorker, irregularLayers ? Math.ceil(baseBytes*5.25) + 64*1024**2 + 128*1024**2 + 64*1024
    : enabled.length ? baseBytes : 0);
  result.estimatedBytes = result.cpuBytes + result.gpuBytes + result.stagingBytes + result.workerBytes;
  if (!Number.isSafeInteger(hardwareMaxTextureSize) || hardwareMaxTextureSize < 1)
    return { ...result, code: "unavailable", error: "The renderer's maximum texture size is unavailable." };
  if (requestedSize > hardwareMaxTextureSize)
    return { ...result, code: "unavailable", error: `This renderer supports textures up to ${hardwareMaxTextureSize} pixels; ${requestedSize} is unavailable.` };
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 0)
    return { ...result, code: "limit", error: "The generated-texture memory budget is invalid." };
  if (result.estimatedBytes > budgetBytes)
    return { ...result, code: "limit", error: `This size needs about ${Math.ceil(result.estimatedBytes / 1e6)} MB for the makeup textures, more than the ${Math.floor(budgetBytes / 1e6)} MB set aside. Choose a smaller size or hide some layers.` };
  return { ...result, accepted: true };
}
