import { expect, test } from "bun:test";
import { hairCoverage, hairResolvedCoverage, hairStrandRandom, srgbToLinear } from "../src/hair-colour-model";
import { defaultHairAtlas, generateHairAtlas, hairAtlasSteps, sampleAtlasFibres, rasterAtlasFibres,
  encodeHairFlow, decodeHairFlow, measureAtlasRegion, measureFilteredCoverage, type HairAtlasDescription } from "../src/features/hair-lab/textures";

function fixture(overrides: Partial<HairAtlasDescription> = {}): HairAtlasDescription {
  const base = defaultHairAtlas(256);
  return { ...base, regions: [{ ...base.regions[0]!, key: "test", rect: { x: 0, y: 0, width: 256, height: 256 },
    padding: 8, count: 32, width: .014, length: [.55, 1], rootJitter: .12 }], ...overrides };
}

test("atlas: identical descriptions produce identical four-map bytes and region metadata", () => {
  const description = fixture(), a = generateHairAtlas(description), b = generateHairAtlas(description);
  expect(a).toEqual(b);
  expect(a.levels[0]!.alpha.length).toBe(256 * 256);
  expect(a.levels[0]!.flow.length).toBe(256 * 256 * 3);
  expect(a.encoding).toEqual({ alpha: "linear-r8", id: "linear-r8", gradient: "linear-r8", flow: "srgb-rgb8" });
  expect(a.regions[0]!.uv).toEqual({ u0: 8 / 256, v0: 8 / 256, u1: 248 / 256, v1: 248 / 256 });
  expect(a.levels[0]!.alpha).not.toEqual(generateHairAtlas(fixture({ seed: 42 })).levels[0]!.alpha);
});

test("atlas: region order does not alter seeded fibres, pixels or stable region identity", () => {
  const a = defaultHairAtlas(256), b = { ...a, regions: [...a.regions].reverse() };
  expect(generateHairAtlas(a)).toEqual(generateHairAtlas(b));
  const sample = sampleAtlasFibres(a);
  expect(new Set(sample.map(f => f.key)).size).toBe(sample.length);
});

test("atlas: gradient follows intrinsic distance on shortened, curved fibres and tapers at both ends", () => {
  const description = fixture(), region = description.regions[0]!;
  const fibres = sampleAtlasFibres(description);
  expect(fibres.every(f => f.points[0]!.s === 0 && f.points.at(-1)!.s === 1)).toBe(true);
  expect(fibres.every(f => f.points[0]!.width === 0 && f.points.at(-1)!.width === 0)).toBe(true);
  for (const f of fibres) {
    let total = 0; const distances = [0];
    for (let i = 1; i < f.points.length; i++) {
      const a = f.points[i - 1]!, b = f.points[i]!; total += Math.hypot(b.x - a.x, b.y - a.y); distances.push(total);
    }
    f.points.forEach((point, i) => expect(point.s).toBeCloseTo(distances[i]! / total, 12));
  }
  const fibre = { key: "curved", region: region.key, id: .73, points: [
    { x: 32, y: 32, s: 0, width: 0 }, { x: 120, y: 60, s: .6, width: 8 },
    { x: 120, y: 124, s: 1, width: 0 }] };
  const atlas = rasterAtlasFibres(description, [fibre]), level = atlas.levels[0]!;
  expect(level.alpha[60 * 256 + 120]).toBeGreaterThan(0);
  expect(level.id[60 * 256 + 120]).toBeCloseTo(Math.round(.73 * 255), -1);
  expect(level.gradient[60 * 256 + 120]! / 255).toBeCloseTo(.6, 1);
  expect(level.gradient[60 * 256 + 120]! / 255).toBeGreaterThan(60 / 256 + .25);
  expect(level.alpha[124 * 256 + 120]).toBe(0);
});

test("atlas: crossing attributes come from one foreground fibre, with shared coverage", () => {
  const description = fixture();
  const fibre = (key: string, id: number, x: number, end: number) => ({ key, region: "test", id, points: [
    { x, y: 16, s: 0, width: 4 }, { x: end, y: 200, s: 1, width: 4 }] });
  const level = rasterAtlasFibres(description, [fibre("a", .2, 40, 200), fibre("b", .8, 200, 40)]).levels[0]!;
  const i = 108 * 256 + 120;
  expect(level.alpha[i]).toBe(255);
  expect(level.id[i]).toBe(204);
  expect(level.gradient[i]! / 255).toBeCloseTo(.5, 1);
});

