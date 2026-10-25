// S1 v0.6 D-30, continued (S1 7.8.1, 8.9, 7.9): grounds from a telling, the endings, an encounter, never V's mind, a reload in the middle of a hunt (SF1-D-2, D-7 to D-10).

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { H, s as hs } from '../../src/id.ts';
import type { Belief } from '../../src/beliefs.ts';
import type { Id } from '../../src/types.ts';
import type { S1Data } from '../../src/sim/data.ts';
import type { GroupState } from '../../src/sim/proc-groups.ts';
import { bigSim, W } from './goals-helpers.ts';
import { actsOf, goalsDigest, groupDigest, minted, startHunt, stepOne } from './hunt-helpers.ts';

setDefaultTimeout(240_000);

const against = (b: Belief[]): Belief[] => b.filter((x) => x.path === 'against');
const quick = (d: S1Data): void => {
  d.goals.rate.warning = 500; d.goals.rate.price = 500; d.goals.rate.search = 500; d.groups.punish.rungDwell = 6; d.groups.punish.climbP = 100;
};
const RESPONSE = { name: 'response', roles: ['protagonist', 'asker'], fills: [{ fn: 'comply', args: { who: 'protagonist', to: 'asker' } }] };

describe('SF1-D-2: grounds from a telling', () => {
  const adultsOf = (sim: ReturnType<typeof bigSim>, affc: number): Id[] => {
    const out: Id[] = [];
    for (const cell of sim.w.districts[0]!.cellIds) for (const r of sim.people.residentsOfBlock(cell)) {
      const v = sim.people.view(r)!;
      if (v.affc === affc && v.ageClass === 'adult') out.push(r);
    }
    return out;
  };
  const setup = (name: string) => {
    const sim = bigSim(name, undefined, ['city.events', 'city.mirror', 'group.decide', 'people.goals']);
    const GA = sim.w.group(sim.w.districts[0]!.id, 'A1');
    const members = adultsOf(sim, 2);
    const seed = sim.k.root('authoring-seed', 'core:seed');
    sim.k.eventKinds.register(RESPONSE);
    const cell = sim.w.districts[0]!.cellIds[0]!;
    sim.startAt(5);
    const mint = (n: string, kind: string, participants: Array<{ who: Id; role: string }>, creator: Id = seed): Id =>
      sim.k.events.mintEvent({ creator, cause: creator, name: n, time: 5 * W + 50, kind, place: cell, participants, effects: [], witnesses: [], causes: [] });
    const belief = (believer: Id, value: Id, evidence: Id[], source: Belief['source']): void => {
      sim.k.beliefs.set({ believer, subject: sim.w.v, path: 'did.take', value, confidence: 0.8, evidence, source, formed: sim.k.now, refreshed: sim.k.now, memorable: true, at: 5 * W + 50 });
    };
    return { sim, GA, members, seed, mint, belief };
  };

  test('a member\'s seed-authored memorable belief did.take about V, whose evidence is a response of V\'s, sets a told grievance (teller the member, evidence unchanged, confidence min(c, 0.9) x 0.8); one whose evidence holds no act of V\'s, and one formed by S1\'s own telling, set nothing', () => {
    const { sim, GA, members, mint, belief } = setup('SF1-D-2');
    const [m, t] = [members[0]!, members[1]!];
    const response = mint('resp', 'response', [{ who: sim.w.v, role: 'protagonist' }, { who: m, role: 'asker' }]);
    belief(m, t, [response], { by: 'told', teller: t, event: response });
    sim.k.settle();
    const g = against(sim.k.beliefs.activeOf(GA));
    expect(g).toHaveLength(1);
    expect(g[0]!).toMatchObject({ believer: GA, subject: sim.w.v, path: 'against', source: { by: 'told', teller: m }, evidence: [response], memorable: true, salience: 3 });
    expect(g[0]!.confidence).toBeCloseTo(Math.min(0.8, 0.9) * 0.8, 12);
    expect(sim.record.grudges).toHaveLength(1);
    expect(sim.record.grudges[0]).toMatchObject({ group: GA, belief: g[0]!.id, op: 'set', via: { teller: m } });
    // no act of V's in the evidence
    const s2 = setup('SF1-D-2b');
    const noAct = s2.mint('fav', 'favour', [{ who: s2.members[1]!, role: 'giver' }, { who: s2.members[2]!, role: 'receiver' }]);
    s2.belief(s2.members[0]!, s2.members[1]!, [noAct], { by: 'told', teller: s2.members[1]!, event: noAct });
    s2.sim.k.settle();
    expect(against(s2.sim.k.beliefs.activeOf(s2.GA))).toHaveLength(0);
    // formed by S1's own telling: the source event was minted by S1's record node
    const s3 = setup('SF1-D-2c');
    const resp3 = s3.mint('resp', 'response', [{ who: s3.sim.w.v, role: 'protagonist' }, { who: s3.members[0]!, role: 'asker' }]);
    const tell = s3.mint('tell', 'tell', [{ who: s3.members[1]!, role: 'teller' }, { who: s3.members[0]!, role: 'listener' }], s3.sim.w.s1);
    s3.belief(s3.members[0]!, s3.members[1]!, [resp3], { by: 'told', teller: s3.members[1]!, event: tell });
    s3.sim.k.settle();
    expect(against(s3.sim.k.beliefs.activeOf(s3.GA))).toHaveLength(0);
  });
});

