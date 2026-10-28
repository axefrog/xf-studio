/** An accepted operation has only captured dependencies. No live input/router is available in this module. */
import type { CancelResult, CollectionOutcome, CollectionProgress, CollectionRequest } from "../library/collection-service";
import type { FileOperationSources, CapturedCollectionPort, InputCapture, PackageResult, StudioActivity, StudioFileAction, StudioFileOutcome, StudioFilePort, StudioFileState } from "./studio-file-operations";
import { CC_PRESET_LIMITS, readPresetJson } from "../character/cc-preset";
import { refusal } from "../platform/api/capability";

type FileAction = Exclude<StudioFileAction, { kind: "package.stop" }>;
export class AcceptedStudioOperation {
  private sources?: FileOperationSources;
  private collection?: CapturedCollectionPort;
  private readonly device: StudioFilePort;
  private readonly listeners = new Set<() => void>();
  private unsubscribe?: () => void;
  private releaseResult?: () => void;
  private requestStarted = false;
  private requestFloor?: number;
  private terminalProgress?: CollectionProgress;
  private packageResult?: PackageResult;
  private last?: StudioFileState["last"];
  private readonly startedAt = Date.now();
  private running = true;
  private disposed = false;
  private readonly life = new AbortController();
  constructor(readonly id: number, readonly kind: NonNullable<StudioFileState["last"]>["kind"],
    readonly file: boolean, input: { sources: FileOperationSources; collection?: CapturedCollectionPort; device: StudioFilePort;
      capture?: InputCapture; signal: AbortSignal }, private readonly captured = false) {
    this.sources = input.sources; this.collection = input.collection && Object.freeze({ ...input.collection }); this.device = input.device;
    this.capture = input.capture; this.signal = AbortSignal.any([input.signal, this.life.signal]);
    this.unsubscribe = this.collection?.service.subscribe(() => this.notify());
    this.signal.addEventListener("abort", this.abort, { once: true });
    if (this.signal.aborted) this.dispose();
  }
  private capture?: InputCapture;
  private readonly signal: AbortSignal;
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private readonly abort = () => this.dispose();
  private notify() { if (!this.disposed) for (const listener of this.listeners) listener(); }
  isRunning() { return this.running; }
  collectionCapability(request: CollectionRequest) { return this.collection?.service.capability(request); }
  private check(action?: FileAction) {
    const allowed = this.signal.aborted || this.disposed ? refusal("missing_target", "This file destination was released.") : this.capture?.check();
    if (allowed && !allowed.available) throw new FileOperationError(allowed.code ?? "missing_target", allowed.reason ?? "This file destination changed.");
    if (this.captured && action?.kind === "recipe.import" &&
        (this.sources?.collection?.() ?? this.collection?.service.draftIdentity()?.collectionId) !== action.collection)
      throw new FileOperationError("missing_target", "The collection this file was going to is no longer available.");
  }
  private progress(): CollectionProgress | undefined {
    if (!this.running) return this.terminalProgress;
    const progress = this.requestStarted ? this.collection?.service.summary().progress : undefined;
    return progress?.requestId !== this.requestFloor ? progress : undefined;
  }
  snapshot() {
    return { progress: this.progress(), collectionBusy: !!this.activity().some(entry => entry.requestId !== undefined),
      last: this.last, package: this.packageResult && { ...this.packageResult,
        freshness: this.collection?.service.lastPackageIsCurrent() ? "current" as const : "stale" as const } };
  }
  activity(): StudioActivity[] {
    if (!this.running) return [];
    const request = this.requestStarted ? this.collection?.service.activity() : undefined;
    const owned = request && request.requestId !== this.requestFloor ? request : undefined;
    if (!this.file && !owned) return [];
    const kind = this.kind, scope = kind.startsWith("package") ? "package" :
      kind.startsWith("collection") || !this.file ? "collection" : "file";
    return [{ id: `operation-${this.id}`, scope, kind, startedAt: this.startedAt,
      ...(owned ? { requestId: owned.requestId } : {}), cancellable: owned?.cancellable ?? false }];
  }
  cancel(id: string): CancelResult {
    const entry = this.activity().find(entry => entry.id === id);
    return entry?.cancellable && entry.requestId !== undefined ? this.collection!.service.cancel(entry.requestId) :
      { accepted: false, reason: entry ? "This work cannot be cancelled once started; its result will still arrive and can be retried after it completes." : "Nothing with that ID is running." };
  }
  private executeRequest(request: CollectionRequest) {
    this.requestFloor = this.collection?.service.activity()?.requestId; this.requestStarted = true;
    return this.collection!.execute(request);
  }
  /** End this caller's wait even when a picker/transport ignores cancellation; accepted writes stay with their durable owner. */
  private wait<T>(pending: Promise<T>): Promise<T> {
    if (this.signal.aborted || this.disposed) return Promise.reject(new FileOperationError("missing_target", "This file destination was released."));
    const signal = this.signal;
    return new Promise((resolve, reject) => {
      const abort = () => reject(new FileOperationError("missing_target", "This file destination was released."));
      signal.addEventListener("abort", abort, { once: true });
      pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }
  async runFile(action: FileAction): Promise<StudioFileOutcome> {
    const sources = this.sources!, check = () => this.check(action);
    try {
      check();
      let outcome: StudioFileOutcome;
      switch (action.kind) {
        case "workspace.showInFolder": {
          await this.wait(this.device.revealWorkspace!());
          outcome = { ok: true, code: "revealed", message: "Workspace file shown in its folder." }; break;
        }
        case "recipe.import": {
          const file = await this.wait(this.device.pick("recipe", this.signal));
          check();
          if (!file) return this.finish(action.kind, { ok: false, code: "cancelled", message: "Recipe selection cancelled." });
          if (file.size > 1_000_000) throw new FileOperationError("too_large", "Recipe is too large.");
          const format = sources.featureFiles!.portable!;
          const recipe = format.parse(JSON.parse(await this.wait(file.text())));
          check();
          if (recipe === undefined) throw Error(format.invalidMessage);
          format.load(recipe, file.name.replace(/\.json$/i, ""), action.collection);
          outcome = { ok: true, code: "imported", message: `Opened ${file.name}` }; break;
        }
        case "recipe.export":
          // The oldest recipe schema that holds it, so older builds open it too.
          this.device.download(new Blob([JSON.stringify(sources.featureFiles!.portable!.serialize(), null, 2)],
            { type: "application/json" }), sources.featureFiles!.portable!.name);
          outcome = { ok: true, code: "exported", message: sources.featureFiles!.portable!.message }; break;
        case "mask.export": {
          const mask = sources.featureFiles!.mask!, input = mask.capture()!;
          const blob = await this.wait(this.device.bakeMask!(structuredClone(input.value), this.signal));
          check();
          this.device.download(blob, input.name);
          outcome = { ok: true, code: "exported", message: mask.message }; break;
        }
        case "savedV.import": {
          const file = await this.wait(this.device.pick("savedV", this.signal));
          check();
          if (!file) return this.finish(action.kind, { ok: false, code: "cancelled", message: "Saved V selection cancelled." });
          if (file.size > 128 * 1024 * 1024) throw new FileOperationError("too_large", "Save is larger than the supported limit.");
          const bytes = await this.wait(file.bytes()); check();
          const savedAppearance = sources.loadSavedV(bytes, action.character);
          outcome = { ok: true, code: "loaded", message: "Your V is loaded. Skin, face details, eyes, brows, lashes, hair, piercings and body follow in a moment.",
            savedAppearance }; break;
        }
        case "savedV.export":
          this.device.download(new Blob([JSON.stringify(sources.savedV(), null, 2)],
            { type: "application/json" }), "v-appearance.json");
          outcome = { ok: true, code: "exported", message: "Saved appearance exported." }; break;
        case "characterPreset.import": {
          const file = await this.wait(this.device.pick("characterPreset", this.signal));
          check();
          if (!file) return this.finish(action.kind, { ok: false, code: "cancelled", message: "Character preset selection cancelled." });
          if (file.size > CC_PRESET_LIMITS.bytes) throw new FileOperationError("too_large", "This character preset can't be read: the file is larger than 1 MB.");
          // The JSON is read once here and the preset once by the context (CORE-55).
          const bytes = await this.wait(file.bytes()); check();
          sources.characterPreset!.load(readPresetJson(bytes), action.character);
          outcome = { ok: true, code: "loaded", message: `Loaded ${file.name}. Your V's skin, face details, eyes, brows, lashes, hair, piercings and body follow in a moment.` }; break;
        }
        case "characterPreset.export": {
          const saved = await this.wait(sources.characterPreset!.save());
          check();
          this.device.download(new Blob([saved.text], { type: "application/json" }), saved.name);
          const notes = [saved.leftOut ? `${saved.leftOut} choice${saved.leftOut === 1 ? "" : "s"} couldn't be written and ${saved.leftOut === 1 ? "was" : "were"} left out.` : "",
            saved.personal ? `${saved.personal} item${saved.personal === 1 ? "" : "s"} naming a personal folder or address ${saved.personal === 1 ? "was" : "were"} left out.` : ""].filter(Boolean);
          outcome = { ok: true, code: "exported", message: [`Character preset saved with ${saved.values} choice${saved.values === 1 ? "" : "s"}.`, ...notes].join(" ") }; break;
        }
        case "collection.exportWindowCopy": {
          const copy = this.collection!.service.exportWindowCopy();
          this.device.download(new Blob([copy.json], { type: "application/json" }), copy.name);
          outcome = { ok: true, code: "exported", message: copy.message }; break;
        }
        case "collection.recover":
          sources.recoverCollection(action.draft);
          outcome = { ok: true, code: "recovered", message: action.draft !== undefined
            ? "Reopened that draft. The one you had open is first under Recent drafts." : "Reopened the previous collection." }; break;
        default: {
          let request: CollectionRequest;
          if (action.kind === "collection.import") {
            const file = await this.wait(this.device.pick("collection", this.signal));
            check();
            if (!file) return this.finish(action.kind, { ok: false, code: "cancelled", message: "Collection selection cancelled." });
            // Keep the service's exact size validation and error code.
            request = { kind: "import", text: file.size > 16_000_000 ? "" : await this.wait(file.text()), bytes: file.size };
            check();
          } else request = collectionRequest(action.kind);
          const result = await this.wait(this.executeRequest(request));
          if (this.signal.aborted || this.disposed) this.check();
          // Import publishes its new binding in the same accepted command. That intentional transition is its successful result.
          if (action.kind !== "collection.import") check();
          if (!result.ok) { outcome = result; break; }
          if (result.result.kind === "export")
            this.device.download(new Blob([result.result.json], { type: "application/json" }), result.result.name);
          if (result.result.kind === "packageCheck" || result.result.kind === "packageBuild")
            this.packageResult = structuredClone(result.result);
          outcome = { ok: true, code: result.result.kind,
            message: sources.message?.() ?? this.collection?.service.summary().progress?.message ?? "Collection operation completed.", result: result.result };
        }
      }
      return this.finish(action.kind, outcome);
    } catch (error) {
      const code = error instanceof FileOperationError ? error.code : error instanceof SyntaxError ? "invalid_json" : "file_failed";
      const prefix = action.kind === "recipe.import" ? "Could not open recipe: " :
        action.kind === "savedV.import" ? "Could not apply V: " : "";
      if (action.kind === "characterPreset.import" && error instanceof SyntaxError)
        return this.finish(action.kind, { ok: false, code: "invalid_json", message: "This character preset can't be read: it is not valid JSON." });
      return this.finish(action.kind, { ok: false, code, message: prefix + (error as Error).message });
    } finally { this.complete(); }
  }
  async runCollection(request: CollectionRequest): Promise<CollectionOutcome> {
    try {
      this.check();
      const result = await this.wait(this.executeRequest(request));
      if (this.signal.aborted || this.disposed) this.check();
      if (result.ok && result.result.kind === "export")
        this.device.download(new Blob([result.result.json], { type: "application/json" }), result.result.name);
      if (result.ok && (result.result.kind === "packageCheck" || result.result.kind === "packageBuild"))
        this.packageResult = structuredClone(result.result);
      this.last = { kind: this.kind, ok: result.ok, code: result.ok ? result.result.kind : result.code,
        message: result.ok ? this.sources!.message?.() ?? this.progress()?.message ?? "Collection operation completed." : result.message, at: Date.now() };
      return result;
    } catch (error) {
      const outcome = { ok: false as const, code: error instanceof FileOperationError ? error.code : "request_failed", message: (error as Error).message };
      this.finish(this.kind, outcome); return outcome;
    } finally { this.complete(); }
  }
  private finish(kind: NonNullable<StudioFileState["last"]>["kind"], outcome: StudioFileOutcome): StudioFileOutcome {
    if (this.signal.aborted || this.disposed) return { ok: false, code: "missing_target", message: "This file destination was released." };
    this.last = { kind, ok: outcome.ok, code: outcome.code, message: outcome.message, at: Date.now() }; return outcome;
  }
  private complete() {
    if (this.disposed) return;
    this.terminalProgress = this.progress();
    if (this.packageResult && !this.disposed) this.releaseResult = this.collection?.service.retainPackageResult();
    else { this.unsubscribe?.(); this.unsubscribe = undefined; this.collection = undefined; }
    this.running = false; this.sources = undefined;
    this.capture?.release(); this.capture = undefined;
    this.notify();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.signal.removeEventListener("abort", this.abort);
    const build = this.activity().find(entry => entry.cancellable); if (build) this.cancel(build.id);
    this.life.abort();
    this.unsubscribe?.(); this.unsubscribe = undefined; this.releaseResult?.(); this.releaseResult = undefined; this.listeners.clear();
    this.running = false; this.sources = undefined; this.collection = undefined;
    this.capture?.release(); this.capture = undefined;
  }
}
class FileOperationError extends Error { constructor(readonly code: string, message: string) { super(message); } }
export function collectionRequest(kind: StudioFileAction["kind"]): CollectionRequest {
  switch (kind) {
    case "collection.import": return { kind: "import", text: "", bytes: 0 };
    case "collection.export": return { kind: "exportCollection" };
    case "collection.plan": return { kind: "exportPlan" };
    case "package.check": return { kind: "package", action: "check" };
    case "package.build": return { kind: "package", action: "build" };
    default: return { kind: "initialize" };
  }
}
