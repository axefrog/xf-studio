import { expect, test } from "bun:test";
import {
  applyHairShadow, bakeHairProfile, bakeHairProfileBytes, bakedSample, EYELASH_DEFAULT_MI_OVERRIDES, gbufferDecalAlbedo, hairAlbedo,
  hairCoverage, hairDitherThreshold, hairFragmentColor, hairPixelCoverage, hairResolvedCoverage, hairRoughness, HAIR_DITHER, hairShadowFactor, HAIR_TEMPLATE_DEFAULTS, linearEquivalentDecal,
  linearToSrgb8, overlayHairColor, profileIndex, rescaledStops, resolveHairMaterial, sampleStopsEncoded, srgbToLinear, type Rgb,
} from "../src/hair-colour-model";

const close = (a: readonly number[], b: readonly number[], digits = 6) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));

test("stored profile stops sort stably, rescale to span 0 to 1 and let the last duplicate win", () => {
  const stops = [
    { value: 1, color: [200, 100, 50] as const }, { value: 0.5, color: [100, 100, 100] as const },
    { value: 1, color: [255, 255, 255] as const }, { value: 0.25, color: [0, 0, 0] as const },
  ];
  // Positions 0.25, 0.5, 1 rescale to 0, 1/3, 1 (the game stretches every profile over the whole row).
  expect(rescaledStops(stops).map(stop => stop.value)).toEqual([0, 1 / 3, 1, 1]);
  expect(sampleStopsEncoded(stops, 0)).toEqual([0, 0, 0]);
  close(sampleStopsEncoded(stops, 1 / 6), [50, 50, 50]);
  close(sampleStopsEncoded(stops, 1 / 3), [100, 100, 100]);
  expect(sampleStopsEncoded(stops, 1)).toEqual([255, 255, 255]);
  // A stored range under 0.001 spaces the stops evenly; one stop colours the whole row.
  expect(rescaledStops([{ value: 0.5, color: [0, 0, 0] }, { value: 0.5005, color: [9, 9, 9] }, { value: 0.5, color: [3, 3, 3] }])
    .map(stop => stop.value)).toEqual([0, 0.5, 1]);
  expect(sampleStopsEncoded([{ value: 0.7, color: [10, 20, 30] }], 0.2)).toEqual([10, 20, 30]);
  expect(() => rescaledStops([])).toThrow();
});

test("the bake samples k/N, interpolates stored bytes, truncates and then decodes sRGB", () => {
  const stops = [{ value: 0, color: [0, 0, 0] as const }, { value: 1, color: [255, 255, 255] as const }];
  // t = 0, 1/4, 1/2, 3/4: 63.75, 127.5 and 191.25 truncate; the last sample never reaches the stop at 1.
  expect([...bakeHairProfileBytes(stops, 4)].filter((_, i) => i % 3 === 0)).toEqual([0, 63, 127, 191]);
  const baked = bakeHairProfile(stops, 4);
  close(bakedSample(baked, 2), [srgbToLinear(127), srgbToLinear(127), srgbToLinear(127)]);
  close(bakedSample(bakeHairProfile(stops, 4, "stored-linear"), 2), [127 / 255, 127 / 255, 127 / 255]);
  expect(srgbToLinear(255)).toBe(1);
  expect(linearToSrgb8(srgbToLinear(107))).toBeCloseTo(107, 6);
  expect(() => bakeHairProfile(stops, 1)).toThrow();
});

