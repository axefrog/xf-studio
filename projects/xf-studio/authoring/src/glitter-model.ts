import {defaultFlakes, isIrregular, type Flakes} from "./finish";
import {defaultStudioIrregularFlakes, validStudioIrregularSettings, type IrregularFlakes} from "./flake-field";
import {defaultDirectGlintFlakes, defaultClusteredGlintFlakes, defaultFineSpeckleFlakes,
  isDirectGlint, type DirectGlintFlakes} from "./direct-glint-settings";
import type {Layer, Recipe} from "./recipe";

export type GlitterModel = "classic" | "irregular" | "direct" | "clustered" | "fine";
export type GlitterSettings = Flakes | IrregularFlakes | DirectGlintFlakes;
export type GlitterChoices = Record<string, Partial<Record<GlitterModel, GlitterSettings>>>;
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

export function parseGlitterChoices(value: unknown): GlitterChoices {
  const result: GlitterChoices = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [key, choices] of Object.entries(value).slice(0, 256)) {
    if (key.length > 180 || !choices || typeof choices !== "object" || Array.isArray(choices)) continue;
    const parsed: Partial<Record<GlitterModel, GlitterSettings>> = {};
    for (const model of glitterModels) {
      const candidate = (choices as Record<string, unknown>)[model];
      if (validGlitterSettings(model, candidate)) parsed[model] = structuredClone(candidate);
    }
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
  const schema = model === "fine" ? "xfs/recipe-10" : model === "clustered" ?
    (recipe.schema === "xfs/recipe-10" ? recipe.schema : "xfs/recipe-9") : model === "direct" ?
    (["xfs/recipe-8", "xfs/recipe-9", "xfs/recipe-10"].includes(recipe.schema) ? recipe.schema : "xfs/recipe-8") : model === "irregular" ?
    (recipe.schema === "xfs/recipe-6" ? "xfs/recipe-7" : recipe.schema) : recipe.schema;
  return {...recipe, schema, layers: recipe.layers.map((entry, i) => i === index ? {...entry, flakes} : entry)};
}
