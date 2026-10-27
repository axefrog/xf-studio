import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createLiveSource } from '../../../../xf-holotable/src/live.ts';
import { createLiveBridge, type LiveBridge } from '../../../../xf-holotable/src/live-bridge.ts';
import { type Batch, type FeedSession } from './feed.ts';

export interface BatchSink { consume(batch: Batch): void }
const MAX_LOG_BYTES = 64 * 1024 * 1024;
/** An independent read-only reader connection. This allowlist is a second gate
 * above CommandApi({readOnly:true}); no fallback or write command is exposed. */
export function readOnlyBridge(createApi: (options: CommandApiOptions) => CommandApi = options => new CommandApi(options)): LiveBridge {
  return createLiveBridge(options => {
    if (options.readOnly !== true) throw Error('Shadow requires readOnly');
    // Constructed lazily by the live CLI, never when replaying offline.
    return new ReadOnlyApi(options, createApi(options));
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
export function watchLive(bridge: LiveBridge, log: string, sink: BatchSink, options: { clock?: NonNullable<Parameters<typeof createLiveSource>[1]>['clock']; maxLogBytes?: number } = {}) {
  let logBytes = 0, cursor: unknown, fatal: Error | undefined;
  let lengths = { v: 0, actors: 0, events: 0, camera: 0, gaps: 0 };
  let identity: string | undefined, closed = false;
  let previousMeta: string | undefined;
  const maxLogBytes = options.maxLogBytes ?? MAX_LOG_BYTES;
  if (!Number.isSafeInteger(maxLogBytes) || maxLogBytes < 1 || maxLogBytes > MAX_LOG_BYTES) throw Error('Invalid shadow live log budget');
  const header = JSON.stringify({ schema: 'xfse/shadow-live-1' }) + '\n';
  writeFileSync(log, header, { flag: 'wx' }); logBytes = Buffer.byteLength(header);
  const stop = () => { if (closed) return; closed = true; source.close(); };
  const fail = (e: unknown) => { fatal ??= e instanceof Error ? e : new Error(String(e)); stop(); return fatal; };
  const record = (value: unknown) => {
    if (fatal) throw fatal;
    try {
      const line = JSON.stringify(value) + '\n'; logBytes += Buffer.byteLength(line);
      if (logBytes > maxLogBytes) throw Error('Shadow live log reached byte budget (maximum 64 MiB)');
      appendFileSync(log, line);
    } catch (e) { throw fail(e); }
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
      if (fatal) throw fatal;
      const page = await bridge.catchup(input, signal); record({ request: input, page }); cursor = page.cursor;
      return page;
    },
    close: () => bridge.close(),
  }, { clock: options.clock, changed(session) { try { capture(session); } catch (e) { fail(e); } } });
  const watch = source.watch().watch;
  return {
    source, watch,
    heartbeat() { if (fatal) throw fatal; source.renew(watch); const session = source.session(); if (session) { try { capture(session); } catch (e) { throw fail(e); } } },
    close() { stop(); if (fatal) throw fatal; const session = source.session(); if (session) { try { capture(session); } catch (e) { throw fail(e); } } },
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
