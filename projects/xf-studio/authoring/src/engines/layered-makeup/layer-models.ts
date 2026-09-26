/**
 * Eye makeup's per-layer model registry (feature-module platform §2, CORE-09). A layer's optical
 * blocks name their own model: `flakes.model` (a Glitter model; classic flakes store none) and
 * `optics.model` (the game-matched finish model, with its Colour-shift settings). Each model is
 * registered once, with its validator and the oldest recipe file schema that holds it.
 *
 * - The in-memory recipe (`xfs/eye-makeup-part-2`) has no recipe-level model gate: every
 *   registered model is valid on any layer whose finish it suits.
 * - A recipe file (`eye-artistry/recipe-1`, `xfs/recipe-2`…`11`) keeps its historical gate: a
 *   layer model is valid only when the file's schema holds it (irregular Glitter 7, Direct 8,
 *   Clustered 9, Fine 10, game-matched optics 11), so every file reads exactly as before.
 * - Writers use the oldest recipe schema that holds every layer's models (never below 7). A new
 *   model registers with no `recipeSchema`; recipes using it are then written as part-2 only.
 *
 * "Version the model whenever appearance changes" applies per layer model: a changed look gets
 * a new model ID here, never a whole-recipe schema bump.
 */
import { isDirectGlint } from "./direct-glint-settings";
import type { Finish } from "./finish";
import { hasGameOptics } from "./finish-export";
import { NewerDataError } from "../../platform/api";
import { validStudioIrregularSettings } from "./flake-field";

/** Every recipe file schema, oldest first. */
export const RECIPE_FILE_SCHEMAS = ["eye-artistry/recipe-1", "xfs/recipe-2", "xfs/recipe-3", "xfs/recipe-4", "xfs/recipe-5",
  "xfs/recipe-6", "xfs/recipe-7", "xfs/recipe-8", "xfs/recipe-9", "xfs/recipe-10", "xfs/recipe-11"] as const;
export type RecipeFileSchema = typeof RECIPE_FILE_SCHEMAS[number];
/** Recipe schemas the Studio writes: older files read as recipe-7, which holds all of their content. */
export type RecipeSchema = "xfs/recipe-7" | "xfs/recipe-8" | "xfs/recipe-9" | "xfs/recipe-10" | "xfs/recipe-11";
/** The oldest schema a writer uses: what new recipes have always been written as. */
export const OLDEST_WRITTEN_SCHEMA: RecipeSchema = "xfs/recipe-7";
export const schemaRank = (schema: RecipeFileSchema) => RECIPE_FILE_SCHEMAS.indexOf(schema);

/** Which optical block of a layer a model describes. */
export type ModelSlot = "flakes" | "optics";
export interface LayerModel {
  readonly slot: ModelSlot;
  /** The stored model ID. Absent for classic flakes, the one model stored without a `model` field. */
  readonly id?: string;
  /** The oldest recipe file schema that holds this model; absent when only part-2 holds it. */
  readonly recipeSchema?: RecipeFileSchema;
  /** Whether `value` is a valid block of this model on a layer with this finish. */
  valid(value: unknown, finish: Finish): boolean;
}
type OpticalLayer = { finish: Finish; flakes?: unknown; optics?: unknown };

const num = (x: unknown, a: number, b: number) => typeof x === "number" && Number.isFinite(x) && x >= a && x <= b;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const glitter = (id: string, recipeSchema: RecipeFileSchema, valid: (value: unknown) => boolean): LayerModel =>
  ({ slot: "flakes", id, recipeSchema, valid: (value, finish) => finish === "glitter" && valid(value) });
const direct = (id: string, recipeSchema: RecipeFileSchema) =>
  glitter(id, recipeSchema, value => isDirectGlint(value) && value.model === id);

/** The models this build registers. */
export const EYE_MAKEUP_LAYER_MODELS: readonly LayerModel[] = Object.freeze([
  // Classic flakes: any finish, any schema (recipe-1 already stored them).
  { slot: "flakes", recipeSchema: "eye-artistry/recipe-1", valid: (value: unknown) => record(value) &&
    Number.isInteger(value.cells) && num(value.cells, 32, 256) && num(value.density, 0, 1) && num(value.tilt, 0, 1) &&
    Number.isInteger(value.seed) && num(value.seed, 0, 2147483647) },
  glitter("irregular-planar-1", "xfs/recipe-7", validStudioIrregularSettings),
  direct("uv-cell-direct-1", "xfs/recipe-8"),
  direct("uv-cell-direct-2", "xfs/recipe-9"),
  direct("uv-cell-direct-3", "xfs/recipe-10"),
  { slot: "optics", id: "game-matched-1", recipeSchema: "xfs/recipe-11", valid: (value: unknown, finish: Finish) => {
    if (!record(value) || value.model !== "game-matched-1" || !hasGameOptics(finish)) return false;
    const keys = Object.keys(value).sort().join();
    if (finish !== "iridescent") return keys === "model";
    const s = value.shift;
    return keys === "model,shift" && record(s) && Object.keys(s).sort().join() === "color,strength" &&
      typeof s.color === "string" && /^#[0-9a-f]{6}$/i.test(s.color) && num(s.strength, 0, 1);
  } },
] satisfies LayerModel[]);

