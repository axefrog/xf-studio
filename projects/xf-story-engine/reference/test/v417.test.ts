// S0 v4.17 (25 October 2026): the kernel's part of the composite's proposals and of S1 v0.6 (V4-50 to V4-55). Each test is a fixture
// of S0 section 16.1, F-26 to F-31, named by its number.

import { describe, expect, test } from 'bun:test';
import type { Config } from '../src/config.ts';
import type { FillDecl } from '../src/event-kinds.ts';
import type { EventSpec } from '../src/events.ts';
import { H, s } from '../src/id.ts';
import type { Kernel } from '../src/kernel.ts';
import type { Change, Id } from '../src/types.ts';
import { coreKernel } from './helpers.ts';

const cause = H(s('cause'), s('v417'));
const KINDS = { extraEventKinds: ['meta:story', 'shakedown', 'meta:other'], extraParticipantRoles: ['aggressor', 'aggressor-group', 'guard'] };
const kernel = (name: string, cfg?: Partial<Config>): Kernel => coreKernel(name, undefined, cfg, KINDS);

function replacement(k: Kernel, name: string, key: string): Kernel {
  const fresh = coreKernel(name, undefined, k.config, KINDS);
  for (const e of k.eventKinds.names()) fresh.eventKinds.register(k.eventKinds.eventKind(e)!);
  for (const [id, record] of k.persistence.chain) fresh.persistence.chain.set(id, structuredClone(record));
  fresh.newEpoch();
  fresh.persistence.load(key);
  return fresh;
}

const STORY = {
  name: 'meta:story',
  dataFields: {
    pattern: { t: 'text' }, instance: { t: 'ref' }, outcome: { t: 'text' }, kind: { t: 'enum', values: ['resolved', 'failed', 'parked'] }, depth: { t: 'int' },
  },
} as const;

test('restoring kind declarations invalidates projections and permits a later re-adoption', () => {
  const k = kernel('registry-restore');
  k.eventKinds.register(STORY as never);
  k.eventKinds.register({ name: 'meta:other', producers: ['fixture'] });
  const version = k.eventKinds.version;
  k.eventKinds.unregister('meta:story');
  expect(k.eventKinds.version).toBe(version + 1);
  expect(k.eventKinds.names()).not.toContain('meta:story');
  expect(k.eventKinds.dataProblem('meta:story', undefined)).toBeUndefined();
  expect(k.eventKinds.eventKind('meta:other')?.producers).toEqual(['fixture']);
  k.eventKinds.unregister('meta:story');
  expect(k.eventKinds.version).toBe(version + 1);
  k.eventKinds.register(STORY as never);
  expect(k.eventKinds.version).toBe(version + 2);
  expect(k.eventKinds.dataProblem('meta:story', undefined)).toContain('needs its data record');
});

