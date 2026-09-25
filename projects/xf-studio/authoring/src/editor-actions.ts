import { editLayers, type LayerCommand } from "./layer-stack";
import { joinRecipe, MAX_LAYERS, parseRecipe, recipeChunks, type Recipe } from "./recipe";
import type { CodedCapability } from "./collection-actions";
import { nameIssue, positionIssue, refuse } from "./validation-issues";
import { HISTORY_LIMIT, refusal, type HistoryEntryId as PlatformHistoryEntryId, type HistoryParts } from "./platform/api";
import { LookHistory, type HistoryStepInfo } from "./platform/core/look-history";
import { EYE_MAKEUP_FEATURE } from "./recipe-schema";
import type { HistoryLabel } from "./history-labels";

export type LayerAction =
  | { kind: "layer.edit"; command: LayerCommand }
  | { kind: "layer.setEnabled"; id: string; enabled: boolean };

export function layerCapability(recipe: Recipe, action: LayerAction): CodedCapability {
  const command = action.kind === "layer.edit" ? action.command : action;
  if ("id" in command && !recipe.layers.some(layer => layer.id === command.id))
    return refusal("missing_target", "That layer no longer exists.");
  if (action.kind === "layer.edit") {
    if ((command.kind === "add" || command.kind === "duplicate") && recipe.layers.length >= MAX_LAYERS)
      return refuse({ code: "range", message: `This preview currently supports up to ${MAX_LAYERS} layers.` });
    if ((command.kind === "add" || command.kind === "duplicate") && command.newId !== undefined &&
        (typeof command.newId !== "string" || !command.newId || recipe.layers.some(layer => layer.id === command.newId)))
      return refusal("invalid_value", "The new layer needs an unused ID.");
    // Layers are stored bottom-to-top: index 0 is the back, the last index the front.
    const issue = command.kind === "move" ? positionIssue(command.to, recipe.layers.length,
      { below: "This layer is already at the back.", above: "This layer is already at the front." }) :
      command.kind === "rename" ? nameIssue(command.name, 80) : undefined;
    if (issue) return refuse(issue);
  }
  return { available: true };
}

export function applyLayerAction(recipe: Recipe, activeId: string | undefined, action: LayerAction) {
  const capability = layerCapability(recipe, action);
  if (!capability.available) throw Error(capability.reason);
  if (action.kind === "layer.edit") return { ...editLayers(recipe, activeId, action.command), structure: true as const };
  const next = parseRecipe({ ...recipe, layers: recipe.layers.map(layer => layer.id === action.id
    ? { ...layer, enabled: action.enabled } : layer) });
  return { recipe: next, active: Math.max(0, next.layers.findIndex(layer => layer.id === activeId)), structure: false as const,
    changed: next.layers.findIndex(layer => layer.id === action.id) };
}

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
  const kept = entries.slice(-RECIPE_HISTORY_LIMIT).map(recipe => parseRecipe(recipe));
  return LookHistory.fromBodies(history.parts, history.feature, kept, trimmed || entries.length > RECIPE_HISTORY_LIMIT);
}
