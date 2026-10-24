import { expect, test } from 'bun:test';
import { coreKernel } from './helpers.ts';
import { H, s } from '../src/id.ts';
import { readEvent } from '../src/procedural/views.ts';
import type { Kernel } from '../src/kernel.ts';
import type { Id } from '../src/types.ts';

function replacement(k: Kernel, name: string, key: string): Kernel {
  const fresh = coreKernel(name, undefined, k.config);
  for (const [id, record] of k.persistence.chain) fresh.persistence.chain.set(id, structuredClone(record));
  fresh.newEpoch(); fresh.persistence.load(key);
  return fresh;
}

function checkRetentionMonotonicity(k: Kernel, event: Id): void {
  const before = [...k.retention.marked()].sort(), seed = H(s('additional-event-consumer'));
  k.retention.setSeed({ id: seed, state: {}, nodes: [event] });
  const after = k.retention.marked();
  expect(before.filter((id) => !after.has(id)), 'adding a consumer cannot shrink the retained closure').toEqual([]);
  expect(after.has(event)).toBe(true);
  k.retention.endSeed(seed);
  expect([...k.retention.marked()].sort(), 'removing a redundant consumer restores the original closure').toEqual(before);
}

for (const snapshot of [false, true])
test(`S3C-01${snapshot ? '-snapshot' : ''}: an expired overlay cannot impersonate a summary materialisation owner after a fresh load`, () => {
  const name = 'expired-materialisation-overlay';
  let k = coreKernel(name, undefined, { snapshotEvery: snapshot ? 1 : 10000 });
  const creator = k.root('producer', 'core:person'), scope = k.root('scope', 'core:place'),
    place = k.root('place', 'core:place'), person = k.mint(creator, creator, 'participant', 'core:person');
  const location = k.addEdge({ type: 'core:located-in', from: place, to: scope, cause: creator }).id;
  const summary = k.summaries.mintSummary({ creator, cause: creator, name: 'summary', kind: 'arrival',
    from: 0, length: 600, scope, count: 1 }), item = k.summaries.materialise(summary, 0),
    time = k.value(item, 'time') as number;
  const seed = H(s('overlay-root'));
  k.retention.setSeed({ id: seed, state: {}, nodes: [item] });
  // Save the header before its fields are opened: provenance must be added to an existing save chain too.
  k.persistence.save('header');
  k.contribute({ source: { layer: 'simulation', origin: 'temporary-overlay' },
    target: { slot: 'participants#count', scope: { nodes: [item] } }, form: { f: 'const', value: 1 },
    mode: 'constrain', valid: { from: 0, to: 1 } });
  k.now = 2;
  const provenance = { descriptor: summary, materialisation: 'scene.acts' };
  k.events.restoreEvent({ creator: summary, cause: summary, name: 'item:0', time, kind: 'arrival',
    participants: [{ who: person, role: 'actor' }], effects: [{ on: person, effect: 'harm' }] }, provenance);
  const before = readEvent(k, item);
  expect(before?.participants).toEqual([{ who: person, role: 'actor' }]);
  expect(before?.effects).toEqual([{ on: person, effect: 'harm' }]);
  const saved = k.persistence.save('opened');
  k = replacement(k, name, 'opened');
  expect(readEvent(k, item)?.participants,
    'S3C-01 semantic: expired overlay cannot replace the saved participant facts').toEqual(before!.participants);
  expect(readEvent(k, item)?.effects, 'S3C-01 semantic: materialised effects survive replacement').toEqual(before!.effects);
  expect(before?.provenance, 'S3C-01 semantic: the live view uses explicit materialisation provenance').toEqual(provenance);
  expect(readEvent(k, item)?.provenance, 'S3C-01 semantic: provenance survives replacement').toEqual(provenance);
  expect(saved.ops.some((op) => op.op === 'ContributionAdded' && op.contribution.source.origin === 'temporary-overlay')).toBe(false);
  expect(k.store.header(person)).toBeDefined();
  k.pin({ node: summary, slot: 'from', value: 600, reason: 'observed', cause: creator });
  const alternate = k.root('alternate', 'core:place');
  k.endEdge(location, 0);
  k.addEdge({ type: 'core:located-in', from: alternate, to: scope, cause: creator });
  expect(k.value(item, 'time'), 'time remains a live summary dependency').toBe(time + 600);
  expect(k.value(item, 'place'), 'place remains a live summary dependency').toBe(alternate);
});

