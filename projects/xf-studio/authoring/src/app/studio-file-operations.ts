import { BUILD_NEEDS_SETUP, BUILD_TOOLS_CHECKING_REASON } from "./alpha-availability";
import type { CancelResult, CollectionOutcome, CollectionProgress, CollectionRequest, CollectionResult, CollectionService } from "../library/collection-service";
import type { PackageBuildResult, PackageCheckResult } from "../platform/api";
import type { Layer, Recipe } from "../engines/layered-makeup/recipe";
import { portableRecipe, readPortableRecipe, RECIPE_FILE_MESSAGE } from "../legacy/eye-makeup/recipe-schema";
import type { ReadonlyDeep } from "../platform/api/read-only";
import type { SavedAppearanceState } from "../character/saved-appearance-actions";
import type { SavedV } from "../saves/save-reader";
import { CC_PRESET_LIMITS, readPresetJson } from "../character/cc-preset";
import { refusal, type Capability, type ReasonCode } from "../platform/api/capability";

export type StudioFileKind = "recipe" | "collection" | "savedV" | "characterPreset";
export type StudioPickedFile = { name: string; size: number; text(): Promise<string>; bytes(): Promise<Uint8Array> };
export type StudioFilePort = {
  pick(kind: StudioFileKind): Promise<StudioPickedFile | undefined>;
  download(blob: Blob, name: string): void;
  bakeMask(layer: Layer): Promise<Blob>;
  /** Desktop-only host-owned file; the browser supplies no route. */
  revealWorkspace?: () => Promise<void>;
};
/**
 * A file workflow. One that waits for a file picker names, when it is asked, what the file goes to (profiles design §3.3: an asynchronous
 * picker holds a capture): a save or character preset names its V (`character`), a recipe its collection (`collection`).
 */
export type StudioFileAction =
  | { kind: "workspace.showInFolder" }
  | { kind: "recipe.export" | "mask.export" | "savedV.export" }
  | { kind: "recipe.import"; collection: string }
  | { kind: "savedV.import"; character: string }
  /** A portable character preset (`xfs/cc-preset-1`): load it as the V it names, or save the choices set on the shown V. */
  | { kind: "characterPreset.import"; character: string }
  | { kind: "characterPreset.export" }
  | { kind: "collection.import" | "collection.export" | "collection.plan" | "package.check" | "package.build" | "package.stop" }
  /**
   * The recovery export: this page's own copy of the open collection, its changes the library doesn't have yet included, written as
   * the portable collection file without saving or reading anything (the workspace notice's recovery export button).
   */
  | { kind: "collection.exportWindowCopy" }
  /** Bring back an earlier draft: `draft` (its collection ID, from the recent-drafts list) names one, else the previous one. */
  | { kind: "collection.recover"; draft?: string };
export type StudioFileOutcome = { ok: true; code: string; message: string;
  result?: CollectionResult;
  savedAppearance?: Readonly<SavedAppearanceState> } |
  { ok: false; code: string; message: string };
type PackageResult = { kind: "packageCheck"; result: PackageCheckResult } | { kind: "packageBuild"; result: PackageBuildResult };
/**
 * One unified list of work in flight (audit A-3): a local file workflow and/or the collection
 * request it (or another caller) started. `requestId` links an entry to collection progress.
 * Build can be stopped through its collection request; library writes finish once accepted.
 */
export type StudioActivity = { id: string; scope: "file" | "collection" | "package"; kind: string;
  startedAt: number; requestId?: number; cancellable: boolean };
export type StudioFileState = { workspaceFile?: boolean; busy?: StudioFileAction["kind"];
  collectionBusy: boolean;
  /** The last finished file or collection request; `at` is when it finished (ms since the epoch). */
  last?: { kind: StudioFileAction["kind"] | CollectionRequest["kind"];
    ok: boolean; code: string; message: string; at: number };
  package?: PackageResult & { freshness: "current" | "stale" };
  progress?: CollectionProgress;
  activity: StudioActivity[];
  recovery: { available: boolean; reason?: string } };
