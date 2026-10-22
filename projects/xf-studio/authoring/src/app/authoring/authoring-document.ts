import { RECIPE_HISTORY, recipeHistory, type HistoryEntryId } from "../../legacy/eye-makeup/editor-actions";
import { parseFieldSelection, type FieldSelection } from "../../engines/layered-makeup/field-selection";
import type { Recipe } from "../../engines/layered-makeup/recipe";
import { readRecipe as parseRecipe } from "../../legacy/eye-makeup/recipe-schema";
import type { RecipeActionEffect, RecipeActionState } from "../../engines/layered-makeup/recipe-actions";
import type { ReadonlyDeep } from "../../platform/api/read-only";
import type { HistoryLabel } from "../../legacy/eye-makeup/history-labels";
import { LOOK_HISTORY_1, type HistoryParts, type HistoryTarget, type LookHistoryData } from "../../platform/api";
import { LookHistory } from "../../platform/core/look-history";
import { createHistoryService, lookScope, type HistoryScope, type HistoryService } from "../../platform/core/history-service";
import type { LiveFeatureState, LiveFeatures } from "../../platform/core/live-features";

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
  liveFeatures?: Record<string, LiveFeatureState>;
  /**
   * Present when the selected look holds a newer build's data (`Look.locked`): the document shows an empty
   * part and nothing in the look is editable; the text says why. Input only: never exported or stored.
   */
  liveLocked?: string };
/** `part`: another feature's live part changed (an action of that feature, or an Undo or Redo). */
/** `access`: whether the document can be edited changed (`setBlocked`). */
export type DocumentChange = "recipe" | "selection" | "history" | "restore" | "part" | "access";
export type DocumentEffect = RecipeActionEffect | { kind: "gesture"; layerIndex: number };
/**
 * Which feature's part the document edits and how the look history splits parts (the composition's part
 * registry). `others` are the live documents of the look's other registered features: the look history
 * reads and restores them too, so one step can span several parts (a look transaction).
 */
export type DocumentParts = { readonly feature: string; readonly parts: HistoryParts; readonly others?: LiveFeatures };
/** What an Undo, Redo or reverted step restored: this document's recipe when the step touched it, and the other features it restored. */
type LookRestore = { recipe?: Recipe; features: string[] };
/**
 * Where the document's look history lives (the session's history service; default: one of its own), the scope of the look it shows
 * first (`look:<collection>/<look>`, profiles design §3.7; default: a look of its own, for fixtures), and how a restored recipe resets
 * the preview's layer resources (the trusted core's port).
 */
export type DocumentHistoryOptions = { readonly history?: HistoryService; readonly scope?: string; readonly resetStack?: (previous: Recipe) => void };
/** The scope a document without a look of the profile's shows (fixtures and tools). */
export const LOCAL_LOOK_SCOPE = lookScope({ collection: "local", look: "local" });

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

/**
 * The live in-process authoring document; snapshots never expose its mutable recipe. It is the target of the shown look's history
 * scope (`history`, `look:<collection>/<look>`): the scope records and restores the look's parts through it, and the document carries
 * the scope's steps in and out of its state (`export`, `restore`). Showing another look (`restore` with its scope) closes the previous
 * look's scope and opens the next one's.
 */
