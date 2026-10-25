// `group.decide` (S1 7.8): makes the Tyger Claws and The Mox of Kabuki actors in the smallest useful way: books that run out,
// grudges that build, four pressures each, leaders in keyed seats whose leanings bend what the group decides, and intentions that
// start, expire and are removed. What a group wants reaches the city as a rate boost. No decision depends on demand: the process calls
// no `demanded`, and members carry an intention out through `people.goals` (a later build of the reference model).
//
// Pressures are derived (a pure function of timestamped facts and the query time) and never pinned (S1-I-20). Leadership is state:
// drawn once, changed only by removal and succession, each recorded (an `xf:leads` edge, a `succession` event, S1-I-31).
//
// This build holds v0.6's seats, succession, interregnum, the pulses by function (the composite's S1-2), the decisions as events and the
// refusal share of the books. The `punish` intention against the protagonist (D-30, S1 7.8.1) and the duties of S1 7.10 are not built.

import { H, i as hi, id as hid, mintedId, s as hs } from '../id.ts';
import type { ProcessOp } from '../evolution.ts';
import { processCause } from '../evolution.ts';
import type { GameTime, Id } from '../types.ts';
import { clip01, exptab, invCum } from './arith.ts';
import type { GroupDef, IntentDef } from './data.ts';
import { applicableFills } from './fills.ts';
import { type DigestBase, type EventFact, type Feed, type Transition, feedAfter, pushTransitions } from './occ.ts';
import { affOfGroup, groupOf, partiesOf } from './outcomes.ts';
import type { EventsDigest } from './proc-events.ts';
import type { MirrorDigest } from './proc-mirror.ts';
import type { NormsDigest } from './proc-norms.ts';
import { PROCESS_VERSIONS, type S1Ctx, type S1Process, type S1Result } from './s1ctx.ts';
import type { Sim } from './sim.ts';
import { simulatedDistricts } from './index-types.ts';

export interface Pulse {
  at: GameTime;
  sev: number;
  latched: boolean;
  releasedAt?: GameTime;
  rival?: number;
  pub?: boolean;
  /** v0.6: the fact that set it. */
  src?: Id;
  /** v0.6: the member wronged and the person who did it, from the fact (an intention's `ward` and `wrongdoer`). */
  ward?: Id;
  wrongdoer?: Id;
}

/** A seat of a group (S1 7.8): seat 0 is the head. */
export interface Seat {
  seat: number;
  holder: Id | null;
  since: number;
  /** The draw's succession counter: 0 at initialisation, +1 for every later draw. */
  succ: number;
  lean?: string;
  /** The window a vacant seat is drawn again in. */
  retry?: number;
  /** Whose seat it was last, for the `predecessor` of the next holder's succession. */
  prev?: Id;
  /** Whether the `xf:leads` edge of the holder has been written. */
  edged?: boolean;
  /** Whether the seat's vacancy at initialisation has been logged (`seat-vacant`, S1 7.8). */
  logged?: boolean;
}

export type Intent =
  | { state: 'none' }
  | { state: 'idle'; drive: string; since: number }
  | { state: 'active'; id: string; name?: string; drive: string; since: number; expires: number; rival?: number; ward?: Id; wrongdoer?: Id; decider?: Id }
  | { state: 'cooling'; until: number };

export interface G {
  aff: 'A1' | 'A2';
  district: Id;
  books: { cash: number; burn: number; income: number };
  pulse: Record<string, Pulse>;
  seats: Seat[];
  interregnum?: { until: number; cause: Id; logged?: boolean };
  intent: Intent;
  /** People who may hold no seat before `until` (after an arrest). */
  barred: Array<{ person: Id; until: number; cause: Id }>;
  W: Record<string, number>;
  D: number;
  gapBand: 0 | 1 | 2;
}

export interface GroupState {
  v: 2;
  groups: Record<Id, G>;
  cursors: { events: number; mirror: number; norms: number };
  /** Canonical origins of the seed and port wrongs already taken, at most 256. */
  seen: Id[];
}

export interface GroupDigest extends DigestBase {
  groups: Record<Id, {
    aff: string; U: Record<string, number>; W: Record<string, number>; D: number;
    /** The gap band the group maintains (0 low, 1 mid, 2 high), with its hysteresis. */
    band: 0 | 1 | 2;
    /** The state of the intention: `active:<name>`, `idle`, `cooling` or `none`. */
    intent: string;
    until?: number;
    seats: Array<{ seat: number; holder: Id | null }>;
    interregnum: boolean;
    /** The active intention, if any (S1 7.8). */
    active: { name: string; id: Id; since: number; until: number; rival?: number; ward?: Id; wrongdoer?: Id } | null;
  }>;
  /** District, then affiliation class index, then kind. */
  boost: Record<Id, Record<number, Record<string, number>>>;
  pairBoost: Record<Id, Array<{ a: number; b: number; mult: number; until: number }>>;
  changes: Feed<Transition>;
}

const DAY = 86400;
const GAP_NAMES = ['low', 'mid', 'high'] as const;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const HARM = ['harm', 'kill', 'take', 'expose'];

