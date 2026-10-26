import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { defaultReader, loadReader, recordingBatch, type Batch, type WorldPack } from '../../src/shadow/feed.ts';
import { ShadowHost } from '../../src/shadow/host.ts';
import { readOnlyBridge, replayLog, watchLive } from '../../src/shadow/live.ts';

export async function runCli(args: string[]) {
  const usage = 'bun tools/shadow/run.ts <recording-run-dir> <fresh-out-dir> | --live <fresh-out-dir> | --replay-log <log> <fresh-out-dir> [--world-pack <file>] [--holotable-root <project-dir>] [--default-game-start <seconds>] [--duration <seconds>]';
  let input: string | undefined, out: string | undefined, mode: 'recording' | 'live' | 'log' = 'recording';
  if (args[0] === '--live') { mode = 'live'; out = args[1]; args = args.slice(2); }
  else if (args[0] === '--replay-log') { mode = 'log'; input = args[1]; out = args[2]; args = args.slice(3); }
  else { [input, out] = args; args = args.slice(2); }
  if (!out || out.startsWith('--') || mode !== 'live' && !input) throw Error(usage);
  let pack = resolve(import.meta.dir, '../../../../../local/holotable/world-pack.json');
  let root: string | undefined, defaultStart = 0, duration = 60;
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1]; if (!value) throw Error(usage);
    if (args[i] === '--world-pack') pack = resolve(value);
    else if (args[i] === '--holotable-root') root = resolve(value);
    else if (args[i] === '--default-game-start') defaultStart = Number(value);
    else if (args[i] === '--duration') duration = Number(value);
    else throw Error(usage);
  }
  if (!Number.isFinite(defaultStart) || !Number.isFinite(duration) || duration <= 0 || duration > 3600) throw Error('Finite game start and live duration (0–3600 seconds) required');
  const world = JSON.parse(readFileSync(pack, 'utf8')) as WorldPack;
  if (world.schema !== 'xfh/world-pack-1' || !Array.isArray(world.areas)) throw Error('Expected xfh/world-pack-1');
  const reader = root ? await loadReader(root) : defaultReader;
  let host: ShadowHost | undefined;
  const prelude: Batch[] = [];
  const sink = { consume(batch: Batch) {
    if (!host && !batch.v.length && !batch.actors.length) { prelude.push(batch); return; }
    const first = batch.v[0], qpc = Math.min(first?.t ?? Infinity, batch.actors[0]?.t ?? Infinity);
    const anchor = batch.meta.gameTimeSamples?.filter(x => x.source <= qpc).at(-1);
    const initial = first?.gameTime ?? (anchor ? anchor.game + (qpc - anchor.source) * 8 : defaultStart + (qpc - batch.meta.start) * 8);
    host ??= new ShadowHost(reader, world, batch.meta, out!, defaultStart, initial);
    for (const earlier of prelude.splice(0)) host.consume(earlier);
    host.consume(batch);
  } };
  if (mode === 'recording') sink.consume(await recordingBatch(reader, resolve(input!)));
  else if (mode === 'log') replayLog(resolve(input!), sink);
  else {
    const scratch = resolve(import.meta.dir, '../../../../../.scratch-shadow'); mkdirSync(scratch, { recursive: true });
    const log = join(scratch, `live-${Date.now()}.jsonl`);
    const ctl = new AbortController(), stop = () => ctl.abort(); process.once('SIGINT', stop);
    const live = watchLive(readOnlyBridge(), log, sink);
    const deadline = performance.now() + duration * 1000;
    try {
      while (!ctl.signal.aborted && performance.now() < deadline) {
        await pause(Math.min(1000, Math.max(1, deadline - performance.now())), undefined, { signal: ctl.signal }).catch(e => { if (!ctl.signal.aborted) throw e; });
        if (!ctl.signal.aborted) live.heartbeat();
      }
    } finally { live.close(); process.removeListener('SIGINT', stop); }
    console.log(`Private live replay log: ${log}`);
  }
  if (!host) throw Error('No recording observations received');
  const summary = host.summary();
  // Timing is measured separately; deterministic artifacts never contain wall time.
  const { performance: timing, ...deterministic } = summary;
  writeFileSync(join(out!, 'summary.json'), JSON.stringify(deterministic, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ ...deterministic, performance: timing }, null, 2));
}
if (import.meta.main) await runCli(process.argv.slice(2));
