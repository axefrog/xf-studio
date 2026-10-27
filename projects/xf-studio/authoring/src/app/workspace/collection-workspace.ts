/**
 * Collection drafts on the look/part model (feature-module platform §2): a draft holds a
 * `xfs/collection-2` collection of looks and each look's editor memory by feature. Pure; the
 * part and editor codecs come from the `DocumentModel` its host passes in (the composition roots
 * build it from the registered features; nothing here imports the composition).
 *
 * Every registered feature's part and editor memory participate; unknown entries are carried unchanged.
 */
import { COLLECTION_1, COLLECTION_2, isNewerData, storedPackagePlan, type Look, type LookCollection, type LookMemory } from "../../platform/api";
import type { NewerPolicy, PartRegistry } from "../../platform/core/document";
import type { LiveFeatureState } from "../../platform/core/live-features";

/**
 * What the collection and workspace code needs from the composition: the registered features'
 * codecs, plus an optional starting feature for existing product defaults. A composition need not
 * name a live feature. Injected by the composition roots (feature-module platform §4, CORE-29).
 */
export type DocumentModel = { readonly parts: PartRegistry; readonly live?: string };

/** Why a collection holding a look from a newer XF Studio is not saved to the library (the look is kept in the draft and in exports). */
export const NEWER_LOOKS_LIBRARY_MESSAGE = "This collection has a look made with a newer version of XF Studio, so this version doesn't " +
  "save it to your library. Use Export collection to keep a copy, or update XF Studio to save it.";
export type Preset = Look;
export type CollectionDraft = {
  collection: LookCollection; revision?: number; selected?: string;
  /** Editor memory of each look, by feature, with the look's Undo history (`LOOK_MEMORY`). */
  memory: Record<string, LookMemory>;
  removed: { preset: Look; index: number; memory: LookMemory }[];
};
/** Browser-only recovery drafts, most recent first. SQLite collections never contain these. */
export const COLLECTION_RECOVERY_LIMIT = 4;
export type CollectionWorkspace = CollectionDraft & { previous?: CollectionDraft; older?: CollectionDraft[] };
/**
 * Every registered feature's parsed part (absent when the look lacks it) and per-look editor memory.
 */
export function liveFeatureStates(look: Pick<Look, "parts"> | undefined, memory: LookMemory | undefined,
  model: DocumentModel): Record<string, LiveFeatureState> | undefined {
  const others = model.parts.features();
  if (!others.length) return undefined;
  // Sparse: a feature the look lacks and has no memory of adds nothing, so a workspace that never used a second feature reads
  // exactly as it did while eye makeup was alone.
  const states = others.flatMap(feature => {
    const part = look ? model.parts.part(look, feature) : undefined;
    if (part === undefined && !memory?.[feature]) return [];
    return [[feature, { ...(part === undefined ? {} : { part: structuredClone(part) }),
      ...(memory?.[feature] ? { editor: structuredClone(memory[feature].editor) } : {}) }] as const];
  });
  return states.length ? Object.fromEntries(states) : undefined;
}
/**
 * `look` and its memory with the live features' state written back: a part is set (or removed
 * when the feature's document has none), and its editor memory replaces the stored one; a feature whose
 * document is empty and that the look never had stays absent (looks are sparse).
 */
export function withLiveFeatures(look: Look, memory: LookMemory, states: Readonly<Record<string, LiveFeatureState>> | undefined,
  model: DocumentModel): { parts: Look["parts"]; memory: LookMemory } {
  // Live states are sparse (`LiveFeatures.export`): a registered feature missing from them is blank, so a part Undo removed goes too.
  const registered = model.parts.features();
  if (!states && !registered.length) return { parts: look.parts, memory };
  const parts = { ...look.parts }, next = { ...memory };
  for (const feature of new Set([...registered, ...Object.keys(states ?? {})])) {
    const state: LiveFeatureState = states?.[feature] ?? {};
    if (!model.parts.feature(feature)) continue;
    if (state.part !== undefined) parts[feature] = model.parts.readPart(feature, model.parts.envelope(feature, state.part), false);
    else delete parts[feature];
    if ("editor" in state) next[feature] = { ...next[feature], editor: structuredClone(state.editor) };
    else delete next[feature];
  }
  return { parts, memory: next };
}
/** A new sparse look, with the optional starting feature's own empty part. */
export function newLook(id: string, name: string, model: DocumentModel): Look {
  const module = model.live ? model.parts.feature(model.live) : undefined;
  return { id, name, revision: 1, parts: module ? { [module.id]: model.parts.envelope(module.id, module.part.empty()) } : {} };
}
/**
 * A look for **Add preset**: the live feature's starter part (eye makeup: one layer, as the first preset starts), so a new look is
 * ready to shape instead of empty (release-readiness-audit.md item 12). Without a starter, the empty part.
 */
