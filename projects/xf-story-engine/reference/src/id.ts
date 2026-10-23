// Identity, hashing and randomness (spec 1.1, 1.2, 1.4).
//
// H(args...) is the first 128 bits of BLAKE3 over the canonical encoding of its arguments. Each
// argument is a one-byte tag followed by its bytes. There is no stateful generator: every draw names
// its key.

import { blake3 } from '@noble/hashes/blake3.js';
import type { Id } from './types.ts';

/** A typed hash argument. The tag is part of the encoding, so a string and an Id never collide. */
export type HArg =
  | { t: 's'; v: string }
  | { t: 'i'; v: number | bigint }
  | { t: 'id'; v: Id }
  | { t: 'f'; v: number }
  | { t: 'b'; v: boolean }
  /** A value, already in its canonical encoding (spec 2.1). H adds the tag and the trailing 0x00. */
  | { t: 'val'; bytes: Uint8Array };

export const s = (v: string): HArg => ({ t: 's', v });
export const i = (v: number | bigint): HArg => ({ t: 'i', v });
export const id = (v: Id): HArg => ({ t: 'id', v });
export const f = (v: number): HArg => ({ t: 'f', v });
export const b = (v: boolean): HArg => ({ t: 'b', v });
export const val = (bytes: Uint8Array): HArg => ({ t: 'val', bytes });

const ID_RE = /^[0-9a-f]{32}$/;
export function isId(x: unknown): x is Id {
  return typeof x === 'string' && ID_RE.test(x);
}

const textEncoder = new TextEncoder();

export function idToBytes(x: Id): Uint8Array {
  if (!isId(x)) throw new Error(`not an Id: ${String(x)}`);
  const out = new Uint8Array(16);
  for (let n = 0; n < 16; n++) out[n] = parseInt(x.slice(2 * n, 2 * n + 2), 16);
  return out;
}

const HEX: string[] = Array.from({ length: 256 }, (_, n) => n.toString(16).padStart(2, '0'));

export function bytesToHex(u: Uint8Array): string {
  let out = '';
  for (let n = 0; n < u.length; n++) out += HEX[u[n]!];
  return out;
}

/** i64, little-endian. Throws on a non-integer or a value outside the i64 range. */
export function i64Bytes(v: number | bigint): Uint8Array {
  if (typeof v === 'number' && !Number.isInteger(v)) throw new Error(`not an integer: ${v}`);
  const big = BigInt(v);
  if (big < -(1n << 63n) || big >= 1n << 63n) throw new Error(`outside i64: ${v}`);
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, big, true);
  return out;
}

/** binary64, little-endian. Negative zero becomes positive zero; NaN is forbidden. */
export function f64Bytes(v: number): Uint8Array {
  if (Number.isNaN(v)) throw new Error('NaN is forbidden in a hash argument');
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, v === 0 ? 0 : v, true);
  return out;
}

/** The UTF-8 length of a string, without allocating. */
function utf8Length(str: string): number {
  let n = 0;
  for (let c = 0; c < str.length; c++) {
    const u = str.charCodeAt(c);
    if (u < 0x80) n += 1;
    else if (u < 0x800) n += 2;
    else if (u >= 0xd800 && u <= 0xdbff && c + 1 < str.length) {
      n += 4;
      c++;
    } else n += 3;
  }
  return n;
}

const ID_HEX: number[] = (() => {
  const t = new Array<number>(128).fill(-1);
  for (let c = 0; c < 10; c++) t[48 + c] = c;
  for (let c = 0; c < 6; c++) t[97 + c] = 10 + c;
  return t;
})();

