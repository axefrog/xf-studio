import { expect, test } from 'bun:test';
import type { EventSpec } from '../src/events.ts';
import { H, s } from '../src/id.ts';
import type { Kernel } from '../src/kernel.ts';
import { coreKernel } from './helpers.ts';
import { runSweepReplayProperty } from './sweep-replay-property.ts';

function replacement(k: Kernel, name: string, key: string): Kernel {
  const fresh = coreKernel(name, undefined, k.config);
  for (const [id, record] of k.persistence.chain) fresh.persistence.chain.set(id, structuredClone(record));
  fresh.newEpoch(); fresh.persistence.load(key);
  return fresh;
}

function sweep(k: Kernel): void { k.retention.scheduleSweep(); k.settle(); }

for (const api of ['mintEvent', 'restoreEvent'] as const) for (const snapshot of [false, true])
  for (const loadA of [false, true]) for (const end of [10, 30])
test(`S3H-01-${api}${snapshot ? '-snapshot' : ''}${loadA ? '-load-A' : ''}${end > 10 ? '-future-end' : ''}: regeneration replays saved terminations first`, () => {
  // Sixteen divergent variants, each with no-sweep and reference-before-regeneration controls.
  for (const order of ['regenerate-first', 'reference-first', 'no-sweep']) {
    const name = 'saved-termination-regeneration';
    let k = coreKernel(name, undefined, { snapshotEvery: snapshot ? 1 : 10000 });
    const creator = k.root('producer', 'core:person'), seed = H(s('consumer')),
      person = k.mint(creator, creator, 'person', 'core:person'),
      spec: EventSpec = { creator, cause: creator, name: 'event', kind: 'arrival', time: 0,
        participants: [{ who: person, role: 'actor' }] },
      event = k.events.mintEvent(spec),
      time = k.store.contributionsNaming(event).find((c) => c.target.slot === 'time')!.id;
    k.retention.setSeed({ id: seed, state: {}, nodes: [event] });
    k.now = 10; k.endContribution(time, end);
    k.persistence.save('A');
    if (loadA) k = replacement(k, name, 'A');
    k.retention.endSeed(seed);
    if (order !== 'no-sweep') {
      sweep(k);
      expect(k.store.header(event)).toBeUndefined();
    }
    const nextSeed = H(s('next-consumer')), pending = structuredClone(k.pending);
    if (order === 'reference-first') k.retention.setSeed({ id: nextSeed, state: {}, nodes: [event] });
    expect(k.events[api](spec)).toBe(event);
    expect(k.store.contribution(time)?.valid, `S3H-01-${api} semantic: defaults never reopen a saved end`).toEqual({ to: end });
    expect(k.pending, `S3H-01-${api} semantic: recovered occurrences remain silent`).toEqual(pending);
    k.retention.setSeed({ id: nextSeed, state: {}, nodes: [event] });
    expect(k.retention.isRetained(person)).toBe(true);
    const b = k.persistence.save('B'), fresh = replacement(k, name, 'B');
    expect(Boolean(b.snapshot)).toBe(snapshot);
    for (const target of [k, fresh]) {
      expect(target.value(event, 'time', end - 1)).toBe(0);
      expect(target.resolve(event, 'time', end).status, 'S3H-01 semantic: live and replay agree at the exclusive end').toBe('unavailable');
    }
    expect(k.persistence.save('C')).toEqual(fresh.persistence.save('C'));
  }
});

for (const snapshot of [false, true]) for (const end of [10, 30])
test(`S3H-02${snapshot ? '-snapshot' : ''}${end > 10 ? '-future-end' : ''}: cleanup keeps facts whose target was never saved`, () => {
  // Four divergent variants, with twelve controls that keep the header or saved it in A.
  for (const savedHeader of [false, true]) for (const swept of [false, true]) {
    const name = 'never-saved-target';
    const k = coreKernel(name, undefined, { snapshotEvery: snapshot ? 1 : 10000 }),
      creator = k.root('producer', 'core:person'), seed = H(s('consumer')),
      event = k.mint(creator, creator, 'target', 'core:event'), header = structuredClone(k.store.header(event)!),
      contribution = k.contribute({ source: { layer: 'authored', origin: H(s('external-author')) },
        target: { slot: 'time', scope: { nodes: [event] } }, form: { f: 'const', value: 42 }, mode: 'constrain' });
    if (savedHeader) k.retention.setSeed({ id: seed, state: {}, nodes: [event] });
    k.persistence.save('A');
    expect(k.persistence.rebuild('A').view.headers.has(event)).toBe(savedHeader);
    k.retention.endSeed(seed); k.now = 10; k.endContribution(contribution.id, end);
    if (swept) sweep(k);
    const b = k.persistence.save('B'), fresh = replacement(k, name, 'B');
    expect(Boolean(b.snapshot)).toBe(snapshot);
    expect(b.ops).toContainEqual({ op: 'ContributionEnded', contribution: contribution.id, to: end });
    if (!savedHeader) expect(k.store.contribution(contribution.id), 'S3H-02 semantic: unrecoverable orphan stays live').toBeDefined();
    for (const target of [k, fresh]) {
      target.root('producer', 'core:person');
      expect(target.mint(creator, creator, 'target', 'core:event')).toBe(event);
      // Exercise completion against a known live header absent from base.headers, independently
      // of the fresh load already having replayed all saved contributions.
      target.store.removeContribution(contribution.id); target.bump();
      target.persistence.restoreReferencedHeader(event);
      expect(target.store.header(event)).toEqual(header);
      expect(target.store.contribution(contribution.id)?.valid, 'S3H-02 semantic: known live headers recover saved facts').toEqual({ to: end });
      target.retention.setSeed({ id: seed, state: {}, nodes: [event] });
      expect(target.value(event, 'time', end - 1), 'S3H-02 semantic: the authored value survives cleanup').toBe(42);
      expect(target.resolve(event, 'time', end).status).toBe('unavailable');
    }
    expect(k.persistence.save('C')).toEqual(fresh.persistence.save('C'));
  }
});