test("the bake stretches a profile that starts late: its first stop moves to the root", () => {
  // Root-to-tip stops from 0.146 (near black) to 1.0, like a profile whose dark band used to cover the first 15 % of the length.
  const late = [{ value: 0.146, color: [8, 4, 3] as const }, { value: 0.5, color: [140, 120, 100] as const }, { value: 1, color: [200, 180, 160] as const }];
  const bytes = bakeHairProfileBytes(late, 127);
  expect([bytes[0], bytes[1], bytes[2]]).toEqual([8, 4, 3]);
  // 10 % along the strand is already well into the ramp (it sat on the flat dark band before rescaling).
  const k = Math.round(0.1 * 127);
  expect(bytes[k * 3]).toBe(Math.trunc(8 + (140 - 8) * (k / 127) / ((0.5 - 0.146) / 0.854)));
  expect(bytes[k * 3]!).toBeGreaterThan(30);
  // The rescaled stop at (0.5 − 0.146)/0.854 is reached at the first sample k/N at or past it.
  const at = Math.ceil(((0.5 - 0.146) / 0.854) * 127);
  expect(bytes[at * 3]!).toBeGreaterThanOrEqual(140);
  // A duplicate stop never opens a zero-width segment: the later one starts the next segment.
  const dup = bakeHairProfileBytes([{ value: 0, color: [0, 0, 0] }, { value: 0.5, color: [10, 10, 10] }, { value: 0.5, color: [250, 250, 250] }, { value: 1, color: [255, 255, 255] }], 4);
  expect(dup[2 * 3]).toBe(250);
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

test("the hair dither threshold spans [offset, offset + 5·step) and cycles every five frames", () => {
  let min = Infinity, max = -Infinity;
  for (let y = 0.5; y < 64; y++) for (let x = 0.5; x < 64; x++) {
    const t = hairDitherThreshold(x, y, 0);
    min = Math.min(min, t); max = Math.max(max, t);
    expect(hairDitherThreshold(x, y, 5)).toBeCloseTo(t, 9);
  }
  expect(min).toBeGreaterThanOrEqual(HAIR_DITHER.offset);
  expect(max).toBeLessThan(HAIR_DITHER.offset + 5 * HAIR_DITHER.step);
  expect(HAIR_DITHER.offset + 5 * HAIR_DITHER.step).toBeCloseTo(0.8356, 3);
});

test("resolved hair coverage matches the dithered pass rate and is nested across layers", () => {
  // Pass rate of one layer over a 5-frame cycle and a 64x64 pixel block.
  const passRate = (alphas: number[]) => {
    let covered = 0, total = 0;
    for (let frame = 0; frame < 5; frame++) for (let y = 0.5; y < 64; y++) for (let x = 0.5; x < 64; x++) {
      const t = hairDitherThreshold(x, y, frame);
      covered += alphas.some(a => a > t) ? 1 : 0; total++;
    }
    return covered / total;
  };
  for (const a of [0.1, 0.3, 0.5, 0.7]) expect(passRate([a])).toBeCloseTo(hairResolvedCoverage(a), 1);
  expect(hairResolvedCoverage(0)).toBe(0);
  expect(hairResolvedCoverage(0.84)).toBe(1);
  // Denser than the alpha value itself: the dither range ends near 0.84.
  expect(hairResolvedCoverage(0.5)).toBeGreaterThan(0.58);
  // Two half-covering layers share the threshold: the pixel is as covered as one layer, not 1 - (1 - a)^2.
  expect(passRate([0.5, 0.5])).toBeCloseTo(passRate([0.5]), 9);
  expect(hairPixelCoverage([0.2, 0.5, 0.4])).toBe(hairResolvedCoverage(0.5));
});

test("local lights evaluate the same model with the LocalLight intensities (executable defaults)", async () => {
  const { hairDirectLight, HAIR_LIGHTING_VANILLA: V231 } = await import("../src/hair-colour-model");
  expect([V231.localR, V231.localTRT, V231.localScatter]).toEqual([0.35, 0.8, 0.47]);
  expect([V231.envR, V231.envTRT, V231.envMultiScatter, V231.additionalAreaRoughness]).toEqual([0.3, 0.8, 0.47, 0.1]);
  const T: Rgb = [0, 1, 0], N: Rgb = [0, 0, 1], V: Rgb = [0, 0, 1], L: Rgb = [0, 0, 1];
  const base = { ...V231, specularRandomMin: 0, specularRandomMax: 0 };
  const global = hairDirectLight(L, V, T, N, [0, 0, 0], 0.3, { ...base, intensityTRT: 0 });
  const local = hairDirectLight(L, V, T, N, [0, 0, 0], 0.3, { ...base, localTRT: 0 }, 0, "local");
  expect(local.specular[0] / global.specular[0]).toBeCloseTo(0.35 / 0.3, 9);
});

test("hair environment light: a view-aligned virtual light, albedo twice in the diffuse, widened irradiance-lit lobes", async () => {
  const { hairEnvironmentLight, hairDirectLight, HAIR_LIGHTING_VANILLA: V231 } = await import("../src/hair-colour-model");
  const base = { ...V231, specularRandomMin: 0, specularRandomMax: 0 };
  const T: Rgb = [0, 1, 0], N: Rgb = [0, 0, 1], V: Rgb = [0, 0, 1];
  // Front-facing (N·L_e = 1): diffuse per unit E = 2·EnvMS·C·w²·albedo, w = wrap(1, 0.35) ≈ 0.74, so about 0.52·C of a Standard surface.
  const w = (1 + 0.35) / 1.35 ** 2;
  for (const c of [0.1, 0.5]) {
    const env = hairEnvironmentLight(V, T, N, [c, c, c], 0.3, base);
    expect(env.diffuse[0]).toBeCloseTo(2 * 0.47 * c * w * w * c, 9);
    expect(env.diffuse[0] / c).toBeCloseTo(0.516 * c, 3);
  }
  // A view tilted along the strand: L_e drops its along-strand part, so the result equals a real light at L_e with the env intensities.
  const tilted = [0, Math.sin(0.4), Math.cos(0.4)] as Rgb;
  const env = hairEnvironmentLight(tilted, T, N, [0.4, 0.3, 0.2], 0.3, { ...base, additionalAreaRoughness: 0 });
  const direct = hairDirectLight([0, 0, 1], tilted, T, N, [0.4, 0.3, 0.2], 0.3,
    { ...base, intensityR: base.envR, intensityTRT: base.envTRT, scatter: base.envMultiScatter });
  close(env.specular, direct.specular.map(v => 2 * Math.PI * v), 9);
  // AdditionalAreaRoughness widens the lobes: a lower peak over a sweep of views along the strand, and more light far from it.
  const sweep = (area: number) => Array.from({ length: 121 }, (_, i) => {
    const a = (i - 60) / 60 * 1.2;
    return hairEnvironmentLight([0, Math.sin(a), Math.cos(a)], T, N, [0, 0, 0], 0.2, { ...base, additionalAreaRoughness: area }).specular[0];
  });
  const widened = sweep(0.1), sharp = sweep(0);
  expect(Math.max(...widened)).toBeLessThan(Math.max(...sharp));
  expect(widened[120]!).toBeGreaterThan(sharp[120]!);
});
