// One M3 run 2 hook run: Kabuki at the same density with V walking the district, R2, the run 1 texture tier and the offer kits in, the wide
// name registry, layer 3 at a tempo with run 2's tunables (src/m3/run2.ts).
// Usage: bun tools/m3/run2-hooks.ts <file> <world> <state> <tempo> <arm: E|A1> <days> <outdir>
// It writes `<outdir>/<file>.txt` (the whole transcript), `<file>.compact.txt` (deliveries and the decision log) and `<file>.json` (the
// machine-readable record). A run with the same arguments writes the same files. Name the file `E-...` or `A1-...` (the packet reads the prefix).

import { mkdirSync, writeFileSync } from 'node:fs';
import type { Tempo } from '../../src/procedural/types.ts';
import { policies, Run } from '../../src/m3/driver.ts';
import { type Run2Arm, run2World } from '../../src/m3/run2.ts';
import { stateById } from '../../src/m3/states.ts';
import { recordOf, transcript } from '../../src/m3/transcript.ts';

const [file, name, stateId, tempo, arm, days, out] = process.argv.slice(2) as [string, string, string, Tempo, Run2Arm, string, string];
if (!file || !name || !stateId || !tempo || !arm || !days || !out) throw new Error('usage: run2-hooks <file> <world> <state> <tempo> <E|A1> <days> <outdir>');
const { opts, notes } = run2World(name, arm, tempo);
const run = new Run(opts, stateById(stateId), policies.decline!, { walk: true, notes });
const t0 = performance.now();
run.runWindows(Number(days) * 144);
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/${file}.txt`, transcript(run));
writeFileSync(`${out}/${file}.compact.txt`, transcript(run, { week: false }));
writeFileSync(`${out}/${file}.json`, JSON.stringify(recordOf(run), null, 1));
const offers = run.deliveries.filter((d) => d.what === 'offer' && d.layer !== 'authored').length;
console.log(`${file}: ${run.deliveries.length} deliveries, ${run.deliveries.filter((d) => d.layer !== 'authored').length} sown (${offers} with an ask), ${Math.round((performance.now() - t0) / 1000)} s`);
