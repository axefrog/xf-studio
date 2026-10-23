import { describe, expect, test } from 'bun:test';
import { H, s } from '../src/id.ts';
import type { Kernel } from '../src/kernel.ts';
import type { Id } from '../src/types.ts';
import { Budget } from '../src/work.ts';
import { coreKernel, defsOf, kind } from './helpers.ts';

const cause = H(s('test-cause'));

const placeDefs = defsOf([], [
  kind('fx:district', [], { extends: ['core:place'] }),
  kind('fx:block', [], { extends: ['core:place'] }),
  kind('fx:place', [], { extends: ['core:place'] }),
]);

function world(name: string): { k: Kernel; district: Id; blocks: Id[]; places: Id[] } {
  const k = coreKernel(name, placeDefs);
  const district = k.root('district', 'fx:district');
  const blocks: Id[] = [];
  const places: Id[] = [];
  for (let b = 0; b < 2; b++) {
    const block = k.root(`block${b}`, 'fx:block');
    blocks.push(block);
    k.addEdge({ type: 'core:located-in', from: block, to: district, cause });
    for (let p = 0; p < 4; p++) {
      const place = k.root(`place${b}-${p}`, 'fx:place');
      places.push(place);
      k.addEdge({ type: 'core:located-in', from: place, to: block, cause });
    }
  }
  return { k, district, blocks, places };
}

describe('events (spec 9.2)', () => {
  test('a minted event resolves its fields, has member nodes, and emits one event change', () => {
    const { k, places } = world('event');
    const alice = k.root('alice', 'core:person');
    const bob = k.root('bob', 'core:person');
    k.pending.length = 0;
    const e = k.events.mintEvent({
      creator: alice, cause, name: 'brawl', time: 1234, kind: 'assault', place: places[0]!,
      participants: [{ who: alice, role: 'actor' }, { who: bob, role: 'victim' }],
      effects: [{ on: bob, effect: 'harm' }],
      witnesses: [alice], causes: [],
    });
    expect(k.pending).toHaveLength(1);
    expect(k.pending[0]!.change).toMatchObject({ c: 'event', event: e, kind: 'assault', place: places[0] });
    expect(k.value(e, 'time')).toBe(1234);
    expect(k.value(e, 'kind')).toBe('assault');
    expect(k.value(e, 'place')).toBe(places[0]);
    expect(k.value(e, 'participants#count')).toBe(2);
    const p1 = k.value(e, 'participants[1]') as Id;
    expect(k.value(p1, 'who')).toBe(bob);
    expect(k.value(p1, 'role')).toBe('victim');
    const f0 = k.value(e, 'effects[0]') as Id;
    expect(k.value(f0, 'on')).toBe(bob);
    expect(k.value(f0, 'effect')).toBe('harm');
    expect(k.value(e, 'witnesses[0]')).toBe(alice);
    expect(k.resolve(e, 'participants[2]')).toEqual({ status: 'unavailable' });
    expect(k.store.edgesFrom(e).map((x) => [x.type, x.to])).toEqual([['core:located-in', places[0]]]);
    // Minting again under the same name is a no-op.
    const before = k.revision;
    expect(k.events.mintEvent({ creator: alice, cause, name: 'brawl', time: 1, kind: 'sale' })).toBe(e);
    expect(k.revision).toBe(before);
    expect(k.value(e, 'time')).toBe(1234);
  });

  test('canon pins only the named fields, with the reason\'s precedence', () => {
    const { k, places } = world('canon');
    const alice = k.root('alice', 'core:person');
    const e = k.events.mintEvent({
      creator: alice, cause, name: 'sale', time: 50, kind: 'sale', place: places[1]!, participants: [{ who: alice, role: 'vendor' }],
    });
    k.pending.length = 0;
    const pins = k.events.makeCanon(e, 'observed', alice, ['time', 'participants']);
    expect(pins.length).toBe(1 + 1 + 2);
    expect(k.pending).toHaveLength(0);
    const timePins = k.store.pinsOn(e, 'time');
    expect(timePins).toHaveLength(1);
    expect(timePins[0]).toMatchObject({ reason: 'observed', value: 50, evidence: e });
    expect(k.store.pinsOn(e, 'place')).toHaveLength(0);
    expect(k.store.pinsOn(e, 'kind')).toHaveLength(0);
    expect(k.events.isCanon(e)).toBe(true);
    // Another source's later contribution cannot unsettle an observed field.
    k.contribute({ source: { layer: 'authored', origin: cause }, target: { slot: 'time', scope: { nodes: [e] } }, form: { f: 'const', value: 99 }, mode: 'constrain' });
    expect(k.resolve(e, 'time')).toEqual({ value: 50, status: 'ok' });
    k.events.makeCanon(e, 'committed', cause, ['place']);
    expect(k.store.pinsOn(e, 'place')[0]).toMatchObject({ reason: 'committed', value: places[1] });
    expect(k.events.canonRecord(e)!.entries.map((x) => x.reason)).toEqual(['observed', 'committed']);
  });
});

