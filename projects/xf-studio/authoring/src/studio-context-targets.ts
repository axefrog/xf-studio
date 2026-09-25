import type { StudioAction, StudioTarget } from "./studio-application";
import type { Recipe } from "./recipe";

/**
 * A renderer/DOM adapter identifies the hit; this module never performs picking.
 * `head` is character geometry (skin, eyes, plate) with no makeup or control under the
 * cursor; `uv-empty` is atlas space with none. Background (no geometry) is no hit at all.
 */
export type StudioContextHit =
  | { kind: "uv-empty" }
  | { kind: "head" }
  | { kind: "shape"; layerId: string }
  | { kind: "point"; layerId: string; index: number }
  | { kind: "tangent"; layerId: string; index: number; side: "incoming" | "outgoing" }
  | { kind: "field"; layerId: string; id: string }
  | { kind: "layer"; id: string }
  | { kind: "preset"; id: string }
  | { kind: "collection" };

/** A query is tied to the collection/preset and, for geometry hits, its revision. */
export type StudioBoundContext = Readonly<{
  hit: Readonly<StudioContextHit>;
  collectionId?: string;
  selectedPresetId?: string;
  collectionRevision: number;
  geometryRevision: number;
}>;

export type ContextCandidate =
  | { id: string; action: StudioAction }
  | { id: string; actionKind: StudioAction["kind"]; variant?: string; requiresInput: true };

export function contextScope(hit: StudioContextHit): StudioTarget | undefined {
  switch (hit.kind) {
    case "collection": case "preset": case "layer": case "point": case "field": return hit;
    case "shape": return { kind: "layer", id: hit.layerId };
    case "tangent": return { kind: "point", layerId: hit.layerId, index: hit.index };
    case "uv-empty": case "head": return undefined;
  }
}

export function geometryHit(hit: StudioContextHit) {
  return hit.kind === "point" || hit.kind === "tangent" || hit.kind === "field" ||
    hit.kind === "shape" || hit.kind === "layer";
}

/** Only existing commands are offered. Input candidates need a value before dispatch. */
export function contextCandidates(hit: StudioContextHit, recipe: Recipe): ContextCandidate[] {
  const ready = (id: string, action: StudioAction): ContextCandidate => ({ id, action });
  const input = (id: string, actionKind: StudioAction["kind"], variant?: string): ContextCandidate =>
    ({ id, actionKind, variant, requiresInput: true });
  if (hit.kind === "collection") return [
    ready("preset.add", { kind: "preset.edit", command: { kind: "add" } }),
    ready("preset.restore", { kind: "preset.edit", command: { kind: "restore" } }),
    ready("collection.undoOpen", { kind: "collection.undoOpen" }),
    input("collection.rename", "collection.rename")];
  if (hit.kind === "preset") return [
    ready("preset.select", { kind: "preset.select", id: hit.id }),
    ready("preset.copy", { kind: "preset.edit", command: { kind: "copy", id: hit.id } }),
    ready("preset.remove", { kind: "preset.edit", command: { kind: "remove", id: hit.id } }),
    input("preset.rename", "preset.edit", "rename"),
    input("preset.move", "preset.edit", "move")];
  if (hit.kind === "layer") {
    const layer = recipe.layers.find(item => item.id === hit.id);
    return [
      ready("layer.select", { kind: "layer.select", layerId: hit.id }),
      ready("layer.duplicate", { kind: "layer.edit", command: { kind: "duplicate", id: hit.id } }),
      ready("layer.remove", { kind: "layer.edit", command: { kind: "remove", id: hit.id } }),
      ready("layer.toggle", { kind: "layer.setEnabled", id: hit.id, enabled: !layer?.enabled }),
      input("layer.rename", "layer.edit", "rename"),
      input("layer.move", "layer.edit", "move")];
  }
  if (hit.kind === "shape") return [
    ready("shape.selectLayer", { kind: "layer.select", layerId: hit.layerId }),
    ready("shape.addWarp", { kind: "field.add", layerId: hit.layerId }),
    ...(recipe.layers.find(layer => layer.id === hit.layerId)?.pathMode === "bezier" ? [] : [
      ready("shape.enableBezier", { kind: "path.edit", layerId: hit.layerId,
        command: { kind: "enable-bezier" } })])];
  if (hit.kind === "point" || hit.kind === "tangent") {
    const options: ContextCandidate[] = [
      ready("point.select", { kind: "point.select", layerId: hit.layerId, index: hit.index }),
      ready("point.remove", { kind: "point.remove", layerId: hit.layerId, index: hit.index })];
    if (recipe.layers.find(layer => layer.id === hit.layerId)?.pathMode === "bezier")
      for (const mode of ["aligned", "symmetric", "corner"] as const)
        options.push(ready(`point.mode.${mode}`, { kind: "path.edit", layerId: hit.layerId,
          command: { kind: "point-mode", index: hit.index, mode } }));
    options.push(input("point.strength", "pigment.edit", "point-strength"),
      input("point.softness", "softness.edit", "point-softness"));
    return options;
  }
  if (hit.kind === "field") return [
    ready("field.select", { kind: "field.select", layerId: hit.layerId, fieldId: hit.id }),
    ready("field.clear", { kind: "field.clear", layerId: hit.layerId, fieldId: hit.id }),
    ready("field.remove", { kind: "field.remove", layerId: hit.layerId, fieldId: hit.id }),
    input("field.reach", "field.setReach")];
  // Pan, zoom and insertion need adapter coordinates; no current standalone action
  // has those inputs. Do not suggest an edit at the wrong place on bare skin or empty
  // canvas: those hits offer no target section, only the viewport's own view actions.
  return [];
}
