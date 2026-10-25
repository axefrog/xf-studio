// Evolution (spec 9.4): one shared simulation window, a defined order at every boundary, and processes
// whose outputs are held until their span ends (double buffering).
//
// The kernel defines when processes run and what they may read; their policies are S1's. Everything a
// process produces is plain data (ProcessOp), held in its ProcessState with the boundary at which it
// applies, so a save and a load never lose or re-run a batch (spec 14.1).

import { canonicalKey, hrec } from './canon.ts';
import { H, type HArg, id as hid, i as hi, rand, s as hs } from './id.ts';
import type { Kernel } from './kernel.ts';
import type { ContributionSpec, EdgeSpec, PinSpec } from './kernel.ts';
import type { EventSpec } from './events.ts';
import type { Belief, BeliefSpec } from './beliefs.ts';
import type { FrameInterests, FrameSpec, FrameStatus, Goal } from './frames.ts';
import type { Decision } from './groups.ts';
import type { SummarySpec } from './summary.ts';
import { newOpCtx } from './resolve.ts';
import type { Form, GameTime, Id, Query, QueryOutcome, Region, ResolveResult, Selector, SlotPath, Tier, Value } from './types.ts';
import { LimitExceeded } from './work.ts';

/** How a told belief changes in the telling (S1 8.4): the operator the policy drew, or none. */
export type TellOperator = 'level' | 'sharpen' | 'assimilate';

/**
 * The operations a process returns (S0 9.4, v4: V4-38, V4-43, V4-47). They are plain data, applied with the
 * batch in the order returned, under the same rules as every other operation. Where S1 names an operation
 * differently, this set is the reference model's.
 */
export type ProcessOp =
  | { op: 'pin'; node: Id; slot: SlotPath; value?: Value; region?: Region; valid?: { from?: GameTime; to?: GameTime } }
  | { op: 'withdraw'; pin: Id }
  | {
      op: 'contribute'; layer?: 'simulation' | 'procedural'; target: Selector; form: Form;
      mode: ContributionSpec['mode']; strength?: number; valid?: { from?: GameTime; to?: GameTime };
      /** Restating a value (cache population after a load) publishes nothing (V4-48). */
      silent?: boolean;
    }
  | { op: 'end-contribution'; id: Id }
  | { op: 'edge'; type: string; from: Id; to: Id; attrs?: Record<string, Value>; valid?: { from?: GameTime; to?: GameTime }; /** The cause the edge names, and its `Id`, where the layer fixes either (S1 7.8 `xf:leads`); the process's own cause by default. */ cause?: Id; id?: Id }
  | { op: 'end-edge'; id: Id }
  /** `creator` and `cause` default to the process's own Id, and name the node's identity (`H("mint", creator, cause, name)`). */
  | { op: 'mint-event'; spec: Omit<EventSpec, 'creator' | 'cause'> & { creator?: Id; cause?: Id } }
  | { op: 'mint-summary'; spec: Omit<SummarySpec, 'creator' | 'cause'> & { creator?: Id; cause?: Id } }
  /** Declare this process as the owner of an opened item's fields, independently of its contributions. */
  | { op: 'materialise-item'; item: Id }
  /** Publish a summary item once, as one `event` change (V4-47). Regeneration of the item stays silent. */
  | { op: 'publish-item'; item: Id }
  | { op: 'frame-open'; frame: FrameSpec }
  | { op: 'frame-status'; frame: Id; status: FrameStatus; cause: Id }
  | { op: 'frame-weight'; frame: Id; weight: number; cause: Id }
  | { op: 'frame-interests'; frame: Id; own: Partial<FrameInterests>; cause: Id }
  | { op: 'decide'; leader: Id; group: Id; decision: Decision }
  | { op: 'order'; groupFrame: Id; member: Id; goal: Goal; pressure: number }
  /** `observer` saw `node`'s `slot` as it stood at `at`: the value is pinned `observed`, cause the observer. */
  | { op: 'observe'; observer: Id; node: Id; slot: SlotPath; at: GameTime; evidence?: Id }
  /** `teller` tells `listener` its belief `belief`, in the telling event `event`, changed by `operator` (S1 8.4). */
  | { op: 'tell'; teller: Id; listener: Id; belief: Id; event: Id; operator: TellOperator | null }
  | { op: 'belief-set'; belief: BeliefSpec }
  | { op: 'belief-drop'; believer: Id; belief: Id }
  /** Append entries to a layer's own record (S1's decision log): applied by the sink the layer registered under `owner`. */
  | { op: 'record'; owner: string; entries: unknown };

