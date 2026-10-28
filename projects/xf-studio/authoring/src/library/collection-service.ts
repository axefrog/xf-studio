/**
 * The Studio's collection service (profiles design §7, `CollectionService` folded into `CollectionOwner`): the library requests and
 * preset actions of the collection a scene's look belongs to, as owner commands. It holds no draft of its own: the collection and its
 * looks are working copies in the library (`collection-owner.ts`, through the outbox), the look a scene shows is the scene's (`LookRef`),
 * and the shown look's edits are the look editor's (`look-editor.ts`).
 *
 * - **Presets** are the collection's looks: Add, Copy, Rename, Move, Remove and Restore are owner commands (one each). Choosing a preset
 *   is `scene.setLook` (app/profiles/scene-commands.ts); the service follows the scene to the collection it shows.
 * - **Save version** (Ctrl+S) makes a named version older builds read (`/api/collection-versions`), from the host's own snapshot of the
 *   working copies after the collection's changes have reached the library. Save as new collection makes a new working copy (fresh IDs)
 *   and saves its first version.
 * - **Check, Build and export** read a coherent snapshot (the collection and its live looks in one read, once its changes have reached the
 *   library); export saves a version first, as before.
 * - **Opening and importing** never replace anything: opening a saved collection shows its working copy (made from the saved version the
 *   first time), importing makes a new working copy, and each joins the profile. Reopen previous (and Reopen on a recent draft) shows the collection shown before.
 * - **Recent drafts** are the library's other working copies never saved as a version (an earlier draft brought into the library, an
 *   import not saved yet).
 */
import { COLLECTION_MESSAGE } from "../platform/core/document";
import type { Recipe } from "../engines/layered-makeup/recipe";
import { COLLECTION_2, isKeptPackagePlan, PLAN_ISSUE_MESSAGE, refusal, storedPackagePlan, type Capability, type KeptPackagePlan, type Look, type LookCollection,
  type ModPackagePlan, type PackageBuildProgress, type PackageBuildResult, type PackageCheckResult, type PackagePlanIssue } from "../platform/api";
import { nameIssue, positionIssue, refuse } from "../platform/api/validation-issues";
import type { OutboxEdit } from "../platform/core/document-outbox";
import { registeredCollectionExport, NO_COLLECTION_EXPORT } from "./collection-export";
type PackageAction = "check" | "build";
import { hostClock, type Clock } from "../platform/core/clock";
import { collectionProducts, copyPackagePlan, editPackagePlan, packagePlanEditIssue, type PlannedProduct } from "../platform/core/package-plan";
import { withLivePart } from "../app/workspace/makeup-workspace";
import { NEWER_LOOKS_LIBRARY_MESSAGE, newPresetName, starterLook, type DocumentModel } from "../app/workspace/collection-workspace";
import { type CollectionAction, type CodedCapability, type CollectionConflict, CONFLICT_FIRST, type CollectionDraftSummary, packagePlanEdit, type PackageProductSummary, type ReadonlyDeep,
  type CollectionSummary, type StoredCollection, PACKAGE_PLAN_KINDS, type PackagePlanAction } from "./collection-actions";
import { type CollectionSnapshot, type CollectionView, type CollectionOwner, type LookInput, MAX_LOOKS_AT_CREATE } from "./collection-owner";
import { COLLECTION_WORKING, collectionRef, collectionWorkingOf, LOOK_WORKING, lookRef, lookWorkingOf, type LookRef, sameLook } from "./collection-documents";
import { documentKey } from "../platform/api/document-commands";
import type { OutboxEntry } from "../platform/core/document-outbox";

/** The plain reasons a collection has nothing to put in a mod because of looks made with a newer version (PIPE-44). */
export { EVERY_LOOK_NEWER_MESSAGE } from "./collection-export";
const LOADING = "Collection is still loading.";
/** How many collections Reopen previous steps back through. */
export const PREVIOUS_LIMIT = 8;

export type CollectionRequest =
  | { kind: "initialize" | "refresh" | "save" | "saveCopy" | "exportPlan" }
  /** `draft`: another working copy (a recent draft) to export instead of the shown one, unsaved. */
  | { kind: "exportCollection"; draft?: string }
  | { kind: "open"; id: string }
  | { kind: "import"; text: string; bytes: number }
  | { kind: "package"; action: PackageAction }
  /** Keep mine, Use theirs or Keep both for a conflict on this collection or one of its presets (style guide t-conflict). */
  | { kind: "resolveConflict"; conflict: string; keep: "mine" | "theirs" | "both" };
export type CollectionResult =
  | { kind: "list"; summaries: CollectionSummary[] }
  | { kind: "opened"; collection: StoredCollection }
  | { kind: "saved"; collection: StoredCollection }
  | { kind: "export"; name: string; json: string }
  | { kind: "imported" }
  | { kind: "packageCheck"; result: PackageCheckResult }
  | { kind: "packageBuild"; result: PackageBuildResult }
  | { kind: "resolved" };
export type CollectionProgress = { phase: "working" | "success" | "error"; code: string; message: string;
  /** How far the work has got (0–1), while it can say (a Build's stage, PIPE-131); absent while it can't. */
  fraction?: number;
  /** The request this progress belongs to (audit A-9). */
  requestId?: number };
/** One accepted async request in flight. Only Build can be stopped. */
export type CollectionActivity = { requestId: number; kind: CollectionRequest["kind"]; action?: PackageAction;
  startedAt: number; cancellable: boolean };
export type CancelResult = { accepted: true; reason?: undefined } | { accepted: false; reason: string };
/** Cheap detached projection for frequently repainted views. */
export type CollectionServiceSummary = { busy: boolean; progress?: CollectionProgress;
  summaries: CollectionSummary[]; draft?: CollectionDraftSummary;
  /** The XF mods the collection would build (feature-module platform §6); absent while the collection loads. */
  products?: PackageProductSummary[];
  /** Why the collection's package plan can't be used (made with a newer version, or damaged), in plain words (CORE-91). */
  packagePlanIssue?: string };
export type CollectionServiceState = CollectionServiceSummary;
/**
 * The shown collection against the named version it was last saved as (audit A-1). `baseline` is `none` for a collection never saved,
 * `unknown` while that version's content is being read back (dirty is then undefined rather than guessed), `unavailable` when it
 * couldn't be read (it is read again on the next library refresh; dirty is undefined too), and `known` otherwise. Preset renames and edits mark that preset; a collection rename, reorder, addition or removal marks the structure. The shown
 * look is compared as the editor holds it.
 */
export type DraftPersistence = { collectionId: string; savedRevision?: number;
  baseline: "none" | "unknown" | "unavailable" | "known"; dirty?: boolean; dirtyPresets: string[]; structureDirty?: boolean };
/** A saved version's content: each look's name, its parts as last read and their canonical text. */
type Baseline = { name: string; order: string[]; presets: Map<string, { name: string; raw: string; canonical: string }>;
  /** The saved package plan's JSON (`null`: the default). */
  plan: string };
/** Accepted requests carry their `requestId`; a refused request never started and has none. */
export type CollectionOutcome = { ok: true; result: CollectionResult; requestId?: number } |
  { ok: false; code: string; message: string; requestId?: number };
/** The released library (named versions) and the package routes; versions are saved through the collection owner. */
export type CollectionTransport = {
  list(): Promise<CollectionSummary[]>;
  get(id: string): Promise<StoredCollection>;
  /** Sends the collection's stored form (with its package plan); the host plans every product and answers them all. */
  package(action: PackageAction, collection: unknown, signal?: AbortSignal): Promise<PackageCheckResult | PackageBuildResult>;
  /** The running Build's stage (PIPE-131); null when none runs or the host can't say. Optional. */
  packageProgress?(): Promise<PackageBuildProgress | null>;
};

/** How often a running Build's stage is asked for. */
export const BUILD_PROGRESS_INTERVAL_MS = 400;

