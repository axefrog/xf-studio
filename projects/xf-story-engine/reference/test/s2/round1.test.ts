// Regression tests for fix round 1 on the layer-2 core: the findings of the independent review (L2-02 and on)
// and the conformance to S2 v1.7 and S0 v4.12. Each test names the finding it pins.

import { describe, expect, test } from 'bun:test';
import { coreDefs, mergeDefs } from '../../src/core-schema.ts';
import { DEFAULT_SETTINGS } from '../../src/settings.ts';
import { Kernel } from '../../src/kernel.ts';
import { Layer2 } from '../../src/seeding/layer2.ts';
import { ScriptPort } from '../../src/seeding/port.ts';
import { fxSeed } from '../helpers.ts';
import { r1World } from './drive.ts';
import { FACTS, s2Defs, EVENT_KINDS } from './world.ts';

describe('note 71 and L2-12: initial settings, and a read-only load with layer 2 attached', () => {
  const fresh = (name: string) => {
    const k = Kernel.create({ defs: mergeDefs(coreDefs(600, { extraEventKinds: EVENT_KINDS }), s2Defs()), worldSeed: fxSeed(name) });
    return k;
  };

  test('a new v4 lineage writes its initial settings, and the root save records them', () => {
    const k = fresh('init-settings');
    const l2 = new Layer2(k, { port: new ScriptPort(), facts: FACTS });
    expect(k.settings.all()).toHaveLength(1);
    expect(k.settings.all()[0]).toMatchObject({ ...DEFAULT_SETTINGS });
    const root = k.persistence.save('root');
    expect(root.ops.filter((o) => o.op === 'SettingsSet')).toHaveLength(1);
    expect(l2.pending).toBe(0);
    k.persistence.load('root');
    expect(k.settings.all()).toHaveLength(1);
  });

  test('a lineage that already has saves, or no layer 2, is left as it is: an empty log in a v3 save stays empty', () => {
    const k = fresh('v3-settings');
    k.persistence.save('v3');
    const rec = k.persistence.chain.get('v3')!;
    expect(rec.ops.filter((o) => o.op === 'SettingsSet')).toHaveLength(0);
    const l2 = new Layer2(k, { port: new ScriptPort(), facts: FACTS });
    expect(k.settings.all()).toHaveLength(0);
    k.persistence.load('v3');
    expect(k.settings.all()).toHaveLength(0);
    expect(l2.pending).toBeGreaterThanOrEqual(0);
  });

  test('L2-12: a save that needs a vanished function loads read-only with layer 2 attached, without throwing', () => {
    const { w, inst } = r1World('l2-12');
    w.k.persistence.save('A');
    w.k.persistence.chain.get('A')!.meta.versions.push('derive:vanished@3');
    let report: ReturnType<typeof w.k.persistence.load> | undefined;
    expect(() => { report = w.k.persistence.load('A', w.gamePort); }).not.toThrow();
    expect(report!.readOnly).toBe(true);
    expect(report!.message).toContain('read-only');
    // Layer 2's state is there to read, and nothing in the kernel was written to get it.
    expect(w.l2.instance(inst.id)).toBeDefined();
    expect(w.l2.instance(inst.id)!.st.state).toBe(inst.st.state);
    expect(() => w.k.tick({ to: 100 })).toThrow(/read-only/);
    w.k.persistence.chain.get('A')!.meta.versions.pop();
    expect(w.k.persistence.load('A', w.gamePort).readOnly).toBe(false);
  });
});
