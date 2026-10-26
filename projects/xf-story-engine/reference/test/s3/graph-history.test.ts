import { expect, test } from 'bun:test';
import { GraphHistory } from '../../src/procedural/graph-history.ts';
import { eventFacts } from '../../src/seeding/eval.ts';
import { graphWorld, simple, emit } from './graph-fixture.ts';
import { event } from './helpers.ts';
import { H, s } from '../../src/id.ts';

for (const canon of [false, true]) test(`receipt history follows clock-driven cited fact changes (${canon ? 'canon' : 'non-canon'}) and reload`, () => {
  const w = graphWorld('receipt-boundary-' + canon), index = new GraphHistory(w.l3), cause = H(s('receipt-boundary'));
  const e = event(w, 'cited', 'generic', 1, { participants: [{ who: w.a, role: 'actor' }] });
  w.k.retention.setSeed({ id: cause, state: {}, nodes: [e.id] });
  if (canon) w.k.events.makeCanon(e.id, 'committed', cause, []);
  for (const [node, slot, value] of [[e.id, 'time', 20], [w.k.address(e.id, 'participants[0]'), 'who', w.b]] as const)
    w.k.contribute({ source: { layer: 'observation', origin: cause }, target: { slot, scope: { nodes: [node] } },
      form: { f: 'const', value }, mode: 'constrain', valid: { from: 10 } });
  w.l2.global.receipts.push({ delivery: cause, seed: cause, template: 'boundary', grade: 'presented', channels: ['message'], cites: [e.id], cue: {}, at: 5, playTotal: 1 });
  w.k.now = 5; index.refresh();
  expect(index.knownTimes.get(w.a)).toBe(5);
  const version = index.version;
  w.k.now = 20; index.refresh();
  expect(eventFacts(w.l2, e.id)).toMatchObject({ time: 20, participants: [{ who: w.b, role: 'actor' }] });
  expect(w.l2.exposedNodeAt(w.a, 'presented')).toBeUndefined();
  expect(index.knownTimes.get(w.a)).toBeUndefined();
  expect(index.knownTimes.get(w.b)).toBe(w.l2.exposedNodeAt(w.b, 'presented'));
  expect(index.version).toBeGreaterThan(version);
  const before = [...index.knownTimes].sort();
  w.l2.flush(); w.l3.flush(); w.k.persistence.save('receipt-boundary');
  index.refresh(); expect([...index.knownTimes].sort()).toEqual(before);
  w.k.persistence.load('receipt-boundary'); index.refresh();
  expect([...index.knownTimes].sort()).toEqual(before);
});

test('header-only summary items follow changes to their descriptor scope', () => {
  const w = graphWorld('summary-header'), index = new GraphHistory(w.l3);
  const summary = w.k.summaries.mintSummary({ creator: w.a, cause: w.a, name: 'header-only', kind: 'generic', from: 0, length: 1, scope: w.city, count: 1 });
  const item = w.k.summaries.materialise(summary, 0), other = w.k.root('other-place', 'core:place');
  expect(w.k.events.materialisationOf(item)).toBeUndefined();
  for (const field of ['participants', 'effects', 'witnesses', 'causes']) w.k.contribute({
    source: { layer: 'simulation', origin: item }, target: { slot: field + '#count', scope: { nodes: [item] } },
    form: { f: 'const', value: 0 }, mode: 'constrain' });
  expect(w.l3.kv.event(item)).toBeDefined();
  w.k.events.makeCanon(item, 'committed', w.a, []);
  w.l2.global.receipts.push({ delivery: item, seed: item, template: 'summary', grade: 'presented', channels: ['message'], cites: [item], cue: {}, at: 5, playTotal: 1 });
  index.refresh();
  expect(index.knownTimes.get(w.city)).toBe(5);
  // Isolate the canon-event row from @receipts: the observed item is presented independently.
  w.k.pin({ node: item, slot: 'kind', value: 'generic', reason: 'observed', cause: w.a, at: 5 });
  index.refresh();
  w.k.pin({ node: summary, slot: 'scope', value: other, reason: 'observed', cause: w.b });
  expect(eventFacts(w.l2, item)?.place).toBe(other);
  index.refresh();
  expect(w.l2.exposedNodeAt(w.city, 'presented')).toBeUndefined();
  expect(index.knownTimes.get(w.city)).toBeUndefined();
  expect(index.knownTimes.get(other)).toBe(w.l2.exposedNodeAt(other, 'presented'));
});

