import { CollectionActions, type CollectionAction, type CollectionDraftSummary, type ReadonlyDeep } from "./collection-actions";
import type { EditorSnapshot } from "./collection-session";
import { collectionDraft, newLook, NEWER_LOOKS_LIBRARY_MESSAGE, withLiveFeatures, withLiveMemory, withLivePart, type CollectionWorkspace,
  type DocumentModel } from "./collection-workspace";
import { COLLECTION_MESSAGE } from "./platform/core/document";
import { eyeMakeupCollection, parseCollection, planCollection, type PresetCollection } from "./preset-collection";
import type { Recipe } from "./recipe";
import { COLLECTION_1, COLLECTION_2, type Look, type LookCollection } from "./platform/api";
import type { CollectionSummary, StoredCollection } from "./collection-store";
import type { LibraryState } from "./workspace-state";
import type { PackageAction, PackageBuild, PackageCheck } from "./package-action";
import { describePackageExperimental, describePackageOmissions } from "./package-filter";
import { refusal, type Capability } from "./platform/api";

/** The plain reasons a collection has nothing to put in a mod because of looks made with a newer version (PIPE-44). */
export const EVERY_LOOK_NEWER_MESSAGE = "Every look in this collection was made with a newer version of XF Studio, so this version " +
  "can't put them in a mod. Update XF Studio to build it.";
export const NO_EDITABLE_EYE_MAKEUP_MESSAGE = "The looks with eye makeup here were made with a newer version of XF Studio, so this " +
  "version can't put them in a mod. Update XF Studio to build them, or add eye makeup to another look.";

export type CollectionRequest =
  | { kind: "initialize" | "refresh" | "save" | "saveCopy" | "exportPlan" }
  /** `draft`: the collection ID of an earlier draft in the recovery queue to export instead of the current one (unsaved). */
  | { kind: "exportCollection"; draft?: string }
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
/** A saved revision's content: each look's name, its parts as last read and their canonical text. */
type Baseline = { name: string; order: string[]; presets: Map<string, { name: string; raw: string; canonical: string }> };
/** Accepted requests carry their `requestId`; a refused request never started and has none. */
export type CollectionOutcome = { ok: true; result: CollectionResult; requestId?: number } |
  { ok: false; code: string; message: string; requestId?: number };
