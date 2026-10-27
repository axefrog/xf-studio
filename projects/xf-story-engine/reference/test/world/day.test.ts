import { test, expect, setDefaultTimeout } from 'bun:test';
import { serialize } from 'node:v8';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pack from './fixtures/world-pack.json';
import content from './fixtures/content.json';
import { importW1 } from '../../src/world/import-w1.ts';
import type { ImportedWorldIndex, W1Content, W1Pack } from '../../src/world/types.ts';
import { Sim } from '../../src/sim/sim.ts';
import { H, s } from '../../src/id.ts';
import { HolotableObserver } from '../../src/holotable/observe.ts';
import { RunPublisher } from '../../tools/holotable/publish-run.ts';
import { validateManifest, validateRecord } from '../../src/holotable/schema.ts';
import { readable } from '../holotable/readability-oracle.ts';

setDefaultTimeout(300_000);
const scratch = resolve(import.meta.dir, '../../../../../.scratch-w1b');

/** Full mutable engine image, independent of save writer/digest abstractions. */
function image(sim: Sim): Buffer {
  const k = sim.k;
  return serialize({ store: k.store.capture(), references: k.store.referencesVersion, revision: k.revision,
    epoch: k.epoch, now: k.now, pending: k.pending, frames: k.frames.capture(), beliefs: k.beliefs.capture(),
    processes: k.evolution.states, queued: k.evolution.queued, record: sim.record, seeds: k.retention.seeds });
}
function runDay(index: ImportedWorldIndex, dir: string) {
  const sim = Sim.create({ worldSeed: H(s('fixture'),s('w1-import-day')), index });
  const observer = new HolotableObserver(sim);
  const publisher = new RunPublisher(dir, {set:'w1-import-day', title:'Imported Kabuki day', from:0, to:86400});
  let samples = 0;
  const start = performance.now();
  for (let w = 0; w <= 144; w++) {
    if (w) sim.advance(1);
    const before = image(sim), observation = observer.sample();
    expect(image(sim).equals(before)).toBe(true);
    publisher.publish(observation); samples++;
  }
  let records = 0;
  for (const file of readdirSync(dir)) {
    const [manifest, ...items] = readFileSync(join(dir,file),'utf8').trim().split('\n').map((s)=>JSON.parse(s));
    validateManifest(manifest);
    for (const item of items) { validateRecord(item,manifest); if ('id' in item) { readable(item); records++; } }
  }
  const result = { now:sim.k.now, samples, records, elapsedMs:performance.now()-start, counts:publisher.counts() };
  expect(sim.k.now).toBe(86400);
  return result;
}
test('synthetic imported world runs one S1 day; observation preserves every mutable record and its spool is readable', () => {
  const dir = join(scratch,'synthetic-day');
  mkdirSync(scratch,{recursive:true});
  try {
    const { index } = importW1(pack as W1Pack, content as unknown as W1Content);
    runDay(index,dir);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test.skipIf(!process.env.W1_REAL_INDEX)('private imported Kabuki day, read-only observer and independent consumer validator', () => {
  const index = JSON.parse(readFileSync(process.env.W1_REAL_INDEX!,'utf8')) as ImportedWorldIndex;
  const dir = join(scratch,`real-day-${randomUUID()}`);
  const result = runDay(index,dir);
  const root = process.env.HOLO_VALIDATOR_ROOT;
  expect(root).toBeDefined();
  const child = Bun.spawnSync(['bun','projects/xf-holotable/tools/holo.ts','validate',dir], {cwd:root,stdout:'pipe',stderr:'pipe',timeout:30000});
  expect(child.exitCode, Buffer.from(child.stderr).toString() || Buffer.from(child.stdout).toString()).toBe(0);
  expect(Buffer.from(child.stdout).toString()).toContain('no refusals');
  writeFileSync(join(scratch,'real-day-summary.json'),JSON.stringify({...result,spool:dir,validator:Buffer.from(child.stdout).toString()},null,2)+'\n');
  console.log(JSON.stringify(result));
});
