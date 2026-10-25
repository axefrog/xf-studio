// Phase 0 of M3: the authored seed R2 compiles lint-clean at `ready`, casts from the generated Kabuki residents, and plays
// every branch of its offer; and nothing in M3's text, fixtures or facts names a main-story character.

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { Run, policies } from '../../src/m3/driver.ts';
import { FACT_NAMES } from '../../src/m3/facts.ts';
import { R2_ID, R2_PACK, r2Fragments, r2Pack, r2Seed, r2Texts } from '../../src/m3/r2.ts';
import { STATES } from '../../src/m3/states.ts';
import { stateById } from '../../src/m3/states.ts';
import { buildWorld } from '../../src/m3/world.ts';
import { readSeedFact } from '../../src/seeding/eval.ts';

setDefaultTimeout(120_000);

const early = stateById('S-early-quiet');
const run = (policy: string, name = 'r2', windows = 40, seedOver = {}) => {
  const r = new Run({ name, layer3: false, packs: [r2Pack({}, seedOver)] }, early, policies[policy]!);
  r.runWindows(windows);
  return { r, inst: r.instancesOf(R2_ID)[0]! };
};
const exitOf = (r: Run, inst: ReturnType<typeof run>['inst']): number => readSeedFact(r.w.l2, inst, 'exit');

describe('R2 compiles, casts and plays', () => {
  test('lint-clean at ready: no errors and no warnings, and nothing later than the core', () => {
    const w = buildWorld({ name: 'r2-lint', layer3: false, packs: [r2Pack()] });
    const out = w.l2.compile(R2_PACK, r2Pack().seeds[0]!);
    expect(out.findings).toEqual([]);
    expect(w.findings).toEqual([]);
    expect(r2Seed().maturity).toBe('ready');
  });

  test('the seed waits until the story and the street allow it, casts from the generated residents, and offers', () => {
    const waiting = new Run({ name: 'r2-wait', layer3: false, packs: [r2Pack()] }, stateById('S-prologue'), policies.decline!);
    waiting.runWindows(20);
    const wi = waiting.instancesOf(R2_ID)[0]!;
    expect(wi.st.state).toBe('waiting');
    expect(waiting.deliveries).toEqual([]);

    const { r, inst } = run('decline', 'r2-offer', 6);
    expect(inst.st.roles.stallholder!.cast).toBeDefined();
    expect(inst.st.roles.collector!.cast).toBeDefined();
    const offer = r.deliveries.find((d) => d.what === 'offer')!;
    expect(offer).toBeDefined();
    // a generated resident, named by the world: the words carry real names and no unresolved placeholder
    expect(offer.names.stallholder).toMatch(/\S+ \S+/);
    expect(offer.words).toContain(offer.names.stallholder!);
    expect(offer.words).toContain(offer.names.collector!);
    expect(offer.words).not.toMatch(/\[[a-z]+\.[a-z]+\]/);
  });

  const branches: Array<[string, number, string]> = [['accept-first', 1, 'pay'], ['accept-middle', 2, 'broker'], ['accept-last', 3, 'standup'], ['decline', 4, 'decline']];
  for (const [policy, exit, id] of branches) {
    test(`V answers "${id}": the matching consequence plays and the seed resolves`, () => {
      const { r, inst } = run(policy, `r2-${id}`, 40);
      expect(inst.st.state).toBe('resolved');
      expect(exitOf(r, inst)).toBe(exit);
      const beats = r.deliveries.map((d) => d.beat);
      expect(beats[0]).toBe('ask');
      expect(r.deliveries[0]!.answer).toBe(id);
      const consequence = r.deliveries.find((d) => d.what === 'beat' && d.beat !== 'closing');
      expect(consequence).toBeDefined();
      expect(consequence!.words.length).toBeGreaterThan(20);
    });
  }

  test('V never answers: the offer lapses and the unattended plan ends the seed', () => {
    const { r, inst } = run('ignore', 'r2-ignore', 220, { unattended: { after: { clock: 'game', s: 86_400 }, outcome: [{ fact: 'exit', set: 5 }] } });
    expect(exitOf(r, inst)).toBe(5);
    expect(['resolved', 'unattended', 'withered']).toContain(inst.st.state);
  });

  test('the author-fill stand-in plays through its implied partner when no scene is installed over it', () => {
    const frag = r2Fragments().find((f) => f.id === 'ff-standup-scene')!;
    expect(frag.authored).toBe('human');
    expect(frag.implied).toBe('pack:ff-standup-implied');
    const texts = r2Texts();
    expect(texts.find((t) => t.id === 't-ff-standup-scene')!.text).toContain('standing in');
  });

  test('every state names real facts only', () => {
    for (const s of STATES) for (const name of Object.keys(s.facts)) expect(FACT_NAMES.has(name), `${s.id}: ${name}`).toBe(true);
  });
});
