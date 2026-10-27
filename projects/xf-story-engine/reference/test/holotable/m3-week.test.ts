import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Run, policies } from '../../src/m3/driver.ts';
import { run3World } from '../../src/m3/run3.ts';
import { stateById } from '../../src/m3/states.ts';
import { runWeek3, type Week3Config } from '../../src/m3/week3.ts';
import { canonicalRun, publishM3Week, runDigest } from '../../tools/holotable/publish-m3-week.ts';
import { kabukiFixture } from '../sim/kabuki-fixture.ts';
import { checkSpool } from '../../tools/holotable/check-spool.ts';
import { HolotableObserver } from '../../src/holotable/observe.ts';
import type { LogEntry } from '../../src/procedural/types.ts';

const config: Week3Config = { id: 'E-short-restless-engage', world: 'short', arm: 'E', tempo: 'restless', policy: 'engage', windows: 3 };
const areas = ['Kabuki', 'Northside', 'LittleChina'].map(id => ({ id: `Districts.${id}`, poly: [[0, 0], [100, 0], [100, 100], [0, 100]] as [number, number][], zlo: 0, zhi: 100 }));
const makeRun = () => new Run({ ...run3World(config.world, config.arm, config.tempo).opts, index: kabukiFixture(.01) }, stateById('S-mid-squeezed'), { ...policies['accept-first']!, id: 'engage' }, { walk: true });

test('short run-3 publish preserves the entire run identity, uses actual bounds, and refuses mismatches before promotion', async () => {
  const root = resolve(import.meta.dir, '../../../../../.scratch-realweek/test-' + randomUUID());
  mkdirSync(root, { recursive: true });
  try {
    const bare = runWeek3(config, { run: makeRun() });
    const observed = makeRun(), from = observed.w.sim.k.now + (observed.w.sim.w.index.clock?.sod0 ?? 0);
    const { record, summary } = publishM3Week(join(root, 'week'), bare, areas, { run: observed });
    expect(canonicalRun(record)).toBe(canonicalRun(bare));
    expect(summary.identity.archivedDigest).toBe(runDigest(record));
    expect(summary.from).toBe(from);
    expect(summary.to).toBe(observed.w.sim.k.now + (observed.w.sim.w.index.clock?.sod0 ?? 0));
    expect(summary.to - summary.from).toBeLessThan(604800);
    expect(summary.observations).toBe(config.windows + 1);
    expect((await checkSpool(summary.output)).refusals).toBe(0);
    const consumer = await import(resolve(import.meta.dir, '../../../../xf-holotable/src/layers.ts'));
    for (const file of readdirSync(summary.output)) {
      const [manifest, ...items] = readFileSync(join(summary.output, file), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      expect(manifest.standalone).toEqual({ set: config.id.toLowerCase(), title: 'Kabuki week (simulated)', from: summary.from, to: summary.to, clock: 'game' });
      expect(consumer.validateManifest(manifest)).toBeNull();
      for (const item of items) { expect(consumer.validateRecord(item, manifest)).toBeNull(); expect(item.t).toBeLessThanOrEqual(summary.to); }
    }
    expect(() => publishM3Week(summary.output, bare, areas, { run: makeRun() })).toThrow('fresh');
    const different = structuredClone(bare); different.play++;
    expect(() => publishM3Week(join(root, 'mismatch'), different, areas, { run: makeRun() })).toThrow('record.play');
    expect(existsSync(join(root, 'mismatch'))).toBe(false);
    expect(existsSync(join(root, 'mismatch.pending'))).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 25000);

test('a drained director log keeps repeated local sequences distinct and clears a hold across windows', () => {
  const run = makeRun();
  const entry = (game: number, seq: number, kind: LogEntry['kind'], rule: string, data = {}): LogEntry => ({
    seq, kind, rule, data, at: { game, playTotal: game / 6, playClock: game / 6 }, purpose: 'match', class: 0, inputs: {}, chain: [],
  });
  const directorLog = [entry(0, 0, 'sow', 'sow-refused'), entry(0, 1, 'hold', 'phase-settling', { delivery: 'held-delivery' })];
  const observer = new HolotableObserver(run.w.sim, run.w.l2, run.w.l3, { directorLog });
  const first = observer.sample().layers.get('director')!;
  const held = first.find(item => item.id.startsWith('hold-'))!;
  run.step();
  directorLog.push(entry(600, 0, 'sow', 'sow-refused'), entry(600, 1, 'hold', 'hold-cleared', { delivery: 'held-delivery' }));
  const before = JSON.stringify(run.w.l3!.log), next = observer.sample();
  expect(next.layers.get('director')!.filter(item => !item.id.startsWith('hold-'))).toHaveLength(2);
  expect(new Set(next.layers.get('director')!.map(item => item.id)).size).toBe(next.layers.get('director')!.length);
  expect(next.retractions?.get('director')).toContainEqual({ retract: held.id, t: 600 });
  expect(JSON.stringify(run.w.l3!.log)).toBe(before);
});