export type InputCapture = { check(): Capability; release(): void };
export type FileWriterCapture = InputCapture & { writer: FileWriter };
type CollectionOperationPort = Pick<CollectionService, "summary" | "activity" | "cancel" | "subscribe" | "capability">;
export type FileWriter = Omit<FileSources, "capture" | "operations"> & { operations(): CollectionOperationPort };
type FileSources = {
  /** Freeze the destination/revisions when a workflow starts; validate again after every asynchronous return. */
  capture?(): FileWriterCapture | undefined;
  /** Execution, progress notifications and Stop must belong to the same concrete service. */
  operations?(): CollectionOperationPort;
  message?(): string | undefined;
  collection?(): string | undefined;
  recipe(): ReadonlyDeep<Recipe>;
  selectedLayer(): ReadonlyDeep<Layer> | undefined;
  /** Import a recipe as a new preset of `collection` (the one the request named when it was asked). */
  importRecipe(recipe: Recipe, name: string, collection: string): void;
  hasSavedV(): boolean;
  savedV(): SavedV | undefined;
  /** Show a save's V on `character` (the V the request named when it was asked). */
  loadSavedV(bytes: Uint8Array, character: string): Readonly<SavedAppearanceState>;
  /** Whether a save can be shown on `character` now: a 3D view shows that V (the head that applies it). */
  savedVReady(character: string): boolean;
  savedVUnavailableReason?(): string | undefined;
  executeCollection(request: CollectionRequest): Promise<CollectionOutcome>;
  recoverCollection(draft?: string): void;
  /** The character context's preset workflows (character-context-actions.ts); absent where there is no 3D preview. */
  characterPreset?: {
    /** Why a preset can't be loaded or saved now, or undefined. */
    unavailable(kind: "import" | "export"): string | undefined;
    /** Load a decoded preset file as `character` (the context validates it once); throws its plain reason. */
    load(value: unknown, character: string): void;
    save(): Promise<{ text: string; name: string; values: number; leftOut: number; personal: number }>;
  };
  /**
   * Host build readiness, when the host has a Build setup. Absent means the
   * host decides at request time (tests, hosts without local setup).
   */
  buildReadiness?(): "ready" | "needs-setup" | "checking" | "loading" | "damaged" | undefined;
};