export function starterLook(id: string, name: string, model: DocumentModel, part?: unknown): Look {
  return { id, name, revision: 1, parts: starterParts(model, part) };
}
/** The contributed starting content, shared by every route that creates a starter look: `part` (the person's chosen starter's), else the feature's own. */
export function starterParts(model: DocumentModel, part?: unknown): Look["parts"] {
  const module = model.live ? model.parts.feature(model.live) : undefined;
  const starter = part ?? module?.part.starter() ?? module?.part.empty();
  return !module || starter === undefined ? {} : { [module.id]: model.parts.envelope(module.id, structuredClone(starter)) };
}

/**
 * A fresh draft of a stored collection of either schema (`xfas/collection-1` or `xfs/collection-2`). A look
 * holding a newer build's data is kept verbatim and locked (step 5); the rest of the collection is editable.
 */
export function collectionDraft(collection: unknown, model: DocumentModel, revision?: number,
  newer: Extract<NewerPolicy, "keep" | "refuse"> = "keep"): CollectionDraft {
  const read = model.parts.readCollection(collection, true, newer);
  return { collection: read, revision, selected: read.presets[0]?.id, memory: {}, removed: [] };
}

/**
 * Collects what a tolerant restore dropped. Only the current draft must parse; a damaged
 * recovery draft or removed-preset entry is dropped with a note instead of blocking the
 * whole workspace. Data from a newer build is never dropped as damage (see `NewerPolicy`).
 */
export type RestoreWarnings = string[];
/** How one stored draft format holds each look's memory. */
type DraftFormat = { memory(draft: unknown, look: Look): LookMemory; removedMemory(entry: unknown, look: Look): LookMemory };
/**
 * How a restore treats damage (`warnings`: tolerant) and data from a newer build (`newer`): with `keep`,
 * a look holding newer data (in its parts or its memory) is kept verbatim and locked.
 */
type ReadPolicy = { warnings?: RestoreWarnings; newer: NewerPolicy; model: DocumentModel };
/**
 * A non-current entry that could not be read. Damage is dropped with a note when the restore is
 * tolerant; newer data is refused (the whole restore throws it) unless the caller builds a
 * read-only view (`omit`), where it is left out silently because the store is never written back.
 */
function skip(error: unknown, policy: ReadPolicy, note: string) {
  if (isNewerData(error)) { if (policy.newer !== "omit") throw error; return; }
  if (!policy.warnings) throw error;
  policy.warnings.push(`${note} (${(error as Error).message}).`);
}

