import {
  DEFAULT_STRENGTH_BLEND, MIN_STRENGTH_BLEND, MAX_STRENGTH_BLEND, type Layer,
} from "./recipe";

export type PigmentCommand =
  | { kind: "point-strength"; index: number; value: number }
  | { kind: "smooth-strength"; enabled: boolean }
  | { kind: "strength-blend"; value: number };

/** UI-independent pigment operations. No mutation, history or storage side effects. */
export function editPigment(layer: Layer, command: PigmentCommand): Layer {
  if (command.kind === "point-strength") {
    if (!Number.isInteger(command.index) || !layer.points[command.index])
      throw Error("That control point no longer exists.");
    if (!Number.isFinite(command.value) || command.value < 0 || command.value > 1)
      throw Error("Pigment strength must be between zero and one.");
    return { ...layer, points: layer.points.map((p, i) => i === command.index ? { ...p, weight: command.value } : p) };
  }
  if (command.kind === "smooth-strength") {
    return { ...layer, strength: command.enabled
      ? layer.strength.mode === "smooth-boundary" ? { ...layer.strength } : { mode: "smooth-boundary", blend: DEFAULT_STRENGTH_BLEND }
      : { mode: "legacy-nearest" } };
  }
  if (layer.strength.mode !== "smooth-boundary")
    throw Error("Enable smooth point gradients before adjusting their blend.");
  if (!Number.isFinite(command.value) || command.value < MIN_STRENGTH_BLEND || command.value > MAX_STRENGTH_BLEND)
    throw Error("Point blend is outside the supported range.");
  return { ...layer, strength: { mode: "smooth-boundary", blend: command.value } };
}
