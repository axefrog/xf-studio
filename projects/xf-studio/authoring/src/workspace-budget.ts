import type { CollectionDraft, CollectionWorkspace, DocumentModel } from "./collection-workspace";
import { withLiveMemory } from "./collection-workspace";
import { LOOK_MEMORY, type LookMemory } from "./platform/api";
import { trimLookHistory } from "./platform/core/look-history";
import { serializeWorkspace, type WorkspaceState } from "./workspace-state";

/**
 * Size policy for the persisted workspace (feature-module platform §3, CORE-02). Browsers give an
 * origin roughly five million UTF-16 code units of `localStorage`, shared by the normal and
 * `?verify=1` workspace keys, so each key targets at most this many code units (`string.length`).
 * The desktop host file passes a larger budget.
 */
export const WORKSPACE_STORAGE_BUDGET = 2_000_000;
/** Undo steps persisted for each preset that is not selected (the selected preset keeps its full history). */
export const PERSISTED_BACKGROUND_HISTORY = 5;
/** Undo steps the selected look keeps however tight the budget, unless its looks alone leave no room for them. */
export const MIN_SELECTED_HISTORY = 10;

/**
 * What one stored form keeps. `selected`: Undo steps of the selected look (or the loose editor);
 * `background`: of every other current look; `recovery`: how many recovery drafts are kept (their
 * looks, never their histories); `removed`: how many removed presets are kept for Restore (the latest,
 * without their histories).
 */
export type WorkspacePlan = { background: number; selected: number; recovery: number; removed: number };
/** The standard policy: every save stores at least this little. */
export const STANDARD_PLAN: WorkspacePlan = Object.freeze({ background: PERSISTED_BACKGROUND_HISTORY, selected: Infinity,
  recovery: Infinity, removed: Infinity });

/**
 * Fixed compaction levels, kept for tools and tests that store a workspace in a known form. Level 0
 * is the standard policy; autosave uses `fitWorkspace`, which trims in the platform's order instead.
 */
const LEVELS: readonly WorkspacePlan[] = [
  STANDARD_PLAN,
  { background: 0, selected: Infinity, recovery: 1, removed: Infinity },
  { background: 0, selected: 20, recovery: 0, removed: 5 },
  { background: 0, selected: 0, recovery: 0, removed: 0 },
];
/** Number of fixed levels; `WORKSPACE_LEVELS - 1` is the smallest form. */
export const WORKSPACE_LEVELS = LEVELS.length;

export type EncodedWorkspace = {
  encoded: string;
  /** Encoded length in UTF-16 code units, the unit browser storage quotas count. */
  size: number;
  /** 0 is the standard policy; higher levels dropped extra Undo history or recovery copies. */
  level: number;
  /** Even the smallest form exceeds the budget; the write may still succeed. */
  overBudget: boolean;
};

/** The workspace stored with one fixed level's plan. Nothing here changes the live session. */
export function encodeWorkspaceAt(state: WorkspaceState, level: number, model: DocumentModel,
  budget = WORKSPACE_STORAGE_BUDGET): EncodedWorkspace {
  const index = Math.max(0, Math.min(level, LEVELS.length - 1));
  const encoded = encodePlan(state, LEVELS[index], model);
  return { encoded, size: encoded.length, level, overBudget: encoded.length > budget };
}

/** The first fixed level that fits the budget (or the smallest one when none fits). */
export function encodeWorkspaceForStorage(state: WorkspaceState, model: DocumentModel,
  budget = WORKSPACE_STORAGE_BUDGET): EncodedWorkspace {
  for (let level = 0; ; level++) {
    const candidate = encodeWorkspaceAt(state, level, model, budget);
    if (!candidate.overBudget || level === LEVELS.length - 1) return candidate;
  }
}

export type FittedWorkspace = {
  encoded: string;
  size: number;
  /** What was kept. */
  plan: WorkspacePlan;
  /**
   * More was dropped than the standard policy drops (older Undo steps, recovery copies or removed
   * presets), so the UI says "Older steps were not kept".
   */
  trimmed: boolean;
  /** Even the smallest form (the looks alone) exceeds the budget; the write may still succeed. */
  overBudget: boolean;
  /** Nothing further can be dropped. */
  minimal: boolean;
};

/**
 * The stored workspace that fits `budget` (feature-module platform §3, `fitWorkspace`). It always
 * applies the standard policy, then, only while the encoded form is over budget, gives up in this order:
 *
 * 1. recovery drafts' histories (the standard policy already keeps their looks without them);
 * 2. other presets' histories, oldest steps first;
 * 3. the selected look's history, oldest steps first, keeping at least `MIN_SELECTED_HISTORY` steps;
 * 4. recovery copies (oldest draft first), then removed presets kept for Restore (oldest first);
 * 5. only when the looks alone leave no room for them, the selected look's last steps.
 *
 * The current presets themselves are never dropped. Nothing here changes the live session.
 */
