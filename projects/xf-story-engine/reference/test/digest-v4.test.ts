// The determinism digest of the v4 kernel: the same 1,000-operation script as test/digest.test.ts, with the
// v4 core schema and the frame change switched on (the defaults). The frozen v3 digest runs with both off and
// uses those older options; both save referenced event facts under S0 v4.15 (SPEC-NOTES 58, 191).

import { describe, expect, test } from 'bun:test';
import { digestOf, makerProcess, moodProcess, startWorld, synKernel } from './synthetic.ts';

describe('the v4 determinism digest', () => {
  const run = () => {
    const k = synKernel('digest', { snapshotEvery: 40 });
    const w = startWorld(k);
    k.evolution.register(moodProcess(() => w.agents));
    k.evolution.register(makerProcess(() => w));
    k.persistence.installPack({
      id: 'demo', version: '1.0.0',
      contributions: [{ layer: 'authored', target: { kind: 'syn:agent', slot: 'size' }, mode: 'weight', form: { f: 'table', weights: { '2': 3 } } }],
    });
    return { ...digestOf(w, 1000, 'script-1'), k };
  };

  test('1,000 mixed operations hash to the frozen v4 digest', () => {
    const { digest, entries } = run();
    // 1,067 entries in v3; the frame change adds two relevance emissions (a `wants` on a site matches a frame
    // focused on it when the frame's status changes).
    expect(entries).toBe(1069);
    expect(digest).toBe('42d5a84e16dde21cc0bca7fe50c01d72');
  });

  test('each v4 switch moves the digest on its own, so the v3 digest is a deliberate mode', () => {
    const k3 = synKernel('digest', { snapshotEvery: 40, frameChanges: false }, { v4: false });
    const w3 = startWorld(k3);
    k3.evolution.register(moodProcess(() => w3.agents));
    k3.evolution.register(makerProcess(() => w3));
    k3.persistence.installPack({
      id: 'demo', version: '1.0.0',
      contributions: [{ layer: 'authored', target: { kind: 'syn:agent', slot: 'size' }, mode: 'weight', form: { f: 'table', weights: { '2': 3 } } }],
    });
    expect(digestOf(w3, 1000, 'script-1').digest).toBe('f924d2c9d1159bca85bbfa4cf18dba6c');
  });
});
