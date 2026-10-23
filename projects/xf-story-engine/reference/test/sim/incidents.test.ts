// SF1-S, SF1-I and SF1-O-3, the rest: regimes, coupling, causality, summaries and the ring, demand independence, cover, the mean, one
// descriptor, the soak; and SF1-P-3, SF1-H-8 (S1 14.1). The long runs are scaled down unless `S1_FULL=1` asks for the spec's figures.

import { describe, expect, test } from 'bun:test';
import { processCause } from '../../src/evolution.ts';
import { H, id as hid, i as hi, s as hs } from '../../src/id.ts';
import { itemTime } from '../../src/summary.ts';
import type { Id } from '../../src/types.ts';
import type { S1Data } from '../../src/sim/data.ts';
import type { PendingChild } from '../../src/sim/occ.ts';
import { ReplayPort } from '../../src/sim/port.ts';
import { type EventsDigest, type EventsState, type RegimeRec } from '../../src/sim/proc-events.ts';
import type { MirrorDigest } from '../../src/sim/proc-mirror.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice, makeKabukiSlice } from '../../src/sim/slices.ts';
import { child, eventsState, fxData, inject, occurrences, quietData, quietSim, seedOf } from './helpers.ts';

const W = 600;
const DAY = 144;
const FULL = process.env.S1_FULL === '1';
const proc = processCause('city.events');

const busy = (factor: number, tweak: (d: S1Data) => void = () => {}): S1Data =>
  fxData((d) => {
    for (const k of Object.keys(d.shape.rate)) d.shape.rate[k] = d.shape.rate[k]!.map((x) => x * factor) as [number, number, number, number];
    tweak(d);
  });

describe('SF1-S-2: regimes', () => {
  test('arrivals within three standard deviations, none ends before its planned length, all gone by their maximum dwell, one live regime of a kind per district', () => {
    const seeds = 20;
    let arrivals = 0;
    for (let n = 0; n < seeds; n++) {
      const sim = quietSim(`SF1-S-2-${n}`, (d) => { for (const r of d.regimes) r.arrival = 0.03; });
      const live = new Map<Id, RegimeRec>();
      for (let w = 0; w < 30 * DAY; w++) {
        sim.advance(1);
        const regimes = eventsState(sim).regimes;
        const keys = new Set<string>();
        for (const r of regimes) {
          expect(keys.has(`${r.scope}|${r.kind}`)).toBe(false);
          keys.add(`${r.scope}|${r.kind}`);
          if (!live.has(r.id)) {
            live.set(r.id, r);
            arrivals++;
          }
          expect(w - r.startW).toBeLessThanOrEqual(r.maxDwell);
        }
        // a regime that left the state has been gone since this window: its age at the exit (window w + 0) is at least its planned length
        for (const [id, r] of [...live]) {
          if (regimes.some((x) => x.id === id)) continue;
          expect(w - r.startW).toBeGreaterThanOrEqual(r.plannedLength);
          expect(w - r.startW).toBeLessThanOrEqual(r.maxDwell + 1);
          live.delete(id);
        }
      }
    }
    // three kinds at 0.03 a day: 0.9 each per seed
    const mean = 3 * 0.9 * seeds;
    expect(Math.abs(arrivals - mean)).toBeLessThan(3 * Math.sqrt(mean) + 1);
  }, 600_000);
});

