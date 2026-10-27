import { HolotableObserver } from '../../src/holotable/observe.ts';
import { layeredWeek } from '../../test/s3/layered-week.ts';
import { RunPublisher, publishBoundary } from './publish-run.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { schematicLayout, type Area } from '../../src/holotable/layout.ts';

export async function runWeekCli(args: string[]): Promise<void> {
  const usage = 'Usage: bun tools/holotable/publish-run.ts <fresh-output-directory> [--world-pack <file>] [--game-epoch-seconds <number>] [--no-holotable-hooks]';
  if (!args[0] || args[0].startsWith('--')) throw Error(usage);
  const holotableHooks = !args.includes('--no-holotable-hooks');
  args = args.filter((a) => a !== '--holotable-hooks' && a !== '--no-holotable-hooks');
  let worldPack = resolve(import.meta.dir, '../../../../../local/holotable/world-pack.json'), gameEpochSeconds: number | undefined;
  for (let i = 1; i < args.length; i += 2) {
    const value = args[i + 1]; if (value === undefined) throw Error(usage);
    if (args[i] === '--world-pack') worldPack = resolve(value);
    else if (args[i] === '--game-epoch-seconds' && Number.isFinite(Number(value))) gameEpochSeconds = Number(value);
    else throw Error(usage);
  }
  let areas: Area[];
  try {
    const pack = JSON.parse(readFileSync(worldPack, 'utf8'));
    if (pack.schema !== 'xfh/world-pack-1' || !Array.isArray(pack.areas)) throw Error('Not an xfh/world-pack-1 pack');
    areas = pack.areas;
  } catch (error) { throw Error(`Cannot read placement world pack; supply --world-pack <file>: ${(error as Error).message}`); }
  let observer: HolotableObserver | undefined, publisher: RunPublisher | undefined;
  const start = performance.now();
  let publishingMs = 0, observations = 0;
  layeredWeek('pay', false, {
    steps: 1002, horizon: 601200,
    sample(sim, l2, l3) {
      const before = performance.now();
      observer ??= new HolotableObserver(sim, l2, l3, { gameEpochSeconds, layout: schematicLayout(sim.w.index, areas) });
      publisher ??= new RunPublisher(args[0], { set: `m3-week-${sim.k.worldSeed}`, title: 'Kabuki week (reference model)', from: observer.epoch, to: 604800 + observer.epoch, schematic: true }, { holotableHooks });
      publishBoundary(observer, publisher);
      publishingMs += performance.now() - before; observations++;
    },
  });
  console.log(JSON.stringify({ output: publisher!.directory, observations, elapsedMs: performance.now() - start, publishingMs, counts: publisher!.counts() }, null, 2));
}
if (import.meta.main) await runWeekCli(process.argv.slice(2));
