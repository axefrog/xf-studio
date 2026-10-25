// The kernel's v4 core (S0 section 20): the additions the seeding layer needs. Each test is named by the
// addition it checks (V4-n), and by the fixture it is (F-16).

import { describe, expect, test } from 'bun:test';
import { coreDefs, mergeDefs } from '../src/core-schema.ts';
import { H, s } from '../src/id.ts';
import { Kernel } from '../src/kernel.ts';
import { redactSensitive } from '../src/persistence.ts';
import { Schema } from '../src/schema.ts';
import { coreRegistry } from '../src/registry.ts';
import { makeConfig } from '../src/config.ts';
import type { Dilemma } from '../src/frames.ts';
import type { Relevance } from '../src/relevance.ts';
import type { Id } from '../src/types.ts';
import { coreKernel, defsOf, dim, fxSeed, kind, slot } from './helpers.ts';

const cause = H(s('cause'), s('v4'));

describe('V4-1: derives receive the query time', () => {
  const defs = defsOf(
    [dim('fx:start', { t: 'int', min: 0, max: 1000 }), dim('fx:late', { t: 'int', min: 0, max: 100 })],
    [kind('fx:job', [
      slot('start', 'fx:start', { mode: 'assigned' }),
      slot('urgency', 'fx:late', { mode: 'derived', derive: { fn: { name: 'elapsed', version: 1 }, inputs: ['start'] } }),
    ])],
  );
  const kern = (): Kernel => {
    const registry = coreRegistry();
    registry.register('derive', 'elapsed', 1, (inputs, _p, t) => Math.max(0, Math.min(100, Math.floor(t / 10) - (inputs[0] as number))));
    return Kernel.create({ defs: mergeDefs(coreDefs(), defs), worldSeed: fxSeed('V4-1'), registry });
  };

  test('a derive that reads t depends on the time asked about, and is cached per time', () => {
    const k = kern();
    const j = k.root('job', 'fx:job');
    k.pin({ node: j, slot: 'start', value: 5, reason: 'authored', cause });
    expect(k.value(j, 'urgency', 100)).toBe(5);
    expect(k.value(j, 'urgency', 300)).toBe(25);
    expect(k.value(j, 'urgency', 100)).toBe(5);
    expect(k.trace(j, 'urgency', 600).value).toBe(55);
  });

  test('a derive that ignores t behaves as before', () => {
    const k = coreKernel('V4-1b');
    const p = k.root('p', 'core:person');
    k.pin({ node: p, slot: 'age', value: 37, reason: 'authored', cause });
    expect(k.value(p, 'age-band', 0)).toBe(3);
    expect(k.value(p, 'age-band', 99_999)).toBe(3);
  });
});

describe('V4-2: the seeding layer kinds', () => {
  test('game facts are mirrored, seed facts assigned, a seed is an actor, a cast is an edge', () => {
    const k = coreKernel('V4-2');
    const fact = k.mirrored('fact:q112_done', 'core:game-fact');
    expect(fact).toBe(H(s('game'), s('fact:q112_done')));
    expect(k.resolve(fact, 'value', 0).status).toBe('unavailable');
    k.reading(fact, 'value', 1, 10);
    expect(k.value(fact, 'value', 20)).toBe(1);
    expect(k.value(fact, 'value', 5)).toBeUndefined();

    const seed = k.mint(k.root('pack:p', 'core:seed'), cause, 'seed:x', 'core:seed');
    expect(k.schema.hasFacet('core:seed', 'actor')).toBe(true);
    const sf = k.mint(seed, seed, 'fact:rung', 'core:seed-fact');
    expect(k.resolve(sf, 'value', 0).status).toBe('unavailable');
    k.pin({ node: sf, slot: 'value', value: 3, reason: 'committed', cause: seed });
    expect(k.value(sf, 'value')).toBe(3);

    const person = k.root('person', 'core:person');
    const e = k.addEdge({ type: 'core:cast', from: seed, to: person, data: { role: 'takemura' }, cause });
    expect(e.data).toEqual({ role: 'takemura' });
    expect(k.schema.edgeType('core:cast').perceivable).toBeFalsy();
    // Only a seed casts.
    expect(() => k.addEdge({ type: 'core:cast', from: person, to: seed, cause })).toThrow();
  });

  test('offer, response and seed-outcome are event kinds', () => {
    const k = coreKernel('V4-2b');
    const seed = k.mint(k.root('pack:p', 'core:seed'), cause, 'seed:x', 'core:seed');
    for (const kindName of ['offer', 'response', 'seed-outcome']) {
      const ev = k.events.mintEvent({ creator: seed, cause: seed, name: `e:${kindName}`, time: 5, kind: kindName });
      expect(k.value(ev, 'kind')).toBe(kindName);
    }
  });
});

