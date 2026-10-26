import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { serialize } from 'node:v8';
import { HolotableObserver, COARSE } from '../../src/holotable/observe.ts';
import { RunPublisher } from '../../tools/holotable/publish-run.ts';
import { validateManifest, type Item } from '../../src/holotable/schema.ts';
import { quietSim, child, inject } from '../sim/helpers.ts';
import { ReplayPort } from '../../src/sim/port.ts';
import type { ActsState } from '../../src/sim/proc-acts.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { tieEdgeId, recordedTieStrength } from '../../src/sim/tie-policy.ts';
import { H, s, memberId } from '../../src/id.ts';
import type { Layer3 } from '../../src/procedural/layer3.ts';
import type { EventView, PoolEntry, LogEntry } from '../../src/procedural/types.ts';

const dirs: string[] = [];
function tempDir() {
  const dir = resolve(import.meta.dir, '../../../../../.scratch-holo', `review-${randomUUID()}`);
  mkdirSync(dir, { recursive: true }); dirs.push(dir); return dir;
}
afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });
const rows = (publisher: RunPublisher, layer = 'people') => readFileSync(join(publisher.directory, `${layer}.jsonl`), 'utf8').trim().split('\n').slice(1).map((s) => JSON.parse(s));
const snapshot = (sim: Sim) => serialize({ store: sim.k.store.capture(), events: sim.k.events.capture(), beliefs: sim.k.beliefs.capture(), record: sim.record, revision: sim.k.revision, epoch: sim.k.epoch, pending: sim.k.pending, processes: sim.k.evolution.states });
function forbidResolution(sim: Sim) {
  const forbidden = () => { throw Error('Observer resolved or restored state'); };
  sim.k.resolve = forbidden; sim.k.value = forbidden; sim.k.address = forbidden;
  sim.k.persistence.recoverIfSaved = forbidden; sim.k.persistence.restoreReferencedHeader = forbidden;
  sim.k.persistence.restoreEdge = forbidden; sim.k.events.mintedSpec = forbidden;
  sim.k.events.materialisationOf = forbidden; sim.people.view = forbidden; sim.people.where = forbidden;
  sim.tiePolicy.strengthOf = forbidden;
}
function layer3(pool: PoolEntry[] = [], log: LogEntry[] = [], buffer: Layer3['state']['buffer'] = []): Layer3 {
  return { state: { pool, evidence: [], buffer }, log, threadView: [] } as unknown as Layer3;
}

test('synthetic state envelopes are excluded while buffered record events remain', () => {
  const sim = quietSim('holo-envelopes', undefined, []);
  const ev: EventView = { id: 'placeholder', creator: 'director', cause: 'director', name: '@state', kind: '@state', time: 0, participants: [], effects: [], causes: [], witnesses: [] };
  const l3 = layer3([], [], [
    { pattern: 'state', version: 1, event: ev, change: { c: 'reading', node: 'v', slot: 'cell', new: 'c1' } },
    { pattern: 'event', version: 1, event: { ...ev, id: 'real', name: 'theft', kind: 'theft' } },
  ]);
  forbidResolution(sim); const before = snapshot(sim);
  const events = new HolotableObserver(sim, undefined, l3).sample().layers.get('events')!;
  expect(events.map((i) => i.id)).toEqual(['real']);
  expect(snapshot(sim).equals(before)).toBe(true);
});

