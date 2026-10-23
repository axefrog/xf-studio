// `order.norms` (S1 7.5): per district and norm, what people privately support, what they do, and what they believe others do. It
// mints the enforcement that follows from non-compliance, and separates public from private acts. A norm is data: a behaviour, a
// sector, enforcers, two threshold histograms (empirical and normative), a cost and a ladder. `perc` is a perspective on the
// district, not world truth. Only a public act moves it: one in a public place with enough witnesses who saw each other. A private
// act moves only its witnesses' beliefs (S0 F-25).

import { processCause } from '../evolution.ts';
import type { ProcessOp } from '../evolution.ts';
import { mintedId } from '../id.ts';
import type { GameTime, Id } from '../types.ts';
import { clip01, invCum, spacingCount } from './arith.ts';
import type { NormDef } from './data.ts';
import { type DigestBase, type EventFact, type Feed, type Transition, pushTransitions, pushFeed } from './occ.ts';
import type { CastEntry, Descriptor } from './occ.ts';
import { PROCESS_VERSIONS, type S1Ctx, type S1Process, type S1Result } from './s1ctx.ts';
import type { Sim } from './sim.ts';
import { simulatedDistricts } from './index-types.ts';
import { ceilingOf } from '../settings.ts';

export interface NormSlots {
  priv: number;
  beh: number;
  perc: number;
  /** The last relaxation's values. */
  qe: number;
  qn: number;
  /** A public event's implication, and the first window it acts. */
  signal?: { value: number; event: Id; from: number };
  /** Windows of public enforcement of this norm in the last 144, oldest first. */
  pub: number[];
  gap: 0 | 1 | 2;
  gapSince: number;
}

export interface NormsState {
  v: 1;
  /** Key: district Id + "|" + norm id. */
  slots: Record<string, NormSlots>;
  /** External enforcement events already taken as signals, at most 256. */
  seen: Id[];
  /** This process's events of the last week. */
  ring: Array<{ id: Id; w: number; time: GameTime; cell: Id; norm: string; rung: string; qe: number; qn: number }>;
  next: number;
}

export interface NormsDigest extends DigestBase {
  norms: Record<Id, Record<string, { priv: number; beh: number; perc: number; vis: number; gap: number }>>;
  /** Enforcement events this process minted (creator `norms`, with norm, rung, enforcer). */
  facts: Feed<EventFact>;
  changes: Feed<Transition>;
}

const GAP_NAMES = ['aligned', 'gap', 'wide'] as const;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One relaxation of a norm's slots (S1 7.5): the behaviour settles for the current perception and signal, then the perception moves once. */
export function relax(slots: NormSlots, norm: NormDef, w: number, vis: number): void {
  let b = slots.beh;
  let qe = slots.beh;
  let qn = slots.qn;
  const sig = slots.signal;
  for (let it = 0; it < 4; it++) {
    const phi = sig === undefined || w < sig.from ? 0 : w === sig.from ? norm.phiPublic : w - sig.from <= norm.signalMemory ? norm.phiBase : 0;
    const s = sig === undefined ? 0 : sig.value;
    qe = (1 - phi) * b + phi * s;
    qn = clip01(slots.perc * (1 - norm.nu) + vis * norm.nu);
    b = 0;
    for (let j = 0; j < 8; j++) b = b + norm.share[j]! * (qe >= norm.taue[j]! && qn >= norm.taun[j]! ? 1 : 0);
  }
  slots.beh = b;
  slots.qe = qe;
  slots.qn = qn;
  slots.perc = slots.perc + norm.eta * (qe - slots.perc);
}

