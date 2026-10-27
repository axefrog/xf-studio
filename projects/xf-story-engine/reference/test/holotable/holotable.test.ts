import { afterAll, expect, test, setDefaultTimeout } from 'bun:test';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { serialize } from 'node:v8';
import { spawnSync } from 'node:child_process';
import { HolotableObserver } from '../../src/holotable/observe.ts';
import { validateManifest, validateRecord, type Item, type Manifest } from '../../src/holotable/schema.ts';
import { RunPublisher, checkItemBounds } from '../../tools/holotable/publish-run.ts';
import { GLYPHS, BADGES } from '../../src/holotable/glyphs.ts';
import { layeredWeek } from '../s3/layered-week.ts';
import { quietSim } from '../sim/helpers.ts';
import type { Sim } from '../../src/sim/sim.ts';
import type { Layer2 } from '../../src/seeding/layer2.ts';
import type { Layer3 } from '../../src/procedural/layer3.ts';
import { H, s } from '../../src/id.ts';
import { People } from '../../src/sim/people.ts';
import { schematicLayout } from '../../src/holotable/layout.ts';
import { makeKabukiSlice } from '../../src/sim/slices.ts';

setDefaultTimeout(180_000);
const scratch = resolve(import.meta.dir, '../../../../../.scratch-holo1');
const folders: string[] = [];
function tempDir() {
  mkdirSync(scratch, { recursive: true });
  const dir = join(scratch, `test-${randomUUID()}`); mkdirSync(dir); folders.push(dir); return dir;
}
afterAll(() => { for (const dir of folders) rmSync(dir, { recursive: true, force: true }); });
const imageData = (sim: Sim, l2?: Layer2, l3?: Layer3) => ({
  store: sim.k.store.capture(), references: sim.k.store.referencesVersion,
  revision: sim.k.revision, epoch: sim.k.epoch, now: sim.k.now, pending: sim.k.pending,
  frames: sim.k.frames.capture(), beliefs: sim.k.beliefs.capture(), processes: sim.k.evolution.states,
  queued: sim.k.evolution.queued, record: sim.record, seeds: sim.k.retention.seeds,
  log: l3?.log, state: l3?.state, threads: l3?.threadView, instances: l2?.all().map((i) => i.st),
});
const image = (sim: Sim, l2?: Layer2, l3?: Layer3) => serialize(imageData(sim, l2, l3));

test('observer on/off: identical records, digests, draws and transcript, including save/load', () => {
  const shared = People.shared;
  // Equal cold starting conditions for both executions, including ephemeral
  // caches. The shared population memo otherwise warms during the first arm.
  People.shared = false;
  try {
  for (const reload of [false, true]) {
    const execute = (observed: boolean) => {
      const samples: string[] = [];
      let observer: HolotableObserver | undefined;
      const result = layeredWeek('pay', reload, {
        sample(sim, l2, l3) {
          // Stronger than the saved-state check: a sample cannot even populate
          // an ephemeral slot/header cache or move a process cursor.
          if (observed) {
            observer ??= new HolotableObserver(sim, l2, l3);
            const before = image(sim, l2, l3);
            observer.sample(); observer.sample();
            expect(image(sim, l2, l3).equals(before)).toBe(true);
          }
          samples.push(JSON.stringify({ digests: [...sim.k.evolution.states], record: sim.record, log: l3.log, instances: l2.all().map((i) => i.st) }));
        },
        finish(sim, l2, l3) {
          // Identical writer histories and exact final save bytes as well.
          sim.k.persistence.save('holo-proof');
          samples.push(JSON.stringify([...sim.k.persistence.chain]));
          samples.push(JSON.stringify(imageData(sim, l2, l3), (_, v) => v instanceof Map ? { map: [...v] } : v instanceof Set ? { set: [...v] } : v));
        },
      });
      return { result: JSON.stringify(result), samples };
    };
    const observed = execute(true), control = execute(false);
    expect(observed.result === control.result).toBe(true);
    for (let i = 0; i < observed.samples.length; i++) {
      if (observed.samples[i] !== control.samples[i]) {
        const a = observed.samples[i], b = control.samples[i];
        let j = 0; while (j < a.length && a[j] === b[j]) j++;
        throw Error(`Pair differs at sample ${i}, byte ${j}: ${a.slice(j, j + 160)} versus ${b.slice(j, j + 160)}`);
      }
    }
  }
  } finally { People.shared = shared; }
});

