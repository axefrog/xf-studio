import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { oracleDescribe } from "./optional-oracles";
import { CHROME, chromeInstalled, runProbePage } from "./webgl-harness";
import type { PlateCompositeProbe } from "./webgl-plate-probe-page";

/**
 * The plate composite on a real GPU (tests/webgl-plate-probe-page.ts): its faceted chain against the export's
 * (route-mip-chains.ts `facetedMipChain`, PREV-57) at levels 0 and 2 on half-float and 8-bit targets, mip generations per update
 * (PREV-61), the studio environment's light-probe fallback (PREV-59) and a lost and restored context (PREV-58). Needs a local
 * Chrome; public CI has none and skips, and XFS_REQUIRE_ORACLES=1 turns the skip into a failure.
 */
const gap = (a: readonly number[], b: readonly number[]) => Math.max(...a.map((value, k) => Math.abs(value - b[k]!)));
const relative = (a: readonly number[], b: readonly number[]) => Math.max(...a.map((value, k) => Math.abs(value / b[k]! - 1)));

oracleDescribe(chromeInstalled(), `headless Chrome is not installed at ${CHROME} (set CHROME)`)("the plate composite on a real GPU", () => {
  let probe: PlateCompositeProbe;
  beforeAll(async () => { probe = await runProbePage<PlateCompositeProbe>(resolve(import.meta.dir, "webgl-plate-probe-page.ts")); }, 120_000);

  test("the probe ran without shader or WebGL errors", () => {
    expect(probe.failure).toBeUndefined();
    expect(probe.ok).toBe(true);
    expect(probe.errors).toEqual([]);
    expect(probe.halfFloat).toBe(true);
  });

  test("the half-float chain is the export's faceted chain: roughness unwidened at level 0 and widened by the lost facet variance at level 2", () => {
    const half = probe.chains.find(chain => chain.precision === "half-float")!;
    for (const level of half.levels) {
      // Byte units: the export rounds to bytes, the composite keeps floats.
      expect(level.roughnessMaxError).toBeLessThanOrEqual(0.6);
      // The merged normal is rounded to the export's bytes from half-float sums: a tie can land one byte away.
      expect(level.normalMaxError).toBeLessThanOrEqual(1.2);
      expect(level.coverageMaxError).toBeLessThanOrEqual(0.6);
    }
    // The finding's case, Shimmer 50 % over Glossy 50 % at one facet: the export's roughness, not a widened one, at level 0.
    const { facet } = probe;
    expect(Math.abs(facet.previewLevel0 - facet.exportLevel0)).toBeLessThanOrEqual(0.5 / 255 + 1e-3);
    expect(Math.abs(facet.previewLevel2 - facet.exportLevel2)).toBeLessThanOrEqual(0.5 / 255 + 1e-3);
    expect(facet.exportLevel2).toBeGreaterThan(facet.exportLevel0 + 0.05);
    // The earlier composite widened it already at level 0.
    expect(facet.earlierLevel0).toBeGreaterThan(facet.exportLevel0 + 0.05);
  });

  test("the 8-bit chain stays within a few byte steps of the export's", () => {
    const byte = probe.chains.find(chain => chain.precision === "8-bit")!;
    const [level0, level2] = byte.levels;
    expect(level0!.roughnessMaxError).toBeLessThanOrEqual(3);
    expect(level0!.normalMaxError).toBeLessThanOrEqual(2);
    expect(level2!.roughnessMaxError).toBeLessThanOrEqual(4);
    expect(level2!.normalMaxError).toBeLessThanOrEqual(2);
    expect(Math.max(level0!.coverageMaxError, level2!.coverageMaxError)).toBeLessThanOrEqual(2);
  });

  test("an update with twelve layers generates mips once per merged attachment, not after every layer draw (PREV-61)", () => {
    expect(probe.mips.layers).toBe(12);
    expect(probe.mips.draws).toEqual({ layerDraws: 12, resolves: 1, levelDraws: 5 });
    expect(probe.mips.perUpdate).toBe(3);
  });

  test("the room's light probe carries the room's harmonics and its diffuse light", () => {
    expect(probe.environment.shMaxError).toBeLessThanOrEqual(1e-3);
    expect(relative(probe.environment.probe, probe.environment.pmrem)).toBeLessThanOrEqual(0.1);
  });

  test("after a lost and restored context the plate and the environment come back only with the restore hooks (PREV-58)", () => {
    const { before, unhooked, hooked } = probe.restore;
    expect(gap(unhooked.plate, before.plate)).toBeGreaterThan(0.01);
    expect(gap(unhooked.skin, before.skin)).toBeGreaterThan(0.01);
    expect(relative(hooked.plate, before.plate)).toBeLessThanOrEqual(0.002);
    expect(relative(hooked.skin, before.skin)).toBeLessThanOrEqual(0.002);
  });
});
