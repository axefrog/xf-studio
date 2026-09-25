import type { CollectionRequest } from "./collection-service";
import { FINISH_IDS, LEGACY_FINISH_ALIASES } from "./finish-catalogue";
import { CONE_READINGS, CREATOR_EXPOSURE_RANGE, CREATOR_PAGE_DISTANCE, INTENSITY_FORMS, LIGHTING_PRESETS } from "./creator-lighting";
import type { InstallDetectionAction } from "./install-detection-actions";
import type { PreviewAction } from "./preview-preparation";
import type { PreviewSetupAction } from "./preview-setup";
import type { WolvenKitSetupAction } from "./wolvenkit-setup";
import type { StudioAction, StudioGestureProposal, StudioTarget } from "./studio-application";
import type { StudioFileAction } from "./studio-file-operations";

/** `host` actions read this computer's configuration (e.g. installed launchers); they never touch a recipe. */
export type ActionScope = StudioTarget["kind"] | "file" | "host";
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
  effect: "read" | "save" | "download" | "import" | "package" | "derive" | "install-tool"; async: true;
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
  "recipe.redo": desc("workspace", "content", "none"),
  "history.jumpTo": desc("workspace", "content", "none", { entryId: input("string") }),
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
  "layer.setFinish": desc("layer", "content", "recipe", { layerId: target("string"), finish: enumerated([...FINISH_IDS, ...LEGACY_FINISH_ALIASES]) }),
  "layer.useGameOptics": desc("layer", "content", "recipe", { layerId: target("string") }),
  "layer.setShift": desc("layer", "content", "transaction", { layerId: target("string"), key: enumerated(["color", "strength"]), value: input("number|string") }, {
    color: { value: inputText(7, 7) }, strength: { value: input("number", 0, 1) } }),
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
  "point.move": desc("point", "content", "recipe", { layerId: target("string"), index: target("integer"), u: input("number", 0, 1), v: input("number", 0, 1) }),
  "point.insert": desc("layer", "content", "recipe", { layerId: target("string"), u: input("number", 0, 1), v: input("number", 0, 1) }),
  "point.setTangent": desc("point", "content", "recipe", { layerId: target("string"), index: target("integer"),
    side: enumerated(["in", "out"]), du: input("number", -1, 1), dv: input("number", -1, 1) }),
  "shape.transform": desc("layer", "content", "recipe", { layerId: target("string"), command: input("object"),
    pivotIndex: { type: "integer", required: false, from: "state", min: 0 } }, {
    translate: { du: input("number", -1, 1), dv: input("number", -1, 1) }, rotate: { radians: input("number") },
    scale: { factor: input("number", .01, 100) } }),
  "field.setOrigin": desc("field", "content", "recipe", { layerId: target("string"), fieldId: target("string"), u: input("number", 0, 1), v: input("number", 0, 1) }),
  "field.setVector": desc("field", "content", "recipe", { layerId: target("string"), fieldId: target("string"), du: input("number", -.1, .1), dv: input("number", -.1, .1) }),
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
  "collection.rename": desc("collection", "library", "none", { name: input("string") }),
  "collection.open": desc("collection", "library", "recovery", { collection: input("object"), revision: { ...state("integer"), required: false } }),
  "collection.undoOpen": desc("collection", "library", "recovery"),
  "collection.importRecipe": desc("file", "library", "none", { recipe: input("object"), name: input("string") }),
  "camera.front": desc("viewport", "workspace", "none"),
  "camera.setFov": desc("viewport", "workspace", "none", { degrees: input("number", 10, 90) }),
  "camera.endFovGesture": desc("viewport", "workspace", "none"),
  "camera.restore": desc("viewport", "workspace", "none", { camera: input("object") }),
  "camera.navigate": desc("viewport", "workspace", "none", { command: input("object") }, {
    orbit: { yaw: input("number"), pitch: input("number") }, dolly: { factor: input("number", .01, 100) },
    pan: { dx: input("number", -10, 10), dy: input("number", -10, 10) } }),
  "camera.creatorFraming": desc("viewport", "workspace", "none", { page: enumerated(Object.keys(CREATOR_PAGE_DISTANCE)) }),
  "preview.setLightingPreset": desc("viewport", "workspace", "none", { preset: enumerated(LIGHTING_PRESETS) }),
  "preview.setCreatorLighting": desc("viewport", "workspace", "none", { key: enumerated(["intensity", "cone", "exposure"]), value: input("number|string") }, {
    intensity: { value: enumerated(INTENSITY_FORMS) }, cone: { value: enumerated(CONE_READINGS) },
    exposure: { value: input("number", CREATOR_EXPOSURE_RANGE.min, CREATOR_EXPOSURE_RANGE.max) } }),
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
  payload: PayloadSchema = {}, cancellable = false): RequestDescriptor => ({ scope: typeof scope === "string" ? [scope] : scope,
    effect, payload, async: true, cancellable });
