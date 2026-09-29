/**
 * Storage interfaces. The engine holds no database: a project implements `GraphStore` (the Studio's is SQLite behind a
 * host transport) and passes the store conformance suite in `strata/testing`, which `MemoryStore` passes too.
 */
import { fold } from "./fold";
import type { Entry, NodeId, NodeRef, Snapshot } from "./types";

/** A stored node as a listing sees it, without folding. */
export type NodeIndexRow = { readonly ref: NodeRef; readonly headSeq: number; readonly name: string; readonly trashed: boolean };
/** A node as loaded: its latest snapshot (if any) and the entries after it. */
export type StoredNode = { readonly ref: NodeRef; readonly snapshot?: Snapshot; readonly tail: readonly Entry[] };
/**
 * One commit to append. `expect` names each node's head seq the commit was made against (0 for a new node); a
 * mismatch refuses the whole commit as stale. Appends are idempotent by commit ID.
 */
export type AppendRequest = { readonly commit: string; readonly entries: readonly Entry[]; readonly expect: readonly (readonly [NodeId, number])[] };
export type AppendResult =
  | { readonly ok: true; readonly positions: readonly number[]; readonly duplicate?: true }
  | { readonly ok: false; readonly reason: "stale"; readonly nodes: readonly NodeId[] };

export interface GraphStore {
  /** Every stored node, from the index. */
  list(): Promise<readonly NodeIndexRow[]>;
  /** Every node's latest snapshot and the entries after it, and the head position. */
  load(): Promise<{ readonly head: number; readonly nodes: readonly StoredNode[] }>;
  /** A node's stream after entry `afterSeq` (0 or absent: all of it). */
  readStream(node: NodeRef, afterSeq?: number): Promise<readonly Entry[]>;
  /** Appends one commit's entries, assigning positions in commit order. */
  append(request: AppendRequest): Promise<AppendResult>;
  /** Every entry appended after position `pos`, in position order, and the head position. */
  changesSince(pos: number): Promise<{ readonly head: number; readonly entries: readonly Entry[] }>;
  /** A counter bumped by every append, compaction and purge (another window's included). */
  counter(): Promise<number>;
  /** Stores a snapshot (a cache: never the truth). */
  putSnapshot(snapshot: Snapshot): Promise<void>;
  /** Discards a node's snapshots. */
  dropSnapshots(node: NodeRef): Promise<void>;
  /**
   * Replaces a node's stored entries up to the last of `entries` (by seq) with `entries` (its kept entries and rollup
   * states, same seqs and positions), keeping any entry after it, and records where it was compacted; discards its
   * snapshots.
   */
  compact(node: NodeRef, entries: readonly Entry[], at: number): Promise<void>;
  /** Removes a node's stream, snapshots and index rows: removal, not hiding. */
  purge(node: NodeRef): Promise<void>;
}

type StoredStream = { ref: NodeRef; entries: Entry[] };

/**
 * An in-memory `GraphStore`. Synchronous inside, so it is also the base of the simulated store (which adds latency,
 * failures, lost replies and crashes around it).
 */
export class MemoryStore implements GraphStore {
  private streams = new Map<NodeId, StoredStream>();
  private snapshots = new Map<NodeId, Snapshot>();
  private commits = new Map<string, readonly number[]>();
  private log: Entry[] = [];
  private head = 0;
  private changes = 0;
  readonly compactions: { node: NodeRef; seq: number; at: number }[] = [];

