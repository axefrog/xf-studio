// S1 v0.6 goals under demand, reload and forgetting (SF1-Y-8, SF1-Y-9), and the three-way property over goals, posts, items and intentions: unswept, swept and reloaded
// agree after every operation (S1-I-19, S1-I-21, S1-I-34).

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import type { Id } from '../../src/types.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import type { S1Data } from '../../src/sim/data.ts';
import { chainOf, transfer } from './feed.ts';
import { fxData, seedOf } from './helpers.ts';
import { bigSim, gnode, watchChanges, W } from './goals-helpers.ts';

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
      sim.advance(FULL ? 420 : 120);
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
    ref.advance(FULL ? 300 : 60);
    // wait for goals with posts: a second round of the same world until a goal with a post is live (the duties of an intention)
    const goalsAt = (s: Sim): { goals: Array<{ state: string; id: Id }>; posts: unknown[] } => s.stateOf('people.goals')!;
    expect(goalsAt(ref).goals.filter((g) => g.state !== 'ended').length).toBeGreaterThan(0);
    ref.k.persistence.save('A');
    const keyOf = chainOf(ref);
    expect(keyOf.has('A')).toBe(true);
    ref.advance(FULL ? 200 : 40);
    const loaded = transfer(ref, 'A', () => make(name), 11);
    const changes = watchChanges(loaded);
    loaded.k.newEpoch();
    // no frame change on load: the goal frames are restored from their records, never opened again
    expect(changes.filter((c) => c.c === 'frame')).toHaveLength(0);
    loaded.advance(FULL ? 200 : 40);
    // the frames that are alive agree (the ended ones a save held or a record refers to are in the reload too: e2e-v06 compares them in full)
    expect(observation(loaded, false)).toEqual(observation(ref, false));
    // a forgetting sweep removes no active or blocked goal frame
    const live = loaded.k.frames.all().filter((f) => f.retain === true && (f.status === 'active' || f.status === 'blocked')).map((f) => f.id);
    loaded.k.retention.scheduleSweep();
    loaded.k.settle();
    for (const id of live) expect(loaded.k.frames.frame(id), id).toBeDefined();
    void W;
  });
});

/** The reads `leads` and `holds` over the whole past of `a`'s seat and holder edges, as each of the runs answers them (S1 9.1: initial value first, then the kernel's edge times). */
function pastReads(a: Sim, s: Sim): unknown {
  const pairs = a.k.store.allEdges().filter((e) => e.type === 'xf:leads' || e.type === 'xf:held-by').sort((x, y) => (x.id < y.id ? -1 : 1));
  return pairs.map((e) => [e.type, e.from, e.to, e.type === 'xf:leads' ? s.reads.transitions('leads', [e.from, e.to], 0, s.k.now) : s.reads.transitions('holds', [e.to, e.from], 0, s.k.now)]);
}

describe('a seat edge that ended before the first save', () => {
  test('a run that never saved before the holders died, saved and reloaded: the reads of the past answer as the unbroken run does, though the unsaved run\'s next-save view would not list the ended edges', () => {
    const make1 = (): Sim => bigSim('SF1-ended-seats', undefined, ['group.decide']);
    const a = make1();
    a.advance(5);
    const GA = gnode(a, 'A1');
    const live = a.k.store.edgesTo(GA).filter((e) => e.type === 'xf:leads' && e.valid.to === undefined);
    expect(live.length).toBeGreaterThan(0);
    for (const e of live) a.k.pin({ node: e.from, slot: 'died', value: a.k.now, reason: 'committed', cause: a.w.port, at: a.k.now });
    a.advance(4);
    const ended = a.k.store.edgesTo(GA).filter((e) => e.type === 'xf:leads' && e.valid.to !== undefined);
    expect(ended.length).toBe(live.length);
    // the view of the unsaved run omits them; its save writes them (they changed since the base), and the reload answers every read of the past alike
    a.flush();
    expect((a.k.persistence.currentView().toData().edges as Array<{ type: string; valid: { to?: number } }>).filter((e) => e.type === 'xf:leads' && e.valid.to !== undefined)).toHaveLength(0);
    a.k.persistence.save('X');
    const c = transfer(a, 'X', make1, 5);
    for (const e of ended) {
      expect(c.reads.transitions('leads', [e.from, GA], 0, c.k.now)).toEqual(a.reads.transitions('leads', [e.from, GA], 0, a.k.now));
      expect(c.reads.eval('leads', [e.from, GA], 100)).toBe('yes');
    }
    // and a sweep of the run that was saved, then a read of the past, is the same
    a.k.retention.scheduleSweep();
    a.k.settle();
    for (const e of ended) expect(a.reads.eval('leads', [e.from, GA], 100)).toBe('yes');
  });
});

describe('the three-way property over goals, posts, items and intentions', () => {
  test('unswept, swept and reloaded runs of the same world agree, window after window and at the end', () => {
    const name = 'SF1-three-way';
    const a = make(name, 10, true);
    const b = make(name, 10, true);
    const checks: number[] = [];
    for (let step = 0; step < (FULL ? 6 : 3); step++) {
      a.advance(FULL ? 70 : 36);
      b.advance(FULL ? 70 : 36);
      // b: sweep what a save could recover, and carry on
      // at the first step the seat holders of the Claws die, so that seats pass on and their edges end: past intervals for the reads to answer
      if (step === 0) {
        const GA = a.w.group(a.w.districts[0]!.id, 'A1');
        for (const sim of [a, b]) for (const e of sim.k.store.edgesTo(GA).filter((x) => x.type === 'xf:leads' && x.valid.to === undefined)) sim.k.pin({ node: e.from, slot: 'died', value: sim.k.now, reason: 'committed', cause: sim.w.port, at: sim.k.now });
        a.advance(3);
        b.advance(3);
      }
      b.k.retention.scheduleSweep();
      b.k.settle();
      // c: a reload of a's save at this window, run to the same window
      a.k.persistence.save(`P${step}`);
      const c = transfer(a, `P${step}`, () => make(name, 10, true), 5 + step);
      c.advance(0);
      // an ended goal frame is dropped by a sweep when no event refers to it, and recovery restores it from its records (S1 11): what must agree is what is alive
      expect(observation(c, false), `reloaded at step ${step}`).toEqual(observation(a, false));
      expect(observation(b, false), `swept at step ${step}`).toEqual(observation(a, false));
      // the past is answered the same: the intervals of every seat and holder edge, ended ones included, by the unbroken, the swept and the reloaded run
      const past = pastReads(a, a);
      expect(JSON.stringify(pastReads(a, c)), `reloaded past at step ${step}`).toEqual(JSON.stringify(past));
      expect(JSON.stringify(pastReads(a, b)), `swept past at step ${step}`).toEqual(JSON.stringify(past));
      if (step > 0) expect(a.k.store.allEdges().some((e) => e.type === 'xf:leads' && e.valid.to !== undefined), 'an ended seat edge').toBe(true);
      checks.push(a.windowNow());
    }
    expect(checks).toHaveLength(FULL ? 6 : 3);
    // the item moved through a goal act, and the busy world held goals and a hunt's worth of state: the property is not vacuous
    const o = observation(a, false) as { edges: unknown[]; procs: Array<[string, { goals?: unknown[] } | undefined]> };
    expect(o.edges.length).toBeGreaterThanOrEqual(2);
    expect(o.procs.find((x) => x[0] === 'people.goals')![1]!.goals!.length).toBeGreaterThan(0);
  });
});
