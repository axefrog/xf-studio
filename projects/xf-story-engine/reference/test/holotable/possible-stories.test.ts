import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HolotableObserver } from '../../src/holotable/observe.ts';
import { RunPublisher } from '../../tools/holotable/publish-run.ts';
import { quietSim } from '../sim/helpers.ts';
import { layeredWeek } from '../s3/layered-week.ts';
import type { Layer3 } from '../../src/procedural/layer3.ts';
import type { Layer2 } from '../../src/seeding/layer2.ts';
import type { PoolEntry } from '../../src/procedural/types.ts';
import * as wording from '../../src/wording/index.ts';

const scratch = () => resolve(import.meta.dir, '../../../../../.scratch-realweek/test-' + randomUUID());
function fixture() {
  const sim = quietSim('possible-stories', undefined, []), cell = sim.w.districts[0].cellIds[0];
  const [a, b] = sim.people.residentsOfBlock(cell);
  const entry = { id: 'story', pattern: 'xf.composite:debt', bindings: { '?d': a, '?c': b }, stages: [], complete: false, firstTime: 0, seq: 0,
    graph: { junctures: { owed: { state: 'matched', filler: { id: 'owed', at: 0, args: { debtor: a, creditor: b } } }, paid: { state: 'ready' } }, retired: false, seeds: [] } } as unknown as PoolEntry;
  const pool = [entry];
  const l3 = { state: { pool, evidence: [], buffer: [] }, log: [], threadView: [], sifter: { patterns: new Map([['xf.composite:debt', { graph: wording.patternInfo('xf.composite:debt') }]]) } } as unknown as Layer3;
  return { sim, cell, entry, pool, l3 };
}