export class LayerModelRegistry {
  private readonly models = new Map<string, LayerModel>();
  constructor(models: readonly LayerModel[]) {
    for (const model of models) {
      const key = LayerModelRegistry.key(model.slot, model.id);
      if (model.id === "" || this.models.has(key)) throw Error(`Layer model ${key} is registered twice or has an empty ID.`);
      if (model.id === undefined && model.slot !== "flakes") throw Error("Only classic flakes are stored without a model ID.");
      this.models.set(key, model);
    }
  }
  private static key(slot: ModelSlot, id: string | undefined) { return `${slot}:${id ?? ""}`; }
  /** The registered model a stored block names (flakes without a `model` field are classic), or undefined. */
  of(slot: ModelSlot, value: unknown): LayerModel | undefined {
    if (!record(value)) return undefined;
    if (!("model" in value)) return slot === "flakes" ? this.models.get(LayerModelRegistry.key(slot, undefined)) : undefined;
    return typeof value.model === "string" && value.model ? this.models.get(LayerModelRegistry.key(slot, value.model)) : undefined;
  }
  /** Whether a recipe file of `schema` holds `model`; with no schema (part-2) every registered model is held. */
  private holds(model: LayerModel, schema: RecipeFileSchema | undefined) {
    return schema === undefined || (model.recipeSchema !== undefined && schemaRank(model.recipeSchema) <= schemaRank(schema));
  }
  /**
   * Validate a layer's optical blocks, throwing the messages recipe files have always produced.
   * With a file `schema`, only models that schema holds are valid (the recipe-N gates). Without
   * one (part-2), a model ID this build does not register is named as coming from a newer build.
   */
  check(layer: OpticalLayer, schema?: RecipeFileSchema) {
    if (schema === undefined) for (const slot of ["flakes", "optics"] as const) {
      const value = layer[slot];
      if (record(value) && typeof value.model === "string" && value.model && !this.of(slot, value))
        throw new NewerDataError(`This look uses a finish model from a newer version of XF Studio (${value.model}).`);
    }
    if (layer.flakes !== undefined) {
      const f = layer.flakes;
      if (!record(f)) throw Error("Invalid flake settings.");
      const model = this.of("flakes", f);
      if (!model || !model.valid(f, layer.finish) || !this.holds(model, schema))
        throw Error("model" in f ? "Invalid experimental Glitter settings." : "Invalid flake settings.");
    }
    if (layer.optics !== undefined) {
      const model = this.of("optics", layer.optics);
      if (!model || !model.valid(layer.optics, layer.finish) || !this.holds(model, schema))
        throw Error("Invalid game-matched finish settings.");
    }
  }
  /** The recipe file schema a layer's models need (recipe-7 at least), or undefined when no recipe schema holds one. */
  layerSchema(layer: OpticalLayer): RecipeSchema | undefined {
    let rank = schemaRank(OLDEST_WRITTEN_SCHEMA);
    for (const [slot, value] of [["flakes", layer.flakes], ["optics", layer.optics]] as const) {
      if (value === undefined) continue;
      const needed = this.of(slot, value)?.recipeSchema;
      if (!needed) return undefined;
      rank = Math.max(rank, schemaRank(needed));
    }
    return RECIPE_FILE_SCHEMAS[rank] as RecipeSchema;
  }
  /** The oldest recipe file schema that holds every layer exactly, or undefined when none does. */
  minimalSchema(layers: readonly OpticalLayer[]): RecipeSchema | undefined {
    let rank = schemaRank(OLDEST_WRITTEN_SCHEMA);
    for (const layer of layers) {
      const schema = this.layerSchema(layer);
      if (!schema) return undefined;
      rank = Math.max(rank, schemaRank(schema));
    }
    return RECIPE_FILE_SCHEMAS[rank] as RecipeSchema;
  }
}

export const LAYER_MODELS = new LayerModelRegistry(EYE_MAKEUP_LAYER_MODELS);
