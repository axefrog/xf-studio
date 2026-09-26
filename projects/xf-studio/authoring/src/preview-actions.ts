import type { CameraState, PreviewState } from "./workspace-state";
import { navigateCamera, validNavigation, type CameraNavigation } from "./camera-navigation";
import type { FaceMorphChoice } from "./face-morphs";
import { CONE_READINGS, CREATOR_EXPOSURE_RANGE, DEFAULT_CREATOR_LIGHTING, INTENSITY_FORMS, LIGHTING_PRESETS, type BodySex, type ConeReading,
  type CreatorCameraPage, type CreatorLightingOptions, type IntensityForm, type LightingPreset } from "./creator-lighting";
import type { GradingLutSource } from "./grading-lut";
import { refusal, type ReasonCode } from "./platform/api";
import { DEFAULT_STUDIO_STAGE, isDefaultStudioStage, matchingStudioSetup, STUDIO_EXPOSURE_RANGE, STUDIO_LIGHT_KEYS, STUDIO_LIGHT_RANGES,
  STUDIO_SETUP_IDS, STUDIO_SETUPS, validStudioExposure, validStudioLightValue, type StudioLightKey, type StudioLights, type StudioSetupId } from "./studio-lighting";

export type PreviewConfig = Pick<PreviewState,
  "surface" | "wire" | "brows" | "lashes" | "hair" | "piercings" | "body" |
  "eyeShape" | "normals" | "eyeOwnRoughness" | "exposure" | "lightAngle" | "lightingPreset" | "creatorLighting" | "studioLights">;
