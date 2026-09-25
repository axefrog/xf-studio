/**
 * One look's Undo history (feature-module platform §3, migration step 4). DOM-free; imports only the
 * platform API.
 *
 * - **Steps record what they touched.** A `part` step (an action, form control or gesture) and a
 *   `look` step (one transaction over several parts) each keep the touched parts as they were before
 *   the step, split into chunks by the part codecs and stored once in the look's chunk store. A
 *   gesture on one layer of a 32-layer look therefore costs one layer chunk.
 * - **Limit.** At `limit` (80) steps a new step drops the oldest and marks the history trimmed
 *   ("Older steps were not kept"). Discarding or undoing that new step brings the dropped one back.
 * - **Identity.** Every step has a session-unique ID (`HistoryEntryId`), kept through Undo and Redo;
 *   labels and times are session-only. A transaction tracks the step its checkpoint added by ID.
 * - **Redo** is session-only: Undo moves steps onto the Redo list with the parts as they were after
 *   them, and Redo puts them back with their identity. Whether Redo is still valid (the look is
 *   exactly what the last Undo produced) is the host's decision; it clears the list otherwise.
 * - **Data.** `data()` is the plain `LookHistoryData` form (kept steps and their chunks, without
 *   labels, times or Redo); `fromData` and `fromBodies` (a feature's whole parts, as older workspaces
 *   stored them) read it back.
 */
import { HISTORY_LIMIT, LOOK_HISTORY_1, UNKNOWN_HISTORY_LABEL, type ChunkId, type HistoryEntryId, type HistoryLabel,
  type HistoryParts, type HistoryScope, type LookHistoryData, type StoredLookEntry } from "../api/history";
import { ChunkStore } from "./chunk-store";

/** Reads the current parsed body of one feature's part in the look; undefined when the look lacks it. */
export type LookReader = (feature: string) => unknown | undefined;
/** Parsed part bodies by feature; undefined means the look does not have that part. */
export type LookParts = Record<string, unknown | undefined>;
/** A step without its content, for timelines and menus. Unlabelled (restored) steps have no label or time. */
export type HistoryStepInfo = { id: HistoryEntryId; label?: HistoryLabel; at?: number };

type Refs = Record<string, ChunkId[] | null>;
type Entry = HistoryStepInfo & { scope: HistoryScope; before: Refs };
type RedoEntry = { id: HistoryEntryId; label: HistoryLabel; at?: number; scope: HistoryScope; after: Refs };

/** Step identities are unique for the whole session, across looks and restores. */
let nextEntryId = 1;
const newId = () => nextEntryId++ as HistoryEntryId;
const copyLabel = (label: HistoryLabel | undefined) => label && { ...label };

export class LookHistory {
  private readonly store: ChunkStore;
  private entries: Entry[] = [];
  private redoList: RedoEntry[] = [];
  /** The oldest step the latest push dropped at the limit, restored if that push is popped again. */
  private displaced?: { by: HistoryEntryId; entry: Entry; trimmed: boolean };
  private trimmedBefore = false;

  constructor(private readonly parts: HistoryParts, readonly limit = HISTORY_LIMIT, store?: ChunkStore) {
    this.store = store ?? new ChunkStore();
  }

