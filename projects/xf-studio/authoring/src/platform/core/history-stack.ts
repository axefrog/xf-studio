/**
 * One linear Undo stack (feature-module platform §3): the steps of one history scope, each holding the keys it touched as they
 * were before it. The history service (`history-service.ts`) keeps one per scope: the look's (keys are features, persisted as
 * `xfs/look-history-1`), the View and lighting history's (node IDs and `structure`) and each experiment document's (its ID).
 * DOM-free; imports only the platform API.
 *
 * - **Steps record what they touched.** A step keeps each touched key's value as it was before the step, split into chunks by
 *   the scope's codec and stored once in the stack's value store. The look's store is content-addressed JSON (a gesture on one
 *   layer of a 32-layer look costs one layer chunk, and the stored form is plain data); session-only scopes keep values by
 *   reference (`ReferenceStore`), so a step costs no copy however large the value (a groom).
 * - **Limit.** At `limit` steps a new step drops the oldest and marks the history trimmed ("Older steps were not kept").
 *   Discarding or undoing that new step brings the dropped one back.
 * - **Identity.** Every step has a session-unique ID (`HistoryEntryId`), kept through Undo and Redo; labels and times are
 *   session-only. A transaction tracks the step its checkpoint added by ID.
 * - **Coalescing.** A checkpoint with a `coalesce` key while the top step is unsealed under the same key adds no step: the keys
 *   that step does not hold yet join its "before", so a slider drag is one step however long it runs (CORE-95). `seal()`, Undo,
 *   Redo and any other step end the run.
 * - **Redo** is session-only: Undo moves steps onto the Redo list with the values as they were after them, and Redo puts them
 *   back with their identity. Whether Redo is still valid is the service's decision; it clears the list otherwise.
 * - **Selection** keeps the endpoints changed by a step, captured with its content publication rather than later navigation.
 *   Moves restore those endpoints; unchanged selections use the target's replay rule. Old saved steps need no selection field.
 * - **Data.** `data()` is the plain `LookHistoryData` form (kept steps and their chunks, without labels, times or Redo);
 *   `fromData`, `fromSteps` and `fromBodies` (a feature's whole parts, as older workspaces stored them) read it back.
 */
import { HISTORY_LIMIT, LOOK_HISTORY_1, UNKNOWN_HISTORY_LABEL, type ChunkId, type HistoryEntryId, type HistoryLabel,
  type HistoryParts, type HistoryScope, type HistorySelection, type LookHistoryData, type StoredLookEntry } from "../api/history";
import { ChunkStore } from "./chunk-store";

/** Reads the current value of one key (for the look, a feature's parsed part); undefined when there is none. */
export type LookReader = (key: string) => unknown | undefined;
/** Values by key; undefined means the key had no value (the look did not have that part, a node did not exist). */
export type LookParts = Record<string, unknown | undefined>;
/** A step without its content, for timelines and menus. Unlabelled (restored) steps have no label or time. */
export type HistoryStepInfo = { id: HistoryEntryId; label?: HistoryLabel; at?: number };

/** Where a stack keeps chunk values: each `put` takes one reference, released when no step uses the chunk. */
export interface ValueStore {
  put(value: unknown): ChunkId;
  retain(id: ChunkId): void;
  release(id: ChunkId): void;
  /** The chunk's value (a fresh copy for a JSON store; the value itself for a reference store). */
  value(id: ChunkId): unknown;
  /** Distinct chunks held, and their text length (UTF-16 code units; 0 for values kept by reference). */
  stats(): { chunks: number; units: number };
}

/** The look's store: content-addressed JSON text (`ChunkStore`), so equal chunks are stored once and the data is plain. */
export function jsonValues(store = new ChunkStore()): ValueStore {
  return { put: value => store.put(JSON.stringify(value)), retain: id => store.retain(id), release: id => store.release(id),
    value: id => JSON.parse(store.text(id)), stats: () => store.stats() };
}

/**
 * A session-only store that keeps values by reference: no copy and no serialisation, whatever their size. Values must not be
 * mutated after they are recorded (the view graph records detached copies; documents are replaced, never edited in place).
 * Equal references share one chunk, so a step that holds what the top step holds is still recognised.
 */
