import { expect, test, setDefaultTimeout } from 'bun:test';
import { readFileSync } from 'node:fs';
import { H, s } from '../../src/id.ts';
import { itemTime } from '../../src/summary.ts';
import type { Id } from '../../src/types.ts';
import type { ActsState } from '../../src/sim/proc-acts.ts';
import type { EventsDigest } from '../../src/sim/proc-events.ts';
import { attachLayer2 } from '../../src/sim/layer2-wire.ts';
import { lintSources } from '../../src/sim/source-audit.ts';
import { ReplayPort } from '../../src/sim/port.ts';
import { ScriptPort } from '../../src/seeding/port.ts';
import { reevaluate } from '../../src/seeding/run.ts';
import { miniPack, MINI_ID } from '../s2/mini.ts';
import { child, inject, quietSim } from './helpers.ts';
import { semanticFailure } from './review-probe-result.ts';

setDefaultTimeout(120_000);
const cause = H(s('round4'));

function pairs(sim: ReturnType<typeof quietSim>): Array<[Id, Id]> {
  const residents = sim.w.districts[0]!.cellIds.flatMap((c) => sim.people.residentsOfBlock(c));
  const out: Array<[Id, Id]> = [];
  for (const a of residents) {
    const b = residents.find((b) => b !== a && sim.ties.tie(a, b)?.tied === false && !out.some((p) => p.includes(a) || p.includes(b)));
    if (b) out.push([a, b]);
    if (out.length === 2) return out;
  }
  throw new Error('fixture needs two independent non-implicit ties');
}

function window(sim: ReturnType<typeof quietSim>, all: unknown[]) {
  const l2 = attachLayer2(sim, { port: new ScriptPort(), facts: { flag: {}, x: {} } });
  const pack = miniPack({}, { windows: [{ id: 'w', opens: 'yes', closes: { all } as never, onClose: 'withdraw' }] });
  expect(l2.installPack(pack)).toEqual([]);
  const sown = l2.sow(pack.id, MINI_ID);
  expect(sown.ok, JSON.stringify(sown)).toBe(true);
  sim.k.settle();
  return { l2, inst: l2.instance(sown.instance!)! };
}

test('A1-01: external tie and belief writes replay in actual order, across a reload between writes', () => {
  for (const reload of [false, true]) {
    const sim = quietSim('A1-01');
    const [pair] = pairs(sim);
    const subject = sim.k.mirrored('subject', 'xf:person');
    sim.k.reading(subject, 'alive', 'yes');
    const npc = sim.k.root('npc', 'core:person');
    sim.k.retention.setSeed({ id: cause, state: {}, nodes: [subject, npc] });
    sim.k.addEdge({ type: 'core:located-in', from: npc, to: sim.w.city, cause });
    sim.k.pin({ node: npc, slot: 'age', value: 35, reason: 'authored', cause });
    sim.advance(1);
    const edge = sim.tiePolicy.materialise(...pair!)!;
    const { l2, inst } = window(sim, [
      { social: { tied: { a: pair![0], b: pair![1], type: 'xf:tie' } }, is: ['yes'] },
      { social: { divergence: { believer: 'npc', subject } }, is: ['large'] },
    ]);
    sim.advance(1);
    const t = sim.k.now;
    sim.k.endEdge(edge.id, t);
    if (reload) {
      sim.k.persistence.save('between'); sim.k.persistence.load('between');
      // Game readings are restated by the port on load; this fixture has no replay-port process.
      sim.k.reading(subject, 'alive', 'yes', t, true);
      pairs(sim);
    }
    sim.k.beliefs.set({ believer: npc, subject, path: 'alive', value: 'no', at: t, confidence: 1, evidence: [subject], source: { by: 'inferred', rule: { name: 'test', version: 1 }, from: [subject] }, formed: t, refreshed: t, memorable: true });
    expect(sim.reads.eval('divergence', [npc, subject]), `fixture divergence (reload=${reload}, reading=${sim.k.value(subject, 'alive')})`).toBe('large');
    const live = l2.instance(inst.id)!;
    reevaluate(l2, live, [{ time: t, reason: 'test', change: { c: 'reading', node: subject, slot: 'alive', at: t, new: 'yes' } }]);
    expect(live.st.latches, 'A1-01 semantic: non-overlapping reads must not latch').toEqual([]);
    const reads = sim.reads.port();
    const end = reads.transitions('tied', [...pair!, 'xf:tie'], t - 1, t)[1]!;
    const div = reads.transitions('divergence', [npc, subject], t - 1, t)[1]!;
    expect(end.ord!).toBeLessThan(div.ord!);
    const before = [end, div];
    sim.k.persistence.save('after'); sim.k.persistence.load('after');
    expect([reads.transitions('tied', [...pair!, 'xf:tie'], t - 1, t)[1], reads.transitions('divergence', [npc, subject], t - 1, t)[1]]).toEqual(before);
  }
});