/** The band of the gap between private support and perceived support, with hysteresis (S1 7.5). */
export function gapBand(cur: 0 | 1 | 2, gap: number, norm: NormDef): 0 | 1 | 2 {
  const [gEnter, gLeave] = norm.gapBands.gap;
  const [wEnter, wLeave] = norm.gapBands.wide;
  if (gap >= wEnter) return 2;
  if (cur === 2) {
    if (gap < wLeave) return gap < gLeave ? 0 : 1;
    return 2;
  }
  if (gap >= gEnter) return 1;
  if (cur === 1 && gap < gLeave) return 0;
  return cur;
}

/** The resident type of a person for a norm: their share and thresholds (S1 7.5). */
export const residentType = (sim: Sim, norm: NormDef, res: Id): number => invCum(norm.share, sim.ids.ntype(norm.id, res));

/** A resident complies if `qe >= taue[type]` and `qn >= taun[type]` (S1 7.5). */
export const complies = (sim: Sim, norm: NormDef, res: Id, qe: number, qn: number): boolean => {
  const j = residentType(sim, norm, res);
  return qe >= norm.taue[j]! && qn >= norm.taun[j]!;
};

const classIndexOfAff = (aff: 'A1' | 'A2' | 'A3'): number => ({ A1: 2, A2: 3, A3: 4 })[aff];

/** Cast an enforcement event: an enforcer of the enforcing affiliation and roles, a target among adult civilian non-compliers (S1 7.5). */
export const castEnforcement = (sim: Sim, norm: NormDef, d: Descriptor, qe: number, qn: number, harm: boolean): CastEntry[] | 'no-cast' => {
  const present = sim.people.presentAt(d.cell, d.time, sim.data.people.presentCap);
  const eligibleE: Id[] = [];
  const eligibleT: Id[] = [];
  for (const r of present) {
    const v = sim.people.view(r);
    if (!v || v.ageClass !== 'adult') continue;
    if (v.affc === classIndexOfAff(norm.enforcer.aff) && norm.enforcer.roles.includes(v.role)) eligibleE.push(r);
    else if (v.affc === 0 && (norm.sector === null || norm.sector.includes(v.role)) && !complies(sim, norm, r, qe, qn) && !(harm && sim.people.protectedAt(r, d.time))) eligibleT.push(r);
  }
  if (eligibleE.length === 0 || eligibleT.length === 0) return 'no-cast';
  const e = eligibleE[Math.floor(sim.ids.castWho(d.id, 'enforcer', 0) * eligibleE.length)]!;
  const t = eligibleT[Math.floor(sim.ids.castWho(d.id, 'target', 0) * eligibleT.length)]!;
  return [{ role: 'enforcer', who: e }, { role: 'target', who: t }];
};