describe('F-26: data on meta: events (V4-50)', () => {
  function world(name: string) {
    const k = kernel(name);
    k.eventKinds.register(STORY as never);
    const creator = k.root('layer3', 'core:person');
    const inst = k.root('instance', 'core:person');
    const base = (n: string, data?: Record<string, unknown>, kind = 'meta:story'): EventSpec => ({
      creator, cause, name: n, time: 100, kind, participants: [], effects: [], witnesses: [], causes: [], ...(data ? { data: data as never } : {}),
    });
    const all = { pattern: 'feud', instance: inst, outcome: 'broken', kind: 'failed', depth: 2 };
    return { k, creator, inst, base, all };
  }

  test('the first is minted, its change carries data, a selector on data.outcome matches it, and a save and load read it identically', () => {
    const { k, base, all } = world('F-26a');
    const watcher = k.root('watcher', 'core:person');
    k.frames.open({
      actor: watcher, level: 'goal', origin: watcher, weight: 1, cause,
      own: { reactsTo: [{ kind: 'core:event', slot: '*', where: [{ path: 'data.outcome', op: 'eq', arg: 'broken' }] }] },
    });
    k.settle();
    k.dispatcher.drain();
    const id = k.events.mintEvent(base('s1', all));
    const ch = k.pending.map((p) => p.change).find((c) => c.c === 'event') as Extract<Change, { c: 'event' }>;
    expect(ch.data).toEqual(all);
    k.settle();
    expect(k.dispatcher.drain().filter((r) => r.type === 'reactsTo')).toHaveLength(1);
    // a different outcome does not match
    k.events.mintEvent(base('s2', { ...all, outcome: 'kept' }));
    k.settle();
    expect(k.dispatcher.drain()).toHaveLength(0);
    // persisted with the event's facts
    k.events.makeCanon(id, 'committed', cause);
    k.persistence.save('A');
    const fresh = replacement(k, 'F-26a', 'A');
    expect(fresh.events.mintedSpec(id)?.data).toEqual(all);
    expect(k.events.mintedSpec(id)?.data).toEqual(all);
    expect(fresh.value(id, 'data')).toBe(k.value(id, 'data'));
  });

  test('a missing field, a field of the wrong type, and a data record on an ordinary kind are each refused with a defect, and nothing is minted', () => {
    const { k, base, all } = world('F-26b');
    const before = k.store.headers.size;
    const { kind: _kind, ...missing } = all;
    const attempts = [base('m1', missing), base('m2', { ...all, depth: 'two' }), base('m3', { ...all, extra: 1 }), base('m4', all, 'assault')];
    for (const a of attempts) {
      const defects = k.defects.ofKind("event-data").length;
      expect(() => k.events.mintEvent(a)).toThrow();
      expect(k.defects.ofKind("event-data").length).toBe(defects + 1);
    }
    expect(k.store.headers.size).toBe(before);
    expect(k.pending.filter((p) => p.change.c === 'event')).toHaveLength(0);
  });

  test('the new fields of the event change are off with eventChangeFields off', () => {
    const k = kernel('F-26c', { eventChangeFields: false });
    k.eventKinds.register(STORY as never);
    const creator = k.root('layer3', 'core:person');
    k.events.mintEvent({ creator, cause, name: 'e', time: 1, kind: 'meta:story', outcome: 'done', data: { pattern: 'p', instance: creator, outcome: 'o', kind: 'parked', depth: 0 } });
    const ch = k.pending.map((p) => p.change).find((c) => c.c === 'event') as Extract<Change, { c: 'event' }>;
    expect(ch.data).toBeUndefined();
    expect(ch.outcome).toBeUndefined();
  });
});