  listNow(): NodeIndexRow[] {
    return [...this.streams.values()].map(stream => {
      const last = stream.entries[stream.entries.length - 1];
      const snapshot = this.snapshots.get(stream.ref.id);
      const state = fold(snapshot?.state ?? null, stream.entries.filter(entry => !snapshot || entry.seq > snapshot.seq));
      return { ref: stream.ref, headSeq: last?.seq ?? 0, name: state?.name ?? "", trashed: !!state?.trashed };
    });
  }
  async list() { return this.listNow(); }
  loadNow(): { head: number; nodes: StoredNode[] } {
    return { head: this.head, nodes: [...this.streams.values()].map(stream => {
      const snapshot = this.snapshots.get(stream.ref.id);
      return { ref: stream.ref, ...(snapshot ? { snapshot } : {}), tail: stream.entries.filter(entry => !snapshot || entry.seq > snapshot.seq) };
    }) };
  }
  async load() { return this.loadNow(); }
  readStreamNow(node: NodeRef, afterSeq = 0): Entry[] {
    return (this.streams.get(node.id)?.entries ?? []).filter(entry => entry.seq > afterSeq);
  }
  async readStream(node: NodeRef, afterSeq = 0) { return this.readStreamNow(node, afterSeq); }
  appendNow(request: AppendRequest): AppendResult {
    const done = this.commits.get(request.commit);
    if (done) return { ok: true, positions: done, duplicate: true };
    const stale = request.expect.filter(([id, seq]) => {
      const entries = this.streams.get(id)?.entries;
      return (entries?.[entries.length - 1]?.seq ?? 0) !== seq;
    }).map(([id]) => id);
    if (stale.length) return { ok: false, reason: "stale", nodes: stale };
    const positions: number[] = [];
    for (const entry of request.entries) {
      const pos = ++this.head;
      const stored = Object.freeze({ ...entry, pos });
      let stream = this.streams.get(entry.node.id);
      if (!stream) this.streams.set(entry.node.id, stream = { ref: entry.node, entries: [] });
      stream.entries.push(stored);
      this.log.push(stored);
      positions.push(pos);
    }
    this.commits.set(request.commit, positions);
    this.changes++;
    return { ok: true, positions };
  }
  async append(request: AppendRequest) { return this.appendNow(request); }
  changesSinceNow(pos: number) {
    // The log is in position order; compaction and purge remove from it.
    let low = 0, high = this.log.length;
    while (low < high) { const mid = (low + high) >> 1; if (this.log[mid].pos <= pos) low = mid + 1; else high = mid; }
    return { head: this.head, entries: this.log.slice(low) };
  }
  async changesSince(pos: number) { return this.changesSinceNow(pos); }
  async counter() { return this.changes; }
  putSnapshotNow(snapshot: Snapshot) {
    const current = this.snapshots.get(snapshot.node.id);
    if (!current || current.seq <= snapshot.seq) this.snapshots.set(snapshot.node.id, snapshot);
  }
  async putSnapshot(snapshot: Snapshot) { this.putSnapshotNow(snapshot); }
  async dropSnapshots(node: NodeRef) { this.snapshots.delete(node.id); }
  snapshotOf(node: NodeRef): Snapshot | undefined { return this.snapshots.get(node.id); }
  compactNow(node: NodeRef, entries: readonly Entry[], at: number) {
    const stream = this.streams.get(node.id);
    if (!stream) return;
    const through = entries[entries.length - 1]?.seq ?? 0;
    const removed = new Set(stream.entries.filter(entry => entry.seq <= through).map(entry => entry.pos));
    stream.entries = [...entries.map(entry => Object.freeze({ ...entry })), ...stream.entries.filter(entry => entry.seq > through)];
    for (const entry of stream.entries) removed.delete(entry.pos);
    const byPos = new Map(stream.entries.map(entry => [entry.pos, entry]));
    this.log = this.log.filter(entry => !removed.has(entry.pos)).map(entry => byPos.get(entry.pos) ?? entry);
    this.snapshots.delete(node.id);
    this.compactions.push({ node, seq: entries[entries.length - 1]?.seq ?? 0, at });
    this.changes++;
  }
  async compact(node: NodeRef, entries: readonly Entry[], at: number) { this.compactNow(node, entries, at); }
  purgeNow(node: NodeRef) {
    this.streams.delete(node.id);
    this.snapshots.delete(node.id);
    this.log = this.log.filter(entry => entry.node.id !== node.id);
    for (let i = this.compactions.length - 1; i >= 0; i--) if (this.compactions[i].node.id === node.id) this.compactions.splice(i, 1);
    this.changes++;
  }
  async purge(node: NodeRef) { this.purgeNow(node); }
  /** Every stored entry, in position order (tests). */
  allEntries(): readonly Entry[] { return this.log; }
}
