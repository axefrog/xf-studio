import { isDirectGlint } from "./direct-glint-settings";
import { canonicalFinish } from "./finish";
import type { PreviewQualityAssessment, PreviewTextureSize } from "./preview-quality";
import type { Layer, Recipe } from "./recipe";

export type LayerPreviewPlan =
  | { kind: "missing" }
  | { kind: "unavailable"; layer: Layer; releaseDisabled: boolean; reason: string }
  | { kind: "recover"; layer: Layer; releaseDisabled: boolean }
  | { kind: "request"; layer: Layer; releaseDisabled: boolean;
      size: number; priority: boolean; needsOptics: boolean };

/** High-level layer policy; renderer adapter owns placeholders, workers and publication. */
export function planLayerPreview(input: { recipe: Recipe; index: number; active: number;
  size: PreviewTextureSize; assessment: PreviewQualityAssessment; blocked: boolean;
  opticsMissing(layer: Layer, size: PreviewTextureSize): boolean }): LayerPreviewPlan {
  const layer = input.recipe.layers[input.index];
  if (!layer) return { kind: "missing" };
  const releaseDisabled = !layer.enabled;
  if (!input.assessment.accepted) return { kind: "unavailable", layer, releaseDisabled,
    reason: input.assessment.error ?? "Preview quality is unavailable." };
  if (input.blocked) return { kind: "recover", layer, releaseDisabled };
  const needsOptics = layer.enabled && !isDirectGlint(layer.flakes) &&
    ["shimmer", "glitter"].includes(canonicalFinish(layer.finish)) && input.opticsMissing(layer, input.size);
  return { kind: "request", layer, releaseDisabled, size: layer.enabled ? input.size : 1,
    priority: input.index === input.active, needsOptics };
}

export function previewCapacity(assessment: PreviewQualityAssessment) {
  return { available: assessment.accepted, reason: assessment.error,
    estimatedBytes: assessment.estimatedBytes, enabledLayers: assessment.enabledLayers };
}