describe('V4-3: outcome and served on events', () => {
  test('optional; an event without them means what it always meant, and canon pins the ones it has', () => {
    const k = coreKernel('V4-3');
    const a = k.root('a', 'core:person');
    const frame = H(s('frame'), s('x'));
    const plain = k.events.mintEvent({ creator: a, cause: a, name: 'plain', time: 1, kind: 'generic' });
    const rich = k.events.mintEvent({ creator: a, cause: a, name: 'rich', time: 2, kind: 'assault', outcome: 'failed', served: frame });
    expect(k.resolve(plain, 'outcome').status).toBe('unavailable');
    expect(k.value(rich, 'outcome')).toBe('failed');
    expect(k.value(rich, 'served')).toBe(frame);
    k.events.makeCanon(plain, 'committed', a);
    k.events.makeCanon(rich, 'committed', a);
    expect(k.events.canonRecord(plain)!.entries[0]!.fields).not.toContain('outcome');
    expect(k.events.canonRecord(rich)!.entries[0]!.fields).toEqual(expect.arrayContaining(['outcome', 'served']));
    expect(k.store.livePinsOn(rich, 'outcome')).toHaveLength(1);
  });
});

describe('V4-4: the frame change', () => {
  function world() {
    const k = coreKernel('V4-4');
    const v = k.root('v', 'core:person');
    k.frames.demandRoots.add(v);
    const site = k.root('site', 'core:place');
    const watcher = k.frames.open({
      actor: v, level: 'concern', origin: v, weight: 1, cause,
      own: { reactsTo: [{ kind: 'core:place', slot: '*' }] },
    });
    const actorFrame = k.frames.open({ actor: k.root('npc', 'core:person'), level: 'goal', origin: v, weight: 1, cause, focus: { nodes: [site], tier: 3 } });
    k.settle();
    k.dispatcher.drain();
    return { k, v, site, watcher, actorFrame };
  }

  test('a status change is a change with the actor and each focus node as bindings; weight and parent changes are not', () => {
    const { k, site, actorFrame } = world();
    k.frames.setWeight(actorFrame.id, 0.5, cause);
    k.settle();
    expect(k.dispatcher.drain()).toHaveLength(0);
    k.frames.setStatus(actorFrame.id, 'satisfied', cause);
    expect(k.pending).toHaveLength(1);
    expect(k.pending[0]!.change).toEqual({ c: 'frame', frame: actorFrame.id, actor: actorFrame.actor, level: 'goal', focus: [site], old: 'active', new: 'satisfied' });
    k.settle();
    const out = k.dispatcher.drain();
    // The watcher reacts to a place: the focus node (role `focus`) is the binding that matches.
    expect(out).toHaveLength(1);
    expect(out[0]!.change.c).toBe('frame');
    expect(site).toBeDefined();
    // The same status again is no change.
    k.frames.setStatus(actorFrame.id, 'satisfied', cause);
    expect(k.pending).toHaveLength(0);
  });

  test('a where clause can read the binding role', () => {
    const { k, v, actorFrame } = world();
    k.frames.open({
      actor: v, level: 'concern', origin: actorFrame.id, weight: 1, cause,
      own: { wants: [{ kind: 'core:person', slot: '*', where: [{ path: '@role', op: 'eq', arg: 'actor' }] }] },
    });
    k.settle();
    k.dispatcher.drain();
    k.frames.setStatus(actorFrame.id, 'abandoned', cause);
    k.settle();
    const types = k.dispatcher.drain().map((r) => r.type);
    expect(types).toContain('wants');
  });

  test('the change can be switched off (the frozen v3 digest runs without it)', () => {
    const k = coreKernel('V4-4b', undefined, { frameChanges: false, openingChanges: false });
    const a = k.root('a', 'core:person');
    const f = k.frames.open({ actor: a, level: 'goal', origin: a, weight: 1, cause });
    k.frames.setStatus(f.id, 'satisfied', cause);
    expect(k.pending).toHaveLength(0);
  });
});

