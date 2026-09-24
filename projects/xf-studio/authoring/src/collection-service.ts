import { CollectionActions, type CollectionAction, type CollectionDraftSummary, type ReadonlyDeep } from "./collection-actions";
import type { EditorSnapshot } from "./collection-session";
import { collectionDraft, type CollectionWorkspace } from "./collection-workspace";
import { parseCollection, planCollection, type PresetCollection } from "./preset-collection";
import type { CollectionSummary, StoredCollection } from "./collection-store";
import type { LibraryState } from "./workspace-state";
import type { PackageAction, PackageBuild, PackageCheck } from "./package-action";
import { describePackageOmissions } from "./package-filter";

export type CollectionRequest =
  | { kind: "initialize" | "refresh" | "save" | "saveCopy" | "exportCollection" | "exportPlan" }
  | { kind: "open"; id: string }
  | { kind: "import"; text: string; bytes: number }
  | { kind: "package"; action: PackageAction };
export type CollectionResult =
  | { kind: "list"; summaries: CollectionSummary[] }
  | { kind: "opened"; collection: StoredCollection }
  | { kind: "saved"; collection: StoredCollection }
  | { kind: "export"; name: string; json: string }
  | { kind: "imported" }
  | { kind: "packageCheck"; result: PackageCheck }
  | { kind: "packageBuild"; result: PackageBuild };
export type CollectionProgress = { phase: "working" | "success" | "error"; code: string; message: string };
export type CollectionServiceState = { busy: boolean; progress?: CollectionProgress;
  summaries: CollectionSummary[]; draft?: ReadonlyDeep<CollectionWorkspace> };
/** Cheap detached projection for frequently repainted views; see `view()` for the full draft. */
export type CollectionServiceSummary = { busy: boolean; progress?: CollectionProgress;
  summaries: CollectionSummary[]; draft?: CollectionDraftSummary };
export type CollectionOutcome = { ok: true; result: CollectionResult } |
  { ok: false; code: string; message: string };
export type CollectionTransport = {
  list(): Promise<CollectionSummary[]>;
  get(id: string): Promise<StoredCollection>;
  save(collection: PresetCollection, revision?: number): Promise<StoredCollection>;
  package(action: PackageAction, collection: PresetCollection): Promise<PackageCheck | PackageBuild>;
};

