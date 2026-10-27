import { afterAll, expect, test, setDefaultTimeout, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ShadowClock, initialGameTime } from '../../src/shadow/clock.ts';
import { defaultReader, recordingBatch, type Batch, type WorldPack } from '../../src/shadow/feed.ts';
import { ShadowHost } from '../../src/shadow/host.ts';
import { ReadOnlyApi, readOnlyBridge, replayLog, watchLive } from '../../src/shadow/live.ts';
import { CommandApi } from '../../../../xf-runtime-bridge/tools/api/command-api.ts';
import { BridgeClient } from '../../../../xf-runtime-bridge/tools/bridge-lib.ts';
import { runCli } from '../../tools/shadow/run.ts';
import { RunPublisher } from '../../tools/holotable/publish-run.ts';
import { validateManifest } from '../../src/holotable/schema.ts';
import type { LiveClock } from '../../../../xf-holotable/src/live.ts';
import type { LiveBridge } from '../../../../xf-holotable/src/live-bridge.ts';
import { mirroredId } from '../../src/id.ts';
import { People } from '../../src/sim/people.ts';
import { createLayerSpool } from '../../../../xf-holotable/src/layer-spool.ts';
import { evaluateLayers } from '../../../../xf-holotable/src/layers.ts';

setDefaultTimeout(180_000);
const scratch = resolve(import.meta.dir, '../../../../../.scratch-shadow');
mkdirSync(scratch, { recursive: true });
const folders: string[] = [];
const temp = () => { const p = mkdtempSync(join(scratch, 'test-')); folders.push(p); return p; };
afterAll(() => { for (const p of folders) rmSync(p, { recursive: true, force: true }); });
const world: WorldPack = { schema: 'xfh/world-pack-1', provenance: { game: 'synthetic', source: 'test', built: 'test' }, cells: [],
  areas: ['Kabuki', 'Northside', 'LittleChina'].map((name, i) => ({ id: `Districts.${name}`, name, kind: 'district', poly: [[i * 100, 0], [i * 100 + 90, 0], [i * 100 + 90, 90], [i * 100, 90]], zlo: -20, zhi: 200 })) };
const meta: Batch['meta'] = { schema: 'xfh/session-1', session: 'synthetic', run: 1, worldGeneration: 1, pluginVersion: 'fixture', start: 100, end: 260, from: 100, to: 260,
  channels: ['v', 'actors', 'camera', 'incidents', 'unknown-channel'].map(name => ({ name, read: 0, kept: 0, dropped: 0, reasons: {} })), complete: true, dropped: 0, missedDeadlines: 0, largestGapS: 80, coverage: 'synthetic', problems: [] };
const v = (t: number, seq = 1, position: [number, number, number] = [20, 20, 0]) => ({ t, seq, position, yaw: 0, speed: 0, health: 100, healthMax: 100, inCombat: false, vehicle: false, busy: '' });
const batch = (): Batch => ({ meta, v: [v(100), v(180, 3), v(260, 5)], actors: [{ t: 101, who: 'a1', valid: true, entity: 'entity-1', position: [21, 20, 0] }], camera: [], events: [], gaps: [] });
const spool = (dir: string) => Object.fromEntries(readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort().map(f => [f, readFileSync(join(dir, f), 'utf8')]));
const peopleRows = (host: ShadowHost) => readFileSync(join(host.publisher.directory, 'people.jsonl'), 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l));
const incident = (t: number, seq: number, receipt: NonNullable<Batch['events'][number]['incident']>): Batch['events'][number] => ({
  t, seq, id: `incident-${seq}`, kind: 'incident', summary: 'Incident observation', level: 'full', cite: `recorder:synthetic:1:${seq}`, incident: receipt,
});
const emptyBatch = (): Batch => ({ meta, v: [], actors: [], camera: [], events: [], gaps: [] });

