// SF1-A: the fine tier (S1 7.9, 14.1).

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { processCause } from '../../src/evolution.ts';
import { H, mintedId, s as hs } from '../../src/id.ts';
import type { Change, Id } from '../../src/types.ts';
import { itemDescriptor, type ActsState } from '../../src/sim/proc-acts.ts';
import { ReplayPort } from '../../src/sim/port.ts';
import { type EventsState } from '../../src/sim/proc-events.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import { child, fxData, inject, quietData, seedOf } from './helpers.ts';

// Bun 1.4 gives the default set in test/setup.ts to the first test file only
setDefaultTimeout(120_000);

const W = 600;
const FULL = process.env.S1_FULL === '1';
const eventsProc = processCause('city.events');

/** FX-3 with the events process and the fine tier; no incidents of their own, and no offspring. Event changes are collected as they are emitted. */
function actsSim(name: string, tweak: (d: ReturnType<typeof quietData>) => void = () => {}) {
  const sim = Sim.create({ worldSeed: seedOf(name), index: fx3Slice(), data: quietData((d) => { d.events.offspring = [0, 0, 0, 0]; tweak(d); }), only: ['city.events', 'scene.acts'] });
  const emitted: Id[] = [];
  const emit = sim.k.emit.bind(sim.k);
  sim.k.emit = (change: Change, time?: number) => {
    if (change.c === 'event') emitted.push(change.event);
    emit(change, time);
  };
  const [c1, c2, c3] = sim.w.districts[0]!.cellIds as [Id, Id, Id];
  return { sim, emitted, port: new ReplayPort(sim), c1, c2, c3 };
}

const actsState = (sim: Sim): ActsState => sim.k.evolution.states.get('scene.acts')!.state as ActsState;
const summaryOf = (w: number, cell: Id, kind = 'theft'): Id => mintedId(eventsProc, eventsProc, `sum/${w}/${cell}/${kind}`);

describe('SF1-A-1: opening and publication', () => {
  test('a focused cell with 3 m1 items in window k - 1: the run for k opens three events with adult people, at most 12 witnesses, outcome done, each published once as an event Change; the count is unchanged', () => {
    const { sim, emitted, port, c1 } = actsSim('SF1-A-1');
    const j = 100;
    port.submit([{ t: (j - 1) * W + 5, op: 'reading', node: 'v', slot: 'cell', value: 'c1' }]);
    sim.startAt(j);
    inject(sim, child(sim, 'a1', 0, j + 1, 'theft', 1, c1), child(sim, 'a2', 0, j + 1, 'theft', 1, c1), child(sim, 'a3', 0, j + 1, 'theft', 1, c1));
    sim.advance(3);
    const S = summaryOf(j + 1, c1);
    expect(sim.k.value(S, 'count')).toBe(3);
    const st = actsState(sim);
    expect(st.published.map((p) => p.summary)).toEqual([S, S, S]);
    expect(st.published.map((p) => p.index).sort()).toEqual([0, 1, 2]);
    for (const p of st.published) {
      const ev = sim.policies.viewEvent(p.item)!;
      expect(ev.kind).toBe('theft');
      expect(ev.outcome).toBe('done');
      expect(ev.place).toBe(c1);
      expect(ev.witnesses.length).toBeLessThanOrEqual(12);
      expect(ev.participants.map((x) => x.role).sort()).toEqual(['aggressor', 'victim']);
      for (const x of ev.participants) expect(sim.people.view(x.who)!.ageClass).toBe('adult');
      expect(ev.effects).toEqual([{ on: ev.participants.find((x) => x.role === 'victim')!.who, effect: 'take' }]);
      // each is published exactly once as an event Change
      expect(emitted.filter((e) => e === p.item).length).toBe(1);
      expect(sim.k.events.published.has(p.item)).toBe(true);
      // the casting names the item, not the opening window: the cast is the pure function of the descriptor
      const entry = sim.ringEntry(S)!;
      const d = itemDescriptor(sim, S, p.index, j + 1, c1, 'theft', entry.meta![p.index]!);
      const cast = sim.casting.cast(d);
      expect(cast).not.toBe('no-cast');
      expect(ev.participants.map((x) => ({ role: x.role, who: x.who }))).toEqual((cast as Array<{ role: string; who: Id }>).map((x) => ({ role: x.role, who: x.who })));
    }
    // opening an item changes no count
    expect(sim.k.value(S, 'count')).toBe(3);
    expect(sim.ringEntry(S)!.count).toBe(3);
    sim.advance(6);
    for (const p of st.published) expect(emitted.filter((e) => e === p.item).length).toBe(1);
    expect(actsState(sim).published.length).toBe(3);
  });
});

