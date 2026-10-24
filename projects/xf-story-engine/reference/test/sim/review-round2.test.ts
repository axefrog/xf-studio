// R3 regressions. tools/check-review-mutations.ts also runs these with pre-fix sources substituted in memory.
import { expect, test, setDefaultTimeout } from 'bun:test';
import { H, s } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import type { ActsState } from '../../src/sim/proc-acts.ts';
import type { EventsState } from '../../src/sim/proc-events.ts';
import { ReplayPort } from '../../src/sim/port.ts';
import { attachLayer2 } from '../../src/sim/layer2-wire.ts';
import { ScriptPort } from '../../src/seeding/port.ts';
import { miniPack, MINI_ID } from '../s2/mini.ts';
import { reevaluate } from '../../src/seeding/run.ts';
import { feedTransitions } from '../../src/sim/reads.ts';
import { pushTransitions } from '../../src/sim/occ.ts';
import { child, inject, quietSim } from './helpers.ts';

setDefaultTimeout(120_000);
const cause = H(s('round2'));

test('R3-01: opened summary evidence retains original fields and provenance through repeated reloads', () => {
  const sim = quietSim('R1-109a', (d) => { d.events.offspring = [0, 0, 0, 0]; }, ['city.events', 'scene.acts']);
  const cell = sim.w.districts[0]!.cellIds[0]!;
  new ReplayPort(sim).submit([{ t: 99 * 600 + 5, op: 'reading', node: 'v', slot: 'cell', value: 'c1' }]);
  sim.startAt(100);
  inject(sim, child(sim, 'first', 0, 100, 'theft', 1, cell), child(sim, 'first', 1, 100, 'theft', 1, cell));
  sim.advance(3);
  const pub = sim.stateOf<ActsState>('scene.acts')!.published[0]!;
  const before = sim.policies.viewEvent(pub.item)!;
  expect(before.participants.length).toBe(2);
  const believer = before.participants[0]!.who;
  sim.k.beliefs.set({ believer, subject: before.participants[1]!.who, path: 'did.harm', value: 'yes', at: sim.k.now, confidence: 1, evidence: [pub.item], source: { by: 'observed', event: pub.item }, formed: sim.k.now, refreshed: sim.k.now, memorable: true });
  sim.k.contribute({ source: { layer: 'authored', origin: cause }, target: { kind: 'core:event', slot: 'kind' }, form: { f: 'const', value: 'assault' }, mode: 'constrain', valid: { to: sim.k.now + 600 } });
  sim.k.persistence.save('A');
  expect(sim.record.evidence[pub.item]!.kind).toBe('theft');
  expect(sim.record.evidence[pub.item]!.provenance).toEqual({ descriptor: pub.summary, materialisation: 'scene.acts' });
  sim.k.persistence.load('A');
  sim.startAt(105);
  expect(sim.policies.viewEvent(pub.item), 'R3-01 semantic: restored materialisation matches the original').toEqual(before);
  const fields = sim.k.store.contributionsNaming(pub.item);
  expect(fields.some((c) => c.target.slot === 'kind' && c.source.layer === 'simulation')).toBe(false);
  expect(fields.find((c) => c.target.slot === 'participants#count')!.source.origin).toBe('scene.acts');
  sim.k.persistence.save('B');
  sim.k.persistence.load('B');
  expect(sim.policies.viewEvent(pub.item)).toEqual(before);
});

test('R3-02: future-ended protection is capped at the save, and future or empty spans are dropped', () => {
  const sim = quietSim('R3-02');
  const person = sim.people.residentAt(sim.w.districts[0]!.cellIds[0]!, 0);
  const seed = sim.k.root('seed', 'core:seed');
  sim.k.retention.setSeed({ id: seed, state: {}, nodes: [person] });
  const e = sim.k.addEdge({ type: 'core:cast', from: seed, to: person, cause: seed, valid: { from: 0, to: 6000 } });
  const future = sim.k.root('future', 'core:person');
  sim.k.addEdge({ type: 'core:cast', from: seed, to: future, cause: seed, valid: { from: 900, to: 6000 } });
  sim.advance(1);
  sim.k.persistence.save('A');
  expect(sim.record.protect[person], 'R3-02 semantic: protection stops at the save time').toEqual([{ from: 0, to: 600 }]);
  expect(sim.record.protect[future]).toBeUndefined();
  sim.k.persistence.load('A');
  sim.k.endEdge(e.id, 1200);
  sim.advance(3);
  expect(sim.people.protectedAt(person, 1500)).toBe(false);
  sim.k.persistence.save('B');
  sim.k.persistence.load('B');
  expect(sim.people.protectedAt(person, 1500)).toBe(false);
  expect(sim.people.protectedAt(person, 599)).toBe(true);
});

