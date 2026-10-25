// `city.events` (S1 7.1, 7.2): the city's life, incidents, their causes and consequences. For every window, district and kind it
// decides how many incidents happen, how big, where, to whom. It keeps the aftershocks and the heat, publishes bands, owns the
// regimes and the service state, and owns production admission: one owner, one order, persisted budgets.
//
// A window, in order: the exits of regimes; the candidates (regime arrivals, immigrants, due children after their checks);
// admission; indexing of the size-1 incidents as summary items; the offspring of every admitted occurrence; heat, bands, service
// status and price; the ring is trimmed; the feed and the digest are written. Nothing here reads V, the demand or the game as it is now.

import { processCause } from '../evolution.ts';
import type { ProcessOp } from '../evolution.ts';
import { H, id as hid, i as hi, mintedId, s as hs } from '../id.ts';
import { itemTime } from '../summary.ts';
import type { GameTime, Id } from '../types.ts';
import { clamp, invCum, nbCount, spacingCount, splitCountR } from './arith.ts';
import type { Boosts } from './cast.ts';
import type { KindName } from './data.ts';
import { type CastEntry, type Descriptor, type DigestBase, type EventFact, type Feed, type PendingChild, type RingEntry, type Transition, pushTransitions, pushFeed } from './occ.ts';
import type { GroupDigest } from './proc-groups.ts';
import type { MirrorDigest } from './proc-mirror.ts';
import type { NormsDigest } from './proc-norms.ts';
import type { StocksDigest } from './proc-stocks.ts';
import { PROCESS_VERSIONS, type S1Ctx, type S1Process, type S1Result } from './s1ctx.ts';
import type { Sim } from './sim.ts';
import { simulatedDistricts } from './index-types.ts';

export interface RegimeRec {
  id: Id;
  kind: string;
  scope: Id;
  /** The game time the regime started and the window that holds it. */
  start: GameTime;
  startW: number;
  plannedLength: number;
  maxDwell: number;
  size: 3 | 4;
  effects: Record<string, number>;
  closes: string[];
  priceShift: number;
}

export interface EventsState {
  v: 1;
  /** Live regimes, in Id order. */
  regimes: RegimeRec[];
  services: Record<Id, { status: 0 | 1 | 2 | 3; since: number }>;
  admit: { m4Times: number[] };
  bands: Record<Id, { band: 0 | 1 | 2 | 3; since: number }>;
  /** By district, sorted by `(due, parent, index)`; at most 256 each. */
  calendar: Record<Id, PendingChild[]>;
  /** The last week's windows, oldest first. */
  ring: RingEntry[];
  next: number;
  counters: { immigrants: number; children: number; thinned: number; refused: number; noCast: number; clamped: number; overflow?: number };
}

export interface EventsDigest extends DigestBase {
  /** State views: every cell with a band above quiet. */
  bands: Record<Id, { band: number; since: number }>;
  regimes: Array<{ id: Id; kind: string; scope: Id; start: number; size: number; effects: Record<string, number>; closes: string[]; priceShift: number }>;
  m4Open: number;
  services: Record<Id, 0 | 1 | 2 | 3>;
  price: Record<Id, 0 | 1 | 2 | 3>;
  /** Per leaf: whether it could be lain low in, from the services and the bands. */
  refuge: Record<Id, 'yes' | 'poor' | 'no' | 'maybe'>;
  calendarSize: Record<Id, number>;
  /** Events of size 2 and above, as admitted (never items). */
  facts: Feed<EventFact>;
  /** Every admitted incident, items included. */
  counts: Feed<{ district: Id; kind: string; size: number; n: number }>;
  changes: Feed<Transition>;
}

export const BAND_NAMES = ['quiet', 'elevated', 'hot', 'flashpoint'] as const;
export const STATUS_NAMES = ['open', 'quiet', 'watched', 'closed'] as const;
export const PRICE_NAMES = ['low', 'fair', 'high', 'extreme'] as const;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byDue = (a: PendingChild, b: PendingChild): number => a.due - b.due || cmp(a.parent, b.parent) || a.index - b.index;

/** `m4Open`: 0 with no times, `last + spacing` with one, `max(last + spacing, secondLast + WEEK)` with two or more (S1 7.2). */
export function m4Open(times: readonly number[], spacing: number, week: number): number {
  if (times.length === 0) return 0;
  const last = times[times.length - 1]!;
  if (times.length === 1) return last + spacing;
  return Math.max(last + spacing, times[times.length - 2]! + week);
}

