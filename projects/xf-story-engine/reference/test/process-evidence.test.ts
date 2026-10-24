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

for (const snapshot of [false, true]) for (const loadC of [false, true])
  test(`S3E-01${snapshot ? '-snapshot' : ''}${loadC ? '-two-loads' : ''}: swept event facts return with a new reference and leave on release`, () => {
    const label = `S3E-01${snapshot ? '-snapshot' : ''}${loadC ? '-two-loads' : ''}`;
    const run = (loadB: boolean) => {
      const name = 'swept-event-reference';
      let k = coreKernel(name, undefined, { snapshotEvery: snapshot ? 1 : 10000 });
      const creator = k.root('producer', 'core:person'), place = k.root('place', 'core:place'),
        person = k.mint(creator, creator, 'participant', 'core:person'),
        earlier = k.events.mintEvent({ creator, cause: creator, name: 'earlier', kind: 'arrival', time: 0,
          participants: [{ who: person, role: 'actor' }] }),
        event = k.events.mintEvent({ creator: earlier, cause: earlier, name: 'located', kind: 'arrival', time: 0,
          place, participants: [{ who: person, role: 'actor' }], effects: [{ on: person, effect: 'harm' }], causes: [earlier] }),
        seed = H(s('release-root')), nextSeed = H(s('next-root')), edge = k.store.edgesFrom(event)[0].id;
      const facts = [readEvent(k, event), readEvent(k, earlier)];
      const query = () => {
        const result = k.query({ find: 'core:event', scope: { under: place }, at: 20, must: [], limit: 'all' });
        expect(result.status).toBe('ok');
        return result.status === 'ok' ? result.items.map((i) => i.id) : [];
      };
      const sweep = () => { k.retention.scheduleSweep(); k.settle(); };
      k.retention.setSeed({ id: seed, state: {}, nodes: [event] });
      k.persistence.save('A');
      k.now = 10; k.retention.endSeed(seed); sweep();
      expect(k.store.header(event)).toBeUndefined();
      expect(k.store.header(earlier)).toBeUndefined();
      const b = k.persistence.save('B');
      expect(Boolean(b.snapshot)).toBe(snapshot);
      if (loadB) k = replacement(k, name, 'B');
      expect(k.retention.isRetained(event), 'saved history alone cannot retain the event').toBe(false);
      k.now = 20;
      const pending = structuredClone(k.pending);
      k.retention.setSeed({ id: nextSeed, state: {}, nodes: [event] });
      expect(k.store.header(event), `${label} semantic: a new reference restores the swept event header`).toBeDefined();
      expect([readEvent(k, event), readEvent(k, earlier)],
        `${label} semantic: a new reference restores owned facts and transitive event dependencies`).toEqual(facts);
      expect(k.pending, `${label} semantic: saved closure restoration is silent`).toEqual(pending);
      expect(query(), `${label} semantic: the restored event is spatially discoverable`).toEqual([event]);
      expect(k.store.edges.get(edge)?.valid).toEqual({ from: 0 });
      checkRetentionMonotonicity(k, event);
      sweep();
      expect([readEvent(k, event), readEvent(k, earlier)]).toEqual(facts);
      const c = k.persistence.save('C');
      const freshC = replacement(k, name, 'C');
      expect([readEvent(freshC, event), readEvent(freshC, earlier)], `${label} semantic: fresh C has the same facts`).toEqual(facts);
      if (loadC) k = freshC;
      k.now = 30; k.retention.endSeed(nextSeed); sweep();
      expect(k.retention.isRetained(event)).toBe(false);
      expect(k.store.header(event), `${label} semantic: restored history is sweepable after release`).toBeUndefined();
      const d = k.persistence.save('D');
      k = replacement(k, name, 'D');
      expect(k.retention.isRetained(event), `${label} semantic: two releases stay released on replay`).toBe(false);
      sweep();
      expect(k.store.header(event)).toBeUndefined();
      return { c, d };
    };
    expect(run(false), `${label} semantic: C and D records agree across the intervening loads`).toEqual(run(true));
  });

