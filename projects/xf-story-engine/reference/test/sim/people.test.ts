// SF1-P: the people (S1 4, 7.4, 14.1): the schema, the fit, rosters, regeneration, spells, routines.

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { H, s } from '../../src/id.ts';
import { ipf, ipfIterate, fitDistrict, personSeed } from '../../src/sim/fit.ts';
import { identityKeys } from '../../src/sim/keys.ts';
import { People } from '../../src/sim/people.ts';
import { HH_TYPES, N_PROFILES, profileIndex } from '../../src/sim/profile.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import { defaultData } from '../../src/sim/data.ts';
import { fxWorld, kabukiWorld } from './helpers.ts';

// Bun 1.4 gives the default set in test/setup.ts to the first test file only
setDefaultTimeout(120_000);

const cause = H(s('cause'), s('people'));
const FULL = process.env.S1_FULL === '1';

describe('SF1-P-0: the schema resolves', () => {
  const w = kabukiWorld('SF1-P-0');
  const people = new People(w, identityKeys(w.k.worldSeed));
  const d = w.districts[0]!;

  test(`${FULL ? '1,000' : '60'} households resolve with no defect (1,000 with S1_FULL=1); every resident age lies in its profile band and the class agrees`, () => {
    const want = FULL ? 1000 : 60;
    const k = w.k;
    let households = 0;
    let residents = 0;
    for (const c of d.cellIds.slice(0, 12)) {
      const info = people.blockInfo(c);
      for (let h = 0; h < info.households.length && households < want; h++) {
        households++;
        for (let j = 0; j < 6; j++) {
          const m = people.residentId(info.households[h]!, j);
          if (j >= info.sizes[h]!) {
            expect(k.value(info.households[h]!, `p${j}`)).toBe('none');
            continue;
          }
          k.address(info.households[h]!, `m${j}`);
          const v = people.view(m)!;
          residents++;
          const [lo, hi] = w.data.people.ageBands[v.aband]!;
          expect(v.age).toBeGreaterThanOrEqual(lo);
          expect(v.age).toBeLessThanOrEqual(hi);
          expect(v.ageClass).toBe(v.aband === 0 ? 'minor' : 'adult');
          expect(k.value(m, 'age-class')).toBe(v.ageClass);
        }
      }
    }
    expect(households).toBe(want);
    expect(residents).toBeGreaterThan(want * 2);
    expect(k.defects.items).toEqual([]);
  }, 120_000);

  test("a pin on a resident's profile narrows its household's slot (S0 6.4)", () => {
    const k = w.k;
    const c = d.cellIds[3]!;
    const info = people.blockInfo(c);
    const h = info.households.findIndex((_hh, i) => info.sizes[i] === 1);
    expect(h).toBeGreaterThanOrEqual(0);
    const hh = info.households[h]!;
    const m0 = people.residentId(hh, 0);
    k.address(hh, 'm0');
    const want = String(profileIndex(3, 4, 1, 0)); // 35 to 44, a labourer, low income, civilian
    k.pin({ node: m0, slot: 'profile', value: want, reason: 'committed', cause });
    expect(k.value(hh, 'p0')).toBe(want);
    expect(k.resolve(m0, 'profile', 0)).toEqual({ value: want, status: 'ok' });
    const age = k.value(m0, 'age') as number;
    expect(age).toBeGreaterThanOrEqual(35);
    expect(age).toBeLessThanOrEqual(44);
    // A pin on a unary view of the profile narrows it too, through the owner.
    const other = info.households.findIndex((x, i) => info.sizes[i] === 1 && x !== hh);
    const hh2 = info.households[other]!;
    const m02 = k.address(hh2, 'm0');
    k.pin({ node: m02, slot: 'aband', value: 6, reason: 'authored', cause });
    expect(people.view(m02)!.aband).toBe(6);
  });
});

