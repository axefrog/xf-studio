import type { CameraState, PreviewState } from "./workspace-state";
import { MAIN_VIEW, type ViewGraphChange, type ViewId } from "./platform/api/view-graph";
import type { ViewGraph } from "./platform/core/view-graph";
import { createStudioViewGraph, EYE_SHAPE_RANGE, HAIR_LOOK_RANGE, LEGACY_TOOL_FIELDS, renderingOf, type RenderingOptions, previewFields, previewMirror, type DisplayState, type LightsState,
  type SceneState } from "./preview-view-graph";
import { navigateCamera, validNavigation, type CameraNavigation } from "./camera-navigation";
import type { DistanceLimits } from "./camera-framing";
import type { FaceMorphChoice } from "./face-morphs";
import { CONE_READINGS, CREATOR_EXPOSURE_RANGE, DEFAULT_CREATOR_LIGHTING, INTENSITY_FORMS, LIGHTING_PRESETS, type BodySex, type ConeReading,
  type CreatorCameraPage, type CreatorLightingOptions, type IntensityForm, type LightingPreset } from "./creator-lighting";
import type { GradingLutSource } from "./grading-lut";
import { refusal, type ReasonCode } from "./platform/api";
import { addLight, aimLightAtHead, duplicateLight, moveLight, BUILT_IN_SETUP_IDS, builtInInfo, colourHex, createSetup, deleteSetup, differsFromBase, editShownSetup,
  findUserSetup, isBuiltInSetup, LIGHT_NUMBER_KEYS, LIGHT_RANGES, LIGHT_TYPES, lightingSource, lightPlacement, LIGHTING_LIMITS, parseColourHex,
  removeLight, renameLight, renameSetup, resetSetup, rigKindOf, SETUP_BACKDROPS, SETUP_DISPLAYS, SETUP_ENVIRONMENT_RANGE,
  SETUP_EXPOSURE_RANGES, setLightColour, setLightNumber, setLightShadows, setLightType, setSetupDisplay, setupBase, setupDefinition,
  setupExists, setupLabel, shadowCasters, validSetupName, type BuiltInSetupId, type LightingSetup, type LightingSource, type LightNumberKey,
  type LightType, type SetupBackdrop, type SetupDisplay, type SetupLibrary } from "./lighting-setups";

export type PreviewConfig = Pick<PreviewState,
  "surface" | "wire" | "brows" | "lashes" | "hair" | "piercings" | "body" | "uncensored" | "physics" |
  "eyeShape" | "normals" | "eyeOwnRoughness" | "skinScatter" | "faceShadows" | "hairLook" | "exposure" | "lightAngle" | "lightingPreset" | "creatorLighting" | "studioLights" | "lightingSetups">;
/** Every camera and preview action may name the view it acts on; without one it acts on the focused view (design §3.8). */
export type PreviewAction = PreviewActionBody & { view?: ViewId };
type PreviewActionBody =
  | { kind: "camera.front" }
  | { kind: "camera.body" }
  | { kind: "camera.setFov"; degrees: number }
  | { kind: "camera.endFovGesture" }
  | { kind: "camera.restore"; camera: CameraState }
  | { kind: "camera.navigate"; command: CameraNavigation }
  | { kind: "camera.back" | "camera.forward" }
  | { kind: "camera.creatorFraming"; page: CreatorCameraPage }
  | { kind: "preview.setLightingPreset"; preset: LightingPreset }
  | { kind: "preview.setCreatorLighting"; key: "intensity"; value: IntensityForm }
  | { kind: "preview.setCreatorLighting"; key: "cone"; value: ConeReading }
  | { kind: "preview.setCreatorLighting"; key: "exposure"; value: number }
  | { kind: "preview.setCreatorShadows"; enabled: boolean }
  | { kind: "preview.resetCreatorLighting" }
  // Lighting setups (lighting-setups.ts). Every change to the shown setup's values forks a built-in first.
  | { kind: "preview.selectLightingSetup"; setup: string }
  | { kind: "preview.createLightingSetup"; from: string }
  | { kind: "preview.renameLightingSetup"; setup: string; name: string }
  | { kind: "preview.deleteLightingSetup"; setup: string }
  | { kind: "preview.resetLightingSetup"; setup: string }
  | { kind: "preview.setExposure"; value: number }
  | { kind: "preview.setRoomLight"; value: number }
  | { kind: "preview.setBackdrop"; backdrop: SetupBackdrop }
  | { kind: "preview.setDisplayTransform"; display: SetupDisplay }
  | { kind: "preview.setLight"; light: string; key: LightNumberKey; value: number }
  | { kind: "preview.setLightColour"; light: string; colour: string }
  | { kind: "preview.setLightShadows"; light: string; enabled: boolean }
  | { kind: "preview.setLightType"; light: string; type: LightType }
  | { kind: "preview.renameLight"; light: string; name: string }
  | { kind: "preview.aimLightAtHead"; light: string }
  | { kind: "preview.addLight"; type: LightType }
  | { kind: "preview.removeLight"; light: string }
  | { kind: "preview.moveLight"; light: string; index: number }
  | { kind: "preview.duplicateLight"; light: string }
  /** The key light's azimuth (the shown setup's `key` light, else its first directional light): scripts and evidence tools. */
  | { kind: "preview.setKeyAngle"; degrees: number }
  | { kind: "preview.setEyeShape"; index: number }
  | { kind: "preview.setPiercings"; enabled: boolean }
  | { kind: "preview.setBody"; enabled: boolean }
  | { kind: "preview.setUncensored"; enabled: boolean }
  | { kind: "preview.setSurfaceControls" | "preview.setWire" | "preview.setNormals" | "preview.setEyeOptics" | "preview.setHair"; enabled: boolean }
  | { kind: "preview.setDetail"; detail: "brows" | "lashes"; enabled: boolean }
  // The Rendering options (the Preview quality panel's Rendering group): how the view draws, in its display node; never the looks or the export.
  | { kind: "preview.setSkinScatter" | "preview.setFaceShadows"; enabled: boolean }
  /** The Hair look, 0 Crisp … 1 Game-like (hair-colour-model.ts `HAIR_LOOK`); a drag is one View and lighting step. */
  | { kind: "preview.setHairLook"; value: number };
