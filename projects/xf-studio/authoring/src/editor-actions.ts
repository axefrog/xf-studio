import { editLayers, type LayerCommand } from "./layer-stack";
import { MAX_LAYERS, parseRecipe, type Recipe } from "./recipe";
import type { ActionCapability } from "./collection-actions";
import { nameIssue, positionIssue, refuse } from "./validation-issues";
import { UNKNOWN_HISTORY_LABEL, type HistoryLabel } from "./history-labels";

export type LayerAction =
  | { kind: "layer.edit"; command: LayerCommand }
  | { kind: "layer.setEnabled"; id: string; enabled: boolean };

export function layerCapability(recipe: Recipe, action: LayerAction): ActionCapability {
  const command = action.kind === "layer.edit" ? action.command : action;
  if ("id" in command && !recipe.layers.some(layer => layer.id === command.id))
    return { available: false, reason: "That layer no longer exists." };
  if (action.kind === "layer.edit") {
    if ((command.kind === "add" || command.kind === "duplicate") && recipe.layers.length >= MAX_LAYERS)
      return refuse({ code: "range", message: `This preview currently supports up to ${MAX_LAYERS} layers.` });
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

type Entry = { encoded: string; id: HistoryEntryId; label?: HistoryLabel };
/** Opaque identity of one Undo entry, returned when a checkpoint actually adds it. */
export type HistoryEntryId = number & { readonly __historyEntry: unique symbol };
/**
 * Recipe history has no DOM or storage dependency and never returns a mutable stored entry.
 * Each entry may carry a session-only label; persisted/restored entries have none.
 * Transactions track the entry their checkpoint added by identity, never by depth: at
 * `RECIPE_HISTORY_LIMIT` a new entry drops the oldest, so the depth does not grow.
 */
export class RecipeHistory {
  private entries: Entry[];
  /** The oldest entry the latest checkpoint pushed out at the limit, restored if that checkpoint is discarded. */
  private displaced?: { by: HistoryEntryId; entry: Entry };
  private nextId = 1;
  constructor(initial: Recipe[] = []) { this.entries = this.encode(initial); }
  get canUndo() { return this.entries.length > 0; }
  get depth() { return this.entries.length; }
  /** Returns the new entry's identity, or undefined when an identical top entry made it a no-op. */
  checkpoint(recipe: Recipe, label?: HistoryLabel): HistoryEntryId | undefined {
    const encoded = JSON.stringify(recipe);
    if (this.entries.at(-1)?.encoded === encoded) return undefined;
    const id = this.id();
    this.entries.push({ encoded, id, label: label && { ...label } });
    const dropped = this.entries.length > RECIPE_HISTORY_LIMIT ? this.entries.shift() : undefined;
    this.displaced = dropped && { by: id, entry: dropped };
    return id;
  }
  /** True while `id` is the entry the next Undo would restore. */
  isTop(id: HistoryEntryId) { return this.entries.at(-1)?.id === id; }
  /** Pop the top entry. At the limit, the oldest entry its checkpoint displaced comes back. */
  undo(): Recipe | undefined {
    const entry = this.pop();
    return entry ? parseRecipe(JSON.parse(entry.encoded)) : undefined;
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
    if (entry && this.displaced?.by === entry.id) this.entries.unshift(this.displaced.entry);
    this.displaced = undefined;
    return entry;
  }
  snapshot(): Recipe[] { return this.entries.map(entry => parseRecipe(JSON.parse(entry.encoded))); }
  restore(entries: Recipe[]) { this.entries = this.encode(entries); this.displaced = undefined; }
  private id() { return this.nextId++ as HistoryEntryId; }
  private encode(entries: Recipe[]) {
    return entries.slice(-RECIPE_HISTORY_LIMIT).map(recipe => ({ encoded: JSON.stringify(parseRecipe(recipe)), id: this.id() }));
  }
}
/** Recipe Undo entries kept per preset (the oldest is dropped beyond this). */
export const RECIPE_HISTORY_LIMIT = 80;