describe('V4-5 and V4-27: relevance and dilemmas reach layer 2', () => {
  function attach(k: Kernel, actors: Id[]) {
    const seen: Array<string> = [];
    const rel: Relevance[] = [];
    const dil: Dilemma[] = [];
    const set = new Set(actors);
    k.layer2 = {
      actors: () => set,
      onRelevance: (r) => { rel.push(r); seen.push(`r:${r.actor}`); },
      onDilemma: (d) => { dil.push(d); seen.push(`d:${d.actor}`); },
      onBoundary: () => {},
      pending: 0,
      run: () => 0,
      flush: () => {},
      onLoad: () => {},
    };
    return { rel, dil, seen };
  }

  test('emissions on frames whose actor layer 2 registered are delivered to it, in the same order, and only those', () => {
    const k = coreKernel('V4-5');
    const seedA = k.mint(k.root('pack', 'core:seed'), cause, 'seed:a', 'core:seed');
    const seedB = k.mint(k.root('pack', 'core:seed'), cause, 'seed:b', 'core:seed');
    const other = k.root('other', 'core:person');
    const place = k.root('place', 'core:place');
    const mk = (actor: Id) => k.frames.open({ actor, level: 'goal', origin: actor, weight: 1, cause, own: { reactsTo: [{ kind: 'core:place', slot: 'public', scope: { nodes: [place] } }] } });
    mk(seedB);
    mk(other);
    mk(seedA);
    k.frames.demandRoots.add(seedA);
    k.frames.demandRoots.add(seedB);
    k.settle();
    const probe = attach(k, [seedA, seedB]);
    k.pin({ node: place, slot: 'public', value: 'public', reason: 'authored', cause });
    k.settle();
    const all = k.dispatcher.drain();
    expect(all).toHaveLength(3);
    // The same order as the kernel's emissions, minus the actor layer 2 did not register.
    expect(probe.rel.map((r) => r.actor)).toEqual(all.filter((r) => r.actor !== other).map((r) => r.actor));
    expect(probe.rel.every((r) => r.time === 0)).toBe(true);
  });

  test('a dilemma on a role goal frame (below a seed frame) goes to layer 2', () => {
    const k = coreKernel('V4-27');
    const seed = k.mint(k.root('pack', 'core:seed'), cause, 'seed:a', 'core:seed');
    const claw = k.root('claw', 'core:person');
    const x = k.root('x', 'core:person');
    k.frames.open({ actor: claw, level: 'concern', origin: H(s('family')), weight: 1, cause, own: { protects: [{ slot: '*', scope: { nodes: [x] } }] } });
    const role = k.frames.open({ actor: seed, level: 'goal', origin: seed, weight: 1, cause });
    k.settle();
    const probe = attach(k, [seed]);
    k.frames.open({
      actor: claw, level: 'goal', origin: role.id, weight: 1, cause, parents: [{ frame: role.id, weight: 1 }],
      payload: { goal: { effects: [{ on: x, effect: 'kill' }] } },
    });
    k.settle();
    expect(k.frames.drainDilemmas()).toHaveLength(1);
    expect(probe.dil).toHaveLength(1);
    expect(probe.dil[0]!.actor).toBe(claw);
  });
});