test('opened SF1-A-1 summary scene events retain cached descriptors and scene-owned fields without resolution', () => {
  const sim = quietSim('SF1-A-1', (d) => { d.events.offspring = [0, 0, 0, 0]; }, ['city.events', 'scene.acts']);
  const cell = sim.w.districts[0].cellIds[0], j = 100;
  new ReplayPort(sim).submit([{ t: (j - 1) * 600 + 5, op: 'reading', node: 'v', slot: 'cell', value: 'c1' }]);
  sim.startAt(j);
  inject(sim, child(sim, 'a1', 0, j + 1, 'theft', 1, cell), child(sim, 'a2', 0, j + 1, 'theft', 1, cell), child(sim, 'a3', 0, j + 1, 'theft', 1, cell));
  sim.advance(3);
  const published = sim.stateOf<ActsState>('scene.acts')!.published;
  expect(published).toHaveLength(3);
  const expected = published.map((p) => sim.policies.viewEvent(p.item)!);
  // Leave descriptor caches, but require participant/outcome/cause fields to
  // come from the recorded scene.acts owner rather than warmed view caches.
  for (const ev of expected) {
    expect(sim.k.events.materialisationRecords().find((r) => r.event === ev.id)!.provenance.materialisation).toBe('scene.acts');
    for (const slot of ['participants#count', 'outcome', 'causes#count']) sim.k.store.nodes.get(ev.id)?.slots.delete(slot);
    for (let i = 0; i < ev.participants.length; i++) sim.k.store.dropNode(memberId(ev.id, 'participants', i));
  }
  forbidResolution(sim); const before = snapshot(sim);
  const events = new HolotableObserver(sim).sample().layers.get('events')!;
  for (const ev of expected) {
    const item = events.find((i) => i.id === ev.id)!;
    expect(item).toBeDefined(); expect(item.cite).toBe(`se:event:${ev.id}`);
    expect(item.t).toBe(ev.time + (sim.w.index.clock?.sod0 ?? 0));
    expect(item.anchor).toEqual({ item: `story-engine/places/${cell}` });
    expect(item.facets).toMatchObject({ kind: 'theft', outcome: 'done', participants: JSON.stringify(ev.participants.map((p) => `${p.role}:${p.who}`)) });
  }
  expect(snapshot(sim).equals(before)).toBe(true);
});

test('belief truth reads recorded subject values at the stated time, excluding expired, future, withdrawn and stale caches', () => {
  const sim = quietSim('holo-truth', undefined, []), k = sim.k;
  k.now = 20;
  const idOf = (name: string) => H(s(`truth-${name}`));
  const add = (name: string, options: { at?: number; from?: number; to?: number; withdrawn?: number; cached?: boolean; region?: boolean } = {}) => {
    const id = idOf(name);
    k.store.addHeader({ id, kind: 'xf:person', origin: { by: 'mirrored', gameKey: id } });
    if (!options.cached) {
      k.store.addPin({ id: `pin-${id}`, node: id, slot: 'affiliation', value: 'civilian', reason: 'game', at: options.from ?? 0, valid: { from: options.from ?? 0, to: options.to }, cause: id });
      if (options.withdrawn !== undefined) k.store.withdrawn.set(`pin-${id}`, { pin: `pin-${id}`, by: id, at: options.withdrawn });
    }
    k.beliefs.set({ believer: sim.w.v, subject: id, path: 'affiliation', ...(options.region ? { region: { r: 'set' as const, values: ['TygerClaws'] } } : { value: 'TygerClaws' }), at: options.at, confidence: 1, evidence: [], source: { by: 'inferred', rule: { name: 'probe', version: 1 }, from: [] }, formed: 0, refreshed: 0, memorable: true });
  };
  add('current'); add('historic', { at: 5, to: 10 }); add('expired', { to: 10 }); add('future', { from: 30 });
  add('withdrawn', { withdrawn: 10 }); add('pre-withdrawal', { at: 5, withdrawn: 10 });
  add('cached', { cached: true }); add('stale', { cached: true }); add('other-time', { cached: true }); add('region', { region: true });
  for (const name of ['cached', 'stale', 'other-time']) k.store.ensureNode(idOf(name), 20).slots.set('affiliation', { s: 'resolved', status: 'ok', value: 'civilian', at: name === 'other-time' ? 5 : 20, revision: k.revision - (name === 'stale' ? 1 : 0) });
  forbidResolution(sim); const before = snapshot(sim);
  const beliefs = new HolotableObserver(sim).sample().layers.get('beliefs')!;
  for (const name of ['current', 'historic', 'pre-withdrawal', 'cached', 'region']) expect(beliefs.find((i) => i.facets!.about === idOf(name))!.value!.type).toBe('believes-wrongly');
  for (const name of ['expired', 'future', 'withdrawn', 'stale', 'other-time']) expect(beliefs.find((i) => i.facets!.about === idOf(name))!.value!.type).toBe('believes');
  expect(snapshot(sim).equals(before)).toBe(true);
});

