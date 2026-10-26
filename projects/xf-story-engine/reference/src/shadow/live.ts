import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createLiveSource } from '../../../../xf-holotable/src/live.ts';
import { createLiveBridge, type LiveBridge } from '../../../../xf-holotable/src/live-bridge.ts';
import { type Batch, type FeedSession } from './feed.ts';

export interface BatchSink { consume(batch: Batch): void }
const MAX_LOG_BYTES = 64 * 1024 * 1024;
/** An independent read-only reader connection. This allowlist is a second gate
 * above CommandApi({readOnly:true}); no fallback or write command is exposed. */
export function readOnlyBridge(): LiveBridge {
  return createLiveBridge(options => {
    if (options.readOnly !== true) throw Error('Shadow requires readOnly');
    // Constructed lazily by the live CLI, never when replaying offline.
    return new ReadOnlyApi(options);
  });
}
import { CommandApi, type CommandApiOptions } from '../../../../xf-runtime-bridge/tools/api/command-api.ts';
export class ReadOnlyApi {
  private api: Pick<CommandApi, 'callBridge' | 'run' | 'close'>;
  constructor(options: CommandApiOptions, api?: Pick<CommandApi, 'callBridge' | 'run' | 'close'>) { this.api = api ?? new CommandApi({ ...options, readOnly: true }); }
  callBridge(...args: Parameters<CommandApi['callBridge']>) {
    if (args[0] !== 'recorder.status') throw Error(`Non-read shadow command refused: ${args[0]}`);
    return this.api.callBridge(...args);
  }
  run(...args: Parameters<CommandApi['run']>) {
    if (args[0] !== 'game.catchup') throw Error(`Non-read shadow command refused: ${args[0]}`);
    return this.api.run(...args);
  }
  close() { this.api.close(); }
}

/** Log exact transport receipts and the exact normalized batches consumed. The
 * latter replay without a bridge, clocks, timers, cursor regeneration or the game.
 * Logs are private scratch evidence, never repository fixtures. */
export function watchLive(bridge: LiveBridge, log: string, sink: BatchSink, options: { clock?: NonNullable<Parameters<typeof createLiveSource>[1]>['clock'] } = {}) {
  let logBytes = 0, cursor: unknown, fatal: Error | undefined;
  let lengths = { v: 0, actors: 0, events: 0, camera: 0, gaps: 0 };
  let identity: string | undefined, closed = false;
  let previousMeta: string | undefined;
  writeFileSync(log, JSON.stringify({ schema: 'xfse/shadow-live-1' }) + '\n', { flag: 'wx' });
  const record = (value: unknown) => {
    const line = JSON.stringify(value) + '\n'; logBytes += Buffer.byteLength(line);
    if (logBytes > MAX_LOG_BYTES) throw Error('Shadow live log reached 64 MiB budget');
    appendFileSync(log, line);
  };
  const capture = (session: FeedSession) => {
    const key = JSON.stringify([session.meta.session, session.meta.run, session.meta.worldGeneration]);
    if (identity && key !== identity) throw Error('Live recording changed; start a fresh output directory');
    identity = key;
    const batch: Batch = { meta: structuredClone(session.meta), v: session.v.slice(lengths.v), actors: (session.actors ?? []).slice(lengths.actors),
      camera: session.camera.slice(lengths.camera), events: session.events.slice(lengths.events), gaps: session.gaps.slice(lengths.gaps) };
    lengths = { v: session.v.length, actors: session.actors?.length ?? 0, camera: session.camera.length, events: session.events.length, gaps: session.gaps.length };
    const meta = JSON.stringify(batch.meta);
    if (!batch.v.length && !batch.actors.length && !batch.camera.length && !batch.events.length && !batch.gaps.length && previousMeta === meta) return;
    previousMeta = meta;
    record({ batch, cursor }); sink.consume(batch);
  };
  const source = createLiveSource({
    async discover(signal) { const result = await bridge.discover(signal); record({ discovery: result }); return result; },
    async catchup(input, signal) {
      const page = await bridge.catchup(input, signal); record({ request: input, page }); cursor = page.cursor;
      return page;
    },
    close: () => bridge.close(),
  }, { ...options, changed(session) { try { capture(session); } catch (e) { fatal = e as Error; } } });
  const watch = source.watch().watch;
  return {
    source, watch,
    heartbeat() { if (fatal) throw fatal; source.renew(watch); const session = source.session(); if (session) capture(session); },
    close() { if (closed) return; closed = true; source.close(); const session = source.session(); if (session) capture(session); },
  };
}
export function replayLog(file: string, sink: BatchSink): void {
  if (statSync(file).size > MAX_LOG_BYTES + 1024 * 1024) throw Error('Shadow log exceeds replay budget');
  const data = readFileSync(file);
  if (data.length > MAX_LOG_BYTES + 1024 * 1024) throw Error('Shadow log exceeds replay budget');
  const rows = data.toString('utf8').split('\n');
  const header = JSON.parse(rows.shift()!);
  if (header.schema !== 'xfse/shadow-live-1') throw Error('Expected xfse/shadow-live-1 log');
  for (const line of rows) {
    if (!line) continue;
    const row = JSON.parse(line); if (row.batch) sink.consume(row.batch);
  }
}
