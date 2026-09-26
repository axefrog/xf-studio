/**
 * The eye-makeup document's history owner: one recipe's Undo history on its own and the look history's
 * recipe chunks. The pure layer-stack actions are the engine's (`engines/layered-makeup/layer-stack.ts`).
 */
import { joinRecipe, recipeChunks, type Recipe } from "./engines/layered-makeup/recipe";
import { HISTORY_LIMIT, type HistoryEntryId as PlatformHistoryEntryId, type HistoryParts } from "./platform/api";
import { LookHistory, type HistoryStepInfo } from "./platform/core/look-history";
import { EYE_MAKEUP_FEATURE, readRecipe } from "./recipe-schema";
import type { HistoryLabel } from "./history-labels";

/** Opaque identity of one Undo entry (a look-history step), returned when a checkpoint actually adds it. */
export type HistoryEntryId = PlatformHistoryEntryId;
/** What one kept Undo entry is, without its recipe (for history lists). */
export type HistoryEntryInfo = HistoryStepInfo;
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

/**
 * One recipe's Undo history on its own: a look history over eye makeup's part alone, without DOM or
 * storage dependencies, that never returns a mutable stored entry. Each entry may carry a
 * session-only label and time; restored entries have none. Transactions track the entry their
 * checkpoint added by identity, never by depth: at `RECIPE_HISTORY_LIMIT` a new entry drops the
 * oldest, so the depth does not grow. `trimmed` records that older entries were dropped (at the
 * limit, or before a restore). The live document uses `LookHistory` directly.
 */
export class RecipeHistory {
  private history: LookHistory;
  constructor(initial: Recipe[] = [], trimmed = false) { this.history = recipeHistory(initial, trimmed); }
  get canUndo() { return this.history.canUndo; }
  get depth() { return this.history.depth; }
  /** True when older entries than the oldest kept one were dropped. */
  get trimmed() { return this.history.trimmed; }
  /** Returns the new entry's identity, or undefined when an identical top entry made it a no-op. */
  checkpoint(recipe: Recipe, label?: HistoryLabel): HistoryEntryId | undefined {
    return this.history.checkpoint(() => recipe, [RECIPE_HISTORY.feature], { label });
  }
  /** True while `id` is the entry the next Undo would restore. */
  isTop(id: HistoryEntryId) { return this.history.isTop(id); }
  /** Identity of the entry the next Undo would restore. */
  get topId(): HistoryEntryId | undefined { return this.history.topId; }
  /** Pop the top entry. At the limit, the oldest entry its checkpoint displaced comes back. */
  undo(): Recipe | undefined { return this.history.revert()?.[RECIPE_HISTORY.feature] as Recipe | undefined; }
  /** Kept entries oldest first, without recipes. Unlabelled (restored) entries have no label. */
  list(): HistoryEntryInfo[] { return this.history.list(); }
  /** Label of the entry the next Undo would restore. */
  topLabel(): HistoryLabel | undefined { return this.history.topLabel(); }
  /** Name one entry; a no-op once that entry was undone or dropped. */
  relabel(id: HistoryEntryId, label: HistoryLabel) { this.history.relabel(id, label); }
  /**
   * Remove `id` only while it is still the top entry (an empty transaction's checkpoint),
   * so an empty transaction leaves the history exactly as it found it, even at the limit.
   */
  discard(id: HistoryEntryId) { return this.history.discard(id); }
  snapshot(): Recipe[] { return this.history.bodies(RECIPE_HISTORY.feature) as Recipe[]; }
  restore(entries: Recipe[], trimmed = false) { this.history = recipeHistory(entries, trimmed); }
}
/** A look history of whole recipes (validated first, as every restore always did). */
export function recipeHistory(entries: readonly unknown[], trimmed = false,
  history: { readonly feature: string; readonly parts: HistoryParts } = RECIPE_HISTORY): LookHistory {
  const kept = entries.slice(-RECIPE_HISTORY_LIMIT).map(recipe => readRecipe(recipe));
  return LookHistory.fromBodies(history.parts, history.feature, kept, trimmed || entries.length > RECIPE_HISTORY_LIMIT);
}
