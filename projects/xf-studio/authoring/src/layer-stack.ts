import { newLayerTemplate, MAX_LAYERS, parseRecipe, type Recipe } from "./recipe";

/**
 * `newId` is the ID of the layer `add` and `duplicate` create. The registered eye-makeup apply
 * requires it (its host supplies it, so replay is deterministic); these helpers still make one when absent.
 */
export type LayerCommand =
  | { kind: "add"; newId?: string }
  | { kind: "duplicate"; id: string; newId?: string }
  | { kind: "remove" | "reset"; id: string }
  | { kind: "rename"; id: string; name: string }
  | { kind: "move"; id: string; to: number };

/** Pure authoring operation. Array order is bottom to top; identities never follow indices. */
export function editLayers(value: Recipe, activeId: string | undefined, command: LayerCommand) {
  const recipe = parseRecipe(value), layers = recipe.layers;
  const index = "id" in command ? layers.findIndex(l => l.id === command.id) : -1;
  if ("id" in command && index < 0) throw Error("That layer no longer exists.");
  if (command.kind === "add" || command.kind === "duplicate") {
    if (layers.length >= MAX_LAYERS) throw Error(`This preview currently supports up to ${MAX_LAYERS} layers.`);
    const layer = structuredClone(command.kind === "duplicate" ? layers[index] : newLayerTemplate());
    layer.id = command.newId ?? crypto.randomUUID();
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
    layers[index] = { ...newLayerTemplate(), id: layers[index].id, name: layers[index].name };
  }
  return { recipe: parseRecipe(recipe), active: Math.max(0, layers.findIndex(l => l.id === activeId)) };
}