/** A node demand reaches (V4-37): its demand tier and claim at the snapshot. */
export interface DemandedNode {
  node: Id;
  tier: Tier;
  claim: number;
}

export interface ProcessCtx {
  /** The window index this run starts at. */
  readonly k: number;
  readonly processId: string;
  readonly worldSeed: Id;
  readonly windowStart: GameTime;
  readonly wSim: number;
  /** Resolve a slot (silent). `t` defaults to the start of the run's window. */
  read(node: Id, path: SlotPath, t?: GameTime): ResolveResult;
  value(node: Id, path: SlotPath, t?: GameTime): Value | undefined;
  /** Process randomness: rand("proc", worldSeed, processId, k, ...key) (spec 9.4). The run's own window. */
  rand(...key: HArg[]): number;
  /** Process randomness for the window being computed, `w` (V4-41): rand("proc", worldSeed, processId, w, ...key). */
  procRand(w: number, ...key: HArg[]): number;
  query(q: Query): QueryOutcome;
  /** The earliest `at` of the node's `observed` pins valid at `t`, or undefined (S0 9.4, v4.17). As of the snapshot. */
  observedAt(node: Id, t: GameTime): GameTime | undefined;
  /** This process's own state as of the snapshot (V4-35). Undefined until the process has returned one. */
  own<S = any>(): S | undefined;
  /** Another process's last published digest as of the snapshot (V4-36), read-only. */
  digest<D = any>(processId: string): D | undefined;
  /** The nodes demand reaches at `tier` or finer, with their claims (V4-37). For a fine-tier process. */
  demanded(tier: Tier): DemandedNode[];
}

/** What a run returns: the operations, and (V4-35) the process's next state and the digest it publishes with them. */
export interface ProcessResult {
  ops: ProcessOp[];
  state?: unknown;
  digest?: unknown;
}

export interface ProcessDef {
  id: string;
  tier: Tier;
  /** n: the process runs when k mod n = 0, and computes windows k to k + n - 1. */
  period: number;
  /** The process's version: part of what a lineage pins (S1 1.4). Optional. */
  version?: number;
  /** The agreement it owes between coarse and fine (V4-24). Ignored by resolution. */
  coarseFine?: { kind: 'exact' } | { kind: 'count' } | { kind: 'distribution'; tolerance: string };
  /** Publication lag, in windows (S1 9.4). Recorded, not used by resolution. */
  lag?: number;
  /**
   * A fine-tier process also runs when demand reached its tier in the `demandLookback` windows before the boundary, so it can finish
   * what the demand of a window just ended asked for (S1 7.9: the items of window `k - 1` are opened from the demand recorded for
   * window `k - 1`, even when V has left by `k`). Judged from the recorded demand history.
   */
  demandLookback?: number;
  /** The state of a new lineage (V4-35): what `own()` answers before the first batch with a state has applied. */
  init?(ctx: { worldSeed: Id }): unknown;
  /**
   * How a copy of the process's state is made for `own()`, when a deep copy is dearer than it needs to be: a process whose state holds a
   * long list of records that it only ever adds to and drops from, never edits, can share those records between the copies. The copy
   * must be one the process can change without the applied state changing. Absent: a structured clone.
   */
  cloneState?(state: unknown): unknown;
  /** Observe a digest at its actual publication point, before another batch or external operation applies. */
  applied?(digest: unknown): void;
  run(ctx: ProcessCtx, k: number): ProcessOp[] | ProcessResult;
}