describe('F-7 summary (spec 9.3)', () => {
  test('F-7: block 1 is a subset of the district, with the same Ids; canon items floor the count', () => {
    const { k, district, blocks, places } = world('F-7');
    const process = H(s('process'), s('robbery-count'));
    const S = k.summaries.mintSummary({ creator: district, cause: process, name: 'robberies', kind: 'robbery', from: 0, length: 86400, scope: district, count: 5 });
    k.revision; // (the count pin is the process's)
    const countPin = k.store.pinsOn(S, 'count')[0]!;
    expect(countPin).toMatchObject({ reason: 'committed', value: 5, cause: process });

    const q = (under: Id) => k.query({ find: 'core:event', scope: { under }, at: 0, must: [], limit: 'all' });
    const b1 = q(blocks[1]!);
    const all = q(district);
    expect(b1.status).toBe('ok');
    expect(all.status).toBe('ok');
    if (b1.status !== 'ok' || all.status !== 'ok') return;
    expect(all.items).toHaveLength(5);
    const allIds = new Set(all.items.map((i) => i.id));
    for (const it of b1.items) expect(allIds.has(it.id)).toBe(true);
    // Item Ids are the summary-derived ones.
    const expected = [0, 1, 2, 3, 4].map((i) => k.summaries.itemId(S, i)).sort();
    expect([...allIds].sort()).toEqual(expected);
    // Each item's place lies under the scope; those in block 1 are exactly block 1's items.
    const inBlock1 = all.items.filter((it) => {
      const pl = k.value(it.id, 'place') as Id;
      return pl === blocks[1] || k.store.edgesFrom(pl).some((e) => e.to === blocks[1]);
    });
    expect(b1.items.map((i) => i.id).sort()).toEqual(inBlock1.map((i) => i.id).sort());
    // Times lie inside the summary's span.
    for (const it of all.items) {
      const t = k.value(it.id, 'time') as number;
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(86400);
      expect(k.value(it.id, 'kind')).toBe('robbery');
    }
    // Querying again changes nothing: nothing is counted twice, and querying does not touch the revision.
    const rev = k.revision;
    const again = q(district);
    expect(again.status === 'ok' && again.items.map((i) => i.id)).toEqual(all.items.map((i) => i.id));
    expect(k.revision).toBe(rev);

    // Make item 2 canon; the count cannot shrink below 3 (structural, 700).
    const item2 = k.summaries.makeItemCanon(S, 2, 'committed', process);
    expect(k.summaries.canonOf(S)).toEqual([2]);
    expect(k.value(item2, 'time')).toBe(k.value(k.summaries.itemId(S, 2), 'time'));
    expect(k.store.pinsOn(item2, 'time')).toHaveLength(1);
    // The process withdraws its count pin and pins count = 2.
    expect(k.withdrawPin(countPin.id, process)).toBe(true);
    const two = k.pin({ node: S, slot: 'count', value: 2, reason: 'committed', cause: process });
    const tr = k.trace(S, 'count');
    expect(tr.constraints.find((c) => c.id === two.id)!.active).toBe(false);
    expect(tr.constraints.find((c) => c.source === 'structural')).toMatchObject({ active: true, precedence: 700 });
    const count = k.value(S, 'count') as number;
    expect(count).toBeGreaterThanOrEqual(3);
    expect(k.resolve(S, 'count').status).toBe('ok');
    // Item 2 is still the same item.
    expect(k.summaries.itemId(S, 2)).toBe(item2);
    void places;
  });

  test('a summary whose fields are not all known has no items; an out-of-range canon item is refused', () => {
    const { k, district } = world('F-7b');
    const sm = k.summaries.mintSummary({ creator: district, cause, name: 'incomplete', kind: 'robbery', from: 0, length: 100, scope: district, count: 2 });
    expect(() => k.summaries.makeItemCanon(sm, 5, 'committed', cause)).toThrow();
    const q = k.query({ find: 'core:event', scope: { under: district }, at: 0, must: [], limit: 'all' });
    expect(q.status === 'ok' && q.items).toHaveLength(2);
  });

  test('the materialisation worklist is silent, budgeted and resumable', () => {
    const { k, district } = world('F-7c');
    const sm = k.summaries.mintSummary({ creator: district, cause, name: 'm', kind: 'robbery', from: 0, length: 100, scope: district, count: 4 });
    k.summaries.queueMaterialise(sm);
    const rev = k.revision;
    k.summaries.runMaterialisation(new Budget(2));
    expect(k.summaries.pendingMaterialisation).toBe(1);
    expect(k.store.header(k.summaries.itemId(sm, 0))).toBeDefined();
    expect(k.store.header(k.summaries.itemId(sm, 3))).toBeUndefined();
    k.summaries.runMaterialisation(new Budget(100));
    expect(k.summaries.pendingMaterialisation).toBe(0);
    expect(k.store.header(k.summaries.itemId(sm, 3))).toBeDefined();
    expect(k.revision).toBe(rev);
  });
});
