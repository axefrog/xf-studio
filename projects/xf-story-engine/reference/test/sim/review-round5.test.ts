import { expect, test, setDefaultTimeout } from 'bun:test';
import { H, s } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import { reevaluate } from '../../src/seeding/run.ts';
import { ScriptPort } from '../../src/seeding/port.ts';
import { attachLayer2 } from '../../src/sim/layer2-wire.ts';
import type { EventsDigest, EventsState } from '../../src/sim/proc-events.ts';
import { miniPack, MINI_ID } from '../s2/mini.ts';
import { quietSim } from './helpers.ts';

setDefaultTimeout(120_000);

function pairs(sim: ReturnType<typeof quietSim>): Array<[Id, Id]> {
  const residents = sim.w.districts[0]!.cellIds.flatMap((c) => sim.people.residentsOfBlock(c));
  const out: Array<[Id, Id]> = [];
  for (const a of residents) {
    const b = residents.find((b) => b !== a && sim.ties.tie(a, b)?.tied === false && !out.some((p) => p.includes(a) || p.includes(b)));
    if (b) out.push([a, b]);
    if (out.length === 2) return out;
  }
  throw new Error('fixture needs two independent non-implicit ties');
}

function window(sim: ReturnType<typeof quietSim>, all: unknown[]) {
  const l2 = attachLayer2(sim, { port: new ScriptPort(), facts: { flag: {}, x: {} } });
  const pack = miniPack({}, { windows: [{ id: 'w', opens: 'yes', closes: { all } as never, onClose: 'withdraw' }] });
  expect(l2.installPack(pack)).toEqual([]);
  const sown = l2.sow(pack.id, MINI_ID);
  expect(sown.ok, JSON.stringify(sown)).toBe(true);
  sim.k.settle();
  return { l2, instance: sown.instance! };
}

for (const reload of [false, true]) test(`A2-01: reopening in the opening second preserves the closing latch (reload=${reload})`, () => {
  const sim = quietSim('A2-01');
  const [a, b] = pairs(sim) as [[Id, Id], [Id, Id]];
  sim.advance(1);
  const { l2, instance } = window(sim, [
    { social: { tied: { a: a[0], b: a[1], type: 'xf:tie' } }, is: ['no'] },
    { social: { tied: { a: b[0], b: b[1], type: 'xf:tie' } }, is: ['yes'] },
  ]);
  sim.advance(1);
  expect(sim.k.now).toBe(1200);
  const edge = sim.tiePolicy.materialise(...a)!;
  sim.tiePolicy.materialise(...b);
  sim.k.endEdge(edge.id);
  if (reload) {
    sim.k.persistence.save('between'); sim.k.persistence.load('between');
    pairs(sim);
  }
  sim.tiePolicy.materialise(...a);
  const inst = l2.instance(instance)!;
  reevaluate(l2, inst, [{ time: 1200, reason: 'test', change: { c: 'reading', node: a[0], slot: 'alive', at: 1200, new: 'yes' } }]);
  expect(inst.st.latches, 'A2-01 semantic: the real A=no and B=yes interval must latch').toEqual(['w']);
  const expected: Array<{ t: number; value: 'yes' | 'no'; ord: number }> = [{ t: 1200, value: 'yes', ord: 0 }, { t: 1200, value: 'no', ord: 2 }, { t: 1200, value: 'yes', ord: 3 }];
  expect(sim.tiePolicy.transitionsOf(...a)).toEqual(expected);
  expect(sim.record.ord).toBe(4);
  for (let n = 0; n < 65; n++) sim.k.updateEdge(edge.id, { attrs: { lastContact: n } });
  expect(sim.tiePolicy.transitionsOf(...a)).toEqual(expected);
  expect(sim.record.ord).toBe(4);
  sim.k.persistence.save('after'); sim.k.persistence.load('after');
  pairs(sim);
  expect(sim.tiePolicy.transitionsOf(...a)).toEqual(expected);
  expect(sim.record.ord).toBe(4);
  sim.k.endEdge(edge.id, 6000);
  sim.k.persistence.save('scheduled'); sim.k.persistence.load('scheduled');
  pairs(sim);
  sim.k.endEdge(edge.id, 1500);
  sim.k.updateEdge(edge.id, { attrs: { lastContact: 100 } });
  const shortened: typeof expected = [...expected, { t: 1500, value: 'no', ord: 5 }];
  expect(sim.tiePolicy.transitionsOf(...a)).toEqual(shortened);
  sim.advance(1);
  sim.k.persistence.save('shortened'); sim.k.persistence.load('shortened');
  pairs(sim);
  expect(sim.tiePolicy.transitionsOf(...a)).toEqual(shortened);
  expect(sim.record.ord).toBe(6);
});

