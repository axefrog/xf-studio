// `grievance` (S1 8.9) and `seedGoals` (S1 8.10, v0.6): the policies that ground an intention against the protagonist and give a seed's
// cast person a goal. They run when the watch frame hears an act of V's (once per canonical origin, beside `absorb`, ignoring raw kinds),
// a `belief` change whose subject is V (S0 V4-52) or a `frame` change (S0 V4-53). Everything they read is coarse-readable (S1 10.1).
//
// D-09 holds: S1 models what a group *believes* V did, from an act the record holds, and never what V feels or wants.

import { H, id as hid, s as hs } from '../id.ts';
import type { Belief } from '../beliefs.ts';
import { processCause } from '../evolution.ts';
import type { Change, Id } from '../types.ts';
import { q64 } from './arith.ts';
import { applicableFills } from './fills.ts';
import type { GrudgeEntry } from './record.ts';
import type { GroupDigest } from './proc-groups.ts';
import type { EventView, Policies } from './policies.ts';

const HARM = ['harm', 'kill', 'take', 'expose'];
const GRIEVANCE_PATHS = ['did.harm', 'did.kill', 'did.take', 'did.expose'];

/** The groups `group.decide` runs (S1 7.8): the Tyger Claws and The Mox in every simulated district that lists them. */
function runGroups(p: Policies): Id[] {
  const sim = p.sim;
  const out: Id[] = [];
  for (const d of sim.w.districts) for (const def of sim.data.groups.groups) if (sim.w.index.districts[d.id]?.simulated) out.push(sim.w.group(d.id, def.aff));
  return out.sort();
}

/** The kind's agent roles, as the registry has them, and for a kind S1 does not own, the kernel's (a seed's `response`). */
function agentRoles(p: Policies, kind: string): string[] {
  return p.sim.w.kinds.agentRolesOf(kind);
}

/** Whether an event is an act of V's (S1 8.9): V in one of its kind's agent roles. Nothing else counts. */
export function isActOfV(p: Policies, ev: EventView): boolean {
  const v = p.sim.w.v;
  const roles = agentRoles(p, ev.kind);
  return ev.participants.some((x) => x.who === v && roles.includes(x.role));
}

/** The fills of an event of a kind S1 owns, or of one whose kind the seeding layer registered with the kernel. */
function fillsOf(p: Policies, ev: EventView): ReturnType<typeof applicableFills> {
  const decls = p.sim.w.kinds.get(ev.kind)?.fills ?? p.sim.k.eventKinds.eventKind(ev.kind)?.fills ?? [];
  return applicableFills(decls, (ev.outcome as 'done' | 'failed' | 'prevented' | undefined) ?? 'done', ev.participants, ev.place, ev.id);
}

const record = (p: Policies, e: Omit<GrudgeEntry, 'seq'>): void => {
  const rec = p.sim.record;
  rec.grudges.push({ ...e, seq: rec.grudgeSeq++ });
  while (rec.grudges.length > 256) rec.grudges.shift();
};

/** The severity of an act that fell on a group's own (S1 7.8's formula, S1 8.9): size, effect, a seat holder harmed, and the confidence. */
function severity(p: Policies, size: number, effect: string, seatHolder: boolean, confidence: number): number {
  const g = p.sim.data.groups;
  return q64(Math.min(1, g.pulses.sev[Math.min(4, Math.max(1, size)) - 1]! * (g.effectW[effect] ?? 0.5) * (seatHolder ? g.leaderSev : 1)) * confidence);
}

