// S1 v0.6 `people.goals` (S1 7.10): goals from the record, their caps, endings, blocks and posts (SF1-Y-1, Y-4, Y-5, Y-6, Y-7, Y-8, Y-9, Y-10).

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { H, s as hs } from '../../src/id.ts';
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