export type PreviewActionResult = { limited?: boolean };
export type PreviewCapability = { available: boolean; reason?: string };
/** Eye-shape choices as the loaded head carries them, and whether the eyeballs follow them. */
export type EyeShapeOptions = { choices: FaceMorphChoice[]; eyesFollow: boolean; eyeSource: string | null };
/** The lighting device's read-only report: which rig is shown and where its colour grading came from. */
export type LightingStatus = { preset: LightingPreset; sex: BodySex; defaultExposure: number;
  lut: { phase: "idle" | "loading" | "ready"; source: GradingLutSource | null } };
/** One light as the editor shows it: placement about the setup's focus, the colour as sRGB hex, the cone in degrees. */
export type LightView = { id: string; name: string; type: LightType; azimuth: number; elevation: number; distance: number; colour: string;
  intensity: number; cone: number; softness: number; shadows: boolean };
/**
 * The lighting setups for the presentation (read-only; the setups themselves persist in the view graph's lights node): the one flat
 * list, built-in templates first, the shown setup, and the shown setup's values for its editor.
 */
export type LightingSetupsView = {
  active: string;
  setups: { id: string; label: string; title: string; builtIn: boolean; base: BuiltInSetupId; baseLabel: string; display: SetupDisplay }[];
  shown: { id: string; label: string; builtIn: boolean; baseLabel: string; resettable: boolean; display: SetupDisplay; backdrop: SetupBackdrop;
    environment: number; exposure: number; exposureRange: { min: number; max: number }; lights: LightView[]; shadowCasters: number };
};
/** Persisted workspace bounds before a head is loaded (the female creator's 22 choices). */
export const MAX_EYE_SHAPE_INDEX = EYE_SHAPE_RANGE.max;
export type PreviewPort = {
  cameraState(): CameraState; front(): boolean; setFov(degrees: number): boolean | undefined; endFovGesture(): void;
  restoreCamera(camera: CameraState): void;
  /** The view's orbit distance limits now (derived from its lens, aspect and scene: camera-framing.ts). Absent: the whole stored range. */
  distanceLimits?(): DistanceLimits;
  /**
   * Light the view by a setup (lighting-setup-stage.ts): a complete definition, or the built-in game rig, which the device resolves for
   * the body it shows. Absent on a preview without the lighting stage.
   */
  setLighting?(source: LightingSource): void;
  setSurfaceControls(enabled: boolean): void; setWire(enabled: boolean): void; setNormals(enabled: boolean): void;
  setEyeOptics(enabled: boolean): void; setHair(enabled: boolean): void;
  /** The Rendering options (scene-host.ts). Absent on a preview without the lighting stage or strands; the setting is still kept. */
  setSkinScatter?(enabled: boolean): void; setFaceShadows?(enabled: boolean): void; setHairLook?(value: number): void;
  setEyeShape(index: number): void; setPiercings(enabled: boolean): void;
  /** The scene's dangle simulation (hair-physics-plan.md §3.6). Absent on a preview without the idle's rig. */
  setPhysics?(enabled: boolean): void;
  /** The V's body (visibility preference) and the whole-body view (true when the lens is too narrow to fit it). Absent on a head-only preview. */
  setBody?(enabled: boolean): void; frameBody?(): boolean;
  eyeShapeOptions?(): EyeShapeOptions;
  setDetail(detail: "brows" | "lashes", enabled: boolean): void;
  availability?(target: "brows" | "lashes" | "hair"): string | undefined;
  creatorCamera?(page: CreatorCameraPage): CameraState;
  lightingStatus?(): LightingStatus;
  onLightingStatus?(listener: () => void): () => void;
};
const NO_CREATOR = "Creator lighting is unavailable in this preview.";
const NO_BODY = "This preview shows the head only.";
const NO_LIGHTING = "Lighting controls are unavailable in this preview.";
/** Actions that change the shown setup's values: on a built-in they fork it first. */
const SETUP_EDITS = new Set<PreviewAction["kind"]>(["preview.setExposure", "preview.setRoomLight", "preview.setBackdrop", "preview.setDisplayTransform",
  "preview.setLight", "preview.setLightColour", "preview.setLightShadows", "preview.setLightType", "preview.renameLight", "preview.aimLightAtHead",
  "preview.addLight", "preview.removeLight", "preview.moveLight", "preview.duplicateLight", "preview.setKeyAngle"]);
/** Actions that name one of the shown setup's lights. */
const LIGHT_ACTIONS = new Set<PreviewAction["kind"]>(["preview.setLight", "preview.setLightColour", "preview.setLightShadows", "preview.setLightType",
  "preview.renameLight", "preview.aimLightAtHead", "preview.removeLight", "preview.moveLight", "preview.duplicateLight"]);