/** The belief `against` of a group about V, set from an act (S1 8.9) and recorded for `group.decide` to read. Returns false when the group held it already. */
function setGrievance(p: Policies, group: Id, act: { time: number; origin: Id; public: boolean }, sev: number, confidence: number, evidence: Id[], source: Belief['source'], via?: GrudgeEntry['via']): boolean {
  const k = p.sim.k;
  const v = p.sim.w.v;
  const held = k.beliefs.activeOf(group).filter((b) => b.memorable && b.subject === v && b.path === 'against');
  if (held.some((b) => b.evidence.includes(act.origin))) return false;
  const rec = p.sim.record;
  // at most 8 about V: a ninth replaces the oldest settled or cleared one, else the one of lowest severity
  if (held.length >= p.sim.data.groups.punish.grievanceMax) {
    const done = new Set(rec.grudges.filter((e) => e.group === group && (e.op === 'settled' || e.op === 'cleared')).map((e) => e.belief));
    const sevOf = (b: Belief): number => rec.grudges.find((e) => e.op === 'set' && e.belief === b.id)?.sev ?? 0;
    const pool = held.some((b) => done.has(b.id)) ? held.filter((b) => done.has(b.id)).sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || (a.id < b.id ? -1 : 1)) : [...held].sort((a, b) => sevOf(a) - sevOf(b) || (a.id < b.id ? -1 : 1));
    k.beliefs.drop(group, pool[0]!.id);
  }
  const id = H(hs('belief'), hid(group), hid(v), hs('against'), hs(String(act.time)));
  k.beliefs.set({
    id, believer: group, subject: v, path: 'against', at: act.time, value: act.origin, confidence, evidence, source, formed: k.now, refreshed: k.now, memorable: true, salience: 3,
  });
  record(p, { group, belief: id, act: act.origin, sev, op: 'set', at: act.time, ...(act.public ? { pub: true } : {}), ...(via ? { via } : {}) });
  p.sim.logNow({ w: p.sim.windowNow(), proc: 'grievance', kind: 'decision', reason: 'grudge', key: `${group}|${id}`, refs: [group, act.origin] });
  return true;
}

