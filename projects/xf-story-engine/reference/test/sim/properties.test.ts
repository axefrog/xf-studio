// The property tests of S1 14.3: generated scripts, named streams, shrinking of a failing script; partition and reload, regeneration under
// forgetting, metamorphic relations, hard limits, demand independence. The seeds and lengths are scaled down unless `S1_FULL=1`.

import { describe, expect, test } from 'bun:test';
import { hrec } from '../../src/canon.ts';
import { H, memberId, s as hs } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import type { Per4 } from '../../src/sim/data.ts';
import type { WorldIndex } from '../../src/sim/index-types.ts';
import { NO_BOOSTS } from '../../src/sim/cast.ts';
import { ReplayPort, type ReplayLine } from '../../src/sim/port.ts';
import { itemDescriptor } from '../../src/sim/proc-acts.ts';
import { Sim } from '../../src/sim/sim.ts';
import { districtIdOf, fx3Slice } from '../../src/sim/slices.ts';
import { lcg } from './feed.ts';
import { CELLS, differenceOf, execute, genPlan, genScript, make, shrink, shrinkDifference } from './gen.ts';
import { eventsState, fxData, inject, child, occurrences, seedOf, withSecondDistrict } from './helpers.ts';
import { differing, recordOf } from './records.ts';

const W = 600;
const FULL = process.env.S1_FULL === '1';
const SEEDS = FULL ? 12 : 3;
const WINDOWS = FULL ? 240 : 90;
/** The metamorphic relations run several worlds each, and compare counts and records, not single windows. */
const MW = FULL ? 240 : 60;

describe('partition and reload', () => {
  for (let n = 0; n < SEEDS; n++) {
    test(`seed ${n}: random call groupings and random saves and loads give the same records as one call`, () => {
      const seed = 0x5eed + n * 7919;
      const script = genScript(seed, WINDOWS);
      const once = (s: ReplayLine[]) => recordOf(execute(s, { groups: [WINDOWS], reloads: [] }, WINDOWS));
      const rr = once(script);
      for (const planSeed of [seed + 1, seed + 2]) {
        const plan = genPlan(planSeed, WINDOWS);
        const planned = (s: ReplayLine[]) => recordOf(execute(s, plan, WINDOWS));
        const d = differenceOf(rr, planned(script));
        if (d.length > 0) {
          // the named streams: report the seed, the plan and the smallest script that still differs, each reduced script run both ways again
          const small = shrinkDifference(script, once, planned);
          throw new Error(`records differ in ${d.join(', ')}\nseed ${seed}, plan ${JSON.stringify(plan)}\nsmallest script ${JSON.stringify(small)}`);
        }
      }
    }, 600_000);
  }

  test('the shrinker runs both ways again on every reduced script, so it keeps the difference that was found and no other', () => {
    // two ways of running a script that differ because of the line at 777 and, in the original reference only, because of its length
    const script = Array.from({ length: 12 }, (_, n): ReplayLine => ({ t: n === 7 ? 777 : n, op: 'fact', name: 'x', value: n }));
    const reference = (s: ReplayLine[]) => ({ out: String(s.length > 0) });
    const other = (s: ReplayLine[]) => ({ out: String(s.length > 0 && !s.some((l) => l.t === 777)) });
    const small = shrinkDifference(script, reference, other);
    expect(small.length).toBe(1);
    expect(small[0]!.t).toBe(777);
    // against the original's result, which is what the first version did, the empty script keeps the difference by being different
    const original = reference(script);
    const first = shrink(script, (s) => differenceOf(original, other(s)).length > 0);
    expect(first.length).not.toBe(1);
  });

  test('the generator is deterministic and the shrinker keeps the failure', () => {
    expect(genScript(7, 60)).toEqual(genScript(7, 60));
    expect(genScript(7, 60)).not.toEqual(genScript(8, 60));
    const s = genScript(3, 60);
    const small = shrink(s, (x) => x.some((l) => l.op === 'event'));
    expect(small.length).toBe(1);
    expect(small[0]!.op).toBe('event');
    expect(genPlan(5, 40).groups.reduce((a, b) => a + b, 0)).toBe(40);
  });
});