describe('V4-22: age-class', () => {
  test('derived from age at 18 for generated people; a declared class narrows the age; a missing reading is a minor', () => {
    const k = coreKernel('V4-22');
    const p = k.root('p', 'core:person');
    k.pin({ node: p, slot: 'age', value: 17, reason: 'authored', cause });
    expect(k.value(p, 'age-class')).toBe('minor');
    k.pin({ node: p, slot: 'age', value: 18, reason: 'authored', cause: H(s('other')), id: H(s('pin2')) });
    // Two authored pins on one slot: the lower Id wins arbitration; this test only needs one at each end.
    const q = k.root('q', 'core:person');
    k.pin({ node: q, slot: 'age', value: 40, reason: 'authored', cause });
    expect(k.value(q, 'age-class')).toBe('adult');
    // A pack person's class is declared: the pin on the derived slot narrows the age (its preimage).
    const r = k.root('r', 'core:person');
    k.pin({ node: r, slot: 'age-class', value: 'minor', reason: 'authored', cause });
    expect(k.value(r, 'age')).toBeLessThanOrEqual(17);
    expect(k.value(r, 'age-class')).toBe('minor');
    const a = k.root('a', 'core:person');
    k.pin({ node: a, slot: 'age-class', value: 'adult', reason: 'authored', cause });
    expect(k.value(a, 'age')).toBeGreaterThanOrEqual(18);
    // A mirrored person: the class is the game's reading; with none it is unavailable, which floor checks read as a minor.
    const m = k.mirrored('npc:m', 'core:person');
    expect(k.resolve(m, 'age-class').status).toBe('unavailable');
    k.reading(m, 'age-class', 'adult', 0);
    expect(k.value(m, 'age-class', 1)).toBe('adult');
  });
});