describe('F-27: fills are stored, not read (V4-51)', () => {
  const fills: FillDecl[] = [
    { fn: 'demand', args: { by: 'aggressor|aggressor-group', of: 'victim' } },
    { fn: 'comply', args: { who: 'victim', to: 'aggressor|aggressor-group' }, when: { outcome: ['done'] } },
    { fn: 'refuse', args: { who: 'victim', to: 'aggressor' }, when: { outcome: ['failed', 'prevented'] } },
    { fn: 'protect', args: { guard: 'guard', ward: 'victim' }, when: { outcome: ['prevented'], has: ['guard'] } },
    { fn: 'befall', args: { who: '@place', what: '@self' } },
  ];
  const roles = ['aggressor', 'aggressor-group', 'victim', 'guard'];

  test('registers and returns the declarations in order; a role the kind does not list, and an outcome no event has, are refused', () => {
    const k = kernel('F-27');
    k.eventKinds.register({ name: 'shakedown', roles, fills } as never);
    expect(k.eventKinds.eventKind('shakedown')!.fills).toEqual(fills);
    expect(k.eventKinds.eventKind('shakedown')!.roles).toEqual(roles);
    expect(() => k.eventKinds.register({ name: 'bad1', roles, fills: [{ fn: 'x', args: { a: 'ghost' } }] } as never)).toThrow();
    expect(() => k.eventKinds.register({ name: 'bad2', roles, fills: [{ fn: 'x', args: { a: 'victim' }, when: { outcome: ['lost'] } }] } as never)).toThrow();
    expect(() => k.eventKinds.register({ name: 'bad3', roles, fills: [{ fn: 'x', args: { a: 'victim' }, when: { has: ['ghost'] } }] } as never)).toThrow();
    expect(k.eventKinds.eventKind('bad1')).toBeUndefined();
    // a copy: the caller cannot edit the registry
    k.eventKinds.eventKind('shakedown')!.fills![0]!.fn = 'edited';
    expect(k.eventKinds.eventKind('shakedown')!.fills![0]!.fn).toBe('demand');
  });

  test('resolution, queries and relevance give identical results with and without the fills field', () => {
    const run = (withFills: boolean) => {
      const k = kernel('F-27b');
      k.eventKinds.register({ name: 'shakedown', roles, ...(withFills ? { fills } : {}) } as never);
      const a = k.root('a', 'core:person');
      const watcher = k.root('w', 'core:person');
      k.frames.open({ actor: watcher, level: 'goal', origin: watcher, weight: 1, cause, own: { reactsTo: [{ kind: 'core:event', slot: '*' }] } });
      k.settle();
      const e = k.events.mintEvent({ creator: a, cause, name: 'e', time: 5, kind: 'shakedown', participants: [{ who: a, role: 'aggressor' }], effects: [] });
      k.settle();
      return { r: k.dispatcher.drain().map((x) => [x.type, x.r]), v: k.value(e, 'kind'), rev: k.revision };
    };
    expect(run(true)).toEqual(run(false));
  });
});

