// One M3 hook run: Kabuki at a given density with V walking the district, R2 and the engine's hook pack in, layer 3 at a tempo.
// Usage: bun tools/m3/run-hooks.ts <file> <world> <state> <tempo> <arm: E|A1> <days> <outdir>
// `world` names the world seed: two runs with the same world and state see the same district and the same incidents.
// It writes `<outdir>/<name>.txt` (the whole transcript), `<name>.compact.txt` (deliveries and the decision log) and `<name>.json`
// (the machine-readable record). A run with the same arguments writes the same files.

import { mkdirSync, writeFileSync } from 'node:fs';
import { defaultData as l3Default } from '../../src/procedural/data.ts';
import type { Tempo } from '../../src/procedural/types.ts';
import { density, policies, Run } from '../../src/m3/driver.ts';
import { randomWithinGates } from '../../src/m3/arms.ts';
import { hookPack, hookPatterns } from '../../src/m3/hooks.ts';
import { r2Pack } from '../../src/m3/r2.ts';
import { stateById } from '../../src/m3/states.ts';
import { recordOf, transcript } from '../../src/m3/transcript.ts';

const [file, name, stateId, tempo, arm, days, out] = process.argv.slice(2) as [string, string, string, Tempo, 'E' | 'A1', string, string];
if (!file || !name || !stateId || !tempo || !arm || !days || !out) throw new Error('usage: run-hooks <file> <world> <state> <tempo> <E|A1> <days> <outdir>');
const dens = density(8);
const run = new Run(
  { name, layer3: true, tempo, packs: [r2Pack(), hookPack()], patterns: hookPatterns(), s1: dens.apply, ...(arm === 'A1' ? { l3Data: randomWithinGates(l3Default()) } : {}) },
  stateById(stateId), policies.decline!, { walk: true, notes: [dens.name, arm === 'A1' ? 'arm A1: layer 3 chooses at random among what passes its gates' : 'arm E: layer 3 ranks and chooses'] },
);
const t0 = performance.now();
run.runWindows(Number(days) * 144);
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/${file}.txt`, transcript(run));
writeFileSync(`${out}/${file}.compact.txt`, transcript(run, { week: false }));
writeFileSync(`${out}/${file}.json`, JSON.stringify(recordOf(run), null, 1));
console.log(`${file}: ${run.deliveries.length} deliveries, ${run.deliveries.filter((d) => d.layer !== 'authored').length} sown, ${Math.round((performance.now() - t0) / 1000)} s`);
