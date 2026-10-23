// The determinism digest: the cross-implementation check for a later native core (spec 17, open item 1).
//
// A fixed script of 1,000 mixed operations runs against the synthetic schema in test/synthetic.ts
// (pins, contributions, withdrawals, readings and observations, resolutions with traces, queries,
// ticks with two processes and external operations, events and canon, frames, relevance and dilemmas,
// beliefs with telling and evidence, summaries with canon items, a group's decisions and orders, seeds,
// edges, sweeps, and saves and replacement loads with branches, snapshots, outstanding process batches,
// a pack and a game port). Every resolved value, trace score, query result, relevance emission, dilemma,
// belief outcome and summary item, the whole frame each group decision left, each order issued, and the
// whole of every saved record, is folded into one BLAKE3 chain.
// A second implementation that agrees on the primitive vectors and the final digest agrees on all of it.
//
// To regenerate the golden values after an intended change to the kernel's behaviour, print them with
// a one-off script (see git history of this file) and record the change in SPEC-NOTES.md.

import { describe, expect, test } from 'bun:test';
import { Beliefs } from '../src/beliefs.ts';
import { Evolution } from '../src/evolution.ts';
import { ln } from '../src/fdlibm-log.ts';
import { Frames } from '../src/frames.ts';
import { Groups } from '../src/groups.ts';
import { Persistence } from '../src/persistence.ts';
import { Summaries } from '../src/summary.ts';
import { H, bytesToHex, f, f64Bytes, i, id, rand, s, toUnit, val } from '../src/id.ts';
import { encodeValue } from '../src/value.ts';
import { digestOf, makerProcess, moodProcess, startWorld, synKernel } from './synthetic.ts';

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
    const k = synKernel('digest', { snapshotEvery: 40, frameChanges: false }, { v4: false });
    const w = startWorld(k);
    k.evolution.register(moodProcess(() => w.agents));
    k.evolution.register(makerProcess(() => w));
    k.persistence.installPack({
      id: 'demo', version: '1.0.0',
      contributions: [{ layer: 'authored', target: { kind: 'syn:agent', slot: 'size' }, mode: 'weight', form: { f: 'table', weights: { '2': 3 } } }],
    });
    const r = digestOf(w, 1000, 'script-1');
    return { ...r, k };
  };

  test('1,000 mixed operations hash to the frozen digest', () => {
    const { digest, entries, k } = run();
    expect(entries).toBe(1067);
    expect(k.revision).toBe(2057);
    expect(k.store.allPins()).toHaveLength(135);
    expect(k.store.allContributions()).toHaveLength(51);
    expect(digest).toBe('d534e0dcef3f85d27cefa552217152ec');
  });

  test('SR-14: the script covers what the digest claims: saves, branches, snapshots, loads with outstanding batches, beliefs, summaries, groups', () => {
    const { labels, maxBatchesAfterLoad, k } = run();
    const atLeast: Array<[string, number]> = [
      ['save', 10], ['load', 10], ['stale', 10], ['submit', 5], ['outstanding', 10], ['belief', 5], ['observe', 3], ['tell', 5], ['knows', 2],
      ['canon-item', 3], ['item', 20], ['summary-query', 5], ['crew', 5], ['decision', 8], ['order', 2], ['dilemma', 1], ['seed', 2], ['record', 10],
    ];
    for (const [label, n] of atLeast) expect(labels.get(label) ?? 0, label).toBeGreaterThanOrEqual(n);
    expect(maxBatchesAfterLoad).toBeGreaterThan(0);
    const records = k.persistence.records();
    expect(records.some((r) => r.snapshot !== undefined)).toBe(true);
    const children = new Map<string, number>();
    for (const r of records) children.set(String(r.parent), (children.get(String(r.parent)) ?? 0) + 1);
    expect([...children.values()].some((n) => n > 1)).toBe(true); // a branch: two saves made from one
    const kinds = new Set(records.flatMap((r) => r.ops.map((o) => o.op)));
    for (const op of ['BeliefSet', 'SummarySet', 'FrameState', 'ProcessState', 'SeedState', 'EventCanon', 'PinEnded']) expect(kinds.has(op as never), op).toBe(true);
    expect(records.every((r) => r.meta.packs.length === 1)).toBe(true);
  });

  /** Run the script with one method of the kernel replaced, then put it back. */
  function digestWith<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]): string {
    const original = target[key];
    target[key] = replacement;
    try {
      return run().digest;
    } finally {
      target[key] = original;
    }
  }

  test('SR-14: the digest moves when a save, a load, the belief, summary or outstanding-batch state, or a group decision changes', () => {
    const base = run().digest;
    expect(base).toBe('d534e0dcef3f85d27cefa552217152ec');
    // A save record that differs only in its lineage metadata.
    const save = Persistence.prototype.save;
    expect(digestWith(Persistence.prototype, 'save', function (this: Persistence, key: string) {
      const rec = save.call(this, key);
      rec.meta.total += 1;
      return rec;
    })).not.toBe(base);
    // A load that restores no beliefs, no canon items of summaries, or no outstanding batches.
    expect(digestWith(Beliefs.prototype, 'restore', () => {})).not.toBe(base);
    expect(digestWith(Summaries.prototype, 'setRecord', () => {})).not.toBe(base);
    const restore = Evolution.prototype.restore;
    expect(digestWith(Evolution.prototype, 'restore', function (this: Evolution, states, cursor) {
      restore.call(this, states.map((st) => ({ ...st, outstanding: [] })), cursor);
    })).not.toBe(base);
    // A group whose decisions never raise a dilemma.
    expect(digestWith(Frames.prototype, 'checkDilemmas', () => 1)).not.toBe(base);
    // And with every patch undone the digest is back.
    expect(run().digest).toBe(base);
  });

  test('SR2-08: the digest moves when a group decision or an order changes its resulting frame state directly', () => {
    const base = run().digest;
    // A weight decision that always sets weight zero.
    const setWeight = Frames.prototype.setWeight;
    expect(digestWith(Frames.prototype, 'setWeight', function (this: Frames, id, _weight, cause) {
      return setWeight.call(this, id, 0, cause);
    })).not.toBe(base);
    // A status decision that always reactivates, and an interests decision that always clears what it was given.
    const decide = Groups.prototype.decide;
    expect(digestWith(Groups.prototype, 'decide', function (this: Groups, leader, group, decision) {
      return decide.call(this, leader, group, decision.op === 'status' ? { ...decision, status: 'active' } : decision);
    })).not.toBe(base);
    expect(digestWith(Groups.prototype, 'decide', function (this: Groups, leader, group, decision) {
      return decide.call(this, leader, group, decision.op === 'interests' ? { ...decision, own: {} } : decision);
    })).not.toBe(base);
    // An order issued at half its pressure.
    const issueOrder = Groups.prototype.issueOrder;
    expect(digestWith(Groups.prototype, 'issueOrder', function (this: Groups, opts) {
      return issueOrder.call(this, { ...opts, pressure: opts.pressure / 2 });
    })).not.toBe(base);
    expect(run().digest).toBe(base);
  });

  test('a second run of the same script gives the same digest (no hidden state, no iteration-order dependence)', () => {
    expect(run().digest).toBe(run().digest);
  });
});
