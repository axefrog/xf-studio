// The process contract (S1 2): a process has a tier and a state, runs one window at a time, and returns its operations, its next
// state and its digest. This module defines the context a run is given and the wrapper that turns an S1 process into the kernel's
// process definition. Every process of the core has period 1.

import type { ProcessCtx, ProcessDef, ProcessOp, ProcessResult } from '../evolution.ts';
import { processCause } from '../evolution.ts';
import type { SettingsEntry } from '../settings.ts';
import type { GameTime, Id, Tier } from '../types.ts';
import type { S1Data } from './data.ts';
import { type ProcessKeys, processKeys } from './keys.ts';
import type { GateResult, LogDraft, Occurrence } from './occ.ts';
import type { S1Record } from './record.ts';
import type { Sim } from './sim.ts';

/**
 * The version of each process of the core (S1 1.4). Raise one when its behaviour changes: the versions are part of what a lineage pins, so
 * a save made under another version opens read-only instead of resuming old state under new code.
 */
export const PROCESS_VERSIONS: Record<string, number> = {
  'city.events': 2, 'group.decide': 2, 'order.stocks': 1, 'city.mirror': 1, 'order.ledger': 2, 'order.norms': 2, 'scene.acts': 1,
};

export type CoarseFine = { kind: 'exact' } | { kind: 'count' } | { kind: 'distribution'; tolerance: string };

export interface DemandedNode {
  node: Id;
  tier: Tier;
  claim: number;
}

export interface S1Ctx {
  readonly sim: Sim;
  readonly pctx: ProcessCtx;
  readonly processId: string;
  /** The window being computed: also the run's `k`. */
  readonly w: number;
  /** The start of the window, the time of the snapshot. */
  readonly T: GameTime;
  readonly data: S1Data;
  /** The `SettingsSet` in force at the snapshot (S1 3.3). */
  readonly settings: SettingsEntry;
  /** The process draws, keyed by the window (S0 V4-41). */
  readonly keys: ProcessKeys;
  /** The process's own cause Id, `proc(id)`. */
  readonly proc: Id;
  own<S>(): S;
  digest<D>(processId: string): D | undefined;
  record(): Readonly<S1Record>;
  demanded(tier: Tier): DemandedNode[];
  /** The gate (S1 6): a refusal is logged, never silent. */
  produce(o: Occurrence): GateResult;
  log(e: LogDraft): void;
  readonly logs: LogDraft[];
}

export interface S1Result<S, D> {
  ops: ProcessOp[];
  state: S;
  digest: D;
}

export interface S1Process<S, D> {
  id: string;
  version: number;
  tier: Tier;
  coarseFine: CoarseFine;
  /** Publication lag in windows (S1 9.4). */
  lag: number;
  /** A fine-tier process also runs for the demand of the windows just ended (kernel `demandLookback`). */
  demandLookback?: number;
  init(sim: Sim): S;
  /** A copy of the state for the run to change, sharing what the process never edits (see `ProcessDef.cloneState`). */
  cloneState?(state: S): S;
  run(c: S1Ctx, k: number): S1Result<S, D>;
}

/** The kernel process definition of an S1 process: period 1, with the context built from the kernel's. */
export function toProcessDef<S, D>(sim: Sim, p: S1Process<S, D>): ProcessDef {
  return {
    id: p.id,
    version: p.version,
    tier: p.tier,
    period: 1,
    coarseFine: p.coarseFine,
    lag: p.lag,
    ...(p.demandLookback ? { demandLookback: p.demandLookback } : {}),
    init: () => p.init(sim),
    ...(p.cloneState ? { cloneState: (state: unknown) => p.cloneState!(state as S) } : {}),
    run(pctx: ProcessCtx, k: number): ProcessResult {
      const logs: LogDraft[] = [];
      const T = pctx.windowStart;
      const settings = sim.k.settings.at(T);
      const c: S1Ctx = {
        sim, pctx, processId: p.id, w: k, T, data: sim.data, settings, keys: processKeys(pctx.procRand), proc: processCause(p.id),
        own: <X>() => pctx.own<X>() as X,
        digest: <X>(id: string) => pctx.digest<X>(id),
        record: () => sim.record,
        demanded: (tier) => pctx.demanded(tier),
        produce(o) {
          const r = sim.gate.produce(o, settings, T);
          if (!r.ok) logs.push({ w: k, proc: p.id, kind: 'gate', reason: r.reason, refs: o.participants.map((x) => x.who).slice(0, 4) });
          return r;
        },
        log: (e) => logs.push(e),
        logs,
      };
      const res = p.run(c, k);
      const ops = logs.length > 0 ? [...res.ops, { op: 'record' as const, owner: 's1', entries: logs }] : res.ops;
      return { ops, state: res.state, digest: res.digest };
    },
  };
}