describe('SF1-A-2: regeneration is silent', () => {
  test('open, forget the scene, reload, bring the cell into focus: the same participants and witnesses, the contributions restated, no second event Change, the published list unchanged', () => {
    const { sim, emitted, port, c1 } = actsSim('SF1-A-2');
    const j = 100;
    port.submit([{ t: (j - 1) * W + 5, op: 'reading', node: 'v', slot: 'cell', value: 'c1' }]);
    sim.startAt(j);
    inject(sim, child(sim, 'a1', 0, j + 1, 'theft', 1, c1), child(sim, 'a2', 0, j + 1, 'theft', 1, c1), child(sim, 'a3', 0, j + 1, 'theft', 1, c1));
    sim.advance(3);
    const before = actsState(sim).published.map((p) => ({ ...p }));
    expect(before.length).toBe(3);
    const view = (id: Id) => {
      const v = sim.policies.viewEvent(id)!;
      return { participants: v.participants, witnesses: v.witnesses, effects: v.effects, time: v.time, place: v.place };
    };
    const first = before.map((p) => view(p.item));
    const count = emitted.length;
    sim.k.persistence.save('A');
    sim.advance(2);
    sim.k.persistence.load('A');
    // the scene is gone: the items hold no fields
    for (const p of before) expect(sim.k.value(p.item, 'kind')).toBeUndefined();
    expect(actsState(sim).published).toEqual(before);
    // the game restates where V is, and the fine tier regenerates the scene
    new ReplayPort(sim).submit([{ t: sim.k.now, op: 'reading', node: 'v', slot: 'cell', value: 'c1' }]);
    sim.advance(3);
    for (const [i, p] of before.entries()) expect(view(p.item)).toEqual(first[i]!);
    expect(emitted.length).toBe(count);
    expect(actsState(sim).published).toEqual(before);
  });
});

describe('SF1-A-2b: regeneration reads the scene, not the pins (Sol 5)', () => {
  test('an item whose descriptor was made canon keeps its pins through a load, and its people are regenerated all the same', () => {
    const { sim, emitted, port, c1 } = actsSim('SF1-A-2b');
    const j = 100;
    port.submit([{ t: (j - 1) * W + 5, op: 'reading', node: 'v', slot: 'cell', value: 'c1' }]);
    sim.startAt(j);
    inject(sim, child(sim, 'a1', 0, j + 1, 'theft', 1, c1), child(sim, 'a2', 0, j + 1, 'theft', 1, c1));
    sim.advance(3);
    const before = actsState(sim).published.map((p) => ({ ...p }));
    expect(before.length).toBe(2);
    const view = (id: Id) => {
      const v = sim.policies.viewEvent(id)!;
      return { participants: v.participants, witnesses: v.witnesses, effects: v.effects, time: v.time, place: v.place };
    };
    const first = before.map((p) => view(p.item));
    // only the summary descriptor is canon: the item's time, place and kind become pins; its people stay contributions of the scene
    const canon = before[0]!;
    sim.k.summaries.makeItemCanon(canon.summary, canon.index, 'observed', H(hs('canoniser')));
    const count = emitted.length;
    sim.k.persistence.save('A');
    sim.advance(2);
    sim.k.persistence.load('A');
    expect(sim.k.store.localState(canon.item)).toBeGreaterThan(0);
    expect(sim.k.store.pinsOfNode(canon.item).length).toBeGreaterThan(0);
    new ReplayPort(sim).submit([{ t: sim.k.now, op: 'reading', node: 'v', slot: 'cell', value: 'c1' }]);
    sim.advance(3);
    for (const [i, p] of before.entries()) expect(view(p.item), `item ${i}`).toEqual(first[i]!);
    expect(sim.k.value(canon.item, 'participants#count')).toBe(first[0]!.participants.length);
    expect(emitted.length).toBe(count);
  });
});

