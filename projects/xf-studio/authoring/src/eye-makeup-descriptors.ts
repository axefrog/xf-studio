/**
 * Eye makeup's action and gesture descriptors (feature-module platform §1), in catalogue order. They depend only on
 * the platform API and the layered-makeup engine, so the eye-makeup feature registers them without reaching the
 * application. The application, presentation and system-family tables still read every kind from
 * `studio-action-descriptors.ts`, which spreads these in place; this module moves into `features/eye-makeup/` once
 * those read descriptors only from the registry (feature-module platform §7, step 9).
 */
import { FINISH_IDS, LEGACY_FINISH_ALIASES } from "./engines/layered-makeup/finish-catalogue";
import type { GestureEdit } from "./engines/layered-makeup/recipe-actions";
import type { ActionDescriptor, PayloadSchema, UndoPolicy } from "./platform/api";
import { describe, enumerated, input, inputText, target } from "./action-descriptor-kit";
import type { EyeMakeupAction } from "./eye-makeup-model";

/** The targets eye makeup's actions apply to (a subset of the Studio's action scopes). */
export type EyeMakeupScope = "layer" | "point" | "field" | "collection";
const desc = (scope: EyeMakeupScope | readonly EyeMakeupScope[], effect: ActionDescriptor["effect"], undo: UndoPolicy,
  payload: PayloadSchema = {}, variants?: Record<string, PayloadSchema>) => describe<EyeMakeupScope>(scope, effect, undo, payload, variants);