export class CollectionServiceError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** Owns async collection work; the transport and editor adapter are injected. */
export class CollectionService {
  private actions?: CollectionActions;
  private busy = false;
  private progress?: CollectionProgress;
  /** Exact authored input of the last successful package request, before transport filtering. */
  private packageSource?: string;
  private summaries: CollectionSummary[] = [];
  private listeners = new Set<() => void>();
  constructor(restored: CollectionWorkspace | undefined, private legacy: LibraryState,
    private read: () => EditorSnapshot, private show: (editor: EditorSnapshot) => void,
    private transport: CollectionTransport) {
    if (restored) this.actions = new CollectionActions(restored, read, show);
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify() { for (const listener of this.listeners) listener(); }
  view(): ReadonlyDeep<CollectionServiceState> {
    return structuredClone({ busy: this.busy, progress: this.progress, summaries: this.summaries,
      draft: this.actions?.view() });
  }
  summary(): CollectionServiceSummary {
    return { busy: this.busy, progress: this.progress && { ...this.progress },
      summaries: this.summaries.map(item => ({ ...item })), draft: this.actions?.summary() };
  }
  snapshot() { return this.actions?.snapshot(); }
  /** A package response describes its request snapshot, not necessarily the live draft. */
  lastPackageIsCurrent(): boolean {
    if (!this.packageSource || !this.actions) return false;
    try { return this.packageSource === JSON.stringify(parseCollection(this.actions.snapshot().collection)); }
    catch { return false; }
  }
  capability(request: CollectionRequest): { available: boolean; reason?: string } {
    if (this.busy) return { available: false, reason: "Another collection request is in progress." };
    if (request.kind === "initialize") return { available: true };
    if (!this.actions) return { available: false, reason: "Collection is still loading." };
    if (request.kind === "open" && !this.summaries.some(item => item.id === request.id))
      return { available: false, reason: "Saved collection is no longer in this list. Refresh it first." };
    if (request.kind === "import" && (!Number.isSafeInteger(request.bytes) || request.bytes < 0 || request.bytes > 16_000_000))
      return { available: false, reason: "Collection exceeds the current 16 MB import budget." };
    if (request.kind === "exportCollection" || request.kind === "exportPlan" || request.kind === "package") {
      try { parseCollection(this.actions.snapshot().collection); }
      catch (error) { return { available: false, reason: (error as Error).message }; }
    }
    return { available: true };
  }
  actionCapability(action: CollectionAction) {
    if (this.busy) return { available: false, reason: "A collection request is in progress." };
    return this.actions?.capability(action) ?? { available: false, reason: "Collection is still loading." };
  }
  dispatch(action: CollectionAction) {
    const allowed = this.actionCapability(action);
    if (!allowed.available) throw new CollectionServiceError("unavailable", allowed.reason!);
    this.actions!.dispatch(action); this.notify();
  }
  private setProgress(progress: CollectionProgress) { this.progress = progress; this.notify(); }
  private async list() { this.summaries = await this.transport.list(); this.notify(); return this.summaries; }
  private async save(copy: boolean): Promise<StoredCollection> {
    const snapshot = this.actions!.snapshot(), sourceId = snapshot.collection.id;
    if (copy) { snapshot.collection.id = crypto.randomUUID(); snapshot.revision = undefined; }
    const saved = await this.transport.save(snapshot.collection, snapshot.revision);
    // An in-flight request may finish after a different draft has been opened via another adapter.
    if (this.actions!.view().collection.id !== sourceId)
      throw new CollectionServiceError("stale_result", "Saved snapshot belongs to another draft. Current draft kept; refresh saved collections to find it.");
    this.actions!.dispatch({ kind: "collection.saved", result: saved, sourceId });
    await this.list();
    return saved;
  }
  async execute(request: CollectionRequest): Promise<CollectionOutcome> {
    const allowed = this.capability(request);
    if (!allowed.available) return { ok: false, code: "unavailable", message: allowed.reason! };
    this.busy = true;
    this.setProgress({ phase: "working", code: request.kind,
      message: request.kind === "package" ? request.action === "check"
        ? "Checking which layers in the current collection can become Cyberpunk mod files…"
        : "Building and verifying Cyberpunk mod files from the current collection. This can take several minutes…"
        : "Working with the local collection library…" });
    try {
      let result: CollectionResult, message: string;
      switch (request.kind) {
        case "initialize": {
          const summaries = await this.list();
          if (!this.actions) {
            const current = this.read(), id = this.legacy.current?.id ?? crypto.randomUUID();
            const stored = summaries.length ? await this.transport.get(summaries[0].id) : undefined;
            const draft = stored
              ? collectionDraft(stored.collection, stored.revision)
              : collectionDraft({ schema: "xfas/collection-1", id: crypto.randomUUID(),
                name: "My collection", presets: [{ id, name: this.legacy.name.trim() || "First look",
                  revision: 1, recipe: current.recipe }] });
            if (stored) {
              const existing = draft.collection.presets.find(p => p.id === id);
              if (existing) { existing.recipe = current.recipe; existing.name = this.legacy.name.trim() || existing.name; }
              else draft.collection.presets.push({ id, name: this.legacy.name.trim() || "Unsaved preset", revision: 1, recipe: current.recipe });
            }
            draft.selected = id; draft.editors[id] = { active: current.active, selected: current.selected,
              fieldSelection: current.fieldSelection, history: current.history };
            this.actions = new CollectionActions(draft, this.read, this.show);
            message = summaries.length
              ? "Existing looks and your current draft are retained. Save collection to store this arrangement."
              : "Your starter collection is ready. Save it to the local library when you want to keep a revision.";
          } else message = "Collection draft restored without replacing unsaved edits from SQLite.";
          result = { kind: "list", summaries }; break;
        }
        case "refresh": result = { kind: "list", summaries: await this.list() };
          message = "Saved collection list refreshed; draft retained."; break;
        case "open": {
          const stored = await this.transport.get(request.id);
          // Opening is the only draft switch in this async operation. Existing changes are stashed first.
          this.actions!.dispatch({ kind: "collection.open", collection: stored.collection, revision: stored.revision });
          result = { kind: "opened", collection: stored };
          message = `Opened “${stored.collection.name}”. Undo collection open restores the previous draft.`; break;
        }
        case "save": case "saveCopy": {
          const stored = await this.save(request.kind === "saveCopy");
          result = { kind: "saved", collection: stored };
          message = `Saved “${stored.collection.name}” · revision ${stored.revision}. Changes made during saving remain in your draft.`; break;
        }
        case "exportCollection": case "exportPlan": {
          const stored = await this.save(false), plan = request.kind === "exportPlan";
          result = { kind: "export", name: plan ? "xfs.build-plan.json" : "xfs.collection.json",
            json: JSON.stringify(plan ? planCollection(stored.collection) : stored.collection, null, 2) };
          message = plan ? "Build plan exported for the offline compiler; this is not an installable mod."
            : "Saved snapshot exported. Recipes and stable preset identities are included."; break;
        }
        case "package": {
          // Snapshot the unsaved editor state once; this request never writes SQLite or changes revision.
          const snapshot = parseCollection(this.actions!.snapshot().collection);
          const source = JSON.stringify(snapshot);
          const response = await this.transport.package(request.action, snapshot);
          this.packageSource = source;
          if (request.action === "check") {
            const checked = response as PackageCheck;
            result = { kind: "packageCheck", result: checked };
            message = `${checked.presets.length} of ${checked.originalPresetCount} preset(s) can become mod files. This check created no files.${describePackageOmissions(checked.omissions)}`;
          } else {
            const built = response as PackageBuild;
            result = { kind: "packageBuild", result: built };
            message = `Verified local mod files for ${built.presetCount} of ${built.originalPresetCount} preset(s): ${built.package} · Manifest: ${built.manifest}. Not installed or game-tested.${describePackageOmissions(built.omissions)}`;
          }
          break;
        }
        case "import": {
          let collection: PresetCollection;
          try { collection = parseCollection(JSON.parse(request.text)); }
          catch (error) { throw new CollectionServiceError(error instanceof SyntaxError ? "invalid_json" : "invalid_collection",
            (error as Error).message); }
          this.actions!.dispatch({ kind: "collection.open", collection });
          result = { kind: "imported" };
          message = "Imported collection draft. Existing IDs are preserved; Save a copy creates a separate collection. Undo collection open recovers the previous draft."; break;
        }
      }
      this.setProgress({ phase: "success", code: result.kind, message });
      return { ok: true, result };
    } catch (error) {
      const code = error instanceof CollectionServiceError ? error.code : error instanceof SyntaxError ? "invalid_json" : "request_failed";
      const message = (error as Error).message;
      this.setProgress({ phase: "error", code, message });
      return { ok: false, code, message };
    } finally { this.busy = false; this.notify(); }
  }
}