export type PreviewAction =
  | { kind: "camera.front" }
  | { kind: "camera.body" }
  | { kind: "camera.setFov"; degrees: number }
  | { kind: "camera.endFovGesture" }
  | { kind: "camera.restore"; camera: CameraState }
  | { kind: "camera.navigate"; command: CameraNavigation }
  | { kind: "camera.creatorFraming"; page: CreatorCameraPage }
  | { kind: "preview.setLightingPreset"; preset: LightingPreset }
  | { kind: "preview.setCreatorLighting"; key: "intensity"; value: IntensityForm }
  | { kind: "preview.setCreatorLighting"; key: "cone"; value: ConeReading }
  | { kind: "preview.setCreatorLighting"; key: "exposure"; value: number }
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
export const MAX_EYE_SHAPE_INDEX = 21;
export type PreviewPort = {
  cameraState(): CameraState; front(): boolean; setFov(degrees: number): boolean | undefined; endFovGesture(): void;
  restoreCamera(camera: CameraState): void;
  setExposure(value: number): void; setLightAngle(degrees: number): void;
  /** The studio stage's strengths, key elevation and tint (studio-lighting.ts). Absent on a preview without the adjustable rig. */
  setStudioLights?(lights: StudioLights): void;
  setSurfaceControls(enabled: boolean): void; setWire(enabled: boolean): void; setNormals(enabled: boolean): void;
  setEyeOptics(enabled: boolean): void; setHair(enabled: boolean): void;
  setEyeShape(index: number): void; setPiercings(enabled: boolean): void;
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

/** Preview preferences and camera commands are independent of the DOM and the Three scene type. */
export class PreviewActions {
  private state: PreviewConfig;
  private listeners = new Set<() => void>();
  constructor(initial: PreviewState, private port: PreviewPort) {
    this.state = { surface: initial.surface, wire: initial.wire, brows: initial.brows,
      lashes: initial.lashes, hair: initial.hair, normals: initial.normals,
      ...(initial.eyeOwnRoughness === undefined ? {} : { eyeOwnRoughness: initial.eyeOwnRoughness }),
      eyeShape: initial.eyeShape, piercings: initial.piercings, ...(initial.body === undefined ? {} : { body: initial.body }),
      exposure: initial.exposure, lightAngle: initial.lightAngle,
      lightingPreset: initial.lightingPreset, creatorLighting: { ...initial.creatorLighting }, studioLights: { ...initial.studioLights } };
    // The LUT arrives from the host after the preset turns on; readers learn of it like any other change.
    port.onLightingStatus?.(() => { for (const listener of this.listeners) listener(); });
  }
  eyeShapeOptions(): Readonly<EyeShapeOptions> {
    return structuredClone(this.port.eyeShapeOptions?.() ?? { choices: [], eyesFollow: false, eyeSource: null });
  }
  private validEyeShape(index: number) {
    const choices = this.port.eyeShapeOptions?.().choices;
    return Number.isInteger(index) && index >= 0 && (choices ? index < choices.length : index <= MAX_EYE_SHAPE_INDEX);
  }
  snapshot(): Readonly<PreviewConfig & { camera: CameraState }> {
    return structuredClone({ ...this.state, camera: this.port.cameraState() });
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
      if (isDefaultStudioStage(this.studioStage())) return refusal("unavailable", "The studio lighting is already at its defaults.");
    }
    // Under the creator preset these studio controls are not wrong, they belong to the other mode (UI-56).
    if (STUDIO_ACTIONS.has(action.kind) && this.state.lightingPreset === "creator")
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
    if (action.kind === "preview.resetCreatorLighting") {
      if (!this.port.setCreatorLighting) return refusal("unavailable", NO_CREATOR);
      const current = this.state.creatorLighting;
      if (current.intensity === DEFAULT_CREATOR_LIGHTING.intensity && current.cone === DEFAULT_CREATOR_LIGHTING.cone
        && current.exposure === DEFAULT_CREATOR_LIGHTING.exposure) return refusal("unavailable", "The calibration is already at its defaults.");
    }
    if ((action.kind === "camera.body" && !this.port.frameBody) || (action.kind === "preview.setBody" && !this.port.setBody))
      return refusal("unavailable", NO_BODY);
    // Framing a body that isn't shown frames nothing (UI-79).
    if (action.kind === "camera.body" && this.state.body === false) return refusal("incompatible_mode", "Turn the body on to see the whole body.");
    if (action.kind === "preview.setBody" && typeof action.enabled !== "boolean") return refusal("invalid_value", "Choose on or off.");
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
    let limited: boolean | undefined;
    switch (action.kind) {
      case "camera.front": limited = this.port.front(); break;
      case "camera.body": limited = this.port.frameBody!(); break;
      case "camera.setFov": limited = this.port.setFov(action.degrees); break;
      case "camera.endFovGesture": this.port.endFovGesture(); break;
      case "camera.restore": this.port.restoreCamera(action.camera); break;
      case "camera.navigate": this.port.restoreCamera(navigateCamera(this.port.cameraState(), action.command)); break;
      case "camera.creatorFraming": this.port.restoreCamera(this.port.creatorCamera!(action.page)); break;
      case "preview.setLightingPreset":
        this.port.setLightingPreset?.(action.preset);
        this.state.lightingPreset = action.preset; break;
      case "preview.setCreatorLighting":
        this.state.creatorLighting = { ...this.state.creatorLighting, [action.key]: action.value };
        this.port.setCreatorLighting!(this.state.creatorLighting); break;
      case "preview.resetCreatorLighting":
        this.state.creatorLighting = { ...DEFAULT_CREATOR_LIGHTING };
        this.port.setCreatorLighting!(this.state.creatorLighting); break;
      case "preview.setExposure": this.port.setExposure(action.value); this.state.exposure = action.value; break;
      case "preview.setKeyAngle": this.port.setLightAngle(action.degrees); this.state.lightAngle = action.degrees; break;
      case "preview.setStudioLight":
        this.state.studioLights = { ...this.state.studioLights, [action.key]: action.value };
        this.port.setStudioLights!(this.state.studioLights); break;
      case "preview.setStudioNeutral":
        this.state.studioLights = { ...this.state.studioLights, neutral: action.enabled };
        this.port.setStudioLights!(this.state.studioLights); break;
      case "preview.applyStudioSetup": this.applyStudioStage(STUDIO_SETUPS[action.setup]); break;
      case "preview.resetStudioLighting": this.applyStudioStage(DEFAULT_STUDIO_STAGE); break;
      case "preview.setEyeShape": this.port.setEyeShape(action.index); this.state.eyeShape = action.index; break;
      case "preview.setPiercings": this.port.setPiercings(action.enabled); this.state.piercings = action.enabled; break;
      case "preview.setBody": this.port.setBody!(action.enabled); this.state.body = action.enabled; break;
      case "preview.setSurfaceControls": this.port.setSurfaceControls(action.enabled); this.state.surface = action.enabled; break;
      case "preview.setWire": this.port.setWire(action.enabled); this.state.wire = action.enabled; break;
      case "preview.setNormals": this.port.setNormals(action.enabled); this.state.normals = action.enabled; break;
      case "preview.setEyeOptics": this.port.setEyeOptics(action.enabled); this.state.eyeOwnRoughness = action.enabled; break;
      case "preview.setHair": this.port.setHair(action.enabled); this.state.hair = action.enabled; break;
      case "preview.setDetail": this.port.setDetail(action.detail, action.enabled); this.state[action.detail] = action.enabled; break;
    }
    for (const listener of this.listeners) listener();
    return limited === undefined ? {} : { limited };
  }
  /** The named studio setups for the presentation, and which one the stage matches. */
  studioSetups(): StudioSetupsView {
    return { active: matchingStudioSetup(this.studioStage()),
      setups: STUDIO_SETUP_IDS.map(id => ({ id, label: STUDIO_SETUPS[id].label, title: STUDIO_SETUPS[id].title })) };
  }
  /** The studio stage as the controls set it: the rig, exposure and key angle. */
  studioStage() {
    return { lights: { ...this.state.studioLights }, exposure: this.state.exposure, angle: this.state.lightAngle };
  }
  private applyStudioStage(stage: { lights: Readonly<StudioLights>; exposure: number; angle: number }) {
    this.state.studioLights = { ...stage.lights };
    this.state.exposure = stage.exposure;
    this.state.lightAngle = stage.angle;
    this.port.setStudioLights!(this.state.studioLights);
    this.port.setExposure(stage.exposure);
    this.port.setLightAngle(stage.angle);
  }
  /** Saved facial morph application already changed the renderer; only update the persisted selector. */
  rememberEyeShape(index: number) {
    if (!this.validEyeShape(index)) return;
    this.state.eyeShape = index;
    for (const listener of this.listeners) listener();
  }
}