describe('SF1-S-4: no coupling inside a window', () => {
  test('the same window with city.events as specified and with a version that mints nothing: every other process\'s state, digest and pins are identical', () => {
    const make = () => Sim.create({ worldSeed: seedOf('SF1-S-4'), index: fx3Slice(), data: busy(20) });
    const a = make();
    const b = make();
    // a window in which the events process mints something
    const probe = make();
    probe.advance(60);
    const v = Math.max(30, ...eventsState(probe).ring.filter((e) => e.event && e.w >= 30).slice(0, 1).map((e) => e.w));
    a.advance(v - 1);
    b.advance(v - 1);
    // from here the second sim's city.events mints nothing in window `v`
    const def = b.defs.get('city.events')!;
    const run = def.run.bind(def);
    def.run = (pctx, k) => {
      const res = run(pctx, k);
      if (k !== v) return res;
      const ops = (Array.isArray(res) ? res : res.ops).filter((op) => op.op !== 'mint-event' && op.op !== 'mint-summary');
      return Array.isArray(res) ? ops : { ...res, ops };
    };
    a.advance(2);
    b.advance(2);
    for (const id of ['order.stocks', 'city.mirror', 'order.ledger', 'order.norms', 'group.decide', 'scene.acts']) {
      expect(b.stateOf(id)).toEqual(a.stateOf(id));
      expect(b.digestOf(id)).toEqual(a.digestOf(id));
    }
    const others = (sim: Sim) => sim.k.store.allPins().filter((p) => sim.k.store.header(p.node)?.kind !== 'core:summary' && !p.slot.startsWith('band@w') && !p.slot.startsWith('status@w')).map((p) => `${p.node}|${p.slot}|${String(p.value)}`).sort();
    expect(others(b)).toEqual(others(a));
    // the run did mint something in window w in the first sim, so the comparison is not vacuous
    expect(a.k.store.idsOfKind('core:event').length).toBeGreaterThan(b.k.store.idsOfKind('core:event').length);
  }, 120_000);
});

describe('SF1-S-6: a value closes and reopens in one batch', () => {
  test('regime(D1) transitions [(startOf(w) - 1, festival), (startOf(w), none), (t_arrival, crackdown)]; a closing condition latches; eval alone answers crackdown', () => {
    const sim = Sim.create({
      worldSeed: seedOf('SF1-S-6'), index: fx3Slice(), only: ['city.events'],
      data: quietData((d) => {
        for (const r of d.regimes) r.arrival = 0;
        const fest = d.regimes.find((r) => r.kind === 'festival')!;
        fest.plannedLength = fest.maxDwell;
      }),
    });
    const district = sim.w.districts[0]!.id;
    const fest = sim.data.regimes.find((r) => r.kind === 'festival')!;
    const w = 400;
    sim.startAt(w - 2);
    sim.setState('city.events', (st) => {
      (st as EventsState).regimes.push({
        id: H(hs('fixture-regime'), hid(district)), kind: 'festival', scope: district, start: (w - fest.maxDwell) * W, startW: w - fest.maxDwell, plannedLength: fest.plannedLength,
        maxDwell: fest.maxDwell, size: 3, effects: fest.effects, closes: fest.closes, priceShift: fest.priceShift,
      });
    });
    sim.advance(1);
    expect(sim.reads.eval('regime', ['fx_d1'])).toBe('festival');
    // the crackdown arrives in window w, at a rate of 5,760 a day: the count is capped at 1; the festival is at its maximum dwell in the same window
    sim.data.regimes.find((r) => r.kind === 'crackdown')!.arrival = 5760;
    sim.advance(2);
    const T = w * W;
    const t = sim.reads.transitions('regime', ['fx_d1'], T - 1, (w + 1) * W);
    expect(t.length).toBe(3);
    expect(t[0]).toEqual({ t: T - 1, value: 'festival' });
    expect(t[1]).toEqual({ t: T, value: 'none' });
    expect(t[2]!.value).toBe('crackdown');
    expect(t[2]!.t).toBeGreaterThanOrEqual(T);
    expect(t[2]!.t).toBeLessThan((w + 1) * W);
    // the end comes before the start when the times are equal
    expect(t[1]!.t).toBeLessThanOrEqual(t[2]!.t);
    // a closing condition `regime = none` evaluated at each entry latches, and the value at the end alone answers crackdown
    expect(t.some((x) => x.value === 'none')).toBe(true);
    expect(sim.reads.eval('regime', ['fx_d1'], (w + 1) * W)).toBe('crackdown');
    expect(sim.reads.eval('regimeIs', ['fx_d1', 'crackdown'])).toBe('yes');
  });
});

