import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { HolotableObserver } from '../../src/holotable/observe.ts';
import { importedLayout, schematicLayout, type Area } from '../../src/holotable/layout.ts';
import { validateManifest } from '../../src/holotable/schema.ts';
import { readRunRecord, encodeRunRecord } from '../../src/m3/run-record.ts';
import { createWeek3, runWeek3, type Week3Config, type Week3Record } from '../../src/m3/week3.ts';
import type { ImportedWorldIndex } from '../../src/world/types.ts';
import { importedWorld } from '../../src/world/types.ts';
import type { Run } from '../../src/m3/driver.ts';
import type { LogEntry } from '../../src/procedural/types.ts';
import { RunPublisher, publishBoundary, spoolLine } from './publish-run.ts';

/** Wall-clock duration is the only nondeterministic field in the archived record. */
export function canonicalRun(record: Week3Record): string {
  const copy = JSON.parse(JSON.stringify(record));
  delete copy.diagnostics.seconds;
  const ordered = (value: any): any => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
  return JSON.stringify(ordered(copy));
}
export const runDigest = (record: Week3Record): string => createHash('sha256').update(canonicalRun(record)).digest('hex');

function firstDifference(a: any, b: any, path = 'record'): string | undefined {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const diff = firstDifference(a[key], b[key], `${path}.${key}`); if (diff) return diff;
    }
  }
  return `${path}: archive=${JSON.stringify(a)?.slice(0, 400)}, regenerated=${JSON.stringify(b)?.slice(0, 400)}`;
}

export function publishM3Week(output: string, expected: Week3Record, areas: readonly Area[], options: {
  holotableHooks?: boolean;
  /** Supply the same configured run as the expected record (including its index). */
  run?: Run;
  deadline?: number;
  identitySource?: 'archive' | 'observer-off';
  progress?: (run: Run, seconds: number) => void;
} = {}) {
  const directory = resolve(output), pending = directory + '.pending';
  if (existsSync(directory) || existsSync(pending)) throw Error('Use a fresh output directory (and no .pending sibling)');
  if (expected.version !== 3 || expected.method !== 'reviewed-v5' || !['E', 'A1'].includes(expected.arm) ||
    !Number.isSafeInteger(expected.windows) || expected.windows < 1) throw Error('Expected a reviewed-v5 engine run-3 record');
  const c: Week3Config = expected;
  const start = performance.now(), run = options.run ?? createWeek3(c);
  const real = !!importedWorld(run.w.sim.w.index);
  const setupStart = performance.now(), directorLog: LogEntry[] = [], seenLogs = new Set<string>();
  const observer = new HolotableObserver(run.w.sim, run.w.l2, run.w.l3, { layout: importedLayout(run.w.sim.w.index) ?? schematicLayout(run.w.sim.w.index, areas), runStartSeconds: run.w.sim.k.now, directorLog });
  const from = run.w.sim.k.now + observer.epoch;
  // This is private staging only. The actual bound replaces it after identity proof.
  const publisher = new RunPublisher(pending, { set: c.id.toLowerCase(), title: real ? 'Kabuki week (real streets)' : 'Kabuki week (simulated)', from, to: Number.MAX_SAFE_INTEGER, schematic: !real }, options);
  const setupMs = performance.now() - setupStart;
  let publishingMs = setupMs, observations = 0, observerMs = 0, writerMs = 0, logCopyMs = 0;
  const boundary = () => {
    const before = performance.now();
    for (const log of run.w.l3?.log ?? []) if (log.kind === 'sow' || log.kind === 'hold') {
      const key = `${log.at.game}-${log.at.playTotal}-${log.seq}`;
      if (!seenLogs.has(key)) { seenLogs.add(key); directorLog.push(structuredClone(log)); }
    }
    logCopyMs += performance.now() - before;
    publishBoundary(observer, publisher, (sample, write) => { observerMs += sample; writerMs += write; });
    publishingMs += performance.now() - before; observations++;
  };
  boundary();
  const record = runWeek3(c, { run, boundary, progress: options.progress, deadline: options.deadline ?? Date.now() + 75 * 60000 });
  const verificationStart = performance.now();
  mkdirSync(dirname(directory), { recursive: true });
  writeFileSync(directory + '.run.json.gz', encodeRunRecord(record));
  const archivedDigest = runDigest(expected), regeneratedDigest = runDigest(record);
  if (archivedDigest !== regeneratedDigest) {
    const difference = firstDifference(JSON.parse(canonicalRun(expected)), JSON.parse(canonicalRun(record)));
    throw Error(`Run identity mismatch; nothing promoted. ${difference}. archive=${archivedDigest}, regenerated=${regeneratedDigest}`);
  }
  const verificationMs = performance.now() - verificationStart;
  publishingMs += verificationMs;
  const before = performance.now(), to = run.w.sim.k.now + observer.epoch;
  for (const file of readdirSync(pending)) {
    const path = join(pending, file), [header, ...lines] = readFileSync(path, 'utf8').trimEnd().split('\n');
    const manifest = JSON.parse(header!); manifest.standalone.to = to; validateManifest(manifest);
    for (const line of lines) {
      const item = JSON.parse(line);
      if (item.t < from || item.t > to || item.until !== undefined && item.until > to) throw Error('Staged item exceeds actual run bounds');
    }
    writeFileSync(path, spoolLine(manifest) + (lines.length ? lines.join('\n') + '\n' : ''));
  }
  renameSync(pending, directory);
  const finalizeMs = performance.now() - before;
  publishingMs += finalizeMs;
  // Use the observer's actual development decision, rather than recreating its
  // receipt/outcome rules or inferring hidden counts from the top-three cards.
  const censusStart = performance.now();
  const developedIds = new Set(observer.sample().layers.get('stories')!.filter(item => item.kind === 'point').map(item => item.id));
  const byPattern: Record<string, { developed: number; possible: number }> = {};
  let developed = 0, possible = 0;
  for (const entry of run.w.l3?.state.pool ?? []) {
    if (entry.graph?.retired) continue;
    const row = byPattern[entry.pattern] ??= { developed: 0, possible: 0 };
    if (developedIds.has(entry.id)) { row.developed++; developed++; }
    else { row.possible++; possible++; }
  }
  const censusMs = performance.now() - censusStart;
  publishingMs += censusMs;
  const elapsedMs = performance.now() - start, engineMs = elapsedMs - publishingMs;
  const counts = publisher.counts();
  for (const [layer, count] of Object.entries(counts)) count.bytes = statSync(join(directory, layer + '.jsonl')).size;
  const summary = { output: directory, run: c.id, identity: { source: options.identitySource ?? 'archive', archivedDigest, regeneratedDigest, excluded: ['diagnostics.seconds'] }, from, to,
    ...(real ? { indexHash: run.w.sim.w.index.hash } : {}), observations, elapsedMs, publishingMs, engineMs, overheadPercent: 100 * publishingMs / engineMs,
    publishingProfile: { setupMs, logCopyMs, observerMs, writerMs, verificationMs, finalizeMs, censusMs }, storyStats: { developed, possible, byPattern }, counts };
  writeFileSync(directory + '.summary.json', JSON.stringify(summary, null, 2));
  return { record, summary };
}

