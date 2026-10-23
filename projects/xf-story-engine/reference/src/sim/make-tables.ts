// The reference tool `make-tables` (S1 1.2): regenerates the frozen table artifacts exptab@1, normtab@1 and lqtab@1.
//
// Each value is computed in fixed-point arithmetic with 400 fractional bits (about 120 decimal digits) and rounded once to
// the nearest binary64, ties to even. A file holds one value per line, written as the 16 lower-case hex digits of the
// big-endian bit pattern, with LF line ends and a final LF. `bun src/sim/make-tables.ts <dir>` writes them.

import { createHash } from 'node:crypto';

/** Fractional bits of the fixed-point numbers. */
const F = 400n;
const ONE = 1n << F;

const fx = (n: number): bigint => BigInt(Math.round(n)) << F;
const mul = (a: bigint, b: bigint): bigint => (a * b) >> F;
const div = (a: bigint, b: bigint): bigint => (a << F) / b;

/** floor(sqrt(a)) of a fixed-point value, by Newton's method on integers. */
function sqrtFx(a: bigint): bigint {
  if (a <= 0n) return 0n;
  const n = a << F; // sqrt(a * 2^F) * 2^(F/2) ... computed on the scaled integer
  let x = 1n << BigInt((n.toString(2).length >> 1) + 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/** e^x for a fixed-point x: halve the argument 14 times, sum the Taylor series, square 14 times. */
export function expFx(x: bigint): bigint {
  const M = 14n;
  const r = x >> M;
  let term = ONE;
  let sum = ONE;
  for (let n = 1n; n < 200n; n++) {
    term = (mul(term, r)) / n;
    if (term === 0n) break;
    sum += term;
  }
  for (let m = 0n; m < M; m++) sum = mul(sum, sum);
  return sum;
}

/** pi by Machin's formula. */
function piFx(): bigint {
  const atanInv = (k: bigint): bigint => {
    // atan(1/k) = sum (-1)^n / ((2n+1) k^(2n+1))
    const k2 = k * k;
    let power = ONE / k;
    let sum = power;
    for (let n = 1n; ; n++) {
      power = power / k2;
      const t = power / (2n * n + 1n);
      if (t === 0n) break;
      sum += n % 2n === 1n ? -t : t;
    }
    return sum;
  };
  return 4n * (4n * atanInv(5n) - atanInv(239n));
}

const PI = piFx();
const SQRT2 = sqrtFx(fx(2));
const SQRT_2PI = sqrtFx(2n * PI);
const SQRT_PI = sqrtFx(PI);

/** erf(x) by its Maclaurin series. */
function erfFx(x: bigint): bigint {
  const x2 = mul(x, x);
  let term = x; // x^(2n+1) / n!
  let sum = x;
  for (let n = 1n; n < 1000n; n++) {
    term = -mul(term, x2) / n;
    const t = term / (2n * n + 1n);
    if (t === 0n) break;
    sum += t;
  }
  return div(2n * sum, SQRT_PI);
}

/** The standard normal CDF at z. */
const phi = (z: bigint): bigint => (ONE + erfFx(div(z, SQRT2))) / 2n;
/** The standard normal density at z. */
const density = (z: bigint): bigint => div(expFx(-mul(z, z) / 2n), SQRT_2PI);

/** A double-precision starting point for the inverse normal CDF (Acklam's rational approximation). */
function acklam(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

const toFx = (x: number): bigint => BigInt(Math.round(x * 2 ** 40)) << (F - 40n);

/** The inverse normal CDF of p = num / den, to the working precision. */
function invPhi(num: bigint, den: bigint): bigint {
  const p = (num << F) / den;
  let z = toFx(acklam(Number(num) / Number(den)));
  for (let it = 0; it < 7; it++) z -= div(phi(z) - p, density(z));
  return z;
}

/** The nearest binary64 to a fixed-point value, ties to even, as its 64-bit pattern. */
export function bitsOf(x: bigint): bigint {
  if (x === 0n) return 0n;
  const neg = x < 0n;
  let a = neg ? -x : x;
  const len = BigInt(a.toString(2).length);
  let shift = len - 53n;
  let mant: bigint;
  if (shift > 0n) {
    mant = a >> shift;
    const rem = a & ((1n << shift) - 1n);
    const half = 1n << (shift - 1n);
    if (rem > half || (rem === half && (mant & 1n) === 1n)) mant += 1n;
    if (mant === 1n << 53n) {
      mant >>= 1n;
      shift += 1n;
    }
  } else {
    mant = a << -shift;
    shift = 0n;
    a = 0n;
  }
  // value = mant * 2^(shift - F), mant has exactly 53 bits.
  const exp = shift - F + 52n; // the exponent of the leading bit
  const biased = exp + 1023n;
  if (biased <= 0n || biased >= 2047n) throw new Error('table value outside the normal binary64 range');
  const frac = mant & ((1n << 52n) - 1n);
  return (neg ? 1n << 63n : 0n) | (biased << 52n) | frac;
}

const hex = (bits: bigint): string => bits.toString(16).padStart(16, '0');
export const doubleOfBits = (bits: bigint): number => {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setBigUint64(0, bits);
  return dv.getFloat64(0);
};

export const fileOf = (values: bigint[]): string => values.map((b) => hex(bitsOf(b))).join('\n') + '\n';

/** exptab@1: T[j] = e^((j - 256) / 16), j = 0 ... 320. */
export function exptabValues(): bigint[] {
  const out: bigint[] = [];
  for (let j = 0; j <= 320; j++) out.push(expFx(fx(j - 256) / 16n));
  return out;
}

/** The exact Z[i] = invPhi((i + 0.5) / 4096), computed for i < 2048 and mirrored. */
export function normtabExact(): bigint[] {
  const z: bigint[] = new Array(4096);
  for (let i = 0; i < 2048; i++) {
    z[i] = invPhi(BigInt(2 * i + 1), 8192n);
    z[4095 - i] = -z[i]!;
  }
  return z;
}

export function normtabValues(): bigint[] {
  return normtabExact();
}

/** lqtab@1: LQ[i] = e^(sigma Z[i]) / mean_j e^(sigma Z[j]), sigma = 1.6, from the exact Z. */
export function lqtabValues(z: bigint[] = normtabExact()): bigint[] {
  const sigma = (fx(16)) / 10n;
  const e = z.map((zi) => expFx(mul(sigma, zi)));
  let total = 0n;
  for (const x of e) total += x;
  const mean = total / 4096n;
  return e.map((x) => div(x, mean));
}

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

export interface TableFiles {
  'exptab@1': string;
  'normtab@1': string;
  'lqtab@1': string;
}

export function makeTables(): TableFiles {
  const z = normtabExact();
  return { 'exptab@1': fileOf(exptabValues()), 'normtab@1': fileOf(z), 'lqtab@1': fileOf(lqtabValues(z)) };
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: bun src/sim/make-tables.ts <output directory>');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(dir, { recursive: true });
  const files = makeTables();
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(`${dir}/${name}.txt`, text, { encoding: 'utf8' });
    console.log(name, sha256(text));
  }
}