describe('SF1-I-5: causality', () => {
  test('every child is born in a later window and at a later time than its parent; no cause follows its effect', () => {
    const seeds = FULL ? 20 : 4;
    const windows = FULL ? 30 * DAY : 220;
    let children = 0;
    for (let n = 0; n < seeds; n++) {
      const sim = Sim.create({ worldSeed: seedOf(`SF1-I-5-${n}`), index: fx3Slice(), data: busy(FULL ? 1 : 25), only: ['city.events'] });
      sim.advance(windows);
      const all = occurrences(sim);
      const byId = new Map(all.map((o) => [o.id, o]));
      for (const o of all) {
        if (o.parent === undefined) continue;
        const p = byId.get(o.parent);
        if (!p) continue;
        children++;
        expect(o.w).toBeGreaterThan(p.w);
        expect(o.time).toBeGreaterThan(p.time);
        expect(o.chain[0]).toBe(o.parent);
      }
    }
    expect(children).toBeGreaterThan(FULL ? 100 : 10);
  }, 600_000);
});

describe('SF1-I-9 and SF1-I-10: summaries, items, the ring and why', () => {
  test('SF1-I-9: for every summary the count equals the items enumerated, each item\'s place is the summary\'s cell, and a canon item persists', () => {
    const sim = Sim.create({ worldSeed: seedOf('SF1-I-9'), index: fx3Slice(), data: busy(25), only: ['city.events'] });
    sim.advance(100);
    const summaries = sim.k.summaries.summaries();
    expect(summaries.length).toBeGreaterThan(20);
    let items = 0;
    for (const S of summaries) {
      const count = sim.k.value(S, 'count') as number;
      const scope = sim.k.value(S, 'scope') as Id;
      for (let j = 0; j < count; j++) {
        const item = sim.k.summaries.materialise(S, j);
        expect(sim.k.value(item, 'place')).toBe(scope);
        expect(typeof sim.k.value(item, 'time')).toBe('number');
        items++;
      }
    }
    expect(items).toBeGreaterThan(30);
    // a canon item survives a sweep and the summary keeps its count
    const S = summaries.find((s) => (sim.k.value(s, 'count') as number) >= 1)!;
    const count = sim.k.value(S, 'count');
    const item = sim.k.summaries.makeItemCanon(S, 0, 'observed', proc);
    const time = sim.k.value(item, 'time');
    sim.k.retention.scheduleSweep();
    sim.k.settle();
    expect(sim.k.store.header(item)).toBeDefined();
    expect(sim.k.value(item, 'time')).toBe(time);
    expect(sim.k.value(S, 'count')).toBe(count);
  });

  const week = (name: string) => {
    const sim = Sim.create({ worldSeed: seedOf(name), index: fx3Slice(), data: busy(FULL ? 4 : 12), only: ['city.events'] });
    sim.advance(1008 + 300);
    return sim;
  };

  test('SF1-I-10: descriptors older than 1,008 windows are gone; a why chain reaches an immigrant in at most 4 links; an occurrence of generation 4 has no children', () => {
    const sim = week('SF1-I-10');
    const st = eventsState(sim);
    const now = sim.windowNow();
    expect(st.ring.length).toBeGreaterThan(100);
    expect(st.ring.every((e) => now - 1 - e.w < 1008)).toBe(true);
    const all = occurrences(sim);
    expect(all.some((o) => o.gen >= 1)).toBe(true);
    let checked = 0;
    for (const e of st.ring) if (e.count !== undefined) for (let j = 0; j < e.count; j++) sim.k.summaries.materialise(e.id, j);
    for (const o of all) {
      expect(o.gen).toBeLessThanOrEqual(4);
      expect(o.chain.length).toBeLessThanOrEqual(4);
      expect(o.chain.length).toBe(o.gen);
      const chain = sim.why(o.id)!;
      expect(chain).toBeDefined();
      expect(chain.length - 1).toBeLessThanOrEqual(4);
      expect(chain[0]!.id).toBe(o.id);
      if (o.gen === 0) expect(chain.length).toBe(1);
      checked++;
    }
    expect(checked).toBe(all.length);
    // no occurrence of generation 4 has a child: nothing in the ring or the calendar names it as a parent
    const gen4 = new Set(all.filter((o) => o.gen === 4).map((o) => o.id));
    for (const o of all) if (o.parent !== undefined) expect(gen4.has(o.parent)).toBe(false);
    for (const list of Object.values(st.calendar)) for (const c of list) expect(gen4.has(c.parent)).toBe(false);
  }, 300_000);

  test('SF1-I-10: an event or a summary within seven days is minted again under its Id with the same fields and the same items', () => {
    const sim = week('SF1-I-10b');
    const st = eventsState(sim);
    const fresh = Sim.create({ worldSeed: seedOf('SF1-I-10b'), index: fx3Slice(), data: busy(FULL ? 4 : 12), only: ['city.events'] });
    const events = st.ring.filter((e) => e.event && e.mint).slice(-12);
    const summaries = st.ring.filter((e) => e.count !== undefined).slice(-12);
    expect(events.length).toBeGreaterThan(3);
    expect(summaries.length).toBeGreaterThan(3);
    fresh.setState('city.events', (s) => { (s as EventsState).ring = structuredClone(st.ring); });
    const fields = (s: Sim, id: Id) => ['time', 'place', 'kind', 'participants#count', 'effects#count'].map((slot) => s.k.value(id, slot));
    for (const e of events) {
      expect(fresh.remint(e.id)).toBe(e.id);
      expect(fields(fresh, e.id)).toEqual(fields(sim, e.id));
      expect(fresh.policies.viewEvent(e.id)!.participants).toEqual(sim.policies.viewEvent(e.id)!.participants);
    }
    for (const e of summaries) {
      expect(fresh.remint(e.id)).toBe(e.id);
      expect(fresh.k.value(e.id, 'count')).toBe(sim.k.value(e.id, 'count'));
      for (let j = 0; j < e.count!; j++) {
        const a = fresh.k.summaries.materialise(e.id, j);
        const b = sim.k.summaries.materialise(e.id, j);
        expect(a).toBe(b);
        expect(fields(fresh, a)).toEqual(fields(sim, b));
      }
    }
    // what the ring no longer holds is not minted
    expect(fresh.remint(H(hs('not-in-ring')))).toBeUndefined();
  }, 300_000);
});

