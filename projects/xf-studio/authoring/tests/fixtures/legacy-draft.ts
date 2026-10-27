/**
 * The collection draft model before profiles phase 1d-ii (`CollectionSession` and `CollectionActions`, with `editPresets`), kept only as a
 * test oracle: legacy workspaces (the migration's input) are read and walked with it in the goldens captured from that code, and the
 * differential parity test runs the same scripted sessions through it and through the Studio on the profile services. The Studio itself
 * no longer holds a draft: its collections and looks are library working copies (`src/library/collection-service.ts`).
 */
import { COLLECTION_RECOVERY_LIMIT, collectionDraft, emptyMemory, emptyRecipe, holdsLocked, liveFeatureStates, liveMemory, livePart, newPresetName,
  starterLook, withLiveFeatures, withLiveMemory, withLivePart, type CollectionDraft, type CollectionWorkspace, type DocumentModel, type EditorMemory,
  type Preset, type PresetCommand, REMOVED_PRESET_LIMIT } from "../../src/app/workspace/makeup-workspace";
import type { Recipe } from "../../src/engines/layered-makeup/recipe";
import type { LiveFeatureState } from "../../src/platform/core/live-features";
import type { Look, LookCollection } from "../../src/platform/api";
import type { StoredCollection } from "../../src/library/collection-actions";
import { nameIssue, positionIssue, refuse, type ValidationIssue } from "../../src/platform/api/validation-issues";
import { isKeptPackagePlan, PLAN_ISSUE_MESSAGE, refusal, type KeptPackagePlan, type ModPackagePlan, type PackagePlanIssue,
  type ReasonCode } from "../../src/platform/api";
import { collectionProducts, editPackagePlan, packagePlanEditIssue, type PackagePlanEdit, type PlannedProduct } from "../../src/platform/core/package-plan";

void emptyMemory;

/**
 * A deep copy of an in-memory workspace. A workspace is JSON data (it is stored as JSON), and a JSON
 * copy takes about 25 ms on the large fixture where `structuredClone` takes 65 ms and a reparse 70 ms.
 * Undo histories are chunked look histories, so a copy no longer repeats every step's whole recipe.
 */
export function copyWorkspace<T extends CollectionDraft>(value: T): T { return JSON.parse(JSON.stringify(value)); }

/**
 * Pure collection operations: stable identities, explicit order and recoverable removal. `value`
 * is an in-memory workspace (already parsed), so it is copied, and only what an edit can change is
 * validated again: the collection's identities, names and looks, never the Undo histories (CORE-35).
 * A new look's ID comes with the command (`newId`); this never invents one (CORE-44).
 */
export function editPresets(value: CollectionWorkspace, command: PresetCommand, model: DocumentModel): CollectionWorkspace {
  const state = copyWorkspace(value), presets = state.collection.presets;
  const index = "id" in command ? presets.findIndex(p => p.id === command.id) : -1;
  if ("id" in command && index < 0) throw Error("That preset no longer exists.");
  if (command.kind === "add" || command.kind === "copy") {
    const id = command.newId;
    if (!id) throw Error("A new preset needs its ID from the host.");
    if (presets.some(p => p.id === id) || state.removed.some(entry => entry.preset.id === id)) throw Error("That preset ID is already in use.");
    // A copy carries every part of the look; its editor memory starts fresh.
    const preset: Preset = command.kind === "copy" ? { ...structuredClone(presets[index]), id,
      name: `${presets[index].name.slice(0, 113)} (copy)`, revision: 1 } : starterLook(id, newPresetName(presets, state.removed.map(entry => entry.preset)), model);
    presets.splice(command.kind === "copy" ? index + 1 : presets.length, 0, preset);
    state.selected = preset.id; state.memory[preset.id] = withLiveMemory(undefined, emptyMemory(), model);
  } else if (command.kind === "remove") {
    const [preset] = presets.splice(index, 1);
    state.removed.push({ preset, index, memory: state.memory[preset.id] ?? withLiveMemory(undefined, emptyMemory(), model) });
    state.removed = state.removed.slice(-REMOVED_PRESET_LIMIT); delete state.memory[preset.id];
    if (state.selected === preset.id) state.selected = presets[Math.min(index, presets.length - 1)]?.id;
  } else if (command.kind === "restore") {
    const entry = state.removed.pop();
    if (!entry) throw Error("No removed preset to restore.");
    if (presets.some(p => p.id === entry.preset.id)) throw Error("That preset already exists.");
    presets.splice(Math.min(entry.index, presets.length), 0, entry.preset);
    state.memory[entry.preset.id] = entry.memory; state.selected = entry.preset.id;
  } else if (command.kind === "move") {
    if (!Number.isInteger(command.to) || command.to < 0 || command.to >= presets.length) throw Error("Invalid preset position.");
    presets.splice(command.to, 0, presets.splice(index, 1)[0]);
  } else if (command.kind === "rename") presets[index].name = command.name.trim();
  state.collection = model.parts.rereadCollection(state.collection);
  return state;
}

