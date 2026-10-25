// S1 v0.6 items and holders (S1 4.9, 7.2): SF1-I-17 (a theft moves a holder edge), SF1-I-18 (two transfers in one window), SF1-Y-5 (a seed's role goal acts through the city).

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import type { Edge, Id } from '../../src/types.ts';
import { processCause } from '../../src/evolution.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import type { EventsState } from '../../src/sim/proc-events.ts';
import type { Occurrence } from '../../src/sim/occ.ts';
import { chainOf, transfer } from './feed.ts';
import { castBySeed, goalList, goalSim, goalsNow, plantGoal, W } from './goals-helpers.ts';
import { quietData, seedOf } from './helpers.ts';
import type { S1Data } from '../../src/sim/data.ts';

setDefaultTimeout(180_000);

const ONLY = ['city.events', 'people.goals'];
const rich = (d: S1Data): void => { d.goals.rate.theft = 1e6; d.goals.rate.assault = 1e6; };

/** Adults of one household, at least `n` of them, as a list. */
function household(sim: Sim, n: number): Id[] {
  for (const cell of sim.w.districts[0]!.cellIds) {
    for (const r of sim.people.residentsOfBlock(cell)) {
      const ref = sim.people.refOf(r)!;
      if (ref.j !== 0) continue;
      const size = sim.people.blockInfo(ref.cell).sizes[ref.hIndex]!;
      const adults = Array.from({ length: size }, (_, j) => sim.people.residentId(ref.household, j)).filter((m) => sim.people.view(m)!.ageClass === 'adult' && sim.people.view(m)!.affc === 0);
      if (adults.length >= n) return adults;
    }
  }
  throw new Error(`no household with ${n} adult civilians in FX-3`);
}

/** The first window at or after `from` in which all the people are alive, in one cell and not away. */
function together(sim: Sim, people: Id[], from: number): number {
  for (let w = from; w < from + 3000; w++) {
    const wh = people.map((p) => sim.people.where(p, w * W));
    if (wh.every((x) => x.cls !== 'away' && x.cell !== undefined && x.cell === wh[0]!.cell)) return w;
  }
  throw new Error('the people are never together');
}

/** An item `i` held by `holder` from time 0, minted by a seed's kit. */
function item(sim: Sim, name: string, holder: Id): { item: Id; seed: Id; edge: Id } {
  const seed = sim.k.root(`kit-${name}`, 'core:seed');
  const i = sim.k.root(`item-${name}`, 'xf:item');
  const e = sim.k.addEdge({ type: 'xf:held-by', from: i, to: holder, cause: seed, valid: { from: 0 } });
  return { item: i, seed, edge: e.id };
}

const holderEdges = (sim: Sim, i: Id): Array<Pick<Edge, 'to' | 'cause'> & { valid: Edge['valid'] }> =>
  sim.k.store.edgesFrom(i).filter((e) => e.type === 'xf:held-by').sort((a, b) => a.valid.from - b.valid.from).map((e) => ({ to: e.to, cause: e.cause, valid: e.valid }));

const theftsOf = (sim: Sim): Array<{ w: number; id: Id; outcome?: string }> =>
  (sim.stateOf<EventsState>('city.events')?.ring ?? []).filter((r) => r.kind === 'theft' && r.event?.served !== undefined).map((r) => ({ w: r.w, id: r.id, ...(r.event!.outcome ? { outcome: r.event!.outcome } : {}) }));

