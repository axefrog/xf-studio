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
const TWO_32 = 4294967296;

function cmpBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

/** One growing buffer, written once: the encoding of a record is a stream of tagged items, and a part per item was most of its cost. */
class Writer {
  private buf = new Uint8Array(256);
  private view = new DataView(this.buf.buffer);
  length = 0;

  private room(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  byte(b: number): void {
    this.room(1);
    this.buf[this.length++] = b;
  }

  u32(n: number): void {
    this.room(4);
    this.view.setUint32(this.length, n, true);
    this.length += 4;
  }

  bytes(b: Uint8Array): void {
    this.room(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }

  /** An integer as i64, little-endian: the two words of a safe integer, written directly; the rest through the checked helper. */
  i64(v: number): void {
    if (Number.isSafeInteger(v)) {
      this.room(8);
      this.view.setUint32(this.length, ((v % TWO_32) + TWO_32) % TWO_32, true);
      this.view.setInt32(this.length + 4, Math.floor(v / TWO_32), true);
      this.length += 8;
    } else this.bytes(i64Bytes(v));
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

function encode(x: unknown, out: Writer): void {
  if (x === null || x === undefined) {
    out.byte(0x00);
    return;
  }
  switch (typeof x) {
    case 'boolean':
      out.byte(x ? 0x02 : 0x01);
      return;
    case 'number':
      if (!Number.isFinite(x)) throw new TypeError(`not canonical: ${x}`);
      if (Number.isInteger(x) && Math.abs(x) < TWO_63) {
        out.byte(0x03);
        out.i64(x);
      } else {
        out.byte(0x04);
        out.bytes(f64Bytes(x));
      }
      return;
    case 'string': {
      const bytes = encoder.encode(x);
      out.byte(0x05);
      out.u32(bytes.length);
      out.bytes(bytes);
      return;
    }
    case 'object': {
      if (Array.isArray(x)) {
        out.byte(0x06);
        out.u32(x.length);
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
      out.byte(0x07);
      out.u32(entries.length);
      for (const [key, value] of entries) {
        out.u32(key.length);
        out.bytes(key);
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
  const out = new Writer();
  encode(x, out);
  return out.result();
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
 * through `expand`. Keys are not read, with one exception: the `weights` of a `table` form are keyed by the
 * values they weigh, which are Ids for a ref-valued slot, so those keys are read wherever the form sits
 * (nested in a `rule` too). Used to follow a record's Id fields (spec 7.3, SPEC-NOTES 33).
 */
export function idsIn(x: unknown, expand?: (s: string) => Id): Id[] {
  const out: Id[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      // `root:` strings are never Ids, so test them first (isId narrows the string branch away).
      if (expand && v.startsWith('root:')) out.push(expand(v));
      else if (isId(v)) out.push(v);
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item);
    } else if (typeof v === 'object' && v !== null) {
      const rec = v as Record<string, unknown>;
      const weights = rec.f === 'table' ? rec.weights : undefined;
      if (typeof weights === 'object' && weights !== null && !Array.isArray(weights)) {
        for (const key of Object.keys(weights)) if (isId(key)) out.push(key);
      }
      for (const value of Object.values(rec)) walk(value);
    }
  };
  walk(x);
  return out;
}