/** A new deterministic engine week. The first execution has no observer attached. */
export function publishImportedM3Week(output: string, index: ImportedWorldIndex, options: {
  config?: Week3Config;
  holotableHooks?: boolean;
  progress?: (run: Run, seconds: number) => void;
  deadline?: number;
} = {}) {
  if (!importedWorld(index)) throw Error('Expected an imported world index');
  if (existsSync(resolve(output)) || existsSync(resolve(output) + '.pending')) throw Error('Use a fresh output directory (and no .pending sibling)');
  const c = options.config ?? { id: 'E-m3c-w2-restless-engage-realstreets', world: 'm3c-w2', arm: 'E', tempo: 'restless', policy: 'engage', windows: 1008 };
  const deadline = options.deadline ?? Date.now() + 75 * 60000, start = performance.now();
  console.log('Observer-off identity run');
  const bare = runWeek3(c, { run: createWeek3(c, index), progress: options.progress, deadline });
  const bareMs = performance.now() - start;
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(resolve(output) + '.bare.run.json.gz', encodeRunRecord(bare));
  console.log('Observer-on publish run');
  const result = publishM3Week(output, bare, [], { ...options, deadline, run: createWeek3(c, index), identitySource: 'observer-off' });
  const summary = { ...result.summary, bareMs, totalMs: performance.now() - start };
  writeFileSync(resolve(output) + '.summary.json', JSON.stringify(summary, null, 2));
  return { record: result.record, summary };
}

export function runM3WeekCli(args: string[]): void {
  const usage = 'bun tools/holotable/publish-m3-week.ts <fresh-out-dir> [--run <run id> | --index <imported index.json>] [--world-pack <file>] [--no-holotable-hooks]';
  if (!args[0] || args[0].startsWith('--')) throw Error(usage);
  let id = 'E-m3c-w2-restless-engage', worldPack = resolve(import.meta.dir, '../../../../../local/holotable/world-pack.json'), holotableHooks = true;
  let indexPath: string | undefined, runSpecified = false;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--no-holotable-hooks') { holotableHooks = false; continue; }
    const value = args[++i]; if (!value) throw Error(usage);
    if (args[i - 1] === '--run' && /^[a-zA-Z0-9-]+$/.test(value)) { id = value; runSpecified = true; }
    else if (args[i - 1] === '--world-pack') worldPack = resolve(value);
    else if (args[i - 1] === '--index') indexPath = resolve(value);
    else throw Error(usage);
  }
  if (indexPath && runSpecified) throw Error('--index starts a new engine week; it cannot match an archived --run');
  const progress = (r: Run, seconds: number) => console.log(`${id}: day ${r.windowNo / 144}, ${r.deliveries.length} deliveries, ${seconds} s`);
  if (indexPath) {
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as ImportedWorldIndex;
    const { summary } = publishImportedM3Week(args[0], index, { holotableHooks, progress });
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  const expected = readRunRecord<Week3Record>(resolve(import.meta.dir, '../../../m3/run3/runs', id + '.json'));
  if (expected.id !== id) throw Error('Archived record id differs from requested id');
  const pack = JSON.parse(readFileSync(worldPack, 'utf8'));
  if (pack.schema !== 'xfh/world-pack-1' || !Array.isArray(pack.areas)) throw Error('Not an xfh/world-pack-1 pack');
  const { summary } = publishM3Week(args[0], expected, pack.areas, { holotableHooks, progress });
  console.log(JSON.stringify(summary, null, 2));
}
if (import.meta.main) runM3WeekCli(process.argv.slice(2));
