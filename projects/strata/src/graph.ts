/**
 * The graph: nodes as event streams, layering, batched commits with propagation to only the affected nodes, conflicts,
 * compensating undo, time views, compaction and purge, over a `GraphStore` and bound sources. Commits apply in memory
 * at once (the person's action is never kept waiting) and reach the store through an ordered outbox; until the store
 * acknowledges them they are `pending()`, which a host keeps as its recovery copy.
 */
import { canonical, equal, freeze, hash, isJson } from "./json";
import type { Json } from "./json";
import { constantId, kindAt, ownFromFields, valueProblem } from "./define";
import type { RuleDef, TypeDef, TypeSpec } from "./define";
import { diffStates, EMPTY_STATE, finish, fold, upcast } from "./fold";
import { covers, isTombstone, keyPath, pathKey } from "./paths";
import { layerOrder, Resolver } from "./resolve";
import type { StateReader } from "./resolve";
import { ReadModel, hasRefs } from "./model";
import type { DeriveResult, NodeSnapshot, Reference, Referrer } from "./model";
import { collapseInline as collapsePrimitive, entryKey, entryReferences, keepSet, nodeReferences, rollupDeltaStream, rollupValueStream } from "./compaction";
import type { KeepOptions, Stream } from "./compaction";
import { page as inspectorPage } from "./inspect";
import type { InspectorDetail, InspectorEdge, InspectorPage, InspectorRow } from "./inspect";
import type { GraphStore, AppendResult } from "./store";
import type { Sink, SinkDef, SourceDef, Sources } from "./sources";
import { resolveClaims, trustSelf } from "./trust";
import type { Claim, FramePolicies, TrustPolicy } from "./trust";
import { Aborter, onAbort } from "./kernel/abort";
import type { AbortSignalLike } from "./kernel/abort";
import { Environment, kernelInternals, KNode, LATEST, UNCHANGED } from "./kernel/kernel";
import type { Process, ProcessState, RunContext } from "./kernel/kernel";
import type {
  ChangeSet, CommitMeta, CommitResult, Conflict, Edit, Entry, EventRef, Layer, NodeChange, NodeId, NodeRef, NodeState, NodeType, Op,
  Origin, Path, PrimitiveOp, Provenance, Refusal, RefusalCode, Severity, Snapshot, Target, TimePoint,
} from "./types";

/** Test-only fault injection (exported from `strata/testing`): proves the harness finds and shrinks a propagation bug. */
export const STRATA_FAULTS: unique symbol = Symbol.for("strata.faults");
export type Faults = { readonly skipInvalidation?: (ref: NodeRef) => boolean };
/** Test-only access to internal state (exported from `strata/testing`): the standard invariants read it. */
export const STRATA_DEBUG: unique symbol = Symbol.for("strata.debug");

export interface GraphOptions {
  readonly types: readonly TypeDef[];
  readonly rules?: readonly RuleDef[];
  readonly sources: Sources;
  /** The store. Without one, the graph is session-only (every commit is acknowledged at once). */
  readonly store?: GraphStore;
  /**
   * This actor's ID (default `"local"`): the ID of the driver the graph runs as (one ID space for drivers and actors),
   * carried by every entry with the actor's own sequence number. It may name a collective (a composite actor).
   */
  readonly actor?: string;
  /** Members, when this actor is a collective or a union. */
  readonly members?: readonly string[];
  /** Trust per frame of reference (the local actor's own frame by default). */
  readonly trust?: TrustPolicy | FramePolicies;
  readonly sinks?: readonly { readonly def: SinkDef; readonly sink: Sink }[];
  /** Write a snapshot when a node's tail passes this many entries (default 200). */
  readonly snapshotEvery?: number;
  /** Write a snapshot when folding a node's tail at load took longer than this (default 5 ms). */
  readonly snapshotFoldMs?: number;
  /** Whether the graph writes snapshots to its store (default true); a read-only view, such as an inspector, says false. */
  readonly writeSnapshots?: boolean;
  /** Retry delay after a failed append (default 250 ms), and how long to wait for a reply (default 10 s). */
  readonly retryMs?: number;
  readonly replyTimeoutMs?: number;
  /** The graph's lifetime: aborting it stops the store driver and every process it started. */
  readonly signal?: AbortSignalLike;
  readonly [STRATA_FAULTS]?: Faults;
}

export type CommitOptions = {
  /** The history step's label (from the action that made it). */
  readonly label?: string;
  /** The Undo stack the commit joins (default `"default"`): a node's content history, or `"graph"` for wiring. */
  readonly scope?: string;
  /** The action kind, checked against blocking conflicts on every edited node. */
  readonly action?: string;
  /** Expected head seq of nodes the edit was made against; a mismatch refuses as `stale`. */
  readonly base?: Readonly<Record<NodeId, number>>;
  /** A belief: the entries record another actor's provenance. */
  readonly provenance?: Provenance;
};

/** A commit not yet acknowledged by the store: the host's recovery copy holds these. */
export type PendingCommit = {
  readonly commit: string; readonly entries: readonly Entry[]; readonly expect: readonly (readonly [NodeId, number])[];
  readonly label?: string; readonly scope?: string;
};
export type RejectedCommit = PendingCommit & { readonly reason: "stale" };

/** A read-only view of the whole graph at one point: a consistent cut. */
export interface GraphView {
  /** The position this view is at. */
  readonly position: number;
  read(ref: NodeRef): NodeSnapshot | undefined;
  resolve(ref: NodeRef, path?: Path): unknown;
  origin(ref: NodeRef, path: Path): Origin;
  exists(ref: NodeRef): boolean;
  list(type?: NodeType): readonly NodeRef[];
  references(ref: NodeRef): readonly Reference[];
  referrers(ref: NodeRef): readonly Referrer[];
  derive(ref: NodeRef, name: string): DeriveResult;
  /** Every rule evaluated on this view. */
  conflicts(): readonly Conflict[];
  issues(ref: NodeRef): readonly import("./types").Issue[];
}

type Rec = {
  ref: NodeRef; def: TypeDef; constant: boolean; session: boolean;
  /** The state before `entries` (null: from the start of the stream). */
  base: { seq: number; pos: number; state: NodeState | null };
  entries: Entry[];
  head: NodeState | null; headSeq: number; ackedSeq: number; snapshotSeq: number;
};
type CommitRecord = {
  id: string; scope: string; label?: string;
  touches: Map<string, { ref: NodeRef; first: number; last: number }>;
};
type Touch = "all" | Path[];
/** A layering combinator's output: the node's effective value and bookkeeping, and the change it reported. */
type EffectiveOut = {
  readonly exists: boolean; readonly name: string; readonly trashed: boolean; readonly layers: readonly Layer[];
  readonly value?: Readonly<Record<string, unknown>>; readonly change?: NodeChange;
};

const SOURCE_TYPE = "strata:source";
const refusal = (reason: RefusalCode, message: string, extra: Partial<Refusal> = {}): Refusal => ({ ok: false, reason, message, ...extra });
const BUSY = () => refusal("busy", "A change can't be committed while a cycle runs; commit it from a queued change instead.");
const refOf = (ref: NodeRef): NodeRef => ({ type: ref.type, id: ref.id });
const severityRank: Record<Severity, number> = { blocking: 3, warning: 2, notice: 1 };

class Refused extends Error { constructor(readonly refusal: Refusal) { super(refusal.message); } }
const refuse = (reason: RefusalCode, message: string, extra: Partial<Refusal> = {}): never => { throw new Refused(refusal(reason, message, extra)); };

export type Graph = StrataGraph;

/** Creates a graph from types, rules, sources and a store. Call `load()` before using a stored graph. */
export function createGraph(options: GraphOptions): Graph {
  return new StrataGraph(options);
}

export class StrataGraph implements GraphView {
  readonly actor: string;
  private readonly types = new Map<string, TypeDef>();
  private readonly rules: readonly RuleDef[];
  private readonly store?: GraphStore;
  private readonly sources: Sources;
  private readonly trustPolicy: FramePolicies;
  private readonly faults?: Faults;
  private readonly snapshotEvery: number;
  private readonly snapshotFoldMs: number;
  private readonly writeSnapshots: boolean;
  private readonly retryMs: number;
  private readonly replyTimeoutMs: number;

  private readonly records = new Map<string, Rec>();
  private readonly inlined = new Map<string, { ref: NodeRef; state: NodeState | null; host: EventRef }>();
  private readonly defaultsMemo = new Map<string, Readonly<Record<string, unknown>> | undefined>();
  private readonly head: ReadModel;
  private readonly timeModels = new Map<number, ReadModel>();
  /** Each in-memory commit's greatest position (filled on demand; forgotten with the time models). */
  private readonly commitEnds = new Map<string, number>();
  /** Nodes being collapsed into another entry: commits to them are refused (busy) until it is done. */
  private readonly collapsing = new Set<string>();
  /** Hosts a collapse is writing into, and nodes being purged: neither overlaps the other. */
  private readonly collapsingInto = new Set<string>();
  private readonly purging = new Set<string>();

  /** Reverse layer index: source id → dependent id → the dependent's layers on it (pinned included). */
  private readonly layerIndex = new Map<string, Map<string, Layer[]>>();
  /** Reverse reference index: target id → referrer id → references (effective values). Built on first need. */
  private readonly refIndex = new Map<string, Map<string, Reference[]>>();
  private readonly refsOut = new Map<string, Reference[]>();
  private refIndexReady = false;
  private readonly uniqueIndex = new Map<string, string>();

  private readonly conflictsById = new Map<string, Conflict>();
  private readonly producers = new Map<string, Set<string>>();
  private readonly produced = new Map<string, Set<string>>();
  private conflictsReady = false;
  private readonly acknowledgements = new Map<string, string>();

  private readonly commits = new Map<string, CommitRecord>();
  private readonly undoStacks = new Map<string, string[]>();
  private readonly redoStacks = new Map<string, string[]>();
  private outbox: PendingCommit[] = [];
  private rejectedCommits: RejectedCommit[] = [];
  private readonly ackedCommits = new Set<string>();
  private inflight: number | null = null;
  private token = 0;
  private retrying = false;
  private flushWaiters: (() => void)[] = [];
  /** The kernel environment this graph runs in (SPEC §11.1). */
  readonly env: Environment;
  private readonly entitySeeds = new Map<string, KNode>();
  private readonly effectiveNodes = new Map<string, KNode<EffectiveOut>>();
  /** Observed with each batch (commit, cause, bookkeeping), in the same cycle as the touched nodes' seeds. */
  private readonly batchSeed: KNode;
  /** Each assembled change set: what `subscribeAll` demands. */
  private readonly commitsSeed: KNode;
  /** The pending commits (the recovery copy) whenever they change. */
  private readonly pendingSeed: KNode;
  private reports: NodeChange[] = [];
  /** The change sets an emit is waiting for (its cycle runs at once), by commit; filled in by `onCycle`. */
  private readonly assembled = new Map<string, ChangeSet | undefined>();
  private allDemand: Aborter | null = null;
  private allSubscribers = 0;
  /** The store driver's run: appends, loads and snapshots are its child processes (SPEC §19.5). */
  private storeRun?: RunContext;
  readonly storeProcess?: Process;
  /** The actor's observable activity: the process of the driver this graph runs as. */
  readonly actorProcess: Process;
  private readonly sinks: readonly { readonly def: SinkDef; readonly sink: Sink }[];
  private headPos = 0;
  /** The greatest position the store has acknowledged or reported (pending entries are kept above it). */
  private storeHead = 0;
  /**
   * The position up to which this graph has read what other windows committed: `sync` reads after it. Only a load or
   * a sync moves it, never the acknowledgement of this graph's own append, since other windows' entries can hold
   * positions below an acknowledged one that this graph hasn't read yet.
   */
  private readPos = 0;
  private actorSeq = 0;
  private loaded = false;
  private snapshotQueue: Promise<void> = Promise.resolve();
  /** Nodes whose tail took long to fold at load: snapshot them after loading. */
  private slowFolds = new Set<string>();

