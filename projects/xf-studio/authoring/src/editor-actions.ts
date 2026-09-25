import { editLayers, type LayerCommand } from "./layer-stack";
import { MAX_LAYERS, parseRecipe, type Recipe } from "./recipe";
import type { CodedCapability } from "./collection-actions";
import { nameIssue, positionIssue, refuse } from "./validation-issues";
import { refusal } from "./platform/api";
import { UNKNOWN_HISTORY_LABEL, type HistoryLabel } from "./history-labels";

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

type Entry = { encoded: string; id: HistoryEntryId; label?: HistoryLabel; at?: number };
/** Opaque identity of one Undo entry, returned when a checkpoint actually adds it. */
export type HistoryEntryId = number & { readonly __historyEntry: unique symbol };
/** What one kept Undo entry is, without its recipe (for history lists). */
export type HistoryEntryInfo = { id: HistoryEntryId; label?: HistoryLabel; at?: number };
/** An entry taken off the history with its recipe, so a Redo can later put the same step back. */
export type PoppedHistoryEntry = HistoryEntryInfo & { recipe: Recipe; encoded: string };
/** Entry identities are unique for the whole session, across presets and restores. */
let nextEntryId = 1;
/**
 * Recipe history has no DOM or storage dependency and never returns a mutable stored entry.
 * Each entry may carry a session-only label and time; persisted/restored entries have none.
 * Transactions track the entry their checkpoint added by identity, never by depth: at
 * `RECIPE_HISTORY_LIMIT` a new entry drops the oldest, so the depth does not grow.
 * `trimmed` records that older entries were dropped (here at the limit, or before a restore).
 */
export class RecipeHistory {
  private entries: Entry[];
  /** The oldest entry the latest checkpoint pushed out at the limit, restored if that checkpoint is discarded. */
  private displaced?: { by: HistoryEntryId; entry: Entry; trimmed: boolean };
  private trimmedBefore: boolean;
  constructor(initial: Recipe[] = [], trimmed = false) {
    this.entries = this.encode(initial);
    this.trimmedBefore = trimmed || initial.length > RECIPE_HISTORY_LIMIT;
  }
  get canUndo() { return this.entries.length > 0; }
  get depth() { return this.entries.length; }
  /** True when older entries than the oldest kept one were dropped. */
  get trimmed() { return this.trimmedBefore; }
  /** Returns the new entry's identity, or undefined when an identical top entry made it a no-op. */
  checkpoint(recipe: Recipe, label?: HistoryLabel): HistoryEntryId | undefined {
    const encoded = JSON.stringify(recipe);
    if (this.entries.at(-1)?.encoded === encoded) return undefined;
    return this.push({ encoded, id: this.id(), label: label && { ...label }, at: Date.now() });
  }
  /**
   * Put a step that Undo took off back on top (Redo), keeping its identity, label and time.
   * `encoded` is the recipe before that step. Returns false when an identical top entry made it a no-op.
   */
  reapply(step: PoppedHistoryEntry | (HistoryEntryInfo & { encoded: string })): boolean {
    if (this.entries.at(-1)?.encoded === step.encoded) return false;
    const reused = !this.entries.some(entry => entry.id === step.id);
    this.push({ encoded: step.encoded, id: reused ? step.id : this.id(), label: step.label && { ...step.label },
      ...(step.at === undefined ? {} : { at: step.at }) });
    return true;
  }
  private push(entry: Entry) {
    this.entries.push(entry);
    const dropped = this.entries.length > RECIPE_HISTORY_LIMIT ? this.entries.shift() : undefined;
    this.displaced = dropped && { by: entry.id, entry: dropped, trimmed: this.trimmedBefore };
    if (dropped) this.trimmedBefore = true;
    return entry.id;
  }
  /** True while `id` is the entry the next Undo would restore. */
  isTop(id: HistoryEntryId) { return this.entries.at(-1)?.id === id; }
  /** Identity of the entry the next Undo would restore. */
  get topId(): HistoryEntryId | undefined { return this.entries.at(-1)?.id; }
  /** Pop the top entry. At the limit, the oldest entry its checkpoint displaced comes back. */
  undo(): Recipe | undefined {
    const entry = this.pop();
    return entry ? parseRecipe(JSON.parse(entry.encoded)) : undefined;
  }
  /** Pop the top entry with its identity, label and time. */
  undoEntry(): PoppedHistoryEntry | undefined {
    const entry = this.pop();
    return entry && { id: entry.id, ...(entry.label ? { label: { ...entry.label } } : {}),
      ...(entry.at === undefined ? {} : { at: entry.at }), encoded: entry.encoded, recipe: parseRecipe(JSON.parse(entry.encoded)) };
  }
  /** Kept entries oldest first, without recipes. Unlabelled (restored) entries have no label. */
  list(): HistoryEntryInfo[] {
    return this.entries.map(entry => ({ id: entry.id, ...(entry.label ? { label: { ...entry.label } } : {}),
      ...(entry.at === undefined ? {} : { at: entry.at }) }));
  }
  /** Label of the entry the next Undo would restore. */
  topLabel(): HistoryLabel | undefined {
    const entry = this.entries.at(-1);
    return entry && (entry.label ? { ...entry.label } : { ...UNKNOWN_HISTORY_LABEL });
  }
  /** Name one entry; a no-op once that entry was undone or dropped. */
  relabel(id: HistoryEntryId, label: HistoryLabel) {
    const entry = this.entries.find(item => item.id === id); if (entry) entry.label = { ...label };
  }
  /**
   * Remove `id` only while it is still the top entry (an empty transaction's checkpoint),
   * so an empty transaction leaves the history exactly as it found it, even at the limit.
   */
  discard(id: HistoryEntryId) { if (!this.isTop(id)) return false; this.pop(); return true; }
  private pop() {
    const entry = this.entries.pop();
    if (entry && this.displaced?.by === entry.id) {
      this.entries.unshift(this.displaced.entry);
      this.trimmedBefore = this.displaced.trimmed;
    }
    this.displaced = undefined;
    return entry;
  }
  snapshot(): Recipe[] { return this.entries.map(entry => parseRecipe(JSON.parse(entry.encoded))); }
  restore(entries: Recipe[], trimmed = false) {
    this.entries = this.encode(entries); this.displaced = undefined;
    this.trimmedBefore = trimmed || entries.length > RECIPE_HISTORY_LIMIT;
  }
  private id() { return nextEntryId++ as HistoryEntryId; }
  private encode(entries: Recipe[]) {
    return entries.slice(-RECIPE_HISTORY_LIMIT).map(recipe => ({ encoded: JSON.stringify(parseRecipe(recipe)), id: this.id() }));
  }
}
/** Recipe Undo entries kept per preset (the oldest is dropped beyond this). */
export const RECIPE_HISTORY_LIMIT = 80;
