import { editLayers, type LayerCommand } from "./layer-stack";
import { MAX_LAYERS, parseRecipe, type Recipe } from "./recipe";
import type { ActionCapability } from "./collection-actions";

export type LayerAction =
  | { kind: "layer.edit"; command: LayerCommand }
  | { kind: "layer.setEnabled"; id: string; enabled: boolean };

export function layerCapability(recipe: Recipe, action: LayerAction): ActionCapability {
  const command = action.kind === "layer.edit" ? action.command : action;
  if ("id" in command && !recipe.layers.some(layer => layer.id === command.id))
    return { available: false, reason: "That layer no longer exists." };
  if (action.kind === "layer.edit") {
    if ((command.kind === "add" || command.kind === "duplicate") && recipe.layers.length >= MAX_LAYERS)
      return { available: false, reason: `This preview currently supports up to ${MAX_LAYERS} layers.` };
    if (command.kind === "move" && (!Number.isInteger(command.to) || command.to < 0 || command.to >= recipe.layers.length))
      return { available: false, reason: "Invalid layer position." };
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

/** Recipe history has no DOM or storage dependency and never returns a mutable stored entry. */
export class RecipeHistory {
  private entries: string[];
  constructor(initial: Recipe[] = []) { this.entries = initial.map(recipe => JSON.stringify(parseRecipe(recipe))).slice(-80); }
  get canUndo() { return this.entries.length > 0; }
  checkpoint(recipe: Recipe) {
    const encoded = JSON.stringify(recipe);
    if (this.entries.at(-1) !== encoded) this.entries.push(encoded);
    if (this.entries.length > 80) this.entries.shift();
  }
  undo(): Recipe | undefined {
    const encoded = this.entries.pop();
    return encoded ? parseRecipe(JSON.parse(encoded)) : undefined;
  }
  snapshot(): Recipe[] { return this.entries.map(encoded => parseRecipe(JSON.parse(encoded))); }
  restore(entries: Recipe[]) { this.entries = entries.map(recipe => JSON.stringify(parseRecipe(recipe))).slice(-80); }
}