test('R3-04: transitive ancestor rules invalidate warm resident and block caches', () => {
  const sim = quietSim('R3-04');
  const cell = sim.w.districts[0]!.cellIds[0]!;
  const resident = sim.people.residentsOfBlock(cell).find((r) => sim.people.view(r)!.age > 25)!;
  sim.k.contribute({ source: { layer: 'authored', origin: cause }, target: { kind: 'xf:resident', slot: 'age' }, form: { f: 'rule', when: [{ path: '^/^/public', op: 'eq', arg: 'private' }], then: { f: 'const', value: 17 } }, mode: 'constrain' });
  sim.k.contribute({ source: { layer: 'authored', origin: cause }, target: { slot: 'public', scope: { nodes: [cell] } }, form: { f: 'rule', when: [{ path: 'position', op: 'eq', arg: [1, 2, 3] }], then: { f: 'const', value: 'private' } }, mode: 'constrain' });
  expect(sim.people.view(resident)!.age).toBeGreaterThan(25);
  sim.k.pin({ node: cell, slot: 'position', value: [1, 2, 3], reason: 'authored', cause });
  expect(sim.k.value(resident, 'age')).toBe(17);
  expect(sim.people.view(resident)!.age, 'R3-04 semantic: resident cache sees the transitive change').toBe(17);
  sim.people.cacheOn = false;
  expect(sim.people.view(resident)!.age).toBe(17);
});

test('R3-04b: named edge-dependent rules bypass resident caches', () => {
  const sim = quietSim('R3-04b');
  const cell = sim.w.districts[0]!.cellIds[0]!;
  const resident = sim.people.residentsOfBlock(cell).find((r) => sim.people.view(r)!.age > 25)!;
  const target = sim.k.root('place', 'core:place');
  sim.k.contribute({ source: { layer: 'authored', origin: cause }, target: { slot: 'age', scope: { nodes: [resident] } }, mode: 'constrain', form: { f: 'rule', when: [{ path: '.', op: 'has-edge', arg: { edge: 'core:located-in', to: target } }], then: { f: 'const', value: 17 } } });
  expect(sim.people.view(resident)!.age).toBeGreaterThan(25);
  sim.k.addEdge({ type: 'core:located-in', from: resident, to: target, cause });
  expect(sim.k.value(resident, 'age')).toBe(17);
  expect(sim.people.view(resident)!.age).toBe(17);
});

test('R3-05: applied, ownOf and outstanding process states have independent nested ring records', () => {
  const sim = quietSim('R3-05');
  const cell = sim.w.districts[0]!.cellIds[0]!;
  sim.setState('city.events', (s) => (s as EventsState).ring.push({ id: cause, w: 0, cell, kind: 'theft', count: 1 }));
  sim.advance(1);
  sim.setState('city.events', (s) => { (s as EventsState).ring[0]!.count!++; });
  expect(sim.stateOf<EventsState>('city.events')!.ring[0]!.count, 'R3-05 semantic: process ring records are independent').toBe(2);
  const own = sim.k.evolution.ownOf<EventsState>(sim.defs.get('city.events')!)!;
  own.ring[0]!.count = 99;
  expect(sim.stateOf<EventsState>('city.events')!.ring[0]!.count).toBe(2);
});

test('R3-06: a queued contribution snapshots its nested form, selector and source', () => {
  const sim = quietSim('R3-06');
  const person = sim.k.root('person', 'core:person');
  const c = sim.k.contribute({ source: { layer: 'authored', origin: cause }, target: { slot: 'age', scope: { nodes: [person] } }, form: { f: 'const', value: 20 }, mode: 'constrain' });
  const queued = sim.k.pending.find((p) => p.change.c === 'contribution' && p.change.contribution.id === c.id)!.change;
  expect(queued.c).toBe('contribution');
  if (queued.c !== 'contribution' || c.form.f !== 'const') throw new Error('fixture');
  c.form.value = 99;
  c.target.slot = 'name';
  c.source.origin = 'changed';
  expect(queued.contribution.form, 'R3-06 semantic: contribution snapshot changed').toEqual({ f: 'const', value: 20 });
  expect(queued.contribution.target).toEqual({ slot: 'age', scope: { nodes: [person] } });
  expect(queued.contribution.source.origin).toBe(cause);
});

