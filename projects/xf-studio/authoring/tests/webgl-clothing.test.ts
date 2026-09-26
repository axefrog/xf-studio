import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { oracleDescribe } from "./optional-oracles";
import { CHROME, chromeInstalled, runProbePage } from "./webgl-harness";
import type { ClothingProbe } from "./webgl-clothing-probe-page";

/**
 * V's clothes on a real GPU (knowledge/clothing.md; tests/webgl-clothing-probe-page.ts): the real scene host on a synthetic head with a
 * synthetic body and two garment layers on `multilayered.mt`, loaded through the host's detail loader. The garments bake and draw, a higher
 * layer wins where two coincide and a garment wins over the body, a body chunk the record leaves out draws nothing, a garment follows the
 * body's shape, the Body toggle hides the clothes with the body, and switching V releases them. Needs a local Chrome; public CI has none and
 * skips, and XFS_REQUIRE_ORACLES=1 turns the skip into a failure.
 */
const PAGE = resolve(import.meta.dir, "webgl-clothing-probe-page.ts");
const blue = ([r, g, b]: [number, number, number]) => b > r + 30 && b > g;
const red = ([r, g, b]: [number, number, number]) => r > g + 30 && r > b + 30;

oracleDescribe(chromeInstalled(), `headless Chrome is not installed at ${CHROME} (set CHROME)`)("clothes on a real GPU", () => {
  let probe: ClothingProbe;
  beforeAll(async () => { probe = await runProbePage<ClothingProbe>(PAGE, "", 120_000); }, 180_000);

  test("the garments bake and draw, every program compiles, and nothing is left out", () => {
    expect(probe.failure).toBeUndefined();
    expect(probe.errors).toEqual([]);
    expect(probe.ok).toBe(true);
    expect(probe.drawn.slots).toEqual(["body", "clothing", "clothing"]);
    expect(probe.drawn.problems).toEqual([]);
    expect(probe.drawn.limits).toEqual([]);
    expect(probe.drawn.bakes).toEqual(["baked", "baked"]);
  });

  test("where two layers coincide the higher layer shows, and a garment wins over the body under it", () => {
    expect(blue(probe.colours.overlapWithClothes)).toBe(true);
    expect(red(probe.colours.legsWithClothes)).toBe(true);
    expect(red(probe.colours.legsBodyOnly)).toBe(false);
  });

  test("a body chunk the record leaves out (a worn item's hiding tag) draws nothing", () => {
    expect(probe.colours.torsoWithClothes).toEqual(probe.colours.torsoEmpty);
  });

  test("a garment without shape keys of its own follows the body's applied shape", () => {
    expect(probe.shapes.garmentKeys).toEqual(["xfs_body_shape"]);
    expect(probe.shapes.garment).toBe(1);
  });

  test("the Body toggle hides the clothes with the body, and shows them again unchanged, without touching GPU memory", () => {
    expect(probe.hidden).toEqual({ clothesHidden: true, memorySame: true, shownAgainSame: true });
  });

  test("switching to the V without clothes, back, and to none leaves the GPU memory where it was (dispose leak)", () => {
    const { memory } = probe;
    expect(memory.withClothes.geometries).toBeGreaterThan(memory.bodyOnly.geometries);
    expect(memory.clothesAgain).toEqual(memory.withClothes);
    // The layered bake's kit (one per renderer, for its life) is the only thing left after the first V; nothing grows after that.
    expect(memory.none.geometries - memory.empty.geometries).toBeLessThanOrEqual(1);
    expect(memory.noneAgain).toEqual(memory.none);
  });
});
