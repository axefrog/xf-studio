import { AcceptedStudioOperation, collectionRequest } from "./accepted-studio-operation";
import { BUILD_NEEDS_SETUP, BUILD_TOOLS_CHECKING_REASON } from "./alpha-availability";
import type { CancelResult, CollectionOutcome, CollectionProgress, CollectionRequest, CollectionResult, CollectionService } from "../library/collection-service";
import type { PackageBuildResult, PackageCheckResult } from "../platform/api";
import type { Layer, Recipe } from "../engines/layered-makeup/recipe";
import type { ReadonlyDeep } from "../platform/api/read-only";
import type { SavedAppearanceState } from "../character/saved-appearance-actions";
import type { SavedV } from "../saves/save-reader";
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
export type PackageResult = { kind: "packageCheck"; result: PackageCheckResult } | { kind: "packageBuild"; result: PackageBuildResult };
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
export type CapturedCollectionService = Pick<CollectionService, "summary" | "activity" | "cancel" | "subscribe" | "capability" | "lastPackageIsCurrent" | "retainPackageResult" | "draftIdentity" | "actionCapability" | "exportWindowCopy">;
export type CapturedCollectionPort = { readonly service: CapturedCollectionService; execute(request: CollectionRequest): Promise<CollectionOutcome> };
export type FileWriter = Omit<FileSources, "capture" | "operations" | "executeCollection"> & { operations(): CapturedCollectionPort };
type FileSources = {
  /** Freeze the destination/revisions when a workflow starts; validate again after every asynchronous return. */
  capture?(): FileWriterCapture | undefined;
  /** Execution, progress notifications and Stop must belong to the same concrete service. */
  operations?(): CapturedCollectionPort;
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


export type FileOperationSources = Omit<FileSources, "capture" | "operations" | "executeCollection">;
/** Preflight/input routing only. Accepted objects never receive this router or its live accessors. */
export class StudioFileOperations {
  private readonly life = new AbortController();
  private liveCollection?: CollectionService;
  private collectionUnsubscribe?: () => void;
  private operations = new Map<AcceptedStudioOperation, () => void>();
  private busy?: AcceptedStudioOperation;
  private last?: AcceptedStudioOperation;
  private packageOwner?: AcceptedStudioOperation;
  private sequence = 0;
  private listeners = new Set<() => void>();
  private retired = false;
  private inputs = 0;
  private readonly executionOwner: StudioFileOperations;
  /** Captured shell inputs preflight locally; the initiating operation owner keeps progress, Stop and outcomes. */
  constructor(private port: StudioFilePort, private sources: FileSources, owner?: StudioFileOperations) {
    this.executionOwner = owner?.executionOwner ?? this;
    if (this.executionOwner !== this) {
      const held = this.executionOwner; held.inputs++;
      this.life.signal.addEventListener("abort", () => { held.inputs--; held.finishRetired(); }, { once: true });
    }
  }
  private finishRetired() { if (this.retired && !this.inputs && !this.running().length) this.dispose(); }
  /** An instance input can leave while its accepted operation still owns a concrete writer. */
  retire() {
    this.retired = true;
    if (this.executionOwner !== this) this.dispose(); else this.finishRetired();
  }
  dispose() { this.life.abort(); this.collectionUnsubscribe?.(); for (const [operation, off] of this.operations) { off(); operation.dispose(); } this.operations.clear(); this.listeners.clear(); }
  attachCollection(collection: CollectionService) {
    this.collectionUnsubscribe?.(); this.liveCollection = collection;
    this.collectionUnsubscribe = collection.subscribe(() => this.notify()); this.notify();
  }
  /** An instance's replacement input changes idle observation, never an accepted dependency bundle. */
  observeInput(input: StudioFileOperations) { if (input !== this && input.liveCollection) this.attachCollection(input.liveCollection); }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    const off = this.executionOwner !== this ? this.executionOwner.subscribe(listener) : () => {};
    return () => { off(); this.listeners.delete(listener); };
  }
  private notify() { for (const listener of this.listeners) listener(); }
  private running(): AcceptedStudioOperation[] { if (this.executionOwner !== this) return this.executionOwner.running(); return [...this.operations.keys()].filter(operation => operation.isRunning()); }
  private progressOwner() {
    const running = this.running();
    return running.find(operation => operation.kind === "package.build") ?? running.find(operation => operation.snapshot().collectionBusy) ?? this.busy ?? this.last;
  }
  private runningCollection() {
    const operation = this.running().find(operation => operation.snapshot().collectionBusy);
    return operation && { capability: (request: CollectionRequest) => operation.collectionCapability(request)! };
  }
  snapshot(): ReadonlyDeep<StudioFileState> {
    if (this.executionOwner !== this) return this.executionOwner.snapshot();
    // Each operation's snapshot is taken once per read: an operation can be the progress owner, the last result and the package
    // owner at once, and its package freshness is a key comparison that needn't run three times.
    const snapshots = new Map<AcceptedStudioOperation, ReturnType<AcceptedStudioOperation["snapshot"]>>();
    const of = (operation: AcceptedStudioOperation) => snapshots.get(operation) ?? snapshots.set(operation, operation.snapshot()).get(operation)!;
    const running = this.running();
    const owner = running.find(operation => operation.kind === "package.build") ?? running.find(operation => of(operation).collectionBusy) ?? this.busy ?? this.last;
    const accepted = owner && of(owner);
    // Idle preflight data is separate from accepted state: no field of an accepted result falls back to it.
    const idle = owner ? undefined : this.liveCollection?.summary();
    const shown = this.liveCollection?.draftIdentity()?.collectionId;
    return structuredClone({ workspaceFile: !!this.port.revealWorkspace, busy: this.busy?.isRunning() ? this.busy.kind as StudioFileAction["kind"] : undefined,
      collectionBusy: running.some(operation => of(operation).collectionBusy) || (!owner && !!idle?.busy),
      last: this.last && of(this.last).last, package: this.packageOwner && of(this.packageOwner).package,
      progress: accepted?.progress ?? (owner ? undefined : idle?.progress), activity: this.activity(),
      // Recovery is preflight for a new command, independent of an accepted operation's result.
      recovery: this.liveCollection?.actionCapability({ kind: "collection.undoOpen", collection: shown ?? "" }) ??
        { available: false, reason: "Collection is still loading." } });
  }
  activity(): StudioActivity[] { return this.running().flatMap(operation => operation.activity()); }
  cancel(id: string): CancelResult {
    const operation = this.running().find(operation => operation.activity().some(entry => entry.id === id));
    return operation?.cancel(id) ?? { accepted: false, reason: "Nothing with that ID is running." };
  }
  capability(action: StudioFileAction): { available: boolean; reason?: string; code?: ReasonCode } {
    if (this.retired || this.life.signal.aborted || this.executionOwner.life.signal.aborted) return refusal("missing_target", "This file destination was released.");
    if (action.kind === "package.stop") {
      const build = this.activity().find(entry => entry.kind === "package.build");
      return build?.cancellable ? { available: true } : { available: false, reason: build
        ? "Waiting for the host to finish stopping or completing the Build." : "No Build is running." };
    }
    const busy = this.executionOwner.busy;
    if (busy) return { available: false, reason: busy.kind === "package.build" && busy.activity()[0]?.cancellable === false
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
      case "collection.exportWindowCopy": return this.liveCollection?.windowCopyCapability() ?? { available: false, reason: "Collection is still loading." };
      case "collection.recover": return this.liveCollection?.actionCapability({ kind: "collection.undoOpen", collection: this.liveCollection.draftIdentity()?.collectionId ?? "",
        ...(action.draft !== undefined ? { draft: action.draft } : {}) }) ??
        { available: false, reason: "Collection is still loading." };
      case "package.build": {
        const base = (this.runningCollection() ?? this.liveCollection)?.capability(collectionRequest(action.kind)) ??
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
        return (this.runningCollection() ?? this.liveCollection)?.capability(request) ??
          { available: false, reason: "Collection is still loading." };
      }
    }
  }
  private accept(kind: NonNullable<StudioFileState["last"]>["kind"], file: boolean) {
    const captured = this.sources.capture?.();
    if (this.sources.capture && !captured) return undefined;
    const { capture: _liveCapture, operations: resolve, executeCollection, ...liveSources } = this.sources;
    const { operations: _boundResolve, ...boundSources } = captured?.writer ?? { operations: undefined, ...liveSources };
    const sources = captured ? boundSources : liveSources;
    const collection = captured ? captured.writer.operations() : resolve?.() ??
      (this.liveCollection ? { service: this.liveCollection, execute: executeCollection } : undefined);
    const owner = this.executionOwner;
    const operation = new AcceptedStudioOperation(++owner.sequence, kind, file,
      { sources, collection, device: { ...this.port }, capture: captured, signal: owner.life.signal }, !!captured);
    let completionHandled = false;
    owner.operations.set(operation, operation.subscribe(() => {
      if (!completionHandled && !operation.isRunning()) {
        completionHandled = true;
        owner.completed(operation);
      }
      // Retained package subscriptions repaint freshness without publishing the outcome again.
      owner.notify();
    }));
    return operation;
  }
  private prune() {
    for (const [operation, off] of this.operations) if (!operation.isRunning() && operation !== this.last && operation !== this.packageOwner) {
      off(); operation.dispose(); this.operations.delete(operation);
    }
  }
  private clearPackageOutcome() {
    this.packageOwner = undefined;
    if (this.last?.kind === "package.check" || this.last?.kind === "package.build") this.last = undefined;
    this.prune();
  }
  private completed(operation: AcceptedStudioOperation) {
    if (this.busy === operation) this.busy = undefined;
    this.last = operation;
    if (operation.snapshot().package) this.packageOwner = operation;
    this.prune();
    if (this.retired && !this.inputs && !this.running().length) queueMicrotask(() => this.finishRetired());
  }
  async execute(action: StudioFileAction): Promise<StudioFileOutcome> {
    action = structuredClone(action);
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, code: allowed.code === "missing_target" ? "missing_target" : this.executionOwner.busy ? "busy" : "unavailable", message: allowed.reason! };
    if (action.kind === "package.stop") {
      const entry = this.activity().find(entry => entry.kind === "package.build" && entry.cancellable)!;
      const answer = this.cancel(entry.id);
      return answer.accepted ? { ok: true, code: "stopping", message: "Stopping Build…" } : { ok: false, code: "unavailable", message: answer.reason! };
    }
    const operation = this.accept(action.kind, true);
    if (!operation) return { ok: false, code: "missing_target", message: "This file destination was released." };
    if (action.kind === "package.check" || action.kind === "package.build") this.executionOwner.clearPackageOutcome();
    this.executionOwner.busy = operation; this.executionOwner.notify();
    return operation.runFile(action);
  }
  async executeCollection(request: CollectionRequest): Promise<CollectionOutcome> {
    request = structuredClone(request);
    if (this.retired || this.life.signal.aborted || this.executionOwner.life.signal.aborted) return { ok: false, code: "missing_target", message: "This collection destination was released." };
    const kind = request.kind === "package" ? request.action === "check" ? "package.check" : "package.build" :
      request.kind === "exportCollection" ? "collection.export" : request.kind === "exportPlan" ? "collection.plan" :
      request.kind === "import" ? "collection.import" : request.kind;
    const operation = this.accept(kind, false);
    if (!operation) return { ok: false, code: "missing_target", message: "This collection destination was released." };
    if (request.kind === "package") this.executionOwner.clearPackageOutcome();
    return operation.runCollection(request);
  }
}