describe('SF1-D-8: endings', () => {
  test('(a) a response of V\'s that fills comply(who: v, to: warner) with the price in its causes: a settled grudge, the pulse released, the intention paid, a relent.punish; no new punish from that belief', () => {
    const h = startHunt({ name: 'SF1-D-8a', delay: 4, tweak: quick });
    const { sim, GA } = h;
    sim.k.eventKinds.register(RESPONSE);
    const seed = sim.k.root('layer2', 'core:seed');
    let price: { id: Id } | undefined;
    for (let i = 0; i < 700 && price === undefined; i++) {
      h.step(1);
      price = actsOf(sim).find((a) => a.kind === 'price');
    }
    expect(price).toBeDefined();
    // the price is in the group's digest a window later, as layer 2 would see it
    h.step(2);
    // the warner of the price is the one V answers
    const warner = sim.policies.viewEvent(price!.id)!.participants.find((p) => p.role === 'warner')!.who;
    const grounds = groupDigest(sim).groups[GA]!.active!.grounds!;
    sim.k.events.mintEvent({ creator: seed, cause: seed, name: 'v-pays', time: sim.k.now, kind: 'response', place: h.cell, participants: [{ who: sim.w.v, role: 'protagonist' }, { who: warner, role: 'asker' }], effects: [], witnesses: [], causes: [price!.id] });
    sim.k.settle();
    expect(sim.record.grudges.filter((e) => e.op === 'settled')).toHaveLength(1);
    expect(sim.record.grudges.find((e) => e.op === 'settled')).toMatchObject({ group: GA, belief: grounds });
    h.step(3);
    expect(groupDigest(sim).groups[GA]!.active).toBeNull();
    expect(sim.record.log.some((e) => e.reason === 'intent-end' && e.key?.endsWith('|punish|paid'))).toBe(true);
    expect(minted(sim, 'relent.punish')).toHaveLength(1);
    // the belief stays as history, and grounds nothing more: no second punish from it, whatever the cooling
    h.step(700);
    expect(minted(sim, 'decide.punish')).toHaveLength(1);
    expect(against(sim.k.beliefs.activeOf(GA))).toHaveLength(1);
  });

  test('(b) the teller of a told grievance has its authored belief revised away by a seed: the grievance is dropped (cleared) and the intention ends cleared; its duties end intent-end and the 288-window cooling starts', () => {
    const sim = bigSim('SF1-D-8b', (d) => { quick(d); d.groups.thetaStop = 0; d.goals.attempts = 600; }, ['city.events', 'city.mirror', 'group.decide', 'people.goals']);
    const GA = sim.w.group(sim.w.districts[0]!.id, 'A1');
    const members: Id[] = [];
    for (const cell of sim.w.districts[0]!.cellIds) for (const r of sim.people.residentsOfBlock(cell)) {
      const v = sim.people.view(r)!;
      if (v.affc === 2 && v.ageClass === 'adult') members.push(r);
    }
    const [m, t] = [members[0]!, members[1]!];
    const seed = sim.k.root('authoring-seed', 'core:seed');
    sim.k.eventKinds.register({ name: 'response', roles: ['protagonist', 'asker'], fills: [] });
    const cell = sim.w.districts[0]!.cellIds[0]!;
    sim.startAt(5);
    const response = sim.k.events.mintEvent({ creator: seed, cause: seed, name: 'resp', time: 5 * W + 50, kind: 'response', place: cell, participants: [{ who: sim.w.v, role: 'protagonist' }, { who: m, role: 'asker' }], effects: [], witnesses: [], causes: [] });
    const set = (value: Id, confidence: number): void => {
      sim.k.beliefs.set({ believer: m, subject: sim.w.v, path: 'did.take', value, confidence, evidence: [response], source: { by: 'told', teller: t, event: response }, formed: sim.k.now, refreshed: sim.k.now, memorable: true, at: 5 * W + 50 });
    };
    set(t, 0.8);
    sim.k.settle();
    const grounds = against(sim.k.beliefs.activeOf(GA))[0]!;
    expect(grounds.source).toMatchObject({ by: 'told', teller: m });
    // a punish intention rests on it
    const decision = H(hs('mint'), hs('decide-punish-8b'));
    sim.setState('group.decide', (st) => {
      const g = (st as GroupState).groups[GA]!;
      g.intent = { state: 'active', id: decision, name: 'punish', drive: 'retribution', since: 5, expires: 100000, motive: 0.6, rung: 1, rungSince: 5, entry: 1, grounds: grounds.id, cause: response, warnings: [], warnKinds: [] } as never;
      g.pulse['retribution-v'] = { at: 5 * W, sev: 1, latched: true, src: grounds.id, act: response };
    });
    sim.advance(6);
    expect(goalsDigest(sim).goals.some((g) => g.duty === 'warn')).toBe(true);
    // a seed revises the member's belief away: another value, more confidence
    const civilian = sim.w.districts[0]!.cellIds.flatMap((c) => sim.people.residentsOfBlock(c)).find((r) => sim.people.view(r)!.affc === 0)!;
    set(civilian, 1);
    sim.k.settle();
    expect(sim.record.grudges.some((e) => e.op === 'cleared' && e.belief === grounds.id)).toBe(true);
    expect(against(sim.k.beliefs.activeOf(GA))).toHaveLength(0);
    sim.advance(4);
    expect(groupDigest(sim).groups[GA]!.active).toBeNull();
    expect(sim.record.log.some((e) => e.reason === 'intent-end' && e.key?.endsWith('|punish|cleared'))).toBe(true);
    expect(goalsDigest(sim).goals.some((g) => g.duty === 'warn')).toBe(false);
    expect(sim.record.log.filter((e) => e.reason === 'goal-end' && e.key?.endsWith('|intent-end')).length).toBeGreaterThanOrEqual(1);
    const st = sim.stateOf<GroupState>('group.decide')!.groups[GA]!;
    expect(st.intent).toMatchObject({ state: 'cooling' });
    expect(st.lastPunish).toBeDefined();
    expect((st.intent as { until: number }).until - st.lastPunish!).toBe(1 + 288);
  });
});