test("atlas: Flow roundtrips the actual gamma decode, including clamped mixed-sign tangents", () => {
  for (const [x, y] of [[0, 1], [.3, 1], [1, .2], [-.05, -1]]) {
    const encoded = encodeHairFlow(x!, y!), decoded = decodeHairFlow(...encoded.rgb);
    const n = Math.hypot(x!, y!);
    expect(Math.abs(decoded[0] * x! / n + decoded[1] * y! / n)).toBeGreaterThan(.9998);
  }
  const unsupported = encodeHairFlow(-.3, 1);
  expect(unsupported.errorRadians).toBeGreaterThan(.25);
  expect(unsupported.rgb[1]).toBe(255);
  expect(unsupported.rgb[0]).toBeGreaterThan(180); // sRGB encoding of linear .5, not raw 128.
  for (let r = 0; r < 256; r += 7) for (let g = 0; g < 256; g += 11) {
    const x = Math.max(2 * srgbToLinear(r) - 1, .01), y = Math.max(2 * srgbToLinear(g) - 1, .01), n = Math.hypot(x, y);
    expect(decodeHairFlow(r, g, 0)).toEqual([x / n, y / n]);
  }
});

test("atlas: mirrored tangent basis covers a consistently negative slope; a UV reflection alone cannot", () => {
  const original = encodeHairFlow(-.3, 1), flipped = encodeHairFlow(-.3, 1, true);
  expect(flipped.errorRadians).toBeLessThan(.01);
  expect(original.errorRadians).toBeGreaterThan(.25);
  const decoded = decodeHairFlow(...original.rgb), intended = [-.3 / Math.hypot(.3, 1), 1 / Math.hypot(.3, 1)];
  const error = Math.acos(Math.abs(decoded[0] * intended[0]! + decoded[1] * intended[1]!));
  const reflectedError = Math.acos(Math.abs(-decoded[0] * -intended[0]! + decoded[1] * intended[1]!));
  expect(reflectedError).toBe(error);
  const d = fixture(), curve = [{ key: "negative", region: "test", id: .5, points: [
    { x: 180, y: 16, width: 3, s: 0 }, { x: 80, y: 220, width: 3, s: 1 }] }];
  const a = rasterAtlasFibres(d, curve);
  d.regions[0]!.mirrored = true;
  const b = rasterAtlasFibres(d, curve);
  expect(a.levels[0]!.alpha).toEqual(b.levels[0]!.alpha);
  expect(a.levels[0]!.id).toEqual(b.levels[0]!.id);
  expect(b.flowError.rmsRadians).toBeLessThan(.01);
  expect(a.regions[0]!.direction.recommendedMirrored).toBe(true);
  expect(b.regions[0]!.mirrored).toBe(true);
});

test("atlas: each safe mip preserves cutoff+dither coverage for dense and sparse cells", () => {
  for (const count of [3, 16, 100]) for (const alphaCutoff of [0, .33]) {
    const d = fixture({ alphaCutoff }); d.regions[0] = { ...d.regions[0]!, count };
    const atlas = generateHairAtlas(d);
    expect(atlas.maxSafeMip).toBe(3);
    const coverage = atlas.regions[0]!.coverage;
    expect(coverage.length).toBe(4);
    for (const mip of coverage) {
      expect(Math.abs(mip.corrected - mip.target)).toBeLessThan(.001);
      expect(mip.saturated).toBe(false);
      const scale = 2 ** mip.level, r = atlas.regions[0]!.rect, level = atlas.levels[mip.level]!;
      const measured = measureFilteredCoverage(level.alpha, level.width,
        { x: r.x / scale, y: r.y / scale, width: r.width / scale, height: r.height / scale }, alphaCutoff);
      expect(measured).toBeCloseTo(mip.corrected, 12);
    }
  }
});

test("atlas: bilinear coverage is measured after filtering and cutoff, using an independent checkerboard oracle", () => {
  const alpha = Uint8Array.from({ length: 64 }, (_, i) => ((i % 8 + Math.floor(i / 8)) & 1) * 255);
  const expected = (.625 + .375) / 2;
  const resolved = (a: number) => hairResolvedCoverage(hairCoverage(a, .33));
  const measured = measureFilteredCoverage(alpha, 8, { x: 2, y: 2, width: 4, height: 4 }, .33);
  expect(measured).toBeCloseTo((resolved(.625) + resolved(.375)) / 2, 12);
  expect(Math.abs(measured - expected)).toBeGreaterThan(.1);
});