export class AuthoringDocument {
  private state: Omit<DocumentState, "history" | "historyTrimmed">;
  private scope: HistoryScope;
  private readonly service: HistoryService;
  private readonly target: HistoryTarget;
  /** The shown look's Undo history: the history service's scope of that look, over this document. */
  get history(): HistoryScope { return this.scope; }
  private readonly resetStack: (previous: Recipe) => void;
  private restoring = false;
  private listeners = new Set<(change: DocumentChange) => void>();
  private replacingListeners = new Set<() => void>();
  private effectListeners = new Set<(effect: DocumentEffect) => void>();
  private geometryRevision = 0;
  private changedLayerIndex: number | undefined;
  private changedGestureKind: string | undefined;
  /** `parts` names the feature this document edits and how its look history chunks parts (default: eye makeup's recipe). */
  constructor(initial: DocumentState, private readonly parts: DocumentParts = RECIPE_HISTORY, options: DocumentHistoryOptions = {}) {
    const recipe = parseRecipe(initial.recipe);
    this.state = { recipe, active: clamp(initial.active, recipe.layers.length),
      selected: clamp(initial.selected, recipe.layers[clamp(initial.active, recipe.layers.length)]?.points.length ?? 0),
      fieldSelection: parseFieldSelection(initial.fieldSelection, recipe) };
    this.resetStack = options.resetStack ?? (() => {});
    this.target = { read: this.read, apply: values => this.applyHistory(values),
      // The recipe's and the other parts' revisions: while unchanged, Redo stays valid without comparing content.
      revision: () => `${this.geometryRevision}:${this.otherRevision}`, fingerprint: keys => this.contentKey(keys) };
    this.service = options.history ?? createHistoryService();
    const stack = lookHistory(initial.history, initial.historyTrimmed === true, parts);
    this.scope = this.openScope(options.scope ?? LOCAL_LOOK_SCOPE, stack);
    // The look shown is the editing context until something else is edited (profiles design §3.7: Undo in a view undoes its look).
    this.scope.replace(stack);
    parts.others?.load(initial.liveFeatures);
    this.lockedReason = initial.liveLocked;
  }
  private openScope(id: string, stack: LookHistory): HistoryScope {
    return this.service.open(id, this.target, { stack, changed: () => { if (!this.restoring) this.notify("history"); } });
  }
  /** The shown look's scope ID (`look:<collection>/<look>`). */
  get scopeId(): string { return this.scope.id; }
  private lockedReason?: string;
  private blockedReason?: string;
  /**
   * Why the shown look can't be edited now, or undefined: it holds a newer build's data (kept exactly as it came), or it is being
   * restored from the last session (`setBlocked`).
   */
  get locked(): string | undefined { return this.lockedReason ?? this.blockedReason; }
  /** The look can't be edited for now (the reason), or can again (undefined): the look editor's recovery gate. */
  setBlocked(reason: string | undefined) {
    if (reason === this.blockedReason) return;
    this.blockedReason = reason;
    this.notify("access");
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
    // Only features holding a part add to the key: with none, it is the recipe's JSON, as while eye makeup was alone.
    const others = this.others, rest = others?.content(features ?? others.features());
    return rest && rest !== "[]" ? `${own}\n${rest}` : own;
  }
  /** Tell listeners that another feature's live part changed (its action was published). */
  partChanged() { this.otherRevision++; this.notify("part"); }
  /** Increments whenever another live feature's part changes (published, restored or loaded). */
  private otherRevision = 0;
  /** The other live features' revision (`otherRevision`): it changes whenever one of their parts or editors is published, restored or loaded. */
  get partRevision() { return this.otherRevision; }
  /** The other live features' parts as they are now (not copies) and their revision; undefined without other features. */
  otherParts(): { revision: number; parts: Record<string, unknown | undefined> } | undefined {
    const others = this.others;
    return others && { revision: this.otherRevision,
      parts: Object.fromEntries(others.features().map(feature => [feature, others.read(feature)])) };
  }
  /**
   * Calls `listener` before the document's content is replaced (another look shown, or the same look taken from elsewhere): an open
   * gesture or control run settles on the content it began on, never on what replaces it.
   */
  onReplacing(listener: () => void): () => void { this.replacingListeners.add(listener); return () => { this.replacingListeners.delete(listener); }; }
  /**
   * The content is about to be replaced: whatever is open settles first. `restore` calls it; a caller that records the look before
   * replacing it (the look editor) calls it before recording, so the settled run is recorded with the look it belongs to.
   */
  replacing() { for (const listener of [...this.replacingListeners]) listener(); }
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
  /** Record this document's part before a change (eye makeup's actions); undefined when the top step already held it. */
  checkpoint(_recipe?: Recipe, label?: HistoryLabel): HistoryEntryId | undefined {
    return this.history.checkpoint([this.parts.feature], label ?? this.pendingLabel);
  }
  /**
   * Show what an Undo, Redo or cancelled transaction restored: the other features' parts go to their live documents, and the
   * recipe (when the step touched it) is replaced once, keeping the active layer where it survives, and the preview's layer
   * resources reset.
   */
  private applyHistory(values: Readonly<Record<string, unknown>>): boolean {
    const next = this.restored(values).recipe;
    if (!next) return true;
    const previous = this.state.recipe, activeId = previous.layers[this.state.active]?.id;
    this.replaceRecipe(next, next.layers.findIndex(layer => layer.id === activeId));
    this.resetStack(previous);
    return true;
  }
  /** Distinct history chunks and their size (UTF-16 code units), for budgets and benchmarks. */
  historyStats() { return this.history.stats(); }
  snapshot(): ReadonlyDeep<DocumentState> { return this.export(); }
  /** The editor state with its look history as data (steps and chunks, never whole recipes per step). */
  export(): DocumentState {
    const others = this.others?.export();
    return { ...structuredClone(this.state), history: this.history.data(),
      ...(this.history.trimmed ? { historyTrimmed: true } : {}), ...(others && Object.keys(others).length ? { liveFeatures: others } : {}) };
  }
  /**
   * Show a look (another one, or the same one taken from elsewhere): publish the whole validated editor state at once. `scope` is the
   * look's history scope when it is another look's: the previous look's scope closes and the shown one's opens with its steps.
   */
  restore(value: DocumentState, scope?: string) {
    this.replacing();
    const recipe = parseRecipe(value.recipe), active = clamp(value.active, recipe.layers.length);
    const fieldSelection = parseFieldSelection(value.fieldSelection, recipe);
    const history = lookHistory(value.history, value.historyTrimmed === true, this.parts);
    this.state = { recipe, active, selected: clamp(value.selected, recipe.layers[active]?.points.length ?? 0),
      fieldSelection };
    this.parts.others?.load(value.liveFeatures); this.otherRevision++;
    this.lockedReason = value.liveLocked;
    this.geometryRevision++; this.changedLayerIndex = undefined; this.changedGestureKind = undefined;
    // The restored look's history replaces the scope's steps, and their Redo with them (announced once, as the restore).
    this.restoring = true;
    try {
      if (scope !== undefined && scope !== this.scope.id) {
        this.service.close(this.scope.id);
        this.scope = this.openScope(scope, history);
        // Showing a look is an editing interaction with it (§3.7): announced like a replaced stack.
        this.scope.replace(history);
      } else this.scope.replace(history);
    } finally { this.restoring = false; }
    this.notify("restore");
  }
}

function clamp(value: number, length: number) {
  return length <= 0 ? 0 : Math.max(0, Math.min(Number.isInteger(value) ? value : 0, length - 1));
}
