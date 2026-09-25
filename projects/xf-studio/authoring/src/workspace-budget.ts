import type { CollectionDraft, CollectionWorkspace, DocumentModel } from "./collection-workspace";
import type { LookMemory, PartMemory } from "./platform/api";
import { serializeWorkspace, type WorkspaceState } from "./workspace-state";

/**
 * Size policy for the persisted browser workspace. Browsers give an origin roughly five
 * million UTF-16 code units of `localStorage`, shared by the normal and `?verify=1`
 * workspace keys, so each key targets at most this many code units (`string.length`).
 */
export const WORKSPACE_STORAGE_BUDGET = 2_000_000;
/** Undo entries persisted for each preset that is not selected (the selected preset keeps its full history), per feature. */
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
export function encodeWorkspaceAt(state: WorkspaceState, level: number, model: DocumentModel,
  budget = WORKSPACE_STORAGE_BUDGET): EncodedWorkspace {
  const encoded = JSON.stringify(serializeWorkspace(compactWorkspace(state, LEVELS[Math.max(0, Math.min(level, LEVELS.length - 1))]), model));
  return { encoded, size: encoded.length, level, overBudget: encoded.length > budget };
}

/** The first level that fits the budget (or the smallest one when none fits). */
export function encodeWorkspaceForStorage(state: WorkspaceState, model: DocumentModel,
  budget = WORKSPACE_STORAGE_BUDGET): EncodedWorkspace {
  for (let level = 0; ; level++) {
    const candidate = encodeWorkspaceAt(state, level, model, budget);
    if (!candidate.overBudget || level === LEVELS.length - 1) return candidate;
  }
}

function compactWorkspace(state: WorkspaceState, level: Level): WorkspaceState {
  const collections = state.collections;
  if (!collections) return level.selected === Infinity ? state
    : { ...state, ...trimHistory({ history: state.history, ...(state.historyTrimmed ? { historyTrimmed: true as const } : {}) },
      level.selected) as Pick<WorkspaceState, "history" | "historyTrimmed"> };
  const current = compactDraft(collections, level, true);
  const recovery = [collections.previous, ...(collections.older ?? [])]
    .filter((draft): draft is CollectionDraft => !!draft).slice(0, level.recovery).map(draft => compactDraft(draft, level, false));
  const compacted: CollectionWorkspace = { ...current,
    ...(recovery.length ? { previous: recovery[0], older: recovery.slice(1) } : {}) };
  // The stored form restores the editor from the collection's selected look, so it keeps no loose editor copy.
  return { ...state, collections: compacted };
}

function compactDraft(draft: CollectionDraft, level: Level, current: boolean): CollectionDraft {
  const memory: Record<string, LookMemory> = {};
  for (const [id, look] of Object.entries(draft.memory)) {
    const keep = !current ? 0 : id === draft.selected ? level.selected : level.background;
    memory[id] = trimLook(look, keep);
  }
  return { collection: draft.collection, revision: draft.revision, selected: draft.selected,
    // Recovery drafts keep their presets but not their removed-preset lists.
    memory, removed: (current && level.removed > 0 ? draft.removed.slice(-level.removed) : [])
      .map(entry => ({ ...entry, memory: trimLook(entry.memory, 0) })) };
}

/** Every feature's history of one look, trimmed alike. */
function trimLook(look: LookMemory, keep: number): LookMemory {
  return Object.fromEntries(Object.entries(look).map(([feature, memory]) =>
    [feature, Array.isArray(memory.history) ? { ...memory, ...trimHistory(memory, keep) } : memory]));
}
/** Keep the latest `keep` Undo entries and record when older ones were dropped, so the UI can say so. */
function trimHistory<T extends Pick<PartMemory, "history" | "historyTrimmed">>(memory: T, keep: number):
  Pick<PartMemory, "history" | "historyTrimmed"> {
  const history = keep <= 0 ? [] : keep === Infinity ? memory.history : memory.history.slice(-keep);
  return { history, ...(memory.historyTrimmed || history.length < memory.history.length ? { historyTrimmed: true as const } : {}) };
}
