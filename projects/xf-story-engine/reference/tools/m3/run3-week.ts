import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { runWeek3, type Week3Config } from '../../src/m3/week3.ts';
import type { Tempo } from '../../src/procedural/types.ts';

const [name, arm, tempo, policy, out, windowArg = '1008'] = process.argv.slice(2) as [string, 'E' | 'A1', Tempo, string, string, string];
if (!name || !arm || !tempo || !policy || !out) throw Error('run3-week <world> <E|A1> <tempo> <policy> <out> [windows]');
const id = `${arm}-${name}-${tempo}-${policy}`, dir = resolve(out);
mkdirSync(dir, { recursive: true });
const c: Week3Config = { id, world: name, arm, tempo, policy, windows: Number(windowArg) };
writeFileSync(resolve(dir, id + '.pid'), String(process.pid));
try {
  const body = runWeek3(c, { progress: (r, seconds) => console.log(`${id}: day ${r.windowNo / 144}, ${r.deliveries.length} deliveries, ${seconds} s`) });
  writeFileSync(resolve(dir, id + '.json'), JSON.stringify(body, null, 1));
  console.log(`${id}: DONE ${body.threads.length} threads, ${body.diagnostics.seconds} s`);
} finally { unlinkSync(resolve(dir, id + '.pid')); }