export type CollectionTransport = {
  list(): Promise<CollectionSummary[]>;
  get(id: string): Promise<StoredCollection>;
  /** Sends the draft's looks; the library writes each row in the oldest schema that holds it. */
  save(collection: LookCollection, revision?: number): Promise<StoredCollection>;
  /** The eye-makeup package pipeline still takes its `xfas/collection-1` view (moves to the product planner in step 8). */
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
  /**
   * The draft version the last successful package request described: the content counter, the
   * collection's identity and saved revision, the selected look and the live editor's revision
   * (CORE-28). Undefined without a result, or when the host has no cheap live read.
   */
  private packageKey?: string;
  /** Without a cheap live read: the exact authored input of the last package request (compared on demand). */
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
  constructor(private model: DocumentModel, restored: CollectionWorkspace | undefined, private legacy: LibraryState,
    private read: () => EditorSnapshot, private show: (editor: EditorSnapshot) => void,
    private transport: CollectionTransport,
    /** Cheap live editor read for dirty checks; defaults to the full editor snapshot. */
    private readRecipe?: () => { recipe: Recipe; revision: number;
      /** The other live features' parts and their revision (present only when the composition registers more features). */
      others?: { revision: number; parts: Record<string, unknown | undefined> } }) {
    if (restored) this.actions = new CollectionActions(model, restored, read, show);
  }
  /** Bookkeeping only: a baseline that cannot be recorded leaves dirty state unknown, never fails a request. */
  private remember(collection: LookCollection, revision: number) {
    let parsed: LookCollection, presets: Baseline["presets"];
    try {
      parsed = this.model.parts.readCollection(collection, true, "keep");
      presets = new Map(parsed.presets.map(preset => [preset.id, { name: preset.name, raw: JSON.stringify(preset.parts),
        canonical: this.model.parts.canonicalParts(preset.parts) }]));
    } catch { return; }
    this.persistenceCache = undefined;
    this.baselines.delete(`${parsed.id}@${revision}`);
    this.baselines.set(`${parsed.id}@${revision}`, { name: parsed.name, order: parsed.presets.map(preset => preset.id), presets });
    while (this.baselines.size > 8) this.baselines.delete(this.baselines.keys().next().value!);
  }
  persistence(): DraftPersistence | undefined {
    if (!this.actions) return undefined;
    const summary = this.actions.summary(), live = this.readRecipe?.();
    // Without a cheap live read there is no editor revision to key a cache on.
    const key = live && JSON.stringify([this.content, summary.id, summary.revision, summary.selected, live.revision,
      ...(live.others ? [live.others.revision] : [])]);
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
        const parts = preset.id === summary.selected ? liveParts(preset, liveRecipe, this.model, live?.others?.parts) : preset.parts;
        if (JSON.stringify(parts) === saved.raw) return false;
        // Gestures edit in place and may reorder keys; compare canonically before calling it a change.
        try { return this.model.parts.canonicalParts(parts) !== saved.canonical; } catch { return true; }
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
  /**
   * A package response describes its request snapshot, not necessarily the live draft. Repaints
   * ask this every frame, so it compares version keys only: no snapshot, no copy and never a
   * write of the live editor into the draft (CORE-28). An edit that is later undone still counts
   * as a change (the result reads stale until the next Check).
   */
  lastPackageIsCurrent(): boolean {
    if (!this.actions) return false;
    const key = this.draftKey();
    if (key !== undefined) return this.packageKey === key;
    // A host without a cheap live read (tests, tools) compares the exact input instead.
    if (!this.packageSource) return false;
    try { return this.packageSource === JSON.stringify(this.packageCollection()); }
    catch { return false; }
  }
  /** The draft's version: content counter, identity, saved revision, selected look and live editor revision. */
  private draftKey(): string | undefined {
    const live = this.readRecipe?.(), identity = this.actions?.identity();
    if (!live || !identity) return undefined;
    return JSON.stringify([this.content, identity.collectionId, this.actions!.summaryRevision(), identity.selected, live.revision]);
  }
  /** The eye-makeup package pipeline's input: the draft's looks with an eye-makeup part, as `xfas/collection-1`. */
  private packageCollection(): PresetCollection {
    return parseCollection(eyeMakeupCollection(this.actions!.snapshot().collection));
  }
  /**
   * Why the draft's eye-makeup view has no look to package, or undefined when it has one (CORE-34): a look
   * with an eye-makeup part, or the selected look while the live editor has layers. A look made with a newer
   * version of XF Studio never counts, since the export leaves it out (PIPE-44). Reads without copying.
   */
  private unpackageable(): string | undefined {
    const selected = this.actions!.selected(), live = this.model.live, looks = this.actions!.presetsForComparison();
    if (looks.some(look => !look.locked && (look.id === selected
      ? !!look.parts[live] || (this.readRecipe?.() ?? this.read()).recipe.layers.length > 0
      : !!look.parts[live]))) return undefined;
    if (looks.length && looks.every(look => look.locked)) return EVERY_LOOK_NEWER_MESSAGE;
    return looks.some(look => look.locked) ? NO_EDITABLE_EYE_MAKEUP_MESSAGE
      : "None of these presets has eye makeup yet, so there is nothing to put in a mod.";
  }

  /** Whether the draft has this preset, without cloning the draft (CORE-05). */
  hasPreset(id: string): boolean { return this.actions?.hasPreset(id) ?? false; }
  /** The draft's collection ID and selected preset, without cloning the draft (CORE-05); undefined while loading. */
  draftIdentity(): { collectionId: string; selected?: string } | undefined { return this.actions?.identity(); }
  /** True while a library or package request runs. */
  isBusy(): boolean { return this.busy; }
  /** Request capability with a structured reason code. */
  capability(request: CollectionRequest): Capability {
    if (this.busy) return refusal("busy", "Another collection request is in progress.");
    if (request.kind === "initialize") return { available: true };
    if (!this.actions) return refusal("not_ready", "Collection is still loading.");
    if (request.kind === "open" && !this.summaries.some(item => item.id === request.id))
      return refusal("invalid_value", "Saved collection is no longer in this list. Refresh it first.");
    if (request.kind === "import" && (!Number.isSafeInteger(request.bytes) || request.bytes < 0 || request.bytes > 16_000_000))
      return refusal("limit", "Collection exceeds the current 16 MB import budget.");
    // A look this build cannot read is kept exactly as it came; the library never takes it (its older rows stay as they are).
    if ((request.kind === "save" || request.kind === "saveCopy") && this.actions.presetsForComparison().some(look => look.locked))
      return refusal("unavailable", NEWER_LOOKS_LIBRARY_MESSAGE);
    // The draft is validated on every change, so only emptiness can refuse here; no snapshot is taken (CORE-05).
    if ((request.kind === "exportCollection" || request.kind === "exportPlan" || request.kind === "package") &&
        !this.actions.summary().presets.length) return refusal("invalid_value", COLLECTION_MESSAGE);
    // A build plan and a mod hold eye makeup only: they need a look that has some (CORE-34).
    if (request.kind === "exportPlan" || request.kind === "package") {
      const reason = this.unpackageable();
      if (reason) return refusal("invalid_value", reason);
    }
    if (request.kind === "exportCollection" && request.draft !== undefined && !this.actions.recoveryCollection(request.draft))
      return refusal("missing_target", "That earlier draft is no longer in the recovery list.");
    return { available: true };
  }
  /** Draft action capability with a structured reason code. */
  actionCapability(action: CollectionAction): Capability {
    if (this.busy) return refusal("busy", "A collection request is in progress.");
    return this.actions?.check(action) ?? refusal("not_ready", "Collection is still loading.");
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
            const model = this.model;
            const draft = stored
              ? collectionDraft(stored.collection, model, stored.revision)
              : collectionDraft({ schema: COLLECTION_2, id: crypto.randomUUID(), name: "My collection",
                presets: [{ ...newLook(id, this.legacy.name.trim() || "First look", model),
                  parts: { [model.live]: model.parts.envelope(model.live, current.recipe) } }] }, model);
            if (stored) {
              this.remember(stored.collection, stored.revision);
              const existing = draft.collection.presets.find(p => p.id === id);
              if (existing) { existing.parts = withLivePart(existing, current.recipe, model); existing.name = this.legacy.name.trim() || existing.name; }
              else {
                const look = newLook(id, this.legacy.name.trim() || "Unsaved preset", model);
                draft.collection.presets.push({ ...look, parts: withLivePart(look, current.recipe, model) });
              }
            }
            // Keep every editor-memory field (historyTrimmed included); only the recipe lives in the preset.
            const { recipe: _recipe, liveFeatures, ...memory } = current;
            draft.selected = id; draft.memory[id] = withLiveMemory(undefined, memory, model);
            // The editor's other live features belong to this look too.
            const look = draft.collection.presets.find(p => p.id === id)!, written = withLiveFeatures(look, draft.memory[id], liveFeatures, model);
            look.parts = written.parts; draft.memory[id] = written.memory;
            this.actions = new CollectionActions(model, draft, this.read, this.show); this.content++;
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
          if (request.kind === "exportCollection" && request.draft !== undefined) {
            // An earlier draft is exported as it is, never saved: the library's revision belongs to the current draft.
            const earlier = this.actions!.recoveryCollection(request.draft)! as LookCollection;
            result = { kind: "export", name: "xfs.collection.json", json: JSON.stringify(this.model.parts.writeMinimal(earlier), null, 2) };
            message = `Exported the earlier draft “${earlier.name}” with its recipes and stable preset identities. It wasn't saved to your library; your current draft is unchanged.`;
            break;
          }
          // The draft is saved first only when the library takes it: a collection that needs
          // `xfs/collection-2` is refused there (CORE-30), and exporting it to a file is exactly how
          // it is kept, so its draft snapshot is exported unsaved (CORE-38).
          const plan = request.kind === "exportPlan", draft = this.actions!.snapshot().collection;
          const storable = this.model.parts.writeMinimal(draft).schema === COLLECTION_1;
          const collection = storable ? (await this.save(false)).collection : draft;
          // A collection file is written in the oldest schema that holds it exactly: `xfas/collection-1`
          // for eye-makeup looks, so 0.1.0-alpha.1 and the build tools read it (feature-module platform §2).
          result = { kind: "export", name: plan ? "xfs.build-plan.json" : "xfs.collection.json",
            json: JSON.stringify(plan ? planCollection(eyeMakeupCollection(collection))
              : this.model.parts.writeMinimal(collection), null, 2) };
          const locked = collection.presets.filter(look => look.locked);
          const kept = storable ? "It was also saved to your library first."
            : locked.length
            ? plan ? "It wasn't saved to your library: it has a look made with a newer version of XF Studio. Your draft is kept."
              : "It wasn't saved to your library: it has a look made with a newer version of XF Studio, which is exported exactly as it came. Your draft is kept."
            : "It wasn't saved to your library: it has parts the released XF Studio 0.1.0-alpha.1 can't read, and that version opens the same library. Your draft is kept.";
          // The plan holds eye makeup only; what it leaves out is listed in the file's `omitted` and named here (PIPE-45).
          const left = plan && locked.length ? ` Not in the plan: ${locked.map(look => `“${look.name}”`).join(", ")}, made with a newer version of XF Studio.` : "";
          message = plan ? `Build plan exported for the offline compiler; this is not an installable mod.${left} ${kept}`
            : storable ? "Collection saved to your library and exported. Recipes and stable preset identities are included."
            : `Collection exported with its recipes and stable preset identities. ${kept}`; break;
        }
        case "package": {
          // Snapshot the unsaved editor state once; this request never writes SQLite or changes revision.
          const key = this.draftKey(), snapshot = this.packageCollection();
          const source = key === undefined ? JSON.stringify(snapshot) : undefined;
          const response = await this.transport.package(request.action, snapshot);
          this.packageKey = key; this.packageSource = source;
          if (request.action === "check") {
            const checked = response as PackageCheck;
            result = { kind: "packageCheck", result: checked };
            message = `${checked.presets.length} of ${checked.originalPresetCount} preset(s) can become mod files. This check created no files.${(checked.notes ?? []).map(note => ` ${note}`).join("")}${describePackageOmissions(checked.omissions)}${describePackageExperimental(checked.experimental)}`;
          } else {
            const built = response as PackageBuild;
            result = { kind: "packageBuild", result: built };
            message = `Verified local ${built.modName ? `${built.modName} ` : ""}mod files for ${built.presetCount} of ${built.originalPresetCount} preset(s): ${built.package} · Manifest: ${built.manifest}. Not installed or game-tested.${describePackageOmissions(built.omissions)}${describePackageExperimental(built.experimental)}`;
          }
          break;
        }
        case "import": {
          // Either collection schema imports; parts of features this build lacks are kept.
          let collection: LookCollection;
          // A look this build cannot read is kept exactly as it came and locked; the others are editable.
          try { collection = this.model.parts.readCollection(JSON.parse(request.text), false, "keep"); }
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

/** A look's parts with the live editor's recipe as its live-feature part (no parse; for dirty checks). */
function liveParts(look: Readonly<Look>, recipe: Recipe, model: DocumentModel,
  others?: Readonly<Record<string, unknown | undefined>>): Look["parts"] {
  // A locked look is never written from the editor: its kept parts are what it holds.
  if (look.locked) return look.parts;
  let parts = look.parts;
  if (look.parts[model.live] || recipe.layers.length) parts = { ...parts, [model.live]: model.parts.envelope(model.live, recipe) };
  if (!others) return parts;
  // The other live features' parts as the editor holds them (absent: the look lacks the feature).
  parts = { ...parts };
  for (const [feature, part] of Object.entries(others))
    if (part === undefined) delete parts[feature]; else parts[feature] = model.parts.envelope(feature, part);
  return parts;
}