for (const sweep of [false, true])
  test(`S3C-02${sweep ? '-sweep' : ''}: a released event location cannot revive through the save chain`, () => {
    const name = 'released-event-location-' + sweep;
    let k = coreKernel(name);
    const creator = k.root('producer', 'core:person'), place = k.root('place', 'core:place'),
      event = k.events.mintEvent({ creator, cause: creator, name: 'located', kind: 'arrival', time: 0, place }),
      seed = H(s('release-root')), edge = k.store.edgesFrom(event)[0].id;
    const query = (at: number) => {
      const result = k.query({ find: 'core:event', scope: { under: place }, at, must: [], limit: 'all' });
      expect(result.status).toBe('ok');
      return result.status === 'ok' ? result.items.map((i) => i.id) : [];
    };
    k.retention.setSeed({ id: seed, state: {}, nodes: [event] });
    k.persistence.save('A');
    expect(query(0)).toEqual([event]);
    k.now = 10;
    k.endEdge(edge);
    k.retention.endSeed(seed);
    expect(query(10)).toEqual([]);
    if (sweep) {
      // Sweep later, so replay must preserve the actual end at 10 rather than inventing one at save time.
      k.now = 20;
      k.retention.scheduleSweep(); k.settle();
      expect(k.store.header(event)).toBeUndefined();
    }
    const saved = k.persistence.save('B');
    k = replacement(k, name, 'B');
    const label = `S3C-02${sweep ? '-sweep' : ''}`;
    expect(query(10), `${label} semantic: a fresh replay cannot revive the ended spatial link`).toEqual([]);
    expect(saved.ops, `${label} semantic: save B records the original edge termination`).toContainEqual({ op: 'EdgeEnded', edge, to: 10 });
    expect(k.store.edges.get(edge)?.valid.to).toBe(10);
  });

for (const sweep of [false, true])
  test(`S3C-02-release${sweep ? '-sweep' : ''}: release and later sweeps never invent an edge end`, () => {
    const name = 'implicit-event-release-' + sweep, k = coreKernel(name),
      creator = k.root('producer', 'core:person'), place = k.root('place', 'core:place'),
      event = k.events.mintEvent({ creator, cause: creator, name: 'located', kind: 'arrival', time: 0, place }),
      seed = H(s('implicit-release-root')), edge = k.store.edgesFrom(event)[0].id;
    k.retention.setSeed({ id: seed, state: {}, nodes: [event] });
    k.persistence.save('A');
    k.now = 10;
    k.retention.endSeed(seed);
    const b = k.persistence.save('B');
    k.now = 20;
    if (sweep) { k.retention.scheduleSweep(); k.settle(); }
    const c = k.persistence.save('C');
    const fresh = replacement(k, name, 'C');
    expect(fresh.store.edges.get(edge)?.valid, 'release cannot terminate an interval').toEqual({ from: 0 });
    expect([...b.ops, ...c.ops].some((op) => op.op === 'EdgeEnded'), 'only an actual end can write EdgeEnded').toBe(false);
    expect(k.retention.marked().has(event), 'saved open history cannot root a released event after sweeping').toBe(false);
    expect(fresh.retention.marked().has(event), 'replay cannot root a released event either').toBe(false);
    const query = fresh.query({ find: 'core:event', scope: { under: place }, at: 10, must: [], limit: 'all' });
    expect(query.status).toBe('ok');
    expect(query.status === 'ok' ? query.items.map((i) => i.id) : []).toEqual([event]);
  });

for (const snapshot of [false, true])
  test(`S3D-01${snapshot ? '-snapshot' : ''}: re-referencing a released location preserves queries and later records`, () => {
    const run = (load: boolean) => {
      const name = 're-reference-event-location';
      let k = coreKernel(name, undefined, { snapshotEvery: snapshot ? 1 : 10000 });
      const creator = k.root('producer', 'core:person'), place = k.root('place', 'core:place'),
        event = k.events.mintEvent({ creator, cause: creator, name: 'located', kind: 'arrival', time: 0, place }),
        seed = H(s('release-root')), nextSeed = H(s('next-root')), edge = k.store.edgesFrom(event)[0].id;
      const query = (at: number) => {
        const result = k.query({ find: 'core:event', scope: { under: place }, at, must: [], limit: 'all' });
        expect(result.status).toBe('ok');
        return result.status === 'ok' ? result.items.map((i) => i.id) : [];
      };
      k.retention.setSeed({ id: seed, state: {}, nodes: [event] });
      k.persistence.save('A');
      k.now = 10;
      k.retention.endSeed(seed);
      const b = k.persistence.save('B');
      expect(Boolean(b.snapshot)).toBe(snapshot);
      if (load) k = replacement(k, name, 'B');
      checkRetentionMonotonicity(k, event);
      k.now = 20;
      k.retention.setSeed({ id: nextSeed, state: {}, nodes: [event] });
      const label = `S3D-01${snapshot ? '-snapshot' : ''}`;
      expect(query(20), `${label} semantic: a later consumer sees the original open location`).toEqual([event]);
      expect(k.store.edges.get(edge)?.valid, `${label} semantic: release never invents an end`).toEqual({ from: 0 });
      const c = k.persistence.save('C');
      const before = [query(0), query(10), query(20)];
      k = replacement(k, name, 'C');
      expect([query(0), query(10), query(20)], `${label} semantic: C replays the same spatial history`).toEqual(before);
      return c;
    };
    expect(run(true), 'S3D-01 semantic: C records are independent of the intervening load').toEqual(run(false));
  });