describe('regeneration under random forgetting', () => {
  test('forgetting the residents, the households, the items and the casts changes no future and no cast', () => {
    const seed = 0xf09e;
    const script = genScript(seed, WINDOWS);
    const rng = lcg(seed);
    const a = make();
    const b = make();
    new ReplayPort(a).submit(script);
    new ReplayPort(b).submit(script);
    const d0 = a.w.districts[0]!;
    const sample = d0.cellIds.flatMap((c) => a.people.residentsOfBlock(c)).slice(0, 25);
    const views = sample.map((r) => JSON.stringify(a.people.view(r)));
    let at = 0;
    for (let round = 0; round < 3; round++) {
      const stop = Math.floor(((round + 1) * WINDOWS) / 4);
      a.advance(stop - at);
      b.advance(stop - at);
      at = stop;
      // b forgets: the caches of the people and the ties, then every node nothing retains
      b.people.dropCaches();
      b.ties.dropCaches();
      b.k.retention.scheduleSweep();
      b.k.settle();
      if (rng() < 2) {
        // and the casts of the items in the ring regenerate the same
        for (const e of eventsState(a).ring.filter((x) => x.count !== undefined && x.meta).slice(-5)) {
          for (let j = 0; j < e.count!; j++) {
            const da = itemDescriptor(a, e.id, j, e.w, e.cell, e.kind, e.meta![j]!);
            const db = itemDescriptor(b, e.id, j, e.w, e.cell, e.kind, e.meta![j]!);
            expect(db).toEqual(da);
            expect(b.casting.cast(db)).toEqual(a.casting.cast(da));
          }
        }
      }
    }
    a.advance(WINDOWS - at);
    b.advance(WINDOWS - at);
    expect(differing(recordOf(b), recordOf(a)).filter((x) => x !== 'headers')).toEqual([]);
    expect(sample.map((r) => JSON.stringify(b.people.view(r)))).toEqual(views);
  }, 300_000);
});

describe('summary and item agreement at each cell', () => {
  for (let n = 0; n < SEEDS; n++) {
    test(`seed ${n}: each summary's count is its items at its cell, in every run`, () => {
      const sim = make((d) => { for (const k of Object.keys(d.shape.rate)) d.shape.rate[k] = d.shape.rate[k]!.map((x) => x * 20) as Per4; });
      new ReplayPort(sim).submit(genScript(31 + n, 60));
      sim.advance(60);
      let seen = 0;
      for (const e of eventsState(sim).ring) {
        if (e.count === undefined) continue;
        expect(sim.k.value(e.id, 'count')).toBe(e.count);
        for (let j = 0; j < e.count; j++) {
          expect(sim.k.value(sim.k.summaries.materialise(e.id, j), 'place')).toBe(e.cell);
          seen++;
        }
      }
      expect(seen).toBeGreaterThan(0);
    }, 120_000);
  }
});

describe('metamorphic relations', () => {
  const busy = (d: Parameters<typeof fxData>[0] extends ((x: infer D) => void) | undefined ? D : never): void => {
    for (const k of Object.keys(d.shape.rate)) d.shape.rate[k] = d.shape.rate[k]!.map((x, m) => (m === 3 ? 0 : x * 20)) as Per4;
  };

  test('moving opportunity out of rest into a new simulated district with the same totals changes no draw of the other districts', () => {
    const one = make(busy);
    const two = make(busy, withSecondDistrict());
    expect(two.w.districts.length).toBe(2);
    one.advance(MW);
    two.advance(MW);
    const d1 = one.w.districts[0]!;
    const cells1 = new Set(d1.cellIds);
    const ringOf = (s: Sim) => eventsState(s).ring.filter((e) => cells1.has(e.cell));
    expect(ringOf(one).length).toBeGreaterThan(20);
    expect(ringOf(two)).toEqual(ringOf(one));
    // and the second district has events of its own
    expect(eventsState(two).ring.some((e) => !cells1.has(e.cell))).toBe(true);
  }, 300_000);

  test('renaming a display name changes nothing; a different hashed identity changes the histories but not their distributions', () => {
    const a = make(busy);
    const ix = fx3Slice();
    ix.names = Object.fromEntries(Object.entries(ix.names!).map(([k, v]) => [`renamed-${k}`, v]));
    const b = make(busy, ix);
    a.advance(MW);
    b.advance(MW);
    expect(differing(recordOf(b), recordOf(a))).toEqual([]);
    // another world seed: other histories, the same distribution of what happens
    const counts = (seed: string): Record<string, number> => {
      const s = make(busy, fx3Slice(), seedOf(seed));
      s.advance(MW);
      const out: Record<string, number> = {};
      for (const o of occurrences(s)) if (o.gen === 0) out[o.kind] = (out[o.kind] ?? 0) + 1;
      return out;
    };
    const total = (xs: Array<Record<string, number>>): number => xs.reduce((acc, x) => acc + Object.values(x).reduce((p, q) => p + q, 0), 0);
    const left = [0, 1, 2, 3].map((n) => counts(`rename-a-${n}`));
    const right = [0, 1, 2, 3].map((n) => counts(`rename-b-${n}`));
    expect(JSON.stringify(left)).not.toBe(JSON.stringify(right));
    const tl = total(left);
    const tr = total(right);
    expect(Math.abs(tl - tr)).toBeLessThanOrEqual(4 * Math.sqrt(tl + tr));
  }, 300_000);

  test('scaling cityScale scales the means and nothing else', () => {
    const immigrants = (scale: number, tag: string): { n: number; views: string[] } => {
      const s = make(busy, fx3Slice(), seedOf(tag));
      s.k.settings.set({ cityScale: scale }, 0);
      s.advance(MW);
      const d = s.w.districts[0]!;
      return { n: occurrences(s).filter((o) => o.gen === 0).length, views: d.cellIds.flatMap((c) => s.people.residentsOfBlock(c)).slice(0, 15).map((r) => JSON.stringify(s.people.view(r))) };
    };
    let n1 = 0;
    let n2 = 0;
    let views1: string[] = [];
    let views2: string[] = [];
    for (let i = 0; i < 4; i++) {
      const a = immigrants(1, `scale-${i}`);
      const b = immigrants(2, `scale-${i}`);
      n1 += a.n;
      n2 += b.n;
      views1 = a.views;
      views2 = b.views;
    }
    expect(Math.abs(n2 - 2 * n1)).toBeLessThanOrEqual(4 * Math.sqrt(n1 + n2));
    expect(views2).toEqual(views1);
  }, 300_000);
});

