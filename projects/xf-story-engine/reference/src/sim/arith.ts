// S1's arithmetic and table functions (S1 1.2): the exact, table-based sampling the simulation layer is allowed beyond
// S0's `+ - * /`, `sqrt`, comparisons, `floor` and fdlibm `ln`.
//
// Two rules hold for every S1 computation. No fused multiply-add: `a * b + c` is two roundings, in that order. Fixed
// order: loops run in the order written, a sum over a set runs in `Id` order, a product runs left to right. Nothing here
// calls `Math.exp`, `Math.pow`, `Math.log` or any gamma function (the arithmetic audit looks for them).

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ln } from '../fdlibm-log.ts';

/** The SHA-256 of each frozen table artifact (S1 1.2). A table version never changes in place. */
export const TABLE_HASHES = {
  'exptab@1': '14b2d09c5c8e697452d1141f9a2a5da46bc33aebf6b4316235d43b10a61cdbb3',
  'normtab@1': '9a8bb800f0ceb60753772fca95394aef86230abdf96ee591d276fd75979032e6',
  'lqtab@1': 'cb0478b554d1fb9c396d6402bbcf0edaea2a68d9d47579af4cf285cbdaf33cdb',
} as const;
export type TableName = keyof typeof TABLE_HASHES;

/** The sigma baked into `lqtab@1`. A pack naming another sigma is refused (SF1-H-6). */
export const LQ_SIGMA = 1.6;

function loadTable(name: TableName, length: number): Float64Array {
  const text = readFileSync(new URL(`./tables/${name}.txt`, import.meta.url), 'utf8');
  const hash = createHash('sha256').update(text).digest('hex');
  if (hash !== TABLE_HASHES[name]) throw new Error(`table ${name} does not match its frozen hash (${hash})`);
  const lines = text.split('\n');
  if (lines.pop() !== '' || lines.length !== length) throw new Error(`table ${name} has ${lines.length} entries, not ${length}`);
  const out = new Float64Array(length);
  const dv = new DataView(new ArrayBuffer(8));
  lines.forEach((line, i) => {
    dv.setBigUint64(0, BigInt(`0x${line}`));
    out[i] = dv.getFloat64(0);
  });
  return out;
}

/** T[j] = e^((j - 256) / 16), j = 0 ... 320. */
export const T: Float64Array = loadTable('exptab@1', 321);
/** Z[i] = the inverse normal CDF of (i + 0.5) / 4096. */
export const Z: Float64Array = loadTable('normtab@1', 4096);
/** LQ[i] = e^(sigma Z[i]) / mean_j e^(sigma Z[j]): a log-normal quantile table with mean 1. */
export const LQ: Float64Array = loadTable('lqtab@1', 4096);

/** e^x on a grid of step 1/16 from -16 to 4, linear interpolation. Relative error below 0.0489 %. */
export function exptab(x: number): number {
  const c = x < -16 ? -16 : x > 4 ? 4 : x;
  const u = (c + 16) * 16; // exact
  let j = Math.floor(u);
  if (j > 319) j = 319;
  const f = u - j; // exact
  return T[j]! + (T[j + 1]! - T[j]!) * f; // two roundings, in this order
}

export const powTab = (a: number, b: number): number => exptab(b * ln(a)); // a > 0

/** The kernel's 1/64 grid; x * 64 is exact. */
export const q64 = (x: number): number => Math.floor(x * 64 + 0.5) / 64;
export const clip01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Choosing from a table (inverse cumulative sum). Returns an index; `u` is in (0, 1). Ties go to the lower index. */
export function invCum(w: readonly number[], u: number): number {
  let total = 0;
  const cum: number[] = [];
  for (let i = 0; i < w.length; i++) {
    total = total + w[i]!;
    cum.push(total);
  }
  const target = u * total;
  for (let i = 0; i < w.length; i++) if (target < cum[i]!) return i;
  for (let i = w.length - 1; i >= 0; i--) if (w[i]! > 0) return i; // rounding at the very top of the range
  return 0;
}

/** The result of a count draw, and whether it stopped at its cap (the caller logs `cap-hit`). */
export interface CountResult {
  n: number;
  capHit: boolean;
}

/** Counts: the exponential-spacing form of a Poisson draw. It uses `ln` and addition only. */
export function spacingCountR(mu: number, draw: (i: number) => number, cap = 64): CountResult {
  if (!(mu > 0)) return { n: 0, capHit: false };
  let s = 0;
  let n = 0;
  while (n < cap) {
    s = s + -ln(draw(n));
    if (s > mu) break;
    n = n + 1;
  }
  return { n, capHit: n >= cap };
}
export const spacingCount = (mu: number, draw: (i: number) => number, cap = 64): number => spacingCountR(mu, draw, cap).n;

/** A mean above 32 is split into equal parts; `capHits` counts the parts that reached their cap. */
export function splitCountR(mu: number, drawPart: (part: number) => (i: number) => number): CountResult & { capHits: number } {
  const parts = Math.max(1, Math.ceil(mu / 32));
  const each = mu / parts;
  let total = 0;
  let capHits = 0;
  for (let p = 0; p < parts; p++) {
    const r = spacingCountR(each, drawPart(p));
    total = total + r.n;
    if (r.capHit) capHits++;
  }
  return { n: total, capHit: capHits > 0, capHits };
}
export const splitCount = (mu: number, drawPart: (part: number) => (i: number) => number): number => splitCountR(mu, drawPart).n;

/** Clusters: the negative binomial by recurrence. The tail folds into `maxK`. */
export function nbCount(n: number, k: number, u: number, maxK = 8): number {
  if (!(n > 0)) return 0;
  let p = exptab(-(k * ln(1 + n / k)));
  let cum = p;
  for (let j = 0; j < maxK; j++) {
    if (u < cum) return j;
    p = p * ((j + k) / (j + 1)) * (n / (n + k)); // left to right: (p x a) x b
    cum = cum + p;
  }
  return maxK;
}

/** Normal and log-normal variates are table lookups, with no interpolation. */
export const normalOf = (u: number): number => Z[Math.floor(u * 4096)]!;
export const logNormalOf = (u: number): number => LQ[Math.floor(u * 4096)]!;

export const floorDiv = (a: number, b: number): number => Math.floor(a / b);
export const mod = (a: number, b: number): number => a - b * Math.floor(a / b);
