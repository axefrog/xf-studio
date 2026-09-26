/**
 * Eye makeup's input units, state-dependent limits and consequence override (feature-module platform
 * §1, §4, step 5): spec fields that were hand-kept tables in `action-limits.ts` and branches in
 * `action-consequences.ts`. Pure; reads the part it is given.
 */
import type { ConsequenceOverride, FeatureActionSpec, FeatureTarget, FieldLimit, SpecUnits } from "../../platform/api";
import { isIrregular } from "../../engines/layered-makeup/finish";
import { FLAKE_LIMITS, REGION_FLAKE_STUDY_LIMITS } from "../../engines/layered-makeup/flake-field";
import type { Recipe } from "../../engines/layered-makeup/recipe";
import type { EyeMakeupAction, EyeMakeupEditorState } from "../../eye-makeup-model";

type Limits = NonNullable<FeatureActionSpec<Recipe, EyeMakeupEditorState, EyeMakeupAction>["limits"]>;

/** The units of eye makeup's numeric and text inputs (`field`, or `variant.field` for a command or key variant). */
export const EYE_MAKEUP_UNITS: Partial<Record<EyeMakeupAction["kind"], SpecUnits>> = {
  "layer.setOpacity": { opacity: "fraction" }, "field.setReach": { radius: "uv" },
  "pigment.edit": { "point-strength.value": "fraction", "strength-blend.value": "uv" },
  "softness.edit": { "point-softness.value": "uv", "uniform-softness.value": "uv" },
  "glitter.setClassic": { "cells.value": "count", "density.value": "fraction", "tilt.value": "fraction" },
  "glitter.setIrregular": { "count.value": "count", "radius.value": "uv", "spread.value": "fraction", "tilt.value": "fraction" },
  "glitter.setDirect": { "density.value": "fraction", "fineShare.value": "fraction" },
  "layer.edit": { "rename.name": "characters", "move.to": "index" },
};

/** The layer a limit is asked about: the target layer, or a point's or warp control's layer. */
function targetLayer(recipe: Recipe, target: FeatureTarget) {
  const layerId = target.kind === "layer" ? target.id : target.kind === "point" || target.kind === "field" ? target.layerId : undefined;
  return layerId ? recipe.layers.find(item => item.id === layerId) : undefined;
}
const withLayer = (refine: (layer: Recipe["layers"][number], variant: string | undefined, base: Record<string, FieldLimit>) =>
  Record<string, FieldLimit>): Limits => (state, target, variant, base) => {
  const layer = targetLayer(state.part, target);
  return layer ? refine(layer, variant, base) : base;
};

/** Limits that depend on the look: layer positions, irregular Glitter density against flake size, and point modes. */
export const EYE_MAKEUP_LIMITS: Partial<Record<EyeMakeupAction["kind"], Limits>> = {
  // A layer moves within the stack it is in.
  "layer.edit": (state, _target, variant, base) => variant === "move" && base.to
    ? { ...base, to: { ...base.to, min: 0, max: Math.max(0, state.part.layers.length - 1) } } : base,
  "glitter.setIrregular": withLayer((layer, variant, base) => {
    if (!isIrregular(layer.flakes)) return base;
    const flakes = layer.flakes, dense = flakes.count > FLAKE_LIMITS.count, limits = { ...base };
    if (variant === "radius") limits.value = { ...limits.value, dependsOn: ["count"],
      min: dense ? REGION_FLAKE_STUDY_LIMITS.minRadius : FLAKE_LIMITS.minRadius,
      max: dense ? REGION_FLAKE_STUDY_LIMITS.maxRadius : FLAKE_LIMITS.maxRadius,
      ...(dense ? { note: "Dense fields are restricted to the eye UV regions and small flakes." } : {}) };
    if (variant === "count") {
      const threshold = FLAKE_LIMITS.count.toLocaleString("en");
      // A radius valid only for one side of the dense threshold pins the count to that side.
      limits.value = { ...limits.value, dependsOn: ["radius"], min: 0, max: REGION_FLAKE_STUDY_LIMITS.count };
      if (flakes.radius > REGION_FLAKE_STUDY_LIMITS.maxRadius) limits.value = { ...limits.value, max: FLAKE_LIMITS.count,
        note: `Fields denser than ${threshold} flakes need a flake size of ${REGION_FLAKE_STUDY_LIMITS.maxRadius * 100}% UV or less.` };
      else if (flakes.radius < FLAKE_LIMITS.minRadius) limits.value = { ...limits.value, min: FLAKE_LIMITS.count + 1,
        note: `Flakes smaller than ${FLAKE_LIMITS.minRadius * 100}% UV need a field denser than ${threshold} flakes.` };
    }
    return limits;
  }),
  "pigment.edit": withLayer((layer, variant, base) => variant === "strength-blend" && layer.strength.mode !== "smooth-boundary"
    ? { ...base, value: { ...base.value, requires: { reason: "Turn on smooth point gradients first." } } } : base),
  "softness.edit": withLayer((layer, variant, base) => variant === "point-softness" && layer.softness.mode !== "boundary"
    ? { ...base, value: { ...base.value, requires: { reason: "Enable point edge softness before editing an individual edge." } } } : base),
};

/** Removing a point, a warp control or a layer, or resetting a layer, takes layer content away (Undo brings it back). */
export function eyeMakeupConsequence(action: EyeMakeupAction): ConsequenceOverride | undefined {
  const destructive = action.kind === "point.remove" || action.kind === "field.remove" ||
    action.kind === "layer.edit" && (action.command.kind === "remove" || action.command.kind === "reset");
  return destructive ? { replaces: "layer-content" } : undefined;
}
