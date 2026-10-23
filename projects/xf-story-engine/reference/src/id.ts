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

export function bytesToHex(u: Uint8Array): string {
  let out = '';
  for (let n = 0; n < u.length; n++) out += u[n]!.toString(16).padStart(2, '0');
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

/** The canonical encoding of an argument list. Exposed so tests can pin the byte layout. */
export function encodeArgs(args: readonly HArg[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const a of args) {
    switch (a.t) {
      case 's': {
        const bytes = textEncoder.encode(a.v);
        const head = new Uint8Array(5);
        head[0] = 0x01;
        new DataView(head.buffer).setUint32(1, bytes.length, true);
        parts.push(head, bytes);
        break;
      }
      case 'i':
        parts.push(Uint8Array.of(0x02), i64Bytes(a.v));
        break;
      case 'id':
        parts.push(Uint8Array.of(0x03), idToBytes(a.v));
        break;
      case 'f':
        parts.push(Uint8Array.of(0x04), f64Bytes(a.v));
        break;
      case 'b':
        parts.push(Uint8Array.of(0x05, a.v ? 1 : 0));
        break;
      case 'val':
        parts.push(Uint8Array.of(0x06), a.bytes, Uint8Array.of(0x00));
        break;
    }
  }
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