describe('V4-26: staged batches', () => {
  const abc = defsOf([dim('fx:abc', { t: 'enum', values: ['a', 'b', 'c'] })], [kind('fx:t', [slot('x', 'fx:abc')], { extends: ['core:thing'] })]);
  function world() {
    const k = coreKernel('V4-26', abc);
    const v = k.root('v', 'core:person');
    k.frames.demandRoots.add(v);
    const n = k.root('n', 'fx:t');
    const m = k.root('m', 'fx:t');
    k.frames.open({ actor: v, level: 'concern', origin: v, weight: 1, cause, own: { reactsTo: [{ slot: '*', scope: { nodes: [n, m] } }] } });
    k.settle();
    k.dispatcher.drain();
    return { k, n, m };
  }

  test('writes are visible through the batch, silent, and not interleaved with other writes', () => {
    const { k, n } = world();
    const rev = k.revision;
    const batch = k.stage();
    batch.write((kk) => kk.pin({ node: n, slot: 'x', value: 'c', reason: 'committed', cause }));
    expect(batch.value(n, 'x')).toBe('c');
    expect(batch.trace(n, 'x').winner?.value).toBe('c');
    expect(k.pending).toHaveLength(0);
    expect(batch.changes).toHaveLength(1);
    expect(() => k.pin({ node: n, slot: 'x', value: 'b', reason: 'authored', cause })).toThrow(/staged batch/);
    expect(() => k.tick()).toThrow(/staged batch/);
    expect(() => k.persistence.save('s')).toThrow();
    expect(() => k.stage()).toThrow();
    expect(k.submit({ epoch: k.epoch, stamp: 1, op: { op: 'pin', spec: { node: n, slot: 'x', value: 'a', reason: 'authored', cause } } }).accepted).toBe(false);
    batch.discard();
    expect(k.revision).toBe(rev);
  });

  test('commit applies the writes as one unit and dispatches their changes in the order they were made', () => {
    const { k, n, m } = world();
    const rev = k.revision;
    const batch = k.stage();
    batch.write((kk) => kk.pin({ node: m, slot: 'x', value: 'a', reason: 'committed', cause }));
    batch.write((kk) => kk.pin({ node: n, slot: 'x', value: 'b', reason: 'committed', cause }));
    k.dispatcher.drain();
    batch.commit();
    expect(k.revision).toBeGreaterThan(rev);
    expect(k.pending.map((p) => (p.change as { node: Id }).node)).toEqual([m, n]);
    k.settle();
    const out = k.dispatcher.drain();
    expect(out.map((r) => (r.change as { node: Id }).node)).toEqual([m, n]);
    expect(k.value(n, 'x')).toBe('b');
    // After the commit, ordinary writes work again, and the pins persist.
    k.pin({ node: n, slot: 'x', value: 'c', reason: 'authored', cause });
    k.persistence.save('A');
    expect(k.persistence.chain.get('A')!.ops.filter((o) => o.op === 'PinAdded')).toHaveLength(3);
  });

  test('discard leaves nothing: no pin, change, frame, edge, belief, node or revision', () => {
    const { k, n } = world();
    const v = k.root('v', 'core:person');
    k.persistence.save('A');
    const before = JSON.stringify([...k.persistence.currentView().toData().pins]);
    const rev = k.revision;
    const batch = k.stage();
    let minted: Id | undefined;
    batch.write((kk) => {
      kk.pin({ node: n, slot: 'x', value: 'b', reason: 'committed', cause });
      const nid = kk.mint(v, cause, 'extra', 'fx:t');
      minted = nid;
      kk.contribute({ source: { layer: 'authored', origin: v }, target: { slot: 'x', scope: { nodes: [nid] } }, form: { f: 'const', value: 'c' }, mode: 'constrain' });
      kk.addEdge({ type: 'core:located-in', from: nid, to: n, cause });
      kk.frames.open({ actor: v, level: 'goal', origin: v, weight: 1, cause });
      kk.beliefs.set({ believer: v, subject: n, path: 'x', value: 'b', confidence: 1, evidence: [cause], source: { by: 'inferred', rule: { name: 'seed', version: 1 }, from: [cause] }, formed: 0, refreshed: 0, memorable: true });
    });
    expect(batch.changes.length).toBeGreaterThan(3);
    const framesDuring = k.frames.all().length;
    batch.discard();
    expect(k.revision).toBe(rev);
    expect(k.pending).toHaveLength(0);
    expect(k.frames.all().length).toBe(framesDuring - 1);
    expect(k.store.allEdges()).toHaveLength(0);
    expect(k.beliefs.entries()).toHaveLength(0);
    expect(minted).toBeDefined();
    expect(k.store.header(minted!)).toBeUndefined();
    k.settle();
    expect(k.dispatcher.drain()).toHaveLength(0);
    expect(JSON.stringify([...k.persistence.currentView().toData().pins])).toBe(before);
    // A write after the discard reaches the revision the batch used, and is not served stale caches.
    expect(k.resolve(n, 'x').status).toBe('ok');
    const unconstrained = k.value(n, 'x');
    k.pin({ node: n, slot: 'x', value: 'c', reason: 'authored', cause });
    expect(k.value(n, 'x')).toBe('c');
    expect(unconstrained).toBeDefined();
  });

  test('a save is refused with a batch open, even from inside its own write callback (review R-1)', () => {
    const { k, n } = world();
    const batch = k.stage();
    batch.write((kk) => kk.pin({ node: n, slot: 'x', value: 'b', reason: 'committed', cause }));
    expect(() => batch.write((kk) => kk.persistence.save('inside'))).toThrow(/staged batch/);
    expect(k.persistence.chain.has('inside')).toBe(false);
    batch.discard();
    expect(k.persistence.chain.has('inside')).toBe(false);
  });

  test('discard also restores settings, seed records, streaming and canon sets (review R-2)', () => {
    const { k, n } = world();
    const v = k.root('v', 'core:person');
    k.settings.set({ tempo: 'calm' });
    k.retention.setSeed({ id: n, state: { keep: 1 }, nodes: [] });
    const rev = k.revision;
    const settingsBefore = JSON.stringify(k.settings.all());
    const seedsBefore = JSON.stringify([...k.retention.seeds.values()]);
    const batch = k.stage();
    batch.write((kk) => {
      kk.settings.set({ tempo: 'off' });
      kk.retention.setSeed({ id: v, state: { added: 1 }, nodes: [], actor: v });
      kk.retention.setSeed({ id: n, state: { keep: 2 }, nodes: [] });
      kk.retention.streamIn([n]);
    });
    expect(k.settings.current().tempo).toBe('off');
    batch.discard();
    expect(k.revision).toBe(rev);
    expect(JSON.stringify(k.settings.all())).toBe(settingsBefore);
    expect(JSON.stringify([...k.retention.seeds.values()])).toBe(seedsBefore);
    expect(k.retention.streamed.size).toBe(0);
    expect(k.frames.demandRoots.has(v)).toBe(true); // v was added by world(), not by the batch
    expect(k.settings.current().tempo).toBe('calm');
  });

  test('a load refuses to run with a batch open', () => {
    const { k } = world();
    k.persistence.save('A');
    const batch = k.stage();
    expect(() => k.persistence.load('A')).toThrow(/staged batch/);
    batch.discard();
  });
});