test('materialised ties share the pure history strength calculation rather than the initial edge attribute', () => {
  const sim = quietSim('holo-strength', undefined, []), [a, b] = sim.people.residentsOfBlock(sim.w.districts[0].cellIds[0]);
  const id = tieEdgeId(a, b);
  sim.k.addEdge({ id, type: 'xf:tie', from: a, to: b, attrs: { kind: 'friend', strength: 0 }, valid: { from: 0 }, cause: a });
  const rec = sim.record.tieHistory[id] = { entries: [{ at: 0, event: 'probe', kind: 'favour', reason: 'favour', salience: 3 }], hours: 0, disclosures: 0, favours: 0, lastLoss: { trustA: 0, trustB: 0, trustI: 0 } };
  expect(sim.tiePolicy.strengthOf(a, b)).toBe(0.25);
  const later = 365 * 86400, expectedLater = sim.tiePolicy.strengthOf(a, b, later);
  forbidResolution(sim); const before = snapshot(sim), observer = new HolotableObserver(sim);
  expect(observer.sample().layers.get('ties')!.find((i) => i.id === id)!.value!.strength).toBe(0.25);
  expect(recordedTieStrength(rec, sim.data.ties.strength, later)).toBe(expectedLater);
  expect(snapshot(sim).equals(before)).toBe(true);
  sim.k.now = later;
  expect(observer.sample().layers.get('ties')!.find((i) => i.id === id)!.value!.strength).toBe(expectedLater);
});

test('explicit item branches win and global replacements invalidate branch signatures and tombstones', () => {
  const publisher = new RunPublisher(tempDir(), { set: 'branch-replacements', title: 'Branch replacements', from: 0, to: 100 });
  const item: Item = { schema: 'xfh/item-1', id: 'actor', kind: 'actor', t: 0, anchor: { region: 'place' }, cite: 'se:node:actor', value: { name: 'red' } };
  const publish = (t: number, branch?: string, name = 'red', explicit?: string) => publisher.publish({ t, branch, layers: new Map([['people', [{ ...item, t, value: { name }, ...(explicit ? { branch: explicit } : {}) }]]]) });
  publish(0, 'save-b', 'red', 'save-a');
  expect(rows(publisher)[0].branch).toBe('save-a');
  publish(10, undefined, 'blue'); publish(20, 'save-a');
  expect(rows(publisher).map((i) => [i.branch, i.value.name])).toEqual([['save-a', 'red'], [undefined, 'blue'], ['save-a', 'red']]);
  // Even a global value equal to the earlier global value must supersede red.
  publish(30, undefined, 'blue');
  publisher.publish({ t: 40, branch: 'save-a', layers: new Map([['people', []]]) });
  publish(50, undefined, 'blue');
  publisher.publish({ t: 60, branch: 'save-a', layers: new Map([['people', []]]) });
  expect(rows(publisher).slice(-3)).toEqual([{ retract: 'actor', t: 40, branch: 'save-a' }, expect.objectContaining({ id: 'actor', t: 50 }), { retract: 'actor', t: 60, branch: 'save-a' }]);
});

