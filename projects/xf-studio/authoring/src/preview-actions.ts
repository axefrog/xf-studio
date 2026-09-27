import type { CameraState, PreviewState } from "./workspace-state";
import { MAIN_VIEW, type ViewGraphChange, type ViewId } from "./platform/api/view-graph";
import type { ViewGraph } from "./platform/core/view-graph";
import { createStudioViewGraph, EYE_SHAPE_RANGE, LEGACY_TOOL_FIELDS, previewFields, previewMirror, type DisplayState, type LightsState,
  type SceneState } from "./preview-view-graph";
import { navigateCamera, validNavigation, type CameraNavigation } from "./camera-navigation";
import type { DistanceLimits } from "./camera-framing";
import type { FaceMorphChoice } from "./face-morphs";
import { CONE_READINGS, CREATOR_EXPOSURE_RANGE, DEFAULT_CREATOR_LIGHTING, INTENSITY_FORMS, LIGHTING_PRESETS, type BodySex, type ConeReading,
  type CreatorCameraPage, type CreatorLightingOptions, type IntensityForm, type LightingPreset } from "./creator-lighting";
import type { GradingLutSource } from "./grading-lut";
import { refusal, type ReasonCode } from "./platform/api";
import { DEFAULT_STUDIO_STAGE, isDefaultStudioStage, matchingStudioSetup, STUDIO_EXPOSURE_RANGE, STUDIO_LIGHT_KEYS, STUDIO_LIGHT_RANGES,
  STUDIO_SETUP_IDS, STUDIO_SETUPS, validStudioExposure, validStudioLightValue, type StudioLightKey, type StudioLights, type StudioSetupId } from "./studio-lighting";

export type PreviewConfig = Pick<PreviewState,
  "surface" | "wire" | "brows" | "lashes" | "hair" | "piercings" | "body" | "uncensored" | "physics" |
  "eyeShape" | "normals" | "eyeOwnRoughness" | "exposure" | "lightAngle" | "lightingPreset" | "creatorLighting" | "studioLights">;
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
  | { kind: "preview.setExposure"; value: number }
  | { kind: "preview.setKeyAngle"; degrees: number }
  | { kind: "preview.setStudioLight"; key: StudioLightKey; value: number }
  | { kind: "preview.setStudioNeutral"; enabled: boolean }
  | { kind: "preview.applyStudioSetup"; setup: StudioSetupId }
  | { kind: "preview.resetStudioLighting" }
  | { kind: "preview.setEyeShape"; index: number }
  | { kind: "preview.setPiercings"; enabled: boolean }
  | { kind: "preview.setBody"; enabled: boolean }
  | { kind: "preview.setUncensored"; enabled: boolean }
  | { kind: "preview.setSurfaceControls" | "preview.setWire" | "preview.setNormals" | "preview.setEyeOptics" | "preview.setHair"; enabled: boolean }
  | { kind: "preview.setDetail"; detail: "brows" | "lashes"; enabled: boolean };
export type PreviewActionResult = { limited?: boolean };
export type PreviewCapability = { available: boolean; reason?: string };
/** Eye-shape choices as the loaded head carries them, and whether the eyeballs follow them. */
export type EyeShapeOptions = { choices: FaceMorphChoice[]; eyesFollow: boolean; eyeSource: string | null };
/** The lighting device's read-only report: which rig is shown and where its colour grading came from. */
export type LightingStatus = { preset: LightingPreset; sex: BodySex; defaultExposure: number;
  lut: { phase: "idle" | "loading" | "ready"; source: GradingLutSource | null } };
