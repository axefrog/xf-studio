import { RECIPE_HISTORY, recipeHistory, type HistoryEntryId, type HistoryEntryInfo } from "./editor-actions";
import { parseFieldSelection, type FieldSelection } from "./field-selection";
import { parseRecipe, type Recipe } from "./recipe";
import type { RecipeActionEffect, RecipeActionState } from "./recipe-actions";
import type { ReadonlyDeep } from "./read-only";
import type { HistoryLabel } from "./history-labels";
import { LOOK_HISTORY_1, type HistoryParts, type LookHistoryData } from "./platform/api";
import { LookHistory } from "./platform/core/look-history";
import type { TransactionHost } from "./platform/core/history-transaction";
import type { LiveFeatureState, LiveFeatures } from "./platform/core/live-features";

/**
 * The look's Undo history as the document is given it: its data (`LookHistoryData`, what this
 * build keeps in memory), or eye makeup's whole recipes oldest first (how workspaces before the look
 * history held it, and how tests still build one).
 */
export type DocumentHistory = LookHistoryData | Recipe[];
export type DocumentState = { recipe: Recipe; active: number; selected: number;
  fieldSelection: FieldSelection; history: DocumentHistory;
  /** Present (true) only when older Undo entries than the oldest kept one were dropped. */
  historyTrimmed?: boolean;
  /**
   * The look's other registered features' live state (their parts and editor memory), present only
   * when the composition registers features beside the one this document edits (step 5).
   */
  liveFeatures?: Record<string, LiveFeatureState> };
/** `part`: another feature's live part changed (an action of that feature, or an Undo or Redo). */
export type DocumentChange = "recipe" | "selection" | "history" | "restore" | "part";
export type DocumentEffect = RecipeActionEffect | { kind: "gesture"; layerIndex: number };
/**
 * Which feature's part the document edits and how the look history splits parts (the composition's part
 * registry). `others` are the live documents of the look's other registered features: the look history
 * reads and restores them too, so one step can span several parts (a look transaction).
 */
export type DocumentParts = { readonly feature: string; readonly parts: HistoryParts; readonly others?: LiveFeatures };
/** What an Undo, Redo or reverted step restored: this document's recipe when the step touched it, and the other features it restored. */
export type LookRestore = { recipe?: Recipe; features: string[] };