describe('SF1-D-7: an encounter', () => {
  test('rung 3, the price seen, V at or next to a search post: a confront (the posted searchers, V confronted, no effects) at most once in 144 windows, published once, with the bridge-spawn row; tier 0 to 2 states are identical with V elsewhere', () => {
    const run = (near: boolean) => {
      const h = startHunt({ name: 'SF1-D-7', delay: 3, tweak: quick });
      const c = near ? h.cell : h.sim.w.districts[0]!.cellIds[2]!;
      h.sim.k.reading(h.sim.w.vState, 'cell', c, h.sim.k.now);
      h.step(900);
      return h;
    };
    const near = run(true);
    const far = run(false);
    const confronts = minted(near.sim, 'confront');
    expect(confronts.length).toBeGreaterThanOrEqual(1);
    expect(minted(far.sim, 'confront')).toHaveLength(0);
    const times: number[] = [];
    for (const id of confronts) {
      const ev = near.sim.policies.viewEvent(id)!;
      expect(ev.participants).toContainEqual({ who: near.sim.w.v, role: 'confronted' });
      const confronters = ev.participants.filter((p) => p.role === 'confronter');
      expect(confronters.length).toBeGreaterThanOrEqual(1);
      expect(confronters.length).toBeLessThanOrEqual(3);
      expect(ev.effects).toEqual([]);
      // it cites the decision, its last price and the act its grounds rest on
      expect(ev.causes.some((c) => near.sim.policies.viewEvent(c)?.kind === 'decide.punish')).toBe(true);
      expect(ev.causes.some((c) => near.sim.policies.viewEvent(c)?.kind === 'price')).toBe(true);
      times.push(Math.floor(ev.time / W));
    }
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(144);
    // published once: each is one event, minted once
    expect(new Set(confronts).size).toBe(confronts.length);
    expect(near.sim.data.realisation.find((r) => r.kind === 'confront')).toMatchObject({ route: 'bridge-spawn', safeRadius: 40, perHour: 1 });
    // no coarse process reads a confront: their states are the same with V away
    for (const p of ['city.events', 'group.decide', 'people.goals']) {
      const strip = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (k, v) => (k === 'log' ? undefined : v)));
      expect(strip(near.sim.stateOf(p)), p).toEqual(strip(far.sim.stateOf(p)));
    }
  });
});