test('A1-01b: feed ordinals are allocated at publication, between earlier and later external writes', () => {
  const sim = quietSim('A1-01b');
  const [pair] = pairs(sim);
  sim.advance(1);
  const next = sim.k.evolution.states.get('city.events')!.outstanding[0]!;
  const dg = next.digest as EventsDigest;
  const district = sim.w.districts[0]!.id;
  // Inject one pending transition into an otherwise ordinary process batch. It has not happened yet.
  dg.changes.windows[dg.changes.windows.length - 1]!.items.push({ key: `regime|${district}`, t: 1200, prev: 'none', value: 'test' });
  const edge = sim.tiePolicy.materialise(...pair!)!;
  const before = sim.reads.port().transitions('tied', [...pair!, 'xf:tie'], 599, 600)[1]!;
  sim.advance(1);
  const feed = sim.reads.port().transitions('regime', [district], 1199, 1200)[1]!;
  sim.k.endEdge(edge.id);
  const after = sim.reads.port().transitions('tied', [...pair!, 'xf:tie'], 1199, 1200)[1]!;
  expect(Number.isSafeInteger(feed.ord), 'A1-01b semantic: a published feed has a persistent ordinal').toBe(true);
  expect(before.ord!).toBeLessThan(feed.ord!);
  expect(feed.ord!).toBeLessThan(after.ord!);
  expect(sim.reads.port().transitions('regimeIs', [district, 'test'], 1199, 1200)[1]!.ord).toBe(feed.ord!);
  const ord = sim.record.ord;
  sim.k.persistence.save('feed'); sim.k.persistence.load('feed');
  expect(sim.record.ord).toBe(ord);
  expect(sim.reads.port().transitions('regime', [district], 1199, 1200)[1]).toEqual(feed);
});

test('A1-01c: a mirrored reading precedes a later tie write even when relevance dispatch is deferred', () => {
  const sim = quietSim('A1-01c');
  const [pair] = pairs(sim);
  const subject = sim.k.mirrored('subject', 'xf:person');
  sim.k.reading(subject, 'alive', 'yes');
  const npc = sim.k.root('npc', 'core:person');
  sim.k.addEdge({ type: 'core:located-in', from: npc, to: sim.w.city, cause });
  sim.k.pin({ node: npc, slot: 'age', value: 35, reason: 'authored', cause });
  sim.k.beliefs.set({ believer: npc, subject, path: 'alive', value: 'yes', at: 0, confidence: 1, evidence: [subject], source: { by: 'inferred', rule: { name: 'test', version: 1 }, from: [subject] }, formed: 0, refreshed: 0, memorable: true });
  sim.advance(1);
  const e = sim.tiePolicy.materialise(...pair!)!;
  const { l2, inst } = window(sim, [
    { social: { tied: { a: pair![0], b: pair![1], type: 'xf:tie' } }, is: ['yes'] },
    { social: { divergence: { believer: 'npc', subject } }, is: ['large'] },
  ]);
  sim.advance(1);
  const t = sim.k.now;
  sim.k.reading(subject, 'alive', 'no');
  sim.k.endEdge(e.id);
  sim.k.settle();
  reevaluate(l2, inst, [{ time: t, reason: 'test', change: { c: 'reading', node: subject, slot: 'alive', at: t, new: 'no' } }]);
  expect(inst.st.latches, 'A1-01c semantic: values that stood together before dispatch must latch').toEqual(['w']);
  const div = sim.reads.port().transitions('divergence', [npc, subject], t - 1, t)[1]!;
  const end = sim.reads.port().transitions('tied', [...pair!, 'xf:tie'], t - 1, t)[1]!;
  expect(div.ord!).toBeLessThan(end.ord!);
});

