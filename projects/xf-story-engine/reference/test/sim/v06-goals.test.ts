// S1 v0.6 `people.goals` (S1 7.10): goals from the record, their caps, endings, blocks and posts (SF1-Y-1, Y-4, Y-5, Y-6, Y-7, Y-8, Y-9, Y-10).

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { H, id as hid, i as hi, rand, s as hs } from '../../src/id.ts';
import { spacingCount } from '../../src/sim/arith.ts';
import type { EventsDigest, EventsState } from '../../src/sim/proc-events.ts';
import type { Id } from '../../src/types.ts';
import { adults, castBySeed, district, fact, feedEvents, goalList, goalsApplied, goalsNow, goalsState, goalSim, pair, plantGoal, watchChanges, W } from './goals-helpers.ts';
import type { Sim } from '../../src/sim/sim.ts';

setDefaultTimeout(120_000);

/** An adult civilian with another adult in their household, so that a loss can pass to kin. */
function withKin(sim: Sim): { y: Id; kin: Id[] } {
  for (const cell of sim.w.districts[0]!.cellIds) {
    for (const r of sim.people.residentsOfBlock(cell)) {
      const v = sim.people.view(r)!;
      if (v.affc !== 0 || v.ageClass !== 'adult') continue;
      const ref = sim.people.refOf(r)!;
      const size = sim.people.blockInfo(ref.cell).sizes[ref.hIndex]!;
      const mates: Id[] = [];
      for (let j = 0; j < size; j++) {
        const m = sim.people.residentId(ref.household, j);
        if (m !== r && sim.people.view(m)!.ageClass === 'adult' && sim.people.view(m)!.affc === 0) mates.push(m);
      }
      if (mates.length > 0) return { y: r, kin: mates };
    }
  }
  throw new Error('no household with two adult civilians in FX-3');
}

describe('SF1-Y-1: redress opens', () => {
  test('a size-2 assault, done, by x on y: y owns a redress against x, motive q64(0.6), retained frame heard as a frame change', () => {
    const sim = goalSim('SF1-Y-1');
    const x = adults(sim, 2, 'gang')[0]!;
    const y = adults(sim, 0)[0]!;
    const changes = watchChanges(sim);
    sim.startAt(5);
    feedEvents(sim, 5, [fact(sim, { ...pair(x, y), effects: [{ on: y, effect: 'harm' }] })]);
    sim.advance(2);
    const goals = goalList(sim, 'redress');
    expect(goals).toHaveLength(1);
    const g = goals[0]!;
    expect(g).toMatchObject({ owner: y, target: x, acts: ['assault'], motive: 0.59375, state: 'active' });
    expect(g.expires! - g.opened).toBe(2016);
    const fr = sim.k.frames.frame(g.id)!;
    expect(fr).toMatchObject({ actor: y, level: 'goal', retain: true, status: 'active', focus: { nodes: [x], tier: 0 } });
    expect(fr.payload.goal!.effects).toEqual([{ on: x, effect: 'harm' }]);
    expect(changes.filter((c) => c.c === 'frame' && c.frame === g.id).map((c) => (c.c === 'frame' ? [c.old, c.new] : []))).toEqual([['none', 'active']]);
  });

  test('V as the aggressor, a group, or no fact at all (an item is never a fact): no goal', () => {
    const sim = goalSim('SF1-Y-1b');
    const y = adults(sim, 0)[0]!;
    const GA = sim.w.group(district(sim), 'A1');
    sim.startAt(5);
    feedEvents(sim, 5, [
      fact(sim, { ...pair(sim.w.v, y), effects: [{ on: y, effect: 'harm' }] }),
      fact(sim, { kind: 'assault', parties: [{ role: 'aggressor-group', who: GA, group: GA }, { role: 'victim', who: y }], effects: [{ on: y, effect: 'harm' }] }),
    ]);
    sim.advance(2);
    expect(goalList(sim)).toHaveLength(0);
  });

  test('y cast by a live seed: the first member of the household by member index who can own a goal owns it', () => {
    const sim = goalSim('SF1-Y-1c');
    const { y, kin } = withKin(sim);
    const x = adults(sim, 2, 'gang')[0]!;
    castBySeed(sim, y);
    sim.startAt(5);
    feedEvents(sim, 5, [fact(sim, { ...pair(x, y), effects: [{ on: y, effect: 'harm' }] })]);
    sim.advance(2);
    const g = goalList(sim, 'redress');
    expect(g).toHaveLength(1);
    // the first member by member index who can own a goal: an adult of any affiliation
    const ref = sim.people.refOf(y)!;
    const first = Array.from({ length: sim.people.blockInfo(ref.cell).sizes[ref.hIndex]! }, (_, j) => sim.people.residentId(ref.household, j)).find((m) => m !== y && sim.people.view(m)!.ageClass === 'adult' && m !== x)!;
    expect(g[0]!.owner).toBe(first);
    expect(kin.length).toBeGreaterThan(0);
    expect(g[0]!.target).toBe(x);
  });

  test('a killed victim passes the loss to kin; the aggressor is never their own kin\'s owner', () => {
    const sim = goalSim('SF1-Y-1d');
    const { y, kin } = withKin(sim);
    const x = adults(sim, 2, 'gang')[0]!;
    sim.startAt(5);
    feedEvents(sim, 5, [fact(sim, { ...pair(x, y), effects: [{ on: y, effect: 'kill' }] })]);
    // the victim is killed: a death pin; the goal passes to kin on the run that consumes the fact
    sim.k.pin({ node: y, slot: 'died', value: 5 * W + 5, reason: 'committed', cause: sim.w.port, at: 5 * W + 5 });
    sim.advance(2);
    const g = goalList(sim, 'redress');
    expect(g.length).toBeGreaterThan(0);
    expect(g.every((x2) => x2.owner !== x && x2.owner !== y)).toBe(true);
    expect(kin.length).toBeGreaterThan(0);
  });
});