describe('SF1-I-12: demand independence', () => {
  test('two runs with V in different cells and different demand: identical tier 0 to 2 states, digests, pins and events; coverage lowers the rate in a covered cell for every run', () => {
    const run = (vCell: string, extra: boolean) => {
      const sim = Sim.create({ worldSeed: seedOf('SF1-I-12'), index: fx3Slice(), data: busy(15) });
      new ReplayPort(sim).submit([
        { t: 0, op: 'reading', node: 'v', slot: 'district', value: 'fx_d1' },
        { t: 0, op: 'reading', node: 'v', slot: 'cell', value: vCell },
        { t: 0, op: 'person', key: 'vic', slots: { affiliation: 'civilian', alive: 'yes', 'age-class': 'adult' } },
        { t: 5 * W, op: 'event', kind: 'game.death', place: 'c2', participants: [{ who: 'vic', role: 'victim' }, { who: 'v', role: 'actor' }], effects: [{ on: 'vic', effect: 'kill' }], witnesses: 3 },
      ]);
      if (extra) {
        // more demand: a root that wants a scene in the other cell, and a node held at tier 4
        sim.k.frames.demandRoots.add(sim.people.residentAt(sim.w.districts[0]!.cellIds[2]!, 0));
      }
      sim.advance(80);
      return sim;
    };
    const a = run('c1', false);
    const b = run('c3', true);
    for (const id of ['city.events', 'order.stocks', 'city.mirror', 'order.ledger', 'order.norms', 'group.decide']) {
      expect(b.stateOf(id)).toEqual(a.stateOf(id));
      expect(b.digestOf(id)).toEqual(a.digestOf(id));
    }
    const pins = (s: Sim) => s.k.store.allPins().filter((p) => /^(band|status|gap-|label-|group-gap)/.test(p.slot)).map((p) => `${p.node}|${p.slot}|${String(p.value)}`).sort();
    expect(pins(b)).toEqual(pins(a));
    const events = (s: Sim) => s.k.store.idsOfKind('core:event').filter((e) => s.k.store.header(e)?.origin.by === 'minted' && (s.k.store.header(e)!.origin as { creator: Id }).creator === proc).sort();
    expect(events(b)).toEqual(events(a));
    expect(events(a).length).toBeGreaterThan(10);
    // the game's coverage lowers the rate of its kind in the covered cell, the same in every run
    const c2 = a.w.districts[0]!.cellIds[1]!;
    const covered = a.city.a(c2, 'gang-clash', 2);
    expect(covered).toBeLessThan(a.city.a(c2, 'theft', 2));
    expect(b.city.a(c2, 'gang-clash', 2)).toBe(covered);
  }, 300_000);
});

