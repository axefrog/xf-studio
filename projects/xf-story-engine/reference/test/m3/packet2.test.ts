// Run 2's blind packet is pinned by its manifest (m3/run2/blind/inputs.json) the way run 1's is: rebuilding from the manifest gives the committed
// files byte for byte, whatever order the runs are supplied in. The packet holds the offers of the engine arms, and every arm's worlds carry the
// wide name registry.

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { type PacketManifest, buildPacketFiles, manifestOf } from '../../src/m3/packet.ts';
import { OFFER_PACK } from '../../src/m3/kits.ts';
import { type RunRecord, recordHash } from '../../src/m3/transcript.ts';

setDefaultTimeout(600_000);

const run2 = new URL('../../../m3/run2/', import.meta.url);
const read = (rel: string): string => readFileSync(new URL(rel, run2), 'utf8');
const manifest = JSON.parse(read('blind/inputs.json')) as PacketManifest;
const load = (file: string): { file: string; record: RunRecord } => ({ file, record: JSON.parse(read(`runs/${file}`)) as RunRecord });

describe('run 2\'s packet is reproducible from its manifest', () => {
  test('the manifest is canonical, names the offers tier and the wide registry, and is what make-manifest2 writes', () => {
    const files = manifest.runs.map((x) => x.file);
    expect(files).toEqual([...files].sort());
    expect(manifest.tier).toBe('offers');
    expect(manifest.names).toBe('wide');
    expect(manifest.a3Rule).toBe('declared');
    expect(manifestOf([...files].reverse().map(load), { seed: manifest.seed, n: manifest.n, raters: manifest.raters, a3Rule: manifest.a3Rule, names: 'wide', tier: 'offers', a4States: manifest.a4States })).toEqual(manifest);
  });

  test('every stored record still has the hash the manifest names, and was made by run 2\'s settings (offers in the pack, the wide registry)', () => {
    for (const x of manifest.runs) {
      const { record } = load(x.file);
      expect(record.hash).toBe(x.hash);
      expect(recordHash(record)).toBe(x.hash);
      expect(record.deliveries.some((d) => d.template.startsWith(OFFER_PACK))).toBe(true);
    }
  });

  test('rebuilding gives the committed files byte for byte, with the runs supplied in reverse', () => {
    const present = readdirSync(new URL('runs/', run2)).filter((f) => f.endsWith('.json'));
    const built = buildPacketFiles(manifest, present.map(load).reverse());
    for (const [name, text] of Object.entries(built.files)) expect(text, name).toBe(read(`blind/${name}`).replace(/\r\n/g, '\n'));
    expect(JSON.parse(built.files['packet.json']!).cards).toHaveLength(manifest.n * 4);
    // the engine and A1 cards are offers: each says who asks and what, in a message from a person
    const key = JSON.parse(built.files['key.json']!) as { key: Record<string, { arm: string; meta: { template?: string } }> };
    for (const v of Object.values(key.key)) if (v.arm === 'E' || v.arm === 'A1') expect(v.meta.template).toMatch(/^xf\.m3b\.offers:/);
  });
});
