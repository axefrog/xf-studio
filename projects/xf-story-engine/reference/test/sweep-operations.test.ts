import { expect, test } from 'bun:test';
import type { EventSpec } from '../src/events.ts';
import { H, s } from '../src/id.ts';
import type { ContributionSpec, Kernel } from '../src/kernel.ts';
import { coreKernel } from './helpers.ts';

function replacement(k: Kernel, name: string, key: string): Kernel {
  const fresh = coreKernel(name, undefined, k.config);
  for (const [id, record] of k.persistence.chain) fresh.persistence.chain.set(id, structuredClone(record));
  fresh.newEpoch(); fresh.persistence.load(key);
  return fresh;
}
function sweep(k: Kernel): void { k.retention.scheduleSweep(); k.settle(); }

for (const snapshot of [false, true]) for (const loadA of [false, true])
test(`S3I-01${snapshot ? '-snapshot' : ''}${loadA ? '-load-A' : ''}: original contribution submissions keep saved ends`, () => {
  const name = 'contribution-operation-recovery';
  let k = coreKernel(name, undefined, { snapshotEvery: snapshot ? 1 : 10000 });
  const creator = k.root('producer', 'core:person'), event = k.mintSilent(creator, creator, 'event', 'core:event'),
    seed = H(s('consumer')), spec: ContributionSpec = { source: { layer: 'authored', origin: event },
      target: { slot: 'time', scope: { nodes: [event] } }, form: { f: 'const', value: 42 }, mode: 'constrain' },
    id = k.contribute(spec).id;
  k.retention.setSeed({ id: seed, state: {}, nodes: [event] });
  k.now = 10; k.endContribution(id, 10); k.persistence.save('A');
  if (loadA) k = replacement(k, name, 'A');
  k.retention.endSeed(seed); sweep(k);
  expect(k.store.contribution(id)).toBeUndefined();
  const pending = structuredClone(k.pending);
  expect(k.contribute(spec).valid, 'S3I-01 semantic: identical original submission preserves saved end').toEqual({ to: 10 });
  expect(k.pending).toEqual(pending);
  k.retention.setSeed({ id: H(s('next-consumer')), state: {}, nodes: [event] });
  const b = k.persistence.save('B'), fresh = replacement(k, name, 'B');
  expect(Boolean(b.snapshot)).toBe(snapshot);
  for (const target of [k, fresh]) {
    expect(target.value(event, 'time', 9)).toBe(42);
    expect(target.resolve(event, 'time', 10).status).toBe('unavailable');
    // Recovery must also respect a newer live end, rather than reinstating saved validity.
    target.endContribution(id, 8);
    expect(target.contribute(spec).valid).toEqual({ to: 8 });
  }
  expect(k.persistence.save('C')).toEqual(fresh.persistence.save('C'));
});

for (const snapshot of [false, true]) for (const loadA of [false, true])
test(`S3I-01-end${snapshot ? '-snapshot' : ''}${loadA ? '-load-A' : ''}: ending a swept contribution recovers it internally`, () => {
  const name = 'end-operation-recovery';
  let k = coreKernel(name, undefined, { snapshotEvery: snapshot ? 1 : 10000 });
  const creator = k.root('producer', 'core:person'), event = k.mintSilent(creator, creator, 'event', 'core:event'),
    seed = H(s('consumer')), c = k.contribute({ source: { layer: 'authored', origin: event },
      target: { slot: 'time', scope: { nodes: [event] } }, form: { f: 'const', value: 42 }, mode: 'constrain' });
  k.retention.setSeed({ id: seed, state: {}, nodes: [event] });
  k.persistence.save('A');
  if (loadA) k = replacement(k, name, 'A');
  k.retention.endSeed(seed); sweep(k);
  expect(k.store.contribution(c.id)).toBeUndefined();
  expect(() => k.endContribution(c.id, 10), 'S3I-01-end semantic: public end recovers a swept record').not.toThrow();
  expect(k.store.contribution(c.id)?.valid).toEqual({ to: 10 });
  expect(k.persistence.save('B').ops).toContainEqual({ op: 'ContributionEnded', contribution: c.id, to: 10 });
  const fresh = replacement(k, name, 'B');
  expect(k.persistence.save('C')).toEqual(fresh.persistence.save('C'));
});