test('incremental graph history agrees with general reads after local edits, receipts, time, sweep and reload', () => {
  const w = graphWorld('history-edits'), index = new GraphHistory(w.l3), cause = H(s('history-edit'));
  w.k.now = 100;
  const a = event(w, 'own', 'generic', 10, { participants: [{ who: w.v, role: 'actor' }, { who: w.a, role: 'target' }] });
  const b = event(w, 'heard', 'generic', 20);
  w.k.events.makeCanon(a.id, 'committed', cause);
  w.k.events.makeCanon(b.id, 'committed', cause);
  const check = () => {
    index.refresh();
    for (const node of [w.a, w.b, w.v, a.id, b.id]) {
      expect(index.knownTimes.get(node)).toBe(w.l2.exposedNodeAt(node, 'presented'));
      const times = w.k.events.canonEvents().flatMap((id) => {
        const ev = w.l3.kv.event(id);
        return ev && w.l3.sifter.graph.world.acts(ev, w.v) && (ev.place === node || ev.participants.some((p) => p.who === node) || ev.effects.some((e) => e.on === node)) ? [ev.time] : [];
      });
      expect(index.actTimes.get(node)).toBe(times.length ? Math.max(...times) : undefined);
    }
  };
  check(); check();
  expect(index.knownTimes.get(w.a)).toBe(10);
  const member = w.k.address(a.id, 'participants[1]');
  const pin = w.k.pin({ node: member, slot: 'who', value: w.b, reason: 'authored', cause });
  check();
  expect(index.knownTimes.get(w.a)).toBeUndefined();
  w.k.withdrawPin(pin.id, cause); check();
  w.l2.global.receipts.push({ delivery: cause, seed: cause, template: 'history', grade: 'presented', channels: ['message'], cites: [b.id], cue: { object: w.a }, at: 30, playTotal: 1 });
  check();
  const c = w.k.contribute({ source: { layer: 'observation', origin: cause }, target: { slot: 'who', scope: { nodes: [member] } }, form: { f: 'const', value: w.b }, mode: 'constrain', valid: { from: 150 } });
  check(); w.k.now = 160; check();
  w.k.endContribution(c.id, 170, true); w.k.now = 180; check();
  w.k.now = 155; check(); w.k.now = 180;
  const batch = w.k.stage();
  batch.write((k) => k.pin({ node: member, slot: 'who', value: w.b, reason: 'authored', cause }));
  check(); batch.discard(); check();
  const general = w.k.contribute({ source: { layer: 'observation', origin: cause }, target: { slot: 'who' }, form: { f: 'const', value: w.b }, mode: 'constrain' });
  check(); expect(index.actTimes.get(w.v)).toBeUndefined();
  w.k.endContribution(general.id, 181, true); w.k.now = 182; check();
  w.l3.flush(); w.k.persistence.save('history');
  w.k.retention.sweepNode(a.id); check();
  w.k.persistence.load('history'); check();
  expect(eventFacts(w.l2, a.id)).toBeDefined();
});

test('layer-3 flush updates its saved snapshot without invalidating unchanged retention roots', () => {
  const w = graphWorld('flush-roots');
  w.l3.flush();
  const before = w.k.revision, record = w.k.retention.seeds.get(w.l3.keys.record)!;
  const saved = structuredClone(record.state);
  w.l3.state.nextSeq++;
  expect(record.state).toEqual(saved);
  w.l3.flush();
  expect(w.k.revision).toBe(before);
  expect(record.state).toEqual(w.l3.state);
  expect(record.state).not.toBe(w.l3.state);
});

test('unchanged constant history is not resolved again; a new canon event reads only new evidence', () => {
  const w = graphWorld('history-work'), index = new GraphHistory(w.l3);
  for (let n = 0; n < 30; n++) {
    const e = event(w, 'past-' + n, 'generic', n, { participants: [{ who: w.v, role: 'actor' }, { who: w.a, role: 'target' }] });
    w.k.events.makeCanon(e.id, 'observed', w.v);
  }
  index.refresh(); index.refresh();
  const read = w.l3.kv.event, reached: string[] = [];
  w.l3.kv.event = (id) => { reached.push(id); return read(id); };
  w.k.now = 100;
  index.refresh(); expect(reached).toEqual([]);
  const e = event(w, 'new', 'generic', 99, { participants: [{ who: w.v, role: 'actor' }] });
  w.k.events.makeCanon(e.id, 'observed', w.v);
  index.refresh(); expect(reached).toEqual([e.id]);
});