function readDraft(value: unknown, format: DraftFormat, policy: ReadPolicy): CollectionDraft {
  const { model } = policy, parts = model.parts;
  const input = value as { collection?: unknown; revision?: unknown; selected?: unknown; removed?: unknown };
  const stored = input?.collection as { schema?: unknown; presets?: unknown[] } | undefined;
  // Without `keep`, a look holding newer data in its parts is refused, as the current draft's looks always were.
  const result = collectionDraft(input?.collection, model, undefined, policy.newer === "keep" ? "keep" : "refuse");
  /** A look's memory; with `keep`, newer data in it locks the look, which is then kept verbatim from its stored preset. */
  const memoryOf = (look: Look, read: () => LookMemory, raw: unknown, schema: unknown) => {
    try { return read(); }
    catch (error) {
      if (policy.newer !== "keep" || !isNewerData(error)) throw error;
      Object.assign(look, parts.keepLook(raw, schema === COLLECTION_1 ? COLLECTION_1 : COLLECTION_2));
      return read();
    }
  };
  const storedPreset = (id: string) => stored?.presets?.find(item => (item as { id?: unknown } | null)?.id === id);
  if (input.revision !== undefined) {
    if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 1) throw Error("Invalid collection revision");
    result.revision = input.revision as number;
  }
  if (typeof input.selected === "string" && result.collection.presets.some(p => p.id === input.selected)) result.selected = input.selected;
  // `expanded` (and the workspace's `filesOpen`) from the retired sidebar shell are ignored.
  for (const look of result.collection.presets) result.memory[look.id] = withLiveDefault(
    memoryOf(look, () => format.memory(value, look), storedPreset(look.id), stored?.schema), look, model);
  if (Array.isArray(input.removed)) for (const entry of input.removed.slice(-REMOVED_PRESET_LIMIT)) {
    try {
      const identity = storedIdentity(result.collection, input.collection);
      const preset = parts.readCollection({ ...identity, presets: [entry?.preset] }, false, policy.newer === "keep" ? "keep" : "refuse").presets[0];
      if (!Number.isInteger(entry.index) || entry.index < 0) throw Error("Invalid removed preset position");
      const memory = memoryOf(preset, () => format.removedMemory(entry, preset), entry?.preset, identity.schema);
      result.removed.push({ preset, index: entry.index, memory: withLiveDefault(memory, preset, model) });
    } catch (error) { skip(error, policy, "A removed preset kept for Restore was damaged and was dropped"); }
  }
  return result;
}
/** Preserve the optional starting feature's editor defaults; no starting feature means no fabricated memory. */
function withLiveDefault(memory: LookMemory, look: Look, model: DocumentModel): LookMemory {
  const { parts, live } = model;
  if (!live || memory[live] || look.locked) return memory;
  const module = parts.feature(live);
  if (!module) return memory;
  return { ...memory, [live]: { editor: module.editor.parse(undefined, parts.part(look, live) ?? module.part.empty()) } };
}
/** The stored collection's own schema with the draft's identity, to read one removed preset the same way. */
function storedIdentity(collection: LookCollection, stored: unknown) {
  const schema = (stored as { schema?: unknown } | undefined)?.schema;
  return { schema: schema === COLLECTION_1 ? COLLECTION_1 : collection.schema, id: collection.id, name: collection.name };
}

function readWorkspaceDrafts(value: unknown, format: DraftFormat, policy: ReadPolicy): CollectionWorkspace {
  const result: CollectionWorkspace = readDraft(value, format, policy);
  const input = value as { previous?: unknown; older?: unknown };
  const stored = [input.previous, ...(input.previous !== undefined && Array.isArray(input.older)
    ? input.older.slice(0, COLLECTION_RECOVERY_LIMIT - 1) : [])].filter(draft => draft !== undefined);
  const recovery: CollectionDraft[] = [];
  for (const draft of stored) {
    try { recovery.push(readDraft(draft, format, policy)); }
    catch (error) { skip(error, policy, "An earlier collection draft kept for recovery was damaged and was dropped"); }
  }
  if (recovery.length) { result.previous = recovery[0]; if (Array.isArray(input.older)) result.older = recovery.slice(1); }
  return result;
}

/**
 * Parse a collection workspace in the `xfs/workspace-2` form: the in-memory state, or its stored
 * copy (which adds each history's `partSchema`). Without `warnings` every entry must be valid
 * (in-memory round trips); with it, damaged recovery drafts and removed presets are dropped and noted.
 * Data from a newer build anywhere is refused (`NewerDataError`) unless `newer` is `omit`, which
 * leaves it out of a read-only view; the current draft itself must always be readable.
 */
export function parseCollectionWorkspace(value: unknown, model: DocumentModel, warnings?: RestoreWarnings,
  newer: NewerPolicy = "refuse"): CollectionWorkspace {
  const parts = model.parts;
  // With `keep`, newer data in a look's memory is refused here and locks that look in `readDraft`.
  const memoryPolicy: NewerPolicy = newer === "keep" ? "refuse" : newer;
  const memoryOf = (source: unknown, look: Look) =>
    parts.readMemory((source as { memory?: Record<string, unknown> })?.memory?.[look.id], look, memoryPolicy);
  return readWorkspaceDrafts(value, { memory: memoryOf,
    removedMemory: (entry, look) => parts.readMemory((entry as { memory?: unknown }).memory, look, memoryPolicy) }, { warnings, newer, model });
}

/**
 * Read `xfas/workspace-1` collection drafts losslessly: each `xfas/collection-1` preset's recipe
 * becomes its eye-makeup part, and each editor memory (active layer, selection, Undo history,
 * `historyTrimmed`) becomes that feature's memory for the look.
 */
