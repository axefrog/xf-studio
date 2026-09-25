import { RECIPE_HISTORY, recipeHistory, type HistoryEntryId, type HistoryEntryInfo } from "./editor-actions";
import { parseFieldSelection, type FieldSelection } from "./field-selection";
import { parseRecipe, type Recipe } from "./recipe";
import type { RecipeActionEffect, RecipeActionState } from "./recipe-actions";
import type { ReadonlyDeep } from "./read-only";
import type { HistoryLabel } from "./history-labels";
import { LOOK_HISTORY_1, type HistoryParts, type LookHistoryData } from "./platform/api";
import { LookHistory } from "./platform/core/look-history";

/**
 * The look's Undo history as the document is given it: its data (`LookHistoryData`, what this
 * build keeps in memory), or eye makeup's whole recipes oldest first (how workspaces before the look
 * history held it, and how tests still build one).
 */
export type DocumentHistory = LookHistoryData | Recipe[];
export type DocumentState = { recipe: Recipe; active: number; selected: number;
  fieldSelection: FieldSelection; history: DocumentHistory;
  /** Present (true) only when older Undo entries than the oldest kept one were dropped. */
  historyTrimmed?: boolean };
export type DocumentChange = "recipe" | "selection" | "history" | "restore";
export type DocumentEffect = RecipeActionEffect | { kind: "gesture"; layerIndex: number };
/** Which feature's part the document edits and how the look history splits parts (the composition's part registry). */
export type DocumentParts = { readonly feature: string; readonly parts: HistoryParts };

/** A look history from either form; throws on a damaged entry (checked before anything is published). */
function lookHistory(value: DocumentHistory | undefined, trimmed: boolean, parts: DocumentParts): LookHistory {
  if (Array.isArray(value) || value === undefined) return recipeHistory(value ?? [], trimmed, parts);
  if (!value || value.schema !== LOOK_HISTORY_1) throw Error("This look's Undo history is damaged.");
  const history = LookHistory.fromData(parts.parts, trimmed && !value.trimmed ? { ...value, trimmed: true } : value);
  // The document edits one feature's part; a step of another feature's is not one it can undo.
  if (history.features().some(feature => feature !== parts.feature))
    throw Error("This look's Undo history changes parts this editor cannot show.");
  return history;
}