describe('F-28: belief changes (V4-52)', () => {
  function world(name: string, cfg?: Partial<Config>) {
    const k = kernel(name, cfg);
    const alice = k.root('alice', 'core:person');
    const bob = k.root('bob', 'core:person');
    const ev = [1, 2, 3].map((n) => k.events.mintEvent({ creator: alice, cause, name: `e${n}`, time: n, kind: 'shakedown' }));
    const changes = (): Array<Extract<Change, { c: 'belief' }>> => k.pending.map((p) => p.change).filter((c): c is Extract<Change, { c: 'belief' }> => c.c === 'belief');
    const mk = (over: Record<string, unknown>) => ({
      believer: alice, subject: bob, path: 'age', value: 30, confidence: 0.5, evidence: [ev[0]!], source: { by: 'observed' as const, event: ev[0]! },
      formed: 10, refreshed: 10, memorable: true, ...over,
    });
    return { k, alice, bob, ev, changes, mk };
  }

  test('set, none on a refresh with evidence held, revised on a new value, dropped; a non-memorable belief is silent until it becomes memorable', () => {
    const { k, alice, bob, ev, changes, mk } = world('F-28a');
    k.beliefs.set(mk({}) as never);
    expect(changes().map((c) => c.op)).toEqual(['set']);
    expect(changes()[0]).toMatchObject({ believer: alice, subject: bob, path: 'age', by: 'observed', evidence: [ev[0]] });
    k.pending.length = 0;
    k.beliefs.set(mk({ refreshed: 20 }) as never);
    expect(changes()).toHaveLength(0);
    // new independent evidence corroborates: confidence and evidence change
    k.beliefs.set(mk({ evidence: [ev[1]], source: { by: 'observed', event: ev[1]! }, refreshed: 21 }) as never);
    expect(changes().map((c) => c.op)).toEqual(['revised']);
    k.pending.length = 0;
    // a value change that replaces the belief drops the old memorable belief and sets the new one (S0 10.5): `revised` is for the same record
    const old = k.beliefs.get(alice, bob, 'age')!;
    k.beliefs.set(mk({ value: 40, confidence: 0.9, evidence: [ev[2]], source: { by: 'observed', event: ev[2]! }, formed: 30, refreshed: 30 }) as never);
    expect(changes().map((c) => c.op)).toEqual(['dropped', 'set']);
    expect(changes()[0]!.belief).toBe(old.id);
    expect(changes()[0]!.evidence).toEqual([ev[0], ev[1]]);
    expect(changes()[1]!.belief).toBe(k.beliefs.get(alice, bob, 'age')!.id);
    expect(changes()[1]!.belief).not.toBe(old.id);
    expect(changes()[1]!.evidence).toEqual([ev[2]]);
    k.pending.length = 0;
    const b = k.beliefs.get(alice, bob, 'age')!;
    expect(k.beliefs.drop(alice, b.id)).toBe(true);
    expect(changes().map((c) => c.op)).toEqual(['dropped']);
    k.pending.length = 0;
    k.beliefs.set(mk({ path: 'name', value: 'x', memorable: false }) as never);
    expect(changes()).toHaveLength(0);
    const t = k.beliefs.get(alice, bob, 'name')!;
    expect(k.beliefs.promote(alice, t.id)).toBe(true);
    expect(changes().map((c) => c.op)).toEqual(['set']);
    // a non-memorable belief dropped is silent
    k.pending.length = 0;
    k.beliefs.set(mk({ path: 'job', value: 'y', memorable: false }) as never);
    k.beliefs.drop(alice, k.beliefs.get(alice, bob, 'job')!.id);
    expect(changes()).toHaveLength(0);
  });

  test('inside a staged batch none until the commit, then all in operation order; a replay makes none; the changes bind the believer, the subject and each evidence event', () => {
    const { k, alice, bob, ev, changes, mk } = world('F-28b');
    k.pending.length = 0;
    const batch = k.stage();
    batch.write(() => {
      k.beliefs.set(mk({}) as never);
      k.beliefs.set(mk({ evidence: [ev[1]], source: { by: 'observed', event: ev[1]! } }) as never);
      k.beliefs.drop(alice, k.beliefs.get(alice, bob, 'age')!.id);
    });
    expect(changes()).toHaveLength(0);
    batch.commit();
    expect(changes().map((c) => c.op)).toEqual(['set', 'revised', 'dropped']);
    // a discarded batch makes none
    k.pending.length = 0;
    const b2 = k.stage();
    b2.write(() => { k.beliefs.set(mk({ path: 'z' }) as never); });
    b2.discard();
    expect(changes()).toHaveLength(0);
    // save, load, replay: none
    k.beliefs.set(mk({ path: 'keep' }) as never);
    k.persistence.save('A');
    const fresh = replacement(k, 'F-28b', 'A');
    expect(fresh.pending.filter((p) => p.change.c === 'belief')).toHaveLength(0);
    const relevance: Id[] = [];
    fresh.dispatcher.onRelevance((r) => relevance.push(r.actor));
    fresh.settle();
    expect(relevance).toHaveLength(0);
  });

  test('a belief change binds the believer, the subject and each evidence event for a matcher', () => {
    const { k, alice, bob, ev, mk } = world('F-28c');
    const watcher = k.root('w', 'core:person');
    k.frames.open({
      actor: watcher, level: 'goal', origin: watcher, weight: 1, cause,
      own: { reactsTo: [{ slot: '*', where: [{ path: '@role', op: 'eq', arg: 'evidence' }] }, { slot: '*', where: [{ path: '@role', op: 'eq', arg: 'believer' }] }, { slot: '*', where: [{ path: '@role', op: 'eq', arg: 'subject' }] }] },
    });
    k.settle();
    k.dispatcher.drain();
    k.beliefs.set(mk({ evidence: [ev[0], ev[1]] }) as never);
    k.settle();
    // one emission per (change, frame, interest type): the greatest relevance among the matching bindings
    const out = k.dispatcher.drain();
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((r) => r.change.c === 'belief')).toBe(true);
    expect(alice).toBeDefined();
    expect(bob).toBeDefined();
  });

  test('beliefChanges off: no change', () => {
    const { k, changes, mk } = world('F-28d', { beliefChanges: false });
    k.beliefs.set(mk({}) as never);
    expect(changes()).toHaveLength(0);
  });
});

