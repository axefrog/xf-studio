/**
 * Eye makeup's portable recipe formats and their lineage. The in-memory recipe (`xfs/eye-makeup-part-2`) has no
 * schema of its own; a recipe file, or an `xfs/eye-makeup-part-1` body, is written in the oldest `xfs/recipe-N`
 * that holds every layer's models, so older builds, 0.1.0-alpha.1 included, keep reading what this build writes
 * whenever the content allows. No edit ever changes a schema: it is derived when a recipe is written.
 *
 * The layered-makeup engine reads only the current in-memory form; the file lineage (`eye-artistry/recipe-1`,
 * `xfs/recipe-2`…`11`, which structural forms and layer models each holds) is eye makeup's and lives here. Files
 * migrate on read exactly as they always have.
 */
import { CLASSIC_FLAKES, DIRECT_GLINT_1, DIRECT_GLINT_2, DIRECT_GLINT_3, GAME_MATCHED_OPTICS, IRREGULAR_GLITTER,
  LayerModelRegistry, type LayerModel } from "./engines/layered-makeup/layer-models";
import { NewerDataError } from "./platform/api";
import { MAX_LAYERS, parseRecipe as parseInMemory, readLayers, type Recipe } from "./engines/layered-makeup/recipe";

/** Eye makeup's feature ID: its part's key in a look (feature-module platform §2). */
export const EYE_MAKEUP_FEATURE = "eye-makeup" as const;
/** Eye makeup's first part schema: a recipe file body (`xfs/recipe-N`). */
export const EYE_MAKEUP_PART_1 = "xfs/eye-makeup-part-1";
/** Eye makeup's part schema with the per-layer model registry (feature-module platform §2). */
export const EYE_MAKEUP_PART_2 = "xfs/eye-makeup-part-2";
const EYE_MAKEUP_PART = /^xfs\/eye-makeup-part-\d+$/;

/** Every recipe file schema, oldest first. */
export const RECIPE_FILE_SCHEMAS = ["eye-artistry/recipe-1", "xfs/recipe-2", "xfs/recipe-3", "xfs/recipe-4", "xfs/recipe-5",
  "xfs/recipe-6", "xfs/recipe-7", "xfs/recipe-8", "xfs/recipe-9", "xfs/recipe-10", "xfs/recipe-11"] as const;
export type RecipeFileSchema = typeof RECIPE_FILE_SCHEMAS[number];
/** Recipe schemas the Studio writes: older files read as recipe-7, which holds all of their content. */
export type RecipeSchema = "xfs/recipe-7" | "xfs/recipe-8" | "xfs/recipe-9" | "xfs/recipe-10" | "xfs/recipe-11";
/** The oldest schema a writer uses: what new recipes have always been written as. */
export const OLDEST_WRITTEN_SCHEMA: RecipeSchema = "xfs/recipe-7";
export const schemaRank = (schema: RecipeFileSchema) => RECIPE_FILE_SCHEMAS.indexOf(schema);
/** Every recipe file schema the readers take; a bare file of one of these is an eye-makeup recipe. */
export const RECIPE_SCHEMAS: readonly string[] = RECIPE_FILE_SCHEMAS;

/**
 * A recipe file (`xfs/recipe-N`), and the body of `xfs/eye-makeup-part-1`: a recipe with the schema that gates its
 * layer models. Writers use the oldest schema that holds it (`recipeFile`).
 */
export type RecipeFile = { schema: RecipeSchema } & Recipe;

export const RECIPE_FILE_MESSAGE = `Expected an XF Studio recipe with up to ${MAX_LAYERS} layers, or a legacy four-layer recipe.`;

/** An eye-makeup layer model with the oldest recipe file schema that holds it (absent when only part-2 holds it). */
export type RecipeLayerModel = LayerModel & { readonly recipeSchema?: RecipeFileSchema };

/**
 * Eye makeup's layer models and their file lineage: classic flakes since recipe-1, irregular Glitter 7, Direct 8,
 * Clustered 9, Fine 10, game-matched optics 11. A new model registers with no `recipeSchema`; recipes using it are
 * then written as part-2 only.
 */
