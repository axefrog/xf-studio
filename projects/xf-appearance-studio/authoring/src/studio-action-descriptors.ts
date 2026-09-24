import type { CollectionRequest } from "./collection-service";
import type { StudioAction, StudioGestureProposal, StudioTarget } from "./studio-application";

export type ActionScope = StudioTarget["kind"] | "file";
export type UndoPolicy = "none" | "recipe" | "transaction" | "recovery";
export type ValueSchema = { type: "string" | "number" | "number|string" | "integer" | "boolean" | "enum" | "object" | "bytes";
  required: boolean; from: "target" | "state" | "input"; min?: number; max?: number;
  minLength?: number; maxLength?: number;
  values?: readonly (string | number)[] };
export type PayloadSchema = Record<string, ValueSchema>;
export type ActionDescriptor = { scope: readonly ActionScope[]; undo: UndoPolicy;
  payload: PayloadSchema; variants?: Record<string, { payload: PayloadSchema; undo: UndoPolicy }>;
  effect: "selection" | "content" | "workspace" | "library" | "file" };
export type RequestDescriptor = { scope: readonly ActionScope[]; payload: PayloadSchema;
  effect: "read" | "save" | "download" | "import" | "package"; async: true;
  cancellable: boolean };

const target = (type: ValueSchema["type"]): ValueSchema => ({ type, required: true, from: "target" });
const input = (type: ValueSchema["type"], min?: number, max?: number): ValueSchema =>
  ({ type, required: true, from: "input", ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) });
const inputText = (minLength?: number, maxLength?: number): ValueSchema =>
  ({ type: "string", required: true, from: "input", minLength, maxLength });
const state = (type: ValueSchema["type"]): ValueSchema => ({ type, required: true, from: "state" });
const enumerated = (values: readonly (string | number)[], from: ValueSchema["from"] = "input"): ValueSchema =>
  ({ type: "enum", required: true, from, values });
const desc = (scope: ActionScope | readonly ActionScope[], effect: ActionDescriptor["effect"],
  undo: UndoPolicy, payload: PayloadSchema = {}, variants?: Record<string, PayloadSchema>,
  variantUndo?: Record<string, UndoPolicy>): ActionDescriptor =>
  ({ scope: typeof scope === "string" ? [scope] : scope, effect, undo, payload,
    ...(variants ? { variants: Object.fromEntries(Object.entries(variants).map(([key, fields]) =>
      [key, { payload: fields, undo: variantUndo?.[key] ?? undo }])) } : {}) });

