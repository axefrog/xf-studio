import { isIrregular } from "./finish";
import { FLAKE_LIMITS, REGION_FLAKE_STUDY_LIMITS } from "./flake-field";
import type { Recipe } from "./recipe";
import type { ReadonlyDeep } from "./read-only";
import { ACTION_DESCRIPTORS, type ValueSchema } from "./studio-action-descriptors";
import type { StudioAction, StudioTarget } from "./studio-application";

export type LimitUnit = "uv" | "fraction" | "count" | "degrees" | "pixels" | "characters" | "index";
/**
 * Current limits for one input field of an action on a concrete target. `min`/`max`
 * include state-dependent bounds (for example irregular Glitter flake size depends on
 * flake count); `requires` explains a mode the target must be in first. Advisory, like
 * every capability: dispatch and the recipe parser remain authoritative.
 */
export type FieldLimit = { min?: number; max?: number; minLength?: number; maxLength?: number;
  unit?: LimitUnit; dependsOn?: string[]; note?: string; requires?: { reason: string } };

const units: Record<string, LimitUnit> = {
  "layer.setOpacity.opacity": "fraction", "field.setReach.radius": "uv",
  "pigment.edit.point-strength.value": "fraction", "pigment.edit.strength-blend.value": "uv",
  "softness.edit.point-softness.value": "uv", "softness.edit.uniform-softness.value": "uv",
  "glitter.setClassic.cells.value": "count", "glitter.setClassic.density.value": "fraction", "glitter.setClassic.tilt.value": "fraction",
  "glitter.setIrregular.count.value": "count", "glitter.setIrregular.radius.value": "uv",
  "glitter.setIrregular.spread.value": "fraction", "glitter.setIrregular.tilt.value": "fraction",
  "glitter.setDirect.density.value": "fraction", "glitter.setDirect.fineShare.value": "fraction",
  "camera.setFov.degrees": "degrees", "preview.setKeyAngle.degrees": "degrees", "motion.setBlink.value": "fraction",
  "layer.edit.rename.name": "characters", "preset.edit.rename.name": "characters", "layer.edit.move.to": "index", "preset.edit.move.to": "index",
};

/** Input fields of `kind` (and its nested `variant`) with static and state-dependent limits. */
export function actionLimits(recipe: ReadonlyDeep<Recipe>, target: StudioTarget, kind: StudioAction["kind"],
  variant?: string): Record<string, FieldLimit> {
  const descriptor = ACTION_DESCRIPTORS[kind] as { payload: Record<string, ValueSchema>;
    variants?: Record<string, { payload: Record<string, ValueSchema> }> };
  const fields = { ...descriptor.payload, ...(variant ? descriptor.variants?.[variant]?.payload : undefined) };
  const limits: Record<string, FieldLimit> = {};
  for (const [name, schema] of Object.entries(fields)) {
    if (schema.from !== "input" || schema.type === "object" || schema.type === "boolean" || schema.type === "bytes") continue;
    const unit = units[[kind, variant, name].filter(Boolean).join(".")];
    limits[name] = { ...(schema.min === undefined ? {} : { min: schema.min }), ...(schema.max === undefined ? {} : { max: schema.max }),
      ...(schema.minLength === undefined ? {} : { minLength: schema.minLength }),
      ...(schema.maxLength === undefined ? {} : { maxLength: schema.maxLength }), ...(unit ? { unit } : {}) };
  }
  const layerId = target.kind === "layer" ? target.id : target.kind === "point" || target.kind === "field" ? target.layerId : undefined;
  const layer = layerId ? recipe.layers.find(item => item.id === layerId) : undefined;
  if (kind === "layer.edit" && variant === "move" && limits.to)
    limits.to = { ...limits.to, min: 0, max: Math.max(0, recipe.layers.length - 1) };
  if (!layer) return limits;
  if (kind === "glitter.setIrregular" && isIrregular(layer.flakes)) {
    const flakes = layer.flakes, dense = flakes.count > FLAKE_LIMITS.count;
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
  }
  if (kind === "pigment.edit" && variant === "strength-blend" && layer.strength.mode !== "smooth-boundary")
    limits.value = { ...limits.value, requires: { reason: "Turn on smooth point gradients first." } };
  if (kind === "softness.edit" && variant === "point-softness" && layer.softness.mode !== "boundary")
    limits.value = { ...limits.value, requires: { reason: "Enable point edge softness before editing an individual edge." } };
  return limits;
}
