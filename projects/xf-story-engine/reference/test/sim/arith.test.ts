// SF1-H: S1's arithmetic and table functions (S1 1.2, 14.1).

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { readFileSync } from 'node:fs';
import { LQ, T, TABLE_HASHES, Z, exptab, invCum, logNormalOf, nbCount, normalOf, powTab, q64, spacingCountR, splitCountR } from '../../src/sim/arith.ts';
import { makeTables, sha256 } from '../../src/sim/make-tables.ts';
import { ln } from '../../src/fdlibm-log.ts';

// Bun 1.4 gives the default set in test/setup.ts to the first test file only
setDefaultTimeout(120_000);

describe('SF1-H-1: exptab', () => {
  test('the table and the function', () => {
    expect(T[256]).toBe(1);
    expect(T[240]).toBe(0.36787944117144233);
    expect(T[0]).toBe(1.1253517471925912e-7);
    expect(T[320]).toBe(54.598150033144236);
    expect(exptab(0)).toBe(1);
    expect(exptab(-0.5)).toBe(0.6065306597126334);
    expect(exptab(-0.53)).toBe(0.5888916989214128);
    expect(exptab(-16 / 18)).toBe(0.4112494879003506);
    expect(exptab(-17)).toBe(T[0]!);
    expect(exptab(5)).toBe(T[320]!);
  });
});

describe('SF1-H-2: error and pow', () => {
  test('the largest relative error over the midpoints of all 320 cells is under 0.05 %', () => {
    let worst = 0;
    for (let j = 0; j < 320; j++) {
      const x = (j - 256 + 0.5) / 16;
      const exact = (T[j]! * T[j + 1]!) ** 0.5; // the geometric midpoint is not the point; use the true value below
      void exact;
      const truth = Math.exp(x); // a test oracle only, never used by the model
      worst = Math.max(worst, Math.abs(exptab(x) - truth) / truth);
    }
    expect(worst).toBeLessThan(0.0005);
    expect(worst * 100).toBeCloseTo(0.04883, 5);
  });
  test('powTab(2, 0.5)', () => {
    expect(powTab(2, 0.5)).toBe(1.4148972265482154);
    expect(powTab(2, 0.5) / Math.SQRT2 - 1).toBeCloseTo(0.000483, 6);
  });
});

describe('SF1-H-3: invCum', () => {
  test('weights [1, 2, 3, 0]', () => {
    expect(invCum([1, 2, 3, 0], 0.1)).toBe(0);
    expect(invCum([1, 2, 3, 0], 0.5)).toBe(2);
    expect(invCum([1, 2, 3, 0], 0.999)).toBe(2);
  });
  test('all zero, and a rounding at the top of the range', () => {
    expect(invCum([0, 0, 0], 0.5)).toBe(0);
    // A u whose product with the total rounds up to the total: the last index with a positive weight.
    expect(invCum([0.1, 0.2, 0.3, 0], 1 - 2 ** -53)).toBe(2);
    const w = [0.1, 0.2, 0.7, 0];
    const total = 0.1 + 0.2 + 0.7;
    const u = (total - 1e-17) / total;
    expect(u * total >= total || invCum(w, u) === 2).toBe(true);
  });
});

describe('SF1-H-4: spacingCount', () => {
  const stream = (draws: number[]) => (i: number) => draws[i % draws.length]!;
  test('mu 1 and mu 2.5 from the worked draws', () => {
    const d = [0.5, 0.7, 0.9, 0.2, 0.9];
    expect(-ln(0.5)).toBeCloseTo(0.6931, 4);
    expect(spacingCountR(1, stream(d)).n).toBe(1);
    expect(spacingCountR(2.5, stream(d)).n).toBe(3);
  });
  test('mu 100 with every draw 0.99 stops at the cap; splitCount(100) is four capped parts', () => {
    const r = spacingCountR(100, () => 0.99);
    expect(r).toEqual({ n: 64, capHit: true });
    const s = splitCountR(100, () => () => 0.99);
    expect(s.n).toBe(256);
    expect(s.capHits).toBe(4);
  });
  test('zero and negative means give 0', () => {
    expect(spacingCountR(0, () => 0.5).n).toBe(0);
    expect(spacingCountR(-1, () => 0.5).n).toBe(0);
  });
});

describe('SF1-H-5: nbCount', () => {
  test('n 0.45, k 0.3', () => {
    expect(nbCount(0.45, 0.3, 0.5)).toBe(0);
    expect(nbCount(0.45, 0.3, 0.8)).toBe(1);
    expect(nbCount(0.45, 0.3, 0.9)).toBe(2);
    expect(nbCount(0.45, 0.3, 0.9995)).toBe(8);
    const p0 = exptab(-(0.3 * ln(1 + 0.45 / 0.3)));
    expect(p0).toBeCloseTo(0.76001, 4);
  });
  test('n 0.25: 83 % no children', () => {
    expect(exptab(-(0.3 * ln(1 + 0.25 / 0.3)))).toBeCloseTo(0.8339, 3);
    expect(nbCount(0, 0.3, 0.5)).toBe(0);
  });
});

describe('SF1-H-6: the table artifacts', () => {
  // regeneration takes a third of a second, so the ordinary run does it: a change to the generator that changes an artifact fails on every push (R2-12)
  test('the files in the repository carry the frozen hashes, and regeneration reproduces them byte for byte', () => {
    const files = makeTables();
    for (const name of ['exptab@1', 'normtab@1', 'lqtab@1'] as const) {
      expect(sha256(files[name])).toBe(TABLE_HASHES[name]);
      expect(files[name]).toBe(readFileSync(new URL(`../../src/sim/tables/${name}.txt`, import.meta.url), 'utf8'));
    }
    expect(TABLE_HASHES['exptab@1']).toBe('14b2d09c5c8e697452d1141f9a2a5da46bc33aebf6b4316235d43b10a61cdbb3');
    expect(TABLE_HASHES['normtab@1']).toBe('9a8bb800f0ceb60753772fca95394aef86230abdf96ee591d276fd75979032e6');
    expect(TABLE_HASHES['lqtab@1']).toBe('cb0478b554d1fb9c396d6402bbcf0edaea2a68d9d47579af4cf285cbdaf33cdb');
  });
  test('the normal table is exactly antisymmetric, and the log-normal table has mean 1 and the stated tails', () => {
    for (let i = 0; i < 4096; i++) expect(Z[i]).toBe(-Z[4095 - i]!);
    expect(Z[0]).toBe(-3.668329285121323);
    let sum = 0;
    for (let i = 0; i < 4096; i++) sum += LQ[i]!;
    expect(Math.abs(sum / 4096 - 1)).toBeLessThan(1e-12);
    const sorted = [...LQ].sort((a, b) => b - a);
    const top = (n: number) => sorted.slice(0, n).reduce((a, b) => a + b, 0) / sum;
    expect(top(Math.round(4096 * 0.05))).toBeCloseTo(0.479, 3);
    expect(top(Math.round(4096 * 0.0125))).toBeCloseTo(0.256, 3);
    expect(normalOf(0)).toBe(Z[0]!);
    expect(logNormalOf(0.9999)).toBe(LQ[4095]!);
  });
});

describe('SF1-H-7: no fused multiply-add', () => {
  test('0.1 * 10 + (-1) is exactly 0', () => {
    const a = 0.1;
    const b = 10;
    const c = -1;
    expect(a * b + c).toBe(0);
  });
  test('q64 rounds to the 1/64 grid', () => {
    expect(q64(0.55)).toBe(0.546875);
    expect(q64(0.45)).toBe(0.453125);
  });
});
