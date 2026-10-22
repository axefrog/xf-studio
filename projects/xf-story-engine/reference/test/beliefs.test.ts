import { describe, expect, test } from 'bun:test';
import { H, s } from '../src/id.ts';
import { type Belief, STUB_POLICY } from '../src/beliefs.ts';
import type { Id } from '../src/types.ts';
import { coreKernel, defsOf, dim, kind, slot } from './helpers.ts';

const cause = H(s('test-cause'));

describe('F-9 hearsay (spec 11.2)', () => {
  function story(name: string) {
    const k = coreKernel(name);
    const place = k.root('place', 'core:place');
    const alice = k.root('alice', 'core:person');
    const carl = k.root('carl', 'core:person');
    const dana = k.root('dana', 'core:person');
    const E = k.events.mintEvent({ creator: alice, cause, name: 'E', time: 100, kind: 'assault', place, witnesses: [alice] });
    return { k, alice, carl, dana, E };
  }

  test('F-9: a rumour from one origin never corroborates itself', () => {
    const { k, alice, carl, dana, E } = story('F-9');
    expect(k.beliefs.observe(alice, E)).toEqual(['added']);
    const aBelief = k.beliefs.get(alice, E, 'kind')!;
    expect(aBelief).toMatchObject({ value: 'assault', evidence: [E], source: { by: 'observed', event: E }, confidence: 1 });
    expect(k.beliefs.tell(alice, carl, aBelief.id)).toBe('added');
    const cBelief = k.beliefs.get(carl, E, 'kind')!;
    expect(cBelief.evidence).toEqual([E]);
    expect(cBelief.source).toMatchObject({ by: 'told', teller: alice });
    expect(k.beliefs.tell(carl, dana, cBelief.id)).toBe('added');
    const dBefore = { ...k.beliefs.get(dana, E, 'kind')! };
    expect(dBefore.evidence).toEqual([E]);
    // Alice tells Dana too: the same origin, so the second telling only refreshes.
    k.now = 500;
    expect(k.beliefs.tell(alice, dana, aBelief.id)).toBe('refreshed');
    const dAfter = k.beliefs.get(dana, E, 'kind')!;
    expect(dAfter.evidence).toEqual([E]);
    expect(dAfter.confidence).toBe(dBefore.confidence);
    expect(dAfter.refreshed).toBe(500);
    expect(dAfter.formed).toBe(dBefore.formed);
  });

  test('independent evidence corroborates: confidence rises, evidence unions', () => {
    const { k, alice, carl, E } = story('F-9b');
    const E2 = k.events.mintEvent({ creator: alice, cause, name: 'E2', time: 100, kind: 'assault' });
    const base = { believer: carl, subject: E, path: 'kind', value: 'assault', confidence: 0.5, formed: 1, refreshed: 1, memorable: true };
    expect(k.beliefs.set({ ...base, evidence: [E], source: { by: 'observed', event: E } })).toBe('added');
    expect(k.beliefs.set({ ...base, evidence: [E2], source: { by: 'observed', event: E2 } })).toBe('corroborated');
    const b = k.beliefs.get(carl, E, 'kind')!;
    expect(b.evidence).toEqual([E, E2].sort());
    expect(b.confidence).toBe(0.75);
  });

  test('I-9: one active belief per (believer, subject, path, at); a contradiction is the policy\'s call; a memorable loser is history', () => {
    const { k, alice, carl, E } = story('I-9');
    const mk = (value: string, confidence: number, memorable: boolean, at?: number): Omit<Belief, 'id'> =>
      ({ believer: carl, subject: E, path: 'kind', value, confidence, evidence: [], source: { by: 'inferred', rule: { name: 'r', version: 1 }, from: [] }, formed: 1, refreshed: 1, memorable, ...(at === undefined ? {} : { at }) });
    expect(k.beliefs.set(mk('sale', 0.5, true))).toBe('added');
    expect(k.beliefs.set(mk('assault', 0.25, true))).toBe('kept'); // lower confidence: STUB policy keeps the existing belief
    expect(k.beliefs.activeOf(carl)).toHaveLength(1);
    expect(k.beliefs.set(mk('assault', 0.75, false))).toBe('replaced');
    expect(k.beliefs.activeOf(carl)).toHaveLength(1);
    expect(k.beliefs.get(carl, E, 'kind')!.value).toBe('assault');
    const entries = k.beliefs.entries();
    expect(entries.filter((e) => e.active)).toHaveLength(1);
    // The replaced memorable belief and the kept memorable newcomer are history.
    expect(entries.filter((e) => !e.active).map((e) => e.belief.value).sort()).toEqual(['assault', 'sale']);
    // A different "at" is a different question.
    expect(k.beliefs.set(mk('sale', 0.5, true, 40))).toBe('added');
    expect(k.beliefs.activeOf(carl)).toHaveLength(2);
    void alice;
  });

  test('the policy is replaceable and drives replacement and merging', () => {
    const { k, carl, E } = story('policy');
    const saved = k.beliefs.policy;
    k.beliefs.policy = { ...STUB_POLICY, replaces: () => true, mergeConfidence: (a, b) => Math.max(a, b) };
    const mk = (value: string): Omit<Belief, 'id'> => ({ believer: carl, subject: E, path: 'kind', value, confidence: 0.5, evidence: [], source: { by: 'inferred', rule: { name: 'r', version: 1 }, from: [] }, formed: 1, refreshed: 1, memorable: false });
    k.beliefs.set(mk('a'));
    expect(k.beliefs.set(mk('b'))).toBe('replaced');
    k.beliefs.policy = saved;
  });

  test('beliefs never constrain world state', () => {
    const { k, alice, E } = story('no-constrain');
    k.beliefs.observe(alice, E);
    k.beliefs.set({ believer: alice, subject: E, path: 'kind', value: 'sale', confidence: 1, evidence: [], source: { by: 'inferred', rule: { name: 'r', version: 1 }, from: [] }, formed: 1, refreshed: 1, memorable: false });
    expect(k.value(E, 'kind')).toBe('assault');
    expect(k.beliefs.aggregate([alice], E, 'kind')).toEqual({ value: 'assault', confidence: 1 });
  });
});