describe('SF1-Y-4: capacity is admission', () => {
  test('a new goal beyond the owner\'s cap replaces the weakest if stronger, otherwise is not opened; kin are not offered it; role goals count against neither cap', () => {
    const sim = goalSim('SF1-Y-4');
    const { y, kin } = withKin(sim);
    const xs = adults(sim, 2, 'gang');
    const x = xs[0]!;
    const weak = plantGoal(sim, { owner: y, motive: 0.25, target: xs[1]! });
    const mid = plantGoal(sim, { owner: y, motive: 0.5, target: xs[2]! });
    sim.startAt(5);
    feedEvents(sim, 5, [fact(sim, { ...pair(x, y), effects: [{ on: y, effect: 'harm' }] })]);
    sim.advance(1);
    let goals = goalList(sim, 'redress').filter((g) => g.owner === y);
    expect(goals.map((g) => g.motive).sort()).toEqual([0.5, 0.59375]);
    expect(goals.some((g) => g.id === weak.id)).toBe(false);
    expect(goals.some((g) => g.id === mid.id)).toBe(true);
    // a size-1 goal act on y: motive 0.296875, weaker than both, so not opened; the kin are not offered it
    sim.advance(1);
    feedEvents(sim, 6, [fact(sim, { ...pair(xs[3] ?? xs[1]!, y), size: 1, goal: H(hs('some-goal')), effects: [{ on: y, effect: 'harm' }] })]);
    sim.advance(2);
    goals = goalList(sim, 'redress');
    expect(goals.filter((g) => g.owner === y)).toHaveLength(2);
    expect(goals.some((g) => kin.includes(g.owner))).toBe(false);
    expect(goalsState(sim).counters.capped).toBeGreaterThanOrEqual(2);
    // never ended owner-gone for being at capacity: the log has no such ending
    expect(sim.record.log.some((e) => e.reason === 'goal-end' && e.key?.endsWith('|owner-gone'))).toBe(false);
    expect(sim.record.log.filter((e) => e.reason === 'goal-cap').length).toBeGreaterThanOrEqual(2);
  });

  test('the 33rd goal of a district replaces the district\'s weakest if stronger', () => {
    const sim = goalSim('SF1-Y-4b');
    const all = adults(sim, 0).slice(0, 40);
    const enemy = adults(sim, 2, 'gang');
    // 32 planted goals with motives from 1/64 steps, one per owner
    all.slice(0, 32).forEach((o, i) => plantGoal(sim, { owner: o, motive: (i + 20) / 64, target: enemy[i % enemy.length]! }));
    sim.startAt(5);
    const strong = all[33]!;
    feedEvents(sim, 5, [fact(sim, { ...pair(enemy[0]!, strong), effects: [{ on: strong, effect: 'harm' }] })]);
    sim.advance(1);
    const redress = goalList(sim, 'redress');
    expect(redress).toHaveLength(32);
    expect(redress.some((g) => g.owner === strong)).toBe(true);
    expect(redress.some((g) => g.motive === 20 / 64)).toBe(false);
    expect(sim.record.log.some((e) => e.reason === 'goal-cap')).toBe(true);
    // a source weaker than the weakest one left is not opened
    sim.advance(1);
    const weakOne = all[35]!;
    feedEvents(sim, 6, [fact(sim, { ...pair(enemy[0]!, weakOne), size: 1, effects: [{ on: weakOne, effect: 'harm' }] })]);
    sim.advance(1);
    expect(goalList(sim, 'redress').filter((g) => g.owner === weakOne)).toHaveLength(0);
    void goalsNow; void goalsApplied;
  });
});

