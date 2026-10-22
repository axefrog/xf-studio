import { describe, expect, test } from 'bun:test';
import { H, s } from '../src/id.ts';
import type { Kernel } from '../src/kernel.ts';
import type { GamePort } from '../src/persistence.ts';
import type { Id } from '../src/types.ts';
import { coreKernel, defsOf, dim, fxKernel, kind, slot } from './helpers.ts';

const cause = H(s('test-cause'));
const fid = (name: string): Id => H(s('origin'), s(name));

const abc = defsOf(
  [dim('fx:abc', { t: 'enum', values: ['a', 'b', 'c'] })],
  [kind('fx:t', [slot('x', 'fx:abc')])],
);

describe('F-12 branching (spec 14.2, 14.3)', () => {
  test('F-12: save A; pin p1; save B; load A; pin p2; save C; load B', () => {
    const k = fxKernel('F-12', abc);
    const v = k.root('v', 'fx:t');
    k.frames.demandRoots.add(v);
    const n = k.root('n', 'fx:t');
    // A frame that would react to pins on n, so a noisy replay would show.
    k.frames.open({ actor: v, level: 'concern', origin: fid('watch'), weight: 1, own: { wants: [{ slot: '*', scope: { nodes: [n] } }] }, cause });
    k.settle();
    k.persistence.save('A');
    const p1 = k.pin({ node: n, slot: 'x', value: 'a', reason: 'authored', cause });
    k.persistence.save('B');
    k.settle();
    k.dispatcher.drain();

    k.persistence.load('A');
    expect(k.store.pin(p1.id)).toBeUndefined();
    expect(k.store.header(n)).toBeUndefined();
    const n2 = k.root('n', 'fx:t');
    expect(n2).toBe(n);
    const p2 = k.pin({ node: n, slot: 'x', value: 'b', reason: 'authored', cause });
    k.persistence.save('C');
    const epochC = k.epoch;
    expect(k.submit({ epoch: epochC, stamp: 10, op: { op: 'pin', spec: { node: n, slot: 'x', value: 'c', reason: 'authored', cause } } }).accepted).toBe(true);

    const report = k.persistence.load('B');
    expect(report.readOnly).toBe(false);
    // B has p1 and not p2.
    expect(k.store.pin(p1.id)).toBeDefined();
    expect(k.store.pin(p2.id)).toBeUndefined();
    expect(k.value(n, 'x')).toBe('a');
    // Every queued operation was discarded, and one tagged with C's epoch is refused.
    expect(k.evolution.queued).toHaveLength(0);
    expect(k.epoch).not.toBe(epochC);
    expect(k.submit({ epoch: epochC, stamp: 20, op: { op: 'pin', spec: { node: n, slot: 'x', value: 'c', reason: 'authored', cause } } })).toEqual({
      accepted: false, reason: 'the operation was created in an earlier epoch',
    });
    // Replay emitted nothing (I-13).
    expect(k.pending).toHaveLength(0);
    k.settle();
    expect(k.dispatcher.drain()).toHaveLength(0);
    // The branch records form a tree: C's parent is A.
    expect(k.persistence.chain.get('C')!.parent).toBe('A');
    expect(k.persistence.chain.get('B')!.parent).toBe('A');
    // Saving after the load continues from B.
    k.persistence.save('D');
    expect(k.persistence.chain.get('D')!.parent).toBe('B');
    expect(k.persistence.chain.get('D')!.ops).toHaveLength(0);
  });
});