/** The live editor document: its recipe (the look's eye-makeup part) and its memory for that look. */
export type EditorSnapshot = EditorMemory & { recipe: Recipe;
  /** The look's other registered features' live state; present only when the composition registers more features (step 5). */
  liveFeatures?: Record<string, LiveFeatureState>;
  /** Present when the look is locked (it holds a newer build's data): why, in plain words. Never written back. */
  liveLocked?: string };
/**
 * Owns draft switching independently of markup, network requests and renderer. The live
 * document edits one feature's part of the selected look; every other part and feature memory
 * of the look is kept as it is.
 *
 * `state` is an in-memory workspace (parsed by its reader, then changed only by validated
 * operations), so it is copied, never parsed again (CORE-35). Reads never write the live editor
 * into the draft (CORE-28): `snapshot()` applies it to its copy.
 */
export class LegacyDraftSession {
  state: CollectionWorkspace;
  constructor(private model: DocumentModel, state: CollectionWorkspace, private read: () => EditorSnapshot,
    private show: (editor: EditorSnapshot) => void,
    /** The host's ID source for new looks (`editPresets` never invents one). */
    private newId: () => string = () => crypto.randomUUID()) {
    this.state = copyWorkspace(state);
  }
  /** Write the live editor into `state`'s selected look (the draft itself, or a copy of it). */
  private stashInto(state: CollectionWorkspace) {
    const preset = state.collection.presets.find(p => p.id === state.selected);
    // A locked look is never written from the editor: its parts and memory stay exactly as they were read.
    if (!preset || preset.locked) return;
    const { recipe, liveFeatures, ...memory } = this.read();
    preset.parts = withLivePart(preset, recipe, this.model);
    const written = withLiveFeatures(preset, withLiveMemory(state.memory[preset.id], structuredClone(memory), this.model),
      liveFeatures, this.model);
    preset.parts = written.parts;
    state.memory[preset.id] = written.memory;
  }
  stash() { this.stashInto(this.state); }
  /** A copy of the draft with the live editor's state in its selected look; the draft is not changed. */
  snapshot(): CollectionWorkspace {
    const copy = copyWorkspace(this.state);
    this.stashInto(copy);
    return copy;
  }
  display() {
    const preset = this.state.collection.presets.find(p => p.id === this.state.selected), recipe = livePart(preset, this.model);
    const memory = preset ? this.state.memory[preset.id] : undefined, others = liveFeatureStates(preset, memory, this.model);
    this.show({ recipe: recipe ? structuredClone(recipe) : emptyRecipe(),
      ...structuredClone(liveMemory(memory, this.model)), ...(others ? { liveFeatures: others } : {}),
      ...(preset?.locked ? { liveLocked: preset.locked } : {}) });
  }
  select(id: string) {
    if (!this.state.collection.presets.some(p => p.id === id)) throw Error("Preset not found.");
    this.stash(); this.state.selected = id; this.display();
  }
  /**
   * Apply a package-plan edit over the products the draft plans now (`edit` gets a fresh ID from the host's ID source
   * for a new mod); the plan is stored only when it differs from the default.
   */
  editPackagePlan(edit: (newId: string) => PackagePlanEdit, products: readonly PlannedProduct[]) {
    this.stash();
    const collection = this.state.collection;
    // A plan this build can't read is never edited (CORE-91); the actions refuse before this.
    if (isKeptPackagePlan(collection.packagePlan)) throw Error("This collection's mod packaging choices can't be changed in this version.");
    const plan = editPackagePlan(collection.packagePlan, edit(this.newId()), products, collection.id);
    const { packagePlan: _old, ...rest } = collection;
    this.state.collection = this.model.parts.rereadCollection({ ...rest, ...(plan ? { packagePlan: plan } : {}) });
  }
  renameCollection(name: string) {
    this.stash();
    this.state.collection = this.model.parts.rereadCollection({ ...this.state.collection, name: name.trim() });
  }
  edit(command: PresetCommand) {
    this.stash(); const previous = this.state.selected;
    const concrete = (command.kind === "add" || command.kind === "copy") && !command.newId ? { ...command, newId: this.newId() } : command;
    this.state = editPresets(this.state, concrete, this.model);
    if (previous !== this.state.selected || command.kind === "restore") this.display();
  }
  open(collection: LookCollection | unknown, revision?: number) {
    const { previous, older, ...current } = this.snapshot();
    const recovery = [current, ...(previous ? [previous] : []), ...(older ?? [])].slice(0, COLLECTION_RECOVERY_LIMIT);
    this.state = { ...collectionDraft(collection, this.model, revision), previous: recovery[0], older: recovery.slice(1) };
    this.display();
  }
  /**
   * Bring back an earlier draft. Without `draft`, the previous one, and the current draft goes to the back of the queue, so repeating
   * walks through them all. With `draft` (its collection ID, picked from the recent-drafts list), that one, and the current draft
   * becomes the newest in the queue.
   */
  undoOpen(draft?: string) {
    if (!this.state.previous) throw Error("No previous draft.");
    const { previous, older, ...current } = this.snapshot();
    if (draft !== undefined) {
      const queue = [previous!, ...(older ?? [])], index = queue.findIndex(entry => entry.collection.id === draft);
      if (index < 0) throw Error("That earlier draft is no longer in the recovery list.");
      const [chosen] = queue.splice(index, 1), recovery = [current, ...queue];
      this.state = { ...chosen!, previous: recovery[0], older: recovery.slice(1) };
      this.display();
      return;
    }
    const recovery = [...(older ?? []), current];
    this.state = { ...previous!, previous: recovery[0], older: recovery.slice(1) };
    this.display();
  }
  importRecipe(recipe: Recipe, name: string) {
    this.edit({ kind: "add" });
    const preset = this.state.collection.presets.find(p => p.id === this.state.selected)!;
    preset.name = name.trim().slice(0, 120) || "Imported preset";
    preset.parts = withLivePart(preset, recipe, this.model); this.display();
  }
  saved(result: StoredCollection, sourceId: string, renamedFrom?: string) {
    // In-flight edits survive: only reconcile persisted identity/revision metadata (and a copy's unique name, unless renamed meanwhile).
    if (this.state.collection.id !== sourceId) throw Error("Saved another collection snapshot; current draft kept.");
    this.state.collection.id = result.collection.id; this.state.revision = result.revision;
    if (renamedFrom !== undefined && this.state.collection.name === renamedFrom) this.state.collection.name = result.collection.name;
    const revisions = new Map(result.collection.presets.map(p => [p.id, p.revision]));
    for (const preset of this.state.collection.presets) preset.revision = revisions.get(preset.id) ?? preset.revision;
  }
}

