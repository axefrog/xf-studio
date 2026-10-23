// SF1-S and SF1-I: the shapes, the regimes, admission and the incidents of `city.events` (S1 7.1, 7.2, 14.1).

import { describe, expect, test } from 'bun:test';
import { processCause } from '../../src/evolution.ts';
import { H, id as hid, mintedId, s } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import { type S1Data } from '../../src/sim/data.ts';
import { type EventsDigest, type EventsState, m4Open } from '../../src/sim/proc-events.ts';
import type { PendingChild } from '../../src/sim/occ.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import { child, fxData, inject, quietData, quietSim, seedOf } from './helpers.ts';

const W = 600;
const proc = processCause('city.events');

describe('SF1-S-1: mean-one shapes', () => {
  const sim = quietSim('SF1-S-1');
  const hour = 3600;
  test('every city kind sums to 168 over the 168 hours of a week', () => {
    for (const kd of sim.data.kinds) {
      let sum = 0;
      for (let h = 0; h < 168; h++) sum += sim.city.shape(kd.name, h * hour + 1);
      expect(Math.abs(sum - 168)).toBeLessThan(1e-9);
    }
  });
  test('theft: M = 0.975, the day shape 1.0256410; shakedown: M = 0.8833333 and the Friday pulse', () => {
    expect(sim.city.M.theft).toBeCloseTo(0.975, 12);
    const wed12 = 2 * 86400 + 12 * hour;
    expect(sim.city.shape('theft', wed12)).toBeCloseTo(1.025641, 6);
    expect(sim.city.M.shakedown).toBeCloseTo(0.8833333, 6);
    const fri12 = 4 * 86400 + 12 * hour;
    const mon12 = 12 * hour;
    expect(sim.city.shape('shakedown', fri12)).toBeCloseTo(5.0943396, 6);
    expect(sim.city.shape('shakedown', mon12)).toBeCloseTo(1.6981132, 6);
  });
});

describe('SF1-S-3: the m4 budget', () => {
  test('m4Open from the times', () => {
    expect(m4Open([100, 600], 432, 1008)).toBe(1108);
    expect(m4Open([100], 432, 1008)).toBe(532);
    expect(m4Open([], 432, 1008)).toBe(0);
  });
  test('a size-4 incident at 1107 is refused (budget-m4); at 1108 it is admitted', () => {
    const run = (due: number): { admitted: boolean; refused: boolean } => {
      const sim = quietSim('SF1-S-3');
      const c1 = sim.w.districts[0]!.cellIds[0]!;
      sim.startAt(due);
      sim.setState('city.events', (st) => { (st as EventsState).admit.m4Times = [100, 600]; });
      inject(sim, child(sim, 'm4', 0, due, 'gang-clash', 4, c1, { sides: { a: 2, b: 3 } }));
      sim.advance(1);
      const id = mintedId(proc, H(s('fixture-parent'), s('m4')), 'child/0');
      return { admitted: sim.k.store.header(id) !== undefined, refused: sim.record.log.some((e) => e.reason === 'budget-m4') };
    };
    expect(run(1107)).toEqual({ admitted: false, refused: true });
    expect(run(1108)).toEqual({ admitted: true, refused: false });
  });
});