export function fitWorkspace(state: WorkspaceState, model: DocumentModel, budget = WORKSPACE_STORAGE_BUDGET): FittedWorkspace {
  const encode = (plan: WorkspacePlan) => encodePlan(state, plan, model);
  const result = (plan: WorkspacePlan, encoded: string, minimal = false): FittedWorkspace => ({ encoded, size: encoded.length, plan,
    trimmed: plan !== STANDARD_PLAN, overBudget: encoded.length > budget, minimal });
  const standard = encode(STANDARD_PLAN);
  if (standard.length <= budget) return result(STANDARD_PLAN, standard);
  const extent = measure(state);
  let plan: WorkspacePlan = { ...STANDARD_PLAN };
  // Each stage searches the largest value of one plan field that fits; `fits` caches every encode.
  const tried = new Map<string, string>();
  const attempt = (candidate: WorkspacePlan) => {
    const key = JSON.stringify(candidate, (_k, value) => value === Infinity ? "all" : value);
    let encoded = tried.get(key);
    if (encoded === undefined) tried.set(key, encoded = encode(candidate));
    return encoded;
  };
  const stage = (field: keyof WorkspacePlan, from: number, to: number) => {
    // `from` is the current (largest) value, `to` the smallest this stage may reach.
    if (from <= to) return false;
    const at = (value: number) => attempt({ ...plan, [field]: value });
    if (at(to).length > budget) { plan = { ...plan, [field]: to }; return false; }
    let low = to, high = from;       // at(low) fits; at(high) does not (the stage started over budget)
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (at(middle).length <= budget) low = middle; else high = middle;
    }
    plan = { ...plan, [field]: low };
    return true;
  };
  const done = () => { const encoded = attempt(plan); return encoded.length <= budget ? result(plan, encoded) : undefined; };
  // 2. Other presets' histories, oldest first.
  if (stage("background", Math.min(PERSISTED_BACKGROUND_HISTORY, extent.background), 0)) return done()!;
  plan = { ...plan, background: 0 };
  // 3. The selected look's history, oldest first, down to the floor.
  if (stage("selected", extent.selected, Math.min(MIN_SELECTED_HISTORY, extent.selected))) return done()!;
  plan = { ...plan, selected: Math.min(MIN_SELECTED_HISTORY, extent.selected) };
  // 4. Recovery copies, then removed presets, oldest first.
  if (stage("recovery", extent.recovery, 0)) return done()!;
  plan = { ...plan, recovery: 0 };
  if (stage("removed", extent.removed, 0)) return done()!;
  plan = { ...plan, removed: 0 };
  // 5. The looks alone leave no room for the floor: keep what fits.
  if (stage("selected", plan.selected, 0)) return done()!;
  plan = { ...plan, selected: 0 };
  const smallest = attempt(plan);
  return result(plan, smallest, true);
}

/** How much each plan field can hold in this workspace (the largest meaningful value). */
function measure(state: WorkspaceState): WorkspacePlan {
  const collections = state.collections;
  const depth = (memory: LookMemory | undefined) => {
    const own = memory?.[LOOK_MEMORY]?.editor as { entries?: unknown[] } | undefined;
    if (own?.entries) return own.entries.length;
    return Math.max(0, ...Object.values(memory ?? {}).map(entry => Array.isArray(entry.history) ? entry.history.length : 0));
  };
  const loose = Array.isArray(state.history) ? state.history.length : state.history.entries.length;
  if (!collections) return { background: 0, selected: loose, recovery: 0, removed: 0 };
  const ids = collections.collection.presets.map(preset => preset.id);
  return {
    background: Math.max(0, ...ids.filter(id => id !== collections.selected).map(id => depth(collections.memory[id]))),
    selected: collections.selected ? depth(collections.memory[collections.selected]) : 0,
    recovery: [collections.previous, ...(collections.older ?? [])].filter(Boolean).length,
    removed: collections.removed.length,
  };
}

/** The workspace stored with one plan (for tools and tests; autosave uses `fitWorkspace`). */
export function encodeWorkspacePlan(state: WorkspaceState, plan: WorkspacePlan, model: DocumentModel): string {
  return encodePlan(state, plan, model);
}
function encodePlan(state: WorkspaceState, plan: WorkspacePlan, model: DocumentModel): string {
  return JSON.stringify(serializeWorkspace(compactWorkspace(state, plan, model), model));
}

function compactWorkspace(state: WorkspaceState, plan: WorkspacePlan, model: DocumentModel): WorkspaceState {
  const collections = state.collections;
  if (!collections) {
    if (plan.selected === Infinity) return state;
    const memory = trimLook(withLiveMemory(undefined, { active: 0, selected: 0, history: state.history,
      ...(state.historyTrimmed ? { historyTrimmed: true } : {}) }, model), plan.selected, model);
    const history = model.parts.lookHistory(memory);
    return { ...state, history, ...(history.trimmed ? { historyTrimmed: true } : {}) };
  }
  const current = compactDraft(collections, plan, true, model);
  const recovery = [collections.previous, ...(collections.older ?? [])]
    .filter((draft): draft is CollectionDraft => !!draft).slice(0, plan.recovery).map(draft => compactDraft(draft, plan, false, model));
  const compacted: CollectionWorkspace = { ...current,
    ...(recovery.length ? { previous: recovery[0], older: recovery.slice(1) } : {}) };
  // The stored form restores the editor from the collection's selected look, so it keeps no loose editor copy.
  return { ...state, collections: compacted };
}

function compactDraft(draft: CollectionDraft, plan: WorkspacePlan, current: boolean, model: DocumentModel): CollectionDraft {
  const memory: Record<string, LookMemory> = {};
  for (const [id, look] of Object.entries(draft.memory)) {
    const keep = !current ? 0 : id === draft.selected ? plan.selected : plan.background;
    memory[id] = trimLook(look, keep, model);
  }
  return { collection: draft.collection, revision: draft.revision, selected: draft.selected,
    // Recovery drafts keep their presets but not their removed-preset lists; removed presets keep no history.
    memory, removed: (current && plan.removed > 0 ? draft.removed.slice(-plan.removed) : [])
      .map(entry => ({ ...entry, memory: trimLook(entry.memory, 0, model) })) };
}

/** A look's Undo history trimmed to its latest `keep` steps, recording when older ones were dropped. */
function trimLook(look: LookMemory, keep: number, model: DocumentModel): LookMemory {
  const history = model.parts.lookHistory(look), trimmed = trimLookHistory(history, keep);
  return trimmed === history && LOOK_MEMORY in look ? look : model.parts.withLookHistory(look, trimmed);
}