function expiringRegimes(two = false) {
  const sim = quietSim('A2-02');
  const district = sim.w.districts[0]!.id;
  const ids = [H(s('lockdown-expiry-a')), H(s('lockdown-expiry-b'))].sort();
  sim.setState('city.events', (st) => {
    (st as EventsState).regimes = (two ? ['lockdown', 'festival'] : ['lockdown']).map((kind, i) => {
      const r = sim.data.regimes.find((r) => r.kind === kind)!;
      return { id: ids[i]!, kind, scope: district, start: 0, startW: 0, plannedLength: 100, maxDwell: 2, size: i === 0 ? 4 : 3, effects: r.effects, closes: r.closes, priceShift: r.priceShift };
    });
  });
  sim.advance(1);
  expect(sim.reads.eval('regime', [district])).toBe('lockdown');
  expect(sim.reads.eval('priceLevel', [district])).toBe('high');
  return { sim, district };
}

for (const reload of [false, true]) test(`A2-02: lockdown expiry publishes regime and price atomically (reload=${reload})`, () => {
  const { sim, district } = expiringRegimes();
  const { l2, instance } = window(sim, [
    { city: { regime: { scope: district } }, is: ['none'] },
    { city: { priceLevel: { district } }, is: ['high'] },
  ]);
  sim.advance(1);
  // Window 2 has computed the expiry at 1200; its feed is still unpublished.
  const pending = sim.k.evolution.states.get('city.events')!.outstanding[0]!.digest as EventsDigest;
  expect(pending.changes.windows.find((w) => w.w === 2)!.items.filter((tr) => tr.t === 1200).map((tr) => tr.ord)).toEqual([undefined, undefined]);
  if (reload) { sim.k.persistence.save('pending'); sim.k.persistence.load('pending'); }
  sim.advance(1);
  sim.k.settle();
  expect(l2.instance(instance)!.st.latches, 'A2-02 semantic: none/high never held during lockdown expiry').toEqual([]);
  const port = sim.reads.port();
  const reads = () => [port.transitions('regime', [district], 1199, 1200), port.transitions('priceLevel', [district], 1199, 1200)];
  const expected = [[{ t: 1199, value: 'lockdown' }, { t: 1200, value: 'none', ord: 0 }], [{ t: 1199, value: 'high' }, { t: 1200, value: 'fair', ord: 0 }]];
  expect(reads()).toEqual(expected);
  expect(port.transitions('regimeIs', [district, 'none'], 1199, 1200)[1]!.ord).toBe(0);
  expect(sim.record.ord).toBe(1);
  sim.k.persistence.save('published'); sim.k.persistence.load('published');
  expect(reads()).toEqual(expected);
  expect(sim.record.ord).toBe(1);
  sim.advance(1);
  expect(reads()).toEqual(expected);
  expect(sim.record.ord).toBe(1);
});

for (const reload of [false, true]) test(`A2-02b: separate same-second regime expiries retain separate ordinals (reload=${reload})`, () => {
  const { sim, district } = expiringRegimes(true);
  const { l2, instance } = window(sim, [
    { city: { regime: { scope: district } }, is: ['festival'] },
    { city: { priceLevel: { district } }, is: ['fair'] },
  ]);
  sim.advance(1);
  if (reload) { sim.k.persistence.save('pending'); sim.k.persistence.load('pending'); }
  sim.advance(1);
  sim.k.settle();
  expect(l2.instance(instance)!.st.latches, 'A2-02b semantic: the state between independent expiries must latch').toEqual(['w']);
  const port = sim.reads.port();
  const regimes = port.transitions('regime', [district], 1199, 1200);
  const price = port.transitions('priceLevel', [district], 1199, 1200);
  expect(regimes, 'A2-02b semantic: independent expiries must keep separate source ordinals').toEqual([{ t: 1199, value: 'lockdown' }, { t: 1200, value: 'festival', ord: 0 }, { t: 1200, value: 'none', ord: 1 }]);
  expect(price, 'A2-02b semantic: the price change must share its own expiry ordinal').toEqual([{ t: 1199, value: 'high' }, { t: 1200, value: 'fair', ord: 0 }]);
  expect(sim.record.ord).toBe(2);
});
