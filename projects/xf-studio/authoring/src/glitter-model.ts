import {defaultFlakes, isIrregular, type Flakes} from "./finish";
import {defaultStudioIrregularFlakes, validStudioIrregularSettings, type IrregularFlakes} from "./flake-field";
import {defaultDirectGlintFlakes, defaultClusteredGlintFlakes, defaultFineSpeckleFlakes,
  isDirectGlint, type DirectGlintFlakes} from "./direct-glint-settings";
import type {Layer, Recipe} from "./recipe";
import {requiredRecipeSchema} from "./recipe-schema";

export type GlitterModel = "classic" | "irregular" | "direct" | "clustered" | "fine";
export type GlitterSettings = Flakes | IrregularFlakes | DirectGlintFlakes;
/** Colour-shift settings of a game-matched Colour-shifting layer. */
export type ShiftSettings = { color: string; strength: number };
/** Editor memory for one layer (`<preset>/<layer>`): each inactive Glitter model's settings and the
 * last Colour-shift settings, so switching away and back restores them. Never part of the recipe;
 * stored in the workspace under its historical `glitterChoices` key. */
export type LayerChoices = Partial<Record<GlitterModel, GlitterSettings>> & { shift?: ShiftSettings };
export type GlitterChoices = Record<string, LayerChoices>;
export const glitterModels: readonly GlitterModel[] = ["classic", "irregular", "direct", "clustered", "fine"];

export function glitterModel(flakes: Layer["flakes"]): GlitterModel {
  if (isIrregular(flakes)) return "irregular";
  if (isDirectGlint(flakes)) return ({"uv-cell-direct-1":"direct", "uv-cell-direct-2":"clustered", "uv-cell-direct-3":"fine"} as const)[flakes.model];
  return "classic";
}

export function validGlitterSettings(model: GlitterModel, value: unknown): value is GlitterSettings {
  if (model === "irregular") return validStudioIrregularSettings(value);
  if (model !== "classic") return isDirectGlint(value) && glitterModel(value) === model;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const f = value as Flakes;
  return Object.keys(f).sort().join() === "cells,density,seed,tilt" &&
    Number.isInteger(f.cells) && f.cells >= 32 && f.cells <= 256 &&
    Number.isFinite(f.density) && f.density >= 0 && f.density <= 1 &&
    Number.isFinite(f.tilt) && f.tilt >= 0 && f.tilt <= 1 &&
    Number.isInteger(f.seed) && f.seed >= 0 && f.seed <= 2147483647;
}

export function validShiftSettings(value: unknown): value is ShiftSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const s = value as ShiftSettings;
  return Object.keys(s).sort().join() === "color,strength" && typeof s.color === "string" && /^#[0-9a-f]{6}$/i.test(s.color) &&
    typeof s.strength === "number" && Number.isFinite(s.strength) && s.strength >= 0 && s.strength <= 1;
}

export function parseGlitterChoices(value: unknown): GlitterChoices {
  const result: GlitterChoices = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [key, choices] of Object.entries(value).slice(0, 256)) {
    if (key.length > 180 || !choices || typeof choices !== "object" || Array.isArray(choices)) continue;
    const parsed: LayerChoices = {};
    for (const model of glitterModels) {
      const candidate = (choices as Record<string, unknown>)[model];
      if (validGlitterSettings(model, candidate)) parsed[model] = structuredClone(candidate);
    }
    const shift = (choices as Record<string, unknown>).shift;
    if (validShiftSettings(shift)) parsed.shift = { color: shift.color, strength: shift.strength };
    if (Object.keys(parsed).length) result[key] = parsed;
  }
  return result;
}

function defaults(model: GlitterModel): GlitterSettings {
  return model === "classic" ? defaultFlakes() : model === "irregular" ? defaultStudioIrregularFlakes() :
    model === "direct" ? defaultDirectGlintFlakes() : model === "clustered" ? defaultClusteredGlintFlakes() : defaultFineSpeckleFlakes();
}

/** The portable recipe stores only the selected model. Inactive choices are local editor memory. */
export function selectGlitterModel(recipe: Recipe, layerId: string, model: GlitterModel,
  choices: GlitterChoices, scope = "draft"): Recipe {
  const index = recipe.layers.findIndex(layer => layer.id === layerId);
  const layer = recipe.layers[index];
  if (!layer || layer.finish !== "glitter") throw Error("Select a Glitter layer first.");
  if (glitterModel(layer.flakes) === model) return recipe;
  const key = `${scope}/${layerId}`, remembered = choices[key] ??= {};
  const previous = glitterModel(layer.flakes);
  remembered[previous] = structuredClone(layer.flakes ?? defaultFlakes());
  const saved = remembered[model];
  const flakes = saved && validGlitterSettings(model, saved) ? structuredClone(saved) : defaults(model);
  const layers = recipe.layers.map((entry, i) => i === index ? {...entry, flakes} : entry);
  return {...recipe, schema: requiredRecipeSchema({schema: recipe.schema, layers}), layers};
}