/** A world with something of every persisted kind. */
function richWorld(name: string, config?: Parameters<typeof coreKernel>[2]) {
  const k = coreKernel(name, undefined, config);
  const v = k.root('v', 'core:person');
  k.frames.demandRoots.add(v);
  const alice = k.root('alice', 'core:person');
  const bob = k.root('bob', 'core:person');
  const city = k.root('city', 'core:place');
  const place = k.root('place', 'core:place');
  const group = k.root('group', 'core:group');
  k.addEdge({ type: 'core:located-in', from: place, to: city, cause });
  k.addEdge({ type: 'core:member-of', from: alice, to: group, attrs: { role: 'leader', strength: 0.75 }, cause });
  k.pin({ node: alice, slot: 'age', value: 33, reason: 'authored', cause });
  k.contribute({ source: { layer: 'authored', origin: cause }, target: { slot: 'age', scope: { nodes: [bob] } }, form: { f: 'const', value: 41 }, mode: 'constrain' });
  k.contribute({ source: { layer: 'simulation', origin: cause }, target: { slot: 'age', scope: { nodes: [v] } }, form: { f: 'const', value: 29 }, mode: 'constrain' });
  const ev = k.events.mintEvent({ creator: alice, cause, name: 'e1', time: 100, kind: 'meeting', place, participants: [{ who: alice, role: 'actor' }], witnesses: [bob] });
  k.events.makeCanon(ev, 'observed', alice, ['time', 'kind', 'participants']);
  k.events.mintEvent({ creator: alice, cause, name: 'forgettable', time: 101, kind: 'sale', place });
  k.beliefs.observe(bob, ev);
  k.beliefs.set({ believer: bob, subject: alice, path: 'age', value: 30, confidence: 0.5, evidence: [ev], source: { by: 'observed', event: ev }, formed: 5, refreshed: 5, memorable: false });
  const S = k.summaries.mintSummary({ creator: city, cause, name: 'robberies', kind: 'robbery', from: 0, length: 1000, scope: city, count: 4 });
  k.summaries.makeItemCanon(S, 1, 'committed', cause);
  const gf = k.groups.decide(alice, group, { op: 'open', spec: { level: 'concern', origin: fid('g'), payload: { drive: 'honour' }, weight: 0.6 } });
  k.frames.open({ actor: v, level: 'drive', origin: fid('v'), payload: { drive: 'honour' }, weight: 0.8, focus: { nodes: [alice], tier: 3 }, cause });
  k.retention.setSeed({ id: H(s('seed'), s('s1')), state: { phase: 2 }, nodes: [bob] });
  k.evolution.register({ id: 'slow', tier: 0, period: 3, run: (_c, w) => [{ op: 'pin', node: alice, slot: 'age', value: 40 + w }] });
  k.settle();
  k.tick({ to: 600 });
  return { k, v, alice, bob, city, place, group, ev, S, gf };
}