describe('policy hooks (spec 11.2)', () => {
  test('onTick is called for each believer after a boundary, as a budgeted worklist', () => {
    const k = coreKernel('ticks');
    const a = k.root('a', 'core:person');
    const b = k.root('b', 'core:person');
    for (const who of [a, b]) {
      k.beliefs.set({ believer: who, subject: a, path: 'age', value: 30, confidence: 1, evidence: [], source: { by: 'inferred', rule: { name: 'r', version: 1 }, from: [] }, formed: 0, refreshed: 0, memorable: false });
    }
    const called: Id[] = [];
    k.beliefs.policy = { ...STUB_POLICY, onTick: (_k, who) => { called.push(who); } };
    k.tick({ to: 600 });
    expect([...called].sort()).toEqual([a, b].sort());
    k.tick({ to: 1200 });
    expect(called).toHaveLength(4);
    k.beliefs.policy = STUB_POLICY;
  });
});

describe('F-10 secret affiliation and knowing (spec 11.4)', () => {
  function world(name: string, visibility: 'open' | 'secret' | 'deniable') {
    const k = coreKernel(name);
    const place = k.root('place', 'core:place');
    const alice = k.root('alice', 'core:person');
    const bob = k.root('bob', 'core:person');
    const militech = k.root('militech', 'core:group');
    const edge = k.addEdge({ type: 'core:member-of', from: bob, to: militech, attrs: { role: 'member', strength: 0.5, visibility }, cause });
    k.events.mintEvent({
      creator: alice, cause, name: 'meet', time: 100, kind: 'meeting', place,
      participants: [{ who: bob, role: 'participant' }], witnesses: [alice],
    });
    return { k, alice, bob, militech, edge };
  }

  test('F-10: a secret membership is never perceived; the same edge with visibility open is', () => {
    const secret = world('F-10a', 'secret');
    expect(secret.k.beliefs.knows(secret.alice, secret.bob, 'member-of', 100)).toEqual({ k: 'unknown' });
    expect(world('F-10b', 'deniable').k.beliefs.knows(secret.alice, secret.bob, 'core:member-of', 100).k).toBe('unknown');
    const open = world('F-10c', 'open');
    const got = open.k.beliefs.knows(open.alice, open.bob, 'member-of', 100);
    expect(got.k).toBe('seen');
    expect(got.k === 'seen' && got.edges!.map((e) => e.id)).toEqual([open.edge.id]);
  });

  test('without a witnessing event the answer is unknown, never world truth', () => {
    const w = world('F-10d', 'open');
    expect(w.k.beliefs.knows(w.alice, w.bob, 'member-of', 101)).toEqual({ k: 'unknown' });
    const stranger = w.k.root('stranger', 'core:person');
    expect(w.k.beliefs.knows(stranger, w.bob, 'member-of', 100)).toEqual({ k: 'unknown' });
    expect(w.k.beliefs.knows(w.alice, w.bob, 'age', 100)).toEqual({ k: 'unknown' });
  });

  test('a belief answers before perception does, and an ended edge is not seen', () => {
    const w = world('F-10e', 'open');
    w.k.beliefs.set({ believer: w.alice, subject: w.bob, path: 'age', value: 31, confidence: 0.5, evidence: [], source: { by: 'inferred', rule: { name: 'r', version: 1 }, from: [] }, formed: 1, refreshed: 1, memorable: false });
    expect(w.k.beliefs.knows(w.alice, w.bob, 'age', 100)).toMatchObject({ k: 'belief' });
    w.k.endEdge(w.edge.id, 100);
    expect(w.k.beliefs.knows(w.alice, w.bob, 'member-of', 100)).toEqual({ k: 'unknown' });
  });

  test('a witness sees a mirrored slot only when S1 marks its dimension visible', () => {
    const defs = defsOf(
      [dim('fx:outfit', { t: 'enum', values: ['suit', 'jeans'] })],
      [kind('fx:dresser', [slot('outfit', 'fx:outfit', { mode: 'mirrored' })], { extends: ['core:person'] })],
    );
    const k = coreKernel('visible', defs);
    const place = k.root('place', 'core:place');
    const alice = k.root('alice', 'core:person');
    const npc = k.mirrored('npc/1', 'fx:dresser');
    k.reading(npc, 'outfit', 'suit', 50);
    k.events.mintEvent({ creator: alice, cause, name: 'meet', time: 100, kind: 'meeting', place, participants: [{ who: npc, role: 'participant' }], witnesses: [alice] });
    expect(k.beliefs.knows(alice, npc, 'outfit', 100)).toEqual({ k: 'unknown' });
    k.beliefs.policy = { ...STUB_POLICY, visibleDims: new Set(['fx:outfit']) };
    expect(k.beliefs.knows(alice, npc, 'outfit', 100)).toEqual({ k: 'seen', value: 'suit' });
    k.beliefs.policy = STUB_POLICY;
  });
});