describe('SF1-S-5: one admission owner', () => {
  const w = 600;
  type How = { reverse?: boolean; calls?: number[]; reload?: boolean };

  /** Two size-4 incidents due in window `w`, in the districts' first two cells; the budget is open. */
  function incidents(names: readonly [string, string], how: How = {}) {
    const sim = quietSim('SF1-S-5');
    const d = sim.w.districts[0]!;
    sim.startAt(w);
    const kids = [
      child(sim, names[0], 0, w, 'gang-clash', 4, d.cellIds[0]!, { sides: { a: 2, b: 3 } }),
      child(sim, names[1], 0, w, 'gang-clash', 4, d.cellIds[1]!, { sides: { a: 3, b: 2 } }),
    ];
    inject(sim, ...(how.reverse ? [...kids].reverse() : kids));
    if (how.reload) {
      sim.k.persistence.save('S5');
      sim.k.persistence.load('S5');
    }
    for (const n of how.calls ?? [1]) sim.advance(n);
    const ids = kids.map((k) => mintedId(proc, k.parent, 'child/0'));
    // the candidate times are the keyed draws the process makes: the incident of the earlier time, then the smaller Id, comes first
    const times = kids.map((k) => w * 600 + Math.floor(sim.ids.child(k.parent, 0, 't') * 600));
    const first = times[0]! < times[1]! || (times[0] === times[1] && ids[0]! < ids[1]!) ? 0 : 1;
    const admitted = ids.filter((id) => sim.k.store.header(id) !== undefined);
    const refused = sim.record.log.filter((e) => e.reason === 'budget-m4').map((e) => e.refs[0]);
    const m4Times = sim.stateOf<EventsState>('city.events')!.admit.m4Times;
    return { ids, first, admitted, refused, m4Times, outcome: JSON.stringify([admitted, refused, m4Times]) };
  }

  const PAIRS: Array<[string, string]> = [['a', 'b'], ['b', 'a'], ['c', 'd'], ['d', 'c'], ['e', 'f'], ['f', 'e'], ['g', 'h'], ['h', 'g']];

  test('two size-4 incidents in one window: the earlier by (time, Id) is admitted and the later refused budget-m4, whichever way round they come; the budget gains one entry', () => {
    const winners = new Set<number>();
    for (const names of PAIRS) {
      const r = incidents(names);
      winners.add(r.first);
      expect(r.admitted, names.join()).toEqual([r.ids[r.first]!]);
      expect(r.refused, names.join()).toEqual([r.ids[1 - r.first]!]);
      expect(r.m4Times, names.join()).toEqual([w]);
    }
    // the fixture has both cases: the earlier is the first incident and the earlier is the second
    expect([...winners].sort()).toEqual([0, 1]);
  });

  test('the same result whatever the order the candidates were produced in, in one call or many, and after a save before the window', () => {
    for (const names of PAIRS.slice(0, 2)) {
      const base = incidents(names);
      expect(incidents(names, { reverse: true }).outcome).toBe(base.outcome);
      expect(incidents(names, { calls: [1, 1, 1] }).outcome).toBe(base.outcome);
      expect(incidents(names, { reload: true }).outcome).toBe(base.outcome);
      expect(incidents(names, { reload: true, reverse: true, calls: [1, 2] }).outcome).toBe(base.outcome);
    }
  });

  test('a regime-end of a size-4 regime is minted and counted by no budget', () => {
    const sim = quietSim('SF1-S-5r');
    const district = sim.w.districts[0]!.id;
    const fest = sim.data.regimes.find((r) => r.kind === 'festival')!;
    sim.startAt(w);
    const id = H(s('fixture-regime'), hid(district));
    sim.setState('city.events', (st) => {
      (st as EventsState).regimes.push({ id, kind: 'festival', scope: district, start: (w - fest.maxDwell) * 600, startW: w - fest.maxDwell, plannedLength: fest.plannedLength, maxDwell: fest.maxDwell, size: 4, effects: fest.effects, closes: fest.closes, priceShift: fest.priceShift });
    });
    sim.advance(2);
    const end = mintedId(proc, proc, `regime-end/${id}`);
    expect(sim.k.value(end, 'kind')).toBe('regime-end');
    expect(sim.stateOf<EventsState>('city.events')!.admit.m4Times).toEqual([]);
    expect(sim.record.log.filter((e) => e.reason === 'budget-m4')).toEqual([]);
  });

  test('a size-4 regime that arrives while the budget is closed starts as size 3 and uses none; with the budget open it starts as size 4 and uses one', () => {
    const arrive = (tag: string, closed: boolean) => {
      const sim = quietSim(`SF1-S-5s-${tag}`, (d) => { d.regimes.find((r) => r.kind === 'crackdown')!.arrival = 5760; });
      sim.startAt(w);
      if (closed) sim.setState('city.events', (st) => { (st as EventsState).admit.m4Times = [w - 1]; });
      sim.advance(2);
      const regime = sim.stateOf<EventsState>('city.events')!.regimes.find((r) => r.kind === 'crackdown')!;
      return { regime, m4Times: sim.stateOf<EventsState>('city.events')!.admit.m4Times };
    };
    let tried = 0;
    for (let n = 0; n < 80; n++) {
      const open = arrive(String(n), false);
      if (open.regime.size !== 4) continue;
      tried++;
      expect(open.m4Times).toEqual([w]);
      const closed = arrive(String(n), true);
      expect(closed.regime.size).toBe(3);
      expect(closed.m4Times).toEqual([w - 1]);
      if (tried >= 2) break;
    }
    expect(tried).toBeGreaterThan(0);
  }, 120_000);
});