describe('save and load (spec 14)', () => {
  test('a round trip restores exactly the persisted state', () => {
    const w = richWorld('roundtrip');
    const before = w.k.persistence.currentView().toData();
    expect(before.headers.length).toBeGreaterThan(5);
    w.k.persistence.save('S1');
    const outstanding = JSON.stringify(w.k.evolution.stateOf('slow').outstanding);
    // Mutate the world, then load.
    w.k.pin({ node: w.bob, slot: 'age', value: 77, reason: 'authored', cause });
    w.k.endEdge(w.k.store.edgesFrom(w.place)[0]!.id, 5);
    w.k.persistence.load('S1');
    expect(w.k.persistence.currentView().toData()).toEqual(before);
    expect(JSON.stringify(w.k.evolution.stateOf('slow').outstanding)).toBe(outstanding);
    expect(w.k.evolution.cursor).toBeGreaterThanOrEqual(1);
    // Things that are not persisted are gone: caches, simulation contributions, the unretained event, pending changes.
    expect(w.k.store.nodes.size).toBe(0);
    expect(w.k.pending).toHaveLength(0);
    expect(w.k.store.allContributions().filter((c) => c.source.layer === 'simulation' && c.source.origin === cause)).toHaveLength(0);
    expect(w.k.store.header(H(s('mint'), ...[]))).toBeUndefined();
    // And the canon event still reads, from its pins.
    expect(w.k.value(w.ev, 'time')).toBe(100);
    expect(w.k.value(w.ev, 'kind')).toBe('meeting');
    expect(w.k.summaries.canonOf(w.S)).toEqual([1]);
    expect(w.k.beliefs.activeOf(w.bob).length).toBeGreaterThanOrEqual(1);
    expect(w.k.frames.demandRoots.has(w.v)).toBe(true);
    expect(w.k.retention.seeds.size).toBe(1);
  });

  test('saving twice with no change writes no ops; ops are the diff against the chain', () => {
    const w = richWorld('diff');
    const a = w.k.persistence.save('A');
    expect(a.ops.length).toBeGreaterThan(10);
    const b = w.k.persistence.save('B');
    expect(b.ops).toHaveLength(0);
    w.k.pin({ node: w.bob, slot: 'age', value: 52, reason: 'authored', cause });
    const c = w.k.persistence.save('C');
    expect(c.ops.map((o) => o.op)).toEqual(['PinAdded']);
    const withdrawn = H(s('withdrawer'));
    const p = w.k.pin({ node: w.bob, slot: 'age', value: 53, reason: 'committed', cause: withdrawn });
    w.k.persistence.save('D');
    w.k.withdrawPin(p.id, withdrawn);
    const e = w.k.persistence.save('E');
    expect(e.ops.map((o) => o.op)).toContain('PinWithdrawn');
    w.k.endEdge(w.k.store.edgesFrom(w.alice).find((x) => x.type === 'core:member-of')!.id, 7);
    const f = w.k.persistence.save('F');
    expect(f.ops.map((o) => o.op)).toEqual(['EdgeEnded']);
    w.k.endContribution(w.k.store.allContributions().find((x) => x.source.layer === 'authored')!.id, 9);
    expect(w.k.persistence.save('G').ops.map((o) => o.op)).toEqual(['ContributionEnded']);
    w.k.beliefs.drop(w.bob, w.k.beliefs.get(w.bob, w.ev, 'kind')!.id);
    expect(w.k.persistence.save('H').ops.map((o) => o.op)).toEqual(['BeliefDropped']);
    // Every op kind the specification lists can be produced and replayed by the view.
    const kinds = new Set(w.k.persistence.records().flatMap((r) => r.ops.map((o) => o.op)));
    for (const op of ['HeaderAdded', 'PinAdded', 'PinWithdrawn', 'EdgeAdded', 'EdgeEnded', 'ContributionAdded', 'ContributionEnded', 'BeliefSet', 'BeliefDropped', 'EventCanon', 'SummarySet', 'FrameState', 'SeedState', 'ProcessState']) {
      expect(kinds.has(op as never)).toBe(true);
    }
  });

  test('a reading ended by a later, unpersisted reading is recorded as PinEnded; unretained readings are not persisted', () => {
    const defs = defsOf(
      [dim('fx:wx', { t: 'enum', values: ['clear', 'rain', 'fog'] })],
      [kind('fx:weather', [slot('weather', 'fx:wx', { mode: 'mirrored' })], { extends: ['core:thing'] })],
    );
    const k = coreKernel('pin-ended', defs);
    const v = k.root('v', 'core:person');
    const w = k.mirrored('weather', 'fx:weather');
    k.reading(w, 'weather', 'rain', 1000);
    k.reading(w, 'weather', 'fog', 1500);
    const obs = k.observeReading(w, 'weather', 1000, v)!;
    expect(obs.valid).toEqual({ from: 1000, to: 1500 });
    const a = k.persistence.save('A');
    const pinsA = a.ops.filter((o) => o.op === 'PinAdded');
    expect(pinsA).toHaveLength(2); // the observed pin and the reading it saw; the unobserved fog reading is not kept
    expect(pinsA.map((o) => (o.op === 'PinAdded' ? o.pin.reason : '')).sort()).toEqual(['game', 'observed']);
    // A later reading ends the retained observation, though that reading is not itself retained.
    const k2 = coreKernel('pin-ended2', defs);
    const v2 = k2.root('v', 'core:person');
    const w2 = k2.mirrored('weather', 'fx:weather');
    k2.reading(w2, 'weather', 'rain', 1000);
    k2.observeReading(w2, 'weather', 1000, v2);
    k2.persistence.save('A');
    k2.reading(w2, 'weather', 'clear', 2000);
    const b = k2.persistence.save('B');
    expect(b.ops.filter((o) => o.op === 'PinEnded')).toHaveLength(2);
    expect(b.ops.some((o) => o.op === 'PinAdded')).toBe(false);
    // Reload: the retained observation keeps its end.
    k2.persistence.load('B');
    const pins = k2.store.pinsOn(w2, 'weather');
    expect(pins.map((p) => p.valid.to)).toEqual([2000, 2000]);
  });

  test('snapshots every N ops: load starts from the nearest snapshot', () => {
    const k = coreKernel('snapshots', undefined, { snapshotEvery: 6 });
    const people = Array.from({ length: 12 }, (_, n) => k.root(`p${n}`, 'core:person'));
    people.slice(0, 4).forEach((p, n) => k.pin({ node: p, slot: 'age', value: 20 + n, reason: 'authored', cause }));
    const a = k.persistence.save('A');
    expect(a.snapshot).toBeDefined();
    expect(a.meta.sinceSnapshot).toBe(0);
    people.slice(4, 5).forEach((p) => k.pin({ node: p, slot: 'age', value: 30, reason: 'authored', cause }));
    const b = k.persistence.save('B');
    expect(b.snapshot).toBeUndefined();
    expect(b.ops.length).toBeLessThan(6);
    const report = k.persistence.load('B');
    expect(report.replayed).toBe(b.ops.length); // only B's ops after A's snapshot
    expect(k.value(people[4]!, 'age')).toBe(30);
    expect(k.value(people[3]!, 'age')).toBe(23);
    // A load of A itself replays nothing.
    expect(k.persistence.load('A').replayed).toBe(0);
  });

  test('outstanding process batches are persisted and applied at their boundary without re-running', () => {
    const k = fxKernel('outstanding', defsOf(
      [dim('fx:n', { t: 'int', min: 0, max: 100 })],
      [kind('fx:c', [slot('n', 'fx:n', { mode: 'assigned', temporal: { window: 600 } })])],
    ));
    const node = k.root('c', 'fx:c');
    k.pin({ node, slot: 'n@w0', value: 1, reason: 'authored', cause });
    let runs = 0;
    const def = { id: 'slow', tier: 0 as const, period: 3, run: (_c: unknown, w: number) => (runs++, [{ op: 'pin' as const, node, slot: `n@w${w + 1}`, value: 10 + w }]) };
    k.evolution.register(def);
    k.tick({ to: 600 });
    expect(runs).toBe(1);
    k.persistence.save('mid');
    k.persistence.load('mid');
    k.tick({ to: 1800 });
    expect(runs).toBe(2); // the run at boundary 3; the run at boundary 0 was not repeated
    expect(k.value(node, 'n', 600)).toBe(10);
  });

  test('a save needing a function that is no longer available loads read-only with a plain message', () => {
    const w = richWorld('compat');
    const rec = w.k.persistence.save('A');
    rec.meta.versions.push('derive:vanished@3');
    const report = w.k.persistence.load('A');
    expect(report.readOnly).toBe(true);
    expect(report.message).toContain('derive:vanished@3');
    expect(report.message).toContain('read-only');
    expect(() => w.k.pin({ node: w.bob, slot: 'age', value: 20, reason: 'authored', cause })).toThrow();
    expect(w.k.value(w.alice, 'age')).toBe(33);
  });

  test('pack contributions are reloaded from the pack, not stored; a missing pack is reported', () => {
    const k = coreKernel('packs');
    const p = k.root('p', 'core:person');
    k.persistence.installPack({
      id: 'demo', version: '1.0.0',
      contributions: [{ layer: 'authored', target: { slot: 'age', scope: { nodes: [p] } }, form: { f: 'const', value: 61 }, mode: 'constrain' }],
    });
    expect(k.value(p, 'age')).toBe(61);
    const rec = k.persistence.save('A');
    expect(rec.ops.some((o) => o.op === 'ContributionAdded')).toBe(false);
    expect(rec.meta.packs).toEqual([{ id: 'demo', version: '1.0.0' }]);
    k.store.clear();
    const report = k.persistence.load('A');
    expect(report.missingPacks).toEqual([]);
    expect(k.value(k.root('p', 'core:person'), 'age')).toBe(61);
    k.persistence.packs.delete('demo');
    expect(k.persistence.load('A').missingPacks).toEqual(['demo@1.0.0']);
  });

  test('the mirrored state is reconciled into silent readings at the current time', () => {
    const defs = defsOf(
      [dim('fx:wx', { t: 'enum', values: ['clear', 'rain'] })],
      [kind('fx:weather', [slot('weather', 'fx:wx', { mode: 'mirrored' })], { extends: ['core:thing'] })],
    );
    const k = coreKernel('reconcile', defs);
    k.persistence.save('A');
    const port: GamePort = { now: () => 5000, readMirrored: () => [{ gameKey: 'weather', kind: 'fx:weather', slot: 'weather', value: 'rain' }] };
    const before = k.revision;
    const report = k.persistence.load('A', port);
    expect(report.readOnly).toBe(false);
    expect(k.now).toBe(5000);
    const w = k.mirrored('weather', 'fx:weather');
    expect(k.value(w, 'weather', 5000)).toBe('rain');
    expect(k.pending).toHaveLength(0);
    expect(k.revision).toBeGreaterThan(before);
  });
});