test('coarse residents, explicit entity bindings, frame/place/event/item belief endpoints and ties', () => {
  const sim = quietSim('holo-mapping', undefined, []), k = sim.k;
  const cell = sim.w.districts[0].cellIds[0], [a, b] = sim.people.residentsOfBlock(cell);
  const role = k.value(a, 'role'); k.value(k.address(a, 'name'), 'display');
  const parent = k.events.mintEvent({ creator: a, cause: a, name: 'holo-parent', kind: 'generic', time: 0, place: cell });
  const event = k.events.mintEvent({ creator: a, cause: parent, name: 'holo-child', kind: 'generic', time: 0, place: cell, causes: [parent], participants: [{ who: a, role: 'actor' }], outcome: 'done' });
  const frame = k.frames.open({ actor: a, origin: a, cause: event, level: 'goal', status: 'blocked', weight: 1, focus: { nodes: [cell], tier: 3 } });
  const item = k.root('holo-prop', 'xf:item');
  k.addEdge({ type: 'xf:held-by', from: item, to: b, cause: event, valid: { from: -1, to: 0 } });
  k.addEdge({ type: 'xf:held-by', from: item, to: a, cause: event, valid: { from: 0 } });
  const tie = k.addEdge({ type: 'xf:tie', from: a, to: b, attrs: { kind: 'colleague', strength: 0 }, cause: event, valid: { from: 0 } });
  sim.record.tieHistory[tie.id] = { entries: [], hours: sim.data.ties.strength.sharedHoursFull, disclosures: 1 / sim.data.ties.strength.disclosureStep, favours: sim.data.ties.strength.favoursFull, lastLoss: { trustA: 0, trustB: 0, trustI: 0 } };
  k.addEdge({ type: 'core:member-of', from: a, to: sim.w.group(sim.w.districts[0].id, 'A1'), attrs: { strength: 0.5 }, cause: event, valid: { from: 0 } });
  for (const [subject, path, value] of [[event, 'outcome', 'failed'], [frame.id, 'status', 'active'], [cell, 'public', 'public'], [item, 'label', 'prop']] as const) k.beliefs.set({
    believer: a, subject, path, value, confidence: 1, evidence: [event], formed: 0, refreshed: 0, memorable: true, source: { by: 'observed', event },
  });
  k.beliefs.set({ believer: b, subject: event, path: 'outcome', region: { r: 'set', values: ['done', 'prevented'] }, confidence: 1, evidence: [event], formed: 0, refreshed: 0, memorable: true, source: { by: 'observed', event } });
  const observer = new HolotableObserver(sim, undefined, undefined, { entities: new Map([[a, 'entity-a']]) });
  // Any accidental use of these familiar 'reads' must fail before it can repair
  // state or draw a name/routine; the before/after image independently checks it.
  const forbidden = () => { throw Error('Observer tried to resolve/materialise'); };
  k.value = forbidden; k.resolve = forbidden; k.address = forbidden;
  k.persistence.recoverIfSaved = forbidden; k.persistence.restoreReferencedHeader = forbidden;
  sim.people.view = forbidden; sim.people.where = forbidden;
  const before = image(sim), observation = observer.sample();
  expect(image(sim).equals(before)).toBe(true);
  const people = observation.layers.get('people')!;
  const actor = people.find((i) => i.id === a)!;
  expect(actor.anchor).toEqual({ entity: 'entity-a' });
  expect(actor.value!.role).toBeDefined();
  expect(actor.label).toContain(actor.value!.name!);
  expect(actor.facets!.doing).toBeUndefined(); // unknown is absent
  expect(observation.layers.get('detail')!.find((i) => i.id === cell)!.label).toBe('Simulated in full detail');
  const ties = observation.layers.get('ties')!;
  expect(ties.find((i) => i.value?.type === 'works with')!.value!.strength).toBe(0.75);
  expect(ties.find((i) => i.value?.type === 'holds')!.value!.to).toEqual({ item: `story-engine/items/${item}` });
  const prop = observation.layers.get('items')![0];
  expect(prop.anchor).toEqual({ entity: 'entity-a' });
  expect(prop.facets!.holder).toBe(actor.value!.name!);
  const beliefs = observation.layers.get('beliefs')!;
  expect(beliefs.find((i) => i.cite.startsWith('se:belief:') && i.value?.type === 'is wrong about')).toBeDefined();
  expect(beliefs.some((i) => i.value!.to?.item === `story-engine/people/${a}`)).toBe(true);
  expect(beliefs.some((i) => i.value!.to?.item === `story-engine/places/${cell}`)).toBe(false); // the synthetic place has no known name
  // Unknown item names are absent, and the complete event cause chain is prose.
  expect(observation.layers.get('events')!.find((i) => i.id === event)!.detail).toContain('Day 1, 00:00:');
  expect(observation.layers.get('events')!.every((i) => i.kind === 'point')).toBe(true);
});