describe('SF1-A-3: no catch-up, recorded demand', () => {
  test('an item is opened if and only if its cell was in the recorded focus of its own window: absent then present is never opened, present then absent is opened', () => {
    const { sim, port, c1 } = actsSim('SF1-A-3');
    const j = 100;
    port.submit([
      { t: (j - 1) * W + 5, op: 'reading', node: 'v', slot: 'cell', value: 'c3' },
      { t: (j + 1) * W + 5, op: 'reading', node: 'v', slot: 'cell', value: 'c1' },
      { t: (j + 4) * W + 5, op: 'reading', node: 'v', slot: 'cell', value: 'c3' },
    ]);
    // the recorded focus of every window, as the fine tier returned it
    const focus = new Map<number, Id[]>();
    const def = sim.defs.get('scene.acts')!;
    const original = def.run.bind(def);
    def.run = (pctx, k) => {
      const res = original(pctx, k);
      const state = (Array.isArray(res) ? undefined : res.state) as ActsState | undefined;
      if (state?.prev) focus.set(k, [...state.prev.cells]);
      return res;
    };
    sim.startAt(j);
    const windows = [0, 1, 2, 3, 4, 5, 6, 7];
    inject(sim, ...windows.map((n) => child(sim, `w${n}`, 0, j + n, 'theft', 1, c1)));
    sim.advance(12);
    const opened = new Set(actsState(sim).published.map((p) => p.w));
    const seen = windows.map((n) => ({ w: j + n, focused: (focus.get(j + n) ?? []).includes(c1), opened: opened.has(j + n) }));
    for (const x of seen) expect(x.opened, `window ${x.w}`).toBe(x.focused);
    // the fixture has every case: absent then present, present then absent
    expect(seen.some((x, i) => !x.focused && seen[i + 1]?.focused)).toBe(true);
    expect(seen.some((x, i) => x.focused && seen[i + 1] !== undefined && !seen[i + 1]!.focused && x.opened)).toBe(true);
    expect(seen.filter((x) => !x.focused).every((x) => !x.opened)).toBe(true);
    // a later arrival does not open what passed
    const before = [...opened].sort();
    port.submit([{ t: sim.k.now + 5, op: 'reading', node: 'v', slot: 'cell', value: 'c1' }]);
    sim.advance(6);
    expect([...new Set(actsState(sim).published.map((p) => p.w))].sort()).toEqual(before);
  });
});

