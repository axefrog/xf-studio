// SF1-N, SF1-O: the norms and the stocks (S1 7.5, 7.6, 14.1).

import { describe, expect, test } from 'bun:test';
import { H, id as hid, rand, s as hs, i as hi } from '../../src/id.ts';
import { processCause } from '../../src/evolution.ts';
import type { Id } from '../../src/types.ts';
import { relax, gapBand, residentType, castEnforcement, type NormsState, type NormsDigest, type NormSlots } from '../../src/sim/proc-norms.ts';
import { stockRows, type StocksState, type StocksDigest } from '../../src/sim/proc-stocks.ts';
import type { EventFact } from '../../src/sim/occ.ts';
import { ReplayPort } from '../../src/sim/port.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import { type S1Data } from '../../src/sim/data.ts';
import { fxData, quietData, seedOf } from './helpers.ts';

const W = 600;

const norm = (sim: Sim, id = 'fee') => sim.data.norms.norms.find((n) => n.id === id)!;
const slots = (over: Partial<NormSlots> = {}): NormSlots => ({ priv: 0.7, beh: 0.5, perc: 0.8, qe: 0.5, qn: 0.8, pub: [], gap: 0, gapSince: 0, ...over });

function normsSim(name: string, tweak: (d: S1Data) => void = () => {}, only = ['order.norms']): Sim {
  return Sim.create({ worldSeed: seedOf(name), index: fx3Slice(), data: quietData(tweak), only });
}

describe('SF1-N-1: a window\'s update', () => {
  const sim = normsSim('SF1-N-1');
  const fee = norm(sim);
  test('(a) no signal: beh 0.625, perc 0.78985', () => {
    const s = slots();
    relax(s, fee, 10, 0);
    expect(s.beh).toBe(0.625);
    expect(s.perc).toBeCloseTo(0.78985, 10);
  });
  test('(b) a public signal of 0.9 acting in this window (phi 0.6): beh 0.625, qe 0.79, perc 0.79942', () => {
    const s = slots({ signal: { value: 0.9, event: H(hs('e')), from: 10 } });
    relax(s, fee, 10, 0);
    expect(s.beh).toBe(0.625);
    expect(s.qe).toBeCloseTo(0.79, 12);
    expect(s.perc).toBeCloseTo(0.79942, 10);
  });
});

describe('SF1-N-2 and SF1-N-5: the gap band and the endpoints', () => {
  const sim = normsSim('SF1-N-2');
  const fee = norm(sim);
  test('gap 0.31, 0.27, 0.24, 0.09, 0.07: wide, wide, gap, gap, aligned; a pin only at 0.31, 0.24 and 0.07', () => {
    let band: 0 | 1 | 2 = 0;
    const out: number[] = [];
    const changed: number[] = [];
    for (const g of [0.31, 0.27, 0.24, 0.09, 0.07]) {
      const next = gapBand(band, g, fee);
      if (next !== band) changed.push(g);
      band = next;
      out.push(band);
    }
    expect(out).toEqual([2, 2, 1, 1, 0]);
    expect(changed).toEqual([0.31, 0.24, 0.07]);
  });
  test('zero compliance is absorbing and full compliance stays 1, before any tuning', () => {
    const z = slots({ beh: 0, perc: 0, qe: 0, qn: 0 });
    for (let w = 0; w < 50; w++) relax(z, fee, w, 0);
    expect(z.beh).toBe(0);
    expect(z.perc).toBe(0);
    const o = slots({ beh: 1, perc: 1, qe: 1, qn: 1 });
    for (let w = 0; w < 50; w++) relax(o, fee, w, fee.visBase);
    expect(o.beh).toBe(1);
    expect(o.perc).toBe(1);
  });
});

