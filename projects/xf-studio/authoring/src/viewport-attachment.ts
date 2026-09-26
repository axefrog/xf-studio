import type { CameraState } from "./workspace-state";
import type { UVSelectionVisibility, UVView } from "./uv-view";
import type { StudioApplication } from "./studio-application";
import type { StudioContextHit } from "./studio-context-targets";
import { NO_MODIFIERS, type EditorInputState, type HeldModifiers, type UVViewCommand, type ViewportScope } from "./input-bindings";
import { MAIN_VIEW, viewPanelId } from "./platform/api/view-graph";

export type { UVViewCommand };
/**
 * A viewport host's ID: a 3D view's panel (`head` for the main view, `view.<id>` for others; view-graph-design.md §3.1) or a flat
 * editor's (`uv`). Hosts are registered by the device, not a fixed set; `head` stays the main view's alias for every caller.
 */
export type ViewportHostId = string;
/** The hosts a browser viewport device registers today (the main 3D view `head` and the flat UV editor `uv`): the binding scopes. */
export type ViewportHostKind = ViewportScope;
export const DEFAULT_VIEWPORT_HOSTS: readonly ViewportHostKind[] = [viewPanelId(MAIN_VIEW) as ViewportHostKind, "uv"];
/** Programmatic UV navigation (audit A-5): pan by atlas units, zoom by a factor about a UV point. */
export type UVNavigation = { kind: "pan"; du: number; dv: number } | { kind: "zoom"; factor: number; at?: { u: number; v: number } };
import { visibleViewportSize, type ViewportSize } from "./viewport-size";
export type { ViewportSize };
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
/** Read-only input context for hint strips and cursors: held modifiers plus each viewport's report (`head` and `uv` always present). */
export type ViewportInputSnapshot = Readonly<{ modifiers: HeldModifiers; head: EditorInputState; uv: EditorInputState } &
  Record<ViewportHostId, EditorInputState | HeldModifiers>>;
export type ViewportContextQuery = ReturnType<StudioApplication["contextQuery"]> &
  Pick<ViewportHit, "mirror" | "affordance"> & { source: ViewportHostId };

/** Layout/device hooks. A move must reparent the same host, never recreate its editor. */
export type ViewportAttachmentPort<Slot, Host extends ViewportHostId = ViewportHostKind> = {
  moveHost(kind: Host, slot: Slot): void;
  measure(kind: Host): ViewportSize;
  resize(kind: Host): void;
  cancelInput(kind: Host): void;
  inputCapture(kind: Host): boolean;
  headView(): CameraState | undefined;
  uvView(): UVView | undefined;
  /** Optional: whether the selected point/warp is inside the current UV view. */
  uvSelection?(): UVSelectionVisibility | undefined;
  uvCommand(command: UVViewCommand): boolean;
  /** Optional: apply a UV pan/zoom and persist the view. */
  uvNavigate?(command: UVNavigation): boolean;
  hitAt(kind: Host, clientX: number, clientY: number): ViewportHit | undefined;
  queryContext(hit: StudioContextHit): ReturnType<StudioApplication["contextQuery"]>;
};

/** A layout-facing attachment boundary with no scene, worker or editor imports. */
export class ViewportAttachment<Slot, Host extends ViewportHostId = ViewportHostKind> {
  private phases = new Map<Host, PhaseState>();
  private listeners = new Set<() => void>();
  private inputListeners = new Set<() => void>();
  private inputState: ViewportInputSnapshot;
  /** @param hosts the hosts the device registers (the main view's `head` and the flat editor's `uv` by default) */
  constructor(private port: ViewportAttachmentPort<Slot, Host>, private readonly hosts: readonly Host[] = DEFAULT_VIEWPORT_HOSTS as readonly Host[]) {
    for (const host of hosts) this.phases.set(host, { phase: "loading" });
    this.inputState = { modifiers: NO_MODIFIERS, ...Object.fromEntries(hosts.map(host => [host, { editable: false }])) } as ViewportInputSnapshot;
  }
  /** A host this attachment registers; any other ID is a caller error. */
  private known(host: Host) {
    if (!this.phases.has(host)) throw Error(`There is no viewport ${host}.`);
    return host;
  }
  /**
   * Input context is published on its own channel: hover and modifier changes repaint only the
   * hint strips and cursors, never every panel. Reports are deduplicated here.
   */
  subscribeInput(listener: () => void) { this.inputListeners.add(listener); return () => { this.inputListeners.delete(listener); }; }
  input(): ViewportInputSnapshot { return structuredClone(this.inputState); }
  reportInput(kind: Host, state: EditorInputState) {
    this.known(kind);
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
  setReady(kind: Host) { this.phases.set(this.known(kind), { phase: "ready" }); this.publish(); }
  setError(kind: Host, error: string) { this.setPhase(kind, { phase: "error", error }); }
  /** Not interactive yet: still loading or preparing (with progress), or waiting for something (neutral). */
  setPending(kind: Host, phase: "loading" | "preparing" | "unavailable", message: string, progress: number | null = null) {
    this.setPhase(kind, { phase, message, progress });
  }
  private setPhase(kind: Host, next: PhaseState) {
    if (JSON.stringify(next) === JSON.stringify(this.phases.get(this.known(kind)))) return;
    this.phases.set(kind, next); this.publish();
  }
  attach(kind: Host, slot: Slot) { this.rehost(kind, slot); }
  /** Rehosting cancels captured gestures but never destroys the editor or its host. */
  rehost(kind: Host, slot: Slot) {
    this.known(kind);
    this.port.cancelInput(kind);
    this.port.moveHost(kind, slot);
    this.resize(kind);
  }
  resize(kind?: Host) {
    for (const key of kind ? [this.known(kind)] : this.hosts) {
      const size = this.port.measure(key);
      if (visibleViewportSize(size.width, size.height)) this.port.resize(key);
    }
    this.publish();
  }
  cancelInput(kind?: Host) {
    for (const key of kind ? [this.known(kind)] : this.hosts) this.port.cancelInput(key);
    this.publish();
  }
  uvCommandCapability(command: UVViewCommand) {
    if (this.phases.get("uv" as Host)?.phase !== "ready") return { available: false as const, reason: "UV editor is not ready." };
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
    if (this.phases.get("uv" as Host)?.phase !== "ready" || !this.port.uvNavigate) return { available: false as const, reason: "UV editor is not ready." };
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
  contextAt(kind: Host, clientX: number, clientY: number): ViewportContextQuery | undefined {
    if (this.phases.get(kind)?.phase !== "ready") return;
    const hit = this.port.hitAt(kind, clientX, clientY);
    if (!hit) return;
    return { ...this.port.queryContext(hit.hit), source: kind,
      affordance: hit.affordance, mirror: hit.mirror };
  }
  snapshot(): ViewportAttachmentState {
    const state = (kind: Host): ViewportHostState => ({
      ...(this.phases.get(kind) ?? { phase: "loading" as const }), ...this.port.measure(kind), captured: this.port.inputCapture(kind),
    });
    return {
      head: { ...state("head" as Host), view: structuredClone(this.port.headView()) },
      uv: { ...state("uv" as Host), view: structuredClone(this.port.uvView()),
        ...(this.port.uvSelection?.() ? { selection: structuredClone(this.port.uvSelection()) } : {}) },
    };
  }
}

export { retainedViewportAspect, visibleViewportSize } from "./viewport-size";