describe('I-12 V is never owned (spec 11.3, 15)', () => {
  test('nothing pins or sets V\'s drives, directly or through a process', () => {
    const k = coreKernel('I-12');
    const v = k.root('v', 'core:person');
    const drive = k.address(v, 'drives[0]');
    expect(() => k.pin({ node: v, slot: 'drives#count', value: 2, reason: 'authored', cause })).toThrow();
    expect(() => k.pin({ node: drive, slot: 'importance', value: 0.5, reason: 'authored', cause })).toThrow();
    expect(() => k.contribute({ source: { layer: 'simulation', origin: cause }, target: { slot: 'importance', scope: { nodes: [drive] } }, form: { f: 'const', value: 0.5 }, mode: 'constrain' })).toThrow();
    // Other slots of V are not drives.
    expect(() => k.pin({ node: v, slot: 'age', value: 30, reason: 'observed', cause })).not.toThrow();
    // A process that tries is refused without stalling the tick.
    k.evolution.register({ id: 'meddler', tier: 0, period: 1, run: () => [{ op: 'pin', node: drive, slot: 'importance', value: 0.5 }] });
    k.tick({ to: 1200 });
    expect(k.defects.ofKind('op-refused').length).toBeGreaterThan(0);
    expect(k.store.pinsOn(drive, 'importance')).toHaveLength(0);
  });
});