describe('SF1-N-3: enforcement', () => {
  test('fee, beh 0.875, enforcer share 0.10: mu = 0.0026042; each use is an event of kind enf.fee.<rung> through the gate; a rung at ceiling 0 is never drawn', () => {
    const sim = normsSim('SF1-N-3');
    const d = sim.w.districts[0]!;
    const mu = 3 * (W / 86400) * (1 - 0.875) * Math.min(1, 0.1 / 0.05);
    expect(mu).toBeCloseTo(0.0026042, 6);
    // a norm that enforces often, with the sanction classes excluded by the player
    const busy = normsSim('SF1-N-3b', (x) => { for (const n of x.norms.norms) { n.enforcePerDay = 4000; n.beh0 = 0.1; n.priv0 = 0.1; } });
    busy.k.settings.set({ classExclusions: ['harm.sanction'] }, 0);
    busy.advance(60);
    const events = busy.k.store.idsOfKind('core:event').map((id) => busy.k.value(id, 'kind')).filter((x): x is string => typeof x === 'string' && x.startsWith('enf.'));
    expect(events.length).toBeGreaterThan(5);
    for (const kind of events) expect(['enf.fee.word', 'enf.fee.fine', 'enf.uniforms.word']).toContain(kind);
    void d;
  });
});

describe('SF1-N-4 and SF1-N-6: public against private; each signal once', () => {
  const run = (name: string, lines: 'public' | 'private' | 'none', calls: number) => {
    const sim = normsSim(name, (x) => { for (const n of x.norms.norms) { n.enforcePerDay = 0; n.visBase = 0; } });
    const port = new ReplayPort(sim);
    const t = 300 * 0 + 5 * W + 100;
    if (lines !== 'none') {
      port.submit([
        { t: 0, op: 'person', key: 'gangster', slots: { affiliation: 'GA', alive: 'yes', 'age-class': 'adult' } },
        { t: 0, op: 'person', key: 'vendor', slots: { affiliation: 'civilian', alive: 'yes', 'age-class': 'adult' } },
        { t, op: 'event', kind: 'enf.fee.word', place: 'c1', participants: [{ who: 'gangster', role: 'enforcer' }, { who: 'vendor', role: 'target' }], witnesses: lines === 'public' ? 6 : 3 },
      ]);
    }
    for (let i = 0; i < calls; i++) sim.advance(12 / calls);
    return { sim, perc: sim.stateOf<NormsState>('order.norms')!.slots, d: sim.w.districts[0]!.id };
  };
  test('the private run equals the none run exactly; the public run differs; each is identical in 12 calls and in one', () => {
    const none = run('SF1-N-4', 'none', 1);
    const priv = run('SF1-N-4', 'private', 1);
    const pub = run('SF1-N-4', 'public', 1);
    const key = `${pub.d}|fee`;
    expect(priv.perc[key]).toEqual({ ...none.perc[key]!, pub: none.perc[key]!.pub });
    expect(priv.perc[key]!.perc).toBe(none.perc[key]!.perc);
    expect(pub.perc[key]!.perc).not.toBe(none.perc[key]!.perc);
    expect(run('SF1-N-4', 'public', 12).perc[key]).toEqual(pub.perc[key]!);
    expect(run('SF1-N-4', 'private', 12).perc[key]!.perc).toBe(priv.perc[key]!.perc);
  });
  test('an external public event is taken once: its signal acts from the window it is found, and a later window does not take it again', () => {
    const { sim, d } = run('SF1-N-6', 'public', 1);
    const st = sim.stateOf<NormsState>('order.norms')!;
    expect(st.slots[`${d}|fee`]!.signal?.from).toBe(6);
    expect(st.seen.length).toBe(1);
    sim.advance(5);
    const later = sim.stateOf<NormsState>('order.norms')!;
    expect(later.slots[`${d}|fee`]!.signal?.from).toBe(6);
    expect(later.seen.length).toBe(1);
  });
});

