import type { CollectionRequest } from "./collection-service";
import { CONE_READINGS, CREATOR_EXPOSURE_RANGE, CREATOR_PAGE_DISTANCE, INTENSITY_FORMS, LIGHTING_PRESETS } from "./creator-lighting";
import type { InstallDetectionAction } from "./install-detection-actions";
import type { DesktopAppAction } from "./desktop-app";
import type { ModInstallAction } from "./mod-install-actions";
import type { PoseAction } from "./pose-actions";
import { STUDIO_KEY_ANGLE_RANGE } from "./studio-lighting";
import { HAIR_LOOK_RANGE } from "./preview-view-graph";
import { LIGHT_NUMBER_KEYS, LIGHT_RANGES, LIGHT_TYPES, LIGHTING_LIMITS, SETUP_BACKDROPS, SETUP_DISPLAYS, SETUP_ENVIRONMENT_RANGE } from "./lighting-setups";
import type { PreviewAction } from "./preview-preparation";
import type { PreviewSetupAction } from "./preview-setup";
import type { WolvenKitSetupAction } from "./wolvenkit-setup";
import type { StudioAction, StudioGestureProposal, StudioTarget } from "./studio-application";
import type { ActionDescriptor as PlatformActionDescriptor, PayloadSchema, UndoPolicy, ValueSchema } from "./platform/api";
import type { StudioFileAction } from "./studio-file-operations";
import type { PartPresetRequest } from "./part-presets";
import { CHARACTER_CONTEXT_DESCRIPTORS } from "./character-context";
import { describe, enumerated, input, inputText, state, target } from "./action-descriptor-kit";
import { EYE_MAKEUP_DESCRIPTORS, EYE_MAKEUP_GESTURE_DESCRIPTORS } from "./eye-makeup-descriptors";

/** `host` actions read this computer's configuration (e.g. installed launchers); they never touch a recipe. */
export type ActionScope = StudioTarget["kind"] | "file" | "host";
// The descriptor shape is the platform's (feature-module platform §1); this table fixes its scopes.
export type { PayloadSchema, UndoPolicy, ValueSchema } from "./platform/api";
export type ActionDescriptor = PlatformActionDescriptor<ActionScope>;
export type RequestDescriptor = { scope: readonly ActionScope[]; payload: PayloadSchema;
  effect: "read" | "save" | "download" | "import" | "package" | "derive" | "install-tool" | "install-mod" | "reveal" | "launch"; async: true;
  cancellable: boolean };

const desc = (scope: ActionScope | readonly ActionScope[], effect: ActionDescriptor["effect"], undo: UndoPolicy,
  payload: PayloadSchema = {}, variants?: Record<string, PayloadSchema>, variantUndo?: Record<string, UndoPolicy>): ActionDescriptor =>
  describe<ActionScope>(scope, effect, undo, payload, variants, variantUndo);

/**
 * A camera, preview or motion action: it may name the view it acts on (view-graph-design.md §3.8); without one it acts on the
 * focused view. Optional, so every existing caller is unchanged.
 */
