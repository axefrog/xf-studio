/**
 * One look's Undo history as data (feature-module platform §3, migration step 4): the persisted `xfs/look-history-1` form and
 * the helpers the workspace and the library use on it. The live history is a `HistoryStack` (`history-stack.ts`), the look
 * scope's stack in the history service; `LookHistory` is its name here. DOM-free; imports only the platform API.
 */
import { LOOK_HISTORY_1, type ChunkId, type HistoryParts, type LookHistoryData } from "../api/history";

export { HistoryStack as LookHistory, type HistoryStepInfo, type LookParts, type LookReader } from "./history-stack";

/** An empty look history. */
export const emptyLookHistory = (): LookHistoryData => ({ schema: LOOK_HISTORY_1, entries: [], chunks: {} });
/** True when a look history holds no step and no record of dropped ones (the same as having none). */
export const isEmptyLookHistory = (data: LookHistoryData | undefined) => !data || (!data.entries.length && !data.trimmed);
/** The data without chunks no kept step uses. */
export function pruneLookHistory(data: LookHistoryData): LookHistoryData {
  const chunks: Record<ChunkId, unknown> = {};
  for (const entry of data.entries) for (const ids of Object.values(entry.before)) for (const id of ids ?? [])
    if (Object.hasOwn(data.chunks, id)) chunks[id] = data.chunks[id];
  return { schema: LOOK_HISTORY_1, entries: data.entries, chunks, ...(data.trimmed ? { trimmed: true as const } : {}) };
}
/**
 * Keep the latest `keep` steps of a look history (the storage budget, oldest first), dropping the
 * chunks only older steps used and recording that older steps were not kept.
 */
export function trimLookHistory(data: LookHistoryData, keep: number): LookHistoryData {
  const count = Math.max(0, Math.min(data.entries.length, Number.isFinite(keep) ? Math.floor(keep) : data.entries.length));
  if (count === data.entries.length) return data;
  return { ...pruneLookHistory({ ...data, entries: data.entries.slice(data.entries.length - count) }), trimmed: true };
}
/**
 * The steps of a look history as one feature's whole parts, oldest first, when every step is a part
 * step of that feature alone and the look had the part before each step (the form workspaces before the
 * look history stored, which older builds read); an empty history has no feature. Undefined otherwise.
 * Parts are rebuilt from the chunk values without copying them: serialize the result at once.
 */
export function lookHistoryBodies(data: LookHistoryData, parts: HistoryParts): { feature?: string; bodies: unknown[] } | undefined {
  let feature: string | undefined;
  const bodies: unknown[] = [];
  for (const entry of data.entries) {
    // Whole-part legacy storage cannot carry selection endpoints.
    if (entry.selection && Object.keys(entry.selection).length) return undefined;
    const keys = Object.keys(entry.before);
    if (entry.scope !== "part" || keys.length !== 1 || (feature !== undefined && keys[0] !== feature)) return undefined;
    feature = keys[0];
    const ids = entry.before[feature];
    if (!ids) return undefined;
    bodies.push(parts.join(feature, ids.map(id => data.chunks[id])));
  }
  return { ...(feature === undefined ? {} : { feature }), bodies };
}
