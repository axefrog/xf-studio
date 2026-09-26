import { shortcutLabel } from "../input-bindings";
import type { CollectionOutcome, CollectionRequest } from "../collection-service";
import type { ValueSchema } from "../studio-action-descriptors";
import type { StudioAction, StudioDispatchResult } from "../studio-application";
import type { StudioFileAction, StudioFileOutcome } from "../studio-file-operations";
import type { EyeMakeupFacade, StudioPresentationPort } from "../studio-presentation";
import type { DockView } from "./dock/dock-view";
import type { Feedback, FeedbackAction } from "./feedback";
import { AnchorRegistry } from "./guidance/anchors";
import { activitySource, viewCatalogue, type ViewCatalogue } from "./views/contribution";
import { SHELL_VIEW } from "./views/shell";

export type Port = StudioPresentationPort<HTMLElement>;
type Ret<T extends (...args: never[]) => unknown> = ReturnType<T>;

/** Reads for one paint. Each getter touches the port at most once per frame. */
export class Frame {
  private cache = new Map<string, unknown>();
  constructor(private port: Port) {}
  private once<T>(key: string, read: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, read());
    return this.cache.get(key) as T;
  }
  /** Eye makeup's editor view (its facade's `view()`): the eye-makeup reads below are a recorded coupling (UI-75). */
  private get editor() { return this.port.feature("eye-makeup").view(); }
  get recipe() { return this.once("recipe", () => this.editor.recipe()); }
  get layer() { return this.once("layer", () => this.editor.layer()); }
  get active() { return this.once("active", () => this.editor.active()); }
  get selected() { return this.once("selected", () => this.editor.selected()); }
  get field() { return this.once("field", () => this.editor.selectedField()); }
  get revision() { return this.once("revision", () => this.editor.revision()); }
  /** Whether Undo has a step: the look-wide history, across every feature's part. */
  get canUndo() { return this.once("canUndo", () => this.port.authoring.history().undo !== undefined); }
  /** The plain reason when the selected look was made with a newer XF Studio (its eye makeup is kept as it is); else undefined. */
  get locked() { return this.once("locked", () => this.port.feature("eye-makeup").locked()); }
  get library() { return this.once("library", () => this.port.library.summary()); }
  get persistence() { return this.once("persistence", () => this.port.library.persistence()); }
  get files() { return this.once("files", () => this.port.files.snapshot()); }
  get preview() { return this.once("preview", () => this.port.authoring.previewState()); }
  get readiness() { return this.once("readiness", () => this.port.previewReadiness.snapshot()); }
  get viewport() { return this.once("viewport", () => this.port.viewport.snapshot()); }
  get status() { return this.once("status", () => this.port.status.snapshot()); }
  get localSetup() { return this.once("localSetup", () => this.port.localSetup.snapshot()); }
  get previewSetup() { return this.once("previewSetup", () => this.port.previewSetup.snapshot()); }
  get preferences() { return this.once("preferences", () => this.port.preferences.snapshot()); }
  get history() { return this.once("history", () => this.port.authoring.historyTimeline()); }
}
export type FrameState = Frame;
/** How a dispatch reports: `success` is recorded, a failure toasts unless `quiet` (with `failure` instead of its reason). */
export type DispatchFeedback = { success?: string; quiet?: boolean; failure?: string };

/** The shell's catalogue alone: what a runtime built without a composition (fixtures) reports under. */
const SHELL_CATALOGUE = viewCatalogue([SHELL_VIEW]);