export const EYE_MAKEUP_LAYER_MODELS: readonly RecipeLayerModel[] = Object.freeze([
  { ...CLASSIC_FLAKES, recipeSchema: "eye-artistry/recipe-1" },
  { ...IRREGULAR_GLITTER, recipeSchema: "xfs/recipe-7" },
  { ...DIRECT_GLINT_1, recipeSchema: "xfs/recipe-8" },
  { ...DIRECT_GLINT_2, recipeSchema: "xfs/recipe-9" },
  { ...DIRECT_GLINT_3, recipeSchema: "xfs/recipe-10" },
  { ...GAME_MATCHED_OPTICS, recipeSchema: "xfs/recipe-11" },
] satisfies RecipeLayerModel[]);

type OpticalLayer = { flakes?: unknown; optics?: unknown };
/** Eye makeup's layer-model registry, with the recipe schema each layer needs. */
export class RecipeModelRegistry extends LayerModelRegistry {
  constructor(models: readonly RecipeLayerModel[]) { super(models); }
  /** Whether a recipe file of `schema` holds `model`. */
  static holds(model: LayerModel, schema: RecipeFileSchema) {
    const needed = (model as RecipeLayerModel).recipeSchema;
    return needed !== undefined && schemaRank(needed) <= schemaRank(schema);
  }
  /** The recipe file schema a layer's models need (recipe-7 at least), or undefined when no recipe schema holds one. */
  layerSchema(layer: OpticalLayer): RecipeSchema | undefined {
    let rank = schemaRank(OLDEST_WRITTEN_SCHEMA);
    for (const [slot, value] of [["flakes", layer.flakes], ["optics", layer.optics]] as const) {
      if (value === undefined) continue;
      const needed = (this.of(slot, value) as RecipeLayerModel | undefined)?.recipeSchema;
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
/** The layer models this build registers for eye makeup (its region's `models`). */
export const LAYER_MODELS = new RecipeModelRegistry(EYE_MAKEUP_LAYER_MODELS);

/**
 * Read a recipe file of any schema, migrating on read: each schema's structural forms (warp fields since recipe-3,
 * strength modes 4, Bézier paths 5, per-point softness 6) and the layer models it holds. Recipe 8–11 keep their
 * schema; older files hold nothing recipe-7 does not.
 */
function readFile(value: Record<string, unknown>, models: LayerModelRegistry): RecipeFile {
  const r = value as { schema: RecipeFileSchema; uv: unknown; layers: unknown };
  if (!RECIPE_FILE_SCHEMAS.includes(r.schema) || r.uv !== "gltf-uv0-top-left" || !Array.isArray(r.layers) ||
    r.layers.length > MAX_LAYERS || (r.schema === "eye-artistry/recipe-1" && r.layers.length !== 4))
    throw Error(RECIPE_FILE_MESSAGE);
  const rank = schemaRank(r.schema), since = (schema: RecipeFileSchema) => rank >= schemaRank(schema);
  const layers = readLayers(r.layers, models,
    { fields: since("xfs/recipe-3"), strength: since("xfs/recipe-4"), path: since("xfs/recipe-5"), softness: since("xfs/recipe-6") },
    model => RecipeModelRegistry.holds(model, r.schema));
  const schema: RecipeSchema = rank >= schemaRank("xfs/recipe-8") ? r.schema as RecipeSchema : OLDEST_WRITTEN_SCHEMA;
  return structuredClone({ ...r, schema, layers }) as RecipeFile;
}
const isFile = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && "schema" in value;
/** The in-memory form of a parsed recipe file: the same copy without its `schema`. */
function withoutSchema(recipe: RecipeFile): Recipe {
  const { schema: _schema, ...rest } = recipe;
  return rest;
}

/**
 * Read a recipe: a recipe file of any schema (`eye-artistry/recipe-1`, `xfs/recipe-2`…`11`), which migrates on
 * read exactly as it always has, or an in-memory recipe (an `xfs/eye-makeup-part-2` body, which has no `schema`).
 * Returns the in-memory recipe (a copy).
 */
export function readRecipe(value: unknown, models: LayerModelRegistry = LAYER_MODELS): Recipe {
  return isFile(value) ? withoutSchema(readFile(value, models)) : parseInMemory(value, models, RECIPE_FILE_MESSAGE);
}
/**
 * Read a recipe file only, keeping its schema as the in-memory recipe used to (older schemas become
 * `xfs/recipe-7`; 8–11 stay). The collection-1 readers use it, so their output is unchanged.
 */
export function parseRecipeFile(value: unknown, models: LayerModelRegistry = LAYER_MODELS): RecipeFile {
  if (!isFile(value)) throw Error(RECIPE_FILE_MESSAGE);
  return readFile(value, models);
}
/** Read an `xfs/eye-makeup-part-2` body only: an in-memory recipe, with no `schema`. */
export function parseRecipePart(value: unknown, models: LayerModelRegistry = LAYER_MODELS): Recipe {
  return parseInMemory(value, models, RECIPE_FILE_MESSAGE);
}

/**
 * Read one eye-makeup part (`{ schema, body }`) into the in-memory recipe: part-2 bodies as they
 * are, part-1 bodies as recipe files (their schema gates their layer models). A later part schema
 * is a newer build's (`NewerDataError`). The part codec and the package pipeline both read with it.
 */
export function parseEyeMakeupPart(envelope: { schema: string; body: unknown }, models: LayerModelRegistry = LAYER_MODELS): Recipe {
  if (envelope.schema === EYE_MAKEUP_PART_2) return parseRecipePart(envelope.body, models);
  // A part-1 body is a recipe file: its schema gates its layer models, then goes. Like every recipe
  // reader, it also takes a recipe without a schema (an in-memory one) as part-2.
  if (envelope.schema === EYE_MAKEUP_PART_1) return readRecipe(envelope.body, models);
  if (EYE_MAKEUP_PART.test(envelope.schema))
    throw new NewerDataError(`This look's eye makeup was saved by a newer version of XF Studio (${envelope.schema}).`);
  throw Error(`Unsupported eye-makeup part schema ${envelope.schema}.`);
}

/** The recipe file of a recipe in the oldest schema that holds it, or undefined when no recipe schema does. */
export function recipeFile(recipe: Recipe, models: RecipeModelRegistry = LAYER_MODELS): RecipeFile | undefined {
  const schema = models.minimalSchema(recipe.layers);
  return schema && { schema, ...recipe };
}

/**
 * Read a recipe as a recipe file: a file keeps its (migrated) schema exactly as it always has; a
 * recipe without one (an in-memory recipe placed in a collection-1 file) gets the oldest schema
 * that holds it. Throws when the recipe is invalid or no recipe schema holds it.
 */
export function readRecipeFile(value: unknown, models: RecipeModelRegistry = LAYER_MODELS): RecipeFile {
  if (isFile(value)) return readFile(value, models);
  const file = recipeFile(parseRecipePart(value, models), models);
  if (!file) throw Error("This recipe uses a layer model no recipe file holds; export its collection instead.");
  return file;
}

/** A recipe with a layer model newer than every recipe schema, as "Export recipe" writes it: its part. */
export type RecipePartFile = { schema: typeof EYE_MAKEUP_PART_2; body: Recipe };
/**
 * What "Export recipe" writes: the minimal `xfs/recipe-N` file whenever one holds the recipe;
 * otherwise (only for a layer model this build registers without a recipe schema) the part itself.
 */
export function portableRecipe(recipe: Recipe, models: RecipeModelRegistry = LAYER_MODELS): RecipeFile | RecipePartFile {
  return recipeFile(recipe, models) ?? { schema: EYE_MAKEUP_PART_2, body: recipe };
}

/**
 * Read a portable recipe: a recipe file of any schema, or a part file `portableRecipe` wrote.
 * Undefined for anything else (for example a collection); throws when a recipe is invalid.
 */
export function readPortableRecipe(file: unknown, models: LayerModelRegistry = LAYER_MODELS): Recipe | undefined {
  const value = file as { schema?: unknown; body?: unknown } | null;
  const schema = value && typeof value === "object" ? value.schema : undefined;
  if (typeof schema === "string" && RECIPE_SCHEMAS.includes(schema)) return readRecipe(file, models);
  if (schema === EYE_MAKEUP_PART_2 && Object.keys(value!).sort().join() === "body,schema") return parseRecipePart(value!.body, models);
  return undefined;
}
