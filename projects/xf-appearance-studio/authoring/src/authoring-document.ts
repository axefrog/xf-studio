import { RecipeHistory } from "./editor-actions";
import { parseFieldSelection, type FieldSelection } from "./field-selection";
import { parseRecipe, type Recipe } from "./recipe";
import type { RecipeActionEffect, RecipeActionState } from "./recipe-actions";

export type DocumentState = { recipe: Recipe; active: number; selected: number;
  fieldSelection: FieldSelection; history: Recipe[] };
export type DocumentChange = "recipe" | "selection" | "history" | "restore";
export type DocumentEffect = RecipeActionEffect | { kind: "gesture"; layerIndex: number };
type ReadonlyDeep<T> = T extends (infer U)[] ? readonly ReadonlyDeep<U>[] :
  T extends object ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> } : T;

/** The live in-process authoring document; snapshots never expose its mutable recipe. */
export class AuthoringDocument {
  private state: Omit<DocumentState, "history">;
  private history: RecipeHistory;
  private listeners = new Set<(change: DocumentChange) => void>();
  private effectListeners = new Set<(effect: DocumentEffect) => void>();
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
  set recipe(value: Recipe) { this.state.recipe = value; this.notify("recipe"); }
  get active() { return this.state.active; }
  set active(value: number) { this.state.active = value; this.notify("selection"); }
  get selected() { return this.state.selected; }
  set selected(value: number) { this.state.selected = value; this.notify("selection"); }
  get fieldSelection() { return this.state.fieldSelection; }
  set fieldSelection(value: FieldSelection) { this.state.fieldSelection = value; this.notify("selection"); }
  /** Gesture proposals preserve the live layer identity; publish after their validated in-place write. */
  gestureChanged(layerIndex?: number) { this.notify("recipe"); if (layerIndex !== undefined) this.effect({ kind: "gesture", layerIndex }); }
  /** Publish one validated action result and its rendering intent together. */
  applyActionState(next: RecipeActionState, effect: RecipeActionEffect) {
    this.state = next;
    this.notify(effect.kind === "selection" ? "selection" : "recipe");
    this.effect(effect);
  }
  publishLayer(recipe: Recipe, layerIndex: number) {
    this.state.recipe = recipe;
    this.notify("recipe");
    this.effect({ kind: "immediate", layerIndex });
  }
  checkpoint(_recipe?: Recipe) { this.history.checkpoint(this.state.recipe); this.notify("history"); }
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
    this.notify("restore");
  }
}

function clamp(value: number, length: number) {
  return length <= 0 ? 0 : Math.max(0, Math.min(Number.isInteger(value) ? value : 0, length - 1));
}