export class CollectionServiceError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** The scene whose look the service works on (the drawn view's, phase 1): which look it shows, and showing another (`scene.setLook`). */
export type CollectionScenePort = {
  look(): LookRef | undefined;
  setLook(ref: LookRef | undefined): void;
  subscribe(listener: () => void): () => void;
};
export type CollectionServiceDeps = {
  /** A scoped input's semantic/lifetime check, revalidated before a delayed request creates or selects data. */
  readonly current?: () => Capability;
  /** A bound inspector keeps its exact empty/missing/removed destination; initialization never chooses a replacement for it. */
  readonly preserveEmpty?: boolean;
  readonly model: DocumentModel;
  readonly owner: CollectionOwner;
  readonly scene: CollectionScenePort;
  readonly transport: CollectionTransport;
  /** Writes the shown look's edits now (`LookEditor.commit`); false when they couldn't be recorded. */
  readonly flushLook?: () => boolean;
  /** Cheap live read of the shown look as the editor holds it (dirty checks, freshness); absent: the working copy's. */
  readonly readParts?: () => { revision: number; parts: Record<string, unknown | undefined> };
  /** Transitional callers of the concrete makeup editor; production reads the neutral owner. */
  readonly readRecipe?: () => { recipe: Recipe; revision: number; others?: { revision: number; parts: Record<string, unknown | undefined> } };
  /** The profile's membership edit for a collection made, imported or opened here (null: already listed), written in the same command. */
  readonly membership?: (collection: string) => OutboxEdit | null;
  /** Lists an existing collection in the profile (a recent draft opened). */
  readonly join?: (collection: string) => void;
  readonly newId?: () => string;
  readonly clock?: Clock;
  /** The live feature's part a new look starts from (its chosen default starter's); absent: the feature's own starter. */
  readonly starterPart?: () => unknown;
};

type Parsed = { key: string; collection: LookCollection };

export class CollectionService {
  private busy = false;
  private progress?: CollectionProgress;
  private packageKey?: string;
  private buildAbort?: AbortController;
  private summaries: CollectionSummary[] = [];
  private listeners = new Set<() => void>();
  /**
   * Advances whenever the shown collection's identity or structure changes (which collection, its name, looks, their names and order,
   * the look shown); the shown look's own edits, progress, busy and the saved list do not count.
   */
  private content = 0;
  private structure = "";
  private baselines = new Map<string, Baseline>();
  /** Saved versions being read back to compare with (`collection@revision`): the chip's Working… while one is pending. */
  private baselineReads = new Set<string>();
  /** Saved versions that couldn't be read back: no comparison (the chip names the version) until the next library refresh reads them. */
  private baselineFailed = new Set<string>();
  private persistenceCache?: { key: string; value: DraftPersistence };
  private requestSeq = 0;
  private listSeq = 0;
  private running?: CollectionActivity;
  private parsed?: Parsed;
  /** The looks shown before an open or import, newest last (Reopen previous). */
  private previous: LookRef[] = [];
  /** The look last shown in each collection, to come back to it. */
  private lastShown = new Map<string, string>();
  /** The collection shown: the scene's look's, kept while the scene shows no look (its last preset was removed). */
  private current: string | undefined;
  private readonly clock: Clock;
  private readonly unsubscribe: () => void;
  private disposed = false;
  private resultReaders = 0;

  constructor(private readonly deps: CollectionServiceDeps) {
    this.clock = deps.clock ?? hostClock();
    const changed = () => {
      const structure = this.structureKey();
      if (structure !== this.structure) { this.structure = structure; this.content++; }
      if (this.packageKey && this.packageKey !== this.draftKey()) this.packageKey = undefined;
      this.persistenceCache = undefined;
      this.notify();
    };
    this.current = deps.scene.look()?.collection;
    this.structure = this.structureKey();
    const offOwner = deps.owner.subscribe(changed), offScene = deps.scene.subscribe(() => {
      const ref = deps.scene.look();
      if (ref) { this.lastShown.set(ref.collection, ref.look); this.current = ref.collection; }
      changed();
    });
    this.unsubscribe = () => { offOwner(); offScene(); };
  }
  dispose() {
    this.disposed = true; this.buildAbort?.abort();
    if (!this.resultReaders) { this.unsubscribe(); this.listeners.clear(); }
  }
  /** A completed package keeps only this bound read service alive, never its editable-context want. */
  retainPackageResult(): () => void {
    this.resultReaders++;
    let released = false;
    return () => {
      if (released) return; released = true;
      if (!--this.resultReaders && this.disposed) { this.unsubscribe(); this.listeners.clear(); }
    };
  }
  private newId() { return (this.deps.newId ?? (() => crypto.randomUUID()))(); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify() { for (const listener of [...this.listeners]) listener(); }

  // -------------------------------------------------------------------------------------------------------------
  // The shown collection

  /** What `content` follows: the shown collection's identity and structure, and the look shown. */
  private structureKey(): string {
    const view = this.shown();
    return JSON.stringify(view ? [view.id, view.name, view.looks, view.removed.map(item => item.look),
      this.deps.owner.looksOf(view.id).map(look => look.name), this.selectedId(), view.packagePlan ?? null] : null);
  }
  /** The collection the scene's look belongs to, or the one shown last while the scene shows no look (null: none, or it is gone). */
  private shown(): CollectionView | null {
    const id = this.deps.scene.look()?.collection ?? this.current;
    return id ? this.deps.owner.collection(id) : null;
  }
  private selectedId(): string | undefined {
    const ref = this.deps.scene.look(), view = this.shown();
    return ref && view?.looks.includes(ref.look) ? ref.look : undefined;
  }
  /** The shown collection as looks (parsed, cached by revision): what products, summaries and comparisons read. */
  private collection(id?: string): LookCollection | undefined {
    const view = id === undefined ? this.shown() : this.deps.owner.collection(id);
    if (!view) return undefined;
    const looks = this.deps.owner.looksOf(view.id);
    const key = JSON.stringify([view.id, view.revision, looks.map(look => [look.id, look.revision])]);
    if (this.parsed?.key === key) return this.parsed.collection;
    const presets = looks.map(look => {
      const stored = { id: look.id, name: look.name, revision: 1, parts: look.parts };
      try { return this.deps.model.parts.readPreset(stored, COLLECTION_2, "keep"); }
      catch { return this.deps.model.parts.keepLook(stored, COLLECTION_2); }
    });
    let packagePlan: LookCollection["packagePlan"];
    if (view.packagePlan !== undefined) {
      try { packagePlan = this.deps.model.parts.readCollection({ schema: COLLECTION_2, id: view.id, name: view.name, presets: [], packagePlan: view.packagePlan }, true, "keep").packagePlan; }
      catch { packagePlan = undefined; }
    }
    const collection: LookCollection = { schema: COLLECTION_2, id: view.id, name: view.name, presets, ...(packagePlan ? { packagePlan } : {}) };
    this.parsed = { key, collection };
    return collection;
  }

  summary(): CollectionServiceSummary {
    const view = this.shown(), collection = this.collection();
    const draft = view && collection ? this.draftSummary(view, collection) : undefined;
    const issue = collection ? this.packagePlanIssue(collection) : undefined;
    return { busy: this.busy, progress: this.progress && { ...this.progress }, summaries: this.summaries.map(item => ({ ...item })),
      ...(draft ? { draft } : {}), ...(collection ? { products: this.productSummary(collection) } : {}),
      ...(issue ? { packagePlanIssue: issue.message } : {}) };
  }
  view(): ReadonlyDeep<CollectionServiceState> { return this.summary(); }
  private draftSummary(view: CollectionView, collection: LookCollection): CollectionDraftSummary {
    const live = this.deps.model.live, owner = this.deps.owner;
    const removed = owner.restorable(view.id).slice().reverse().map(item => ({ id: item.look, name: item.name, index: item.index ?? view.looks.length }));
    const previous = this.previous.at(-1), previousView = previous ? owner.collection(previous.collection) : null;
    const recovery = this.recent(view.id).map(other => ({ id: other.id, name: other.name, presets: other.looks.length, saved: "never" as const }));
    return { id: view.id, name: view.name, ...(view.saved ? { revision: view.saved.revision } : {}), selected: this.selectedId(),
      presets: collection.presets.map(look => ({ id: look.id, name: look.name, revision: look.revision,
        layers: Number(live ? this.deps.model.parts.summary(look, live)?.layers ?? 0 : 0), ...(look.locked ? { locked: true as const } : {}) })),
      removed, ...(previousView ? { previous: { id: previousView.id, name: previousView.name, ...(previousView.saved ? { revision: previousView.saved.revision } : {}) } } : {}),
      recovery, conflicts: this.conflictsOf(view.id) };
  }
  /** The conflicts on a collection or any of its presets (listed or removed), oldest first, as the Presets panel shows them. */
  private conflictEntries(id: string): readonly OutboxEntry[] {
    const view = this.deps.owner.collection(id);
    if (!view) return [];
    const keys = new Set([documentKey(collectionRef(id)), ...[...view.looks, ...view.removed.map(item => item.look)]
      .map(look => documentKey(lookRef({ collection: id, look })))]);
    return this.deps.owner.conflicts().filter(entry => entry.writes.some(write => keys.has(documentKey(write))));
  }
  private conflictsOf(id: string): CollectionConflict[] {
    return this.conflictEntries(id).map(entry => ({ id: entry.id, message: conflictMessage(entry), subject: conflictSubject(entry),
      keepBoth: entry.writes.some(write => write.kind === LOOK_WORKING && lookWorkingOf(write.value)?.state === "live") }));
  }
  /** The library's other working copies never saved as a version, newest first. */
  private recent(except: string): readonly CollectionView[] {
    return this.deps.owner.list().filter(view => view.id !== except && !view.saved && view.looks.length).reverse();
  }
  private products(collection: LookCollection): PlannedProduct[] {
    // The shown look counts as holding the live feature: its editor may not have written it yet.
    const selected = this.selectedId(), live = this.deps.model.live;
    const looks = collection.presets.map(look => live && look.id === selected && !look.parts[live] ? { parts: { ...look.parts, [live]: {} } } : look);
    try { return collectionProducts({ ...collection, presets: looks } as LookCollection, this.deps.model.parts.exporting()); }
    catch { return []; }
  }
  private labels(): Record<string, string> {
    return Object.fromEntries(this.deps.model.parts.exporting().map(feature => [feature.id, feature.label]));
  }
  private productSummary(collection: LookCollection): PackageProductSummary[] {
    const labels = this.labels();
    return this.products(collection).map(product => ({ id: product.id, isDefault: product.isDefault, modName: product.modName,
      nameSource: product.nameSource, features: product.features.map(id => ({ id, label: labels[id] ?? id })) }));
  }
  private packagePlanIssue(collection: LookCollection): { issue: PackagePlanIssue; message: string } | undefined {
    const plan = collection.packagePlan;
    return isKeptPackagePlan(plan) ? { issue: plan.issue, message: PLAN_ISSUE_MESSAGE[plan.issue] } : undefined;
  }

  /** Bookkeeping only: a baseline that can't be recorded leaves dirty state unknown, never fails a request. */
  private remember(collection: LookCollection, revision: number) {
    let parsed: LookCollection, presets: Baseline["presets"];
    try {
      parsed = this.deps.model.parts.readCollection(collection, true, "keep");
      presets = new Map(parsed.presets.map(preset => [preset.id, { name: preset.name, raw: JSON.stringify(preset.parts),
        canonical: this.deps.model.parts.canonicalParts(preset.parts) }]));
    } catch { return; }
    this.persistenceCache = undefined;
    this.baselines.delete(`${parsed.id}@${revision}`);
    this.baselines.set(`${parsed.id}@${revision}`, { name: parsed.name, order: parsed.presets.map(preset => preset.id), presets,
      plan: JSON.stringify(parsed.packagePlan ?? null) });
    while (this.baselines.size > 8) this.baselines.delete(this.baselines.keys().next().value!);
  }
  persistence(): DraftPersistence | undefined {
    const view = this.shown(), collection = this.collection();
    if (!view || !collection) return undefined;
    const live = this.readLive(), selected = this.selectedId(), revision = view.saved?.revision;
    const key = JSON.stringify([this.content, this.versions(view), revision, live?.revision, (live && "others" in live ? live.others?.revision : undefined), [...this.baselineReads], [...this.baselineFailed]]);
    if (this.persistenceCache?.key === key) return structuredClone(this.persistenceCache.value);
    const ids = collection.presets.map(preset => preset.id), base = revision === undefined ? undefined : this.baselines.get(`${view.id}@${revision}`);
    let value: DraftPersistence;
    if (revision === undefined) value = { collectionId: view.id, baseline: "none", dirty: true, dirtyPresets: ids, structureDirty: true };
    // Not read yet: unavailable once a read failed (until a refresh reads it again), else in progress (the read is pending or about to start).
    else if (!base) value = { collectionId: view.id, savedRevision: revision, dirtyPresets: [],
      baseline: this.baselineFailed.has(`${view.id}@${revision}`) && !this.baselineReads.has(`${view.id}@${revision}`) ? "unavailable" : "unknown" };
    else {
      const dirtyPresets = collection.presets.filter(preset => {
        const saved = base.presets.get(preset.id);
        if (!saved || saved.name !== preset.name) return true;
        const parts = preset.id === selected && live ? liveParts(preset, live, this.deps.model) : preset.parts;
        if (JSON.stringify(parts) === saved.raw) return false;
        try { return this.deps.model.parts.canonicalParts(parts) !== saved.canonical; } catch { return true; }
      }).map(preset => preset.id);
      const structureDirty = base.name !== view.name || base.order.join() !== ids.join() || base.plan !== JSON.stringify(collection.packagePlan ?? null);
      value = { collectionId: view.id, savedRevision: revision, baseline: "known", dirty: structureDirty || dirtyPresets.length > 0, dirtyPresets, structureDirty };
    }
    this.persistenceCache = { key, value };
    return structuredClone(value);
  }

  /** The accepted request in flight, if any (requests are serialized). */
  activity(): CollectionActivity | undefined { return this.running && { ...this.running }; }
  /** Only Build is cancellable; library writes finish once accepted. */
  cancel(requestId: number): CancelResult {
    if (this.running?.requestId === requestId && this.buildAbort && !this.buildAbort.signal.aborted) {
      this.running.cancellable = false;
      this.setProgress({ phase: "working", code: "package", requestId, message: "Stopping…" });
      this.buildAbort.abort(); this.notify();
      return { accepted: true };
    }
    return this.running?.requestId === requestId
      ? { accepted: false, reason: "Library and package requests cannot be cancelled once started; the result will still arrive." }
      : { accepted: false, reason: "No running request has that ID." };
  }
  /** Version of the shown collection's content, for binding menus to what they were opened on. */
  contentVersion() { return this.content; }
  /** Cheap ownership read: `loaded` is false until a collection is shown; `id` is the look the editor shows. */
  selectedPreset(): { loaded: boolean; id?: string } { return this.shown() ? { loaded: true, id: this.selectedId() } : { loaded: false }; }
  /**
   * Whether the last package result describes the collection as it is now: its content, identity, saved version, shown look and the
   * editor's revision (CORE-28). An edit later undone still counts as a change (the result reads stale until the next Check).
   */
  lastPackageIsCurrent(): boolean { return !!this.packageKey && this.packageKey === this.draftKey(); }
  private readLive() { return this.deps.readParts?.() ?? this.deps.readRecipe?.(); }
  private draftKey(): string | undefined {
    const view = this.shown();
    if (!view) return undefined;
    const live = this.readLive();
    // The original document may retire after completion. Its look's recorded parts still change on every edit,
    // including edits through a newly acquired context; memory/selection-only writes do not change those parts.
    const selected = this.selectedId(), parts = selected && this.deps.owner.look({ collection: view.id, look: selected })?.parts;
    return JSON.stringify([this.content, this.versions(view), view.saved?.revision, live?.revision, (live && "others" in live ? live.others?.revision : undefined), parts]);
  }
  /** The versions of the shown collection's looks other than the shown one (whose content is the editor's revision). */
  private versions(view: CollectionView) {
    const selected = this.selectedId();
    return this.deps.owner.looksOf(view.id).filter(look => look.id !== selected).map(look => [look.id, look.revision]);
  }
  /** Why the collection has no look to package, or undefined when it has one (CORE-34, PIPE-44). */
  private unpackageable(collection: LookCollection): string | undefined {
    const bridge = registeredCollectionExport(this.deps.model);
    if (!bridge) return NO_COLLECTION_EXPORT;
    const selected = this.selectedId(), current = this.readLive();
    return bridge.unavailable({ ...collection, presets: collection.presets.map(look => !look.locked && look.id === selected && current
      ? { ...look, parts: liveParts(look, current, this.deps.model) } : look) });
  }
  hasPreset(id: string): boolean { return !!this.shown()?.looks.includes(id); }
  draftIdentity(): { collectionId: string; selected?: string } | undefined {
    const view = this.shown();
    return view ? { collectionId: view.id, selected: this.selectedId() } : undefined;
  }
  isBusy(): boolean { return this.busy; }

  // -------------------------------------------------------------------------------------------------------------
  // Capabilities

  capability(request: CollectionRequest): Capability {
    const current = this.deps.current?.(); if (current && !current.available) return current;
    if (this.busy) return refusal("busy", "Another collection request is in progress.");
    if (request.kind === "initialize") return { available: true };
    const collection = this.collection();
    if (!collection) return refusal("not_ready", LOADING);
    if (request.kind === "open" && !this.summaries.some(item => item.id === request.id))
      return refusal("invalid_value", "Saved collection is no longer in this list. Refresh it first.");
    if (request.kind === "open" && request.id === collection.id) return refusal("invalid_value", "This collection is already open.");
    if (request.kind === "import" && (!Number.isSafeInteger(request.bytes) || request.bytes < 0 || request.bytes > 16_000_000))
      return refusal("limit", "That collection is larger than 16 MB, the most XF Studio can import.");
    // A look this build can't read is kept exactly as it came; the library's named versions never take it.
    if ((request.kind === "save" || request.kind === "saveCopy") && collection.presets.some(look => look.locked))
      return refusal("unavailable", NEWER_LOOKS_LIBRARY_MESSAGE);
    if (request.kind === "resolveConflict") {
      const conflict = this.conflictsOf(collection.id).find(item => item.id === request.conflict);
      if (!conflict) return refusal("missing_target", "That was already resolved.");
      if (!["mine", "theirs", "both"].includes(request.keep)) return refusal("invalid_value", "Choose Keep mine, Use other window's or Keep both.");
      return request.keep === "both" && !conflict.keepBoth ? refusal("unavailable", "Only a preset can be kept as a copy; choose Keep mine or Use other window's.") : { available: true };
    }
    // A conflict waits on this collection or a preset: the person chooses first (the Presets panel shows how).
    if (["save", "saveCopy", "exportCollection", "exportPlan", "package"].includes(request.kind) && this.conflictEntries(collection.id).length)
      return refusal("stale", CONFLICT_FIRST);
    if ((request.kind === "exportCollection" || request.kind === "exportPlan" || request.kind === "package") && !collection.presets.length)
      return refusal("invalid_value", COLLECTION_MESSAGE);
    const issue = this.packagePlanIssue(collection);
    if (request.kind === "package" && issue) return refusal("unavailable", issue.message);
    if (request.kind === "exportPlan" || request.kind === "package") {
      const reason = this.unpackageable(collection);
      if (reason) return refusal("invalid_value", reason);
    }
    if (request.kind === "exportCollection" && request.draft !== undefined && !this.recent(collection.id).some(view => view.id === request.draft))
      return refusal("missing_target", "That earlier draft is no longer in the list.");
    return { available: true };
  }
  actionCapability(action: CollectionAction): CodedCapability {
    if (this.busy) return refusal("busy", "A collection request is in progress.");
    const view = this.shown(), collection = this.collection();
    if (!view || !collection) return refusal("not_ready", LOADING);
    // The collection the action names is the one shown (phase 1 shows one): another is refused, never acted on in its place.
    if (action.collection !== view.id) return refusal("missing_target", "That collection isn't the one open here.");
    if (view.conflict)
      return refusal("stale", "This collection changed in another window too. Choose which version to keep first.");
    switch (action.kind) {
      case "collection.undoOpen":
        if (action.draft !== undefined) return this.recent(view.id).some(other => other.id === action.draft)
          ? { available: true } : refusal("missing_target", "That earlier draft is no longer in the list.");
        return this.previousLook() ? { available: true } : refusal("invalid_value", "No collection was open before this one.");
      case "preset.edit": {
        const command = action.command;
        if (command.kind === "restore" && !this.deps.owner.restorable(view.id).length) return refusal("invalid_value", "No removed preset to restore.");
        if ("id" in command && !view.looks.includes(command.id)) return refusal("missing_target", "That preset no longer exists.");
        const newId = "newId" in command ? command.newId : undefined;
        if (newId && (view.looks.includes(newId) || view.removed.some(item => item.look === newId)))
          return refusal("invalid_value", "That preset ID is already in use.");
        if ((command.kind === "add" || command.kind === "copy") && view.looks.length + view.removed.length >= 4096)
          return refusal("limit", "This collection has as many presets as it can hold.");
        const issue = command.kind === "move" ? positionIssue(command.to, view.looks.length,
          { below: "This preset is already first.", above: "This preset is already last." }) :
          command.kind === "rename" ? nameIssue(command.name, 120) : undefined;
        return issue ? refuse(issue) : { available: true };
      }
      case "collection.rename": { const issue = nameIssue(action.name, 120); return issue ? refuse(issue) : { available: true }; }
      case "collection.importRecipe": return { available: true };
      default: return this.planCapability(action, collection);
    }
  }
  private planCapability(action: PackagePlanAction, collection: LookCollection): CodedCapability {
    const issue = this.packagePlanIssue(collection);
    if (issue) return refusal("unavailable", issue.message);
    const products = this.products(collection);
    if (!products.length) return refusal("unavailable", "No look in this collection has anything XF Studio can make into mod files yet.");
    const editIssue = packagePlanEditIssue(packagePlanEdit(action, "00000000-0000-4000-8000-000000000000"), products, collection.id, this.labels());
    if (editIssue) return refusal(action.kind === "package.rename" && action.modName.trim() ? "invalid_value" : "unavailable", editIssue);
    if (action.kind === "package.split" && action.newId && (action.newId === collection.id || products.some(p => p.id === action.newId)))
      return refusal("invalid_value", "That mod ID is already in use.");
    return { available: true };
  }

  // -------------------------------------------------------------------------------------------------------------
  // Actions

  dispatch(action: CollectionAction) {
    const allowed = this.actionCapability(action);
    if (!allowed.available) throw new CollectionServiceError("unavailable", allowed.reason!);
    const view = this.shown()!, owner = this.deps.owner, id = view.id;
    const done = (answer: ReturnType<CollectionOwner["dispatch"]>) => {
      if (!answer.ok) throw new CollectionServiceError(answer.code ?? "unavailable", answer.reason);
      return answer;
    };
    switch (action.kind) {
      case "collection.rename": done(owner.dispatch({ kind: "collection.rename", collection: id, base: view.revision, name: action.name.trim() })); break;
      case "collection.importRecipe": {
        const look = starterLook(this.newId(), "Imported preset", this.deps.model);
        const parts = withLivePart(look, action.recipe, this.deps.model);
        const made = done(owner.dispatch({ kind: "collection.addLook", collection: id, base: view.revision,
          look: { name: action.name.trim().slice(0, 120) || "Imported preset", ...this.storedLook({ ...look, parts }) } }));
        this.show(made.look!);
        break;
      }
      case "collection.undoOpen": {
        if (action.draft !== undefined) { this.open(action.draft); break; }
        const back = this.previousLook()!;
        this.previous = this.previous.filter(item => !sameLook(item, back));
        this.deps.scene.setLook(back);
        break;
      }
      case "preset.edit": this.editPresets(view, action.command); break;
      default: {
        const collection = this.collection()!;
        if (isKeptPackagePlan(collection.packagePlan)) throw new CollectionServiceError("unavailable", "This collection's mod packaging choices can't be changed in this version.");
        const plan = editPackagePlan(collection.packagePlan as ModPackagePlan | undefined, packagePlanEdit(action, this.newId()), this.products(collection), id);
        done(owner.dispatch({ kind: "collection.plan", collection: id, base: view.revision, packagePlan: plan ? storedPackagePlan(plan) : undefined }));
      }
    }
    this.notify();
  }
  private editPresets(view: CollectionView, command: Extract<CollectionAction, { kind: "preset.edit" }>["command"]) {
    const owner = this.deps.owner, id = view.id, model = this.deps.model;
    const done = (answer: ReturnType<CollectionOwner["dispatch"]>) => {
      if (!answer.ok) throw new CollectionServiceError(answer.code ?? "unavailable", answer.reason);
      return answer;
    };
    switch (command.kind) {
      case "add": {
        const removedNames = owner.restorable(id).map(item => ({ name: item.name }));
        const look = starterLook(command.newId ?? this.newId(), newPresetName(owner.looksOf(id), removedNames), model, this.deps.starterPart?.());
        const made = done(owner.dispatch({ kind: "collection.addLook", collection: id, base: view.revision,
          look: { id: look.id, name: look.name, ...this.storedLook(look) } }));
        this.show(made.look!);
        break;
      }
      case "copy": {
        // The look as the editor holds it now; a copy carries every part, and its editor memory starts fresh (as Copy always did).
        this.deps.flushLook?.();
        const from = owner.look({ collection: id, look: command.id })!, now = owner.collection(id)!;
        const made = done(owner.dispatch({ kind: "collection.addLook", collection: id, base: now.revision, at: now.looks.indexOf(command.id) + 1,
          look: { ...(command.newId ? { id: command.newId } : {}), name: `${from.name.slice(0, 113)} (copy)`, parts: from.parts,
            memory: this.freshMemory() } }));
        this.show(made.look!);
        break;
      }
      case "remove": {
        const index = view.looks.indexOf(command.id), shown = this.deps.scene.look();
        if (shown && sameLook(shown, { collection: id, look: command.id })) this.deps.flushLook?.();
        done(owner.dispatch({ kind: "collection.removeLook", collection: id, base: view.revision, look: command.id }));
        if (shown && sameLook(shown, { collection: id, look: command.id })) {
          const rest = owner.collection(id)!.looks, next = rest[Math.min(index, rest.length - 1)];
          // The last preset gone: the scene still names it (removed), so the collection stays shown, across a restart too, and Restore
          // brings it back; the editor shows it empty meanwhile.
          if (next) this.deps.scene.setLook({ collection: id, look: next });
        }
        break;
      }
      case "restore": {
        const newest = owner.restorable(id)[0]!;
        const made = done(owner.dispatch({ kind: "collection.restoreLook", collection: id, base: view.revision, look: newest.look }));
        this.show(made.look!);
        break;
      }
      case "rename": {
        const answer = owner.updateLook({ collection: id, look: command.id }, { name: command.name.trim() });
        if (!answer.ok) throw new CollectionServiceError(answer.code ?? "unavailable", answer.reason);
        break;
      }
      case "move": done(owner.dispatch({ kind: "collection.reorder", collection: id, base: view.revision,
        looks: moved(view.looks, command.id, command.to) })); break;
    }
  }
  /** A look's stored parts and fresh editor memory (a new look's). */
  private storedLook(look: Look): Pick<LookInput, "parts" | "memory"> {
    const model = this.deps.model;
    return { parts: model.parts.minimalLook(look, false).parts, memory: this.freshMemory() };
  }
  /** The primary feature's registered initial editor; no concrete editor or fabricated part is needed. */
  private freshMemory() {
    const model = this.deps.model, module = model.live === undefined ? undefined : model.parts.feature(model.live);
    return model.parts.writeMemory(module ? { [module.id]: { editor: module.editor.empty() } } : {}, { lookLevel: true });
  }
  /** Show a look on the scene (its edits so far are written first by the look editor). */
  private show(ref: LookRef) { this.deps.scene.setLook(ref); }
  private previousLook(): LookRef | undefined {
    for (let i = this.previous.length - 1; i >= 0; i--) {
      const ref = this.previous[i]!, look = this.deps.owner.look(ref);
      if (look?.state === "live") return ref;
      const view = this.deps.owner.collection(ref.collection), first = view?.looks[0];
      if (first) return { collection: ref.collection, look: first };
    }
    return undefined;
  }
  /** Show another collection: the look last shown there, else its first; the collection shown now can be gone back to (Undo open). */
  private open(collection: string) {
    const view = this.deps.owner.collection(collection);
    if (!view) throw new CollectionServiceError("missing_target", "That collection doesn't exist any more.");
    const last = this.lastShown.get(collection), look = last && view.looks.includes(last) ? last : view.looks[0];
    if (!look) throw new CollectionServiceError("invalid_value", "That collection has no presets to show.");
    const current = this.deps.scene.look();
    if (current && current.collection !== collection) this.previous = [...this.previous.filter(item => item.collection !== current.collection), current].slice(-PREVIOUS_LIMIT);
    this.deps.join?.(collection);
    this.deps.scene.setLook({ collection, look });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Requests

  /**
   * A saved version's content is read once so the dirty state is exact after a restart. One that couldn't be read is read again on the
   * next library refresh (`refresh`, which the Library panel asks for whenever it or the window is shown again).
   */
  private async loadBaseline(summaries: CollectionSummary[]) {
    const view = this.shown(), revision = view?.saved?.revision, key = view && `${view.id}@${revision}`;
    if (!view || revision === undefined || this.baselines.has(key!) || this.baselineReads.has(key!)) return;
    // The library doesn't list that version: nothing to read back, so no comparison until a refresh lists it.
    if (!summaries.some(item => item.id === view.id && item.revision === revision)) { this.unread(key!); return; }
    this.baselineReads.add(key!); this.notify();
    let read = false;
    try {
      const stored = await this.deps.transport.get(view.id);
      if (stored.revision === revision && stored.collection.id === view.id) { this.remember(stored.collection, stored.revision); read = true; }
    } catch { /* The comparison is unavailable until the next refresh reads it; the collection itself is unaffected. */ }
    finally {
      this.baselineReads.delete(key!);
      if (read) this.baselineFailed.delete(key!); else this.unread(key!);
      this.persistenceCache = undefined; this.notify();
    }
  }
  /** A saved version couldn't be read back to compare with (`collection@revision`): unavailable until a refresh reads it. */
  private unread(key: string) { if (!this.baselineFailed.has(key)) { this.baselineFailed.add(key); this.persistenceCache = undefined; this.notify(); } }
  private setProgress(progress: CollectionProgress) { this.progress = progress; this.notify(); }
  /** While Build `requestId` runs, ask the host which stage it has reached and show it in place of the starting line (PIPE-131). */
  private followBuild(requestId: number): () => void {
    const ask = this.deps.transport.packageProgress?.bind(this.deps.transport);
    if (!ask) return () => {};
    const stop = new AbortController();
    const poll = async () => {
      try {
        const stage = await ask();
        if (!stop.signal.aborted && !this.buildAbort?.signal.aborted && stage && this.running?.requestId === requestId && this.progress?.requestId === requestId &&
            this.progress.phase === "working") {
          const message = registeredCollectionExport(this.deps.model)!.stageLine(stage), fraction = (stage.step - .5) / stage.steps;
          if (message !== this.progress.message || fraction !== this.progress.fraction)
            this.setProgress({ phase: "working", code: "package", requestId, message, fraction });
        }
      } catch { /* The line stays as it was; the Build's own answer decides the outcome. */ }
      this.clock.after(BUILD_PROGRESS_INTERVAL_MS, () => void poll(), stop.signal);
    };
    void poll();
    return () => stop.abort();
  }
  private async list() {
    const seq = ++this.listSeq, summaries = await this.deps.transport.list();
    if (seq === this.listSeq) { this.summaries = summaries; this.notify(); }
    return this.summaries;
  }
  /** The collection and its live looks as the library holds them (one read, after this window's changes reached it). */
  private async snapshot(id: string): Promise<LookCollection> {
    this.deps.flushLook?.();
    return this.portable(id, await this.deps.owner.snapshot(id));
  }
  /** A snapshot (the library's, or this window's copy) as the portable collection, or the owner's refusal as an error. */
  private portable(id: string, snapshot: CollectionSnapshot | Capability): LookCollection {
    if ("available" in snapshot) throw new CollectionServiceError(snapshot.code ?? "unavailable", snapshot.reason ?? "The collection couldn't be read.");
    const stored = { schema: COLLECTION_2, id, name: snapshot.collection.name,
      presets: snapshot.looks.map(look => ({ id: look.id, name: look.name, revision: 1, parts: look.parts })),
      ...(snapshot.collection.packagePlan !== undefined ? { packagePlan: snapshot.collection.packagePlan } : {}) };
    return this.deps.model.parts.readCollection(stored, true, "keep");
  }
  /**
   * Whether this window's own copy can be exported (the recovery export, `exportWindowCopy`). It needs nothing from the library: not a
   * write, a read or the workspace lease, and it doesn't wait for another collection request.
   */
  windowCopyCapability(): Capability {
    const view = this.shown(), collection = this.collection();
    if (!view || !collection) return refusal("not_ready", LOADING);
    if (!collection.presets.length) return refusal("invalid_value", COLLECTION_MESSAGE);
    return { available: true };
  }
  /**
   * The recovery export: the collection open here as this window shows it, its changes that haven't reached the library included, as
   * the portable collection file. Nothing is saved, read or sent; this is the way to keep a copy when the library can't take those
   * changes (a handover that couldn't save, a restore that is stuck).
   */
  exportWindowCopy(): { name: string; json: string; message: string } {
    const allowed = this.windowCopyCapability();
    if (!allowed.available) throw new CollectionServiceError(allowed.code ?? "unavailable", allowed.reason!);
    this.deps.flushLook?.();
    const id = this.shown()!.id, collection = this.portable(id, this.deps.owner.windowCopy(id));
    return { name: "xfs.collection.json", json: JSON.stringify(this.deps.model.parts.writeMinimal(collection), null, 2),
      message: `Exported this window's copy of “${collection.name}”, with the changes your library doesn't have yet. It wasn't saved to your library.` };
  }
  /** Save version: the host writes a named version from its own snapshot; its content becomes the baseline. */
  private async saveVersion(id: string): Promise<StoredCollection> {
    this.deps.flushLook?.();
    const saved = await this.deps.owner.saveVersion(id);
    if (!saved.ok) throw new CollectionServiceError(saved.code ?? "unavailable", saved.reason);
    let stored: StoredCollection | undefined;
    try { stored = await this.deps.transport.get(id); } catch { stored = undefined; }
    if (stored && stored.revision === saved.version.revision) this.remember(stored.collection, stored.revision);
    // The version just saved couldn't be read back: no comparison until a refresh reads it (never a lasting Working…).
    else this.unread(`${id}@${saved.version.revision}`);
    await this.list().catch(() => undefined);
    return stored && stored.revision === saved.version.revision ? stored
      : { collection: this.collection(id) ?? { schema: COLLECTION_2, id, name: "", presets: [] }, revision: saved.version.revision, updatedAt: saved.version.updatedAt };
  }
  /**
   * Make a working copy from looks (in their stored form), listed in the profile, in as few commands as the write limit allows; answers
   * the new looks' references in order.
   */
  private create(input: { id: string; name: string; looks: readonly LookInput[]; packagePlan?: unknown; saved?: { revision: number } }): LookRef[] {
    const owner = this.deps.owner;
    // The profile's membership edit goes in the same command: the first batch leaves room for it within the write limit.
    const membership = this.deps.membership?.(input.id), also = membership ? [membership] : [];
    const first = input.looks.slice(0, MAX_LOOKS_AT_CREATE - also.length);
    const ids = input.looks.map(look => look.id ?? this.newId());
    const made = owner.dispatch({ kind: "collection.create", id: input.id, name: input.name, looks: first.map((look, i) => ({ ...look, id: ids[i] })),
      ...(input.packagePlan !== undefined ? { packagePlan: input.packagePlan } : {}), ...(input.saved ? { saved: input.saved } : {}) },
    also.length ? { also: () => also } : {});
    if (!made.ok) throw new CollectionServiceError(made.code ?? "unavailable", made.reason);
    // The rest are added after it, in order, from where the first batch ended.
    for (const [i, look] of input.looks.slice(first.length).entries()) {
      const view = owner.collection(input.id)!;
      const added = owner.dispatch({ kind: "collection.addLook", collection: input.id, base: view.revision, look: { ...look, id: ids[first.length + i] } });
      if (!added.ok) throw new CollectionServiceError(added.code ?? "unavailable", added.reason);
    }
    return ids.map(look => ({ collection: input.id, look }));
  }
  private storedLooks(collection: LookCollection, keepIds: boolean): LookInput[] {
    const model = this.deps.model, memory = this.freshMemory();
    return collection.presets.map(look => ({ ...(keepIds ? { id: look.id } : {}), name: look.name, parts: model.parts.minimalLook(look, false).parts, memory }));
  }
  private remembered(): void {
    const current = this.deps.scene.look();
    if (current) this.previous = [...this.previous.filter(item => item.collection !== current.collection), current].slice(-PREVIOUS_LIMIT);
  }

  async execute(request: CollectionRequest): Promise<CollectionOutcome> {
    if (this.disposed) return { ok: false, code: "missing_target", message: "This collection destination was released." };
    const allowed = this.capability(request);
    if (!allowed.available) return { ok: false, code: this.deps.current && allowed.code === "missing_target" ? "missing_target" : "unavailable", message: allowed.reason! };
    const check = () => { const current = this.deps.current?.(); if (current && !current.available) throw new CollectionServiceError(current.code ?? "missing_target", current.reason ?? "This collection destination changed."); };
    // Reading the saved list is quiet: it never marks the library busy or replaces the progress line (release-readiness-audit.md item 13).
    if (request.kind === "refresh") {
      const requestId = ++this.requestSeq, seq = ++this.listSeq;
      try {
        const summaries = await this.deps.transport.list();
        check();
        if (seq === this.listSeq && JSON.stringify(summaries) !== JSON.stringify(this.summaries)) { this.summaries = summaries; this.notify(); }
        // A saved version that couldn't be read back to compare with is read again now.
        void this.loadBaseline(this.summaries);
        return { ok: true, result: { kind: "list", summaries: this.summaries }, requestId };
      } catch (error) {
        return { ok: false, code: error instanceof CollectionServiceError ? error.code : "request_failed", message: (error as Error).message, requestId };
      }
    }
    this.busy = true;
    const requestId = ++this.requestSeq;
    this.buildAbort = request.kind === "package" && request.action === "build" ? new AbortController() : undefined;
    this.running = { requestId, kind: request.kind, ...(request.kind === "package" ? { action: request.action } : {}), startedAt: Date.now(), cancellable: !!this.buildAbort };
    this.setProgress({ phase: "working", code: request.kind, requestId,
      message: request.kind === "package" ? request.action === "check"
        ? "Checking which layers in the current collection can become Cyberpunk mod files…" : "Starting the build…"
        : "Working with the local collection library…" });
    try {
      let result: CollectionResult, message: string;
      switch (request.kind) {
        case "initialize": {
          const summaries = await this.list();
          check();
          this.ensureShown();
          await this.loadBaseline(summaries);
          message = "Your collection is back as you left it.";
          result = { kind: "list", summaries }; break;
        }
        case "open": {
          const id = request.id, owner = this.deps.owner;
          let stored: StoredCollection;
          if (!owner.collection(id)) {
            stored = await this.deps.transport.get(id);
            check();
            const collection = this.deps.model.parts.readCollection(stored.collection, true, "keep");
            this.remembered();
            const refs = this.create({ id, name: collection.name, looks: this.storedLooks(collection, true),
              ...(collection.packagePlan ? { packagePlan: storedPackagePlan(collection.packagePlan) } : {}), saved: { revision: stored.revision } });
            this.remember(stored.collection, stored.revision);
            if (refs[0]) this.deps.scene.setLook(refs[0]);
          } else {
            this.open(id);
            const view = owner.collection(id)!;
            stored = { collection: this.collection(id)!, revision: view.saved?.revision ?? 0, updatedAt: "" };
            void this.loadBaseline(this.summaries);
          }
          result = { kind: "opened", collection: stored };
          message = `Opened “${stored.collection.name}”. The collection you had open stays in your library.`; break;
        }
        case "resolveConflict": {
          // What waits in the editor joins this window's version first: Keep mine keeps it, Use theirs lets it go with the rest.
          this.deps.flushLook?.();
          const answer = await this.deps.owner.resolve(request.conflict, request.keep, this.deps.current);
          if (!answer.available) throw new CollectionServiceError(answer.code ?? "unavailable", answer.reason ?? "That couldn't be resolved right now.");
          this.ensureShown();
          result = { kind: "resolved" };
          message = request.keep === "mine" ? "Kept this window's version." : request.keep === "theirs" ? "Showing the other window's version."
            : "Kept this window's version as a copy, beside the other window's.";
          break;
        }
        case "save": case "saveCopy": {
          const view = this.shown()!;
          let stored: StoredCollection;
          if (request.kind === "save") stored = await this.saveVersion(view.id);
          else {
            const source = await this.snapshot(view.id), id = this.newId();
            // A copy never takes a name already in the library ("My collection" becomes "My collection 2", CORE-124, CORE-141).
            let names = [...this.summaries.map(item => item.name), ...this.deps.owner.list().map(item => item.name)];
            try { names = [...(await this.list()).map(item => item.name), ...this.deps.owner.list().map(item => item.name)]; } catch { /* The list as last read. */ }
            check();
            const name = uniqueCollectionName(source.name, names);
            // The copy's mods are the copy's own (PIPE-89).
            const plan = copyPackagePlan(source.packagePlan, source.id, id, () => this.newId());
            const at = Math.max(0, source.presets.findIndex(look => look.id === this.selectedId()));
            this.remembered();
            const refs = this.create({ id, name, looks: this.storedLooksWithMemory(source), ...(plan ? { packagePlan: storedPackagePlan(plan) } : {}) });
            if (refs[at]) this.deps.scene.setLook(refs[at]);
            stored = await this.saveVersion(id);
          }
          result = { kind: "saved", collection: stored };
          message = `Saved “${stored.collection.name}” · version ${stored.revision}.`; break;
        }
        case "exportCollection": case "exportPlan": {
          const view = this.shown()!;
          if (request.kind === "exportCollection" && request.draft !== undefined) {
            // Another working copy is exported as it is, never saved.
            const earlier = await this.snapshot(request.draft);
            result = { kind: "export", name: "xfs.collection.json", json: JSON.stringify(this.deps.model.parts.writeMinimal(earlier), null, 2) };
            message = `Exported the earlier draft “${earlier.name}” with its recipes and stable preset identities. It wasn't saved to your library; the collection you have open is unchanged.`;
            break;
          }
          const plan = request.kind === "exportPlan", storable = !this.collection()!.presets.some(look => look.locked);
          // Saved as a version first when the library takes it: a look made with a newer version never is (CORE-38).
          if (storable) await this.saveVersion(view.id);
          const collection = await this.snapshot(view.id);
          result = { kind: "export", name: plan ? "xfs.build-plan.json" : "xfs.collection.json",
            json: JSON.stringify(plan ? registeredCollectionExport(this.deps.model)!.plan(collection) : this.deps.model.parts.writeMinimal(collection), null, 2) };
          const locked = collection.presets.filter(look => look.locked);
          const kept = storable ? "It was also saved to your library first."
            : plan ? "It wasn't saved to your library: it has a look made with a newer version of XF Studio. Your collection is kept."
            : "It wasn't saved to your library: it has a look made with a newer version of XF Studio, which is exported exactly as it came. Your collection is kept.";
          const left = plan && locked.length ? ` Not in the plan: ${locked.map(look => `“${look.name}”`).join(", ")}, made with a newer version of XF Studio.` : "";
          message = plan ? `Build plan exported for the offline compiler; this is not an installable mod.${left} ${kept}`
            : storable ? "Collection saved to your library and exported. Recipes and stable preset identities are included."
            : `Collection exported with its recipes and stable preset identities. ${kept}`; break;
        }
        case "package": {
          const key = this.draftKey(), collection = await this.snapshot(this.shown()!.id);
          const stopFollowing = request.action === "build" ? this.followBuild(requestId) : () => {};
          let response: PackageCheckResult | PackageBuildResult;
          try {
            response = await this.deps.transport.package(request.action, this.deps.model.parts.writeMinimal(collection), this.buildAbort?.signal);
          } finally { stopFollowing(); }
          this.packageKey = key;
          if (request.action === "check") {
            const checked = response as PackageCheckResult;
            result = { kind: "packageCheck", result: checked }; message = registeredCollectionExport(this.deps.model)!.checkLine(checked);
          } else {
            const built = response as PackageBuildResult;
            result = { kind: "packageBuild", result: built }; message = registeredCollectionExport(this.deps.model)!.buildLine(built);
          }
          break;
        }
        case "import": {
          let collection: LookCollection;
          try { collection = this.deps.model.parts.readCollection(JSON.parse(request.text), false, "keep"); }
          catch (error) { throw new CollectionServiceError(error instanceof SyntaxError ? "invalid_json" : "invalid_collection", (error as Error).message); }
          // A collection the library already has (or had) is imported as a new one: nothing existing is written over.
          const taken = !!this.deps.owner.collection(collection.id) || this.summaries.some(item => item.id === collection.id) ||
            this.deps.owner.list().some(item => item.id === collection.id);
          const id = taken ? this.newId() : collection.id;
          const plan = taken ? copyPackagePlan(collection.packagePlan, collection.id, id, () => this.newId()) : collection.packagePlan;
          this.remembered();
          let refs: LookRef[];
          try { refs = this.create({ id, name: collection.name, looks: this.storedLooks(collection, !taken), ...(plan ? { packagePlan: storedPackagePlan(plan) } : {}) }); }
          catch (error) {
            if (taken || !(error instanceof CollectionServiceError)) throw error;
            // Its identity was taken by a collection deleted here: imported under fresh IDs.
            const fresh = this.newId(), copy = copyPackagePlan(collection.packagePlan, collection.id, fresh, () => this.newId());
            refs = this.create({ id: fresh, name: collection.name, looks: this.storedLooks(collection, false), ...(copy ? { packagePlan: storedPackagePlan(copy) } : {}) });
          }
          if (refs[0]) this.deps.scene.setLook(refs[0]);
          result = { kind: "imported" };
          message = "Imported the collection as a new collection. The collection you had open stays in your library."; break;
        }
      }
      this.setProgress({ phase: "success", code: result.kind, message, requestId });
      return { ok: true, result, requestId };
    } catch (error) {
      const code = error instanceof CollectionServiceError ? error.code : error instanceof SyntaxError ? "invalid_json" : "request_failed";
      const message = (error as Error).message;
      this.setProgress({ phase: "error", code, message, requestId });
      return { ok: false, code, message, requestId };
    } finally { this.buildAbort = undefined; this.busy = false; this.running = undefined; this.notify(); }
  }
  /** A snapshot's looks with their own editor memory (Save as new collection keeps each look's Undo history). */
  private storedLooksWithMemory(collection: LookCollection): LookInput[] {
    const model = this.deps.model;
    return collection.presets.map(look => {
      const held = this.deps.owner.look({ collection: collection.id, look: look.id });
      return { name: look.name, parts: model.parts.minimalLook(look, false).parts, ...(held?.memory !== undefined ? { memory: held.memory } : {}) };
    });
  }
  /**
   * An assigned missing look keeps its recovery identity. An unassigned scene shows the first of its collection, else the first look
   * of the first collection with any, else a new collection with one starter look. Bound profile panels preserve unassigned scenes too.
   */
  private ensureShown() {
    if (this.deps.preserveEmpty) return;
    const owner = this.deps.owner, ref = this.deps.scene.look();
    // Legacy initialize/conflict recovery must preserve retained work too, even without the bound facade's preserveEmpty policy.
    if (ref && owner.targetStatus(ref).state !== "present") { this.current = ref.collection; return; }
    if (ref && owner.look(ref)?.state === "live" && owner.collection(ref.collection)?.looks.includes(ref.look)) return;
    // A collection whose presets were all removed stays shown, named by its removed look (Restore brings it back).
    if (ref && owner.collection(ref.collection)?.looks.length === 0) { this.current = ref.collection; return; }
    const same = owner.collection(ref?.collection ?? this.current ?? "");
    if (same) {
      this.current = same.id;
      this.deps.scene.setLook(same.looks[0] ? { collection: same.id, look: same.looks[0] } : undefined);
      return;
    }
    const candidate = owner.list().find(view => view.looks.length);
    if (candidate) { this.deps.scene.setLook({ collection: candidate.id, look: candidate.looks[0]! }); return; }
    const look = starterLook(this.newId(), "Preset 1", this.deps.model, this.deps.starterPart?.());
    const refs = this.create({ id: this.newId(), name: "My collection", looks: [{ id: look.id, name: look.name, ...this.storedLook(look) }] });
    this.deps.scene.setLook(refs[0]);
  }
}

/** `looks` with `id` moved to `to`. */
function moved(looks: readonly string[], id: string, to: number): string[] {
  const next = looks.filter(item => item !== id);
  next.splice(to, 0, id);
  return next;
}

/**
 * A collection name no other collection has: the name itself when free, else the next "Name N" (a trailing number is counted on from,
 * so "Looks 2" becomes "Looks 3"), kept within the 120-character limit.
 */
export function uniqueCollectionName(name: string, taken: readonly string[]): string {
  const names = new Set(taken.map(item => item.trim().toLowerCase()));
  if (!names.has(name.trim().toLowerCase())) return name;
  const match = /^(.*?)\s+(\d+)$/.exec(name.trim()), base = (match ? match[1]! : name.trim()).slice(0, 110);
  for (let n = match ? Number(match[2]) + 1 : 2; ; n++) {
    const next = `${base} ${n}`;
    if (!names.has(next.toLowerCase())) return next;
  }
}

/** Current registered parts, without parsing or cloning their bodies (dirty checks). */
function liveParts(look: Readonly<Look>, live: NonNullable<ReturnType<NonNullable<CollectionServiceDeps["readParts"]>>> |
  NonNullable<ReturnType<NonNullable<CollectionServiceDeps["readRecipe"]>>>, model: DocumentModel): Look["parts"] {
  if (look.locked) return look.parts;
  let values: Readonly<Record<string, unknown | undefined>>;
  if ("recipe" in live) {
    const feature = model.live;
    values = { ...live.others?.parts, ...(feature && (look.parts[feature] || live.recipe.layers.length) ? { [feature]: live.recipe } : {}) };
  } else values = live.parts;
  const parts = { ...look.parts };
  for (const [feature, part] of Object.entries(values))
    if (part === undefined) delete parts[feature]; else parts[feature] = model.parts.envelope(feature, part);
  return parts;
}

export { PACKAGE_PLAN_KINDS };
export type { KeptPackagePlan };

/** Whether a conflict is about the collection (its name or list) rather than one preset. */
const aboutCollection = (entry: OutboxEntry) => {
  const look = entry.writes.some(write => write.kind === LOOK_WORKING), collection = entry.writes.some(write => write.kind === COLLECTION_WORKING);
  return collection && (!look || entry.writes.length > 2);
};
/** What a conflict is about, as its notice and confirmations name it: "the preset “Smoky”", "the collection “Night market set”". */
export function conflictSubject(entry: OutboxEntry): string {
  const theirsOf = (write: { kind: string; id: string }) => entry.current?.[documentKey(write)]?.value;
  if (aboutCollection(entry)) {
    const collection = entry.writes.find(write => write.kind === COLLECTION_WORKING)!;
    return `the collection “${collectionWorkingOf(collection.value)?.name ?? "Collection"}”`;
  }
  const look = entry.writes.find(write => write.kind === LOOK_WORKING);
  const mine = lookWorkingOf(look?.value), theirs = look ? lookWorkingOf(theirsOf(look)) : null;
  return `the preset “${mine?.name ?? theirs?.name ?? "Preset"}”`;
}
/** What a conflict is about and what differs, in a sentence ending with the question (style guide t-conflict). */
export function conflictMessage(entry: OutboxEntry): string {
  const theirsOf = (write: { kind: string; id: string }) => entry.current?.[documentKey(write)]?.value;
  const look = entry.writes.find(write => write.kind === LOOK_WORKING), collection = entry.writes.find(write => write.kind === COLLECTION_WORKING);
  const differs: string[] = [];
  const what = conflictSubject(entry);
  if (collection && aboutCollection(entry)) {
    const mine = collectionWorkingOf(collection.value), theirs = collectionWorkingOf(theirsOf(collection));
    if (mine && theirs) {
      if (mine.name !== theirs.name) differs.push("its name");
      const listed = (doc: typeof mine) => [...doc.looks].sort().join("\n");
      if (listed(mine) !== listed(theirs)) differs.push("which presets it lists");
      else if (mine.looks.join("\n") !== theirs.looks.join("\n")) differs.push("the order of its presets");
    } else if (!theirs) differs.push("the other window removed it");
  } else {
    const mine = lookWorkingOf(look?.value), theirs = look ? lookWorkingOf(theirsOf(look)) : null;
    if (mine && theirs) {
      if (mine.name !== theirs.name) differs.push(`its name: “${theirs.name}” there`);
      if (JSON.stringify(mine.parts) !== JSON.stringify(theirs.parts)) differs.push("its makeup");
      if (mine.state !== theirs.state) differs.push(theirs.state === "removed" ? "the other window removed it" : "the other window restored it");
    } else if (!theirs) differs.push("the other window deleted it");
  }
  return `You changed ${what} here too${differs.length ? ` (${differs.join(", ")})` : ""}. Which version should it keep?`;
}