test('previously emitted district people layers remain present when empty and retract their actors', () => {
  const sim = quietSim('holo-empty-district', undefined, []), cell = sim.w.districts[0].cellIds[0];
  const ids = Array.from({ length: 4001 }, (_, i) => H(s(`district-actor-${i}`)));
  for (const id of ids) sim.k.store.addHeader({ id, kind: 'xf:resident', origin: { by: 'value', owner: cell, slot: id } });
  const observer = new HolotableObserver(sim), first = observer.sample(), layer = [...first.layers].find(([key, items]) => key.startsWith('people-') && items.length === 4001)![0];
  const publisher = new RunPublisher(tempDir(), { set: 'empty-district', title: 'Empty district', from: observer.epoch, to: observer.epoch + 100 });
  publisher.publish(first);
  for (const id of ids) sim.k.store.removeHeader(id);
  forbidResolution(sim); const before = snapshot(sim), next = observer.sample();
  expect(next.layers.get(layer)).toEqual([]);
  expect(snapshot(sim).equals(before)).toBe(true);
  publisher.publish({ ...next, t: next.t + 10 });
  expect(publisher.counts()[layer].live).toBe(0);
  expect(rows(publisher, layer).filter((i) => i.retract)).toHaveLength(4001);
});

test('missing event digest is coarse, but an omitted sparse band in a present digest is quiet', () => {
  const sim = quietSim('holo-heat', undefined, []), observer = new HolotableObserver(sim);
  for (const item of observer.sample().layers.get('places')!) {
    expect(item.facets!['heat band']).toBe(COARSE); expect(item.tone).toBeUndefined();
  }
  sim.k.evolution.digestPeek = <T>(id: string) => (id === 'city.events' ? { bands: {}, regimes: [], refuge: {} } : undefined) as T | undefined;
  forbidResolution(sim); const before = snapshot(sim);
  for (const item of observer.sample().layers.get('places')!) {
    expect(item.facets!['heat band']).toBe('quiet'); expect(item.tone).toBe('muted');
  }
  expect(snapshot(sim).equals(before)).toBe(true);
});

test('director uses the known entry pattern and marks absent pattern, candidate and score as not recorded', () => {
  const sim = quietSim('holo-director', undefined, []);
  const pool: PoolEntry[] = [{ id: 'entry', pattern: 'known-pattern', version: 1, seq: 1, bindingKey: 'binding', bindings: {}, stages: [], firstTime: 0, lastTime: 0, complete: false, refusals: 0, cooldownUntil: 0 }];
  const log = (seq: number, data: Record<string, unknown>): LogEntry => ({ seq, data, kind: 'sow', at: { game: 0, playTotal: 0, playClock: 0 }, purpose: 'schedule', class: 0, rule: 'sow', inputs: {}, chain: [] });
  forbidResolution(sim); const before = snapshot(sim);
  const items = new HolotableObserver(sim, undefined, layer3(pool, [log(1, { entry: 'entry' }), log(2, {}), log(3, { pattern: 'explicit' })])).sample().layers.get('director')!;
  expect(items.map((i) => i.facets!.pattern)).toEqual(['known-pattern', 'not recorded', 'explicit']);
  for (const i of items) expect(i.facets).toMatchObject({ 'candidate kind': 'not recorded', score: 'not recorded' });
  expect(snapshot(sim).equals(before)).toBe(true);
});

test('standalone manifests require a lowercase set slug and strictly increasing span', () => {
  const manifest = { schema: 'xfh/layer-1', producer: 'story-engine', layer: 'test', title: 'Test', clock: 'game', content: 'full', kinds: ['point'], standalone: { set: 'valid-set-1', clock: 'game', from: 0, to: 1 } };
  validateManifest(manifest);
  for (const set of ['Bad', 'has space', '-edge', 'edge-', 'double--dash', 'x'.repeat(65), '']) expect(() => validateManifest({ ...manifest, standalone: { ...manifest.standalone, set } })).toThrow('standalone');
  for (const to of [0, -1]) expect(() => validateManifest({ ...manifest, standalone: { ...manifest.standalone, to } })).toThrow('standalone');
});