for (const snapshot of [false, true])
test(`S3H-03${snapshot ? '-snapshot' : ''}: authored rules outlive their swept origin`, () => {
  for (const mode of ['general', 'named', 'unsaved', 'no-sweep']) {
    const name = 'authored-rule-origin';
    const k = coreKernel(name, undefined, { snapshotEvery: snapshot ? 1 : 10000 }),
      creator = k.root('producer', 'core:person'),
      origin = k.events.mintEvent({ creator, cause: creator, name: 'origin', kind: 'arrival', time: 0 }),
      target = k.mint(creator, creator, 'target', 'core:event'), seed = H(s('consumer')),
      rule = k.contribute({ source: { layer: 'authored', origin },
        target: { kind: 'core:event', slot: 'time', ...(mode === 'named' ? { scope: { nodes: [target] } } : {}) },
        form: { f: 'const', value: 42 }, mode: 'constrain' });
    k.retention.setSeed({ id: seed, state: {}, nodes: [target] });
    if (mode !== 'unsaved') k.persistence.save('A');
    if (mode !== 'no-sweep') {
      sweep(k);
      expect(k.store.header(origin)).toBeUndefined();
    }
    expect(k.store.contribution(rule.id), 'S3H-03 semantic: source lifetime cannot delete an applicable authored rule').toEqual(rule);
    expect(k.value(target, 'time'), 'S3H-03 semantic: retained target keeps its authored value through sweeping').toBe(42);
    k.retention.setSeed({ id: H(s('second-consumer')), state: {}, nodes: [target] });
    const b = k.persistence.save('B');
    expect(Boolean(b.snapshot)).toBe(snapshot);
    const fresh = replacement(k, name, 'B'), again = replacement(fresh, name, 'B');
    expect([fresh.value(target, 'time'), again.value(target, 'time')]).toEqual([42, 42]);
    expect(k.persistence.save('C')).toEqual(fresh.persistence.save('C'));
  }
});

test('S3H recovery paths: re-minting any saved header replays its owned facts silently', () => {
  const name = 'all-header-recovery', k = coreKernel(name), creator = k.root('producer', 'core:person'),
    event = k.events.mintEvent({ creator, cause: creator, name: 'event', kind: 'arrival', time: 0,
      participants: [{ who: creator, role: 'actor' }] }), seed = H(s('consumer'));
  k.retention.setSeed({ id: seed, state: {}, nodes: [event] });
  k.persistence.save('A'); k.retention.endSeed(seed); sweep(k);
  const pending = structuredClone(k.pending);
  expect(k.mint(creator, creator, 'event', 'core:event')).toBe(event);
  expect(k.value(k.address(event, 'participants[0]'), 'role')).toBe('actor');
  expect(k.pending).toEqual(pending);
  sweep(k);
  expect(k.mintSilent(creator, creator, 'event', 'core:event')).toBe(event);
  expect(k.value(event, 'time')).toBe(0);
  expect(k.pending).toEqual(pending);
});

test('S3H recovery paths: reconciliation cannot recover facts from the discarded branch', () => {
  const k = coreKernel('recovery-selected-branch');
  k.persistence.save('A');
  const event = k.mirrored('event', 'core:person');
  const contribution = k.contribute({ source: { layer: 'authored', origin: H(s('author')) }, target: { slot: 'age', scope: { nodes: [event] } },
    form: { f: 'const', value: 42 }, mode: 'constrain' });
  k.retention.setSeed({ id: H(s('consumer')), state: {}, nodes: [event] });
  k.persistence.save('B');
  k.persistence.load('A', { now: () => 0,
    readMirrored: () => [{ gameKey: 'event', kind: 'core:person', slot: 'age-class', value: 'adult' }] });
  expect(k.value(event, 'age-class')).toBe('adult');
  expect(k.store.contribution(contribution.id), 'reconciliation recovers only the selected save').toBeUndefined();
});

test('S3I property: unswept, swept and random fresh replay agree after every operation', () => {
  const coverage = runSweepReplayProperty();
  if (process.env.SWEEP_SEEDS) console.log('sweep/replay coverage:', coverage);
}, Math.max(60000, Number(process.env.SWEEP_SEEDS ?? 8) * 1500));