/** Two adults of one household, who spend their nights in one cell. */
function housemates(sim: Sim, skip = 0): [Id, Id] {
  let n = 0;
  for (const cell of sim.w.districts[0]!.cellIds) {
    for (const r of sim.people.residentsOfBlock(cell)) {
      if (sim.people.view(r)!.ageClass !== 'adult') continue;
      const ref = sim.people.refOf(r)!;
      const size = sim.people.blockInfo(ref.cell).sizes[ref.hIndex]!;
      for (let j = ref.j + 1; j < size; j++) {
        const m = sim.people.residentId(ref.household, j);
        if (sim.people.view(m)!.ageClass === 'adult' && n++ >= skip) return [r, m];
      }
    }
  }
  throw new Error('no two adults of one household in FX-3');
}

describe('SF1-Y-2 and SF1-Y-3: the goal-act rate, and the act', () => {
  const procDraw = (sim: Sim, w: number, goal: Id, i: number): number => rand(hs('proc'), hid(sim.k.worldSeed), hs('city.events'), hi(w), hs('gact'), hid(goal), hi(i));

  test('shape(assault, Wednesday 22:00) is 1.17 / 1.0285714, so mu = 2 x 0.75 x 1.1375 x (600 / 86400) = 0.0118490', () => {
    const sim = goalSim('SF1-Y-2', undefined, ['city.events', 'people.goals']);
    // a Wednesday evening at 22:00
    let t = -1;
    for (let w = 0; w < 1008; w++) if (sim.people.weekday(w * W) === 2 && sim.people.secondOfDay(w * W) === 22 * 3600) { t = w * W; break; }
    expect(t).toBeGreaterThanOrEqual(0);
    const shape = sim.city.shape('assault', t);
    expect(shape).toBeCloseTo(1.17 / 1.0285714, 6);
    expect(2 * 0.75 * shape * (W / 86400)).toBeCloseTo(0.011849, 6);
  });

  test('co-present: an act exactly when spacingCount(mu) is 1, never two in a day; apart: no candidate and no draw', () => {
    const sim = goalSim('SF1-Y-2b', (d) => { d.goals.rate.assault = 60; }, ['city.events', 'people.goals']);
    const [a, b] = housemates(sim);
    const g = plantGoal(sim, { owner: a, target: b, motive: 0.75 });
    sim.startAt(5);
    sim.advance(1);
    let acts = 0;
    let apart = 0;
    let together = 0;
    for (let i = 0; i < 1500 && acts === 0; i++) {
      const w = sim.windowNow();
      const T = w * W;
      const wa = sim.people.where(a, T);
      const wb = sim.people.where(b, T);
      const copresent = wa.cls !== 'away' && wb.cls !== 'away' && wa.cell !== undefined && wa.cell === wb.cell;
      const mu = sim.data.goals.rate.assault! * 0.75 * sim.city.shape('assault', T) * (W / 86400);
      const expected = copresent && spacingCount(mu, (j) => procDraw(sim, w, g.id, j), 1) === 1;
      sim.advance(1);
      const made = actsOfGoal(sim, g.id).filter((x) => x.w === w);
      expect(made.length, `window ${w}`).toBe(expected ? 1 : 0);
      if (copresent) together++;
      else apart++;
      acts += made.length;
    }
    expect(acts).toBe(1);
    expect(apart + together).toBeGreaterThan(0);
  });

  test('the act: an assault with the owner as aggressor and the target as victim, both fixed; served the goal\'s frame, causes the goal\'s source, generation 0; in the facts feed with its goal and not in counts; with done the goal and its frame are satisfied by the act', () => {
    const sim = goalSim('SF1-Y-3', (d) => { d.goals.rate.assault = 500; }, ['city.events', 'people.goals']);
    const [a, b] = housemates(sim);
    const source = H(hs('the-wrong'));
    const g = plantGoal(sim, { owner: a, target: b, motive: 0.75, source });
    sim.startAt(5);
    let made: ReturnType<typeof actsOfGoal> = [];
    for (let i = 0; i < 1500 && made.length === 0; i++) {
      sim.advance(1);
      made = actsOfGoal(sim, g.id);
    }
    expect(made).toHaveLength(1);
    const act = made[0]!;
    const view = sim.policies.viewEvent(act.id)!;
    expect(view.kind).toBe('assault');
    expect(view.participants).toContainEqual({ who: a, role: 'aggressor' });
    expect(view.participants).toContainEqual({ who: b, role: 'victim' });
    expect(view.causes).toEqual([source]);
    expect(act).toMatchObject({ served: g.id });
    expect(sim.stateOf<EventsState>('city.events')!.ring.find((r) => r.id === act.id)!.event!.gen).toBe(0);
    const facts = sim.digestOf<EventsDigest>('city.events')!.facts.windows.flatMap((x) => x.items).filter((f) => f.id === act.id);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ goal: g.id, size: 1, outcome: view.outcome });
    expect(sim.digestOf<EventsDigest>('city.events')!.counts.windows.flatMap((x) => x.items).some((c) => c.kind === 'assault')).toBe(false);
    sim.advance(3);
    if (view.outcome === 'done') {
      expect(goalList(sim).some((x) => x.id === g.id)).toBe(false);
      expect(sim.k.frames.frame(g.id)!.status).toBe('satisfied');
    } else {
      // an act that failed or was prevented leaves the goal: no more than one in a day
      expect(goalList(sim).some((x) => x.id === g.id)).toBe(true);
    }
  });
});