test('cached projection preserves replay order when more threads than skeleton ring slots remain', () => {
  const w = graphWorld('ring-pressure', [simple()]);
  w.l3.data.sower.skeletonRing = 1;
  for (let n = 0; n < 3; n++) {
    const target = w.k.root('target-' + n, 'core:person');
    const e = emit(w, 'wrong', n + 1, { participants: [{ who: w.a, role: 'actor' }, { who: target, role: 'target' }], witnesses: [w.v] });
    w.k.events.makeCanon(e.id, 'observed', w.v);
  }
  w.l3.refresh();
  expect(w.l3.threadView).toHaveLength(3);
  expect(w.l3.threadView.every((t) => t.tokens?.length)).toBe(true);
  const before = w.l3.state.skeletons.seq, tokens = w.l3.threadView.map((t) => t.tokens);
  w.l3.refresh();
  expect(w.l3.state.skeletons.seq).toBe(before + 3);
  expect(w.l3.threadView.map((t) => t.tokens)).toEqual(tokens);
});

test('controlled play ticks reuse detached pool snapshots instead of cloning the pool every second', () => {
  const w = graphWorld('snapshot-work', [simple()]);
  w.l3.data.schedule.slotGap = 10000;
  const e = emit(w, 'wrong', 1, { witnesses: [w.v] });
  w.k.events.makeCanon(e.id, 'observed', w.v);
  w.k.settle(); w.l3.advancePlay(1);
  const clone = globalThis.structuredClone;
  let fullCopies = 0;
  globalThis.structuredClone = (value, options) => {
    if (value === w.l3.state) fullCopies++;
    return clone(value, options);
  };
  try { w.l3.advancePlay(101); } finally { globalThis.structuredClone = clone; }
  expect(fullCopies).toBeLessThanOrEqual(1);
  const saved = w.k.retention.seeds.get(w.l3.keys.record)!.state as typeof w.l3.state;
  expect(saved.pool).toEqual(w.l3.state.pool);
  expect(saved.pool).not.toBe(w.l3.state.pool);
  w.l3.state.pool[0].refusals++;
  expect(saved.pool[0].refusals).not.toBe(w.l3.state.pool[0].refusals);
  w.l3.flush();
  expect((w.k.retention.seeds.get(w.l3.keys.record)!.state as typeof saved).pool).toEqual(w.l3.state.pool);
});

test('constant negative exposure avoids repeated resolution and observes new receipts and withdrawn member pins', () => {
  const w = graphWorld('negative-exposure'), cause = H(s('negative-exposure'));
  const e = event(w, 'background', 'generic', 0), value = w.k.value.bind(w.k);
  let reads = 0;
  w.k.value = (node, slot, at) => { reads++; return value(node, slot, at); };
  expect(w.l2.exposure(e.id)).toBeUndefined();
  const first = reads; expect(first).toBeGreaterThan(0);
  expect(w.l2.exposure(e.id)).toBeUndefined(); expect(reads).toBe(first);
  w.l2.global.receipts.push({ delivery: cause, seed: cause, template: 'negative', grade: 'presented', channels: ['message'], cites: [e.id], cue: {}, at: 5, playTotal: 1 });
  expect(w.l2.exposure(e.id)).toMatchObject({ grade: 'presented', at: 5 });
  const own = event(w, 'own-negative', 'generic', 2, { participants: [{ who: w.v, role: 'actor' }] });
  const pin = w.k.pin({ node: w.k.address(own.id, 'participants[0]'), slot: 'who', value: w.a, reason: 'authored', cause });
  expect(w.l2.exposure(own.id)).toBeUndefined();
  expect(w.l2.exposure(own.id)).toBeUndefined();
  w.k.withdrawPin(pin.id, cause);
  expect(w.l2.exposure(own.id)).toMatchObject({ grade: 'confirmed', at: 2 });
  const future = event(w, 'future-negative', 'generic', 3);
  w.k.pin({ node: future.id, slot: 'kind', value: 'generic', reason: 'observed', cause, at: 10 });
  expect(w.l2.exposure(future.id)).toBeUndefined();
  w.k.now = 11;
  expect(w.l2.exposure(future.id)).toMatchObject({ grade: 'presented', at: 10 });
});

test('negative exposure does not cache an extra member whose retention can raise the participant count', () => {
  const w = graphWorld('negative-extra'), e = event(w, 'extra', 'generic', 0);
  const extra = w.k.address(e.id, 'participants[2]');
  for (const [slot, value] of [['who', w.v], ['role', 'actor']]) w.k.contribute({ source: { layer: 'simulation', origin: e.id },
    target: { slot, scope: { nodes: [extra] } }, form: { f: 'const', value }, mode: 'constrain' });
  expect(w.l2.exposure(e.id)).toBeUndefined();
  w.k.retention.setSeed({ id: H(s('keep-extra')), state: {}, nodes: [extra] });
  expect(w.l2.exposure(e.id)).toMatchObject({ grade: 'confirmed', at: 0 });
});