for (const materialised of [false, true]) for (const reference of ['seed', 'frame', 'pin', 'edge', 'origin'] as const)
  test(`S3E-01-${reference}${materialised ? '-materialised' : ''}: reference traversal restores saved closure regardless of root category`, () => {
    const run = (reverse: boolean) => {
      const k = coreKernel('swept-reference-categories'), creator = k.root('producer', 'core:person'),
        place = k.root('place', 'core:place'), person = k.mint(creator, creator, 'participant', 'core:person');
      let event: Id;
      if (materialised) {
        const scope = k.root('scope', 'core:place');
        k.addEdge({ type: 'core:located-in', from: place, to: scope, cause: creator });
        const summary = k.summaries.mintSummary({ creator, cause: creator, name: 'summary', kind: 'arrival',
          from: 0, length: 600, scope, count: 1 });
        event = k.summaries.materialise(summary, 0);
        k.events.restoreEvent({ creator: summary, cause: summary, name: 'item:0', kind: 'arrival',
          time: k.value(event, 'time') as number, participants: [{ who: person, role: 'actor' }],
          effects: [{ on: person, effect: 'harm' }] }, { descriptor: summary, materialisation: 'scene.acts' });
      } else event = k.events.mintEvent({ creator, cause: creator, name: 'event', kind: 'arrival', time: 0,
        participants: [{ who: person, role: 'actor' }], effects: [{ on: person, effect: 'harm' }] });
      const facts = readEvent(k, event), seed = H(s('initial-consumer'));
      k.retention.setSeed({ id: seed, state: {}, nodes: [event] }); k.persistence.save('A');
      k.retention.endSeed(seed); k.retention.scheduleSweep(); k.settle(); k.persistence.save('B');
      expect(k.store.header(event)).toBeUndefined();
      const addReference = () => {
        if (reference === 'seed') k.retention.setSeed({ id: H(s('new-consumer')), state: {}, nodes: [event] });
        else if (reference === 'frame') {
          k.frames.demandRoots.add(creator);
          k.frames.open({ actor: creator, origin: creator, cause: creator, level: 'goal', weight: 1, focus: { nodes: [event], tier: 1 } });
        } else if (reference === 'pin') k.pin({ node: creator, slot: 'age', value: 20, reason: 'observed', cause: creator, evidence: event });
        else if (reference === 'edge') k.addEdge({ type: 'core:located-in', from: creator, to: place, cause: event });
        else {
          const child = k.mint(creator, event, 'child', 'core:person');
          k.retention.setSeed({ id: H(s('child-consumer')), state: {}, nodes: [child] });
        }
      };
      const addOverlap = () => k.retention.setSeed({ id: H(s('overlapping-consumer')), state: {}, nodes: [person] });
      if (reverse) { addOverlap(); addReference(); } else { addReference(); addOverlap(); }
      const marked = [...k.retention.marked()].sort();
      expect(readEvent(k, event), `S3E-01-${reference}${materialised ? '-materialised' : ''} semantic: common reference traversal restores complete event facts`).toEqual(facts);
      expect(k.retention.isRetained(person)).toBe(true);
      checkRetentionMonotonicity(k, event);
      return { marked, facts: readEvent(k, event) };
    };
    expect(run(false), 'root insertion order cannot change restored facts or the retained closure').toEqual(run(true));
  });

