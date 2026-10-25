// S1 v0.6 goals under demand, reload and forgetting (SF1-Y-8, SF1-Y-9), and the three-way property over goals, posts, items and intentions: unswept, swept and reloaded
// agree after every operation (S1-I-19, S1-I-21, S1-I-34).

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import type { Id } from '../../src/types.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import type { S1Data } from '../../src/sim/data.ts';
import { chainOf, transfer } from './feed.ts';
import { fxData, seedOf } from './helpers.ts';
import { watchChanges, W } from './goals-helpers.ts';

setDefaultTimeout(300_000);
const FULL = process.env.S1_FULL === '1';

/** FX-3 with the city's rates multiplied by `factor`, so that wrongs happen and goals open (as SF1-E2 does). */
const busy = (factor: number) => (d: S1Data): void => {
  for (const k of Object.keys(d.shape.rate)) d.shape.rate[k] = d.shape.rate[k]!.map((x) => x * factor) as [number, number, number, number];
  d.goals.attempts = 400;
};
const make = (name: string, factor = 10, withItem = false): Sim => {
  const sim = Sim.create({ worldSeed: seedOf(name), index: fx3Slice(), data: fxData((d) => { busy(factor)(d); if (withItem) d.goals.rate.theft = 400; }) });
  if (withItem) {
    // an item held by one resident, and a seed's role goal that takes it: the holder edges move through the city's own rates
    const adults = sim.w.districts[0]!.cellIds.flatMap((c) => sim.people.residentsOfBlock(c)).filter((r) => sim.people.view(r)!.ageClass === 'adult' && sim.people.view(r)!.affc === 0);
    const [holder, thief] = [adults[0]!, adults[1]!];
    const seed = sim.k.root('kit', 'core:seed');
    const item = sim.k.root('item', 'xf:item');
    sim.k.addEdge({ type: 'xf:held-by', from: item, to: holder, cause: seed, valid: { from: 0 } });
    sim.setState('people.goals', (st) => {
      (st as { goals: unknown[] }).goals.push({ id: seed, kind: 'role', owner: thief, source: seed, acts: ['theft'], item, motive: 1, opened: 0, state: 'active' });
    });
  }
  return sim;
};

/** What the goals layer holds, as one comparable value: the process states and digests it keeps, the retained goal frames, the edges of items and the record's entries. */
function observation(sim: Sim, ended = true): unknown {
  const frames = sim.k.frames.all().filter((f) => f.retain === true && (ended || f.status === 'active' || f.status === 'blocked')).map((f) => ({ id: f.id, actor: f.actor, status: f.status, weight: f.weight, payload: f.payload, focus: f.focus, cause: f.cause })).sort((a, b) => (a.id < b.id ? -1 : 1));
  const items = sim.k.store.idsOfKind('xf:item').sort();
  const edges = items.flatMap((i) => sim.k.store.edgesFrom(i).filter((e) => e.type === 'xf:held-by').map((e) => ({ to: e.to, valid: e.valid, cause: e.cause })));
  const procs = ['people.goals', 'city.events', 'group.decide', 'scene.acts'].map((p) => [p, sim.stateOf(p), sim.digestOf(p)]);
  return { frames, edges, procs, grudges: sim.record.grudges, roleGoals: sim.record.roleGoals, log: sim.record.log };
}

const ring = (sim: Sim): Array<{ w: number; kind: string; served?: Id }> => (sim.stateOf<{ ring: Array<{ w: number; kind: string; event?: { served?: Id } }> }>('city.events')?.ring ?? []).map((r) => ({ w: r.w, kind: r.kind, ...(r.event?.served ? { served: r.event.served } : {}) }));