for (const snapshot of [false, true]) for (const api of ['mintEvent', 'restoreEvent'] as const)
test(`S3I-02-header-first-${api}${snapshot ? '-snapshot' : ''}: unsaved spatial links survive sweeps and regeneration`, () => {
  const name = 'unsaved-event-link', k = coreKernel(name, undefined, { snapshotEvery: snapshot ? 1 : 10000 }),
    creator = k.root('producer', 'core:person'), place = k.root('place', 'core:place'),
    spec: EventSpec = { creator, cause: creator, name: 'event', kind: 'arrival', time: 0, place,
      participants: [{ who: creator, role: 'actor' }] }, event = k.events.mintEvent(spec),
    edge = structuredClone(k.store.edgesFrom(event)[0]);
  k.persistence.save('A');
  expect(k.persistence.rebuild('A').view.headers.has(event)).toBe(false);
  const fresh = replacement(k, name, 'A');
  fresh.settle();
  sweep(k);
  expect(k.store.header(event)).toBeUndefined();
  expect(k.store.edges.get(edge.id), `S3I-02-header-first-${api} semantic: unsaved intervals cannot be discarded`).toEqual(edge);
  // Ownership survives the missing header and must not turn the preserved interval into a root.
  sweep(k);
  expect(k.store.header(event)).toBeUndefined();
  for (const target of [k, fresh]) {
    target.root('producer', 'core:person'); target.root('place', 'core:place');
    target.mintSilent(creator, creator, spec.name, 'core:event');
    target.events[api](spec);
    target.retention.setSeed({ id: H(s('consumer')), state: {}, nodes: [event] });
    expect(target.query({ find: 'core:event', scope: { under: place }, at: 20, must: [], limit: 'all' }))
      .toEqual({ status: 'ok', items: [{ id: event, score: 0 }] });
  }
  expect(k.persistence.save('B')).toEqual(fresh.persistence.save('B'));
  const loadedB = replacement(k, name, 'B');
  expect(k.persistence.save('C')).toEqual(loadedB.persistence.save('C'));
});

for (const snapshot of [false, true]) for (const api of ['mintEvent', 'restoreEvent'] as const)
test(`S3I-02-interval-${api}${snapshot ? '-snapshot' : ''}: sweeping cannot reopen an unsaved ended edge`, () => {
  const records = [false, true].map((swept) => {
    const k = coreKernel('unsaved-ended-link', undefined, { snapshotEvery: snapshot ? 1 : 10000 }),
      creator = k.root('producer', 'core:person'), place = k.root('place', 'core:place'),
      spec: EventSpec = { creator, cause: creator, name: 'event', kind: 'arrival', time: 0, place },
      event = k.events.mintEvent(spec), edge = k.store.edgesFrom(event)[0].id;
    k.endEdge(edge, 10); k.persistence.save('A');
    if (swept) sweep(k); else k.settle();
    k.events[api](spec);
    expect(k.store.edges.get(edge)?.valid, 'S3I-02 semantic: unsaved exclusive end survives regeneration').toEqual({ from: 0, to: 10 });
    k.retention.setSeed({ id: H(s('consumer')), state: {}, nodes: [event] });
    expect(k.query({ find: 'core:event', scope: { under: place }, at: 20, must: [], limit: 'all' }))
      .toEqual({ status: 'ok', items: [] });
    const b = k.persistence.save('B');
    const fresh = replacement(k, 'unsaved-ended-link', 'B');
    expect(k.persistence.save('C')).toEqual(fresh.persistence.save('C'));
    return b;
  });
  expect(records[1]).toEqual(records[0]);
});

for (const operation of ['add', 'end', 'reopen', 'update'] as const)
test(`S3I edge operations: ${operation} recovers an exactly swept saved edge`, () => {
  const name = 'saved-edge-operation', k = coreKernel(name), creator = k.root('producer', 'core:person'),
    place = k.root('place', 'core:place'), event = k.events.mintEvent({ creator, cause: creator, name: 'event', kind: 'arrival', time: 0, place }),
    seed = H(s('consumer')), edge = structuredClone(k.store.edgesFrom(event)[0]);
  k.retention.setSeed({ id: seed, state: {}, nodes: [event] });
  k.endEdge(edge.id, 10); k.persistence.save('A'); k.retention.endSeed(seed); sweep(k);
  expect(k.store.edges.get(edge.id)).toBeUndefined();
  if (operation === 'add') expect(k.addEdge(edge).valid).toEqual({ from: 0, to: 10 });
  if (operation === 'end') k.endEdge(edge.id, 8);
  if (operation === 'reopen') k.reopenEdge(edge.id, 10);
  if (operation === 'update') k.updateEdge(edge.id, { data: { proof: true } });
  expect(k.store.edges.get(edge.id)).toBeDefined();
  k.persistence.save('B');
  const fresh = replacement(k, name, 'B');
  expect(k.persistence.save('C')).toEqual(fresh.persistence.save('C'));
});

test('S3I completeness: regeneration fills a missing owned field and edge despite surviving event constants', () => {
  const k = coreKernel('partial-event-completeness'), creator = k.root('producer', 'core:person'), place = k.root('place', 'core:place'),
    spec: EventSpec = { creator, cause: creator, name: 'event', kind: 'arrival', time: 0, place,
      participants: [{ who: creator, role: 'actor' }], effects: [{ on: creator, effect: 'harm' }] },
    event = k.events.mintEvent(spec), member = k.address(event, 'participants[0]'),
    role = k.store.contributionsNaming(member).find((c) => c.target.slot === 'role')!,
    edge = k.store.edgesFrom(event)[0];
  k.store.removeContribution(role.id); k.store.removeEdge(edge.id); k.bump();
  k.events.restoreEvent(spec);
  expect(k.store.contribution(role.id), 'S3I completeness semantic: one own constant is not a complete event').toEqual(role);
  expect(k.store.edges.get(edge.id)).toEqual(edge);
});
