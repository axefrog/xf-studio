import type { StudioAction, StudioTarget } from "./studio-application";
import type { NamedTargets, Unnamed } from "./action-targets";
import type { StudioCapability } from "./studio-application";

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

/**
 * A query is tied to the collection/preset and, for geometry hits, its revision, and to the targets the input layer resolved when it
 * opened (`named`, profiles design §3.3): every command it offers names them.
 */
export type StudioBoundContext = Readonly<{
  contextIdentity: number;
  hit: Readonly<StudioContextHit>;
  named: Readonly<NamedTargets>;
  collectionId?: string;
  selectedPresetId?: string;
  collectionRevision: number;
  geometryRevision: number;
}>;

export type ContextCandidate = ContextPresentation & (
  | { id: string; action: Unnamed<StudioAction> }
  | { id: string; actionKind: StudioAction["kind"]; variant?: string; requiresInput: true });

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

/**
 * Only existing commands are offered. Input candidates need a value before dispatch. `collection`: the collection the menu's targets name,
 * whose preset a preset hit shows (`scene.setLook`).
 */
export function contextCandidates(hit: StudioContextHit, collection?: string): ContextCandidate[] {
  const ready = (id: string, action: Unnamed<StudioAction>): ContextCandidate => ({ id, action });
  const input = (id: string, actionKind: StudioAction["kind"], variant?: string): ContextCandidate =>
    ({ id, actionKind, variant, requiresInput: true });
  if (hit.kind === "collection") return [
    ready("preset.add", { kind: "preset.edit", command: { kind: "add" } }),
    ready("preset.restore", { kind: "preset.edit", command: { kind: "restore" } }),
    ready("collection.undoOpen", { kind: "collection.undoOpen" }),
    input("collection.rename", "collection.rename")];
  if (hit.kind === "preset") return [
    ...(collection ? [ready("preset.select", { kind: "scene.setLook", look: { collection, look: hit.id } })] : []),
    ready("preset.copy", { kind: "preset.edit", command: { kind: "copy", id: hit.id } }),
    ready("preset.remove", { kind: "preset.edit", command: { kind: "remove", id: hit.id } }),
    input("preset.rename", "preset.edit", "rename"),
    input("preset.move", "preset.edit", "move")];
  return [];
}

/** Data the shell can render without interpreting a feature's part. */
export type ContextInput = { kind: "range" | "text" | "integer"; label: string; value: string | number;
  min?: number; max?: number; step?: number; maxLength?: number; field?: string; format?: "percent" | "scale"; title: string; apply: string };
export type ContextPresentation = { label?: string; icon?: string; checked?: boolean;
  capability?: StudioCapability; input?: ContextInput & { make(value: string | number): Unnamed<StudioAction> } };
export type ContextSelection = { hit: StudioContextHit; label: string; detail?: string };
export type EditorInputFacts = { hasTarget: boolean; enabled: boolean; locked: boolean };
export type FeatureContext = {
  handles(hit: StudioContextHit): boolean;
  revision(): number;
  target(target: StudioTarget): StudioCapability | undefined;
  validate(hit: StudioContextHit): StudioCapability | undefined;
  candidates(hit: StudioContextHit): ContextCandidate[];
  detail(hit: StudioContextHit): string | undefined;
  selected(): ContextSelection | undefined;
  inputFacts(): EditorInputFacts;
};
