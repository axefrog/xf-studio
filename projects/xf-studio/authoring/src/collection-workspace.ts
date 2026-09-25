/**
 * Collection drafts on the look/part model (feature-module platform §2): a draft holds a
 * `xfs/collection-2` collection of looks and each look's editor memory by feature. Pure; the
 * part and editor codecs come from the composed feature registry.
 *
 * The one live editor document edits `LIVE_FEATURE` (eye makeup) until the look history lands
 * (migration step 4), so `EditorMemory` below is that document's memory for one look; every
 * other part and feature memory of a look is carried unchanged.
 */
import { LIVE_FEATURE, STUDIO_PARTS } from "./compose/studio-registry";
import type { FieldSelection } from "./field-selection";
import { COLLECTION_1, type Look, type LookCollection, type LookMemory, type PartMemory } from "./platform/api";
import type { PartRegistry } from "./platform/core/document";
import { emptyRecipe, type Recipe } from "./recipe";

export { emptyRecipe } from "./recipe";
export type Preset = Look;
/** The live editor document's memory for one look: its selection and its Undo history. */
export type EditorMemory = { active: number; selected: number; fieldSelection?: FieldSelection; history: Recipe[];
  /** Present (true) only when older Undo entries than `history[0]` were dropped; lets the UI say so. */
  historyTrimmed?: boolean };
export type CollectionDraft = {
  collection: LookCollection; revision?: number; selected?: string;
  /** Editor memory of each look, by feature. */
  memory: Record<string, LookMemory>;
  removed: { preset: Look; index: number; memory: LookMemory }[];
};
/** Browser-only recovery drafts, most recent first. SQLite collections never contain these. */
export const COLLECTION_RECOVERY_LIMIT = 4;
export type CollectionWorkspace = CollectionDraft & { previous?: CollectionDraft; older?: CollectionDraft[] };
export const emptyMemory = (): EditorMemory => ({ active: 0, selected: 0, history: [] });

/** The live document's memory in a look's memory (defaults when the look has none). */
export function liveMemory(memory: LookMemory | undefined): EditorMemory {
  const entry = memory?.[LIVE_FEATURE] as PartMemory<{ active: number; selected: number; fieldSelection?: FieldSelection }, Recipe> | undefined;
  if (!entry) return emptyMemory();
  return { active: entry.editor.active, selected: entry.editor.selected, history: entry.history,
    ...(entry.historyTrimmed ? { historyTrimmed: true } : {}),
    ...(entry.editor.fieldSelection ? { fieldSelection: entry.editor.fieldSelection } : {}) };
}
/** A look's memory with the live document's memory replaced; other features' memory is kept. */
export function withLiveMemory(memory: LookMemory | undefined, editor: EditorMemory): LookMemory {
  const { active, selected, fieldSelection, history, historyTrimmed } = editor;
  return { ...memory, [LIVE_FEATURE]: { editor: { active, selected, ...(fieldSelection ? { fieldSelection } : {}) }, history,
    ...(historyTrimmed ? { historyTrimmed: true as const } : {}) } };
}
/** The live document's part of a look, or undefined when the look does not have one. */
export function livePart(look: Pick<Look, "parts"> | undefined): Recipe | undefined {
  return look?.parts[LIVE_FEATURE]?.body as Recipe | undefined;
}
/** A look's parts with the live document's part set; an empty recipe is not added to a look that had none. */
export function withLivePart(look: Look, recipe: Recipe, parts: PartRegistry = STUDIO_PARTS): Look["parts"] {
  if (!look.parts[LIVE_FEATURE] && !recipe.layers.length) return look.parts;
  return { ...look.parts, [LIVE_FEATURE]: parts.readPart(LIVE_FEATURE, parts.envelope(LIVE_FEATURE, recipe), false) };
}
/** A new look: the live feature's empty part, as new presets have always had. */
export function newLook(id: string, name: string, parts: PartRegistry = STUDIO_PARTS): Look {
  return { id, name, revision: 1, parts: { [LIVE_FEATURE]: parts.envelope(LIVE_FEATURE, emptyRecipe()) } };
}

/** A fresh draft of a stored collection of either schema (`xfas/collection-1` or `xfs/collection-2`). */
export function collectionDraft(collection: unknown, revision?: number, parts: PartRegistry = STUDIO_PARTS): CollectionDraft {
  const read = parts.readCollection(collection, true);
  return { collection: read, revision, selected: read.presets[0]?.id, memory: {}, removed: [] };
}

