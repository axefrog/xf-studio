import { describe, expect, test } from 'bun:test';
import { H, id, rand, s, i } from '../src/id.ts';
import type { ProcessDef } from '../src/evolution.ts';
import type { Kernel } from '../src/kernel.ts';
import type { Id } from '../src/types.ts';
import { coreKernel, defsOf, dim, fxKernel, fxSeed, kind, slot } from './helpers.ts';

const W = 600;
const cause = H(s('test-cause'));

const counterDefs = defsOf(
  [dim('fx:count', { t: 'int', min: 0, max: 1_000_000 })],
  [kind('fx:counter', [slot('counter', 'fx:count', { mode: 'assigned', temporal: { window: W } }), slot('x', 'fx:count', { mode: 'assigned', temporal: { window: W } })])],
);

const tally = (node: Id): ProcessDef => ({
  id: 'tally',
  tier: 0,
  period: 1,
  run(ctx, k) {
    const prev = (ctx.value(node, 'counter', (k - 1) * W) as number | undefined) ?? 0;
    return [{ op: 'pin', node, slot: `counter@w${k}`, value: prev + Math.floor(ctx.rand() * 10) }];
  },
});

function history(k: Kernel, node: Id, windows: number): Array<number | undefined> {
  return Array.from({ length: windows }, (_, w) => k.value(node, 'counter', w * W) as number | undefined);
}