describe('SF1-N-7: types and the cast of an enforcement event', () => {
  test('10,000 residents: type shares within sampling error of 1/8', () => {
    const sim = normsSim('SF1-N-7');
    const fee = norm(sim);
    const counts = new Array(8).fill(0) as number[];
    for (let i = 0; i < 10_000; i++) counts[residentType(sim, fee, H(hs('res'), hi(i)))]!++;
    for (const c of counts) expect(Math.abs(c / 10_000 - 1 / 8)).toBeLessThan(4 * Math.sqrt((1 / 8) * (7 / 8) / 10_000));
  });
  test('the target of an enforcement event is a non-complier by the qe and qn of its ring entry, and re-minting it gives the same cast', () => {
    const sim = normsSim('SF1-N-7b', (x) => { for (const n of x.norms.norms) { n.enforcePerDay = 4000; n.beh0 = 0.1; n.priv0 = 0.1; } });
    sim.advance(80);
    const st = sim.stateOf<NormsState>('order.norms')!;
    expect(st.ring.length).toBeGreaterThan(3);
    const proc = processCause('order.norms');
    for (const e of st.ring.slice(0, 8)) {
      const n = norm(sim, e.norm);
      const kind = `enf.${e.norm}.${e.rung}`;
      const d = { id: e.id, kind, size: 1, w: e.w, time: e.time, cell: e.cell, gen: 0, chain: [], public: false, witnesses: 0 };
      const harm = sim.data.gate.harmEffects.includes(sim.data.norms.rungs.find((r) => r.name === e.rung)!.effect);
      const cast = castEnforcement(sim, n, d, e.qe, e.qn, harm);
      expect(cast).not.toBe('no-cast');
      const [enf, target] = cast as Array<{ role: string; who: Id }>;
      expect(enf!.role).toBe('enforcer');
      expect(sim.people.view(target!.who)!.affc).toBe(0);
      expect(sim.people.view(target!.who)!.ageClass).toBe('adult');
      const node = sim.k.store.header(e.id);
      expect(node?.origin.by === 'minted' && node.origin.creator === proc).toBe(true);
      const parts: Array<{ who: string; role: string }> = [];
      for (let i = 0; i < (sim.k.value(e.id, 'participants#count') as number); i++) {
        const m = sim.k.address(e.id, `participants[${i}]`);
        parts.push({ who: sim.k.value(m, 'who') as string, role: sim.k.value(m, 'role') as string });
      }
      expect(parts).toEqual([{ who: enf!.who, role: 'enforcer' }, { who: target!.who, role: 'target' }]);
    }
  });
});

