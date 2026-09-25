import type { CameraState } from "./workspace-state";
import type { UVSelectionVisibility, UVView } from "./uv-view";
import type { StudioApplication } from "./studio-application";
import type { StudioContextHit } from "./studio-context-targets";
import { NO_MODIFIERS, type EditorInputState, type HeldModifiers } from "./input-bindings";

export type ViewportHostKind = "head" | "uv";
export type UVViewCommand = "both" | "single" | "other" | "fit";
/** Programmatic UV navigation (audit A-5): pan by atlas units, zoom by a factor about a UV point. */
export type UVNavigation = { kind: "pan"; du: number; dv: number } | { kind: "zoom"; factor: number; at?: { u: number; v: number } };
export type ViewportSize = { width: number; height: number };
/**
 * `loading` and `preparing` show progress (`progress` 0–1 when known), `unavailable` is neutral
 * (something is still needed; `message` says what), `error` is a failure (`error` says what).
 */
export type ViewportPhase = "loading" | "preparing" | "unavailable" | "ready" | "error";
export type ViewportHostState = ViewportSize & { phase: ViewportPhase; error?: string; message?: string; progress?: number | null; captured: boolean };
type PhaseState = { phase: ViewportPhase; error?: string; message?: string; progress?: number | null };
export type ViewportAttachmentState = {
  head: ViewportHostState & { view?: CameraState };
  uv: ViewportHostState & { view?: UVView; selection?: UVSelectionVisibility };
};
export type ViewportHit = { hit: StudioContextHit; mirror?: boolean;
  affordance: "point" | "tangent" | "warp-origin" | "warp-vector" | "shape" | "empty" };
/** Read-only input context for hint strips and cursors: held modifiers plus each viewport's report. */
export type ViewportInputSnapshot = Readonly<{ modifiers: HeldModifiers; head: EditorInputState; uv: EditorInputState }>;
export type ViewportContextQuery = ReturnType<StudioApplication["contextQuery"]> &
  Pick<ViewportHit, "mirror" | "affordance"> & { source: ViewportHostKind };

/** Layout/device hooks. A move must reparent the same host, never recreate its editor. */
export type ViewportAttachmentPort<Slot> = {
  moveHost(kind: ViewportHostKind, slot: Slot): void;
  measure(kind: ViewportHostKind): ViewportSize;
  resize(kind: ViewportHostKind): void;
  cancelInput(kind: ViewportHostKind): void;
  inputCapture(kind: ViewportHostKind): boolean;
  headView(): CameraState | undefined;
  uvView(): UVView | undefined;
  /** Optional: whether the selected point/warp is inside the current UV view. */
  uvSelection?(): UVSelectionVisibility | undefined;
  uvCommand(command: UVViewCommand): boolean;
  /** Optional: apply a UV pan/zoom and persist the view. */
  uvNavigate?(command: UVNavigation): boolean;
  hitAt(kind: ViewportHostKind, clientX: number, clientY: number): ViewportHit | undefined;
  queryContext(hit: StudioContextHit): ReturnType<StudioApplication["contextQuery"]>;
};