/** The studio stage's named setups and the one the current lights match exactly (null once adjusted). Read-only; not persisted. */
export type StudioSetupsView = { active: StudioSetupId | null; setups: { id: StudioSetupId; label: string; title: string }[] };
/** Persisted workspace bounds before a head is loaded (the female creator's 22 choices). */
export const MAX_EYE_SHAPE_INDEX = EYE_SHAPE_RANGE.max;
export type PreviewPort = {
  cameraState(): CameraState; front(): boolean; setFov(degrees: number): boolean | undefined; endFovGesture(): void;
  restoreCamera(camera: CameraState): void;
  /** The view's orbit distance limits now (derived from its lens, aspect and scene: camera-framing.ts). Absent: the whole stored range. */
  distanceLimits?(): DistanceLimits;
  setExposure(value: number): void; setLightAngle(degrees: number): void;
  /** The studio stage's strengths, key elevation and tint (studio-lighting.ts). Absent on a preview without the adjustable rig. */
  setStudioLights?(lights: StudioLights): void;
  setSurfaceControls(enabled: boolean): void; setWire(enabled: boolean): void; setNormals(enabled: boolean): void;
  setEyeOptics(enabled: boolean): void; setHair(enabled: boolean): void;
  setEyeShape(index: number): void; setPiercings(enabled: boolean): void;
  /** The scene's dangle simulation (hair-physics-plan.md §3.6). Absent on a preview without the idle's rig. */
  setPhysics?(enabled: boolean): void;
  /** The V's body (visibility preference) and the whole-body view (true when the lens is too narrow to fit it). Absent on a head-only preview. */
  setBody?(enabled: boolean): void; frameBody?(): boolean;
  eyeShapeOptions?(): EyeShapeOptions;
  setDetail(detail: "brows" | "lashes", enabled: boolean): void;
  availability?(target: "brows" | "lashes" | "hair"): string | undefined;
  /** Lighting presets (creator-lighting.ts). Absent on a preview without the creator rig. */
  setLightingPreset?(preset: LightingPreset): void;
  setCreatorLighting?(options: CreatorLightingOptions): void;
  creatorCamera?(page: CreatorCameraPage): CameraState;
  lightingStatus?(): LightingStatus;
  onLightingStatus?(listener: () => void): () => void;
};
const NO_CREATOR = "Creator lighting is unavailable in this preview.";
const NO_BODY = "This preview shows the head only.";
const CREATOR_FIXED = "Creator lighting uses the game's own lights and fixed exposure. Switch to Studio lighting to adjust this.";
const NO_STUDIO_RIG = "Studio light controls are unavailable in this preview.";
const STUDIO_ACTIONS = new Set<PreviewAction["kind"]>(["preview.setExposure", "preview.setKeyAngle", "preview.setStudioLight",
  "preview.setStudioNeutral", "preview.applyStudioSetup", "preview.resetStudioLighting"]);
