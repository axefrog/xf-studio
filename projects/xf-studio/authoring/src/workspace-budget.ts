import { emptyRecipe, type CollectionDraft, type CollectionWorkspace, type EditorMemory } from "./collection-workspace";
import type { WorkspaceState } from "./workspace-state";

/**
 * Size policy for the persisted browser workspace. Browsers give an origin roughly five
 * million UTF-16 code units of `localStorage`, shared by the normal and `?verify=1`
 * workspace keys, so each key targets at most this many code units (`string.length`).
 */
export const WORKSPACE_STORAGE_BUDGET = 2_000_000;
/** Undo entries persisted for each preset that is not selected (the selected preset keeps its full history). */
export const PERSISTED_BACKGROUND_HISTORY = 5;

/**
 * Progressive levels, applied only while the encoded workspace is over budget. Level 0 is
 * the standard policy and always applies; later levels give up Undo depth and recovery
 * copies, never the current presets themselves.
 */
const LEVELS = [
  { background: PERSISTED_BACKGROUND_HISTORY, selected: Infinity, recovery: Infinity, removed: Infinity },
  { background: 0, selected: Infinity, recovery: 1, removed: Infinity },
  { background: 0, selected: 20, recovery: 0, removed: 5 },
  { background: 0, selected: 0, recovery: 0, removed: 0 },
] as const;
type Level = (typeof LEVELS)[number];

export type EncodedWorkspace = {
  encoded: string;
  /** Encoded length in UTF-16 code units, the unit browser storage quotas count. */
  size: number;
  /** 0 is the standard policy; higher levels dropped extra Undo history or recovery copies. */
  level: number;
  /** Even the smallest level exceeds the budget; the write may still succeed. */
  overBudget: boolean;
};

/** Number of progressive levels; `WORKSPACE_LEVELS - 1` is the smallest form. */
export const WORKSPACE_LEVELS = LEVELS.length;

/**
 * Encodes the workspace at one level. Every level:
 * - stores the selected preset once (inside the collection), not again at the top level;
 * - keeps removed presets of the current draft without their Undo histories;
 * - keeps the presets of recovery drafts, but not their Undo histories or removed presets;
 * - keeps only the latest few Undo entries of presets that are not selected.
 * Nothing here changes the live session; only what is written to storage.
 */
export function encodeWorkspaceAt(state: WorkspaceState, level: number, budget = WORKSPACE_STORAGE_BUDGET): EncodedWorkspace {
  const encoded = JSON.stringify(compactWorkspace(state, LEVELS[Math.max(0, Math.min(level, LEVELS.length - 1))]));
  return { encoded, size: encoded.length, level, overBudget: encoded.length > budget };
}

/** The first level that fits the budget (or the smallest one when none fits). */
export function encodeWorkspaceForStorage(state: WorkspaceState, budget = WORKSPACE_STORAGE_BUDGET): EncodedWorkspace {
  for (let level = 0; ; level++) {
    const candidate = encodeWorkspaceAt(state, level, budget);
    if (!candidate.overBudget || level === LEVELS.length - 1) return candidate;
  }
}

function compactWorkspace(state: WorkspaceState, level: Level): WorkspaceState {
  const collections = state.collections;
  if (!collections) return level.selected === Infinity ? state
    : { ...state, history: level.selected > 0 ? state.history.slice(-level.selected) : [] };
  const current = compactDraft(collections, level, true);
  const recovery = [collections.previous, ...(collections.older ?? [])]
    .filter((draft): draft is CollectionDraft => !!draft).slice(0, level.recovery).map(draft => compactDraft(draft, level, false));
  const compacted: CollectionWorkspace = { ...current, ...(collections.filesOpen === undefined ? {} : { filesOpen: collections.filesOpen }),
    ...(recovery.length ? { previous: recovery[0], older: recovery.slice(1) } : {}) };
  // parseWorkspace restores the editor from the collection's selected preset, so the
  // top-level editor copy would only duplicate it.
  return { ...state, recipe: emptyRecipe(), active: 0, selected: 0, history: [], fieldSelection: {}, collections: compacted };
}

function compactDraft(draft: CollectionDraft, level: Level, current: boolean): CollectionDraft {
  const editors: Record<string, EditorMemory> = {};
  for (const [id, memory] of Object.entries(draft.editors)) {
    const keep = !current ? 0 : id === draft.selected ? level.selected : level.background;
    editors[id] = trim(memory, keep);
  }
  return { collection: draft.collection, revision: draft.revision, selected: draft.selected, expanded: draft.expanded,
    // Recovery drafts keep their presets but not their removed-preset lists.
    editors, removed: (current && level.removed > 0 ? draft.removed.slice(-level.removed) : [])
      .map(entry => ({ ...entry, editor: trim(entry.editor, 0) })) };
}

function trim(memory: EditorMemory, keep: number): EditorMemory {
  return { ...memory, history: keep <= 0 ? [] : keep === Infinity ? memory.history : memory.history.slice(-keep) };
}