/** A look history from either form; throws on a damaged entry (checked before anything is published). */
function lookHistory(value: DocumentHistory | undefined, trimmed: boolean, parts: DocumentParts): LookHistory {
  if (Array.isArray(value) || value === undefined) return recipeHistory(value ?? [], trimmed, parts);
  if (!value || value.schema !== LOOK_HISTORY_1) throw Error("This look's Undo history is damaged.");
  const history = LookHistory.fromData(parts.parts, trimmed && !value.trimmed ? { ...value, trimmed: true } : value);
  // The document edits one feature's part beside its other live features; a step of any other feature's is not one it can undo.
  if (history.features().some(feature => feature !== parts.feature && !parts.others?.has(feature)))
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
    parts.others?.load(initial.liveFeatures);
  }
  /** The look as the history reads it: this document's feature is its recipe; the others are their live documents. */
  private readonly read = (feature: string) => feature === this.parts.feature ? this.state.recipe : this.parts.others?.read(feature);
  private recipeOf(parts: Record<string, unknown> | undefined) { return parts?.[this.parts.feature] as Recipe | undefined; }
  /** The feature this document edits. */
  get feature() { return this.parts.feature; }
  /** The look's other live feature documents (undefined unless the composition registers more features). */
  get others(): LiveFeatures | undefined { return this.parts.others?.size ? this.parts.others : undefined; }
  /**
   * Apply restored parts: the other features' go to their live documents (announced once as `part`);
   * this document's recipe is returned for the caller to publish.
   */
  private restored(parts: Record<string, unknown> | undefined): LookRestore {
    const others = this.others && parts ? this.others.restore(parts) : [];
    if (others.length) { this.otherRevision++; this.notify("part"); }
    return { ...(parts && this.parts.feature in parts ? { recipe: this.recipeOf(parts) } : {}), features: others };
  }
  /**
   * A fingerprint of the look's content (of `features` only, when given): the recipe's JSON, followed by
   * the other live features' parts only when there are any, so it is the recipe's JSON while this
   * document's feature is the only one.
   */
  contentKey(features?: readonly string[]): string {
    const own = !features || features.includes(this.parts.feature) ? JSON.stringify(this.state.recipe) : "";
    const others = this.others;
    return others ? `${own}\n${others.content(features ?? others.features())}` : own;
  }
  /** Tell listeners that another feature's live part changed (its action was published). */
  partChanged() { this.otherRevision++; this.notify("part"); }
  /** Increments whenever another live feature's part changes (published, restored or loaded). */
  private otherRevision = 0;
  /** The other live features' parts as they are now (not copies) and their revision; undefined without other features. */
  otherParts(): { revision: number; parts: Record<string, unknown | undefined> } | undefined {
    const others = this.others;
    return others && { revision: this.otherRevision,
      parts: Object.fromEntries(others.features().map(feature => [feature, others.read(feature)])) };
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
  /** Record the current recipe; returns the added entry, or undefined when it duplicated the top entry. */
  checkpoint(_recipe?: Recipe, label?: HistoryLabel): HistoryEntryId | undefined {
    const added = this.history.checkpoint(this.read, [this.parts.feature], { label: label ?? this.pendingLabel });
    this.notify("history");
    return added;
  }
  /** Record a step for another live feature's part, before its action publishes; undefined when the top step already held it. */
  checkpointFeature(feature: string, label?: HistoryLabel): HistoryEntryId | undefined {
    const added = this.history.checkpoint(this.read, [feature], { label: label ?? this.pendingLabel });
    this.notify("history");
    return added;
  }
  /** Record one look step over several parts (a look transaction's checkpoint). */
  checkpointLook(features: readonly string[], label: HistoryLabel): HistoryEntryId | undefined {
    const added = this.history.checkpoint(this.read, features, { scope: "look", label });
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
  /** The recipe the top step restores, leaving the history as it is (a cancelled transaction without its own step). */
  topRecipe(): Recipe | undefined { return this.topLook()?.recipe; }
  /** Take the latest checkpoint off without Redo (a cancelled transaction); returns the recipe it restores. */
  undoRecipe() { return this.revertLook()?.recipe; }
  /**
   * Undo `count` steps as one change (each onto the session's Redo list); returns the recipe to
   * show, which the caller publishes once. Undefined when fewer steps are kept.
   */
  undoSteps(count: number): Recipe | undefined { return this.undoLook(count)?.recipe; }
  /** Redo `count` steps as one change, keeping each step's identity; returns the recipe to show. */
  redoSteps(count: number): Recipe | undefined { return this.redoLook(count)?.recipe; }
  /**
   * What the top step restores, leaving the history as it is: the other features' parts are restored at
   * once and the recipe (when the step touched it) is returned for the caller to publish.
   */
  topLook(): LookRestore | undefined {
    return this.history.canUndo ? this.restored(this.history.stepParts(this.history.depth - 1)) : undefined;
  }
  /** Take the latest step off without Redo (a cancelled transaction) and restore what it held. */
  revertLook(): LookRestore | undefined {
    if (!this.history.canUndo) return undefined;
    const parts = this.history.revert();
    this.notify("history");
    return this.restored(parts);
  }
  /** Undo `count` steps as one change: the other features' parts are restored, the recipe returned to publish. */
  undoLook(count: number): LookRestore | undefined {
    const result = this.history.undo(this.read, count);
    if (!result) return undefined;
    for (let i = 0; i < count; i++) this.notify("history");
    return this.restored(result.parts);
  }
  /** Redo `count` steps as one change, keeping each step's identity. */
  redoLook(count: number): LookRestore | undefined {
    const result = this.history.redo(this.read, count);
    if (!result) return undefined;
    for (let i = 0; i < result.pushed; i++) this.notify("history");
    return this.restored(result.parts);
  }
  /** Redo-able steps in Redo order (the next one first). Validity is the caller's decision. */
  redoList() { return this.history.redoSteps(); }
  get redoDepth() { return this.history.redoDepth; }
  clearRedo() { this.history.clearRedo(); }
  /**
   * Where a gesture or form-control transaction records (the platform's `HistoryTransaction`): this
   * look's history, with the recipe's JSON as the content fingerprint. `revert` restores and publishes.
   */
  transactionHost(revert: (step: HistoryEntryId | undefined) => void): TransactionHost<HistoryEntryId> {
    return { checkpoint: () => this.checkpoint(), top: () => this.history.topId,
      relabel: (step, label) => this.relabelCheckpoint(step, label),
      discard: step => this.discardCheckpoint(step), revert, content: () => JSON.stringify(this.state.recipe) };
  }
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
    const others = this.others;
    return { ...structuredClone(this.state), history: this.history.data(),
      ...(this.history.trimmed ? { historyTrimmed: true } : {}), ...(others ? { liveFeatures: others.export() } : {}) };
  }
  /** For collection switches and workspace restore, publish the whole validated editor state at once. */
  restore(value: DocumentState) {
    const recipe = parseRecipe(value.recipe), active = clamp(value.active, recipe.layers.length);
    const fieldSelection = parseFieldSelection(value.fieldSelection, recipe);
    const history = lookHistory(value.history, value.historyTrimmed === true, this.parts);
    this.state = { recipe, active, selected: clamp(value.selected, recipe.layers[active]?.points.length ?? 0),
      fieldSelection };
    this.history = history;
    this.parts.others?.load(value.liveFeatures); this.otherRevision++;
    this.geometryRevision++; this.changedLayerIndex = undefined; this.changedGestureKind = undefined;
    this.notify("restore");
  }
}

function clamp(value: number, length: number) {
  return length <= 0 ? 0 : Math.max(0, Math.min(Number.isInteger(value) ? value : 0, length - 1));
}