test('A1-02: restored item materialisation still follows edited summary descriptors', () => {
  const sim = quietSim('R1-109a', (d) => { d.events.offspring = [0, 0, 0, 0]; }, ['city.events', 'scene.acts']);
  const cell = sim.w.districts[0]!.cellIds[0]!;
  new ReplayPort(sim).submit([{ t: 99 * 600 + 5, op: 'reading', node: 'v', slot: 'cell', value: 'c1' }]);
  sim.startAt(100);
  inject(sim, child(sim, 'first', 0, 100, 'theft', 1, cell), child(sim, 'first', 1, 100, 'theft', 1, cell));
  sim.advance(3);
  const pub = sim.stateOf<ActsState>('scene.acts')!.published[0]!;
  const before = sim.policies.viewEvent(pub.item)!;
  expect(before.participants.length).toBe(2);
  sim.k.beliefs.set({ believer: before.participants[0]!.who, subject: before.participants[1]!.who, path: 'did.harm', value: 'yes', at: sim.k.now, confidence: 1, evidence: [pub.item], source: { by: 'observed', event: pub.item }, formed: sim.k.now, refreshed: sim.k.now, memorable: true });
  sim.k.pin({ node: pub.summary, slot: 'kind', value: 'assault', reason: 'authored', cause });
  expect(sim.k.value(pub.item, 'kind')).toBe('assault');
  for (const save of ['item1', 'item2']) {
    sim.k.persistence.save(save); sim.k.persistence.load(save);
    expect(sim.k.value(pub.item, 'kind'), 'A1-02 semantic: reloaded descriptor follows its summary').toBe('assault');
    expect(sim.policies.viewEvent(pub.item)!.participants).toEqual(before.participants);
    expect(sim.policies.viewEvent(pub.item)!.effects).toEqual(before.effects);
    expect(sim.record.evidence[pub.item]!.kind).toBe('theft');
    expect(sim.k.store.contributionsNaming(pub.item).filter((c) => ['time', 'kind', 'place'].includes(c.target.slot ?? ''))).toEqual([]);
  }
  // A subsequent summary edit also propagates; query acceleration must not cache the original descriptor.
  sim.k.pin({ node: pub.summary, slot: 'from', value: 61000, reason: 'authored', cause });
  expect(sim.k.value(pub.item, 'time')).toBe(itemTime(pub.summary, sim.summaryOfItem(pub.item)!.index, 61000, 600));
  expect(sim.k.events.mintedFacts(pub.item)).toBeUndefined();
});

test('A1-03: shortening a future-ended tie after reload does not preserve its superseded future', () => {
  const answers: string[] = [];
  for (const reload of [false, true]) {
    const sim = quietSim('A1-03');
    const [pair] = pairs(sim);
    const e = sim.tiePolicy.materialise(...pair!)!;
    sim.k.endEdge(e.id, 6000);
    sim.advance(1);
    if (reload) { sim.k.persistence.save('future'); sim.k.persistence.load('future'); pairs(sim); }
    sim.k.endEdge(e.id, 1200);
    sim.advance(3);
    answers.push(sim.reads.eval('tied', [...pair!, 'xf:tie'], 1500));
    expect(answers[answers.length - 1], 'A1-03 semantic: shortened interval is absent at 1500').toBe('no');
    expect(sim.reads.transitions('tied', [...pair!, 'xf:tie'], 1199, 1500)).toEqual([{ t: 1199, value: 'yes' }, { t: 1200, value: 'no' }]);
    sim.k.persistence.save('ended'); sim.k.persistence.load('ended');
    pairs(sim);
    expect(sim.reads.eval('tied', [...pair!, 'xf:tie'], 1500)).toBe('no');
  }
  expect(answers).toEqual(['no', 'no']);
});

