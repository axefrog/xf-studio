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
import type { SummarySpec } from './summary.ts';
import { newOpCtx } from './resolve.ts';
import type { Form, GameTime, Id, Query, QueryOutcome, Region, ResolveResult, Selector, SlotPath, Tier, Value } from './types.ts';
import { LimitExceeded } from './work.ts';

export type ProcessOp =
  | { op: 'pin'; node: Id; slot: SlotPath; value?: Value; region?: Region; valid?: { from?: GameTime; to?: GameTime } }
  | { op: 'withdraw'; pin: Id }
  | {
      op: 'contribute'; layer?: 'simulation' | 'procedural'; target: Selector; form: Form;
      mode: ContributionSpec['mode']; strength?: number; valid?: { from?: GameTime; to?: GameTime };
    }
  | { op: 'end-contribution'; id: Id }
  | { op: 'edge'; type: string; from: Id; to: Id; attrs?: Record<string, Value>; valid?: { from?: GameTime; to?: GameTime } }
  | { op: 'end-edge'; id: Id }
  | { op: 'mint-event'; spec: Omit<EventSpec, 'creator' | 'cause'> }
  | { op: 'mint-summary'; spec: Omit<SummarySpec, 'creator' | 'cause'> };

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
  /** Process randomness: rand("proc", worldSeed, processId, k, ...key) (spec 9.4). */
  rand(...key: HArg[]): number;
  query(q: Query): QueryOutcome;
}

export interface ProcessDef {
  id: string;
  tier: Tier;
  /** n: the process runs when k mod n = 0, and computes windows k to k + n - 1. */
  period: number;
  run(ctx: ProcessCtx, k: number): ProcessOp[];
}

export interface OutstandingBatch {
  /** The window the run started at. */
  k: number;
  /** The boundary index at which the batch applies. */
  spanEnd: number;
  ops: ProcessOp[];
}

export interface ProcessState {
  id: string;
  /** Plain data the process keeps between runs (S1's). */
  state: unknown;
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

export class Evolution {
  readonly processes = new Map<string, ProcessDef>();
  readonly states = new Map<string, ProcessState>();
  /** The index of the last boundary processed (-1 before the first). */
  cursor = -1;
  private queue: QueuedOp[] = [];
  /** Operations applied at boundaries after their window (a diagnostic, never a policy). */
  lateOps = 0;

  constructor(private readonly k: Kernel) {}

  register(def: ProcessDef): void {
    if (!(def.period >= 1) || !Number.isInteger(def.period)) throw new Error('a process period is a whole number of windows, at least 1');
    if (this.processes.has(def.id)) throw new Error(`process already registered: ${def.id}`);
    this.processes.set(def.id, def);
    if (!this.states.has(def.id)) this.states.set(def.id, { id: def.id, state: null, outstanding: [] });
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

    // 3. Take the snapshot and start the processes whose window this is (coarse tiers first).
    const starting = [...this.processes.values()].sort((x, y) => x.tier - y.tier || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    const started: Array<{ id: string; batch: OutstandingBatch }> = [];
    for (const def of starting) {
      if (((b % def.period) + def.period) % def.period !== 0) continue;
      if (def.tier >= 3 && !k.frames.demandReachesAt(def.tier, T)) continue;
      const ctx = newOpCtx(k.config.allowance);
      const pctx: ProcessCtx = {
        k: b, processId: def.id, worldSeed: k.worldSeed, windowStart: T, wSim: W,
        read: (node, path, at = T) => k.resolver.resolveWithin(ctx, node, path, at),
        value: (node, path, at = T) => {
          const r = k.resolver.resolveWithin(ctx, node, path, at);
          return r.status === 'ok' || r.status === 'contradiction' ? r.value : undefined;
        },
        rand: (...key) => rand(hs('proc'), hid(k.worldSeed), hs(def.id), hi(b), ...key),
        query: (q) => k.queries.run(q),
      };
      let ops: ProcessOp[] = [];
      try {
        ops = def.run(pctx, b);
      } catch (e) {
        if (!(e instanceof LimitExceeded)) throw e;
        k.defects.record({ kind: 'limit', detail: `process ${def.id}: ${e.message}` });
      }
      // Held back until every starting process has read the boundary snapshot (spec 9.4: one shared snapshot,
      // double buffered). Publishing a batch adds retention roots, which can move structural constraints.
      started.push({ id: def.id, batch: { k: b, spanEnd: b + def.period, ops } });
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
        k.contribute(spec);
        break;
      }
      case 'end-contribution':
        k.endContribution(op.id, T);
        break;
      case 'edge': {
        const spec: EdgeSpec = { type: op.type, from: op.from, to: op.to, cause };
        if (op.attrs) spec.attrs = op.attrs;
        if (op.valid) spec.valid = op.valid;
        k.addEdge(spec);
        break;
      }
      case 'end-edge':
        k.endEdge(op.id, T);
        break;
      case 'mint-event':
        k.events.mintEvent({ ...op.spec, creator: cause, cause });
        break;
      case 'mint-summary':
        k.summaries.mintSummary({ ...op.spec, creator: cause, cause });
        break;
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
    for (const s of states) this.states.set(s.id, { id: s.id, state: s.state, outstanding: s.outstanding.map((b) => ({ ...b, ops: [...b.ops] })) });
    for (const def of this.processes.values()) if (!this.states.has(def.id)) this.states.set(def.id, { id: def.id, state: null, outstanding: [] });
    this.cursor = cursor;
    this.queue = [];
  }

  snapshotStates(): ProcessState[] {
    return [...this.states.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map((s) => ({ id: s.id, state: s.state, outstanding: s.outstanding.map((b) => ({ ...b, ops: [...b.ops] })) }));
  }
}