  /** A history from a feature's whole parts, oldest first (how workspaces before the look history stored it). */
  static fromBodies(parts: HistoryParts, feature: string, bodies: readonly unknown[], trimmed = false,
    limit = HISTORY_LIMIT): LookHistory {
    return LookHistory.fromSteps(parts, bodies.map(body => ({ feature, body })), trimmed, limit);
  }
  /** A history of part steps, oldest first, each one feature's whole part before it (no labels or times). */
  static fromSteps(parts: HistoryParts, steps: readonly { feature: string; body: unknown }[], trimmed = false,
    limit = HISTORY_LIMIT): LookHistory {
    const history = new LookHistory(parts, limit);
    history.entries = steps.slice(-limit).map(({ feature, body }) => ({ id: newId(), scope: "part" as const,
      before: { [feature]: history.encodeBody(feature, body) } }));
    history.trimmedBefore = trimmed || steps.length > limit;
    return history;
  }
  /** A history from its plain data. Throws when a step names a chunk the data does not hold. */
  static fromData(parts: HistoryParts, data: LookHistoryData, limit = HISTORY_LIMIT): LookHistory {
    const history = new LookHistory(parts, limit);
    if (!data || data.schema !== LOOK_HISTORY_1 || !Array.isArray(data.entries) || !data.chunks || typeof data.chunks !== "object")
      throw Error("This look's Undo history is damaged.");
    const kept = data.entries.slice(-limit);
    // Addresses are recomputed from the content, so stored addresses never have to be trusted. Each
    // distinct stored chunk is serialized and hashed once; later references only retain it (CORE-40).
    const local = new Map<ChunkId, ChunkId>();
    const ref = (id: ChunkId) => {
      let found = local.get(id);
      if (found !== undefined) { history.store.retain(found); return found; }
      if (!Object.hasOwn(data.chunks, id)) throw Error("This look's Undo history is damaged.");
      local.set(id, found = history.store.put(JSON.stringify(data.chunks[id])));
      return found;
    };
    history.entries = kept.map(entry => {
      if (!entry || (entry.scope !== "part" && entry.scope !== "look") || !entry.before || typeof entry.before !== "object")
        throw Error("This look's Undo history is damaged.");
      const before: Refs = {};
      for (const [feature, ids] of Object.entries(entry.before))
        before[feature] = ids === null ? null : (Array.isArray(ids) ? ids : []).map(ref);
      return { id: newId(), scope: entry.scope, before };
    });
    history.trimmedBefore = data.trimmed === true || data.entries.length > limit;
    return history;
  }

  get canUndo() { return this.entries.length > 0; }
  get depth() { return this.entries.length; }
  /** True when older steps than the oldest kept one were dropped. */
  get trimmed() { return this.trimmedBefore; }
  get topId(): HistoryEntryId | undefined { return this.entries.at(-1)?.id; }
  isTop(id: HistoryEntryId) { return this.entries.at(-1)?.id === id; }

  /**
   * Record `features` as they are now (before a change). Returns the new step's ID, or undefined when
   * the top step already holds exactly this content (nothing to undo to). The top step then reverts
   * the coming change, so a `label` names it (CORE-42): a gesture that moved a point and back, then an
   * opacity edit, is undone as "Opacity".
   */
  checkpoint(read: LookReader, features: readonly string[], options: { scope?: HistoryScope; label?: HistoryLabel } = {}):
    HistoryEntryId | undefined {
    const before = this.encode(read, features);
    if (this.sameAsTop(before)) {
      this.releaseRefs(before);
      if (options.label) this.entries.at(-1)!.label = { ...options.label };
      return undefined;
    }
    return this.push({ id: newId(), scope: options.scope ?? (features.length > 1 ? "look" : "part"),
      label: copyLabel(options.label), at: Date.now(), before });
  }
  /** Name a step; a no-op once that step was undone or dropped. */
  relabel(id: HistoryEntryId, label: HistoryLabel) {
    const entry = this.entries.find(item => item.id === id); if (entry) entry.label = { ...label };
  }
  /** Label of the step the next Undo reverts. */
  topLabel(): HistoryLabel | undefined {
    const entry = this.entries.at(-1);
    return entry && (entry.label ? { ...entry.label } : { ...UNKNOWN_HISTORY_LABEL });
  }
  /** Kept steps oldest first, without content. */
  list(): HistoryStepInfo[] {
    return this.entries.map(entry => ({ id: entry.id, ...(entry.label ? { label: { ...entry.label } } : {}),
      ...(entry.at === undefined ? {} : { at: entry.at }) }));
  }
  /**
   * Remove step `id` only while it is the top step (an empty transaction's checkpoint), so an empty
   * transaction leaves the history exactly as it found it, even at the limit. Never creates Redo.
   */
  discard(id: HistoryEntryId): boolean {
    if (!this.isTop(id)) return false;
    this.releaseEntry(this.pop()!);
    return true;
  }
  /** Take the top step off without Redo (a cancelled transaction); returns the parts it restores. */
  revert(): LookParts | undefined {
    const entry = this.pop();
    if (!entry) return undefined;
    const parts = this.materialize(entry.before);
    this.releaseEntry(entry);
    return parts;
  }