describe('F-29: frame openings (V4-53)', () => {
  const seq = (k: Kernel, a: Id, site: Id) => {
    const f = k.frames.open({ id: H(s('frame'), s('g')), actor: a, level: 'goal', origin: a, weight: 1, cause, focus: { nodes: [site], tier: 1 } });
    k.frames.setStatus(f.id, 'blocked', cause);
    k.frames.setStatus(f.id, 'abandoned', cause);
    k.frames.open({ id: f.id, actor: a, level: 'goal', origin: a, weight: 1, cause, focus: { nodes: [site], tier: 1 } });
    return f;
  };
  const frameChanges = (k: Kernel) => k.pending.map((p) => p.change).filter((c) => c.c === 'frame') as Array<Extract<Change, { c: 'frame' }>>;

  test('none to active, active to blocked, blocked to abandoned, abandoned to active, each binding the actor and the focus nodes', () => {
    const k = kernel('F-29a');
    const a = k.root('a', 'core:person');
    const site = k.root('site', 'core:place');
    seq(k, a, site);
    expect(frameChanges(k).map((c) => [c.old, c.new])).toEqual([['none', 'active'], ['active', 'blocked'], ['blocked', 'abandoned'], ['abandoned', 'active']]);
    expect(frameChanges(k).every((c) => c.actor === a && c.focus.length === 1 && c.focus[0] === site)).toBe(true);
  });

  test('with openingChanges off and frame changes on the openings produce nothing and the status changes are as in v4.16; with both off none', () => {
    const k = kernel('F-29b', { openingChanges: false });
    const a = k.root('a', 'core:person');
    const site = k.root('site', 'core:place');
    seq(k, a, site);
    expect(frameChanges(k).map((c) => [c.old, c.new])).toEqual([['active', 'blocked'], ['blocked', 'abandoned']]);
    const k2 = kernel('F-29c', { openingChanges: false, frameChanges: false });
    seq(k2, k2.root('a', 'core:person'), k2.root('site', 'core:place'));
    expect(frameChanges(k2)).toHaveLength(0);
  });

  test('the opening change reaches an interest (a goal opening is heard)', () => {
    const k = kernel('F-29d');
    const a = k.root('a', 'core:person');
    const watcher = k.root('w', 'core:person');
    k.frames.open({ actor: watcher, level: 'goal', origin: watcher, weight: 1, cause, own: { reactsTo: [{ kind: 'core:person', slot: '*', where: [{ path: '@role', op: 'eq', arg: 'actor' }] }] } });
    k.settle();
    k.dispatcher.drain();
    k.frames.open({ actor: a, level: 'goal', origin: a, weight: 1, cause });
    k.settle();
    expect(k.dispatcher.drain().filter((r) => r.change.c === 'frame')).toHaveLength(1);
  });
});