test('R3-03b: independent divergence pairs retain one global order through reload and eviction', () => {
  const sim = quietSim('R3-03b');
  const port = new ReplayPort(sim);
  port.submit(['mv', 'mv2'].map((key) => ({ t: 0, op: 'person' as const, key, slots: { alive: 'yes', affiliation: 'civilian', 'age-class': 'adult' } })));
  sim.advance(2);
  const [a, b] = [port.node('mv'), port.node('mv2')];
  const l2 = attachLayer2(sim, { port: new ScriptPort(), facts: { flag: {}, x: {} } });
  const npc = sim.k.root('npc', 'core:person');
  sim.k.addEdge({ type: 'core:located-in', from: npc, to: sim.w.city, cause });
  sim.k.pin({ node: npc, slot: 'age', value: 35, reason: 'authored', cause });
  const believe = (subject: Id, value: string) => {
    for (const old of sim.k.beliefs.activeOf(npc)) if (old.subject === subject && old.path === 'alive') sim.k.beliefs.drop(npc, old.id);
    sim.k.beliefs.set({ believer: npc, subject, path: 'alive', value, at: sim.k.now, confidence: 1, evidence: [subject], source: { by: 'inferred', rule: { name: 'test', version: 1 }, from: [subject] }, formed: sim.k.now, refreshed: sim.k.now, memorable: true });
  };
  believe(a!, 'no');
  const all = [a, b].map((subject) => ({ social: { divergence: { believer: 'npc', subject } }, is: ['large'] }));
  const pack = miniPack({}, { windows: [{ id: 'w', opens: 'yes', closes: { all } as never, onClose: 'withdraw' }] });
  expect(l2.installPack(pack)).toEqual([]);
  const sown = l2.sow(pack.id, MINI_ID);
  expect(sown.ok, JSON.stringify(sown)).toBe(true);
  const inst = l2.instance(sown.instance!)!;
  sim.k.settle();
  sim.advance(1);
  const time = sim.k.now;
  believe(a!, 'yes');
  believe(b!, 'no');
  const read = (subject: Id) => sim.reads.port().transitions('divergence', [npc, subject], time - 1, time);
  expect(read(a!)[1]!.ord, 'R3-03b semantic: independent divergence pairs follow write order').toBeLessThan(read(b!)[1]!.ord!);
  reevaluate(l2, inst, [{ time, reason: 'test', change: { c: 'reading', node: a, slot: 'alive', at: time, value: 'yes' } as never }]);
  expect(inst.st.latches).toEqual([]);
  const before = [read(a!), read(b!)];
  sim.k.persistence.save('D');
  sim.k.persistence.load('D');
  expect([read(a!), read(b!)]).toEqual(before);
  // The next entry after a reload must follow every previous pair's entries, even when one pair evicts old history.
  const last = Math.max(...before.flat().map((x) => x.ord ?? -1));
  for (let n = 0; n < 12; n++) { sim.advance(1); believe(a!, n % 2 ? 'yes' : 'no'); }
  const entries = sim.reads.port().transitions('divergence', [npc, a], time, sim.k.now).slice(1);
  expect(entries.every((x) => x.ord! > last)).toBe(true);
});

test('R3-07: tie transitions include the recovery at the history coverage floor', () => {
  const sim = quietSim('R3-07');
  const all = sim.w.districts[0]!.cellIds.flatMap((c) => sim.people.residentsOfBlock(c));
  let pair: [Id, Id] | undefined;
  for (const a of all) { const b = all.find((b) => b !== a && sim.ties.tie(a, b)?.tied === false); if (b) { pair = [a, b]; break; } }
  expect(pair).toBeDefined();
  for (let n = 0; n < 19; n++) {
    sim.advance(1);
    const e = sim.tiePolicy.materialise(...pair!)!;
    sim.advance(1);
    sim.k.endEdge(e.id, sim.k.now);
  }
  const floor = sim.tiePolicy.coverageFloor(...pair!)!;
  expect(floor).toBeGreaterThan(0);
  const args = [...pair!, 'xf:tie'];
  expect(sim.reads.eval('tied', args, floor - 1)).toBe('maybe');
  expect(sim.reads.eval('tied', args, floor)).toBe('no');
  expect(sim.reads.transitions('tied', args, floor - 1, floor), 'R3-07 semantic: recovery boundary is published').toEqual([{ t: floor - 1, value: 'maybe' }, { t: floor, value: 'no' }]);
});