describe('provenance (spec 13)', () => {
  test('every record names a cause', () => {
    const w = richWorld('causes');
    w.k.settle();
    expect(w.k.provenance.verifyCauses()).toEqual([]);
    const pin = w.k.store.pinsOn(w.alice, 'age')[0]!;
    expect(w.k.provenance.causeOf(pin.id)).toBe(cause);
    expect(w.k.provenance.causeOf(w.k.store.allEdges()[0]!.id)).toBe(cause);
    expect(w.k.provenance.causeChain(pin.id)).toEqual([cause]);
    const frame = w.k.frames.framesOf(w.v)[0]!;
    expect(w.k.provenance.causeOf(frame.id)).toBe(frame.cause);
  });

  test('explain: contributions ranked by signed discriminating effect; the scores add up; one feasible value lists constraints', () => {
    const k = fxKernel('explain', defsOf(
      [dim('fx:e5', { t: 'enum', values: ['a', 'b', 'c', 'd', 'e'] })],
      [kind('fx:t', [slot('x', 'fx:e5')])],
    ));
    const n = k.root('n', 'fx:t');
    const tbl = (layer: 'authored' | 'seeding', origin: string, weights: Record<string, number>, strength = 1) =>
      k.contribute({ source: { layer, origin }, target: { slot: 'x', scope: { nodes: [n] } }, form: { f: 'table', weights }, mode: 'weight', strength });
    tbl('authored', 'one', { a: 8, b: 1, c: 2 });
    tbl('seeding', 'two', { a: 1, b: 4 }, 2);
    const ex = k.provenance.explain(n, 'x');
    expect(ex.mode).toBe('discriminating');
    if (ex.mode !== 'discriminating') return;
    expect(ex.heuristic).toBe(true);
    expect(ex.entries.length).toBe(3);
    const tr = k.trace(n, 'x');
    expect(ex.value).toBe(tr.winner!.value);
    expect(ex.runnerUp).toBe(tr.runnerUp!.value);
    const lead = tr.winner!.score - tr.runnerUp!.score;
    expect(Math.abs(ex.scoreLead - lead)).toBeLessThan(1e-9);
    for (let i = 1; i < ex.entries.length; i++) expect(Math.abs(ex.entries[i - 1]!.effect)).toBeGreaterThanOrEqual(Math.abs(ex.entries[i]!.effect));
    // A single feasible value: the constraints that produced it.
    k.pin({ node: n, slot: 'x', value: 'c', reason: 'observed', cause });
    const one = k.provenance.explain(n, 'x');
    expect(one.mode).toBe('constraints');
    if (one.mode === 'constraints') {
      expect(one.value).toBe('c');
      expect(one.active.map((c) => c.precedence)).toEqual([600]);
    }
    expect(k.provenance.explain(n, 'nope').mode).toBe('none');
  });

  test('the trace is complete: every constraint, every feasible score, the winner and runner-up', () => {
    const k = fxKernel('trace', defsOf(
      [dim('fx:e4', { t: 'enum', values: ['a', 'b', 'c', 'd'] })],
      [kind('fx:t', [slot('x', 'fx:e4')])],
    ));
    const n = k.root('n', 'fx:t');
    k.pin({ node: n, slot: 'x', region: { r: 'set', values: ['b', 'c', 'd'] }, reason: 'authored', cause });
    k.contribute({ source: { layer: 'seeding', origin: cause }, target: { slot: 'x', scope: { nodes: [n] } }, form: { f: 'set', region: { r: 'set', values: ['a'] }, allow: true }, mode: 'constrain' });
    const tr = k.trace(n, 'x');
    expect(tr.constraints.map((c) => c.active)).toEqual([true, false]);
    expect(tr.feasibleSize).toBe(3);
    expect(tr.scores.map((x) => x.value)).toEqual(['b', 'c', 'd']);
    expect(tr.winner && tr.runnerUp).toBeTruthy();
    expect(tr.winner!.total).toBeGreaterThan(tr.runnerUp!.total);
    expect(tr.value).toBe(tr.winner!.value);
  });
});

function _unused(_k: Kernel): void {}
void _unused;
