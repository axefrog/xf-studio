// Reputation through carriers (S1 8.6, 7.7). The ledger is the set of carriers' beliefs: there is no second store. A carrier is a node
// whose beliefs stand for an audience (the stallholders' circle, the Tyger Claws, the district). One evidence item is one belief held by
// the carrier about the subject on the path `rep-<axis>[i]`, with `at` the event's time, a confidence, a salience and a value
// `[v, reach]` on the 1/64 grid. Standing does not decay by absence: the aggregate reads no clock, and carrier evidence does not fade.

import type { Belief } from '../beliefs.ts';
import { ln } from '../fdlibm-log.ts';
import { processCause } from '../evolution.ts';
import type { ProcessOp } from '../evolution.ts';
import type { GameTime, Id } from '../types.ts';
import { clamp, q64 } from './arith.ts';
import type { LedgerData } from './data.ts';
import { type DigestBase, type Feed, type Transition, pushFeed } from './occ.ts';
import type { S1Ctx, S1Process, S1Result } from './s1ctx.ts';
import type { Sim } from './sim.ts';
import { simulatedDistricts } from './index-types.ts';

export interface LedgerItem {
  id: Id;
  at: GameTime;
  v: number;
  reach: number;
  salience: number;
  confidence: number;
  tellerDiscount: number;
  /** The canonical origin it cites. */
  origin: Id;
  index: number;
}

export interface Aggregate {
  value?: number;
  mass: number;
  items: number;
  /** The unrounded `(r + 1) / (r + q + 2)`, used for the label. */
  E: number;
  r: number;
  q: number;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export const BAND_LABELS = ['unknown', 'low', 'mid', 'high'] as const;

/** The aggregate of a sorted list of items (S1 8.6): older items are displaced in expectation, and each addition is the expected one. */
export function aggregateItems(items: readonly LedgerItem[], cfg: LedgerData): Aggregate {
  const sorted = [...items].sort((a, b) => a.at - b.at || cmp(a.id, b.id));
  let r = 0;
  let q = 0;
  for (const e of sorted) {
    const scale = 1 - e.reach * (1 - cfg.lambda);
    r = r * scale;
    q = q * scale;
    const w = cfg.salW[e.salience]! * e.confidence * e.tellerDiscount * e.reach;
    r = r + w * Math.max(0, e.v);
    q = q + w * Math.max(0, -e.v);
  }
  const E = (r + 1) / (r + q + 2);
  return { value: q64(E), mass: r + q, items: sorted.length, E, r, q };
}

/** The resident's own belief: the same sum over the items they know, with the full conditional weight and a displacement only when known (S1 8.6). */
export function residentSum(items: readonly LedgerItem[], cfg: LedgerData, knows: (item: LedgerItem) => boolean): { r: number; q: number } {
  let r = 0;
  let q = 0;
  for (const e of [...items].sort((a, b) => a.at - b.at || cmp(a.id, b.id))) {
    if (!knows(e)) continue;
    r = r * cfg.lambda;
    q = q * cfg.lambda;
    const w = cfg.salW[e.salience]! * e.confidence * e.tellerDiscount;
    r = r + w * Math.max(0, e.v);
    q = q + w * Math.max(0, -e.v);
  }
  return { r, q };
}

/** The label of an aggregate: `unknown` under the mass floor, else by the unrounded `E` (S1 8.6). */
export function labelOf(a: Aggregate, cfg: LedgerData): 0 | 1 | 2 | 3 {
  if (a.mass < cfg.m0) return 0;
  return a.E >= cfg.highAt ? 3 : a.E >= cfg.midAt ? 2 : 1;
}

/** The ledger's reads over the kernel's beliefs. */
export class Ledger {
  constructor(private readonly sim: Sim) {}

  private get cfg(): LedgerData {
    return this.sim.data.ledger;
  }

  /** The carrier node of a carrier definition in a district (S1 8.6). */
  carrierNode(carrierId: string, district: Id): Id {
    const def = this.cfg.carriers.find((c) => c.id === carrierId)!;
    if (def.type === 'circle') return this.sim.w.circle(district);
    if (def.type === 'group') return this.sim.w.group(district, def.aff!);
    return district;
  }

  carriers(): Array<{ id: string; district: Id; node: Id }> {
    const out: Array<{ id: string; district: Id; node: Id }> = [];
    for (const d of simulatedDistricts(this.sim.w.index)) for (const c of this.cfg.carriers) out.push({ id: c.id, district: d.id, node: this.carrierNode(c.id, d.id) });
    return out;
  }

