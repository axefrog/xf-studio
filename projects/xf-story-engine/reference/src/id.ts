// Identity, hashing and randomness (spec 1.1, 1.2, 1.4).
//
// H(args...) is the first 128 bits of BLAKE3 over the canonical encoding of its arguments. Each
// argument is a one-byte tag followed by its bytes. There is no stateful generator: every draw names
// its key.

import { blake3 } from '@noble/hashes/blake3.js';
import { SHORT_MAX, blake3Headed, blake3Short } from './blake3-short.ts';
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
    else if (u >= 0xd800 && u <= 0xdbff && c + 1 < str.length && (str.charCodeAt(c + 1) & 0xfc00) === 0xdc00) {
      // a surrogate pair is one code point of four bytes; a lone surrogate is U+FFFD, three bytes, as the encoder writes it
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

/** The size of the canonical encoding of an argument list. */
function encodedSize(args: readonly HArg[]): number {
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
  return total;
}

/** Write the canonical encoding of an argument list into `out` from `at`; returns where it ends. */
function writeArgs(args: readonly HArg[], out: Uint8Array, dv: DataView, start: number): number {
  let at = start;
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
  return at;
}

/** The canonical encoding of an argument list. Exposed so tests can pin the byte layout. One buffer, written once. */
export function encodeArgs(args: readonly HArg[]): Uint8Array {
  const out = new Uint8Array(encodedSize(args));
  writeArgs(args, out, new DataView(out.buffer), 0);
  return out;
}

/** The scratch buffer the hashes are written into: they are hashed at once and not kept, so one buffer serves them all. */
let scratch = new Uint8Array(1024);
let scratchView = new DataView(scratch.buffer);
function scratchFor(n: number): void {
  if (n <= scratch.length) return;
  let size = scratch.length * 2;
  while (size < n) size *= 2;
  scratch = new Uint8Array(size);
  scratchView = new DataView(scratch.buffer);
}

/**
 * The first 128 bits of BLAKE3 over the canonical encoding of the arguments, as bytes. A message of up to one chunk (all but the rare long
 * one) is hashed by the short-message implementation; its output array is shared and overwritten by the next hash, so a caller reads it at once.
 */
function hashBytes(args: readonly HArg[]): Uint8Array {
  const total = encodedSize(args);
  scratchFor(total);
  writeArgs(args, scratch, scratchView, 0);
  if (total <= SHORT_MAX) return blake3Short(scratchView, total);
  return blake3(scratch.subarray(0, total), { dkLen: 16 });
}

/** H: the first 128 bits of BLAKE3 over the canonical encoding of the arguments, as an Id. */
export function H(...args: HArg[]): Id {
  return bytesToHex(hashBytes(args));
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

/** toUnit of a hash given as bytes: the first 52 bits are the first 6.5 bytes, exactly. */
function toUnitBytes(h: Uint8Array): number {
  const bits = h[0]! * 17592186044416 + h[1]! * 68719476736 + h[2]! * 268435456 + h[3]! * 1048576 + h[4]! * 4096 + h[5]! * 16 + (h[6]! >> 4);
  return (bits + 0.5) / 4503599627370496;
}

/** rand(key...) = toUnit(H("rng", key...)). A stream is rand(key..., i) for i = 0, 1, ... */
export function rand(...key: HArg[]): number {
  return toUnitBytes(hashBytes([s('rng'), ...key]));
}

/**
 * The draws of one key that differ only in the last argument, a value: `draw(bytes)` is `rand(...key, val(bytes))`, with the fixed part of the key
 * encoded once. The sampled slots draw a noise for every candidate value (hundreds for a profile), and the key before the value is the same.
 */
export function randOverValues(...key: HArg[]): (bytes: Uint8Array) => number {
  const head = encodedSize([s('rng'), ...key]);
  const prefix = new Uint8Array(head);
  writeArgs([s('rng'), ...key], prefix, new DataView(prefix.buffer), 0);
  // the whole blocks of the key are compressed once; each value then costs the blocks after them
  const headed = blake3Headed(prefix);
  const keep = headed.tailStart.length;
  const skipped = head - keep;
  let tail = new Uint8Array(256);
  let tailView = new DataView(tail.buffer);
  return (bytes: Uint8Array): number => {
    const tailLen = keep + 2 + bytes.length;
    if (skipped + tailLen <= SHORT_MAX) {
      if (tailLen > tail.length) {
        tail = new Uint8Array(SHORT_MAX);
        tailView = new DataView(tail.buffer);
      }
      tail.set(headed.tailStart, 0);
      tail[keep] = 0x06;
      tail.set(bytes, keep + 1);
      tail[keep + 1 + bytes.length] = 0x00;
      const h = headed.hash(tailView, tailLen);
      if (h !== undefined) return toUnitBytes(h);
    }
    const total = head + 2 + bytes.length;
    scratchFor(total);
    scratch.set(prefix, 0);
    scratch[head] = 0x06;
    scratch.set(bytes, head + 1);
    scratch[head + 1 + bytes.length] = 0x00;
    return toUnitBytes(blake3(scratch.subarray(0, total), { dkLen: 16 }));
  };
}

/** The Id of a root node (spec 1.1). */
export const rootId = (worldSeed: Id, name: string): Id => H(s('root'), id(worldSeed), s(name));
/**
 * The Ids of owned values and members are pure functions of the owner and the slot, asked again for the same node a great many times (every
 * address of a household's member is one), so the answers are kept. The map is dropped when it grows past what a world needs; an answer is
 * never wrong, only recomputed.
 */
const ID_MEMO_MAX = 400_000;
const ownedMemo = new Map<string, Id>();
const memberMemo = new Map<string, Id>();
function memoised(memo: Map<string, Id>, key: string, make: () => Id): Id {
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const made = make();
  if (memo.size >= ID_MEMO_MAX) memo.clear();
  memo.set(key, made);
  return made;
}
/** The Id of the node held by a `card: 'one'` `node` slot. */
export const ownedId = (owner: Id, slotKey: string): Id => memoised(ownedMemo, `${owner}|${slotKey}`, () => H(s('val'), id(owner), s(slotKey)));
/** The Id of member `index` of a `many` slot, whatever its value type. */
export const memberId = (owner: Id, slotKey: string, index: number): Id =>
  memoised(memberMemo, `${owner}|${slotKey}|${index}`, () => H(s('gen'), id(owner), s(slotKey), i(index)));
/** The Id of a node minted by an event, seed, process or summary. */
export const mintedId = (creator: Id, cause: Id, localName: string): Id =>
  H(s('mint'), id(creator), id(cause), s(localName));
/** The Id of a node the game owns. */
export const mirroredId = (gameKey: string): Id => H(s('game'), s(gameKey));