for (const snapshot of [false, true]) for (const sweepBeforeB of [false, true]) for (const queryFirst of [false, true])
  test(`S3F-01${snapshot ? '-snapshot' : ''}${sweepBeforeB ? '-sweep' : ''}${queryFirst ? '-query-first' : ''}: a summary header cannot suppress saved fact recovery`, () => {
    const label = `S3F-01${snapshot ? '-snapshot' : ''}${sweepBeforeB ? '-sweep' : ''}${queryFirst ? '-query-first' : ''}`;
    const run = (loadB: boolean) => {
      const name = 'partially-rematerialised-reference';
      let k = coreKernel(name, undefined, { snapshotEvery: snapshot ? 1 : 10000 });
      const creator = k.root('producer', 'core:person'), scope = k.root('scope', 'core:place'),
        place = k.root('place', 'core:place'),
        earlier = k.events.mintEvent({ creator, cause: creator, name: 'earlier', kind: 'arrival', time: 0 }),
        person = k.mint(creator, earlier, 'participant', 'core:person'),
        unrelated = k.events.mintEvent({ creator, cause: creator, name: 'unrelated', kind: 'arrival', time: 0 });
      k.addEdge({ type: 'core:located-in', from: place, to: scope, cause: creator });
      const summary = k.summaries.mintSummary({ creator, cause: creator, name: 'summary', kind: 'arrival',
        from: 0, length: 600, scope, count: 1 }), item = k.summaries.materialise(summary, 0),
        provenance = { descriptor: summary, materialisation: 'scene.acts' },
        seed = H(s('initial-consumer')), nextSeed = H(s('next-consumer'));
      k.events.restoreEvent({ creator: summary, cause: summary, name: 'item:0', kind: 'arrival',
        time: k.value(item, 'time') as number, participants: [{ who: person, role: 'actor' }],
        effects: [{ on: person, effect: 'harm' }] }, provenance);
      const facts = [readEvent(k, item), readEvent(k, earlier)];
      const sweep = () => { k.retention.scheduleSweep(); k.settle(); };
      const query = () => {
        const result = k.query({ find: 'core:event', scope: { under: scope }, at: k.now, must: [], limit: 'all' });
        expect(result.status).toBe('ok');
        expect(result.status === 'ok' ? result.items.map((i) => i.id) : []).toEqual([item]);
      };
      const materialisedFacts = () => [...k.retention.eventFacts()]
        .filter((id) => k.store.contribution(id)?.source.origin === 'scene.acts').sort();
      k.retention.setSeed({ id: seed, state: {}, nodes: [item, unrelated] });
      const ownFacts = materialisedFacts();
      expect(ownFacts).toHaveLength(8);
      k.persistence.save('A');
      k.retention.endSeed(seed);
      if (sweepBeforeB) {
        sweep();
        expect(k.store.header(item)).toBeUndefined();
        expect(k.store.header(person)).toBeUndefined();
      }
      const b = k.persistence.save('B');
      expect(Boolean(b.snapshot)).toBe(snapshot);
      if (loadB) k = replacement(k, name, 'B');
      expect(k.retention.isRetained(item), 'history alone cannot root the item').toBe(false);
      if (queryFirst) {
        query();
        expect(k.store.header(item)).toBeDefined();
        if (sweepBeforeB && !loadB) {
          expect(k.store.header(person), 'the summary query only recreates the item header').toBeUndefined();
          expect(k.events.materialisationOf(item)).toBeUndefined();
        }
      }
      const pending = structuredClone(k.pending);
      k.retention.setSeed({ id: nextSeed, state: {}, nodes: [item] });
      expect(k.store.header(person), `${label} semantic: re-reference restores the participant even when the event header exists`).toBeDefined();
      expect(k.retention.isRetained(person), `${label} semantic: recovered field references retain the participant`).toBe(true);
      expect(k.events.materialisationOf(item), `${label} semantic: re-reference restores explicit provenance`).toEqual(provenance);
      expect(materialisedFacts(), `${label} semantic: all eight owned event facts are retained`).toEqual(ownFacts);
      expect([readEvent(k, item), readEvent(k, earlier)], `${label} semantic: owned facts and their transitive event dependencies recover`).toEqual(facts);
      expect(k.pending, `${label} semantic: recovery emits no changes`).toEqual(pending);
      if (!queryFirst) query();
      checkRetentionMonotonicity(k, item);
      sweep();
      expect(k.store.header(unrelated), `${label} semantic: recovery never resurrects unrelated saved history`).toBeUndefined();
      expect(k.persistence.currentView().headers.has(unrelated)).toBe(false);
      expect(k.store.header(unrelated)).toBeUndefined();
      expect([readEvent(k, item), readEvent(k, earlier)]).toEqual(facts);
      const c = k.persistence.save('C'), freshC = replacement(k, name, 'C');
      expect([readEvent(freshC, item), readEvent(freshC, earlier)], `${label} semantic: fresh C agrees with live execution`).toEqual(facts);
      k.retention.endSeed(nextSeed); sweep();
      expect(k.store.header(item), `${label} semantic: restored data is sweepable after release`).toBeUndefined();
      expect(k.persistence.currentView().headers.has(item)).toBe(false);
      expect(k.store.header(item)).toBeUndefined();
      return c;
    };
    expect(run(false), `${label} semantic: C records agree with and without a fresh B load`).toEqual(run(true));
  });

