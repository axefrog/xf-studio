import { describe, expect, test } from 'bun:test';
import { H, s } from '../src/id.ts';
import type { Id } from '../src/types.ts';
import { Budget } from '../src/work.ts';
import { coreKernel, defsOf, dim, kind, slot } from './helpers.ts';

const cause = H(s('test-cause'));
const fid = (name: string): Id => H(s('origin'), s(name));

const crowdDefs = defsOf(
  [dim('fx:cnt', { t: 'int', min: 0, max: 30 }), dim('fx:member', { t: 'node', kind: 'core:trait' })],
  [kind('fx:crowd', [slot('members', 'fx:member', { card: { many: { count: 'fx:cnt' } } })], { extends: ['core:thing'] })],
);

describe('F-14 retained member (spec 6.5)', () => {
  function crowd(name: string) {
    const k = coreKernel(name, crowdDefs);
    const c = k.root('crowd', 'fx:crowd');
    const v = k.root('v', 'core:person');
    k.frames.demandRoots.add(v);
    k.pin({ node: c, slot: 'members#count', value: 12, reason: 'committed', cause });
    const m9 = k.address(c, 'members[9]');
    const frame = k.frames.open({ actor: v, level: 'situation', origin: fid('look'), weight: 1, focus: { nodes: [m9], tier: 3 }, cause });
    k.contribute({ source: { layer: 'authored', origin: cause }, target: { slot: 'members#count', scope: { nodes: [c] } }, form: { f: 'const', value: 6 }, mode: 'constrain' });
    return { k, c, v, m9, frame };
  }

  test('F-14: the structural constraint rejects 6; the count is 10 or more and member 9 stays addressable', () => {
    const { k, c, m9 } = crowd('F-14');
    expect(k.retention.isRetained(m9)).toBe(true);
    expect(k.retention.maxRetainedMember(c, 'members')).toBe(9);
    const tr = k.trace(c, 'members#count');
    expect(tr.constraints.find((x) => x.source === 'structural')).toMatchObject({ active: true, precedence: 700 });
    const authored = tr.constraints.find((x) => x.label === 'authored')!;
    expect(authored.active).toBe(false);
    const count = k.value(c, 'members#count') as number;
    expect(count).toBeGreaterThanOrEqual(10);
    expect(count).toBe(12);
    expect(tr.status).toBe('ok');
    expect(k.resolve(c, 'members[9]')).toEqual({ value: m9, status: 'ok' });
  });

  test('the constraint lapses when nothing retains the member any more', () => {
    const { k, c, frame } = crowd('F-14b');
    expect(k.value(c, 'members#count')).toBe(12);
    k.frames.setStatus(frame.id, 'satisfied', cause);
    expect(k.retention.maxRetainedMember(c, 'members')).toBeUndefined();
    expect(k.value(c, 'members#count')).toBe(6);
    expect(k.resolve(c, 'members[9]')).toEqual({ status: 'unavailable' });
  });

  test('a retained member below the pinned count does not interfere', () => {
    const { k, c } = crowd('F-14c');
    const lower = k.address(c, 'members[2]');
    expect(k.retention.isRetained(lower)).toBe(false);
    expect(k.value(c, 'members#count')).toBe(12);
  });
});

describe('open and close (spec 7.1, 7.2)', () => {
  test('open materialises an open slot; a many slot resolves its count first; members come lazily', () => {
    const k = coreKernel('open');
    const p = k.root('p', 'core:person');
    k.open(p, 'age');
    expect(k.store.nodes.get(p)!.slots.get('age')).toEqual({ s: 'open' });
    k.open(p, 'traits');
    const count = k.store.nodes.get(p)!.slots.get('traits#count')!;
    expect(count.s).toBe('resolved');
    expect(k.store.nodes.get(p)!.slots.get('traits')).toEqual({ s: 'open' });
    expect(k.store.ownedOf(p)).toEqual([]);
    k.resolve(p, 'traits[0]');
    expect(k.store.ownedOf(p).length === 1 || (count.s === 'resolved' && count.value === 0)).toBe(true);
    expect(() => k.open(p, 'nope')).toThrow();
    k.value(p, 'age');
    k.open(p, 'age');
    expect(k.store.nodes.get(p)!.slots.get('age')!.s).toBe('resolved');
  });

  test('close drops the caches of the node and its unretained owned values; pins, edges and headers stay', () => {
    const k = coreKernel('close');
    const p = k.root('p', 'core:person');
    const name = k.address(p, 'name');
    k.pin({ node: p, slot: 'age', value: 30, reason: 'authored', cause });
    k.value(p, 'age');
    k.value(name, 'given');
    expect(k.store.nodes.has(p) && k.store.nodes.has(name)).toBe(true);
    k.close(p);
    expect(k.store.nodes.has(p)).toBe(false);
    expect(k.store.nodes.has(name)).toBe(true); // the pin on p retains its owned values
    expect(k.store.pinsOn(p, 'age')).toHaveLength(1);
    expect(k.store.header(name)).toBeDefined();
    expect(k.value(p, 'age')).toBe(30);
    const q = k.root('q', 'core:person');
    const qname = k.address(q, 'name');
    k.value(qname, 'given');
    k.value(q, 'age');
    k.close(q);
    expect(k.store.nodes.has(q) || k.store.nodes.has(qname)).toBe(false);
  });
});

