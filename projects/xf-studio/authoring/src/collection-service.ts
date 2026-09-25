import { CollectionActions, type CollectionAction, type CollectionDraftSummary, type ReadonlyDeep } from "./collection-actions";
import type { EditorSnapshot } from "./collection-session";
import { collectionDraft, type CollectionWorkspace } from "./collection-workspace";
import { parseCollection, planCollection, type PresetCollection } from "./preset-collection";
import { parseRecipe, type Recipe } from "./recipe";
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
export type CollectionProgress = { phase: "working" | "success" | "error"; code: string; message: string;
  /** The request this progress belongs to (audit A-9). */
  requestId?: number };
/** One accepted async request in flight. Library and package requests cannot be cancelled. */
export type CollectionActivity = { requestId: number; kind: CollectionRequest["kind"]; action?: PackageAction;
  startedAt: number; cancellable: false };
export type CancelResult = { accepted: false; reason: string };
export type CollectionServiceState = { busy: boolean; progress?: CollectionProgress;
  summaries: CollectionSummary[]; draft?: ReadonlyDeep<CollectionWorkspace> };
/** Cheap detached projection for frequently repainted views; see `view()` for the full draft. */
export type CollectionServiceSummary = { busy: boolean; progress?: CollectionProgress;
  summaries: CollectionSummary[]; draft?: CollectionDraftSummary };
/**
 * Draft versus its library revision (audit A-1). `baseline` is `none` for a collection never
 * saved, `unknown` when the saved revision's content has not been loaded in this session
 * (dirty is then undefined rather than guessed), and `known` otherwise. Preset renames and
 * recipe edits mark that preset; a collection rename, reorder, addition or removal marks
 * the structure. The live editor recipe is compared for the selected preset.
 */
export type DraftPersistence = { collectionId: string; savedRevision?: number;
  baseline: "none" | "unknown" | "known"; dirty?: boolean; dirtyPresets: string[]; structureDirty?: boolean };
