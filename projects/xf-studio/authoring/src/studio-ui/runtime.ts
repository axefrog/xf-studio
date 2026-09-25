import type { CollectionOutcome, CollectionRequest } from "../collection-service";
import type { ValueSchema } from "../studio-action-descriptors";
import type { StudioAction } from "../studio-application";
import type { StudioFileAction, StudioFileOutcome } from "../studio-file-operations";
import type { StudioPresentationPort } from "../studio-presentation";
import type { DockView } from "./dock/dock-view";
import type { Feedback, FeedbackAction } from "./feedback";

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
  get recipe() { return this.once("recipe", () => this.port.editor.recipe()); }
  get layer() { return this.once("layer", () => this.port.editor.layer()); }
  get active() { return this.once("active", () => this.port.editor.active()); }
  get selected() { return this.once("selected", () => this.port.editor.selected()); }
  get field() { return this.once("field", () => this.port.editor.selectedField()); }
  get revision() { return this.once("revision", () => this.port.editor.revision()); }
  get canUndo() { return this.once("canUndo", () => this.port.editor.canUndo()); }
  get library() { return this.once("library", () => this.port.library.summary()); }
  get persistence() { return this.once("persistence", () => this.port.library.persistence()); }
  get files() { return this.once("files", () => this.port.files.snapshot()); }
  get preview() { return this.once("preview", () => this.port.authoring.previewState()); }
  get readiness() { return this.once("readiness", () => this.port.previewReadiness.snapshot()); }
  get viewport() { return this.once("viewport", () => this.port.viewport.snapshot()); }
  get status() { return this.once("status", () => this.port.status.snapshot()); }
  get localSetup() { return this.once("localSetup", () => this.port.localSetup.snapshot()); }
}
export type FrameState = Frame;

const sources: [RegExp, string][] = [
  [/^recipe\.(undo|redo)$/, "Undo"], [/^preset\./, "Presets"], [/^layer\.(edit|setEnabled|select)$/, "Layers"],
  [/^(point|path|field|pigment|softness|shape)\./, "Shape"], [/^(layer\.set|glitter\.)/, "Colour & finish"],
  [/^camera\./, "Camera"], [/^preview\./, "Preview"], [/^motion\./, "Motion"], [/^quality\./, "Preview quality"],
  [/^collection\./, "Library"], [/^savedV\./, "Saved V"],
];
export const sourceLabel = (kind: string) => sources.find(([pattern]) => pattern.test(kind))?.[1] ?? "Studio";

/** Shared presentation services. Holds no authored state of its own. */
export class StudioRuntime {
  dock!: DockView;
  readonly descriptors: Ret<Port["authoring"]["actionDescriptors"]>;
  readonly finishes: Ret<Port["authoring"]["finishCatalogue"]>;
  readonly glitterModels: Ret<Port["authoring"]["glitterModelCatalogue"]>;
  private listeners = new Set<() => void>();
  constructor(readonly port: Port, readonly feedback: Feedback) {
    this.descriptors = port.authoring.actionDescriptors();
    this.finishes = port.authoring.finishCatalogue();
    this.glitterModels = port.authoring.glitterModelCatalogue();
  }
  /** Descriptor limits drive control ranges, so the view keeps no copy of domain constants. */
  range(kind: StudioAction["kind"], field: string, variant?: string): { min: number; max: number } {
    const descriptor = this.descriptors[kind] as { payload: Record<string, ValueSchema>; variants?: Record<string, { payload: Record<string, ValueSchema> }> };
    const schema = (variant ? descriptor.variants?.[variant]?.payload[field] : undefined) ?? descriptor.payload[field];
    return { min: schema?.min ?? 0, max: schema?.max ?? 1 };
  }
  /** Validated dispatch. Failures surface their typed reason; nothing is retried silently. */
  dispatch(action: StudioAction, options: { success?: string; quiet?: boolean; failure?: string } = {}) {
    const result = this.port.authoring.dispatch(action);
    if (!result.ok) {
      // Something not in this alpha is information, not an error.
      if (!options.quiet) this.feedback.toast(result.code === "busy" ? "warning" : result.code === "asset_unavailable" ? "info" : "error", sourceLabel(action.kind),
        options.failure ?? result.message);
      return false;
    }
    if (options.success) this.feedback.record("success", sourceLabel(action.kind), options.success);
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
  /** Layer creation; the application refuses it (with a reason) while no preset owns the editor. */
  addLayerCapability() {
    return this.port.authoring.capability({ kind: "layer.edit", command: { kind: "add" } });
  }
  /** A toast "Undo" that only undoes the change it announced, never a later unrelated edit. */
  undoAction(): FeedbackAction {
    const revision = this.port.editor.revision();
    return { label: "Undo", run: () => {
      if (this.port.editor.revision() !== revision) {
        this.feedback.toast("warning", "Undo", "Other edits happened since. Use Undo (Ctrl+Z) to step back through them in order.");
        return;
      }
      this.dispatch({ kind: "recipe.undo" });
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
