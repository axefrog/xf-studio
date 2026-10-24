import { expect, test } from 'bun:test';
import { complete, kit, pattern, world } from './helpers.ts';
import { oracle } from './transcript-oracle.ts';
import frozen from './transcript.json';

test('S3 frozen transcript: independently encoded identities, draw values and persisted hand-over records', () => {
  const expected = oracle();
  expect(expected, 'independent S0/S3 identity and draw vectors').toEqual(frozen);
  const t = kit({ roles: { ...kit().roles, story: { kind: 'core:event', must: [{ path: 'kind', op: 'eq', arg: 'meta:story' }], onUnfilled: ['wait'] } } }),
    p = pattern({ telling: { form: 'recap', binds: { subject: '?a', other: '?b', story: '?story' } } }),
    w = world('S3-TRANSCRIPT', { seeds: [t], patterns: [p] });
  complete(w); w.k.settle();
  const entry = structuredClone(w.l3.state.pool[0]);
  expect(entry).toEqual({ id: expected.match, bindingKey: expected.binding, seq: 0, pattern: p.id, version: 1,
    bindings: { '?a': expected.a, '?b': expected.b }, stages: [{ event: expected.first, time: 100 }, { event: expected.last, time: 101 }],
    firstTime: 100, lastTime: 101, complete: true, story: expected.story, refusals: 0, cooldownUntil: 0 });
  expect(w.l3.keys.slot(1, 4500)).toEqual(expected.slot);
  w.k.settings.set({ tempo: 'restless' });
  w.l2.baseTotal = expected.slot.time; w.l3.state.slots.open.next = 1;
  w.l3.sower.resolve({ A: 0, L: 0, C: 0, S: 0 });
  const log = w.l3.log.find((e) => e.rule === 'sow')!;
  expect(log).toBeDefined();
  const scores = log.data.scores as Array<{ key: string; score: number; noise: number }>,
    kits = log.data.kitScores as Array<{ key: string; score: number; noise: number }>;
  expect(scores[0].key).toBe(expected.candidate);
  expect(scores[0].score).toBe(0.5); // Constant features are skipped: neutral composite 0.5, no duplicate penalty.
  expect(kits[0].score).toBe(0); // weight 1, no recent kit: ln(1) = 0.
  // Independent host ln checks the noise to binary64 tolerance; frozen uniforms above are exact.
  expect(Math.abs(scores[0].noise + Math.log(-Math.log(expected.pick)))).toBeLessThan(1e-14);
  expect(Math.abs(kits[0].noise + Math.log(-Math.log(expected.kitDraw)))).toBeLessThan(1e-14);
  expect(w.l2.all().map((i) => i.id)).toEqual([expected.instance]);
  w.l3.sifter.sweep(w.k.now); w.l3.flush();
  const saved = w.k.persistence.save('s3-transcript'),
    op = saved.ops.find((op) => op.op === 'SeedState' && op.id === expected.record);
  expect(op?.op).toBe('SeedState');
  if (!op || op.op !== 'SeedState') throw new Error('S3 record missing');
  expect(op.seed).toMatchObject({ id: expected.record, nodes: [], state: {
    schema: 1, slots: { open: { next: 2 } }, nextSeq: 1, openLockUntil: 0, consumedOutcomes: [], pool: [], buffer: [],
    tombstones: [{ pattern: p.id, key: expected.tombstone, until: 1301 }],
    pending: [{ instance: expected.instance, sownAt: expected.slot.time }],
    recent: [{ pattern: p.id, kit: t.id, at: expected.slot.time }],
  } });
  expect(w.l3.state.evidence.map((e) => ({ id: e.id, time: e.time, kind: e.kind, causes: e.causes })).sort((a, b) => a.time - b.time || a.kind.localeCompare(b.kind)))
    .toEqual([{ id: expected.first, time: 100, kind: 'insult', causes: [] },
      { id: expected.last, time: 101, kind: 'assault', causes: [expected.first] },
      { id: expected.story, time: 101, kind: 'meta:story', causes: [expected.first, expected.last] }]);
});