describe('SF1-I-13: game cover', () => {
  const run = (coverCell: string) => {
    const sim = Sim.create({ worldSeed: seedOf('SF1-I-13'), index: fx3Slice(), data: quietData((d) => { d.events.offspring = [0, 0, 0, 0]; }), only: ['city.events', 'city.mirror'] });
    const [c1, c2, c3] = sim.w.districts[0]!.cellIds as [Id, Id, Id];
    const port = new ReplayPort(sim);
    port.submit([
      { t: 0, op: 'person', key: 'claw', slots: { affiliation: 'GA', alive: 'yes', 'age-class': 'adult' } },
      { t: 0, op: 'person', key: 'rival', slots: { affiliation: 'GB', alive: 'yes', 'age-class': 'adult' } },
      { t: 155 * W + 100, op: 'event', kind: 'game.combat.start', place: coverCell, participants: [{ who: 'claw', role: 'hostile' }, { who: 'rival', role: 'hostile' }] },
    ]);
    sim.startAt(150);
    const sides = { a: 2, b: 3 };
    inject(
      sim,
      child(sim, 'clash-c2', 0, 160, 'gang-clash', 2, c2, { sides }),
      child(sim, 'theft-c2', 1, 160, 'theft', 2, c2),
      child(sim, 'clash-c3', 2, 160, 'gang-clash', 2, c3, { sides }),
      child(sim, 'clash-c1', 3, 160, 'gang-clash', 2, c1, { sides }),
    );
    sim.advance(14);
    const covers = sim.record.log.filter((e) => e.reason === 'game-covers');
    const fired = new Set(Object.values(eventsState(sim).ring).map((e) => `${e.kind}|${e.cell}`));
    return { sim, covers, fired, cells: { c1, c2, c3 } };
  };

  test('a pending gang-clash child in the covered cell is thinned game-covers and logged as a correction; a theft child and a gang-clash child two steps away fire as usual', () => {
    const { covers, fired, cells } = run('c1');
    expect(covers.length).toBe(2);
    expect(covers.every((e) => e.kind === 'correction')).toBe(true);
    // c1 is the covered cell and c2 is one step from it: both gang-clash children are thinned; c3 is two steps away
    expect(fired.has(`gang-clash|${cells.c3}`)).toBe(true);
    expect(fired.has(`gang-clash|${cells.c1}`)).toBe(false);
    expect(fired.has(`gang-clash|${cells.c2}`)).toBe(false);
    expect(fired.has(`theft|${cells.c2}`)).toBe(true);
  });

  test('covered at c2: the c2 child and the children one step away (c1 and c3) are thinned; a theft child fires', () => {
    const { covers, fired, cells } = run('c2');
    expect(covers.length).toBe(3);
    expect(fired.has(`gang-clash|${cells.c1}`)).toBe(false);
    expect(fired.has(`gang-clash|${cells.c2}`)).toBe(false);
    expect(fired.has(`gang-clash|${cells.c3}`)).toBe(false);
    expect(fired.has(`theft|${cells.c2}`)).toBe(true);
  });

  test('a cover entry expires after coverLull windows', () => {
    const sim = Sim.create({ worldSeed: seedOf('SF1-I-13c'), index: fx3Slice(), data: quietData(), only: ['city.mirror'] });
    new ReplayPort(sim).submit([
      { t: 0, op: 'person', key: 'a', slots: { affiliation: 'GA', alive: 'yes', 'age-class': 'adult' } },
      { t: 0, op: 'person', key: 'b', slots: { affiliation: 'GB', alive: 'yes', 'age-class': 'adult' } },
      { t: 100, op: 'event', kind: 'game.combat.start', place: 'c1', participants: [{ who: 'a', role: 'hostile' }, { who: 'b', role: 'hostile' }] },
    ]);
    sim.advance(3);
    expect(sim.digestOf<MirrorDigest>('city.mirror')!.cover.length).toBe(1);
    sim.advance(sim.data.events.coverLull + 3);
    expect(sim.digestOf<MirrorDigest>('city.mirror')!.cover.length).toBe(0);
  });
});