export interface OutstandingBatch {
  /** The window the run started at. */
  k: number;
  /** The boundary index at which the batch applies. */
  spanEnd: number;
  ops: ProcessOp[];
  /** The state the batch replaces the process's own with when it applies (V4-35). Absent: the state is left alone. */
  state?: unknown;
  /** The digest the batch publishes when it applies (V4-36). Absent: the digest is left alone. */
  digest?: unknown;
}

export interface ProcessState {
  id: string;
  /** Plain data the process keeps between runs (S1's). */
  state: unknown;
  /** The last published digest, persisted with the state so reads of it are identical after a load (V4-49). */
  digest?: unknown;
  outstanding: OutstandingBatch[];
}

export type ExternalOp =
  | { op: 'reading'; node: Id; slot: SlotPath; value: Value }
  | { op: 'observe'; node: Id; slot: SlotPath; at: GameTime; cause: Id; evidence?: Id }
  | { op: 'pin'; spec: Omit<PinSpec, 'at' | 'silent'> }
  | { op: 'event'; spec: EventSpec };

export interface Envelope {
  /** The epoch the operation was created in (spec 14.3). */
  epoch: Id;
  /** The game time the operation is stamped with. */
  stamp: GameTime;
  op: ExternalOp;
}

export interface QueuedOp extends Envelope {
  id: Id;
}

export type SubmitResult = { accepted: true; id: Id } | { accepted: false; reason: string };

export interface AdvanceReport {
  /** Whether every boundary up to the target was processed. */
  done: boolean;
  boundaries: number;
  runs: number;
  applied: number;
}

export const processCause = (id: string): Id => H(hs('process'), hs(id));

const cmpId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A deep copy of a process state: the state, the digest and every outstanding batch, with the state and digest it carries. */
function copyState(s: ProcessState): ProcessState {
  const out: ProcessState = { id: s.id, state: structuredClone(s.state), outstanding: s.outstanding.map((b) => structuredClone(b)) };
  if (s.digest !== undefined) out.digest = structuredClone(s.digest);
  return out;
}

export class Evolution {
  readonly processes = new Map<string, ProcessDef>();
  readonly states = new Map<string, ProcessState>();
  /** The index of the last boundary processed (-1 before the first). */
  cursor = -1;
  private queue: QueuedOp[] = [];
  /** Operations applied at boundaries after their window (a diagnostic, never a policy). */
  lateOps = 0;
  /** Where a `record` operation goes: a layer registers a sink for its record (S1's decision log). */
  readonly sinks = new Map<string, (entries: unknown, at: GameTime, processId: string) => void>();

  constructor(private readonly k: Kernel) {}

  register(def: ProcessDef): void {
    if (!(def.period >= 1) || !Number.isInteger(def.period)) throw new Error('a process period is a whole number of windows, at least 1');
    if (this.processes.has(def.id)) throw new Error(`process already registered: ${def.id}`);
    this.processes.set(def.id, def);
    if (!this.states.has(def.id)) this.states.set(def.id, { id: def.id, state: null, outstanding: [] });
  }

  /** A process's own state as of the last applied boundary, or what `init` gives before any state has applied (V4-35). */
  ownOf<S = any>(def: ProcessDef): S | undefined {
    const st = this.states.get(def.id);
    if (st && st.state !== null && st.state !== undefined) return (def.cloneState ? def.cloneState(st.state) : structuredClone(st.state)) as S;
    if (def.init) return def.init({ worldSeed: this.k.worldSeed }) as S;
    return undefined;
  }

  /**
   * A process's last published digest, as of the last applied boundary (V4-36, V4-42). Registered reads and
   * hooks read it here; it is the same after a load (V4-49). The answer is a copy: nothing can edit it.
   */
  digestOf<D = any>(processId: string): D | undefined {
    const st = this.states.get(processId);
    return st && st.digest !== undefined ? (structuredClone(st.digest) as D) : undefined;
  }

  /**
   * The last published digest itself, for a reader that only looks at it: it is replaced when a batch applies and never edited in place, so
   * looking costs nothing. `digestOf` is the copy, for a reader that may keep or change what it gets.
   */
  digestPeek<D = any>(processId: string): D | undefined {
    return this.states.get(processId)?.digest as D | undefined;
  }

