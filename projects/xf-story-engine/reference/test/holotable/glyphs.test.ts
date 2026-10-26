import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { serialize } from 'node:v8';
import { GLYPHS, BADGES, KIND_GLYPHS, personGlyph, eventGlyph, placeGlyph, storyBadge } from '../../src/holotable/glyphs.ts';
import { HolotableObserver } from '../../src/holotable/observe.ts';
import { RunPublisher } from '../../tools/holotable/publish-run.ts';
import { validateRecord, type Item } from '../../src/holotable/schema.ts';
import { quietSim } from '../sim/helpers.ts';
import { layeredWeek } from '../s3/layered-week.ts';
import type { Layer3 } from '../../src/procedural/layer3.ts';
import type { LogEntry, PoolEntry } from '../../src/procedural/types.ts';
import type { GraphState, JState } from '../../src/procedural/graph-types.ts';

const dirs: string[] = [];
function tempDir() {
  const dir = resolve(import.meta.dir, '../../../../../.scratch-holo', `glyphs-${randomUUID()}`);
  mkdirSync(dir, { recursive: true }); dirs.push(dir); return dir;
}
afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });
const rows = (publisher: RunPublisher) => readFileSync(join(publisher.directory, 'director.jsonl'), 'utf8').trim().split('\n').slice(1).map((s) => JSON.parse(s));

test('community roles and event kinds use the exact glyph vocabulary and documented fallbacks', () => {
  for (const role of ['stallholder', 'vendor', 'shopkeeper', 'street-vendor', 'merchant']) expect(personGlyph(role)).toBe('merchant');
  for (const role of ['collector', 'fixer', 'police', 'medic', 'courier', 'gang-member', 'gang-leader']) expect(personGlyph(role)).toBe(role);
  expect(personGlyph('gang member')).toBe('gang-member'); expect(personGlyph('gang')).toBe('gang-member');
  for (const role of [undefined, 'unopened', 'student', 'unemployed', 'protagonist']) expect(personGlyph(role)).toBe('person');
  for (const kind of ['theft', 'assault', 'clash', 'shakedown', 'police-action', 'cyberpsychosis', 'disorder', 'accident', 'outage', 'trade', 'rumour', 'warning', 'confrontation']) expect(eventGlyph(kind)).toBe(kind);
  for (const [kind, glyph] of Object.entries({ 'gang-clash': 'clash', 'psycho-break': 'cyberpsychosis', commerce: 'trade', tell: 'rumour', confront: 'confrontation' })) expect(eventGlyph(kind)).toBe(glyph);
  expect(eventGlyph('fixture.paid')).toBe('event');
  expect(placeGlyph(['crackdown'], true)).toBe('crackdown'); expect(placeGlyph(['festival'], true)).toBe('festival');
  expect(placeGlyph([], true)).toBe('refuge'); expect(placeGlyph([], false)).toBe('place');
});

test('every published fixture item has a vocabulary glyph, with no invented badge', () => {
  const dir = tempDir(); let publisher: RunPublisher | undefined;
  layeredWeek('pay', false, { steps: 1, horizon: 600, sample(sim, l2, l3) {
    const before = serialize({ store: sim.k.store.capture(), events: sim.k.events.capture(), record: sim.record, state: l3.state, log: l3.log });
    const observer = new HolotableObserver(sim, l2, l3), observation = observer.sample();
    expect(serialize({ store: sim.k.store.capture(), events: sim.k.events.capture(), record: sim.record, state: l3.state, log: l3.log }).equals(before)).toBe(true);
    publisher ??= new RunPublisher(dir, { set: 'glyph-fixture', title: 'Glyph fixture', from: observer.epoch, to: observer.epoch + 12000 });
    publisher.publish(observation);
    for (const [layer, items] of observation.layers) for (const item of items) {
      expect(GLYPHS.has(item.glyph!)).toBe(true);
      if (item.badge !== undefined) expect(BADGES.has(item.badge)).toBe(true);
      else if (layer !== 'stories') expect(item.badge).toBeUndefined();
      if (layer === 'groups') expect(item.glyph).toBe('group');
      if (layer === 'placement') expect(item.glyph).toBe('scene');
    }
  } });
  for (const file of readdirSync(dir)) for (const row of readFileSync(join(dir, file), 'utf8').trim().split('\n').slice(1).map((s) => JSON.parse(s))) if ('id' in row) expect(GLYPHS.has(row.glyph)).toBe(true);
  for (const count of Object.values(publisher!.counts())) expect(count.unknownGlyphs).toBe(0);
});

