import { test, expect } from "bun:test";
import { compileFlatPreset, mergeFlatSample, srgbToLinear, UnsupportedMaterialError } from "../src/engines/layered-makeup/preset-compiler";
import { initialRecipe, raster } from "../src/engines/layered-makeup/recipe";

test("merged channels reproduce ordered game-target blending over arbitrary backgrounds", () => {
  let seed = 2077;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let trial = 0; trial < 40; trial++) {
    const background = Array.from({ length: 5 }, random);
    let sequential = [...background];
    let merged = { color: [0, 0, 0] as [number, number, number], roughness: 0, metalness: 0, coverage: 0 };
    for (let layer = 0; layer < 7; layer++) {
      const top = { color: [random(), random(), random()] as [number, number, number], roughness: random(), metalness: random() };
      const a = random(), encoded = [...top.color.map(Math.sqrt), top.roughness, top.metalness];
      sequential = sequential.map((v, i) => encoded[i] * a + v * (1 - a));
      merged = mergeFlatSample(merged, top, a);
    }
    const encoded = [...merged.color.map(Math.sqrt), merged.roughness, merged.metalness];
    encoded.forEach((v, i) => expect(v * merged.coverage + background[i] * (1 - merged.coverage)).toBeCloseTo(sequential[i], 12));
  }
});

test("compiled pixels preserve coverage, order and destination colour encoding", () => {
  const recipe = initialRecipe();
  recipe.layers.forEach((l, i) => { l.enabled = i < 2; l.opacity = .5; l.points = structuredClone(recipe.layers[0].points); l.feather = .012; });
  recipe.layers[0].color = "#ff0000";
  recipe.layers[1].color = "#0000ff";
  recipe.layers[1].finish = "metallic";
  const baked = compileFlatPreset(recipe, 128), masks = recipe.layers.slice(0, 2).map(l => raster(l, 128));
  let overlaps = 0;
  for (let p = 0; p < 128 * 128; p++) {
    const a = masks[0][p * 4 + 3] / 255, b = masks[1][p * 4 + 3] / 255;
    const coverage = a + b * (1 - a), encodedCoverage = (baked.diffuse[p * 4 + 3] / 255) ** 2;
    expect(Math.abs(encodedCoverage - coverage)).toBeLessThan(.004);
    if (a > .4 && b > .4) {
      overlaps++;
      const r = Math.sqrt(srgbToLinear(baked.diffuse[p * 4] / 255)) * encodedCoverage;
      const blue = Math.sqrt(srgbToLinear(baked.diffuse[p * 4 + 2] / 255)) * encodedCoverage;
      expect(Math.abs(r - a * (1 - b))).toBeLessThan(.006);
      expect(Math.abs(blue - b)).toBeLessThan(.006);
      expect(blue).toBeGreaterThan(r);
      expect(Math.abs(baked.metalness[p] / 255 * encodedCoverage - .65 * b)).toBeLessThan(.006);
    }
  }
  expect(overlaps).toBeGreaterThan(10);
  [recipe.layers[0], recipe.layers[1]] = [recipe.layers[1], recipe.layers[0]];
  expect(compileFlatPreset(recipe, 128).diffuse).not.toEqual(baked.diffuse);
});

test("unsupported optical features fail explicitly without changing the recipe", () => {
  const recipe = initialRecipe(); recipe.layers[0].finish = "glitter";
  const before = JSON.stringify(recipe);
  expect(() => compileFlatPreset(recipe, 32)).toThrow(UnsupportedMaterialError);
  expect(JSON.stringify(recipe)).toBe(before);
  recipe.layers[0].enabled = false;
  expect(compileFlatPreset(recipe, 32).metadata.coveredTexels).toBe(0);
  expect(() => compileFlatPreset(recipe, 33)).toThrow();
});
