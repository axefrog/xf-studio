import { expect, test } from "bun:test";
import {
  applyHairShadow, bakeHairProfile, bakedSample, EYELASH_DEFAULT_MI_OVERRIDES, gbufferDecalAlbedo, hairAlbedo,
  hairCoverage, hairFragmentColor, hairRoughness, hairShadowFactor, HAIR_TEMPLATE_DEFAULTS, linearEquivalentDecal,
  linearToSrgb8, overlayHairColor, profileIndex, resolveHairMaterial, sampleStopsEncoded, srgbToLinear, type Rgb,
} from "../src/hair-colour-model";

const close = (a: readonly number[], b: readonly number[], digits = 6) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));

test("stored profile stops sort stably, clamp at the ends and let the last duplicate win", () => {
  const stops = [
    { value: 1, color: [200, 100, 50] as const }, { value: 0.5, color: [100, 100, 100] as const },
    { value: 1, color: [255, 255, 255] as const }, { value: 0.25, color: [0, 0, 0] as const },
  ];
  expect(sampleStopsEncoded(stops, 0)).toEqual([0, 0, 0]);
  expect(sampleStopsEncoded(stops, 0.375)).toEqual([50, 50, 50]);
  expect(sampleStopsEncoded(stops, 0.5)).toEqual([100, 100, 100]);
  expect(sampleStopsEncoded(stops, 1)).toEqual([255, 255, 255]);
});

test("the bake decodes interpolated 8-bit colours and samples k/(N-1)", () => {
  const stops = [{ value: 0, color: [0, 0, 0] as const }, { value: 1, color: [255, 255, 255] as const }];
  const baked = bakeHairProfile(stops, 3);
  close(bakedSample(baked, 1), [srgbToLinear(127.5), srgbToLinear(127.5), srgbToLinear(127.5)]);
  close(bakedSample(bakeHairProfile(stops, 3, "stored-linear"), 1), [0.5, 0.5, 0.5]);
  expect(srgbToLinear(255)).toBe(1);
  expect(linearToSrgb8(srgbToLinear(107))).toBeCloseTo(107, 6);
  expect(() => bakeHairProfile(stops, 1)).toThrow();
});

test("profile lookup truncates like HLSL uint((N-1)*v) instead of filtering", () => {
  expect(profileIndex(107 / 255, 127)).toBe(52);   // constant grey Strand_ID placeholder
  expect(profileIndex(1, 127)).toBe(126);          // white Strand_Gradient placeholder
  expect(profileIndex(0.99, 127)).toBe(124);
  expect(profileIndex(-0.1, 127)).toBe(0);
  expect(profileIndex(Number.NaN, 127)).toBe(0);
  expect(profileIndex(2, 127)).toBe(126);
});

test("overlay uses the root-to-tip luminance and a neutral 0.5 ID leaves the base unchanged", () => {
  const dark: Rgb = [0.2, 0.1, 0.05], light: Rgb = [0.9, 0.8, 0.6];
  close(overlayHairColor(dark, [0.5, 0.5, 0.5]), dark);
  close(overlayHairColor(light, [0.5, 0.5, 0.5]), light);
  close(overlayHairColor(dark, [0.25, 0.5, 1]), [0.1, 0.1, 0.1]);
  close(overlayHairColor(light, [0.25, 0.25, 0.25]), [0.9, 0.8, 0.6].map(v => 1 - 2 * 0.75 * (1 - v)));
  // The branch is chosen per pixel, not per channel: a saturated dark base can exceed 1.
  expect(overlayHairColor([0.9, 0.1, 0.1], [0.9, 0.5, 0.5])[0]).toBeGreaterThan(1);
  // Screen branch can go negative; the resolve writes |rgb|.
  expect(overlayHairColor([0.9, 0.9, 0.0], [0.5, 0.5, 0.2])[2]).toBeLessThan(0);
  expect(hairFragmentColor([0.9, 0.9, 0.0], [0.5, 0.5, 0.2], 0, { shadowMin: -0.5, shadowMax: 1, shadowStrength: 0 })[2])
    .toBeGreaterThan(0);
});

