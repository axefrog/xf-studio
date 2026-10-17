import { expect, test } from "bun:test";
import { defaultHairAtlas, generateHairAtlas, measureFilteredCoverage } from "../src/features/hair-lab/textures";
import { hairAtlasStripSteps, prepareHairAtlasStrips, selectHairAtlasStrip } from "../src/features/hair-lab/strand-strips";

const fixture = () => {
  const d = defaultHairAtlas(256);
  d.regions = [
    { ...d.regions[0]!, key: "dense", rect: { x: 0, y: 0, width: 128, height: 256 }, padding: 8, count: 40, width: .025, lengthClass: "long" as const, idSampling: undefined, idHistogram: undefined },
    { ...d.regions[0]!, key: "flyaway", type: "single" as const, variant: "curl" as const, rect: { x: 128, y: 0, width: 128, height: 256 },
      padding: 8, count: 4, width: .025, lengthClass: "short" as const, mirrored: true, idQuantiles: [.9, .9], idSampling: undefined, idHistogram: undefined },
  ];
  return d;
};
test("strip chains preserve individual filtered coverage to 1x1, beyond shared atlas gutters", () => {
  for (const alphaCutoff of [0, .33]) {
    const d = fixture(); d.alphaCutoff = alphaCutoff;
    const atlas = generateHairAtlas(d), result = prepareHairAtlasStrips(atlas);
    expect(result).toEqual(prepareHairAtlasStrips(atlas));
    for (const strip of result.strips) {
      expect(strip.levels.at(-1)!.width).toBe(1); expect(strip.levels.at(-1)!.height).toBe(1);
      expect(strip.levels.length).toBe(1 + Math.floor(Math.log2(Math.max(strip.levels[0]!.width, strip.levels[0]!.height))));
      expect(strip.levels.length).toBeGreaterThan(atlas.maxSafeMip + 1);
      for (const [i, level] of strip.levels.entries()) {
        const actual = measureFilteredCoverage(level.alpha, level.width, { x: 0, y: 0, width: level.width, height: level.height }, alphaCutoff);
        expect(Math.abs(actual - strip.coverage[0]!.target)).toBeLessThan(.004);
        expect(actual).toBeCloseTo(strip.coverage[i]!.corrected, 12);
      }
    }
    const a = result.strips[0]!, b = result.strips[1]!;
    expect(a.coverage.at(-1)!.corrected).toBeGreaterThan(b.coverage.at(-1)!.corrected + .2);
    expect(b.levels.every(level => level.id.every(id => id === 230))).toBe(true);
  }
});
test("strip selector uses explicit card kind, length and tangent basis, with stable choices and no hidden fallback", () => {
  const result = prepareHairAtlasStrips(generateHairAtlas(fixture()));
  expect(selectHairAtlasStrip(result, { kind: "dense", lengthClass: "long", mirrored: false }, 3)?.key).toBe("dense");
  expect(selectHairAtlasStrip(result, { kind: "flyaway", lengthClass: "short", mirrored: true }, 3)?.key).toBe("flyaway");
  expect(selectHairAtlasStrip(result, { kind: "curl" }, 3)?.key).toBe("flyaway");
  expect(selectHairAtlasStrip(result, { kind: "wisp" }, 3)).toBeNull();
  expect(selectHairAtlasStrip(result, { kind: "flyaway", mirrored: false }, 3)).toBeNull();
  const region = result.strips[1]!;
  expect(region.atlasUV).toEqual({ u0: 136 / 256, u1: 248 / 256, v0: 8 / 256, v1: 248 / 256 });
});
test("strip preparation honours an already-aborted lifetime", () => {
  const life = new AbortController(); life.abort();
  expect(() => prepareHairAtlasStrips(generateHairAtlas(fixture()), life.signal)).toThrow();
  const nextLife = new AbortController(), steps = hairAtlasStripSteps(generateHairAtlas(fixture()), nextLife.signal);
  steps.next(); steps.next(); nextLife.abort(); expect(() => steps.next()).toThrow();
});