/** The package-plan actions' kinds. */
const PACKAGE_PLAN_KINDS = ["package.rename", "package.assign", "package.split", "package.merge"] as const;
type PackagePlanAction = Extract<CollectionAction, { kind: (typeof PACKAGE_PLAN_KINDS)[number] }>;
const isPackagePlanAction = (action: CollectionAction): action is PackagePlanAction =>
  (PACKAGE_PLAN_KINDS as readonly string[]).includes(action.kind);
/** The plan edit an action asks for (`newId` is filled by the session before it applies). */
function packagePlanEdit(action: PackagePlanAction, newId = ""): PackagePlanEdit {
  switch (action.kind) {
    case "package.rename": return { kind: "rename", productId: action.productId, name: action.modName.trim() ? action.modName : null };
    case "package.assign": return { kind: "assign", feature: action.feature, productId: action.productId };
    case "package.split": return { kind: "split", feature: action.feature, newId: action.newId ?? newId };
    case "package.merge": return { kind: "merge", productId: action.productId, intoId: action.intoId };
  }
}
/** One mod the draft would build, for views: primitives only. */
type PackageProductSummary = { id: string; isDefault: boolean; modName: string; nameSource: "plan" | "derived";
  features: { id: string; label: string }[] };

type CollectionAction =
  | { kind: "preset.edit"; command: PresetCommand }
  | { kind: "preset.select"; id: string }
  | { kind: "collection.rename"; name: string }
  /** A stored collection of either schema (`xfas/collection-1` or `xfs/collection-2`). */
  | { kind: "collection.open"; collection: LookCollection | unknown; revision?: number }
  /** Bring back an earlier draft from the recovery queue: `draft` names one (its collection ID), else the previous one. */
  | { kind: "collection.undoOpen"; draft?: string }
  | { kind: "collection.importRecipe"; recipe: Recipe; name: string }
  /** `renamedFrom`: a Save as new collection gave the copy a unique name; the draft takes it while it still has this one. */
  | { kind: "collection.saved"; result: StoredCollection; sourceId: string; renamedFrom?: string }
  /**
   * The package plan (feature-module platform §6): which features ship in which XF mod. `package.rename` names a mod
   * (an empty `modName` goes back to the name that follows its features); `package.assign` moves a feature into an existing
   * mod; `package.split` moves one into a new mod of its own (`newId` from the host's ID source); `package.merge` puts
   * everything of one mod into another.
   */
  | { kind: "package.rename"; productId: string; modName: string }
  | { kind: "package.assign"; feature: string; productId: string }
  | { kind: "package.split"; feature: string; newId?: string }
  | { kind: "package.merge"; productId: string; intoId: string };