test('13 manifests, schema/citations/bounds, shared standalone span, deduplication and retractions', () => {
  const dir = tempDir(), sim = quietSim('holo-spool', undefined, []);
  const observer = new HolotableObserver(sim), publisher = new RunPublisher(dir, { set: 'fixture-week', title: 'Fixture week', from: observer.epoch, to: observer.epoch + 1200 });
  const first = observer.sample(); publisher.publish(first);
  const bytes = JSON.stringify(publisher.counts()); publisher.publish(first);
  expect(JSON.stringify(publisher.counts())).toBe(bytes);
  const next = structuredClone(first); next.t += 600;
  next.layers.set('people', []); publisher.publish(next);
  expect(publisher.counts().people.live).toBe(0);
  expect(readdirSync(dir).length).toBe(13);
  for (const file of readdirSync(dir)) {
    const [m, ...records] = readFileSync(join(dir, file), 'utf8').trim().split('\n').map((s) => JSON.parse(s));
    validateManifest(m);
    expect(m.standalone).toEqual({ set: 'fixture-week', title: 'Fixture week', from: observer.epoch, to: observer.epoch + 1200, clock: 'game' });
    expect(m.branch).toBeUndefined();
    for (const r of records) {
      validateRecord(r, m);
      if ('id' in r) {
        expect(GLYPHS.has(r.glyph!)).toBe(true);
        if (r.badge !== undefined) expect(BADGES.has(r.badge)).toBe(true);
      }
    }
    checkItemBounds(records, file);
    expect(Buffer.byteLength(readFileSync(join(dir, file)))).toBeLessThan(16 * 1024 * 1024);
  }
  expect(() => new RunPublisher(dir, publisher.run)).toThrow('already contains');
});

test('branch and epoch semantics, and bounded validation refuses malformed items atomically', () => {
  const sim = quietSim('holo-branch', undefined, []);
  const observer = new HolotableObserver(sim, undefined, undefined, { gameEpochSeconds: 36000 });
  expect(new HolotableObserver(sim).epoch).toBe(sim.w.index.clock?.sod0 ?? 0);
  expect(observer.sample().branch).toBeUndefined();
  sim.k.persistence.save('save-a');
  expect(observer.sample().branch).toBe('save-a');
  const publisher = new RunPublisher(tempDir(), { set: 'branch-test', title: 'Branch test', from: 36000, to: 37200 });
  publisher.publish(observer.sample());
  const before = JSON.stringify(publisher.counts()), bad = observer.sample();
  bad.layers.get('places')![0].cite = 'se:unknown:bad';
  expect(() => publisher.publish(bad)).toThrow('citation');
  expect(JSON.stringify(publisher.counts())).toBe(before);
  const m = JSON.parse(readFileSync(join(publisher.directory, 'places.jsonl'), 'utf8').split('\n')[0]) as Manifest;
  const good = observer.sample().layers.get('places')![0];
  expect(() => validateRecord({ ...good, facets: { bad: 'x'.repeat(501) } }, m)).toThrow('Facets');
  expect(() => validateRecord({ ...good, t: NaN }, m)).toThrow();
  expect(() => validateRecord({ ...good, kind: 'field' }, m)).toThrow();
  expect(() => validateRecord({ ...good, anchor: { at: [0, Infinity, 0] } }, m)).toThrow();
});

