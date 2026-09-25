import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { oracleDescribe } from "./optional-oracles";
import { CHROME, chromeInstalled, runProbePage } from "./webgl-harness";
import type { StudioLightingProbe } from "./webgl-studio-lighting-probe-page";

/**
 * The studio rig on a real GPU (tests/webgl-studio-lighting-probe-page.ts): the key's direction moves a gloss highlight on a
 * Metallic makeup plate (standard light and the skin's own light) and on plain metal, its strength scales the direct light, and
 * the environment strength scales the ambient term, with the prefiltered room and with the room's light probe (PREV-59).
 * Needs a local Chrome; public CI has none and skips, and XFS_REQUIRE_ORACLES=1 turns the skip into a failure.
 */
oracleDescribe(chromeInstalled(), `headless Chrome is not installed at ${CHROME} (set CHROME)`)("the studio rig on a real GPU", () => {
  let probe: StudioLightingProbe, hidden: StudioLightingProbe;
  beforeAll(async () => {
    probe = await runProbePage<StudioLightingProbe>(resolve(import.meta.dir, "webgl-studio-lighting-probe-page.ts"));
    hidden = await runProbePage<StudioLightingProbe>(resolve(import.meta.dir, "webgl-studio-lighting-probe-page.ts"), "?hide=half-float");
  }, 180_000);

  test("the probe ran without shader or WebGL errors, with the prefiltered room and with its light probe", () => {
    for (const [run, mode] of [[probe, "pmrem"], [hidden, "probe"]] as const) {
      expect(run.failure).toBeUndefined();
      expect(run.errors).toEqual([]);
      expect(run.ok).toBe(true);
      expect(run.environment).toBe(mode);
    }
  });

  test("the key's azimuth and elevation move the gloss highlight on the Metallic plate (both lights) and on metal", () => {
    for (const name of ["plate", "plateSkinLight", "metal"] as const) {
      const { azimuth, elevation } = probe.surfaces[name];
      // The camera looks along +Z, so V's right (+X, azimuth 0–180°) is the image's left: the highlight moves left as the key
      // swings from V's left (300°) through the front to V's right (60°), and up as the key rises.
      const xs = ["300", "330", "0", "30", "60"].map(key => azimuth[key]!.x);
      for (let i = 1; i < xs.length; i++) expect(xs[i]!, `${name} azimuth step ${i}`).toBeLessThan(xs[i - 1]!);
      expect(xs[0]! - xs[4]!, name).toBeGreaterThan(12);
      const ys = ["-20", "0", "20", "45", "70"].map(key => elevation[key]!.y);
      for (let i = 1; i < ys.length; i++) expect(ys[i]!, `${name} elevation step ${i}`).toBeGreaterThan(ys[i - 1]!);
      expect(ys[4]! - ys[0]!, name).toBeGreaterThan(12);
    }
  });

  test("the key's strength scales the direct light linearly (scene-linear, before tone mapping)", () => {
    for (const name of ["plate", "plateSkinLight", "metal"] as const) {
      const { single, double } = probe.surfaces[name].strength;
      expect(single).toBeGreaterThan(0.05);
      expect(double / single).toBeCloseTo(2, 1);
    }
  });

  test("the environment strength scales the ambient term, on the skin and on the plate, prefiltered or as a light probe", () => {
    for (const run of [probe, hidden]) for (const name of ["skin", "plate"] as const) {
      const { full, half, none } = run.ambient[name];
      expect(full).toBeGreaterThan(0.02);
      expect(none).toBeLessThan(full * 0.01);
      // 8-bit readback without half float: allow its rounding.
      expect(Math.abs(half / full - 0.5)).toBeLessThan(run.float ? 0.01 : 0.05);
    }
  });
});