  stateOf(id: string): ProcessState {
    let s = this.states.get(id);
    if (!s) this.states.set(id, (s = { id, state: null, outstanding: [] }));
    return s;
  }

  /** Queue an external operation (a reading, an observation, a seed operation). Stale epochs are refused. */
  submit(env: Envelope): SubmitResult {
    if (env.epoch !== this.k.epoch) return { accepted: false, reason: 'the operation was created in an earlier epoch' };
    const key = canonicalKey(env.op);
    let ord = 0;
    for (const q of this.queue) if (q.stamp === env.stamp && canonicalKey(q.op) === key) ord++;
    const id = H(hs('xop'), hi(env.stamp), hrec(env.op), hi(ord));
    this.queue.push({ ...env, id });
    return { accepted: true, id };
  }

  get queued(): readonly QueuedOp[] {
    return this.queue;
  }

  clearQueue(): void {
    this.queue = [];
  }

  // ---- advancing ----

  /**
   * The next boundary, if it falls at or before `t`. The engine takes boundaries one at a time, in order,
   * from the persisted cursor (spec 9.4), and does a boundary's consequences before the next (SPEC-NOTES 56).
   */
  nextBoundary(t: GameTime): number | undefined {
    const b = this.cursor + 1;
    return b * this.k.config.wSim <= t ? b : undefined;
  }

  /** Process the next boundary: its operations apply and its crossings and belief hooks are queued. Returns the work units used. */
  stepBoundary(report: AdvanceReport): number {
    const b = this.cursor + 1;
    const cost = this.processBoundary(b, report);
    this.cursor = b;
    report.boundaries++;
    return cost;
  }

  /** Every boundary up to the target is done: the engine time moves to the target, and the validity crossings up to it are queued. */
  finishAdvance(t: GameTime): void {
    this.k.now = Math.max(this.k.now, t);
    this.k.groups.crossTo(this.k.now);
  }