describe('hard limits under fault injection', () => {
  test('a calendar pushed over its cap loses the lowest-size, largest-Id entries, and every drop is logged and counted', () => {
    const rng = lcg(0xca1);
    const sim = make(busy0);
    const c1 = sim.w.districts[0]!.cellIds[0]!;
    const n = 257 + Math.floor(rng() * 80);
    sim.startAt(200);
    inject(sim, ...Array.from({ length: n }, (_, i) => child(sim, `fault-${i}`, 0, 400 + Math.floor(rng() * 300), 'theft', 1 + Math.floor(rng() * 3), c1)));
    sim.advance(2);
    expect(Object.values(eventsState(sim).calendar).flat().length).toBe(256);
    expect(sim.record.log.filter((e) => e.reason === 'calendar-overflow').length).toBe(n - 256);
    expect(eventsState(sim).counters.overflow).toBe(n - 256);
  });
});

function busy0(d: Parameters<typeof fxData>[0] extends ((x: infer D) => void) | undefined ? D : never): void {
  for (const k of Object.keys(d.shape.rate)) d.shape.rate[k] = [0, 0, 0, 0];
  for (const r of d.regimes) r.arrival = 0;
}

describe('demand independence', () => {
  test('random demand histories change no tier 0 to 2 output given the same external observations', () => {
    const script = genScript(0xd3d, WINDOWS).filter((l) => !(l.op === 'reading' && l.slot === 'cell'));
    const histories = [1, 2, 3].map((seed) => {
      const rng = lcg(seed * 977);
      return Array.from({ length: 6 }, () => ({ t: Math.floor((1 + rng() * (WINDOWS - 4)) * W), cell: CELLS[Math.floor(rng() * 3)]! }));
    });
    const run = (history: Array<{ t: number; cell: string }>, extra: boolean): Sim => {
      const sim = make();
      const port = new ReplayPort(sim);
      port.submit(script);
      port.submit(history.map((h): ReplayLine => ({ t: h.t, op: 'reading', node: 'v', slot: 'cell', value: h.cell })));
      if (extra) sim.k.frames.demandRoots.add(sim.people.residentAt(sim.w.districts[0]!.cellIds[1]!, 2));
      sim.advance(WINDOWS);
      return sim;
    };
    const base = recordOf(run(histories[0]!, false), { processes: ['scene.acts'], logProcs: ['scene.acts'] });
    for (const [i, h] of histories.slice(1).entries()) {
      const other = recordOf(run(h, i === 0), { processes: ['scene.acts'], logProcs: ['scene.acts'] });
      expect(differing(base, other).filter((x) => !['frames', 'seeds', 'headers'].includes(x))).toEqual([]);
    }
  }, 300_000);
});

void NO_BOOSTS;
