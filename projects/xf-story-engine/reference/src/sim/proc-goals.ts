// `people.goals` (S1 7.10, v0.6): gives the city's people goals of their own, in the smallest form that lets stories grow out of what
// people want and do: someone wronged wants redress; someone owed calls the debt in; a member carries out what the group decided; a
// person a seed cast pursues what the seed gave them. A goal is a retained frame on its owner, acts only through `city.events`' goal-act
// rate (S1 7.2), and ends by a recorded event or a deadline. The process mints no event: it makes goals, ends them, and keeps the
// posts members stand at. Everything it reads is coarse-readable (S1 10.1): recorded facts, digests, the record's entries.
//
// A goal's source owns it by eligibility alone; capacity is admission, decided by the caps after the owner is chosen. The post history is
// the one record `where` and `guarded` read, so an occurrence casts and draws its outcome the same whichever later digest is read (S1-I-34).

import { mintedId } from '../id.ts';
import type { ProcessOp } from '../evolution.ts';
import { processCause } from '../evolution.ts';
import type { FrameSpec } from '../frames.ts';
import type { GameTime, Id, Selector } from '../types.ts';
import { invCum, q64 } from './arith.ts';
import type { Duty, DutyDef } from './data.ts';
import { applicableFills } from './fills.ts';
import { ForeignEvents } from './foreign.ts';
import { type DigestBase, type EventFact, type Feed, type Transition, feedAfter, pushFeed, pushTransitions } from './occ.ts';
import { groupOf } from './outcomes.ts';
import type { PostRec } from './outcomes.ts';
import type { EventsDigest } from './proc-events.ts';
import type { GroupDigest } from './proc-groups.ts';
import type { MirrorDigest } from './proc-mirror.ts';
import type { NormsDigest } from './proc-norms.ts';
import { PROCESS_VERSIONS, type S1Ctx, type S1Process, type S1Result } from './s1ctx.ts';
import type { Sim } from './sim.ts';
import { simulatedDistricts } from './index-types.ts';

export type GoalKind = 'redress' | 'collect' | 'carry-out' | 'role';

export interface GoalRec {
  /** The goal frame's Id; for a role goal, the seed's frame. */
  id: Id;
  kind: GoalKind;
  duty?: Duty;
  slot?: number;
  owner: Id;
  target?: Id;
  ward?: Id;
  item?: Id;
  /** The event, decision or frame that opened it. */
  source: Id;
  /** A carry-out goal's intention, and the rung entry that gave it. */
  intent?: { group: Id; decision: Id; name: string; rung?: 1 | 2 | 3; entry?: number };
  /** The act kinds, in preference order. */
  acts: string[];
  /** 0 to 1, on the 1/64 grid. */
  motive: number;
  /** Windows; a role goal has no expiry of S1's. */
  opened: number;
  expires?: number;
  post?: { cell: Id; periods: number[] };
  state: 'active' | 'blocked';
  blocked?: 'target-protected' | 'owner-cast';
}

export interface GoalsState {
  v: 1;
  /** In `Id` order. */
  goals: GoalRec[];
  /** The post history: active, and ended within `WEEK` windows; `ward` for a guard's post, so `guarded` needs no current goal. */
  posts: PostRec[];
  /** By intention (decision Id), the rung entry whose duties were last given; dropped once the intention has left the `group.decide` digest. */
  entries: Record<Id, number>;
  /** Seed and port events taken (favour, promise, repair), at most 256. */
  seen: Id[];
  /** Favours and promises not yet due, at most 64, by due window. */
  debts: Array<{ event: Id; creditor: Id; debtor: Id; due: number }>;
  cursors: { events: number; mirror: number; norms: number; groups: number; roleGoals: number };
  counters: { opened: number; ended: number; capped: number; unfilled: number };
}

export type GoalView = GoalRec & { punish?: { group: Id; intent: Id; rung: 1 | 2 | 3; cause: Id } };

