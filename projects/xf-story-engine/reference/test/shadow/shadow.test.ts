import { afterAll, expect, test, setDefaultTimeout } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ShadowClock } from '../../src/shadow/clock.ts';
import { defaultReader, recordingBatch, type Batch, type WorldPack } from '../../src/shadow/feed.ts';
import { ShadowHost } from '../../src/shadow/host.ts';
import { ReadOnlyApi, replayLog, watchLive } from '../../src/shadow/live.ts';
import { RunPublisher } from '../../tools/holotable/publish-run.ts';
import { validateManifest } from '../../src/holotable/schema.ts';
import type { LiveClock } from '../../../../xf-holotable/src/live.ts';
import type { LiveBridge } from '../../../../xf-holotable/src/live-bridge.ts';
import { mirroredId } from '../../src/id.ts';
import { People } from '../../src/sim/people.ts';

setDefaultTimeout(180_000);
const scratch = resolve(import.meta.dir, '../../../../../.scratch-shadow');
mkdirSync(scratch, { recursive: true });
const folders: string[] = [];
const temp = () => { const p = mkdtempSync(join(scratch, 'test-')); folders.push(p); return p; };
afterAll(() => { for (const p of folders) rmSync(p, { recursive: true, force: true }); });
const world: WorldPack = { schema: 'xfh/world-pack-1', provenance: { game: 'synthetic', source: 'test', built: 'test' }, cells: [],
  areas: ['Kabuki', 'Northside', 'LittleChina'].map((name, i) => ({ id: `Districts.${name}`, name, kind: 'district', poly: [[i * 100, 0], [i * 100 + 90, 0], [i * 100 + 90, 90], [i * 100, 90]], zlo: -20, zhi: 200 })) };
const meta: Batch['meta'] = { schema: 'xfh/session-1', session: 'synthetic', run: 1, worldGeneration: 1, pluginVersion: 'fixture', start: 100, end: 260, from: 100, to: 260,
  channels: ['v', 'actors', 'camera', 'incidents', 'unknown-channel'], complete: true, dropped: 0, missedDeadlines: 0, largestGapS: 80, coverage: 'synthetic', problems: [] };
const v = (t: number, seq = 1, position: [number, number, number] = [20, 20, 0]) => ({ t, seq, position, yaw: 0, speed: 0, health: 100, healthMax: 100, inCombat: false, vehicle: false, busy: '' });
const batch = (): Batch => ({ meta, v: [v(100), v(180, 3), v(260, 5)], actors: [{ t: 101, who: 'a1', entity: 'entity-1', position: [21, 20, 0] }], camera: [], events: [], gaps: [] });
const spool = (dir: string) => Object.fromEntries(readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort().map(f => [f, readFileSync(join(dir, f), 'utf8')]));

test('clock prefers game readings; fallback is causal, declared and rejects rollback', () => {
  const c = new ShadowClock(meta);
  expect(c.at(100)).toEqual({ game: 0, derived: true });
  expect(c.at(110, 1000)).toEqual({ game: 1000, derived: false });
  expect(c.at(111)).toEqual({ game: 1008, derived: true });
  expect(() => c.at(112, 500)).toThrow('backwards');
  const sampled = new ShadowClock({ ...meta, gameTimeSamples: [{ source: 100, game: 3600 }, { source: 200, game: 7200 }] });
  expect(sampled.at(101).game).toBe(3600);
  const paused = new ShadowClock(meta);
  paused.at(100, 600); expect(paused.at(100.1, undefined, true)).toEqual({ game: 600, derived: false });
  expect(paused.at(100.2, 600).game).toBe(600);
});

test('recording mode validates its binding; standalone bytes retain the original manifest', () => {
  const standalone = temp(), rec = temp();
  new RunPublisher(standalone, { set: 'test', title: 'Test', from: 0, to: 100 });
  expect(readFileSync(join(standalone, 'people.jsonl'), 'utf8')).toBe('{"schema":"xfh/layer-1","producer":"story-engine","layer":"people","title":"people","content":"full","clock":"game","kinds":["actor"],"standalone":{"set":"test","title":"Test","from":0,"to":100,"clock":"game"}}\n');
  new RunPublisher(rec, { mode: 'recording', session: 'synthetic', run: 1, from: 100, to: 200 });
  const m = JSON.parse(readFileSync(join(rec, 'people.jsonl'), 'utf8')); validateManifest(m);
  expect(m.clock).toBe('recording'); expect(m.session).toBe('synthetic'); expect(m.standalone).toBeUndefined();
  expect(() => validateManifest({ ...m, run: 0 })).toThrow();
  expect(() => validateManifest({ ...m, standalone: {} })).toThrow();
});

test('V maps to writer grid; actors are game readings without invented identity data; unknowns are explicit', () => {
  const host = new ShadowHost(defaultReader, world, meta, temp());
  host.consume(batch());
  const actor = mirroredId(host.key('a1'));
  expect(host.sim.k.value(actor, 'position')).toEqual([21, 20, 0]);
  const readings = host.sim.k.store.pinsOfNode(actor);
  expect(readings.some(c => c.slot === 'position' && c.reason === 'game')).toBe(true);
  expect(readings.some(c => c.slot === 'affiliation')).toBe(false);
  expect(host.sim.k.value(host.sim.w.vState, 'cell')).toBe(host.locate([20, 20, 0]).cell);
  expect(host.locate([20, 20, 150]).cell).toBe(host.locate([20, 20, 0]).cell);
  expect(host.locate([120, 20, 0]).district).toBeDefined();
  expect(host.locate([120, 20, 0]).cell).toBeUndefined();
  const summary = host.summary();
  expect(summary.absentFromRecorder).toContain('actors.affiliation');
  expect(summary.unquantifiedSourceChannels).toContain('unknown-channel');
  expect(summary.pendingHolotableModel).toContain('typed incidents');
  const lines = readFileSync(join(host.publisher.directory, 'people.jsonl'), 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l));
  const a = lines.find(l => l.id === actor);
  expect(a.anchor).toEqual({ entity: 'entity-1' }); expect(a.value.name).toBe('Unidentified person');
  expect(a.facets['game time (derived)']).toBeDefined(); expect(a.t).toBe(180);
  for (const text of Object.values(spool(host.publisher.directory))) for (const line of text.trim().split('\n').slice(1)) {
    const item = JSON.parse(line);
    if (item.id) expect(item.facets['game time (derived)']).toBeDefined();
  }
});