describe('SF1-P-1: IPF by hand', () => {
  test('seed [[2,1],[1,2]], rows [0.7,0.3], columns [0.4,0.6], 20 iterations', () => {
    const t = ipf([2, 1, 1, 2], [2, 2], [[0.7, 0.3], [0.4, 0.6]], 20, 2 ** -30);
    expect(t[0]).toBeCloseTo(0.34213, 5);
    expect(t[1]).toBeCloseTo(0.35787, 5);
    expect(t[2]).toBeCloseTo(0.05787, 5);
    expect(t[3]).toBeCloseTo(0.24213, 5);
    expect(Math.abs(t[0]! + t[2]! - 0.4)).toBeLessThan(1e-9);
    expect(Math.abs(t[1]! + t[3]! - 0.6)).toBeLessThan(1e-9);
    expect(Math.abs(t[0]! + t[1]! - 0.7)).toBeLessThan(1e-9);
  });
});

describe('SF1-P-2: a district fit', () => {
  test('FX-3: after 20 iterations the dimension fitted last is within 1e-9 and every other marginal within 1e-6 (S1 v0.3), w = t / max(t) has maximum 1, the household table has 60 cells', () => {
    const ix = fx3Slice();
    const d = Object.values(ix.districts)[0]!;
    const fit = fitDistrict(d, defaultData());
    expect(fit.person.length).toBe(N_PROFILES);
    expect(fit.household.length).toBe(60);
    const marg = (t: number[], dimStride: number, dimSize: number): number[] => {
      const out = new Array(dimSize).fill(0) as number[];
      t.forEach((v, x) => { out[Math.floor(x / dimStride) % dimSize]! += v; });
      return out;
    };
    const norm = (a: number[]): number[] => a.map((x) => x / a.reduce((p, q) => p + q, 0));
    const check = (got: number[], want: number[], tol: number): void => got.forEach((g, i) => expect(Math.abs(g - norm(want)[i]!)).toBeLessThan(tol));
    // After the 20 iterations the dimension fitted last is within 1e-9 and the others within 1e-6: iterative proportional fitting converges at a finite rate.
    const raw = ipfIterate(personSeed(d, defaultData()), [8, 12, 4, 6], [d.marginals.age, d.marginals.role, d.marginals.income, d.marginals.aff], 20);
    const rawSum = raw.reduce((a, b) => a + b, 0);
    const rawNorm = raw.map((x) => x / rawSum);
    check(marg(rawNorm, 1, 6), d.marginals.aff, 1e-9);
    check(marg(rawNorm, 288, 8), d.marginals.age, 1e-6);
    check(marg(rawNorm, 24, 12), d.marginals.role, 1e-6);
    check(marg(rawNorm, 6, 4), d.marginals.income, 1e-6);
    // The floor raises every empty cell to 2^-30, which moves a marginal by up to about 2e-6.
    check(marg(fit.person, 1, 6), d.marginals.aff, 5e-6);
    check(marg(fit.household, 12, 5), d.marginals.household.type, 1e-8);
    expect(Math.max(...fit.personWeights)).toBe(1);
    expect(Math.max(...fit.householdWeights)).toBe(1);
    const sum = fit.person.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-12);
    expect(HH_TYPES.length).toBe(5);
    expect(fit.meanHH).toBeGreaterThan(1.5);
  });
});