export const EYE_MAKEUP_DESCRIPTORS = {
  "layer.select": desc("layer", "selection", "none", { layerId: target("string") }),
  "point.select": desc("point", "selection", "none", { layerId: target("string"), index: target("integer") }),
  "point.remove": desc("point", "content", "part", { layerId: target("string"), index: target("integer") }),
  "path.edit": desc(["layer", "point"], "content", "part", { layerId: target("string"), command: input("object") }, {
    "enable-bezier": {}, "point-mode": { index: target("integer"), mode: enumerated(["aligned", "symmetric", "corner"]) } }),
  "field.select": desc("field", "selection", "none", { layerId: target("string"), fieldId: target("string") }),
  "field.add": desc("layer", "content", "part", { layerId: target("string") }),
  "field.remove": desc("field", "content", "part", { layerId: target("string"), fieldId: target("string") }),
  "field.clear": desc("field", "content", "part", { layerId: target("string"), fieldId: target("string") }),
  "field.setReach": desc("field", "content", "transaction", { layerId: target("string"), fieldId: target("string"), radius: input("number", .005, .2) }),
  "pigment.edit": desc(["point", "layer"], "content", "transaction", { layerId: target("string"), command: input("object") }, {
    "point-strength": { index: target("integer"), value: input("number", 0, 1) },
    "smooth-strength": { enabled: input("boolean") },
    "strength-blend": { value: input("number", .000125, .02) } }),
  "softness.edit": desc(["point", "layer"], "content", "transaction", { layerId: target("string"), command: input("object") }, {
    "variable-softness": { enabled: input("boolean") },
    "point-softness": { index: target("integer"), value: input("number", .0005, .06) },
    "uniform-softness": { value: input("number", .0005, .06) } }),
  "layer.setColor": desc("layer", "content", "transaction", { layerId: target("string"), color: input("string") }),
  "layer.setOpacity": desc("layer", "content", "transaction", { layerId: target("string"), opacity: input("number", 0, 1) }),
  "layer.setSymmetry": desc("layer", "content", "part", { layerId: target("string"), symmetry: input("boolean") }),
  "layer.setFinish": desc("layer", "content", "part", { layerId: target("string"), finish: enumerated([...FINISH_IDS, ...LEGACY_FINISH_ALIASES]) }),
  "layer.useGameOptics": desc("layer", "content", "part", { layerId: target("string") }),
  "layer.setShift": desc("layer", "content", "transaction", { layerId: target("string"), key: enumerated(["color", "strength"]), value: input("number|string") }, {
    color: { value: inputText(7, 7) }, strength: { value: input("number", 0, 1) } }),
  "glitter.selectModel": desc("layer", "content", "part", { layerId: target("string"), model: enumerated(["classic", "irregular", "direct", "clustered", "fine"]) }),
  "glitter.setClassic": desc("layer", "content", "transaction", { layerId: target("string"), key: enumerated(["cells", "density", "tilt"]), value: input("number") }, {
    cells: { value: input("integer", 32, 256) }, density: { value: input("number", 0, 1) },
    tilt: { value: input("number", 0, 1) } }),
  "glitter.setIrregular": desc("layer", "content", "transaction", { layerId: target("string"), key: enumerated(["count", "radius", "spread", "tilt", "color"]), value: input("number|string") }, {
    count: { value: input("integer", 0, 500000) }, radius: { value: input("number", .00025, .003) },
    spread: { value: input("number", 0, 1) }, tilt: { value: input("number", 0, 1) },
    color: { value: inputText(7, 7) } }),
  "glitter.setDirect": desc("layer", "content", "transaction", { layerId: target("string"), key: enumerated(["density", "fineShare", "strength", "color"]), value: input("number|string") }, {
    density: { value: input("number", 0, 1) }, fineShare: { value: input("number", 0, 1) },
    strength: { value: input("number", 0, 32) }, color: { value: inputText(7, 7) } }),
  "point.move": desc("point", "content", "part", { layerId: target("string"), index: target("integer"), u: input("number", 0, 1), v: input("number", 0, 1) }),
  "point.insert": desc("layer", "content", "part", { layerId: target("string"), u: input("number", 0, 1), v: input("number", 0, 1) }),
  "point.setTangent": desc("point", "content", "part", { layerId: target("string"), index: target("integer"),
    side: enumerated(["in", "out"]), du: input("number", -1, 1), dv: input("number", -1, 1) }),
  "shape.transform": desc("layer", "content", "part", { layerId: target("string"), command: input("object"),
    pivotIndex: { type: "integer", required: false, from: "state", min: 0 } }, {
    translate: { du: input("number", -1, 1), dv: input("number", -1, 1) }, rotate: { radians: input("number") },
    scale: { factor: input("number", .01, 100) } }),
  "field.setOrigin": desc("field", "content", "part", { layerId: target("string"), fieldId: target("string"), u: input("number", 0, 1), v: input("number", 0, 1) }),
  "field.setVector": desc("field", "content", "part", { layerId: target("string"), fieldId: target("string"), du: input("number", -.1, .1), dv: input("number", -.1, .1) }),
  "layer.edit": desc(["layer", "collection"], "content", "part", { command: input("object") }, {
    add: {}, duplicate: { id: target("string") }, remove: { id: target("string") },
    reset: { id: target("string") }, rename: { id: target("string"), name: inputText(1, 80) },
    move: { id: target("string"), to: input("integer", 0) } }),
  "layer.setEnabled": desc("layer", "content", "part", { id: target("string"), enabled: input("boolean") }),
} satisfies Record<EyeMakeupAction["kind"], ActionDescriptor<EyeMakeupScope>>;

/** Gesture payloads are proposals inside one opaque session, not standalone commands. */
export const EYE_MAKEUP_GESTURE_DESCRIPTORS = {
  "shape.replace": desc("layer", "content", "transaction", { next: input("object") }),
  "point.replace": desc("point", "content", "transaction", { index: target("integer"), next: input("object") }),
  "field.replace": desc("field", "content", "transaction", { fieldId: target("string"), next: input("object") }),
  "path.replacePoints": desc("layer", "content", "transaction", { points: input("object") }),
} satisfies Record<GestureEdit["kind"], ActionDescriptor<EyeMakeupScope>>;