describe('roots, marks and forgetting (spec 7.3, I-3)', () => {
  test('pins in effect, live edges and observed pins retain; history does not', () => {
    const k = coreKernel('marks');
    const a = k.root('a', 'core:person');
    const b = k.root('b', 'core:person');
    const c = k.root('c', 'core:person');
    const d = k.root('d', 'core:person');
    const e = k.root('e', 'core:place');
    k.pin({ node: a, slot: 'age', value: 30, reason: 'authored', cause });
    k.addEdge({ type: 'core:knows', from: b, to: c, cause });
    const ended = k.addEdge({ type: 'core:located-in', from: d, to: e, cause });
    k.endEdge(ended.id, 5);
    k.now = 10;
    const marked = k.retention.marked();
    expect(marked.has(a)).toBe(true);
    expect(marked.has(b)).toBe(true);
    expect(marked.has(c)).toBe(true);
    expect(marked.has(d)).toBe(false);
    expect(marked.has(e)).toBe(false);
    // A withdrawn pin is history, not a root.
    const w = H(s('w'));
    const p = k.pin({ node: d, slot: 'age', value: 20, reason: 'committed', cause: w });
    expect(k.retention.marked().has(d)).toBe(true);
    k.withdrawPin(p.id, w);
    expect(k.retention.marked().has(d)).toBe(false);
  });

  test('marking follows owner chains, creators and owned values both ways', () => {
    const k = coreKernel('chains');
    const p = k.root('p', 'core:person');
    const name = k.address(p, 'name');
    const trait = k.address(p, 'traits[1]');
    k.pin({ node: name, slot: 'given', value: 'Alex', reason: 'authored', cause });
    k.pin({ node: trait, slot: 'trait', value: 'kind', reason: 'authored', cause });
    const marked = k.retention.marked();
    expect(marked.has(name)).toBe(true);
    expect(marked.has(p)).toBe(true); // up the owner chain
    expect(marked.has(trait)).toBe(true);
    const other = k.root('o', 'core:person');
    const oname = k.address(other, 'name');
    expect(k.retention.marked().has(oname)).toBe(false);
    k.pin({ node: other, slot: 'age', value: 22, reason: 'authored', cause });
    expect(k.retention.marked().has(oname)).toBe(true); // down to the owned value
  });

  test('I-3: a swept node regenerates identically', () => {
    const k = coreKernel('I-3');
    const nodes = Array.from({ length: 30 }, (_, n) => k.root(`p${n}`, 'core:person'));
    const read = () => nodes.map((n) => [k.value(n, 'age'), k.value(n, 'place'), k.value(k.address(n, 'name'), 'given')]);
    const before = read();
    expect(k.store.nodes.size).toBeGreaterThan(30);
    expect(k.retention.scheduleSweep()).toBeGreaterThan(0);
    k.settle();
    expect(k.store.nodes.size).toBe(0);
    expect(read()).toEqual(before);
  });

  test('a minted non-canon event is forgotten with the records it owns; re-minting regenerates it identically', () => {
    const k = coreKernel('events');
    const place = k.root('place', 'core:place');
    const alice = k.root('alice', 'core:person');
    k.pin({ node: alice, slot: 'age', value: 30, reason: 'authored', cause });
    const spec = { creator: alice, cause, name: 'e', time: 77, kind: 'sale', place, participants: [{ who: alice, role: 'vendor' }] };
    const e = k.events.mintEvent(spec);
    const member = k.address(e, 'participants[0]');
    const snapshot = () => [k.value(e, 'time'), k.value(e, 'kind'), k.value(e, 'place'), k.value(member, 'who'), k.value(member, 'role')];
    const before = snapshot();
    expect(k.retention.isRetained(e)).toBe(false);
    k.retention.scheduleSweep();
    k.settle();
    expect(k.store.header(e)).toBeUndefined();
    expect(k.store.header(member)).toBeUndefined();
    expect(k.store.contributionsOrigin(e)).toHaveLength(0);
    expect(k.store.edgesFrom(e)).toHaveLength(0);
    expect(k.resolve(e, 'time')).toEqual({ status: 'unavailable' });
    expect(k.events.mintEvent(spec)).toBe(e);
    expect(snapshot()).toEqual(before);
  });

  test('an event kept as the evidence of a memorable belief is a bare header after a load; minting it again restates its fields, silently', () => {
    const k = coreKernel('restate');
    const place = k.root('place', 'core:place');
    const alice = k.root('alice', 'core:person');
    k.pin({ node: alice, slot: 'age', value: 30, reason: 'authored', cause });
    const spec = { creator: alice, cause, name: 'e', time: 77, kind: 'sale', place, participants: [{ who: alice, role: 'vendor' }] };
    const e = k.events.mintEvent(spec);
    k.beliefs.set({ believer: alice, subject: alice, path: 'did.sell', value: 'x', confidence: 1, evidence: [e], source: { by: 'observed', event: e }, formed: 0, refreshed: 0, memorable: true });
    k.persistence.save('A');
    k.persistence.load('A');
    expect(k.store.header(e)).toBeDefined();
    expect(k.value(e, 'kind')).toBeUndefined();
    const announced = k.pending.length;
    expect(k.events.mintEvent(spec)).toBe(e);
    expect(k.value(e, 'time')).toBe(77);
    expect(k.value(e, 'kind')).toBe('sale');
    expect(k.value(e, 'place')).toBe(place);
    expect(k.value(k.address(e, 'participants[0]'), 'who')).toBe(alice);
    expect(k.pending.length).toBe(announced);
    // and once restated, a third mint does nothing
    const contributions = k.store.contributionsOrigin(e).length;
    k.events.mintEvent(spec);
    expect(k.store.contributionsOrigin(e).length).toBe(contributions);
  });

  test('a canon event survives the sweep, and its pinned fields still resolve', () => {
    const k = coreKernel('canon');
    const place = k.root('place', 'core:place');
    const alice = k.root('alice', 'core:person');
    const e = k.events.mintEvent({ creator: alice, cause, name: 'e', time: 77, kind: 'sale', place, participants: [{ who: alice, role: 'vendor' }] });
    k.events.makeCanon(e, 'observed', alice, ['time', 'kind', 'participants']);
    expect(k.retention.isRetained(e)).toBe(true);
    k.retention.scheduleSweep();
    k.settle();
    expect(k.store.header(e)).toBeDefined();
    expect(k.value(e, 'time')).toBe(77);
    expect(k.value(e, 'kind')).toBe('sale');
    const member = k.address(e, 'participants[0]');
    expect(k.value(member, 'who')).toBe(alice);
    expect(k.retention.isRetained(alice)).toBe(true); // the participant is an Id field of a retained pin
  });

  test('canon items of a summary retain the item and the summary', () => {
    const k = coreKernel('summary');
    const city = k.root('city', 'core:place');
    for (let n = 0; n < 3; n++) k.addEdge({ type: 'core:located-in', from: k.root(`pl${n}`, 'core:place'), to: city, cause });
    const S = k.summaries.mintSummary({ creator: city, cause, name: 's', kind: 'robbery', from: 0, length: 1000, scope: city, count: 4 });
    const item = k.summaries.makeItemCanon(S, 1, 'committed', cause);
    expect(k.retention.isRetained(item)).toBe(true);
    expect(k.retention.isRetained(S)).toBe(true);
    expect(k.retention.isRetained(k.summaries.itemId(S, 2))).toBe(false);
  });

  test('frames of demand roots and live seeds retain their focus; so do streamed-in mirrored nodes and memorable beliefs', () => {
    const k = coreKernel('frames');
    const v = k.root('v', 'core:person');
    const target = k.root('target', 'core:person');
    const far = k.root('far', 'core:person');
    const npc = k.mirrored('npc/9', 'core:person');
    const seedNode = k.root('seeded', 'core:person');
    k.frames.demandRoots.add(v);
    const f = k.frames.open({ actor: v, level: 'situation', origin: fid('f'), weight: 1, focus: { nodes: [target], tier: 3 }, cause });
    const child = k.frames.open({ actor: v, level: 'step', origin: fid('c'), weight: 1, parents: [{ frame: f.id, weight: 1 }], focus: { nodes: [far], tier: 3 }, cause });
    expect(k.retention.isRetained(target)).toBe(true);
    expect(k.retention.isRetained(far)).toBe(true);
    k.frames.setStatus(child.id, 'satisfied', cause);
    expect(k.retention.isRetained(far)).toBe(false);
    expect(k.retention.isRetained(npc)).toBe(false);
    k.retention.streamIn([npc]);
    expect(k.retention.isRetained(npc)).toBe(true);
    k.retention.streamOut([npc]);
    expect(k.retention.isRetained(npc)).toBe(false);
    k.retention.setSeed({ id: H(s('seed'), s('s1')), state: { phase: 1 }, nodes: [seedNode] });
    expect(k.retention.isRetained(seedNode)).toBe(true);
    k.retention.endSeed(H(s('seed'), s('s1')));
    expect(k.retention.isRetained(seedNode)).toBe(false);
    const ev = k.events.mintEvent({ creator: v, cause, name: 'e', time: 1, kind: 'sale' });
    const subject = k.root('subj', 'core:person');
    k.beliefs.set({ believer: target, subject, path: 'age', value: 40, confidence: 1, evidence: [ev], source: { by: 'observed', event: ev }, formed: 1, refreshed: 1, memorable: false });
    expect(k.retention.isRetained(subject)).toBe(false);
    k.beliefs.set({ believer: target, subject, path: 'age2', value: 40, confidence: 1, evidence: [ev], source: { by: 'observed', event: ev }, formed: 1, refreshed: 1, memorable: true });
    expect(k.retention.isRetained(subject)).toBe(true);
    expect(k.retention.isRetained(ev)).toBe(true);
  });

  test('forgetting is a budgeted, resumable worklist and does not bump the revision', () => {
    const k = coreKernel('worklist');
    for (let n = 0; n < 10; n++) k.value(k.root(`p${n}`, 'core:person'), 'age');
    const queued = k.retention.scheduleSweep();
    expect(queued).toBeGreaterThanOrEqual(10);
    const rev = k.revision;
    k.retention.runForgetting(new Budget(3));
    expect(k.retention.pendingForgetting).toBeGreaterThan(0);
    expect(k.retention.pendingForgetting).toBeLessThan(queued);
    k.retention.runForgetting(new Budget(1000));
    expect(k.retention.pendingForgetting).toBe(0);
    expect(k.store.nodes.size).toBe(0);
    expect(k.revision).toBe(rev);
    expect(k.pending).toHaveLength(0);
  });

  test('I-11: moving a node changes its edges, never its Id or pins', () => {
    const k = coreKernel('I-11');
    const p = k.root('p', 'core:person');
    const a = k.root('a', 'core:place');
    const b = k.root('b', 'core:place');
    k.pin({ node: p, slot: 'age', value: 44, reason: 'observed', cause });
    const e1 = k.addEdge({ type: 'core:located-in', from: p, to: a, cause });
    k.endEdge(e1.id, 10);
    k.addEdge({ type: 'core:located-in', from: p, to: b, valid: { from: 10 }, cause });
    expect(k.store.header(p)!.id).toBe(p);
    expect(k.store.livePinsOn(p, 'age')).toHaveLength(1);
    expect(k.value(p, 'age')).toBe(44);
    const under = (container: Id, t: number) => {
      const o = k.query({ find: 'core:person', scope: { under: container }, at: t, must: [], limit: 'all' });
      return o.status === 'ok' ? o.items.map((i) => i.id) : [];
    };
    expect(under(a, 5)).toEqual([p]);
    expect(under(b, 5)).toEqual([]);
    expect(under(a, 15)).toEqual([]);
    expect(under(b, 15)).toEqual([p]);
  });
});
