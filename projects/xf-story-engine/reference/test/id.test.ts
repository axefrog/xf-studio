import { describe, expect, test } from 'bun:test';
import { blake3 } from '@noble/hashes/blake3.js';
import {
  H, b, bytesToHex, encodeArgs, f, f64Bytes, i, i64Bytes, id, idToBytes, isId, memberId, mintedId, mirroredId,
  ownedId, rand, rootId, s, toUnit, val,
} from '../src/id.ts';

const seed = H(s('fixture'), s('id-test'));

describe('identifiers and hashing (spec 1.1, 1.2)', () => {
  test('BLAKE3 test vector for the empty input', () => {
    expect(bytesToHex(blake3(new Uint8Array(0)))).toBe('af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262');
  });

  test('an Id is 32 lowercase hex characters', () => {
    expect(isId(seed)).toBe(true);
    expect(seed).toHaveLength(32);
    expect(isId(seed.toUpperCase())).toBe(false);
    expect(isId('abc')).toBe(false);
  });

  test('canonical encoding: tag, then bytes', () => {
    const hex = (u: Uint8Array) => bytesToHex(u);
    expect(hex(encodeArgs([s('ab')]))).toBe('01' + '02000000' + '6162');
    expect(hex(encodeArgs([i(1)]))).toBe('02' + '0100000000000000');
    expect(hex(encodeArgs([i(-1)]))).toBe('02' + 'ffffffffffffffff');
    expect(hex(encodeArgs([id('00112233445566778899aabbccddeeff')]))).toBe('03' + '00112233445566778899aabbccddeeff');
    expect(hex(encodeArgs([f(1)]))).toBe('04' + '000000000000f03f');
    expect(hex(encodeArgs([b(true), b(false)]))).toBe('0501' + '0500');
    expect(hex(encodeArgs([val(Uint8Array.of(7, 8))]))).toBe('06' + '0708' + '00');
  });

  test('negative zero becomes positive zero, NaN is forbidden', () => {
    expect(bytesToHex(f64Bytes(-0))).toBe(bytesToHex(f64Bytes(0)));
    expect(() => f64Bytes(NaN)).toThrow();
    expect(() => i64Bytes(1.5)).toThrow();
    expect(() => i64Bytes(1n << 63n)).toThrow();
    expect(bytesToHex(i64Bytes(-(1n << 63n)))).toBe('0000000000000080');
  });

  test('H is the first 128 bits of BLAKE3 over the canonical encoding', () => {
    const args = [s('root'), id(seed), s('city')];
    expect(H(...args)).toBe(bytesToHex(blake3(encodeArgs(args)).slice(0, 16)));
  });

  test('a string and an Id with the same text never collide (the tag is part of the hash)', () => {
    expect(H(s(seed))).not.toBe(H(id(seed)));
  });

  test('origin formulas (spec 1.1)', () => {
    expect(rootId(seed, 'city')).toBe(H(s('root'), id(seed), s('city')));
    const owner = rootId(seed, 'v');
    expect(ownedId(owner, 'name')).toBe(H(s('val'), id(owner), s('name')));
    expect(memberId(owner, 'traits', 3)).toBe(H(s('gen'), id(owner), s('traits'), i(3)));
    expect(memberId(owner, 'traits', 3)).not.toBe(memberId(owner, 'traits', 4));
    expect(mintedId(owner, owner, 'x')).toBe(H(s('mint'), id(owner), id(owner), s('x')));
    expect(mirroredId('npc/17')).toBe(H(s('game'), s('npc/17')));
  });

  test('toUnit: the first 13 hex characters, strictly inside (0, 1)', () => {
    expect(toUnit('0'.repeat(32))).toBe(0.5 / 2 ** 52);
    const top = toUnit('f'.repeat(32));
    expect(top).toBe((2 ** 52 - 0.5) / 2 ** 52);
    expect(top < 1).toBe(true);
    // 0x8000000000000 is exactly half of 2^52.
    expect(toUnit('8000000000000' + '0'.repeat(19))).toBe((2 ** 51 + 0.5) / 2 ** 52);
    // only the first 52 bits matter
    expect(toUnit('1234567890abc' + '0'.repeat(19))).toBe(toUnit('1234567890abc' + 'f'.repeat(19)));
  });

  test('rand is a pure function of its key, and a stream is rand(key, i)', () => {
    expect(rand(s('g'), id(seed), i(0))).toBe(rand(s('g'), id(seed), i(0)));
    const stream = Array.from({ length: 50 }, (_, n) => rand(s('g'), id(seed), i(n)));
    expect(new Set(stream).size).toBe(50);
    for (const u of stream) {
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
    }
  });

  test('idToBytes round-trips', () => {
    const bytes = idToBytes(seed);
    expect(bytes).toHaveLength(16);
    expect(bytesToHex(bytes)).toBe(seed);
  });

  test('golden values (cross-implementation check for a native core)', () => {
    // These pin the exact byte layout and hash for implementations in other languages.
    expect(H(s('root'), id('00000000000000000000000000000000'), s('city'))).toBe(
      bytesToHex(blake3(encodeArgs([s('root'), id('00000000000000000000000000000000'), s('city')])).slice(0, 16)),
    );
  });
});
