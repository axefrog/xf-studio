import { expect, test } from 'bun:test';
import { coreKernel } from './helpers.ts';
import { H, s } from '../src/id.ts';
import { readEvent } from '../src/procedural/views.ts';

test('S3-kernel: outstanding output keeps referenced non-canon event facts through replacement replay', () => {
  const run = (load: boolean) => {
    const k = coreKernel('process-event-facts'), creator = k.root('producer', 'core:person'),
      person = k.mint(creator, creator, 'participant', 'core:person'),
      cause = k.events.mintEvent({ creator, cause: creator, name: 'earlier', kind: 'arrival', time: 1,
        participants: [{ who: person, role: 'actor' }] }),
      raw = k.events.mintEvent({ creator, cause: H(s('raw')), name: 'raw', kind: 'arrival', time: 2,
        causes: [cause], participants: [{ who: person, role: 'actor' }], effects: [{ on: person, effect: 'harm' }] });
    k.evolution.register({ id: 'consumer', tier: 0, period: 1, run: (_ctx, window) => window === 0 ?
      [{ op: 'mint-event', spec: { name: 'derived', kind: 'arrival', time: 3, causes: [raw] } }] : [] });
    k.settle({ to: 0 });
    expect(k.evolution.stateOf('consumer').outstanding[0].ops).toHaveLength(1);
    const before = [readEvent(k, raw), readEvent(k, cause)];
    expect(before.every(Boolean)).toBe(true);
    const saved = k.persistence.save('outstanding');
    expect(saved.ops.some((op) => op.op === 'ContributionAdded' && op.contribution.source.layer === 'simulation'),
      'S3-kernel semantic: referenced event constants are saved').toBe(true);
    if (load) k.persistence.load('outstanding');
    expect([readEvent(k, raw), readEvent(k, cause)], 'S3-kernel semantic: raw and transitive facts survive replay').toEqual(before);
    k.settle({ to: 600 });
    const derived = [...k.store.headers.values()].find((h) => h.origin.by === 'minted' && h.origin.name === 'derived');
    expect(derived).toBeDefined();
    expect(readEvent(k, derived!.id)?.causes).toEqual([raw]);
    expect([readEvent(k, raw), readEvent(k, cause)], 'S3-kernel semantic: batch application keeps its causes readable').toEqual(before);
    return [readEvent(k, derived!.id), ...before];
  };
  expect(run(true)).toEqual(run(false));
});
