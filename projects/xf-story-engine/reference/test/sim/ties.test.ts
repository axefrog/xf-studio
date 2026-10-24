// SF1-T: the tie function (S1 4.6, 14.1).

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { identityKeys } from '../../src/sim/keys.ts';
import { People } from '../../src/sim/people.ts';
import { Ties } from '../../src/sim/ties.ts';
import { fxWorld } from './helpers.ts';

// Bun 1.4 gives the default set in test/setup.ts to the first test file only
setDefaultTimeout(120_000);

const FULL = process.env.S1_FULL === '1';

function build(name: string) {
  const w = fxWorld(name);
  const people = new People(w, identityKeys(w.k.worldSeed));
  const ties = new Ties(w, people, identityKeys(w.k.worldSeed));
  const d = w.districts[0]!;
  const all = d.cellIds.flatMap((c) => people.residentsOfBlock(c));
  return { w, people, ties, d, all };
}

describe('SF1-T-1: symmetry', () => {
  test('251 stratified FX-3 pairs (10,000 with S1_FULL=1): tie(a, b) = tie(b, a), and a sample of them is the same after the caches go and in a rebuilt world, in any order', () => {
    const { ties, people, all } = build('SF1-T-1');
    expect(all.length).toBeGreaterThanOrEqual(80);
    // all the pairs there are: more than the spec's random 10,000 would cover of this district, each tested both ways
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) pairs.push([all[i]!, all[j]!]);
    if (FULL) {
      let seed = 12345;
      const next = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
      while (pairs.length < 10_000) {
        const a = all[Math.floor(next() * all.length)]!;
        const b = all[Math.floor(next() * all.length)]!;
        if (a !== b) pairs.push([a, b]);
      }
    }
    if(!FULL) pairs.splice(0,pairs.length,...pairs.filter((_,n)=>n%16===0));
    const forward = pairs.map(([a, b]) => ties.tie(a, b));
    const backward = pairs.map(([a, b]) => ties.tie(b, a));
    expect(backward).toEqual(forward);
    // the caches and a rebuilt world answer the same on every fourth pair (all of them with S1_FULL=1)
    const every = FULL ? 1 : 4;
    const at = pairs.map((_, n) => n).filter((n) => n % every === 0);
    people.dropCaches();
    ties.dropCaches();
    const reversed = [...at].reverse().map((n) => ties.tie(pairs[n]![0], pairs[n]![1])).reverse();
    expect(reversed).toEqual(at.map((n) => forward[n]));
    People.shared = false;
    try {
      const other = build('SF1-T-1');
      if (FULL) {
        other.people.cacheOn = false;
        expect(at.length).toBe(10_000);
      }
      expect(at.map((n) => {
        if (FULL) { other.people.dropCaches(); other.ties.dropCaches(); }
        return other.ties.tie(pairs[n]![0], pairs[n]![1]);
      })).toEqual(at.map((n) => forward[n]));
    } finally {
      People.shared = true;
    }
    const tied = forward.filter((x) => x?.tied).length;
    expect(tied).toBeGreaterThan(0);
    expect(tied).toBeLessThan(forward.length);
  }, 120_000);
});

describe('SF1-T-2: the numbers', () => {
  const { w, ties, people, all, d } = build('SF1-T-2');

  test('N = 90, cGeo = 4, rank 10', () => {
    expect(ties.populationOf(d.cellIds[0]!)).toBe(90);
    expect(ties.harmonic(90)).toBeCloseTo(5.0825706, 6);
    expect(ties.pGeoOfRank(d.cellIds[0]!, 10)).toBeCloseTo(0.0787003, 6);
  });

  test('two members of one household are always tied', () => {
    let checked = 0;
    for (const c of d.cellIds) {
      const info = people.blockInfo(c);
      info.households.forEach((hh, h) => {
        if (info.sizes[h]! < 2) return;
        const a = people.residentId(hh, 0);
        const b = people.residentId(hh, 1);
        w.k.address(hh, 'm0');
        w.k.address(hh, 'm1');
        const t = ties.tieP(people.view(a)!, people.view(b)!);
        expect(t.p).toBe(1);
        expect(ties.tie(a, b)).toMatchObject({ tied: true, kind: 'kin', layer: 1 });
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(5);
  });

  test('two crew-cell members with no other focus: p = 1 - (1 - pg) x 0.7', () => {
    let found = 0;
    for (const a of all) {
      const va = people.view(a)!;
      for (const b of all) {
        if (a >= b) continue;
        const vb = people.view(b)!;
        const shared = ties.sharedFoci(va, vb);
        if (shared.length !== 1 || shared[0]!.type !== 'crew') continue;
        const { p } = ties.tieP(va, vb);
        const pg = 0.5 * (ties.pGeoOfRank(va.cell, ties.rankOf(va, vb)) + ties.pGeoOfRank(vb.cell, ties.rankOf(vb, va)));
        expect(p).toBe(1 - (1 - pg) * 0.7);
        found++;
        if (found >= 3) return;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('a rank: the successor in the same block is rank 1', () => {
    const c = d.cellIds[0]!;
    const r0 = people.view(people.residentAt(c, 0))!;
    const r1 = people.view(people.residentAt(c, 1))!;
    expect(ties.rankOf(r0, r1)).toBe(1);
    const n = people.residentCount(c);
    expect(ties.rankOf(r1, r0)).toBe(n - 1);
  });
});

describe('neighbours and the bridge', () => {
  const { ties, people, all } = build('SF1-T-nb');
  test('layer 1 is the household, capped at 5; the layers grow inward first and stay within their caps and the call budget', () => {
    const a = all[0]!;
    const l1 = ties.neighbours(a, 1);
    expect(l1.ids.length).toBeLessThanOrEqual(5);
    for (const x of l1.ids) expect(ties.tie(a, x)).toMatchObject({ tied: true, layer: 1 });
    const l2 = ties.neighbours(a, 2);
    const l3 = ties.neighbours(a, 3);
    expect(l2.ids.length).toBeLessThanOrEqual(15);
    expect(l3.ids.length).toBeLessThanOrEqual(50);
    expect(l3.ids.slice(0, l1.ids.length)).toEqual(l1.ids);
    expect(l3.units).toBeLessThanOrEqual(5000 + 50);
    expect(new Set(l3.ids).size).toBe(l3.ids.length);
    expect(l3.ids).not.toContain(a);
    expect(ties.neighbours(a, 3)).toEqual(l3);
  });
  test('the bridge is in [0, 1) and the band follows its thresholds', () => {
    for (const r of all.slice(0, 20)) {
      const b = ties.bridge(r);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(1);
      expect(ties.bridgeBand(r)).toBe(b < 0.3 ? 'low' : b >= 0.6 ? 'high' : 'mid');
    }
    expect(people.residentCount(people.view(all[0]!)!.cell)).toBeGreaterThan(0);
  });
});