/** The strength of a stored pulse at `t` (S1 7.8): decaying, or held while latched and unreleased, then decaying from its release. */
export function pulseU(p: Pulse | undefined, u0: number, tauSeconds: number, t: GameTime, hold = 0): number {
  if (p === undefined || t < p.at) return 0;
  const base = u0 * p.sev;
  const e = t - p.at;
  if (!p.latched) return base * exptab(-e / tauSeconds);
  if (p.releasedAt === undefined || t < p.releasedAt) return Math.max(base * exptab(-e / tauSeconds), hold * base);
  return hold * base * exptab(-(t - p.releasedAt) / tauSeconds);
}

/**
 * Whether a new pulse replaces the one a drive holds: the stronger urgency now wins (S1 7.8). Both are read at the snapshot time `T`, never
 * at the new fact's own time, because a fact that reaches the group late (a mirrored one) is older than facts already counted.
 */
export function pulseReplaces(cur: Pulse | undefined, p: Pulse, u0: number, tauSeconds: number, hold: number, T: GameTime): boolean {
  return cur === undefined || pulseU(p, u0, tauSeconds, T, hold) > pulseU(cur, u0, tauSeconds, T, hold);
}

/** The four pressures of a group at `t`, a pure function of its books and pulses (S1 7.8). */
export function pressures(sim: Sim, def: GroupDef, g: G, t: GameTime): Record<string, number> {
  const cfg = sim.data.groups;
  const pc = cfg.pulses;
  const out: Record<string, number> = {};
  const carried = Object.keys(def.ethos);
  const runway = g.books.burn > 0 ? g.books.cash / g.books.burn : Number.POSITIVE_INFINITY;
  for (const d of carried) {
    switch (d) {
      case 'treasury': out[d] = clip01(1 - runway / cfg.treasuryDays); break;
      case 'retribution': out[d] = pulseU(g.pulse.retribution, pc.retU0, pc.retTauDays * DAY, t, pc.retHold); break;
      case 'care_of_members': out[d] = Math.max(cfg.constants.careMin, pulseU(g.pulse.care_of_members, pc.careU0, pc.careTauDays * DAY, t)); break;
      case 'reputation': out[d] = Math.max(cfg.constants.repMin, pulseU(g.pulse.reputation, pc.repU0, pc.repTauDays * DAY, t)); break;
      case 'cohesion': out[d] = cfg.constants.cohesion; break;
      case 'legitimacy': out[d] = cfg.constants.legitimacy; break;
      default: out[d] = 0;
    }
  }
  return out;
}

/** The weight of a seat (S1 7.8): the head 0.6, the other seats share 0.4 equally. */
export function seatWeight(seat: number, seats: number, head = 0.6): number {
  return seat === 0 ? head : seats > 1 ? (1 - head) / (seats - 1) : 0;
}

/**
 * The leaders' term (S1 7.8): the share of the held seats' weight that leans to each carried drive, and `ethosN` where no seat is held. Sums
 * run in carried-drive order.
 */
export function leadShares(ethos: Record<string, number>, seats: ReadonlyArray<Pick<Seat, 'seat' | 'holder' | 'lean'>>, head = 0.6): Record<string, number> {
  const drives = Object.keys(ethos);
  const eSum = drives.reduce((a, d) => a + ethos[d]!, 0);
  const held = seats.filter((s) => s.holder !== null);
  const out: Record<string, number> = {};
  let total = 0;
  for (const s of held) total = total + seatWeight(s.seat, seats.length, head);
  for (const d of drives) {
    if (held.length === 0 || !(total > 0)) { out[d] = ethos[d]! / eSum; continue; }
    let sum = 0;
    for (const s of held) if (s.lean === d) sum = sum + seatWeight(s.seat, seats.length, head);
    out[d] = sum / total;
  }
  return out;
}

/** The operative weights, the divergence and the intention weights (S1 7.8): `W = 0.4 ethosN + 0.4 Un + 0.2 leadN` (v0.6; v0.5 had 0.5 and 0.5). */
export function operative(sim: Sim, ethos: Record<string, number>, U: Record<string, number>, lead?: Record<string, number>): { W: Record<string, number>; D: number; w: Record<string, number> } {
  const drives = Object.keys(ethos).sort();
  let eSum = 0;
  let uSum = 0;
  for (const d of drives) {
    eSum = eSum + ethos[d]!;
    uSum = uSum + U[d]!;
  }
  const W: Record<string, number> = {};
  let maxW = 0;
  for (const d of drives) {
    const en = ethos[d]! / eSum;
    const un = uSum > 0 ? U[d]! / uSum : 0;
    const ln = lead ? lead[d]! : en;
    W[d] = 0.4 * en + 0.4 * un + 0.2 * ln;
    if (W[d]! > maxW) maxW = W[d]!;
  }
  let D = 0;
  for (const d of drives) D = D + Math.abs(ethos[d]! / eSum - W[d]!);
  D = 0.5 * D;
  const w: Record<string, number> = {};
  for (const d of drives) {
    const phi = sim.data.groups.phi[d] ?? 0.3;
    w[d] = (W[d]! / maxW) * (phi + (1 - phi) * U[d]!);
  }
  return { W, D, w };
}