type Baseline = { name: string; order: string[]; presets: Map<string, { name: string; recipe: string }> };
/** Accepted requests carry their `requestId`; a refused request never started and has none. */
export type CollectionOutcome = { ok: true; result: CollectionResult; requestId?: number } |
  { ok: false; code: string; message: string; requestId?: number };
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
  /** Advances only when draft content or identity changes; progress, busy, list and disclosure do not count. */
  private content = 0;
  /** Library content by `id@revision`, recorded when this session saved or loaded it (bounded). */
  private baselines = new Map<string, Baseline>();
  private persistenceCache?: { key: string; value: DraftPersistence };
  private requestSeq = 0;
  private running?: CollectionActivity;
  constructor(restored: CollectionWorkspace | undefined, private legacy: LibraryState,
    private read: () => EditorSnapshot, private show: (editor: EditorSnapshot) => void,
    private transport: CollectionTransport,
    /** Cheap live editor read for dirty checks; defaults to the full editor snapshot. */
    private readRecipe?: () => { recipe: Recipe; revision: number }) {
    if (restored) this.actions = new CollectionActions(restored, read, show);
  }
  /** Bookkeeping only: a baseline that cannot be recorded leaves dirty state unknown, never fails a request. */
  private remember(collection: PresetCollection, revision: number) {
    let parsed: PresetCollection;
    try { parsed = parseCollection(collection, true); } catch { return; }
    this.persistenceCache = undefined;
    this.baselines.delete(`${parsed.id}@${revision}`);
    this.baselines.set(`${parsed.id}@${revision}`, { name: parsed.name, order: parsed.presets.map(preset => preset.id),
      presets: new Map(parsed.presets.map(preset => [preset.id, { name: preset.name, recipe: JSON.stringify(preset.recipe) }])) });
    while (this.baselines.size > 8) this.baselines.delete(this.baselines.keys().next().value!);
  }
  persistence(): DraftPersistence | undefined {
    if (!this.actions) return undefined;
    const summary = this.actions.summary(), live = this.readRecipe?.();
    // Without a cheap live read there is no editor revision to key a cache on.
    const key = live && JSON.stringify([this.content, summary.id, summary.revision, summary.selected, live.revision]);
    if (key && this.persistenceCache?.key === key) return structuredClone(this.persistenceCache.value);
    const ids = summary.presets.map(preset => preset.id);
    let value: DraftPersistence;
    const base = summary.revision === undefined ? undefined : this.baselines.get(`${summary.id}@${summary.revision}`);
    if (summary.revision === undefined)
      value = { collectionId: summary.id, baseline: "none", dirty: true, dirtyPresets: ids, structureDirty: true };
    else if (!base) value = { collectionId: summary.id, savedRevision: summary.revision, baseline: "unknown", dirtyPresets: [] };
    else {
      const liveRecipe = live?.recipe ?? this.read().recipe;
      const dirtyPresets = this.actions.presetsForComparison().filter(preset => {
        const saved = base.presets.get(preset.id);
        if (!saved || saved.name !== preset.name) return true;
        const recipe = preset.id === summary.selected ? liveRecipe : preset.recipe, encoded = JSON.stringify(recipe);
        // Gestures edit in place and may reorder keys; normalize before calling it a change.
        return encoded !== saved.recipe && JSON.stringify(parseRecipe(recipe)) !== saved.recipe;
      }).map(preset => preset.id);
      const structureDirty = base.name !== summary.name || base.order.join() !== ids.join();
      value = { collectionId: summary.id, savedRevision: summary.revision, baseline: "known",
        dirty: structureDirty || dirtyPresets.length > 0, dirtyPresets, structureDirty };
    }
    if (key) this.persistenceCache = { key, value };
    return structuredClone(value);
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
  /** The accepted request in flight, if any (requests are serialized). */
  activity(): CollectionActivity | undefined { return this.running && { ...this.running }; }
  /**
   * Honest cancellation: the local server cannot abort a save, SQLite write or package
   * build once sent, so a running request is never cancelled; its result still arrives.
   */
  cancel(requestId: number): CancelResult {
    return this.running?.requestId === requestId
      ? { accepted: false, reason: "Library and package requests cannot be cancelled once started; the result will still arrive." }
      : { accepted: false, reason: "No running request has that ID." };
  }
  /** Version of the draft's collection/preset content, for binding menus to what they were opened on. */
  contentVersion() { return this.content; }
  /** Cheap ownership read: `loaded` is false until a draft exists; `id` is the preset the editor belongs to. */
  selectedPreset(): { loaded: boolean; id?: string } {
    return this.actions ? { loaded: true, id: this.actions.selected() } : { loaded: false };
  }
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
    this.actions!.dispatch(action);
    this.content++;
    this.notify();
  }
  /** A restored draft's revision content is fetched once so dirty state can be exact after reload. */
  private async loadBaseline(summaries: CollectionSummary[]) {
    const draft = this.actions!.summary();
    if (draft.revision === undefined || this.baselines.has(`${draft.id}@${draft.revision}`)) return;
    if (!summaries.some(item => item.id === draft.id && item.revision === draft.revision)) return;
    try {
      const stored = await this.transport.get(draft.id);
      if (stored.revision === draft.revision && stored.collection.id === draft.id) this.remember(stored.collection, stored.revision);
    } catch { /* Baseline stays unknown; the draft itself is unaffected. */ }
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
    this.remember(saved.collection, saved.revision);
    await this.list();
    return saved;
  }
  async execute(request: CollectionRequest): Promise<CollectionOutcome> {
    const allowed = this.capability(request);
    if (!allowed.available) return { ok: false, code: "unavailable", message: allowed.reason! };
    this.busy = true;
    const requestId = ++this.requestSeq;
    this.running = { requestId, kind: request.kind, ...(request.kind === "package" ? { action: request.action } : {}),
      startedAt: Date.now(), cancellable: false };
    this.setProgress({ phase: "working", code: request.kind, requestId,
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
              this.remember(stored.collection, stored.revision);
              const existing = draft.collection.presets.find(p => p.id === id);
              if (existing) { existing.recipe = current.recipe; existing.name = this.legacy.name.trim() || existing.name; }
              else draft.collection.presets.push({ id, name: this.legacy.name.trim() || "Unsaved preset", revision: 1, recipe: current.recipe });
            }
            draft.selected = id; draft.editors[id] = { active: current.active, selected: current.selected,
              fieldSelection: current.fieldSelection, history: current.history };
            this.actions = new CollectionActions(draft, this.read, this.show); this.content++;
            message = summaries.length
              ? "Existing looks and your current draft are retained. Save collection to store this arrangement."
              : "Your starter collection is ready. Save it to the local library when you want to keep a revision.";
          } else {
            message = "Collection draft restored without replacing unsaved edits from SQLite.";
            await this.loadBaseline(summaries);
          }
          result = { kind: "list", summaries }; break;
        }
        case "refresh": result = { kind: "list", summaries: await this.list() };
          message = "Saved collection list refreshed; draft retained."; break;
        case "open": {
          const stored = await this.transport.get(request.id);
          // Opening is the only draft switch in this async operation. Existing changes are stashed first.
          this.actions!.dispatch({ kind: "collection.open", collection: stored.collection, revision: stored.revision });
          this.remember(stored.collection, stored.revision);
          this.content++;
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
            message = `Verified local ${built.modName ? `${built.modName} ` : ""}mod files for ${built.presetCount} of ${built.originalPresetCount} preset(s): ${built.package} · Manifest: ${built.manifest}. Not installed or game-tested.${describePackageOmissions(built.omissions)}`;
          }
          break;
        }
        case "import": {
          let collection: PresetCollection;
          try { collection = parseCollection(JSON.parse(request.text)); }
          catch (error) { throw new CollectionServiceError(error instanceof SyntaxError ? "invalid_json" : "invalid_collection",
            (error as Error).message); }
          this.actions!.dispatch({ kind: "collection.open", collection });
          this.content++;
          result = { kind: "imported" };
          message = "Imported collection draft. Existing IDs are preserved; Save a copy creates a separate collection. Undo collection open recovers the previous draft."; break;
        }
      }
      this.setProgress({ phase: "success", code: result.kind, message, requestId });
      return { ok: true, result, requestId };
    } catch (error) {
      const code = error instanceof CollectionServiceError ? error.code : error instanceof SyntaxError ? "invalid_json" : "request_failed";
      const message = (error as Error).message;
      this.setProgress({ phase: "error", code, message, requestId });
      return { ok: false, code, message, requestId };
    } finally { this.busy = false; this.running = undefined; this.notify(); }
  }
}