describe('SF1-O: the stocks', () => {
  const E0 = 0.5;
  const fact = (over: Partial<EventFact>): EventFact => ({
    id: H(hs('f'), hs(String(over.kind)), hs(String(over.creator))), kind: 'theft', size: 1, w: 0, time: 0, cell: H(hs('c')), district: '', public: false, witnesses: 0,
    policeChild: false, creator: 'sim', ...over,
  });
  const setup = (name: string, tweak?: (d: S1Data) => void) => {
    const sim = Sim.create({ worldSeed: seedOf(name), index: fx3Slice(), data: quietData(tweak), only: ['order.stocks'] });
    const d = sim.w.districts[0]!.id;
    const facts: EventFact[] = [
      fact({ kind: 'enf.fee.word', creator: 'norms', public: true, district: d }),
      fact({ kind: 'police-action', size: 2, parentSize: 2, district: d }),
      fact({ kind: 'theft', size: 2, public: true, policeChild: false, district: d }),
      fact({ kind: 'shakedown', size: 2, district: d }),
    ];
    const inject = (): void => {
      sim.k.evolution.stateOf('city.events').digest = { v: 1, through: 0, facts: { windows: [{ w: 0, items: facts.slice(1) }] }, counts: { windows: [] }, changes: { windows: [] } };
      sim.k.evolution.stateOf('order.norms').digest = { v: 1, through: 0, norms: {}, facts: { windows: [{ w: 0, items: facts.slice(0, 1) }] }, changes: { windows: [] } };
    };
    return { sim, d, facts, inject };
  };

  test('SF1-O-1: each row once, in the window the cursor passes it; a save before the consumption neither drops nor repeats', () => {
    const { sim, d, inject } = setup('SF1-O-1');
    inject();
    sim.k.persistence.save('A');
    sim.advance(1);
    const dE = 0.01 + 0.01 + 0 - 0.01;
    const dY = -0.01 - 0.015 + 0.02 + 0;
    const dL = 0 + 0.01 - 0.02 + 0;
    const cfg = sim.data.stocks;
    const first = sim.stateOf<StocksState>('order.stocks')!.districts[d]!;
    expect(first.E).toBeCloseTo(cfg.rhoE * E0 + (1 - cfg.rhoE) * E0 + dE, 12);
    expect(first.Y).toBeCloseTo(cfg.rhoY * E0 + (1 - cfg.rhoY) * E0 + dY, 12);
    expect(first.L).toBeCloseTo(cfg.rhoL * E0 + (1 - cfg.rhoL) * E0 + dL, 12);
    sim.advance(3);
    const later = sim.stateOf<StocksState>('order.stocks')!.districts[d]!;
    // later windows apply none: the stock only relaxes towards its baseline
    expect(Math.abs(later.E - E0)).toBeLessThan(Math.abs(first.E - E0));
    // a reload from before the consumption applies them once as well
    sim.k.persistence.load('A');
    inject();
    sim.advance(1);
    expect(sim.stateOf<StocksState>('order.stocks')!.districts[d]!.E).toBeCloseTo(first.E, 12);
  });

  test('stockRows: the four rows by their fields', () => {
    const { sim, facts } = setup('SF1-O-1b');
    expect(stockRows(sim, facts[0]!).length).toBe(1);
    expect(stockRows(sim, facts[1]!).length).toBe(1);
    expect(stockRows(sim, facts[2]!).length).toBe(1);
    expect(stockRows(sim, facts[3]!).length).toBe(1);
    expect(stockRows(sim, { ...facts[2]!, policeChild: true }).length).toBe(0);
    expect(stockRows(sim, { ...facts[1]!, parentSize: 1 }).length).toBe(0);
  });

  test('SF1-O-2: no events for 30 game days leave the stocks at their baselines; a +0.01 shock decays back by 0.9966 a window', () => {
    const { sim, d } = setup('SF1-O-2');
    sim.advance(4320);
    const s = sim.stateOf<StocksState>('order.stocks')!.districts[d]!;
    expect(Math.abs(s.E - E0)).toBeLessThan(1e-9);
    expect(Math.abs(s.Y - E0)).toBeLessThan(1e-9);
    sim.setState('order.stocks', (st) => { (st as StocksState).districts[d]!.E = E0 + 0.01; });
    sim.advance(2);
    const after = sim.stateOf<StocksState>('order.stocks')!.districts[d]!.E;
    expect(after - E0).toBeCloseTo(0.01 * sim.data.stocks.rhoE, 10);
  });

  test('SF1-O-4: a consumer not run for 10 windows with keep = 8 logs feed-gap and resumes from the first retained window', () => {
    const { sim, d } = setup('SF1-O-4');
    const items = (w: number): EventFact[] => [fact({ id: H(hs('f'), hi(w)), kind: 'shakedown', size: 2, w, district: d })];
    sim.k.evolution.stateOf('city.events').digest = {
      v: 1, through: 19, counts: { windows: [] }, changes: { windows: [] },
      facts: { windows: Array.from({ length: 8 }, (_, i) => ({ w: 12 + i, items: items(12 + i) })) },
    };
    sim.k.evolution.stateOf('order.norms').digest = { v: 1, through: 19, norms: {}, facts: { windows: [] }, changes: { windows: [] } };
    sim.advance(1);
    expect(sim.record.log.some((e) => e.reason === 'feed-gap')).toBe(true);
    const st = sim.stateOf<StocksState>('order.stocks')!;
    expect(st.cursors.events).toBe(19);
    // the eight retained windows' shakedown rows (-0.01 each) were all applied
    expect(st.districts[d]!.E).toBeLessThan(E0 - 0.07);
  });
});

export type { NormsDigest, StocksDigest };
void rand;
void hid;