export const REQUEST_DESCRIPTORS = {
  initialize: request("collection", "read"), refresh: request("collection", "read"),
  open: request("collection", "read", { id: target("string") }),
  save: request("collection", "save"), saveCopy: request("collection", "save"),
  exportCollection: request("collection", "download"), exportPlan: request("collection", "download"),
  import: request("file", "import", { text: input("string"), bytes: input("integer", 0, 16_000_000) }),
  package: request("collection", "package", { action: enumerated(["check", "build"]) }),
} satisfies Record<CollectionRequest["kind"], RequestDescriptor>;

/** Read-only host detection. Results are private host metadata (absolute paths) for a setup view to
 * offer as choices; saving a choice goes through the separate local setup actions. */
export const DETECTION_DESCRIPTORS = {
  "detect.gameInstalls": request("host", "read"),
  "detect.mo2Instances": request("host", "read"),
  "detect.frameworkVersions": request("host", "read"),
} satisfies Record<InstallDetectionAction["kind"], RequestDescriptor>;

/** Gesture payloads are proposals inside one opaque session, not standalone commands. */
export const GESTURE_DESCRIPTORS = {
  "shape.replace": desc("layer", "content", "transaction", { next: input("object") }),
  "point.replace": desc("point", "content", "transaction", { index: target("integer"), next: input("object") }),
  "field.replace": desc("field", "content", "transaction", { fieldId: target("string"), next: input("object") }),
  "path.replacePoints": desc("layer", "content", "transaction", { points: input("object") }),
} satisfies Record<StudioGestureProposal["kind"], ActionDescriptor>;

/**
 * File workflows (`StudioFileOperations`). Each runs asynchronously through a device
 * port; `device` names the browser mechanism it needs, `savesFirst` marks exports that
 * write a SQLite revision before downloading, and `recovery` marks draft switches that
 * the collection recovery queue can undo. None records a recipe Undo entry.
 */
export type FileDescriptor = { scope: readonly ActionScope[];
  effect: "import" | "download" | "package" | "recover"; device: "picker" | "download" | "none";
  async: true; cancellable: false; savesFirst: boolean; undo: UndoPolicy };
const file = (scope: ActionScope | readonly ActionScope[], effect: FileDescriptor["effect"],
  device: FileDescriptor["device"], options: { savesFirst?: boolean; undo?: UndoPolicy } = {}): FileDescriptor =>
  ({ scope: typeof scope === "string" ? [scope] : scope, effect, device, async: true, cancellable: false,
    savesFirst: options.savesFirst ?? false, undo: options.undo ?? "none" });
export const FILE_DESCRIPTORS = {
  "recipe.import": file(["file", "collection"], "import", "picker"),
  "recipe.export": file(["file", "layer"], "download", "download"),
  "mask.export": file(["file", "layer"], "download", "download"),
  "savedV.import": file("file", "import", "picker"),
  "savedV.export": file("file", "download", "download"),
  "collection.import": file(["file", "collection"], "import", "picker", { undo: "recovery" }),
  "collection.export": file("collection", "download", "download", { savesFirst: true }),
  "collection.plan": file("collection", "download", "download", { savesFirst: true }),
  "package.check": file("collection", "package", "none"),
  "package.build": file("collection", "package", "none"),
  "collection.recover": file("collection", "recover", "none", { undo: "recovery" }),
} satisfies Record<StudioFileAction["kind"], FileDescriptor>;

