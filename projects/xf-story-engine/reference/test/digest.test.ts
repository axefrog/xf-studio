// The determinism digest: the cross-implementation check for a later native core (spec 17, open item 1).
//
// A fixed script of 1,000 mixed operations runs against the synthetic schema in test/synthetic.ts
// (pins, contributions, withdrawals, readings and observations, resolutions with traces, queries,
// ticks with a process, events and canon, frames and relevance, edges, saves and sweeps). Every
// resolved value, trace score, query result and relevance emission is folded into one BLAKE3 chain.
// A second implementation that agrees on the primitive vectors and the final digest agrees on all of it.
//
// To regenerate the golden values after an intended change to the kernel's behaviour, print them with
// a one-off script (see git history of this file) and record the change in SPEC-NOTES.md.

import { describe, expect, test } from 'bun:test';
import { ln } from '../src/fdlibm-log.ts';
import { H, bytesToHex, f, f64Bytes, i, id, rand, s, toUnit, val } from '../src/id.ts';
import { encodeValue } from '../src/value.ts';
import { digestOf, moodProcess, startWorld, synKernel } from './synthetic.ts';

const bits = (x: number): string => bytesToHex(f64Bytes(x));
const vseed = H(s('fixture'), s('vectors'));

describe('primitive vectors (BLAKE3 hash, unit mapping, randomness, fdlibm ln)', () => {
  test('H and the argument encodings', () => {
    expect(H(s('a'))).toBe('8d085bf7c2340313f27b0b7b091e0a31');
    expect(vseed).toBe('9a34038996e22b0f58eafbb6fd254bc4');
    expect(H(s('x'), i(-7), id(vseed), f(0.25), val(encodeValue({ t: 'real', min: 0, max: 1, quantum: 1 / 64 }, 0.5)))).toBe('1b5312c5b022f81a145f81b70f329dc9');
  });

  test('toUnit and rand, bit for bit', () => {
    expect(bits(toUnit(vseed))).toBe('45dc32718046e33f');
    expect(bits(rand(s('g'), id(vseed), s('slot'), i(0), val(new Uint8Array([1, 2, 3]))))).toBe('874a8ed7ab75e83f');
  });

  test('fdlibm ln, bit for bit', () => {
    const golden: Array<[number, string]> = [
      [0.25, 'ef39fafe422ef6bf'], [0.5, 'ef39fafe422ee6bf'], [1.5, '4c98bfec23f3d93f'], [2, 'ef39fafe422ee63f'], [3, '0a03ad7aea93f13f'],
      [10, '1655b5bbb16b0240'], [0.1, '1555b5bbb16b02c0'], [1e-300, 'b57ff847349685c0'], [123456.789, '44a8d8ca81722740'],
    ];
    for (const [x, hex] of golden) {
      expect(bits(ln(x)), String(x)).toBe(hex);
      // The platform log agrees to within a couple of ulps (it is not used by the kernel).
      expect(Math.abs(ln(x) - Math.log(x))).toBeLessThanOrEqual(Math.abs(Math.log(x)) * 4.5e-16 + 1e-300);
    }
  });
});

describe('the determinism digest', () => {
  const run = () => {
    const k = synKernel('digest');
    const w = startWorld(k);
    k.evolution.register(moodProcess(() => w.agents));
    const r = digestOf(w, 1000, 'script-1');
    return { ...r, k };
  };

  test('1,000 mixed operations hash to the frozen digest', () => {
    const { digest, entries, k } = run();
    expect(entries).toBe(2194);
    expect(k.revision).toBe(1344);
    expect(k.store.allPins()).toHaveLength(408);
    expect(k.store.allContributions()).toHaveLength(338);
    expect(digest).toBe('00796d399c46bee565b64ca1f03323ae');
  });

  test('a second run of the same script gives the same digest (no hidden state, no iteration-order dependence)', () => {
    expect(run().digest).toBe(run().digest);
  });
});
