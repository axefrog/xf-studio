// The canonical encoding of a record (SPEC-NOTES 52): the one way a generated identity, a cache key or
// an equality test reads a plain-data record. Incidental object construction order must never reach a
// kernel decision, so a record's bytes depend only on its content.
//
// Layout (every item starts with a one-byte tag; counts and lengths are u32, little-endian):
//   0x00                   null; also `undefined` as an array element
//   0x01 / 0x02            false / true
//   0x03 + i64             an integer: a finite number with no fractional part and magnitude below 2^63
//   0x04 + binary64        any other finite number; negative zero is the integer 0
//   0x05 + len + bytes     a string, as UTF-8
//   0x06 + count + items   an array, in order
//   0x07 + count + entries a record: entries whose value is `undefined` are left out, the rest are sorted
//                          by the bytewise order of their UTF-8 keys; an entry is key len + key bytes +
//                          the value's item
// NaN, infinities and anything that is not plain data (functions, symbols, bigints, maps, sets) are
// refused. Two records that differ only in key order or in `undefined` entries encode identically.

import { type HArg, bytesToHex, i64Bytes, f64Bytes, isId, val } from './id.ts';
import type { Id } from './types.ts';

const encoder = new TextEncoder();
const TWO_63 = 2 ** 63;

function u32(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, true);
  return out;
}

function cmpBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

function encode(x: unknown, out: Uint8Array[]): void {
  if (x === null || x === undefined) {
    out.push(Uint8Array.of(0x00));
    return;
  }
  switch (typeof x) {
    case 'boolean':
      out.push(Uint8Array.of(x ? 0x02 : 0x01));
      return;
    case 'number':
      if (!Number.isFinite(x)) throw new TypeError(`not canonical: ${x}`);
      if (Number.isInteger(x) && Math.abs(x) < TWO_63) out.push(Uint8Array.of(0x03), i64Bytes(x));
      else out.push(Uint8Array.of(0x04), f64Bytes(x));
      return;
    case 'string': {
      const bytes = encoder.encode(x);
      out.push(Uint8Array.of(0x05), u32(bytes.length), bytes);
      return;
    }
    case 'object': {
      if (Array.isArray(x)) {
        out.push(Uint8Array.of(0x06), u32(x.length));
        for (const item of x) encode(item, out);
        return;
      }
      const proto = Object.getPrototypeOf(x);
      if (proto !== Object.prototype && proto !== null) throw new TypeError('not canonical: not a plain record');
      const entries: Array<[Uint8Array, unknown]> = [];
      for (const [key, value] of Object.entries(x as Record<string, unknown>)) {
        if (value !== undefined) entries.push([encoder.encode(key), value]);
      }
      entries.sort((a, b) => cmpBytes(a[0], b[0]));
      out.push(Uint8Array.of(0x07), u32(entries.length));
      for (const [key, value] of entries) {
        out.push(u32(key.length), key);
        encode(value, out);
      }
      return;
    }
    default:
      throw new TypeError(`not canonical: ${typeof x}`);
  }
}

/** The canonical bytes of a plain-data record. */
export function canonicalBytes(x: unknown): Uint8Array {
  const parts: Uint8Array[] = [];
  encode(x, parts);
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The canonical bytes as lowercase hexadecimal: a string key for caches and comparisons. */
export function canonicalKey(x: unknown): string {
  return bytesToHex(canonicalBytes(x));
}

/** Whether two records have the same content, whatever their key order. */
export function canonicalEqual(a: unknown, b: unknown): boolean {
  return canonicalKey(a) === canonicalKey(b);
}

/** A record as a hash argument (`H` adds its tag and the trailing 0x00, as for a value). */
export function hrec(x: unknown): HArg {
  return val(canonicalBytes(x));
}

/**
 * Every Id named in a plain-data record: each string value that is an Id, and each `root:<name>` string
 * through `expand`. Keys are not read. Used to follow a record's Id fields (spec 7.3).
 */
export function idsIn(x: unknown, expand?: (s: string) => Id): Id[] {
  const out: Id[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (isId(v)) out.push(v);
      else if (expand && v.startsWith('root:')) out.push(expand(v));
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item);
    } else if (typeof v === 'object' && v !== null) {
      for (const value of Object.values(v)) walk(value);
    }
  };
  walk(x);
  return out;
}