export class ReferenceStore implements ValueStore {
  private readonly ids = new Map<unknown, ChunkId>();
  private readonly entries = new Map<ChunkId, { value: unknown; count: number }>();
  private next = 1;
  put(value: unknown): ChunkId {
    const known = this.ids.get(value);
    if (known !== undefined) { this.entries.get(known)!.count++; return known; }
    const id = `r${this.next++}`;
    this.ids.set(value, id); this.entries.set(id, { value, count: 1 });
    return id;
  }
  retain(id: ChunkId) {
    const entry = this.entries.get(id);
    if (!entry) throw Error(`History value ${id} is missing.`);
    entry.count++;
  }
  release(id: ChunkId) {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (--entry.count > 0) return;
    this.entries.delete(id); this.ids.delete(entry.value);
  }
  value(id: ChunkId) {
    const entry = this.entries.get(id);
    if (!entry) throw Error(`History value ${id} is missing.`);
    return entry.value;
  }
  stats() { return { chunks: this.entries.size, units: 0 }; }
}

/** A codec that keeps each key's value whole, as one chunk (session-only scopes). */
export const WHOLE_VALUES: HistoryParts = Object.freeze({ chunks: (_key: string, value: unknown) => [value],
  join: (_key: string, chunks: readonly unknown[]) => chunks[0] });

type Refs = Record<string, ChunkId[] | null>;
/** `distinct`: the step was recorded although the top step held the same content, so Redo puts it back the same way. */
type Entry = HistoryStepInfo & { scope: HistoryScope; before: Refs; coalesce?: string; distinct?: true; selection?: HistorySelection };
type RedoEntry = { id: HistoryEntryId; label: HistoryLabel; at?: number; scope: HistoryScope; after: Refs; distinct?: true; selection?: HistorySelection };
export type CheckpointOptions = {
  scope?: HistoryScope; label?: HistoryLabel;
  /** Joins the top step while it is unsealed under the same key (a continuous edit). */
  coalesce?: string;
  /** Whether the step records its time (default true; a document's steps have none). */
  timed?: boolean;
  /** Add a step even when the top step already holds exactly this content. */
  distinct?: boolean;
  selection?: LookReader;
};

/** Step identities are unique for the whole session, across scopes, looks and restores. */
let nextEntryId = 1;
const newId = () => nextEntryId++ as HistoryEntryId;
const copyLabel = (label: HistoryLabel | undefined) => label && { ...label };

export class HistoryStack {
  private readonly store: ValueStore;
  private entries: Entry[] = [];
  private redoList: RedoEntry[] = [];
  /** The oldest step the latest push dropped at the limit, restored if that push is popped again. */
  private displaced?: { by: HistoryEntryId; entry: Entry; trimmed: boolean };
  private trimmedBefore = false;

  constructor(private readonly parts: HistoryParts, readonly limit = HISTORY_LIMIT, store?: ValueStore) {
    this.store = store ?? jsonValues();
  }
  /** Keep all stack state (including Redo, labels, coalescing and the displaced limit entry) if a target refuses a move. */
  attempt(move: () => boolean): boolean {
    const entries = this.entries.map(entry => ({ ...entry })), redo = this.redoList.map(entry => ({ ...entry })), trimmed = this.trimmedBefore;
    const displaced = this.displaced && { ...this.displaced, entry: { ...this.displaced.entry } };
    const refs = [...entries.map(entry => entry.before), ...redo.map(entry => entry.after), ...(displaced ? [displaced.entry.before] : [])];
    for (const values of refs) for (const chunks of Object.values(values)) for (const id of chunks ?? []) this.store.retain(id);
    let accepted = false;
    try { accepted = move(); return accepted; }
    finally {
      if (accepted) for (const values of refs) this.releaseRefs(values);
      else {
        this.clear();
        this.entries = entries; this.redoList = redo; this.displaced = displaced; this.trimmedBefore = trimmed;
      }
    }
  }