/**
 * Collects what a tolerant restore dropped. Only the current draft must parse; a damaged
 * recovery draft or removed-preset entry is dropped with a note instead of blocking the
 * whole workspace.
 */
export type RestoreWarnings = string[];
/** How one stored draft format holds each look's memory. */
type DraftFormat = { memory(draft: unknown, look: Look): LookMemory; removedMemory(entry: unknown, look: Look): LookMemory };

function readDraft(value: unknown, format: DraftFormat, warnings: RestoreWarnings | undefined, parts: PartRegistry): CollectionDraft {
  const input = value as { collection?: unknown; revision?: unknown; selected?: unknown; removed?: unknown };
  const result = collectionDraft(input?.collection, undefined, parts);
  if (input.revision !== undefined) {
    if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 1) throw Error("Invalid collection revision");
    result.revision = input.revision as number;
  }
  if (typeof input.selected === "string" && result.collection.presets.some(p => p.id === input.selected)) result.selected = input.selected;
  // `expanded` (and the workspace's `filesOpen`) from the retired sidebar shell are ignored.
  for (const look of result.collection.presets) result.memory[look.id] = withLiveDefault(format.memory(value, look), look, parts);
  if (Array.isArray(input.removed)) for (const entry of input.removed.slice(-REMOVED_PRESET_LIMIT)) {
    try {
      const preset = parts.readCollection({ ...storedIdentity(result.collection, input.collection), presets: [entry?.preset] }).presets[0];
      if (!Number.isInteger(entry.index) || entry.index < 0) throw Error("Invalid removed preset position");
      result.removed.push({ preset, index: entry.index, memory: withLiveDefault(format.removedMemory(entry, preset), preset, parts) });
    } catch (error) {
      if (!warnings) throw error;
      warnings.push(`A removed preset kept for Restore was damaged and was dropped (${(error as Error).message}).`);
    }
  }
  return result;
}
/** Every look has the live document's memory (defaults when none was stored), as every preset always had. */
function withLiveDefault(memory: LookMemory, look: Look, parts: PartRegistry): LookMemory {
  if (memory[LIVE_FEATURE]) return memory;
  const live = parts.feature(LIVE_FEATURE)!.part;
  return { ...memory, [LIVE_FEATURE]: parts.readFeatureMemory(LIVE_FEATURE, undefined, live.current, [], false, look) };
}
/** The stored collection's own schema with the draft's identity, to read one removed preset the same way. */
function storedIdentity(collection: LookCollection, stored: unknown) {
  const schema = (stored as { schema?: unknown } | undefined)?.schema;
  return { schema: schema === COLLECTION_1 ? COLLECTION_1 : collection.schema, id: collection.id, name: collection.name };
}

function readWorkspaceDrafts(value: unknown, format: DraftFormat, warnings: RestoreWarnings | undefined,
  parts: PartRegistry): CollectionWorkspace {
  const result: CollectionWorkspace = readDraft(value, format, warnings, parts);
  const input = value as { previous?: unknown; older?: unknown };
  const stored = [input.previous, ...(input.previous !== undefined && Array.isArray(input.older)
    ? input.older.slice(0, COLLECTION_RECOVERY_LIMIT - 1) : [])].filter(draft => draft !== undefined);
  const recovery: CollectionDraft[] = [];
  for (const draft of stored) {
    try { recovery.push(readDraft(draft, format, warnings, parts)); }
    catch (error) {
      if (!warnings) throw error;
      warnings.push(`An earlier collection draft kept for recovery was damaged and was dropped (${(error as Error).message}).`);
    }
  }
  if (recovery.length) { result.previous = recovery[0]; if (Array.isArray(input.older)) result.older = recovery.slice(1); }
  return result;
}

/**
 * Parse a collection workspace in the `xfs/workspace-2` form: the in-memory state, or its stored
 * copy (which adds each history's `partSchema`). Without `warnings` every entry must be valid
 * (in-memory round trips); with it, damaged recovery drafts and removed presets are dropped and noted.
 */
