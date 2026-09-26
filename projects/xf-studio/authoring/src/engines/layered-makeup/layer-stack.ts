import { MAX_LAYERS, parseRecipe, type Recipe } from "./recipe";
import type { LayeredMakeupRegion } from "./region";
import { nameIssue, positionIssue, refuse } from "../../validation-issues";
import { refusal, type Capability } from "../../platform/api";

/**
 * `newId` is the ID of the layer `add` and `duplicate` create. A feature's registered apply
 * requires it (its host supplies it, so replay is deterministic); these helpers still make one when absent.
 */
export type LayerCommand =
  | { kind: "add"; newId?: string }
  | { kind: "duplicate"; id: string; newId?: string }
  | { kind: "remove" | "reset"; id: string }
  | { kind: "rename"; id: string; name: string }
  | { kind: "move"; id: string; to: number };

/** The layer-stack actions: a stack edit, or turning one layer on or off. */
export type LayerAction =
  | { kind: "layer.edit"; command: LayerCommand }
  | { kind: "layer.setEnabled"; id: string; enabled: boolean };

/**
 * Pure authoring operation. Array order is bottom to top; identities never follow indices. A new
 * layer's ID comes from the host (`newId`); this never invents one (CORE-33, CORE-44). A new or reset
 * layer takes the region's new-layer contour; the region's models validate the result.
 */
export function editLayers(value: Recipe, activeId: string | undefined, command: LayerCommand, region: Pick<LayeredMakeupRegion, "models" | "newLayer">) {
  const recipe = parseRecipe(value, region.models), layers = recipe.layers;
  const index = "id" in command ? layers.findIndex(l => l.id === command.id) : -1;
  if ("id" in command && index < 0) throw Error("That layer no longer exists.");
  if (command.kind === "add" || command.kind === "duplicate") {
    if (layers.length >= MAX_LAYERS) throw Error(`This preview currently supports up to ${MAX_LAYERS} layers.`);
    const layer = structuredClone(command.kind === "duplicate" ? layers[index] : region.newLayer());
    if (!command.newId) throw Error("A new layer needs its ID from the host.");
    layer.id = command.newId;
    if (layers.some(existing => existing.id === layer.id)) throw Error("That layer ID is already in use.");
    layer.name = command.kind === "duplicate" ? `${layer.name.slice(0, 73)} (copy)` : `Layer ${layers.length + 1}`;
    if (command.kind === "add") layer.enabled = true;
    layers.splice(command.kind === "duplicate" ? index + 1 : layers.length, 0, layer);
    activeId = layer.id;
  } else if (command.kind === "remove") {
    layers.splice(index, 1);
    if (activeId === command.id) activeId = layers[Math.min(index, layers.length - 1)]?.id;
  } else if (command.kind === "move") {
    if (!Number.isInteger(command.to) || command.to < 0 || command.to >= layers.length) throw Error("Invalid layer position.");
    layers.splice(command.to, 0, layers.splice(index, 1)[0]);
  } else if (command.kind === "rename") {
    layers[index].name = command.name.trim();
  } else {
    layers[index] = { ...region.newLayer(), id: layers[index].id, name: layers[index].name };
  }
  return { recipe: parseRecipe(recipe, region.models), active: Math.max(0, layers.findIndex(l => l.id === activeId)) };
}

export function layerCapability(recipe: Recipe, action: LayerAction): Capability {
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

/** Apply one layer-stack action (after its capability); `structure` says whether the stack itself changed. */
export function applyLayerAction(recipe: Recipe, activeId: string | undefined, action: LayerAction,
  region: Pick<LayeredMakeupRegion, "models" | "newLayer">) {
  const capability = layerCapability(recipe, action);
  if (!capability.available) throw Error(capability.reason);
  if (action.kind === "layer.edit") return { ...editLayers(recipe, activeId, action.command, region), structure: true as const };
  const next = parseRecipe({ ...recipe, layers: recipe.layers.map(layer => layer.id === action.id
    ? { ...layer, enabled: action.enabled } : layer) }, region.models);
  return { recipe: next, active: Math.max(0, next.layers.findIndex(layer => layer.id === activeId)), structure: false as const,
    changed: next.layers.findIndex(layer => layer.id === action.id) };
}