test('invalid actor observations submit nothing and retract only that person until reobserved', () => {
  const host = new ShadowHost(defaultReader, world, meta, temp());
  host.consume({ ...batch(), v: [v(100), v(180)] });
  const actor = mirroredId(host.key('a1')), before = peopleRows(host), inputs = host.summary().pendingInputs;
  const submit = spyOn(host.port, 'submit');
  host.consume({ ...emptyBatch(), actors: [{ t: 181, who: 'a1', valid: false, entity: 'entity-1', position: [999, 999, 999] }] });
  expect(submit).not.toHaveBeenCalled(); submit.mockRestore();
  expect(host.summary().pendingInputs).toBe(inputs);
  expect(host.summary().unmapped['actor invalid']).toBe(1);
  expect(peopleRows(host).slice(before.length)).toEqual([{ retract: actor, t: 181 }]);
  const broken = peopleRows(host).length;
  host.consume({ ...emptyBatch(), v: [v(260)] });
  expect(peopleRows(host).slice(broken).filter(row => row.id === actor)).toEqual([]);
  host.consume({ ...emptyBatch(), actors: [{ t: 261, who: 'a1', valid: true, position: [25, 20, 0] }], v: [v(340)] });
  expect(peopleRows(host).filter(row => row.id === actor).at(-1).anchor).toEqual({ at: [25, 20, 0] });
  expect(host.sim.k.value(actor, 'position')).toEqual([25, 20, 0]);
});

test('actor-only gap batches revoke all people without V, clock advancement or synthetic inputs', () => {
  const host = new ShadowHost(defaultReader, world, meta, temp());
  host.consume({ ...batch(), v: [v(100), v(180)], actors: [...batch().actors, { t: 102, who: 'a2', valid: true, position: [22, 20, 0] }] });
  const before = host.summary(), position = host.sim.k.value(host.sim.w.vState, 'position'), rows = peopleRows(host).length;
  const clock = spyOn(host.clock, 'at');
  const resolve = spyOn(host.sim.k, 'value');
  host.consume({ ...emptyBatch(), gaps: [{ from: 181, to: 181, fromSeq: 5, toSeq: 5, reason: 'invalid', channel: 'actors' }] });
  expect(resolve).not.toHaveBeenCalled(); resolve.mockRestore();
  expect(clock).not.toHaveBeenCalled(); clock.mockRestore();
  const after = host.summary();
  for (const key of ['windows', 'observations', 'inputs', 'pendingInputs', 'gameThrough', 'lastObservedGameTime', 'clock'] as const) expect(after[key]).toEqual(before[key]);
  expect(host.sim.k.value(host.sim.w.vState, 'position')).toEqual(position);
  expect(peopleRows(host).slice(rows).map(row => row.retract).sort()).toEqual(['a1', 'a2'].map(who => mirroredId(host.key(who))).sort());
  // A later V sample still follows its own track through the actor-scoped gap.
  host.consume({ ...emptyBatch(), v: [v(182, 6, [30, 20, 0]), v(260)] });
  expect(host.sim.k.value(host.sim.w.vState, 'position')).toEqual([30, 20, 0]);
  expect(defaultReader.snapshotAt({ ...host.session, v: [v(180), v(182)] }, 182, 'full', world).trail).toHaveLength(1);
});