test('layer bound counts distinct item ids across expiry, retractions, replacements and branches', () => {
  const item: Item = { schema: 'xfh/item-1', id: 'one', kind: 'point', t: 0, until: 1, anchor: { region: 'test' }, cite: 'se:node:one' };
  const items = Array.from({ length: 5000 }, (_, i) => ({ ...item, id: String(i), t: i, until: i + 1 }));
  const retractions = Array.from({ length: 5001 }, (_, i) => ({ retract: String(i), t: 5000 }));
  // Unknown retraction ids do not count; repeated ids across branches count once.
  checkItemBounds([...items, ...retractions, ...items.map((i) => ({ ...i, branch: 'save-a' }))], 'at-limit');
  expect(() => checkItemBounds([...items, { ...item, id: 'extra', t: 5000, until: 5001 }], 'expired')).toThrow('5,000 distinct item ids');
  expect(() => checkItemBounds([...items, { ...item, id: 'extra', branch: 'save-b' }], 'branches')).toThrow('5,000 distinct item ids');

  const publisher = new RunPublisher(tempDir(), { set: 'item-limit', title: 'Item limit', from: 0, to: 5001 });
  publisher.publish({ t: 0, layers: new Map([['events', items]]) });
  publisher.publish({ t: 5000, layers: new Map([['events', items.map((i) => ({ ...i, t: 5000, until: 5001 }))]]) });
  expect(publisher.counts().events).toMatchObject({ items: 5000, revisions: 10000 });
  const path = join(publisher.directory, 'events.jsonl'), before = readFileSync(path, 'utf8');
  expect(() => publisher.publish({ t: 5000, layers: new Map([['events', [{ ...item, id: 'extra', t: 5000, until: 5001 }]]]) })).toThrow('5,000 distinct item ids');
  expect(readFileSync(path, 'utf8')).toBe(before);
  expect(publisher.counts().events).toMatchObject({ items: 5000, revisions: 10000 });
});

test('crossing 4000 unnamed headers changes no people layer or published stops', () => {
  const sim = quietSim('holo-split', undefined, []), cell = sim.w.districts[0].cellIds[0];
  const observer = new HolotableObserver(sim), first = observer.sample();
  const publisher = new RunPublisher(tempDir(), { set: 'header-threshold', title: 'Header threshold', from: first.t, to: first.t + 100 });
  publisher.publish(first);
  const counts = publisher.counts(), path = join(publisher.directory, 'people.jsonl'), bytes = readFileSync(path, 'utf8');
  for (let i = 0; i < 4001; i++) sim.k.store.addHeader({ id: H(s(`holo-person-${i}`)), kind: 'xf:resident', origin: { by: 'value', owner: cell, slot: `fixture-${i}` } });
  sim.k.now += 10;
  const observation = observer.sample(); publisher.publish(observation);
  expect([...observation.layers.keys()].some((l) => l.startsWith('people-'))).toBe(false);
  expect(observation.layers.get('people')!.map((i) => i.id)).toEqual(first.layers.get('people')!.map((i) => i.id));
  expect(publisher.counts()).toEqual(counts);
  expect(readFileSync(path, 'utf8')).toBe(bytes);
});

test('a save branch retracts inherited prefix items only on that branch, once', () => {
  const publisher = new RunPublisher(tempDir(), { set: 'inheritance', title: 'Inheritance', from: 0, to: 100 });
  const item: Item = { schema: 'xfh/item-1', id: 'actor', kind: 'actor', t: 0, anchor: { region: 'place' }, value: { name: 'Actor' }, cite: 'se:node:actor' };
  publisher.publish({ t: 0, layers: new Map([['people', [item]]]) });
  publisher.publish({ t: 10, branch: 'save-a', layers: new Map([['people', []]]) });
  const path = join(publisher.directory, 'people.jsonl');
  let rows = readFileSync(path, 'utf8').trim().split('\n').map((s) => JSON.parse(s));
  expect(rows[0].branch).toBeUndefined();
  expect(rows.at(-1)).toEqual({ retract: 'actor', t: 10, branch: 'save-a' });
  const length = rows.length;
  publisher.publish({ t: 20, branch: 'save-a', layers: new Map([['people', []]]) });
  expect(readFileSync(path, 'utf8').trim().split('\n').length).toBe(length);
  // A sibling still sees the common prefix. Reappearing on the retracted branch
  // publishes a new revision instead of being swallowed by deduplication.
  publisher.publish({ t: 30, branch: 'save-b', layers: new Map([['people', [{ ...item, t: 30 }]]]) });
  publisher.publish({ t: 40, branch: 'save-a', layers: new Map([['people', [{ ...item, t: 40 }]]]) });
  rows = readFileSync(path, 'utf8').trim().split('\n').map((s) => JSON.parse(s));
  expect(rows.at(-1)).toMatchObject({ id: 'actor', t: 40, branch: 'save-a' });
  expect(rows.filter((r) => r.retract).every((r) => r.branch === 'save-a')).toBe(true);
  publisher.publish({ t: 50, layers: new Map([['people', []]]) });
  publisher.publish({ t: 60, branch: 'save-b', layers: new Map([['people', [{ ...item, t: 60 }]]]) });
  rows = readFileSync(path, 'utf8').trim().split('\n').map((s) => JSON.parse(s));
  expect(rows.at(-2)).toEqual({ retract: 'actor', t: 50 });
  expect(rows.at(-1)).toMatchObject({ id: 'actor', t: 60, branch: 'save-b' });
});

