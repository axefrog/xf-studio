import type { Layer, Recipe } from "./recipe";

/** Current recipe schemas, oldest first. Each accepts every layer form of the ones before it. */
const SCHEMA_ORDER: readonly Recipe["schema"][] =
  ["xfs/recipe-6", "xfs/recipe-7", "xfs/recipe-8", "xfs/recipe-9", "xfs/recipe-10", "xfs/recipe-11"];

/** Oldest schema that accepts this layer's stored optical form (Glitter model and game-matched optics). */
export function layerSchema(layer: Pick<Layer, "flakes" | "optics">): Recipe["schema"] {
  if (layer.optics) return "xfs/recipe-11";
  const model = layer.flakes && "model" in layer.flakes ? layer.flakes.model : undefined;
  return model === "uv-cell-direct-3" ? "xfs/recipe-10" : model === "uv-cell-direct-2" ? "xfs/recipe-9" :
    model === "uv-cell-direct-1" ? "xfs/recipe-8" : model === "irregular-planar-1" ? "xfs/recipe-7" : "xfs/recipe-6";
}

/**
 * The schema a recipe needs for all of its layers, computed in one place for every edit that
 * changes a layer's optical form. It never goes below `recipe.schema`: a recipe's optical model
 * stays pinned, so changing or removing the layer that needed a newer schema never moves the
 * recipe back, and one layer's choice can never invalidate another layer.
 */
export function requiredRecipeSchema(recipe: Pick<Recipe, "schema" | "layers">): Recipe["schema"] {
  let rank = Math.max(0, SCHEMA_ORDER.indexOf(recipe.schema));
  for (const layer of recipe.layers) rank = Math.max(rank, SCHEMA_ORDER.indexOf(layerSchema(layer)));
  return SCHEMA_ORDER[rank];
}