const LIGHT_NUMBER_LABELS: Record<LightNumberKey, string> = { azimuth: "direction", elevation: "height", distance: "distance", intensity: "strength",
  cone: "cone", softness: "cone softness" };


/** Undo labels in the View and lighting history (design §3.6). */
const shown = (enabled: boolean, what: string) => `${enabled ? "Show" : "Hide"} ${what}`;
type Shown = ReturnType<typeof previewFields>;

/**
 * Camera, light, display, scene and tool commands, independent of the DOM and the Three scene type. Their state lives in the view
 * graph (the one owner, design §3.3): each action edits the node its view references, and the device follows the graph for the view
 * it draws (`shown`, the main view while there is one visible view). Camera jumps are computed by the device, then recorded.
 */
export class PreviewActions {
  private listeners = new Set<() => void>();
  private readonly graph: ViewGraph;
  /** What the device shows now, per graph field (tools as applied: withdrawn tools off, UI-102): a change applies only the difference. */
  private applied: Shown;
  private dispatching = false;
  private readonly unsubscribe: () => void;
  /**
   * @param initial the workspace's preview, used to build a private one-view graph when `graph` is not given (fixtures)
   * @param graph the workspace's view graph (the composition root's); the device must already show its `shown` view's state
   * @param shown the view this device draws
   */
  constructor(initial: PreviewState, private port: PreviewPort, graph?: ViewGraph, private readonly shown: ViewId = MAIN_VIEW) {
    this.graph = graph ?? createStudioViewGraph(initial);
    // The device shows the stored state; a tool the presentation already withdrew goes off at once (UI-102).
    this.applied = previewFields(this.graph, shown);
    this.apply(false);
    // The LUT arrives from the host after the preset turns on; readers learn of it like any other change.
    port.onLightingStatus?.(() => this.notify());
    this.unsubscribe = this.graph.subscribe(change => this.follow(change));
  }
  /** Stop following the graph (the head this device draws was released). */
  dispose() { this.unsubscribe(); this.listeners.clear(); }
  private notify() { for (const listener of this.listeners) listener(); }
  /** The graph changed: the device applies what changed for the view it draws (Undo, Redo, a shared node edited elsewhere). */
  private follow(change: ViewGraphChange) {
    if (!change.views.includes(this.shown) && !change.structure) return;
    if (change.applied) this.applied = this.shownFields();
    else this.apply(change.origin === "history");
    if (!this.dispatching) this.notify();
  }
  /** What the device should show for the view it draws: its graph state, with the tools the presentation withdrew off. */
  private shownFields() { return previewFields(this.graph, this.shown, { active: true }); }
  /** Push the shown view's graph state to the device, field by field, in the order the controls always set them. */
  private apply(camera: boolean) {
    const next = this.shownFields(), was = this.applied, port = this.port;
    const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
    this.applied = next;
    const lighting = (f: Shown) => lightingSource({ setup: f.lights.setup, setups: f.lights.setups }, f.lights.creatorLighting);
    const source = lighting(next);
    if (changed(source, lighting(was))) port.setLighting?.(source);
    if (next.scene.eyeShape !== was.scene.eyeShape) port.setEyeShape(next.scene.eyeShape);
    if (next.scene.normals !== was.scene.normals) port.setNormals(next.scene.normals);
    if (next.scene.eyeOwnRoughness !== was.scene.eyeOwnRoughness) port.setEyeOptics(next.scene.eyeOwnRoughness ?? true);
    if ((next.scene.physics ?? false) !== (was.scene.physics ?? false)) port.setPhysics?.(next.scene.physics ?? false);
    for (const detail of ["brows", "lashes"] as const) if (next.display[detail] !== was.display[detail]) port.setDetail(detail, next.display[detail]);
    if (next.display.hair !== was.display.hair) port.setHair(next.display.hair);
    const rendering = renderingOf(next.display), before = renderingOf(was.display);
    if (rendering.skinScatter !== before.skinScatter) port.setSkinScatter?.(rendering.skinScatter);
    if (rendering.faceShadows !== before.faceShadows) port.setFaceShadows?.(rendering.faceShadows);
    if (rendering.hairLook !== before.hairLook) port.setHairLook?.(rendering.hairLook);
    if (next.display.piercings !== was.display.piercings) port.setPiercings(next.display.piercings);
    if (next.display.body !== was.display.body) port.setBody?.(next.display.body ?? true);
    if (next.surface !== was.surface) port.setSurfaceControls(next.surface);
    if (next.wire !== was.wire) port.setWire(next.wire);
    if (camera && next.camera && changed(next.camera, was.camera)) port.restoreCamera(next.camera);
  }
  /** The view graph this device follows. */
  views(): ViewGraph { return this.graph; }
  /** The view an action acts on: the one it names, else the focused one (the shown one when that is gone). */
  private target(view?: ViewId): ViewId {
    const id = view ?? this.graph.focused();
    return this.graph.has(id) ? id : this.shown;
  }
  private fields(view?: ViewId) { return previewFields(this.graph, this.target(view)); }
  eyeShapeOptions(): Readonly<EyeShapeOptions> {
    return structuredClone(this.port.eyeShapeOptions?.() ?? { choices: [], eyesFollow: false, eyeSource: null });
  }
  private validEyeShape(index: number) {
    const choices = this.port.eyeShapeOptions?.().choices;
    return Number.isInteger(index) && index >= 0 && (choices ? index < choices.length : index <= MAX_EYE_SHAPE_INDEX);
  }
  /** The shown view's settings in the workspace's `preview` shape (the legacy mirror), with the device's live camera. */
  snapshot(): Readonly<PreviewConfig & { camera: CameraState }> {
    const { camera: _pose, ...mirror } = previewMirror(this.graph, this.shown);
    return structuredClone({ ...mirror, camera: this.port.cameraState() });
  }
  /** What the lighting device shows now (null on a preview without the creator rig). Not persisted. */
  lightingStatus(): Readonly<LightingStatus> | null {
    const status = this.port.lightingStatus?.();
    return status ? structuredClone(status) : null;
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  /** The existing uncoded capability shape; the application reads the coded `check()`. */
  capability(action: PreviewAction): PreviewCapability {
    const { code: _code, ...capability } = this.check(action);
    return capability;
  }
  /** Capability with the reason code chosen at each refusal. */
  check(action: PreviewAction): PreviewCapability & { code?: ReasonCode } {
    if (action.view !== undefined && !this.graph.has(action.view)) return refusal("missing_target", "That view no longer exists.");
    // The device computes framing for the view it draws; other views get cameras of their own with more than one visible view (P4).
    if (action.kind.startsWith("camera.") && this.target(action.view) !== this.shown) return refusal("unavailable", "That view isn't shown.");
    const state = this.fields(action.view);
    if ((action.kind === "camera.back" || action.kind === "camera.forward") && !this.graph.cameraTrail(this.target(action.view))[action.kind === "camera.back" ? "back" : "forward"])
      return refusal("invalid_value", action.kind === "camera.back" ? "The camera hasn't jumped anywhere yet." : "There is no later camera position to go forward to.");
    if (action.kind === "camera.setFov" && (!Number.isFinite(action.degrees) || action.degrees < 10 || action.degrees > 90))
      return refusal("invalid_value", "Field of view must be between 10° and 90°.");
    if (action.kind === "camera.navigate") {
      const invalid = validNavigation(action.command);
      if (invalid) return refusal("invalid_value", invalid);
    }
    if (action.kind.startsWith("preview.") && this.lightingAction(action) && !this.port.setLighting) return refusal("unavailable", NO_LIGHTING);
    const lighting = this.checkLighting(action, state.lights);
    if (lighting) return lighting;
    if (action.kind === "preview.setLightingPreset" && !LIGHTING_PRESETS.includes(action.preset)) return refusal("invalid_value", "That lighting preset does not exist.");
    if (action.kind === "preview.setCreatorLighting") {
      const valid = action.key === "intensity" ? INTENSITY_FORMS.includes(action.value)
        : action.key === "cone" ? CONE_READINGS.includes(action.value)
          : action.key === "exposure" && Number.isFinite(action.value) && action.value >= CREATOR_EXPOSURE_RANGE.min && action.value <= CREATOR_EXPOSURE_RANGE.max;
      if (!valid) return refusal("invalid_value", action.key === "exposure"
        ? `Creator exposure must be between ${CREATOR_EXPOSURE_RANGE.min} and ${CREATOR_EXPOSURE_RANGE.max}.` : "That creator lighting option does not exist.");
    }
    if ((action.kind === "preview.setCreatorShadows" || action.kind === "preview.setSkinScatter" || action.kind === "preview.setFaceShadows") &&
      typeof action.enabled !== "boolean") return refusal("invalid_value", "Choose on or off.");
    if (action.kind === "preview.setHairLook" && !(Number.isFinite(action.value) && action.value >= HAIR_LOOK_RANGE.min && action.value <= HAIR_LOOK_RANGE.max))
      return refusal("invalid_value", "Hair look goes from Crisp (0) to Game-like (1).");
    if (action.kind === "preview.resetCreatorLighting") {
      const current = state.lights.creatorLighting;
      if (current.intensity === DEFAULT_CREATOR_LIGHTING.intensity && current.cone === DEFAULT_CREATOR_LIGHTING.cone
        && current.exposure === DEFAULT_CREATOR_LIGHTING.exposure && current.shadows === DEFAULT_CREATOR_LIGHTING.shadows) return refusal("unavailable", "The calibration is already at its defaults.");
    }
    if ((action.kind === "camera.body" && !this.port.frameBody) || ((action.kind === "preview.setBody" || action.kind === "preview.setUncensored") && !this.port.setBody))
      return refusal("unavailable", NO_BODY);
    // Framing a body that isn't shown frames nothing (UI-79).
    if (action.kind === "camera.body" && state.display.body === false) return refusal("incompatible_mode", "Turn the body on to see the whole body.");
    if ((action.kind === "preview.setBody" || action.kind === "preview.setUncensored") && typeof action.enabled !== "boolean")
      return refusal("invalid_value", "Choose on or off.");
    if (action.kind === "camera.creatorFraming") {
      if (!this.port.creatorCamera) return refusal("unavailable", NO_CREATOR);
      if (action.page !== "face" && action.page !== "hair") return refusal("invalid_value", "That creator page does not exist.");
    }
    if (action.kind === "preview.setEyeShape" && !this.validEyeShape(action.index))
      return refusal("invalid_value", "That eye shape is not offered by this head.");
    const target = action.kind === "preview.setDetail" ? action.detail : action.kind === "preview.setHair" ? "hair" : undefined;
    const requested = action.kind === "preview.setDetail" || action.kind === "preview.setHair" ? action.enabled : false;
    const unavailable = target && requested && this.port.availability?.(target);
    if (unavailable) return refusal("asset_unavailable", unavailable);
    return { available: true };
  }
  dispatch(action: PreviewAction): PreviewActionResult {
    const capability = this.capability(action);
    if (!capability.available) throw Error(capability.reason);
    const view = this.target(action.view), state = this.fields(view);
    const lights = (next: Partial<LightsState>, label: string, coalesce?: string) => this.graph.edit(view, "lights", { state: next }, { label, coalesce });
    const scene = (next: Partial<SceneState>, label: string) => this.graph.edit(view, "scene", { state: next }, { label });
    const display = (next: Partial<DisplayState>, label: string) => this.graph.edit(view, "display", { state: next }, { label });
    // View tools are affordances, not settings: they record nothing (design §3.6).
    const tool = (id: string, enabled: boolean) => this.graph.edit(view, "tools", { state: { on: { ...state.tools, [id]: enabled } } });
    let limited: boolean | undefined;
    this.dispatching = true;
    try {
      switch (action.kind) {
        case "camera.front": limited = this.jump(view, "Front view", () => this.port.front()); break;
        case "camera.body": limited = this.jump(view, "Whole body view", () => this.port.frameBody!()); break;
        case "camera.setFov": limited = this.port.setFov(action.degrees); this.moved(view); break;
        case "camera.endFovGesture": this.port.endFovGesture(); break;
        case "camera.restore": this.jump(view, "Saved camera", () => { this.port.restoreCamera(action.camera); }); break;
        case "camera.back": case "camera.forward": this.cameraStep(action.kind === "camera.back" ? "back" : "forward", view); break;
        case "camera.navigate": this.port.restoreCamera(navigateCamera(this.port.cameraState(), action.command, this.port.distanceLimits?.())); this.moved(view); break;
        case "camera.creatorFraming":
          this.jump(view, action.page === "face" ? "Creator face camera" : "Creator hair camera",
            () => { this.port.restoreCamera(this.port.creatorCamera!(action.page)); });
          break;
        case "preview.setLightingPreset": {
          // Scripts: the creator shows Character creator; the studio shows Soft studio unless an ACES setup already shows.
          const library = this.library(view);
          if (action.preset === "creator") this.write(view, { ...library, setup: "creator" }, "Lighting: Character creator");
          else if (rigKindOf(library) === "creator") this.write(view, { ...library, setup: "soft" }, "Lighting: Soft studio");
          break;
        }
        case "preview.setCreatorLighting":
          lights({ creatorLighting: { ...state.lights.creatorLighting, [action.key]: action.value } }, "Creator lighting calibration",
            `creator.${action.key}`); break;
        case "preview.setCreatorShadows":
          lights({ creatorLighting: { ...state.lights.creatorLighting, shadows: action.enabled } }, action.enabled ? "Creator shadows on" : "Creator shadows off"); break;
        case "preview.resetCreatorLighting": lights({ creatorLighting: { ...DEFAULT_CREATOR_LIGHTING } }, "Restore creator calibration"); break;
        case "preview.setEyeShape": scene({ eyeShape: action.index }, "Eye shape"); break;
        case "preview.setPiercings": display({ piercings: action.enabled }, shown(action.enabled, "piercings")); break;
        case "preview.setBody": display({ body: action.enabled }, shown(action.enabled, "the body")); break;
        // Only the character context's request follows it (the host prepares the V in that mode); the scene draws what arrives.
        case "preview.setUncensored": scene({ uncensored: action.enabled }, action.enabled ? "Show the V uncensored" : "Show the V censored"); break;
        case "preview.setSurfaceControls": tool(LEGACY_TOOL_FIELDS.surface, action.enabled); break;
        case "preview.setWire": tool(LEGACY_TOOL_FIELDS.wire, action.enabled); break;
        case "preview.setNormals": scene({ normals: action.enabled }, "Normal map preview"); break;
        case "preview.setEyeOptics": scene({ eyeOwnRoughness: action.enabled }, "Eye's own roughness"); break;
        case "preview.setHair": display({ hair: action.enabled }, shown(action.enabled, "hair")); break;
        case "preview.setDetail":
          display({ [action.detail]: action.enabled }, shown(action.enabled, action.detail === "brows" ? "eyebrows" : "eyelashes")); break;
        case "preview.setSkinScatter": display({ skinScatter: action.enabled }, action.enabled ? "Skin scattering on" : "Skin scattering off"); break;
        case "preview.setFaceShadows": display({ faceShadows: action.enabled }, action.enabled ? "Face shadows on" : "Face shadows off"); break;
        case "preview.setHairLook":
          this.graph.edit(view, "display", { state: { hairLook: action.value } }, { label: "Hair look", coalesce: "hairLook" }); break;
        default:
          if (action.kind.startsWith("preview.") && this.lightingAction(action)) this.dispatchLighting(view, action);
          break;
      }
    } finally { this.dispatching = false; }
    this.notify();
    return limited === undefined ? {} : { limited };
  }
  /** A camera jump the device computes: record where it went from and to (a View and lighting step and a Back trail entry). */
  private jump(view: ViewId, label: string, move: () => boolean | void): boolean | undefined {
    const before = this.port.cameraState(), limited = move();
    this.graph.cameraJump(view, { pose: before }, { pose: this.port.cameraState() }, label);
    return typeof limited === "boolean" ? limited : undefined;
  }
  /** Navigation the device did: the camera node keeps it, unrecorded. */
  private moved(view: ViewId) { this.graph.cameraMoved(view, { pose: this.port.cameraState() }); }
  /** Restore a saved camera without recording a step or a trail entry (workspace restore). */
  restoreSavedCamera(camera: CameraState) { this.port.restoreCamera(camera); this.moved(this.shown); }
  /** Move the view's camera Back or Forward along its trail (design §3.6); false when there is nowhere to go. */
  cameraStep(direction: "back" | "forward", view?: ViewId): boolean {
    return this.graph.cameraStep(this.target(view), direction, { pose: this.port.cameraState() });
  }
  // ----- Lighting setups (lighting-setups.ts) -----

  /** Whether an action is one of the setup and light actions (the creator calibration's included). */
  private lightingAction(action: PreviewAction): boolean {
    return SETUP_EDITS.has(action.kind) || action.kind === "preview.selectLightingSetup" || action.kind === "preview.createLightingSetup" ||
      action.kind === "preview.renameLightingSetup" || action.kind === "preview.deleteLightingSetup" || action.kind === "preview.resetLightingSetup" ||
      action.kind === "preview.setLightingPreset" || action.kind === "preview.setCreatorLighting" || action.kind === "preview.setCreatorShadows" ||
      action.kind === "preview.resetCreatorLighting";
  }
  private library(view?: ViewId): SetupLibrary { const lights = this.fields(view).lights; return { setup: lights.setup, setups: lights.setups }; }
  /** The body the device lights (the built-in creator rig and its forks follow it). */
  private sex(): BodySex { return this.port.lightingStatus?.()?.sex ?? "female"; }
  /** The shown setup's complete definition for the body shown. */
  private shownSetup(view?: ViewId): LightingSetup {
    const lights = this.fields(view).lights;
    return setupDefinition({ setup: lights.setup, setups: lights.setups }, lights.setup, this.sex(), lights.creatorLighting);
  }
  /** Write a library into the view's lights node, with the rig kind its shown setup draws through, as one View and lighting step. */
  private write(view: ViewId, library: SetupLibrary, label: string, coalesce?: string) {
    this.graph.edit(view, "lights", { kind: rigKindOf(library), state: { setup: library.setup, setups: library.setups } }, { label, coalesce });
  }
  /** Change the shown setup's values (forking a built-in first); a change that changes nothing records nothing and forks nothing. */
  private editShown(view: ViewId, label: string, change: (setup: LightingSetup) => LightingSetup, coalesce?: string) {
    const lights = this.fields(view).lights, library = this.library(view), sex = this.sex();
    const before = setupDefinition(library, library.setup, sex, lights.creatorLighting);
    if (JSON.stringify(change(structuredClone(before))) === JSON.stringify(before)) return;
    this.write(view, editShownSetup(library, sex, lights.creatorLighting, change), label, coalesce);
  }
  /** The light `setKeyAngle` turns: the shown setup's `key` light, else its first directional light. */
  private keyLight(setup: LightingSetup) {
    return setup.lights.find(light => light.id === "key" && light.type === "directional") ?? setup.lights.find(light => light.type === "directional");
  }
  /** Refusals for the setup and light actions (undefined: no objection). */
  private checkLighting(action: PreviewAction, lights: LightsState): (PreviewCapability & { code?: ReasonCode }) | undefined {
    const library = { setup: lights.setup, setups: lights.setups };
    const exists = (id: unknown) => setupExists(library, id);
    const own = (id: string, verb: string) => !exists(id) ? refusal("missing_target", "That lighting setup no longer exists.")
      : isBuiltInSetup(id) ? refusal("incompatible_mode", `${builtInInfo(id).label} is built in and can't be ${verb}. Make your own setup from it to change it.`) : undefined;
    const full = library.setups.length >= LIGHTING_LIMITS.setups;
    const fullReason = `You have ${LIGHTING_LIMITS.setups} lighting setups, the most a workspace keeps. Delete one first.`;
    switch (action.kind) {
      case "preview.selectLightingSetup": return exists(action.setup) ? undefined : refusal("invalid_value", "That lighting setup doesn't exist.");
      case "preview.createLightingSetup":
        if (!exists(action.from)) return refusal("invalid_value", "That lighting setup doesn't exist.");
        return full ? refusal("unavailable", fullReason) : undefined;
      case "preview.renameLightingSetup":
        return own(action.setup, "renamed") ?? (validSetupName(action.name) ? undefined
          : refusal("invalid_value", `A setup name needs 1 to ${LIGHTING_LIMITS.name} characters.`));
      case "preview.deleteLightingSetup": return own(action.setup, "deleted");
      case "preview.resetLightingSetup": {
        const refused = own(action.setup, "reset");
        if (refused) return refused;
        const setup = findUserSetup(library, action.setup)!;
        return differsFromBase(setup, this.sex(), lights.creatorLighting) ? undefined
          : refusal("unavailable", `${setup.name} already matches ${builtInInfo(setup.base).label}.`);
      }
    }
    if (!SETUP_EDITS.has(action.kind)) return;
    // Changing a built-in makes a copy, which needs room in the list.
    if (isBuiltInSetup(library.setup) && full) return refusal("unavailable", `${fullReason} Changing a built-in setup makes a copy of it.`);
    const shown = setupDefinition(library, library.setup, this.sex(), lights.creatorLighting);
    const light = "light" in action ? shown.lights.find(item => item.id === action.light) : undefined;
    if (LIGHT_ACTIONS.has(action.kind) && !light) return refusal("missing_target", "That light isn't in this setup any more.");
    const outside = (what: string, range: { min: number; max: number }) => refusal("invalid_value", `${what} must be between ${range.min} and ${range.max}.`);
    switch (action.kind) {
      case "preview.setExposure": {
        const range = SETUP_EXPOSURE_RANGES[shown.display];
        return Number.isFinite(action.value) && action.value >= range.min && action.value <= range.max ? undefined : outside("Exposure", range);
      }
      case "preview.setRoomLight":
        return Number.isFinite(action.value) && action.value >= SETUP_ENVIRONMENT_RANGE.min && action.value <= SETUP_ENVIRONMENT_RANGE.max
          ? undefined : outside("Room light", SETUP_ENVIRONMENT_RANGE);
      case "preview.setBackdrop": return SETUP_BACKDROPS.includes(action.backdrop) ? undefined : refusal("invalid_value", "That backdrop doesn't exist.");
      case "preview.setDisplayTransform": return SETUP_DISPLAYS.includes(action.display) ? undefined : refusal("invalid_value", "That display doesn't exist.");
      case "preview.setLight": {
        if (!LIGHT_NUMBER_KEYS.includes(action.key)) return refusal("invalid_value", "That light setting doesn't exist.");
        const range = LIGHT_RANGES[action.key];
        if (!Number.isFinite(action.value) || action.value < range.min || action.value > range.max) return outside(`The ${LIGHT_NUMBER_LABELS[action.key]}`, range);
        if ((action.key === "cone" || action.key === "softness") && light!.type !== "spot")
          return refusal("incompatible_mode", "A directional light has no cone. Make it a spot light to shape one.");
        return;
      }
      case "preview.setLightColour": return parseColourHex(action.colour) ? undefined : refusal("invalid_value", "Choose a colour as #rrggbb.");
      case "preview.setLightShadows":
        if (typeof action.enabled !== "boolean") return refusal("invalid_value", "Choose on or off.");
        return action.enabled && !light!.shadows && shadowCasters(shown) >= LIGHTING_LIMITS.shadowCasters
          ? refusal("unavailable", `At most ${LIGHTING_LIMITS.shadowCasters} lights can cast shadows at once. Turn one off first.`) : undefined;
      case "preview.setLightType": return LIGHT_TYPES.includes(action.type) ? undefined : refusal("invalid_value", "That kind of light doesn't exist.");
      case "preview.renameLight": return validSetupName(action.name) ? undefined : refusal("invalid_value", `A light's name needs 1 to ${LIGHTING_LIMITS.name} characters.`);
      case "preview.addLight":
        if (!LIGHT_TYPES.includes(action.type)) return refusal("invalid_value", "That kind of light doesn't exist.");
        return shown.lights.length >= LIGHTING_LIMITS.lights
          ? refusal("unavailable", `A setup holds at most ${LIGHTING_LIMITS.lights} lights. Remove one first.`) : undefined;
      case "preview.moveLight":
        return Number.isInteger(action.index) && action.index >= 0 && action.index < shown.lights.length ? undefined
          : refusal("invalid_value", "That place isn't in the list of lights.");
      case "preview.duplicateLight":
        return shown.lights.length >= LIGHTING_LIMITS.lights
          ? refusal("unavailable", `A setup holds at most ${LIGHTING_LIMITS.lights} lights. Remove one first.`) : undefined;
      case "preview.setKeyAngle":
        if (!Number.isFinite(action.degrees) || action.degrees < 0 || action.degrees > 360) return refusal("invalid_value", "Key light angle must be between 0° and 360°.");
        return this.keyLight(shown) ? undefined : refusal("unavailable", "This setup has no directional light to turn.");
    }
    return;
  }
  private dispatchLighting(view: ViewId, action: PreviewAction) {
    const lights = this.fields(view).lights, library = this.library(view), sex = this.sex(), calibration = lights.creatorLighting;
    const lightName = (id: string) => this.shownSetup(view).lights.find(light => light.id === id)?.name ?? "Light";
    switch (action.kind) {
      case "preview.selectLightingSetup": this.write(view, { ...library, setup: action.setup }, `Lighting: ${setupLabel(library, action.setup)}`); break;
      case "preview.createLightingSetup":
        this.write(view, createSetup(library, action.from, sex, calibration), `New lighting setup from ${setupLabel(library, action.from)}`); break;
      case "preview.renameLightingSetup": this.write(view, renameSetup(library, action.setup, action.name), "Rename lighting setup"); break;
      case "preview.deleteLightingSetup": this.write(view, deleteSetup(library, action.setup), `Delete ${setupLabel(library, action.setup)}`); break;
      case "preview.resetLightingSetup":
        this.write(view, resetSetup(library, action.setup, sex, calibration),
          `Reset ${setupLabel(library, action.setup)} to ${builtInInfo(setupBase(library, action.setup)).label}`); break;
      case "preview.setExposure": this.editShown(view, "Exposure", setup => ({ ...setup, exposure: action.value }), "exposure"); break;
      case "preview.setRoomLight": this.editShown(view, "Room light", setup => ({ ...setup, environment: action.value }), "room"); break;
      case "preview.setBackdrop":
        this.editShown(view, action.backdrop === "black" ? "Black backdrop" : "Studio backdrop", setup => ({ ...setup, backdrop: action.backdrop })); break;
      case "preview.setDisplayTransform":
        this.editShown(view, action.display === "game" ? "Game colour grade" : "Studio tone mapping", setup => setSetupDisplay(setup, action.display, calibration)); break;
      case "preview.setLight":
        this.editShown(view, `${lightName(action.light)} ${LIGHT_NUMBER_LABELS[action.key]}`, setup => setLightNumber(setup, action.light, action.key, action.value),
          `light.${action.light}.${action.key === "azimuth" || action.key === "elevation" || action.key === "distance" ? "place" : action.key}`); break;
      case "preview.setLightColour":
        this.editShown(view, `${lightName(action.light)} colour`, setup => setLightColour(setup, action.light, parseColourHex(action.colour)!), `light.${action.light}.colour`); break;
      case "preview.setLightShadows":
        this.editShown(view, `${lightName(action.light)} shadows ${action.enabled ? "on" : "off"}`, setup => setLightShadows(setup, action.light, action.enabled)); break;
      case "preview.setLightType":
        this.editShown(view, `${lightName(action.light)}: ${action.type} light`, setup => setLightType(setup, action.light, action.type)); break;
      case "preview.renameLight": this.editShown(view, "Rename light", setup => renameLight(setup, action.light, action.name)); break;
      case "preview.aimLightAtHead": this.editShown(view, `Aim ${lightName(action.light)} at the head`, setup => aimLightAtHead(setup, action.light)); break;
      case "preview.addLight": this.editShown(view, `Add a ${action.type} light`, setup => addLight(setup, action.type).setup); break;
      case "preview.removeLight": this.editShown(view, `Remove ${lightName(action.light)}`, setup => removeLight(setup, action.light)); break;
      case "preview.moveLight": this.editShown(view, `Move ${lightName(action.light)} in the list`, setup => moveLight(setup, action.light, action.index)); break;
      case "preview.duplicateLight": this.editShown(view, `Duplicate ${lightName(action.light)}`, setup => duplicateLight(setup, action.light).setup); break;
      case "preview.setKeyAngle": {
        const key = this.keyLight(this.shownSetup(view))!;
        this.editShown(view, "Key light direction", setup => setLightNumber(setup, key.id, "azimuth", action.degrees), `light.${key.id}.place`); break;
      }
    }
  }
  /** The setups for the presentation: one flat list (built-in templates first, then the person's own) and the shown setup's values. */
  lightingSetups(view?: ViewId): LightingSetupsView {
    const lights = this.fields(view).lights, library = this.library(view), sex = this.sex();
    const shown = setupDefinition(library, library.setup, sex, lights.creatorLighting), user = findUserSetup(library, library.setup);
    const base = setupBase(library, library.setup);
    return {
      active: library.setup,
      setups: [
        ...BUILT_IN_SETUP_IDS.map(id => ({ id, ...builtInInfo(id), builtIn: true, base: id, baseLabel: builtInInfo(id).label,
          display: (id === "creator" ? "game" : "aces") as SetupDisplay })),
        ...library.setups.map(setup => ({ id: setup.id, label: setup.name, title: `Your setup, made from ${builtInInfo(setup.base).label}`, builtIn: false,
          base: setup.base, baseLabel: builtInInfo(setup.base).label, display: setup.setup.display })),
      ],
      shown: {
        id: library.setup, label: setupLabel(library, library.setup), builtIn: !user, baseLabel: builtInInfo(base).label,
        resettable: !!user && differsFromBase(user, sex, lights.creatorLighting), display: shown.display, backdrop: shown.backdrop,
        environment: shown.environment, exposure: shown.exposure, exposureRange: { ...SETUP_EXPOSURE_RANGES[shown.display] },
        lights: shown.lights.map(light => ({ id: light.id, name: light.name, type: light.type, ...lightPlacement(light, shown.focus),
          colour: colourHex(light.colour), intensity: light.intensity, cone: light.angle * 180 / Math.PI, softness: light.penumbra, shadows: light.shadows })),
        shadowCasters: shadowCasters(shown),
      },
    };
  }
  /** A view's Rendering options, with their defaults applied (the Preview quality panel's Rendering group reads them). */
  rendering(view?: ViewId): RenderingOptions { return renderingOf(this.fields(view).display); }
  /** Whether a view's scene simulates its dangles (the scene node's `physics`; off until the viewer turns it on). */
  scenePhysics(view?: ViewId): boolean { return this.fields(view).scene.physics === true; }
  /**
   * Turn a view's scene's dangle simulation on or off (`motion.setPhysics`, dispatched by the motion service): a scene-node edit, so every
   * view of the scene follows it, and Undo in View and lighting reverses it.
   */
  setScenePhysics(enabled: boolean, view?: ViewId) {
    this.dispatching = true;
    try { this.graph.edit(this.target(view), "scene", { state: { physics: enabled } }, { label: enabled ? "Hair physics on" : "Hair physics off" }); }
    finally { this.dispatching = false; }
    this.notify();
  }
  /** Saved facial morph application already changed the renderer; only update the persisted selector. */
  rememberEyeShape(index: number) {
    if (!this.validEyeShape(index)) return;
    this.graph.edit(this.shown, "scene", { state: { eyeShape: index } }, { applied: true, seed: true });
    this.notify();
  }
}