test('an entry-only story moves from a possible bucket into stories, including its roles, exactly once', () => {
  const dir = scratch(), { sim, cell, entry, l3 } = fixture();
  const observer = new HolotableObserver(sim, undefined, l3), publisher = new RunPublisher(dir, { set: 'possible', title: 'Possible', from: observer.epoch, to: observer.epoch + 100 });
  try {
    const first = observer.sample();
    expect(first.layers.get('stories')).toHaveLength(0);
    expect(first.layers.get('possible-stories')).toHaveLength(1);
    expect(first.layers.get('possible-stories')![0].label).toBe('1 possible stories here');
    expect(first.layers.get('possible-stories')![0].facets!.kinds).toBe('Debt 1');
    expect(first.layers.get('possible-stories')![0].anchor).toEqual({ item: `story-engine/places/${cell}` });
    publisher.publish(first);
    sim.k.now = 10;
    entry.graph!.junctures.paid.state = 'matched';
    entry.graph!.junctures.paid.filler = { id: 'paid', at: 10, args: entry.graph!.junctures.owed.filler!.args } as never;
    const developed = observer.sample();
    expect(developed.layers.get('possible-stories')).toHaveLength(0);
    expect(developed.layers.get('stories')!.filter(i => i.kind === 'point')).toHaveLength(1);
    expect(developed.layers.get('stories')!.filter(i => i.kind === 'relation').length).toBeGreaterThan(0);
    publisher.publish(developed); publisher.publish(observer.sample());
    const rows = (layer: string) => readFileSync(join(dir, layer + '.jsonl'), 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
    expect(rows('possible-stories').filter(r => 'retract' in r)).toEqual([{ retract: first.layers.get('possible-stories')![0].id, t: observer.epoch + 10 }]);
    expect(rows('stories').filter(r => r.kind === 'point')).toHaveLength(1);
    expect(rows('stories').find(r => r.kind === 'point').t).toBe(observer.epoch + 10);
    expect(rows('possible-stories')[0].title).toBe('Possible stories');
    expect(rows('possible-stories')[0].facet_titles).toEqual({ kinds: 'Kinds', about: 'About' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('presentation needs a nonambient receipt; an outcome also develops an entry-only story', () => {
  const { sim, entry, l3 } = fixture();
  entry.graph!.seeds = [{ seed: 'told-seed', for: 'told' }];
  const receipts = [{ seed: 'told-seed', grade: 'ambient' }];
  const l2 = { global: { receipts }, all: () => [] } as unknown as Layer2;
  const observer = new HolotableObserver(sim, l2, l3);
  expect(observer.sample().layers.get('stories')).toHaveLength(0);
  receipts[0].grade = 'presented';
  expect(observer.sample().layers.get('stories')!.filter(i => i.kind === 'point')).toHaveLength(1);
  receipts.length = 0;
  entry.graph!.outcome = { name: 'paid', kind: 'resolved', at: 0, story: 'ending' };
  expect(observer.sample().layers.get('stories')!.filter(i => i.kind === 'point')).toHaveLength(1);
});

test('graph development counts matched steps, not historical events or a completion flag without an outcome', () => {
  const { sim, entry, l3 } = fixture();
  entry.stages = [{ event: 'older', time: 0 }, { event: 'later', time: 1 }];
  entry.complete = true;
  const observation = new HolotableObserver(sim, undefined, l3).sample();
  expect(observation.layers.get('stories')).toHaveLength(0);
  expect(observation.layers.get('possible-stories')![0].label).toBe('1 possible stories here');
});

test('possible buckets keep their detail until count or kinds changes, and reappearance has a fresh timestamp', () => {
  const { sim, entry, pool, l3 } = fixture(), observer = new HolotableObserver(sim, undefined, l3);
  const first = observer.sample().layers.get('possible-stories')![0];
  sim.k.now = 10; entry.bindings = { '?d': entry.bindings['?c'], '?c': entry.bindings['?d'] }; entry.firstTime = 10;
  expect(observer.sample().layers.get('possible-stories')![0]).toEqual(first);
  pool.length = 0; observer.sample(); pool.push(entry); sim.k.now = 20;
  expect(observer.sample().layers.get('possible-stories')![0].t).toBe(observer.epoch + 20);
});

test('possible kinds show the top three plus others, and detail lists at most twenty titles newest first', () => {
  const { sim, entry, pool, l3 } = fixture(); pool.length = 0;
  for (const [pattern, count] of [['debt', 25], ['feud', 3], ['grievance', 2], ['betrayal', 1]] as const) {
    const info = wording.patternInfo('xf.composite:' + pattern)!;
    l3.sifter.patterns.set(info.id, { graph: info } as never);
    for (let i = 0; i < count; i++) {
      const copy = structuredClone(entry); copy.id = `${pattern}-${i}`; copy.pattern = info.id; copy.firstTime = copy.seq = pool.length;
      copy.bindings = Object.fromEntries(Object.keys(info.roles).map((role, n) => [role, Object.values(entry.bindings)[n % 2]]));
      pool.push(copy);
    }
  }
  const item = new HolotableObserver(sim, undefined, l3).sample().layers.get('possible-stories')![0];
  expect(item.label).toBe('31 possible stories here');
  expect(item.facets!.kinds).toBe('Debt 25 · Feud 3 · A grudge 2 · others 1');
  expect(item.detail!.split('\n')).toHaveLength(21);
  expect(item.detail!.split('\n')[0]).toBe(item.label!);
  expect(item.detail!.split('\n')[1]).toStartWith('Betrayal:');
  expect(item.glyph).toBe('story');
});

test('developed plus possible conserves every live instance throughout the complete fixture week', () => {
  let observer: HolotableObserver | undefined, samples = 0;
  layeredWeek('pay', false, { steps: 1002, horizon: 601200, sample(sim, l2, l3) {
    observer ??= new HolotableObserver(sim, l2, l3);
    const observation = observer.sample();
    const developed = observation.layers.get('stories')!.filter(i => i.kind === 'point').length;
    const possible = observation.layers.get('possible-stories')!.reduce((sum, i) => sum + Number(i.label!.split(' ')[0]), 0);
    expect(developed + possible).toBe(l3.state.pool.filter(e => !e.graph?.retired).length);
    samples++;
  } });
  expect(samples).toBeGreaterThan(1000);
}, 30000);