for (const channel of ['actors', undefined] as const) test(`${channel ?? 'shared'} interval gap retracts at its start, including an actor sample at that endpoint`, () => {
  const host = new ShadowHost(defaultReader, world, meta, temp());
  host.consume({ ...batch(), v: [v(100), v(180)] });
  const actor = mirroredId(host.key('a1')), before = peopleRows(host).length;
  expect(peopleRows(host).some(row => row.id === actor)).toBe(true);
  const gap = { from: 181, to: 261, fromSeq: 5, toSeq: 8, reason: 'sequence' as const, ...(channel ? { channel } : {}) };
  // The V sample closes a simulation window strictly inside the known interval.
  host.consume({ ...emptyBatch(), gaps: [gap], actors: [{ ...batch().actors[0], t: gap.from }], v: [v(250, 7, [30, 20, 0])] });
  expect(host.summary().windows).toBe(2);
  const changed = peopleRows(host).slice(before).filter(row => row.id === actor || row.retract === actor);
  expect(changed).toEqual([{ retract: actor, t: 181 }]);
  for (const t of [181, 250, 260]) {
    const last = peopleRows(host).filter(row => row.t <= t && (row.id === actor || row.retract === actor)).at(-1);
    expect(last?.retract).toBe(actor);
  }
  const source = { ...host.session, v: [v(180), v(250, 7), v(261, 8)] };
  expect(defaultReader.snapshotAt(source, 250, 'full', world).inGap).toBe(!channel);
  expect(defaultReader.snapshotAt(source, 261, 'full', world).trail).toHaveLength(channel ? 1 : 2);
  // The gap ending does not itself restore the old actor position.
  host.consume({ ...emptyBatch(), v: [v(330)] });
  expect(peopleRows(host).slice(before).filter(row => row.id === actor)).toEqual([]);
  host.consume({ ...emptyBatch(), actors: [{ t: 331, who: 'a1', valid: true, position: [25, 20, 0] }], v: [v(410)] });
  expect(peopleRows(host).filter(row => row.id === actor).at(-1)).toMatchObject({ t: 410, anchor: { at: [25, 20, 0] } });
});

for (const channel of ['actors', undefined] as const) for (const publishedAt of [180, 250]) {
  test(`${channel ?? 'shared'} retrospective gap supersedes the ${publishedAt} revision in Holotable, matching up-front discovery`, async () => {
    const roots = [temp(), temp()];
    const [live, offline] = roots.map(root => new ShadowHost(defaultReader, world, meta, join(root, 'story-engine')));
    const readers = roots.map(root => createLayerSpool(root));
    const initial: Batch = { ...batch(), actors: [{ ...batch().actors[0], entity: undefined }], v: [v(100), v(180), ...(publishedAt === 250 ? [v(250)] : [])] };
    const gap = { from: publishedAt - 0.1, to: publishedAt + 1, fromSeq: 5, toSeq: 8, reason: 'sequence' as const, ...(channel ? { channel } : {}) };
    const actor = mirroredId(live.key('a1'));
    const visible = (data: Awaited<ReturnType<typeof readers[0]['read']>>, host: ShadowHost, t: number) =>
      evaluateLayers(data, host.session, t, 'full', [], world).flatMap(layer => layer.items).some(item => item.id === actor);
    try {
      live.consume(initial);
      const before = await readers[0].read();
      expect(visible(before, live, publishedAt)).toBe(true);
      expect(evaluateLayers(before, live.session, publishedAt, 'full', [], world).flatMap(layer => layer.items).find(item => item.id === actor)?.place).toEqual([21, 20, 0]);
      live.consume({ ...emptyBatch(), gaps: [gap] });
      offline.consume({ ...initial, gaps: [gap] });
      const tombstones = (host: ShadowHost) => peopleRows(host).filter(row => row.retract === actor);
      for (const host of [live, offline]) host.consume({ ...emptyBatch(), v: [v(330), v(410)] });
      const data = await Promise.all(readers.map(reader => reader.read()));
      for (let i = 0; i < readers.length; i++) {
        expect(data[i].every(layer => layer.refused === 0)).toBe(true);
        for (const t of [gap.from, publishedAt - 0.05, publishedAt, publishedAt + 0.5, gap.to, 330, 410]) {
          expect(visible(data[i], [live, offline][i], t)).toBe(visible(data[1], offline, t));
          expect(visible(data[i], [live, offline][i], t)).toBe(false);
        }
      }
      expect(tombstones(live)).toEqual([{ retract: actor, t: gap.from }, { retract: actor, t: publishedAt }]);
      expect(tombstones(offline)).toEqual([{ retract: actor, t: gap.from }]);
    } finally { for (const reader of readers) reader.close(); }
  });
}