test("vertex-red shadow term darkens painted strands only when ShadowStrength is set", () => {
  expect(hairShadowFactor(0, -0.4, 1)).toBe(1);
  const inner = hairShadowFactor(1, -0.4, 1);
  expect(inner).toBeCloseTo((0.4 / 1.4) ** 2 * (3 - 2 * 0.4 / 1.4), 9);
  // The lash .mi uses a zero-width range; fast HLSL division saturates to 1 for positive numerators.
  expect(hairShadowFactor(0, 0, 0)).toBe(1);
  expect(hairShadowFactor(1, 0, 0)).toBe(0);
  close(applyHairShadow([0.5, 0.5, 0.5], inner, 0), [0.5, 0.5, 0.5]);
  close(applyHairShadow([0.5, 0.5, 0.5], 0.2, 0.9), [0.5 + (0.1 - 0.5) * 0.9, 0.5 + (0.1 - 0.5) * 0.9, 0.5 + (0.1 - 0.5) * 0.9]);
});

test("coverage remaps Strand_Alpha by AlphaCutoff and roughness follows the ID-scaled G-buffer value", () => {
  expect(hairCoverage(0.5, 0)).toBe(0.5);
  expect(hairCoverage(0.33, 0.33)).toBe(0);
  expect(hairCoverage(0.665, 0.33)).toBeCloseTo(0.5, 9);
  expect(hairCoverage(0.9, 1)).toBe(0);
  const meluminary = resolveHairMaterial({ roughnessScale: 0.15, roughnessBias: 0.15, shadowRoughness: 0.75, shadowStrength: 0.9 });
  expect(hairRoughness(1, 1, meluminary)).toBeCloseTo(0.3, 9);
  expect(hairRoughness(0, 0, meluminary)).toBeCloseTo(0.15 + (0.75 - 0.15) * 0.9, 9);
  const lash = resolveHairMaterial(EYELASH_DEFAULT_MI_OVERRIDES);
  expect(hairRoughness(107 / 255, 1, lash)).toBe(1);
});

test("material overrides are validated against the template's parameter set and ranges", () => {
  expect(resolveHairMaterial()).toEqual({ ...HAIR_TEMPLATE_DEFAULTS });
  expect(resolveHairMaterial({ alphaCutoff: 0 }).alphaCutoff).toBe(0);
  expect(() => resolveHairMaterial({ tint: 1 })).toThrow();
  expect(() => resolveHairMaterial({ alphaCutoff: 2 })).toThrow();
  expect(() => resolveHairMaterial([])).toThrow();
});

test("baked two-row lookup composes index, overlay and shadow exactly like the fragment path", () => {
  const id = bakeHairProfile([{ value: 0, color: [128, 128, 128] }, { value: 1, color: [255, 255, 255] }], 127);
  const root = bakeHairProfile([{ value: 0, color: [20, 10, 5] }, { value: 1, color: [220, 200, 180] }], 127);
  const material = { shadowMin: -0.5, shadowMax: 1, shadowStrength: 0 };
  const expected = hairFragmentColor(bakedSample(root, 126), bakedSample(id, 0), 0, material);
  close(hairAlbedo(id, root, 127, 0, 1, 0, material), expected);
});

test("post-G-buffer decals blend sqrt(albedo); the linear-over equivalent reproduces it", () => {
  const skin: Rgb = [0.45, 0.3, 0.25], brow: Rgb = [0.02, 0.012, 0.006];
  for (const a of [0, 0.1, 0.25, 0.5, 0.9, 1]) {
    const target = gbufferDecalAlbedo(brow, a, skin);
    const { color, alpha } = linearEquivalentDecal(brow, a, skin);
    expect(alpha).toBeGreaterThanOrEqual(a);
    close(color.map((c, k) => alpha * c + (1 - alpha) * skin[k]!), target, 6);
  }
  // A black decal at coverage a behaves like linear alpha 2a - a^2 (denser than a).
  expect(linearEquivalentDecal([0, 0, 0], 0.25, skin).alpha).toBeCloseTo(0.4375, 9);
  // Fully covered and fully uncovered cases are unchanged.
  close(gbufferDecalAlbedo(brow, 1, skin), brow);
  close(gbufferDecalAlbedo(brow, 0, skin), skin);
});

