// The kernel facilities the fixes of the independent review of the simulation layer rest on: a silent restoration of an event (SIM-02), the
// spans a summary's query shortcut keeps (SIM-06) and an ended edge opened again under its own Id (SIM-07). Each test fails without its fix.

import { describe, expect, test } from 'bun:test';
import { H, s } from '../src/id.ts';
import type { Id } from '../src/types.ts';
import { coreKernel } from './helpers.ts';

const cause = H(s('test-cause'));

describe('SIM-02: restoring an event announces nothing', () => {
  function forgotten(name: string) {
    const k = coreKernel(name);
    const place = k.root('place', 'core:place');
    const alice = k.root('alice', 'core:person');
    k.pin({ node: alice, slot: 'age', value: 30, reason: 'authored', cause });
    const spec = { creator: alice, cause, name: 'e', time: 77, kind: 'sale', place, participants: [{ who: alice, role: 'vendor' }] };
    const e = k.events.mintEvent(spec);
    const member = k.address(e, 'participants[0]');
    const snapshot = () => [k.value(e, 'time'), k.value(e, 'kind'), k.value(e, 'place'), k.value(member, 'who'), k.value(member, 'role')];
    const before = snapshot();
    k.retention.scheduleSweep();
    k.settle();
    return { k, e, spec, snapshot, before, alice };
  }

  test('an event whose header the sweep dropped comes back under its Id with its fields, and no change is emitted', () => {
    const { k, e, spec, snapshot, before } = forgotten('R1-02a');
    expect(k.store.header(e)).toBeUndefined();
    const announced = k.pending.length;
    expect(k.events.restoreEvent(spec)).toBe(e);
    expect(k.pending.length).toBe(announced);
    expect(snapshot()).toEqual(before);
    // restoring it again does nothing
    const contributions = k.store.contributionsOrigin(e).length;
    k.events.restoreEvent(spec);
    expect(k.store.contributionsOrigin(e).length).toBe(contributions);
  });

  test('minting the same event again is a new occurrence and is announced: only a restoration is silent', () => {
    const { k, e, spec } = forgotten('R1-02b');
    const announced = k.pending.length;
    expect(k.events.mintEvent(spec)).toBe(e);
    expect(k.pending.length).toBe(announced + 1);
  });

  test('a restoration at the load of a save that kept the header only is silent too', () => {
    const k = coreKernel('R1-02c');
    const place = k.root('place', 'core:place');
    const alice = k.root('alice', 'core:person');
    k.pin({ node: alice, slot: 'age', value: 30, reason: 'authored', cause });
    const spec = { creator: alice, cause, name: 'e', time: 77, kind: 'sale', place, participants: [{ who: alice, role: 'vendor' }] };
    const e = k.events.mintEvent(spec);
    k.beliefs.set({ believer: alice, subject: alice, path: 'did.sell', value: 'x', confidence: 1, evidence: [e], source: { by: 'observed', event: e }, formed: 0, refreshed: 0, memorable: true });
    k.persistence.save('A');
    k.persistence.load('A');
    const announced = k.pending.length;
    expect(k.events.restoreEvent(spec)).toBe(e);
    expect(k.value(e, 'kind')).toBe('sale');
    expect(k.pending.length).toBe(announced);
  });
});

describe('SIM-06: the span a query shortcut keeps holds at the time it was resolved', () => {
  function world(name: string) {
    const k = coreKernel(name);
    const place = k.root('place', 'core:place');
    const S = k.summaries.mintSummary({ creator: place, cause, name: 's', kind: 'assault', from: 0, length: 600, scope: place, count: 1 });
    const assault = (at: number): Id[] => {
      const out = k.query({ find: 'core:event', scope: { under: place }, at, must: [{ path: 'kind', op: 'eq', arg: 'assault' }, { path: 'time', op: 'range', arg: [0, 1200] }], limit: 'all' });
      return out.status === 'ok' ? out.items.map((x) => x.id) : [];
    };
    return { k, place, S, assault };
  }

  test('a summary constrained to be a sale for a window is not an assault inside it and is one after it, whatever was asked first', () => {
    for (const order of [[100, 600], [600, 100]]) {
      const { k, S, assault } = world(`R1-06-${order.join('-')}`);
      k.contribute({ source: { layer: 'authored', origin: cause }, target: { slot: 'kind', scope: { nodes: [S] } }, form: { f: 'const', value: 'sale' }, mode: 'constrain', valid: { from: 0, to: 600 } });
      expect(k.value(S, 'kind', 100)).toBe('sale');
      expect(k.value(S, 'kind', 600)).toBe('assault');
      const answers = new Map<number, Id[]>();
      for (const at of order) answers.set(at, assault(at));
      expect(answers.get(100), `at 100 after ${order[0]}`).toEqual([]);
      expect(answers.get(600)!.length, `at 600 after ${order[0]}`).toBe(1);
    }
  });

  test('a window of a named contribution moves the answer without moving the stamp the cache is checked by', () => {
    const { k, S, assault } = world('R1-06c');
    k.contribute({ source: { layer: 'authored', origin: cause }, target: { slot: 'kind', scope: { nodes: [S] } }, form: { f: 'const', value: 'sale' }, mode: 'constrain', valid: { from: 0, to: 600 } });
    const stamp = k.store.localState(S);
    expect(assault(100)).toEqual([]);
    expect(k.store.localState(S)).toBe(stamp);
    expect(assault(600).length).toBe(1);
    expect(assault(100)).toEqual([]);
  });
});

describe('SIM-07: an ended edge opens again under its own Id', () => {
  test('reopenEdge makes the edge live from the time given, keeps its Id, and announces it; the kernel refuses a live edge', () => {
    const k = coreKernel('R1-07');
    const city = k.root('city', 'core:place');
    const a = k.root('a', 'core:place');
    const edge = k.addEdge({ type: 'core:located-in', from: a, to: city, cause, valid: { from: 5 } });
    expect(() => k.reopenEdge(edge.id, 20)).toThrow('not ended');
    k.endEdge(edge.id, 10);
    expect(edge.valid).toEqual({ from: 5, to: 10 });
    // addEdge returns the ended edge unchanged: a stable Id cannot be reused that way
    expect(k.addEdge({ id: edge.id, type: 'core:located-in', from: a, to: city, cause, valid: { from: 30 } }).valid).toEqual({ from: 5, to: 10 });
    const announced = k.pending.length;
    const again = k.reopenEdge(edge.id, 30);
    expect(again.id).toBe(edge.id);
    expect(again.valid).toEqual({ from: 30 });
    expect(k.pending.length).toBe(announced + 1);
    expect(k.store.edgesFrom(a).filter((e) => e.valid.to === undefined)).toHaveLength(1);
  });

  test('a reopened edge survives a save and a load as a live edge', () => {
    const k = coreKernel('R1-07b');
    const city = k.root('city', 'core:place');
    const a = k.root('a', 'core:place');
    const edge = k.addEdge({ type: 'core:located-in', from: a, to: city, cause, valid: { from: 5 } });
    k.persistence.save('A');
    k.endEdge(edge.id, 10);
    k.reopenEdge(edge.id, 30);
    k.persistence.save('B');
    k.persistence.load('B');
    expect(k.store.edges.get(edge.id)?.valid).toEqual({ from: 30 });
  });
});
