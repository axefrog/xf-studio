// M3 run 2: the configuration of the run (tuned data, the wide registry, both tiers of hook material) and the packet's two new settings
// (`tier: 'offers'` takes only the hooks with an ask for the engine arms; `names: 'wide'` gives the A3 and A4 worlds the same registry).
// Nothing here claims which arm is better; that comes from raters.

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { dataProblems } from '../../src/procedural/data.ts';
import { type PacketManifest, buildPacketFiles, manifestOf } from '../../src/m3/packet.ts';
import { OFFER_PACK } from '../../src/m3/kits.ts';
import { run2Layer3, run2World } from '../../src/m3/run2.ts';
import { type RunRecord, recordHash } from '../../src/m3/transcript.ts';
import { buildWorld } from '../../src/m3/world.ts';

setDefaultTimeout(600_000);
const FULL = process.env.S1_FULL === '1';

describe('run 2 configuration', () => {
  test('layer 3 is tuned as data only: the weights S3 defines, valid, with the selection switched off for A1', () => {
    const d = run2Layer3();
    expect(dataProblems(d)).toEqual([]);
    expect(d.sower.featureWeights).toEqual({ F3: 2, F5: 2, F6: 1, F11: 1 });
    expect(d.sower.lambda).toBe(3);
    expect(d.sifter.candidateTtl).toBe(86_400);
    const a1 = run2World('x', 'A1', 'restless').opts.l3Data!;
    expect(a1.sower.lambda).toBe(0);
    expect(a1.sower.diversity).toBe(0);
    expect(a1.sower.kitDiversity).toBe(0);
    // everything else of A1 is the engine's: same gates, same weights of the features, same kits
    expect(a1.sower.featureWeights).toEqual(d.sower.featureWeights);
    expect(run2World('x', 'E', 'restless').opts.l3Data).toEqual(d);
  });

  test('the world installs both tiers and R2 with no finding, and the engine and A1 share the patterns and kits', () => {
    const { opts } = run2World('run2-install', 'E', 'steady');
    const w = buildWorld(opts);
    expect(w.findings).toEqual([]);
    const templates = [...w.l2.packs.values()].flatMap((p) => p.pack.seeds.map((s) => s.id));
    expect(templates.filter((t) => t.startsWith(OFFER_PACK)).length).toBe(6);
    expect(templates.filter((t) => t.startsWith('xf.m3.hooks')).length).toBe(7);
    const a1 = run2World('run2-install', 'A1', 'steady').opts;
    expect(a1.patterns).toEqual(opts.patterns);
    expect(a1.packs).toEqual(opts.packs);
  });
});

describe('the packet of run 2', () => {
  // Both tiers and all three raters remain in the default packet. More source
  // hooks also require more freshly simulated A3/A4 worlds; keep that at FULL.
  const hooks = FULL ? 6 : 2;
  const perArm = FULL ? 3 : 2;
  const delivery = (template: string, what: string, words: string, a: string, b: string) => ({
    id: `d-${words.length}-${a}`, template, layer: template.startsWith('xf.m3') && !template.endsWith('friday-fee') ? 'procedural' : 'authored', beat: what === 'offer' ? 'ask' : 'tell', what,
    game: 1000, play: 10, clock: 'Mon 02:00', words, channel: 'message', names: { subject: a, other: b },
  });
  const record = (name: string, tag: string): RunRecord => {
    const deliveries = Array.from({ length: hooks }, (_, i) => [
      delivery(`${OFFER_PACK}:goods-back`, 'offer', `Offer ${tag}${i}: Aa${tag}${i} Bb${tag}${i} asks you to find the bag.`, `Aa${tag}${i} Xx`, `Bb${tag}${i} Yy`),
      delivery('xf.m3.hooks:theft', 'tell', `Texture ${tag}${i}: a bag was lifted.`, `Cc${tag}${i} Xx`, `Dd${tag}${i} Yy`),
    ]).flat();
    const body: Omit<RunRecord, 'hash'> = { version: 1, name, state: 'S-early-quiet', windows: 864, play: 86400, layer3: true, tempo: 'restless', policy: 'decline', deliveries, instances: [], decisions: [] };
    const r = { ...body, hash: '' } as RunRecord;
    r.hash = recordHash(r);
    return r;
  };
  const files = [{ file: 'A1-t.json', record: record('A1-t', 'a') }, { file: 'E-t.json', record: record('E-t', 'e') }];
  const manifest: PacketManifest = manifestOf(files, { seed: 'm3b-test', n: perArm, raters: 3, a3Rule: 'declared', names: 'wide', tier: 'offers', a4States: ['S-early-quiet', 'S-mid-squeezed'] });

  test('the engine and A1 cards are the hooks with an ask and nothing else; the texture tier is left out', () => {
    const built = buildPacketFiles(manifest, files);
    expect(built.available.E).toBe(hooks);
    expect(built.available.A1).toBe(hooks);
    const packet = JSON.parse(built.files['packet.json']!) as { cards: Array<{ id: string; text: string }> };
    const key = JSON.parse(built.files['key.json']!) as { key: Record<string, { arm: string }> };
    const engine = packet.cards.filter((c) => key.key[c.id]!.arm === 'E' || key.key[c.id]!.arm === 'A1');
    expect(engine.length).toBe(2 * perArm);
    for (const c of engine) { expect(c.text).toMatch(/^Offer /); expect(c.text).not.toMatch(/Texture/); }
    // three raters, each with an order of their own, the second the first reversed
    const orders = (JSON.parse(built.files['packet.json']!) as { orders: string[][] }).orders;
    expect(orders.length).toBe(3);
    expect(orders[1]).toEqual(orders[0]!.slice().reverse());
    expect(orders[2]).not.toEqual(orders[0]);
  }, 600_000);

  test('without `tier`, run 1\'s rule holds: texture and offers alike are hooks', () => {
    const legacy: PacketManifest = { ...manifest };
    delete legacy.tier;
    delete legacy.names;
    const built = buildPacketFiles(legacy, files);
    expect(built.available.E).toBe(2 * hooks);
  }, 600_000);

  test('a manifest whose record has changed is refused', () => {
    const tampered = files.map((x) => ({ ...x, record: { ...x.record, play: 1 } }));
    expect(() => buildPacketFiles(manifest, tampered)).toThrow(/hash/);
  });
});