/** Every public top-level action ID is covered at compile time; nested commands have named variants. */
export const ACTION_DESCRIPTORS = {
  "recipe.undo": desc("workspace", "content", "none"),
  "layer.select": desc("layer", "selection", "none", { layerId: target("string") }),
  "point.select": desc("point", "selection", "none", { layerId: target("string"), index: target("integer") }),
  "point.remove": desc("point", "content", "recipe", { layerId: target("string"), index: target("integer") }),
  "path.edit": desc(["layer", "point"], "content", "recipe", { layerId: target("string"), command: input("object") }, {
    "enable-bezier": {}, "point-mode": { index: target("integer"), mode: enumerated(["aligned", "symmetric", "corner"]) } }),
  "field.select": desc("field", "selection", "none", { layerId: target("string"), fieldId: target("string") }),
  "field.add": desc("layer", "content", "recipe", { layerId: target("string") }),
  "field.remove": desc("field", "content", "recipe", { layerId: target("string"), fieldId: target("string") }),
  "field.clear": desc("field", "content", "recipe", { layerId: target("string"), fieldId: target("string") }),
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
  "layer.setSymmetry": desc("layer", "content", "recipe", { layerId: target("string"), symmetry: input("boolean") }),
  "layer.setFinish": desc("layer", "content", "recipe", { layerId: target("string"), finish: enumerated(["matte", "regular", "satin", "metallic", "shimmer", "glitter", "glossy", "iridescent"]) }),
  "glitter.selectModel": desc("layer", "content", "recipe", { layerId: target("string"), model: enumerated(["classic", "irregular", "direct", "clustered", "fine"]) }),
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
  "layer.edit": desc(["layer", "collection"], "content", "recipe", { command: input("object") }, {
    add: {}, duplicate: { id: target("string") }, remove: { id: target("string") },
    reset: { id: target("string") }, rename: { id: target("string"), name: inputText(1, 80) },
    move: { id: target("string"), to: input("integer", 0) } }),
  "layer.setEnabled": desc("layer", "content", "recipe", { id: target("string"), enabled: input("boolean") }),
  "preset.edit": desc(["preset", "collection"], "library", "none", { command: input("object") }, {
    add: {}, copy: { id: target("string") }, remove: { id: target("string") },
    restore: {}, rename: { id: target("string"), name: inputText(1, 120) },
    move: { id: target("string"), to: input("integer", 0) } }, { remove: "recovery", restore: "recovery" }),
  "preset.select": desc("preset", "selection", "none", { id: target("string") }),
  "preset.expand": desc("preset", "workspace", "none", { expanded: input("boolean") }),
  "collection.rename": desc("collection", "library", "none", { name: input("string") }),
  "collection.filesOpen": desc("collection", "workspace", "none", { open: input("boolean") }),
  "collection.open": desc("collection", "library", "recovery", { collection: input("object"), revision: { ...state("integer"), required: false } }),
  "collection.undoOpen": desc("collection", "library", "recovery"),
  "collection.importRecipe": desc("file", "library", "none", { recipe: input("object"), name: input("string") }),
  "camera.front": desc("viewport", "workspace", "none"),
  "camera.setFov": desc("viewport", "workspace", "none", { degrees: input("number", 10, 90) }),
  "camera.endFovGesture": desc("viewport", "workspace", "none"),
  "camera.restore": desc("viewport", "workspace", "none", { camera: input("object") }),
  "preview.setExposure": desc("viewport", "workspace", "none", { value: input("number", .5, 2) }),
  "preview.setKeyAngle": desc("viewport", "workspace", "none", { degrees: input("number", 0, 360) }),
  "preview.setEyeShape": desc("viewport", "workspace", "none", { index: input("integer", 0, 21) }),
  "preview.setPiercingPreview": desc("viewport", "workspace", "none", { style: input("string"), definition: input("string") }),
  "preview.setPiercings": desc("viewport", "workspace", "none", { enabled: input("boolean") }),
  "preview.setSurfaceControls": desc("viewport", "workspace", "none", { enabled: input("boolean") }),
  "preview.setWire": desc("viewport", "workspace", "none", { enabled: input("boolean") }),
  "preview.setNormals": desc("viewport", "workspace", "none", { enabled: input("boolean") }),
  "preview.setEyeOptics": desc("viewport", "workspace", "none", { enabled: input("boolean") }),
  "preview.setHair": desc("viewport", "workspace", "none", { enabled: input("boolean") }),
  "preview.setDetail": desc("viewport", "workspace", "none", { detail: enumerated(["brows", "lashes"]), enabled: input("boolean") }),
  "motion.setIdle": desc("viewport", "workspace", "none", { enabled: input("boolean") }),
  "motion.setPaused": desc("viewport", "workspace", "none", { paused: input("boolean") }),
  "motion.setContributions": desc("viewport", "workspace", "none", { body: input("boolean"), face: input("boolean") }),
  "motion.setBlink": desc("viewport", "workspace", "none", { value: input("number", 0, 1) }),
  "motion.playBlink": desc("viewport", "workspace", "none", { playing: input("boolean") }),
  "quality.set": desc("viewport", "workspace", "none", { size: enumerated([512, 1024, 2048, 4096]) }),
  "quality.rebuild": desc("viewport", "workspace", "none"),
  "savedV.load": desc("file", "file", "none", { bytes: input("bytes", 0, 128 * 1024 * 1024) }),
  "savedV.restore": desc("file", "workspace", "none", { value: input("object") }),
} satisfies Record<StudioAction["kind"], ActionDescriptor>;

const request = (scope: ActionScope | readonly ActionScope[], effect: RequestDescriptor["effect"],
  payload: PayloadSchema = {}): RequestDescriptor => ({ scope: typeof scope === "string" ? [scope] : scope,
    effect, payload, async: true, cancellable: false });
export const REQUEST_DESCRIPTORS = {
  initialize: request("collection", "read"), refresh: request("collection", "read"),
  open: request("collection", "read", { id: target("string") }),
  save: request("collection", "save"), saveCopy: request("collection", "save"),
  exportCollection: request("collection", "download"), exportPlan: request("collection", "download"),
  import: request("file", "import", { text: input("string"), bytes: input("integer", 0, 16_000_000) }),
  package: request("collection", "package", { action: enumerated(["check", "build"]) }),
} satisfies Record<CollectionRequest["kind"], RequestDescriptor>;

/** Gesture payloads are proposals inside one opaque session, not standalone commands. */
export const GESTURE_DESCRIPTORS = {
  "shape.replace": desc("layer", "content", "transaction", { next: input("object") }),
  "point.replace": desc("point", "content", "transaction", { index: target("integer"), next: input("object") }),
  "field.replace": desc("field", "content", "transaction", { fieldId: target("string"), next: input("object") }),
  "path.replacePoints": desc("layer", "content", "transaction", { points: input("object") }),
} satisfies Record<StudioGestureProposal["kind"], ActionDescriptor>;
