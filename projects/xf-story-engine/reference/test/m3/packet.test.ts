// The rated blind packet is pinned by a manifest (m3/blind/inputs.json): rebuilding from it gives the committed packet byte for
// byte, whatever order the runs are supplied in and whatever other runs sit beside them.

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { type PacketManifest, buildPacketFiles, manifestOf } from '../../src/m3/packet.ts';
import { type RunRecord, recordHash } from '../../src/m3/transcript.ts';

setDefaultTimeout(300_000);

const m3 = new URL('../../../m3/', import.meta.url);
const read = (rel: string): string => readFileSync(new URL(rel, m3), 'utf8');
const manifest = JSON.parse(read('blind/inputs.json')) as PacketManifest;
const load = (file: string): { file: string; record: RunRecord } => ({ file, record: JSON.parse(read(`runs/${file}`)) as RunRecord });

describe('the rated packet is reproducible from its manifest', () => {
  test('the manifest is canonical: runs sorted by file name, the rated runs only (the restless ones)', () => {
    const files = manifest.runs.map((x) => x.file);
    expect(files).toEqual([...files].sort());
    expect(files).toEqual(['A1-restless-early.json', 'A1-restless-mid.json', 'E-restless-early.json', 'E-restless-mid.json']);
    expect(manifest.a3Rule).toBe('rated-v1');
    // the manifest is what make-manifest writes for those runs, in any order they are named
    expect(manifestOf([...files].reverse().map(load), { seed: manifest.seed, n: manifest.n, raters: manifest.raters, a3Rule: manifest.a3Rule, a4States: manifest.a4States })).toEqual(manifest);
  });

  test('every stored record still has the hash the manifest names', () => {
    for (const x of manifest.runs) {
      const { record } = load(x.file);
      expect(record.hash).toBe(x.hash);
      expect(recordHash(record)).toBe(x.hash);
    }
  });

  test('a run that does not match the manifest is refused before anything is built', () => {
    const runs = manifest.runs.map((x) => load(x.file));
    const changed = runs.map((x, i) => (i === 0 ? { file: x.file, record: { ...x.record, windows: x.record.windows + 1 } } : x));
    expect(() => buildPacketFiles(manifest, changed)).toThrow(/hash/);
    expect(() => buildPacketFiles(manifest, runs.slice(1))).toThrow(/not supplied/);
    expect(() => buildPacketFiles({ ...manifest, runs: [...manifest.runs].reverse() }, runs)).toThrow(/sorted/);
  });

  test('rebuilding gives the committed files byte for byte, with the runs supplied in reverse and the unrated runs beside them', () => {
    const present = readdirSync(new URL('runs/', m3)).filter((f) => f.endsWith('.json'));
    expect(present.length).toBeGreaterThan(manifest.runs.length); // the unrated calm and steady runs are in the folder
    const supplied = present.map(load).reverse();
    const built = buildPacketFiles(manifest, supplied);
    expect(built.available).toEqual({ E: 36, A1: 36, A3: 44, A4: 44 });
    for (const [name, text] of Object.entries(built.files)) expect(text, name).toBe(read(`blind/${name}`).replace(/\r\n/g, '\n'));
    expect(JSON.parse(built.files['packet.json']!).cards).toHaveLength(96);
    expect(Object.keys(built.files).sort()).toEqual(['instructions.md', 'key.json', 'packet.json', 'rater-1.md', 'rater-2.md', 'rater-3.md', 'rater-4.md', 'scoring-sheet.md']);
  });
});