test('S3F-01-live: completing partial saved data preserves authoritative live records and is idempotent', () => {
  const k = coreKernel('partial-live-records'), creator = k.root('producer', 'core:person'),
    person = k.mint(creator, creator, 'participant', 'core:person'),
    event = k.events.mintEvent({ creator, cause: creator, name: 'event', kind: 'arrival', time: 0,
      participants: [{ who: person, role: 'actor' }] }), seed = H(s('consumer'));
  k.retention.setSeed({ id: seed, state: {}, nodes: [event] });
  k.persistence.save('A');
  k.retention.endSeed(seed);
  const header = k.store.header(event), member = k.store.ownedOf(event)[0], memberHeader = k.store.header(member),
    contribution = k.store.contributionsNaming(event).find((c) => c.target.slot === 'participants#count')!,
    missing = structuredClone(k.store.contributionsNaming(member)[0]);
  // Exercise a partially present owned tree alongside a contribution updated since A.
  k.endContribution(contribution.id, 30);
  k.store.removeHeader(member); k.store.removeContribution(missing.id); k.bump();
  k.retention.setSeed({ id: seed, state: {}, nodes: [event] });
  expect(k.store.header(event), 'S3F-01-live semantic: the live header remains authoritative').toBe(header);
  expect(k.store.contribution(contribution.id), 'S3F-01-live semantic: the updated live contribution is not replaced').toBe(contribution);
  expect(contribution.valid.to, 'S3F-01-live semantic: recovery cannot reopen an ended live contribution').toBe(30);
  expect(k.store.header(member), 'S3F-01-live semantic: missing owned headers are completed').toEqual(memberHeader);
  expect(k.store.contribution(missing.id), 'S3F-01-live semantic: missing owned contributions are completed').toEqual(missing);
  const revision = k.revision, count = k.store.allContributions().length;
  k.persistence.restoreReferencedHeader(event);
  expect(k.revision, 'complete records require no recovery revision').toBe(revision);
  expect(k.store.allContributions()).toHaveLength(count);
});

for (const snapshot of [false, true]) for (const loadA of [false, true]) for (const sweep of [false, true])
  for (const end of [undefined, 30])
  test(`S3E-02${snapshot ? '-snapshot' : ''}${loadA ? '-load-A' : ''}${sweep ? '-sweep' : ''}${end === undefined ? '-open' : ''}: equal-start reopening keeps its live interval`, () => {
    const label = `S3E-02${snapshot ? '-snapshot' : ''}${loadA ? '-load-A' : ''}${sweep ? '-sweep' : ''}${end === undefined ? '-open' : ''}`,
      name = 'equal-start-reopening';
    let k = coreKernel(name, undefined, { snapshotEvery: snapshot ? 1 : 10000 });
    const creator = k.root('producer', 'core:person'), place = k.root('place', 'core:place'),
      event = k.events.mintEvent({ creator, cause: creator, name: 'located', kind: 'arrival', time: 0, place }),
      seed = H(s('release-root')), edge = k.store.edgesFrom(event)[0].id;
    k.retention.setSeed({ id: seed, state: {}, nodes: [event] });
    k.endEdge(edge, 0); k.persistence.save('A');
    if (loadA) k = replacement(k, name, 'A');
    k.reopenEdge(edge, 0);
    k.now = 30;
    if (end !== undefined) k.endEdge(edge, end);
    k.retention.endSeed(seed);
    const valid = end === undefined ? { from: 0 } : { from: 0, to: end };
    expect(k.store.edges.get(edge)?.valid).toEqual(valid);
    if (sweep) { k.retention.scheduleSweep(); k.settle(); }
    expect(k.store.edges.get(edge)?.valid, `${label} semantic: sweeping cannot inherit the previous interval's end`).toEqual(valid);
    const b = k.persistence.save('B');
    expect(Boolean(b.snapshot)).toBe(snapshot);
    k = replacement(k, name, 'B');
    expect(k.store.edges.get(edge)?.valid, `${label} semantic: replay preserves the authoritative live interval`).toEqual(valid);
    const query = (at: number) => {
      const result = k.query({ find: 'core:event', scope: { under: place }, at, must: [], limit: 'all' });
      expect(result.status).toBe('ok');
      return result.status === 'ok' ? result.items.map((i) => i.id) : [];
    };
    expect(query(25), `${label} semantic: the reopened event remains visible before its end`).toEqual([event]);
    expect(query(30)).toEqual(end === undefined ? [event] : []);
    expect(b.ops).toContainEqual(end === undefined ? { op: 'EdgeAdded', edge: k.store.edges.get(edge)! } : { op: 'EdgeEnded', edge, to: end });
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