/** One flat index over every family, for palettes, scripts and documentation checks. */
export type RegistryEntry = { id: string; family: "action" | "request" | "gesture" | "file";
  scope: readonly ActionScope[]; undo: UndoPolicy; async: boolean };
export function actionRegistry(): RegistryEntry[] {
  return [
    ...Object.entries(ACTION_DESCRIPTORS).map(([id, d]) => ({ id, family: "action" as const, scope: d.scope, undo: d.undo, async: false })),
    ...Object.entries(REQUEST_DESCRIPTORS).map(([id, d]) => ({ id, family: "request" as const, scope: d.scope, undo: "none" as const, async: true })),
    ...Object.entries(GESTURE_DESCRIPTORS).map(([id, d]) => ({ id, family: "gesture" as const, scope: d.scope, undo: d.undo, async: false })),
    ...Object.entries(FILE_DESCRIPTORS).map(([id, d]) => ({ id, family: "file" as const, scope: d.scope, undo: d.undo, async: true })),
  ].map(entry => structuredClone(entry));
}

/** Deriving the 3D preview from the player's own game files. The host owns every path; the browser sends only the action. */
export const PREVIEW_PREPARATION_DESCRIPTORS = {
  "preview.refresh": request("host", "read"),
  "preview.prepare": request("host", "derive", {}, true),
  "preview.cancel": request("host", "derive"),
  "preview.rebuild": request("host", "derive", {}, true),
} satisfies Record<PreviewAction["kind"], RequestDescriptor>;

/**
 * WolvenKit CLI setup. `wolvenkit.install` is the person's consent to download exactly the pinned
 * release they were shown (its version is the only payload); the host supplies the URL, hash and folder.
 */
export const WOLVENKIT_DESCRIPTORS = {
  "wolvenkit.refresh": request("host", "read"),
  "wolvenkit.install": request("host", "install-tool", { version: input("string") }, true),
  "wolvenkit.cancel": request("host", "install-tool"),
  "wolvenkit.recheck": request("host", "read"),
} satisfies Record<WolvenKitSetupAction["kind"], RequestDescriptor>;

/**
 * The 3D preview setup the presentation drives (`StudioPresentationPort.previewSetup`): what the
 * setup card, the WolvenKit consent and the head pane offer. `view` actions only change what is
 * shown; the others ask the host (through the preparation, WolvenKit and settings ports above) or
 * load the head. None changes a recipe or has Undo.
 */
export type PreviewSetupDescriptor = { scope: readonly ActionScope[]; payload: PayloadSchema;
  effect: "view" | "read" | "derive" | "install-tool" | "settings" | "link" | "head"; async: boolean; cancellable: boolean };
const setupAction = (effect: PreviewSetupDescriptor["effect"], payload: PayloadSchema = {}, cancellable = false): PreviewSetupDescriptor =>
  ({ scope: ["host"], payload, effect, async: effect !== "view", cancellable });
export const PREVIEW_SETUP_DESCRIPTORS = {
  "previewSetup.show": setupAction("view"),
  "previewSetup.dismiss": setupAction("view"),
  "previewSetup.consent": setupAction("view"),
  "previewSetup.consentClose": setupAction("view"),
  "previewSetup.openSetup": setupAction("view"),
  "previewSetup.refresh": setupAction("read"),
  "previewSetup.openLink": setupAction("link", { link: enumerated(["wolvenkit-licence", "wolvenkit-release", "runtime-installer", "runtime-page"]) }),
  "previewSetup.prepare": setupAction("derive", {}, true),
  "previewSetup.cancel": setupAction("derive"),
  "previewSetup.prepareAgain": setupAction("derive", {}, true),
  "previewSetup.useDetectedGame": setupAction("settings"),
  "previewSetup.installWolvenKit": setupAction("install-tool", { version: input("string") }, true),
  "previewSetup.cancelDownload": setupAction("install-tool"),
  "previewSetup.useDetectedWolvenKit": setupAction("settings"),
  "previewSetup.recheckRuntime": setupAction("read"),
  "previewSetup.retryHead": setupAction("head"),
} satisfies Record<PreviewSetupAction["kind"], PreviewSetupDescriptor>;