/** Collection actions a presentation may dispatch; `collection.saved` is the library's own completion. */
type CollectionStudioAction = Exclude<CollectionAction, { kind: "collection.saved" }>;

type ActionCapability = { available: boolean; reason?: string; issue?: ValidationIssue };
/** A capability with the reason code chosen where it was refused (`platform/api`). */
type CodedCapability = ActionCapability & { code?: ReasonCode };
/** Primitive-only draft projection; building it never clones recipes or Undo histories. */
type CollectionDraftSummary = {
  id: string; name: string; revision?: number; selected?: string;
  /** `locked`: the look holds a newer build's data and is not editable in this version. */
  presets: { id: string; name: string; revision: number; layers: number; locked?: true }[];
  /** Oldest first; `restore` brings back the last entry. */
  removed: { id: string; name: string; index: number }[];
  previous?: { id: string; name: string; revision?: number };
  /**
   * The recovery queue, newest first (the previous draft, then older ones), for a list to pick from (release-readiness-audit.md
   * item 13): each draft's collection ID, name, saved revision and preset count; `locked` as for `oldestRecoverable`.
   */
  recovery: { id: string; name: string; revision?: number; presets: number; locked?: true;
    /** How it stands against the library: never saved, the same as its saved version, edited since it, or unknown (not loaded). */
    saved: "never" | "same" | "edited" | "unknown" }[];
  recoveryCount: number; recoveryLimit: number;
  /** `locked`: it holds a look made with a newer version, which the library can't take, so this draft may be its only copy. */
  oldestRecoverable?: { id: string; name: string; revision?: number; locked?: true };
};
type ReadonlyDeep<T> = T extends (infer U)[] ? readonly ReadonlyDeep<U>[] :
  T extends object ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> } : T;

/** In-process collection command boundary. Returned views cannot mutate the live draft. */
export class LegacyDraftActions {
  private session: LegacyDraftSession;
  private listeners = new Set<() => void>();

  constructor(private model: DocumentModel, state: CollectionWorkspace, read: () => EditorSnapshot,
    show: (editor: EditorSnapshot) => void,
    /** The host's ID source for new looks; defaults to random UUIDs. */
    newId?: () => string) {
    this.session = new LegacyDraftSession(model, state, read, show, newId);
  }

