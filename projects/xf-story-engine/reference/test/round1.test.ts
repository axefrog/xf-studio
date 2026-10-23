// Regression tests for the kernel-level findings of the independent review of the v4 core (fix round 1):
// L2-01 (a discarded batch reaches queued notifications), L2-04 (operation identity reads the epoch),
// L2-13 (a frame change takes its focus when it is emitted), and S0 section 14.2a's shared allowance.

import { describe, expect, test } from 'bun:test';
import { coreDefs, mergeDefs } from '../src/core-schema.ts';
import { makeConfig } from '../src/config.ts';
import { H, s } from '../src/id.ts';
import { Kernel } from '../src/kernel.ts';
import { coreRegistry } from '../src/registry.ts';
import { Schema } from '../src/schema.ts';
import type { Id } from '../src/types.ts';
import { coreKernel, defsOf, dim, fxSeed, kind, slot } from './helpers.ts';

const cause = H(s('cause'), s('round1'));
const abc = defsOf([dim('fx:abc', { t: 'enum', values: ['a', 'b', 'c'] })], [kind('fx:t', [slot('x', 'fx:abc')], { extends: ['core:thing'] })]);

describe('L2-01: a discarded batch leaves queued notifications as they were', () => {
  test('a queued edge notification keeps the edge as it was when it was made', () => {
    const k = coreKernel('L2-01a', abc);
    const a = k.root('a', 'fx:t');
    const b = k.root('b', 'fx:t');
    const e = k.addEdge({ type: 'core:located-in', from: a, to: b, cause });
    expect(k.pending).toHaveLength(1);
    const batch = k.stage();
    batch.write((kk) => kk.endEdge(e.id, 10));
    batch.discard();
    expect(k.store.edges.get(e.id)!.valid.to).toBeUndefined();
    const queued = k.pending[0]!.change;
    expect(queued.c === 'edge' && queued.edge.valid.to).toBeUndefined();
  });

  test('a queued notification is also a snapshot against later committed writes', () => {
    const k = coreKernel('L2-01b', abc);
    const a = k.root('a', 'fx:t');
    const b = k.root('b', 'fx:t');
    const e = k.addEdge({ type: 'core:located-in', from: a, to: b, cause });
    k.endEdge(e.id, 10);
    const [first, second] = k.pending.filter((p) => p.change.c === 'edge').map((p) => p.change);
    expect(first!.c === 'edge' && first!.ended).toBe(false);
    expect(first!.c === 'edge' && first!.edge.valid.to).toBeUndefined();
    expect(second!.c === 'edge' && second!.ended).toBe(true);
    expect(second!.c === 'edge' && second!.edge.valid.to).toBe(10);
  });

  test('a queued contribution notification is not altered by a batch that ends the contribution and is discarded', () => {
    const k = coreKernel('L2-01c', abc);
    const a = k.root('a', 'fx:t');
    const c = k.contribute({ source: { layer: 'authored', origin: a }, target: { slot: 'x', scope: { nodes: [a] } }, form: { f: 'const', value: 'b' }, mode: 'constrain' });
    const batch = k.stage();
    batch.write((kk) => kk.endContribution(c.id, 50));
    batch.discard();
    expect(k.store.contribution(c.id)!.valid.to).toBeUndefined();
    const queued = k.pending.find((p) => p.change.c === 'contribution')!.change;
    expect(queued.c === 'contribution' && queued.contribution.valid.to).toBeUndefined();
  });
});