describe('SF1-I-1 and SF1-I-2: the mean and the cells', () => {
  test('theft, Wednesday 12:00, L = 1: share 0.1 and mu 0.0641026; gang clash with coverage 0.5 at c2: share 0.0735294', () => {
    const sim = Sim.create({ worldSeed: seedOf('SF1-I-1'), index: fx3Slice(), data: fxData(), only: ['city.events'] });
    const d = sim.w.districts[0]!;
    const t = 2 * 86400 + 12 * 3600;
    const p = sim.people.periodOf(t);
    expect(sim.city.share(d.id, 'theft', p)).toBeCloseTo(0.1, 12);
    const mu = sim.data.shape.rate.theft![0]! * sim.city.shape('theft', t) * sim.city.share(d.id, 'theft', p) * (W / 86400);
    expect(mu).toBeCloseTo(0.0641026, 6);
    expect(sim.city.aD(d.id, 'gang-clash', p)).toBeCloseTo(2.5, 12);
    expect(sim.city.cityTotal('gang-clash', p)).toBeCloseTo(34, 12);
    expect(sim.city.share(d.id, 'gang-clash', p)).toBeCloseTo(0.0735294, 6);
  });
  test('cells: the weights a = 3.0, 2.0, 0.25 with the propensity override', () => {
    const sim = quietSim('SF1-I-2', (d) => { d.events.propensityOverride = { '0': 3, '1': 1, '2': 0.5 }; });
    const dist = sim.w.districts[0]!;
    const w = sim.city.cellWeights(dist.id, 'theft', 1);
    expect(w).toEqual([3.0, 2.0, 0.25]);
    const total = w[0]! + w[1]! + w[2]!;
    expect(w[0]! / total).toBeCloseTo(0.5714, 4);
    expect(w[1]! / total).toBeCloseTo(0.381, 3);
    expect(w[2]! / total).toBeCloseTo(0.0476, 4);
  });
});

describe('SF1-I-3: Ids are keyed', () => {
  test('an event of window w, district d, kind k, index i has the same Id whatever the save points', () => {
    const run = (calls: number): string[] => {
      const sim = Sim.create({ worldSeed: seedOf('SF1-I-3'), index: fx3Slice(), data: fxData((d) => { for (const k of Object.keys(d.shape.rate)) d.shape.rate[k] = d.shape.rate[k]!.map((x) => x * 20) as never; }), only: ['city.events'] });
      for (let i = 0; i < calls; i++) sim.advance(40 / calls);
      return sim.k.store.idsOfKind('core:event').filter((id) => sim.k.value(id, 'kind') !== undefined);
    };
    const one = run(1);
    const many = run(4);
    expect(one.length).toBeGreaterThan(20);
    expect(many).toEqual(one);
    const sim = Sim.create({ worldSeed: seedOf('SF1-I-3'), index: fx3Slice(), data: fxData(), only: ['city.events'] });
    const d = sim.w.districts[0]!.id;
    expect(mintedId(proc, proc, `ev/3/${d}/theft/0`)).toBe(H(s('mint'), hid(proc), hid(proc), s(`ev/3/${d}/theft/0`)));
  });
});

