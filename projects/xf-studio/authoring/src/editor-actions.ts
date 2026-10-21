/**
 * Eye makeup's part in the look history: its recipe chunks, and a look history of whole recipes (how workspaces before the
 * look history stored it). The pure layer-stack actions are the engine's (`engines/layered-makeup/layer-stack.ts`).
 */
import { joinRecipe, recipeChunks, type Recipe } from "./engines/layered-makeup/recipe";
import { HISTORY_LIMIT, type HistoryEntryId as PlatformHistoryEntryId, type HistoryParts } from "./platform/api";
import { LookHistory } from "./platform/core/look-history";
import { EYE_MAKEUP_FEATURE, readRecipe } from "./recipe-schema";

/** Opaque identity of one Undo entry (a look-history step), returned when a checkpoint actually adds it. */
export type HistoryEntryId = PlatformHistoryEntryId;
/** Undo entries kept per look (the oldest is dropped beyond this). */
export const RECIPE_HISTORY_LIMIT = HISTORY_LIMIT;

/**
 * How the live eye-makeup document's look history reads its part: the recipe's header and one
 * chunk per layer (feature-module platform §3). Hosts built from the composition pass the part
 * registry instead, which answers the same for eye makeup and for every other registered feature.
 */
export const RECIPE_HISTORY: { readonly feature: string; readonly parts: HistoryParts } = Object.freeze({
  feature: EYE_MAKEUP_FEATURE,
  parts: Object.freeze({ chunks: (_feature: string, body: unknown) => recipeChunks(body as Recipe),
    join: (_feature: string, chunks: readonly unknown[]) => joinRecipe(chunks) }),
});

/** A look history of whole recipes (validated first, as every restore always did). */
export function recipeHistory(entries: readonly unknown[], trimmed = false,
  history: { readonly feature: string; readonly parts: HistoryParts } = RECIPE_HISTORY): LookHistory {
  const kept = entries.slice(-RECIPE_HISTORY_LIMIT).map(recipe => readRecipe(recipe));
  return LookHistory.fromBodies(history.parts, history.feature, kept, trimmed || entries.length > RECIPE_HISTORY_LIMIT);
}
