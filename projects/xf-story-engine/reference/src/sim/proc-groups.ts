// `group.decide` (S1 7.8): makes the Tyger Claws and The Mox of Kabuki actors in the smallest useful way: books that run out,
// grudges that build, four pressures each, and two simple intentions that start, expire and are removed. What a group wants reaches
// the city as a rate boost. No decision depends on demand: the process calls no `demanded`, and member orders are a later capability.
//
// Pressures are derived (a pure function of timestamped facts and the query time) and never pinned (S1-I-20).

import type { ProcessOp } from '../evolution.ts';
import type { GameTime, Id } from '../types.ts';
import { clip01, exptab } from './arith.ts';
import type { GroupDef, IntentDef } from './data.ts';
import { recipeClasses } from './fit.ts';
import { type DigestBase, type EventFact, type Feed, type Transition, feedAfter, pushFeed } from './occ.ts';
import type { EventsDigest } from './proc-events.ts';
import type { MirrorDigest } from './proc-mirror.ts';
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
}

export type Intent =
  | { state: 'none' }
  | { state: 'idle'; drive: string; since: number }
  | { state: 'active'; id: string; drive: string; since: number; expires: number; rival?: number }
  | { state: 'cooling'; until: number };

export interface G {
  aff: 'A1' | 'A2';
  district: Id;
  books: { cash: number; burn: number; income: number };
  pulse: Record<string, Pulse>;
  intent: Intent;
  W: Record<string, number>;
  D: number;
  gapBand: 0 | 1 | 2;
}

export interface GroupState {
  v: 1;
  groups: Record<Id, G>;
  cursors: { events: number; mirror: number };
}

export interface GroupDigest extends DigestBase {
  groups: Record<Id, { aff: string; U: Record<string, number>; W: Record<string, number>; D: number; intent: string; until?: number }>;
  /** District, then affiliation class index, then kind. */
  boost: Record<Id, Record<number, Record<string, number>>>;
  pairBoost: Record<Id, Array<{ a: number; b: number; mult: number; until: number }>>;
  changes: Feed<Transition>;
}

const DAY = 86400;
const GAP_NAMES = ['low', 'mid', 'high'] as const;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

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