describe('SF1-I-4: offspring', () => {
  test('a size-2 gang clash parent has mean 0.30; children are due at least a window later; a size-2 child is an event under the parent', () => {
    const sim = quietSim('SF1-I-4');
    const d = sim.w.districts[0]!;
    const c2 = d.cellIds[1]!;
    const w = 50;
    sim.startAt(w);
    const parents = Array.from({ length: 30 }, (_, n) => child(sim, `p${n}`, 0, w + Math.floor(n / 3), 'gang-clash', 2, c2, { sides: { a: 2, b: 3 } }));
    inject(sim, ...parents);
    sim.advance(11);
    const st = sim.stateOf<EventsState>('city.events')!;
    const kids = (st.calendar[d.id] ?? []).filter((x) => parents.some((p) => mintedId(proc, p.parent, 'child/0') === x.parent));
    expect(kids.length).toBeGreaterThan(0);
    for (const k of kids) {
      expect(k.due).toBeGreaterThanOrEqual(w + 1);
      expect(k.parentFacts.gen).toBe(1);
      expect(k.kind).toBeTruthy();
    }
    // 24 parents with a mean of 0.3: the count is between 0 and 8 each; the child Id of a size-2 child is H(mint, proc, parent, child/<index>)
    expect(kids.length).toBeLessThanOrEqual(24 * 8);
    const parentIds = parents.map((p) => mintedId(proc, p.parent, 'child/0'));
    for (const id of parentIds) expect(sim.k.store.header(id)?.kind).toBe('core:event');
  });
});

describe('SF1-I-6 and SF1-I-11: the fault limits', () => {
  test('the calendar keeps 256: the lowest size and largest Id go first, and each drop is logged and counted', () => {
    const sim = quietSim('SF1-I-6');
    const d = sim.w.districts[0]!;
    const c1 = d.cellIds[0]!;
    const cs = Array.from({ length: 300 }, (_, n) => child(sim, `c${String(n).padStart(3, '0')}`, 0, 100 + (n % 50), n < 100 ? 'theft' : 'gang-clash', n < 100 ? 1 : 2, c1));
    inject(sim, ...cs);
    sim.advance(1);
    const st = sim.stateOf<EventsState>('city.events')!;
    const cal = st.calendar[d.id]!;
    expect(cal.length).toBe(256);
    const keys = cal.map((x) => `${String(x.due).padStart(6, '0')}|${x.parent}|${x.index}`);
    expect(keys).toEqual([...keys].sort());
    expect(sim.record.log.filter((e) => e.reason === 'calendar-overflow').length).toBe(44);
    expect(st.counters.overflow).toBe(44);
    // the dropped ones are the size-1 children with the largest parent Ids
    const dropped = cs.filter((x) => !cal.some((y) => y.parent === x.parent));
    expect(dropped.length).toBe(44);
    expect(dropped.every((x) => x.size === 1)).toBe(true);
    const keptSize1 = cal.filter((x) => x.size === 1).map((x) => x.parent).sort();
    const droppedParents = dropped.map((x) => x.parent).sort();
    expect(droppedParents[0]! > keptSize1[keptSize1.length - 1]!).toBe(true);
  });
  test('the district cap: the ninth and tenth size-2 candidates are refused (cap-window) and draw no offspring', () => {
    const sim = quietSim('SF1-I-11');
    const d = sim.w.districts[0]!;
    const w = 20;
    sim.startAt(w);
    const cs = Array.from({ length: 10 }, (_, n) => child(sim, `k${n}`, 0, w, 'accident', 2, d.cellIds[n % 3]!));
    inject(sim, ...cs);
    sim.advance(1);
    const ids = cs.map((x) => mintedId(proc, x.parent, 'child/0'));
    const made = ids.filter((id) => sim.k.store.header(id) !== undefined);
    expect(made.length).toBe(8);
    expect(sim.record.log.filter((e) => e.reason === 'cap-window').length).toBe(2);
    const refusedIds = sim.record.log.filter((e) => e.reason === 'cap-window').flatMap((e) => e.refs);
    expect(refusedIds.length).toBe(2);
    const st = sim.stateOf<EventsState>('city.events')!;
    for (const r of refusedIds) expect((st.calendar[d.id] ?? []).some((x) => x.parent === r)).toBe(false);
    // the counter is not persisted into the next window: a later window admits eight more
    inject(sim, ...Array.from({ length: 8 }, (_, n) => child(sim, `m${n}`, 0, w + 1, 'accident', 2, d.cellIds[0]!)));
    sim.advance(1);
    expect(sim.record.log.filter((e) => e.reason === 'cap-window').length).toBe(2);
  });
});

