import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { oracleDescribe } from "./optional-oracles";
import { CHROME, chromeInstalled, runProbePage } from "./webgl-harness";
import type { ScatterProbe } from "./webgl-skin-scatter-probe-page";

/**
 * The skin scatter's GPU passes on a real GPU (tests/webgl-skin-scatter-probe-page.ts; research/materials/shader-skin.md §11.8): the
 * blur and combine match the CPU reference run on the GPU's own input targets; no scatter lands outside the class-1 mask (an occluder
 * in front of the skin, checked against an independent mask); a Metallic decal above 0.1 switches it off under its coverage while the
 * skin's class and slot stay; light spreads past a hard terminator, red furthest; the wrap is gated off while it runs; the quality
 * setting changes the result; and the display adds Δ where it is non-zero only. Needs a local Chrome; public CI has none and skips.
 */
const PAGE = resolve(import.meta.dir, "webgl-skin-scatter-probe-page.ts");

oracleDescribe(chromeInstalled(), `headless Chrome is not installed at ${CHROME} (set CHROME)`)("skin scatter on a real GPU", () => {
  let probe: ScatterProbe;
  beforeAll(async () => { probe = await runProbePage<ScatterProbe>(PAGE); }, 120_000);

  test("every pass compiles and runs", () => {
    expect(probe.failure).toBeUndefined();
    expect(probe.errors).toEqual([]);
    expect(probe.ok).toBe(true);
  });

  test("the GPU passes match the CPU reference on the same inputs (half-float intermediate)", () => {
    expect(probe.parity.pixels).toBeGreaterThan(1000);
    expect(probe.parity.maxDelta).toBeGreaterThan(0.01);
    expect(probe.parity.maxGap).toBeLessThan(2e-3 * Math.max(1, probe.parity.maxDelta) + 1e-4);
  });

  test("no scatter outside the class-1 mask: the occluder carries neither class 1 nor Δ, though the skin beside it scatters", () => {
    expect(probe.bleed.occluderPixels).toBeGreaterThan(500);
    expect(probe.bleed.classed).toBe(0);
    expect(probe.bleed.scattered).toBe(0);
    expect(probe.bleed.outsideClass).toBe(0);
    expect(probe.bleed.besideOccluder).toBeGreaterThan(0);
  });

  test("a Metallic decal gates the scatter off under it, writes its √colour, and keeps the skin's class and slot", () => {
    expect(probe.metal.pixels).toBeGreaterThan(100);
    expect(probe.metal.scattered).toBe(0);
    // √ of the decal's sRGB-decoded (40, 80, 200) in bytes: 0.146, 0.283, 0.760 → 37, 72, 194 (±2 for filtering at the band edge).
    for (const [k, value] of [37, 72, 194].entries()) expect(Math.abs(probe.metal.s1[k]! - value)).toBeLessThan(3);
    expect(Math.abs(probe.metal.s1[3]! - probe.metal.skinSlotByte)).toBeLessThan(0.5);
    expect(probe.metal.skinSlotByte).toBe(32);
    expect(probe.metal.s0Alpha).toBeGreaterThan(0.2);
  });

  test("light spreads past the terminator, red reaching furthest", () => {
    const [r, g, b] = probe.spread.first as [number, number, number];
    expect(r).toBeGreaterThan(0);
    expect(r).toBeGreaterThan(b);
    // Red's falloff is widest (default.sp: 255/178/165), so more of it arrives 8 px out, per unit of albedo.
    expect(probe.spread.far[0]!).toBeGreaterThan(1.5 * probe.spread.far[2]!);
    expect(g).toBeGreaterThanOrEqual(0);
  });

  test("the wrap is gated off while the scatter runs and back on when it is switched off; the materials come back after the pass", () => {
    expect(probe.gates.active).toBe(0);
    expect(probe.gates.off).toBe(1);
    expect(probe.gates.restored).toBe(true);
  });

  test("Low and High quality differ", () => {
    expect(probe.qualityDifference).toBeGreaterThan(0.01);
  });

  test("the display adds Δ only where it is non-zero: the lit face is unchanged, the unlit face past the crease brightens", () => {
    expect(probe.display.lit).toBeLessThanOrEqual(1);
    expect(probe.display.unlit).toBeGreaterThan(3);
  });
});