export interface GoalsDigest extends DigestBase {
  /** State view: the active and blocked goals, role goals included; `punish` is set on the duties of a punish intention. */
  goals: GoalView[];
  /** State view: the history `where` reads (S1 4.5). */
  posts: PostRec[];
  /** Ward to the indexes in `posts` of the posts that guard it, history included: the `guarded` index. */
  wards: Record<Id, number[]>;
  /** Target or ward to the goals aimed at them: the state-query index (S1 9.1a). */
  byTarget: Record<Id, Id[]>;
  /** Who owned and what kind each goal with a transition in `changes` was, ended ones included: what a per-person read (`wants`) replays the feed by. */
  recent: Record<Id, { owner: Id; kind: GoalKind }>;
  /** Key `goal|<id>`: open, blocked, active, satisfied, abandoned. */
  changes: Feed<Transition>;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const DAY = 86400;
const HARM = ['harm', 'kill', 'take', 'expose'];
const DEBT_KINDS = ['favour', 'promise', 'repair'];

export const emptyGoals = (): GoalsState => ({
  v: 1, goals: [], posts: [], entries: {}, seen: [], debts: [], cursors: { events: -1, mirror: -1, norms: -1, groups: -1, roleGoals: -1 }, counters: { opened: 0, ended: 0, capped: 0, unfilled: 0 },
});

/** The act a seed's effect asks for (S1 7.10): `take` is a theft, `harm` an assault, `protect` a presence; any other effect asks for none. */
export const ROLE_ACTS: Record<string, string> = { take: 'theft', harm: 'assault', protect: 'presence' };

export function goalsProcess(sim: Sim): S1Process<GoalsState, GoalsDigest> {
  const procId = 'people.goals';
  const proc = processCause(procId);
  const cfg = sim.data.goals;
  const gcfg = sim.data.groups;
  const W = sim.data.time.W;
  const DAYW = DAY / W;
  const WEEK = (7 * DAY) / W;
  const k = sim.k;
  const v = sim.w.v;
  const WRONG_KINDS = [...sim.w.kinds.kinds.values()].filter((kd) => kd.fills.some((f) => f.fn === 'wrong')).map((kd) => kd.name);
  const foreign = new ForeignEvents(sim, [...new Set([...WRONG_KINDS, ...DEBT_KINDS])]);
  const classIdx = (aff: string): number => ({ A1: 2, A2: 3, A3: 4 })[aff as 'A1']!;
  const dutyOf = (intent: string, duty: Duty): DutyDef | undefined => gcfg.intents.find((i) => i.id === intent)?.duties?.find((d) => d.duty === duty);

  const isPerson = (n: Id): boolean => {
    if (sim.people.view(n) !== undefined) return true;
    k.persistence.recoverIfSaved(n);
    return k.persistence.restoreReferencedHeader(n)?.kind === 'xf:person';
  };
  const aliveAt = (n: Id, t: GameTime): boolean => (sim.people.view(n) ? sim.people.alive(n, t) : k.value(n, 'alive', t) !== 'no');
  const castBySeed = (n: Id, t: GameTime): boolean => {
    k.persistence.recoverIfSaved(n);
    for (const e of k.store.edgesTo(n)) if (e.type === 'core:cast' && e.valid.from <= t && (e.valid.to === undefined || t < e.valid.to) && k.retention.seeds.has(e.from)) return true;
    return false;
  };
  /** Who may own a goal (S1 7.10): structural, never capacity. A role goal may be owned by a person a seed casts. */
  const eligible = (p: Id, t: GameTime, allowCast = false): boolean => {
    if (p === v) return false;
    const rv = sim.people.view(p);
    if (rv) {
      if (!sim.people.alive(p, t) || rv.ageClass !== 'adult') return false;
    } else {
      k.persistence.recoverIfSaved(p);
      if (k.persistence.restoreReferencedHeader(p)?.kind !== 'xf:person') return false;
      if (sim.spine.has(p) || sim.people.essential.has(p) || k.value(p, 'quest-linked', t) === 'yes') return false;
      if (k.value(p, 'alive', t) === 'no' || k.value(p, 'age-class', t) !== 'adult') return false;
    }
    return allowCast || !castBySeed(p, t);
  };
  const districtOfPerson = (p: Id): Id => {
    const rv = sim.people.view(p);
    if (rv) return sim.w.cell(rv.cell).district;
    return ''; // a mirrored person is placed by the game, which a coarse process does not read: such goals share one bucket of the district cap
  };
  const householdOf = (p: Id): Id[] => {
    const ref = sim.people.refOf(p);
    if (!ref) return [];
    const size = sim.people.blockInfo(ref.cell).sizes[ref.hIndex] ?? 0;
    const out: Id[] = [];
    for (let j = 0; j < size; j++) out.push(sim.people.residentId(ref.household, j));
    return out;
  };
  /** Whether an act kind carries a harmful effect on its victim (S1 7.10 blocking). */
  const harmful = (act: string): boolean => (sim.w.kinds.get(act)?.effects ?? []).some((e) => HARM.includes(e.effect));
  const placeOfWork = (r: Id): { cell: Id; periods: number[] } | undefined => {
    const rv = sim.people.view(r);
    if (!rv) return undefined;
    const rows = sim.data.people.schedules[rv.archetype] ?? sim.data.people.schedules.resident!;
    const periods = [0, 1, 2, 3].filter((p) => rows[p]![1]! > 0);
    const cell = sim.people.placeOf(rv, 'work', 0, 0);
    return cell === undefined ? undefined : { cell, periods };
  };

  /**
   * `knownPlaces(group)` (S1 7.10): the cells, newest first, distinct, at most 3, of the act events behind the group's held grievances and, for a
   * group that is a carrier, its items about V, within its district; else the district's market cells by `pop`, the most public first.
   */
  const knownPlaces = (group: Id, district: Id): Id[] => {
    const seen: Array<{ at: GameTime; cell: Id }> = [];
    for (const b of k.beliefs.activeOf(group)) {
      if (!b.memorable || b.subject !== v || !(b.path === 'against' || b.path.startsWith('rep-'))) continue;
      const origin = b.evidence[0];
      if (origin === undefined) continue;
      const place = k.value(origin, 'place');
      if (typeof place !== 'string' || sim.w.index.cells[place]?.district !== district) continue;
      seen.push({ at: b.at ?? 0, cell: place });
    }
    seen.sort((a, b) => b.at - a.at || cmp(a.cell, b.cell));
    const out: Id[] = [];
    for (const s of seen) if (!out.includes(s.cell) && out.length < cfg.knownPlaces) out.push(s.cell);
    if (out.length > 0) return out;
    const markets = sim.w.district(district).cellIds.filter((c) => sim.w.cell(c).marketCell).map((c) => ({ c, pop: sim.city.meanPop(c, 1) }));
    markets.sort((a, b) => b.pop - a.pop || cmp(a.c, b.c));
    return markets.slice(0, cfg.knownPlaces).map((x) => x.c);
  };

  const frameName = (g: Pick<GoalRec, 'kind' | 'owner' | 'duty' | 'slot'> & { rung?: number; entry?: number }): string =>
    `goal/${g.kind}/${g.owner}/${g.duty ?? ''}/${g.rung ?? 0}/${g.entry ?? 0}/${g.slot ?? 0}`;

  return {
    id: procId, version: PROCESS_VERSIONS[procId]!, tier: 2, coarseFine: { kind: 'exact' }, lag: 0,
    init: () => emptyGoals(),
    cloneState: (st) => structuredClone(st),

    run(c: S1Ctx, w: number): S1Result<GoalsState, GoalsDigest> {
      const st = c.own<GoalsState>();
      const T = c.T;
      const ops: ProcessOp[] = [];
      const changes: Transition[] = [];
      const prev = c.digest<GoalsDigest>(procId);
      const peek = <D>(id: string): D | undefined => k.evolution.digestPeek<D>(id);
      const ev = peek<EventsDigest>('city.events');
      const mr = peek<MirrorDigest>('city.mirror');
      const nm = peek<NormsDigest>('order.norms');
      const gd = peek<GroupDigest>('group.decide');

      // ---- (1) consume ----
      const fe = feedAfter(ev?.facts, st.cursors.events);
      const fm = feedAfter(mr?.facts, st.cursors.mirror);
      const fn = feedAfter(nm?.facts, st.cursors.norms);
      const fg = feedAfter(gd?.lifecycle, st.cursors.groups);
      if (fe.gap) c.log({ w, proc: procId, kind: 'defect', reason: 'feed-gap', key: 'city.events', refs: [] });
      if (fm.gap) c.log({ w, proc: procId, kind: 'defect', reason: 'feed-gap', key: 'city.mirror', refs: [] });
      if (fn.gap) c.log({ w, proc: procId, kind: 'defect', reason: 'feed-gap', key: 'order.norms', refs: [] });
      if (fg.gap) c.log({ w, proc: procId, kind: 'defect', reason: 'feed-gap', key: 'group.decide', refs: [] });
      st.cursors.events = fe.through;
      st.cursors.mirror = fm.through;
      st.cursors.norms = fn.through;
      st.cursors.groups = fg.through;
      const rec = c.record();
      const roleEntries = rec.roleGoals.filter((e) => e.seq > st.cursors.roleGoals);
      for (const e of roleEntries) st.cursors.roleGoals = Math.max(st.cursors.roleGoals, e.seq);

      const seen = new Set(st.seen);
      const facts: EventFact[] = [...fe.items, ...fm.items, ...fn.items];
      const repairs: Array<{ a: Id; b: Id; id: Id; time: GameTime }> = [];
      for (const { id, ev: e } of foreign.scan(w, T, seen)) {
        seen.add(id);
        st.seen.push(id);
        if (e.kind === 'favour' || e.kind === 'promise') {
          const creditor = e.participants.find((p) => p.role === (e.kind === 'favour' ? 'giver' : 'promisee'))?.who;
          const debtor = e.participants.find((p) => p.role === (e.kind === 'favour' ? 'receiver' : 'promiser'))?.who;
          if (creditor !== undefined && debtor !== undefined && creditor !== v && debtor !== v && isPerson(creditor) && isPerson(debtor) && eligible(creditor, T) && eligible(debtor, T)) {
            const due = Math.floor(e.time / W) + (e.kind === 'favour' ? cfg.dueDays.favour : cfg.dueDays.promise) * DAYW;
            st.debts.push({ event: id, creditor, debtor, due });
          }
        } else if (e.kind === 'repair') {
          const a = e.participants.find((p) => p.role === 'repairer')?.who;
          const b = e.participants.find((p) => p.role === 'other')?.who;
          if (a !== undefined && b !== undefined) {
            repairs.push({ a, b, id, time: e.time });
            // a repair between them came before the debt fell due: the debt is never called in
            st.debts = st.debts.filter((d) => !((d.creditor === a && d.debtor === b) || (d.creditor === b && d.debtor === a)));
          }
        }
        if (WRONG_KINDS.includes(e.kind)) {
          const f = foreign.factOf(id, e, w);
          if (f) facts.push(f);
        }
      }
      if (st.seen.length > cfg.seenMax) st.seen = st.seen.slice(st.seen.length - cfg.seenMax);
      st.debts.sort((a, b) => a.due - b.due || cmp(a.event, b.event));
      if (st.debts.length > cfg.debtsMax) st.debts = st.debts.slice(0, cfg.debtsMax);

      const goals = new Map<Id, GoalRec>(st.goals.map((g) => [g.id, g]));
      const sorted = (): GoalRec[] => [...goals.values()].sort((a, b) => cmp(a.id, b.id));
      const intents = new Map<Id, { group: Id; name: string; rung?: number; entry?: number; ward?: Id; wrongdoer?: Id; rival?: number; motive: number; warnKinds: string[] }>();
      const holders = new Set<Id>();
      for (const [gid, g] of Object.entries(gd?.groups ?? {})) {
        for (const s of g.seats) if (s.holder !== null) holders.add(s.holder);
        const a = g.active;
        if (a) intents.set(a.id, { group: gid, name: a.name, ...(a.rung !== undefined ? { rung: a.rung } : {}), ...(a.entry !== undefined ? { entry: a.entry } : {}), ...(a.ward !== undefined ? { ward: a.ward } : {}), ...(a.wrongdoer !== undefined ? { wrongdoer: a.wrongdoer } : {}), ...(a.rival !== undefined ? { rival: a.rival } : {}), motive: a.motive ?? 0, warnKinds: a.warnKinds ?? [] });
      }
      const ended = new Map<Id, { relent: Id }>();
      const moved = new Map<Id, Id>();
      for (const ch of fg.items) {
        if (ch.kind === 'end') ended.set(ch.intent, { relent: ch.cause });
        else if (ch.kind === 'climb' || ch.kind === 'drop') moved.set(ch.intent, ch.cause);
      }

      // the facts that fill `wrong` at their outcome, by function (S1 5.2a): what a goal ends on and what a grievance opens from
      interface Wrong { fact: EventFact; by: Id; to: Id }
      const wrongs: Wrong[] = [];
      for (const f of facts) {
        const kd = sim.w.kinds.get(f.kind);
        if (!kd) continue;
        for (const fl of applicableFills(kd.fills, f.outcome, f.parties.map((p) => ({ who: p.who, role: p.role })), f.cell, f.id)) {
          if (fl.fn === 'wrong' && fl.args.by !== undefined && fl.args.to !== undefined) wrongs.push({ fact: f, by: fl.args.by, to: fl.args.to });
        }
      }

      const info = new Map<Id, { owner: Id; kind: GoalKind }>(Object.entries(prev?.recent ?? {}));
      const record = (g: GoalRec, value: string, prevValue: string | null, source: string): void => {
        info.set(g.id, { owner: g.owner, kind: g.kind });
        changes.push({ key: `goal|${g.id}`, t: T + W, value, prev: prevValue, source });
      };
      const endPost = (goal: Id): void => {
        for (const p of st.posts) if (p.goal === goal && p.until === undefined) p.until = w + 1;
      };
      const startPost = (g: GoalRec): void => {
        if (!g.post) return;
        st.posts.push({ person: g.owner, cell: g.post.cell, periods: [...g.post.periods], from: w + 1, goal: g.id, ...(g.ward !== undefined ? { ward: g.ward } : {}) });
      };

      // ---- (2) end goals ----
      const endGoal = (g: GoalRec, reason: string, status: 'satisfied' | 'abandoned', cause: Id): void => {
        goals.delete(g.id);
        endPost(g.id);
        // a seed's frame is the seed's: S1 never changes it, it only stops producing acts for it
        if (g.kind !== 'role') ops.push({ op: 'frame-status', frame: g.id, status, cause });
        record(g, status, g.state, `end/${g.id}`);
        st.counters.ended++;
        c.log({ w, proc: procId, kind: 'decision', reason: 'goal-end', key: `${g.id}|${reason}`, refs: [g.id, g.owner] });
      };
      const gone = (n: Id | undefined): boolean => n !== undefined && isPerson(n) && !aliveAt(n, T);
      const killedBy = (n: Id): Id | undefined => facts.find((f) => (f.effects ?? []).some((e) => e.on === n && e.effect === 'kill'))?.id;
      for (const g of sorted()) {
        let reason: string | undefined;
        let status: 'satisfied' | 'abandoned' = 'abandoned';
        let cause: Id = g.source;
        if (g.kind === 'redress' || (g.kind === 'carry-out' && g.duty === 'strike')) {
          const hit = wrongs.find((x) => x.fact.outcome === 'done' && x.by === g.owner && x.to === g.target);
          if (hit) { reason = 'satisfied'; status = 'satisfied'; cause = hit.fact.id; }
        } else if (g.kind === 'collect') {
          const done = facts.find((f) => f.kind === 'call-in' && f.outcome === 'done' && f.parties.some((p) => p.role === 'creditor' && p.who === g.owner));
          const failed = facts.find((f) => f.kind === 'call-in' && f.outcome === 'failed' && f.parties.some((p) => p.role === 'creditor' && p.who === g.owner));
          if (done) { reason = 'satisfied'; status = 'satisfied'; cause = done.id; }
          else if (failed) { reason = 'refused'; cause = failed.id; }
        } else if (g.kind === 'carry-out' && g.duty === 'warn') {
          const hit = facts.find((f) => f.goal === g.id);
          if (hit) { reason = 'satisfied'; status = 'satisfied'; cause = hit.id; }
        }
        if (reason === undefined && (g.kind === 'redress' || g.kind === 'collect')) {
          const rp = repairs.find((r) => (r.a === g.owner && r.b === g.target) || (r.b === g.owner && r.a === g.target));
          if (rp) { reason = 'repaired'; status = 'satisfied'; cause = rp.id; }
        }
        if (reason === undefined) {
          const tg = g.target !== undefined && g.target !== v && gone(g.target);
          const og = !aliveAt(g.owner, T) || !eligible(g.owner, T, true);
          if (tg || og) {
            reason = tg ? 'target-gone' : 'owner-gone';
            cause = killedBy(tg ? g.target! : g.owner) ?? g.source;
          }
        }
        if (reason === undefined && g.kind === 'carry-out' && g.intent) {
          const cur = intents.get(g.intent.decision);
          if (cur === undefined) { reason = 'intent-end'; cause = ended.get(g.intent.decision)?.relent ?? g.intent.decision; }
          else if ((g.intent.entry ?? 1) !== (cur.entry ?? 1)) { reason = 'intent-end'; cause = moved.get(g.intent.decision) ?? g.intent.decision; }
        }
        if (reason === undefined && g.expires !== undefined && w >= g.expires) reason = 'expired';
        if (reason !== undefined) endGoal(g, reason, status, cause);
      }
      // the role goals the seeds ended
      for (const e of roleEntries) {
        if (e.op !== 'end') continue;
        const g = goals.get(e.frame);
        if (g && g.kind === 'role') endGoal(g, 'seed-end', 'abandoned', e.frame);
      }
      // entries of intentions that have left the digest are dropped
      for (const d of Object.keys(st.entries)) if (!intents.has(d)) delete st.entries[d];

      // ---- (3) block and unblock ----
      for (const g of sorted()) {
        let why: GoalRec['blocked'];
        if (g.kind !== 'role' && castBySeed(g.owner, T)) why = 'owner-cast';
        else if (g.target !== undefined && g.target !== v && g.acts.some(harmful) && sim.people.protectedAt(g.target, T)) why = 'target-protected';
        if (why !== undefined && g.state === 'active') {
          g.state = 'blocked';
          g.blocked = why;
          endPost(g.id);
          if (g.kind !== 'role') ops.push({ op: 'frame-status', frame: g.id, status: 'blocked', cause: g.source });
          record(g, 'blocked', 'active', `block/${g.id}`);
        } else if (why === undefined && g.state === 'blocked') {
          g.state = 'active';
          delete g.blocked;
          startPost(g);
          if (g.kind !== 'role') ops.push({ op: 'frame-status', frame: g.id, status: 'active', cause: g.source });
          record(g, 'active', 'blocked', `unblock/${g.id}`);
        } else if (why !== undefined) g.blocked = why;
      }

      // ---- (4) open goals, then apply the caps ----
      const countOf = (owner: Id): number => sorted().filter((g) => g.kind !== 'role' && g.owner === owner).length;
      const weakest = (list: GoalRec[]): GoalRec => [...list].sort((a, b) => a.motive - b.motive || a.opened - b.opened || cmp(b.id, a.id))[0]!;
      /** Apply the caps (S1 7.10) and open the goal if it stays: a goal beyond a cap replaces the weakest of that cap's goals if its own motive is higher. */
      const admit = (g: GoalRec, frame: FrameSpec | undefined, ownerCap = true): boolean => {
        if (g.kind !== 'role') {
          const mine = sorted().filter((x) => x.kind !== 'role' && x.owner === g.owner);
          if (ownerCap && mine.length >= cfg.perPerson) {
            const wk = weakest(mine);
            if (g.motive > wk.motive) {
              endGoal(wk, 'goal-cap', 'abandoned', g.source);
              c.log({ w, proc: procId, kind: 'admission', reason: 'goal-cap', key: `${wk.id}|owner`, refs: [wk.id, g.owner] });
              st.counters.capped++;
            } else {
              c.log({ w, proc: procId, kind: 'admission', reason: 'goal-cap', key: `${g.id}|owner`, refs: [g.id, g.owner] });
              st.counters.capped++;
              return false;
            }
          }
          const district = districtOfPerson(g.owner);
          const here = sorted().filter((x) => x.kind !== 'role' && districtOfPerson(x.owner) === district);
          if (here.length >= cfg.perDistrict) {
            const wk = weakest(here);
            if (g.motive > wk.motive) {
              endGoal(wk, 'goal-cap', 'abandoned', g.source);
              c.log({ w, proc: procId, kind: 'admission', reason: 'goal-cap', key: `${wk.id}|district`, refs: [wk.id, g.owner] });
              st.counters.capped++;
            } else {
              c.log({ w, proc: procId, kind: 'admission', reason: 'goal-cap', key: `${g.id}|district`, refs: [g.id, g.owner] });
              st.counters.capped++;
              return false;
            }
          }
        }
        goals.set(g.id, g);
        startPost(g);
        if (frame) ops.push({ op: 'frame-open', frame });
        record(g, 'open', null, `open/${g.id}`);
        st.counters.opened++;
        return true;
      };
      const frameOf = (g: GoalRec, effects: Array<{ on: Id | Selector; effect: string }>): FrameSpec => {
        const aim = g.target ?? g.ward;
        return {
          id: g.id, actor: g.owner, level: 'goal', parents: [], origin: g.source, weight: g.motive, status: 'active', cause: g.source, retain: true,
          payload: { goal: { effects: effects as never } },
          own: {
            wants: g.target !== undefined ? [{ slot: '*', scope: { nodes: [g.target] } }] : [],
            reactsTo: aim !== undefined ? [{ slot: '*', scope: { nodes: [aim] } }] : [],
            protects: g.ward !== undefined ? [{ slot: '*', scope: { nodes: [g.ward] }, where: [{ path: '@effect', op: 'in', arg: HARM }] }] : [],
            blockedBy: [], threatenedBy: [],
          },
          focus: { nodes: aim !== undefined ? [aim] : [], tier: 0 },
        };
      };

      // 4a. redress: a wrong done to a person, by a person, other than V
      const sizeSev = gcfg.pulses.sev;
      for (const x of wrongs) {
        const f = x.fact;
        if (x.by === v || x.to === v || !isPerson(x.by) || !isPerson(x.to)) continue;
        const effs = (f.effects ?? []).filter((e) => e.on === x.to && ['harm', 'kill', 'take'].includes(e.effect));
        const anyHarm = (f.effects ?? []).some((e) => e.on === x.to && HARM.includes(e.effect));
        let motive: number;
        if (effs.length > 0) {
          const effect = (effs.find((e) => e.effect === 'kill') ?? effs[0]!).effect;
          motive = q64(Math.min(1, sizeSev[Math.min(4, f.size) - 1]! * (gcfg.effectW[effect] ?? 0.5) * (holders.has(x.to) ? gcfg.leaderSev : 1)));
        } else if (!anyHarm) motive = cfg.brokenMotive;
        else continue;
        // a loss passes to kin: the first member of the household, by member index, who can own a goal
        let owner: Id | undefined;
        const killed = effs.some((e) => e.effect === 'kill');
        if (!killed && eligible(x.to, T)) owner = x.to;
        else for (const m of householdOf(x.to)) if (m !== x.to && m !== x.by && eligible(m, T)) { owner = m; break; }
        if (owner === undefined || owner === x.by) continue;
        const g: GoalRec = {
          id: mintedId(proc, f.id, frameName({ kind: 'redress', owner })), kind: 'redress', owner, target: x.by, source: f.id, acts: ['assault'], motive,
          opened: w, expires: w + cfg.expires, state: 'active',
        };
        if (goals.has(g.id)) continue;
        admit(g, frameOf(g, [{ on: x.by, effect: 'harm' }]));
      }

      // 4b. collect: debts fallen due
      const due = st.debts.filter((d) => d.due <= w);
      st.debts = st.debts.filter((d) => d.due > w);
      for (const d of due) {
        if (!eligible(d.creditor, T) || !isPerson(d.debtor) || !aliveAt(d.debtor, T)) continue;
        const g: GoalRec = {
          id: mintedId(proc, d.event, frameName({ kind: 'collect', owner: d.creditor })), kind: 'collect', owner: d.creditor, target: d.debtor, source: d.event, acts: ['call-in'], motive: cfg.debtMotive,
          opened: w, expires: w + cfg.expires, state: 'active',
        };
        if (goals.has(g.id)) continue;
        admit(g, frameOf(g, [{ on: d.debtor, effect: 'take' }]));
      }

      // 4c. carry-out: the duties of an intention, once per rung entry
      for (const [decision, cur] of [...intents.entries()].sort((a, b) => cmp(a[0], b[0]))) {
        const entry = cur.entry ?? 1;
        if (st.entries[decision] === entry) continue;
        st.entries[decision] = entry;
        const rung = cur.rung ?? 0;
        const gnode = cur.group;
        const gstate = gd!.groups[gnode]!;
        const district = gstate.district;
        const idef = gcfg.intents.find((i) => i.id === cur.name);
        for (const dd of idef?.duties ?? []) {
          const row = dd.byRung.find((r) => r.rung === rung);
          if (!row) continue;
          // the word stands: a second warning, or a second price, adds nothing
          if (dd.duty === 'warn' && cur.warnKinds.includes(row.act)) continue;
          for (let slot = 0; slot < row.slots; slot++) {
            const made = giveDuty(gnode, district, gstate.aff, decision, cur, dd, rung, entry, slot, row.act);
            if (!made) {
              st.counters.unfilled++;
              c.log({ w, proc: procId, kind: 'decision', reason: 'duty-unfilled', key: `${decision}|${dd.duty}|${slot}`, refs: [gnode] });
            }
          }
        }
      }

      /** Draw the member of a duty slot (S1 7.10) and open the goal. Returns whether a goal was opened. */
      function giveDuty(group: Id, district: Id, aff: string, decision: Id, cur: { name: string; ward?: Id; wrongdoer?: Id; rival?: number; motive: number }, dd: DutyDef, rung: number, entry: number, slot: number, act: string): boolean {
        const punish = cur.name === 'punish';
        const f = classIdx(aff);
        const dist = sim.w.district(district);
        const attempts = cfg.attempts;
        const pick = (u: string, fi: number, ok: (r: Id) => boolean): Id | undefined => {
          const weights = dist.cellIds.map((cid) => sim.people.residentCount(cid) * sim.casting.classPresence(cid, fi));
          if (!(weights.reduce((a, b) => a + b, 0) > 0)) return undefined;
          for (let a = 0; a < attempts; a++) {
            const block = dist.cellIds[invCum(weights, sim.ids.dutyB(decision, rung, entry, u, slot, a))]!;
            const n = sim.people.residentCount(block);
            if (n === 0) continue;
            const r = sim.people.residentAt(block, Math.floor(sim.ids.dutyR(decision, rung, entry, u, slot, a) * n));
            if (ok(r)) return r;
          }
          return undefined;
        };
        // who the duty is aimed at
        let target: Id | undefined;
        let ward: Id | undefined;
        let post: { cell: Id; periods: number[] } | undefined;
        const mine = sim.w.group(district, aff as 'A1');
        if (dd.duty === 'guard') {
          ward = cur.ward;
          if (ward === undefined || !isPerson(ward) || !aliveAt(ward, T)) return true;
          post = placeOfWork(ward);
          if (!post) return true;
        } else if (dd.duty === 'strike') {
          const rivalAff = cur.rival !== undefined ? (['A1', 'A2', 'A3'] as const)[cur.rival - 2] : undefined;
          const rivalNode = rivalAff !== undefined ? sim.w.group(district, rivalAff) : undefined;
          const targetOk = (r: Id): boolean => aliveAt(r, T) && !sim.people.protectedAt(r, T) && rivalNode !== undefined && groupOf(sim, r, T) === rivalNode && placeOfWork(r) !== undefined;
          if (cur.wrongdoer !== undefined && sim.people.view(cur.wrongdoer)?.ageClass === 'adult' && targetOk(cur.wrongdoer)) target = cur.wrongdoer;
          else if (cur.rival !== undefined) target = pick('strike-target', cur.rival, (r) => sim.people.view(r)?.ageClass === 'adult' && targetOk(r));
          if (target === undefined) return false;
          post = placeOfWork(target);
        } else if (punish) target = v;
        const owner = pick(dd.duty, f, (r) => {
          if (!eligible(r, T) || countOf(r) >= cfg.perPerson) return false;
          if (groupOf(sim, r, T) !== mine) return false;
          const rv = sim.people.view(r)!;
          if (dd.role !== 'any' && rv.role !== dd.role) return false;
          if (holders.has(r)) return false;
          for (const x of goals.values()) if (x.kind === 'carry-out' && x.intent?.decision === decision && x.owner === r) return false;
          if (target !== undefined && target !== v) {
            const t = sim.ties.tie(r, target);
            if (t !== undefined && t.tied && t.layer === 1) return false;
          }
          if (punish && sim.tiePolicy.hasEdge(r, v)) return false;
          return true;
        });
        if (owner === undefined) return false;
        const base: GoalRec = {
          id: '', kind: 'carry-out', duty: dd.duty, slot, owner, source: decision, acts: [act], motive: q64(cur.motive), opened: w, state: 'active',
          intent: { group, decision, name: cur.name, ...(rung > 0 ? { rung: rung as 1 | 2 | 3 } : {}), entry },
        };
        if (target !== undefined) base.target = target;
        if (ward !== undefined) base.ward = ward;
        base.id = mintedId(proc, decision, frameName({ kind: 'carry-out', owner, duty: dd.duty, rung, entry, slot }));
        if (dd.duty === 'collect') {
          const markets = dist.cellIds.filter((cid) => sim.w.cell(cid).marketCell);
          if (markets.length === 0) return false;
          const cell = markets[invCum(markets.map((cid) => sim.city.meanPop(cid, 1)), sim.ids.post(base.id))]!;
          post = { cell, periods: [0, 1] };
        } else if (dd.duty === 'warn') {
          const places = knownPlaces(mine, district);
          if (places.length === 0) return false;
          post = { cell: places[0]!, periods: [1, 2] };
        } else if (dd.duty === 'search') {
          const places = knownPlaces(mine, district);
          if (places.length === 0) return false;
          post = { cell: places[slot % places.length]!, periods: [2, 3] };
        }
        if (post) base.post = post;
        const effects: Array<{ on: Id | Selector; effect: string }> = dd.duty === 'collect' ? [{ on: { kind: 'xf:person', slot: '*', scope: { under: district } }, effect: 'take' }]
          : dd.duty === 'guard' ? [{ on: ward!, effect: 'protect' }] : dd.duty === 'strike' ? [{ on: target!, effect: 'harm' }] : [{ on: v, effect: 'meet' }];
        return admit(base, frameOf(base, effects), false);
      }

      // 4d. role goals a seed gave a cast person: the act comes from the simulation, never from the seed
      for (const e of roleEntries) {
        if (e.op !== 'open' || goals.has(e.frame)) continue;
        if (!eligible(e.owner, T, true)) continue;
        const first = e.effects[0];
        const on = typeof first?.on === 'string' ? first.on : undefined;
        let acts: string[] = [];
        let target: Id | undefined;
        let item: Id | undefined;
        let ward: Id | undefined;
        if (first !== undefined && on !== undefined && on !== v) {
          const act = ROLE_ACTS[first.effect];
          if (act !== undefined) {
            const isItem = k.persistence.restoreReferencedHeader(on)?.kind === 'xf:item';
            if (act === 'presence') { if (isPerson(on)) { acts = [act]; ward = on; } }
            else if (isItem) { acts = [act]; if (act === 'theft') item = on; }
            else if (isPerson(on)) { acts = [act]; target = on; }
          }
        }
        const g: GoalRec = { id: e.frame, kind: 'role', owner: e.owner, source: e.frame, acts, motive: q64(e.weight), opened: w, state: 'active' };
        if (target !== undefined) g.target = target;
        if (item !== undefined) g.item = item;
        if (ward !== undefined) g.ward = ward;
        admit(g, undefined);
      }

      // ---- (5) posts: kept a week after they end ----
      st.posts = st.posts.filter((p) => p.until === undefined || w - p.until < cfg.postKeep);
      void WEEK;

      // ---- (6) the digest ----
      st.goals = sorted();
      const views: GoalView[] = st.goals.map((g) => {
        const out: GoalView = structuredClone(g);
        if (g.intent?.name === 'punish') {
          const ag = gd?.against?.[g.intent.group];
          if (ag && ag.id === g.intent.decision) out.punish = { group: g.intent.group, intent: g.intent.decision, rung: (g.intent.rung ?? 1) as 1 | 2 | 3, cause: ag.cause };
        }
        return out;
      });
      const wards: Record<Id, number[]> = {};
      st.posts.forEach((p, i) => { if (p.ward !== undefined) (wards[p.ward] ??= []).push(i); });
      const byTarget: Record<Id, Id[]> = {};
      for (const g of st.goals) for (const n of new Set([g.target, g.ward].filter((x): x is Id => x !== undefined))) (byTarget[n] ??= []).push(g.id);
      const feedNow = pushTransitions(prev?.changes, w, changes, sim.data.feed.keep);
      const recent: GoalsDigest['recent'] = {};
      for (const win of feedNow.windows) for (const tr of win.items) {
        const id = tr.key.slice(5);
        const got = info.get(id);
        if (got) recent[id] = got;
      }
      const digest: GoalsDigest = { v: 1, through: w, goals: views, posts: structuredClone(st.posts), wards, byTarget, recent, changes: feedNow };
      void simulatedDistricts; void pushFeed;
      return { ops, state: st, digest };
    },
  };
}