const inView: typeof desc = (...args) => { const d = desc(...args); return { ...d, payload: { ...d.payload, view: { type: "string", required: false, from: "target" } } }; };

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
  "camera.front": inView("viewport", "workspace", "none"),
  "camera.body": inView("viewport", "workspace", "none"),
  "camera.setFov": inView("viewport", "workspace", "none", { degrees: input("number", 10, 90) }),
  "camera.endFovGesture": inView("viewport", "workspace", "none"),
  "camera.restore": inView("viewport", "workspace", "none", { camera: input("object") }),
  "camera.navigate": inView("viewport", "workspace", "none", { command: input("object") }, {
    orbit: { yaw: input("number"), pitch: input("number") }, dolly: { factor: input("number", .01, 100) },
    pan: { dx: input("number", -10, 10), dy: input("number", -10, 10) } }),
  // The camera's Back/Forward trail (view-graph-design.md §3.6): where it was before its last jump.
  "camera.back": inView("viewport", "workspace", "none"),
  "camera.forward": inView("viewport", "workspace", "none"),
  "camera.creatorFraming": inView("viewport", "workspace", "none", { page: enumerated(Object.keys(CREATOR_PAGE_DISTANCE)) }),
  "preview.setLightingPreset": inView("viewport", "workspace", "none", { preset: enumerated(LIGHTING_PRESETS) }),
  "preview.setCreatorLighting": inView("viewport", "workspace", "none", { key: enumerated(["intensity", "cone", "exposure"]), value: input("number|string") }, {
    intensity: { value: enumerated(INTENSITY_FORMS) }, cone: { value: enumerated(CONE_READINGS) },
    exposure: { value: input("number", CREATOR_EXPOSURE_RANGE.min, CREATOR_EXPOSURE_RANGE.max) } }),
  "preview.resetCreatorLighting": inView("viewport", "workspace", "none"),
  "preview.setCreatorShadows": inView("viewport", "workspace", "none", { enabled: input("boolean") }),
  // Lighting setups (lighting-setups.ts): one flat list; a change to a built-in's values forks it into a setup of the person's own.
  // All are workspace view state in the View and lighting history, never look Undo.
  "preview.selectLightingSetup": inView("viewport", "workspace", "none", { setup: target("string") }),
  "preview.createLightingSetup": inView("viewport", "workspace", "none", { from: target("string") }),
  "preview.renameLightingSetup": inView("viewport", "workspace", "none", { setup: target("string"), name: inputText(1, LIGHTING_LIMITS.name) }),
  "preview.deleteLightingSetup": inView("viewport", "workspace", "none", { setup: target("string") }),
  "preview.resetLightingSetup": inView("viewport", "workspace", "none", { setup: target("string") }),
  // Exposure's range follows the shown setup's display: ACES 0.125–8, the game's k 0.01–20.
  "preview.setExposure": inView("viewport", "workspace", "none", { value: input("number", CREATOR_EXPOSURE_RANGE.min, CREATOR_EXPOSURE_RANGE.max) }),
  "preview.setRoomLight": inView("viewport", "workspace", "none", { value: input("number", SETUP_ENVIRONMENT_RANGE.min, SETUP_ENVIRONMENT_RANGE.max) }),
  "preview.setBackdrop": inView("viewport", "workspace", "none", { backdrop: enumerated(SETUP_BACKDROPS) }),
  "preview.setDisplayTransform": inView("viewport", "workspace", "none", { display: enumerated(SETUP_DISPLAYS) }),
  "preview.setLight": inView("viewport", "workspace", "none", { light: target("string"), key: enumerated(LIGHT_NUMBER_KEYS), value: input("number") },
    Object.fromEntries(LIGHT_NUMBER_KEYS.map(key => [key, { value: input("number", LIGHT_RANGES[key].min, LIGHT_RANGES[key].max) }]))),
  "preview.setLightColour": inView("viewport", "workspace", "none", { light: target("string"), colour: input("string") }),
  "preview.setLightShadows": inView("viewport", "workspace", "none", { light: target("string"), enabled: input("boolean") }),
  "preview.setLightType": inView("viewport", "workspace", "none", { light: target("string"), type: enumerated(LIGHT_TYPES) }),
  "preview.renameLight": inView("viewport", "workspace", "none", { light: target("string"), name: inputText(1, LIGHTING_LIMITS.name) }),
  "preview.aimLightAtHead": inView("viewport", "workspace", "none", { light: target("string") }),
  "preview.addLight": inView("viewport", "workspace", "none", { type: enumerated(LIGHT_TYPES) }),
  "preview.removeLight": inView("viewport", "workspace", "none", { light: target("string") }),
  "preview.moveLight": inView("viewport", "workspace", "none", { light: target("string"), index: input("integer", 0, LIGHTING_LIMITS.lights - 1) }),
  "preview.duplicateLight": inView("viewport", "workspace", "none", { light: target("string") }),
  "preview.setKeyAngle": inView("viewport", "workspace", "none", { degrees: input("number", STUDIO_KEY_ANGLE_RANGE.min, STUDIO_KEY_ANGLE_RANGE.max) }),
  "preview.setEyeShape": inView("viewport", "workspace", "none", { index: input("integer", 0, 21) }),
  "preview.setPiercings": inView("viewport", "workspace", "none", { enabled: input("boolean") }),
  "preview.setBody": inView("viewport", "workspace", "none", { enabled: input("boolean") }),
  "preview.setUncensored": inView("viewport", "workspace", "none", { enabled: input("boolean") }),
  "preview.setSurfaceControls": inView("viewport", "workspace", "none", { enabled: input("boolean") }),
  "preview.setWire": inView("viewport", "workspace", "none", { enabled: input("boolean") }),
  "preview.setNormals": inView("viewport", "workspace", "none", { enabled: input("boolean") }),
  "preview.setEyeOptics": inView("viewport", "workspace", "none", { enabled: input("boolean") }),
  "preview.setHair": inView("viewport", "workspace", "none", { enabled: input("boolean") }),
  "preview.setDetail": inView("viewport", "workspace", "none", { detail: enumerated(["brows", "lashes"]), enabled: input("boolean") }),
  // The Rendering options: how the view draws (its display node), workspace view state in the View and lighting history, never the looks.
  "preview.setSkinScatter": inView("viewport", "workspace", "none", { enabled: input("boolean") }),
  "preview.setFaceShadows": inView("viewport", "workspace", "none", { enabled: input("boolean") }),
  "preview.setHairLook": inView("viewport", "workspace", "none", { value: input("number", HAIR_LOOK_RANGE.min, HAIR_LOOK_RANGE.max) }),
  "motion.setIdle": inView("viewport", "workspace", "none", { enabled: input("boolean") }),
  "motion.setIdleClip": inView("viewport", "workspace", "none", { clip: inputText(1, 40) }),
  "motion.setPaused": inView("viewport", "workspace", "none", { paused: input("boolean") }),
  "motion.setContributions": inView("viewport", "workspace", "none", { body: input("boolean"), face: input("boolean") }),
  "motion.setBlink": inView("viewport", "workspace", "none", { value: input("number", 0, 1) }),
  "motion.playBlink": inView("viewport", "workspace", "none", { playing: input("boolean") }),
  "motion.setPhysics": inView("viewport", "workspace", "none", { enabled: input("boolean") }),
  "quality.set": desc("viewport", "workspace", "none", { size: enumerated([512, 1024, 2048, 4096]) }),
  "quality.rebuild": desc("viewport", "workspace", "none"),
  "savedV.load": desc("file", "file", "none", { bytes: input("bytes", 0, 128 * 1024 * 1024) }),
  "savedV.restore": desc("file", "workspace", "none", { value: input("object") }),
  "savedV.clear": desc("viewport", "workspace", "none"),
  // The character context's family (character-context.ts): creator choices record their own history, never a look's.
  ...CHARACTER_CONTEXT_DESCRIPTORS,
  // The views family (view-actions.ts): view tools in a view's tools node, and the View and lighting history (never a look's).
  "view.setTool": desc("viewport", "workspace", "none", { view: { type: "string", required: false, from: "target" }, tool: target("string"),
    enabled: input("boolean") }),
  "view.undo": desc("workspace", "workspace", "none"),
  "view.redo": desc("workspace", "workspace", "none"),
  // A released slider: the next light or display change starts a new View and lighting step (CORE-95).
  "view.endEdit": desc("workspace", "workspace", "none"),
} satisfies Record<StudioAction["kind"], ActionDescriptor>;