  /**
   * Undo `count` steps as one change: each goes onto the Redo list with the parts as they were after
   * it, and the parts to show are returned once (only the features the steps touched). Undefined when
   * fewer steps are kept.
   */
  undo(read: LookReader, count = 1): { parts: LookParts; steps: HistoryStepInfo[] } | undefined {
    if (count < 1 || this.entries.length < count) return undefined;
    const state = new Map<string, ChunkId[] | null>(), steps: HistoryStepInfo[] = [];
    for (let i = 0; i < count; i++) {
      const entry = this.pop()!;
      const after: Refs = {};
      for (const feature of Object.keys(entry.before)) after[feature] = this.current(state, read, feature);
      this.redoList.push({ id: entry.id, label: entry.label ? { ...entry.label } : { ...UNKNOWN_HISTORY_LABEL },
        ...(entry.at === undefined ? {} : { at: entry.at }), scope: entry.scope, after });
      steps.push({ id: entry.id, ...(entry.label ? { label: { ...entry.label } } : {}), ...(entry.at === undefined ? {} : { at: entry.at }) });
      for (const [feature, refs] of Object.entries(entry.before)) this.replace(state, feature, refs);
    }
    return { parts: this.settle(state), steps };
  }
  /**
   * Redo `count` steps as one change: each goes back on top with its identity (the parts as they are
   * now become its "before"), and the parts to show are returned once. Undefined without enough Redo.
   */
  redo(read: LookReader, count = 1): { parts: LookParts; pushed: number } | undefined {
    if (count < 1 || this.redoList.length < count) return undefined;
    const state = new Map<string, ChunkId[] | null>();
    let pushed = 0;
    for (let i = 0; i < count; i++) {
      const step = this.redoList.pop()!;
      const before: Refs = {};
      for (const feature of Object.keys(step.after)) before[feature] = this.current(state, read, feature);
      if (this.sameAsTop(before)) this.releaseRefs(before);
      else { pushed++; this.push({ id: this.entries.some(entry => entry.id === step.id) ? newId() : step.id, label: { ...step.label },
        ...(step.at === undefined ? {} : { at: step.at }), scope: step.scope, before }); }
      for (const [feature, refs] of Object.entries(step.after)) this.replace(state, feature, refs);
    }
    return { parts: this.settle(state), pushed };
  }
  get redoDepth() { return this.redoList.length; }
  /** Redo-able steps in the order Redo re-applies them (the next one first). */
  redoSteps(): (HistoryStepInfo & { label: HistoryLabel })[] {
    return [...this.redoList].reverse().map(step => ({ id: step.id, label: { ...step.label },
      ...(step.at === undefined ? {} : { at: step.at }) }));
  }
  clearRedo() {
    for (const step of this.redoList) this.releaseRefs(step.after);
    this.redoList = [];
  }

  /** The parts one kept step restores, oldest step first (index 0). */
  stepParts(index: number): LookParts | undefined {
    const entry = this.entries[index];
    return entry && this.materialize(entry.before);
  }
  /**
   * The kept steps as one feature's whole parts, oldest first, when every step is a part step of that
   * feature alone (the form workspaces before the look history stored); otherwise undefined.
   */
  bodies(feature: string): unknown[] | undefined {
    const bodies: unknown[] = [];
    for (const entry of this.entries) {
      const keys = Object.keys(entry.before), refs = entry.before[feature];
      if (entry.scope !== "part" || keys.length !== 1 || !refs) return undefined;
      bodies.push(this.join(feature, refs));
    }
    return bodies;
  }
  /** The features any kept step touches. */
  features(): string[] {
    return [...new Set(this.entries.flatMap(entry => Object.keys(entry.before)))];
  }
  /** Plain data: kept steps and the chunks they use (labels, times and Redo are session-only). */
  data(): LookHistoryData {
    const chunks: Record<ChunkId, unknown> = {};
    const entries: StoredLookEntry[] = this.entries.map(entry => {
      for (const refs of Object.values(entry.before)) for (const id of refs ?? [])
        if (!Object.hasOwn(chunks, id)) chunks[id] = JSON.parse(this.store.text(id));
      return { scope: entry.scope, before: Object.fromEntries(Object.entries(entry.before).map(([feature, refs]) =>
        [feature, refs && [...refs]])) };
    });
    return { schema: LOOK_HISTORY_1, entries, chunks, ...(this.trimmedBefore ? { trimmed: true as const } : {}) };
  }
  /** Distinct chunks this look holds (kept steps and Redo) and their text length, for size budgets and benchmarks. */
  stats() { return this.store.stats(); }