describe('SF1-A-4: the gate', () => {
  const run = (name: string, before: (sim: Sim, c1: Id, j: number) => void) => {
    const { sim, emitted, port, c1 } = actsSim(name);
    const j = 100;
    port.submit([{ t: (j - 1) * W + 5, op: 'reading', node: 'v', slot: 'cell', value: 'c1' }]);
    sim.startAt(j);
    inject(sim, child(sim, 'g1', 0, j + 1, 'theft', 1, c1));
    const def = sim.defs.get('scene.acts')!;
    const original = def.run.bind(def);
    def.run = (pctx, k) => {
      if (k === j + 2) before(sim, c1, j + 1);
      return original(pctx, k);
    };
    sim.advance(5);
    return { sim, emitted, c1 };
  };

  test('a cast resolving to a minor in the role victim: the item stays unopened and floor-minor is logged', () => {
    const { sim, emitted } = run('SF1-A-4a', (sim) => {
      const minor = sim.w.districts[0]!.cellIds.flatMap((c) => sim.people.residentsOfBlock(c)).find((r) => sim.people.view(r)!.ageClass === 'minor')!;
      const adult = sim.w.districts[0]!.cellIds.flatMap((c) => sim.people.residentsOfBlock(c)).find((r) => sim.people.view(r)!.ageClass === 'adult')!;
      const cast = sim.casting.cast.bind(sim.casting);
      sim.casting.cast = (d) => (d.kind === 'theft' ? [{ role: 'aggressor', who: adult }, { role: 'victim', who: minor }] : cast(d));
    });
    expect(actsState(sim).published).toEqual([]);
    expect(emitted).toEqual([]);
    const gate = sim.record.log.filter((e) => e.proc === 'scene.acts' && e.kind === 'gate');
    expect(gate.map((e) => e.reason)).toEqual(['floor-minor']);
  });

  test('a person who became protected between occurrence and opening: the item stays unopened and protected is logged', () => {
    const { sim, emitted } = run('SF1-A-4b', (sim, c1, w) => {
      const S = summaryOf(w, c1);
      const entry = sim.ringEntry(S)!;
      const d = itemDescriptor(sim, S, 0, w, c1, 'theft', entry.meta![0]!);
      const cast = sim.casting.cast(d);
      if (cast === 'no-cast') throw new Error('the item has no cast');
      const victim = cast.find((e) => e.role === 'victim')!.who!;
      // the occurrence is before the edge; the opening is after it
      const seed = sim.k.root('live-seed-a4', 'core:seed');
      sim.k.retention.setSeed({ id: seed, state: {}, nodes: [victim] });
      sim.k.addEdge({ type: 'core:cast', from: seed, to: victim, data: { role: 'witness' }, cause: seed, valid: { from: d.time + 1 } });
      expect(sim.people.protectedAt(victim, d.time)).toBe(false);
      expect(sim.people.protectedSet(victim)).toBe(true);
    });
    expect(actsState(sim).published).toEqual([]);
    expect(emitted).toEqual([]);
    expect(sim.record.log.filter((e) => e.proc === 'scene.acts' && e.kind === 'gate').map((e) => e.reason)).toEqual(['protected']);
  });
});

describe('SF1-A-5: coarse against detail', () => {
  test('the items in focus, opened or not, against the summary\'s count; twin runs with V in different cells: equal counts, identical tier 0 to 2 outputs, only scene.acts differs', () => {
    const make = (vCell: string) => {
      const sim = Sim.create({ worldSeed: seedOf('SF1-A-5'), index: fx3Slice(), data: fxData((d) => { for (const k of Object.keys(d.shape.rate)) d.shape.rate[k] = d.shape.rate[k]!.map((x) => x * 40) as [number, number, number, number]; }), only: ['city.events', 'order.stocks', 'order.norms', 'group.decide', 'scene.acts'] });
      new ReplayPort(sim).submit([{ t: 0, op: 'reading', node: 'v', slot: 'cell', value: vCell }]);
      sim.advance(FULL ? 60 : 36);
      return sim;
    };
    const a = make('c1');
    const b = make('c3');
    for (const id of ['city.events', 'order.stocks', 'order.norms', 'group.decide']) {
      expect(b.stateOf(id)).toEqual(a.stateOf(id));
      expect(b.digestOf(id)).toEqual(a.digestOf(id));
    }
    expect(b.stateOf('scene.acts')).not.toEqual(a.stateOf('scene.acts'));
    // equal counts: every summary's count is its ring count, whether its items were opened or not
    let opened = 0;
    for (const e of (a.stateOf<EventsState>('city.events')!).ring) {
      if (e.count === undefined) continue;
      expect(a.k.value(e.id, 'count')).toBe(e.count);
      expect(b.k.value(e.id, 'count')).toBe(e.count);
      opened += actsState(a).published.filter((p) => p.summary === e.id).length;
    }
    expect(opened).toBe(actsState(a).published.length);
    expect(actsState(a).published.length).toBeGreaterThan(0);
    for (const p of actsState(a).published) expect([p.cell]).toEqual([a.w.districts[0]!.cellIds[0]!]);
    // V's neighbours are watched but not opened
    expect(actsState(b).published.every((p) => p.cell === b.w.districts[0]!.cellIds[2]!)).toBe(true);
    void H;
    void hs;
  }, 300_000);
});