export function parseCollectionWorkspace(value: unknown, warnings?: RestoreWarnings, parts: PartRegistry = STUDIO_PARTS): CollectionWorkspace {
  const memoryOf = (source: unknown, look: Look) => parts.readMemory((source as { memory?: Record<string, unknown> })?.memory?.[look.id], look);
  return readWorkspaceDrafts(value, { memory: memoryOf,
    removedMemory: (entry, look) => parts.readMemory((entry as { memory?: unknown }).memory, look) }, warnings, parts);
}

/**
 * Read `xfas/workspace-1` collection drafts losslessly: each `xfas/collection-1` preset's recipe
 * becomes its eye-makeup part, and each editor memory (active layer, selection, Undo history,
 * `historyTrimmed`) becomes that feature's memory for the look.
 */
export function readCollectionWorkspaceV1(value: unknown, warnings?: RestoreWarnings, parts: PartRegistry = STUDIO_PARTS): CollectionWorkspace {
  const legacy = parts.legacyFeature();
  if (!legacy) throw Error("This version of XF Studio cannot read xfas/workspace-1 collection drafts.");
  const schema = parts.feature(legacy)!.part.legacy!.schema;
  const memory = (editor: unknown, look: Look): LookMemory => {
    const input = editor as { active?: unknown; selected?: unknown; fieldSelection?: unknown; history?: unknown; historyTrimmed?: unknown } | undefined;
    return { [legacy]: parts.readFeatureMemory(legacy, input && { active: input.active, selected: input.selected,
      fieldSelection: input.fieldSelection }, schema, input?.history, input?.historyTrimmed === true, look) };
  };
  return readWorkspaceDrafts(value, {
    memory: (source, look) => memory((source as { editors?: Record<string, unknown> })?.editors?.[look.id], look),
    removedMemory: (entry, look) => memory((entry as { editor?: unknown }).editor, look) }, warnings, parts);
}

/** The stored `xfs/workspace-2` form of a collection workspace. */
export function writeCollectionWorkspace(workspace: CollectionWorkspace, parts: PartRegistry = STUDIO_PARTS) {
  const draft = (value: CollectionDraft) => ({ collection: value.collection, ...(value.revision !== undefined ? { revision: value.revision } : {}),
    ...(value.selected !== undefined ? { selected: value.selected } : {}),
    memory: Object.fromEntries(Object.entries(value.memory).map(([id, memory]) => [id, parts.writeMemory(memory)])),
    removed: value.removed.map(entry => ({ preset: entry.preset, index: entry.index, memory: parts.writeMemory(entry.memory) })) });
  return { ...draft(workspace), ...(workspace.previous ? { previous: draft(workspace.previous) } : {}),
    ...(workspace.older ? { older: workspace.older.map(draft) } : {}) };
}

/** Removed presets kept for Restore; removing another beyond this drops the oldest. */
export const REMOVED_PRESET_LIMIT = 20;
export type PresetCommand = { kind: "add" } | { kind: "copy" | "remove"; id: string } |
  { kind: "rename"; id: string; name: string } | { kind: "move"; id: string; to: number } | { kind: "restore" };
/** Pure collection operations: stable identities, explicit order and recoverable removal. */
export function editPresets(value: CollectionWorkspace, command: PresetCommand): CollectionWorkspace {
  const state = parseCollectionWorkspace(value), presets = state.collection.presets;
  const index = "id" in command ? presets.findIndex(p => p.id === command.id) : -1;
  if ("id" in command && index < 0) throw Error("That preset no longer exists.");
  if (command.kind === "add" || command.kind === "copy") {
    // A copy carries every part of the look; its editor memory starts fresh.
    const preset: Preset = command.kind === "copy" ? { ...structuredClone(presets[index]), id: crypto.randomUUID(),
      name: `${presets[index].name.slice(0, 113)} (copy)`, revision: 1 } : newLook(crypto.randomUUID(), `Preset ${presets.length + 1}`);
    presets.splice(command.kind === "copy" ? index + 1 : presets.length, 0, preset);
    state.selected = preset.id; state.memory[preset.id] = withLiveMemory(undefined, emptyMemory());
  } else if (command.kind === "remove") {
    const [preset] = presets.splice(index, 1);
    state.removed.push({ preset, index, memory: state.memory[preset.id] ?? withLiveMemory(undefined, emptyMemory()) });
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
  return parseCollectionWorkspace(state);
}