describe('SF1-P-4: rosters', () => {
  // the spec's sample is 10,000 households; a Kabuki stand-in has about 3,500, so the long profile draws worlds of other seeds until it has them
  const SAMPLE = FULL ? 10_000 : 160;
  test(`${FULL ? '10,000' : 'about 160'} households (10,000 with S1_FULL=1): none beyond the size; a family child is two bands younger than member 0; crew share an affiliation; a couple is within one band`, () => {
    const seen = { family: 0, crew: 0, couple: 0 };
    let examined = 0;
    for (let n = 0; examined < SAMPLE; n++) {
      expect(n).toBeLessThan(20);
      const w = kabukiWorld(n === 0 ? 'SF1-P-4' : `SF1-P-4-${n}`);
      const people = new People(w, identityKeys(w.k.worldSeed));
      const k = w.k;
      for (const c of w.districts[0]!.cellIds) {
        const info = people.blockInfo(c);
        for (let h = 0; h < info.households.length && examined < SAMPLE; h++) {
          examined++;
          const hh = info.households[h]!;
          const type = Math.floor(Number(k.value(hh, 'hprofile')) / 12);
          const v = (j: number) => {
            k.address(hh, `m${j}`);
            return people.view(people.residentId(hh, j))!;
          };
          const size = info.sizes[h]!;
          for (let j = size; j < 6; j++) expect(k.value(hh, `p${j}`)).toBe('none');
          if (type === 2) {
            seen.family++;
            const b0 = v(0).aband;
            for (let j = 2; j < size; j++) expect(b0 - v(j).aband).toBeGreaterThanOrEqual(2);
          }
          if (type === 4) {
            seen.crew++;
            for (let j = 1; j < size; j++) expect(v(j).affc).toBe(v(0).affc);
            expect([2, 3, 4]).toContain(v(0).affc);
          }
          if (type === 1) {
            seen.couple++;
            expect(size).toBe(2);
            expect(Math.abs(v(0).aband - v(1).aband)).toBeLessThanOrEqual(1);
          }
        }
        if (examined >= SAMPLE) break;
      }
    }
    // the sample is the size the fixture says, and each kind of household is in it
    expect(examined).toBe(SAMPLE);
    expect(seen.family).toBeGreaterThan(FULL ? 300 : 12);
    expect(seen.crew).toBeGreaterThan(FULL ? 60 : 1);
    expect(seen.couple).toBeGreaterThan(FULL ? 150 : 6);
  }, 600_000);
});

describe('SF1-P-5: residents are regenerated', () => {
  test('resolve the residents, forget the world, resolve again: the same profiles, ages and names; and again after a reload', () => {
    People.shared = false;
    try {
      const w = fxWorld('SF1-P-5');
      const people = new People(w, identityKeys(w.k.worldSeed));
      const k = w.k;
      const d = w.districts[0]!;
      const grab = (): string[] => {
        const out: string[] = [];
        for (const c of d.cellIds) {
          for (const r of people.residentsOfBlock(c)) {
            const v = people.view(r)!;
            out.push([r, v.profile, v.age, v.archetype, v.life, v.sociability, k.value(k.address(r, 'name'), 'display')].join('|'));
          }
        }
        return out;
      };
      const first = grab();
      expect(first.length).toBeGreaterThanOrEqual(50);
      people.dropCaches();
      k.retention.scheduleSweep();
      k.settle();
      k.invalidateCaches();
      expect(grab()).toEqual(first);
      k.persistence.save('A');
      k.persistence.load('A');
      people.dropCaches();
      expect(grab()).toEqual(first);
    } finally {
      People.shared = true;
    }
  });
});

describe('SF1-P-6: spells', () => {
  const w = fxWorld('SF1-P-6');
  const people = new People(w, identityKeys(w.k.worldSeed));
  test('the table: work track, age band 3', () => {
    expect(people.lenQ('work', 0, 3, 0)).toBe(12_096_000);
    expect(people.lenQ('work', 0, 3, 15)).toBe(120_960_000);
    expect(people.lenQ('health', 1, 0, 0)).toBe(4 * 0.6 * 0.2 * 86400);
  });
  test('a walk to day 20 and to day 2,000 is at most 64 steps and identical after the caches go', () => {
    const d = w.districts[0]!;
    const r = people.residentsOfBlock(d.cellIds[0]!)[0]!;
    const v = people.view(r)!;
    const a = people.stateAt(v, 'work', 20 * 86400);
    const b = people.stateAt(v, 'work', 2000 * 86400);
    expect(b.k).toBeLessThan(64);
    expect(a.start).toBeLessThanOrEqual(20 * 86400);
    expect(a.end).toBeGreaterThan(20 * 86400);
    expect(b.start).toBeLessThanOrEqual(2000 * 86400);
    expect(b.end).toBeGreaterThan(2000 * 86400);
    people.dropCaches();
    expect(people.stateAt(people.view(r)!, 'work', 2000 * 86400)).toEqual(b);
    expect(people.stateAt(people.view(r)!, 'work', 20 * 86400)).toEqual(a);
    // The state alternates and starts at or before time 0.
    expect(people.stateAt(v, 'work', 0).start).toBeLessThanOrEqual(0);
  });
  test('a walk past the limit holds the last state and records walk-limit', () => {
    const seen: string[] = [];
    people.hooks = { closed: () => false, isSpine: () => false, defect: (k) => seen.push(k) };
    const d = w.districts[0]!;
    const v = people.view(people.residentsOfBlock(d.cellIds[0]!)[0]!)!;
    const far = people.stateAt(v, 'health', 1e12);
    expect(seen).toContain('walk-limit');
    expect(far.k).toBe(63);
    people.hooks = { closed: () => false, isSpine: () => false, defect: () => {} };
  });
});