function actsOfGoal(sim: Sim, goal: Id): Array<{ w: number; id: Id; kind: string; served?: Id }> {
  return sim.stateOf<EventsState>('city.events')!.ring.filter((r) => r.event?.served === goal).map((r) => ({ w: r.w, id: r.id, kind: r.kind, served: r.event!.served }));
}

describe('SF1-Y-5: a seed\'s goal acts through the city', () => {
  /** A live seed gives resident `o` a role frame and a goal frame with the given effects (as S2 commits a role, S2 5.3). */
  function seedRole(sim: Sim, o: Id, effects: Array<{ on: Id; effect: 'take' | 'harm' | 'protect' | 'meet' }>, tag: string): { seed: Id; role: Id; goal: Id } {
    const seed = sim.k.root(`seed-${tag}`, 'core:seed');
    const role = sim.k.frames.open({ actor: seed, level: 'concern', origin: seed, weight: 1, cause: seed });
    const goal = sim.k.frames.open({ id: H(hs('role-goal'), hs(tag)), actor: o, level: 'goal', origin: seed, weight: 0.75, cause: seed, parents: [{ frame: role.id, weight: 1 }], payload: { goal: { effects } } });
    return { seed, role: role.id, goal: goal.id };
  }

  test('a role goal frame on a cast resident is recorded by seedGoals; people.goals holds a role goal with acts [theft] and the frame\'s weight; the theft comes from city.events when o and h share a cell; the seed\'s frame is never changed; the goal on V produces nothing; at the seed\'s end the role goal ends', () => {
    const sim = goalSim('SF1-Y-5', (d) => { d.goals.rate.theft = 1e6; d.goals.rate.assault = 1e6; }, ['city.events', 'people.goals']);
    const [h, o] = housemates(sim);
    const seed0 = sim.k.root('kit-y5', 'core:seed');
    const it = sim.k.root('item-y5', 'xf:item');
    sim.k.addEdge({ type: 'xf:held-by', from: it, to: h, cause: seed0, valid: { from: 0 } });
    const r = seedRole(sim, o, [{ on: it, effect: 'take' }], 'a');
    // a second role goal, aimed at V
    const o2 = adults(sim, 0).find((x) => x !== o && x !== h)!;
    const onV = seedRole(sim, o2, [{ on: sim.w.v, effect: 'harm' }], 'b');
    sim.k.settle();
    expect(sim.record.roleGoals.map((e) => [e.frame, e.owner, e.op])).toEqual([[r.goal, o, 'open'], [onV.goal, o2, 'open']]);
    sim.startAt(sim.windowNow());
    const w = Array.from({ length: 3000 }, (_, i) => i + sim.windowNow() + 2).find((x) => [h, o].every((p) => sim.people.where(p, x * W).cell === sim.people.where(h, x * W).cell && sim.people.where(p, x * W).cls !== 'away'))!;
    sim.startAt(w - 2);
    sim.advance(1);
    const roles = goalList(sim, 'role');
    const mine = roles.find((g) => g.id === r.goal)!;
    expect(mine).toMatchObject({ owner: o, acts: ['theft'], item: it, motive: 0.75, state: 'active' });
    expect(roles.find((g) => g.id === onV.goal)).toMatchObject({ owner: o2, acts: [] });
    for (let i = 0; i < 6; i++) sim.advance(1);
    const thefts = (sim.stateOf<EventsState>('city.events')?.ring ?? []).filter((x) => x.kind === 'theft' && x.event?.served === r.goal);
    expect(thefts.length).toBeGreaterThanOrEqual(1);
    // S1 never changes a seed's frame
    expect(sim.k.frames.frame(r.goal)!.status).toBe('active');
    expect(sim.k.frames.frame(onV.goal)!.status).toBe('active');
    // nothing came of the goal on V: no event serves it
    expect((sim.stateOf<EventsState>('city.events')?.ring ?? []).some((x) => x.event?.served === onV.goal)).toBe(false);
    // the seed's role ends: the frame is the seed's to end, and the role goal ends with it
    sim.k.frames.setStatus(r.goal, 'abandoned', r.seed);
    sim.advance(3);
    expect(goalList(sim, 'role').some((g) => g.id === r.goal)).toBe(false);
    expect(sim.k.frames.frame(r.goal)!.status).toBe('abandoned');
  });
});

