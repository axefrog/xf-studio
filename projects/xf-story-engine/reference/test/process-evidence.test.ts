import { expect, test } from 'bun:test';
import { coreKernel } from './helpers.ts';
import { H, s } from '../src/id.ts';
import { readEvent } from '../src/procedural/views.ts';
import type { Kernel } from '../src/kernel.ts';

function replacement(k: Kernel, name: string, key: string): Kernel {
  const fresh = coreKernel(name);
  for (const [id, record] of k.persistence.chain) fresh.persistence.chain.set(id, structuredClone(record));
  fresh.newEpoch(); fresh.persistence.load(key);
  return fresh;
}

test('S3B-01-location: a referenced event keeps its spatial link only while a consumer needs it', () => {
  const run = (load: boolean) => {
    const name = 'persisted-event-location';
    let k = coreKernel(name);
    const creator = k.root('producer', 'core:person'), place = k.root('place', 'core:place'),
      event = k.events.mintEvent({ creator, cause: creator, name: 'located', kind: 'arrival', time: 0, place }),
      seed = H(s('location-root'));
    k.retention.setSeed({ id: seed, state: {}, nodes: [event] });
    k.persistence.save('location');
    if (load) k = replacement(k, name, 'location');
    const result = k.query({ find: 'core:event', scope: { under: place }, at: k.now, must: [], limit: 'all' });
    expect(result.status === 'ok' ? result.items.map((i) => i.id) : [],
      'S3B-01-location semantic: referenced event remains spatially discoverable').toEqual([event]);
    k.retention.endSeed(seed);
    const remaining = k.persistence.currentView().toData().edges.filter((e) => e.from === event);
    expect(remaining, 'S3B-01-location semantic: saved history cannot extend the spatial link lifetime').toEqual([]);
    return remaining;
  };
  expect(run(true)).toEqual(run(false));
});

for (const reference of ['canon-causes', 'canon-participants', 'canon-served', 'pin-evidence', 'frame-focus',
  'edge-cause', 'origin-creator', 'origin-cause', 'belief-evidence'] as const)
  test(`S3B-01-${reference}: persisted references keep event facts and transitive origin dependencies`, () => {
    const run = (load: boolean) => {
      const name = 'persisted-event-' + reference;
      let k = coreKernel(name);
      const creator = k.root('producer', 'core:person'), place = k.root('place', 'core:place'),
        person = k.mint(creator, creator, 'unrooted-participant', 'core:person'),
        earlier = k.events.mintEvent({ creator, cause: creator, name: 'earlier', kind: 'arrival', time: 1,
          participants: [{ who: person, role: 'actor' }] }),
        dependency = k.events.mintEvent({ creator: earlier, cause: earlier, name: 'dependency', kind: 'arrival', time: 2,
          participants: [{ who: person, role: 'actor' }], effects: [{ on: person, effect: 'harm' }] });
      if (reference.startsWith('canon-')) {
        const a = k.events.mintEvent({ creator, cause: creator, name: 'canon', kind: 'arrival', time: 3,
          ...(reference === 'canon-causes' ? { causes: [dependency] } :
            reference === 'canon-participants' ? { participants: [{ who: dependency, role: 'actor' }] } : { served: dependency }) });
        k.events.makeCanon(a, 'committed', creator);
      } else if (reference === 'pin-evidence') {
        k.pin({ node: creator, slot: 'age', value: 20, reason: 'observed', cause: creator, evidence: dependency });
      } else if (reference === 'frame-focus') {
        k.frames.demandRoots.add(creator);
        k.frames.open({ actor: creator, origin: creator, cause: creator, level: 'goal', weight: 1,
          focus: { nodes: [dependency], tier: 1 } });
      } else if (reference === 'edge-cause') {
        k.addEdge({ type: 'core:located-in', from: creator, to: place, cause: dependency });
      } else if (reference === 'belief-evidence') {
        k.beliefs.set({ believer: creator, subject: creator, path: 'age', value: 20, confidence: 1,
          evidence: [dependency], source: { by: 'observed', event: dependency }, formed: 0, refreshed: 0, memorable: true });
      } else {
        const child = k.mint(reference === 'origin-creator' ? dependency : creator,
          reference === 'origin-cause' ? dependency : creator, 'retained-child', 'core:person');
        k.retention.setSeed({ id: H(s('origin-root')), state: {}, nodes: [child] });
      }
      const facts = [dependency, earlier].map((id) => readEvent(k, id));
      expect(facts.every(Boolean)).toBe(true);
      k.persistence.save('reference');
      if (load) k = replacement(k, name, 'reference');
      expect([dependency, earlier].map((id) => readEvent(k, id)),
        `S3B-01-${reference} semantic: event facts survive replacement`).toEqual(facts);
      expect(k.store.header(person), 'referenced participant stays addressable').toBeDefined();
      k.retention.scheduleSweep(); k.settle();
      expect([dependency, earlier].map((id) => readEvent(k, id))).toEqual(facts);
      return facts;
    };
    expect(run(true)).toEqual(run(false));
  });