test('R3-03c: feed order is persistent through eviction and quiet windows, and aliases share an ordinal', () => {
  const sim = quietSim('R3-03c');
  // Published entries already carry the ordinal assigned by the application hook.
  const one = pushTransitions(undefined, 0, [{ key: 'x', t: 600, value: 'one', prev: 'zero', ord: 9 }], 2);
  const two = pushTransitions(one, 1, [{ key: 'x', t: 1200, value: 'two', prev: 'one', ord: 12 }], 2);
  const before = feedTransitions(sim, two, 'x', 'two', 1199, 1200)[1]!;
  const three = pushTransitions(two, 2, [], 2);
  expect(feedTransitions(sim, three, 'x', 'two', 1199, 1200)[1], 'R3-03c semantic: eviction cannot renumber a transition').toEqual(before);
  const quiet = pushTransitions(three, 3, [], 2);
  const later = pushTransitions(quiet, 4, [{ key: 'x', t: 3000, value: 'three', prev: 'two', ord: 23 }], 2);
  expect(feedTransitions(sim, later, 'x', 'three', 2999, 3000)[1]!.ord).toBeGreaterThan(before.ord!);
});

test('R3-03d: independent tie boundaries retain write order, and discarded staged edges leave no log', () => {
  const sim = quietSim('R3-03d');
  const residents = sim.w.districts[0]!.cellIds.flatMap((c) => sim.people.residentsOfBlock(c));
  const pairs: Array<[Id, Id]> = [];
  for (const a of residents) {
    const b = residents.find((b) => b !== a && sim.ties.tie(a, b)?.tied === false && !pairs.some((p) => p.includes(a) || p.includes(b)));
    if (b) pairs.push([a, b]);
    if (pairs.length === 2) break;
  }
  expect(pairs.length).toBe(2);
  sim.advance(1);
  const first = sim.tiePolicy.materialise(...pairs[0]!)!;
  sim.advance(1);
  const time = sim.k.now;
  sim.k.endEdge(first.id, time);
  sim.tiePolicy.materialise(...pairs[1]!);
  const read = (p: [Id, Id]) => sim.reads.port().transitions('tied', [...p, 'xf:tie'], time - 1, time);
  expect(read(pairs[0]!)[1]!.ord, 'R3-03d semantic: independent ties follow write order').toBeLessThan(read(pairs[1]!)[1]!.ord!);
  const before = structuredClone(sim.record.tieLog);
  const sequence = sim.record.ord;
  const batch = sim.k.stage();
  batch.write((k) => k.addEdge({ type: 'xf:tie', from: residents[10]!, to: residents[11]!, cause }));
  batch.discard();
  expect(sim.record.tieLog).toEqual(before);
  expect(sim.record.ord).toBe(sequence);
  const orders = pairs.map(read);
  sim.k.persistence.save('ties');
  sim.k.persistence.load('ties');
  sim.people.residentsOfBlock(sim.w.districts[0]!.cellIds[0]!);
  expect(pairs.map(read)).toEqual(orders);
});

test('R3-03e: one mirrored reading changes all affected divergence pairs atomically', () => {
  const sim = quietSim('R3-03e');
  const subject = sim.k.mirrored('subject', 'xf:person');
  sim.k.reading(subject, 'alive', 'yes');
  const [a, b] = sim.people.residentsOfBlock(sim.w.districts[0]!.cellIds[0]!).slice(0, 2) as [Id, Id];
  for (const [believer, value] of [[a, 'no'], [b, 'yes']] as const) sim.k.beliefs.set({ believer, subject, path: 'alive', value, at: 0, confidence: 1, evidence: [subject], source: { by: 'inferred', rule: { name: 'test', version: 1 }, from: [subject] }, formed: 0, refreshed: 0, memorable: true });
  sim.advance(1);
  const at = sim.k.now;
  sim.k.reading(subject, 'alive', 'no');
  sim.divergence.noteReading(subject, 'alive');
  const logs = [a, b].map((who) => sim.reads.port().transitions('divergence', [who, subject], at - 1, at));
  expect(logs.map((log) => log[1]!.value)).toEqual(['none', 'large']);
  expect(logs[0]![1]!.ord, 'R3-03e semantic: aliases of a reading share one ordinal').toBe(logs[1]![1]!.ord!);
});