  /** The items a carrier holds about a subject on an axis with `at <= t`. */
  itemsOf(carrier: Id, subject: Id, axis: string, t: GameTime = Number.POSITIVE_INFINITY): LedgerItem[] {
    const out: LedgerItem[] = [];
    const prefix = `rep-${axis}[`;
    for (const b of this.sim.k.beliefs.activeOf(carrier)) {
      if (b.subject !== subject || !b.path.startsWith(prefix) || (b.at ?? 0) > t) continue;
      const v = b.value as number[] | undefined;
      if (!v) continue;
      out.push({
        id: b.id, at: b.at ?? 0, v: v[0]!, reach: v[1]!, salience: b.salience ?? 0, confidence: b.confidence, tellerDiscount: this.cfg.tellerDiscount,
        origin: b.evidence[0]!, index: Number(b.path.slice(prefix.length, -1)),
      });
    }
    return out;
  }

  /** `aggregate(audience, subject, path, t)`: the carriers' items merged; one origin across carriers keeps the one with the larger reach (S1 8.6). */
  aggregate(carriers: readonly Id[], subject: Id, axis: string, t: GameTime): Aggregate {
    const best = new Map<Id, LedgerItem>();
    for (const c of carriers) {
      for (const it of this.itemsOf(c, subject, axis, t)) {
        const have = best.get(it.origin);
        if (!have || it.reach > have.reach) best.set(it.origin, it);
      }
    }
    return aggregateItems([...best.values()], this.cfg);
  }
}

export interface LedgerState {
  v: 1;
  handledSeq: number;
  /** Key `carrier|subject|axis`; band 0 unknown, 1 low, 2 mid, 3 high. */
  labels: Record<string, number>;
}

export interface LedgerDigest extends DigestBase {
  /** By carrier node, then axis, for subject V: the band and the aggregate's mass and item count. */
  labels: Record<Id, Record<string, { band: string; mass: number; items: number }>>;
  changes: Feed<Transition>;
}

export function ledgerProcess(sim: Sim): S1Process<LedgerState, LedgerDigest> {
  const procId = 'order.ledger';
  const W = sim.data.time.W;
  void processCause;
  return {
    id: procId, version: 1, tier: 1, coarseFine: { kind: 'distribution', tolerance: '0.1 absolute' }, lag: 0,
    init: () => ({ v: 1, handledSeq: -1, labels: {} }),
    run(c: S1Ctx, k: number): S1Result<LedgerState, LedgerDigest> {
      const st = c.own<LedgerState>();
      const ops: ProcessOp[] = [];
      const changes: Transition[] = [];
      const rec = c.record();
      const dirty = rec.dirty.filter((d) => d.seq > st.handledSeq).sort((a, b) => a.seq - b.seq);
      const seen = new Set<string>();
      for (const d of dirty) {
        const key = `${d.carrier}|${d.subject}|${d.axis}`;
        st.handledSeq = Math.max(st.handledSeq, d.seq);
        if (seen.has(key)) continue;
        seen.add(key);
        const agg = sim.ledger.aggregate([d.carrier], d.subject, d.axis, c.T);
        const band = labelOf(agg, sim.data.ledger);
        const prev = st.labels[key] ?? 0;
        st.labels[key] = band;
        if (band !== prev) {
          const standing = sim.w.standingOfCarrier(d.carrier);
          ops.push({ op: 'pin', node: standing, slot: `label-${d.axis}@w${k + 1}`, value: BAND_LABELS[band]! });
          changes.push({ key: `label|${d.carrier}|${d.axis}`, t: c.T + W, value: BAND_LABELS[band]!, prev: BAND_LABELS[prev]! });
        }
      }
      const labels: LedgerDigest['labels'] = {};
      for (const car of sim.ledger.carriers()) {
        for (const axis of sim.data.ledger.axes) {
          const agg = sim.ledger.aggregate([car.node], sim.w.v, axis, Number.POSITIVE_INFINITY);
          const band = st.labels[`${car.node}|${sim.w.v}|${axis}`] ?? 0;
          (labels[car.node] ??= {})[axis] = { band: BAND_LABELS[band]!, mass: agg.mass, items: agg.items };
        }
      }
      const prevDigest = c.digest<LedgerDigest>(procId);
      return { ops, state: st, digest: { v: 1, through: k, labels, changes: pushFeed(prevDigest?.changes, k, changes, sim.data.feed.keep) } };
    },
  };
}

export { clamp, ln };
export type { Belief };