test('story badges prefer ready then pending then matched and preserve every exact juncture state', () => {
  expect(storyBadge(['matched', 'pending', 'ready'])).toBe('ready');
  expect(storyBadge(['matched', 'pending'])).toBe('pending'); expect(storyBadge(['matched'])).toBe('matched');
  expect(storyBadge(['open', 'refined', 'foreclosed', 'skipped'])).toBeUndefined();
  const sim = quietSim('glyph-story', undefined, []);
  const states: JState['state'][] = ['open', 'refined', 'foreclosed', 'skipped', 'matched', 'pending', 'ready'];
  const graph = { retired: false, junctures: Object.fromEntries(states.map((state) => [state, { state }])) } as GraphState;
  const pool: PoolEntry[] = [{ id: 'story', pattern: 'pattern', version: 1, bindings: {}, stages: [], complete: false, graph, bindingKey: 'binding', seq: 1, firstTime: 0, lastTime: 0, refusals: 0, cooldownUntil: 0 }];
  const l3 = { state: { pool, evidence: [], buffer: [] }, log: [], threadView: [], sifter: { patterns: new Map([['pattern', { graph: { family: 'tension' } }]]) } } as unknown as Layer3;
  const sample = () => new HolotableObserver(sim, undefined, l3).sample().layers.get('stories')![0];
  const item = sample();
  expect(item.glyph).toBe('story'); expect(item.badge).toBe('ready');
  expect(item.facets!['pattern family']).toBe('tension'); expect(item.label).toContain('tension');
  expect(JSON.parse(item.facets!.junctures)).toEqual(Object.fromEntries(states.map((s) => [s, s])));
  l3.sifter.patterns.clear(); expect(sample().facets!['pattern family']).toBe('not recorded'); expect(sample().label).toContain('not recorded');
});

test('delivery holds publish held targets and retract at their recorded clear time without retracting sows', () => {
  const sim = quietSim('glyph-hold', undefined, []), log: LogEntry[] = [];
  const add = (seq: number, game: number, kind: 'sow' | 'hold', rule: string, data: Record<string, unknown>) => log.push({ seq, kind, rule, data, at: { game, playClock: game, playTotal: game }, purpose: 'schedule', class: 0, inputs: {}, chain: [] });
  add(1, 0, 'hold', 'headroom', { delivery: 'delivery', reason: 'headroom' }); add(2, 0, 'sow', 'sow', {}); add(3, 0, 'sow', 'gate-7', {});
  const l3 = { state: { pool: [], evidence: [], buffer: [] }, log, threadView: [] } as unknown as Layer3;
  const observer = new HolotableObserver(sim, undefined, l3), publisher = new RunPublisher(tempDir(), { set: 'holds', title: 'Holds', from: observer.epoch, to: observer.epoch + 100 });
  publisher.publish(observer.sample());
  expect(rows(publisher).map((i) => i.glyph)).toEqual(['sown', 'refused', 'held']);
  expect(rows(publisher).find((i) => i.glyph === 'held').facets).toEqual({ decision: 'held: headroom', 'reason held': 'headroom', gate: 'headroom', delivery: 'delivery' });
  add(4, 5, 'hold', 'hold-cleared', { delivery: 'delivery', reason: 'headroom' }); sim.k.now = 10;
  const cleared = { ...observer.sample(), branch: 'save-a' };
  publisher.publish(cleared); publisher.publish(cleared);
  expect(rows(publisher).at(-1)).toEqual({ retract: 'hold-1', t: observer.epoch + 5, branch: 'save-a' });
  expect(rows(publisher).filter((i) => i.retract)).toHaveLength(1);
  // A global clear still needs an unbranched record to clear every branch.
  publisher.publish(observer.sample());
  expect(rows(publisher).at(-1)).toEqual({ retract: 'hold-1', t: observer.epoch + 5 });
  expect(rows(publisher).filter((i) => i.id === '2').every((i) => i.glyph === 'sown')).toBe(true);
  expect(rows(publisher).some((i) => i.retract === '2')).toBe(false);
});

