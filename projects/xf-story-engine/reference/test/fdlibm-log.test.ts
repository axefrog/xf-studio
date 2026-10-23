import { describe, expect, test } from 'bun:test';
import { LOG_CONSTANTS, ln } from '../src/fdlibm-log.ts';

const view = new DataView(new ArrayBuffer(8));
function bitsOf(x: number): bigint {
  view.setFloat64(0, x, false);
  return view.getBigUint64(0, false);
}
/** Distance in units in the last place between two finite doubles of the same sign class. */
function ulpDistance(a: number, b: number): bigint {
  const ord = (x: number): bigint => {
    const bits = bitsOf(x);
    return bits & 0x8000000000000000n ? -(bits & 0x7fffffffffffffffn) : bits;
  };
  const d = ord(a) - ord(b);
  return d < 0n ? -d : d;
}

describe('fdlibm ln (spec 1.3)', () => {
  test('the decimal constants carry the bit patterns the C source states', () => {
    for (const [name, value, hex] of LOG_CONSTANTS) {
      expect(bitsOf(value).toString(16).padStart(16, '0'), name).toBe(hex);
    }
  });

  test('special points are exact', () => {
    expect(Object.is(ln(1), 0)).toBe(true);
    expect(ln(0)).toBe(-Infinity);
    expect(ln(-0)).toBe(-Infinity);
    expect(ln(-1)).toBeNaN();
    expect(ln(NaN)).toBeNaN();
    expect(ln(Infinity)).toBe(Infinity);
    expect(ln(-Infinity)).toBeNaN();
  });

  test('powers of two follow the specified reduction exactly', () => {
    const ln2_hi = 6.93147180369123816490e-01;
    const ln2_lo = 1.90821492927058770002e-10;
    for (let k = -1074; k <= 1023; k++) {
      const x = 2 ** k;
      if (x === 0) continue;
      expect(ln(x), `2^${k}`).toBe(k === 0 ? 0 : k * ln2_hi + k * ln2_lo);
      expect(Number(ulpDistance(ln(x), Math.log(x))), `2^${k} vs Math.log`).toBeLessThanOrEqual(1);
    }
    expect(ln(2)).toBe(Math.LN2);
  });

  test('edges of the double range', () => {
    expect(Number(ulpDistance(ln(Number.MIN_VALUE), Math.log(Number.MIN_VALUE)))).toBeLessThanOrEqual(1);
    expect(ln(Number.MIN_VALUE)).toBeCloseTo(-744.4400719213812, 9);
    expect(Number(ulpDistance(ln(Number.MAX_VALUE), Math.log(Number.MAX_VALUE)))).toBeLessThanOrEqual(1);
    expect(ln(Number.MAX_VALUE)).toBeCloseTo(709.782712893384, 9);
    const minNormal = 2 ** -1022;
    expect(Number(ulpDistance(ln(minNormal), Math.log(minNormal)))).toBeLessThanOrEqual(1);
    const maxSub = minNormal - Number.MIN_VALUE;
    expect(Number(ulpDistance(ln(maxSub), Math.log(maxSub)))).toBeLessThanOrEqual(1);
    // Around 1, where the |f| < 2^-20 branch applies.
    for (const d of [1e-17, 1e-12, 1e-9, 1e-7, 9.5e-7, 1.1e-6, 1e-5]) {
      for (const x of [1 + d, 1 - d]) {
        expect(Number(ulpDistance(ln(x), Math.log(x))), `x = ${x}`).toBeLessThanOrEqual(1);
      }
    }
  });

  test('within 1 ulp of Math.log over a broad sample', () => {
    // A small deterministic generator, so the sample is the same on every run.
    let state = 0x9e3779b97f4a7c15n;
    const next = (): bigint => {
      state ^= state << 13n;
      state &= 0xffffffffffffffffn;
      state ^= state >> 7n;
      state ^= state << 17n;
      state &= 0xffffffffffffffffn;
      return state;
    };
    let worst = 0n;
    let exact = 0;
    const n = 40000;
    for (let c = 0; c < n; c++) {
      // Random bit patterns give a log-uniform spread over the whole positive range.
      let bits = next() & 0x7fffffffffffffffn;
      if (c % 4 === 0) bits = (0x3fe0000000000000n + (next() & 0x001fffffffffffffn)) & 0x7fffffffffffffffn; // near 1
      if (c % 8 === 1) bits = bits & 0x000fffffffffffffn; // subnormals
      view.setBigUint64(0, bits, false);
      const x = view.getFloat64(0, false);
      if (!(x > 0) || !Number.isFinite(x)) continue;
      const d = ulpDistance(ln(x), Math.log(x));
      if (d > worst) worst = d;
      if (d === 0n) exact++;
    }
    expect(Number(worst)).toBeLessThanOrEqual(1);
    expect(exact).toBeGreaterThan(n / 2); // fdlibm is almost always the correctly rounded result
  });

  test('the draw path: ln over the open unit interval never meets 0 or 1', () => {
    const lo = 0.5 / 2 ** 52;
    const hi = (2 ** 52 - 0.5) / 2 ** 52;
    expect(hi < 1).toBe(true);
    expect(Number.isFinite(ln(lo))).toBe(true);
    expect(ln(hi)).toBeLessThan(0);
    expect(-ln(hi)).toBeGreaterThan(0);
    expect(Number.isFinite(-ln(-ln(hi)))).toBe(true);
    expect(Number.isFinite(-ln(-ln(lo)))).toBe(true);
  });
});
