import type { CollectionRequest } from "./collection-service";
import { CONE_READINGS, CREATOR_EXPOSURE_RANGE, CREATOR_PAGE_DISTANCE, INTENSITY_FORMS, LIGHTING_PRESETS } from "./creator-lighting";
import type { InstallDetectionAction } from "./install-detection-actions";
import type { ModInstallAction } from "./mod-install-actions";
import { STUDIO_EXPOSURE_RANGE, STUDIO_KEY_ANGLE_RANGE, STUDIO_LIGHT_KEYS, STUDIO_LIGHT_RANGES, STUDIO_SETUP_IDS } from "./studio-lighting";
import type { PreviewAction } from "./preview-preparation";
import type { PreviewSetupAction } from "./preview-setup";
import type { WolvenKitSetupAction } from "./wolvenkit-setup";
import type { StudioAction, StudioGestureProposal, StudioTarget } from "./studio-application";
import type { ActionDescriptor as PlatformActionDescriptor, PayloadSchema, UndoPolicy, ValueSchema } from "./platform/api";
import type { StudioFileAction } from "./studio-file-operations";
import { CHARACTER_CONTEXT_DESCRIPTORS } from "./character-context";
import { describe, enumerated, input, inputText, state, target } from "./action-descriptor-kit";
import { EYE_MAKEUP_DESCRIPTORS, EYE_MAKEUP_GESTURE_DESCRIPTORS } from "./eye-makeup-descriptors";

/** `host` actions read this computer's configuration (e.g. installed launchers); they never touch a recipe. */
export type ActionScope = StudioTarget["kind"] | "file" | "host";
// The descriptor shape is the platform's (feature-module platform §1); this table fixes its scopes.
export type { PayloadSchema, UndoPolicy, ValueSchema } from "./platform/api";
export type ActionDescriptor = PlatformActionDescriptor<ActionScope>;
export type RequestDescriptor = { scope: readonly ActionScope[]; payload: PayloadSchema;
  effect: "read" | "save" | "download" | "import" | "package" | "derive" | "install-tool" | "install-mod" | "reveal"; async: true;
  cancellable: boolean };

const desc = (scope: ActionScope | readonly ActionScope[], effect: ActionDescriptor["effect"], undo: UndoPolicy,
  payload: PayloadSchema = {}, variants?: Record<string, PayloadSchema>, variantUndo?: Record<string, UndoPolicy>): ActionDescriptor =>
  describe<ActionScope>(scope, effect, undo, payload, variants, variantUndo);

/** Every public top-level action ID is covered at compile time; nested commands have named variants. */
export const ACTION_DESCRIPTORS = {
  "history.undo": desc("workspace", "content", "none"),
  "history.redo": desc("workspace", "content", "none"),
  "history.jumpTo": desc("workspace", "content", "none", { entryId: input("string") }),
  // Eye makeup's actions, in catalogue order (eye-makeup-descriptors.ts).
  ...EYE_MAKEUP_DESCRIPTORS,
  "preset.edit": desc(["preset", "collection"], "library", "none", { command: input("object") }, {
    add: {}, copy: { id: target("string") }, remove: { id: target("string") },
    restore: {}, rename: { id: target("string"), name: inputText(1, 120) },
    move: { id: target("string"), to: input("integer", 0) } }, { remove: "recovery", restore: "recovery" }),
  "preset.select": desc("preset", "selection", "none", { id: target("string") }),
  "collection.rename": desc("collection", "library", "none", { name: input("string") }),
  "collection.open": desc("collection", "library", "recovery", { collection: input("object"), revision: { ...state("integer"), required: false } }),
  "collection.undoOpen": desc("collection", "library", "recovery"),
  "collection.importRecipe": desc("file", "library", "none", { recipe: input("object"), name: input("string") }),
  // The package plan (feature-module platform §6): which features ship in which XF mod; stored with the collection.
  "package.rename": desc("collection", "library", "none", { productId: target("string"), modName: inputText(0, 80) }),
  "package.assign": desc("collection", "library", "none", { feature: target("string"), productId: target("string") }),
  "package.split": desc("collection", "library", "none", { feature: target("string"), newId: { ...state("string"), required: false } }),
  "package.merge": desc("collection", "library", "none", { productId: target("string"), intoId: target("string") }),
  "camera.front": desc("viewport", "workspace", "none"),
  "camera.body": desc("viewport", "workspace", "none"),
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
  "preview.resetCreatorLighting": desc("viewport", "workspace", "none"),
  "preview.setExposure": desc("viewport", "workspace", "none", { value: input("number", STUDIO_EXPOSURE_RANGE.min, STUDIO_EXPOSURE_RANGE.max) }),
  "preview.setKeyAngle": desc("viewport", "workspace", "none", { degrees: input("number", STUDIO_KEY_ANGLE_RANGE.min, STUDIO_KEY_ANGLE_RANGE.max) }),
  "preview.setStudioLight": desc("viewport", "workspace", "none", { key: enumerated(STUDIO_LIGHT_KEYS), value: input("number") },
    Object.fromEntries(STUDIO_LIGHT_KEYS.map(key => [key, { value: input("number", STUDIO_LIGHT_RANGES[key].min, STUDIO_LIGHT_RANGES[key].max) }]))),
  "preview.setStudioNeutral": desc("viewport", "workspace", "none", { enabled: input("boolean") }),
  "preview.applyStudioSetup": desc("viewport", "workspace", "none", { setup: enumerated(STUDIO_SETUP_IDS) }),
  "preview.resetStudioLighting": desc("viewport", "workspace", "none"),
  "preview.setEyeShape": desc("viewport", "workspace", "none", { index: input("integer", 0, 21) }),
  "preview.setPiercings": desc("viewport", "workspace", "none", { enabled: input("boolean") }),
  "preview.setBody": desc("viewport", "workspace", "none", { enabled: input("boolean") }),
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
  "savedV.clear": desc("viewport", "workspace", "none"),
  // The character context's family (character-context.ts): creator choices record their own history, never a look's.
  ...CHARACTER_CONTEXT_DESCRIPTORS,
} satisfies Record<StudioAction["kind"], ActionDescriptor>;

