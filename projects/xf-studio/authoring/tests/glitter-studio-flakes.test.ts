import { expect, test } from "bun:test";
// Glitter flakes 2 (experiment 032): the Studio's glint models as the diagnostic Glitter route's flake statistics.
import { defaultClusteredGlintFlakes, defaultDirectGlintFlakes, defaultFineSpeckleFlakes } from "../src/engines/layered-makeup/direct-glint-settings";
import { parseExportDiagnostics } from "../src/export-diagnostics";
import { GLITTER_FLAKES_2, studioGlitterFlakes } from "../src/glitter-studio-flakes";

/** The maintainer's reference preset's glitter layer (research/materials/finish-designs/glitter.md): Dense fine speckles at full strength. */
const GLITTERATI = { model: "uv-cell-direct-3", density: .88, fineShare: .88, strength: 16, seed: 2077, color: "#fa006c" } as const;

test("the reference preset's model becomes dense 2-texel flakes above the fade, metallic, with a few large ones, clustered", () => {
  const { base, flakes } = studioGlitterFlakes(GLITTERATI);
  expect(base).toEqual({ roughness: .55, metalness: 0 });
  expect(flakes).toEqual({ sizeMm: .13, sizeSigma: .25, cover: .2688, tiltSigmaDeg: 16, tiltMaxDeg: 65, roughness: .2, metalness: 1, color: "#fa006c",
    seed: 2077, tiltMinDeg: 14, roughnessMax: .34, metalnessMin: .85, largeShare: .039, largeSizeMm: .2893, clusterMm: 3.805, clusterFloor: .48 });
});

test("every Studio model maps to flakes the knob accepts, never narrower than two window texels or below the fade", () => {
  for (const settings of [defaultDirectGlintFlakes(), defaultClusteredGlintFlakes(), defaultFineSpeckleFlakes(), GLITTERATI,
    { ...GLITTERATI, density: 0, strength: 0 }, { ...GLITTERATI, density: 1, strength: 32 }]) {
    const { base, flakes } = studioGlitterFlakes(settings);
    expect(flakes.sizeMm).toBeGreaterThanOrEqual(GLITTER_FLAKES_2.minWidthMm);
    expect(flakes.tiltMinDeg!).toBeGreaterThan(Math.acos(.98) * 180 / Math.PI);
    const parsed = parseExportDiagnostics({ schema: "xfs/export-diagnostics-1", presets: { p: { glitter: { base, regions: [{ layer: "l", mips: "nested", flakes }] } } } }, ["p"]);
    expect(parsed!.presets.p.glitter!.regions[0].flakes).toEqual(flakes);
  }
  // Clustered models carry the envelope; the direct model does not.
  expect(studioGlitterFlakes(defaultDirectGlintFlakes()).flakes.clusterMm).toBeUndefined();
  expect(studioGlitterFlakes(defaultClusteredGlintFlakes()).flakes.clusterFloor).toBe(.07);
  // More density, more cover; more strength, glossier and more metallic flakes.
  expect(studioGlitterFlakes({ ...GLITTERATI, density: .5 }).flakes.cover).toBeLessThan(studioGlitterFlakes(GLITTERATI).flakes.cover);
  const weak = studioGlitterFlakes({ ...GLITTERATI, strength: 4 }).flakes, strong = studioGlitterFlakes(GLITTERATI).flakes;
  expect(weak.roughness).toBeGreaterThan(strong.roughness); expect(weak.metalness).toBeLessThan(strong.metalness);
});
