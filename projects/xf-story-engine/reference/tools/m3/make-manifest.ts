// Write the manifest of a blind packet: the hook runs by file name and record hash, in sorted order, and the packet's settings.
// Usage: bun tools/m3/make-manifest.ts <rundir> <out.json> <n> <raters> <declared|rated-v1> <run file>...
// The run files are named explicitly; the directory is never listed, so what goes into a packet is a decision on the page.

import { readFileSync, writeFileSync } from 'node:fs';
import { manifestOf } from '../../src/m3/packet.ts';
import type { RunRecord } from '../../src/m3/transcript.ts';

const [dir, out, nArg, ratersArg, rule, ...files] = process.argv.slice(2);
if (!dir || !out || !nArg || !ratersArg || !rule || files.length === 0) throw new Error('usage: make-manifest <rundir> <out.json> <n> <raters> <declared|rated-v1> <run file>...');
if (rule !== 'declared' && rule !== 'rated-v1') throw new Error(`unknown slot rule ${rule}`);
const records = files.map((file) => ({ file, record: JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) as RunRecord }));
const manifest = manifestOf(records, { seed: 'm3-blind-1', n: Number(nArg), raters: Number(ratersArg), a3Rule: rule, a4States: ['S-early-quiet', 'S-mid-squeezed', 'S-mid-crackdown', 'S-late-wary'] });
writeFileSync(out, JSON.stringify(manifest, null, 1) + '\n');
console.log(`wrote ${out}: ${manifest.runs.length} runs`);