test('a retrospective gap supersedes the latest revision on its save branch and preserves the sibling prefix', async () => {
  const root = temp(), host = new ShadowHost(defaultReader, world, meta, join(root, 'story-engine'));
  const reader = createLayerSpool(root), actor = mirroredId(host.key('a1'));
  try {
    host.consume({ ...batch(), v: [v(100), v(180), v(250), v(330)] });
    host.sim.k.persistence.save('late-gap-branch');
    host.consume({ ...emptyBatch(), gaps: [{ from: 249.9, to: 331, fromSeq: 5, toSeq: 8, reason: 'sequence', channel: 'actors' }] });
    const data = await reader.read();
    const visible = (t: number, branch: string) => evaluateLayers(data, host.session, t, 'full', [], world, branch).flatMap(layer => layer.items).some(item => item.id === actor);
    for (const t of [249.9, 249.95, 250, 250.5, 300, 330, 331, 410]) {
      expect(visible(t, 'late-gap-branch')).toBe(false);
      expect(visible(t, 'sibling')).toBe(true);
    }
    expect(peopleRows(host).filter(row => row.retract === actor)).toEqual([249.9, 250, 330].map(t => ({ retract: actor, t, branch: 'late-gap-branch' })));
  } finally { reader.close(); }
});

test('channel coverage carries read/kept/dropped/reasons, sorted, including unmapped channels', () => {
  const host = new ShadowHost(defaultReader, world, meta, temp());
  const channels: Batch['meta']['channels'] = [
    { name: 'z-unmapped', read: 7, kept: 2, dropped: 5, reasons: { unsupported: 3, invalid: 2 } },
    { name: 'actors', read: 4, kept: 3, dropped: 1, reasons: { invalid: 1 } },
    { name: 'incidents', read: 10, kept: 10, dropped: 0, reasons: {} },
  ];
  host.consume({ ...emptyBatch(), meta: { ...meta, channels } });
  expect(host.summary().coverage.channels).toEqual([channels[1], channels[2], channels[0]]);
  expect(host.summary().unmappedSourceChannels).toEqual(['z-unmapped']);
  expect(JSON.stringify(host.summary().coverage.channels.at(-1)?.reasons)).toBe('{"invalid":2,"unsupported":3}');
});

test('witness reports feed admitted raw port events once per incident at the causal observation clock', () => {
  const host = new ShadowHost(defaultReader, world, meta, temp());
  const submit = spyOn(host.port, 'submit');
  const report = { event: 'witness.report' as const, incident: 'inc-1', kind: 'assault',
    place: { position: [20, 20, 0] as [number, number, number], first: [20, 20, 0] as [number, number, number], last: [20, 20, 0] as [number, number, number], district_v: 'Kabuki' },
    when: { start_sim_s: 1, end_sim_s: 2, duration_s: 1, start_game_s: 10000, end_game_s: 10001 }, delayed: true };
  expect(initialGameTime({ ...emptyBatch(), events: [incident(101, 2, report)] })).toBe(8);
  host.consume({ ...emptyBatch(), v: [v(100)], events: [incident(101, 2, report), incident(102, 3, report)] });
  host.consume({ ...emptyBatch(), events: [incident(103, 4, { ...report, incident: 'inc-2' })], v: [v(180)] });
  const raws = submit.mock.calls.flatMap(([lines]) => lines).filter(line => line.op === 'event');
  submit.mockRestore();
  expect(raws.map(line => [line.kind, line.t])).toEqual([
    ['game.incident', 8], ['game.witness.report', 8], ['game.witness.report', 16], ['game.incident', 24], ['game.witness.report', 24],
  ]);
  expect(raws.every(line => line.place === host.locate([20, 20, 0]).cell && !line.effects && line.participants.length === 0)).toBe(true);
  expect(host.summary().mapped).toEqual({ 'game.incident': 2, 'game.witness.report': 3 });
  const minted = [...host.sim.k.store.headers.keys()].flatMap(id => { const fact = host.sim.k.events.mintedFacts(id); return fact && fact.kind.startsWith('game.') ? [fact] : []; });
  expect(minted.map(f => [f.kind, f.time]).sort()).toEqual(raws.map(line => [line.kind, line.t]).sort());
  for (const name of ['game.incident', 'game.witness.report']) {
    expect(host.sim.w.kinds.get(name)?.family).toBe('raw');
    expect(host.sim.k.eventKinds.eventKind(name)?.fills).toEqual([]);
    expect(host.sim.w.kinds.get(name)?.effects).toEqual([]);
  }
});