describe('SF1-I-15: the mean is bounded', () => {
  test('cityScale 5, a live festival and crackdown, an m4 disorder parent: the unclamped mean 0.6 x 5 x 2.6 = 7.8 is clamped to nMax and logged n-clamped', () => {
    const sim = Sim.create({ worldSeed: seedOf('SF1-I-15'), index: fx3Slice(), data: quietData((d) => { for (const r of d.regimes) r.arrival = 0; }), only: ['city.events'] });
    sim.k.settings.set({ cityScale: 5 }, 0);
    const district = sim.w.districts[0]!.id;
    const c1 = sim.w.districts[0]!.cellIds[0]!;
    const w = 300;
    sim.startAt(w);
    sim.setState('city.events', (st) => {
      for (const kind of ['festival', 'crackdown']) {
        const r = sim.data.regimes.find((x) => x.kind === kind)!;
        (st as EventsState).regimes.push({ id: H(hs('fixture-regime'), hs(kind)), kind, scope: district, start: w * W, startW: w, plannedLength: r.plannedLength, maxDwell: r.maxDwell, size: 3, effects: r.effects, closes: r.closes, priceShift: r.priceShift });
      }
    });
    expect(sim.data.regimes.find((r) => r.kind === 'festival')!.effects.disorder! * sim.data.regimes.find((r) => r.kind === 'crackdown')!.effects.disorder!).toBeCloseTo(2.6, 12);
    expect(sim.data.events.offspring[3]! * 5 * 2.6).toBeCloseTo(7.8, 12);
    inject(sim, child(sim, 'm4', 0, w, 'disorder', 4, c1));
    sim.advance(2);
    expect(sim.record.log.filter((e) => e.reason === 'n-clamped').length).toBe(1);
    expect(eventsState(sim).counters.clamped).toBe(1);
    expect(sim.data.events.nMax).toBe(0.85);
  });

  test('a regime that arrives in a window changes incidents from the next window: its own window reads the regimes live at its start (Sol 13)', () => {
    const offspringOf = (festivalTheft: number, at: 'own' | 'next') => {
      const sim = Sim.create({
        worldSeed: seedOf('SF1-I-15r'), index: fx3Slice(), only: ['city.events'],
        data: quietData((d) => {
          for (const r of d.regimes) r.arrival = 0;
          const f = d.regimes.find((r) => r.kind === 'festival')!;
          // one festival arrives in the first window (a rate of 5,760 a day is a certainty), and it changes the means of theft
          f.arrival = 5760;
          f.effects = { ...f.effects, theft: festivalTheft };
          d.events.nMax = 3;
        }),
      });
      sim.k.settings.set({ cityScale: 5 }, 0);
      const c1 = sim.w.districts[0]!.cellIds[0]!;
      const w = 300;
      sim.startAt(w);
      const due = at === 'own' ? w : w + 1;
      inject(sim, ...Array.from({ length: 40 }, (_, n) => child(sim, `p${n}`, 0, due, 'theft', 2, c1)));
      sim.advance(due - w + 1);
      expect(eventsState(sim).regimes.some((r) => r.kind === 'festival')).toBe(true);
      // the children born of the injected parents are gen 1 (the injected ones are gen 0 by their facts)
      return Object.values(eventsState(sim).calendar).flat().filter((x) => x.parentFacts.gen === 1).length;
    };
    // in the window the festival arrives it changes nothing: ten times the effect, the same offspring
    expect(offspringOf(0.1, 'own')).toBe(offspringOf(10, 'own'));
    expect(offspringOf(0.1, 'own')).toBeGreaterThan(0);
    // in the next window it does
    expect(offspringOf(10, 'next')).toBeGreaterThan(offspringOf(0.1, 'next'));
  });

  test('over many cascades from large roots no chain exceeds 4 links', () => {
    const roots = FULL ? 1000 : 120;
    const sim = Sim.create({ worldSeed: seedOf('SF1-I-15b'), index: fx3Slice(), data: quietData((d) => { for (const r of d.regimes) r.arrival = 0; d.events.capPerWindow = 1000; }), only: ['city.events'] });
    sim.k.settings.set({ cityScale: 5 }, 0);
    const c1 = sim.w.districts[0]!.cellIds[0]!;
    sim.startAt(100);
    const per = 6;
    for (let w = 100; w < 100 + roots / per; w++) {
      const cs: PendingChild[] = [];
      for (let r = 0; r < per; r++) cs.push(child(sim, `root-${w}-${r}`, 0, w + 1, 'disorder', 3, c1));
      inject(sim, ...cs);
      sim.advance(1);
    }
    sim.advance(60);
    const all = occurrences(sim);
    expect(all.length).toBeGreaterThan(roots);
    expect(Math.max(...all.map((o) => o.gen))).toBeLessThanOrEqual(4);
    expect(Math.max(...all.map((o) => o.chain.length))).toBeLessThanOrEqual(4);
    expect(all.some((o) => o.gen === 4)).toBe(true);
    expect(sim.record.log.filter((e) => e.reason === 'calendar-overflow').length).toBe(0);
  }, 300_000);
});

