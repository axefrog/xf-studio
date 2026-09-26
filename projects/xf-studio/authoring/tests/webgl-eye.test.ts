import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { oracleDescribe } from "./optional-oracles";
import { CHROME, chromeInstalled, runProbePage } from "./webgl-harness";
import type { EyeProbe } from "./webgl-eye-probe-page";

/**
 * Eye plan ranks 4–5 on a real GPU in headless Chrome (tests/webgl-eye-probe-page.ts): the eye's GLSL functions agree with their
 * TypeScript twins (which tests/eye-shading.test.ts checks against the eye reference), and on a synthetic eyeball the eye material
 * changes the previous preview's eye the way the reference predicts: a smaller, brighter catch light (roughness 0.05 against the
 * flat 0.18), an iris shaded by its relief, the pupil displaced by parallax at a 30° view, and the iris plane mirrored in V against
 * the mesh's coordinate as the program computes it. Needs a local Chrome; public CI has none and skips, and
 * XFS_REQUIRE_ORACLES=1 turns the skip into a failure.
 */
const PAGE = resolve(import.meta.dir, "webgl-eye-probe-page.ts");

oracleDescribe(chromeInstalled(), `headless Chrome is not installed at ${CHROME} (set CHROME)`)("the eye on a real GPU", () => {
  let probe: EyeProbe;
  beforeAll(async () => {
    probe = await runProbePage<EyeProbe>(PAGE, "", 120_000);
    if (process.env.XFS_PRINT_EYE_PROBE === "1") console.log(JSON.stringify(probe, null, 1));
  }, 180_000);

  test("the eye program compiles and draws; its GLSL matches the TypeScript twins", () => {
    expect(probe.failure).toBeUndefined();
    expect(probe.errors).toEqual([]);
    expect(probe.ok).toBe(true);
    expect(probe.parity.cases).toBe(48);
    expect(probe.parity.iris).toBeLessThan(2e-5);
    expect(probe.parity.cornea).toBeLessThan(2e-5);
    expect(probe.parity.diffuse).toBeLessThan(2e-5);
    expect(probe.parity.specular).toBeLessThan(1e-3);
  });

  test("the catch light: at the same flat 0.18 the eye's lobe carries half the energy; at the eye's own 0.05 it is a crisp point", () => {
    const { before, afterFlat, after } = probe.specular;
    // Same lobe size, half the energy: the eye visibility (0.125 at normal incidence) against Smith with N·L (0.25).
    expect(afterFlat.core.total / before.core.total).toBeGreaterThan(0.4);
    expect(afterFlat.core.total / before.core.total).toBeLessThan(0.6);
    expect(Math.abs(afterFlat.core.pixels / before.core.pixels - 1)).toBeLessThan(0.25);
    // The sclera's own roughness (26/255 × RoughnessScale ≈ 0.05): a few pixels, far brighter, less total energy than before.
    expect(after.core.pixels).toBeLessThan(before.core.pixels / 10);
    expect(after.core.peak).toBeGreaterThan(before.core.peak * 10);
    expect(after.core.total).toBeLessThan(before.core.total);
  });

  test("the iris is shaded by its relief: under a side light its fibres read with far more contrast than on the smooth sphere", () => {
    expect(probe.after.sideLight!.irisContrast).toBeGreaterThan(2 * probe.before.sideLight!.irisContrast);
  });

  test("the iris sits under the cornea: centred straight on, displaced by parallax at a 30° view", () => {
    const straight = probe.after.catchLight!.pupil!;
    expect(Math.hypot(...straight)).toBeLessThan(1);
    const shift = probe.after.view30!.pupil![0] - probe.before.view30!.pupil![0];
    // About 0.8 mm on the eye at this scale (4.5 pixels per millimetre); the painted pupil of the previous eye has none.
    expect(Math.abs(shift)).toBeGreaterThan(2);
    expect(Math.abs(shift)).toBeLessThan(8);
    expect(Math.abs(probe.after.view30!.pupil![1] - probe.before.view30!.pupil![1])).toBeLessThan(1);
  });

  test("the program's iris plane is mirrored in V against the mesh coordinate: an iris marker below the pupil draws above it", () => {
    const before = probe.before.catchLight!.marker!, after = probe.after.catchLight!.marker!;
    expect(before[1]).toBeLessThan(-10);
    expect(after[1]).toBeGreaterThan(10);
    expect(Math.abs(after[0] - before[0])).toBeLessThan(2);
  });
});