describe('SF1-D-9: never V\'s mind', () => {
  test('no S1 state, digest or read holds a value about V\'s feelings, desires or drives; no goal frame of S1\'s has V for its actor or a harmful effect on V', () => {
    const h = startHunt({ name: 'SF1-D-9', delay: 3, tweak: quick });
    h.step(300);
    const { sim } = h;
    const text = JSON.stringify([sim.stateOf('people.goals'), sim.digestOf('people.goals'), sim.stateOf('group.decide'), sim.digestOf('group.decide')]);
    expect(text).not.toMatch(/feel|emotion|mood|desire|fear of|wishes/i);
    for (const f of sim.k.frames.all().filter((x) => x.retain === true)) {
      expect(f.actor).not.toBe(sim.w.v);
      for (const e of f.payload.goal?.effects ?? []) if (e.on === sim.w.v) expect(e.effect).toBe('meet');
    }
    expect(sim.k.frames.framesOf(sim.w.v).every((f) => f.retain !== true)).toBe(true);
  });
});

describe('SF1-D-10: reload in the middle of a hunt', () => {
  test('a hunt saved at rung 2, loaded under another epoch, play clock and wall clock: the same climb, duties, acts and end as without the reload', () => {
    const slow = (d: S1Data): void => { quick(d); d.groups.punish.rungDwell = 12; };
    const opts = { name: 'SF1-D-10', delay: 4, tweak: slow } as const;
    const ref = startHunt(opts);
    for (let i = 0; i < 700 && (groupDigest(ref.sim)?.groups[ref.GA]?.active?.rung ?? 0) < 2; i++) ref.step(1);
    expect(groupDigest(ref.sim).groups[ref.GA]!.active!.rung).toBe(2);
    ref.sim.k.persistence.save('D10');
    const seen = new Map(ref.seen);
    const fresh = startHunt(opts);
    // a fresh process of the same lineage, loaded at the save
    const chainOf = (s: typeof ref.sim): Map<string, unknown> => (s.k.persistence as unknown as { chain: Map<string, unknown> }).chain;
    for (const [key, r] of chainOf(ref.sim)) chainOf(fresh.sim).set(key, structuredClone(r));
    for (let i = 0; i < 9; i++) fresh.sim.k.newEpoch();
    fresh.sim.k.persistence.load('D10');
    for (let i = 0; i < 450; i++) {
      stepOne(ref.sim, ref.delay, ref.seen);
      stepOne(fresh.sim, ref.delay, seen);
    }
    const obs = (s: typeof ref.sim): unknown => JSON.parse(JSON.stringify([s.stateOf('people.goals'), s.stateOf('group.decide'), s.stateOf('city.events'), actsOf(s), s.k.frames.all().filter((f) => f.retain === true && (f.status === 'active' || f.status === 'blocked')).map((f) => [f.id, f.status])]));
    expect(obs(fresh.sim)).toEqual(obs(ref.sim));
    expect(minted(fresh.sim, 'confront')).toEqual(minted(ref.sim, 'confront'));
  });
});