const request = (scope: ActionScope | readonly ActionScope[], effect: RequestDescriptor["effect"],
  payload: PayloadSchema = {}, cancellable = false): RequestDescriptor => ({ scope: typeof scope === "string" ? [scope] : scope,
    effect, payload, async: true, cancellable });
/**
 * The `presets` family (part-presets.ts): a feature's part saved in the library under a name, for favourites and start points. Its rows
 * live in their own table (part-preset-store.ts), which the released 0.1.0-alpha.1 never reads.
 */
export const PART_PRESET_DESCRIPTORS = {
  "partPreset.list": request("workspace", "read", { feature: target("string") }),
  "partPreset.save": request("workspace", "save", { feature: target("string"), name: inputText(1, 120), part: state("object") }),
  "partPreset.rename": request("workspace", "save", { feature: target("string"), id: target("string"), name: inputText(1, 120),
    revision: state("integer") }),
  "partPreset.delete": request("workspace", "save", { feature: target("string"), id: target("string"), revision: state("integer") }),
} satisfies Record<PartPresetRequest["kind"], RequestDescriptor>;
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
 * "Get the desktop app" on localhost (`StudioPresentationPort.desktopApp`; the desktop app has none). `refresh` reads whether the
 * app is installed, whether this checkout built a setup program and whether a release exists. `install` is the person's consent
 * to run the setup they were shown, named by its `installer` ID (the host refuses one that changed); `open` starts the installed
 * app. The host decides every path; none changes a recipe, the library or Undo.
 */
export const DESKTOP_APP_DESCRIPTORS = {
  "desktopApp.refresh": request("host", "read"),
  "desktopApp.install": request("host", "launch", { installer: target("string") }),
  "desktopApp.open": request("host", "launch"),
} satisfies Record<DesktopAppAction["kind"], RequestDescriptor>;

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

/**
 * The photo-mode pose catalogue (pose-library-design.md §7; `PoseActions`, for the Poses panel to come). All read the host's own game
 * files on its own launch route: the catalogue for a body gender, one pose's sampled clip, and Try again. None changes a recipe, the
 * library, the workspace or Undo.
 */
export const POSE_DESCRIPTORS = {
  "poses.load": request("host", "read", { bodyGender: enumerated(["female", "male"], "state") }),
  "poses.sample": request("host", "read", { bodyGender: enumerated(["female", "male"], "state"), id: target("string") }),
  "poses.retry": request("host", "read", { bodyGender: enumerated(["female", "male"], "state") }),
} satisfies Record<PoseAction["kind"], RequestDescriptor>;

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
