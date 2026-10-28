import type { MakeupPublication } from "../../engines/layered-makeup/editor";
import { recipeHistory, type HistoryEntryId } from "../../legacy/eye-makeup/editor-actions";
import { parseFieldSelection, type FieldSelection } from "../../engines/layered-makeup/field-selection";
import { emptyRecipe, type Recipe } from "../../engines/layered-makeup/recipe";
import { readRecipe as parseRecipe } from "../../legacy/eye-makeup/recipe-schema";
import type { RecipeActionEffect, RecipeActionState } from "../../engines/layered-makeup/recipe-actions";
import type { ReadonlyDeep } from "../../platform/api/read-only";
import type { HistoryLabel } from "../../engines/layered-makeup/history-labels";
import { LOOK_HISTORY_1, type HistoryParts, type LookHistoryData } from "../../platform/api";
import type { HistoryScope, HistoryService } from "../../platform/core/history-service";
import { AuthoringDocument as LookDocument } from "./authoring-document";
export { LOCAL_LOOK_SCOPE } from "./authoring-document";
import type { AnyFeatureModule } from "../../platform/api/feature";
import { LiveFeatures, type FeatureDocument, type LiveFeatureState } from "../../platform/core/live-features";

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
export type DocumentParts = { readonly feature: string; readonly parts: HistoryParts; readonly module: AnyFeatureModule; readonly others?: LiveFeatures };
/**
 * Where the document's look history lives (the session's history service; default: one of its own), the scope of the look it shows
 * first (`look:<collection>/<look>`, profiles design §3.7; default: a look of its own, for fixtures), and how a restored recipe resets
 * the preview's layer resources (the trusted core's port).
 */
export type DocumentHistoryOptions = { readonly history?: HistoryService; readonly scope?: string; readonly resetStack?: (previous: Recipe) => void;
  /** Attach the old API to the existing neutral owner, without loading or copying any state. */
  readonly look?: LookDocument; readonly signal?: AbortSignal; readonly release?: () => void;
  /** Opening/restoring an unseen context is not an editing interaction. Actual commands still activate their history. */
  readonly activate?: boolean; readonly registered?: boolean };
/** A look history from either form; throws on a damaged entry (checked before anything is published). */
function lookHistory(value: DocumentHistory | undefined, trimmed: boolean, parts: DocumentParts): LookHistoryData {
  if (Array.isArray(value) || value === undefined) return recipeHistory(value ?? [], trimmed, parts).data();
  if (!value || value.schema !== LOOK_HISTORY_1) throw Error("This look's Undo history is damaged.");
  return trimmed && !value.trimmed ? { ...value, trimmed: true } : value;
}

/** Transitional makeup adapter. The neutral look document owns all parts and the one history scope.
 * Recipe selection, geometry notifications and preview resets stay here until the registered editor slices.
 */
