import type { CameraState, PreviewState } from "./workspace-state";

export type PreviewConfig = Pick<PreviewState,
  "surface" | "wire" | "brows" | "lashes" | "hair" | "piercings" | "piercingStyle" | "piercingDefinition" |
  "eyeShape" | "normals" | "eyeOptics" | "exposure" | "lightAngle">;
export type PreviewAction =
  | { kind: "camera.front" }
  | { kind: "camera.setFov"; degrees: number }
  | { kind: "camera.endFovGesture" }
  | { kind: "camera.restore"; camera: CameraState }
  | { kind: "preview.setExposure"; value: number }
  | { kind: "preview.setKeyAngle"; degrees: number }
  | { kind: "preview.setEyeShape"; index: number }
  | { kind: "preview.setPiercingPreview"; style: string; definition: string }
  | { kind: "preview.setPiercings"; enabled: boolean }
  | { kind: "preview.setSurfaceControls" | "preview.setWire" | "preview.setNormals" | "preview.setEyeOptics" | "preview.setHair"; enabled: boolean }
  | { kind: "preview.setDetail"; detail: "brows" | "lashes"; enabled: boolean };
export type PreviewActionResult = { limited?: boolean };
export type PreviewCapability = { available: boolean; reason?: string };
export type PiercingPreviewOption = { id: string; label: string;
  choices: { index: number; definition: string; label: string }[] };
export type PreviewPort = {
  cameraState(): CameraState; front(): boolean; setFov(degrees: number): boolean | undefined; endFovGesture(): void;
  restoreCamera(camera: CameraState): void;
  setExposure(value: number): void; setLightAngle(degrees: number): void;
  setSurfaceControls(enabled: boolean): void; setWire(enabled: boolean): void; setNormals(enabled: boolean): void;
  setEyeOptics(enabled: boolean): void; setHair(enabled: boolean): void;
  setEyeShape(index: number): void; setPiercings(enabled: boolean): void;
  setPiercingPreview(style: string, definition: string): void;
  piercingOptions?(): PiercingPreviewOption[];
  setDetail(detail: "brows" | "lashes", enabled: boolean): void;
  availability?(target: "brows" | "lashes" | "hair"): string | undefined;
};

/** Preview preferences and camera commands are independent of the DOM and the Three scene type. */
export class PreviewActions {
  private state: PreviewConfig;
  private listeners = new Set<() => void>();
  constructor(initial: PreviewState, private port: PreviewPort) {
    this.state = { surface: initial.surface, wire: initial.wire, brows: initial.brows,
      lashes: initial.lashes, hair: initial.hair, normals: initial.normals, eyeOptics: initial.eyeOptics,
      eyeShape: initial.eyeShape, piercings: initial.piercings, piercingStyle: initial.piercingStyle,
      piercingDefinition: initial.piercingDefinition,
      exposure: initial.exposure, lightAngle: initial.lightAngle };
  }
  piercingOptions(): Readonly<PiercingPreviewOption[]> {
    return structuredClone(this.port.piercingOptions?.() ?? []);
  }
  snapshot(): Readonly<PreviewConfig & { camera: CameraState }> {
    return structuredClone({ ...this.state, camera: this.port.cameraState() });
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  capability(action: PreviewAction): PreviewCapability {
    if (action.kind === "camera.setFov" && (!Number.isFinite(action.degrees) || action.degrees < 10 || action.degrees > 90))
      return { available: false, reason: "Field of view must be between 10° and 90°." };
    if (action.kind === "preview.setExposure" && (!Number.isFinite(action.value) || action.value < .5 || action.value > 2))
      return { available: false, reason: "Exposure must be between 0.5 and 2." };
    if (action.kind === "preview.setKeyAngle" && (!Number.isFinite(action.degrees) || action.degrees < 0 || action.degrees > 360))
      return { available: false, reason: "Key light angle must be between 0° and 360°." };
    if (action.kind === "preview.setEyeShape" && (!Number.isInteger(action.index) || action.index < 0 || action.index > 21))
      return { available: false, reason: "Eye shape must be between 0 and 21." };
    if (action.kind === "preview.setPiercingPreview" && action.style) {
      const option = this.port.piercingOptions?.().find(item => item.id === action.style);
      if (!option || !option.choices.some(choice => choice.definition === action.definition))
        return { available: false, reason: "That piercing style or colour is unavailable." };
    }
    if (action.kind === "preview.setPiercings" && action.enabled && !this.port.piercingOptions?.().length)
      return { available: false, reason: "Piercing preview assets are unavailable." };
    const target = action.kind === "preview.setDetail" ? action.detail : action.kind === "preview.setHair" ? "hair" : undefined;
    const requested = action.kind === "preview.setDetail" || action.kind === "preview.setHair" ? action.enabled : false;
    const unavailable = target && requested && this.port.availability?.(target);
    if (unavailable) return { available: false, reason: unavailable };
    return { available: true };
  }
  dispatch(action: PreviewAction): PreviewActionResult {
    const capability = this.capability(action);
    if (!capability.available) throw Error(capability.reason);
    let limited: boolean | undefined;
    switch (action.kind) {
      case "camera.front": limited = this.port.front(); break;
      case "camera.setFov": limited = this.port.setFov(action.degrees); break;
      case "camera.endFovGesture": this.port.endFovGesture(); break;
      case "camera.restore": this.port.restoreCamera(action.camera); break;
      case "preview.setExposure": this.port.setExposure(action.value); this.state.exposure = action.value; break;
      case "preview.setKeyAngle": this.port.setLightAngle(action.degrees); this.state.lightAngle = action.degrees; break;
      case "preview.setEyeShape": this.port.setEyeShape(action.index); this.state.eyeShape = action.index; break;
      case "preview.setPiercings": this.port.setPiercings(action.enabled); this.state.piercings = action.enabled; break;
      case "preview.setPiercingPreview": this.port.setPiercingPreview(action.style, action.definition);
        this.state.piercingStyle = action.style; this.state.piercingDefinition = action.definition; break;
      case "preview.setSurfaceControls": this.port.setSurfaceControls(action.enabled); this.state.surface = action.enabled; break;
      case "preview.setWire": this.port.setWire(action.enabled); this.state.wire = action.enabled; break;
      case "preview.setNormals": this.port.setNormals(action.enabled); this.state.normals = action.enabled; break;
      case "preview.setEyeOptics": this.port.setEyeOptics(action.enabled); this.state.eyeOptics = action.enabled; break;
      case "preview.setHair": this.port.setHair(action.enabled); this.state.hair = action.enabled; break;
      case "preview.setDetail": this.port.setDetail(action.detail, action.enabled); this.state[action.detail] = action.enabled; break;
    }
    for (const listener of this.listeners) listener();
    return limited === undefined ? {} : { limited };
  }
  /** Saved facial morph application already changed the renderer; only update the persisted selector. */
  rememberEyeShape(index: number) {
    if (!Number.isInteger(index) || index < 0 || index > 21) return;
    this.state.eyeShape = index;
    for (const listener of this.listeners) listener();
  }
}
