/**
 * Portable recipe formats. The in-memory recipe (`xfs/eye-makeup-part-2`) has no schema of its
 * own; a recipe file, or an `xfs/eye-makeup-part-1` body, is written in the oldest `xfs/recipe-N`
 * that holds every layer's models (`layer-models.ts`), so older builds, 0.1.0-alpha.1 included,
 * keep reading what this build writes whenever the content allows. No edit ever changes a
 * schema: it is derived when a recipe is written.
 */
import { LAYER_MODELS, type LayerModelRegistry } from "./layer-models";
import { parseRecipe, parseRecipeFile, parseRecipePart, type Recipe, type RecipeFile } from "./recipe";

/** Eye makeup's part schema with the per-layer model registry (feature-module platform §2). */
export const EYE_MAKEUP_PART_2 = "xfs/eye-makeup-part-2";
/** Every recipe file schema `parseRecipe` reads; a bare file of one of these is an eye-makeup recipe. */
export const RECIPE_SCHEMAS: readonly string[] = ["eye-artistry/recipe-1", "xfs/recipe-2", "xfs/recipe-3", "xfs/recipe-4",
  "xfs/recipe-5", "xfs/recipe-6", "xfs/recipe-7", "xfs/recipe-8", "xfs/recipe-9", "xfs/recipe-10", "xfs/recipe-11"];

/** The recipe file of a recipe in the oldest schema that holds it, or undefined when no recipe schema does. */
export function recipeFile(recipe: Recipe, models: LayerModelRegistry = LAYER_MODELS): RecipeFile | undefined {
  const schema = models.minimalSchema(recipe.layers);
  return schema && { schema, ...recipe };
}

/**
 * Read a recipe as a recipe file: a file keeps its (migrated) schema exactly as it always has; a
 * recipe without one (an in-memory recipe placed in a collection-1 file) gets the oldest schema
 * that holds it. Throws when the recipe is invalid or no recipe schema holds it.
 */
export function readRecipeFile(value: unknown, models: LayerModelRegistry = LAYER_MODELS): RecipeFile {
  if (value && typeof value === "object" && "schema" in value) return parseRecipeFile(value, models);
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
export function portableRecipe(recipe: Recipe, models: LayerModelRegistry = LAYER_MODELS): RecipeFile | RecipePartFile {
  return recipeFile(recipe, models) ?? { schema: EYE_MAKEUP_PART_2, body: recipe };
}

/**
 * Read a portable recipe: a recipe file of any schema, or a part file `portableRecipe` wrote.
 * Undefined for anything else (for example a collection); throws when a recipe is invalid.
 */
export function readPortableRecipe(file: unknown, models: LayerModelRegistry = LAYER_MODELS): Recipe | undefined {
  const value = file as { schema?: unknown; body?: unknown } | null;
  const schema = value && typeof value === "object" ? value.schema : undefined;
  if (typeof schema === "string" && RECIPE_SCHEMAS.includes(schema)) return parseRecipe(file, models);
  if (schema === EYE_MAKEUP_PART_2 && Object.keys(value!).sort().join() === "body,schema") return parseRecipePart(value!.body, models);
  return undefined;
}