export function normsProcess(sim: Sim): S1Process<NormsState, NormsDigest> {
  const procId = 'order.norms';
  const proc = processCause(procId);
  const W = sim.data.time.W;
  const DAY = 86400;
  const cfg = sim.data.norms;
  const norms = cfg.norms;
  const kindName = (n: string, r: string): string => `enf.${n}.${r}`;
  const rawKinds = norms.flatMap((n) => n.ladder.map((r) => kindName(n.id, r.rung)));

  return {
    id: procId, version: PROCESS_VERSIONS[procId]!, tier: 1, coarseFine: { kind: 'distribution', tolerance: '10%' }, lag: 0,
    init: () => {
      const slots: NormsState['slots'] = {};
      for (const d of simulatedDistricts(sim.w.index)) {
        for (const n of norms) slots[`${d.id}|${n.id}`] = { priv: n.priv0, beh: n.beh0, perc: n.perc0, qe: n.beh0, qn: n.perc0, pub: [], gap: 0, gapSince: 0 };
      }
      return { v: 1, slots, seen: [], ring: [], next: 0 };
    },

    run(c: S1Ctx, w: number): S1Result<NormsState, NormsDigest> {
      const st = c.own<NormsState>();
      const T = c.T;
      const ops: ProcessOp[] = [];
      const facts: EventFact[] = [];
      const changes: Transition[] = [];
      const p = sim.people.periodOf(T);
      const seen = new Set(st.seen);

      // external enforcement events, by query, taken once (the find-and-deduplicate rule of S1 7.3)
      const q = c.pctx.query({
        find: 'core:event', scope: { under: sim.w.city }, at: T, limit: 'all',
        must: [{ path: 'kind', op: 'in', arg: rawKinds }, { path: 'time', op: 'range', arg: [sim.windowStart(Math.max(0, w - 6)), T - 1] }],
      });
      const external = (q.status === 'ok' ? q.items : [])
        .map((it) => ({ id: it.id, time: c.pctx.value(it.id, 'time') as number, kind: c.pctx.value(it.id, 'kind') as string, place: c.pctx.value(it.id, 'place') as Id }))
        .filter((e) => !seen.has(e.id) && typeof e.time === 'number')
        .filter((e) => {
          const h = sim.k.store.header(e.id);
          return !(h?.origin.by === 'minted' && h.origin.creator === proc);
        })
        .sort((a, b) => a.time - b.time || cmp(a.id, b.id));

      const eventDigest = c.digest<{ regimes: unknown }>('city.events');
      void eventDigest;
      for (const d of simulatedDistricts(sim.w.index)) {
        for (const norm of norms) {
          const key = `${d.id}|${norm.id}`;
          const s = st.slots[key] ?? (st.slots[key] = { priv: norm.priv0, beh: norm.beh0, perc: norm.perc0, qe: norm.beh0, qn: norm.perc0, pub: [], gap: 0, gapSince: 0 });
          // (a) the fresh external public events set their signals
          for (const e of external) {
            if (!e.kind.startsWith(`enf.${norm.id}.`)) continue;
            const cell = sim.w.index.cells[e.place];
            if (!cell || cell.district !== d.id) continue;
            seen.add(e.id);
            st.seen.push(e.id);
            const wc = c.pctx.value(e.id, 'witnesses#count', e.time);
            const witnesses = typeof wc === 'number' ? wc : 0;
            if (cell.public === 'public' && witnesses >= cfg.publicMinWitnesses) {
              s.signal = { value: norm.signalValue, event: e.id, from: w };
              s.pub.push(w);
            }
          }
          // (b) enforce, from the behaviour as the snapshot held it
          const pending: Array<{ id: Id; time: GameTime }> = [];
          const share = (() => {
            const aff = d.affOrder[classIndexOfAff(norm.enforcer.aff)]!;
            return (d.entry.byAff.find((b) => b.aff === aff)?.q ?? 0) / d.entry.total;
          })();
          const mu = norm.enforcePerDay * (W / DAY) * (1 - s.beh) * Math.min(1, share / 0.05);
          const n = spacingCount(mu, (i) => c.keys.enf(w, d.id, norm.id, i), cfg.enforceCap);
          for (let i = 0; i < n; i++) {
            const allowed = norm.ladder.filter((r) => ceilingOf(c.settings, cfg.rungs.find((x) => x.name === r.rung)?.class ?? '') !== 0 || cfg.rungs.find((x) => x.name === r.rung)?.class === undefined);
            if (allowed.length === 0) continue;
            const rung = allowed[invCum(allowed.map((r) => r.weight), c.keys.rung(w, d.id, norm.id, i))]!.rung;
            const pubCells = d.cellIds.filter((cid) => sim.w.cell(cid).public === 'public');
            const cell = pubCells[invCum(pubCells.map((cid) => sim.w.cell(cid).pop[p]!), c.keys.ecell(w, d.id, norm.id, i))]!;
            const time = T + Math.floor(c.keys.et(w, d.id, norm.id, i) * W);
            const name = `enf/${w}/${d.id}/${norm.id}/${i}`;
            const id = mintedId(proc, proc, name);
            const kindN = kindName(norm.id, rung);
            const rungDef = cfg.rungs.find((x) => x.name === rung)!;
            const harm = sim.data.gate.harmEffects.includes(rungDef.effect);
            const desc: Descriptor = { id, kind: kindN, size: 1, w, time, cell, gen: 0, chain: [], public: false, witnesses: 0 };
            const cast = castEnforcement(sim, norm, desc, s.qe, s.qn, harm);
            if (cast === 'no-cast') {
              c.log({ w, proc: procId, kind: 'admission', reason: 'no-cast', refs: [id] });
              continue;
            }
            const pmean = sim.w.cell(cell).pop[sim.people.periodOf(time)]! * sim.data.events.witFraction;
            desc.witnesses = spacingCount(pmean, (j) => sim.ids.wit(id, j));
            desc.public = sim.w.cell(cell).public === 'public' && desc.witnesses >= cfg.publicMinWitnesses;
            const occ = {
              kind: kindN, origin: 'sim' as const, size: 1, window: w, cell,
              participants: cast.map((e) => ({ who: (e.who ?? e.group)!, role: e.role })),
              effects: cast.filter((e) => e.role === 'target').map((e) => ({ on: e.who!, effect: rungDef.effect })),
              creator: proc, tags: ['enforcement', `norm:${norm.id}`],
            };
            if (!c.produce(occ).ok) continue;
            ops.push({ op: 'mint-event', spec: { name, time, kind: kindN, place: cell, participants: occ.participants, effects: occ.effects, outcome: 'done' } });
            st.ring.push({ id, w, time, cell, norm: norm.id, rung, qe: s.qe, qn: s.qn });
            facts.push({
              id, kind: kindN, size: 1, w, time, cell, district: d.id, public: desc.public, witnesses: desc.witnesses, policeChild: false, creator: 'norms',
              norm: norm.id, rung, enforcer: classIndexOfAff(norm.enforcer.aff),
            });
            if (desc.public) pending.push({ id, time });
          }
          // (c) relax
          s.pub = s.pub.filter((x) => w - x < 144);
          const vis = Math.min(1, norm.visBase + s.pub.length / 4);
          relax(s, norm, w, vis);
          // (d) this window's own public events set their signals, from the next window
          pending.sort((a, b) => a.time - b.time || cmp(a.id, b.id));
          for (const e of pending) {
            s.signal = { value: norm.signalValue, event: e.id, from: w + 1 };
            s.pub.push(w);
          }
          // (e) the gap band
          const gap = Math.abs(s.priv - s.perc);
          const band = gapBand(s.gap, gap, norm);
          if (band !== s.gap) {
            ops.push({ op: 'pin', node: d.id, slot: `gap-${norm.id}@w${w + 1}`, value: GAP_NAMES[band]! });
            changes.push({ key: `gap|${norm.id}|${d.id}`, t: T + W, value: GAP_NAMES[band]!, prev: GAP_NAMES[s.gap]! });
            s.gap = band;
            s.gapSince = w + 1;
          }
        }
      }
      if (st.seen.length > 256) st.seen = st.seen.slice(st.seen.length - 256);
      st.ring = st.ring.filter((e) => w - e.w < 1008);
      facts.sort((a, b) => a.time - b.time || cmp(a.id, b.id));
      st.next += facts.length;
      const out: NormsDigest['norms'] = {};
      for (const d of simulatedDistricts(sim.w.index)) {
        out[d.id] = {};
        for (const norm of norms) {
          const s = st.slots[`${d.id}|${norm.id}`]!;
          out[d.id]![norm.id] = { priv: s.priv, beh: s.beh, perc: s.perc, vis: Math.min(1, norm.visBase + s.pub.length / 4), gap: s.gap };
        }
      }
      const prev = c.digest<NormsDigest>(procId);
      const keep = sim.data.feed.keep;
      return { ops, state: st, digest: { v: 1, through: w, norms: out, facts: pushFeed(prev?.facts, w, facts, keep), changes: pushTransitions(prev?.changes, w, changes, keep) } };
    },
  };
}
