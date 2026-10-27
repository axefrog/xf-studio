import { expect, test } from 'bun:test';
import { readFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as text from '../../src/wording/index.ts';
import vocabulary from '../../../../../research/story-engine/composite/vocabulary.json';
import { allEventKindNames, participantRoles } from '../../src/sim/kinds.ts';
import { defaultData } from '../../src/sim/data.ts';
import { ROLES } from '../../src/sim/profile.ts';
import { HolotableObserver } from '../../src/holotable/observe.ts';
import { RunPublisher } from '../../tools/holotable/publish-run.ts';
import { validateManifest, validateRecord, type Item } from '../../src/holotable/schema.ts';
import { layeredWeek } from '../s3/layered-week.ts';
import { quietSim } from '../sim/helpers.ts';
import { ownedId } from '../../src/id.ts';
import type { EventView } from '../../src/procedural/types.ts';
import type { Layer3 } from '../../src/procedural/layer3.ts';
import type { PoolEntry } from '../../src/procedural/types.ts';
import { ShadowHost } from '../../src/shadow/host.ts';
import { defaultReader, type Batch, type WorldPack } from '../../src/shadow/feed.ts';

// Independent oracle: scan runs and parse exponent mantissa/suffix pairs,
// rather than reuse the producer's guard or its combined regular expression.
function hasInternals(value: string): boolean {
  if (/se:|xf[.:]|\?[a-z]|[{}\[\]]|not recorded|not opened|\bcoarse\b/i.test(value)) return true;
  for (let i = 0; i < value.length - 1; i++) if (value[i] === '.' && '0123456789'.includes(value[i + 1])) return true;
  let hex = 0, digits = 0;
  for (const char of value.toLowerCase()) {
    hex = '0123456789abcdef'.includes(char) ? hex + 1 : 0;
    digits = '0123456789'.includes(char) ? digits + 1 : 0;
    if (hex >= 16 || digits >= 10) return true;
  }
  for (const token of value.split(/\s+/)) for (let i = 0; i < token.length; i++) {
    if (token[i].toLowerCase() !== 'e') continue;
    const before = token.slice(0, i), after = token.slice(i + 1);
    if (/(?:\d+\.?\d*|\.\d+)$/.test(before) && /^[+-]?\d/.test(after)) return true;
  }
  return false;
}
export function readable(item: Item) {
  for (const value of [item.label, item.detail, ...Object.keys(item.facets ?? {}), ...Object.values(item.facets ?? {}), item.value?.name, item.value?.role, item.value?.type]) if (value) expect(hasInternals(value)).toBe(false);
}
function scratch<T>(run: (dir: string) => T): T {
  const dir = resolve(import.meta.dir, '../../../../../.scratch-holo1', randomUUID());
  mkdirSync(dir, { recursive: true });
  try { return run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('wording covers the vocabulary, all 29 patterns, registered event kinds and community/participant roles', () => {
  expect(Object.keys(text.wording.functions).sort()).toEqual(vocabulary.functions.map((f) => f.id).sort());
  expect(Object.keys(text.wording.patterns)).toHaveLength(29);
  for (const key of Object.keys(text.wording.patterns)) expect(text.patternInfo('xf.composite:' + key)).toBeDefined();
  for (const kind of allEventKindNames(defaultData())) expect(Object.keys(text.wording.events)).toContain(kind);
  for (const role of [...ROLES, ...participantRoles()]) expect(text.roleWord(role)).toBeDefined();
});
test('the agreed optional titles fall back without a missing role or dangling text', () => {
  const names = text.names(new Map([['guard', 'the Mox'], ['ward', 'Mara'], ['interceptor', 'Jun']]), 'v');
  expect(text.title({ pattern: 'xf.composite:protection', bindings: { '?gd': 'guard', '?wd': 'ward' } }, names)).toBe('Protection: the Mox looks after Mara');
  expect(text.title({ pattern: 'xf.composite:interception', bindings: { '?i': 'interceptor' } }, names)).toBe('Interception: Jun goes after a delivery');
  expect(text.title({ pattern: 'xf.composite:hunted', bindings: { '?h': 'guard', '?q': 'v' } }, names)).toBe('Hunted: the Mox are after you');
});
test('why chains are oldest first, cycle safe, limited to five events and signal earlier causes', () => {
  const events = new Map<string, EventView>();
  for (let i = 0; i < 8; i++) events.set(String(i), { id: String(i), kind: 'outage', time: i * 60, creator: 'c', cause: 'c', name: 'power', participants: [], effects: [], witnesses: [], causes: i ? [String(i - 1)] : [] });
  const chain = text.why('7', 20, events, () => undefined);
  expect(chain).toHaveLength(6);
  expect(chain[0]).toBe('Day 1, 00:03: The power went out.');
  expect(chain[4]).toBe('Day 1, 00:07: The power went out.');
  expect(chain[5]).toBe('(earlier causes not shown)');
  events.get('0')!.causes = ['1'];
  expect(text.why('1', 5, events, () => undefined)).toHaveLength(2);
});
test('shares show three named affiliations, whole percentages and the remaining share', () => {
  expect(text.share({ TygerClaws: 7, TheMox: 6, civilian: 73, ncpd: 5, Scavengers: 4, other: 5 })).toBe('civilians 73 % · Tyger Claws 7 % · Mox 6 % · others 14 %');
  expect([.33, .34, .66, .67].map(text.strength)).toEqual(['weak', 'moderate', 'moderate', 'strong']);
  const rounded = text.share({ TygerClaws: .335, TheMox: .335, civilian: .3299, ncpd: .0001 })!;
  expect(rounded).not.toContain('-');
  expect([...rounded.matchAll(/(\d+) %/g)].reduce((n, m) => n + Number(m[1]), 0)).toBe(100);
  expect(text.time(90000, 86400)).toBe('Day 1, 01:00');
});
test('a named opening moves one resident out of the crowd without resolving during observation', () => {
  const sim = quietSim('readability-crowd', undefined, []), cell = sim.w.districts[0].cellIds[0];
  const expected = sim.people.populationSnapshot().get(cell)!, observer = new HolotableObserver(sim);
  const count = (items: Item[]) => Number(items.find((i) => i.id === `crowd-${cell}`)?.label?.match(/About (\d+)/)?.[1] ?? 0);
  const before = observer.sample().layers.get('people')!;
  expect(count(before)).toBe(expected); // genuinely cold: no resident enumeration
  const residents = sim.people.residentsOfBlock(cell);
  expect(count(observer.sample().layers.get('people')!)).toBe(expected);
  const person = residents.find((id) => !before.some((i) => i.id === id))!;
  sim.k.value(sim.k.address(person, 'name'), 'display');
  const display = sim.k.store.nodes.get(ownedId(person, 'name'))!.slots.get('display')!;
  sim.k.value = () => { throw Error('Observer resolved a slot'); };
  const after = observer.sample().layers.get('people')!;
  expect(after.find((i) => i.id === person)!.value!.name).toBe(display.s === 'resolved' ? String(display.value) : undefined);
  expect(count(after)).toBe(count(before) - 1);
});
test('the complete fixture week is readable and bounded in both modes; default spools pass the current consumer', async () => {
  const consumer = await import(resolve(import.meta.dir, '../../../../xf-holotable/src/layers.ts'));
  scratch((dir) => {
    const ordinary = new RunPublisher(join(dir, 'compatibility'), { set: 'readability-week', title: 'Fixture', from: 0, to: 604800 }, { holotableHooks: false });
    const hooks = new RunPublisher(join(dir, 'default'), { set: 'readability-week', title: 'Fixture', from: 0, to: 604800 });
    let observer: HolotableObserver | undefined;
    layeredWeek('pay', false, { steps: 1002, horizon: 601200, sample(sim, l2, l3) {
      observer ??= new HolotableObserver(sim, l2, l3, { gameEpochSeconds: 0 });
      const observation = observer.sample();
      for (const items of observation.layers.values()) for (const item of items) {
        readable(item);
        expect(item.facets?.layout).toBeUndefined();
        if (item.label?.startsWith('Held back:')) expect(item.facets?.checks).toBeUndefined();
      }
      ordinary.publish(observation); hooks.publish(observation);
    } });
    for (const [folder, enabled] of [['compatibility', false], ['default', true]] as const) for (const file of readdirSync(join(dir, folder))) {
      const [manifest, ...records] = readFileSync(join(dir, folder, file), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      validateManifest(manifest);
      if (enabled) { expect(manifest.producer_title).toBe('Story Engine'); expect(Object.keys(manifest.facet_titles!).length).toBeLessThanOrEqual(16); }
      else { expect(manifest.producer_title).toBeUndefined(); expect(manifest.facet_titles).toBeUndefined(); }
      expect(consumer.validateManifest(manifest)).toBeNull();
      for (const record of records) {
        validateRecord(record, manifest);
        expect(consumer.validateRecord(record, manifest)).toBeNull();
        if ('id' in record) readable(record);
      }
      if (file === 'events.jsonl') {
        const items = records.filter((r) => 'id' in r);
        expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
        expect(items.some((i) => i.detail?.includes('\n'))).toBe(enabled);
      }
    }
  });
}, 120000);
test('hook text and multiline detail obey the confirmed consumer bounds', () => {
  const m = { schema: 'xfh/layer-1', producer: 'story-engine', layer: 'events', title: 'Events', content: 'full', clock: 'recording', session: 's', run: 1, kinds: ['point'] };
  for (const producer_title of ['', 'x'.repeat(81), 'x\n']) expect(() => validateManifest({ ...m, producer_title })).toThrow();
  for (const facet_titles of [{ ['x'.repeat(41)]: 'A' }, { x: 'x'.repeat(61) }, Object.fromEntries(Array.from({ length: 17 }, (_, i) => [String(i), 'A']))]) expect(() => validateManifest({ ...m, facet_titles })).toThrow();
  validateManifest(m);
  const item: Item = { schema: 'xfh/item-1', id: 'one', kind: 'point', t: 0, anchor: { region: 'r' }, cite: 'se:event:one' };
  validateRecord({ ...item, detail: 'Summary\n\nCause' }, m);
  for (const detail of ['a\rb', 'a\tb', Array(41).fill('a').join('\n'), 'a'.repeat(4001)]) expect(() => validateRecord({ ...item, detail }, m)).toThrow();
});
test('compatibility detail separates the summary from causes; hook mode preserves the original lines', () => scratch((dir) => {
  const original = 'Mara paid Jun.\n\nDay 1, 00:20: Jun came to collect.\nDay 1, 00:34: Mara paid Jun.';
  for (const enabled of [false, true]) {
    const folder = join(dir, String(enabled));
    const publisher = new RunPublisher(folder, { set: 'detail', title: 'Detail', from: 0, to: 10 }, enabled ? undefined : { holotableHooks: false });
    const base: Item = { schema: 'xfh/item-1', id: 'paid', kind: 'point', t: 0, anchor: { region: 'r' }, cite: 'se:event:paid' };
    publisher.publish({ t: 0, layers: new Map([['events', [
      { ...base, detail: original },
      { ...base, id: 'summary', detail: 'A quiet moment.' },
      { ...base, id: 'story', detail: 'A debt came due.\nWaiting for Mara to pay Jun.\n\nDay 1, 00:20: Jun came to collect.' },
    ]]]) });
    const records = readFileSync(join(folder, 'events.jsonl'), 'utf8').trim().split('\n').slice(1).map((s) => JSON.parse(s));
    expect(records[0].detail).toBe(enabled ? original : 'Mara paid Jun. Why: Day 1, 00:20: Jun came to collect. → Day 1, 00:34: Mara paid Jun.');
    expect(records[1].detail).toBe('A quiet moment.');
    if (!enabled) expect(records[2].detail).toBe('A debt came due. Waiting for Mara to pay Jun. Why: Day 1, 00:20: Jun came to collect.');
  }
}));
test('a compatibility-mode overflow remains single-line and passes the current consumer', async () => {
  const consumer = await import(resolve(import.meta.dir, '../../../../xf-holotable/src/layers.ts'));
  scratch((dir) => {
    const publisher = new RunPublisher(dir, { set: 'overflow', title: 'Overflow', from: 0, to: 10 }, { holotableHooks: false });
    publisher.publish({ t: 0, layers: new Map([['events', [{ schema: 'xfh/item-1', id: 'overflow', kind: 'point', t: 0, anchor: { region: 'r' }, cite: 'se:event:overflow', label: 'A story. '.repeat(25), detail: 'A summary.\n' + 'A cause.\n'.repeat(39), facets: { who: 'A neighbour. '.repeat(60) } } as Item]]]) });
    const [manifest, record] = readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((s) => JSON.parse(s));
    expect(record.detail).not.toContain('\n');
    expect(consumer.validateRecord(record, manifest)).toBeNull();
  });
});
test('story stepping ignores timestamps, pending bookkeeping and scores, and stops on a match', () => scratch((dir) => {
  const sim = quietSim('readability-stops', undefined, []), [a, b] = sim.people.residentsOfBlock(sim.w.districts[0].cellIds[0]);
  const entry = { id: 'story', pattern: 'xf.composite:debt', bindings: { '?d': a, '?c': b }, stages: [], complete: false,
    graph: { junctures: { paid: { state: 'ready', readySince: 0 } }, retired: false } } as unknown as PoolEntry;
  const l3 = { state: { pool: [entry], evidence: [], buffer: [] }, log: [], threadView: [], sifter: { patterns: new Map([['xf.composite:debt', { graph: text.patternInfo('xf.composite:debt') }]]) } } as unknown as Layer3;
  const observer = new HolotableObserver(sim, undefined, l3), publisher = new RunPublisher(dir, { set: 'stops', title: 'Stops', from: observer.epoch, to: observer.epoch + 100 });
  publisher.publish(observer.sample());
  sim.k.now = 10; entry.graph!.junctures.paid.readySince = 10; entry.graph!.junctures.paid.state = 'pending'; entry.refusals = 20;
  publisher.publish(observer.sample());
  expect(publisher.counts().stories.revisions).toBe(3); // point plus two role relations
  entry.graph!.junctures.paid.state = 'matched';
  entry.graph!.junctures.paid.filler = { id: 'paid', at: 10, args: { debtor: a, creditor: b } } as never;
  publisher.publish(observer.sample());
  expect(publisher.counts().stories.revisions).toBe(4);
}));
test('shadow mode publishes the same readable wording through the shared observer', () => scratch((dir) => {
  const world: WorldPack = { schema: 'xfh/world-pack-1', provenance: { game: 'synthetic', source: 'test', built: 'test' }, cells: [],
    areas: ['Kabuki', 'Northside', 'LittleChina'].map((name, i) => ({ id: `Districts.${name}`, name, kind: 'district', poly: [[i * 100, 0], [i * 100 + 90, 0], [i * 100 + 90, 90], [i * 100, 90]], zlo: -20, zhi: 200 })) };
  const meta: Batch['meta'] = { schema: 'xfh/session-1', session: 'wording', run: 1, worldGeneration: 1, pluginVersion: 'test', start: 100, end: 260, from: 100, to: 260, channels: [], complete: true, dropped: 0, missedDeadlines: 0, largestGapS: 0, coverage: 'synthetic', problems: [] };
  const host = new ShadowHost(defaultReader, world, meta, dir);
  expect([...host.sim.k.store.headers.values()].filter((h) => /^xf:resident/.test(h.kind))).toHaveLength(0);
  const cold = host.observer.sample(), expected = host.sim.people.populationSnapshot();
  for (const [cell, count] of expected) if (count) {
    const row = [...cold.layers.values()].flat().find((item) => item.id === `crowd-${cell}`);
    expect(row?.label).toBe(`About ${count} people in the background`);
    expect(row?.facets?.about).toContain('Numbers are estimates until people are simulated individually.');
  }

  host.consume({ meta, v: [100, 180, 260].map((t, seq) => ({ t, seq, position: [20, 20, 0], yaw: 0, speed: 0, health: 100, healthMax: 100, inCombat: false, vehicle: false, busy: '' })), actors: [{ t: 101, who: 'a1', valid: true, entity: 'entity-1', position: [21, 20, 0] }], camera: [], events: [], gaps: [] });
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) for (const line of readFileSync(join(dir, file), 'utf8').trim().split('\n').slice(1)) {
    const record = JSON.parse(line); if ('id' in record) readable(record);
  }
}));

test('the internals checker covers facet keys as well as values', () => {
  const item: Item = { schema: 'xfh/item-1', id: 'one', kind: 'point', t: 0, anchor: { region: 'r' }, cite: 'se:node:one', facets: { 'xf.item:hidden': 'A key' } };
  expect(() => readable(item)).toThrow();
  expect(() => readable({ ...item, facets: { holder: 'Mara' } })).not.toThrow();
});

test('guard and independent checker reject embedded hashes, exponent numbers, long digits and syntax fragments', () => {
  const bad = ['key_1234567890abcdef1234567890abcdef', 'prefix_DEADBEEFDEADBEEF_suffix', 'key_0123456789abcdef', '1e-7', '2E+10', '.5e2', '-1.2e-3', 'rate_3e7_value', 'key_0.123_value', '.5', '-.5', '+.5', 'label_.5_suffix', '1234567890', 'xf.item:key', '?x', '{"key":', '["fragment"'];
  const base: Item = { schema: 'xfh/item-1', id: 'one', kind: 'point', t: 0, anchor: { region: 'r' }, cite: 'se:node:one' };
  for (const value of bad) {
    expect(text.displayText(value)).toBeUndefined();
    for (const fields of [{ label: value }, { detail: value }, { facets: { [value]: 'Mara' } }, { facets: { who: value } }, { value: { name: value } }, { value: { type: value } }]) expect(() => readable({ ...base, ...fields })).toThrow();
  }
  for (const value of ['Mara Ilić', 'Day 2, 14:05', 'About 27 people in the background', 'civilians 81 %', 'block 123456789']) {
    expect(text.displayText(value)).toBe(value);
    expect(() => readable({ ...base, label: value, facets: { about: value } })).not.toThrow();
  }
});

test('leading-dot decimal item labels are replaced before publication', () => scratch((dir) => {
  const sim = quietSim('leading-dot-items', undefined, []), k = sim.k;
  for (const [i, label] of ['.5', '-.5', '+.5'].entries()) {
    const item = k.root(`decimal-item-${i}`, 'xf:item');
    k.pin({ node: item, slot: 'label', value: label, reason: 'authored', cause: sim.w.v });
    k.value(item, 'label');
    k.addEdge({ type: 'xf:held-by', from: item, to: sim.w.v, cause: sim.w.v });
    expect(text.itemName(label)).toBe('an item');
  }
  const observer = new HolotableObserver(sim), observation = observer.sample();
  const publisher = new RunPublisher(dir, { set: 'decimal-items', title: 'Decimal items', from: observation.t, to: observation.t + 10 });
  publisher.publish(observation);
  const records = readFileSync(join(dir, 'items.jsonl'), 'utf8').trim().split('\n').slice(1).map((line) => JSON.parse(line));
  expect(records).toHaveLength(3);
  for (const item of records) { expect(item.label).toBe('An item'); readable(item); }
}));
