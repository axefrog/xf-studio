// Write the manifest of run 2's blind packet: the hook runs by file name and record hash, in sorted order, and the packet's settings (the wide
// name registry for every arm, the hooks with an ask for the engine arms, A3 under the declared slot rule).
// Usage: bun tools/m3/make-manifest2.ts <rundir> <out.json> <n> <raters> <run file>...
// The run files are named explicitly; the directory is never listed, so what goes into a packet is a decision on the page.
// Build the packet from it with `build-packet.ts` (the manifest carries `names` and `tier`, which the builder reads).

import { readFileSync, writeFileSync } from 'node:fs';
import { manifestOf } from '../../src/m3/packet.ts';
import type { RunRecord } from '../../src/m3/transcript.ts';

const [dir, out, nArg, ratersArg, ...files] = process.argv.slice(2);
if (!dir || !out || !nArg || !ratersArg || files.length === 0) throw new Error('usage: make-manifest2 <rundir> <out.json> <n> <raters> <run file>...');
const records = files.map((file) => ({ file, record: JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) as RunRecord }));
const manifest = manifestOf(records, {
  seed: 'm3b-blind-1', n: Number(nArg), raters: Number(ratersArg), a3Rule: 'declared', names: 'wide', tier: 'offers',
  a4States: ['S-early-quiet', 'S-mid-squeezed', 'S-mid-crackdown', 'S-late-wary'],
});
writeFileSync(out, JSON.stringify(manifest, null, 1) + '\n');
console.log(`wrote ${out}: ${manifest.runs.length} runs`);