export function emptyEvents(): EventsState {
  return { v: 1, regimes: [], services: {}, admit: { m4Times: [] }, bands: {}, calendar: {}, ring: [], next: 0, counters: { immigrants: 0, children: 0, thinned: 0, refused: 0, noCast: 0, clamped: 0 } };
}

/** The next band (S1 7.2): after a dwell of a game day, rise to the highest band whose enter threshold is met, or fall while the leave threshold is not. */
export function nextBand(cur: number, heat: number, since: number, w: number, ev: { bandEnter: readonly number[]; bandLeave: readonly number[]; bandMinDwell: number }): number {
  if (w - since < ev.bandMinDwell) return cur;
  for (let j = 3; j > cur; j--) if (heat >= ev.bandEnter[j - 1]!) return j;
  let j = cur;
  while (j > 0 && heat < ev.bandLeave[j - 1]!) j--;
  return j;
}

interface Cand {
  isRegime: boolean;
  id: Id;
  time: GameTime;
  d?: Descriptor;
  regime?: RegimeRec;
  child?: PendingChild;
  /** The identity the event node is minted under: `H("mint", proc, cause, name)`. */
  cause?: Id;
  name?: string;
  cast?: CastEntry[];
}

/** The heat of every cell: the pending future of a cell's neighbourhood (S1 7.2). Terms are summed in `(entry w, Id)` order, then pending in `(due, parent, index)` order. */
export function heatOf(sim: Sim, st: EventsState, w: number): Map<Id, number> {
  const ev = sim.data.events;
  const heat = new Map<Id, number>();
  const add = (cell: Id, v: number): void => {
    heat.set(cell, (heat.get(cell) ?? 0) + v);
  };
  const reach = (cell: Id): Array<[Id, number]> => {
    const c = sim.w.cell(cell);
    return [[cell, 0], ...c.adj1.map((x): [Id, number] => [x, 1]), ...c.adj2.map((x): [Id, number] => [x, 2])];
  };
  const wa = (age: number): number => {
    for (const b of ev.heatAge) if (age <= b.upTo) return b.weight;
    return 0;
  };
  const entries = [...st.ring].sort((a, b) => a.w - b.w || cmp(a.id, b.id));
  for (const e of entries) {
    const age = w - e.w;
    if (age >= ev.heatHorizon) continue;
    const size = e.event ? e.event.size : 1;
    for (const [cell, dist] of reach(e.cell)) {
      if (!sim.w.index.cells[cell]) continue;
      add(cell, ev.heatSize[size - 1]! * ev.heatDist[dist]! * wa(age) * (e.count ?? 1));
    }
  }
  const pending = Object.values(st.calendar).flat().sort(byDue);
  for (const ch of pending) {
    const ahead = ch.due - w;
    if (!(ahead > 0 && ahead <= ev.heatHorizon)) continue;
    for (const [cell, dist] of reach(ch.cell)) {
      if (!sim.w.index.cells[cell]) continue;
      add(cell, ev.heatPending * ev.heatSize[ch.size - 1]! * ev.heatDist[dist]!);
    }
  }
  return heat;
}