/** `grievance`, from an act of V's heard (S1 8.9 rules 1 and 4). */
export function grievanceFromAct(p: Policies, ev: EventView): void {
  const sim = p.sim;
  const k = sim.k;
  const v = sim.w.v;
  if (!isActOfV(p, ev)) return;
  const origin = p.origin(ev);
  const size = p.sizeOf(ev);
  const cell = ev.place !== undefined ? sim.w.index.cells[ev.place] : undefined;
  const isPublic = cell !== undefined && cell.public === 'public' && ev.witnesses.length >= sim.data.norms.publicMinWitnesses;
  const groups = runGroups(p);
  const dg = k.evolution.digestPeek<GroupDigest>('group.decide');
  // rule 1: an act that puts harm, kill, take or expose on a member of a group, a seat holder, the group itself or an item it or a member holds
  const memberOf = (n: Id, t: number): Id | undefined => {
    if (groups.includes(n)) return n;
    const g = sim.people.view(n) || k.persistence.restoreReferencedHeader(n)?.kind === 'xf:person' ? groupOfAt(p, n, t) : undefined;
    if (g !== undefined) return g;
    // an item: its holder's group
    for (const e of k.store.edgesFrom(n)) {
      if (e.type !== 'xf:held-by' || e.valid.from > t || (e.valid.to !== undefined && t >= e.valid.to)) continue;
      return groups.includes(e.to) ? e.to : groupOfAt(p, e.to, t);
    }
    return undefined;
  };
  const best = new Map<Id, { effect: string; seat: boolean }>();
  for (const e of ev.effects) {
    if (e.on === v || !HARM.includes(e.effect)) continue;
    const g = memberOf(e.on, ev.time);
    if (g === undefined || !groups.includes(g)) continue;
    const seat = (dg?.groups[g]?.seats ?? []).some((s) => s.holder === e.on);
    const have = best.get(g);
    const w = (effect: string, s: boolean): number => (sim.data.groups.effectW[effect] ?? 0) * (s ? sim.data.groups.leaderSev : 1);
    if (!have || w(e.effect, seat) > w(have.effect, have.seat)) best.set(g, { effect: e.effect, seat });
  }
  for (const [g, x] of [...best.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const witnessMember = ev.witnesses.some((wi) => groupOfAt(p, wi, ev.time) === g);
    const confidence = witnessMember ? 1 : 0.9;
    setGrievance(p, g, { time: ev.time, origin, public: isPublic }, severity(p, size, x.effect, x.seat, confidence), confidence, [origin], { by: 'observed', event: origin });
  }
  // rule 4: an act of V's that pays what a warning asked, or complies with a warner, settles the grudge its intention rests on
  for (const g of groups) {
    const a = dg?.groups[g]?.active;
    if (!a || a.name !== 'punish' || a.grounds === undefined || (a.warnings ?? []).length === 0) continue;
    if (!ev.causes.some((c) => (a.warnings ?? []).includes(c))) continue;
    const warners = new Set<Id>();
    for (const wid of a.warnings ?? []) {
      const w = p.viewEvent(wid)?.participants.find((x) => x.role === 'warner');
      if (w) warners.add(w.who);
    }
    const holders = new Set((dg?.groups[g]?.seats ?? []).flatMap((s) => (s.holder === null ? [] : [s.holder])));
    for (const fl of fillsOf(p, ev)) {
      if (fl.fn !== 'repay' && fl.fn !== 'comply') continue;
      const payer = fl.fn === 'repay' ? fl.args.debtor : fl.args.who;
      const to = fl.fn === 'repay' ? fl.args.creditor : fl.args.to;
      if (payer !== v || to === undefined) continue;
      if (to === g || holders.has(to) || warners.has(to)) {
        record(p, { group: g, belief: a.grounds, act: origin, sev: 0, op: 'settled', at: k.now });
        sim.logNow({ w: sim.windowNow(), proc: 'grievance', kind: 'decision', reason: 'grudge-settled', key: `${g}|${a.grounds}`, refs: [g, origin] });
        break;
      }
    }
  }
}

/** The group a person belongs to at `t` (S1 4.8). */
function groupOfAt(p: Policies, n: Id, t: number): Id | undefined {
  const sim = p.sim;
  const v = sim.people.view(n);
  if (v) {
    if (v.affc < 2 || v.affc > 4) return undefined;
    return sim.w.group(sim.w.cell(v.cell).district, (['A1', 'A2', 'A3'] as const)[v.affc - 2]!);
  }
  const k = sim.k;
  k.persistence.recoverIfSaved(n);
  for (const e of k.store.edgesFrom(n)) if (e.type === 'core:member-of' && e.valid.from <= t && (e.valid.to === undefined || t < e.valid.to)) return e.to;
  return undefined;
}

/** Whether a belief of a group member grounds a grievance (S1 8.9 rule 2): a `did.<effect>` belief about V that names a member of the group, the group or the believer, rests on an act of V's, and was made outside S1's own telling. */
function groundsToldGrievance(p: Policies, b: Belief): { group: Id; act: Id; effect: string } | undefined {
  const sim = p.sim;
  const k = sim.k;
  const v = sim.w.v;
  if (b.subject !== v || !GRIEVANCE_PATHS.includes(b.path) || typeof b.value !== 'string') return undefined;
  const group = groupOfAt(p, b.believer, k.now);
  if (group === undefined || !runGroups(p).includes(group)) return undefined;
  const target = b.value;
  if (!(target === group || target === b.believer || groupOfAt(p, target, k.now) === group)) return undefined;
  // its evidence includes an act of V's
  const acts = b.evidence.map((id) => p.viewEvent(id)).filter((e): e is EventView => e !== undefined && isActOfV(p, e));
  if (acts.length === 0) return undefined;
  // its source event was created by the port, the mirror or a seed: never by S1's own telling
  const src = b.source.by === 'inferred' ? undefined : p.viewEvent(b.source.event);
  const creator = src?.creator;
  if (creator === undefined) return undefined;
  const header = k.persistence.restoreReferencedHeader(creator);
  const outside = creator === sim.w.port || creator === sim.mirrorProc || header?.kind === 'core:seed' || k.retention.seeds.has(creator);
  if (!outside) return undefined;
  return { group, act: p.origin(acts[0]!), effect: b.path.slice(4) };
}

/** `grievance`, from a belief change (S1 8.9 rules 2 and 3): a member told, by a source outside S1's telling, what V did; and the grievance dropped when that belief goes. */
export function grievanceFromBelief(p: Policies, ch: Extract<Change, { c: 'belief' }>): void {
  const sim = p.sim;
  const k = sim.k;
  const v = sim.w.v;
  if (ch.subject !== v) return;
  const mine = k.beliefs.activeOf(ch.believer).filter((x) => x.memorable);
  if (ch.op !== 'dropped') {
    const b = mine.find((x) => x.id === ch.belief);
    if (b && b.memorable) {
      const g = groundsToldGrievance(p, b);
      if (g) {
        const act = p.viewEvent(g.act);
        const size = act ? p.sizeOf(act) : 1;
        const confidence = Math.min(b.confidence, sim.data.minds.toldCap) * sim.data.minds.toldFactor;
        const dg = k.evolution.digestPeek<GroupDigest>('group.decide');
        const seat = (dg?.groups[g.group]?.seats ?? []).some((s) => s.holder === b.value);
        const cell = act?.place !== undefined ? sim.w.index.cells[act.place] : undefined;
        const isPublic = act !== undefined && cell !== undefined && cell.public === 'public' && act.witnesses.length >= sim.data.norms.publicMinWitnesses;
        const made = setGrievance(p, g.group, { time: act?.time ?? b.at ?? k.now, origin: g.act, public: isPublic }, severity(p, size, g.effect, seat, confidence), confidence, [...b.evidence], { by: 'told', teller: ch.believer, event: b.source.by === 'inferred' ? b.id : b.source.event }, { teller: ch.believer, belief: b.id });
        void made;
      }
    }
  }
  // rule 3: the member's belief behind a told grievance was revised or dropped, and they hold no grounded belief of the kind about the same act
  for (const e of [...sim.record.grudges]) {
    if (e.op !== 'set' || e.via?.teller !== ch.believer) continue;
    const gb = k.beliefs.activeOf(e.group).find((x) => x.memorable && x.id === e.belief);
    if (!gb) continue;
    const settledOrCleared = sim.record.grudges.some((x) => x.belief === e.belief && (x.op === 'cleared' || x.op === 'settled'));
    if (settledOrCleared) continue;
    const grounded = mine.some((x) => x.memorable && groundsToldGrievance(p, x)?.act === e.act);
    if (grounded) continue;
    k.beliefs.drop(e.group, e.belief);
    record(p, { group: e.group, belief: e.belief, act: e.act, sev: 0, op: 'cleared', at: k.now });
    sim.logNow({ w: sim.windowNow(), proc: 'grievance', kind: 'decision', reason: 'belief-drop', key: `${e.group}|${e.belief}`, refs: [e.group, ch.believer] });
  }
}

/** `seedGoals` (S1 8.10): a goal frame of a person whose parent is a seed's role frame becomes a role goal; its end ends it. It reads the frame through the kernel at dispatch time. */
export function seedGoals(p: Policies, ch: Extract<Change, { c: 'frame' }>): void {
  const sim = p.sim;
  const k = sim.k;
  if (ch.level !== 'goal') return;
  const f = k.frames.frame(ch.frame);
  if (!f) return;
  const seedParent = f.parents.map((x) => k.frames.frame(x.frame)).find((pf) => pf !== undefined && k.persistence.restoreReferencedHeader(pf.actor)?.kind === 'core:seed');
  if (!seedParent) return;
  const isPerson = sim.people.view(f.actor) !== undefined || k.persistence.restoreReferencedHeader(f.actor)?.kind === 'xf:person';
  if (!isPerson) return;
  const rec = sim.record;
  const push = (op: 'open' | 'end'): void => {
    rec.roleGoals.push({ seq: rec.roleGoalSeq++, frame: f.id, owner: f.actor, seed: seedParent.actor, effects: (f.payload.goal?.effects ?? []).map((e) => ({ on: e.on, effect: e.effect })), weight: f.weight, op, at: k.now });
    while (rec.roleGoals.length > 256) rec.roleGoals.shift();
  };
  if (ch.old === 'none') push('open');
  else if (ch.new === 'satisfied' || ch.new === 'abandoned') push('end');
  void processCause;
}