for (const reference of ['batch', 'seed'] as const)
  test(`S3B-02-${reference}: referenced summary materialisation survives replay with a live descriptor`, () => {
    const run = (load: boolean) => {
      const name = 'materialisation-' + reference;
      let k = coreKernel(name);
      const creator = k.root('producer', 'core:person'), scope = k.root('scope', 'core:place'),
        place = k.root('place', 'core:place'),
        person = k.mint(creator, creator, 'unrooted-participant', 'core:person');
      const location = k.addEdge({ type: 'core:located-in', from: place, to: scope, cause: creator }).id;
      const summary = k.summaries.mintSummary({ creator, cause: creator, name: 'summary', kind: 'arrival',
        from: 0, length: 600, scope, count: 1 }), item = k.summaries.materialise(summary, 0),
        time = k.value(item, 'time') as number;
      k.events.restoreEvent({ creator: summary, cause: summary, name: 'item:0', time, kind: 'arrival',
        participants: [{ who: person, role: 'actor' }], effects: [{ on: person, effect: 'harm' }] },
        { descriptor: summary, materialisation: 'scene.acts' });
      const attach = (target: Kernel) => target.evolution.register({ id: 'consumer', tier: 0, period: 1,
        run: (_ctx, window) => window === 0 ?
          [{ op: 'mint-event', spec: { name: 'derived', kind: 'arrival', time: 600, causes: [item] } }] : [] });
      if (reference === 'seed') k.retention.setSeed({ id: H(s('summary-root')), state: {}, nodes: [item] });
      else { attach(k); k.settle({ to: 0 }); expect(k.evolution.stateOf('consumer').outstanding).toHaveLength(1); }
      const before = readEvent(k, item);
      expect(before?.provenance).toEqual({ descriptor: summary, materialisation: 'scene.acts' });
      const saved = k.persistence.save('materialisation');
      expect(saved.ops.some((op) => op.op === 'ContributionAdded' && op.contribution.source.origin === 'scene.acts'),
        `S3B-02-${reference} semantic: materialisation constants are saved`).toBe(true);
      if (load) { k = replacement(k, name, 'materialisation'); if (reference === 'batch') attach(k); }
      expect(readEvent(k, item), 'materialisation is readable immediately after replacement').toEqual(before);
      expect(k.store.header(person)).toBeDefined();
      if (reference === 'batch') {
        k.settle({ to: 600 });
        const derived = [...k.store.headers.values()].find((h) => h.origin.by === 'minted' && h.origin.name === 'derived');
        expect(readEvent(k, derived!.id)?.causes).toEqual([item]);
        expect(readEvent(k, item), 'materialisation survives batch application').toEqual(before);
      }
      k.pin({ node: summary, slot: 'from', value: 600, reason: 'observed', cause: creator });
      const alternate = k.root('alternate', 'core:place');
      // Move the sole candidate out of the scope and a different place into it.
      k.endEdge(location, 0);
      k.addEdge({ type: 'core:located-in', from: alternate, to: scope, cause: creator });
      expect(k.value(item, 'time'), 'time remains a live summary dependency').toBe(time + 600);
      expect(k.value(item, 'place'), 'place remains a live summary dependency').toBe(alternate);
      return readEvent(k, item);
    };
    expect(run(true)).toEqual(run(false));
  });

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
