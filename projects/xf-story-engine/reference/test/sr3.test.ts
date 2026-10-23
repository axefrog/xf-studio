// Regression test for the finding of the third independent review (SR3-01). It failed before the fix.

import { describe, expect, test } from 'bun:test';
import { H, memberId, s } from '../src/id.ts';
import { coreKernel, defsOf, dim, kind, slot } from './helpers.ts';

const cause = H(s('test-cause'));

const crowdDefs = defsOf(
  [dim('fx:cnt', { t: 'int', min: 0, max: 30 }), dim('fx:member', { t: 'node', kind: 'core:trait' })],
  [kind('fx:crowd', [slot('members', 'fx:member', { card: { many: { count: 'fx:cnt' } } })], { extends: ['core:thing'] })],
);

describe('SR3-01 processes starting at one boundary share its snapshot', () => {
  test('SR3-01: a batch queued by one process does not change what another reads at the same boundary', () => {
    const k = coreKernel('SR3-01', crowdDefs);
    const c = k.root('crowd', 'fx:crowd');
    // Member 15 exists (it was addressed while the crowd was larger), but the count is now 1 and nothing retains it.
    const big = k.pin({ node: c, slot: 'members#count', value: 16, reason: 'committed', cause });
    const m15 = k.address(c, 'members[15]');
    expect(m15).toBe(memberId(c, 'members', 15));
    k.withdrawPin(big.id, cause);
    k.pin({ node: c, slot: 'members#count', value: 1, reason: 'committed', cause });
    expect(k.value(c, 'members#count')).toBe(1);
    const reads: Record<string, unknown> = {};
    // Process "a" runs first (same tier, lower id) and queues a pin on member 15 for later.
    k.evolution.register({
      id: 'a', tier: 0, period: 2,
      run: (ctx, b) => {
        reads.a = ctx.value(c, 'members#count');
        return b === 0 ? [{ op: 'pin', node: m15, slot: 'strength', value: 0.5 }] : [];
      },
    });
    k.evolution.register({ id: 'b', tier: 0, period: 2, run: (ctx) => { reads.b = ctx.value(c, 'members#count'); return []; } });
    k.tick({ to: 0 });
    expect(reads).toEqual({ a: 1, b: 1 });
    // Once published, the queued batch retains member 15, and the structural floor applies.
    expect(k.retention.isRetained(m15)).toBe(true);
    expect(k.value(c, 'members#count') as number).toBeGreaterThanOrEqual(16);
  });
});