export function readCollectionWorkspaceV1(value: unknown, model: DocumentModel, warnings?: RestoreWarnings,
  newer: NewerPolicy = "refuse"): CollectionWorkspace {
  const parts = model.parts, legacy = parts.legacyFeature();
  if (!legacy) throw Error("This version of XF Studio cannot read xfas/workspace-1 collection drafts.");
  const schema = parts.feature(legacy)!.part.legacy!.schema;
  const memory = (editor: unknown, look: Look): LookMemory => {
    const input = editor as { active?: unknown; selected?: unknown; fieldSelection?: unknown; history?: unknown; historyTrimmed?: unknown } | undefined;
    return parts.readFeatureMemory(legacy, input && { active: input.active, selected: input.selected,
      fieldSelection: input.fieldSelection }, schema, input?.history, input?.historyTrimmed === true, look, newer);
  };
  return readWorkspaceDrafts(value, {
    memory: (source, look) => memory((source as { editors?: Record<string, unknown> })?.editors?.[look.id], look),
    removedMemory: (entry, look) => memory((entry as { editor?: unknown }).editor, look) }, { warnings, newer, model });
}

/**
 * The stored `xfs/workspace-2` form of a collection workspace. Looks and Undo histories are written
 * in the oldest part schemas that hold them, as the library and collection files are, so an older
 * build that knows `xfs/workspace-2` reads what this one writes whenever the content allows. The
 * result shares structure with `workspace`; serialize it at once.
 */
export function writeCollectionWorkspace(workspace: CollectionWorkspace, model: DocumentModel,
  /** `lookLevel`: every Undo history with steps in the look-level form (see `PartRegistry.writeMemory`). */
  options: { lookLevel?: boolean } = {}) {
  const parts = model.parts;
  const draft = (value: CollectionDraft) => ({
    collection: { schema: COLLECTION_2, id: value.collection.id, name: value.collection.name,
      presets: value.collection.presets.map(look => parts.minimalLook(look, false)),
      // A kept package plan (CORE-91) is written back exactly as it came.
      ...(value.collection.packagePlan ? { packagePlan: storedPackagePlan(value.collection.packagePlan) } : {}) },
    ...(value.revision !== undefined ? { revision: value.revision } : {}),
    ...(value.selected !== undefined ? { selected: value.selected } : {}),
    memory: Object.fromEntries(Object.entries(value.memory).map(([id, memory]) => [id, parts.writeMemory(memory, options)])),
    removed: value.removed.map(entry => ({ preset: parts.minimalLook(entry.preset, false), index: entry.index,
      memory: parts.writeMemory(entry.memory, options) })) });
  return { ...draft(workspace), ...(workspace.previous ? { previous: draft(workspace.previous) } : {}),
    ...(workspace.older ? { older: workspace.older.map(draft) } : {}) };
}

/** Whether a draft holds a locked look (a newer build's), in its collection or its removed presets. */
export function holdsLocked(draft: Pick<CollectionDraft, "collection" | "removed">) {
  return draft.collection.presets.some(look => look.locked) || draft.removed.some(entry => entry.preset.locked);
}
/** Removed presets kept for Restore; removing another beyond this drops the oldest. */
export const REMOVED_PRESET_LIMIT = 20;
/** `newId` is the new look's ID for `add` and `copy`; the session fills it from its host's ID source. */
export type PresetCommand = { kind: "add"; newId?: string } | { kind: "copy"; id: string; newId?: string } | { kind: "remove"; id: string } |
  { kind: "rename"; id: string; name: string } | { kind: "move"; id: string; to: number } | { kind: "restore" };
/**
 * A new preset's default name: "Preset N" for the next count, skipping a number another preset already carries, so adding after a
 * removal never names two presets alike (desktop acceptance, 29 September: two "Preset 2"). `removed` are the presets Restore can
 * bring back: their names are skipped too, so restoring one never makes two alike either (CORE-124 design review).
 */
export function newPresetName(presets: readonly { name: string }[], removed: readonly { name: string }[] = []): string {
  const taken = new Set([...presets, ...removed].map(preset => preset.name));
  let n = presets.length + 1;
  while (taken.has(`Preset ${n}`)) n++;
  return `Preset ${n}`;
}