/** File and package workflow contract; DOM, worker and download mechanics are injected. */
export class StudioFileOperations {
  private disposed = false;
  private collection?: CollectionService;
  private collectionUnsubscribe?: () => void;
  private busy?: { kind: StudioFileAction["kind"]; owner: symbol; id: number; startedAt: number; collection?: CollectionOperationPort };
  private operations = new Set<{ id: number; collection: CollectionOperationPort; unsubscribe(): void }>();
  private completedProgress?: CollectionProgress;
  private sequence = 0;
  private last?: StudioFileState["last"];
  private package?: PackageResult;
  private listeners = new Set<() => void>();
  constructor(private port: StudioFilePort, private sources: FileSources) {}
  dispose() { this.disposed = true; this.collectionUnsubscribe?.(); for (const operation of this.operations) operation.unsubscribe(); this.listeners.clear(); }
  attachCollection(collection: CollectionService) {
    this.collectionUnsubscribe?.(); this.collection = collection;
    this.collectionUnsubscribe = collection.subscribe(() => this.notify()); this.notify();
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify() { for (const listener of this.listeners) listener(); }
  private observe(sources: FileSources) {
    const collection = sources.operations?.() ?? this.collection;
    this.completedProgress = undefined;
    if (!collection) return { collection, release: () => {} };
    const operation = { id: ++this.sequence, collection,
      unsubscribe: collection === this.collection ? () => {} : collection.subscribe(() => this.notify()) };
    this.operations.add(operation);
    return { collection, release: () => {
      // Keep the terminal line as plain data; the captured facade may be disposed immediately after this.
      if (collection !== this.collection) this.completedProgress = collection.summary().progress;
      operation.unsubscribe(); this.operations.delete(operation);
      if (collection !== this.collection) this.notify();
    } };
  }
  private operationSources() {
    const sources = new Map<CollectionOperationPort, number>();
    if (this.collection) sources.set(this.collection, 0);
    for (const operation of this.operations) if (!sources.has(operation.collection)) sources.set(operation.collection, operation.id);
    return sources;
  }
  private progressSource() {
    const sources = [...this.operationSources().keys()];
    return sources.find(source => source.activity()?.action === "build") ?? sources.find(source => source.activity()) ??
      this.busy?.collection ?? [...this.operations].at(-1)?.collection;
  }
  snapshot(): ReadonlyDeep<StudioFileState> {
    // The primitive summary carries busy/progress without cloning every preset's Undo history.
    const source = this.progressSource(), progress = source ? source.summary().progress : this.completedProgress ?? this.collection?.summary().progress;
    const collectionBusy = [...this.operationSources().keys()].some(source => source.summary().busy);
    const shown = this.collection?.draftIdentity()?.collectionId ?? "";
    const recovery = this.collection?.actionCapability({ kind: "collection.undoOpen", collection: shown }) ??
      { available: false, reason: "Collection is still loading." };
    return structuredClone({ workspaceFile: !!this.port.revealWorkspace, busy: this.busy?.kind, collectionBusy,
      last: this.last, package: this.package && { ...this.package,
        freshness: this.collection?.lastPackageIsCurrent() ? "current" : "stale" },
      progress, activity: this.activity(), recovery });
  }
  /** Current file and collection work as one list; the collection request is folded into its file workflow. */
  activity(): StudioActivity[] {
    return this.activityOwners().map(item => item.entry);
  }
  private activityOwners(): { entry: StudioActivity; collection?: CollectionOperationPort }[] {
    const list: { entry: StudioActivity; collection?: CollectionOperationPort }[] = [];
    const scopeOf = (kind: string) => kind.startsWith("package") ? "package" as const :
      kind.startsWith("collection") || kind === "initialize" || kind === "refresh" || kind === "open" ||
      kind === "save" || kind === "saveCopy" || kind === "import" || kind.startsWith("export") ? "collection" as const : "file" as const;
    const request = this.busy?.collection?.activity();
    // A Build started through the collection port may run beside a file picker. It keeps its own Stop.
    const separateBuild = request?.kind === "package" && request.action === "build" && this.busy?.kind !== "package.build";
    if (this.busy) list.push({ collection: this.busy.collection, entry: { id: `file-${this.busy.id}`, scope: scopeOf(this.busy.kind), kind: this.busy.kind,
      startedAt: this.busy.startedAt, ...(request && !separateBuild ? { requestId: request.requestId } : {}), cancellable: !separateBuild && (request?.cancellable ?? false) } });
    for (const [collection, id] of this.operationSources()) {
      const running = collection.activity();
      if (!running || (this.busy?.collection === collection && !separateBuild)) continue;
      list.push({ collection, entry: { id: id ? `request-${id}-${running.requestId}` : `request-${running.requestId}`,
        scope: running.kind === "package" ? "package" : "collection",
        kind: running.kind === "package" ? `package.${running.action}` : running.kind, startedAt: running.startedAt,
        requestId: running.requestId, cancellable: running.cancellable } });
    }
    return list;
  }
  /** Build delegates cancellation to its collection owner; other accepted work finishes. */
  cancel(id: string): CancelResult {
    const owner = this.activityOwners().find(item => item.entry.id === id), entry = owner?.entry;
    if (entry?.cancellable && entry.requestId !== undefined) return owner!.collection!.cancel(entry.requestId);
    return { accepted: false, reason: entry
      ? "This work cannot be cancelled once started; its result will still arrive and can be retried after it completes."
      : "Nothing with that ID is running." };
  }
  capability(action: StudioFileAction): { available: boolean; reason?: string; code?: ReasonCode } {
    if (this.disposed) return refusal("missing_target", "This file destination was released.");
    if (action.kind === "package.stop") {
      const build = this.activity().find(entry => entry.kind === "package.build");
      return build?.cancellable ? { available: true } : { available: false, reason: build
        ? "Waiting for the host to finish stopping or completing the Build." : "No Build is running." };
    }
    if (this.busy) return { available: false, reason: this.busy.kind === "package.build" && this.busy.collection?.activity()?.cancellable === false
      ? "The Build is stopping. Wait for the host to finish cleanup." : "Another file operation is in progress." };
    // What a picker's file goes to is named when it is asked (profiles design §3.3), never decided when the file arrives.
    if (action.kind === "recipe.import" && !action.collection) return refusal("missing_target", "Open a collection first.");
    if ((action.kind === "savedV.import" || action.kind === "characterPreset.import") && !action.character) return refusal("missing_target", "Choose a V first.");
    switch (action.kind) {
      case "workspace.showInFolder": return this.port.revealWorkspace ? { available: true } : { available: false, reason: "This workspace is stored in your browser." };
      case "recipe.import": case "recipe.export": return { available: true };
      case "mask.export": return this.sources.selectedLayer() ? { available: true } :
        { available: false, reason: "Select a layer before exporting a mask." };
      case "savedV.import": return this.sources.savedVReady(action.character!) ? { available: true } :
        { available: false, reason: this.sources.savedVUnavailableReason?.() ?? "Wait for the 3D view to finish loading." };
      case "savedV.export": return this.sources.hasSavedV() ? { available: true } :
        { available: false, reason: this.sources.savedVUnavailableReason?.() ??
          "Load a saved V before exporting its appearance." };
      case "characterPreset.import": case "characterPreset.export": {
        const reason = this.sources.characterPreset ? this.sources.characterPreset.unavailable(action.kind === "characterPreset.import" ? "import" : "export")
          : "Character presets need the 3D view.";
        return reason ? { available: false, reason } : { available: true };
      }
      case "collection.exportWindowCopy": return this.collection?.windowCopyCapability() ?? { available: false, reason: "Collection is still loading." };
      case "collection.recover": return this.collection?.actionCapability({ kind: "collection.undoOpen", collection: this.collection.draftIdentity()?.collectionId ?? "",
        ...(action.draft !== undefined ? { draft: action.draft } : {}) }) ??
        { available: false, reason: "Collection is still loading." };
      case "package.build": {
        const base = (this.progressSource() ?? this.collection)?.capability(collectionRequest(action.kind)) ??
          { available: false, reason: "Collection is still loading." };
        if (!base.available) return base;
        const build = this.sources.buildReadiness?.();
        return build === "needs-setup" ? { available: false, reason: BUILD_NEEDS_SETUP } :
          build === "loading" ? { available: false, reason: "Your settings are still loading." } :
          build === "checking" ? { available: false, reason: BUILD_TOOLS_CHECKING_REASON } :
          build === "damaged" ? { available: false, reason: "Your settings file is damaged. Restore the previous copy in Settings › Game." } :
          base;
      }
      default: {
        const request = collectionRequest(action.kind);
        return (this.progressSource() ?? this.collection)?.capability(request) ??
          { available: false, reason: "Collection is still loading." };
      }
    }
  }
  async execute(action: StudioFileAction): Promise<StudioFileOutcome> {
    const allowed = this.capability(action);
    // A refused call never acquired the transaction, so it must not release or replace its result.
    if (!allowed.available) return { ok: false, code: allowed.code === "missing_target" ? "missing_target" : this.busy ? "busy" : "unavailable", message: allowed.reason! };
    if (action.kind === "package.stop") {
      const entry = this.activity().find(entry => entry.kind === "package.build" && entry.cancellable)!;
      const answer = this.cancel(entry.id);
      return answer.accepted ? { ok: true, code: "stopping", message: "Stopping Build…" }
        : { ok: false, code: "unavailable", message: answer.reason! };
    }
    const captured = this.sources.capture?.();
    const sources = captured?.writer ?? this.sources;
    const operation = this.observe(sources);
    const check = () => {
      const allowed = this.disposed ? refusal("missing_target", "This file destination was released.") : captured?.check();
      if (allowed && !allowed.available) throw new FileOperationError(allowed.code ?? "missing_target", allowed.reason ?? "This file destination changed.");
      if (captured && action.kind === "recipe.import" && (sources.collection ? sources.collection() : this.collection?.draftIdentity()?.collectionId) !== action.collection)
        throw new FileOperationError("missing_target", "The collection this file was going to is no longer available.");
    };
    if (action.kind === "package.check" || action.kind === "package.build") this.clearPackageOutcome();
    const owner = Symbol(action.kind);
    this.busy = { kind: action.kind, owner, id: ++this.sequence, startedAt: Date.now(), collection: operation.collection }; this.notify();
    try {
      check();
      let outcome: StudioFileOutcome;
      switch (action.kind) {
        case "workspace.showInFolder": {
          await this.port.revealWorkspace!();
          outcome = { ok: true, code: "revealed", message: "Workspace file shown in its folder." }; break;
        }
        case "recipe.import": {
          const file = await this.port.pick("recipe");
          check();
          if (!file) return this.finish(owner, action.kind, { ok: false, code: "cancelled", message: "Recipe selection cancelled." });
          if (file.size > 1_000_000) throw new FileOperationError("too_large", "Recipe is too large.");
          const recipe = readPortableRecipe(JSON.parse(await file.text()));
          check();
          if (!recipe) throw Error(RECIPE_FILE_MESSAGE);
          sources.importRecipe(recipe, file.name.replace(/\.json$/i, ""), action.collection);
          outcome = { ok: true, code: "imported", message: `Opened ${file.name}` }; break;
        }
        case "recipe.export":
          // The oldest recipe schema that holds it, so older builds open it too.
          this.port.download(new Blob([JSON.stringify(portableRecipe(sources.recipe() as Recipe), null, 2)],
            { type: "application/json" }), "xfs.recipe.json");
          outcome = { ok: true, code: "exported", message: "Recipe exported — editable shapes, colours and fields." }; break;
        case "mask.export": {
          const layer = structuredClone(sources.selectedLayer()!) as Layer;
          const blob = await this.port.bakeMask(layer);
          check();
          this.port.download(blob, `xfs-${layer.id}-alpha.png`);
          outcome = { ok: true, code: "exported", message: "Exported the layer's shape as a 2048 × 2048 mask." }; break;
        }
        case "savedV.import": {
          const file = await this.port.pick("savedV");
          check();
          if (!file) return this.finish(owner, action.kind, { ok: false, code: "cancelled", message: "Saved V selection cancelled." });
          if (file.size > 128 * 1024 * 1024) throw new FileOperationError("too_large", "Save is larger than the supported limit.");
          const bytes = await file.bytes(); check();
          const savedAppearance = sources.loadSavedV(bytes, action.character);
          outcome = { ok: true, code: "loaded", message: "Your V is loaded. Skin, face details, eyes, brows, lashes, hair, piercings and body follow in a moment.",
            savedAppearance }; break;
        }
        case "savedV.export":
          this.port.download(new Blob([JSON.stringify(sources.savedV(), null, 2)],
            { type: "application/json" }), "v-appearance.json");
          outcome = { ok: true, code: "exported", message: "Saved appearance exported." }; break;
        case "characterPreset.import": {
          const file = await this.port.pick("characterPreset");
          check();
          if (!file) return this.finish(owner, action.kind, { ok: false, code: "cancelled", message: "Character preset selection cancelled." });
          if (file.size > CC_PRESET_LIMITS.bytes) throw new FileOperationError("too_large", "This character preset can't be read: the file is larger than 1 MB.");
          // The JSON is read once here and the preset once by the context (CORE-55).
          const bytes = await file.bytes(); check();
          sources.characterPreset!.load(readPresetJson(bytes), action.character);
          outcome = { ok: true, code: "loaded", message: `Loaded ${file.name}. Your V's skin, face details, eyes, brows, lashes, hair, piercings and body follow in a moment.` }; break;
        }
        case "characterPreset.export": {
          const saved = await sources.characterPreset!.save();
          check();
          this.port.download(new Blob([saved.text], { type: "application/json" }), saved.name);
          const notes = [saved.leftOut ? `${saved.leftOut} choice${saved.leftOut === 1 ? "" : "s"} couldn't be written and ${saved.leftOut === 1 ? "was" : "were"} left out.` : "",
            saved.personal ? `${saved.personal} item${saved.personal === 1 ? "" : "s"} naming a personal folder or address ${saved.personal === 1 ? "was" : "were"} left out.` : ""].filter(Boolean);
          outcome = { ok: true, code: "exported", message: [`Character preset saved with ${saved.values} choice${saved.values === 1 ? "" : "s"}.`, ...notes].join(" ") }; break;
        }
        case "collection.exportWindowCopy": {
          const copy = this.collection!.exportWindowCopy();
          this.port.download(new Blob([copy.json], { type: "application/json" }), copy.name);
          outcome = { ok: true, code: "exported", message: copy.message }; break;
        }
        case "collection.recover":
          sources.recoverCollection(action.draft);
          outcome = { ok: true, code: "recovered", message: action.draft !== undefined
            ? "Reopened that draft. The one you had open is first under Recent drafts." : "Reopened the previous collection." }; break;
        default: {
          let request: CollectionRequest;
          if (action.kind === "collection.import") {
            const file = await this.port.pick("collection");
            check();
            if (!file) return this.finish(owner, action.kind, { ok: false, code: "cancelled", message: "Collection selection cancelled." });
            // Keep the service's exact size validation and error code.
            request = { kind: "import", text: file.size > 16_000_000 ? "" : await file.text(), bytes: file.size };
            check();
          } else request = collectionRequest(action.kind);
          const result = await sources.executeCollection(request);
          // Import publishes its new binding in the same accepted command. That intentional transition is its successful result.
          if (action.kind !== "collection.import") check();
          if (!result.ok) { outcome = result; break; }
          if (result.result.kind === "export")
            this.port.download(new Blob([result.result.json], { type: "application/json" }), result.result.name);
          if (result.result.kind === "packageCheck" || result.result.kind === "packageBuild")
            this.package = structuredClone(result.result);
          outcome = { ok: true, code: result.result.kind,
            message: sources.message?.() ?? operation.collection?.summary().progress?.message ?? "Collection operation completed.", result: result.result };
        }
      }
      return this.finish(owner, action.kind, outcome);
    } catch (error) {
      const code = error instanceof FileOperationError ? error.code : error instanceof SyntaxError ? "invalid_json" : "file_failed";
      const prefix = action.kind === "recipe.import" ? "Could not open recipe: " :
        action.kind === "savedV.import" ? "Could not apply V: " : "";
      if (action.kind === "characterPreset.import" && error instanceof SyntaxError)
        return this.finish(owner, action.kind, { ok: false, code: "invalid_json", message: "This character preset can't be read: it is not valid JSON." });
      return this.finish(owner, action.kind, { ok: false, code, message: prefix + (error as Error).message });
    } finally { operation.release(); captured?.release(); }
  }
  /** Existing save/open/refresh requests share the same result/download state port. */
  async executeCollection(request: CollectionRequest): Promise<CollectionOutcome> {
    const captured = this.sources.capture?.(), sources = captured?.writer ?? this.sources;
    const operation = this.observe(sources);
    const current = () => this.disposed ? refusal("missing_target", "This file destination was released.") : captured?.check();
    try {
      const allowed = current();
      if (allowed && !allowed.available) return { ok: false, code: allowed.code ?? "missing_target", message: allowed.reason ?? "This collection destination changed." };
      if (request.kind === "package") { this.clearPackageOutcome(); this.notify(); }
      const result = await sources.executeCollection(request);
      if (result.ok && result.result.kind === "export")
        this.port.download(new Blob([result.result.json], { type: "application/json" }), result.result.name);
      if (result.ok && (result.result.kind === "packageCheck" || result.result.kind === "packageBuild"))
        this.package = structuredClone(result.result);
      this.last = { kind: request.kind === "package" ? request.action === "check" ? "package.check" : "package.build" :
        request.kind === "exportCollection" ? "collection.export" : request.kind === "exportPlan" ? "collection.plan" :
        request.kind === "import" ? "collection.import" : request.kind,
        ok: result.ok, code: result.ok ? result.result.kind : result.code,
        message: result.ok ? sources.message?.() ?? operation.collection?.summary().progress?.message ?? "Collection operation completed." : result.message, at: Date.now() };
      this.notify();
      return result;
    } finally { operation.release(); captured?.release(); }
  }
  private clearPackageOutcome(): void {
    this.package = undefined;
    if (this.last?.kind === "package.check" || this.last?.kind === "package.build") this.last = undefined;
  }
  private finish(owner: symbol, kind: StudioFileAction["kind"], outcome: StudioFileOutcome): StudioFileOutcome {
    if (this.busy?.owner === owner) {
      this.busy = undefined; this.last = { kind, ok: outcome.ok, code: outcome.code, message: outcome.message, at: Date.now() };
      this.notify();
    }
    return outcome;
  }
}

class FileOperationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
function collectionRequest(kind: StudioFileAction["kind"]): CollectionRequest {
  switch (kind) {
    case "collection.import": return { kind: "import", text: "", bytes: 0 };
    case "collection.export": return { kind: "exportCollection" };
    case "collection.plan": return { kind: "exportPlan" };
    case "package.check": return { kind: "package", action: "check" };
    case "package.build": return { kind: "package", action: "build" };
    default: return { kind: "initialize" };
  }
}