test('recording spools and summaries are byte-identical across independent runs', () => {
  const a = new ShadowHost(defaultReader, world, meta, temp()), b = new ShadowHost(defaultReader, world, meta, temp());
  const input = batch(); input.v = [v(100, 1, [120, 20, 0]), v(750, 2, [120, 20, 0])];
  const shared = People.shared;
  a.consume(input); b.consume(input); expect(spool(a.publisher.directory)).toEqual(spool(b.publisher.directory));
  expect(People.shared).toBe(shared);
  const { performance: _a, ...sa } = a.summary(), { performance: _b, ...sb } = b.summary(); expect(JSON.stringify(sa)).toBe(JSON.stringify(sb));
});

test('the authoritative reader rejects changed recording schema; no sidecar exists', async () => {
  const root = temp(), run = join(root, 'synthetic/run-1'); mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'manifest.json'), JSON.stringify({ schema: 'xfb/recording-99' }));
  await expect(recordingBatch(defaultReader, run)).rejects.toThrow('Not a recorder manifest');
});

test('explicit paused game time does not advance windows through intervening actor samples', () => {
  const host = new ShadowHost(defaultReader, world, meta, temp(), 0, 7200);
  const data = batch();
  data.v = [{ ...v(100), gameTime: 7200 }, { ...v(101), gameTime: 7200 }, { ...v(180), gameTime: 7800 }];
  data.actors = [{ t: 100.5, who: 'a1', position: [20, 20, 0] }];
  host.consume(data); expect(host.summary().windows).toBe(1);
  expect(host.summary().gameThrough).toBe(7800);
});

test('never acts: the command allowlist rejects writes before any transport call', async () => {
  const calls: string[] = [];
  const fake = { callBridge: async (name: string) => { calls.push(name); return { ok: true } as any; }, run: async (name: string) => { calls.push(name); return { ok: true } as any; }, close() {} };
  const api = new ReadOnlyApi({ readOnly: true }, fake);
  await api.callBridge('recorder.status', {}, 'test'); await api.run('game.catchup', {});
  expect(() => api.callBridge('player.teleport', {}, 'test')).toThrow('Non-read');
  expect(() => api.run('recorder.start', {})).toThrow('Non-read');
  expect(calls).toEqual(['recorder.status', 'game.catchup']);
});

test('simulated live batches use their own read slot at <=1 Hz; exact log replay matches spool', async () => {
  let now = 0, timer: { at: number; fn: () => void } | undefined;
  const clock: LiveClock = { now: () => now, later(ms, fn) { timer = { at: now + ms, fn }; return () => { timer = undefined; }; } };
  const times: number[] = []; let pageNo = 0, closed = false;
  const row = (t: number, seq: number) => ({ schema: 'xfb/source-record-1', session: 'synthetic', run: 1, world_generation: 1, seq, source_s: t, valid: true, channel: 'v', data: { position: [20, 20, 0], yaw: 0 } });
  const bridge: LiveBridge = {
    async discover() { return { available: true, recorder: { active: true, run: 1, session: 'synthetic', world: 1, channels: ['v', 'actors'], start: 100, latest: 3, stopReason: null } }; },
    async catchup(input) {
      expect(input.now).toBe(false); expect(input.detail).toBe(true); times.push(now);
      const i = pageNo++, t = [100, 180, 260][i];
      const records: any[] = [row(t, i * 2 + 1)];
      if (i === 0) records.push({ ...row(101, 2), channel: 'actors', data: { actors: [{ who: 'a1', entity: 'entity-1', valid: true, position: [21, 20, 0] }] } });
      return { cursor: { sid: 'synthetic', run: 1, world: 1, record: i * 2 + 2, event: 0 }, records, events: [], calibration: { source_s: t, host_after_ms: now }, source: { active: true }, more: false };
    }, close() { closed = true; },
  };
  const liveOut = temp(), replayOut = temp(), log = join(temp(), 'live.jsonl');
  let host: ShadowHost | undefined;
  const live = watchLive(bridge, log, { consume(b) { host ??= new ShadowHost(defaultReader, world, b.meta, liveOut); host.consume(b); } }, { clock });
  try {
    await new Promise(setImmediate);
    for (let i = 0; i < 2; i++) {
      expect(timer).toBeDefined(); now = timer!.at; const fn = timer!.fn; timer = undefined; fn(); await new Promise(setImmediate); live.heartbeat();
    }
  } finally { live.close(); }
  expect(closed).toBe(true); expect(times.length).toBe(3);
  expect(times.slice(1).every((t, i) => t - times[i] >= 1000)).toBe(true);
  let replay: ShadowHost | undefined;
  replayLog(log, { consume(b) { replay ??= new ShadowHost(defaultReader, world, b.meta, replayOut); replay.consume(b); } });
  expect(spool(replayOut)).toEqual(spool(liveOut));
  expect(host!.sim.k.value(mirroredId(host!.key('a1')), 'position')).toEqual([21, 20, 0]);
  expect(replay!.summary().windows).toBe(2);
});