test("atlas: width envelopes alter silhouettes without changing fibre coordinates or intrinsic gradient", () => {
  const a = fixture(), b = fixture(); b.regions[0]!.widthProfile = [0, .2, 1, .1, 0];
  const original = sampleAtlasFibres(a), profiled = sampleAtlasFibres(b);
  expect(profiled.map(f => f.points.map(({ x, y, s }) => [x, y, s]))).toEqual(original.map(f => f.points.map(({ x, y, s }) => [x, y, s])));
  expect(profiled.some((f, i) => f.points.some((p, j) => p.width !== original[i]!.points[j]!.width))).toBe(true);
});

test("atlas: padding extends attributes while keeping alpha empty and neighbouring cells isolated", () => {
  const d = fixture(); d.regions = [
    { ...d.regions[0]!, key: "left", rect: { x: 0, y: 0, width: 128, height: 256 }, idQuantiles: [.1, .1] },
    { ...d.regions[0]!, key: "right", rect: { x: 128, y: 0, width: 128, height: 256 }, idQuantiles: [.9, .9] },
  ];
  const atlas = generateHairAtlas(d);
  for (const level of atlas.levels) {
    const y = Math.floor(level.height / 2), left = y * level.width + level.width / 2 - 1, right = left + 1;
    expect(level.alpha[left]).toBe(0); expect(level.alpha[right]).toBe(0);
    expect(level.id[left]).toBe(26); expect(level.id[right]).toBe(230);
  }
});

test("atlas: map statistics are coverage-weighted and include ID, gradient and specular-shift distributions", () => {
  const atlas = generateHairAtlas(fixture()), stats = measureAtlasRegion(atlas.levels[0]!, atlas.regions[0]!.rect, 0);
  expect(stats.coverage).toBeGreaterThan(0);
  expect(stats.id.histogram.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
  expect(stats.gradient.mean).toBeGreaterThan(.25);
  expect(stats.gradient.mean).toBeLessThan(.65);
  expect(stats.shift.histogram.length).toBe(16);
  const r = atlas.regions[0]!.rect, map = atlas.levels[0]!; let total = 0, shift = 0;
  for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) {
    const k = y * map.width + x, weight = hairResolvedCoverage(hairCoverage(map.alpha[k]! / 255, 0));
    total += weight; shift += weight * hairStrandRandom(map.id[k]! / 255);
  }
  expect(stats.shift.mean).toBeCloseTo(shift / total, 12);
});

test("atlas: cancellation before allocation and between resumable batches exposes no partial result", () => {
  const controller = new AbortController(); controller.abort();
  expect(() => generateHairAtlas(fixture(), controller.signal)).toThrow();
  const c = new AbortController(), steps = hairAtlasSteps(fixture(), c.signal);
  expect(steps.next().done).toBe(false); c.abort();
  expect(() => steps.next()).toThrow();
  for (const phase of ["raster", "padding", "mips"] as const) {
    const c = new AbortController(), work = hairAtlasSteps(fixture(), c.signal); let next = work.next();
    while (!next.done && next.value.phase !== phase) next = work.next();
    expect(next.done).toBe(false); c.abort(); expect(() => work.next()).toThrow();
  }
});

test("atlas: rejects invalid bounds, overlapping cells, nonfinite parameters and excessive work", () => {
  for (const bad of [fixture({ width: 255 }), fixture({ seed: NaN }), fixture({ alphaCutoff: 1 })])
    expect(() => generateHairAtlas(bad)).toThrow();
  for (const property of [{ padding: 0 }, { count: 1000000 }, { width: NaN }, { wave: { amplitude: .1, cycles: Infinity } },
    { idQuantiles: [.8, .2] }, { length: [1, .5] }]) {
    const d = fixture(); d.regions[0] = { ...d.regions[0]!, ...property } as typeof d.regions[number];
    expect(() => generateHairAtlas(d)).toThrow();
  }
  const d = fixture(); d.regions.push({ ...d.regions[0]!, key: "overlap" });
  expect(() => generateHairAtlas(d)).toThrow();
});
