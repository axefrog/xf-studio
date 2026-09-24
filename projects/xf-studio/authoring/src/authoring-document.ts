import { RecipeHistory } from "./editor-actions";
import { parseFieldSelection, type FieldSelection } from "./field-selection";
import { parseRecipe, type Recipe } from "./recipe";
import type { RecipeActionEffect, RecipeActionState } from "./recipe-actions";
import type { ReadonlyDeep } from "./read-only";
import type { HistoryLabel } from "./history-labels";

export type DocumentState = { recipe: Recipe; active: number; selected: number;
  fieldSelection: FieldSelection; history: Recipe[] };
export type DocumentChange = "recipe" | "selection" | "history" | "restore";
export type DocumentEffect = RecipeActionEffect | { kind: "gesture"; layerIndex: number };

/** The live in-process authoring document; snapshots never expose its mutable recipe. */
export class AuthoringDocument {
  private state: Omit<DocumentState, "history">;
  private history: RecipeHistory;
  private listeners = new Set<(change: DocumentChange) => void>();
  private effectListeners = new Set<(effect: DocumentEffect) => void>();
  private geometryRevision = 0;
  private changedLayerIndex: number | undefined;
  private changedGestureKind: string | undefined;
  constructor(initial: DocumentState) {
    const recipe = parseRecipe(initial.recipe);
    this.state = { recipe, active: clamp(initial.active, recipe.layers.length),
      selected: clamp(initial.selected, recipe.layers[clamp(initial.active, recipe.layers.length)]?.points.length ?? 0),
      fieldSelection: parseFieldSelection(initial.fieldSelection, recipe) };
    this.history = new RecipeHistory(initial.history);
  }
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
  checkpoint(_recipe?: Recipe, label?: HistoryLabel) {
    this.history.checkpoint(this.state.recipe, label ?? this.pendingLabel); this.notify("history");
  }
  /** Name an open transaction's entry once its first edit shows what it does. */
  relabelCheckpoint(depth: number, label: HistoryLabel) {
    if (this.history.depth === depth) this.history.relabelTop(label);
  }
  historyLabel() { return this.history.topLabel(); }
  undoRecipe() { const recipe = this.history.undo(); if (recipe) this.notify("history"); return recipe; }
  get canUndo() { return this.history.canUndo; }
  get undoDepth() { return this.history.depth; }
  historySnapshot() { return this.history.snapshot(); }
  restoreHistory(entries: Recipe[]) { this.history.restore(entries); this.notify("history"); }
  snapshot(): ReadonlyDeep<DocumentState> {
    return structuredClone({ ...this.state, history: this.history.snapshot() });
  }
  export(): DocumentState { return structuredClone({ ...this.state, history: this.history.snapshot() }); }
  /** For collection switches and workspace restore, publish the whole validated editor state at once. */
  restore(value: DocumentState) {
    const recipe = parseRecipe(value.recipe), active = clamp(value.active, recipe.layers.length);
    const fieldSelection = parseFieldSelection(value.fieldSelection, recipe);
    const history = new RecipeHistory(value.history);
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