test('A1-04: attribute writes retain boundary order and cannot invent overlapping ties', () => {
  const sim = quietSim('A1-04');
  const [a, b] = pairs(sim) as [[Id, Id], [Id, Id]];
  sim.advance(1);
  const ea = sim.tiePolicy.materialise(...a)!;
  const { l2, inst } = window(sim, [a, b].map((p) => ({ social: { tied: { a: p[0], b: p[1], type: 'xf:tie' } }, is: ['yes'] })));
  sim.advance(1);
  sim.k.endEdge(ea.id);
  const eb = sim.tiePolicy.materialise(...b)!;
  const read = () => [a, b].map((p) => sim.reads.port().transitions('tied', [...p, 'xf:tie'], 1199, 1200));
  const original = read();
  sim.advance(1);
  sim.k.endEdge(eb.id);
  sim.tiePolicy.materialise(...a);
  const ord = sim.record.ord;
  for (let n = 0; n < 65; n++) sim.k.updateEdge(ea.id, { attrs: { lastContact: n } });
  reevaluate(l2, inst, [{ time: 1200, reason: 'test', change: { c: 'reading', node: a[0], slot: 'alive', at: 1200, new: 'yes' } }]);
  expect(inst.st.latches, 'A1-04 semantic: attribute updates cannot make disjoint ties overlap').toEqual([]);
  expect(read(), 'A1-04 semantic: original boundary ordinals survive attributes').toEqual(original);
  expect(sim.record.ord).toBe(ord);
  sim.k.persistence.save('attributes'); sim.k.persistence.load('attributes');
  expect(read()).toEqual(original);
});

test('A1-05: meta guards use operand values and leave unknown operands uncertain', () => {
  const text = readFileSync(new URL('../../src/sim/policies.ts', import.meta.url), 'utf8');
  for (const guard of [
    "(ev.place || ev.kind.startsWith('meta:')) === true",
    "('cell' || ev.kind.startsWith('meta:')) === true",
    "(ev.place && false) === false",
  ]) {
    const changed = text.replaceAll("ev.kind.startsWith('meta:')", guard);
    expect(changed).not.toBe(text);
    expect(lintSources([{ path: 'policies.ts', text: changed }]).filter((f) => f.audit === 'meta-inert').map((f) => f.where), 'A1-05 semantic: an unproved guard must be rejected').toEqual(['policies.ts:heardEvent', 'policies.ts:absorb']);
  }
  for (const guard of ["('' || ev.kind.startsWith('meta:')) === true", "('cell' && ev.kind.startsWith('meta:')) === true"]) {
    expect(lintSources([{ path: 'policies.ts', text: text.replaceAll("ev.kind.startsWith('meta:')", guard) }]).filter((f) => f.audit === 'meta-inert')).toEqual([]);
  }
});

test('A1-05b: an unknown falsy operand is not interchangeable with false in a strict comparison', () => {
  const text = readFileSync(new URL('../../src/sim/policies.ts', import.meta.url), 'utf8');
  const changed = text.replaceAll("ev.kind.startsWith('meta:')", '(ev.place && false) === false');
  // For place='', && returns '', and the strict comparison is false. An unknown place cannot prove rejection.
  expect(lintSources([{ path: 'policies.ts', text: changed }]).filter((f) => f.audit === 'meta-inert').map((f) => f.where), 'A1-05b semantic: an unknown operand cannot prove a strict comparison').toEqual(['policies.ts:heardEvent', 'policies.ts:absorb']);
});

test('A1-06: mutating a resident view cannot corrupt another world or its own cache', () => {
  const a = quietSim('A1-06');
  const cell = a.w.districts[0]!.cellIds[0]!;
  const resident = a.people.residentAt(cell, 0);
  const view = a.people.view(resident)!;
  const age = a.k.value(resident, 'age');
  if (typeof age !== 'number') throw new Error('fixture needs an age');
  Reflect.set(view, 'age', 999);
  const b = quietSim('A1-06');
  b.people.residentAt(cell, 0);
  expect(b.people.view(resident)!.age, 'A1-06 semantic: shared resident data cannot be corrupted').toBe(age);
  expect(a.people.view(resident)!.age).toBe(age);
  expect(b.k.value(resident, 'age')).toBe(age);
  expect(Object.isFrozen(view)).toBe(true);
});

test('A1-07: the probe checker rejects setup errors and accepts only the intended assertion', () => {
  const setup = 'TypeError: undefined is not an object (evaluating this.k.edgeHooks.push)\n(fail) R3-06: snapshot test\n';
  expect(semanticFailure(1, setup, 'R3-06'), 'A1-07 semantic: setup failures do not prove a regression').toBe(false);
  const intended = 'error: R3-06 semantic: contribution snapshot changed\n(fail) R3-06: snapshot test\n';
  expect(semanticFailure(1, intended, 'R3-06')).toBe(true);
  expect(semanticFailure(0, intended, 'R3-06')).toBe(false);
  expect(semanticFailure(1, intended, 'R3-05')).toBe(false);
  expect(semanticFailure(1, 'error: R3-06 semantic: contribution snapshot changed\n', 'R3-06')).toBe(false);
});