  view(): ReadonlyDeep<CollectionWorkspace> { return structuredClone(this.session.state); }
  /** The selected preset's stored layer count can lag the live editor; callers may patch it. */
  summary(): CollectionDraftSummary {
    const s = this.session.state;
    const recovery = [...(s.previous ? [s.previous] : []), ...(s.older ?? [])];
    const oldest = recovery.at(-1);
    return { id: s.collection.id, name: s.collection.name, revision: s.revision, selected: s.selected,
      presets: s.collection.presets.map(p => ({ id: p.id, name: p.name, revision: p.revision,
        layers: Number(this.model.parts.summary(p, this.model.live)?.layers ?? 0), ...(p.locked ? { locked: true as const } : {}) })),
      removed: s.removed.map(entry => ({ id: entry.preset.id, name: entry.preset.name, index: entry.index })),
      previous: s.previous ? { id: s.previous.collection.id, name: s.previous.collection.name,
        revision: s.previous.revision } : undefined,
      recovery: recovery.map(draft => ({ id: draft.collection.id, name: draft.collection.name, revision: draft.revision,
        presets: draft.collection.presets.length, ...(holdsLocked(draft) ? { locked: true as const } : {}),
        saved: draft.revision === undefined ? "never" as const : "unknown" as const })),
      recoveryCount: recovery.length, recoveryLimit: COLLECTION_RECOVERY_LIMIT,
      oldestRecoverable: oldest ? { id: oldest.collection.id, name: oldest.collection.name,
        revision: oldest.revision, ...(holdsLocked(oldest) ? { locked: true as const } : {}) } : undefined };
  }
  /** The XF mods the draft would build (one merged mod by default), in order; empty when no look has an exportable feature. */
  productSummary(): PackageProductSummary[] {
    const labels = this.labels();
    return this.products().map(product => ({ id: product.id, isDefault: product.isDefault, modName: product.modName,
      nameSource: product.nameSource, features: product.features.map(id => ({ id, label: labels[id] ?? id })) }));
  }
  /**
   * The mods the draft plans (feature-module platform §6), from its package plan and the exporting features its
   * looks hold. The selected look counts as holding the live feature, as its editor may not be stashed yet. A plan
   * a newer build wrote that this one cannot plan shows as no products.
   */
  products(): PlannedProduct[] {
    const s = this.session.state;
    const looks = s.collection.presets.map(look => look.id === s.selected && !look.parts[this.model.live]
      ? { parts: { ...look.parts, [this.model.live]: look.parts[this.model.live] ?? {} } } : look);
    try { return collectionProducts({ ...s.collection, presets: looks }, this.model.parts.exporting()); }
    catch { return []; }
  }
  private labels(): Record<string, string> {
    return Object.fromEntries(this.model.parts.exporting().map(feature => [feature.id, feature.label]));
  }
  /** An earlier draft's collection in the recovery queue, by its ID, uncloned (for the service's own reads). */
  recoveryCollection(id: string): Readonly<LookCollection> | undefined {
    const s = this.session.state;
    return [s.previous, ...(s.older ?? [])].find(draft => draft?.collection.id === id)?.collection;
  }
  snapshot(): CollectionWorkspace { return this.session.snapshot(); }
  /** Trusted, uncloned look list for the service's own comparisons. Never hand it to a view. */
  presetsForComparison(): readonly Readonly<Look>[] {
    return this.session.state.collection.presets;
  }
  /** The draft's package plan, uncloned (for the service's own comparisons); undefined for the default. */
  packagePlan(): Readonly<ModPackagePlan | KeptPackagePlan> | undefined { return this.session.state.collection.packagePlan; }
  /** Why the draft's package plan can't be used, with its plain message, or undefined when it can (CORE-91). */
  packagePlanIssue(): { issue: PackagePlanIssue; message: string } | undefined {
    const plan = this.session.state.collection.packagePlan;
    return isKeptPackagePlan(plan) ? { issue: plan.issue, message: PLAN_ISSUE_MESSAGE[plan.issue] } : undefined;
  }
  /** Selected preset ID without cloning; undefined when the collection has no selected preset. */
  selected(): string | undefined { return this.session.state.selected; }
  /** Draft identity without cloning (CORE-05): the collection ID and the selected preset. */
  identity(): { collectionId: string; selected?: string } {
    return { collectionId: this.session.state.collection.id, selected: this.session.state.selected };
  }
  /** The draft's saved library revision (undefined before its first save), without cloning. */
  summaryRevision(): number | undefined { return this.session.state.revision; }
  /** Whether the draft has this preset, without cloning (CORE-05). */
  hasPreset(id: string): boolean { return this.session.state.collection.presets.some(preset => preset.id === id); }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The existing uncoded capability shape; the application reads the coded `check()`. */
  capability(action: CollectionAction): ActionCapability {
    const { code: _code, ...capability } = this.check(action);
    return capability;
  }
  /** Capability with a structured reason code (issues imply theirs; see `platform/api` `coded`). */
  check(action: CollectionAction): CodedCapability {
    const state = this.session.state;
    if (action.kind === "collection.undoOpen" && !state.previous)
      return refusal("invalid_value", "No previous draft.");
    if (action.kind === "collection.undoOpen" && action.draft !== undefined && !this.recoveryCollection(action.draft))
      return refusal("missing_target", "That earlier draft is no longer in the recovery list.");
    if (action.kind === "preset.edit") {
      const command = action.command;
      if (command.kind === "restore" && !state.removed.length)
        return refusal("invalid_value", "No removed preset to restore.");
      if ("id" in command && !state.collection.presets.some(p => p.id === command.id))
        return refusal("missing_target", "That preset no longer exists.");
      const newId = "newId" in command ? command.newId : undefined;
      if (newId && (state.collection.presets.some(p => p.id === newId) || state.removed.some(entry => entry.preset.id === newId)))
        return refusal("invalid_value", "That preset ID is already in use.");
      const issue = command.kind === "move" ? positionIssue(command.to, state.collection.presets.length,
        { below: "This preset is already first.", above: "This preset is already last." }) :
        command.kind === "rename" ? nameIssue(command.name, 120) : undefined;
      if (issue) return refuse(issue);
    }
    if (action.kind === "collection.rename") {
      const issue = nameIssue(action.name, 120);
      if (issue) return refuse(issue);
    }
    if (action.kind === "preset.select" && !state.collection.presets.some(p => p.id === action.id))
      return refusal("missing_target", "Preset not found.");
    if (isPackagePlanAction(action)) {
      // A plan made by a newer version (or damaged) is kept exactly as it came; this build never edits it (CORE-91).
      const planIssue = this.packagePlanIssue();
      if (planIssue) return refusal("unavailable", planIssue.message);
      const products = this.products();
      if (!products.length) return refusal("unavailable", "No look in this collection has anything XF Studio can make into mod files yet.");
      const issue = packagePlanEditIssue(packagePlanEdit(action, "00000000-0000-4000-8000-000000000000"), products, state.collection.id, this.labels());
      if (issue) return refusal(action.kind === "package.rename" && action.modName.trim() ? "invalid_value" : "unavailable", issue);
      if (action.kind === "package.split" && action.newId && (action.newId === state.collection.id || products.some(p => p.id === action.newId)))
        return refusal("invalid_value", "That mod ID is already in use.");
    }
    return { available: true };
  }

  dispatch(action: CollectionAction): void {
    const capability = this.capability(action);
    if (!capability.available) throw Error(capability.reason);
    switch (action.kind) {
      case "preset.edit": this.session.edit(action.command); break;
      case "preset.select": this.session.select(action.id); break;
      case "collection.rename": this.session.renameCollection(action.name); break;
      case "collection.open": this.session.open(action.collection, action.revision); break;
      case "collection.undoOpen": this.session.undoOpen(action.draft); break;
      case "collection.importRecipe": this.session.importRecipe(action.recipe, action.name); break;
      case "collection.saved": this.session.saved(action.result, action.sourceId, action.renamedFrom); break;
      case "package.rename": case "package.assign": case "package.split": case "package.merge":
        this.session.editPackagePlan(newId => packagePlanEdit(action, newId), this.products()); break;
    }
    for (const listener of this.listeners) listener();
  }
}