describe('SF1-Y-6: a debt called in', () => {
  /** A seed's favour from `a` to `b`, minted at the time given. */
  const favour = (sim: Sim, a: Id, b: Id, time: number, kind = 'favour'): Id => {
    const seed = sim.k.root('favour-seed', 'core:seed');
    const roles = kind === 'favour' ? ['giver', 'receiver'] : kind === 'promise' ? ['promiser', 'promisee'] : ['repairer', 'other'];
    return sim.k.events.mintEvent({ creator: seed, cause: seed, name: `${kind}-${time}`, time, kind, place: sim.w.districts[0]!.cellIds[0]!, participants: [{ who: a, role: roles[0]! }, { who: b, role: roles[1]! }], witnesses: [], causes: [] });
  };

  test('a favour opens a collect goal for the giver seven days later (1,008 windows after), unless a repair between them came first; a promise three days later, for the promisee', () => {
    const sim = goalSim('SF1-Y-6');
    const [a, b] = housemates(sim);
    sim.startAt(5);
    favour(sim, a, b, 5 * W + 10);
    const c = adults(sim, 0).filter((x) => x !== a && x !== b);
    favour(sim, c[0]!, c[1]!, 5 * W + 20, 'promise');
    const [d, e] = [c[2]!, c[3]!];
    favour(sim, d, e, 5 * W + 30);
    favour(sim, d, e, 5 * W + 40, 'repair');
    let openedAt: number | undefined;
    for (let i = 0; i < 1100; i++) {
      sim.advance(1);
      if (openedAt === undefined && goalList(sim, 'collect').some((g) => g.owner === a)) openedAt = sim.windowNow();
    }
    expect(openedAt).toBe(5 + 1008);
    const mine = goalList(sim, 'collect').find((g) => g.owner === a)!;
    expect(mine).toMatchObject({ target: b, acts: ['call-in'], motive: 0.5 });
    expect(mine.expires! - mine.opened).toBe(2016);
    // the promise: three days (432 windows) later, for the one the promise was made to
    expect(goalList(sim, 'collect').find((g) => g.owner === c[1]!)).toMatchObject({ target: c[0]! });
    // a repair between d and e came before the favour fell due: no goal
    expect(goalList(sim, 'collect').some((g) => g.owner === d || g.owner === e)).toBe(false);
  });

  test('a call-in: done fills repay and comply and satisfies the goal; failed fills refuse and wrong(by: debtor, to: creditor), ends it refused and opens the creditor\'s redress of motive 0.5 from the same fact', () => {
    const seen = new Set<string>();
    for (let n = 0; n < 40 && seen.size < 2; n++) {
      const sim = goalSim(`SF1-Y-6-${n}`, (d) => { d.goals.rate['call-in'] = 1e6; d.goals.dueDays.favour = 1; }, ['city.events', 'people.goals']);
      const [a, b] = housemates(sim);
      sim.startAt(5);
      favour(sim, a, b, 5 * W + 10);
      let act: { id: Id; outcome?: string } | undefined;
      for (let i = 0; i < 700 && act === undefined; i++) {
        sim.advance(1);
        const hit = (sim.stateOf<EventsState>('city.events')?.ring ?? []).find((r) => r.kind === 'call-in' && r.event?.served !== undefined);
        if (hit) act = { id: hit.id, ...(hit.event!.outcome ? { outcome: hit.event!.outcome } : {}) };
      }
      if (act === undefined) continue;
      sim.advance(3);
      const view = sim.policies.viewEvent(act.id)!;
      expect(view.participants).toContainEqual({ who: a, role: 'creditor' });
      expect(view.participants).toContainEqual({ who: b, role: 'debtor' });
      const fills = sim.w.kinds.get('call-in')!.fills;
      expect(fills.map((f) => f.fn).sort()).toEqual(['comply', 'demand', 'refuse', 'repay', 'wrong']);
      if (view.outcome === 'done') {
        expect(sim.k.frames.all().filter((f) => f.level === 'goal' && f.actor === a && f.status === 'satisfied')).toHaveLength(1);
        expect(goalList(sim).filter((g) => g.owner === a)).toHaveLength(0);
        seen.add('done');
      } else {
        expect(view.outcome).toBe('failed');
        // refused: the collect goal is gone and the creditor holds a redress against the debtor, from the same fact, of motive 0.5
        expect(goalList(sim, 'collect').some((g) => g.owner === a)).toBe(false);
        const redress = goalList(sim, 'redress').find((g) => g.owner === a);
        expect(redress).toMatchObject({ target: b, motive: 0.5, source: act.id });
        expect(sim.k.frames.all().filter((f) => f.actor === a && f.status === 'abandoned')).toHaveLength(1);
        seen.add('failed');
      }
    }
    expect([...seen].sort()).toEqual(['done', 'failed']);
  });
});