describe('F-30: retained frames (V4-54)', () => {
  test('survives a sweep and a load identically and silently, creates no demand, is no longer a root when satisfied and is kept while a served refers to it', () => {
    const k = kernel('F-30');
    const actor = k.mint(k.root('city', 'core:place'), cause, 'actor', 'core:person');
    const node = k.mint(k.root('city', 'core:place'), cause, 'node', 'core:person');
    const f = k.frames.open({ id: H(s('frame'), s('goal')), actor, level: 'goal', origin: actor, weight: 1, cause, retain: true, focus: { nodes: [node] }, own: { wants: [] } });
    expect(f.focus.tier).toBe(0);
    expect(f.retain).toBe(true);
    k.settle();
    k.retention.scheduleSweep();
    k.settle();
    expect(k.store.header(actor)).toBeDefined();
    expect(k.store.header(node)).toBeDefined();
    expect(k.frames.frame(f.id)).toBeDefined();
    expect(k.frames.demandTier(node)).toBe(0);
    expect(k.frames.maxDemandTier()).toBe(0);
    k.persistence.save('A');
    const fresh = replacement(k, 'F-30', 'A');
    expect(fresh.frames.frame(f.id)).toEqual(k.frames.frame(f.id));
    expect(fresh.pending).toHaveLength(0);
    expect(fresh.store.header(actor)).toBeDefined();
    // satisfied: no longer a root
    fresh.frames.setStatus(f.id, 'satisfied', cause);
    expect(fresh.retention.rootFrameIds().has(f.id)).toBe(false);
    // an event whose `served` refers to it is canon: the frame is kept
    const ev = fresh.events.mintEvent({ creator: actor, cause, name: 'act', time: 5, kind: 'shakedown', served: f.id });
    fresh.events.makeCanon(ev, 'committed', cause);
    expect(fresh.retention.rootFrameIds().has(f.id)).toBe(true);
    fresh.retention.scheduleSweep();
    fresh.settle();
    expect(fresh.retention.rootFrameIds().has(f.id)).toBe(true);
    fresh.persistence.save('B');
    expect(fresh.persistence.chain.get('B')!.ops.some((o) => o.op === 'FrameState' && o.id === f.id)).toBe(true);
  });

  test('a retained frame an earlier save holds is never dropped: its terminal status is written, and a swept frame recovers silently', () => {
    const k = kernel('F-30b');
    const actor = k.mint(k.root('city', 'core:place'), cause, 'actor', 'core:person');
    const f = k.frames.open({ id: H(s('frame'), s('goal')), actor, level: 'goal', origin: actor, weight: 1, cause, retain: true });
    k.persistence.save('A');
    k.frames.setStatus(f.id, 'satisfied', cause);
    const b = k.persistence.save('B');
    // the terminal status is written as a change to a saved record, never as a null
    expect(b.ops).not.toContainEqual({ op: 'FrameState', id: f.id, frame: null });
    const written = b.ops.find((o) => o.op === 'FrameState' && o.id === f.id);
    expect(written && written.op === 'FrameState' ? written.frame?.status : undefined).toBe('satisfied');
    // a reload holds what the run that went on holds
    const fresh = replacement(k, 'F-30b2', 'B');
    expect(fresh.frames.frame(f.id)).toEqual(k.frames.frame(f.id));
    // a frame taken out of memory comes back as saved when something reaches it, with no change and no relevance
    const saved = structuredClone(fresh.frames.frame(f.id)!);
    fresh.frames.remove(f.id);
    expect(fresh.frames.frame(f.id)).toBeUndefined();
    const before = fresh.pending.length;
    fresh.persistence.recoverIfSaved(f.id);
    expect(fresh.frames.frame(f.id)).toEqual(saved);
    expect(fresh.pending.length).toBe(before);
  });

  test('an ended retained frame that no save holds and no record refers to is not added to a save', () => {
    const k = kernel('F-30b3');
    const actor = k.mint(k.root('city', 'core:place'), cause, 'actor', 'core:person');
    const f = k.frames.open({ id: H(s('frame'), s('goal')), actor, level: 'goal', origin: actor, weight: 1, cause, retain: true });
    k.frames.setStatus(f.id, 'abandoned', cause);
    const a = k.persistence.save('A');
    expect(a.ops.some((o) => o.op === 'FrameState' && o.id === f.id)).toBe(false);
  });

  for (const snapshotEvery of [1, 1_000_000]) test(`retained live frames do not depend on saves; terminal history survives recovery (${snapshotEvery})`, () => {
    const make = () => kernel('F-30-history', { snapshotEvery });
    const u = make(), r = make();
    const open = (k: Kernel) => {
      const actor = k.root('actor', 'core:person');
      return k.frames.open({ id: H(s('frame'), s('history')), actor, level: 'goal', origin: actor, weight: 1, cause, retain: true });
    };
    const f = open(u); open(r);
    r.persistence.save('A');
    // The frame ends after A, then its final consumer releases it before B.
    for (const k of [u, r]) {
      k.retention.setSeed({ id: H(s('consumer')), state: {}, nodes: [f.id] });
      k.frames.setStatus(f.id, 'satisfied', cause);
      expect(k.persistence.currentView().frames.get(f.id)?.status).toBe('satisfied');
      k.retention.endSeed(H(s('consumer')));
      expect(k.persistence.currentView().frames.has(f.id)).toBe(false);
    }
    expect(r.persistence.currentView().toData().frames).toEqual(u.persistence.currentView().toData().frames);
    expect(r.frames.frame(f.id)).toEqual(u.frames.frame(f.id));
    const b = r.persistence.save('B');
    expect(b.ops).toContainEqual({ op: 'FrameState', id: f.id, frame: structuredClone(u.frames.frame(f.id)!) });
    const fresh = replacement(r, 'F-30-history', 'B');
    expect(fresh.frames.frame(f.id)).toEqual(u.frames.frame(f.id));
    expect(fresh.persistence.currentView().frames.has(f.id)).toBe(false);
    fresh.frames.remove(f.id);
    fresh.persistence.save('C');
    expect(fresh.persistence.rebuild('C').view.frames.get(f.id)).toEqual(u.frames.frame(f.id));
    fresh.persistence.recoverIfSaved(f.id);
    expect(fresh.frames.frame(f.id)).toEqual(u.frames.frame(f.id));
    expect(fresh.pending).toHaveLength(0);
    // Re-reference makes the ended frame part of the retained view again in both executions.
    for (const k of [u, fresh]) k.retention.setSeed({ id: H(s('consumer')), state: {}, nodes: [f.id] });
    expect(fresh.persistence.currentView().toData().frames).toEqual(u.persistence.currentView().toData().frames);
  });

  test('a saved retained frame keeps a new game reading that causes its terminal status', () => {
    const k = kernel('F-30-history-cause');
    const actor = k.root('actor', 'core:person');
    const f = k.frames.open({ actor, level: 'goal', origin: actor, weight: 1, cause, retain: true });
    k.persistence.save('A');
    const subject = k.mirrored('subject', 'core:person');
    const reading = k.reading(subject, 'age-class', 'adult');
    k.frames.setStatus(f.id, 'satisfied', reading.id);
    expect(k.persistence.currentView().frames.has(f.id)).toBe(false);
    k.persistence.save('B');
    const fresh = replacement(k, 'F-30-history-cause', 'B');
    expect(fresh.frames.frame(f.id)?.cause).toBe(reading.id);
    expect(fresh.store.pin(reading.id)).toEqual(reading);
  });

  test('an ended retained frame a non-canon retained event names is kept, with its links, and a process state that names it keeps it too', () => {
    const k = kernel('F-30e');
    const actor = k.mint(k.root('city', 'core:place'), cause, 'actor', 'core:person');
    const other = k.mint(k.root('city', 'core:place'), cause, 'other', 'core:person');
    const f = k.frames.open({ id: H(s('frame'), s('goal')), actor, level: 'goal', origin: actor, weight: 1, cause, retain: true, focus: { nodes: [other] } });
    const g = k.frames.open({ id: H(s('frame'), s('goal2')), actor, level: 'goal', origin: actor, weight: 1, cause, retain: true });
    k.frames.setStatus(f.id, 'satisfied', cause);
    k.frames.setStatus(g.id, 'abandoned', cause);
    expect(k.retention.rootFrameIds().has(f.id)).toBe(false);
    // an event that is not canon, retained by an edge it causes, names the frame in `served`
    const ev = k.events.mintEvent({ creator: actor, cause, name: 'act', time: 5, kind: 'shakedown', served: f.id });
    k.persistence.save('A');
    expect(k.retention.rootFrameIds().has(f.id)).toBe(false);
    k.addEdge({ type: 'core:located-in', from: actor, to: k.root('city', 'core:place'), cause: ev });
    expect(k.retention.rootFrameIds().has(f.id)).toBe(true);
    expect(k.retention.marked().has(other)).toBe(true);
    // a process whose persisted state names the other frame keeps it
    k.evolution.register({ id: 'holder', tier: 0, period: 1, run: () => [] });
    k.evolution.states.set('holder', { id: 'holder', state: { frames: [g.id] }, outstanding: [] });
    k.bump();
    expect(k.retention.rootFrameIds().has(g.id)).toBe(true);
    const b = k.persistence.save('B');
    expect(b.ops.some((o) => o.op === 'FrameState' && o.id === g.id)).toBe(true);
  });

  test('a retained frame with focus tier 3 is refused', () => {
    const k = kernel('F-30c');
    const actor = k.root('a', 'core:person');
    expect(() => k.frames.open({ actor, level: 'goal', origin: actor, weight: 1, cause, retain: true, focus: { tier: 3 } })).toThrow();
    expect(k.frames.all()).toHaveLength(0);
  });

  test('a process opens a retained frame through its operations', () => {
    const k = kernel('F-30d');
    const actor = k.root('a', 'core:person');
    k.evolution.register({
      id: 'opener', tier: 0, period: 1,
      run: (_ctx, kk) => (kk === 0 ? [{ op: 'frame-open', frame: { id: H(s('frame'), s('p')), actor, level: 'goal', origin: actor, weight: 1, cause, retain: true } }] : []),
    });
    k.tick({ to: 1200 });
    expect(k.frames.frame(H(s('frame'), s('p')))?.retain).toBe(true);
  });
});

