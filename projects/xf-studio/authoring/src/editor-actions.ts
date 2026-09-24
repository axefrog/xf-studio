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

/**
 * Recipe history has no DOM or storage dependency and never returns a mutable stored entry.
 * Each entry may carry a session-only label; persisted/restored entries have none.
 */
export class RecipeHistory {
  private entries: { encoded: string; label?: HistoryLabel }[];
  constructor(initial: Recipe[] = []) { this.entries = encode(initial); }
  get canUndo() { return this.entries.length > 0; }
  get depth() { return this.entries.length; }
  /** Returns true when a new entry was added (an identical top entry is not duplicated). */
  checkpoint(recipe: Recipe, label?: HistoryLabel) {
    const encoded = JSON.stringify(recipe);
    const added = this.entries.at(-1)?.encoded !== encoded;
    if (added) this.entries.push({ encoded, label: label && { ...label } });
    if (this.entries.length > 80) this.entries.shift();
    return added;
  }
  undo(): Recipe | undefined {
    const entry = this.entries.pop();
    return entry ? parseRecipe(JSON.parse(entry.encoded)) : undefined;
  }
  /** Label of the entry the next Undo would restore. */
  topLabel(): HistoryLabel | undefined {
    const entry = this.entries.at(-1);
    return entry && (entry.label ? { ...entry.label } : { ...UNKNOWN_HISTORY_LABEL });
  }
  relabelTop(label: HistoryLabel) { const entry = this.entries.at(-1); if (entry) entry.label = { ...label }; }
  snapshot(): Recipe[] { return this.entries.map(entry => parseRecipe(JSON.parse(entry.encoded))); }
  restore(entries: Recipe[]) { this.entries = encode(entries); }
}
const encode = (entries: Recipe[]) => entries.map(recipe => ({ encoded: JSON.stringify(parseRecipe(recipe)) })).slice(-80);