describe('V4-12, V4-16, V4-21: SettingsSet', () => {
  test('settings are an append-only log, in force from their time, persisted and branched with the saves', () => {
    const k = coreKernel('V4-12');
    expect(k.settings.current().content.preset).toBe('as-the-game');
    expect(k.settings.current().tempo).toBe('steady');
    k.persistence.save('A');
    k.settings.set({ memoryScale: 2, tempo: 'calm', content: { ceiling: { 'violence.gore': 1 } } }, 100);
    k.settings.set({ noticing: 'off', cityScale: 3, classExclusions: ['harm.minor'], exclusions: [H(s('npc'))] }, 200);
    expect(k.settings.at(50).memoryScale).toBe(1);
    expect(k.settings.at(150).memoryScale).toBe(2);
    expect(k.settings.at(250)).toMatchObject({ memoryScale: 2, tempo: 'calm', noticing: 'off', cityScale: 3 });
    expect(k.settings.at(250).content.ceiling).toEqual({ 'violence.gore': 1 });
    const rec = k.persistence.save('B');
    expect(rec.ops.filter((o) => o.op === 'SettingsSet')).toHaveLength(2);
    k.persistence.load('A');
    expect(k.settings.all()).toHaveLength(0);
    k.settings.set({ resetScale: 0.5 }, 10);
    const c = k.persistence.save('C');
    expect(c.ops.filter((o) => o.op === 'SettingsSet')).toHaveLength(1);
    k.persistence.load('B');
    expect(k.settings.all()).toHaveLength(2);
    expect(k.settings.at(150).tempo).toBe('calm');
  });

  test('a change is a lens: it touches no pin, event or record, and the content settings are dropped from exports', () => {
    const k = coreKernel('V4-21');
    const a = k.root('a', 'core:person');
    k.pin({ node: a, slot: 'age', value: 30, reason: 'authored', cause });
    const pins = JSON.stringify(k.store.allPins());
    k.settings.set({ content: { preset: 'strict', ceiling: { dread: 0 } }, memoryScale: 4 });
    expect(JSON.stringify(k.store.allPins())).toBe(pins);
    const rec = k.persistence.save('A');
    const exported = redactSensitive(rec, k.worldSeed);
    const entry = exported.ops.find((o) => o.op === 'SettingsSet');
    expect(entry && entry.op === 'SettingsSet' && entry.settings.content.preset).toBe('redacted');
    expect(entry && entry.op === 'SettingsSet' && entry.settings.memoryScale).toBe(4);
    expect(JSON.stringify(rec)).toContain('strict');
    expect(JSON.stringify(exported)).not.toContain('strict');
  });

  test('the director\'s beliefs about V are dropped from exports too', () => {
    const k = coreKernel('V4-21b');
    const director = k.root('director', 'core:person');
    const v = k.root('v', 'core:person');
    const other = k.root('other', 'core:person');
    const mk = (believer: Id, subject: Id) => k.beliefs.set({
      believer, subject, path: 'age', value: 30, confidence: 1, evidence: [cause],
      source: { by: 'inferred', rule: { name: 'x', version: 1 }, from: [cause] }, formed: 0, refreshed: 0, memorable: true,
    });
    mk(director, v);
    mk(other, v);
    const rec = k.persistence.save('A');
    expect(rec.ops.filter((o) => o.op === 'BeliefSet')).toHaveLength(2);
    expect(redactSensitive(rec, k.worldSeed).ops.filter((o) => o.op === 'BeliefSet')).toHaveLength(1);
  });
});