/** A layout-facing attachment boundary with no scene, worker or editor imports. */
export class ViewportAttachment<Slot> {
  private phases: Record<ViewportHostKind, PhaseState> = {
    head: { phase: "loading" }, uv: { phase: "loading" },
  };
  private listeners = new Set<() => void>();
  private inputListeners = new Set<() => void>();
  private inputState: ViewportInputSnapshot = { modifiers: NO_MODIFIERS, head: { editable: false }, uv: { editable: false } };
  constructor(private port: ViewportAttachmentPort<Slot>) {}
  /**
   * Input context is published on its own channel: hover and modifier changes repaint only the
   * hint strips and cursors, never every panel. Reports are deduplicated here.
   */
  subscribeInput(listener: () => void) { this.inputListeners.add(listener); return () => { this.inputListeners.delete(listener); }; }
  input(): ViewportInputSnapshot { return structuredClone(this.inputState); }
  reportInput(kind: ViewportHostKind, state: EditorInputState) {
    const next = { ...(state.target ? { target: state.target } : {}), ...(state.gesture ? { gesture: state.gesture } : {}), editable: state.editable };
    if (JSON.stringify(next) === JSON.stringify(this.inputState[kind])) return;
    this.inputState = { ...this.inputState, [kind]: next };
    this.publishInput();
  }
  /** Held modifiers from key and pointer events; a lost window focus reports none. */
  reportModifiers(modifiers: HeldModifiers) {
    const next = { ctrl: !!modifiers.ctrl, alt: !!modifiers.alt, shift: !!modifiers.shift }, old = this.inputState.modifiers;
    if (next.ctrl === old.ctrl && next.alt === old.alt && next.shift === old.shift) return;
    this.inputState = { ...this.inputState, modifiers: next };
    this.publishInput();
  }
  private publishInput() { for (const listener of this.inputListeners) listener(); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private publish() { for (const listener of this.listeners) listener(); }
  /** The device reports a view change (UV pan/zoom/mode) so readers of `snapshot()` can repaint. */
  viewChanged() { this.publish(); }
  setReady(kind: ViewportHostKind) { this.phases[kind] = { phase: "ready" }; this.publish(); }
  setError(kind: ViewportHostKind, error: string) { this.setPhase(kind, { phase: "error", error }); }
  /** Not interactive yet: still loading or preparing (with progress), or waiting for something (neutral). */
  setPending(kind: ViewportHostKind, phase: "loading" | "preparing" | "unavailable", message: string, progress: number | null = null) {
    this.setPhase(kind, { phase, message, progress });
  }
  private setPhase(kind: ViewportHostKind, next: PhaseState) {
    if (JSON.stringify(next) === JSON.stringify(this.phases[kind])) return;
    this.phases[kind] = next; this.publish();
  }
  attach(kind: ViewportHostKind, slot: Slot) { this.rehost(kind, slot); }
  /** Rehosting cancels captured gestures but never destroys the editor or its host. */
  rehost(kind: ViewportHostKind, slot: Slot) {
    this.port.cancelInput(kind);
    this.port.moveHost(kind, slot);
    this.resize(kind);
  }
  resize(kind?: ViewportHostKind) {
    for (const key of kind ? [kind] : ["head", "uv"] as const) {
      const size = this.port.measure(key);
      if (visibleViewportSize(size.width, size.height)) this.port.resize(key);
    }
    this.publish();
  }
  cancelInput(kind?: ViewportHostKind) {
    for (const key of kind ? [kind] : ["head", "uv"] as const) this.port.cancelInput(key);
    this.publish();
  }
  uvCommandCapability(command: UVViewCommand) {
    if (this.phases.uv.phase !== "ready") return { available: false as const, reason: "UV editor is not ready." };
    const view = this.port.uvView();
    if (!view) return { available: false as const, reason: "UV view is unavailable." };
    if (command === "other" && view.mode !== "single")
      return { available: false as const, reason: "Switch to single-eye view first." };
    return { available: true as const };
  }
  uvCommand(command: UVViewCommand) {
    const capability = this.uvCommandCapability(command);
    if (!capability.available) return false;
    const changed = this.port.uvCommand(command);
    if (changed) this.publish();
    return changed;
  }
  uvNavigateCapability(command: UVNavigation) {
    if (this.phases.uv.phase !== "ready" || !this.port.uvNavigate) return { available: false as const, reason: "UV editor is not ready." };
    const values = command.kind === "pan" ? [command.du, command.dv] : [command.factor, command.at?.u ?? 0, command.at?.v ?? 0];
    if (!values.every(Number.isFinite) || command.kind === "zoom" && command.factor <= 0)
      return { available: false as const, reason: "UV navigation needs finite values and a positive zoom factor." };
    return { available: true as const };
  }
  /** View state only: no recipe, Undo or selection change. */
  uvNavigate(command: UVNavigation) {
    if (!this.uvNavigateCapability(command).available) return false;
    const changed = this.port.uvNavigate!(command);
    if (changed) this.publish();
    return changed;
  }
  /** Picking is read-only; the application binds identity and geometry revision. */
  contextAt(kind: ViewportHostKind, clientX: number, clientY: number): ViewportContextQuery | undefined {
    if (this.phases[kind].phase !== "ready") return;
    const hit = this.port.hitAt(kind, clientX, clientY);
    if (!hit) return;
    return { ...this.port.queryContext(hit.hit), source: kind,
      affordance: hit.affordance, mirror: hit.mirror };
  }
  snapshot(): ViewportAttachmentState {
    const state = (kind: ViewportHostKind): ViewportHostState => ({
      ...this.phases[kind], ...this.port.measure(kind), captured: this.port.inputCapture(kind),
    });
    return {
      head: { ...state("head"), view: structuredClone(this.port.headView()) },
      uv: { ...state("uv"), view: structuredClone(this.port.uvView()),
        ...(this.port.uvSelection?.() ? { selection: structuredClone(this.port.uvSelection()) } : {}) },
    };
  }
}

export function visibleViewportSize(width: number, height: number): ViewportSize | undefined {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height } : undefined;
}

export function retainedViewportAspect(width: number, height: number, previous: number): number {
  const size = visibleViewportSize(width, height);
  return size ? size.width / size.height : Number.isFinite(previous) && previous > 0 ? previous : 1;
}