const request = (scope: ActionScope | readonly ActionScope[], effect: RequestDescriptor["effect"],
  payload: PayloadSchema = {}, cancellable = false): RequestDescriptor => ({ scope: typeof scope === "string" ? [scope] : scope,
    effect, payload, async: true, cancellable });
export const REQUEST_DESCRIPTORS = {
  initialize: request("collection", "read"), refresh: request("collection", "read"),
  open: request("collection", "read", { id: target("string") }),
  save: request("collection", "save"), saveCopy: request("collection", "save"),
  // `draft` exports an earlier draft in the recovery queue instead (CORE-49).
  exportCollection: request("collection", "download", { draft: { type: "string", required: false, from: "target" } }),
  exportPlan: request("collection", "download"),
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

/**
 * "Add to my mod manager" after Build (UI-82; `StudioPresentationPort.modInstall`). `review` reads the host's plan; `apply` is the
 * person's consent to that reviewed plan (the host refuses a plan that no longer matches); `reveal` opens the build's folder.
 * The product names a mod of the latest Build; the host decides every path. None changes a recipe, the library or Undo.
 */
export const MOD_INSTALL_DESCRIPTORS = {
  "modInstall.review": request("host", "read", { product: target("string") }),
  "modInstall.apply": request("host", "install-mod", { product: target("string") }),
  "modInstall.reveal": request("host", "reveal", { product: target("string") }),
} satisfies Record<ModInstallAction["kind"], RequestDescriptor>;

/** Gesture payloads are proposals inside one opaque session, not standalone commands (eye makeup's, eye-makeup-descriptors.ts). */
export const GESTURE_DESCRIPTORS = EYE_MAKEUP_GESTURE_DESCRIPTORS satisfies Record<StudioGestureProposal["kind"], ActionDescriptor>;

/**
 * File workflows (`StudioFileOperations`). Each runs asynchronously through a device
 * port; `device` names the browser mechanism it needs, `savesFirst` marks exports that
 * write a SQLite revision before downloading (whenever the library takes the collection; one
 * it refuses is exported unsaved, CORE-38), and `recovery` marks draft switches that
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
  "characterPreset.import": file("file", "import", "picker"),
  "characterPreset.export": file("file", "download", "download"),
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
/**
 * `actions` is the application's action registry (the union of every owner's table); the requests,
 * gesture proposals and file workflows come from the registered library and files families and the
 * live feature's gestures. Each defaults to this file's table.
 */
export function actionRegistry(actions: Readonly<Record<string, ActionDescriptor>> = ACTION_DESCRIPTORS,
  families: { requests?: Readonly<Record<string, { scope: readonly string[] }>>;
    gestures?: Readonly<Record<string, { scope: readonly string[]; undo: UndoPolicy }>>;
    files?: Readonly<Record<string, { scope: readonly string[]; undo?: UndoPolicy }>> } = {}): RegistryEntry[] {
  const { requests = REQUEST_DESCRIPTORS, gestures = GESTURE_DESCRIPTORS, files = FILE_DESCRIPTORS } = families;
  return [
    ...Object.entries(actions).map(([id, d]) => ({ id, family: "action" as const, scope: d.scope, undo: d.undo, async: false })),
    ...Object.entries(requests).map(([id, d]) => ({ id, family: "request" as const, scope: d.scope, undo: "none" as const, async: true })),
    ...Object.entries(gestures).map(([id, d]) => ({ id, family: "gesture" as const, scope: d.scope, undo: d.undo, async: false })),
    ...Object.entries(files).map(([id, d]) => ({ id, family: "file" as const, scope: d.scope, undo: d.undo ?? "none", async: true })),
  ].map(entry => structuredClone(entry)) as RegistryEntry[];
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
