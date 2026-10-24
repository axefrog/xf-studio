import { expect, test } from 'bun:test';
import { defaultData } from '../../src/procedural/data.ts';
import { fitTerms } from '../../src/procedural/fit.ts';
import { instanceView } from '../../src/procedural/views.ts';
import type { FitRequest } from '../../src/procedural/types.ts';
import type { CompiledSeed, Seed } from '../../src/seeding/types.ts';
import { world, kit, pack } from './helpers.ts';
import { sowableFindings } from '../../src/procedural/lint.ts';

test('SF3-31 exact world fit terms and S2 clamp', () => {
  const w = world('SF3-31'),
    seed = kit({ intent: { prohibitions: [], tone: [], aesthetic: { style: 1 } } });
  const base = {
    id: 'current',
    template: { id: seed.id, version: 1 },
    level: seed.level,
    source: { by: 'pack' as const, layer: 'authored' },
    sowSeq: 5,
    state: 'sown',
    roles: {},
    beats: [],
    displays: [],
    responses: [],
    draws: {},
    closingPending: false,
  };
  const req: FitRequest = {
    seed: { ...base, document: seed as CompiledSeed },
    choice: { key: 'cast:subject', kind: 'cast', role: 'subject' },
    options: ['held', 'repeat', 'aesthetic', 'plain'].map((id) => ({ id, node: id })),
    kernel: { ...w.l3.kv, aesthetic: (n) => (n === 'aesthetic' ? 1 : undefined) },
    layer2: {
      ...w.l3.lv,
      instances: () => [
        { ...base, id: 'previous', sowSeq: 4, roles: { subject: { cast: 'repeat', anchor: false, committed: true } } },
        { ...base, id: 'older', sowSeq: 2, roles: { subject: { cast: 'plain', anchor: false, committed: true } } },
      ],
      claimConflict: (n) => n === 'held',
    },
    at: 0,
    fitCap: w.l2.tun.fitCap,
  };
  const terms = fitTerms(req, defaultData());
  expect(terms.map((t) => t.raw)).toEqual([-0.3, -0.2, 0.3, 0]);
  const input = {
    ...req,
    layer2: { ...req.layer2, claimConflict: () => true },
    kernel: { ...req.kernel, aesthetic: () => -1 },
  };
  expect(fitTerms(input, defaultData()).every((t) => t.clamped >= -w.l2.tun.fitCap)).toBe(true);
  const result = w.l2.draw('a'.repeat(32), 'test', [{ id: 'x' }, { id: 'y' }], 0, () => -5);
  expect(result.raw).toBe(-5);
  expect(result.clamped).toBe(-w.l2.tun.fitCap);
});
test('SF3-32 fit report terms are independent of tempo and noticing and leave state unchanged', () => {
  const w = world('SF3-32'),
    fits: unknown[] = [];
  for (const tempo of ['off', 'calm', 'steady', 'restless'] as const)
    for (const noticing of ['off', 'acts', 'full'] as const) {
      w.k.settings.set({ tempo, noticing });
      const before = structuredClone(w.l2.global);
      const report = w.l2.fit('xf.fixture', 'xf.fixture:rumour-kit');
      expect(report.verdict).toBe('fits');
      expect(report.connectingMaterial).toEqual([]);
      expect(w.l2.global).toEqual(before);
      fits.push(report.fit);
    }
  expect(fits.every((f) => JSON.stringify(f) === JSON.stringify(fits[0]))).toBe(true);
  expect((fits[0] as { policy: string }).policy).toBe('world');
});
test('mode, variant, alternate and cast all use the complete world fit seam', () => {
  const w = world('all-fit', { patterns: [] });
  const seed = kit({
    variation: {
      modes: [
        { id: 'm1', weight: 1 },
        { id: 'm2', weight: 1 },
      ],
      variants: [
        { id: 'v1', weight: 1, parts: {} },
        { id: 'v2', weight: 1, parts: {} },
      ],
    },
    beats: { tell: { play: { alternates: ['pack:rumour', 'pack:second'] } } },
  });
  const p = pack([seed]);
  p.fragments.push({ ...p.fragments[0], id: 'second' });
  expect(w.l2.installPack(p)).toEqual([]);
  const seen: string[] = [];
  const weigh = w.l2.hooks.weigh!;
  w.l2.hooks.weigh = (req) => {
    seen.push(req.choice);
    return weigh(req);
  };
  const report = w.l2.fit(p.id, seed.id);
  expect(Object.keys(report.fit!.terms)).toEqual(
    expect.arrayContaining(['mode', 'variant', 'cast:subject', 'cast:other', 'alt:tell:0']),
  );
  expect(w.l2.sow(p.id, seed.id).ok).toBe(true);
  w.k.settle();
  expect(seen).toEqual(expect.arrayContaining(['mode', 'variant', 'cast:subject', 'cast:other', 'alt:tell:0']));
  const inst = w.l2.all()[0];
  expect(Object.values(inst.st.draws).every((d) => d.raw !== undefined && d.clamped !== undefined)).toBe(true);
});
test('view snapshots cannot mutate a live record or share nested roles', () => {
  const w = world('copy-views');
  w.l2.sow('xf.fixture', 'xf.fixture:rumour-kit');
  w.k.settle();
  const first = w.l3.lv.instances();
  first[0].roles.subject.cast = 'wrong';
  first[0].draws.wrong = { value: 'wrong', attempt: 0 };
  expect(instanceView(w.l2.all()[0]).roles.subject.cast).not.toBe('wrong');
  expect(w.l2.all()[0].st.draws.wrong).toBeUndefined();
});
test('fit report lists later requested material without fabricating connections', () => {
  const w = world('fit-later', { patterns: [], seeds: [kit({ latitude: { bridge: true, 'why-now': true } })] });
  const report = w.l2.fit('xf.fixture', 'xf.fixture:rumour-kit');
  expect(report.fit?.notFitted).toEqual([
    { part: 'bridge', reason: 'later-capability' },
    { part: 'why-now', reason: 'later-capability' },
  ]);
  expect(report.connectingMaterial).toEqual([]);
});
test('a variant cannot bypass the level or first-class certification of its kit', () => {
  const w = world('variant-certification', { patterns: [] });
  const t = kit({ variation: { variants: [{ id: 'unbounded', weight: 1, parts: { level: 'arc' } }] } });
  expect(sowableFindings(t, w.l2, w.l3.kv, w.l3.data, 'xf.fixture').some((f) => f.code === 'S3-K-2')).toBe(true);
});
