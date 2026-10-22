// A literal port of fdlibm's e_log.c (netlib), spec 1.3.
//
// Same constants, same operation order, using only binary64 arithmetic plus reads and writes of the
// bit pattern through a DataView. It never calls Math.log or Math.exp.
//
//   __ieee754_log(x)
//   Return the natural logarithm of x.
//   Method:
//     1. Argument reduction: find k and f such that x = 2^k * (1+f), where sqrt(2)/2 < 1+f < sqrt(2).
//     2. Approximation of log(1+f). See e_log.c for the derivation.

const ln2_hi = 6.93147180369123816490e-01; /* 3fe62e42 fee00000 */
const ln2_lo = 1.90821492927058770002e-10; /* 3dea39ef 35793c76 */
const two54 = 1.80143985094819840000e+16; /* 43500000 00000000 */
const Lg1 = 6.666666666666735130e-01; /* 3FE55555 55555593 */
const Lg2 = 3.999999999940941908e-01; /* 3FD99999 9997FA04 */
const Lg3 = 2.857142874366239149e-01; /* 3FD24924 94229359 */
const Lg4 = 2.222219843214978396e-01; /* 3FCC71C5 1D8E78AF */
const Lg5 = 1.818357216161805012e-01; /* 3FC74664 96CB03DE */
const Lg6 = 1.531383769920937332e-01; /* 3FC39A09 D078C69F */
const Lg7 = 1.479819860511658591e-01; /* 3FC2F112 DF3E5244 */

/** The constants with the bit patterns the C source states, so a test can pin the decimal literals to them. */
export const LOG_CONSTANTS: ReadonlyArray<readonly [string, number, string]> = [
  ['ln2_hi', ln2_hi, '3fe62e42fee00000'],
  ['ln2_lo', ln2_lo, '3dea39ef35793c76'],
  ['two54', two54, '4350000000000000'],
  ['Lg1', Lg1, '3fe5555555555593'],
  ['Lg2', Lg2, '3fd999999997fa04'],
  ['Lg3', Lg3, '3fd2492494229359'],
  ['Lg4', Lg4, '3fcc71c51d8e78af'],
  ['Lg5', Lg5, '3fc7466496cb03de'],
  ['Lg6', Lg6, '3fc39a09d078c69f'],
  ['Lg7', Lg7, '3fc2f112df3e5244'],
];

const buf = new DataView(new ArrayBuffer(8));

/** High word of x as a signed 32-bit integer (big-endian view, so independent of the platform). */
function hiWord(x: number): number {
  buf.setFloat64(0, x, false);
  return buf.getInt32(0, false);
}

/** Low word of x as an unsigned 32-bit integer. */
function loWord(x: number): number {
  buf.setFloat64(0, x, false);
  return buf.getUint32(4, false);
}

/** x with its high word replaced (the low word is kept). */
function withHiWord(x: number, hi: number): number {
  buf.setFloat64(0, x, false);
  buf.setInt32(0, hi | 0, false);
  return buf.getFloat64(0, false);
}

/** The natural logarithm, as fdlibm's e_log.c computes it. */
export function ln(xIn: number): number {
  let x = xIn;
  let hfsq: number, f: number, s: number, z: number, R: number, w: number, t1: number, t2: number, dk: number;
  let k: number, hx: number, i: number, j: number;
  let lx: number;

  hx = hiWord(x); /* high word of x */
  lx = loWord(x); /* low  word of x */

  k = 0;
  if (hx < 0x00100000) {
    /* x < 2**-1022  */
    if (((hx & 0x7fffffff) | lx) === 0) return -two54 / 0.0; /* log(+-0)=-inf */
    if (hx < 0) return (x - x) / 0.0; /* log(-#) = NaN */
    k -= 54;
    x *= two54; /* subnormal number, scale up x */
    hx = hiWord(x); /* high word of x */
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  i = (hx + 0x95f64) & 0x100000;
  x = withHiWord(x, hx | (i ^ 0x3ff00000)); /* normalize x or x/2 */
  k += i >> 20;
  f = x - 1.0;
  if ((0x000fffff & (2 + hx)) < 3) {
    /* |f| < 2**-20 */
    if (f === 0.0) {
      if (k === 0) return 0.0;
      dk = k;
      return dk * ln2_hi + dk * ln2_lo;
    }
    R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k === 0) return f - R;
    dk = k;
    return dk * ln2_hi - ((R - dk * ln2_lo) - f);
  }
  s = f / (2.0 + f);
  dk = k;
  z = s * s;
  i = hx - 0x6147a;
  w = z * z;
  j = 0x6b851 - hx;
  t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
  t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  i |= j;
  R = t2 + t1;
  if (i > 0) {
    hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * ln2_hi - ((hfsq - (s * (hfsq + R) + dk * ln2_lo)) - f);
  } else {
    if (k === 0) return f - s * (f - R);
    return dk * ln2_hi - ((s * (f - R) - dk * ln2_lo) - f);
  }
}