describe('SF1-I-16: one descriptor', () => {
  test('a size-3 parent with a child of size 1 and one of size 2, and a size-1 parent with a child of size 1: items by the kernel\'s Id, time and place; events by H(mint, proc, parent, child/index)', () => {
    const sim = Sim.create({ worldSeed: seedOf('SF1-I-16'), index: fx3Slice(), data: quietData((d) => { d.events.offspring = [0, 0, 0, 0]; }), only: ['city.events'] });
    const c1 = sim.w.districts[0]!.cellIds[0]!;
    const w = 220;
    sim.startAt(w);
    const parent3 = H(hs('p3'));
    const parent1 = H(hs('p1'));
    const facts = (id: Id, size: number) => ({ id, kind: 'theft', size, w: w - 1, time: (w - 1) * W + 10, cell: c1, gen: 0, chain: [] as Id[] });
    inject(
      sim,
      { parent: parent3, index: 0, due: w, kind: 'theft', size: 1, cell: c1, modBirth: 1, parentFacts: facts(parent3, 3) },
      { parent: parent3, index: 1, due: w, kind: 'assault', size: 2, cell: c1, modBirth: 1, parentFacts: facts(parent3, 3) },
      { parent: parent1, index: 0, due: w, kind: 'theft', size: 1, cell: c1, modBirth: 1, parentFacts: facts(parent1, 1) },
    );
    sim.advance(2);
    const ring = eventsState(sim).ring;
    // the size-2 child is an event under its parent, whatever the parent's size
    const ev = H(hs('mint'), hid(proc), hid(parent3), hs('child/1'));
    const e = ring.find((x) => x.id === ev)!;
    expect(e.event).toBeDefined();
    expect(sim.k.value(ev, 'time')).toBe(e.event!.time);
    expect(sim.k.value(ev, 'place')).toBe(e.event!.cell);
    // the size-1 children are items of the cell summary of their due window, with a parent link
    const sum = ring.filter((x) => x.count !== undefined && x.w === w);
    expect(sum.length).toBe(1);
    expect(sum[0]!.count).toBe(2);
    const parents = Object.values(sum[0]!.meta!).map((m) => m.parent).sort();
    expect(parents).toEqual([parent1, parent3].sort());
    sum[0]!.meta && Object.entries(sum[0]!.meta).forEach(([j, m]) => {
      const item = sim.k.summaries.materialise(sum[0]!.id, Number(j));
      expect(item).toBe(sim.k.summaries.itemId(sum[0]!.id, Number(j)));
      expect(sim.k.value(item, 'time')).toBe(itemTime(sum[0]!.id, Number(j), w * W, W));
      expect(sim.k.value(item, 'place')).toBe(c1);
      expect(m.gen).toBe(1);
      expect(m.chain[0]).toBe(m.parent!);
    });
    // for the event the descriptor's id, time and cell are those the kernel reports
    expect(ev).toBe(e.id);
    void hi;
  });
});