  private processBoundary(b: number, report: AdvanceReport): number {
    const k = this.k;
    const W = k.config.wSim;
    const T = b * W;
    k.now = T;
    k.groups.crossTo(T);
    let cost = 1;

    // 1. Apply the outputs of every run whose span ends here, by tier then id.
    const due: Array<{ def: ProcessDef | undefined; state: ProcessState; batch: OutstandingBatch }> = [];
    for (const state of this.states.values()) {
      const def = this.processes.get(state.id);
      for (const batch of state.outstanding) if (batch.spanEnd <= b) due.push({ def, state, batch });
    }
    due.sort((x, y) => (x.def?.tier ?? 0) - (y.def?.tier ?? 0) || (x.state.id < y.state.id ? -1 : x.state.id > y.state.id ? 1 : 0) || x.batch.k - y.batch.k);
    for (const d of due) {
      for (const op of d.batch.ops) {
        try {
          this.applyProcessOp(op, d.state.id, T);
        } catch (err) {
          k.defects.record({ kind: 'op-refused', detail: `process ${d.state.id}: ${(err as Error).message}` });
        }
        report.applied++;
        cost++;
      }
      // The state and the digest the batch carries replace the process's own, atomically with its operations
      // (V4-35, V4-36); a batch without one leaves it alone.
      if ('state' in d.batch) d.state.state = d.batch.state;
      if ('digest' in d.batch) {
        d.state.digest = d.batch.digest;
        d.def?.applied?.(d.state.digest);
      }
      d.state.outstanding = d.state.outstanding.filter((x) => x !== d.batch);
    }
    // The Ids the outstanding batches name are retention roots (SPEC-NOTES 33), so a batch leaving them changes
    // what is retained, and the caches that depend on it, as a write does.
    if (due.length > 0) k.bump();

    // 2. Apply the external operations stamped before this boundary (the window that just ended), by timestamp then Id.
    const ready = this.queue.filter((q) => q.stamp < T).sort((x, y) => x.stamp - y.stamp || cmpId(x.id, y.id));
    if (ready.length > 0) {
      this.queue = this.queue.filter((q) => q.stamp >= T);
      for (const q of ready) {
        if (q.stamp < T - W) {
          this.lateOps++;
          k.defects.record({ kind: 'late-op', detail: `an operation stamped ${q.stamp} was applied at boundary ${T}` });
        }
        try {
          this.applyExternal(q);
        } catch (err) {
          k.defects.record({ kind: 'op-refused', detail: `external operation: ${(err as Error).message}` });
        }
        report.applied++;
        cost++;
      }
    }

    // 2b. What the operations of this boundary queued (frame work, relevance dispatch) runs to its end before the snapshot, so a fine-tier
    // process judges demand after a reading of V's cell has opened its frames (S1 10.2: the window V arrives in is covered).
    if (due.length > 0 || ready.length > 0) k.settleInputs();

    // 3. Take the snapshot and start the processes whose window this is (coarse tiers first).
    const starting = [...this.processes.values()].sort((x, y) => x.tier - y.tier || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    const started: Array<{ id: string; batch: OutstandingBatch }> = [];
    for (const def of starting) {
      if (((b % def.period) + def.period) % def.period !== 0) continue;
      if (def.tier >= 3 && !k.frames.demandReachesAt(def.tier, T) && !(def.demandLookback && k.frames.demandOverlaps(def.tier, T - def.demandLookback * W, T))) continue;
      const ctx = newOpCtx(k.config.allowance);
      const pctx: ProcessCtx = {
        k: b, processId: def.id, worldSeed: k.worldSeed, windowStart: T, wSim: W,
        read: (node, path, at = T) => k.resolver.resolveWithin(ctx, node, path, at),
        value: (node, path, at = T) => {
          const r = k.resolver.resolveWithin(ctx, node, path, at);
          return r.status === 'ok' || r.status === 'contradiction' ? r.value : undefined;
        },
        rand: (...key) => rand(hs('proc'), hid(k.worldSeed), hs(def.id), hi(b), ...key),
        procRand: (w, ...key) => rand(hs('proc'), hid(k.worldSeed), hs(def.id), hi(w), ...key),
        query: (q) => k.queries.run(q),
        observedAt: (node, at) => k.observedAt(node, at),
        own: <S>() => this.ownOf<S>(def),
        digest: <D>(processId: string) => this.digestOf<D>(processId),
        demanded: (tier) => k.frames.demanded(tier),
      };
      let ops: ProcessOp[] = [];
      let result: ProcessResult | null = null;
      try {
        const out = def.run(pctx, b);
        if (Array.isArray(out)) ops = out;
        else {
          ops = out.ops;
          result = out;
        }
      } catch (e) {
        if (!(e instanceof LimitExceeded)) throw e;
        k.defects.record({ kind: 'limit', detail: `process ${def.id}: ${e.message}` });
      }
      // Held back until every starting process has read the boundary snapshot (spec 9.4: one shared snapshot,
      // double buffered). Publishing a batch adds retention roots, which can move structural constraints.
      const batch: OutstandingBatch = { k: b, spanEnd: b + def.period, ops };
      if (result && result.state !== undefined) batch.state = result.state;
      if (result && result.digest !== undefined) batch.digest = result.digest;
      started.push({ id: def.id, batch });
      report.runs++;
      cost += 1 + ctx.allowance.used;
    }
    // Publish the new batches together. A batch joining the outstanding ones adds roots to retention without any
    // other write, and at boundary 0 the engine time does not move either, so the revision moves: the retained set
    // and every cache that depends on it (resolutions, candidate sets, item descriptors) are then recomputed
    // (SPEC-NOTES 53).
    if (started.length > 0) {
      for (const st of started) this.stateOf(st.id).outstanding.push(st.batch);
      k.bump();
    }
    k.beliefs.onBoundary(b, T);
    k.layer2?.onBoundary(b, T);
    return cost;
  }

  // ---- applying operations ----

  private applyProcessOp(op: ProcessOp, processId: string, T: GameTime): void {
    const k = this.k;
    const cause = processCause(processId);
    switch (op.op) {
      case 'pin': {
        const spec: PinSpec = { node: op.node, slot: op.slot, reason: 'committed', cause, at: T };
        if (op.value !== undefined) spec.value = op.value;
        if (op.region !== undefined) spec.region = op.region;
        if (op.valid) spec.valid = op.valid;
        k.pin(spec);
        break;
      }
      case 'withdraw':
        k.withdrawPin(op.pin, cause, T);
        break;
      case 'contribute': {
        const spec: ContributionSpec = {
          source: { layer: op.layer ?? 'simulation', origin: processId }, target: op.target, form: op.form, mode: op.mode,
        };
        if (op.strength !== undefined) spec.strength = op.strength;
        if (op.valid) spec.valid = op.valid;
        if (op.silent) spec.silent = true;
        k.contribute(spec);
        break;
      }
      case 'end-contribution':
        k.endContribution(op.id, T);
        break;
      case 'edge': {
        const spec: EdgeSpec = { type: op.type, from: op.from, to: op.to, cause: op.cause ?? cause };
        if (op.id !== undefined) spec.id = op.id;
        if (op.attrs) spec.attrs = op.attrs;
        if (op.valid) spec.valid = op.valid;
        k.addEdge(spec);
        break;
      }
      case 'end-edge':
        k.endEdge(op.id, T);
        break;
      case 'mint-event':
        k.events.mintEvent({ ...op.spec, creator: op.spec.creator ?? cause, cause: op.spec.cause ?? cause });
        break;
      case 'mint-summary':
        k.summaries.mintSummary({ ...op.spec, creator: op.spec.creator ?? cause, cause: op.spec.cause ?? cause });
        break;
      case 'materialise-item': {
        const h = k.persistence.restoreReferencedHeader(op.item);
        if (!h || h.origin.by !== 'minted') throw new Error(`unknown summary item: ${op.item}`);
        k.events.setMaterialisation(op.item, { descriptor: h.origin.creator, materialisation: processId });
        break;
      }
      case 'publish-item':
        k.events.publishItem(op.item);
        break;
      case 'frame-open':
        k.frames.open(op.frame);
        break;
      case 'frame-status':
        k.frames.setStatus(op.frame, op.status, op.cause);
        break;
      case 'frame-weight':
        k.frames.setWeight(op.frame, op.weight, op.cause);
        break;
      case 'frame-interests':
        k.frames.setInterests(op.frame, op.own, op.cause);
        break;
      case 'decide':
        k.groups.decide(op.leader, op.group, op.decision);
        break;
      case 'order':
        k.groups.issueOrder({ groupFrame: op.groupFrame, member: op.member, goal: op.goal, pressure: op.pressure, cause });
        break;
      case 'observe':
        k.observeAs(op.observer, op.node, op.slot, op.at, op.evidence);
        break;
      case 'tell':
        k.beliefs.tellAs(op.teller, op.listener, op.belief, op.event, op.operator);
        break;
      case 'belief-set':
        k.beliefs.set(op.belief);
        break;
      case 'belief-drop':
        k.beliefs.drop(op.believer, op.belief);
        break;
      case 'record': {
        const sink = this.sinks.get(op.owner);
        if (!sink) throw new Error(`no record sink for ${op.owner}`);
        sink(op.entries, T, processId);
        break;
      }
    }
  }

  private applyExternal(q: QueuedOp): void {
    const k = this.k;
    const op = q.op;
    switch (op.op) {
      case 'reading':
        k.reading(op.node, op.slot, op.value, q.stamp);
        break;
      case 'observe':
        k.observeReading(op.node, op.slot, op.at, op.cause, op.evidence);
        break;
      case 'pin':
        k.pin({ ...op.spec, at: q.stamp });
        break;
      case 'event':
        k.events.mintEvent(op.spec);
        break;
    }
  }

  // ---- persistence support ----

  restore(states: ProcessState[], cursor: number): void {
    this.states.clear();
    for (const s of states) this.states.set(s.id, copyState(s));
    for (const def of this.processes.values()) if (!this.states.has(def.id)) this.states.set(def.id, { id: def.id, state: null, outstanding: [] });
    this.cursor = cursor;
    this.queue = [];
  }

  snapshotStates(): ProcessState[] {
    return [...this.states.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map(copyState);
  }
}