test("hair direct light: white R lobe, albedo-tinted TRT, diffuse proportional to albedo", async () => {
  const { hairDirectLight, HAIR_LIGHTING_VANILLA, HAIR_LIGHTING_KARIS } = await import("../src/hair-colour-model");
  const T: Rgb = [0, 1, 0], N: Rgb = [0, 0, 1], V: Rgb = [0, 0, 1];
  for (const options of [HAIR_LIGHTING_VANILLA, HAIR_LIGHTING_KARIS]) {
    const lighting = { ...options, specularRandomMin: 0, specularRandomMax: 0 };
    // The R lobe peaks where sinL + sinV = sin(2 * shiftR) for a view along the normal.
    const L = [0, Math.sin(2 * lighting.shiftR), Math.cos(2 * lighting.shiftR)] as Rgb;
    const grey = hairDirectLight(L, V, T, N, [0.5, 0.5, 0.5], 0.2, lighting);
    const red = hairDirectLight(L, V, T, N, [0.5, 0.05, 0.05], 0.2, lighting);
    // Diffuse scales with albedo; the R lobe does not depend on it, TRT does.
    expect(red.diffuse[1] / grey.diffuse[1]).toBeCloseTo(0.1, 9);
    expect(red.specular[0]).toBeGreaterThan(red.specular[1]);
    expect(red.specular[1]).toBeGreaterThan(0);
    // A rougher fibre spreads (lowers) the R peak.
    expect(hairDirectLight(L, V, T, N, [0.5, 0.5, 0.5], 0.6, lighting).specular[0]).toBeLessThan(grey.specular[0]);
    // Scatter is an option-driven register.
    expect(hairDirectLight(L, V, T, N, [0.5, 0.5, 0.5], 0.2, { ...lighting, scatter: 0 }).diffuse).toEqual([0, 0, 0]);
  }
});

test("hair direct light: Mask_Intensity gates and diffuse arithmetic follow the 2.31 program", async () => {
  const { hairDirectLight, hairStrandRandom, HAIR_LIGHTING_VANILLA: V231 } = await import("../src/hair-colour-model");
  const T: Rgb = [0, 1, 0], N: Rgb = [0, 0, 1], V: Rgb = [0, 0, 1];
  const L: Rgb = [0, 0, 1];                                 // sinL = 0, N.L = 1
  const base = { ...V231, specularRandomMin: 0, specularRandomMax: 0 };
  // Diffuse = C/pi * lerp(w, 1-|sinL|, DiffuseScatterFactor) * clamp(w + 1 - Mask) * MultiScatter,
  // w = saturate((N.L + Wrap)/(1+Wrap)^2).
  const w = (1 + 0.35) / 1.35 ** 2;
  expect(hairDirectLight(L, V, T, N, [0.5, 0.5, 0.5], 0.3, base).diffuse[0]).toBeCloseTo(0.5 / Math.PI * w * w * 0.47, 9);
  // Mask_Intensity 0 opens the gate fully (clamp(w + 1) = 1).
  expect(hairDirectLight(L, V, T, N, [0.5, 0.5, 0.5], 0.3, { ...base, scatterMask: 0 }).diffuse[0])
    .toBeCloseTo(0.5 / Math.PI * w * 0.47, 9);
  // A light behind the card closes both gates at Mask_Intensity 1; the R lobe is gated by the specular wrap.
  const behind: Rgb = [0, 0, -1];
  expect(hairDirectLight(behind, V, T, N, [0.5, 0.5, 0.5], 0.3, base).diffuse[0]).toBe(0);
  const open = hairDirectLight(L, V, T, N, [0, 0, 0], 0.3, { ...base, specularMask: 0, intensityTRT: 0 }).specular[0];
  const gated = hairDirectLight(L, V, T, N, [0, 0, 0], 0.3, { ...base, intensityTRT: 0 }).specular[0];
  expect(gated / open).toBeCloseTo(Math.min(1, (1 + 0.3) / 1.3 ** 2), 9);
  // Per-strand random: frac(frac(id * 0.0729477) * 52.98292), mapped into [SpecularRandom_Min, _Max].
  expect(hairStrandRandom(0)).toBe(0);
  expect(hairStrandRandom(0.5)).toBeCloseTo((0.5 * 0.07294771 * 52.982918) % 1, 5);
  const a = hairDirectLight(L, V, T, N, [0.5, 0.5, 0.5], 0.3, V231, 0.2).specular[0];
  const b = hairDirectLight(L, V, T, N, [0.5, 0.5, 0.5], 0.3, V231, 0.7).specular[0];
  expect(a).not.toBeCloseTo(b, 6);
});