/** Shared presentation services. Holds no authored state of its own. */
export class StudioRuntime {
  dock!: DockView;
  /** Named guidance anchors that panels and the shell register as they build their controls. */
  readonly anchors = new AnchorRegistry();
  readonly descriptors: Ret<Port["authoring"]["actionDescriptors"]>;
  /**
   * Eye makeup's facade and finish catalogue, for the shell's remaining eye-makeup reads (context-menu values,
   * viewport crumbs and hints, guidance facts and tours, the finish lists in Help and Mod package, the toast
   * Undo's revision check). Recorded couplings (UI-75, ui-architecture-boundary.md) that go once the shell
   * mounts with no features; feature views never see the runtime (they get a `FeatureViewContext`).
   */
  readonly eyeMakeup: EyeMakeupFacade;
  readonly finishes: Ret<EyeMakeupFacade["finishCatalogue"]>;
  private listeners = new Set<() => void>();
  /**
   * @param views the catalogue of every contributed panel (the shell's and each feature's) that the
   *   composition root handed `mountStudio`.
   */
  constructor(readonly port: Port, readonly feedback: Feedback, readonly views: ViewCatalogue = SHELL_CATALOGUE) {
    this.descriptors = port.authoring.actionDescriptors();
    this.eyeMakeup = port.feature("eye-makeup");
    this.finishes = this.eyeMakeup.finishCatalogue();
  }
  /** Eye makeup's live editor view (cheap, cached and read-only). */
  get editor() { return this.eyeMakeup.view(); }
  /** Descriptor limits drive control ranges, so the view keeps no copy of domain constants. */
  range(kind: StudioAction["kind"], field: string, variant?: string): { min: number; max: number } {
    const descriptor = this.descriptors[kind] as { payload: Record<string, ValueSchema>; variants?: Record<string, { payload: Record<string, ValueSchema> }> };
    const schema = (variant ? descriptor.variants?.[variant]?.payload[field] : undefined) ?? descriptor.payload[field];
    return { min: schema?.min ?? 0, max: schema?.max ?? 1 };
  }
  /** The activity-log source an action kind reports under, from the view contributions. */
  sourceLabel(kind: string) { return activitySource(kind, this.views); }
  /** Validated dispatch. Failures surface their typed reason; nothing is retried silently. */
  dispatch(action: StudioAction, options: DispatchFeedback = {}) {
    return this.report(action.kind, this.port.authoring.dispatch(action), options);
  }
  /**
   * The feedback for a dispatch result, however it was dispatched (the port, or a feature's facade):
   * a failure toasts its typed reason unless quiet, a success records `options.success`. Returns whether it succeeded.
   */
  report(kind: string, result: StudioDispatchResult, options: DispatchFeedback = {}) {
    if (!result.ok) {
      // Something not available yet is information, not an error.
      if (!options.quiet) this.feedback.toast(result.code === "busy" ? "warning" : result.code === "asset_unavailable" ? "info" : "error", this.sourceLabel(kind),
        options.failure ?? result.message);
      return false;
    }
    if (options.success) this.feedback.record("success", this.sourceLabel(kind), options.success);
    return true;
  }
  async file(action: StudioFileAction, options: { quietSuccess?: boolean; actions?: FeedbackAction[] } = {}): Promise<StudioFileOutcome> {
    const outcome = await this.port.files.execute(action);
    const source = fileSource(action.kind);
    if (!outcome.ok) {
      if (outcome.code === "cancelled") this.feedback.record("info", source, outcome.message);
      else this.feedback.toast(outcome.code === "busy" || outcome.code === "unavailable" ? "warning" : "error", source, outcome.message,
        recoveryFor(outcome.code, this));
    } else if (options.quietSuccess) this.feedback.record("success", source, outcome.message);
    else this.feedback.toast("success", source, outcome.message, options.actions);
    this.changed();
    return outcome;
  }
  async request(request: CollectionRequest, options: { quietSuccess?: boolean; actions?: FeedbackAction[] } = {}): Promise<CollectionOutcome> {
    const outcome = await this.port.library.execute(request);
    const source = request.kind === "package" ? "Mod package" : "Library";
    if (!outcome.ok) this.feedback.toast(outcome.code === "unavailable" ? "warning" : "error", source, outcome.message, recoveryFor(outcome.code, this));
    else {
      const message = this.port.library.summary().progress?.message ?? "Done.";
      if (options.quietSuccess) this.feedback.record("success", source, message);
      else this.feedback.toast("success", source, message, options.actions);
    }
    this.changed();
    return outcome;
  }
  /** A toast "Undo" that only undoes the change it announced, never a later unrelated edit. */
  undoAction(): FeedbackAction {
    const revision = this.editor.revision();
    return { label: "Undo", run: () => {
      if (this.editor.revision() !== revision) {
        this.feedback.toast("warning", "Undo", `Other edits happened since. Use Undo (${shortcutLabel("shell.undo")}) to step back through them in order.`);
        return;
      }
      this.dispatch({ kind: "history.undo" });
    } };
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /** Presentation-local changes (feedback log, drag state) that need a repaint. */
  changed() { for (const listener of this.listeners) listener(); }
}

function fileSource(kind: StudioFileAction["kind"]) {
  return kind.startsWith("package") ? "Mod package" : kind.startsWith("savedV") ? "Saved V" :
    kind === "mask.export" ? "Mask export" : kind.startsWith("recipe") ? "Recipe" : "Library";
}
function recoveryFor(code: string, runtime: StudioRuntime): FeedbackAction[] {
  if (code === "conflict") return [
    { label: "Refresh library", run: () => void runtime.request({ kind: "refresh" }) },
    { label: "Save as copy", run: () => void runtime.request({ kind: "saveCopy" }) },
  ];
  if (code === "stale_result") return [{ label: "Refresh library", run: () => void runtime.request({ kind: "refresh" }) }];
  return [];
}