  private push(entry: Entry): HistoryEntryId {
    this.entries.push(entry);
    const dropped = this.entries.length > this.limit ? this.entries.shift() : undefined;
    if (this.displaced) this.releaseEntry(this.displaced.entry);
    this.displaced = dropped && { by: entry.id, entry: dropped, trimmed: this.trimmedBefore };
    if (dropped) this.trimmedBefore = true;
    return entry.id;
  }
  /** Pop the top step (its references pass to the caller). At the limit, the step its push displaced comes back. */
  private pop(): Entry | undefined {
    const entry = this.entries.pop();
    if (entry && this.displaced?.by === entry.id) {
      this.entries.unshift(this.displaced.entry);
      this.trimmedBefore = this.displaced.trimmed;
    } else if (this.displaced) this.releaseEntry(this.displaced.entry);
    this.displaced = undefined;
    return entry;
  }
  private sameAsTop(refs: Refs) {
    const top = this.entries.at(-1)?.before;
    if (!top) return false;
    const keys = Object.keys(refs);
    if (keys.length !== Object.keys(top).length) return false;
    return keys.every(feature => {
      const a = refs[feature], b = top[feature];
      if (a === null || b === null || a === undefined || b === undefined) return a === b;
      return a.length === b.length && a.every((id, i) => id === b[i]);
    });
  }
  private encode(read: LookReader, features: readonly string[]): Refs {
    const refs: Refs = {};
    for (const feature of features) {
      const body = read(feature);
      refs[feature] = body === undefined ? null : this.encodeBody(feature, body);
    }
    return refs;
  }
  private encodeBody(feature: string, body: unknown): ChunkId[] {
    return this.parts.chunks(feature, body).map(chunk => this.store.put(JSON.stringify(chunk)));
  }
  /** One feature's references in a running Undo/Redo, retained again for a new owner. */
  private current(state: Map<string, ChunkId[] | null>, read: LookReader, feature: string): ChunkId[] | null {
    if (!state.has(feature)) return this.encode(read, [feature])[feature];
    const refs = state.get(feature)!;
    for (const id of refs ?? []) this.store.retain(id);
    return refs && [...refs];
  }
  /** Move `refs` (already owned) into the running state, releasing what it held for that feature. */
  private replace(state: Map<string, ChunkId[] | null>, feature: string, refs: ChunkId[] | null) {
    const previous = state.get(feature);
    if (previous) for (const id of previous) this.store.release(id);
    state.set(feature, refs);
  }
  private settle(state: Map<string, ChunkId[] | null>): LookParts {
    const parts: LookParts = {};
    for (const [feature, refs] of state) {
      parts[feature] = refs === null ? undefined : this.join(feature, refs);
      for (const id of refs ?? []) this.store.release(id);
    }
    return parts;
  }
  private materialize(before: Refs): LookParts {
    return Object.fromEntries(Object.entries(before).map(([feature, refs]) => [feature, refs === null ? undefined : this.join(feature, refs)]));
  }
  private join(feature: string, refs: readonly ChunkId[]) {
    return this.parts.join(feature, refs.map(id => JSON.parse(this.store.text(id))));
  }
  private releaseRefs(refs: Refs) { for (const ids of Object.values(refs)) for (const id of ids ?? []) this.store.release(id); }
  private releaseEntry(entry: Entry) { this.releaseRefs(entry.before); }
}

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
    const keys = Object.keys(entry.before);
    if (entry.scope !== "part" || keys.length !== 1 || (feature !== undefined && keys[0] !== feature)) return undefined;
    feature = keys[0];
    const ids = entry.before[feature];
    if (!ids) return undefined;
    bodies.push(parts.join(feature, ids.map(id => data.chunks[id])));
  }
  return { ...(feature === undefined ? {} : { feature }), bodies };
}