const STUDIO_LIGHT_LABELS: Record<StudioLightKey, string> = { environment: "Environment strength", key: "Key light strength",
  elevation: "Key light height", fill: "Fill light strength", rim: "Rim light strength" };


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
    if (next.rig !== was.rig) port.setLightingPreset?.(next.rig);
    if (changed(next.lights.creatorLighting, was.lights.creatorLighting)) port.setCreatorLighting?.(next.lights.creatorLighting);
    if (changed(next.lights.studioLights, was.lights.studioLights)) port.setStudioLights?.(next.lights.studioLights);
    if (next.lights.exposure !== was.lights.exposure) port.setExposure(next.lights.exposure);
    if (next.lights.lightAngle !== was.lights.lightAngle) port.setLightAngle(next.lights.lightAngle);
    if (next.scene.eyeShape !== was.scene.eyeShape) port.setEyeShape(next.scene.eyeShape);
    if (next.scene.normals !== was.scene.normals) port.setNormals(next.scene.normals);
    if (next.scene.eyeOwnRoughness !== was.scene.eyeOwnRoughness) port.setEyeOptics(next.scene.eyeOwnRoughness ?? true);
    if ((next.scene.physics ?? false) !== (was.scene.physics ?? false)) port.setPhysics?.(next.scene.physics ?? false);
    for (const detail of ["brows", "lashes"] as const) if (next.display[detail] !== was.display[detail]) port.setDetail(detail, next.display[detail]);
    if (next.display.hair !== was.display.hair) port.setHair(next.display.hair);
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
    if (action.kind === "preview.setExposure" && !validStudioExposure(action.value))
      return refusal("invalid_value", `Exposure must be between ${STUDIO_EXPOSURE_RANGE.min} and ${STUDIO_EXPOSURE_RANGE.max}.`);
    if (action.kind === "preview.setKeyAngle" && (!Number.isFinite(action.degrees) || action.degrees < 0 || action.degrees > 360))
      return refusal("invalid_value", "Key light angle must be between 0° and 360°.");
    if ((action.kind === "preview.setStudioLight" || action.kind === "preview.setStudioNeutral") && !this.port.setStudioLights)
      return refusal("unavailable", NO_STUDIO_RIG);
    if (action.kind === "preview.setStudioNeutral" && typeof action.enabled !== "boolean") return refusal("invalid_value", "Choose on or off.");
    if (action.kind === "preview.setStudioLight") {
      if (!STUDIO_LIGHT_KEYS.includes(action.key)) return refusal("invalid_value", "That studio light setting does not exist.");
      if (!validStudioLightValue(action.key, action.value)) {
        const range = STUDIO_LIGHT_RANGES[action.key];
        return refusal("invalid_value", `${STUDIO_LIGHT_LABELS[action.key]} must be between ${range.min} and ${range.max}.`);
      }
    }
    if (action.kind === "preview.applyStudioSetup") {
      if (!this.port.setStudioLights) return refusal("unavailable", NO_STUDIO_RIG);
      if (!Object.hasOwn(STUDIO_SETUPS, action.setup)) return refusal("invalid_value", "That lighting setup does not exist.");
    }
    if (action.kind === "preview.resetStudioLighting") {
      if (!this.port.setStudioLights) return refusal("unavailable", NO_STUDIO_RIG);
      if (isDefaultStudioStage(this.studioStage(action.view))) return refusal("unavailable", "The studio lighting is already at its defaults.");
    }
    // Under the creator preset these studio controls are not wrong, they belong to the other mode (UI-56).
    if (STUDIO_ACTIONS.has(action.kind) && state.rig === "creator")
      return refusal("incompatible_mode", CREATOR_FIXED);
    if (action.kind === "preview.setLightingPreset") {
      if (!LIGHTING_PRESETS.includes(action.preset)) return refusal("invalid_value", "That lighting preset does not exist.");
      if (action.preset === "creator" && !this.port.setLightingPreset) return refusal("unavailable", NO_CREATOR);
    }
    if (action.kind === "preview.setCreatorLighting") {
      if (!this.port.setCreatorLighting) return refusal("unavailable", NO_CREATOR);
      const valid = action.key === "intensity" ? INTENSITY_FORMS.includes(action.value)
        : action.key === "cone" ? CONE_READINGS.includes(action.value)
          : action.key === "exposure" && Number.isFinite(action.value) && action.value >= CREATOR_EXPOSURE_RANGE.min && action.value <= CREATOR_EXPOSURE_RANGE.max;
      if (!valid) return refusal("invalid_value", action.key === "exposure"
        ? `Creator exposure must be between ${CREATOR_EXPOSURE_RANGE.min} and ${CREATOR_EXPOSURE_RANGE.max}.` : "That creator lighting option does not exist.");
    }
    if (action.kind === "preview.setCreatorShadows") {
      if (!this.port.setCreatorLighting) return refusal("unavailable", NO_CREATOR);
      if (typeof action.enabled !== "boolean") return refusal("invalid_value", "Choose on or off.");
    }
    if (action.kind === "preview.resetCreatorLighting") {
      if (!this.port.setCreatorLighting) return refusal("unavailable", NO_CREATOR);
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
        case "preview.setLightingPreset":
          this.graph.edit(view, "lights", { kind: action.preset }, { label: action.preset === "creator" ? "Creator lighting" : "Studio lighting" }); break;
        case "preview.setCreatorLighting":
          lights({ creatorLighting: { ...state.lights.creatorLighting, [action.key]: action.value } }, "Creator lighting calibration",
            `creator.${action.key}`); break;
        case "preview.setCreatorShadows":
          lights({ creatorLighting: { ...state.lights.creatorLighting, shadows: action.enabled } }, action.enabled ? "Creator shadows on" : "Creator shadows off"); break;
        case "preview.resetCreatorLighting": lights({ creatorLighting: { ...DEFAULT_CREATOR_LIGHTING } }, "Restore creator calibration"); break;
        case "preview.setExposure": lights({ exposure: action.value }, "Exposure", "exposure"); break;
        case "preview.setKeyAngle": lights({ lightAngle: action.degrees }, "Key light direction", "angle"); break;
        case "preview.setStudioLight":
          lights({ studioLights: { ...state.lights.studioLights, [action.key]: action.value } }, STUDIO_LIGHT_LABELS[action.key], `studio.${action.key}`); break;
        case "preview.setStudioNeutral": lights({ studioLights: { ...state.lights.studioLights, neutral: action.enabled } }, "Untinted lights"); break;
        case "preview.applyStudioSetup":
          this.applyStudioStage(view, STUDIO_SETUPS[action.setup], `Studio lighting: ${STUDIO_SETUPS[action.setup].label}`); break;
        case "preview.resetStudioLighting": this.applyStudioStage(view, DEFAULT_STUDIO_STAGE, "Restore studio lighting"); break;
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
  /** The named studio setups for the presentation, and which one the stage matches. */
  studioSetups(): StudioSetupsView {
    return { active: matchingStudioSetup(this.studioStage()),
      setups: STUDIO_SETUP_IDS.map(id => ({ id, label: STUDIO_SETUPS[id].label, title: STUDIO_SETUPS[id].title })) };
  }
  /** The studio stage as the controls set it: the rig, exposure and key angle. */
  studioStage(view?: ViewId) {
    const lights = this.fields(view).lights;
    return { lights: { ...lights.studioLights }, exposure: lights.exposure, angle: lights.lightAngle };
  }
  private applyStudioStage(view: ViewId, stage: { lights: Readonly<StudioLights>; exposure: number; angle: number }, label: string) {
    this.graph.edit(view, "lights", { state: { studioLights: { ...stage.lights }, exposure: stage.exposure, lightAngle: stage.angle } }, { label });
  }
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