describe('F-16 and I-16: session independence', () => {
  function run(epochs: (n: number) => Id, wall: number) {
    const realNow = Date.now;
    Date.now = () => wall;
    try {
      const schema = Schema.load(mergeDefs(coreDefs(), defsOf([dim('fx:abc', { t: 'enum', values: ['a', 'b', 'c', 'd'] })], [kind('fx:t', [slot('x', 'fx:abc')])])), coreRegistry(), makeConfig());
      let count = 0;
      const k = new Kernel({ schema, worldSeed: fxSeed('F-16'), epochSource: () => epochs(count++) });
      const v = k.root('v', 'fx:t');
      k.frames.demandRoots.add(v);
      const n = k.root('n', 'fx:t');
      k.frames.open({ actor: v, level: 'concern', origin: v, weight: 1, cause, own: { wants: [{ slot: '*', scope: { nodes: [n] } }] } });
      k.settle();
      k.persistence.save('A');
      k.pin({ node: n, slot: 'x', value: 'a', reason: 'authored', cause });
      k.persistence.save('B');
      k.persistence.load('A');
      k.pin({ node: n, slot: 'x', value: 'b', reason: 'authored', cause });
      k.persistence.save('C');
      k.persistence.load('B');
      const values = ['A', 'B', 'C'].map((key) => {
        k.persistence.load(key);
        return k.value(n, 'x');
      });
      return { records: JSON.stringify([...k.persistence.chain.values()]), values, ids: [k.epoch] };
    } finally {
      Date.now = realNow;
    }
  }

  test('F-16: the F-12 sequence under different epochs and clocks gives identical records and resolved values', () => {
    const one = run((n) => H(s('epoch-one'), s(String(n))), 1_000);
    const two = run((n) => H(s('epoch-two'), s(String(n * 7))), 9_999_999);
    expect(one.ids[0]).not.toBe(two.ids[0]);
    expect(one.records).toBe(two.records);
    expect(one.values).toEqual(two.values);
    expect(one.values.slice(1)).toEqual(['a', 'b']);
  });

  test('I-16: no draw key, Id or ordering reads the epoch', () => {
    // Ids and draws are functions of the world seed and the records alone; two kernels with different epochs agree.
    const mk = (epoch: string) => {
      const schema = Schema.load(mergeDefs(coreDefs(), defsOf([dim('fx:abc', { t: 'enum', values: ['a', 'b', 'c', 'd'] })], [kind('fx:t', [slot('x', 'fx:abc')])])), coreRegistry(), makeConfig());
      const k = new Kernel({ schema, worldSeed: fxSeed('I-16'), epochSource: () => H(s(epoch)) });
      const n = k.root('n', 'fx:t');
      const ev = k.events.mintEvent({ creator: n, cause: n, name: 'e', time: 3, kind: 'generic' });
      return { n, ev, x: k.value(n, 'x'), pin: k.pin({ node: n, slot: 'x', value: 'c', reason: 'authored', cause }).id };
    };
    expect(mk('e1')).toEqual(mk('e2'));
  });
});