export class AuthoringDocument {
  private readonly look: LookDocument;
  private readonly primary: FeatureDocument;
  /** Derived compatibility projection, with no second state map or document owner. */
  private readonly otherDocuments: Pick<LiveFeatures, "features" | "has" | "document" | "read" | "content">;
  private readonly life = new AbortController();
  private readonly resetStack: (previous: Recipe) => void;
  private listeners = new Set<(change: DocumentChange) => void>();
  private effectListeners = new Set<(effect: DocumentEffect) => void>();
  private geometryRevision = 0;
  private changedLayerIndex: number | undefined;
  private changedGestureKind: string | undefined;
  private otherRevision = 0;
  private pendingLabel?: HistoryLabel;
  constructor(initial: DocumentState | undefined, private readonly parts: DocumentParts, private readonly options: DocumentHistoryOptions = {}) {
    if (parts.module.id !== parts.feature) throw Error("The makeup document's module does not match its feature.");
    this.resetStack = options.resetStack ?? (() => {});
    if (options.signal?.aborted) throw Error("This look's editing context has ended.");
    const features = options.look?.features ?? parts.others ?? new LiveFeatures();
    const replay: import("../../platform/core/live-features").FeatureRestore = {
      editor: (previous, value) => {
        const before = previous.part as Recipe | undefined, recipe = value as Recipe | undefined;
        const memory = previous.editor as { active: number; selected: number; fieldSelection?: FieldSelection };
        const activeId = before?.layers[memory.active]?.id, active = clamp(recipe?.layers.findIndex(layer => layer.id === activeId) ?? 0, recipe?.layers.length ?? 0);
        return { active, selected: activeId === recipe?.layers[active]?.id ? clamp(memory.selected, recipe?.layers[active]?.points.length ?? 0) : 0,
          fieldSelection: parseFieldSelection(memory.fieldSelection, recipe ?? emptyRecipe()) };
      },
      restored: previous => {
        this.geometryRevision++; this.changedLayerIndex = undefined; this.changedGestureKind = undefined;
        this.notify("recipe"); this.resetStack(previous as Recipe);
      },
    };
    this.primary = options.look ? features.document(parts.feature)! : features.add(parts.module, replay);
    if (options.look && !options.registered) this.primary.observeReplay(replay, this.life.signal);
    this.look = options.look ?? new LookDocument(this.seed(initial!), { features, parts: parts.parts }, { ...options, signal: this.life.signal });
    this.otherDocuments = {
      features: () => features.features().filter(feature => feature !== this.feature),
      has: feature => feature !== this.feature && features.has(feature),
      document: feature => feature === this.feature ? undefined : features.document(feature),
      read: feature => feature === this.feature ? undefined : features.read(feature),
      content: keys => features.content((keys ?? features.features()).filter(feature => feature !== this.feature)),
    };
    const off = this.look.subscribe((change, details) => {
      if (change === "part") {
        if (details?.kind === "restore" && details.features.some(feature => feature !== this.feature)) { this.otherRevision++; this.notify("part"); }
      } else {
        if (change === "restore") { this.otherRevision++; this.geometryRevision++; this.changedLayerIndex = undefined; this.changedGestureKind = undefined; }
        this.notify(change);
      }
    });
    const release = () => { this.life.abort(); off(); this.listeners.clear(); this.effectListeners.clear(); };
    this.life.signal.addEventListener("abort", off, { once: true });
    options.signal?.addEventListener("abort", release, { once: true });
    this.life.signal.addEventListener("abort", () => options.signal?.removeEventListener("abort", release), { once: true });
  }
  private seed(value: DocumentState) {
    const recipe = parseRecipe(value.recipe), active = clamp(value.active, recipe.layers.length);
    return { features: { ...value.liveFeatures, [this.feature]: { part: recipe, editor: { active,
      selected: clamp(value.selected, recipe.layers[active]?.points.length ?? 0), fieldSelection: parseFieldSelection(value.fieldSelection, recipe) } } },
      history: lookHistory(value.history, value.historyTrimmed === true, this.parts), locked: value.liveLocked };
  }
  private get state() {
    const editor = this.primary.editor as { active: number; selected: number; fieldSelection: FieldSelection };
    return { recipe: (this.primary.part as Recipe | undefined) ?? emptyRecipe(), ...editor };
  }
  private set state(value: Omit<DocumentState, "history" | "historyTrimmed">) {
    this.primary.set(value.recipe, { active: value.active, selected: value.selected, fieldSelection: value.fieldSelection });
  }
  /** The same feature-neutral owner, used by workspace/library adapters until registered construction lands. */
  get lookDocument() { return this.look; }
  get features() { return this.look.features; }
  get version() { return this.look.version; }
  get history(): HistoryScope { return this.look.history; }
  get scopeId() { return this.look.scopeId; }
  get locked() { return this.look.locked; }
  setBlocked(reason: string | undefined) { this.look.setBlocked(reason); }
  get feature() { return this.parts.feature; }
  /** Non-primary feature lookups over the same owner, preserving the existing sparse projection. */
  get others() { return this.look.features.size > 1 ? this.otherDocuments : undefined; }
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
  onReplacing(listener: () => void): () => void { return this.look.onReplacing(listener); }
  /**
   * The content is about to be replaced: whatever is open settles first. `restore` calls it; a caller that records the look before
   * replacing it (the look editor) calls it before recording, so the settled run is recorded with the look it belongs to.
   */
  replacing() { this.look.replacing(); }
  subscribe(listener: (change: DocumentChange) => void) {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  subscribeEffects(listener: (effect: DocumentEffect) => void) {
    this.effectListeners.add(listener); return () => this.effectListeners.delete(listener);
  }
  /** The final editable-context owner releases its history target and subscriptions. */
  dispose() {
    this.options.release?.(); this.life.abort(); this.listeners.clear(); this.effectListeners.clear();
  }
  private notify(change: DocumentChange) { for (const listener of this.listeners) listener(change); }
  private effect(value: DocumentEffect) { for (const listener of this.effectListeners) listener(value); }
  get recipe() { return this.state.recipe; }
  /** Lets detached geometry readers refresh on edits without cloning on render frames. */
  get geometryVersion() { return { revision: this.geometryRevision, layerIndex: this.changedLayerIndex,
    gestureKind: this.changedGestureKind }; }
  set recipe(value: Recipe) { this.primary.set(value, this.primary.editor, true); this.geometryRevision++; this.changedLayerIndex = undefined;
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
  set active(value: number) { this.state = { ...this.state, active: value }; this.notify("selection"); }
  get selected() { return this.state.selected; }
  set selected(value: number) { this.state = { ...this.state, selected: value }; this.notify("selection"); }
  get fieldSelection() { return this.state.fieldSelection; }
  set fieldSelection(value: FieldSelection) { this.state = { ...this.state, fieldSelection: value }; this.notify("selection"); }
  /** Gesture proposals preserve the live layer identity; publish after their validated in-place write. */
  gestureChanged(layerIndex?: number, kind?: string) {
    this.geometryRevision++; this.changedLayerIndex = layerIndex;
    this.changedGestureKind = kind;
    this.look.changed([this.feature]);
    this.notify("recipe"); if (layerIndex !== undefined) this.effect({ kind: "gesture", layerIndex });
  }
  /** Translate a registered editor publication into the released geometry/view notifications; never writes state. */
  published({ effect, previous, gestureKind }: MakeupPublication) {
    if (effect.kind !== "selection") {
      this.geometryRevision++;
      this.changedLayerIndex = "layerIndex" in effect && (effect.kind === "gesture" || effect.kind === "immediate") ? effect.layerIndex : undefined;
      this.changedGestureKind = gestureKind;
    }
    this.notify(effect.kind === "selection" ? "selection" : "recipe");
    if (effect.kind === "restore" || effect.kind === "structure") this.resetStack(previous!);
    else this.effect(effect);
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
    this.primary.set(recipe, this.primary.editor);
    this.geometryRevision++; this.changedLayerIndex = layerIndex; this.changedGestureKind = undefined;
    this.notify("recipe");
    this.effect({ kind: "immediate", layerIndex });
  }
  /** Run `change` so any checkpoint it creates is labelled (session-only; persisted history has no labels). */
  withHistoryLabel<T>(label: HistoryLabel, change: () => T): T {
    const prior = this.pendingLabel; this.pendingLabel = label;
    try { return change(); } finally { this.pendingLabel = prior; }
  }
  /** Record this document's part before a change (eye makeup's actions); undefined when the top step already held it. */
  checkpoint(_recipe?: Recipe, label?: HistoryLabel): HistoryEntryId | undefined {
    return this.history.checkpoint([this.parts.feature], label ?? this.pendingLabel);
  }
  /** Distinct history chunks and their size (UTF-16 code units), for budgets and benchmarks. */
  historyStats() { return this.history.stats(); }
  snapshot(): ReadonlyDeep<DocumentState> { return this.export(); }
  /** The editor state with its look history as data (steps and chunks, never whole recipes per step). */
  export(): DocumentState {
    const others = this.look.features.export(this.otherDocuments.features());
    return { ...structuredClone(this.state), history: this.history.data(),
      ...(this.history.trimmed ? { historyTrimmed: true } : {}), ...(others && Object.keys(others).length ? { liveFeatures: others } : {}) };
  }
  /**
   * Show a look (another one, or the same one taken from elsewhere): publish the whole validated editor state at once. `scope` is the
   * look's history scope when it is another look's: the previous look's scope closes and the shown one's opens with its steps.
   */
  restore(value: DocumentState, scope?: string) {
    this.look.restore(this.seed(value), scope);
  }
}

function clamp(value: number, length: number) {
  return length <= 0 ? 0 : Math.max(0, Math.min(Number.isInteger(value) ? value : 0, length - 1));
}
