/**
 * Mottle (`mottle-1`, vector engine extensions §7): validation and lineage, determinism, mean preservation,
 * preview/export parity through the one evaluator, byte-identical unmottled layers and the raster budget.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { curve, type Layer } from "../src/engines/layered-makeup/recipe";
import * as recipe from "../src/engines/layered-makeup/recipe";
import { matchingMottlePreset, mottlePreset, mottleSeed, mottleTile, nextMottleSeed, validMottle, MOTTLE_PRESET_IDS,
  type Mottle } from "../src/engines/layered-makeup/mottle";
import { NewerDataError } from "../src/platform/api";
import { parseRecipeFile, readRecipe, recipeFile } from "../src/recipe-schema";
import { coverage, createRasterJob, EYE_MIRROR, EYE_SKIN, initialRecipe, raster, rasterWindow } from "./fixtures/eye-region";
import { maskAlphaKey } from "../src/engines/layered-makeup/makeup-dependencies";
import { parseRecipe } from "../src/engines/layered-makeup/recipe";
import { EYE_MAKEUP_REGION } from "../src/features/eye-makeup/region";

const sha = (bytes: Uint8Array | Uint8ClampedArray) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const alpha = (rgba: Uint8ClampedArray) => Uint8Array.from({ length: rgba.length / 4 }, (_, i) => rgba[i * 4 + 3]);
const powder = (seed = 7): Mottle => mottlePreset("powder", seed);
function mottled(settings: Mottle, edit: (layer: Layer) => void = () => {}): Layer {
  const layer = initialRecipe().layers[0];
  edit(layer);
  layer.effects = { mottle: settings };
  return layer;
}
const inMemory = (layers: Layer[]) => parseRecipe({ uv: "gltf-uv0-top-left", layers }, EYE_MAKEUP_REGION.models);

test("a mottle block is exactly its fields in range, on any finish", () => {
  expect(validMottle(powder())).toBe(true);
  for (const id of MOTTLE_PRESET_IDS) expect(validMottle(mottlePreset(id, 3))).toBe(true);
  const bad: unknown[] = [{ ...powder(), amount: 1.2 }, { ...powder(), grain: .2 }, { ...powder(), seed: 1.5 }, { ...powder(), where: "centre" },
    { ...powder(), extra: 1 }, { ...powder(), model: "mottle-0" }, { ...powder(), streaks: { mode: "angle", length: 4 } },
    { ...powder(), streaks: { mode: "edge", length: 9 } }, { ...powder(), streaks: { mode: "edge", length: 4, angle: 10 } }];
  for (const value of bad) expect(validMottle(value)).toBe(false);
  for (const finish of ["matte", "glossy", "glitter"] as const) {
    const layer = mottled(powder(), l => { l.finish = finish; });
    expect(inMemory([layer]).layers[0].effects).toEqual({ mottle: powder() });
  }
});

test("unknown effects and mottle models are a newer build's; malformed effects are refused", () => {
  expect(() => inMemory([mottled({ ...powder(), model: "mottle-9" } as unknown as Mottle)])).toThrow(NewerDataError);
  const layer = initialRecipe().layers[0] as Record<string, unknown>;
  layer.effects = { sparkle: {} };
  expect(() => inMemory([layer as Layer])).toThrow(NewerDataError);
  for (const effects of [{}, [], null, { mottle: null }, { mottle: { ...powder(), amount: -1 } }]) {
    layer.effects = effects;
    let error: unknown;
    try { inMemory([layer as Layer]); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NewerDataError);
  }
});

test("recipe files: mottle needs recipe-12, older files cannot hold it, and removing it writes the older schema again", () => {
  const plain = initialRecipe(), withMottle = structuredClone(plain);
  withMottle.layers[1].effects = { mottle: powder() };
  expect(recipeFile(plain)!.schema).toBe("xfs/recipe-7");
  const file = recipeFile(withMottle)!;
  expect(file.schema).toBe("xfs/recipe-12");
  expect(readRecipe(JSON.parse(JSON.stringify(file)))).toEqual(withMottle);
  expect(parseRecipeFile(JSON.parse(JSON.stringify(file))).schema).toBe("xfs/recipe-12");
  expect(() => parseRecipeFile({ ...file, schema: "xfs/recipe-11" })).toThrow("Invalid mottle settings.");
  const removed = structuredClone(withMottle);
  delete removed.layers[1].effects;
  expect(recipeFile(removed)!.schema).toBe("xfs/recipe-7");
  // An unmottled recipe serializes exactly as before: no `effects` key appears.
  expect(JSON.stringify(recipeFile(plain))).not.toContain("effects");
});

test("unmottled layers keep their frozen mask bytes and their cache keys", () => {
  const layer = initialRecipe().layers[0];
  expect(sha(raster(layer, 1024)).slice(0, 16)).toBe("e652b1addb13a44f");
  expect(sha(raster(layer, 2048)).slice(0, 16)).toBe("87661b9adbf2219e");
  // An unmottled layer never reads the skin scale.
  expect(recipe.raster(layer, 256, EYE_MIRROR, { mmPerUv: { u: 1, v: 1 }, texelMm: 1 })).toEqual(raster(layer, 256));
  expect(maskAlphaKey(layer, 512)).not.toContain("mottle");
  expect(maskAlphaKey(mottled(powder()), 512)).not.toBe(maskAlphaKey(layer, 512));
  expect(maskAlphaKey(mottled(powder(1)), 512)).not.toBe(maskAlphaKey(mottled(powder(2)), 512));
});

test("CORE-110: every raster entry point requires the region's skin scale, and the raster tools draw mottled layers", () => {
  const layer = mottled(powder()), area = { u0: 0, u1: 1, v0: 0, v1: 1 };
  // Typed callers cannot leave it out (`bun run check` fails if these compile)…
  // @ts-expect-error the skin scale is required
  expect(() => recipe.raster(layer, 64, EYE_MIRROR)).toThrow("skin scale");
  // @ts-expect-error the skin scale is required
  expect(() => recipe.createRasterJob(layer, 64, EYE_MIRROR)).toThrow("skin scale");
  // @ts-expect-error the skin scale is required
  expect(() => recipe.rasterWindow(layer, 64, 64, area, EYE_MIRROR)).toThrow("skin scale");
  // …and an untyped caller is still told plainly; a disabled layer needs none.
  // @ts-expect-error the skin scale is required
  expect(() => recipe.raster(mottled(powder(), l => { l.enabled = false; }), 64, EYE_MIRROR)).not.toThrow();
  // The benchmark tool over a recipe with a mottled layer (it threw before, passing only the mirror).
  const dir = mkdtempSync(join(tmpdir(), "xfs-mottle-tool-")), file = join(dir, "recipe.json");
  try {
    const small = mottled(mottlePreset("mascara", 3), l => { l.symmetry = false; l.feather = .002; });
    writeFileSync(file, JSON.stringify(recipeFile({ uv: "gltf-uv0-top-left", layers: [small] })));
    const run = Bun.spawnSync([process.execPath, join(import.meta.dir, "..", "tools", "raster-performance.ts"), "", file], { stdout: "pipe", stderr: "pipe" });
    expect(run.stderr.toString()).not.toContain("skin scale");
    expect(run.exitCode).toBe(0);
    const records = JSON.parse(run.stdout.toString()) as { size: number; sha256: string }[];
    expect(records.map(r => r.size)).toEqual([1024, 2048]);
    expect(records[0].sha256).toBe(sha(raster(small, 1024)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 60_000);

test("the tile is deterministic, seeded and zero-mean at every mip level", () => {
  const a = mottleTile(11, .4), b = mottleTile(11, .4);
  expect(a).toBe(b);
  expect(a).toHaveLength(10);
  expect(sha(new Uint8Array(a[0].buffer)).slice(0, 16)).toBe(sha(new Uint8Array(mottleTile(11, .4)[0].buffer)).slice(0, 16));
  expect(mottleTile(12, .4)[0]).not.toEqual(a[0]);
  for (const level of a) {
    let sum = 0, peak = 0;
    for (const value of level) { sum += value; peak = Math.max(peak, Math.abs(value)); }
    expect(Math.abs(sum / level.length)).toBeLessThan(1e-5);
    expect(peak).toBeLessThanOrEqual(1.0001);
  }
  // Seeds: derived from a layer ID, and "shuffle" is a pure step.
  expect(mottleSeed("layer-1")).toBe(mottleSeed("layer-1"));
  expect(mottleSeed("layer-1")).not.toBe(mottleSeed("layer-2"));
  expect(nextMottleSeed(5)).toBe(nextMottleSeed(5));
  expect(nextMottleSeed(5)).not.toBe(5);
  for (const seed of [0, 1, 2147483647]) expect(validMottle({ ...powder(), seed: nextMottleSeed(seed) })).toBe(true);
  expect(matchingMottlePreset(mottlePreset("mascara", 99))).toBe("mascara");
  expect(matchingMottlePreset({ ...powder(), amount: .1 })).toBeUndefined();
});

test("CORE-109: a look's mottled layers keep their tiles however many it has, and dragging one clumping evicts no other layer's", () => {
  // Every layer a look can hold, each with its own seed, sampled in turn twice: the second pass reuses every mixture
  // (the old caches kept eight, so a ninth layer rebuilt a 64 ms tile on every raster).
  const seeds = Array.from({ length: recipe.MAX_LAYERS }, (_, i) => 9000 + i);
  const first = seeds.map(seed => mottleTile(seed, .3));
  seeds.forEach((seed, i) => expect(mottleTile(seed, .3)).toBe(first[i]));
  // Dragging one layer's clumping through forty values keeps every other layer's mixture.
  for (let step = 0; step <= 40; step++) mottleTile(seeds[0], step / 40);
  seeds.slice(1).forEach((seed, i) => expect(mottleTile(seed, .3)).toBe(first[i + 1]));
  // A rebuilt mixture is the same tile, byte for byte.
  expect(sha(new Uint8Array(mottleTile(seeds[0], .3)[0].buffer))).toBe(sha(new Uint8Array(first[0][0].buffer)));
});

test("a mottled raster is deterministic by seed and frozen (version the model whenever appearance changes)", () => {
  const layer = mottled(mottlePreset("mascara", 1234));
  const first = raster(layer, 512);
  expect(raster(structuredClone(layer), 512)).toEqual(first);
  expect(raster(mottled(mottlePreset("mascara", 1235)), 512)).not.toEqual(first);
  expect(sha(first)).toBe(FROZEN.mascara512);
  expect(sha(raster(mottled(mottlePreset("powder", 42)), 512))).toBe(FROZEN.powder512);
});

test("mottle preserves mean coverage away from clamping", () => {
  const mean = (bytes: Uint8ClampedArray) => { let s = 0; for (let i = 3; i < bytes.length; i += 4) s += bytes[i]; return s / (bytes.length / 4); };
  const film = (l: Layer) => { l.opacity = .5; l.feather = .02; };
  // Everywhere on a half-opaque film never clamps (|amount · c · d| ≤ c).
  for (const clumping of [0, .5, 1]) {
    const settings: Mottle = { ...mottlePreset("sponge", 5), amount: .8, clumping };
    const base = mean(raster(mottled(settings, l => { film(l); delete l.effects; }), 1024)), with_ = mean(raster(mottled(settings, film), 1024));
    expect(Math.abs(with_ - base) / base).toBeLessThan(.01);
  }
  // Edges on a soft shape: breakup confined to the edge, averaging to the same strength (little clamping).
  for (const id of ["powder", "mascara"] as const) {
    const soft = (l: Layer) => { l.feather = .03; };
    const base = mean(raster(mottled(powder(), l => { soft(l); delete l.effects; }), 1024)), with_ = mean(raster(mottled(mottlePreset(id, 9), soft), 1024));
    expect(Math.abs(with_ - base) / base).toBeLessThan(.02);
  }
  // Edges never touch fully covered or uncovered texels.
  const edge = raster(mottled(powder(), l => { l.opacity = 1; }), 256), plain = raster(mottled(powder(), l => { l.opacity = 1; delete l.effects; }), 256);
  for (let i = 3; i < plain.length; i += 4) if (plain[i] === 0 || plain[i] === 255) expect(edge[i]).toBe(plain[i]);
});

test("export equals preview: window rasters sample the same function at the same texel centres", () => {
  const cases: Mottle[] = [powder(), mottlePreset("mascara", 3), { ...mottlePreset("sponge", 8), streaks: { mode: "angle", angle: 30, length: 3 } }];
  for (const settings of cases) {
    const layer = mottled(settings, l => { l.feather = .02; });
    for (const size of [256, 255]) {
      const head = raster(layer, size);
      expect(rasterWindow(layer, size, size, { u0: 0, u1: 1, v0: 0, v1: 1 })).toEqual(head);
      // A texel-aligned sub-window at the head raster's density is the head raster's crop (the plate window at preview density).
      const x0 = Math.floor(size * .25), y0 = Math.floor(size * .15), w = Math.floor(size * .5), h = Math.floor(size * .2);
      const crop = rasterWindow(layer, w, h, { u0: x0 / size, u1: (x0 + w) / size, v0: y0 / size, v1: (y0 + h) / size });
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
        expect(crop[(y * w + x) * 4 + 3]).toBe(head[((y0 + y) * size + x0 + x) * 4 + 3]);
    }
  }
});

test("the paired, sliced and scalar paths agree byte for byte, streaks and mirrored copies included", () => {
  const cases: Mottle[] = [powder(), { ...powder(), where: "everywhere" }, mottlePreset("mascara", 3),
    { ...mottlePreset("cream", 4), streaks: { mode: "angle", angle: 60, length: 6 } }];
  for (const settings of cases) for (const symmetry of [true, false]) {
    const layer = mottled(settings, l => { l.symmetry = symmetry; l.feather = .03; l.points.forEach((p, i) => { p.weight = i % 2 ? 1 : .6; }); });
    const polygon = curve(layer.points);
    for (const size of [64, 63]) {
      const pixels = raster(layer, size), spacing = { u: 1 / size, v: 1 / size };
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
        expect(pixels[(y * size + x) * 4 + 3]).toBe(Math.round(255 * coverage((x + .5) / size, (y + .5) / size, layer, polygon, { skin: EYE_SKIN, spacing })));
      const job = createRasterJob(layer, size);
      while (!job.advance(1));
      expect(job.data).toEqual(pixels);
    }
  }
});

test("the grain is floored at two export texels and measured in skin millimetres", () => {
  const at = (grain: number) => raster(mottled({ ...powder(), grain }), 512);
  expect(at(.25)).toEqual(at(.26));
  expect(at(.26)).not.toEqual(at(.4));
  // A different skin scale is a different size on the skin.
  const layer = mottled(powder());
  const other = recipe.raster(layer, 512, EYE_MIRROR, { mmPerUv: { u: 300, v: 300 }, texelMm: .13 });
  expect(other).not.toEqual(raster(layer, 512));
});

test("mottle stays within the raster budget (about 5–10 ns per covered texel in the design; bounded generously here)", () => {
  const plain = initialRecipe().layers[0];
  plain.opacity = .8;
  const withMottle = { ...structuredClone(plain), effects: { mottle: { ...powder(), where: "everywhere" as const } } };
  const streaked = { ...structuredClone(plain), effects: { mottle: mottlePreset("mascara", 7) } };
  raster(withMottle, 256); raster(streaked, 256);
  const time = (l: Layer) => { let best = Infinity; for (let k = 0; k < 3; k++) { const t = performance.now(); raster(l, 2048); best = Math.min(best, performance.now() - t); } return best; };
  const base = time(plain), everywhere = time(withMottle), streaks = time(streaked);
  const covered = alpha(raster(plain, 2048)).reduce((n, a) => n + (a ? 1 : 0), 0);
  // Per covered texel (the symmetric raster evaluates each pair once, so this counts both copies).
  expect((everywhere - base) * 1e6 / covered).toBeLessThan(150);
  expect((streaks - base) * 1e6 / covered).toBeLessThan(600);
});

const FROZEN = {
  mascara512: "642b8f3b8c5fc9ea55279f463b230f83e49fb4275edbe667aa8b381b2329c37d",
  powder512: "505a04aec6d8117f98fb6ad8df6d77a0b79b5a760a663a78b50f562b9b1c79b1",
};