/** The canonical encoding of an argument list. Exposed so tests can pin the byte layout. One buffer, written once. */
export function encodeArgs(args: readonly HArg[]): Uint8Array {
  let total = 0;
  for (const a of args) {
    switch (a.t) {
      case 's':
        total += 5 + utf8Length(a.v);
        break;
      case 'i':
      case 'f':
        total += 9;
        break;
      case 'id':
        total += 17;
        break;
      case 'b':
        total += 2;
        break;
      case 'val':
        total += 2 + a.bytes.length;
        break;
    }
  }
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let at = 0;
  for (const a of args) {
    switch (a.t) {
      case 's': {
        const len = utf8Length(a.v);
        out[at] = 0x01;
        dv.setUint32(at + 1, len, true);
        textEncoder.encodeInto(a.v, out.subarray(at + 5, at + 5 + len));
        at += 5 + len;
        break;
      }
      case 'i': {
        out[at] = 0x02;
        const v = a.v;
        if (typeof v === 'number' && Number.isSafeInteger(v)) {
          // two's complement, little-endian: the low word, then the high word (the floor quotient)
          dv.setUint32(at + 1, ((v % 4294967296) + 4294967296) % 4294967296, true);
          dv.setInt32(at + 5, Math.floor(v / 4294967296), true);
        } else out.set(i64Bytes(v), at + 1);
        at += 9;
        break;
      }
      case 'id': {
        const x = a.v;
        if (!isId(x)) throw new Error(`not an Id: ${String(x)}`);
        out[at] = 0x03;
        for (let n = 0; n < 16; n++) out[at + 1 + n] = ID_HEX[x.charCodeAt(2 * n)]! * 16 + ID_HEX[x.charCodeAt(2 * n + 1)]!;
        at += 17;
        break;
      }
      case 'f':
        out[at] = 0x04;
        if (Number.isNaN(a.v)) throw new Error('NaN is forbidden in a hash argument');
        dv.setFloat64(at + 1, a.v === 0 ? 0 : a.v, true);
        at += 9;
        break;
      case 'b':
        out[at] = 0x05;
        out[at + 1] = a.v ? 1 : 0;
        at += 2;
        break;
      case 'val':
        out[at] = 0x06;
        out.set(a.bytes, at + 1);
        out[at + 1 + a.bytes.length] = 0x00;
        at += 2 + a.bytes.length;
        break;
    }
  }
  return out;
}

/** H: the first 128 bits of BLAKE3 over the canonical encoding of the arguments, as an Id. */
export function H(...args: HArg[]): Id {
  return bytesToHex(blake3(encodeArgs(args), { dkLen: 16 }));
}

/**
 * toUnit(h) = (bits52(h) + 0.5) / 2^52, where bits52 is the first 52 bits of the hash as an unsigned
 * integer. The first 52 bits are the first 13 hexadecimal characters. Every step is exact in binary64,
 * and the result lies strictly inside (0, 1), so ln never sees 0 or 1.
 */
export function toUnit(h: Id): number {
  const bits = parseInt(h.slice(0, 13), 16);
  return (bits + 0.5) / 4503599627370496;
}

/** rand(key...) = toUnit(H("rng", key...)). A stream is rand(key..., i) for i = 0, 1, ... */
export function rand(...key: HArg[]): number {
  return toUnit(H(s('rng'), ...key));
}

/** The Id of a root node (spec 1.1). */
export const rootId = (worldSeed: Id, name: string): Id => H(s('root'), id(worldSeed), s(name));
/** The Id of the node held by a `card: 'one'` `node` slot. */
export const ownedId = (owner: Id, slotKey: string): Id => H(s('val'), id(owner), s(slotKey));
/** The Id of member `index` of a `many` slot, whatever its value type. */
export const memberId = (owner: Id, slotKey: string, index: number): Id =>
  H(s('gen'), id(owner), s(slotKey), i(index));
/** The Id of a node minted by an event, seed, process or summary. */
export const mintedId = (creator: Id, cause: Id, localName: string): Id =>
  H(s('mint'), id(creator), id(cause), s(localName));
/** The Id of a node the game owns. */
export const mirroredId = (gameKey: string): Id => H(s('game'), s(gameKey));