  /** A history from a feature's whole parts, oldest first (how workspaces before the look history stored it). */
  static fromBodies(parts: HistoryParts, feature: string, bodies: readonly unknown[], trimmed = false,
    limit = HISTORY_LIMIT): HistoryStack {
    return HistoryStack.fromSteps(parts, bodies.map(body => ({ feature, body })), trimmed, limit);
  }
  /** A history of part steps, oldest first, each one feature's whole part before it (no labels or times). */
  static fromSteps(parts: HistoryParts, steps: readonly { feature: string; body: unknown }[], trimmed = false,
    limit = HISTORY_LIMIT): HistoryStack {
    const history = new HistoryStack(parts, limit);
    history.entries = steps.slice(-limit).map(({ feature, body }) => ({ id: newId(), scope: "part" as const,
      before: { [feature]: history.encodeBody(feature, body) } }));
    history.trimmedBefore = trimmed || steps.length > limit;
    return history;
  }
  /** A history from its plain data. Throws when a step names a chunk the data does not hold. */
  static fromData(parts: HistoryParts, data: LookHistoryData, limit = HISTORY_LIMIT): HistoryStack {
    const history = new HistoryStack(parts, limit);
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
      local.set(id, found = history.store.put(data.chunks[id]));
      return found;
    };
    history.entries = kept.map(entry => {
      if (!entry || (entry.scope !== "part" && entry.scope !== "look") || !entry.before || typeof entry.before !== "object")
        throw Error("This look's Undo history is damaged.");
      const before: Refs = {};
      for (const [feature, ids] of Object.entries(entry.before))
        before[feature] = ids === null ? null : (Array.isArray(ids) ? ids : []).map(ref);
      const selection = entry.selection && Object.fromEntries(Object.entries(entry.selection).filter(([key, change]) =>
        Object.hasOwn(before, key) && change && Object.hasOwn(change, "before") && Object.hasOwn(change, "after")));
      return { id: newId(), scope: entry.scope, before, ...(selection ? { selection: structuredClone(selection) } : {}) };
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
   * Record `keys` as they are now (before a change). Returns the new step's ID, or undefined when no step was added: the top step
   * already holds exactly this content (nothing to undo to; it then reverts the coming change, so a `label` names it, CORE-42: a
   * gesture that moved a point and back, then an opacity edit, is undone as "Opacity"), or it is the unsealed step of the same
   * continuous edit (`coalesce`), which takes the keys it does not hold yet.
   */
  checkpoint(read: LookReader, keys: readonly string[], options: CheckpointOptions = {}): HistoryEntryId | undefined {
    const top = this.entries.at(-1);
    if (options.coalesce !== undefined && top?.coalesce === options.coalesce) {
      for (const key of keys) if (!Object.hasOwn(top.before, key)) top.before[key] = this.encodeOne(read, key);
      this.startSelection(top, keys, options.selection);
      if (options.label) top.label = { ...options.label };
      return undefined;
    }
    const before = this.encode(read, keys);
    if (!options.distinct && this.sameAsTop(before)) {
      this.releaseRefs(before);
      if (options.label) top!.label = { ...options.label };
      if (options.coalesce !== undefined) top!.coalesce = options.coalesce;
      this.startSelection(top!, keys, options.selection);
      return undefined;
    }
    const entry: Entry = { id: newId(), scope: options.scope ?? (keys.length > 1 ? "look" : "part"),
      label: copyLabel(options.label), ...(options.timed === false ? {} : { at: Date.now() }), before,
      ...(options.coalesce === undefined ? {} : { coalesce: options.coalesce }), ...(options.distinct ? { distinct: true as const } : {}) };
    this.startSelection(entry, keys, options.selection);
    return this.push(entry);
  }
  private startSelection(entry: Entry, keys: readonly string[], read?: LookReader) {
    if (!read) return;
    const selection = { ...entry.selection };
    for (const key of keys) if (!Object.hasOwn(selection, key)) {
      const before = structuredClone(read(key));
      selection[key] = { before, after: before };
    }
    entry.selection = selection;
  }
  /** Complete the pending checkpoint from the content publication, never from later navigation. */
  recordSelection(step: HistoryEntryId, keys: readonly string[], read: LookReader) {
    const entry = this.entries.at(-1);
    if (entry?.id !== step || !entry.selection) return;
    const selection = { ...entry.selection };
    for (const key of keys) if (Object.hasOwn(selection, key))
      selection[key] = { before: selection[key].before, after: structuredClone(read(key)) };
    entry.selection = selection;
  }
  selection(index: number, endpoint: "before" | "after"): Record<string, unknown> {
    return this.selectionOf(this.entries[index]?.selection, endpoint);
  }
  private selectionOf(selection: HistorySelection | undefined, endpoint: "before" | "after"): Record<string, unknown> {
    return Object.fromEntries(Object.entries(selection ?? {}).filter(([, change]) =>
      JSON.stringify(change.before) !== JSON.stringify(change.after)).map(([key, change]) => [key, structuredClone(change[endpoint])]));
  }
  /** End the current continuous edit: the next checkpoint starts a step of its own even with the same key (CORE-95). */
  seal() { const top = this.entries.at(-1); if (top) delete top.coalesce; }
  /** Drop every step, Redo included, and the record of dropped ones. */
  clear() {
    for (const entry of this.entries) this.releaseEntry(entry);
    if (this.displaced) this.releaseEntry(this.displaced.entry);
    this.clearRedo();
    this.entries = []; this.displaced = undefined; this.trimmedBefore = false;
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
  /** Take the top step off without Redo (a cancelled transaction); returns the values it restores. */
  revert(): LookParts | undefined {
    const entry = this.pop();
    if (!entry) return undefined;
    const parts = this.materialize(entry.before);
    this.releaseEntry(entry);
    return parts;
  }

  /**
   * Undo `count` steps as one change: each goes onto the Redo list with the values as they were after
   * it, and the values to show are returned once (only the keys the steps touched). Undefined when
   * fewer steps are kept.
   */
  undo(read: LookReader, count = 1): { parts: LookParts; steps: HistoryStepInfo[]; selection: Record<string, unknown> } | undefined {
    if (count < 1 || this.entries.length < count) return undefined;
    this.seal();
    const state = new Map<string, ChunkId[] | null>(), steps: HistoryStepInfo[] = [], selection: Record<string, unknown> = {};
    for (let i = 0; i < count; i++) {
      const entry = this.pop()!;
      const after: Refs = {};
      for (const key of Object.keys(entry.before)) after[key] = this.current(state, read, key);
      this.redoList.push({ id: entry.id, label: entry.label ? { ...entry.label } : { ...UNKNOWN_HISTORY_LABEL },
        ...(entry.at === undefined ? {} : { at: entry.at }), scope: entry.scope, after, selection: entry.selection,
        ...(entry.distinct ? { distinct: true as const } : {}) });
      Object.assign(selection, this.selectionOf(entry.selection, "before"));
      steps.push({ id: entry.id, ...(entry.label ? { label: { ...entry.label } } : {}), ...(entry.at === undefined ? {} : { at: entry.at }) });
      for (const [key, refs] of Object.entries(entry.before)) this.replace(state, key, refs);
    }
    return { parts: this.settle(state), steps, selection };
  }
  /**
   * Redo `count` steps as one change: each goes back on top with its identity (the values as they are
   * now become its "before"), and the values to show are returned once. Undefined without enough Redo.
   */
  redo(read: LookReader, count = 1): { parts: LookParts; pushed: number; selection: Record<string, unknown> } | undefined {
    if (count < 1 || this.redoList.length < count) return undefined;
    this.seal();
    const state = new Map<string, ChunkId[] | null>();
    const selection: Record<string, unknown> = {};
    let pushed = 0;
    for (let i = 0; i < count; i++) {
      const step = this.redoList.pop()!;
      const before: Refs = {};
      for (const key of Object.keys(step.after)) before[key] = this.current(state, read, key);
      if (!step.distinct && this.sameAsTop(before)) this.releaseRefs(before);
      else { pushed++; this.push({ id: this.entries.some(entry => entry.id === step.id) ? newId() : step.id, label: { ...step.label },
        ...(step.at === undefined ? {} : { at: step.at }), scope: step.scope, before, selection: step.selection,
        ...(step.distinct ? { distinct: true as const } : {}) }); }
      Object.assign(selection, this.selectionOf(step.selection, "after"));
      for (const [key, refs] of Object.entries(step.after)) this.replace(state, key, refs);
    }
    return { parts: this.settle(state), pushed, selection };
  }
  get redoDepth() { return this.redoList.length; }
  /** Every step identity the stack still holds: kept, redo-able and the one a step at the limit displaced. */
  heldIds(): Set<HistoryEntryId> {
    return new Set([...this.entries, ...this.redoList, ...(this.displaced ? [this.displaced.entry] : [])].map(step => step.id));
  }
  /** Redo-able steps in the order Redo re-applies them (the next one first). */
  redoSteps(): (HistoryStepInfo & { label: HistoryLabel })[] {
    return [...this.redoList].reverse().map(step => ({ id: step.id, label: { ...step.label },
      ...(step.at === undefined ? {} : { at: step.at }) }));
  }
  clearRedo() {
    for (const step of this.redoList) this.releaseRefs(step.after);
    this.redoList = [];
  }

  /** The values one kept step restores, oldest step first (index 0). */
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
  /** The keys any kept step touches. */
  features(): string[] {
    return [...new Set(this.entries.flatMap(entry => Object.keys(entry.before)))];
  }
  /** Plain data: kept steps and the chunks they use (labels, times and Redo are session-only). */
  data(): LookHistoryData {
    const chunks: Record<ChunkId, unknown> = {};
    const entries: StoredLookEntry[] = this.entries.map(entry => {
      for (const refs of Object.values(entry.before)) for (const id of refs ?? [])
        if (!Object.hasOwn(chunks, id)) chunks[id] = this.store.value(id);
      const selection = Object.fromEntries(Object.entries(entry.selection ?? {}).filter(([, change]) =>
        JSON.stringify(change.before) !== JSON.stringify(change.after)));
      return { scope: entry.scope, before: Object.fromEntries(Object.entries(entry.before).map(([feature, refs]) =>
        [feature, refs && [...refs]])), ...(Object.keys(selection).length ? { selection: structuredClone(selection) } : {}) };
    });
    return { schema: LOOK_HISTORY_1, entries, chunks, ...(this.trimmedBefore ? { trimmed: true as const } : {}) };
  }
  /** Distinct chunks this stack holds (kept steps and Redo) and their text length, for size budgets and benchmarks. */
  stats() { return this.store.stats(); }

  private push(entry: Entry): HistoryEntryId {
    // A different step ends the previous continuous edit.
    const previous = this.entries.at(-1);
    if (previous) delete previous.coalesce;
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
    return keys.every(key => {
      const a = refs[key], b = top[key];
      if (a === null || b === null || a === undefined || b === undefined) return a === b;
      return a.length === b.length && a.every((id, i) => id === b[i]);
    });
  }
  private encode(read: LookReader, keys: readonly string[]): Refs {
    const refs: Refs = {};
    for (const key of keys) refs[key] = this.encodeOne(read, key);
    return refs;
  }
  private encodeOne(read: LookReader, key: string): ChunkId[] | null {
    const value = read(key);
    return value === undefined ? null : this.encodeBody(key, value);
  }
  private encodeBody(key: string, value: unknown): ChunkId[] {
    return this.parts.chunks(key, value).map(chunk => this.store.put(chunk));
  }
  /** One key's references in a running Undo/Redo, retained again for a new owner. */
  private current(state: Map<string, ChunkId[] | null>, read: LookReader, key: string): ChunkId[] | null {
    if (!state.has(key)) return this.encodeOne(read, key);
    const refs = state.get(key)!;
    for (const id of refs ?? []) this.store.retain(id);
    return refs && [...refs];
  }
  /** Move `refs` (already owned) into the running state, releasing what it held for that key. */
  private replace(state: Map<string, ChunkId[] | null>, key: string, refs: ChunkId[] | null) {
    const previous = state.get(key);
    if (previous) for (const id of previous) this.store.release(id);
    state.set(key, refs);
  }
  private settle(state: Map<string, ChunkId[] | null>): LookParts {
    const parts: LookParts = {};
    for (const [key, refs] of state) {
      parts[key] = refs === null ? undefined : this.join(key, refs);
      for (const id of refs ?? []) this.store.release(id);
    }
    return parts;
  }
  private materialize(before: Refs): LookParts {
    return Object.fromEntries(Object.entries(before).map(([key, refs]) => [key, refs === null ? undefined : this.join(key, refs)]));
  }
  private join(key: string, refs: readonly ChunkId[]) {
    return this.parts.join(key, refs.map(id => this.store.value(id)));
  }
  private releaseRefs(refs: Refs) { for (const ids of Object.values(refs)) for (const id of ids ?? []) this.store.release(id); }
  private releaseEntry(entry: Entry) { this.releaseRefs(entry.before); }
}