/** The operative weights, the divergence and the intention weights (S1 7.8). */
export function operative(sim: Sim, ethos: Record<string, number>, U: Record<string, number>): { W: Record<string, number>; D: number; w: Record<string, number> } {
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
    W[d] = 0.5 * en + 0.5 * un;
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

export function groupsProcess(sim: Sim): S1Process<GroupState, GroupDigest> {
  const procId = 'group.decide';
  const cfg = sim.data.groups;
  const W = sim.data.time.W;
  const defOf = (aff: 'A1' | 'A2'): GroupDef => cfg.groups.find((g) => g.aff === aff)!;
  const classIdx = (aff: 'A1' | 'A2'): number => (aff === 'A1' ? 2 : 3);
  const intentDef = (id: string): IntentDef => cfg.intents.find((i) => i.id === id)!;

  return {
    id: procId, version: PROCESS_VERSIONS[procId]!, tier: 0, coarseFine: { kind: 'exact' }, lag: 0,
    init: () => {
      const groups: GroupState['groups'] = {};
      for (const d of simulatedDistricts(sim.w.index)) {
        for (const def of cfg.groups) {
          groups[sim.w.group(d.id, def.aff)] = {
            aff: def.aff, district: d.id, books: { ...def.books }, pulse: {}, intent: { state: 'none' }, W: {}, D: 0, gapBand: 0,
          };
        }
      }
      return { v: 1, groups, cursors: { events: -1, mirror: -1 } };
    },

    run(c: S1Ctx, w: number): S1Result<GroupState, GroupDigest> {
      const st = c.own<GroupState>();
      const T = c.T;
      const ops: ProcessOp[] = [];
      const changes: Transition[] = [];
      const ev = c.digest<EventsDigest>('city.events');
      const mr = c.digest<MirrorDigest>('city.mirror');
      const fe = feedAfter(ev?.facts, st.cursors.events);
      const fc = feedAfter(ev?.counts, st.cursors.events);
      const fm = feedAfter(mr?.facts, st.cursors.mirror);
      if (fe.gap) c.log({ w, proc: procId, kind: 'defect', reason: 'feed-gap', key: 'city.events', refs: [] });
      if (fm.gap) c.log({ w, proc: procId, kind: 'defect', reason: 'feed-gap', key: 'city.mirror', refs: [] });
      st.cursors.events = Math.max(fe.through, fc.through);
      st.cursors.mirror = fm.through;
      const facts: EventFact[] = [...fe.items, ...fm.items];
      const boost: GroupDigest['boost'] = {};
      const pairBoost: GroupDigest['pairBoost'] = {};
      const outGroups: GroupDigest['groups'] = {};

      for (const id of Object.keys(st.groups).sort()) {
        const g = st.groups[id]!;
        const def = defOf(g.aff);
        const mine = classIdx(g.aff);
        const district = sim.w.district(g.district);
        const cls = recipeClasses(district);
        // (2) books
        g.books.cash = g.books.cash + ((g.books.income - g.books.burn) * W) / DAY;
        // the lump sum per consumed shakedown incident (all sizes), in feed order
        for (const row of fc.items) {
          if (row.district !== g.district || row.kind !== 'shakedown') continue;
          g.books.cash = g.books.cash + def.perShakedown * sim.city.offenderShare(g.district, 'shakedown', mine) * row.n;
        }
        // (3) pulses
        for (const f of facts) {
          if (f.district !== g.district) continue;
          const sev = cfg.pulses.sev[Math.min(4, f.size) - 1]!;
          const put = (drive: string, p: Pulse, u0: number, tau: number, hold = 0): void => {
            if (!(drive in def.ethos)) return;
            const cur = g.pulse[drive];
            if (pulseReplaces(cur, p, u0, tau * DAY, hold, T)) g.pulse[drive] = p;
          };
          if ((f.kind === 'gang-clash' || f.kind === 'assault') && f.sides?.b === mine) {
            put('care_of_members', { at: f.time, sev, latched: false }, cfg.pulses.careU0, cfg.pulses.careTauDays);
            const a = f.sides.a;
            const rivalOk = a !== undefined && (cls[a] === 'gang' || a === 5);
            const lp: Pulse = { at: f.time, sev, latched: true, pub: f.public };
            if (rivalOk) lp.rival = a;
            put('retribution', lp, cfg.pulses.retU0, cfg.pulses.retTauDays, cfg.pulses.retHold);
            if (f.public) put('reputation', { at: f.time, sev, latched: false }, cfg.pulses.repU0, cfg.pulses.repTauDays);
          }
          if (f.kind === 'gang-clash' && f.sides?.a === mine && f.sides.b !== undefined && (cls[f.sides.b] === 'gang' || f.sides.b === 5)) {
            const r = g.pulse.retribution;
            if (r && r.latched && r.releasedAt === undefined && r.rival === f.sides.b) r.releasedAt = f.time;
          }
        }
        // a latched pulse also ends by exhaustion after 90 days
        for (const [drive, p] of Object.entries(g.pulse)) if (p.latched && T - p.at > cfg.latchExhaustDays * DAY && p.releasedAt === undefined) delete g.pulse[drive];
        // (4, 5) pressures, operative weights, divergence and the gap band
        const U = pressures(sim, def, g, T);
        const op = operative(sim, def.ethos, U);
        g.W = op.W;
        g.D = op.D;
        const band = groupBand(g.gapBand, op.D, sim);
        if (band !== g.gapBand) {
          ops.push({ op: 'pin', node: id, slot: `group-gap@w${w + 1}`, value: GAP_NAMES[band]! });
          changes.push({ key: `group-gap|${id}`, t: T + W, value: GAP_NAMES[band]!, prev: GAP_NAMES[g.gapBand]! });
          g.gapBand = band;
        }
        // (6) the intention lifecycle
        const it = g.intent;
        // an intention that has just cooled is `none` for a window before another may start; one that has just ended cools
        let mayStart = true;
        if (it.state === 'cooling') {
          mayStart = false;
          if (w + 1 >= it.until) g.intent = { state: 'none' };
        } else if (it.state === 'active') {
          const idf = intentDef(it.id);
          const stop = (op.w[it.drive] ?? 0) < cfg.thetaStop;
          if (w + 1 >= it.expires || stop) {
            c.log({ w, proc: procId, kind: 'decision', reason: 'intent-end', key: `${id}|${it.id}|${stop && w + 1 < it.expires ? 'ended' : 'done'}`, refs: [id] });
            g.intent = { state: 'cooling', until: w + 1 + idf.cooling };
          }
          mayStart = false;
        }
        if (mayStart && (g.intent.state === 'none' || g.intent.state === 'idle')) {
          const cand = Object.keys(def.ethos).filter((d) => (op.w[d] ?? 0) >= cfg.thetaStart).sort((a, b) => (op.w[b]! - op.w[a]!) || cmp(a, b));
          if (cand.length === 0) {
            if (g.intent.state === 'idle' && !Object.keys(def.ethos).some((d) => (op.w[d] ?? 0) >= cfg.thetaStop)) g.intent = { state: 'none' };
          } else {
            let started = false;
            for (const drive of cand) {
              const idf = cfg.intents.find((i) => def.intents.includes(i.id) && i.serves === drive && i.groups.includes(g.aff));
              if (!idf) continue;
              let rival: number | undefined;
              if (idf.id === 'retaliate') {
                const r = g.pulse.retribution;
                if (!r || !r.latched || r.releasedAt !== undefined || r.rival === undefined) continue;
                const hazard = cfg.h0 * (1 + cfg.hazardPublic * (r.pub ? 1 : 0));
                if (!(c.keys.retal(w, id, r.rival) < hazard)) continue;
                rival = r.rival;
              }
              g.intent = { state: 'active', id: idf.id, drive, since: w + 1, expires: w + 1 + idf.duration, ...(rival !== undefined ? { rival } : {}) };
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
        // (7) boosts and the digest
        const now = g.intent;
        if (now.state === 'active') {
          const idf = intentDef(now.id);
          const b = ((boost[g.district] ??= {})[mine] ??= {});
          for (const [kind, v] of Object.entries(idf.boost)) b[kind] = Math.min(cfg.boostMax, Math.max(cfg.boostMin, (b[kind] ?? 0) + v));
          if (idf.pairMult !== undefined && now.rival !== undefined) (pairBoost[g.district] ??= []).push({ a: mine, b: now.rival, mult: idf.pairMult, until: now.expires });
        }
        outGroups[id] = { aff: g.aff, U, W: op.W, D: op.D, intent: now.state === 'active' ? `active:${now.id}` : now.state, ...(now.state === 'active' ? { until: now.expires } : {}) };
      }
      const prev = c.digest<GroupDigest>(procId);
      return { ops, state: st, digest: { v: 1, through: w, groups: outGroups, boost, pairBoost, changes: pushFeed(prev?.changes, w, changes, sim.data.feed.keep) } };
    },
  };
}
