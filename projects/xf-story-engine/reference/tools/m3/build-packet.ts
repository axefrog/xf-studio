// Build the blind packet from a manifest of hook runs and settings (src/m3/packet.ts).
// Usage: bun tools/m3/build-packet.ts <manifest.json> <rundir> <outdir>
//   <manifest.json> lists the runs (`E-*.json` and `A1-*.json`, written by run-hooks.ts) by file name and record hash, in sorted
//   order, with n, the raters, the A3 slot rule and the A4 states; `make-manifest.ts` writes one. Only the listed runs are read, so
//   a directory with other runs in it gives the same packet. A3 hooks are generated over fresh worlds, and A4 hooks are R2's offer
//   played over fresh worlds and story states. The cards carry text only; `key.json` says which card is which arm and is never
//   given to a rater.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { type PacketManifest, buildPacketFiles } from '../../src/m3/packet.ts';
import type { RunRecord } from '../../src/m3/transcript.ts';

const [manifestFile, dir, out] = process.argv.slice(2);
if (!manifestFile || !dir || !out) throw new Error('usage: build-packet <manifest.json> <rundir> <outdir>');
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as PacketManifest;
const records = manifest.runs.map((x) => ({ file: x.file, record: JSON.parse(readFileSync(`${dir}/${x.file}`, 'utf8')) as RunRecord }));
const built = buildPacketFiles(manifest, records);
mkdirSync(out, { recursive: true });
for (const [name, text] of Object.entries(built.files)) writeFileSync(`${out}/${name}`, text);
console.log(JSON.stringify({ n: built.n, available: built.available, files: Object.keys(built.files).length }));