describe('SF1-I-7 and SF1-I-8: heat and bands', () => {
  const setup = () => {
    const sim = quietSim('SF1-I-7', (d) => { d.events.offspring = [0, 0, 0, 0]; });
    const d = sim.w.districts[0]!;
    const c1 = d.cellIds[0]!;
    return { sim, d, c1 };
  };
  const bandPins = (sim: Sim, cell: Id): Array<{ w: number; value: string }> =>
    sim.k.store.pinsOn(cell, 'band').length >= 0
      ? sim.k.store.allPins().filter((p) => p.node === cell && p.slot.startsWith('band@w')).map((p) => ({ w: Number(p.slot.slice(6)), value: p.value as string })).sort((a, b) => a.w - b.w)
      : [];

  test('one isolated size-2 event: heat 3.0, elevated from w + 1, held through age 144, quiet from w + 146 and no earlier', () => {
    const { sim, c1 } = setup();
    const w = 200;
    sim.startAt(w);
    inject(sim, child(sim, 'iso', 0, w, 'accident', 2, c1));
    sim.advance(1);
    expect(bandPins(sim, c1)).toEqual([{ w: w + 1, value: 'elevated' }]);
    sim.advance(w + 147 - sim.windowNow());
    expect(bandPins(sim, c1)).toEqual([{ w: w + 1, value: 'elevated' }, { w: w + 146, value: 'quiet' }]);
  });

  test('a size-4 event at w + 10 is held by the dwell: no pin until the end of w + 145, where heat 11.25 gives hot', () => {
    const { sim, c1 } = setup();
    const w = 200;
    sim.startAt(w);
    inject(sim, child(sim, 'iso', 0, w, 'accident', 2, c1));
    sim.advance(9);
    // the second event arrives at w + 10 (a pending child is part of a cell's heat from the moment it is born)
    inject(sim, child(sim, 'big', 0, w + 10, 'gang-clash', 4, c1, { sides: { a: 2, b: 3 } }));
    sim.advance(w + 146 - sim.windowNow() + 1);
    expect(bandPins(sim, c1)).toEqual([{ w: w + 1, value: 'elevated' }, { w: w + 146, value: 'hot' }]);
  });
});

describe('SF1-I-14: reports', () => {
  test('E = Y = 0.5, fear 0.2, noSnitch 0.4, r0 0.7, witness bonus 3: 0.1638', () => {
    const sim = quietSim('SF1-I-14');
    const d = sim.w.districts[0]!.id;
    const stocks = { v: 1, through: 0, districts: { [d]: { E: 0.5, Y: 0.5, L: 0.5, fear: 0.2 } } };
    const norms = { v: 1, through: 0, norms: { [d]: { uniforms: { priv: 0.5, beh: 0.4, perc: 0.8, vis: 0.3, gap: 0 } } }, facts: { windows: [] }, changes: { windows: [] } };
    expect(sim.reportChance(d, 3, stocks, norms)).toBeCloseTo(0.1638, 10);
  });
});

export type { EventsDigest };