test('unknown glyph and badge names are retained, counted once per published revision, and never refused for membership', () => {
  const publisher = new RunPublisher(tempDir(), { set: 'unknown-glyphs', title: 'Unknown glyphs', from: 0, to: 10 });
  const item: Item = { schema: 'xfh/item-1', id: 'unknown', kind: 'point', t: 0, anchor: { region: 'place' }, cite: 'se:event:unknown', glyph: 'future-glyph', badge: 'future-badge' };
  const manifest = JSON.parse(readFileSync(join(publisher.directory, 'events.jsonl'), 'utf8').trim());
  validateRecord(item, manifest);
  publisher.publish({ t: 0, layers: new Map([['events', [item]]]) }); publisher.publish({ t: 0, layers: new Map([['events', [item]]]) });
  expect(publisher.counts().events.unknownGlyphs).toBe(2);
  const written = JSON.parse(readFileSync(join(publisher.directory, 'events.jsonl'), 'utf8').trim().split('\n').at(-1)!);
  expect(written.glyph).toBe('future-glyph'); expect(written.badge).toBe('future-badge');
  publisher.publish({ t: 1, layers: new Map([['events', [{ ...item, id: 'default', glyph: undefined, badge: undefined }]]]) });
  expect(JSON.parse(readFileSync(join(publisher.directory, 'events.jsonl'), 'utf8').trim().split('\n').at(-1)!).glyph).toBe(KIND_GLYPHS.point);
  expect(publisher.counts().events.unknownGlyphs).toBe(2);
});

test('a hold that starts and clears between samples is published as its exact historical interval, once', () => {
  const sim = quietSim('glyph-short-hold', undefined, []); sim.k.now = 10;
  const log = (seq: number, game: number, rule: string): LogEntry => ({ seq, kind: 'hold', rule, data: { delivery: 'delivery', reason: 'headroom' }, at: { game, playClock: game, playTotal: game }, purpose: 'schedule', class: 0, inputs: {}, chain: [] });
  const l3 = { state: { pool: [], evidence: [], buffer: [] }, log: [log(1, 2, 'headroom'), log(2, 5, 'hold-cleared')], threadView: [] } as unknown as Layer3;
  const observer = new HolotableObserver(sim, undefined, l3), publisher = new RunPublisher(tempDir(), { set: 'short-hold', title: 'Short hold', from: observer.epoch, to: observer.epoch + 100 });
  const before = serialize({ store: sim.k.store.capture(), state: l3.state, log: l3.log, record: sim.record });
  const sample = observer.sample(); publisher.publish(sample); publisher.publish(observer.sample());
  expect(rows(publisher)).toEqual([
    expect.objectContaining({ id: 'hold-1', glyph: 'held', t: observer.epoch + 2, until: observer.epoch + 5 }),
    { retract: 'hold-1', t: observer.epoch + 5 },
  ]);
  expect(publisher.counts().director).toMatchObject({ items: 1, live: 0, revisions: 1 });
  expect(serialize({ store: sim.k.store.capture(), state: l3.state, log: l3.log, record: sim.record }).equals(before)).toBe(true);
});