export function groupBand(cur: 0 | 1 | 2, D: number, sim: Sim): 0 | 1 | 2 {
  const b = sim.data.groups.gapBands;
  if (D >= b.mid) return 2;
  if (cur === 2) return D < b.leaveMid ? (D < b.leaveLow ? 0 : 1) : 2;
  if (D >= b.low) return 1;
  if (cur === 1 && D < b.leaveLow) return 0;
  return cur;
}

/** The expected share of shakedowns a window's incidents lose to refusal (S1 7.8): an item's outcome is not known at the coarse tier. */
export function refusalShare(beh: number, refuseNC: number, refuseC: number): number {
  return (1 - beh) * refuseNC + beh * refuseC;
}

const edgeId = (holder: Id, group: Id, from: GameTime): Id => H(hs('edge'), hs('xf:leads'), hid(holder), hid(group), hi(from));

export function groupsProcess(sim: Sim): S1Process<GroupState, GroupDigest> {
  const procId = 'group.decide';
  const proc = processCause(procId);
  const cfg = sim.data.groups;
  const W = sim.data.time.W;
  const defOf = (aff: 'A1' | 'A2'): GroupDef => cfg.groups.find((g) => g.aff === aff)!;
  const classIdx = (aff: 'A1' | 'A2' | 'A3'): number => ({ A1: 2, A2: 3, A3: 4 })[aff];
  const intentDef = (id: string): IntentDef => cfg.intents.find((i) => i.id === id)!;
  const WRONG_KINDS = [...sim.w.kinds.kinds.values()].filter((k) => k.fills.some((f) => f.fn === 'wrong')).map((k) => k.name);
  const settled = new Set<Id>();
  const ownCreators = new Set<Id>([sim.w.s1, ...['city.events', 'city.mirror', 'order.norms', 'group.decide', 'scene.acts', 'people.goals'].map((p) => processCause(p))]);

  /** Who may hold a seat of a group at `t` (S1 7.8): a living adult member, aged 25 or more, of profile role gang, in no other seat, not barred. */
  const eligible = (g: G, group: Id, r: Id, t: GameTime, w: number, taken: ReadonlySet<Id>): boolean => {
    if (taken.has(r) || g.barred.some((b) => b.person === r && w < b.until)) return false;
    const v = sim.people.view(r);
    if (!v || !sim.people.alive(r, t) || v.ageClass !== 'adult' || v.aband < 2 || v.role !== 'gang') return false;
    return groupOf(sim, r, t) === group;
  };

  /** The mirrored canon holder of a seat, if the pack names one and they can hold it at `t`. */
  const canonHolder = (g: G, group: Id, seat: number, t: GameTime, w: number, taken: ReadonlySet<Id>): Id | undefined => {
    for (const cs of cfg.canonSeats ?? []) {
      if (cs.seat !== seat || cs.aff !== g.aff) continue;
      const node = sim.k.mirrored(cs.gameKey, 'xf:person');
      if (taken.has(node) || g.barred.some((b) => b.person === node && w < b.until)) continue;
      if (sim.k.value(node, 'alive', t) === 'no' || groupOf(sim, node, t) !== group) continue;
      return node;
    }
    return undefined;
  };

  /** `drawSeat(group, seat, succ, t)` (S1 7.8): the first eligible resident of up to 24 attempts, or none. */
  const drawSeat = (g: G, group: Id, seat: number, succ: number, t: GameTime, w: number, taken: ReadonlySet<Id>): Id | null => {
    const canon = canonHolder(g, group, seat, t, w, taken);
    if (canon !== undefined) return canon;
    const district = sim.w.district(g.district);
    const f = classIdx(g.aff);
    const weights = district.cellIds.map((cid) => sim.people.residentCount(cid) * sim.casting.classPresence(cid, f));
    if (!(weights.reduce((a, b) => a + b, 0) > 0)) return null;
    for (let a = 0; a < 24; a++) {
      const block = district.cellIds[invCum(weights, sim.ids.seatB(group, seat, succ, a))]!;
      const n = sim.people.residentCount(block);
      if (n === 0) continue;
      const r = sim.people.residentAt(block, Math.floor(sim.ids.seatR(group, seat, succ, a) * n));
      if (eligible(g, group, r, t, w, taken)) return r;
    }
    return null;
  };

  const leanOf = (def: GroupDef, holder: Id, group: Id): string => {
    const carried = Object.keys(def.ethos);
    const sum = carried.reduce((a, d) => a + def.ethos[d]!, 0);
    return carried[invCum(carried.map((d) => def.ethos[d]! / sum), sim.ids.lean(holder, group))]!;
  };

  return {
    id: procId, version: PROCESS_VERSIONS[procId]!, tier: 0, coarseFine: { kind: 'exact' }, lag: 0,
    init: () => {
      const groups: GroupState['groups'] = {};
      for (const d of simulatedDistricts(sim.w.index)) {
        for (const def of cfg.groups) {
          const id = sim.w.group(d.id, def.aff);
          const g: G = {
            aff: def.aff, district: d.id, books: { ...def.books }, pulse: {}, seats: [], intent: { state: 'none' }, barred: [], W: {}, D: 0, gapBand: 0,
          };
          // every seat is drawn at t = 0 with succ = 0 (S1 7.8)
          const taken = new Set<Id>();
          for (let s = 0; s < def.seats; s++) {
            const holder = drawSeat(g, id, s, 0, 0, 0, taken);
            if (holder !== null) {
              taken.add(holder);
              g.seats.push({ seat: s, holder, since: 0, succ: 0, lean: leanOf(def, holder, id) });
            } else g.seats.push({ seat: s, holder: null, since: 0, succ: 0, retry: 144 - (0 % 144) });
          }
          groups[id] = g;
        }
      }
      return { v: 2, groups, cursors: { events: -1, mirror: -1, norms: -1 }, seen: [] };
    },

    run(c: S1Ctx, w: number): S1Result<GroupState, GroupDigest> {
      const st = c.own<GroupState>();
      const T = c.T;
      const ops: ProcessOp[] = [];
      const changes: Transition[] = [];
      const ev = c.digest<EventsDigest>('city.events');
      const mr = c.digest<MirrorDigest>('city.mirror');
      const nm = c.digest<NormsDigest>('order.norms');
      const fe = feedAfter(ev?.facts, st.cursors.events);
      const fc = feedAfter(ev?.counts, st.cursors.events);
      const fm = feedAfter(mr?.facts, st.cursors.mirror);
      const fn = feedAfter(nm?.facts, st.cursors.norms);
      if (fe.gap) c.log({ w, proc: procId, kind: 'defect', reason: 'feed-gap', key: 'city.events', refs: [] });
      if (fm.gap) c.log({ w, proc: procId, kind: 'defect', reason: 'feed-gap', key: 'city.mirror', refs: [] });
      if (fn.gap) c.log({ w, proc: procId, kind: 'defect', reason: 'feed-gap', key: 'order.norms', refs: [] });
      st.cursors.events = Math.max(fe.through, fc.through);
      st.cursors.mirror = fm.through;
      st.cursors.norms = fn.through;
      // the wrongs of seeds and of the port, found by query and taken once by their canonical origin (S1 7.8): a kit's minted beating or a replayed enforcement pulses like a simulated one
      const seen = new Set(st.seen);
      const queried: EventFact[] = [];
      if (WRONG_KINDS.length > 0) {
        // The events of other creators than S1's own are found by their headers, not by a query over every event: S1's own events are thousands,
        // seeds' and the port's are few. `settled` holds only facts that never change (an event of S1's, of another kind, or too old to be taken),
        // so it is a cache that a reload may lose without changing a result.
        const lowest = sim.windowStart(Math.max(0, w - 6));
        const found: Array<{ id: Id; time: GameTime }> = [];
        // every window looks at the live events; the first window of a session also looks at the saved ones, which a sweep may have taken out of memory
        const candidates = settled.size === 0 ? sim.k.persistence.discoveryIdsOfKind('core:event') : [...sim.k.store.eachIdOfKind('core:event')];
        for (const id of candidates) {
          if (settled.has(id) || seen.has(id)) continue;
          const h = sim.k.persistence.restoreReferencedHeader(id);
          if (!h || h.origin.by !== 'minted' || ownCreators.has(h.origin.creator) || /^item:\d+$/.test(h.origin.name)) { settled.add(id); continue; }
          const kind = sim.k.value(id, 'kind');
          const time = sim.k.value(id, 'time');
          if (typeof kind !== 'string' || typeof time !== 'number') continue;
          if (!WRONG_KINDS.includes(kind) || time < lowest) { settled.add(id); continue; }
          if (time <= T - 1) found.push({ id, time });
        }
        found.sort((a, b) => a.time - b.time || cmp(a.id, b.id));
        const taken = found
          .map((x) => ({ id: x.id, ev: sim.policies.viewEvent(x.id) }))
          .filter((x) => x.ev !== undefined && x.ev.creator !== undefined && !ownCreators.has(x.ev.creator));
        for (const { id, ev: e } of taken) {
          const cell = e!.place !== undefined ? sim.w.index.cells[e!.place] : undefined;
          if (!cell) continue;
          seen.add(id);
          st.seen.push(id);
          const pub = cell.public === 'public' && e!.witnesses.length >= sim.data.norms.publicMinWitnesses;
          queried.push({
            id, kind: e!.kind, size: 1, w, time: e!.time, cell: e!.place!, district: cell.district, public: pub, witnesses: e!.witnesses.length, policeChild: false, creator: 'sim',
            outcome: (e!.outcome as EventFact['outcome'] | undefined) ?? 'done', parties: partiesOf(sim, e!.participants, e!.time), effects: e!.effects.map((x) => ({ ...x })),
          });
        }
        if (st.seen.length > 256) st.seen = st.seen.slice(st.seen.length - 256);
      }
      const facts: EventFact[] = [...fe.items, ...fm.items, ...fn.items, ...queried];
      const norms = sim.data.norms.norms;
      const boost: GroupDigest['boost'] = {};
      const pairBoost: GroupDigest['pairBoost'] = {};
      const outGroups: GroupDigest['groups'] = {};
      const groupIds = Object.keys(st.groups).sort();
      const minted = (g: Id, name: string, kind: string, participants: Array<{ who: Id; role: string }>, causes: Id[], place: Id): void => {
        const spec = {
          cause: g, name, time: T + Math.floor(c.keys.decideT(w, g) * W), kind, place, participants, causes, outcome: 'done' as const,
        };
        // lifecycle notices pass the gate and are counted by no budget (S1 5.3)
        if (!c.produce({ kind, origin: 'sim', size: 1, window: w, participants, effects: [], creator: proc }).ok) return;
        ops.push({ op: 'mint-event', spec });
      };

      for (const id of groupIds) {
        const g = st.groups[id]!;
        const def = defOf(g.aff);
        const mine = classIdx(g.aff);
        // (2) books
        g.books.cash = g.books.cash + ((g.books.income - g.books.burn) * W) / DAY;
        // the lump sum per consumed shakedown incident (all sizes), in feed order, less the share expected to be refused (v0.6)
        const fee = norms.find((n) => n.id === 'fee');
        const beh = nm?.norms[g.district]?.fee?.beh ?? fee?.beh0 ?? 1;
        const keep = 1 - refusalShare(beh, sim.data.outcomes.refuseNC, sim.data.outcomes.refuseC);
        for (const row of fc.items) {
          if (row.district !== g.district || row.kind !== 'shakedown') continue;
          g.books.cash = g.books.cash + def.perShakedown * sim.city.offenderShare(g.district, 'shakedown', mine) * row.n * keep;
        }

        // (3) seats: bars end, holders are removed, successions, draws (S1 7.8)
        // a holder removed in this run still held the seat when the fact that removed them happened: harm to them weighs `leaderSev`
        const heldBefore = new Set(g.seats.filter((s) => s.holder !== null).map((s) => s.holder!));
        g.barred = g.barred.filter((b) => w < b.until);
        const heldBy = (): Set<Id> => new Set(g.seats.filter((s) => s.holder !== null).map((s) => s.holder!));
        const killedIn = (person: Id): Id | undefined => facts.find((f) => f.parties.some((p) => p.who === person && (p.role === 'victim' || p.role === 'target')) && (f.effects ?? []).some((e) => e.on === person && e.effect === 'kill'))?.id;
        const succession = (seat: Seat, successor: Id, predecessor: Id | undefined, cause: Id): void => {
          const alive = predecessor !== undefined && (sim.people.view(predecessor) ? sim.people.alive(predecessor, T) : sim.k.value(predecessor, 'alive', T) !== 'no');
          const parts: Array<{ who: Id; role: string }> = [{ who: id, role: 'group' }, { who: successor, role: 'successor' }];
          if (predecessor !== undefined) parts.push({ who: predecessor, role: alive ? 'predecessor' : 'late' });
          minted(id, `succession/${seat.seat}/${w}`, 'succession', parts, [cause], g.district);
          c.log({ w, proc: procId, kind: 'decision', reason: 'seat-taken', key: `${id}|${seat.seat}`, refs: [id, successor] });
        };
        // the removals: not alive, no longer a member, or arrested by a police action of size 2 or more that came out `done`
        const removed: Array<{ seat: Seat; cause: Id }> = [];
        for (const seat of g.seats) {
          if (seat.holder === null) continue;
          const h = seat.holder;
          const dead = sim.people.view(h) ? !sim.people.alive(h, T) : sim.k.value(h, 'alive', T) === 'no';
          const left = !dead && groupOf(sim, h, T) !== id;
          const arrest = facts.find((f) => f.district === g.district && f.kind === 'police-action' && f.size >= 2 && f.outcome === 'done' && f.parties.some((p) => p.role === 'target' && p.who === h));
          if (dead) removed.push({ seat, cause: killedIn(h) ?? id });
          else if (left) removed.push({ seat, cause: id });
          else if (arrest) {
            removed.push({ seat, cause: arrest.id });
            g.barred.push({ person: h, until: w + cfg.arrestBar, cause: arrest.id });
          }
        }
        let headLost = false;
        for (const r of removed) {
          const holder = r.seat.holder!;
          ops.push({ op: 'end-edge', id: edgeId(holder, id, r.seat.since * W) });
          r.seat.prev = holder;
          r.seat.holder = null;
          r.seat.edged = false;
          c.log({ w, proc: procId, kind: 'decision', reason: 'seat-vacant', key: `${id}|${r.seat.seat}`, refs: [id, holder, r.cause] });
          if (r.seat.seat === 0) headLost = true;
        }
        if (headLost) {
          g.interregnum = { until: w + cfg.interregnumW, cause: removed.find((r) => r.seat.seat === 0)!.cause };
          // the holder of the lowest-numbered held seat moves to the head's seat at once; every seat left vacant is drawn anew at the next window
          const head = g.seats[0]!;
          const next = g.seats.find((s) => s.seat > 0 && s.holder !== null);
          if (next) {
            const moved = next.holder!;
            ops.push({ op: 'end-edge', id: edgeId(moved, id, next.since * W) });
            next.prev = moved;
            next.holder = null;
            next.edged = false;
            next.retry = w + 1;
            head.holder = moved;
            head.since = w + 1;
            head.lean = leanOf(def, moved, id);
            head.edged = false;
            succession(head, moved, head.prev, removed.find((r) => r.seat.seat === 0)!.cause);
          } else head.retry = g.interregnum.until;
        }
        for (const r of removed) if (r.seat.seat !== 0 && r.seat.holder === null && r.seat.retry === undefined) r.seat.retry = w + 1;
        if (g.interregnum && w >= g.interregnum.until) delete g.interregnum;
        // the draws: a seat vacated is drawn at the next window with `succ + 1`; a failed draw is retried at each day boundary with `succ + 1` again
        for (const seat of g.seats) {
          if (seat.holder !== null || seat.retry === undefined || w < seat.retry) continue;
          // a head with no other holder is drawn when the interregnum ends
          if (seat.seat === 0 && g.interregnum && w < g.interregnum.until) continue;
          const succ = seat.succ + 1;
          const t = sim.windowStart(w);
          const holder = drawSeat(g, id, seat.seat, succ, t, w, heldBy());
          seat.succ = succ;
          if (holder === null) {
            seat.retry = w + (DAYW - (w % DAYW) || DAYW);
            c.log({ w, proc: procId, kind: 'decision', reason: 'seat-vacant', key: `${id}|${seat.seat}`, refs: [id] });
            continue;
          }
          delete seat.retry;
          seat.holder = holder;
          seat.since = w + 1;
          seat.lean = leanOf(def, holder, id);
          seat.edged = false;
          succession(seat, holder, seat.prev, id);
        }
        // a canon holder whose bar has ended takes the seat back at once, as a succession (S1 7.8)
        for (const cs of cfg.canonSeats ?? []) {
          if (cs.aff !== g.aff) continue;
          const seat = g.seats[cs.seat];
          if (!seat) continue;
          const node = canonHolder(g, id, cs.seat, T, w, heldBy());
          if (node === undefined || seat.holder === node) continue;
          if (seat.holder !== null) {
            ops.push({ op: 'end-edge', id: edgeId(seat.holder, id, seat.since * W) });
            seat.prev = seat.holder;
          }
          seat.holder = node;
          seat.since = w + 1;
          seat.lean = leanOf(def, node, id);
          seat.edged = false;
          succession(seat, node, seat.prev, id);
        }
        // a seat that no resident could take at initialisation is vacant, and logged once
        for (const seat of g.seats) {
          if (seat.holder === null && seat.succ === 0 && !seat.logged) {
            seat.logged = true;
            c.log({ w, proc: procId, kind: 'decision', reason: 'seat-vacant', key: `${id}|${seat.seat}`, refs: [id] });
          }
        }
        // the holders' edges: `xf:leads`, `Id` `H("edge", "xf:leads", holder, group, since)`, cause the group node or the succession
        for (const seat of g.seats) {
          if (seat.holder === null || seat.edged) continue;
          ops.push({ op: 'edge', type: 'xf:leads', from: seat.holder, to: id, attrs: { seat: seat.seat }, valid: { from: seat.since * W }, cause: id, id: edgeId(seat.holder, id, seat.since * W) });
          seat.edged = true;
        }
        const holders = new Set(g.seats.filter((s) => s.holder !== null).map((s) => s.holder!));

        // (4) pulses, by function (S1 7.8): each fill `wrong(by, to)` of a fact that applies at its outcome
        for (const f of facts) {
          if (f.district !== g.district) continue;
          const kd = sim.w.kinds.get(f.kind);
          if (!kd) continue;
          const parts = f.parties.map((p) => ({ who: p.who, role: p.role }));
          const put = (drive: string, p: Pulse, u0: number, tau: number, hold = 0): void => {
            if (!(drive in def.ethos)) return;
            const cur = g.pulse[drive];
            if (pulseReplaces(cur, p, u0, tau * DAY, hold, T)) g.pulse[drive] = p;
          };
          for (const fl of applicableFills(kd.fills, f.outcome, parts, f.cell, f.id)) {
            if (fl.fn !== 'wrong') continue;
            const to = fl.args.to;
            const by = fl.args.by;
            if (to === undefined) continue;
            const gTo = f.parties.find((p) => p.who === to)?.group;
            const gBy = by === undefined ? undefined : f.parties.find((p) => p.who === by)?.group;
            const effs = (f.effects ?? []).filter((e) => e.on === to && HARM.includes(e.effect));
            const effect = effs.length > 0 ? (effs.find((e) => e.effect === 'kill') ?? effs[0]!).effect : 'none';
            const sev = Math.min(1, cfg.pulses.sev[Math.min(4, f.size) - 1]! * (cfg.effectW[effect] ?? 0.5) * (holders.has(to) || heldBefore.has(to) ? cfg.leaderSev : 1));
            if (gTo === id && gBy !== id) {
              const wardTo = to;
              put('care_of_members', { at: f.time, sev, latched: false, src: f.id }, cfg.pulses.careU0, cfg.pulses.careTauDays);
              if (f.public || holders.has(to) || heldBefore.has(to)) put('reputation', { at: f.time, sev, latched: false, src: f.id }, cfg.pulses.repU0, cfg.pulses.repTauDays);
              const byAff = gBy === undefined ? undefined : affOfGroup(sim, gBy);
              if (byAff !== undefined && st.groups[gBy!] !== undefined && by !== sim.w.v) {
                const lp: Pulse = { at: f.time, sev, latched: true, pub: f.public, rival: classIdx(byAff), src: f.id, ward: wardTo };
                if (by !== undefined) lp.wrongdoer = by;
                put('retribution', lp, cfg.pulses.retU0, cfg.pulses.retTauDays, cfg.pulses.retHold);
              }
            } else if (gBy === id && gTo !== undefined && gTo !== id) {
              const toAff = affOfGroup(sim, gTo);
              if (toAff !== undefined) {
                const r = g.pulse.retribution;
                if (r && r.latched && r.releasedAt === undefined && r.rival === classIdx(toAff)) r.releasedAt = f.time;
              }
            }
          }
          // a public refusal of a norm the group enforces is a defiance (S1 7.5): a reputation pulse of severity 0.6
          for (const norm of norms) {
            if (sim.w.group(g.district, norm.enforcer.aff) !== id || !f.public) continue;
            for (const rf of norm.refusals ?? []) {
              if (f.kind !== rf.kind || !rf.outcomes.includes(f.outcome as 'failed' | 'prevented')) continue;
              const demander = rf.demander.split('|').map((r) => f.parties.find((p) => p.role === r)).find((p) => p !== undefined);
              if (demander === undefined || (demander.group ?? demander.who) !== id) continue;
              put('reputation', { at: f.time, sev: cfg.defianceSev, latched: false, src: f.id }, cfg.pulses.repU0, cfg.pulses.repTauDays);
            }
          }
        }
        // a latched pulse also ends by exhaustion after 90 days
        for (const [drive, p] of Object.entries(g.pulse)) if (p.latched && T - p.at > cfg.latchExhaustDays * DAY && p.releasedAt === undefined) delete g.pulse[drive];
        // (5, 6) pressures, operative weights, divergence and the gap band
        const U = pressures(sim, def, g, T);
        const op = operative(sim, def.ethos, U, leadShares(def.ethos, g.seats, cfg.seatHead));
        g.W = op.W;
        g.D = op.D;
        const band = groupBand(g.gapBand, op.D, sim);
        if (band !== g.gapBand) {
          ops.push({ op: 'pin', node: id, slot: `group-gap@w${w + 1}`, value: GAP_NAMES[band]! });
          changes.push({ key: `group-gap|${id}`, t: T + W, value: GAP_NAMES[band]!, prev: GAP_NAMES[g.gapBand]! });
          g.gapBand = band;
        }

        // (7) the intention lifecycle
        const it = g.intent;
        const deciderOf = (serves: string): Id | undefined => g.seats.find((s) => s.holder !== null && s.lean === serves)?.holder ?? g.seats[0]!.holder ?? undefined;
        const objectOf = (i: Extract<Intent, { state: 'active' }>): Id | undefined => {
          if (i.name === 'retaliate' && i.rival !== undefined) {
            const a = (['A1', 'A2', 'A3'] as const)[i.rival - 2];
            return a === undefined ? undefined : sim.w.group(g.district, a);
          }
          return i.ward;
        };
        let mayStart = true;
        if (it.state === 'cooling') {
          mayStart = false;
          if (w + 1 >= it.until) g.intent = { state: 'none' };
        } else if (it.state === 'active') {
          const idf = intentDef(it.name ?? it.id);
          const stop = (op.w[it.drive] ?? 0) < cfg.thetaStop;
          if (w + 1 >= it.expires || stop) {
            const outcome = stop && w + 1 < it.expires ? 'ended' : 'done';
            c.log({ w, proc: procId, kind: 'decision', reason: 'intent-end', key: `${id}|${it.name ?? it.id}|${outcome}`, refs: [id] });
            // the end is an event: `relent.<intention>`, its participants those of its decision, its cause the decision (S1 7.8)
            const decider = it.decider ?? deciderOf(idf.serves);
            const parts: Array<{ who: Id; role: string }> = [{ who: id, role: 'group' }];
            if (decider !== undefined) parts.push({ who: decider, role: 'decider' });
            const obj = objectOf(it);
            if (obj !== undefined) parts.push({ who: obj, role: 'object' });
            minted(id, `relent/${idf.id}/${w}`, `relent.${idf.id}`, parts, [it.id], g.district);
            g.intent = { state: 'cooling', until: w + 1 + idf.cooling };
          }
          mayStart = false;
        }
        const headHeld = g.seats[0]!.holder !== null && g.interregnum === undefined;
        if (mayStart && (g.intent.state === 'none' || g.intent.state === 'idle') && !headHeld) {
          if (!g.interregnum?.logged && g.interregnum) {
            g.interregnum.logged = true;
            c.log({ w, proc: procId, kind: 'decision', reason: 'intent-leaderless', key: id, refs: [id] });
          }
        } else if (mayStart && (g.intent.state === 'none' || g.intent.state === 'idle')) {
          const cand = Object.keys(def.ethos).filter((d) => (op.w[d] ?? 0) >= cfg.thetaStart).sort((a, b) => (op.w[b]! - op.w[a]!) || cmp(a, b));
          if (cand.length === 0) {
            if (g.intent.state === 'idle' && !Object.keys(def.ethos).some((d) => (op.w[d] ?? 0) >= cfg.thetaStop)) g.intent = { state: 'none' };
          } else {
            let started = false;
            for (const drive of cand) {
              const idf = cfg.intents.find((i) => def.intents.includes(i.id) && i.serves === drive && i.groups.includes(g.aff));
              if (!idf) continue;
              let rival: number | undefined;
              let src: Pulse | undefined;
              if (idf.id === 'retaliate') {
                const r = g.pulse.retribution;
                if (!r || !r.latched || r.releasedAt !== undefined || r.rival === undefined) continue;
                const hazard = cfg.h0 * (1 + cfg.hazardPublic * (r.pub ? 1 : 0));
                if (!(c.keys.retal(w, id, r.rival) < hazard)) continue;
                rival = r.rival;
                src = r;
              } else if (idf.id === 'protect-members') src = g.pulse.care_of_members;
              // the decision is an event; the intention's id is its Id (S1 7.8)
              const decisionId = mintedId(proc, id, `decide/${idf.id}/${w}`);
              const ward = src?.ward;
              const wrongdoer = src?.wrongdoer;
              const active: Extract<Intent, { state: 'active' }> = { state: 'active', id: decisionId, name: idf.id, drive, since: w + 1, expires: w + 1 + idf.duration };
              if (rival !== undefined) active.rival = rival;
              if (ward !== undefined && (idf.id === 'protect-members' || idf.id === 'retaliate')) active.ward = ward;
              if (wrongdoer !== undefined && idf.id === 'retaliate') active.wrongdoer = wrongdoer;
              const decider = deciderOf(idf.serves);
              if (decider !== undefined) active.decider = decider;
              g.intent = active;
              const parts: Array<{ who: Id; role: string }> = [{ who: id, role: 'group' }];
              if (decider !== undefined) parts.push({ who: decider, role: 'decider' });
              const obj = objectOf(active);
              if (obj !== undefined) parts.push({ who: obj, role: 'object' });
              minted(id, `decide/${idf.id}/${w}`, `decide.${idf.id}`, parts, src?.src !== undefined ? [src.src] : [], g.district);
              c.log({ w, proc: procId, kind: 'decision', reason: 'intent-start', key: `${id}|${idf.id}`, refs: [id] });
              started = true;
              break;
            }
            if (!started && g.intent.state === 'none') {
              g.intent = { state: 'idle', drive: cand[0]!, since: w };
              c.log({ w, proc: procId, kind: 'decision', reason: 'intent-idle', key: `${id}|${cand[0]}`, refs: [id] });
            }
          }
        }
        // (8) boosts and the digest
        const now = g.intent;
        const b = ((boost[g.district] ??= {})[mine] ??= {});
        if (now.state === 'active') {
          const idf = intentDef(now.name ?? now.id);
          for (const [kind, v] of Object.entries(idf.boost)) b[kind] = Math.min(cfg.boostMax, Math.max(cfg.boostMin, (b[kind] ?? 0) + v));
          if (idf.pairMult !== undefined && now.rival !== undefined) (pairBoost[g.district] ??= []).push({ a: mine, b: now.rival, mult: idf.pairMult, until: now.expires });
        }
        // an interregnum loosens discipline: members act unrestrained (S1 7.8)
        if (g.interregnum) for (const kind of ['assault', 'theft']) b[kind] = Math.min(cfg.boostMax, Math.max(cfg.boostMin, (b[kind] ?? 0) + cfg.interregnumBoost));
        if (Object.keys(b).length === 0) delete boost[g.district]![mine];
        if (boost[g.district] && Object.keys(boost[g.district]!).length === 0) delete boost[g.district];
        outGroups[id] = {
          aff: g.aff, U, W: op.W, D: op.D, band: g.gapBand, intent: now.state === 'active' ? `active:${now.name ?? now.id}` : now.state, ...(now.state === 'active' ? { until: now.expires } : {}),
          seats: g.seats.map((s) => ({ seat: s.seat, holder: s.holder })), interregnum: g.interregnum !== undefined,
          active: now.state === 'active' ? { name: now.name ?? now.id, id: now.id, since: now.since, until: now.expires, ...(now.rival !== undefined ? { rival: now.rival } : {}), ...(now.ward !== undefined ? { ward: now.ward } : {}), ...(now.wrongdoer !== undefined ? { wrongdoer: now.wrongdoer } : {}) } : null,
        };
      }
      const prev = c.digest<GroupDigest>(procId);
      return { ops, state: st, digest: { v: 1, through: w, groups: outGroups, boost, pairBoost, changes: pushTransitions(prev?.changes, w, changes, sim.data.feed.keep) } };
    },
  };
}

const DAYW = 144;
