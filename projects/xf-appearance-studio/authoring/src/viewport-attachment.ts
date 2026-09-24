import type { CameraState } from "./workspace-state";
import type { UVView } from "./uv-view";
import type { StudioApplication } from "./studio-application";
import type { StudioContextHit } from "./studio-context-targets";

export type ViewportHostKind = "head" | "uv";
export type ViewportSize = { width: number; height: number };
export type ViewportPhase = "loading" | "ready" | "error";
export type ViewportHostState = ViewportSize & { phase: ViewportPhase; error?: string; captured: boolean };
export type ViewportAttachmentState = {
  head: ViewportHostState & { view?: CameraState };
  uv: ViewportHostState & { view?: UVView };
};
export type ViewportHit = { hit: StudioContextHit; mirror?: boolean;
  affordance: "point" | "tangent" | "warp-origin" | "warp-vector" | "shape" | "empty" };
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
  hitAt(kind: ViewportHostKind, clientX: number, clientY: number): ViewportHit | undefined;
  queryContext(hit: StudioContextHit): ReturnType<StudioApplication["contextQuery"]>;
};

/** A layout-facing attachment boundary with no scene, worker or editor imports. */
export class ViewportAttachment<Slot> {
  private phases: Record<ViewportHostKind, { phase: ViewportPhase; error?: string }> = {
    head: { phase: "loading" }, uv: { phase: "loading" },
  };
  private listeners = new Set<() => void>();
  constructor(private port: ViewportAttachmentPort<Slot>) {}
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private publish() { for (const listener of this.listeners) listener(); }
  setReady(kind: ViewportHostKind) { this.phases[kind] = { phase: "ready" }; this.publish(); }
  setError(kind: ViewportHostKind, error: string) {
    this.phases[kind] = { phase: "error", error }; this.publish();
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
      uv: { ...state("uv"), view: structuredClone(this.port.uvView()) },
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