export function eventsProcess(sim: Sim): S1Process<EventsState, EventsDigest> {
  const W = sim.data.time.W;
  const DAY = 86400;
  const WEEK = (7 * DAY) / W;
  const ev = sim.data.events;
  const procId = 'city.events';
  const proc = processCause(procId);

  return {
    id: procId, version: PROCESS_VERSIONS[procId]!, tier: 0, coarseFine: { kind: 'count' }, lag: 0,
    init: () => emptyEvents(),
    // ownOf and fixture updates may edit nested ring entries. Applied and outstanding states must stay independent.
    cloneState: (st) => structuredClone(st),

    run(c: S1Ctx, w: number): S1Result<EventsState, EventsDigest> {
      const st = c.own<EventsState>();
      const T = c.T;
      const p = sim.people.periodOf(T);
      const keys = c.keys;
      const ops: ProcessOp[] = [];
      const facts: EventFact[] = [];
      const countAgg = new Map<string, { district: Id; kind: string; size: number; n: number }>();
      const changes: Transition[] = [];
      const districts = simulatedDistricts(sim.w.index);
      const prevDigest = c.digest<EventsDigest>(procId);

      // The inputs: the digests of the previous window, with the defaults of a lineage that has none yet.
      const mirror = c.digest<MirrorDigest>('city.mirror');
      const stocks = c.digest<StocksDigest>('order.stocks');
      const norms = c.digest<NormsDigest>('order.norms');
      const groups = c.digest<GroupDigest>('group.decide');
      const boosts: Boosts = {
        boost: (d, f, kind) => groups?.boost[d]?.[f]?.[kind] ?? 0,
        pairBoost: (d, a, b) => {
          let m = 1;
          for (const x of groups?.pairBoost[d] ?? []) if (x.a === a && x.b === b) m = m * x.mult;
          return m;
        },
      };

      const allowedKind = (kind: string): boolean => sim.kindAllowed(kind, c.settings);
      const view = sim.outcomeView(c.digest);
      // the modifiers of a window are those of the regimes live at its start, after the exits: a regime that arrives in this window changes
      // incidents from the next one (S1 7.1, 7.2)
      let liveAtStart: RegimeRec[] = [];
      const regimeMod = (d: Id, kind: KindName): number => {
        let m = 1;
        for (const r of liveAtStart) if (r.scope === d) m = m * Math.max(0.1, r.effects[kind] ?? 1);
        return m;
      };
      const groupMod = (d: Id, kind: KindName): number => {
        if (kind === 'gang-clash') return 1;
        let sum = 0;
        for (let f = 1; f < 6; f++) sum = sum + sim.city.offenderShare(d, kind, f) * boosts.boost(d, f, kind);
        return Math.max(0.5, 1 + sum);
      };
      const mu = (d: Id, kind: KindName, m: number): number => {
        const rate = sim.data.shape.rate[kind]![m - 1]!;
        return rate * c.settings.cityScale * sim.city.shape(kind, T) * sim.city.share(d, kind, p) * regimeMod(d, kind) * groupMod(d, kind) * (W / DAY);
      };

      // the regime and the price of a district are state views with transitions
      const regimeValue = (regimes: RegimeRec[], district: Id): string => {
        const live = regimes.filter((r) => r.scope === district).sort((a, b) => b.size - a.size || a.start - b.start || cmp(a.kind, b.kind));
        return live.length > 0 ? live[0]!.kind : 'none';
      };
      const priceValue = (regimes: RegimeRec[], district: Id): number =>
        clamp(sim.w.district(district).priceAnchor + regimes.filter((r) => r.scope === district).reduce((a, r) => a + r.priceShift, 0), 0, 3);
      const regimesChanged = (district: Id, time: GameTime, before: RegimeRec[], after: RegimeRec[], source: string): void => {
        const rb = regimeValue(before, district);
        const ra = regimeValue(after, district);
        if (rb !== ra) changes.push({ key: `regime|${district}`, t: time, value: ra, prev: rb, source });
        const pb = priceValue(before, district);
        const pa = priceValue(after, district);
        if (pb !== pa) changes.push({ key: `price|${district}`, t: time, value: PRICE_NAMES[pa]!, prev: PRICE_NAMES[pb]!, source });
      };

      // (2) exits: a lifecycle notice, never refused and never counted; applied before the window's arrivals
      const exited: RegimeRec[] = [];
      for (const r of [...st.regimes].sort((a, b) => cmp(a.id, b.id))) {
        const age = w - r.startW;
        const h = age < 1.5 * r.plannedLength ? 0.05 : 0.2;
        if (age >= r.maxDwell || (age >= r.plannedLength && keys.regimeExit(w, r.id) < h)) exited.push(r);
      }
      for (const r of exited) {
        const before = [...st.regimes];
        st.regimes = st.regimes.filter((x) => x.id !== r.id);
        ops.push({ op: 'mint-event', spec: { name: `regime-end/${r.id}`, time: T, kind: 'regime-end', place: r.scope, causes: [r.id], outcome: 'done' } });
        regimesChanged(r.scope, T, before, st.regimes, `regime-end/${r.id}`);
      }
      liveAtStart = [...st.regimes];

      // (3) candidates
      const cands: Cand[] = [];
      // 3a. regime arrivals
      for (const d of districts) {
        for (const rd of sim.data.regimes) {
          if (st.regimes.some((r) => r.scope === d.id && r.kind === rd.kind)) continue;
          const n = spacingCount((rd.arrival * W) / DAY, (i) => keys.regime(w, d.id, rd.kind, i), 1);
          if (n !== 1) continue;
          const size: 3 | 4 = keys.regimeSize(w, d.id, rd.kind) < 0.1 ? 4 : 3;
          const time = T + Math.floor(keys.regimeT(w, d.id, rd.kind) * W);
          const id = mintedId(proc, proc, `regime/${w}/${d.id}/${rd.kind}`);
          cands.push({
            isRegime: true, id, time,
            regime: { id, kind: rd.kind, scope: d.id, start: time, startW: w, plannedLength: rd.plannedLength, maxDwell: rd.maxDwell, size, effects: rd.effects, closes: rd.closes, priceShift: rd.priceShift },
          });
        }
      }
      // 3b. immigrants
      const immigrantItems: Descriptor[] = [];
      for (const d of districts) {
        for (const kd of sim.data.kinds) {
          if (!allowedKind(kd.name)) continue;
          const mus = [1, 2, 3, 4].map((m) => mu(d.id, kd.name, m));
          let lambda = 0;
          for (const x of mus) lambda = lambda + x;
          if (!(lambda > 0)) continue;
          const r = splitCountR(lambda, (part) => (i) => keys.cnt(w, d.id, kd.name, part, i));
          for (let n = 0; n < r.capHits; n++) c.log({ w, proc: procId, kind: 'defect', reason: 'cap-hit', refs: [d.id] });
          const weights = sim.city.cellWeights(d.id, kd.name, p);
          for (let i = 0; i < r.n; i++) {
            const size = invCum(mus, keys.size(w, d.id, kd.name, i)) + 1;
            const cell = d.cellIds[invCum(weights, keys.cell(w, d.id, kd.name, i))]!;
            st.counters.immigrants++;
            if (size >= 2) {
              const name = `ev/${w}/${d.id}/${kd.name}/${i}`;
              const id = mintedId(proc, proc, name);
              const time = T + Math.floor(keys.t(w, d.id, kd.name, i) * W);
              cands.push({ isRegime: false, id, time, name, cause: proc, d: { id, kind: kd.name, size, w, time, cell, gen: 0, chain: [], public: false, witnesses: 0 } });
            } else {
              immigrantItems.push({ id: H(hs('pending-item'), hid(d.id), hs(kd.name), hi(i)), kind: kd.name, size: 1, w, time: 0, cell, gen: 0, chain: [], public: false, witnesses: 0 });
            }
          }
        }
      }
      // 3c. due children
      const childItems: Array<{ d: Descriptor; index: number }> = [];
      for (const d of districts) {
        const cal = st.calendar[d.id] ?? [];
        const due = cal.filter((x) => x.due === w).sort(byDue);
        st.calendar[d.id] = cal.filter((x) => x.due !== w);
        for (const ch of due) {
          const refs = [ch.parent];
          const key = `${ch.parent}|${ch.index}`;
          // (1) game cover: the game already covers the same kind here or one step away
          const covered = (mirror?.cover ?? []).some((e) => e.kind === ch.kind && e.cell !== undefined && w - e.since <= ev.coverLull && (e.cell === ch.cell || sim.w.cell(ch.cell).adj1.includes(e.cell)));
          if (covered) {
            c.log({ w, proc: procId, kind: 'correction', reason: 'game-covers', key, refs });
            st.counters.thinned++;
            continue;
          }
          // (2) excluded now
          if (!allowedKind(ch.kind)) {
            c.log({ w, proc: procId, kind: 'gate', reason: 'excluded', key, refs });
            st.counters.refused++;
            continue;
          }
          // (3) thinning by the regime that began since the child was born
          const ratio = Math.min(1, regimeMod(d.id, ch.kind) / ch.modBirth);
          if (ratio < 1 && sim.ids.thin(ch.parent, ch.index) >= ratio) {
            c.log({ w, proc: procId, kind: 'decision', reason: 'regime', key, refs });
            st.counters.thinned++;
            continue;
          }
          st.counters.children++;
          const gen = ch.parentFacts.gen + 1;
          const chain = [ch.parent, ...ch.parentFacts.chain].slice(0, ev.genMax);
          const base = { kind: ch.kind, w, cell: ch.cell, parent: ch.parent, gen, chain, public: false, witnesses: 0 };
          if (ch.size >= 2) {
            const name = `child/${ch.index}`;
            const id = mintedId(proc, ch.parent, name);
            const time = T + Math.floor(sim.ids.child(ch.parent, ch.index, 't') * W);
            const desc: Descriptor = { id, size: ch.size, time, ...base };
            if (ch.sides) desc.sides = ch.sides;
            if (ch.inherit) desc.inherit = ch.inherit;
            cands.push({ isRegime: false, id, time, name, cause: ch.parent, d: desc, child: ch });
          } else {
            const desc: Descriptor = { id: H(hs('pending-item'), hid(ch.parent), hi(ch.index)), size: 1, time: 0, ...base };
            if (ch.sides) desc.sides = ch.sides;
            if (ch.inherit) desc.inherit = ch.inherit;
            childItems.push({ d: desc, index: ch.index });
          }
        }
      }

      // (4) admission: one owner, one order, against working counters that are committed with the run
      cands.sort((x, y) => x.time - y.time || cmp(x.id, y.id));
      let m4Times = [...st.admit.m4Times];
      const perDistrict = new Map<Id, number>();
      const admitted: Cand[] = [];
      const parentSize = new Map<Id, number>();
      for (const cd of cands) {
        if (!cd.isRegime) {
          const d = cd.d!;
          if (d.sides?.a === undefined) {
            const sides = sim.casting.drawSides(d.id, d.cell, d.kind, boosts);
            if (Object.keys(sides).length > 0) d.sides = sides;
          }
          const cast = sim.casting.cast(d);
          if (cast === 'no-cast') {
            c.log({ w, proc: procId, kind: 'admission', reason: 'no-cast', refs: [d.id] });
            st.counters.noCast++;
            continue;
          }
          cd.cast = cast;
          // the outcome is drawn once, here, from the occurrence's own Id (S1 5.2a, 7.2); the gate sees the effects that follow it
          sim.drawOutcome(d, cast, view);
          if (!c.produce(sim.occurrenceOf(d, cast, proc, 'sim')).ok) {
            st.counters.refused++;
            continue;
          }
        }
        const size = cd.isRegime ? cd.regime!.size : cd.d!.size;
        if (size === 4 && w < m4Open(m4Times, ev.m4Spacing, WEEK)) {
          if (cd.isRegime) cd.regime!.size = 3; // demoted: the regime starts as size 3 and uses no budget
          else {
            c.log({ w, proc: procId, kind: 'admission', reason: 'budget-m4', refs: [cd.id] });
            st.counters.refused++;
            continue;
          }
        }
        const dist = cd.isRegime ? cd.regime!.scope : sim.w.cell(cd.d!.cell).district;
        if (!cd.isRegime && size >= 2 && (perDistrict.get(dist) ?? 0) >= ev.capPerWindow) {
          c.log({ w, proc: procId, kind: 'admission', reason: 'cap-window', refs: [cd.id] });
          st.counters.refused++;
          continue;
        }
        if ((cd.isRegime ? cd.regime!.size : size) === 4) m4Times = [...m4Times, w].slice(-2);
        if (!cd.isRegime && size >= 2) perDistrict.set(dist, (perDistrict.get(dist) ?? 0) + 1);
        admitted.push(cd);
        if (cd.child) parentSize.set(cd.id, cd.child.parentFacts.size);
      }
      st.admit.m4Times = m4Times;

      const occurrences: Descriptor[] = [];
      const castOf = new Map<Id, CastEntry[]>();
      const minted = new Map<Id, { name: string; cause: Id }>();
      for (const cd of admitted) {
        if (cd.isRegime) {
          const r = cd.regime!;
          const before = [...st.regimes];
          st.regimes.push(r);
          st.regimes.sort((a, b) => cmp(a.id, b.id));
          ops.push({ op: 'mint-event', spec: { name: `regime/${w}/${r.scope}/${r.kind}`, time: r.start, kind: 'regime-start', place: r.scope, outcome: 'done' } });
          regimesChanged(r.scope, r.start, before, st.regimes, `regime-start/${r.id}`);
          continue;
        }
        const d = cd.d!;
        sim.completeDescriptor(d);
        occurrences.push(d);
        minted.set(d.id, { name: cd.name!, cause: cd.cause! });
        castOf.set(d.id, cd.cast!);
        ops.push({ op: 'mint-event', spec: sim.eventSpecOf(d, cd.cast!, proc, cd.cause!, cd.name!) });
        bump(countAgg, sim.w.cell(d.cell).district, d.kind, d.size);
      }

      // (5) indexing: admitted size-1 incidents become the items of their cells' summaries, immigrants first, then due children
      const sortedChildren = childItems.sort((x, y) => cmp(x.d.parent!, y.d.parent!) || x.index - y.index).map((x) => x.d);
      const items = [...immigrantItems, ...sortedChildren].filter((d) => allowedKind(d.kind));
      const bySummary = new Map<string, Descriptor[]>();
      for (const d of items) {
        const key = `${d.cell}|${d.kind}`;
        if (!bySummary.has(key)) bySummary.set(key, []);
        bySummary.get(key)!.push(d);
      }
      const ringNew: RingEntry[] = [];
      const itemDescs: Descriptor[] = [];
      for (const key of [...bySummary.keys()].sort()) {
        const list = bySummary.get(key)!;
        const cell = list[0]!.cell;
        const kind = list[0]!.kind;
        const sname = `sum/${w}/${cell}/${kind}`;
        const S = mintedId(proc, proc, sname);
        ops.push({ op: 'mint-summary', spec: { name: sname, kind, from: T, length: W, scope: cell, count: list.length } });
        const meta: NonNullable<RingEntry['meta']> = {};
        list.forEach((d, j) => {
          d.id = sim.k.summaries.itemId(S, j);
          d.time = itemTime(S, j, T, W);
          if (d.sides?.a === undefined) {
            const sides = sim.casting.drawSides(d.id, d.cell, d.kind, boosts);
            if (Object.keys(sides).length > 0) d.sides = sides;
          }
          sim.completeDescriptor(d);
          const m: NonNullable<RingEntry['meta']>[number] = { gen: d.gen, chain: d.chain };
          if (d.parent !== undefined) m.parent = d.parent;
          if (d.sides) m.sides = d.sides;
          if (d.inherit) m.inherit = d.inherit;
          meta[j] = m;
          itemDescs.push(d);
          bump(countAgg, sim.w.cell(d.cell).district, d.kind, 1);
        });
        ringNew.push({ id: S, w, kind, cell, count: list.length, meta });
      }

      // (6) offspring of every admitted occurrence of generation below genMax, keyed by its final Id
      const police = new Set<Id>();
      for (const d of [...occurrences, ...itemDescs]) {
        if (d.gen >= ev.genMax) continue;
        const district = sim.w.cell(d.cell).district;
        const kd = sim.w.cityKindByName.get(d.kind)!;
        const raw = ev.offspring[d.size - 1]! * kd.offspringFactor * c.settings.cityScale * regimeMod(district, d.kind);
        const n = Math.min(ev.nMax, raw);
        if (raw > ev.nMax) {
          c.log({ w, proc: procId, kind: 'defect', reason: 'n-clamped', key: d.id, refs: [d.id] });
          st.counters.clamped++;
        }
        const count = nbCount(n, ev.dispersion, sim.ids.child(d.id, 0, 'n'), ev.maxChildren);
        for (let ci = 0; ci < count; ci++) {
          const bin = invCum(kd.delayWeights, sim.ids.child(d.id, ci, 'bin'));
          const [lo, hi2] = ev.delayBins[bin]!;
          const due = w + lo + Math.floor(sim.ids.child(d.id, ci, 'win') * (hi2 - lo + 1));
          // the rows of the matrix in the order of the kind registry, never the order a record lists them (S1 1.2)
          const row = sim.data.kinds.flatMap((k2): Array<[string, number]> => (kd.matrix[k2.name] !== undefined && allowedKind(k2.name) ? [[k2.name, kd.matrix[k2.name]!]] : []));
          if (row.length === 0) continue;
          const childKind = row[invCum(row.map((e) => e[1]), sim.ids.child(d.id, ci, 'kind'))]![0];
          if (childKind === 'police-action' && sim.ids.report(d.id, ci) >= sim.reportChance(district, Math.min(10, d.witnesses), stocks, norms)) continue;
          const ckd = sim.w.cityKindByName.get(childKind)!;
          const size = d.size === 1 ? 1 : clamp(d.size + ev.sizeSteps[invCum(ev.sizeStepWeights, sim.ids.child(d.id, ci, 'size'))]!, ckd.sizes[0], ckd.sizes[1]);
          const pc: PendingChild = {
            parent: d.id, index: ci, due, kind: childKind, size, cell: sim.childCell(d, childKind, ci), modBirth: regimeMod(district, childKind),
            parentFacts: { id: d.id, kind: d.kind, size: d.size, w: d.w, time: d.time, cell: d.cell, gen: d.gen, chain: d.chain, ...(d.sides ? { sides: d.sides } : {}), ...(d.parent !== undefined ? { parent: d.parent } : {}) },
          };
          if (childKind === 'gang-clash' && d.kind === 'gang-clash' && d.sides?.a !== undefined && d.sides?.b !== undefined) pc.sides = { a: d.sides.b, b: d.sides.a };
          else if (childKind !== 'police-action' && d.sides) pc.sides = d.sides;
          if (childKind === 'police-action') {
            const inh = sim.inheritFor(d);
            if (inh.length > 0) pc.inherit = inh;
            police.add(d.id);
          }
          const cal = (st.calendar[district] ??= []);
          cal.push(pc);
          cal.sort(byDue);
        }
      }
      // the calendar's cap is a fault limit, not population control: the pending child with the lowest size, then the largest parent Id,
      // is dropped first, and each drop is logged and counted (S1 7.2)
      for (const d of districts) {
        const cal = (st.calendar[d.id] ??= []);
        while (cal.length > ev.calendarCap) {
          let worst = 0;
          for (let x = 1; x < cal.length; x++) if (cal[x]!.size < cal[worst]!.size || (cal[x]!.size === cal[worst]!.size && cmp(cal[x]!.parent, cal[worst]!.parent) > 0)) worst = x;
          cal.splice(worst, 1);
          c.log({ w, proc: procId, kind: 'defect', reason: 'calendar-overflow', refs: [d.id] });
          st.counters.overflow = (st.counters.overflow ?? 0) + 1;
        }
      }

      // events become facts and ring entries; summaries are in the ring already
      for (const d of occurrences) {
        const f: EventFact = {
          id: d.id, kind: d.kind, size: d.size, w, time: d.time, cell: d.cell, district: sim.w.cell(d.cell).district, public: d.public, witnesses: d.witnesses,
          policeChild: police.has(d.id), creator: 'sim', outcome: d.outcome ?? 'done',
          parties: sim.partiesOf(sim.occurrenceOf(d, castOf.get(d.id) ?? [], proc, 'sim').participants, d.time),
          effects: sim.occurrenceOf(d, castOf.get(d.id) ?? [], proc, 'sim').effects,
        };
        if (d.sides) f.sides = d.sides;
        if (d.parent !== undefined) {
          f.parent = d.parent;
          const ps = parentSize.get(d.id);
          if (ps !== undefined) f.parentSize = ps;
        }
        facts.push(f);
        const { witnesses: _ignored, ...rest } = d;
        void _ignored;
        ringNew.push({ id: d.id, w, kind: d.kind, cell: d.cell, event: rest, mint: minted.get(d.id)! });
      }
      facts.sort((x, y) => x.time - y.time || cmp(x.id, y.id));
      st.ring.push(...ringNew);

      // (7) the ring is trimmed; heat, bands, service status and price
      st.ring = st.ring.filter((e) => w - e.w < ev.heatHorizon);
      if (st.ring.length > ev.ringMax) {
        c.log({ w, proc: procId, kind: 'defect', reason: 'ring-overflow', refs: [] });
        while (st.ring.length > ev.ringMax) {
          const oldest = st.ring[0]!.w;
          st.ring = st.ring.filter((e) => e.w !== oldest);
        }
      }
      const heat = heatOf(sim, st, w);
      for (const d of districts) {
        for (const cid of d.cellIds) {
          const cur = st.bands[cid] ?? { band: 0 as const, since: Number.NEGATIVE_INFINITY };
          const next = nextBand(cur.band, heat.get(cid) ?? 0, cur.since, w, ev);
          if (next !== cur.band) {
            ops.push({ op: 'pin', node: cid, slot: `band@w${w + 1}`, value: BAND_NAMES[next]! });
            changes.push({ key: `band|${cid}`, t: T + W, value: BAND_NAMES[next]!, prev: BAND_NAMES[cur.band]! });
            st.bands[cid] = { band: next as 0 | 1 | 2 | 3, since: w + 1 };
          }
        }
        const live = st.regimes.filter((r) => r.scope === d.id);
        for (const cid of d.cellIds) {
          const band = st.bands[cid]?.band ?? 0;
          sim.w.cell(cid).services.forEach((svc, j) => {
            if (svc.type === 'home' || svc.type === 'safehouse' || svc.type === 'apartment') return;
            const node = sim.k.address(cid, `services[${j}]`);
            const closed = live.some((r) => r.closes.includes(svc.type)) || band === 3;
            const status = closed ? 3 : band === 2 ? 2 : band === 1 ? 1 : 0;
            const was = st.services[node]?.status ?? 0;
            if (status !== was) {
              ops.push({ op: 'pin', node, slot: `status@w${w + 1}`, value: STATUS_NAMES[status]! });
              changes.push({ key: `status|${node}`, t: T + W, value: STATUS_NAMES[status]!, prev: STATUS_NAMES[was]! });
              st.services[node] = { status: status as 0 | 1 | 2 | 3, since: w + 1 };
            }
          });
        }
      }

      // the digest
      const digestBands: EventsDigest['bands'] = {};
      for (const [cid, b] of Object.entries(st.bands)) if (b.band > 0) digestBands[cid] = { band: b.band, since: b.since };
      const price: EventsDigest['price'] = {};
      const refuge: EventsDigest['refuge'] = {};
      const svcOut: EventsDigest['services'] = {};
      for (const [n, s2] of Object.entries(st.services)) svcOut[n] = s2.status;
      for (const d of districts) {
        price[d.id] = priceValue(st.regimes, d.id) as 0 | 1 | 2 | 3;
        const lodging: Id[] = [];
        let hot = false;
        for (const cid of d.cellIds) {
          if ((st.bands[cid]?.band ?? 0) >= 2) hot = true;
          sim.w.cell(cid).services.forEach((svc, j) => {
            if (svc.type === 'safehouse' || svc.type === 'lodging') lodging.push(sim.k.address(cid, `services[${j}]`));
          });
        }
        if (lodging.length === 0) refuge[d.id] = 'maybe';
        else refuge[d.id] = !lodging.some((n) => (st.services[n]?.status ?? 0) <= 1) ? 'no' : hot ? 'poor' : 'yes';
        const prevR = prevDigest?.refuge[d.id] ?? (lodging.length > 0 ? 'yes' : 'maybe');
        if (refuge[d.id] !== prevR && refuge[d.id] !== 'maybe') changes.push({ key: `refuge|${d.id}`, t: T + W, value: refuge[d.id]!, prev: prevR });
      }
      const calSize: Record<Id, number> = {};
      for (const d of districts) calSize[d.id] = (st.calendar[d.id] ?? []).length;
      const keep = sim.data.feed.keep;
      st.next += facts.length;
      const digest: EventsDigest = {
        v: 1, through: w, bands: digestBands,
        regimes: st.regimes.map((r) => ({ id: r.id, kind: r.kind, scope: r.scope, start: r.start, size: r.size, effects: r.effects, closes: r.closes, priceShift: r.priceShift })),
        m4Open: m4Open(st.admit.m4Times, ev.m4Spacing, WEEK), services: svcOut, price, refuge, calendarSize: calSize,
        facts: pushFeed(prevDigest?.facts, w, facts, keep),
        counts: pushFeed(prevDigest?.counts, w, [...countAgg.values()].sort((a, b) => cmp(a.district, b.district) || cmp(a.kind, b.kind) || a.size - b.size), keep),
        changes: pushTransitions(prevDigest?.changes, w, changes, keep),
      };
      return { ops, state: st, digest };
    },
  };
}

function bump(m: Map<string, { district: Id; kind: string; size: number; n: number }>, district: Id, kind: string, size: number): void {
  const key = `${district}|${kind}|${size}`;
  const hit = m.get(key);
  if (hit) hit.n++;
  else m.set(key, { district, kind, size, n: 1 });
}