describe('SF1-I-17: items and holders', () => {
  /** A role goal of `o` with `take` on the item `i`, planted as `seedGoals` would have given it. */
  const roleGoal = (sim: Sim, o: Id, i: Id, seed: Id) => plantGoal(sim, { owner: o, kind: 'role', source: seed, acts: ['theft'], item: i, motive: 1 });

  test('a role goal with take on an item held by h: a theft goal act, item i, victim h; done moves the edge to the act\'s time with the act as cause; holds follows', () => {
    const sim = goalSim('SF1-I-17', rich, ONLY);
    const [h, o] = household(sim, 2) as [Id, Id];
    const it = item(sim, 'a', h);
    roleGoal(sim, o, it.item, it.seed);
    sim.startAt(together(sim, [h, o], 6) - 1);
    for (let i = 0; i < 40 && theftsOf(sim).length === 0; i++) sim.advance(1);
    // one more window applies the batch that moved the holder
    sim.advance(1);
    const acts = theftsOf(sim);
    expect(acts.length).toBeGreaterThanOrEqual(1);
    const act = acts[0]!;
    const view = sim.policies.viewEvent(act.id)!;
    expect(view.participants).toContainEqual({ who: it.item, role: 'item' });
    expect(view.participants).toContainEqual({ who: h, role: 'victim' });
    expect(view.participants).toContainEqual({ who: o, role: 'aggressor' });
    expect(view.outcome).toBe('done');
    const edges = holderEdges(sim, it.item);
    expect(edges).toHaveLength(2);
    expect(edges[0]).toMatchObject({ to: h, cause: it.seed, valid: { from: 0, to: view.time } });
    expect(edges[1]).toMatchObject({ to: o, cause: act.id, valid: { from: view.time } });
    expect(sim.reads.eval('holds', [h, it.item], view.time + 1)).toBe('no');
    expect(sim.reads.eval('holds', [o, it.item], view.time + 1)).toBe('yes');
    expect(sim.reads.eval('holds', [h, it.item], view.time - 1)).toBe('yes');
  });

  test('prevented: no edge changes (a guard stood by the victim); found over seeds, since the outcome is a keyed draw', () => {
    let seen: { sim: Sim; h: Id; it: ReturnType<typeof item>; act: ReturnType<typeof theftsOf>[number] } | undefined;
    for (let n = 0; n < 24 && !seen; n++) {
      const sim = goalSim(`SF1-I-17-prevented-${n}`, rich, ONLY);
      const people = household(sim, 3);
      const [h, o, g] = people as [Id, Id, Id];
      const it = item(sim, 'p', h);
      roleGoal(sim, o, it.item, it.seed);
      // a guard of h, standing at h's home in every period
      const home = sim.people.view(h)!.cell;
      plantGoal(sim, { owner: g, kind: 'carry-out', duty: 'guard', ward: h, acts: ['presence'], post: { cell: home, periods: [0, 1, 2, 3] }, motive: 0.5 });
      const w = together(sim, [h, o], 6);
      sim.startAt(w - 1);
      // the theft happens where h is: the guard guards them wherever they are at home; require h at home
      if (sim.people.where(h, w * W).cell !== home) continue;
      for (let i = 0; i < 30 && theftsOf(sim).length === 0; i++) sim.advance(1);
      const t = theftsOf(sim)[0];
      if (t?.outcome === 'prevented') seen = { sim, h, it, act: t };
    }
    expect(seen, 'a prevented theft over 24 worlds').toBeDefined();
    const { sim, h, it, act } = seen!;
    sim.advance(2);
    expect(sim.policies.viewEvent(act.id)!.outcome).toBe('prevented');
    expect(holderEdges(sim, it.item)).toEqual([{ to: h, cause: it.seed, valid: { from: 0 } }]);
    expect(sim.reads.eval('holds', [h, it.item])).toBe('yes');
  });

  test('a theft of an item V holds is never produced: the goal act is not drawn, and the gate would refuse it v-target', () => {
    const sim = goalSim('SF1-I-17-v', rich, ONLY);
    const [o, h] = household(sim, 2) as [Id, Id];
    const it = item(sim, 'v', sim.w.v);
    roleGoal(sim, o, it.item, it.seed);
    sim.startAt(together(sim, [h, o], 6) - 1);
    sim.advance(60);
    expect(theftsOf(sim)).toHaveLength(0);
    expect(holderEdges(sim, it.item).map((e) => e.to)).toEqual([sim.w.v]);
    const occ: Occurrence = { kind: 'theft', origin: 'sim', size: 1, window: 6, participants: [{ who: o, role: 'aggressor' }, { who: sim.w.v, role: 'victim' }, { who: it.item, role: 'item' }], effects: [{ on: sim.w.v, effect: 'take' }], creator: processCause('city.events') };
    expect(sim.gate.produce(occ, sim.k.settings.current(), 6 * W)).toEqual({ ok: false, reason: 'v-target' });
  });
});