describe('F-13 partition independence (spec 9.4, I-15)', () => {
  const build = () => {
    const k = fxKernel('F-13', counterDefs);
    const node = k.root('c', 'fx:counter');
    k.evolution.register(tally(node));
    return { k, node };
  };

  test('F-13: 12 windows as one tick and as 12 ticks give identical counter histories', () => {
    const one = build();
    one.k.tick({ to: 12 * W });
    const many = build();
    for (let j = 1; j <= 12; j++) many.k.tick({ to: j * W });
    const h1 = history(one.k, one.node, 12);
    const h2 = history(many.k, many.node, 12);
    expect(h1).toEqual(h2);
    expect(h1.every((x) => x !== undefined)).toBe(true);
    // The history follows the specified recurrence with the specified randomness.
    const seed = fxSeed('F-13');
    let acc = 0;
    for (let w = 0; w < 12; w++) {
      acc += Math.floor(rand(s('proc'), id(seed), s('tally'), i(w)) * 10);
      expect(h1[w]).toBe(acc);
    }
    // The window being computed is held, not applied: window 12 is outstanding.
    expect(one.k.value(one.node, 'counter', 12 * W)).toBeUndefined();
    expect(one.k.evolution.stateOf('tally').outstanding.map((b) => b.k)).toEqual([12]);
    expect(many.k.evolution.stateOf('tally').outstanding.map((b) => b.k)).toEqual([12]);
  });

  test('a tiny budget changes nothing about the history, only how many ticks it takes', () => {
    const slow = build();
    let ticks = 0;
    let r = slow.k.tick({ to: 12 * W, budget: 1 });
    ticks++;
    while (!r.done && ticks < 100) {
      r = slow.k.tick({ to: 12 * W, budget: 1 });
      ticks++;
    }
    expect(ticks).toBeGreaterThan(2);
    const fast = build();
    fast.k.tick({ to: 12 * W });
    expect(history(slow.k, slow.node, 12)).toEqual(history(fast.k, fast.node, 12));
  });

  test('processes see only applied state: outputs wait for the end of their span (double buffering)', () => {
    const k = fxKernel('double-buffer', counterDefs);
    const node = k.root('c', 'fx:counter');
    const seen: Array<{ now: number | undefined; prev: number | undefined }> = [];
    k.evolution.register({ id: 'a', tier: 0, period: 1, run: (_c, w) => [{ op: 'pin', node, slot: `x@w${w}`, value: w + 1 }] });
    k.evolution.register({
      id: 'b', tier: 1, period: 1,
      run(ctx, w) {
        seen.push({ now: ctx.value(node, 'x', w * W) as number | undefined, prev: ctx.value(node, 'x', (w - 1) * W) as number | undefined });
        return [];
      },
    });
    k.tick({ to: 4 * W });
    expect(seen.map((x) => x.now)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(seen.map((x) => x.prev)).toEqual([undefined, 1, 2, 3, 4]);
  });

  test('at a boundary outputs apply by tier (coarse first), then id', () => {
    const k = fxKernel('order', counterDefs);
    const node = k.root('c', 'fx:counter');
    const mk = (pid: string, tier: 0 | 1 | 2, slotKey: string, v: number): ProcessDef => ({
      id: pid, tier, period: 1, run: (_c, w) => [{ op: 'pin', node, slot: `${slotKey}@w${w}`, value: v }],
    });
    k.evolution.register(mk('zeta', 0, 'x', 1));
    k.evolution.register(mk('alpha', 2, 'counter', 2));
    k.evolution.register(mk('beta', 1, 'x', 3));
    k.tick({ to: 2 * W });
    const order = k.store.allPins().filter((p) => p.slot.endsWith('@w0')).map((p) => p.value);
    expect(order).toEqual([1, 3, 2]);
  });

  test('a process with period n runs when k mod n = 0 and its batch applies n windows later', () => {
    const k = fxKernel('period', counterDefs);
    const node = k.root('c', 'fx:counter');
    const runs: number[] = [];
    k.evolution.register({
      id: 'slow', tier: 0, period: 3,
      run(_c, w) {
        runs.push(w);
        return [0, 1, 2].map((d) => ({ op: 'pin' as const, node, slot: `x@w${w + d}`, value: 10 * w + d }));
      },
    });
    k.tick({ to: 2 * W });
    expect(runs).toEqual([0]);
    expect(k.value(node, 'x', 0)).toBeUndefined();
    k.tick({ to: 3 * W });
    expect(runs).toEqual([0, 3]);
    expect([0, 1, 2].map((w) => k.value(node, 'x', w * W))).toEqual([0, 1, 2]);
    expect(k.value(node, 'x', 3 * W)).toBeUndefined();
    k.tick({ to: 6 * W });
    expect([3, 4, 5].map((w) => k.value(node, 'x', w * W))).toEqual([30, 31, 32]);
  });

  test('the cursor is persisted state: a second advance to the same time does nothing', () => {
    const { k, node } = build();
    k.tick({ to: 3 * W });
    const rev = k.revision;
    const r = k.tick({ to: 3 * W });
    expect(r.boundaries).toBe(0);
    expect(k.revision).toBe(rev);
    expect(history(k, node, 3).every((x) => x !== undefined)).toBe(true);
  });

  test('fine tiers (3-5) run only where demand reaches them, and never catch up', () => {
    const k = coreKernel('fine', counterDefs);
    const node = k.root('c', 'fx:counter');
    const runs: number[] = [];
    k.evolution.register({ id: 'fine', tier: 3, period: 1, run: (_c, w) => (runs.push(w), []) });
    const v = k.root('v', 'core:person');
    k.tick({ to: 5 * W });
    expect(runs).toEqual([]);
    // V arrives at 5.5 windows: a frame focusing a tier-3 node.
    k.now = 5 * W + 300;
    k.frames.demandRoots.add(v);
    const f = k.frames.open({ actor: v, level: 'situation', origin: v, weight: 1, focus: { nodes: [node], tier: 3 }, cause });
    k.tick({ to: 8 * W });
    expect(runs).toEqual([6, 7, 8]);
    // The demand ends; the run for the open window is still coming, and then no more.
    k.now = 8 * W + 100;
    k.frames.setStatus(f.id, 'satisfied', cause);
    k.tick({ to: 11 * W });
    expect(runs).toEqual([6, 7, 8]);
    expect(k.frames.demandHistory().filter((e) => e.tier === 3)).toEqual([{ tier: 3, from: 5 * W + 300, to: 8 * W + 100 }]);
  });

  test('external operations apply at the boundary after their stamp, in stamp order; a stale epoch is refused', () => {
    const defs = defsOf(
      [dim('fx:wx', { t: 'enum', values: ['clear', 'rain'] })],
      [kind('fx:weather', [slot('weather', 'fx:wx', { mode: 'mirrored' })])],
    );
    const k = fxKernel('external', defs);
    const w = k.mirrored('weather', 'fx:weather');
    const oldEpoch = k.epoch;
    expect(k.submit({ epoch: oldEpoch, stamp: 700, op: { op: 'reading', node: w, slot: 'weather', value: 'rain' } }).accepted).toBe(true);
    expect(k.submit({ epoch: oldEpoch, stamp: 650, op: { op: 'reading', node: w, slot: 'weather', value: 'clear' } }).accepted).toBe(true);
    k.tick({ to: W });
    expect(k.resolve(w, 'weather', 800)).toEqual({ status: 'unavailable' });
    k.tick({ to: 2 * W });
    expect(k.value(w, 'weather', 660)).toBe('clear');
    expect(k.value(w, 'weather', 800)).toBe('rain');
    expect(k.evolution.queued).toHaveLength(0);
    const fresh = k.newEpoch();
    expect(fresh).not.toBe(oldEpoch);
    expect(k.submit({ epoch: oldEpoch, stamp: 1300, op: { op: 'reading', node: w, slot: 'weather', value: 'clear' } })).toEqual({
      accepted: false, reason: 'the operation was created in an earlier epoch',
    });
  });

  test('a process may mint events, edges and contributions as plain-data ops', () => {
    const k = coreKernel('ops');
    const alice = k.root('alice', 'core:person');
    const place = k.root('place', 'core:place');
    k.evolution.register({
      id: 'maker', tier: 1, period: 1,
      run: (_c, w) => (w === 0
        ? [
            { op: 'mint-event', spec: { name: 'e0', time: 5, kind: 'meeting', place, participants: [{ who: alice, role: 'actor' }] } },
            { op: 'edge', type: 'core:located-in', from: alice, to: place },
            { op: 'contribute', target: { slot: 'age', scope: { nodes: [alice] } }, form: { f: 'const', value: 33 }, mode: 'constrain' },
          ]
        : []),
    });
    k.tick({ to: 2 * W });
    expect(k.store.edgesFrom(alice).map((e) => e.type)).toEqual(['core:located-in']);
    expect(k.value(alice, 'age')).toBe(33);
    const events = k.store.idsOfKind('core:event');
    expect(events).toHaveLength(1);
    expect(k.value(events[0]!, 'kind')).toBe('meeting');
  });
});
