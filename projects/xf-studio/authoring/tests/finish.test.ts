import { test, expect } from "bun:test";
import { bakeFlakes, canonicalFinish, defaultFlakes } from "../src/finish";
import { initialRecipe, parseRecipe, raster } from "../src/recipe";

test("flake fields are deterministic, seed-dependent, bounded and opaque with unit normals", () => {
  const p = defaultFlakes(),
    a = bakeFlakes(256, "glitter", { ...p, cells: 32 });
  expect(bakeFlakes(256, "glitter", { ...p, cells: 32 })).toEqual(a);
  expect(
    bakeFlakes(256, "glitter", { ...p, cells: 32, seed: 10 }).normal,
  ).not.toEqual(a.normal);
  let facets = 0;
  for (let i = 0; i < a.normal.length; i += 4) {
    const n = Array.from(a.normal.subarray(i, i + 3), (x) => (x / 255) * 2 - 1);
    expect(Math.abs(Math.hypot(...n) - 1)).toBeLessThan(0.008);
    expect(a.normal[i + 3]).toBe(255);
    expect(a.surface[i + 3]).toBe(255);
    if (a.surface[i] > 0) facets++;
  }
  expect(facets).toBeGreaterThan(100);
  expect(facets).toBeLessThan((256 * 256) / 2);
});

test("empty flakes produce flat normals and nonmetallic pigment; finish never changes coverage", () => {
  const a = bakeFlakes(64, "glitter", { ...defaultFlakes(), density: 0 });
  for (let i = 0; i < a.normal.length; i += 4) {
    expect(Array.from(a.normal.subarray(i, i + 4))).toEqual([
      128, 128, 255, 255,
    ]);
    expect(a.surface[i]).toBe(0);
    expect(a.surface[i + 2]).toBe(0);
  }
  const recipe = initialRecipe(),
    layer = recipe.layers[0],
    mask = raster(layer, 64);
  for (const finish of [
    "regular",
    "shimmer",
    "glitter",
    "satin",
    "metallic",
    "glossy",
    "iridescent",
  ] as const) {
    layer.finish = finish;
    layer.flakes = defaultFlakes();
    expect(parseRecipe(recipe)).toEqual(recipe);
    expect(raster(layer, 64)).toEqual(mask);
  }
  expect(canonicalFinish("satin")).toBe("regular");
  expect(canonicalFinish("metallic")).toBe("metallic");
  expect(() =>
    bakeFlakes(512, "glitter", { ...defaultFlakes(), cells: Infinity }),
  ).toThrow();
  layer.flakes = { ...defaultFlakes(), density: NaN };
  expect(() => parseRecipe(recipe)).toThrow();
});
