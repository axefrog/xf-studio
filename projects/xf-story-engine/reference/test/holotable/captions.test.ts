import { expect, test } from 'bun:test';
import { serialize } from 'node:v8';
import { plainWords, unopenedDoing, storyCaption } from '../../src/holotable/captions.ts';
import { HolotableObserver } from '../../src/holotable/observe.ts';
import { quietSim } from '../sim/helpers.ts';
import { ownedId } from '../../src/id.ts';
import type { Layer3 } from '../../src/procedural/layer3.ts';
import type { PoolEntry } from '../../src/procedural/types.ts';
import type { GraphState } from '../../src/procedural/graph-types.ts';
import type { Pattern } from '../../src/seeding/pattern-types.ts';
import type { EventsDigest } from '../../src/sim/proc-events.ts';

test('story captions use the next ready function, recorded actor name, last match and outcome', () => {
  const graph = { junctures: { old: { state: 'matched', filler: { at: 1 } }, latest: { state: 'matched', filler: { at: 2 } }, next: { state: 'ready', readySince: 3 }, later: { state: 'ready', readySince: 4 } } } as unknown as GraphState;
  const entry = { graph, bindings: { '?actor': 'recorded-actor' }, complete: false } as unknown as PoolEntry;
  const pattern = { junctures: { next: { fn: 'pay-debt', args: { by: '?actor' } }, later: { fn: 'leave', args: {} } } } as unknown as Pattern;
  expect(storyCaption(entry, pattern, (id) => id === 'recorded-actor' ? 'Mira' : 'not recorded')).toBe('waiting for pay debt by Mira');
  expect(storyCaption(entry, undefined, () => 'not recorded')).toBe('waiting for not recorded by not recorded');
  graph.junctures.next.state = 'pending'; graph.junctures.later.state = 'pending';
  expect(storyCaption(entry, pattern, () => 'not recorded')).toBe('under way: latest');
  graph.outcome = { name: 'debt-paid' } as GraphState['outcome'];
  expect(storyCaption(entry, pattern, () => 'not recorded')).toBe('ended: debt paid');
  expect(unopenedDoing('vendor')).toBe('a merchant (not yet opened)');
  expect(unopenedDoing()).toBe('a person (role not recorded; not yet opened)');
  expect(plainWords('police-action')).toBe('police action');
});

test('first facets are plain captions, and every known cell fallback references its places item without resolving', () => {
  const sim = quietSim('holo-captions', undefined, []), k = sim.k;
  const cell = sim.w.districts[0].cellIds[0], [actor] = sim.people.residentsOfBlock(cell);
  k.value(actor, 'role'); k.value(k.address(actor, 'name'), 'display');
  const name = k.store.nodes.get(ownedId(actor, 'name'))!.slots.get('display');
  const expectedName = name?.s === 'resolved' && typeof name.value === 'string' ? name.value : 'not recorded';
  const event = k.events.mintEvent({ creator: actor, cause: actor, name: 'caption-event', kind: 'theft', time: 0, place: cell, outcome: 'done' });
  k.frames.open({ actor, origin: actor, cause: event, level: 'goal', status: 'active', weight: 1, focus: { nodes: [cell], tier: 3 } });
  const graph = { retired: false, junctures: { next: { state: 'ready', readySince: 0 } } } as unknown as GraphState;
  const pool = [{ id: 'caption-story', pattern: 'caption-pattern', version: 1, bindings: { '?actor': actor, '?place': cell }, stages: [], complete: false, graph }] as unknown as PoolEntry[];
  const l3 = { state: { pool, evidence: [], buffer: [] }, threadView: [], log: [{ kind: 'sow', rule: 'gate-7', seq: 1, at: { game: 0 }, data: { entry: 'caption-story' }, chain: [] }], sifter: { patterns: new Map([['caption-pattern', { graph: { family: 'tension', junctures: { next: { fn: 'repay', args: { debtor: '?actor' } } } } }]]) } } as unknown as Layer3;
  const ed = { bands: {}, regimes: [{ scope: cell, kind: 'crackdown' }], refuge: { [cell]: 'yes' } } as unknown as EventsDigest;
  k.evolution.digestPeek = <T>(id: string) => (id === 'city.events' ? ed : undefined) as T | undefined;
  const forbidden = () => { throw Error('caption resolved or regenerated state'); };
  k.value = forbidden; k.resolve = forbidden; k.address = forbidden; k.persistence.recoverIfSaved = forbidden; k.persistence.restoreReferencedHeader = forbidden;
  sim.people.view = forbidden; sim.people.where = forbidden;
  const before = serialize({ store: k.store.capture(), events: k.events.capture(), record: sim.record, state: l3.state, log: l3.log });
  const layers = new HolotableObserver(sim, undefined, l3).sample().layers;
  const first = (layer: string) => Object.keys(layers.get(layer)![0].facets!)[0];
  expect(first('places')).toBe('heat'); expect(first('people')).toBe('doing'); expect(first('groups')).toBe('intent');
  expect(first('events')).toBe('what'); expect(first('stories')).toBe('now'); expect(first('director')).toBe('decision');
  expect(layers.get('places')!.find((i) => i.id === cell)!.facets!.heat).toBe('quiet, crackdown');
  expect(layers.get('events')!.find((i) => i.id === event)!.facets!.what).toBe('theft (done) at not recorded');
  expect(layers.get('stories')![0].facets!.now).toBe(`waiting for repay by ${expectedName}`);
  expect(layers.get('director')![0].facets!.decision).toBe('refused at gate 7');
  for (const layer of ['people', 'events', 'stories', 'director']) {
    const item = layers.get(layer)!.find((i) => layer !== 'people' || i.id === actor)!;
    expect(item.anchor).toEqual({ item: `story-engine/places/${cell}` });
  }
  expect(layers.get('detail')![0].anchor).toEqual({ region: cell }); // no schematic layout supplied
  expect(serialize({ store: k.store.capture(), events: k.events.capture(), record: sim.record, state: l3.state, log: l3.log }).equals(before)).toBe(true);
});

test('group captions distinguish an active intention, recorded absence, and missing records', () => {
  const sim = quietSim('holo-group-caption', undefined, []), observer = new HolotableObserver(sim);
  const id = observer.sample().layers.get('groups')![0].id;
  expect(observer.sample().layers.get('groups')![0].facets!.intent).toBe('not recorded');
  const group = { intent: 'active:protect-market', active: { name: 'protect-market' } };
  sim.k.evolution.digestPeek = <T>(key: string) => (key === 'group.decide' ? { groups: { [id]: group } } : undefined) as T | undefined;
  expect(observer.sample().layers.get('groups')![0].facets!.intent).toBe('protect market');
  group.intent = 'none'; group.active = null as unknown as typeof group.active;
  expect(observer.sample().layers.get('groups')![0].facets!.intent).toBe('no active intention');
});