test('incident gaps, unwitnessed receipts and coverage retain their counts and native coverage values', () => {
  const host = new ShadowHost(defaultReader, world, meta, temp());
  const events = [incident(101, 1, { event: 'witness.gap', incident: 'inc-gap', reason: 'queue_limit', queue_limit: 64 }),
    incident(102, 2, { event: 'witness.unwitnessed', incident: 'inc-unseen' }),
    incident(103, 3, { event: 'incident.coverage', reports: 2, dropped_invalid: 0, declared: 4, valid: false, tap_dropped_cap: 7 }),
    incident(104, 4, { event: 'incident.coverage', reports: 3, dropped_invalid: 1, declared: 0, valid: true })];
  host.consume({ ...emptyBatch(), v: [v(100)], events });
  expect(host.summary().mapped).toEqual({});
  expect(host.summary().unmapped).toMatchObject({ 'incident event:witness.gap': 1, 'incident event:witness.unwitnessed': 1, 'incident event:incident.coverage': 2 });
  expect(host.summary().incidentReceipts).toEqual(events.map(e => ({ t: e.t, seq: e.seq, receipt: e.incident! })));
});

test('actor trail breaks retract inherited people only on the current save branch', () => {
  const host = new ShadowHost(defaultReader, world, meta, temp());
  host.consume({ ...batch(), v: [v(100), v(180)] });
  const actor = mirroredId(host.key('a1'));
  host.sim.k.persistence.save('shadow-branch');
  host.consume({ ...emptyBatch(), actors: [{ t: 181, who: 'a1', valid: false }] });
  expect(peopleRows(host).filter(row => row.retract === actor)).toEqual([{ retract: actor, t: 181, branch: 'shadow-branch' }]);
  host.consume({ ...emptyBatch(), actors: [{ t: 182, who: 'a1', valid: true, position: [23, 20, 0] }], v: [v(260)] });
  expect(peopleRows(host).filter(row => row.id === actor).at(-1)).toMatchObject({ branch: 'shadow-branch', anchor: { at: [23, 20, 0] } });
});

test('clock prefers game readings; fallback is causal, declared and rejects rollback', () => {
  const c = new ShadowClock(meta);
  expect(c.at(100)).toEqual({ game: 0, derived: true });
  expect(c.at(110, 1000)).toEqual({ game: 1000, derived: false });
  expect(c.at(111)).toEqual({ game: 1008, derived: true });
  expect(c.at(111.5, undefined, true)).toEqual({ game: 1008, derived: true });
  expect(c.at(111.6, undefined, true)).toEqual({ game: 1008, derived: true });
  expect(c.at(112)).toEqual({ game: 1016, derived: true });
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
  expect(summary.unmappedSourceChannels).toContain('unknown-channel');
  expect(summary.coverage.channels.map(c => c.name)).toEqual(['actors', 'camera', 'incidents', 'unknown-channel', 'v']);
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
  input.actors.push({ t: 200, who: 'a1', valid: false });
  input.gaps.push({ from: 210, to: 210, fromSeq: 3, toSeq: 3, reason: 'invalid', channel: 'actors' });
  input.events = [incident(110, 2, { event: 'witness.report', incident: 'inc-1' }),
    incident(120, 3, { event: 'witness.report', incident: 'inc-1' }),
    incident(130, 4, { event: 'incident.coverage', observed: 2, reports: 2, dropped_rate: 0 })];
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
  data.actors = [{ t: 100.5, who: 'a1', valid: true, position: [20, 20, 0] }];
  data.events = [incident(100.6, 2, { event: 'witness.report', incident: 'paused-incident' })];
  const boundaries: number[] = [], evolution = host.sim.k.evolution, step = evolution.stepBoundary.bind(evolution);
  evolution.stepBoundary = report => { boundaries.push(evolution.cursor + 1); return step(report); };
  host.consume(data); expect(host.summary().windows).toBe(1);
  expect(host.summary().gameThrough).toBe(7800);
  expect(boundaries).toEqual([12, 13]);
});

