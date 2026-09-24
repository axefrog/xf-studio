import {DEFAULT_SOFTNESS_BLEND, MIN_FEATHER, MAX_FEATHER, type Layer} from "./recipe";

export type SoftnessCommand =
  | {kind: "variable-softness"; enabled: boolean}
  | {kind: "point-softness"; index: number; value: number}
  | {kind: "uniform-softness"; value: number};

/** Presentation-independent edits; callers own Undo, scheduling and persistence. */
export function editSoftness(layer: Layer, command: SoftnessCommand): Layer {
  const next = structuredClone(layer);
  if (command.kind === "variable-softness") {
    if (typeof command.enabled !== "boolean") throw Error("Choose whether point softness is enabled.");
    if (command.enabled) {
      next.softness = layer.softness.mode === "boundary" ? {...layer.softness} : {mode: "boundary", blend: DEFAULT_SOFTNESS_BLEND};
      next.points.forEach(p => { if (p.feather === undefined) p.feather = layer.feather; });
    } else next.softness = {mode: "uniform"};
    return next;
  }
  if (!Number.isFinite(command.value) || command.value < MIN_FEATHER || command.value > MAX_FEATHER)
    throw Error("Edge softness is outside the supported range.");
  if (command.kind === "uniform-softness") {
    next.feather = command.value;
    return next;
  }
  if (command.kind !== "point-softness") throw Error("Unknown edge softness action.");
  if (layer.softness.mode !== "boundary") throw Error("Enable point edge softness before editing an individual edge.");
  if (!Number.isInteger(command.index) || !next.points[command.index]) throw Error("That control point no longer exists.");
  next.points[command.index].feather = command.value;
  return next;
}