for (const snapshot of [false, true]) for (const sweep of [false, true]) for (const end of [30, 50])
  test(`S3D-02${snapshot ? '-snapshot' : ''}${sweep ? '-sweep' : ''}${end > 30 ? '-future-end' : ''}: a released reopened edge keeps its own interval`, () => {
    const name = 'released-reopened-location';
    let k = coreKernel(name, undefined, { snapshotEvery: snapshot ? 1 : 10000 });
    const creator = k.root('producer', 'core:person'), place = k.root('place', 'core:place'),
      event = k.events.mintEvent({ creator, cause: creator, name: 'located', kind: 'arrival', time: 0, place }),
      seed = H(s('release-root')), edge = k.store.edgesFrom(event)[0].id;
    const query = (at = 25) => {
      const result = k.query({ find: 'core:event', scope: { under: place }, at, must: [], limit: 'all' });
      expect(result.status).toBe('ok');
      return result.status === 'ok' ? result.items.map((i) => i.id) : [];
    };
    k.retention.setSeed({ id: seed, state: {}, nodes: [event] });
    k.now = 10; k.endEdge(edge); k.persistence.save('A');
    k.now = 20; k.reopenEdge(edge);
    k.now = 30; k.endEdge(edge, end); k.retention.endSeed(seed);
    expect(query()).toEqual([event]);
    if (sweep) { k.now = 40; k.retention.scheduleSweep(); k.settle(); }
    const b = k.persistence.save('B');
    expect(Boolean(b.snapshot)).toBe(snapshot);
    k = replacement(k, name, 'B');
    const label = `S3D-02${snapshot ? '-snapshot' : ''}${sweep ? '-sweep' : ''}${end > 30 ? '-future-end' : ''}`;
    expect(query(), `${label} semantic: a fresh replay finds the event in the reopened interval`).toEqual([event]);
    expect(k.store.edges.get(edge)?.valid, `${label} semantic: the previous interval cannot clamp this one`).toEqual({ from: 20, to: end });
    expect(query(end - 1), `${label} semantic: save time cannot clamp a future end`).toEqual([event]);
    expect(query(end), `${label} semantic: the actual end remains exclusive`).toEqual([]);
    expect(b.ops).toContainEqual({ op: 'EdgeAdded', edge: k.store.edges.get(edge)! });
  });

for (const snapshot of [false, true])
  test(`S3D-first-save${snapshot ? '-snapshot' : ''}: an edge ended before its first save retains its interval`, () => {
    const name = 'ended-before-first-save';
    let k = coreKernel(name, undefined, { snapshotEvery: snapshot ? 1 : 10000 });
    const creator = k.root('producer', 'core:person'), place = k.root('place', 'core:place'),
      event = k.events.mintEvent({ creator, cause: creator, name: 'located', kind: 'arrival', time: 0, place }),
      seed = H(s('early-end-root')), edge = k.store.edgesFrom(event)[0].id;
    k.retention.setSeed({ id: seed, state: {}, nodes: [event] });
    k.now = 10; k.endEdge(edge);
    k.now = 20; k.persistence.save('A');
    k = replacement(k, name, 'A');
    expect(k.store.edges.get(edge)?.valid).toEqual({ from: 0, to: 10 });
    const query = (at: number) => {
      const result = k.query({ find: 'core:event', scope: { under: place }, at, must: [], limit: 'all' });
      expect(result.status).toBe('ok');
      return result.status === 'ok' ? result.items.map((i) => i.id) : [];
    };
    expect(query(5)).toEqual([event]);
    expect(query(10)).toEqual([]);
    k.retention.endSeed(seed); k.retention.scheduleSweep(); k.settle();
    k.persistence.save('B'); k = replacement(k, name, 'B');
    expect(k.store.edges.get(edge)?.valid, 'later release cannot extend the first saved end').toEqual({ from: 0, to: 10 });
    expect(query(5)).toEqual([event]);
    expect(query(10)).toEqual([]);
  });

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
      checkRetentionMonotonicity(k, dependency);
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
      checkRetentionMonotonicity(k, item);
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