test('latest source reading wins per node/slot/second across live batches', () => {
  const host = new ShadowHost(defaultReader, world, meta, temp(), 0, 600);
  const feed = (t: number, gameTime: number, position: [number, number, number]): Batch => ({ ...batch(),
    v: [{ ...v(t, 1, position), gameTime }], actors: [{ t, who: 'a1', valid: true, position }], camera: [], events: [], gaps: [] });
  host.consume(feed(100, 600.1, [20, 20, 0]));
  host.consume(feed(100.05, 600.5, [220, 20, 0]));
  host.consume(feed(100.1, 600.9, [120, 20, 0]));
  host.consume(feed(180, 1200, [20, 20, 0]));
  const state = host.sim.w.vState, actor = mirroredId(host.key('a1'));
  expect(host.sim.k.value(state, 'position')).toEqual([120, 20, 0]);
  expect(host.sim.k.value(state, 'district')).toBe(host.locate([120, 20, 0]).district);
  expect(host.sim.k.value(state, 'cell')).toBe('0'.repeat(32));
  expect(host.sim.k.value(actor, 'position')).toEqual([120, 20, 0]);
  for (const node of [state, actor]) expect(host.sim.k.store.pinsOfNode(node).filter(p => p.reason === 'game' && p.slot === 'position')).toHaveLength(1);
  expect(host.summary().inputs).toBe(4);
});