describe('SF1-O-3: bounds and partition', () => {
  test('a soak: stocks stay in 0 to 1 and the histories are identical in one call and in many', () => {
    const days = FULL ? 100 : 6;
    const mk = () => Sim.create({ worldSeed: seedOf('SF1-O-3'), index: fx3Slice(), data: fxData(), only: ['city.events', 'order.stocks', 'order.norms'] });
    const bounds = (sim: Sim) => {
      const dg = sim.digestOf<{ districts: Record<Id, { E: number; Y: number; L: number; fear: number }> }>('order.stocks')!;
      for (const s of Object.values(dg.districts)) for (const v of Object.values(s)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    };
    const one = mk();
    one.advance(days * DAY);
    bounds(one);
    const many = mk();
    for (let d = 0; d < days; d++) {
      many.advance(DAY / 2);
      many.advance(DAY / 2);
      bounds(many);
    }
    expect(many.stateOf('order.stocks')).toEqual(one.stateOf('order.stocks'));
    expect(many.digestOf('order.stocks')).toEqual(one.digestOf('order.stocks'));
    expect(many.stateOf('order.norms')).toEqual(one.stateOf('order.norms'));
  }, 600_000);
});

describe('SF1-P-3: the recipe is fixed', () => {
  test('altering the index marginals inside a lineage: the pinned versions differ and the save loads read-only; nothing refits', () => {
    const a = Sim.create({ worldSeed: seedOf('SF1-P-3'), index: fx3Slice(), data: fxData(), only: ['city.events'] });
    a.advance(3);
    const rec = a.k.persistence.save('A');
    const altered = fx3Slice();
    const d = Object.values(altered.districts)[0]!;
    d.marginals.age = [0.05, 0.15, 0.22, 0.2, 0.17, 0.11, 0.07, 0.03];
    const b = Sim.create({ worldSeed: seedOf('SF1-P-3'), index: altered, data: fxData(), only: ['city.events'] });
    expect(b.w.pack.version).not.toBe(a.w.pack.version);
    expect([...b.w.fits.values()].map((f) => f.recipeHash)).not.toEqual([...a.w.fits.values()].map((f) => f.recipeHash));
    (b.k.persistence as unknown as { chain: Map<string, unknown> }).chain.set('A', rec);
    const report = b.k.persistence.load('A');
    expect(report.readOnly).toBe(true);
    expect(report.message).toContain('read-only');
    expect(() => b.advance(1)).toThrow(/read-only/);
    // the same index loads without complaint
    const c = Sim.create({ worldSeed: seedOf('SF1-P-3'), index: fx3Slice(), data: fxData(), only: ['city.events'] });
    (c.k.persistence as unknown as { chain: Map<string, unknown> }).chain.set('A', rec);
    expect(c.k.persistence.load('A').readOnly).toBe(false);
    c.advance(2);
  });
});

describe('SF1-H-8: procRand is window-keyed', () => {
  test('the draw for window 7 from the run of window 7, and through a harness that advanced from window 0 in one call, are equal', () => {
    const draws = (calls: number) => {
      const sim = Sim.create({ worldSeed: seedOf('SF1-H-8'), index: fx3Slice(), data: fxData(), only: ['city.events'] });
      const seen: number[] = [];
      const def = sim.defs.get('city.events')!;
      const run = def.run.bind(def);
      def.run = (pctx, k) => {
        if (k === 7) seen.push(pctx.procRand(7, hs('probe'), hi(3)));
        return run(pctx, k);
      };
      for (let i = 0; i < calls; i++) sim.advance(10 / calls);
      return seen;
    };
    const one = draws(1);
    expect(one.length).toBe(1);
    expect(draws(10)).toEqual(one);
    expect(draws(2)).toEqual(one);
    expect(one[0]).toBeGreaterThan(0);
    expect(one[0]).toBeLessThan(1);
  });
});

void makeKabukiSlice;
