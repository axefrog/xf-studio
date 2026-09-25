import { parseCollection, type PresetCollection } from "./preset-collection";
import { parseFieldSelection, type FieldSelection } from "./field-selection";
import { parseRecipe, type Recipe } from "./recipe";

export type Preset = PresetCollection["presets"][number];
export type EditorMemory = { active: number; selected: number; fieldSelection?: FieldSelection; history: Recipe[] };
export type CollectionDraft = {
  collection: PresetCollection; revision?: number; selected?: string; expanded: boolean;
  editors: Record<string, EditorMemory>;
  removed: { preset: Preset; index: number; editor: EditorMemory }[];
};
/** Browser-only recovery drafts, most recent first. SQLite collections never contain these. */
export const COLLECTION_RECOVERY_LIMIT = 4;
export type CollectionWorkspace = CollectionDraft & { previous?: CollectionDraft; older?: CollectionDraft[]; filesOpen?: boolean };
export const emptyRecipe = (): Recipe => ({ schema: "xfs/recipe-7", uv: "gltf-uv0-top-left", layers: [] });
export const emptyMemory = (): EditorMemory => ({ active: 0, selected: 0, history: [] });
export function collectionDraft(collection: PresetCollection, revision?: number): CollectionDraft {
  return { collection: parseCollection(collection, true), revision, selected: collection.presets[0]?.id,
    expanded: true, editors: {}, removed: [] };
}
export function parseEditorMemory(value: unknown, recipe: Recipe): EditorMemory {
  const input = value as EditorMemory | undefined, out = emptyMemory();
  if (input && Number.isInteger(input.active) && input.active >= 0 && input.active < recipe.layers.length) out.active = input.active;
  if (input && Number.isInteger(input.selected) && input.selected >= 0 && input.selected < (recipe.layers[out.active]?.points.length ?? 0)) out.selected = input.selected;
  if (Array.isArray(input?.history)) for (const item of input.history.slice(-80)) {
    try { out.history.push(parseRecipe(item)); } catch { /* Preserve usable history. */ }
  }
  out.fieldSelection = parseFieldSelection(input?.fieldSelection, recipe);
  return out;
}
/**
 * Collects what a tolerant restore dropped. Only the current draft must parse; a damaged
 * recovery draft or removed-preset entry is dropped with a note instead of blocking the
 * whole workspace.
 */
export type RestoreWarnings = string[];
function parseDraft(value: unknown, warnings?: RestoreWarnings): CollectionDraft {
  const input = value as CollectionDraft;
  const result = collectionDraft(parseCollection(input?.collection, true));
  if (input.revision !== undefined) {
    if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw Error("Invalid collection revision");
    result.revision = input.revision;
  }
  if (input.selected && result.collection.presets.some(p => p.id === input.selected)) result.selected = input.selected;
  if (typeof input.expanded === "boolean") result.expanded = input.expanded;
  for (const preset of result.collection.presets) result.editors[preset.id] = parseEditorMemory(input.editors?.[preset.id], preset.recipe);
  if (Array.isArray(input.removed)) for (const entry of input.removed.slice(-REMOVED_PRESET_LIMIT)) {
    try {
      const preset = parseCollection({ ...result.collection, presets: [entry.preset] }).presets[0];
      if (!Number.isInteger(entry.index) || entry.index < 0) throw Error("Invalid removed preset position");
      result.removed.push({ preset, index: entry.index, editor: parseEditorMemory(entry.editor, preset.recipe) });
    } catch (error) {
      if (!warnings) throw error;
      warnings.push(`A removed preset kept for Restore was damaged and was dropped (${(error as Error).message}).`);
    }
  }
  return result;
}
/**
 * Parse a stored collection workspace. Without `warnings` every entry must be valid (in-memory
 * round trips); with it, damaged recovery drafts and removed presets are dropped and noted.
 */
export function parseCollectionWorkspace(value: unknown, warnings?: RestoreWarnings): CollectionWorkspace {
  const result: CollectionWorkspace = parseDraft(value, warnings);
  const input = value as CollectionWorkspace;
  const stored = [input.previous, ...(input.previous !== undefined && Array.isArray(input.older)
    ? input.older.slice(0, COLLECTION_RECOVERY_LIMIT - 1) : [])].filter(draft => draft !== undefined);
  const recovery: CollectionDraft[] = [];
  for (const draft of stored) {
    try { recovery.push(parseDraft(draft, warnings)); }
    catch (error) {
      if (!warnings) throw error;
      warnings.push(`An earlier collection draft kept for recovery was damaged and was dropped (${(error as Error).message}).`);
    }
  }
  if (recovery.length) { result.previous = recovery[0]; if (Array.isArray(input.older)) result.older = recovery.slice(1); }
  if (typeof input.filesOpen === "boolean") result.filesOpen = input.filesOpen;
  return result;
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
    const preset: Preset = command.kind === "copy" ? { ...structuredClone(presets[index]), id: crypto.randomUUID(),
      name: `${presets[index].name.slice(0, 113)} (copy)`, revision: 1 } :
      { id: crypto.randomUUID(), name: `Preset ${presets.length + 1}`, revision: 1, recipe: emptyRecipe() };
    presets.splice(command.kind === "copy" ? index + 1 : presets.length, 0, preset);
    state.selected = preset.id; state.editors[preset.id] = emptyMemory(); state.expanded = true;
  } else if (command.kind === "remove") {
    const [preset] = presets.splice(index, 1);
    state.removed.push({ preset, index, editor: state.editors[preset.id] ?? emptyMemory() });
    state.removed = state.removed.slice(-REMOVED_PRESET_LIMIT); delete state.editors[preset.id];
    if (state.selected === preset.id) state.selected = presets[Math.min(index, presets.length - 1)]?.id;
  } else if (command.kind === "restore") {
    const entry = state.removed.pop();
    if (!entry) throw Error("No removed preset to restore.");
    if (presets.some(p => p.id === entry.preset.id)) throw Error("That preset already exists.");
    presets.splice(Math.min(entry.index, presets.length), 0, entry.preset);
    state.editors[entry.preset.id] = entry.editor; state.selected = entry.preset.id; state.expanded = true;
  } else if (command.kind === "move") {
    if (!Number.isInteger(command.to) || command.to < 0 || command.to >= presets.length) throw Error("Invalid preset position.");
    presets.splice(command.to, 0, presets.splice(index, 1)[0]);
  } else if (command.kind === "rename") presets[index].name = command.name.trim();
  return parseCollectionWorkspace(state);
}