test('CLI starts from the earliest observation with the consumption clock, holding manifest anchors', async () => {
  const data: Batch = { ...batch(), meta: { ...meta, gameTimeSamples: [{ source: 100, game: 0 }, { source: 275, game: 600 }] },
    v: [v(200), v(275)], actors: [] };
  expect(initialGameTime(data)).toBe(0);
  expect(initialGameTime({ ...data, v: [{ ...v(200), gameTime: 900 }], actors: [{ t: 150, who: 'first', valid: true, position: [20, 20, 0] }] })).toBe(0);
  expect(initialGameTime({ ...data, v: [v(275), v(200)] })).toBe(0);
  const folder = temp(), log = join(folder, 'input.jsonl'), pack = join(folder, 'world.json'), out = temp();
  writeFileSync(log, JSON.stringify({ schema: 'xfse/shadow-live-1' }) + '\n' + JSON.stringify({ batch: data }) + '\n');
  writeFileSync(pack, JSON.stringify(world));
  const output = spyOn(console, 'log').mockImplementation(() => {});
  try { await runCli(['--replay-log', log, out, '--world-pack', pack]); } finally { output.mockRestore(); }
  const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
  expect(summary.windows).toBe(1); expect(summary.gameThrough).toBe(600); expect(summary.lastObservedGameTime).toBe(600);
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

test('never acts: live adapter and real CommandApi select a reader and issue only retained-data reads', async () => {
  const runtimeDir = temp(), calls: string[] = [], selections: boolean[] = [];
  writeFileSync(join(runtimeDir, 'session.json'), JSON.stringify({ protocol: 1, sid: 'synthetic', pid: process.pid, pipe: 'forbidden-writer',
    read_only_pipes: ['synthetic-reader'], token: 'synthetic', allow_writes: true }));
  // Inject at the native transport boundary; keep readOnlyBridge, its wrapper,
  // CommandApi.run and the local game.catchup expansion in the exercised path.
  const connect = spyOn(BridgeClient.prototype, 'connect').mockImplementation(async options => {
    selections.push(options?.readOnly === true);
    if (!options?.readOnly) throw Error('Writer slot forbidden');
  });
  const call = spyOn(BridgeClient.prototype, 'call').mockImplementation(async (method, _params, cid) => {
    calls.push(method);
    let result: unknown;
    switch (method) {
      case 'recorder.status': result = { active: true, run: 1, session: 'synthetic', world: 1, channels: ['v'], start: { s: 100 }, latest: 1 }; break;
      case 'bridge.info': result = { sid: 'synthetic' }; break;
      case 'test.record.read': result = { run: 1, session: 'synthetic', world_generation: 1, active: true, latest: 1, next: 1, lost: 0,
        start_s: 100, end_s: null, source_now_s: 100, records: [{ seq: 1, run: 1, session: 'synthetic', world_generation: 1, valid: true, source_s: 100, channel: 'v', data: { position: [20, 20, 0], yaw: 0 } }] }; break;
      case 'session.events': result = { events: [], next: 0, latest: 0, dropped: 0 }; break;
      default: throw Error(`Non-read transport method forbidden: ${method}`);
    }
    return { v: 1, id: 1, cid: cid ?? 'synthetic', ok: true, result };
  });
  let consumed = 0;
  const live = watchLive(readOnlyBridge(options => new CommandApi({ ...options, runtimeDir })), join(temp(), 'live.jsonl'),
    { consume(batch) { consumed += batch.v.length; } }, { clock: { now: () => 0, later: () => () => {} } });
  try {
    await new Promise(setImmediate); live.heartbeat();
    expect(selections).toEqual([true]);
    expect(calls).toEqual(['recorder.status', 'bridge.info', 'test.record.read', 'session.events']);
    expect(consumed).toBe(1);
  } finally { live.close(); connect.mockRestore(); call.mockRestore(); }
});

for (const stage of ['discovery', 'page'] as const) for (const failure of ['budget', 'disk'] as const) {
  test(`live ${stage} transport-log ${failure} failure is fatal and stops retries`, async () => {
    const log = join(temp(), 'live.jsonl');
    let timer: (() => void) | undefined, closes = 0, requests = 0, consumed = 0;
    const breakDisk = () => { rmSync(log); mkdirSync(log); };
    const bridge: LiveBridge = {
      async discover() {
        requests++;
        if (stage === 'discovery' && failure === 'disk') breakDisk();
        return { available: true, recorder: { active: true, run: 1, session: 'synthetic', world: 1, channels: ['v'], start: 100, latest: 1, stopReason: null } };
      },
      async catchup() {
        requests++;
        if (stage === 'page' && failure === 'disk') breakDisk();
        return { cursor: { sid: 'synthetic', run: 1, world: 1, record: 0, event: 0 }, records: [], events: [],
          calibration: { source_s: 100, host_after_ms: 0 }, padding: 'x'.repeat(3000) };
      },
      close() { closes++; },
    };
    const live = watchLive(bridge, log, { consume(b) { consumed += b.v.length; } }, {
      maxLogBytes: failure === 'budget' ? stage === 'discovery' ? 1 : 2000 : undefined,
      clock: { now: () => 0, later(_ms, fn) { timer = fn; return () => { timer = undefined; }; } },
    });
    await new Promise(setImmediate);
    expect(() => live.heartbeat()).toThrow(failure === 'budget' ? 'budget' : undefined);
    expect(() => live.close()).toThrow();
    expect(closes).toBe(1); expect(timer).toBeUndefined(); expect(consumed).toBe(0);
    expect(requests).toBe(stage === 'discovery' ? 1 : 2);
  });
}

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
      if (i === 0) records.push({ ...row(101, 2), channel: 'actors', data: { actors: [{ who: 'a1', valid: true, entity: 'entity-1', position: [21, 20, 0] }] } });
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
