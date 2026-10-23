// The short-message BLAKE3 (src/blake3-short.ts) is the library's function, not a variant of it: it is compared with the library over messages
// of every length a chunk allows, over bytes drawn from a fixed generator, and the keyed draws built on it are compared with the straight route.

import { describe, expect, test } from 'bun:test';
import { blake3 } from '@noble/hashes/blake3.js';
import { SHORT_MAX, blake3Headed, blake3Short } from '../src/blake3-short.ts';
import { H, bytesToHex, encodeArgs, i as hi, id as hid, rand, randOverValues, s as hs, val } from '../src/id.ts';

/** A fixed byte stream (xorshift), so a failure names the same message every time. */
function bytesFrom(seed: number, n: number): Uint8Array {
  let x = seed >>> 0 || 1;
  const out = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[k] = x & 0xff;
  }
  return out;
}

const viewOf = (u: Uint8Array): DataView => new DataView(u.buffer, u.byteOffset, u.byteLength);

describe('the short-message BLAKE3', () => {
  test('matches the library for every length from 0 to a full chunk', () => {
    for (let len = 0; len <= SHORT_MAX; len++) {
      const msg = bytesFrom(len * 7919 + 13, len);
      expect(bytesToHex(blake3Short(viewOf(msg), len))).toBe(bytesToHex(blake3(msg, { dkLen: 16 })));
    }
  });

  test('matches the library on messages that do not start at the beginning of their buffer, and ignores the bytes after the length', () => {
    const buf = bytesFrom(99, 1500);
    for (const [start, len] of [[1, 5], [3, 64], [7, 65], [64, 1000], [13, 1024], [0, 63], [100, 128], [255, 127]] as const) {
      const msg = buf.subarray(start, start + len);
      // the view reads from its own offset 0, so a view over the subarray stands for "the message"; bytes beyond len are not read
      expect(bytesToHex(blake3Short(viewOf(buf.subarray(start, start + len + 100)), len))).toBe(bytesToHex(blake3(msg, { dkLen: 16 })));
    }
  });

  test('a message with a shared head hashes like the whole message, for every head and tail length that fits in a chunk', () => {
    for (let headLen = 0; headLen <= 200; headLen += 1) {
      const head = bytesFrom(headLen + 1000, headLen);
      const headed = blake3Headed(head);
      const skipped = headLen - headed.tailStart.length;
      expect(skipped % 64).toBe(0);
      for (const rest of [0, 1, 2, 31, 62, 63, 64, 65, 127, 128, 129, 300]) {
        const tailLen = headed.tailStart.length + rest;
        const full = new Uint8Array(headLen + rest);
        full.set(head, 0);
        full.set(bytesFrom(headLen * 31 + rest, rest), headLen);
        const tail = new Uint8Array(1100);
        tail.set(full.subarray(skipped), 0);
        const got = headed.hash(viewOf(tail), tailLen);
        if (tailLen < 1 || skipped + tailLen > SHORT_MAX) {
          expect(got).toBeUndefined();
          continue;
        }
        expect(bytesToHex(got!)).toBe(bytesToHex(blake3(full, { dkLen: 16 })));
      }
    }
  });

  test('H and rand agree with the library on the canonical encodings, short and long', () => {
    for (let n = 0; n < 400; n++) {
      const args = [hs('t'), hi(n), hs('x'.repeat(n % 90)), hid(H(hs('id'), hi(n)))];
      expect(H(...args)).toBe(bytesToHex(blake3(encodeArgs(args), { dkLen: 16 })));
    }
    // beyond a chunk the library is used, and nothing changes at the boundary
    for (const n of [900, 1000, 1010, 1020, 1030, 1100, 3000]) {
      const args = [hs('x'.repeat(n))];
      expect(H(...args)).toBe(bytesToHex(blake3(encodeArgs(args), { dkLen: 16 })));
    }
    expect(rand(hs('k'), hi(1))).toBe(rand(hs('k'), hi(1)));
  });

  test('the keyed draws over values equal rand with the value as the last argument, whatever the key and value lengths', () => {
    const keys = [
      [hs('g'), hid(H(hs('a'))), hid(H(hs('b'))), hs('some.path'), hi(77)],
      [hs('g'), hid(H(hs('a')))],
      [hs('g'), hs('x'.repeat(40)), hs('y'.repeat(40))],
      [hs('g'), hs('x'.repeat(60))],
      [hs('g'), hs('z'.repeat(1000))],
      [],
    ];
    for (const key of keys) {
      const draw = randOverValues(...key);
      for (const len of [0, 1, 5, 9, 17, 40, 63, 64, 65, 200, 400, 1100]) {
        const bytes = bytesFrom(len + 5, len);
        expect(draw(bytes)).toBe(rand(...key, val(bytes)));
      }
    }
  });
});