describe('SF1-P-7: where', () => {
  const w = fxWorld('SF1-P-7');
  const people = new People(w, identityKeys(w.k.worldSeed));
  const k = w.k;
  const d = w.districts[0]!;
  const all = d.cellIds.flatMap((c) => people.residentsOfBlock(c));

  test('a protected resident is never away; an ill one is away with cause ill; the answers do not depend on how time is reached', () => {
    const seed = k.root('pack:test', 'core:seed');
    k.retention.setSeed({ id: seed, state: {}, nodes: [] });
    const target = all[3]!;
    k.addEdge({ type: 'core:cast', from: seed, to: target, data: { role: 'x' }, cause });
    for (let step = 0; step < 4320; step += 7) {
      const wh = people.where(target, step * 600);
      expect(wh.cls).not.toBe('away');
      expect(wh.cause).toBe('protected-present');
    }
    expect(people.protectedSet(target)).toBe(true);
    // find an ill resident
    let ill: { r: string; t: number } | undefined;
    for (const r of all) {
      if (r === target) continue;
      const v = people.view(r)!;
      for (let day = 0; day < 400 && !ill; day += 10) {
        if (people.stateAt(v, 'health', day * 86400).state === 1) ill = { r, t: day * 86400 };
      }
      if (ill) break;
    }
    expect(ill).toBeDefined();
    const wh = people.where(ill!.r, ill!.t);
    expect(wh).toEqual({ cls: 'away', cause: 'ill' });
    // a jump of 30 days and 4,320 single steps give the same answer: where is a pure function of the time
    const direct = people.where(ill!.r, ill!.t + 30 * 86400);
    people.dropCaches();
    let stepped = people.where(ill!.r, ill!.t);
    for (let n = 1; n <= 4320; n++) stepped = people.where(ill!.r, ill!.t + n * 600);
    expect(stepped).toEqual(direct);
  });

  test('the period of a time is the spec formula', () => {
    for (let t = 0; t < 3 * 86400; t += 997) {
      const sod = ((t % 86400) + 86400) % 86400;
      expect(people.periodOf(t)).toBe((Math.floor(sod / 21600) + 3) % 4);
    }
    expect(people.weekday(0)).toBe(0);
    expect(people.weekday(7 * 86400 - 1)).toBe(6);
  });

  test('a resident dies of age or of a story event, and only then', () => {
    const r = all[10]!;
    const v = people.view(r)!;
    const ageDeath = (v.deathAge - v.age) * 31_557_600;
    expect(people.alive(r, 0)).toBe(true);
    expect(people.alive(r, ageDeath - 1)).toBe(true);
    expect(people.alive(r, ageDeath)).toBe(false);
    const r2 = all[11]!;
    k.pin({ node: r2, slot: 'died', value: 5000, reason: 'committed', cause });
    expect(people.alive(r2, 4999)).toBe(true);
    expect(people.alive(r2, 5000)).toBe(false);
  });

  test('presentAt: alive, not away, in the cell; cut by the keyed priority', () => {
    const t = 12 * 3600 + 5;
    const cell = d.cellIds[1]!;
    const here = people.presentAt(cell, t, 60);
    for (const r of here) {
      expect(people.alive(r, t)).toBe(true);
      expect(people.where(r, t).cell).toBe(cell);
    }
    const capped = people.presentAt(cell, t, 3);
    expect(capped.length).toBe(Math.min(3, here.length));
    expect(people.presentAt(cell, t, 3)).toEqual(capped);
  });
});