/** The live in-process authoring document; snapshots never expose its mutable recipe. */
export class AuthoringDocument {
  private state: Omit<DocumentState, "history" | "historyTrimmed">;
  private history: LookHistory;
  private listeners = new Set<(change: DocumentChange) => void>();
  private effectListeners = new Set<(effect: DocumentEffect) => void>();
  private geometryRevision = 0;
  private changedLayerIndex: number | undefined;
  private changedGestureKind: string | undefined;
  /** `parts` names the feature this document edits and how its look history chunks parts (default: eye makeup's recipe). */
  constructor(initial: DocumentState, private readonly parts: DocumentParts = RECIPE_HISTORY) {
    const recipe = parseRecipe(initial.recipe);
    this.state = { recipe, active: clamp(initial.active, recipe.layers.length),
      selected: clamp(initial.selected, recipe.layers[clamp(initial.active, recipe.layers.length)]?.points.length ?? 0),
      fieldSelection: parseFieldSelection(initial.fieldSelection, recipe) };
    this.history = lookHistory(initial.history, initial.historyTrimmed === true, parts);
  }
  /** The look as the history reads it: this document's feature is its recipe. */
  private readonly read = (feature: string) => feature === this.parts.feature ? this.state.recipe : undefined;
  private recipeOf(parts: Record<string, unknown> | undefined) { return parts?.[this.parts.feature] as Recipe | undefined; }
  subscribe(listener: (change: DocumentChange) => void) {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  subscribeEffects(listener: (effect: DocumentEffect) => void) {
    this.effectListeners.add(listener); return () => this.effectListeners.delete(listener);
  }
  private notify(change: DocumentChange) { for (const listener of this.listeners) listener(change); }
  private effect(value: DocumentEffect) { for (const listener of this.effectListeners) listener(value); }
  get recipe() { return this.state.recipe; }
  /** Lets detached geometry readers refresh on edits without cloning on render frames. */
  get geometryVersion() { return { revision: this.geometryRevision, layerIndex: this.changedLayerIndex,
    gestureKind: this.changedGestureKind }; }
  set recipe(value: Recipe) { this.state.recipe = value; this.geometryRevision++; this.changedLayerIndex = undefined;
    this.changedGestureKind = undefined; this.notify("recipe"); }
  /** Atomically replace a stack or Undo result, keeping a surviving point selected. */
  replaceRecipe(value: Recipe, nextActive = 0) {
    const recipe = parseRecipe(value), active = clamp(nextActive, recipe.layers.length);
    const sameLayer = this.state.recipe.layers[this.state.active]?.id === recipe.layers[active]?.id;
    this.state = { ...this.state, recipe, active,
      selected: sameLayer ? clamp(this.state.selected, recipe.layers[active]?.points.length ?? 0) : 0,
      fieldSelection: parseFieldSelection(this.state.fieldSelection, recipe) };
    this.geometryRevision++; this.changedLayerIndex = undefined; this.changedGestureKind = undefined;
    this.notify("recipe");
  }
  get active() { return this.state.active; }
  set active(value: number) { this.state.active = value; this.notify("selection"); }
  get selected() { return this.state.selected; }
  set selected(value: number) { this.state.selected = value; this.notify("selection"); }
  get fieldSelection() { return this.state.fieldSelection; }
  set fieldSelection(value: FieldSelection) { this.state.fieldSelection = value; this.notify("selection"); }
  /** Gesture proposals preserve the live layer identity; publish after their validated in-place write. */
  gestureChanged(layerIndex?: number, kind?: string) {
    this.geometryRevision++; this.changedLayerIndex = layerIndex;
    this.changedGestureKind = kind;
    this.notify("recipe"); if (layerIndex !== undefined) this.effect({ kind: "gesture", layerIndex });
  }
  /** Publish one validated action result and its rendering intent together. */
  applyActionState(next: RecipeActionState, effect: RecipeActionEffect) {
    this.state = next;
    if (effect.kind !== "selection") { this.geometryRevision++; this.changedLayerIndex = undefined;
      this.changedGestureKind = undefined; }
    this.notify(effect.kind === "selection" ? "selection" : "recipe");
    this.effect(effect);
  }
  publishLayer(recipe: Recipe, layerIndex: number) {
    this.state.recipe = recipe;
    this.geometryRevision++; this.changedLayerIndex = layerIndex; this.changedGestureKind = undefined;
    this.notify("recipe");
    this.effect({ kind: "immediate", layerIndex });
  }
  private pendingLabel?: HistoryLabel;
  /** Run `change` so any checkpoint it creates is labelled (session-only; persisted history has no labels). */
  withHistoryLabel<T>(label: HistoryLabel, change: () => T): T {
    const prior = this.pendingLabel; this.pendingLabel = label;
    try { return change(); } finally { this.pendingLabel = prior; }
  }
  /** Record the current recipe; returns the added entry, or undefined when it duplicated the top entry. */
  checkpoint(_recipe?: Recipe, label?: HistoryLabel): HistoryEntryId | undefined {
    const added = this.history.checkpoint(this.read, [this.parts.feature], { label: label ?? this.pendingLabel });
    this.notify("history");
    return added;
  }
  /** Name an open transaction's entry once its first edit shows what it does. */
  relabelCheckpoint(entry: HistoryEntryId, label: HistoryLabel) { this.history.relabel(entry, label); }
  /** True while `entry` is the one the next Undo restores. */
  isLatestCheckpoint(entry: HistoryEntryId) { return this.history.isTop(entry); }
  /** Drop an empty transaction's own checkpoint; never removes an older entry. */
  discardCheckpoint(entry: HistoryEntryId) {
    const removed = this.history.discard(entry); if (removed) this.notify("history"); return removed;
  }
  historyLabel() { return this.history.topLabel(); }
  /** Take the latest checkpoint off without Redo (a cancelled transaction); returns the recipe it restores. */
  undoRecipe() {
    if (!this.history.canUndo) return undefined;
    const recipe = this.recipeOf(this.history.revert());
    this.notify("history");
    return recipe;
  }
  /**
   * Undo `count` steps as one change (each onto the session's Redo list); returns the recipe to
   * show, which the caller publishes once. Undefined when fewer steps are kept.
   */
  undoSteps(count: number): Recipe | undefined {
    const result = this.history.undo(this.read, count);
    if (!result) return undefined;
    for (let i = 0; i < count; i++) this.notify("history");
    return this.recipeOf(result.parts);
  }
  /** Redo `count` steps as one change, keeping each step's identity; returns the recipe to show. */
  redoSteps(count: number): Recipe | undefined {
    const result = this.history.redo(this.read, count);
    if (!result) return undefined;
    for (let i = 0; i < result.pushed; i++) this.notify("history");
    return this.recipeOf(result.parts);
  }
  /** Redo-able steps in Redo order (the next one first). Validity is the caller's decision. */
  redoList() { return this.history.redoSteps(); }
  get redoDepth() { return this.history.redoDepth; }
  clearRedo() { this.history.clearRedo(); }
  /** Kept Undo entries oldest first, without recipes. */
  historyEntries(): HistoryEntryInfo[] { return this.history.list(); }
  /** Identity of the entry the next Undo would restore (cheap; for Redo validity). */
  get historyTop() { return this.history.topId; }
  /** True when older Undo entries were dropped (at the limit or before a restore). */
  get historyTrimmed() { return this.history.trimmed; }
  get canUndo() { return this.history.canUndo; }
  get undoDepth() { return this.history.depth; }
  /** The kept entries as whole recipes, oldest first. */
  historySnapshot(): Recipe[] { return this.history.bodies(this.parts.feature) as Recipe[]; }
  /** Distinct history chunks and their size (UTF-16 code units), for budgets and benchmarks. */
  historyStats() { return this.history.stats(); }
  restoreHistory(entries: DocumentHistory, trimmed = false) {
    this.history = lookHistory(entries, trimmed, this.parts); this.notify("history");
  }
  snapshot(): ReadonlyDeep<DocumentState> { return this.export(); }
  /** The editor state with its look history as data (steps and chunks, never whole recipes per step). */
  export(): DocumentState {
    return { ...structuredClone(this.state), history: this.history.data(),
      ...(this.history.trimmed ? { historyTrimmed: true } : {}) };
  }
  /** For collection switches and workspace restore, publish the whole validated editor state at once. */
  restore(value: DocumentState) {
    const recipe = parseRecipe(value.recipe), active = clamp(value.active, recipe.layers.length);
    const fieldSelection = parseFieldSelection(value.fieldSelection, recipe);
    const history = lookHistory(value.history, value.historyTrimmed === true, this.parts);
    this.state = { recipe, active, selected: clamp(value.selected, recipe.layers[active]?.points.length ?? 0),
      fieldSelection };
    this.history = history;
    this.geometryRevision++; this.changedLayerIndex = undefined; this.changedGestureKind = undefined;
    this.notify("restore");
  }
}

function clamp(value: number, length: number) {
  return length <= 0 ? 0 : Math.max(0, Math.min(Number.isInteger(value) ? value : 0, length - 1));
}