describe('SF1-Y-8: demand independence', () => {
  test('two runs with V in different cells, and so a different demand: identical people.goals states, digests, goal frames and goal acts', () => {
    const run = (cellIndex: number) => {
      const sim = make('SF1-Y-8');
      sim.k.reading(sim.w.vState, 'cell', sim.w.districts[0]!.cellIds[cellIndex]!, sim.k.now);
      sim.advance(FULL ? 420 : 160);
      return sim;
    };
    const a = run(0);
    const b = run(2);
    const goals = a.stateOf<{ goals: unknown[]; counters: { opened: number } }>('people.goals')!;
    expect(goals.counters.opened).toBeGreaterThan(0);
    expect(ring(a).some((r) => r.served !== undefined)).toBe(true);
    // only the fine tier's output differs: its decision log lines (and so the sequence numbers after them) are left out
    const keep = (sim: Sim): unknown => {
      const o = observation(sim) as { procs: unknown[]; log: Array<{ proc: string; seq: number }> };
      return { ...o, procs: o.procs.filter((p) => (p as unknown[])[0] !== 'scene.acts'), log: o.log.filter((e) => e.proc !== 'scene.acts').map(({ seq: _s, ...rest }) => rest) };
    };
    expect(keep(a)).toEqual(keep(b));
    // the fine tier saw something else: V was in a different place
    expect(a.digestOf<{ scenes: Id[] }>('scene.acts')!.scenes).not.toEqual(b.digestOf<{ scenes: Id[] }>('scene.acts')!.scenes);
  });
});

describe('SF1-Y-9: reload', () => {
  test('save with active goals and a post; load into a fresh engine under another epoch, play clock and wall clock; run on: no frame change on load, the same frames, posts and acts as without the save; a forgetting sweep removes no active or blocked goal frame', () => {
    const name = 'SF1-Y-9';
    const ref = make(name);
    ref.advance(FULL ? 300 : 120);
    // wait for goals with posts: a second round of the same world until a goal with a post is live (the duties of an intention)
    const goalsAt = (s: Sim): { goals: Array<{ state: string; id: Id }>; posts: unknown[] } => s.stateOf('people.goals')!;
    expect(goalsAt(ref).goals.filter((g) => g.state !== 'ended').length).toBeGreaterThan(0);
    ref.k.persistence.save('A');
    const keyOf = chainOf(ref);
    expect(keyOf.has('A')).toBe(true);
    ref.advance(FULL ? 200 : 80);
    const loaded = transfer(ref, 'A', () => make(name), 11);
    const changes = watchChanges(loaded);
    loaded.k.newEpoch();
    // no frame change on load: the goal frames are restored from their records, never opened again
    expect(changes.filter((c) => c.c === 'frame')).toHaveLength(0);
    loaded.advance(FULL ? 200 : 80);
    // the frames that are alive agree; an ended frame no event refers to is not in a save, and recovery restores it from its records
    expect(observation(loaded, false)).toEqual(observation(ref, false));
    // a forgetting sweep removes no active or blocked goal frame
    const live = loaded.k.frames.all().filter((f) => f.retain === true && (f.status === 'active' || f.status === 'blocked')).map((f) => f.id);
    loaded.k.retention.scheduleSweep();
    loaded.k.settle();
    for (const id of live) expect(loaded.k.frames.frame(id), id).toBeDefined();
    void W;
  });
});

describe('the three-way property over goals, posts, items and intentions', () => {
  test('unswept, swept and reloaded runs of the same world agree, window after window and at the end', () => {
    const name = 'SF1-three-way';
    const a = make(name, 10, true);
    const b = make(name, 10, true);
    const checks: number[] = [];
    for (let step = 0; step < (FULL ? 6 : 3); step++) {
      a.advance(FULL ? 70 : 45);
      b.advance(FULL ? 70 : 45);
      // b: sweep what a save could recover, and carry on
      b.k.retention.scheduleSweep();
      b.k.settle();
      // c: a reload of a's save at this window, run to the same window
      a.k.persistence.save(`P${step}`);
      const c = transfer(a, `P${step}`, () => make(name, 10, true), 5 + step);
      c.advance(0);
      // an ended goal frame is dropped by a sweep when no event refers to it, and recovery restores it from its records (S1 11): what must agree is what is alive
      expect(observation(c, false), `reloaded at step ${step}`).toEqual(observation(a, false));
      expect(observation(b, false), `swept at step ${step}`).toEqual(observation(a, false));
      checks.push(a.windowNow());
    }
    expect(checks).toHaveLength(FULL ? 6 : 3);
    // the item moved through a goal act, and the busy world held goals and a hunt's worth of state: the property is not vacuous
    const o = observation(a, false) as { edges: unknown[]; procs: Array<[string, { goals?: unknown[] } | undefined]> };
    expect(o.edges.length).toBeGreaterThanOrEqual(2);
    expect(o.procs.find((x) => x[0] === 'people.goals')![1]!.goals!.length).toBeGreaterThan(0);
  });
});