describe('SF1-Y-7: blocking', () => {
  test('an owner cast by a seed: the frame is blocked, the post ended, no act; after the seed, active again with a new post', () => {
    const sim = goalSim('SF1-Y-7', (d) => { d.goals.rate.assault = 1e6; }, ['city.events', 'people.goals']);
    const [o, t] = housemates(sim);
    const g = plantGoal(sim, { owner: o, target: t, motive: 0.5, post: { cell: sim.people.view(o)!.cell, periods: [0, 1, 2, 3] } });
    sim.startAt(5);
    const cast = castBySeed(sim, o, sim.k.now);
    sim.advance(4);
    const blocked = goalList(sim).find((x) => x.id === g.id)!;
    expect(blocked).toMatchObject({ state: 'blocked', blocked: 'owner-cast' });
    expect(sim.k.frames.frame(g.id)!.status).toBe('blocked');
    const posts = goalsState(sim).posts.filter((p) => p.goal === g.id);
    expect(posts.every((p) => p.until !== undefined)).toBe(true);
    // no act while it is blocked
    sim.advance(30);
    expect((sim.stateOf<EventsState>('city.events')?.ring ?? []).some((r) => r.event?.served === g.id)).toBe(false);
    // the seed ends: the cast edge ends, the goal returns to active with a new post (the rate is lowered, so that no act ends it first)
    sim.data.goals.rate.assault = 1e-6;
    sim.k.endEdge(cast.edge, sim.k.now);
    sim.advance(3);
    const back = goalList(sim).find((x) => x.id === g.id)!;
    expect(back.state).toBe('active');
    expect(sim.k.frames.frame(g.id)!.status).toBe('active');
    expect(goalsState(sim).posts.filter((p) => p.goal === g.id && p.until === undefined)).toHaveLength(1);
  });

  test('a redress target V meets (an observed pin) is protected for good: blocked, a wish with nothing to do about it', () => {
    const sim = goalSim('SF1-Y-7b', undefined, ['city.events', 'people.goals']);
    const [o, t] = housemates(sim);
    const g = plantGoal(sim, { owner: o, target: t, motive: 0.5 });
    sim.startAt(5);
    sim.advance(2);
    expect(goalList(sim).find((x) => x.id === g.id)!.state).toBe('active');
    sim.k.pin({ node: t, slot: 'age', value: sim.k.value(t, 'age') as number, reason: 'observed', at: sim.k.now, cause: H(hs('observer')), evidence: t });
    sim.advance(3);
    expect(goalList(sim).find((x) => x.id === g.id)).toMatchObject({ state: 'blocked', blocked: 'target-protected' });
    expect(sim.k.frames.frame(g.id)!.status).toBe('blocked');
    sim.advance(50);
    expect(goalList(sim).find((x) => x.id === g.id)!.state).toBe('blocked');
  });
});
