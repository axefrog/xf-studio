// Run 2's blind packet is pinned by its manifest (m3/run2/blind/inputs.json) the way run 1's is: rebuilding from the manifest gives the committed
// files byte for byte, whatever order the runs are supplied in. The packet holds the offers of the engine arms, and every arm's worlds carry the
// wide name registry.

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { type PacketManifest, buildPacketFiles, manifestOf } from '../../src/m3/packet.ts';
import { OFFER_PACK } from '../../src/m3/kits.ts';
import { type RunRecord, recordHash } from '../../src/m3/transcript.ts';

setDefaultTimeout(600_000);
// The byte-for-byte rebuild generates the A3 and A4 hooks over fresh worlds (about forty seconds); it is `S1_FULL=1`. The default checks, cheaply, that the
// committed packet was made from the committed runs (every engine and A1 card is a delivery of a manifest run), that each rater's pairs have balanced
// sides, and that the manifest and records agree.
const FULL = process.env.S1_FULL === '1';

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
    expect(manifestOf([...files].reverse().map(load), { seed: manifest.seed, n: manifest.n, raters: manifest.raters, a3Rule: manifest.a3Rule, names: 'wide', tier: 'offers', sides: 'balanced', a4States: manifest.a4States })).toEqual(manifest);
  });

  test('every stored record still has the hash the manifest names, and was made by run 2\'s settings (offers in the pack, the wide registry)', () => {
    for (const x of manifest.runs) {
      const { record } = load(x.file);
      expect(record.hash).toBe(x.hash);
      expect(recordHash(record)).toBe(x.hash);
      expect(record.deliveries.some((d) => d.template.startsWith(OFFER_PACK))).toBe(true);
    }
  });

  test('the committed packet was made from the committed runs: every engine and A1 card is the words of an offer of a manifest run', () => {
    const packet = JSON.parse(read('blind/packet.json')) as { cards: Array<{ id: string; text: string }> };
    const key = JSON.parse(read('blind/key.json')) as { key: Record<string, { arm: string }> };
    const words = (prefix: string): Set<string> => new Set(manifest.runs.filter((x) => x.file.startsWith(prefix)).flatMap((x) => load(x.file).record.deliveries.filter((d) => d.what === 'offer' && d.template.startsWith(OFFER_PACK)).map((d) => d.words)));
    const e = words('E-'), a1 = words('A1-');
    expect(packet.cards).toHaveLength(manifest.n * 4);
    for (const c of packet.cards) {
      const arm = key.key[c.id]!.arm;
      if (arm === 'E') expect(e.has(c.text), c.id).toBe(true);
      if (arm === 'A1') expect(a1.has(c.text), c.id).toBe(true);
    }
  });

  test('the committed packet has balanced sides: equal left and right in each comparison for every rater, and the first and third rater see every pair mirrored', () => {
    expect(manifest.sides).toBe('balanced');
    const key = JSON.parse(read('blind/key.json')) as { pairKeys: Array<Record<string, { leftArm: string; rightArm: string }>> };
    const packet = JSON.parse(read('blind/packet.json')) as { pairsByRater: Array<Array<{ id: string; left: string; right: string }>> };
    expect(key.pairKeys).toHaveLength(manifest.raters);
    for (const pk of key.pairKeys) {
      const by = new Map<string, number>();
      for (const k of Object.values(pk)) { const sig = [k.leftArm, k.rightArm].sort().join('|'); by.set(sig, (by.get(sig) ?? 0) + (k.leftArm === sig.split('|')[0] ? 1 : 0)); }
      expect(by.size).toBe(4);
      for (const onLeft of by.values()) expect(onLeft).toBe(manifest.n / 2);
    }
    for (const id of Object.keys(key.pairKeys[0]!)) {
      expect(key.pairKeys[2]![id]).toEqual({ leftArm: key.pairKeys[0]![id]!.rightArm, rightArm: key.pairKeys[0]![id]!.leftArm });
    }
    // the sheets a rater is given print that rater's own sides
    const sheets = manifest.raters;
    for (let r = 0; r < sheets; r++) {
      const sheet = read(`blind/rater-${r + 1}.md`);
      const first = packet.pairsByRater[r]![0]!;
      expect(sheet).toContain(`### ${first.id}`);
    }
  });

  (FULL ? test : test.skip)('rebuilding gives the committed files byte for byte, with the runs supplied in reverse (S1_FULL=1)', () => {
    const present = readdirSync(new URL('runs/', run2)).filter((f) => f.endsWith('.json'));
    const built = buildPacketFiles(manifest, present.map(load).reverse());
    for (const [name, text] of Object.entries(built.files)) expect(text, name).toBe(read(`blind/${name}`).replace(/\r\n/g, '\n'));
    expect(JSON.parse(built.files['packet.json']!).cards).toHaveLength(manifest.n * 4);
    // the engine and A1 cards are offers: each says who asks and what, in a message from a person
    const key = JSON.parse(built.files['key.json']!) as { key: Record<string, { arm: string; meta: { template?: string } }> };
    for (const v of Object.values(key.key)) if (v.arm === 'E' || v.arm === 'A1') expect(v.meta.template).toMatch(/^xf\.m3b\.offers:/);
  });
});