  constructor(options: GraphOptions) {
    this.actor = options.actor ?? "local";
    this.sources = options.sources;
    if (!options.sources?.clock || !options.sources?.random) throw new Error("A graph needs clock and random sources.");
    this.store = options.store;
    this.rules = options.rules ?? [];
    const trust = options.trust ?? trustSelf(this.actor);
    this.trustPolicy = typeof trust === "function" ? trust : () => trust;
    this.faults = options[STRATA_FAULTS];
    this.sinks = options.sinks ?? [];
    this.snapshotEvery = options.snapshotEvery ?? 200;
    this.snapshotFoldMs = options.snapshotFoldMs ?? 5;
    this.writeSnapshots = options.writeSnapshots ?? true;
    this.retryMs = options.retryMs ?? 250;
    this.replyTimeoutMs = options.replyTimeoutMs ?? 10_000;
    const sourceType: TypeDef = Object.freeze({ kind: "strata/type" as const, type: SOURCE_TYPE, owner: "strata", schema: "1",
      stream: "value" as const, persistence: "session" as const, fields: { value: { kind: "value" as const } } });
    for (const def of [...options.types, sourceType]) {
      if (this.types.has(def.type)) throw new Error(`Type ${def.type} is registered twice.`);
      this.types.set(def.type, def);
    }
    const ruleIds = new Set<string>();
    for (const rule of this.rules) {
      if (ruleIds.has(rule.id)) throw new Error(`Rule ${rule.id} is registered twice.`);
      ruleIds.add(rule.id);
    }
    for (const def of this.types.values()) for (const constant of def.constants ?? []) {
      const ref = { type: def.type, id: constantId(def.type, constant.name) };
      const state = freeze({ ...EMPTY_STATE, name: constant.label, own: ownFromFields(def, constant.fields) });
      this.records.set(ref.id, { ref, def, constant: true, session: false, base: { seq: 0, pos: 0, state }, entries: [], head: state,
        headSeq: 0, ackedSeq: 0, snapshotSeq: 0 });
    }
    this.head = new ReadModel(this.headReader, () => this.liveRefs(), ref => this.metaOf(ref));
    // The head's referrers come from the index.
    this.head.referrers = ref => this.referrers(ref);
    this.env = new Environment({ clock: this.sources.clock, onCycle: () => this.onCycle() });
    this.batchSeed = this.env.seed({ id: "graph:batches", name: "batches" });
    this.commitsSeed = this.env.seed({ id: "graph:commits", name: "commits" });
    this.pendingSeed = this.env.seed({ id: "graph:pending", name: "pending", initial: [] });
    // The graph runs as its actor's driver; the store is a child driver in the role "store" (SPEC §9.7, §19.5).
    let storeProcess: Process | undefined;
    const actor = this.env.driver({ name: `actor ${this.actor}`, ...(options.members ? { members: options.members } : {}), start: run => {
      if (!this.store) return;
      const store = this.env.driver({ name: "store", start: storeRun => {
        this.storeRun = storeRun;
        // A stopped graph answers no more: whoever waits for a flush is released.
        storeRun.signal.addEventListener("abort", () => this.resolveFlush(), { once: true });
      } }, `${this.actor}/store`);
      storeProcess = run.start(store, { role: "store" });
    } }, this.actor);
    this.actorProcess = actor.start(options.signal);
    this.storeProcess = storeProcess;
    if (!this.store) this.loaded = true;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------------------------------------------

  private readonly headReader: StateReader = {
    state: ref => this.headState(ref),
    def: type => this.types.get(type),
    pinned: layer => this.pinnedModel(layer)?.resolver ?? null,
    defaults: type => this.defaultsOf(type),
  };

  private headState(ref: NodeRef): NodeState | null {
    const rec = this.records.get(ref.id);
    if (rec) return rec.ref.type === ref.type && rec.head && !rec.head.retracted ? rec.head : null;
    const inlined = this.inlined.get(ref.id);
    return inlined && inlined.ref.type === ref.type && inlined.state && !inlined.state.retracted ? inlined.state : null;
  }

  private defaultsOf(type: string): Readonly<Record<string, unknown>> | undefined {
    if (!this.defaultsMemo.has(type)) this.defaultsMemo.set(type, freeze(this.types.get(type)?.defaults?.()));
    return this.defaultsMemo.get(type);
  }

  private *liveRefs(): Iterable<NodeRef> { for (const rec of this.records.values()) yield rec.ref; }
  private metaOf(ref: NodeRef) { const rec = this.records.get(ref.id); return { seq: rec?.headSeq ?? 0, constant: !!rec?.constant }; }

  get position(): number { return this.headPos; }
  /** Whether the node exists now (not retracted; trashed nodes exist). */
  exists(ref: NodeRef): boolean { return this.head.exists(ref); }
  /** The node's detached snapshot: name, seq, own values, layers and effective value. */
  read(ref: NodeRef): NodeSnapshot | undefined { return this.head.read(ref); }
  /** The effective value at a path (a map path as an object of its keys), or the node's whole effective value. */
  resolve(ref: NodeRef, path?: Path): unknown { return this.head.resolve(ref, path); }
  /** Where the value at a leaf path comes from: own, a feed, the base (and whose own value it is), the default, or absent. */
  origin(ref: NodeRef, path: Path): Origin { return this.head.resolver.leaf(ref, path).origin; }
  /** Every node that exists now, of one type or all, constants included. */
  list(type?: NodeType): readonly NodeRef[] { return this.head.nodes(type); }
  references(ref: NodeRef): readonly Reference[] { return this.head.references(ref); }
  referrers(ref: NodeRef): readonly Referrer[] {
    this.ensureRefIndex();
    const out: Referrer[] = [];
    for (const [id, refs] of this.refIndex.get(ref.id) ?? []) {
      const rec = this.records.get(id);
      if (rec) for (const item of refs) if (item.target.type === ref.type) out.push({ node: rec.ref, path: item.path, follows: item.follows });
    }
    return out;
  }
  /** A derived value of the type's `derive` table, memoised until something it can see changes. */
  derive(ref: NodeRef, name: string): DeriveResult { return this.head.derive(ref, name); }
  /** Validation findings on the node's effective value. */
  issues(ref: NodeRef) {
    const def = this.types.get(ref.type), value = this.head.resolver.effective(ref);
    return def?.validate && value ? def.validate(value) : [];
  }
  /** The head seq of a node (0 when it doesn't exist). */
  seqOf(ref: NodeRef): number { return this.records.get(ref.id)?.headSeq ?? 0; }
  /** The type definition registered for a type. */
  typeOf(type: NodeType): TypeSpec | undefined { return this.types.get(type); }
  /** The bound adapter of a declared source. */
  source<T>(def: SourceDef<T>): T {
    const bound = this.sources[def.name];
    if (bound === undefined) throw new Error(`Source ${def.name} is not bound.`);
    return bound as T;
  }
  /**
   * Resolves a fact from several actors' claims with the trust policy of a frame of reference (this actor's own frame
   * by default). There is no global truth; `read` and `resolve` are this actor's perceived world.
   */
  trust(factKind: string, claims: readonly Claim[], frame = this.actor) { return resolveClaims(factKind, claims, this.trustPolicy(frame), frame); }
  /** The frame of reference this graph's values are in: the local actor's own. */
  get frame(): string { return this.actor; }

  // -------------------------------------------------------------------------------------------------------------
  // Loading, history and time
  // -------------------------------------------------------------------------------------------------------------

  /** Loads every node from its latest snapshot plus tail. */
  async load(): Promise<{ readonly nodes: number; readonly entries: number; readonly foldMs: number }> {
    if (!this.store) return { nodes: 0, entries: 0, foldMs: 0 };
    const clock = this.sources.clock;
    const store = this.store;
    const stored = await this.storeTask("load", () => store.load());
    const started = clock.monotonic();
    let entries = 0;
    const refetch: NodeRef[] = [];
    for (const node of stored.nodes) {
      const def = this.types.get(node.ref.type);
      if (!def) continue;   // a newer build's type: kept in the store, invisible here (E1)
      if (node.snapshot && node.snapshot.schema !== def.schema) { refetch.push(node.ref); continue; }
      const t0 = clock.monotonic();
      this.installRecord(node.ref, def, node.snapshot, node.tail);
      if (clock.monotonic() - t0 > this.snapshotFoldMs) this.slowFolds.add(node.ref.id);
      entries += node.tail.length;
    }
    for (const ref of refetch) {
      const all = await this.storeTask("read", () => store.readStream(ref));
      this.installRecord(ref, this.types.get(ref.type)!, undefined, all);
      entries += all.length;
      // Its snapshot couldn't be used: write one that can, so the next load doesn't fold the whole stream again.
      this.slowFolds.add(ref.id);
    }
    this.storeHead = Math.max(this.storeHead, stored.head);
    this.readPos = Math.max(this.readPos, stored.head);
    this.headPos = Math.max(this.headPos, stored.head);
    const foldMs = clock.monotonic() - started;
    await this.loadPinnedHistory();
    this.loaded = true;
    for (const id of this.slowFolds) { const rec = this.records.get(id); if (rec) this.writeSnapshot(rec); }
    this.slowFolds.clear();
    for (const rec of this.records.values()) if (!rec.constant && rec.ackedSeq - rec.snapshotSeq >= this.snapshotEvery) this.writeSnapshot(rec);
    return { nodes: this.records.size, entries, foldMs };
  }

  private installRecord(ref: NodeRef, def: TypeDef, snapshot: Snapshot | undefined, tail: readonly Entry[]): void {
    const base = snapshot ? { seq: snapshot.seq, pos: snapshot.pos, state: snapshot.state } : { seq: 0, pos: 0, state: null };
    const entries = [...tail].sort((a, b) => a.seq - b.seq);
    const head = fold(base.state, entries, def);
    const headSeq = entries.length ? entries[entries.length - 1].seq : base.seq;
    const previous = this.records.get(ref.id);
    const rec: Rec = { ref: refOf(ref), def, constant: false, session: false, base, entries, head, headSeq, ackedSeq: headSeq,
      snapshotSeq: snapshot?.seq ?? 0 };
    this.records.set(ref.id, rec);
    this.indexLayers(ref.id, previous?.head ?? null, head);
    this.indexUnique(rec, previous?.head ?? null, head);
    for (const entry of entries) if (entry.pos > this.headPos) this.headPos = entry.pos;
    // Streams collapsed into this one's entries (it loads whole while it holds any: no snapshot stands in for them).
    for (const [id, item] of this.inlined) if (item.host.node.id === ref.id) { this.inlined.delete(id); this.indexLayers(id, item.state, null); }
    for (const entry of entries) for (const inner of entry.inlined ?? []) {
      const innerDef = this.types.get(inner.node.type);
      if (!innerDef) continue;
      const state = fold(null, inner.entries, innerDef);
      this.inlined.set(inner.node.id, { ref: refOf(inner.node), state, host: { node: rec.ref, seq: entry.seq } });
      // It still reads through its layers: changes to its sources reach it and its dependents.
      this.indexLayers(inner.node.id, null, state);
    }
  }

  /** Pinned layers read their source as it was: make sure that history is in memory. */
  private async loadPinnedHistory(): Promise<void> {
    // Everything read at the head, and through each pin at its own point: the pinned source and its own layers then.
    await this.loadReachable([...this.records.values()].map(rec => [rec.ref.id, this.headPos]));
  }

  /**
   * Loads the history that reading these nodes at these points needs: each node's stream back to the point, and the
   * same for every layer source its state then names (a pinned layer at the pinned entry's point).
   */
  private async loadReachable(queue: [string, number][]): Promise<void> {
    const seen = new Set<string>();
    while (queue.length) {
      const [id, at] = queue.pop()!;
      const key = `${id}@${at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const rec = this.records.get(id);
      if (!rec) continue;
      if (rec.base.seq > 0 && rec.base.pos > at) await this.loadHistory(rec.ref);
      const state = this.stateAt(rec, at);
      for (const layer of state?.layers ?? []) {
        if (layer.at && this.pointOf(layer.at) === undefined) await this.loadHistory(layer.at.node);
        queue.push([layer.from.id, layer.at ? this.pointOf(layer.at) ?? at : at]);
      }
    }
  }

  /** Whether reading a node at a point needs no history that isn't in memory (its layers', at that point, included). */
  private historyAt(id: string, at: number, seen = new Set<string>()): boolean {
    const key = `${id}@${at}`;
    if (seen.has(key)) return true;
    seen.add(key);
    const rec = this.records.get(id);
    if (!rec) return true;
    if (rec.base.seq > 0 && rec.base.pos > at) return false;
    for (const layer of this.stateAt(rec, at)?.layers ?? []) {
      const pos = layer.at ? this.pointOf(layer.at) : at;
      if (pos === undefined || !this.historyAt(layer.from.id, pos, seen)) return false;
    }
    return true;
  }

  /** Loads a node's whole stored stream into memory (its history, before the snapshot it loaded from). */
  async loadHistory(ref: NodeRef): Promise<void> {
    const rec = this.records.get(ref.id);
    if (!rec || rec.constant || rec.session || rec.base.state === null && rec.base.seq === 0) return;
    if (!this.store) return;
    const store = this.store;
    const stored = await this.storeTask("history", () => store.readStream(ref));
    const current = this.records.get(ref.id);
    if (!current || current !== rec) return;
    // Only what it lacks before its base: entries past what it holds (another window's, not yet caught up with) come
    // with a sync, which applies them.
    rec.entries = [...stored.filter(entry => entry.seq <= rec.base.seq), ...rec.entries.filter(entry => entry.seq > rec.base.seq)];
    rec.base = { seq: 0, pos: 0, state: null };
    this.forgetTimes();
    // A pin that read nothing for want of this history reads its point now.
    this.refreshPinned(`history:${ref.id}`);
  }

  /** A node's stream: every entry, loaded from the store as needed. */
  async history(ref: NodeRef): Promise<readonly Entry[]> {
    await this.loadHistory(ref);
    return [...(this.records.get(ref.id)?.entries ?? [])];
  }

  /** A node's entries after entry `seq` (a cursor for re-engaging observers). */
  async after(ref: NodeRef, seq: number): Promise<readonly Entry[]> {
    const rec = this.records.get(ref.id);
    if (rec && rec.base.seq <= seq) return rec.entries.filter(entry => entry.seq > seq);
    return (await this.history(ref)).filter(entry => entry.seq > seq);
  }

  /** The position of an entry, if its history is in memory. */
  posOf(ref: EventRef): number | undefined {
    const rec = this.records.get(ref.node.id);
    if (!rec) return undefined;
    if (rec.constant) return 0;
    if (ref.seq === rec.base.seq && rec.base.seq > 0) return rec.base.pos;
    return entryAt(rec.entries, ref.seq)?.pos;
  }

  /**
   * The point an entry names, if its history is in memory: the greatest position of its commit. A commit is atomic,
   * so nothing reads between its entries: a pin or a view at an entry sees the whole commit it belongs to.
   */
  private pointOf(ref: EventRef): number | undefined {
    const rec = this.records.get(ref.node.id);
    if (!rec) return undefined;
    if (rec.constant) return 0;
    const entry = entryAt(rec.entries, ref.seq);
    if (!entry) return undefined;
    if (!this.commitEnds.has(entry.commit)) {
      this.commitEnds.clear();
      const note = (item: Entry) => { if (item.pos > (this.commitEnds.get(item.commit) ?? -1)) this.commitEnds.set(item.commit, item.pos); };
      for (const other of this.records.values()) for (const item of other.entries) {
        note(item);
        for (const inner of item.inlined ?? []) inner.entries.forEach(note);
      }
    }
    return this.commitEnds.get(entry.commit)!;
  }

  private toPos(point: TimePoint): number {
    if (point === "head") return this.headPos;
    if (typeof point === "number") return point;
    if ("commit" in point) {
      let pos = -1;
      for (const rec of this.records.values()) for (const entry of rec.entries) if (entry.commit === point.commit) pos = Math.max(pos, entry.pos);
      if (pos < 0) throw new Error("That commit isn't in memory.");
      return pos;
    }
    const pos = this.pointOf(point);
    if (pos === undefined) throw new Error("That entry isn't in memory; load its history first.");
    return pos;
  }

  /** A node's state at a position: its head, a fold of its loaded entries, or undefined when that history isn't loaded. */
  /** Positions or the entries in memory changed: points and the views at them are worked out again. */
  private forgetTimes(): void {
    this.timeModels.clear();
    this.commitEnds.clear();
  }

  private stateAt(rec: Rec, pos: number): NodeState | null | undefined {
    if (rec.constant) return rec.head;
    const last = rec.entries[rec.entries.length - 1];
    if (last ? last.pos <= pos : rec.base.pos <= pos) return rec.head;
    if (rec.base.seq > 0 && rec.base.pos > pos) return undefined;
    const upto: Entry[] = [];
    for (const entry of rec.entries) { if (entry.pos > pos) break; upto.push(entry); }
    return fold(rec.base.state, upto, rec.def);
  }

  private modelAt(pos: number): ReadModel {
    if (pos >= this.headPos) return this.head;
    let model = this.timeModels.get(pos);
    if (model) return model;
    const states = new Map<string, NodeState | null>();
    const reader: StateReader = {
      state: ref => {
        const rec = this.records.get(ref.id);
        if (!rec) {
          // A collapsed node reads from its host entry's copy of its stream, at this point as at the head.
          const item = this.inlined.get(ref.id);
          if (!item || item.ref.type !== ref.type) return null;
          if (!states.has(ref.id)) states.set(ref.id, fold(null, (this.inlinedStream(ref.id) ?? []).filter(entry => entry.pos <= pos), this.types.get(ref.type)));
        } else if (rec.ref.type !== ref.type) return null;
        else if (!states.has(ref.id)) states.set(ref.id, this.stateAt(rec, pos) ?? null);
        const state = states.get(ref.id)!;
        return state && !state.retracted ? state : null;
      },
      def: type => this.types.get(type),
      pinned: layer => this.pinnedModel(layer)?.resolver ?? null,
      defaults: type => this.defaultsOf(type),
    };
    model = new ReadModel(reader, () => this.liveRefs(), ref => {
      const rec = this.records.get(ref.id);
      let seq = 0;
      if (rec) for (const entry of rec.entries) if (entry.pos <= pos) seq = entry.seq;
      return { seq: rec && rec.base.pos <= pos ? Math.max(seq, rec.base.seq) : seq, constant: !!rec?.constant };
    });
    if (this.timeModels.size >= 16) this.timeModels.delete(this.timeModels.keys().next().value!);
    this.timeModels.set(pos, model);
    return model;
  }

  private pinnedModel(layer: Layer): ReadModel | null {
    if (!layer.at) return this.head;
    const pos = this.pointOf(layer.at);
    return pos === undefined ? null : this.modelAt(pos);
  }

  /**
   * A read-only view of the whole graph at a point: every stream folded to it, each pinned layer read at its own
   * point. Loads the history the view needs (only the nodes reachable from `roots`, when given).
   */
  async at(point: TimePoint, roots?: readonly NodeRef[]): Promise<GraphView> {
    if (typeof point === "object" && "node" in point && this.pointOf(point) === undefined) await this.loadHistory(point.node);
    let pos = this.toPos(point);
    await this.loadReachable((roots ?? [...this.records.values()].map(rec => rec.ref)).map(ref => [ref.id, pos]));
    if (typeof point !== "number" && point !== "head") pos = this.toPos(point);
    return this.viewOf(this.modelAt(pos), pos);
  }

  private viewOf(model: ReadModel, position: number): GraphView {
    return {
      position,
      read: ref => model.read(ref), resolve: (ref, path) => model.resolve(ref, path), origin: (ref, path) => model.resolver.leaf(ref, path).origin,
      exists: ref => model.exists(ref), list: type => model.nodes(type), references: ref => model.references(ref),
      referrers: ref => model === this.head ? this.referrers(ref) : model.referrers(ref), derive: (ref, name) => model.derive(ref, name),
      conflicts: () => model === this.head ? this.conflicts() : this.evaluateAll(model),
      issues: ref => { const def = this.types.get(ref.type), value = model.resolver.effective(ref); return def?.validate && value ? def.validate(value) : []; },
    };
  }

  /** Entries with positions in (from, to], in position order, loading history as needed. */
  async range(from: number, to: number): Promise<readonly Entry[]> {
    for (const rec of this.records.values()) if (rec.base.seq > 0 && rec.base.pos > from) await this.loadHistory(rec.ref);
    const out: Entry[] = [];
    for (const rec of this.records.values()) for (const entry of rec.entries) if (entry.pos > from && entry.pos <= to) out.push(entry);
    return out.sort((a, b) => a.pos - b.pos);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Committing
  // -------------------------------------------------------------------------------------------------------------

  /** Applies a batch of edits as one commit: in memory at once, then to the store in order. */
  commit(edits: readonly Edit[], options: CommitOptions = {}): CommitResult {
    return this.commitInternal(edits, options, "commit");
  }

  private commitInternal(edits: readonly Edit[], options: CommitOptions, cause: ChangeSet["cause"],
    check?: () => Refusal | null): CommitResult {
    if (!this.loaded) return refusal("unloaded", "The graph hasn't loaded yet.");
    if (this.env.inCycle) return BUSY();
    if (!edits.length) return refusal("empty", "Nothing to change.");
    let work: Working;
    try { work = this.build(edits, options); }
    catch (error) { if (error instanceof Refused) return error.refusal; throw error; }
    if (!work.order.length) return refusal("empty", "Nothing changed.");
    return this.applyWork(work, options, cause, check);
  }

  private applyWork(work: Working, options: CommitOptions, cause: ChangeSet["cause"], check?: () => Refusal | null, track = true): CommitResult {
    // Refused before anything is taken: no commit ID, position or actor counter is used by a refused commit (§17.1).
    if (this.env.inCycle) return BUSY();
    const compacting = this.compactingConflict(work) ?? this.collapsingConflict(work);
    if (compacting) return compacting;
    if (work.order.some(id => this.collapsing.has(id))) return refusal("busy", "That is being moved into the entry that refers to it.");
    const cycle = this.layerCycle(work);
    if (cycle) return cycle;
    const commitId = this.sources.random.stream("commits").uuid(), at = this.sources.clock.now();
    // A commit refused after it was applied (a fix adding a blocking conflict) gives back its positions and counters.
    const startPos = this.headPos, startActorSeq = this.actorSeq;
    const groups = new Map<string, { ref: NodeRef; def: TypeDef; entries: Entry[] }>();
    const basis: [NodeId, number][] = [];
    let first = true;
    for (const id of work.order) {
      const ref = work.refs.get(id)!, def = this.types.get(ref.type)!, rec = this.records.get(id);
      let seq = rec?.headSeq ?? 0;
      basis.push([id, seq]);
      let ops = work.ops.get(id)!;
      if (def.stream === "value" && ops.length) {
        const state = work.states.get(id)!;
        ops = [!rec ? { kind: "create", state: state ?? EMPTY_STATE } : { kind: "state", state: state ?? EMPTY_STATE }];
      }
      const entries: Entry[] = [];
      for (const op of ops) {
        entries.push(freeze({
          node: refOf(ref), seq: ++seq, pos: ++this.headPos, commit: commitId, actor: options.provenance?.actor ?? this.actor,
          actorSeq: options.provenance?.actorSeq ?? ++this.actorSeq, at: options.provenance?.at ?? at, schema: def.schema, op,
          ...(options.provenance ? { provenance: options.provenance } : {}),
          ...(first ? { meta: { ...(options.label ? { label: options.label } : {}), basis: [] as [NodeId, number][], ...(options.scope ? { scope: options.scope } : {}) } } : {}),
        } as Entry));
        first = false;
      }
      groups.set(id, { ref, def, entries });
    }
    // The first entry's meta carries the whole basis.
    const firstGroup = groups.get(work.order[0])!;
    const meta: CommitMeta = { ...firstGroup.entries[0].meta, basis };
    firstGroup.entries[0] = freeze({ ...firstGroup.entries[0], meta });

    const saved = { ...this.saveRecords(groups.keys()), headPos: startPos, actorSeq: startActorSeq };
    const conflictsBefore = check ? new Set([...this.blockingConflicts()].map(item => item.id)) : null;
    const before = this.applyGroups(groups, cause);
    if (check) {
      const problem = check() ?? this.newBlocking(conflictsBefore!);
      if (problem) {
        this.restoreRecords(saved, groups);
        return problem;
      }
    }
    const scope = options.scope ?? "default";
    if (track) {
      const record: CommitRecord = { id: commitId, scope, label: options.label, touches: new Map() };
      for (const [id, group] of groups) record.touches.set(id, { ref: group.ref, first: group.entries[0].seq, last: group.entries[group.entries.length - 1].seq });
      this.commits.set(commitId, record);
      if (cause === "commit" || cause === "fix") {
        this.stack(this.undoStacks, scope).push(commitId);
        // A new commit ends the scope's Redo history: its records go with it.
        for (const id of this.redoStacks.get(scope) ?? []) this.commits.delete(id);
        this.redoStacks.set(scope, []);
      }
    }
    const persistent = [...groups.values()].filter(group => !this.records.get(group.ref.id)!.session);
    if (persistent.length && !this.store) {
      // A session-only graph: nothing to wait for.
      this.ackedCommits.add(commitId);
      for (const group of persistent) { const rec = this.records.get(group.ref.id)!; rec.ackedSeq = rec.headSeq; }
    } else if (persistent.length) {
      const entries = persistent.flatMap(group => group.entries);
      const expect = persistent.map(group => [group.ref.id, group.entries[0].seq - 1] as const);
      this.outbox.push({ commit: commitId, entries, expect, ...(options.label ? { label: options.label } : {}), scope });
      this.notifyPending();
      this.pump();
    } else this.ackedCommits.add(commitId);
    this.deliverSession(groups);
    const set = this.emit(before, cause, commitId, options.label);
    return { ok: true, commit: commitId, changes: set, created: Object.fromEntries(work.created) };
  }

  private stack(stacks: Map<string, string[]>, scope: string): string[] {
    let stack = stacks.get(scope);
    if (!stack) stacks.set(scope, stack = []);
    return stack;
  }

  // ---- building a commit ----

  private build(edits: readonly Edit[], options: CommitOptions): Working {
    const work = new Working(this);
    for (const edit of edits) this.buildEdit(work, edit);
    // Unique fields among live nodes of the type.
    for (const id of work.order) {
      const ref = work.refs.get(id)!, def = this.types.get(ref.type)!, state = work.state(ref);
      if (!state) continue;
      for (const [field, spec] of Object.entries(def.fields)) {
        if (!spec.unique) continue;
        const value = state.own[pathKey([field])];
        if (value === undefined || value === null) continue;
        const holder = this.uniqueIndex.get(`${ref.type}\u0000${field}\u0000${canonical(value)}`);
        const clash = holder && holder !== id && !work.order.includes(holder) ? holder
          : work.order.find(other => other !== id && work.refs.get(other)!.type === ref.type && equal(work.state(work.refs.get(other)!)?.own[pathKey([field])], value));
        if (clash) refuse("unique", `Another ${ref.type} already uses that ${field}.`);
      }
    }
    for (const [id, seq] of Object.entries(options.base ?? {})) {
      if ((this.records.get(id)?.headSeq ?? 0) !== seq) refuse("stale", "This changed in another window or another step since it was read.");
    }
    if (options.action) {
      for (const id of work.order) {
        const blocking = this.blockingFor(work.refs.get(id)!, options.action);
        if (blocking) refuse("conflict", blocking.sentence, { conflict: blocking });
      }
    }
    return work;
  }

  private target(work: Working, target: Target): NodeRef {
    if ("created" in target) {
      const ref = work.created.get(target.created);
      if (!ref) refuse("missing", `No node was created as "${target.created}" earlier in this change.`);
      return ref!;
    }
    if (!target || typeof target.id !== "string" || typeof target.type !== "string") refuse("missing", "Name the node to change.");
    if (!this.types.has(target.type)) refuse("type", `${target.type} isn't a registered type.`);
    return refOf(target);
  }

  /** Whether a new node can't take this ID: a node holds it (a collapsed one included), or this change made one. */
  private taken(work: Working, id: string): boolean {
    return this.records.has(id) || this.inlined.has(id) || work.refs.has(id);
  }

  private editable(work: Working, target: Target): { ref: NodeRef; def: TypeDef; state: NodeState } {
    const ref = this.target(work, target);
    const rec = this.records.get(ref.id);
    if (rec?.constant) refuse("constant", "That is a built-in starting point; fork or clone it to change it.");
    // A collapsed node reads from its host entry's copy: an edit would start a stream without its history.
    if (!rec && this.inlined.has(ref.id)) refuse("constant", "That is kept inside another node's entry now; fork or clone it to change it.");
    const state = work.state(ref);
    if (!state) refuse("missing", "That no longer exists.");
    return { ref, def: this.types.get(ref.type)!, state: state! };
  }

  private leafPath(def: TypeSpec, path: Path, what: string) {
    const at = Array.isArray(path) && path.every(part => typeof part === "string") ? kindAt(def, path) : null;
    if (!at || !at.leaf) refuse("path", `${def.type} has no ${what} ${JSON.stringify(path)}.`);
    return at!;
  }

  private buildEdit(work: Working, edit: Edit): void {
    switch (edit.op) {
      case "create": return this.buildCreate(work, edit);
      case "import": {
        const def = this.types.get(edit.type) ?? refuse("type", `${edit.type} isn't a registered type.`);
        if (this.taken(work, edit.id)) refuse("exists", "A node with that ID already exists.");
        if (!isJson(edit.source)) refuse("value", "The import's source record must be plain data.");
        const own = this.ownOf(def, edit.fields ?? {});
        const ref = { type: def.type, id: edit.id };
        work.push(ref, { kind: "import", state: freeze({ ...EMPTY_STATE, name: edit.name, own }), source: edit.source });
        return;
      }
      case "set": {
        const { ref, def } = this.editable(work, edit.node);
        const at = this.leafPath(def, edit.path, "field");
        const value = this.withCreated(work, edit.value);
        const problem = valueProblem(at.kind, value);
        if (problem) refuse("value", `${pathKey(edit.path)} must be ${problem}.`);
        work.push(ref, { kind: "set", path: [...edit.path], value: freeze(value as Json) });
        return;
      }
      case "reset": {
        const { ref, def } = this.editable(work, edit.node);
        this.leafPath(def, edit.path, "field");
        work.push(ref, { kind: "reset", path: [...edit.path] });
        return;
      }
      case "tombstone": {
        const { ref, def } = this.editable(work, edit.node);
        this.leafPath(def, edit.path, "map key");
        if (edit.path.length < 2) refuse("path", "Only a map key can be removed here; reset a field instead.");
        work.push(ref, { kind: "tombstone", path: [...edit.path] });
        return;
      }
      case "layers": {
        const { ref, def } = this.editable(work, edit.node);
        work.push(ref, { kind: "layers", layers: this.checkLayers(work, ref, def, edit.layers) });
        return;
      }
      case "feed": {
        const { ref, def, state } = this.editable(work, edit.node);
        const layer: Layer = { from: refOf(edit.from), role: "feed", paths: edit.paths, ...(edit.at ? { at: { node: refOf(edit.from), seq: edit.at } } : {}) };
        const layers = [...state.layers.filter(item => !(item.role === "feed" && item.from.id === edit.from.id)), layer];
        work.push(ref, { kind: "layers", layers: this.checkLayers(work, ref, def, layers) });
        return;
      }
      case "rebase": {
        const { ref, def, state } = this.editable(work, edit.node);
        const base: Layer = { from: refOf(edit.base), role: "base", paths: "*", ...(edit.at ? { at: { node: refOf(edit.base), seq: edit.at } } : {}) };
        work.push(ref, { kind: "layers", layers: this.checkLayers(work, ref, def, [...state.layers.filter(item => item.role !== "base"), base]) });
        return;
      }
      case "rename": {
        const { ref } = this.editable(work, edit.node);
        if (typeof edit.name !== "string") refuse("value", "A name is text.");
        work.push(ref, { kind: "rename", name: edit.name });
        return;
      }
      case "trash": case "restore": {
        const { ref, state } = this.editable(work, edit.node);
        if (state.trashed !== (edit.op === "trash")) work.push(ref, { kind: edit.op });
        return;
      }
      case "detach": {
        const { ref } = this.editable(work, edit.node);
        const resolver = work.resolver();
        for (const path of resolver.leafPaths(ref)) {
          const found = resolver.leaf(ref, path);
          if (found.origin.via === "feed" || found.origin.via === "base") work.push(ref, { kind: "set", path, value: found.value! });
        }
        work.push(ref, { kind: "layers", layers: [] });
        return;
      }
      case "applyToSource": {
        const { ref, def, state } = this.editable(work, edit.node);
        this.leafPath(def, edit.path, "field");
        const value = state.own[pathKey(edit.path)];
        if (value === undefined || isTombstone(value)) refuse("path", "This value isn't set here, so there is nothing to apply.");
        const resolver = work.resolver();
        const candidates = layerOrder(state.layers).filter(layer => layer.role === "base" || covers(layer.paths, edit.path));
        const layer = candidates.find(item => resolver.leaf(item.from, edit.path).has) ?? candidates[0];
        if (!layer) refuse("no-source", "Nothing here takes this value from another node.");
        if (layer!.at) refuse("pinned", "That source is pinned to an earlier version, which can't change.");
        const source = this.editable(work, layer!.from);
        work.push(source.ref, { kind: "set", path: [...edit.path], value: value! });
        work.push(ref, { kind: "reset", path: [...edit.path] });
        return;
      }
      case "revert": {
        const { ref, state } = this.editable(work, edit.node);
        const rec = this.records.get(ref.id);
        if (!rec || !Number.isSafeInteger(edit.to) || edit.to < 1 || edit.to > rec.headSeq) refuse("missing", "That version doesn't exist.");
        if (rec!.base.seq > edit.to) refuse("unloaded", "Load this node's history first.");
        const target = fold(rec!.base.state, rec!.entries.filter(entry => entry.seq <= edit.to), rec!.def);
        if (!target) refuse("missing", "The node didn't exist at that version.");
        const ops = diffStates(state, { ...target!, retracted: false });
        if (ops.length) work.push(ref, { kind: "revert", to: { node: ref, seq: edit.to }, ops });
        return;
      }
      case "tag": {
        const { ref } = this.editable(work, edit.node);
        const entries = edit.entries ?? [{ node: ref, seq: work.seqOf(ref) }];
        if (!entries.every(item => item && item.node && Number.isSafeInteger(item.seq) && item.seq >= 1)) refuse("value", "A tag names entries.");
        if (typeof edit.label !== "string") refuse("value", "A tag has a label.");
        work.push(ref, { kind: "tag", label: edit.label, entries: entries.map(item => ({ node: refOf(item.node), seq: item.seq })) });
        return;
      }
      case "untag": {
        const { ref } = this.editable(work, edit.node);
        work.push(ref, { kind: "untag", tag: edit.tag });
        return;
      }
      case "put": {
        const { ref, def, state } = this.editable(work, edit.node);
        const own: Record<string, Json> = {};
        for (const [key, value] of Object.entries(state.own)) if (def.fields[keyPath(key)[0]]?.inherit === false) own[key] = value;
        Object.assign(own, this.ownOf(def, this.withCreated(work, edit.fields) as Record<string, unknown>));
        const next = finish({ name: state.name, own, layers: state.layers, trashed: state.trashed, retracted: state.retracted });
        for (const op of diffStates(state, next)) work.push(ref, op);
        return;
      }
      default: refuse("value", `Unknown edit ${(edit as { op?: unknown }).op}.`);
    }
  }

  /** A value with each `{ created: label }` replaced by the node created under that label earlier in this commit. */
  private withCreated(work: Working, value: unknown): unknown {
    if (Array.isArray(value)) return value.map(item => this.withCreated(work, item));
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length === 1 && typeof record.created === "string") {
      const ref = work.created.get(record.created);
      if (!ref) refuse("missing", `No node was created as "${record.created}" earlier in this change.`);
      return ref;
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, this.withCreated(work, item)]));
  }

  private ownOf(def: TypeSpec, fields: Readonly<Record<string, unknown>>): Record<string, Json> {
    try { return ownFromFields(def, fields); }
    catch (error) { return refuse("value", (error as Error).message); }
  }

  private identityOf(def: TypeSpec): Record<string, Json> {
    const values = def.identity?.({ random: this.sources.random.stream(`identity:${def.type}`), clock: this.sources.clock }) ?? {};
    return this.ownOf(def, values);
  }

  private buildCreate(work: Working, edit: Extract<Edit, { op: "create" }>): void {
    const def = this.types.get(edit.type) ?? refuse("type", `${edit.type} isn't a registered type.`);
    if (edit.as !== undefined && work.created.has(edit.as)) refuse("exists", `"${edit.as}" names two new nodes in this change.`);
    if (edit.from && "clone" in edit.from) {
      const source = this.target(work, edit.from.clone);
      if (source.type !== def.type) refuse("type", "A clone has its source's type.");
      const root = this.buildClone(work, source, edit.from.rules ?? {}, edit.name, edit.id);
      if (edit.fields) for (const [key, value] of Object.entries(this.ownOf(def, edit.fields))) work.push(root, { kind: "set", path: keyPath(key), value });
      if (edit.as !== undefined) work.created.set(edit.as, root);
      return;
    }
    const id = edit.id ?? this.sources.random.stream("ids").uuid();
    if (this.taken(work, id)) refuse("exists", "A node with that ID already exists.");
    const ref = { type: def.type, id };
    if (edit.layers !== undefined && !Array.isArray(edit.layers)) refuse("value", "Layers are a list.");
    let layers: Layer[] = [...(edit.layers ?? [])];
    let name = edit.name;
    if (edit.from && "fork" in edit.from) {
      const source = this.target(work, edit.from.fork);
      const sourceState = work.state(source);
      if (!sourceState) refuse("missing", "The node to fork from no longer exists.");
      name ??= sourceState!.name;
      layers = [{ from: source, role: "base", paths: "*", ...(edit.from.at ? { at: { node: source, seq: edit.from.at } } : {}) }, ...layers];
    }
    const own = { ...this.identityOf(def), ...this.ownOf(def, this.withCreated(work, edit.fields ?? {}) as Record<string, unknown>) };
    const checked = this.checkLayers(work, ref, def, layers);
    work.push(ref, { kind: "create", state: freeze({ ...EMPTY_STATE, name: name ?? "", own, layers: checked }) });
    if (edit.as !== undefined) work.created.set(edit.as, ref);
  }

  /** A deep clone: effective values copied, no layers, fresh IDs, `follow` references cloned and remapped. */
  private buildClone(work: Working, root: NodeRef, rules: Readonly<Record<string, "follow" | "share">>, name?: string, rootId?: string): NodeRef {
    const resolver = work.resolver();
    const mapping = new Map<string, NodeRef>();
    const plans: { source: NodeRef; ref: NodeRef; state: NodeState; refPaths: Path[] }[] = [];
    const visit = (source: NodeRef, id?: string): NodeRef => {
      const done = mapping.get(source.id);
      if (done) return done;
      const state = work.state(source);
      if (!state) refuse("missing", "Something to clone no longer exists.");
      const def = this.types.get(source.type)!;
      const ref = { type: source.type, id: id ?? this.sources.random.stream("ids").uuid() };
      if (this.taken(work, ref.id)) refuse("exists", "A node with that ID already exists.");
      mapping.set(source.id, ref);
      const own: Record<string, Json> = {}, refPaths: Path[] = [], follow: NodeRef[] = [];
      for (const path of resolver.leafPaths(source)) {
        const spec = def.fields[path[0]];
        if (spec.inherit === false) continue;
        const value = resolver.leaf(source, path).value!;
        own[pathKey(path)] = value;
        const kind = kindAt(def, path)!.kind;
        if (kind.kind === "ref" || kind.kind === "refs") {
          refPaths.push(path);
          const rule = rules[`${def.type}.${path[0]}`] ?? rules[path[0]] ?? kind.clone;
          if (rule === "follow") for (const target of (kind.kind === "ref" ? [value] : value as Json[]) as NodeRef[])
            if (target && work.state(target) && !this.records.get(target.id)?.constant) follow.push(target);
        }
      }
      Object.assign(own, this.identityOf(def));
      plans.push({ source, ref, state: freeze({ ...EMPTY_STATE, name: source.id === root.id && name !== undefined ? name : state!.name, own }), refPaths });
      for (const target of follow) visit(target);
      return ref;
    };
    const cloned = visit(root, rootId);
    const remap = (value: Json): Json => {
      if (Array.isArray(value)) return value.map(remap);
      const target = value as unknown as NodeRef | null;
      return target && mapping.has(target.id) ? mapping.get(target.id)! as unknown as Json : value;
    };
    for (const plan of plans) {
      const own = { ...plan.state.own };
      for (const path of plan.refPaths) own[pathKey(path)] = remap(own[pathKey(path)]);
      work.push(plan.ref, { kind: "create", state: freeze({ ...plan.state, own }) });
    }
    return cloned;
  }

  private checkLayers(work: Working, ref: NodeRef, def: TypeDef, layers: readonly Layer[]): Layer[] {
    if (!Array.isArray(layers)) refuse("value", "Layers are a list.");
    let bases = 0;
    const out: Layer[] = [];
    for (const layer of layers) {
      if (!layer || (layer.role !== "base" && layer.role !== "feed")) refuse("value", "A layer is a base or a feed.");
      const from = this.target(work, layer.from);
      if (from.type !== def.type && !def.compatible?.includes(from.type)) refuse("type", `A ${def.type} takes values only from another ${def.type}.`);
      if (from.id === ref.id) refuse("cycle", "A node can't take values from itself.");
      if (!work.state(from)) refuse("missing", "The node to take values from no longer exists.");
      if (layer.role === "base") { bases++; if (layer.paths !== "*") refuse("path", "A base supplies every path."); }
      if (layer.paths !== "*") {
        if (!Array.isArray(layer.paths) || !layer.paths.length) refuse("path", "A feed names the paths it takes.");
        for (const path of layer.paths) if (!Array.isArray(path) || !path.length || !kindAt(def, path)) refuse("path", `${def.type} has no path ${JSON.stringify(path)}.`);
      }
      if (layer.at) {
        if (layer.at.node?.id !== from.id || !Number.isSafeInteger(layer.at.seq) || layer.at.seq < 1) refuse("value", "A pin names an entry of the layer's source.");
        if (work.refs.has(from.id) && !this.records.has(from.id)) refuse("pinned", "A node created in this change has no earlier version to pin to.");
        if (layer.at.seq > (this.records.get(from.id)?.headSeq ?? 0)) refuse("missing", "That version doesn't exist.");
        // Reading the source at the pinned entry reads its own layers then too: all that history must be in memory.
        const pinnedAt = this.pointOf(layer.at);
        if (pinnedAt === undefined || !this.historyAt(from.id, pinnedAt)) refuse("unloaded", "Load the source's history first.");
      }
      out.push({ from, role: layer.role, paths: layer.paths === "*" ? "*" : layer.paths.map(path => [...path]),
        ...(layer.at ? { at: { node: from, seq: layer.at.seq } } : {}) });
    }
    if (bases > 1) refuse("value", "A node has at most one base.");
    // Layer edges never form a cycle: walk the sources' layers (as this change leaves them).
    const seen = new Set<string>(), stack = out.map(layer => layer.from);
    while (stack.length) {
      const next = stack.pop()!;
      if (next.id === ref.id) {
        const state = work.state(ref);
        refuse("cycle", `That ${def.type} already takes values from ${state?.name ? `“${state.name}”` : "this one"}.`);
      }
      if (seen.has(next.id)) continue;
      seen.add(next.id);
      for (const layer of work.state(next)?.layers ?? []) stack.push(layer.from);
    }
    return out;
  }

  /**
   * A layer cycle this change would close, whatever made it (a layering edit, a revert, an undo or a redo restoring
   * earlier layers): each node whose layers it changes must not reach itself through its sources as the change leaves them.
   */
  private layerCycle(work: Working): Refusal | null {
    for (const id of work.order) {
      const ref = work.refs.get(id)!, after = work.state(ref)?.layers ?? [];
      if (equal(after, this.headState(ref)?.layers ?? [])) continue;
      const seen = new Set<string>(), stack = after.map(layer => layer.from);
      while (stack.length) {
        const next = stack.pop()!;
        if (next.id === id) return refusal("cycle", "That would make these take values from each other in a circle.");
        if (seen.has(next.id)) continue;
        seen.add(next.id);
        for (const layer of work.state(next)?.layers ?? []) stack.push(layer.from);
      }
    }
    return null;
  }

  // ---- applying entries: records, indexes, propagation ----

  private saveRecords(ids: Iterable<string>) {
    const saved = new Map<string, { rec: Rec | undefined; copy?: Omit<Rec, "entries"> & { length: number } }>();
    for (const id of ids) {
      const rec = this.records.get(id);
      saved.set(id, { rec, ...(rec ? { copy: { ...rec, length: rec.entries.length } } : {}) });
    }
    return { saved, headPos: this.headPos, actorSeq: this.actorSeq };
  }

  private restoreRecords(state: ReturnType<StrataGraph["saveRecords"]>, groups: Map<string, { ref: NodeRef; def: TypeDef; entries: Entry[] }>): void {
    const touched = new Map<string, Touch>();
    for (const id of groups.keys()) touched.set(id, "all");
    this.refresh(touched, () => {
      for (const [id, { rec, copy }] of state.saved) {
        const current = this.records.get(id);
        const before = current?.head ?? null;
        if (!rec) this.records.delete(id);
        else { const { length, ...rest } = copy!; Object.assign(rec, rest); rec.entries.length = length; this.records.set(id, rec); }
        const after = this.records.get(id)?.head ?? null;
        this.indexLayers(id, before, after);
        if (current) this.indexUnique(current, before, after);
      }
    }, "rollback");
    this.headPos = state.headPos;
    this.actorSeq = state.actorSeq;
    this.forgetGone();
  }

  /** Paths an op changes (`"all"` for whole-state and layer changes). */
  private touchOf(ops: readonly Op[]): Touch {
    const paths: Path[] = [];
    for (const op of ops) {
      switch (op.kind) {
        case "set": case "reset": case "tombstone": paths.push(op.path); break;
        case "compensate": case "revert": {
          const inner = this.touchOf(op.ops);
          if (inner === "all") return "all";
          paths.push(...inner);
          break;
        }
        case "rename": case "trash": case "restore": case "tag": case "untag": break;
        default: return "all";
      }
    }
    return paths;
  }

  private applyGroups(groups: Map<string, { ref: NodeRef; def: TypeDef; entries: Entry[] }>, cause: ChangeSet["cause"]): Map<string, NodeState | null> {
    const touched = new Map<string, Touch>();
    for (const [id, group] of groups) {
      touched.set(id, this.touchOf(group.entries.map(entry => upcast(group.def, entry).op)));
      // While everything is demanded, a new node's layering combinator exists before it does, so it reports its creation.
      if (this.allDemand && !this.records.has(id)) this.effectiveNode(group.ref).demand(LATEST, this.allDemand.signal, "all");
    }
    return this.refresh(touched, () => {
      for (const [id, group] of groups) {
        let rec = this.records.get(id);
        const before = rec?.head ?? null;
        if (!rec) {
          const session = group.def.persistence === "session";
          rec = { ref: refOf(group.ref), def: group.def, constant: false, session, base: { seq: 0, pos: 0, state: null }, entries: [],
            head: null, headSeq: 0, ackedSeq: 0, snapshotSeq: 0 };
          this.records.set(id, rec);
        }
        rec.entries.push(...group.entries);
        rec.head = fold(rec.head, group.entries, rec.def);
        rec.headSeq = group.entries[group.entries.length - 1].seq;
        if (rec.session) this.trimRing(rec);
        this.indexLayers(id, before, rec.head);
        this.indexUnique(rec, before, rec.head);
      }
    }, cause);
  }

  private trimRing(rec: Rec): void {
    const ring = rec.ref.type === SOURCE_TYPE ? this.sourceRings.get(rec.ref.id) ?? 1024 : rec.def.ring ?? 1024;
    if (rec.entries.length <= ring) { rec.ackedSeq = rec.headSeq; return; }
    const dropped = rec.entries.splice(0, rec.entries.length - ring);
    const last = dropped[dropped.length - 1];
    rec.base = { seq: last.seq, pos: last.pos, state: fold(rec.base.state, dropped, rec.def) };
    rec.ackedSeq = rec.headSeq;
  }
  private readonly sourceRings = new Map<string, number>();

  /**
   * Bookkeeping for a change to the records (SPEC §11, "the Studio's graph in these terms"): `touched` names each node
   * whose stream changed and the paths its entries change; `mutate` changes the records. The candidates are those
   * nodes and every live layer dependent whose mask covers a changed path, transitively: their resolution memo is
   * invalidated, and the reverse indexes and (when demanded) the conflict index follow. Nothing is computed for change
   * reports here; `emit` observes the touched nodes' seeds, and the demanded layering combinators report changes.
   */
  private refresh(touched: Map<string, Touch>, mutate: () => void, cause: ChangeSet["cause"]): Map<string, NodeState | null> {
    if (!this.refIndexReady && this.conflictsReady) this.ensureRefIndex();
    // 1. Candidates.
    const candidates = new Map<string, "all" | Map<string, Path>>();
    const queue: string[] = [];
    const add = (id: string, paths: Touch): boolean => {
      const current = candidates.get(id);
      if (current === "all") return false;
      if (paths === "all") { candidates.set(id, "all"); return true; }
      const map = current ?? new Map<string, Path>();
      let grew = !current;
      for (const path of paths) { const key = pathKey(path); if (!map.has(key)) { map.set(key, path); grew = true; } }
      candidates.set(id, map);
      return grew;
    };
    for (const [id, paths] of touched) if (add(id, paths)) queue.push(id);
    while (queue.length) {
      const id = queue.shift()!, paths = candidates.get(id)!;
      for (const [depId, layers] of this.layerIndex.get(id) ?? []) {
        // A collapsed node layers from its sources too: it and its dependents are reached through it.
        const inlinedDep = this.inlined.get(depId);
        const dep = this.records.get(depId) ?? (inlinedDep && { def: this.types.get(inlinedDep.ref.type) });
        if (!dep?.def) continue;
        let depPaths: Touch = [];
        for (const layer of layers) {
          if (layer.at) continue;
          if (paths === "all") { depPaths = "all"; break; }
          for (const path of paths.values()) {
            if (dep.def.fields[path[0]]?.inherit === false) continue;
            if (layer.role === "base" || covers(layer.paths, path)) (depPaths as Path[]).push(path);
          }
        }
        if ((depPaths === "all" || depPaths.length) && add(depId, depPaths)) queue.push(depId);
      }
    }
    const before = new Map<string, NodeState | null>();
    for (const id of touched.keys()) { const ref = this.records.get(id)?.ref ?? this.inlined.get(id)?.ref; before.set(id, ref ? this.headState(ref) : null); }
    // 2. Mutate.
    mutate();
    // 3. Invalidate the memo along the layer index, for every candidate (demanded or not: reads are never stale).
    const resolver = this.head.resolver;
    for (const id of candidates.keys()) {
      const rec = this.records.get(id);
      if (rec && this.faults?.skipInvalidation?.(rec.ref)) continue;
      resolver.invalidate(id);
    }
    this.head.clearDerived();
    if (cause === "rollback" || cause === "sync" || cause === "purge") this.forgetTimes();
    // 4. References held by candidates whose reference fields may have changed.
    const changed = new Set<string>(candidates.keys());
    if (this.refIndexReady) {
      for (const [id, paths] of candidates) {
        const ref = this.records.get(id)?.ref ?? this.purgedRefs.get(id);
        const def = ref && this.types.get(ref.type);
        if (!ref || !def) continue;
        if (paths === "all" || [...paths.values()].some(path => { const at = kindAt(def, path); return at && hasRefs(at.spec); })) this.indexRefs(ref);
      }
    }
    // 5. Conflicts, for the subjects the change reached: the candidates, what references them (following `follows`
    // edges transitively, since derivations read through them), and the direct layer dependents of touched nodes.
    if (this.conflictsReady) {
      const subjects = new Set<string>([...touched.keys(), ...changed]);
      const walk = [...changed];
      while (walk.length) {
        const at = walk.pop()!;
        for (const [referrer, refs] of this.refIndex.get(at) ?? []) {
          if (!subjects.has(referrer)) { subjects.add(referrer); if (refs.some(item => item.follows)) walk.push(referrer); }
        }
      }
      for (const id of touched.keys()) for (const dep of this.layerIndex.get(id)?.keys() ?? []) subjects.add(dep);
      this.reevaluate(subjects);
    }
    return before;
  }

  /**
   * One cycle for a change the records already hold: each touched node's seed observes the change (with the commit),
   * with the batch seed in the same transaction. Demanded layering combinators compute and report exact changes; after
   * the cycle the change set is assembled (`onCycle`) and observed on the commits seed for `subscribeAll`. Returns the
   * change set when the cycle ran at once (a commit outside the kernel's processing), else the bookkeeping part of it.
   */
  private emit(before: Map<string, NodeState | null>, cause: ChangeSet["cause"], commit: string, label?: string): ChangeSet {
    const meta: NodeChange[] = [];
    for (const [id, was] of before) {
      const rec = this.records.get(id), ref = rec?.ref ?? this.purgedRefs.get(id);
      if (!ref) continue;
      const now = rec ? this.headState(rec.ref) : null;
      const items: NodeChange["meta"][number][] = [];
      if (!was && now) items.push("created");
      if (was && !now) items.push(rec?.head ? "retracted" : "purged");
      if (was && now) {
        if (was.name !== now.name) items.push("name");
        if (!equal(was.layers, now.layers)) items.push("layers");
        if (was.trashed !== now.trashed) items.push("trashed");
      }
      meta.push({ node: ref, paths: [], meta: items, via: [] });
    }
    const batch = { commit, cause, ...(label ? { label } : {}), meta };
    // Waiting for the change set: a cycle that runs later (this one is queued mid-cycle) assembles one nobody takes.
    this.assembled.set(commit, undefined);
    this.env.transaction(() => {
      for (const id of before.keys()) { const seed = this.entitySeeds.get(id); if (seed) this.env.observe(seed, commit); }
      this.env.observe(this.batchSeed, batch as unknown as Json);
    });
    // Rewire demanded layering combinators whose layers changed (after the cycle that reported the change). A gone
    // node no longer layered from lets go of its kernel nodes.
    let orphaned = false;
    for (const [id, was] of before) {
      const node = this.effectiveNodes.get(id), rec = this.records.get(id);
      if (node && rec && !equal(was?.layers ?? [], rec.head?.layers ?? [])) this.env.setInputs(node, this.effectiveInputs(rec.ref));
      for (const layer of was?.layers ?? []) if (this.effectiveNodes.has(layer.from.id) && !this.records.has(layer.from.id) && !this.inlined.has(layer.from.id)) orphaned = true;
    }
    if (orphaned) this.forgetGone();
    const set = this.assembled.get(commit);
    this.assembled.delete(commit);
    return set ?? freeze({ commit, ...(label ? { label } : {}), cause, nodes: meta.filter(item => item.meta.length) });
  }

  /** After each kernel cycle: a cycle carrying a batch assembles its change set from the combinators' reports. */
  private onCycle(): void {
    const batchEntry = this.batchSeed.latest();
    if (!batchEntry || batchEntry.cycle !== this.env.cycle) return;
    const batch = batchEntry.value as unknown as { commit: string; cause: ChangeSet["cause"]; label?: string; meta: NodeChange[] };
    const reported = new Map<string, NodeChange>();
    for (const change of this.reports) reported.set(change.node.id, change);
    this.reports = [];
    const nodes: NodeChange[] = [];
    for (const item of batch.meta) {
      const found = reported.get(item.node.id);
      if (found) { nodes.push({ ...found, meta: [...new Set([...found.meta, ...item.meta])] }); reported.delete(item.node.id); }
      else if (item.meta.length) nodes.push(item);
    }
    nodes.push(...reported.values());
    const set: ChangeSet = freeze({ commit: batch.commit, ...(batch.label ? { label: batch.label } : {}), cause: batch.cause,
      nodes: nodes.sort((a, b) => a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0) });
    if (this.assembled.has(batch.commit)) this.assembled.set(batch.commit, set);
    if (set.nodes.length && this.commitsSeed.active) this.env.observe(this.commitsSeed, set as unknown as Json);
  }

  // ---- the kernel nodes of an entity (created on demand) ----

  private entitySeed(ref: NodeRef): KNode {
    let seed = this.entitySeeds.get(ref.id);
    if (!seed) { seed = this.env.seed({ id: `entity:${ref.id}`, name: `${ref.type} ${ref.id}` }); this.entitySeeds.set(ref.id, seed); }
    return seed;
  }

  private effectiveInputs(ref: NodeRef): KNode[] {
    const state = this.records.get(ref.id)?.head;
    return [this.entitySeed(ref), ...(state?.layers ?? []).filter(layer => !layer.at).map(layer => this.effectiveNode(layer.from))];
  }

  /** The layering combinator of a node: its effective value, reporting exact changes (SPEC §12.8). */
  private effectiveNode(ref: NodeRef): KNode<EffectiveOut> {
    let node = this.effectiveNodes.get(ref.id);
    if (node) return node;
    const target = refOf(ref);
    node = this.env.combinator<EffectiveOut>({ id: `effective:${ref.id}`, name: `effective ${ref.id}`, inputs: [],
      compute: context => this.computeEffective(target, context.previous?.value as EffectiveOut | undefined) });
    this.effectiveNodes.set(ref.id, node);
    kernelInternals.setInputsNow(this.env, node, this.effectiveInputs(target));
    return node;
  }

  private computeEffective(ref: NodeRef, previous: EffectiveOut | undefined): EffectiveOut | typeof UNCHANGED {
    const state = this.headState(ref), def = this.types.get(ref.type);
    const value = state ? this.head.resolver.effective(ref) : undefined;
    const out: EffectiveOut = { exists: !!state, name: state?.name ?? "", trashed: !!state?.trashed, layers: state?.layers ?? [], ...(value ? { value } : {}) };
    if (!previous) return out;
    const paths = def ? diffLeaves(def, previous.value, value) : [];
    const meta: NodeChange["meta"][number][] = [];
    if (!previous.exists && out.exists) meta.push("created");
    if (previous.exists && !out.exists) meta.push(this.records.get(ref.id)?.head ? "retracted" : "purged");
    if (previous.exists && out.exists) {
      if (previous.name !== out.name) meta.push("name");
      if (!equal(previous.layers, out.layers)) meta.push("layers");
      if (previous.trashed !== out.trashed) meta.push("trashed");
    }
    if (!paths.length && !meta.length) return UNCHANGED;
    const change: NodeChange = { node: ref, paths, meta, via: [] };
    this.reports.push(change);
    return { ...out, change };
  }

  private readonly purgedRefs = new Map<string, NodeRef>();

  /**
   * Forgets the kernel nodes (seed and layering combinator) of nodes that are gone, once nothing wires them in: no
   * node layers from it any more and no kernel node other than another gone node's demands it (a subscription to
   * everything demands every node's combinator as the host, and that demand goes with it). Also forgets the gone
   * nodes' references, which only the change set announcing them needed. Runs after a purge, a rollback and an
   * unsubscription from a gone node.
   */
  private forgetGone(): void {
    this.purgedRefs.clear();
    const gone = (id: string) => !this.records.has(id) && !this.inlined.has(id) && !this.layerIndex.has(id);
    const nodesOf = (id: string) => [this.effectiveNodes.get(id), this.entitySeeds.get(id)].filter((node): node is KNode => !!node);
    // The gone nodes whose kernel nodes nothing else wires in, where the gone nodes that go with them don't count.
    const going = new Set([...this.entitySeeds.keys(), ...this.effectiveNodes.keys()].filter(gone));
    for (let changed = true; changed;) {
      changed = false;
      const doomed = new Set([...going].flatMap(nodesOf));
      for (const id of going) if (nodesOf(id).some(node => [...node.demands.keys()].some(consumer => consumer instanceof KNode && !doomed.has(consumer)))) {
        going.delete(id);
        changed = true;
      }
    }
    kernelInternals.release(this.env, () => {
      for (const id of going) {
        for (const node of nodesOf(id)) kernelInternals.removeNow(this.env, node);
        this.effectiveNodes.delete(id); this.entitySeeds.delete(id);
      }
    });
  }

  private indexLayers(id: string, before: NodeState | null, after: NodeState | null): void {
    if (before && after && before.layers === after.layers) return;
    for (const layer of before?.layers ?? []) {
      const deps = this.layerIndex.get(layer.from.id);
      deps?.delete(id);
      if (deps && !deps.size) this.layerIndex.delete(layer.from.id);
    }
    for (const layer of after?.layers ?? []) {
      let deps = this.layerIndex.get(layer.from.id);
      if (!deps) this.layerIndex.set(layer.from.id, deps = new Map());
      const list = deps.get(id) ?? [];
      list.push(layer);
      deps.set(id, list);
    }
  }

  private indexUnique(rec: Rec, before: NodeState | null, after: NodeState | null): void {
    for (const [field, spec] of Object.entries(rec.def.fields)) {
      if (!spec.unique) continue;
      const key = pathKey([field]);
      const a = before && !before.retracted ? before.own[key] : undefined, b = after && !after.retracted ? after.own[key] : undefined;
      if (equal(a, b)) continue;
      if (a !== undefined && a !== null) {
        const index = `${rec.ref.type}\u0000${field}\u0000${canonical(a)}`;
        if (this.uniqueIndex.get(index) === rec.ref.id) this.uniqueIndex.delete(index);
      }
      if (b !== undefined && b !== null) this.uniqueIndex.set(`${rec.ref.type}\u0000${field}\u0000${canonical(b)}`, rec.ref.id);
    }
  }

  private ensureRefIndex(): void {
    if (this.refIndexReady) return;
    this.refIndexReady = true;
    for (const rec of this.records.values()) this.indexRefs(rec.ref);
  }

  private indexRefs(ref: NodeRef): void {
    for (const item of this.refsOut.get(ref.id) ?? []) {
      const referrers = this.refIndex.get(item.target.id);
      referrers?.delete(ref.id);
      if (referrers && !referrers.size) this.refIndex.delete(item.target.id);
    }
    const out = this.headState(ref) ? this.head.references(ref) : [];
    if (out.length) this.refsOut.set(ref.id, out); else this.refsOut.delete(ref.id);
    for (const item of out) {
      let referrers = this.refIndex.get(item.target.id);
      if (!referrers) this.refIndex.set(item.target.id, referrers = new Map());
      const list = referrers.get(ref.id) ?? [];
      list.push(item);
      referrers.set(ref.id, list);
    }
  }

  // ---- publishing: subscriptions are effects (SPEC §5.4), ended by abort signals (§8.4) ----

  /**
   * Every commit's change set, until `signal` aborts. While anyone subscribes to everything, every node's layering
   * combinator is demanded, so change sets report every changed path.
   */
  subscribeAll(listener: (changes: ChangeSet) => void, options: { readonly signal: AbortSignalLike }): void {
    if (options.signal.aborted) return;
    if (this.allSubscribers++ === 0) {
      this.allDemand = new Aborter();
      for (const rec of this.records.values()) if (!rec.constant) this.effectiveNode(rec.ref).demand(LATEST, this.allDemand.signal, "all");
    }
    const effect = this.env.effect({ name: "subscribe all", inputs: [this.commitsSeed], signal: options.signal, run: context => {
      for (const entry of context.inputs[0].fresh) listener(entry.value as unknown as ChangeSet);
    } });
    this.env.connect(effect, options.signal);
    options.signal.addEventListener("abort", () => {
      if (--this.allSubscribers === 0) { this.allDemand?.abort("unsubscribed"); this.allDemand = null; }
    }, { once: true });
  }

  /**
   * One node's changes, until `signal` aborts: called once per cycle that changes its effective value or bookkeeping,
   * and, with `follows`, when a node it reaches through `follows` references changes (`via` names them).
   */
  subscribe(ref: NodeRef, listener: (change: NodeChange) => void, options: { readonly signal: AbortSignalLike; readonly follows?: boolean }): void {
    if (options.signal.aborted) return;
    if (options.follows) this.ensureRefIndex();
    const target = refOf(ref);
    const self = this.effectiveNode(target);
    const inputsFor = () => options.follows ? [self, ...this.followsClosure(target).map(item => this.effectiveNode(item))] : [self];
    let effect: KNode;
    effect = this.env.effect({ name: `subscribe ${ref.id}`, inputs: inputsFor(), signal: options.signal, run: context => {
      const own = context.inputs[0].changed ? (context.inputs[0].value as EffectiveOut | undefined)?.change : undefined;
      const via = context.inputs.slice(1).filter(input => input.changed && (input.value as EffectiveOut | undefined)?.change)
        .map(input => (input.value as EffectiveOut).change!.node);
      if (own || via.length) listener(freeze({ node: target, paths: own?.paths ?? [], meta: own?.meta ?? [], via }));
      if (options.follows) {
        const next = inputsFor();
        if (next.length !== effect.inputs.length || next.some((node, i) => node !== effect.inputs[i].node)) this.env.setInputs(effect, next);
      }
    } });
    this.env.connect(effect, options.signal);
    // A subscription to a node that has gone meanwhile was the last thing holding its kernel nodes.
    onAbort(options.signal, () => { if (!this.records.has(target.id) && !this.inlined.has(target.id)) this.forgetGone(); });
  }

  /** The pending (unacknowledged) commits whenever they change, until `signal` aborts: the host's recovery copy. */
  subscribePending(listener: (pending: readonly PendingCommit[]) => void, options: { readonly signal: AbortSignalLike }): void {
    const effect = this.env.effect({ name: "pending", inputs: [this.pendingSeed], signal: options.signal, run: context => {
      if (context.inputs[0].changed) listener(context.inputs[0].value as unknown as PendingCommit[]);
    } });
    this.env.connect(effect, options.signal);
  }

  /** Nodes reachable from `ref` through `follows` references (not `ref` itself). */
  private followsClosure(ref: NodeRef): NodeRef[] {
    const seen = new Set<string>([ref.id]), out: NodeRef[] = [], stack = [ref];
    while (stack.length) {
      const at = stack.pop()!;
      for (const item of this.refsOut.get(at.id) ?? []) {
        if (!item.follows || seen.has(item.target.id)) continue;
        seen.add(item.target.id);
        out.push(item.target);
        stack.push(item.target);
      }
    }
    return out;
  }

  private notifyPending(): void { this.env.observe(this.pendingSeed, this.pending() as unknown as Json); }

  private deliverSession(groups: Map<string, { ref: NodeRef; def: TypeDef; entries: Entry[] }>): void {
    for (const group of groups.values()) if (this.records.get(group.ref.id)?.session) this.deliverToSinks(group.entries);
  }
  private deliverToSinks(entries: readonly Entry[]): void {
    for (const { def, sink } of this.sinks) {
      const matching = entries.filter(entry => def.types === "*" || def.types.includes(entry.node.type));
      if (matching.length) sink.accept(matching);
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // The outbox: acknowledgement, retries, rejection, recovery
  // -------------------------------------------------------------------------------------------------------------

  /** Commits not yet acknowledged by the store, oldest first. */
  pending(): readonly PendingCommit[] { return this.outbox.map(item => ({ ...item })); }
  /** Commits the store refused as stale (changed in another window): kept for the recovery copy, never silently dropped. */
  rejected(): readonly RejectedCommit[] { return [...this.rejectedCommits]; }
  /** Forgets rejected commits once the host has shown or kept them. */
  clearRejected(): void { this.rejectedCommits = []; }
  /** Whether the store has acknowledged a commit. */
  acknowledged(commit: string): boolean { return this.ackedCommits.has(commit); }

  /**
   * Long-running store work as a child process of the store driver's run; the promise is for the host API. It settles
   * from the process's terminal state, never from the raw work: an aborted task's result reaches no one (SPEC §9.4),
   * and a task asked for after the store driver stopped fails at once instead of waiting for ever.
   */
  private storeTask<T>(name: string, work: (signal: AbortSignalLike) => Promise<T>): Promise<T> {
    const run = this.storeRun!;
    if (run.signal.aborted) return Promise.reject(new Error("The graph's store has stopped."));
    return new Promise<T>((resolve, reject) => {
      let result: { value: T } | undefined;
      const process = run.spawn(name, signal => work(signal).then(value => { result = { value }; return null; }));
      this.whenSettled(process, state => {
        if (state.status === "done" && result) resolve(result.value);
        else reject(new Error(state.status === "failed" ? state.error.message : "The graph's store has stopped."));
      });
    });
  }

  /**
   * Sends the oldest pending commit to the store as an `append` process. Its result arrives as an observation of
   * the process node (SPEC §9.2); an effect hands it to bookkeeping between cycles. A failed or timed-out append is
   * retried after a `retry` process (a timer) completes.
   */
  private pump(): void {
    if (this.inflight !== null || this.retrying || !this.outbox.length) {
      if (!this.outbox.length) this.resolveFlush();
      return;
    }
    const run = this.storeRun!, store = this.store!, item = this.outbox[0], token = ++this.token;
    this.inflight = token;
    const process = run.spawn("append", signal => new Promise<Json>((resolve, reject) => {
      // The wait for a reply ends with the reply (or the process): no timer outlives the append.
      const waiting = new Aborter(signal);
      this.sources.clock.after(this.replyTimeoutMs, () => reject(new Error("The database didn't answer in time.")), waiting.signal);
      store.append({ commit: item.commit, entries: item.entries, expect: item.expect }).then(
        result => { waiting.abort("answered"); resolve(result as unknown as Json); },
        error => { waiting.abort("answered"); reject(error); });
    }));
    this.whenSettled(process, state => {
      this.inflight = null;
      if (state.status === "done") this.onReply(item, state.result as unknown as AppendResult);
      else if (state.status === "failed") this.scheduleRetry();
    });
  }

  /**
   * Runs `then` (between cycles) once a process reaches a terminal state. If the store driver stops first, the
   * process was aborted with it: `then` runs with that state.
   */
  private whenSettled(process: Process, then: (state: ProcessState) => void): void {
    const run = this.storeRun!, done = new Aborter();
    // Settles once: whichever of the abort listener and the result effect comes first ends the other.
    const settle = (state: ProcessState) => {
      run.signal.removeEventListener("abort", stopped);
      done.abort("settled");
      this.env.change(() => then(state));
    };
    const stopped = () => settle({ status: "aborted", reason: "stopped" });
    if (run.signal.aborted) { stopped(); return; }
    run.signal.addEventListener("abort", stopped);
    run.effect({ name: `${process.name} result`, inputs: [process], signal: done.signal, run: context => {
      const state = context.inputs[0].value as ProcessState | undefined;
      if (!state || state.status === "running" || state.status === "progress") return;
      settle(state);
    } });
  }

  private scheduleRetry(): void {
    this.retrying = true;
    const timer = this.storeRun!.spawn("retry", signal => new Promise<Json>(resolve => this.sources.clock.after(this.retryMs, () => resolve(null), signal)));
    this.whenSettled(timer, () => { this.retrying = false; this.pump(); });
  }

  private onReply(item: PendingCommit, result: AppendResult): void {
    // The commit was dropped meanwhile (rejected with the rest of the outbox): send whatever is pending now.
    if (this.outbox[0] !== item) { this.pump(); return; }
    if (!result.ok) { this.rollbackPending(); this.pump(); return; }
    this.outbox.shift();
    this.ackedCommits.add(item.commit);
    const positions = new Map<string, number>();
    item.entries.forEach((entry, index) => positions.set(`${entry.node.id}@${entry.seq}`, result.positions[index]));
    let moved = false;
    const acked: Entry[] = [];
    for (const id of new Set(item.entries.map(entry => entry.node.id))) {
      const rec = this.records.get(id);
      if (!rec) continue;
      rec.entries = rec.entries.map(entry => {
        const pos = entry.commit === item.commit ? positions.get(`${id}@${entry.seq}`) : undefined;
        if (pos === undefined || pos === entry.pos) return entry;
        moved = true;
        return freeze({ ...entry, pos });
      });
      for (const entry of rec.entries) if (entry.commit === item.commit) { acked.push(entry); rec.ackedSeq = Math.max(rec.ackedSeq, entry.seq); }
      if (rec.ackedSeq - rec.snapshotSeq >= this.snapshotEvery) this.writeSnapshot(rec);
    }
    for (const pos of result.positions) { if (pos > this.storeHead) this.storeHead = pos; if (pos > this.headPos) this.headPos = pos; }
    if (this.repositionPending()) moved = true;
    this.forgetTimes();
    // Positions this graph had assigned for itself moved to the store's: every pin reads its point anew.
    if (moved) this.refreshPinned(`ack:${item.commit}`);
    this.deliverToSinks(acked);
    this.notifyPending();
    this.pump();
  }

  /**
   * Keeps pending entries after every acknowledged position: another window's appends can push the store's positions
   * past the provisional ones, and a node's entries must stay in position order.
   */
  private repositionPending(): boolean {
    if (!this.outbox.some(item => item.entries.some(entry => entry.pos <= this.storeHead))) return false;
    const moved = new Map<string, Entry>();
    this.outbox = this.outbox.map(item => ({ ...item, entries: item.entries.map(entry => {
      const next = freeze({ ...entry, pos: ++this.headPos });
      moved.set(`${entry.node.id}@${entry.seq}@${entry.commit}`, next);
      return next;
    }) }));
    for (const id of new Set([...moved.values()].map(entry => entry.node.id))) {
      const rec = this.records.get(id);
      if (rec) rec.entries = rec.entries.map(entry => moved.get(`${id}@${entry.seq}@${entry.commit}`) ?? entry);
    }
    return true;
  }

  /**
   * After entries' positions moved (the store assigned its own to entries this graph had placed provisionally), a
   * pinned layer's point may now fall elsewhere among its source's entries: every node with a pinned layer is read
   * again, and its subscribers told what changed.
   */
  private refreshPinned(commit: string): void {
    const touched = new Map<string, Touch>();
    for (const rec of this.records.values()) if (rec.head?.layers.some(layer => layer.at)) touched.set(rec.ref.id, "all");
    if (!touched.size) return;
    this.emit(this.refresh(touched, () => undefined, "sync"), "sync", commit);
  }

  /** Drops the pending commits from `from` on (the first of them was, or would be, refused as stale); they stay available as rejected. */
  private rollbackPending(from = 0): void {
    if (this.outbox.length <= from) return;
    const dropped = this.outbox.slice(from);
    this.outbox = this.outbox.slice(0, from);
    const ids = new Set(dropped.map(item => item.commit));
    for (const item of dropped) this.rejectedCommits.push({ ...item, reason: "stale" });
    const touched = new Map<string, Touch>();
    for (const item of dropped) for (const entry of item.entries) touched.set(entry.node.id, "all");
    const beforeStates = this.refresh(touched, () => {
      for (const id of touched.keys()) {
        const rec = this.records.get(id);
        if (!rec) continue;
        const before = rec.head;
        rec.entries = rec.entries.filter(entry => !ids.has(entry.commit));
        rec.head = fold(rec.base.state, rec.entries, rec.def);
        rec.headSeq = rec.entries.length ? rec.entries[rec.entries.length - 1].seq : rec.base.seq;
        rec.ackedSeq = Math.min(rec.ackedSeq, rec.headSeq);
        if (!rec.head) { this.records.delete(id); this.purgedRefs.set(id, rec.ref); }
        this.indexLayers(id, before, rec.head);
        this.indexUnique(rec, before, rec.head);
      }
    }, "rollback");
    for (const stacks of [this.undoStacks, this.redoStacks]) for (const [scope, stack] of stacks) stacks.set(scope, stack.filter(id => !ids.has(id)));
    for (const id of ids) this.commits.delete(id);
    this.notifyPending();
    this.emit(beforeStates, "rollback", `rollback:${dropped[0].commit}`);
    this.forgetGone();
    // A pin may have pointed into what was dropped.
    this.refreshPinned(`rollback-pins:${dropped[0].commit}`);
  }

  /**
   * Resolves when every pending commit has been acknowledged or rejected, or the graph has stopped (its pending
   * commits then stay pending: the host's recovery copy).
   */
  flush(): Promise<void> {
    if (!this.outbox.length || !this.store || !this.storeRun || this.storeRun.signal.aborted) return Promise.resolve();
    return new Promise(resolve => this.flushWaiters.push(resolve));
  }
  private resolveFlush(): void { const waiters = this.flushWaiters; this.flushWaiters = []; for (const resolve of waiters) resolve(); }

  /**
   * Re-applies a recovery copy's commits after a restart: each whose basis still matches is applied and queued again
   * (the store ignores one it already has); one the store already holds is skipped; the rest are rejected as stale.
   */
  recover(pending: readonly PendingCommit[]): { readonly applied: number; readonly skipped: number; readonly rejected: number } {
    let applied = 0, skipped = 0, rejected = 0;
    // Entries of the commits rejected here: a later commit that names one was made on top of it.
    const lost = new Set<string>();
    const reject = (item: PendingCommit) => { rejected++; this.rejectedCommits.push({ ...item, reason: "stale" }); for (const entry of item.entries) lost.add(entryKey(entry)); };
    for (const item of pending) {
      // Entries a loaded snapshot covers can't be compared in memory: the store answers (it knows the commit by its
      // ID, or refuses it as stale), so the commit goes back to it without being applied again.
      if (item.entries.some(entry => { const rec = this.records.get(entry.node.id); return !!rec && entry.seq <= rec.base.seq; })) {
        this.outbox.push({ ...item });
        applied++;
        continue;
      }
      const already = item.entries.every(entry => {
        const rec = this.records.get(entry.node.id);
        return rec?.entries.some(stored => stored.seq === entry.seq && stored.commit === item.commit);
      });
      if (already) { skipped++; this.ackedCommits.add(item.commit); continue; }
      const fits = item.expect.every(([id, seq]) => (this.records.get(id)?.headSeq ?? 0) === seq) && !this.namesLost(item, lost);
      if (!fits) { reject(item); continue; }
      const groups = new Map<string, { ref: NodeRef; def: TypeDef; entries: Entry[] }>();
      for (const entry of item.entries) {
        const def = this.types.get(entry.node.type);
        if (!def) continue;
        let group = groups.get(entry.node.id);
        if (!group) groups.set(entry.node.id, group = { ref: entry.node, def, entries: [] });
        const moved = freeze({ ...entry, pos: ++this.headPos });
        group.entries.push(moved);
      }
      const before = this.applyGroups(groups, "recover");
      this.outbox.push({ ...item, entries: [...groups.values()].flatMap(group => group.entries) });
      applied++;
      this.emit(before, "recover", item.commit, item.label);
    }
    this.notifyPending();
    this.pump();
    // Recovered commits can add pins whose reading needs history this graph hasn't loaded.
    if (applied) this.loadPinnedHistory().catch(() => undefined);
    return { applied, skipped, rejected };
  }

  /**
   * Whether a recovered commit names what isn't there any more: an entry of a commit rejected before it, an entry its
   * node doesn't have, or a layer source that doesn't exist. Its basis alone doesn't cover what it points at.
   */
  private namesLost(item: PendingCommit, lost: ReadonlySet<string>): boolean {
    const exists = (id: string) => this.records.has(id) || this.inlined.has(id) || item.entries.some(entry => entry.node.id === id);
    for (const entry of item.entries) {
      const def = this.types.get(entry.node.type);
      for (const ref of entryReferences(entry, def)) {
        const rec = this.records.get(ref.node.id);
        if (lost.has(entryKey(ref)) || (!rec?.constant && !item.entries.some(own => own.node.id === ref.node.id) && (rec?.headSeq ?? 0) < ref.seq)) return true;
      }
      const op = entry.op;
      const layers = op.kind === "layers" ? op.layers : op.kind === "create" || op.kind === "import" || op.kind === "state" ? op.state.layers : [];
      if (layers.some(layer => !exists(layer.from.id))) return true;
    }
    return false;
  }

  /**
   * Reads what other windows (or processes) committed since this graph last looked, and applies it. Pending commits
   * that touch the same nodes are rejected first (the store would refuse them as stale).
   */
  async sync(): Promise<{ readonly applied: number }> {
    if (!this.store) return { applied: 0 };
    await this.flush();
    const store = this.store;
    const { head, entries } = await this.storeTask("changes", () => store.changesSince(this.readPos));
    // This graph's own pending commits can be read back already written (the acknowledgement not yet observed): they
    // are neither another window's changes nor stale, and their acknowledgement settles them.
    const pending = new Set(this.outbox.map(item => item.commit));
    const written = new Set(entries.filter(entry => pending.has(entry.commit)).map(entry => entry.commit));
    const foreign = entries.filter(entry => !this.ackedCommits.has(entry.commit) && !written.has(entry.commit) && this.types.has(entry.node.type));
    // The first pending commit not yet written that touches a node another window changed would be refused as stale,
    // and so would every commit after it: those are rejected now. The commits before it stand (written, or on their way).
    const changed = new Set(foreign.map(entry => entry.node.id));
    const first = this.outbox.findIndex(item => !written.has(item.commit) && item.entries.some(own => changed.has(own.node.id)));
    if (first >= 0) this.rollbackPending(first);
    const groups = new Map<string, { ref: NodeRef; def: TypeDef; entries: Entry[] }>();
    const reload: NodeRef[] = [];
    for (const entry of foreign) {
      const rec = this.records.get(entry.node.id);
      const expected = (groups.get(entry.node.id)?.entries.at(-1)?.seq ?? rec?.ackedSeq ?? 0) + 1;
      if (entry.seq < expected) continue;
      if (entry.seq > expected) { reload.push(entry.node); continue; }
      let group = groups.get(entry.node.id);
      if (!group) groups.set(entry.node.id, group = { ref: entry.node, def: this.types.get(entry.node.type)!, entries: [] });
      group.entries.push(entry);
      this.ackedCommits.add(entry.commit);
    }
    for (const ref of reload) groups.delete(ref.id);
    const before = new Map<string, NodeState | null>();
    if (groups.size) {
      for (const [id, state] of this.applyGroups(groups, "sync")) before.set(id, state);
      for (const group of groups.values()) { const rec = this.records.get(group.ref.id)!; rec.ackedSeq = rec.headSeq; }
    }
    for (const ref of reload) {
      const all = await this.storeTask("read", () => store.readStream(ref));
      const touched = new Map<string, Touch>([[ref.id, "all"]]);
      for (const [id, state] of this.refresh(touched, () => this.installRecord(ref, this.types.get(ref.type)!, undefined, all), "sync")) before.set(id, state);
    }
    this.storeHead = Math.max(this.storeHead, head);
    this.readPos = Math.max(this.readPos, head);
    this.headPos = Math.max(this.headPos, head);
    if (before.size) {
      this.emit(before, "sync", `sync:${foreign.at(-1)?.commit ?? head}`);
      // Another window's pins read history this graph may not hold yet; and its entries can fall before a pinned point
      // this graph already read (their positions are lower).
      await this.loadPinnedHistory();
      this.refreshPinned(`sync-pins:${foreign.at(-1)?.commit ?? head}`);
    }
    return { applied: foreign.length };
  }

  /** The store's change counter (another window's commits bump it). */
  async changeCounter(): Promise<number> { return this.store ? this.store.counter() : 0; }

  // -------------------------------------------------------------------------------------------------------------
  // Snapshots
  // -------------------------------------------------------------------------------------------------------------

  private writeSnapshot(rec: Rec): boolean {
    if (!this.store || !this.writeSnapshots || rec.constant || rec.session || rec.ackedSeq <= rec.snapshotSeq) return false;
    // A stream holding inlined streams loads whole: a snapshot standing in for its entries would hide them.
    if (rec.entries.some(entry => entry.inlined?.length)) return false;
    const acked = rec.entries.filter(entry => entry.seq <= rec.ackedSeq);
    const state = fold(rec.base.state, acked, rec.def);
    if (!state) return false;
    const last = acked[acked.length - 1];
    const snapshot: Snapshot = freeze({ node: rec.ref, seq: rec.ackedSeq, pos: last?.pos ?? rec.base.pos, schema: rec.def.schema, state });
    rec.snapshotSeq = rec.ackedSeq;
    const store = this.store;
    this.snapshotQueue = this.snapshotQueue.then(() => this.storeTask("snapshot", () => store.putSnapshot(snapshot))).catch(() => { rec.snapshotSeq = 0; });
    return true;
  }

  /** Writes a snapshot for every node changed since its last one (the Studio calls it when closing). */
  async snapshotAll(): Promise<number> {
    await this.flush();
    // A graph without a store, or one that writes none (a read-only view), writes nothing and says so.
    if (!this.store || !this.writeSnapshots) return 0;
    let written = 0;
    for (const rec of this.records.values()) if (this.writeSnapshot(rec)) written++;
    await this.snapshotQueue;
    return written;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Undo and redo: compensating entries
  // -------------------------------------------------------------------------------------------------------------

  /**
   * Ends a scope's Undo and Redo history (all scopes when none is named), as a session end does: the entries stay,
   * and compaction no longer keeps them for undo's sake.
   */
  forgetHistory(scope?: string): void {
    for (const stacks of [this.undoStacks, this.redoStacks]) {
      for (const [name, stack] of stacks) if (scope === undefined || name === scope) for (const id of stack) this.commits.delete(id);
      if (scope === undefined) stacks.clear(); else stacks.delete(scope);
    }
  }
  /** The commit IDs on a scope's Undo stack, newest last. */
  undoStack(scope = "default"): readonly string[] { return [...this.undoStacks.get(scope) ?? []]; }
  canUndo(scope = "default"): boolean { return !!this.undoStacks.get(scope)?.length; }
  canRedo(scope = "default"): boolean { return !!this.redoStacks.get(scope)?.length; }
  /** The labels on a scope's Undo stack, newest last. */
  undoLabels(scope = "default"): readonly string[] {
    return (this.undoStacks.get(scope) ?? []).map(id => this.commits.get(id)?.label ?? "");
  }

  /** Undoes the scope's latest commit by appending entries that reverse it. The stream only grows. */
  undo(scope = "default"): CommitResult {
    const stack = this.undoStacks.get(scope);
    const id = stack?.[stack.length - 1];
    if (!id) return refusal("nothing-to-undo", "There is nothing to undo.");
    const result = this.compensate(id, "undo");
    // The undone commit's record is read only through the stacks: its compensation's record stands in for it.
    if (result.ok) { stack!.pop(); this.commits.delete(id); this.stack(this.redoStacks, scope).push(result.commit); }
    return result;
  }

  /** Redoes the scope's latest undo by compensating its compensation. */
  redo(scope = "default"): CommitResult {
    const stack = this.redoStacks.get(scope);
    const id = stack?.[stack.length - 1];
    if (!id) return refusal("nothing-to-undo", "There is nothing to redo.");
    const result = this.compensate(id, "redo");
    if (result.ok) { stack!.pop(); this.commits.delete(id); this.stack(this.undoStacks, scope).push(result.commit); }
    return result;
  }

  private compensate(commitId: string, cause: "undo" | "redo"): CommitResult {
    const record = this.commits.get(commitId);
    if (!record) return refusal("missing", "That step is no longer in this session's history.");
    const work = new Working(this);
    for (const { ref, first, last } of record.touches.values()) {
      const rec = this.records.get(ref.id);
      if (!rec) continue;
      if (rec.base.seq >= first) return refusal("unloaded", "That step's history isn't in memory.");
      const upto = (seq: number) => fold(rec.base.state, rec.entries.filter(entry => entry.seq <= seq), rec.def);
      const before = upto(first - 1), after = upto(last), current = rec.head;
      if (!after || !current) continue;
      const ops: PrimitiveOp[] = [];
      if (!before || before.retracted) { if (!current.retracted) ops.push({ kind: "retract" }); }
      else {
        for (const key of new Set([...Object.keys(before.own), ...Object.keys(after.own)])) {
          if (equal(before.own[key], after.own[key]) || !equal(current.own[key], after.own[key])) continue;
          ops.push(before.own[key] === undefined ? { kind: "reset", path: keyPath(key) } : { kind: "set", path: keyPath(key), value: before.own[key] });
        }
        if (!equal(before.layers, after.layers) && equal(current.layers, after.layers)) ops.push({ kind: "layers", layers: before.layers });
        if (before.name !== after.name && current.name === after.name) ops.push({ kind: "rename", name: before.name });
        if (before.trashed !== after.trashed && current.trashed === after.trashed) ops.push({ kind: before.trashed ? "trash" : "restore" });
        if (before.retracted !== after.retracted && current.retracted === after.retracted) ops.push({ kind: before.retracted ? "retract" : "unretract" });
      }
      if (!ops.length) continue;
      const reverses: EventRef[] = [];
      for (let seq = first; seq <= last; seq++) reverses.push({ node: rec.ref, seq });
      work.push(rec.ref, { kind: "compensate", reverses, ops });
    }
    if (!work.order.length) return refusal("empty", "That step no longer changes anything.");
    return this.applyWork(work, { label: record.label, scope: record.scope }, cause);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Conflicts
  // -------------------------------------------------------------------------------------------------------------

  private rulesFor(type: NodeType): RuleDef[] {
    return this.rules.filter(rule => rule.subject === "*" || rule.subject === type || Array.isArray(rule.subject) && rule.subject.includes(type));
  }

  private draftsToConflicts(rule: RuleDef, subject: NodeRef, model: ReadModel): Conflict[] {
    return rule.evaluate(subject, model.ruleContext()).map(draft => {
      const subjects = (draft.subjects ?? [subject]).map(refOf);
      const sorted = [...subjects].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      const id = hash(canonical([rule.id, sorted, draft.key ?? ""]));
      return freeze({ id, rule: rule.id, owner: rule.owner, severity: rule.severity, kind: draft.kind ?? "conflict", blocks: rule.blocks ?? [],
        subjects, sentence: draft.sentence, routes: draft.routes ?? [] });
    });
  }

  /** Evaluates every rule on every node of a model: the reference the conflict index must equal. */
  evaluateAll(model: ReadModel = this.head): Conflict[] {
    const out = new Map<string, Conflict>();
    for (const ref of model.nodes()) for (const rule of this.rulesFor(ref.type)) for (const conflict of this.draftsToConflicts(rule, ref, model)) out.set(conflict.id, conflict);
    return [...out.values()].sort((a, b) => a.id < b.id ? -1 : 1);
  }

  private ensureConflicts(): void {
    if (this.conflictsReady) return;
    this.ensureRefIndex();
    this.conflictsReady = true;
    this.reevaluate(new Set(this.records.keys()));
  }

  private reevaluate(subjects: Set<string>): void {
    const global = this.rules.filter(rule => rule.scope === "global"), dropped = new Set<string>();
    const all = global.length ? new Set([...subjects, ...this.records.keys()]) : subjects;
    for (const id of all) {
      const rec = this.records.get(id), inSubjects = subjects.has(id);
      const rules = rec ? this.rulesFor(rec.ref.type).filter(rule => inSubjects || rule.scope === "global") : [];
      // Drop what this subject produced before, for the rules re-evaluated now.
      for (const rule of inSubjects ? this.rules : global) this.dropProduced(`${rule.id}\u0000${id}`, dropped);
      if (!rec || !this.headState(rec.ref)) continue;
      for (const rule of rules) {
        const producer = `${rule.id}\u0000${id}`;
        const ids = new Set<string>();
        for (const conflict of this.draftsToConflicts(rule, rec.ref, this.head)) {
          this.conflictsById.set(conflict.id, conflict);
          let producers = this.producers.get(conflict.id);
          if (!producers) this.producers.set(conflict.id, producers = new Set());
          producers.add(producer);
          ids.add(conflict.id);
        }
        if (ids.size) this.produced.set(producer, ids);
      }
    }
    // A conflict gone after the re-evaluation takes its acknowledgement with it.
    for (const id of dropped) if (!this.conflictsById.has(id)) this.acknowledgements.delete(id);
  }

  /** Drops what a producer produced; a conflict nothing produces any more goes, and is added to `dropped`. */
  private dropProduced(producer: string, dropped: Set<string>): void {
    const ids = this.produced.get(producer);
    if (!ids) return;
    this.produced.delete(producer);
    for (const id of ids) {
      const producers = this.producers.get(id);
      producers?.delete(producer);
      if (!producers?.size) { this.producers.delete(id); this.conflictsById.delete(id); dropped.add(id); }
    }
  }

  /** Current conflicts (on one node, or all), worst first; acknowledged warnings are left out unless asked for. */
  conflicts(ref?: NodeRef, options: { readonly acknowledged?: boolean } = {}): readonly Conflict[] {
    this.ensureConflicts();
    const out = [...this.conflictsById.values()].filter(conflict => (!ref || conflict.subjects.some(subject => subject.id === ref.id)) &&
      (options.acknowledged || !this.isAcknowledged(conflict)));
    return out.sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || (a.id < b.id ? -1 : 1));
  }

  /** The conflict index as it stands (tests compare it with `evaluateAll`). */
  conflictIndex(): Conflict[] {
    this.ensureConflicts();
    return [...this.conflictsById.values()].sort((a, b) => a.id < b.id ? -1 : 1);
  }

  private *blockingConflicts(): Iterable<Conflict> {
    this.ensureConflicts();
    for (const conflict of this.conflictsById.values()) if (conflict.severity === "blocking") yield conflict;
  }

  /** The blocking conflict that refuses `action` on `ref`, if any. */
  blockingFor(ref: NodeRef, action: string): Conflict | undefined {
    for (const conflict of this.blockingConflicts()) {
      if ((conflict.blocks.includes("*") || conflict.blocks.includes(action)) && conflict.subjects.some(subject => subject.id === ref.id)) return conflict;
    }
    return undefined;
  }

  private newBlocking(before: Set<string>): Refusal | null {
    for (const conflict of this.blockingConflicts()) if (!before.has(conflict.id))
      return refusal("conflict", `That would cause another problem: ${conflict.sentence}`, { conflict });
    return null;
  }

  private signature(conflict: Conflict): string { return conflict.subjects.map(ref => `${ref.id}@${this.seqOf(ref)}`).join(","); }
  private isAcknowledged(conflict: Conflict): boolean {
    const signature = this.acknowledgements.get(conflict.id);
    if (signature === undefined) return false;
    if (signature === this.signature(conflict)) return true;
    this.acknowledgements.delete(conflict.id);
    return false;
  }
  /** "Leave it": quiets a warning or notice until any node it involves changes. */
  acknowledge(conflictId: string): { readonly ok: boolean } {
    const conflict = this.conflictsById.get(conflictId);
    if (!conflict || conflict.severity === "blocking") return { ok: false };
    this.acknowledgements.set(conflictId, this.signature(conflict));
    return { ok: true };
  }

  /**
   * Applies a conflict's fix route as one commit (one Graph history step with the route's label). Refused when the
   * conflict is gone or the patch would add a blocking conflict. No fix deletes anything.
   */
  fix(conflictId: string, routeId: string): CommitResult {
    this.ensureConflicts();
    const conflict = this.conflictsById.get(conflictId);
    if (!conflict) return refusal("missing", "That problem has already been resolved.");
    const route = conflict.routes.find(item => item.id === routeId);
    if (!route) return refusal("missing", "That fix is no longer offered.");
    const acknowledge = route.patch.filter(edit => (edit as { op: string }).op === "acknowledge");
    for (const item of acknowledge) this.acknowledge((item as unknown as { conflict: string }).conflict);
    const edits = route.patch.filter(edit => (edit as { op: string }).op !== "acknowledge");
    if (!edits.length) return refusal("empty", "Nothing to change.");
    return this.commitInternal(edits, { label: route.label, scope: "graph" }, "fix", () => null);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Sources as session streams
  // -------------------------------------------------------------------------------------------------------------

  /** The session stream node of a source (its latest value; its ring of recent values when the source keeps one). */
  sourceNode(def: SourceDef<unknown>): NodeRef { return { type: SOURCE_TYPE, id: `source:${def.name}` }; }

  /** Records a source's event in its session stream (a bounded ring), so traces and recordings can replay it. */
  record(def: SourceDef<unknown>, value: Json): void {
    if (!def.ring) return;
    const ref = this.sourceNode(def);
    this.sourceRings.set(ref.id, def.ring);
    const exists = this.records.has(ref.id);
    const work = new Working(this);
    work.push(ref, exists ? { kind: "set", path: ["value"], value } : { kind: "create", state: freeze({ ...EMPTY_STATE, name: def.name, own: { [pathKey(["value"])]: value } }) });
    this.applyWork(work, { scope: `source:${def.name}` }, "commit", undefined, false);
  }

  /** A session stream's entries in memory (its ring). */
  ring(ref: NodeRef): readonly Entry[] { return [...(this.records.get(ref.id)?.entries ?? [])]; }

  // -------------------------------------------------------------------------------------------------------------
  // Compaction and purge
  // -------------------------------------------------------------------------------------------------------------

  /** Streams being compacted, with the seqs being rolled up: commits referencing those are refused while it runs. */
  private readonly compacting = new Map<string, ReadonlySet<number>>();

  /** A refusal when a commit's entries would reference an entry a running compaction is removing. */
  private compactingConflict(work: Working): Refusal | null {
    if (!this.compacting.size) return null;
    for (const id of work.order) {
      const def = this.types.get(work.refs.get(id)!.type);
      for (const op of work.ops.get(id)!) {
        for (const target of entryReferences({ op, commit: "" } as Entry, def)) {
          if (this.compacting.get(target.node.id)?.has(target.seq))
            return refusal("busy", "That history is being tidied up right now; try again in a moment.");
        }
      }
    }
    return null;
  }

  /**
   * A commit that would add a reference to a node being collapsed, or to one of its entries, is refused while the
   * collapse is under way (SPEC §16.6): the collapse was allowed because exactly one entry referenced the node.
   */
  private collapsingConflict(work: Working): Refusal | null {
    if (!this.collapsing.size) return null;
    for (const id of work.order) {
      const def = this.types.get(work.refs.get(id)!.type);
      for (const op of work.ops.get(id)!) {
        const entry = { op, commit: "" } as Entry;
        if (entryReferences(entry, def).some(target => this.collapsing.has(target.node.id)) || nodeReferences(entry, def).some(ref => this.collapsing.has(ref.id)))
          return refusal("busy", "What this refers to is being moved into the entry that refers to it; try again in a moment.");
      }
    }
    return null;
  }

  private undoReach(): Set<string> {
    const reach = new Set<string>();
    for (const stacks of [this.undoStacks, this.redoStacks]) for (const stack of stacks.values()) for (const id of stack) reach.add(id);
    return reach;
  }

  private async allStreams(): Promise<Stream[]> {
    for (const rec of [...this.records.values()]) await this.loadHistory(rec.ref);
    return [...this.records.values()].filter(rec => !rec.constant).map(rec => ({ ref: rec.ref, entries: rec.entries }));
  }

  /**
   * Compacts one node's stored stream: keeps the latest entry and every entry something references (tags, pins,
   * reverts, entry fields, `roots`, this session's undo reach), rolls up the rest (value streams drop them; delta
   * streams keep the state at each `bucketMs` boundary). The fold at every kept entry is unchanged.
   */
  async compact(ref: NodeRef, options: { readonly bucketMs?: number; readonly roots?: KeepOptions["roots"] } = {}):
    Promise<{ readonly ok: true; readonly before: number; readonly after: number } | Refusal> {
    const rec = this.records.get(ref.id);
    if (!rec || rec.constant) return refusal("missing", "That can't be compacted.");
    if (this.compacting.has(ref.id) || this.collapsing.has(ref.id) || this.collapsingInto.has(ref.id)) return refusal("busy", "That is already being compacted.");
    // Reserved from the start: a second compaction of this node asked for while this one waits is refused, and
    // neither can clear the other's guard.
    const rolling = new Set<number>();
    this.compacting.set(ref.id, rolling);
    let rolled: Entry[], through: number, acked: Entry[];
    try {
      await this.flush();
      // Other windows' tags and pins count too: read what they committed first.
      if (this.store && !rec.session) await this.sync();
      await this.allStreams();
      // From here to the store call nothing awaits: the keep set sees every entry committed until now.
      const current = this.records.get(ref.id);
      if (!current || current.base.seq > 0) return refusal("missing", "That changed while it was being compacted.");
      const streams = [...this.records.values()].filter(item => !item.constant).map(item => ({ ref: item.ref, entries: item.entries }));
      const keep = keepSet(streams, type => this.types.get(type), { roots: options.roots, undoReach: this.undoReach() });
      through = current.ackedSeq;
      acked = current.entries.filter(entry => entry.seq <= through);
      if (!acked.length) return { ok: true, before: 0, after: 0 };
      rolled = current.def.stream === "value" ? rollupValueStream(acked, keep) : rollupDeltaStream(current.def, acked, keep, options.bucketMs ?? 1000);
      // While the store compacts, this graph refuses (busy) a commit referencing an entry being rolled up.
      const surviving = new Set(rolled.map(entry => entry.seq));
      for (const entry of acked) if (!surviving.has(entry.seq)) rolling.add(entry.seq);
      // The store keeps anything appended after `through` meanwhile; so does memory.
      const store = this.store;
      if (store && !current.session) await this.storeTask("compact", () => store.compact(ref, rolled, this.sources.clock.now()));
    } finally { this.compacting.delete(ref.id); }
    const after = this.records.get(ref.id);
    if (after) {
      after.entries = [...rolled, ...after.entries.filter(entry => entry.seq > through)];
      after.base = { seq: 0, pos: 0, state: null };
      after.snapshotSeq = 0;
    }
    this.forgetTimes();
    return { ok: true, before: acked.length, after: rolled.length };
  }

  /**
   * Inline collapse: when exactly one entry anywhere references the node, its stream moves into that entry and the
   * node's own stream is removed. The node still reads (from the host entry) exactly as before.
   */
  async collapseInline(ref: NodeRef): Promise<{ readonly ok: true; readonly host: EventRef } | Refusal> {
    const rec = this.records.get(ref.id);
    if (!rec || rec.constant) return refusal("missing", "That can't be collapsed.");
    if (this.collapsing.has(ref.id) || this.compacting.has(ref.id)) return refusal("busy", "That is already being compacted.");
    // From the start, commits to it are refused (busy): what the host entry takes is its whole stream.
    this.collapsing.add(ref.id);
    try { return await this.collapse(ref, rec); } finally { this.collapsing.delete(ref.id); }
  }

  private async collapse(ref: NodeRef, rec: Rec): Promise<{ readonly ok: true; readonly host: EventRef } | Refusal> {
    await this.flush();
    const streams = await this.allStreams();
    const result = collapsePrimitive(streams, type => this.types.get(type), ref);
    if (!result.ok) return refusal("dependents", result.reason);
    const host = this.records.get(result.host.node.id)!;
    // A stream lives only as long as its host: a session host would lose a persistent stream, a persistent one would
    // store a session stream.
    if (host.session !== rec.session) return refusal("type", rec.session
      ? "Only a node kept beyond this session refers to it: it can't move there." : "Only a node of this session refers to it: it can't move there.");
    if (this.purging.has(host.ref.id) || this.collapsingInto.has(host.ref.id) || this.compacting.has(host.ref.id)) return refusal("busy", "The node that refers to it is being changed in the store.");
    this.collapsingInto.add(host.ref.id);
    try { return await this.collapseInto(ref, rec, host, result); } finally { this.collapsingInto.delete(host.ref.id); }
  }

  private async collapseInto(ref: NodeRef, rec: Rec, host: Rec, result: Extract<ReturnType<typeof collapsePrimitive>, { ok: true }>): Promise<{ readonly ok: true; readonly host: EventRef }> {
    const rewrite = (entries: readonly Entry[]) => entries.map(entry => entry.seq === result.host.seq ? freeze(result.host) : entry);
    if (this.store && !host.session) {
      const store = this.store;
      await this.storeTask("compact", () => store.compact(host.ref, rewrite(host.entries.filter(entry => entry.seq <= result.host.seq)), this.sources.clock.now()));
      await this.storeTask("purge", () => store.purge(ref));
    }
    host.entries = rewrite(host.entries);
    host.base = { seq: 0, pos: 0, state: null };
    host.snapshotSeq = 0;
    // It reads as before, but is no longer a record: the indexes and conflicts that name it as a subject follow.
    this.refresh(new Map([[ref.id, "all"]]), () => {
      this.records.delete(ref.id);
      // It reads what the host entry holds (another window's entries that arrived meanwhile were purged with its stream).
      this.inlined.set(ref.id, { ref: rec.ref, state: fold(null, result.host.inlined!.at(-1)!.entries, rec.def), host: { node: host.ref, seq: result.host.seq } });
    }, "purge");
    return { ok: true, host: { node: host.ref, seq: result.host.seq } };
  }

  /** A collapsed node's stream, as its host entry holds it. */
  private inlinedStream(id: string): readonly Entry[] | undefined {
    const item = this.inlined.get(id), host = item && this.records.get(item.host.node.id);
    return host && entryAt(host.entries, item.host.seq)?.inlined?.find(inner => inner.node.id === id)?.entries;
  }

  /** Where a collapsed stream now lives. */
  inlinedIn(ref: NodeRef): EventRef | undefined { return this.inlined.get(ref.id)?.host; }

  /**
   * Purges a node whose stream was collapsed into another entry (SPEC §16.6, §16.7): the host entry is rewritten
   * without it (a compaction of the host's stream, same seq and position), so its data leaves the store. The host's
   * reference to it remains and reads as missing.
   */
  private async purgeInlined(ref: NodeRef, options: { readonly force?: boolean }): Promise<{ readonly ok: true } | Refusal> {
    const item = this.inlined.get(ref.id)!;
    const dependents = this.layerDependents(ref);
    if (dependents.length && !options.force)
      return refusal("dependents", "Other nodes take values from this one: detach them or point them elsewhere first.", { dependents });
    await this.flush();
    await this.loadHistory(item.host.node);
    const host = this.records.get(item.host.node.id);
    const strip = (entry: Entry): Entry => {
      if (entry.seq !== item.host.seq || !entry.inlined) return entry;
      const { inlined, ...rest } = entry;
      const kept = inlined.filter(inner => inner.node.id !== ref.id);
      return freeze(kept.length ? { ...rest, inlined: kept } : rest) as Entry;
    };
    if (host) {
      const store = this.store;
      if (store && !host.session) {
        const upto = host.entries.filter(entry => entry.seq <= item.host.seq).map(strip);
        await this.storeTask("compact", () => store.compact(host.ref, upto, this.sources.clock.now()));
      }
      host.entries = host.entries.map(strip);
      host.snapshotSeq = 0;
    }
    const touched = new Map<string, Touch>([[ref.id, "all"]]);
    // A pin that read it (directly, or through its source's own layers then) reads nothing from it now.
    for (const rec of this.records.values()) if (rec.head?.layers.some(layer => layer.at)) touched.set(rec.ref.id, "all");
    this.purgedRefs.set(ref.id, item.ref);
    const beforeStates = this.refresh(touched, () => { this.inlined.delete(ref.id); this.indexLayers(ref.id, item.state, null); }, "purge");
    this.forgetTimes();
    this.emit(beforeStates, "purge", `purge:${ref.id}`);
    this.forgetGone();
    return { ok: true };
  }

  /** Nodes that layer from `ref` (live or pinned). */
  layerDependents(ref: NodeRef): readonly NodeRef[] {
    return [...this.layerIndex.get(ref.id)?.keys() ?? []].map(id => this.records.get(id)?.ref).filter((item): item is NodeRef => !!item);
  }

  /**
   * Delete permanently: removes the node's stream, entries and snapshots from the store (and, through the store,
   * from backups). Refused while other nodes layer from it (offer Detach them or Point them elsewhere), unless `force`.
   * Other nodes' references to it remain by ID and read as missing.
   */
  async purge(ref: NodeRef, options: { readonly force?: boolean } = {}): Promise<{ readonly ok: true } | Refusal> {
    // A purge and a collapse touching the same node (or the entry a collapse writes into) never overlap.
    const host = this.inlined.get(ref.id)?.host.node.id;
    if ([ref.id, host].some(id => id !== undefined && (this.purging.has(id) || this.collapsing.has(id) || this.collapsingInto.has(id))))
      return refusal("busy", "That is being compacted or deleted already.");
    this.purging.add(ref.id);
    try { return await this.purgeNow(ref, options); } finally { this.purging.delete(ref.id); }
  }

  private async purgeNow(ref: NodeRef, options: { readonly force?: boolean }): Promise<{ readonly ok: true } | Refusal> {
    const rec = this.records.get(ref.id);
    if (!rec && this.inlined.has(ref.id)) return this.purgeInlined(ref, options);
    if (!rec || rec.constant) return refusal("missing", "That can't be deleted permanently.");
    // Streams collapsed into this node's entries live nowhere else: they go with it.
    const inlined = [...this.inlined].filter(([, item]) => item.host.node.id === ref.id).map(([id, item]) => [id, item.ref] as const);
    const dependents = [...new Set([ref, ...inlined.map(([, inner]) => inner)].flatMap(item => this.layerDependents(item)))]
      .filter(item => item.id !== ref.id);
    if (dependents.length && !options.force)
      return refusal("dependents", "Other nodes take values from this one: detach them or point them elsewhere first.", { dependents });
    await this.flush();
    // A snapshot queued before the purge must not land after it and bring the node's data back.
    await this.snapshotQueue;
    const store = this.store;
    if (store && !rec.session) await this.storeTask("purge", () => store.purge(ref));
    const touched = new Map<string, Touch>([[ref.id, "all"], ...inlined.map(([id]) => [id, "all"] as [string, Touch])]);
    // A pin that read it (directly, or through its source's own layers then) reads nothing from it now.
    for (const other of this.records.values()) if (other.head?.layers.some(layer => layer.at)) touched.set(other.ref.id, "all");
    this.purgedRefs.set(ref.id, rec.ref);
    for (const [id, inner] of inlined) this.purgedRefs.set(id, inner);
    const beforeStates = this.refresh(touched, () => {
      const before = rec.head;
      for (const [id] of inlined) { this.indexLayers(id, this.inlined.get(id)?.state ?? null, null); this.inlined.delete(id); }
      this.records.delete(ref.id);
      this.indexLayers(ref.id, before, null);
      this.indexUnique(rec, before, null);
    }, "purge");
    for (const stacks of [this.undoStacks, this.redoStacks]) for (const [scope, stack] of stacks)
      stacks.set(scope, stack.filter(id => {
        const touched = !!this.commits.get(id)?.touches.has(ref.id);
        if (touched) this.commits.delete(id);
        return !touched;
      }));
    this.forgetTimes();
    this.emit(beforeStates, "purge", `purge:${ref.id}`);
    this.forgetGone();
    return { ok: true };
  }

  // -------------------------------------------------------------------------------------------------------------
  // The inspector's data
  // -------------------------------------------------------------------------------------------------------------

  private depthOf(id: string): number {
    const state = this.records.get(id)?.head;
    let depth = 0;
    for (const layer of state?.layers ?? []) depth = Math.max(depth, 1 + this.depthOf(layer.from.id));
    return depth;
  }

  /** One inspector row. */
  inspectorRow(ref: NodeRef): InspectorRow | undefined {
    const rec = this.records.get(ref.id), state = rec && this.headState(rec.ref);
    if (!rec || !state) return undefined;
    this.ensureConflicts();
    const references = this.refsOut.get(ref.id) ?? [];
    const referrers = this.refIndex.get(ref.id);
    const fork = state.layers.some(layer => layer.role === "base"), fed = state.layers.some(layer => layer.role === "feed");
    let worst: Severity | null = null;
    for (const conflict of this.conflictsById.values()) if (conflict.subjects.some(subject => subject.id === ref.id) &&
      (!worst || severityRank[conflict.severity] > severityRank[worst])) worst = conflict.severity;
    return freeze({ ref: rec.ref, name: state.name, constant: rec.constant, trashed: state.trashed, used: referrers?.size ?? 0,
      uses: references.length, layer: fork && fed ? "fork+fed" : fork ? "fork" : fed ? "fed" : null, depth: this.depthOf(ref.id),
      conflict: worst, orphaned: references.some(item => !this.headState(item.target)), seq: rec.headSeq });
  }

  /** A page of inspector rows matching a query (see `inspect.ts` for the language), 200 at a time. */
  inspect(query = "", offset = 0, limit?: number): InspectorPage {
    const rows = [...this.records.values()].map(rec => this.inspectorRow(rec.ref)).filter((row): row is InspectorRow => !!row);
    rows.sort((a, b) => a.ref.type < b.ref.type ? -1 : a.ref.type > b.ref.type ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : a.ref.id < b.ref.id ? -1 : 1);
    return inspectorPage(rows, query, offset, limit);
  }

  /** One node's detail for the inspector: its edges both ways, conflicts, and the research view of what it stores. */
  inspectNode(ref: NodeRef): InspectorDetail | undefined {
    const row = this.inspectorRow(ref);
    const state = this.headState(ref);
    if (!row || !state) return undefined;
    const uses: InspectorEdge[] = (this.refsOut.get(ref.id) ?? []).map(item => ({ from: row.ref, to: item.target, path: item.path, kind: "ref" }));
    const usedBy: InspectorEdge[] = this.referrers(ref).map(item => ({ from: item.node, to: row.ref, path: item.path, kind: "ref" }));
    const edge = (layer: Layer): InspectorEdge => ({ from: row.ref, to: layer.from, kind: layer.role, ...(layer.at ? { pinned: layer.at.seq } : {}) });
    const basedOn = state.layers.filter(layer => layer.role === "base").map(edge);
    const feedsFrom = state.layers.filter(layer => layer.role === "feed").map(edge);
    const fedInto: InspectorEdge[] = [];
    for (const [id, layers] of this.layerIndex.get(ref.id) ?? []) {
      const dep = this.records.get(id);
      if (dep) for (const layer of layers) fedInto.push({ from: dep.ref, to: row.ref, kind: layer.role, ...(layer.at ? { pinned: layer.at.seq } : {}) });
    }
    return freeze({ row, uses, usedBy, basedOn, feedsFrom, fedInto, conflicts: this.conflicts(ref, { acknowledged: true }), own: state.own, layers: state.layers });
  }

  /** Internal state for the standard invariants (`strata/testing`, through `STRATA_DEBUG`): the head memo and stored structure. */
  [STRATA_DEBUG]() {
    return {
      records: [...this.records.values()].map(rec => ({ ref: rec.ref, constant: rec.constant, session: rec.session, base: rec.base,
        entries: rec.entries, head: rec.head, headSeq: rec.headSeq, ackedSeq: rec.ackedSeq })),
      resolver: this.head.resolver,
      layerIndex: this.layerIndex,
      outbox: this.outbox,
      // The internal tables, for the "bounded by the live set" invariant (`checkTables`).
      tables: {
        kernel: kernelInternals.tables(this.env), records: this.records, inlined: this.inlined, defaultsMemo: this.defaultsMemo,
        timeModels: this.timeModels, commitEnds: this.commitEnds, collapsing: this.collapsing, collapsingInto: this.collapsingInto,
        purging: this.purging, compacting: this.compacting, slowFolds: this.slowFolds, sourceRings: this.sourceRings, purgedRefs: this.purgedRefs,
        layerIndex: this.layerIndex, refIndex: this.refIndex, refsOut: this.refsOut, uniqueIndex: this.uniqueIndex, conflicts: this.conflictsById,
        producers: this.producers, produced: this.produced, acknowledgements: this.acknowledgements, commits: this.commits,
        stacks: [...this.undoStacks.values(), ...this.redoStacks.values()] as readonly (readonly string[])[], outbox: this.outbox.length,
        rejected: this.rejectedCommits.length, ackedCommits: this.ackedCommits, entitySeeds: this.entitySeeds, effectiveNodes: this.effectiveNodes,
        assembled: this.assembled, reports: this.reports.length, flushWaiters: this.flushWaiters.length,
      } as const,
    };
  }
}

/** The leaf paths whose values differ between two effective values of a type (maps walked per key). */
function diffLeaves(def: TypeSpec, a: Readonly<Record<string, unknown>> | undefined, b: Readonly<Record<string, unknown>> | undefined): Path[] {
  const out: Path[] = [];
  const walk = (path: string[], kind: import("./types").FieldKind, x: unknown, y: unknown) => {
    if (kind.kind !== "map") { if (!equal(x, y)) out.push(path); return; }
    const xs = (x ?? {}) as Record<string, unknown>, ys = (y ?? {}) as Record<string, unknown>;
    for (const key of [...new Set([...Object.keys(xs), ...Object.keys(ys)])].sort()) walk([...path, key], kind.of, xs[key], ys[key]);
  };
  for (const [field, spec] of Object.entries(def.fields)) walk([field], spec, a?.[field], b?.[field]);
  return out.sort((p, q) => pathKey(p) < pathKey(q) ? -1 : pathKey(p) > pathKey(q) ? 1 : 0);
}

/** The edits of one commit as they are built: working states, the ops per node, and created labels. */
/** The entry with this seq, by binary search over entries in seq order. */
function entryAt(entries: readonly Entry[], seq: number): Entry | undefined {
  let low = 0, high = entries.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1, at = entries[mid].seq;
    if (at === seq) return entries[mid];
    if (at < seq) low = mid + 1; else high = mid - 1;
  }
  return undefined;
}

class Working {
  readonly states = new Map<string, NodeState | null>();
  readonly ops = new Map<string, Op[]>();
  readonly order: string[] = [];
  readonly created = new Map<string, NodeRef>();
  readonly refs = new Map<string, NodeRef>();
  private seqs = new Map<string, number>();
  private temp?: Resolver;
  constructor(private graph: StrataGraph) {}

  private base(ref: NodeRef): NodeState | null {
    return (this.graph as unknown as { headState(ref: NodeRef): NodeState | null }).headState(ref);
  }
  /** The node's state as this change leaves it so far (null when it doesn't exist). */
  state(ref: NodeRef): NodeState | null {
    if (this.states.has(ref.id)) {
      const state = this.states.get(ref.id)!;
      return state && !state.retracted && this.refs.get(ref.id)?.type === ref.type ? state : null;
    }
    return this.base(ref);
  }
  seqOf(ref: NodeRef): number { return this.seqs.get(ref.id) ?? this.graph.seqOf(ref); }
  push(ref: NodeRef, op: Op): void {
    const fresh = !this.ops.has(ref.id);
    const before = fresh ? this.base(ref) : this.states.get(ref.id) as NodeState | null;
    const after = fold(before, [{ op } as Entry]);
    // An edit that changes nothing is not recorded: no entry, nothing to undo.
    const primitive = op.kind === "set" || op.kind === "reset" || op.kind === "tombstone" || op.kind === "layers" || op.kind === "rename";
    if (primitive && before && equal(before, after)) return;
    if (fresh) { this.ops.set(ref.id, []); this.order.push(ref.id); this.refs.set(ref.id, ref); }
    this.ops.get(ref.id)!.push(op);
    this.states.set(ref.id, after);
    this.seqs.set(ref.id, this.seqOf(ref) + 1);
    this.temp?.clear();
  }

  /** A resolver over this change's working states (for detach, clone and apply-to-source). */
  resolver(): Resolver {
    const graph = this.graph as unknown as { headReader: StateReader };
    this.temp ??= new Resolver({ ...graph.headReader, state: ref => this.state(ref) });
    return this.temp;
  }
}