describe('L2-04: an external operation\'s identity and order do not read the epoch', () => {
  const abcSeed = (epoch: string) => {
    const schema = Schema.load(
      mergeDefs(coreDefs(), defsOf([dim('fx:abc', { t: 'enum', values: ['a', 'b', 'c'] })], [kind('fx:t', [slot('x', 'fx:abc', { mode: 'mirrored' })], { extends: ['core:thing'] })])),
      coreRegistry(), makeConfig(),
    );
    const k = new Kernel({ schema, worldSeed: fxSeed('L2-04'), epochSource: () => H(s(epoch)) });
    const node = k.mirrored('thing', 'fx:t');
    return { k, node };
  };

  test('the same timestamped readings give the same accepted Ids and the same applied order under any epoch', () => {
    const run = (epoch: string) => {
      const { k, node } = abcSeed(epoch);
      const r1 = k.submit({ epoch: k.epoch, stamp: 100, op: { op: 'reading', node, slot: 'x', value: 'a' } });
      const r2 = k.submit({ epoch: k.epoch, stamp: 100, op: { op: 'reading', node, slot: 'x', value: 'b' } });
      const r3 = k.submit({ epoch: k.epoch, stamp: 100, op: { op: 'reading', node, slot: 'x', value: 'a' } });
      k.settle({ to: 1200 });
      return { ids: [r1, r2, r3].map((r) => (r.accepted ? r.id : 'refused')), now: k.value(node, 'x', 1200), k };
    };
    const one = run('epoch-one');
    const two = run('epoch-two');
    expect(one.ids).toEqual(two.ids);
    expect(one.ids[0]).not.toBe(one.ids[2]);
    expect(one.now).toBe(two.now);
    expect(one.k.epoch).not.toBe(two.k.epoch);
  });

  test('the epoch still refuses a stale operation', () => {
    const { k, node } = abcSeed('epoch-three');
    const stale = H(s('some-older-epoch'));
    expect(k.submit({ epoch: stale, stamp: 5, op: { op: 'reading', node, slot: 'x', value: 'a' } })).toMatchObject({ accepted: false });
  });
});

describe('L2-13 and S0 v4.12: a frame change carries the focus it had when it was made', () => {
  function world() {
    const k = coreKernel('L2-13', abc);
    const v = k.root('v', 'core:person');
    k.frames.demandRoots.add(v);
    const x = k.root('x', 'fx:t');
    const y = k.root('y', 'fx:t');
    const watch = (node: Id) => k.frames.open({
      actor: v, level: 'concern', origin: v, weight: 1, cause, own: { reactsTo: [{ kind: 'fx:t', slot: '*', scope: { nodes: [node] } }] },
    });
    const wx = watch(x);
    const wy = watch(y);
    const npc = k.frames.open({ actor: k.root('npc', 'core:person'), level: 'goal', origin: v, weight: 1, cause, focus: { nodes: [x], tier: 3 } });
    k.settle();
    k.dispatcher.drain();
    return { k, x, y, wx, wy, npc };
  }

  test('the change carries the focus nodes of the moment it was emitted', () => {
    const { k, x, y, npc } = world();
    k.frames.setStatus(npc.id, 'satisfied', cause);
    k.frames.setFocus(npc.id, { nodes: [y] }, cause);
    const ch = k.pending.find((p) => p.change.c === 'frame')!.change;
    expect(ch.c === 'frame' && ch.focus).toEqual([x]);
  });

  test('moving the focus before dispatch does not change who hears an earlier status change, drained or batched', () => {
    const heard = (drainBetween: boolean): Id[] => {
      const { k, y, npc } = world();
      k.frames.setStatus(npc.id, 'satisfied', cause);
      const early = drainBetween ? (k.settle(), k.dispatcher.drain()) : [];
      k.frames.setFocus(npc.id, { nodes: [y] }, cause);
      k.settle();
      return [...early, ...k.dispatcher.drain()].filter((r) => r.change.c === 'frame').map((r) => r.frame);
    };
    const { wx } = world();
    expect(heard(false)).toEqual([wx.id]);
    expect(heard(true)).toEqual([wx.id]);
  });
});

describe('S0 14.2a: the work of a batch is bounded by one shared allowance', () => {
  test('reads through a batch draw on one allowance, not a fresh one each', () => {
    const k = coreKernel('batch-allowance', abc, { allowance: 12 });
    const nodes = Array.from({ length: 30 }, (_, n) => k.root(`n${n}`, 'fx:t'));
    for (const n of nodes) k.pin({ node: n, slot: 'x', value: 'b', reason: 'authored', cause });
    // Outside a batch, every read has its own allowance and each is fine.
    for (const n of nodes) expect(k.resolve(n, 'x').status).toBe('ok');
    k.invalidateCaches();
    const batch = k.stage();
    batch.write((kk) => kk.pin({ node: nodes[0]!, slot: 'x', value: 'c', reason: 'committed', cause }));
    const statuses = nodes.map((n) => batch.resolve(n, 'x').status);
    expect(statuses).toContain('failed');
    expect(statuses[0]).not.toBe('failed');
    expect(batch.used).toBeGreaterThan(12);
    expect(k.defects.ofKind('limit').length).toBeGreaterThan(0);
    batch.discard();
  });
});