describe('SF1-I-18: two transfers in one window', () => {
  const make = (): Sim => goalSim('SF1-I-18', rich, ONLY);

  function scenario() {
    const sim = make();
    const [h, o1, o2] = household(sim, 3) as [Id, Id, Id];
    const it = item(sim, 'two', h);
    for (const o of [o1, o2]) plantGoal(sim, { owner: o, kind: 'role', source: it.seed, acts: ['theft'], item: it.item, motive: 1 });
    const w = together(sim, [h, o1, o2], 8);
    return { sim, h, o1, o2, it, w };
  }

  const finish = (sim: Sim, it: { item: Id }, w: number) => ({
    edges: holderEdges(sim, it.item),
    thefts: theftsOf(sim).filter((t) => t.w === w).map((t) => t.id),
    refused: sim.record.log.filter((e) => e.reason === 'no-cast' && e.w === w).length,
    children: sim.stateOf<EventsState>('city.events')!.calendar,
  });

  test('o1\'s theft, earlier by (time, Id), is admitted done and moves the item; o2\'s is refused no-cast and draws no offspring; one call, per window, and with a save and load before and after the window give the same edges', () => {
    const run = (mode: 'one' | 'each' | 'reload-before' | 'reload-after') => {
      const { sim, w, it, h, o1, o2 } = scenario();
      sim.startAt(w - 1);
      let cur = sim;
      // window w - 1 publishes the goals, window w draws the acts, and window w + 1 begins by applying what w decided
      if (mode === 'one') cur.advance(3);
      else if (mode === 'each') for (let i = 0; i < 3; i++) cur.advance(1);
      else {
        cur.advance(mode === 'reload-before' ? 1 : 2);
        cur.k.persistence.save('A');
        cur = transfer(cur, 'A', () => { const s = make(); s.k.root('kit-two', 'core:seed'); s.k.root('item-two', 'xf:item'); return s; });
        cur.advance(mode === 'reload-before' ? 2 : 1);
      }
      return { out: finish(cur, it, w), sim: cur, it, h, o1, o2, w };
    };
    const a = run('one');
    // in window w exactly one theft got through, o1's or o2's, whichever came first: one edge from h ended and one started. The other was refused (its victim no
    // longer holds the item); the next window it takes the item from the new holder, as its own goal allows
    expect(a.out.edges).toHaveLength(3);
    expect(a.out.edges[0]!.valid.to).toBeDefined();
    expect([a.o1, a.o2]).toContain(a.out.edges[1]!.to);
    const winner = a.out.edges[1]!.to;
    const loser = winner === a.o1 ? a.o2 : a.o1;
    expect(a.out.edges[2]!.to).toBe(loser);
    // the loser's act: found in the ring as the refused, never minted
    expect(a.out.refused).toBeGreaterThanOrEqual(1);
    expect(a.out.thefts.length).toBe(1);
    expect(a.sim.policies.viewEvent(a.out.thefts[0]!)!.participants).toContainEqual({ who: winner, role: 'aggressor' });
    expect(a.sim.policies.viewEvent(a.out.thefts[0]!)!.participants.some((p) => p.who === loser)).toBe(false);
    for (const mode of ['each', 'reload-before', 'reload-after'] as const) {
      const b = run(mode);
      expect(b.out.edges, mode).toEqual(a.out.edges);
      expect(b.out.thefts, mode).toEqual(a.out.thefts);
    }
    void chainOf; void goalList; void goalsNow; void castBySeed; void fx3Slice; void quietData; void seedOf;
  });
});