describe('F-31: observedAt (V4-55)', () => {
  test('earliest valid observed pin; a committed pin changes neither', () => {
    const k = kernel('F-31');
    const creator = k.root('c', 'core:person');
    const e = k.events.mintEvent({ creator, cause, name: 'e', time: 1, kind: 'shakedown' });
    expect(k.observedAt(e, 4999)).toBeUndefined();
    k.pin({ node: e, slot: 'kind', value: 'shakedown', reason: 'observed', cause: creator, at: 5000 });
    expect(k.observedAt(e, 4999)).toBeUndefined();
    expect(k.observedAt(e, 6000)).toBe(5000);
    k.pin({ node: e, slot: 'kind', value: 'shakedown', reason: 'observed', cause: creator, at: 4000 });
    expect(k.observedAt(e, 4999)).toBe(4000);
    expect(k.observedAt(e, 6000)).toBe(4000);
    k.pin({ node: e, slot: 'time', value: 1, reason: 'committed', cause: creator, at: 100 });
    expect(k.observedAt(e, 4999)).toBe(4000);
    expect(k.observedAt(e, 6000)).toBe(4000);
  });

  test('a process reads it as of the snapshot', () => {
    const k = kernel('F-31b');
    const creator = k.root('c', 'core:person');
    const e = k.events.mintEvent({ creator, cause, name: 'e', time: 1, kind: 'shakedown' });
    const seen: Array<number | undefined> = [];
    k.evolution.register({ id: 'looker', tier: 0, period: 1, run: (ctx) => { seen.push(ctx.observedAt(e, ctx.windowStart)); return []; } });
    k.tick({ to: 600 });
    k.pin({ node: e, slot: 'kind', value: 'shakedown', reason: 'observed', cause: creator, at: 700 });
    k.tick({ to: 1800 });
    expect(seen[0]).toBeUndefined();
    expect(seen.at(-1)).toBe(700);
  });
});