test('schematic cells are deterministic, bounded, labelled and place all cell fallbacks', () => {
  const index = makeKabukiSlice();
  const areas = ['Kabuki', 'Northside', 'LittleChina'].map((name) => ({ id: `Districts.${name}`, poly: [[0, 0], [100, 0], [100, 200], [0, 200]] as [number, number][], zlo: -10, zhi: 20 }));
  const layout = schematicLayout(index, areas);
  expect(layout).toEqual(schematicLayout(index, [...areas].reverse()));
  expect(() => schematicLayout(index, [])).toThrow('World pack');
  expect(layout.cells.size).toBe(22);
  for (const anchor of layout.cells.values()) {
    expect(anchor.box.min.every((n, i) => n >= [0, 0, -10][i])).toBe(true);
    expect(anchor.box.max.every((n, i) => n <= [100, 200, 20][i])).toBe(true);
  }
  let sampled = false;
  layeredWeek('pay', false, {
    steps: 1, horizon: 600,
    sample(sim, l2, l3) {
      if (sampled || sim.k.now !== 1200) return;
      sampled = true;
      const obs = new HolotableObserver(sim, l2, l3, { layout }).sample();
      const cell = sim.w.districts[0].cellIds[0];
      const zone = obs.layers.get('places')!.find((i) => i.id === cell)!;
      expect(zone.anchor).toEqual(layout.cells.get(cell)!);
      expect(zone.facets!.layout).toBeUndefined();
      expect(zone.facets!.about).toBe('A sketch of this block, not the real streets yet.');
      expect(Object.keys(zone.facets!).at(-1)).toBe('about');
      for (const detail of obs.layers.get('detail')!) if (layout.cells.has(detail.id)) expect(detail.anchor).toEqual(layout.cells.get(detail.id)!);
      const district = obs.layers.get('places')!.find((i) => i.id === sim.w.districts[0].id)!;
      expect(district.anchor).toEqual({ region: 'Districts.Kabuki' });
      const point = obs.layers.get('events')!.find((i) => i.kind === 'point' && 'item' in i.anchor)!;
      expect(point.facets!.layout).toBeUndefined();
      expect('item' in point.anchor && [...layout.cells.keys()].some((id) => 'item' in point.anchor && point.anchor.item === `story-engine/places/${id}`)).toBe(true);
    },
  });
  expect(sampled).toBe(true);
});

test.skipIf(!process.env.HOLO_VALIDATOR_ROOT)('consumer validator accepts a test run spool (opt-in, read-only consumer checkout)', () => {
  const dir = tempDir();
  let observer: HolotableObserver | undefined, publisher: RunPublisher | undefined;
  layeredWeek('pay', true, {
    sample(sim, l2, l3) {
      observer ??= new HolotableObserver(sim, l2, l3);
      publisher ??= new RunPublisher(dir, { set: 'validation-fixture', title: 'Validation fixture', from: observer.epoch, to: observer.epoch + 12000 });
      publisher.publish(observer.sample());
    },
  });
  const result = spawnSync('bun', ['projects/xf-holotable/tools/holo.ts', 'validate', dir], {
    cwd: process.env.HOLO_VALIDATOR_ROOT, encoding: 'utf8', timeout: 30000,
  });
  if (result.error || result.status !== 0) throw Error(`Consumer refused test spool: ${result.error ?? result.stderr ?? result.stdout}`);
  expect(result.stdout).toContain('no refusals');
});
