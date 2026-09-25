import type { LayerAction } from "./editor-actions";
import type { GestureEdit, RecipeAction } from "./recipe-actions";

/** What one recipe Undo/Redo entry did, for menus and tooltips ("Undo Opacity"). Session-only. */
export type HistoryLabel = { label: string; actionKind: string; layerId?: string };

export const UNKNOWN_HISTORY_LABEL: HistoryLabel = Object.freeze({ label: "Earlier change", actionKind: "unknown" });

const layerCommand: Record<string, string> = { add: "Add layer", duplicate: "Duplicate layer", remove: "Remove layer",
  reset: "Reset layer", rename: "Rename layer", move: "Move layer" };
const simple: Record<string, string> = {
  "point.remove": "Remove point", "field.add": "Add warp", "field.remove": "Remove warp", "field.clear": "Reset warp pull",
  "field.setReach": "Warp reach", "layer.setColor": "Colour", "layer.setOpacity": "Opacity", "layer.setSymmetry": "Mirroring",
  "layer.setFinish": "Finish", "layer.useGameOptics": "Game-matched finish", "glitter.selectModel": "Glitter model", "glitter.setClassic": "Flake setting",
  "glitter.setIrregular": "Flake setting", "glitter.setDirect": "Glint setting",
  "point.move": "Move point", "point.insert": "Add point", "point.setTangent": "Tangent",
  "field.setOrigin": "Move warp", "field.setVector": "Warp pull",
};
const nested: Record<string, string> = {
  "enable-bezier": "Enable Bézier handles", "point-mode": "Handle type",
  "point-strength": "Point pigment", "smooth-strength": "Smooth point gradients", "strength-blend": "Pigment blend",
  "variable-softness": "Point edge softness", "point-softness": "Point edge softness", "uniform-softness": "Edge softness",
  translate: "Move shape", rotate: "Rotate shape", scale: "Scale shape",
};

/** Label for a discrete or form-control recipe edit. */
export function historyLabel(action: RecipeAction | LayerAction): HistoryLabel {
  if (action.kind === "layer.edit") return { label: layerCommand[action.command.kind] ?? "Layer change",
    actionKind: `layer.edit.${action.command.kind}`, ...("id" in action.command ? { layerId: action.command.id } : {}) };
  if (action.kind === "layer.setEnabled") return { label: action.enabled ? "Show layer" : "Hide layer",
    actionKind: action.kind, layerId: action.id };
  if (action.kind === "layer.setShift") return { label: action.key === "strength" ? "Shift strength" : "Shift colour",
    actionKind: action.kind, layerId: action.layerId };
  const command = "command" in action ? action.command.kind : undefined;
  return { label: (command && nested[command]) ?? simple[action.kind] ?? "Recipe change",
    actionKind: command ? `${action.kind}.${command}` : action.kind, layerId: action.layerId };
}

const gesture: Record<GestureEdit["kind"], string> = { "shape.replace": "Transform shape", "point.replace": "Move point",
  "field.replace": "Move warp", "path.replacePoints": "Edit path" };
export function gestureHistoryLabel(action: Pick<GestureEdit, "kind" | "layerId">): HistoryLabel {
  return { label: gesture[action.kind], actionKind: `gesture.${action.kind}`, layerId: action.layerId };
}
