/**
 * Pure model of the REDengine 2.31 `base\materials\hair.mt` colour and coverage
 * arithmetic, plus the sqrt-encoded G-buffer blend used by post-G-buffer mesh
 * decals such as the saved brow. No Three.js, DOM or network dependency.
 *
 * Grades (see knowledge/hair-shading.md):
 * - [source] compiled 2.31 pixel programs: profile lookup by truncated index,
 *   luminance-switched overlay, vertex-red shadow term, cutoff remap, roughness
 *   and sqrt(albedo) G-buffer writes.
 * - [observed] the CPU bake of CHairProfile stops into the per-profile rows, read
 *   from the 2.31 executable (research/materials/shader-hair.md §7): stops sorted
 *   and rescaled to span 0 to 1, sample k at t = k/N, stored 8-bit colours
 *   interpolated and truncated to a byte, then decoded with the exact sRGB EOTF.
 * - [observed] the hair option defaults (`HAIR_LIGHTING_VANILLA`), read from the
 *   executable's option table (shader-hair.md §6.4).
 */

export type Rgb = [number, number, number];
export type ProfileStop = { value: number; color: readonly [number, number, number] };
/**
 * How a baked byte becomes the texel the shader reads. The game decodes it with the sRGB EOTF [observed]; `stored-linear`
 * (byte / 255) is no longer a live hypothesis and is kept only so evidence captures can name the encoding they used.
 */
export type ProfileEncoding = "srgb-decoded" | "stored-linear";

/** Rec.601 weights used by the compiled base-colour pass to choose the overlay branch. */
export const HAIR_OVERLAY_LUMA: Readonly<Rgb> = [0.3, 0.59, 0.11];

/** Scalar defaults serialized in the installed 2.31 hair.mt (resource read 2026-09-25). */
export const HAIR_TEMPLATE_DEFAULTS = Object.freeze({
  alphaCutoff: 0.33, roughnessScale: 1, roughnessBias: 0, shadowStrength: 0,
  shadowMin: -0.5, shadowMax: 1, shadowRoughness: 1, flowStrength: 1, scattering: 0.16,
});
export type HairMaterialParameters = { -readonly [K in keyof typeof HAIR_TEMPLATE_DEFAULTS]: number };

/** Overrides serialized in vanilla eyelashes__default.mi (inherited by Soft Natural lashes). */
export const EYELASH_DEFAULT_MI_OVERRIDES: Readonly<Partial<HairMaterialParameters>> = Object.freeze({
  alphaCutoff: 0, scattering: 0, shadowMin: 0, shadowMax: 0, shadowRoughness: 0,
  roughnessBias: 1, roughnessScale: 0,
});

const PARAMETER_RANGES: Record<keyof HairMaterialParameters, [number, number]> = {
  alphaCutoff: [0, 1], roughnessScale: [0, 1], roughnessBias: [0, 1], shadowStrength: [0, 1],
  shadowMin: [-2, 2], shadowMax: [-2, 2], shadowRoughness: [0, 1], flowStrength: [0, 1], scattering: [0, 1],
};

/** Apply material-instance overrides over the template defaults; reject unknown or out-of-range values. */
export function resolveHairMaterial(overrides: unknown = {}): HairMaterialParameters {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides))
    throw Error("Hair material overrides must be an object");
  const result: HairMaterialParameters = { ...HAIR_TEMPLATE_DEFAULTS };
  for (const [key, value] of Object.entries(overrides)) {
    const range = PARAMETER_RANGES[key as keyof HairMaterialParameters];
    if (!range) throw Error(`Unknown hair material parameter: ${key}`);
    if (typeof value !== "number" || !Number.isFinite(value) || value < range[0] || value > range[1])
      throw Error(`Hair material parameter ${key} is out of range`);
    result[key as keyof HairMaterialParameters] = value;
  }
  return result;
}

/** `hair.mt` parameter names as the material instances and template store them. */
export const HAIR_MATERIAL_PARAMETER_NAMES: Readonly<Record<string, keyof HairMaterialParameters>> = Object.freeze({
  AlphaCutoff: "alphaCutoff", RoughnessScale: "roughnessScale", RoughnessBias: "roughnessBias", ShadowStrength: "shadowStrength",
  ShadowMin: "shadowMin", ShadowMax: "shadowMax", ShadowRoughness: "shadowRoughness", FlowStrength: "flowStrength", Scattering: "scattering",
});

/** Effective `hair.mt` scalars (instance chain, then template defaults) → the model's parameters, clamped to their ranges. */
export function hairMaterialFromScalars(scalars: Readonly<Record<string, number>>): HairMaterialParameters {
  const overrides: Partial<HairMaterialParameters> = {};
  for (const [name, key] of Object.entries(HAIR_MATERIAL_PARAMETER_NAMES)) {
    const value = scalars[name];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const [low, high] = PARAMETER_RANGES[key];
    overrides[key] = Math.min(high, Math.max(low, value));
  }
  return resolveHairMaterial(overrides);
}

export function srgbToLinear(value8: number): number {
  const c = value8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb8(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
}

/** Sort by position (stable); among equal positions the later entry wins, as the source lists are unsorted. */
export function sortStops(stops: readonly ProfileStop[]): ProfileStop[] {
  return stops.map((stop, index) => ({ stop, index }))
    .sort((a, b) => a.stop.value - b.stop.value || a.index - b.index).map(entry => entry.stop);
}

/**
 * The stops as the game holds them after loading a profile [observed, shader-hair.md §7]: sorted by position, then rescaled so the
 * first sits at 0 and the last at 1 (`v' = (v − v_first) / (v_last − v_first)`), or spaced evenly (`i/(n−1)`) when the stored range is
 * under 0.001. The game's sort is not stable; among equal positions this keeps the source order, so the later entry wins. A single stop
 * (a zero range the game would divide by) sits at 0 and colours the whole row.
 */
export function rescaledStops(stops: readonly ProfileStop[]): ProfileStop[] {
  const sorted = sortStops(stops);
  if (!sorted.length) throw Error("A hair gradient needs at least one stop");
  if (sorted.length === 1) return [{ value: 0, color: sorted[0]!.color }];
  const first = sorted[0]!.value, range = sorted.at(-1)!.value - first;
  return sorted.map((stop, i) => ({ value: range < 0.001 ? i / (sorted.length - 1) : (stop.value - first) / range, color: stop.color }));
}

/**
 * The segment the bake interpolates at `t` over rescaled stops: the last stop `i` with `v'_i ≤ t` and the fraction toward the next one
 * (`f = 0` at or past the last stop, and before the first). A zero-width segment is never chosen, so the later of two equal stops wins.
 */
function segmentAt(stops: readonly ProfileStop[], t: number): { a: ProfileStop; b: ProfileStop; f: number } {
  let i = 0;
  while (i + 1 < stops.length && stops[i + 1]!.value <= t) i++;
  const a = stops[i]!, b = stops[i + 1];
  if (!b || t <= a.value) return { a, b: a, f: 0 };
  return { a, b, f: (t - a.value) / (b.value - a.value) };
}

/**
 * Stored 8-bit stop colours interpolated at `t` along the profile as the game rescales it (`rescaledStops`), without the bake's
 * truncation: for display (a raw profile colour). Clamps outside 0 to 1.
 */
export function sampleStopsEncoded(stops: readonly ProfileStop[], t: number): Rgb {
  const { a, b, f } = segmentAt(rescaledStops(stops), Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)));
  return a.color.map((c, k) => c + (b.color[k]! - c) * f) as Rgb;
}

/**
 * The profile's stored bytes as the game bakes them [observed, shader-hair.md §7]: sample `k` at `t = k/N` (not `k/(N−1)`: the last
 * sample sits at `(N−1)/N`, just short of a stop at 1), interpolate the stored 8-bit colours, clamp to 0–255 and truncate to a byte.
 */
export function bakeHairProfileBytes(stops: readonly ProfileStop[], sampleCount: number): Uint8Array {
  if (!Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount > 1024)
    throw Error("Hair profile sampleCount must be an integer from 2 to 1024");
  const rescaled = rescaledStops(stops);
  const out = new Uint8Array(sampleCount * 3);
  for (let k = 0; k < sampleCount; k++) {
    const { a, b, f } = segmentAt(rescaled, k / sampleCount);
    for (let c = 0; c < 3; c++) out[k * 3 + c] = Math.trunc(Math.min(255, Math.max(0, a.color[c]! * (1 - f) + b.color[c]! * f)));
  }
  return out;
}

/**
 * Bake N linear samples (N×3 floats), the per-profile row the compiled shader reads: `bakeHairProfileBytes`, then each byte decoded
 * with the sRGB EOTF (the game's 256-entry table) [observed].
 */
export function bakeHairProfile(stops: readonly ProfileStop[], sampleCount: number,
                                encoding: ProfileEncoding = "srgb-decoded"): Float32Array {
  const bytes = bakeHairProfileBytes(stops, sampleCount);
  const out = new Float32Array(sampleCount * 3);
  for (let i = 0; i < bytes.length; i++) out[i] = encoding === "srgb-decoded" ? srgbToLinear(bytes[i]!) : bytes[i]! / 255;
  return out;
}

/** HLSL `uint((N-1) * v)`: truncation, never interpolation between samples. */
export function profileIndex(sample: number, sampleCount: number): number {
  if (!Number.isFinite(sample) || sample <= 0) return 0;
  return Math.min(sampleCount - 1, Math.floor((sampleCount - 1) * sample));
}

export function bakedSample(baked: Float32Array, index: number): Rgb {
  return [baked[index * 3]!, baked[index * 3 + 1]!, baked[index * 3 + 2]!];
}

/** Luminance-switched overlay: root-to-tip is the base layer, the strand-ID colour the blend layer. */
export function overlayHairColor(rootTip: Readonly<Rgb>, id: Readonly<Rgb>): Rgb {
  const luma = rootTip[0] * HAIR_OVERLAY_LUMA[0] + rootTip[1] * HAIR_OVERLAY_LUMA[1] + rootTip[2] * HAIR_OVERLAY_LUMA[2];
  return rootTip.map((base, c) => luma < 0.5 ? 2 * id[c]! * base : 1 - 2 * (1 - id[c]!) * (1 - base)) as Rgb;
}

const saturate = (x: number) => Number.isNaN(x) ? 0 : Math.min(1, Math.max(0, x));

/** smoothstep(ShadowMin, ShadowMax, 1 - vertexColour.r); a zero-width range saturates like fast HLSL division. */
export function hairShadowFactor(vertexRed: number, shadowMin: number, shadowMax: number): number {
  const numerator = 1 - vertexRed - shadowMin, width = shadowMax - shadowMin;
  const t = width === 0 ? (numerator > 0 ? 1 : 0) : saturate(numerator / width);
  return t * t * (3 - 2 * t);
}

export function applyHairShadow(color: Readonly<Rgb>, factor: number, strength: number): Rgb {
  return color.map(c => c + (saturate(c * factor) - c) * strength) as Rgb;
}

/** Colour written for one fragment before the alpha-weighted layer average; the resolve takes |rgb|. */
export function hairFragmentColor(rootTip: Readonly<Rgb>, id: Readonly<Rgb>, vertexRed: number,
                                  material: Pick<HairMaterialParameters, "shadowMin" | "shadowMax" | "shadowStrength">): Rgb {
  const shadow = hairShadowFactor(vertexRed, material.shadowMin, material.shadowMax);
  return applyHairShadow(overlayHairColor(rootTip, id), shadow, material.shadowStrength).map(Math.abs) as Rgb;
}

/** Albedo for texture samples through a baked two-row profile (ID row, root-to-tip row). */
export function hairAlbedo(idRow: Float32Array, rootRow: Float32Array, sampleCount: number,
                           idSample: number, gradientSample: number, vertexRed: number,
                           material: Pick<HairMaterialParameters, "shadowMin" | "shadowMax" | "shadowStrength">): Rgb {
  return hairFragmentColor(bakedSample(rootRow, profileIndex(gradientSample, sampleCount)),
    bakedSample(idRow, profileIndex(idSample, sampleCount)), vertexRed, material);
}

/** Remapped alpha; the game keeps a fragment with dithered probability ~= this value (TAA-resolved). */
export function hairCoverage(strandAlpha: number, alphaCutoff: number): number {
  if (alphaCutoff >= 1) return 0;
  return saturate(Math.max(strandAlpha - alphaCutoff, 0) / (1 - alphaCutoff));
}

/**
 * The 2.31 hair dither, identical in `hair_alpha_accum` and `hair_gbuffer_solid` apart from its
 * offset. The threshold depends only on the pixel centre (x, y) and a per-frame counter:
 *   t = step · (5·frac(0.2·(x + 2y − 1.5 + frame)) + frac(2.4084506·x + 3.2535212·y)) + offset
 * and a fragment survives when its remapped alpha exceeds t [source]. Because every layer in a
 * pixel meets the same t, the layers' coverage is nested, not independent: a pixel is covered
 * when its most opaque layer survives. t is close to uniform on [offset, offset + 5·step), so the
 * five-frame cycle (resolved by TAA) covers `hairResolvedCoverage(max layer alpha)` of the pixel.
 */
export const HAIR_DITHER = Object.freeze({
  step: 0.16535948,
  /** `hair_gbuffer_solid`, the pass that writes the visible G-buffer. */
  offset: 0.008843138,
  /** `hair_alpha_accum` (k-buffer insertion): 2/255. */
  accumOffset: 2 / 255,
});

const fract = (x: number) => x - Math.floor(x);

/** Per-pixel, per-frame dither threshold (pixel centres at integer + 0.5, as SV_Position). */
export function hairDitherThreshold(x: number, y: number, frame: number, offset = HAIR_DITHER.offset): number {
  const coarse = fract(0.2 * (x + 2 * y - 1.5 + frame)), fine = fract(2.4084506 * x + 3.2535212 * y);
  return HAIR_DITHER.step * (5 * coarse + fine) + offset;
}

/** Time-resolved coverage of one layer: the fraction of the dither range its alpha exceeds. Opaque from ~0.835. */
export function hairResolvedCoverage(alpha: number): number {
  return saturate((alpha - HAIR_DITHER.offset) / (5 * HAIR_DITHER.step));
}

/** Time-resolved coverage of a pixel crossed by several layers: the shared threshold makes it the most opaque layer's. */
export function hairPixelCoverage(layerAlphas: readonly number[]): number {
  return hairResolvedCoverage(layerAlphas.reduce((a, b) => Math.max(a, b), 0));
}

/** G-buffer roughness: ID-scaled roughness pulled toward ShadowRoughness by the shadow term. */
export function hairRoughness(idSample: number, shadowFactor: number,
                              material: Pick<HairMaterialParameters, "roughnessScale" | "roughnessBias" | "shadowRoughness" | "shadowStrength">): number {
  const rough = saturate(material.roughnessScale * idSample + material.roughnessBias);
  return rough + (material.shadowRoughness - rough) * (1 - shadowFactor) * material.shadowStrength;
}

/** Engine decal result: SrcAlpha blend of sqrt(colour) over sqrt(underlying albedo), decoded by squaring. */
export function gbufferDecalAlbedo(decal: Readonly<Rgb>, coverage: number, underlay: Readonly<Rgb>): Rgb {
  const a = saturate(coverage);
  return decal.map((c, k) => (a * Math.sqrt(Math.max(c, 0)) + (1 - a) * Math.sqrt(Math.max(underlay[k]!, 0))) ** 2) as Rgb;
}

/**
 * Colour/alpha for an ordinary linear-space "over" blend that reproduces
 * gbufferDecalAlbedo over the given underlay (exactly per channel when the
 * underlay is right). Alpha only grows: it is the largest per-channel value
 * that keeps every solved colour channel non-negative.
 */
export function linearEquivalentDecal(decal: Readonly<Rgb>, coverage: number, underlay: Readonly<Rgb>): { color: Rgb; alpha: number } {
  const a = saturate(coverage);
  const target = gbufferDecalAlbedo(decal, a, underlay);
  let alpha = a;
  for (let k = 0; k < 3; k++)
    if (underlay[k]! - decal[k]! > 1e-6) alpha = Math.max(alpha, (underlay[k]! - target[k]!) / (underlay[k]! - decal[k]!));
  alpha = Math.min(1, alpha);
  if (alpha <= 0) return { color: [...decal] as Rgb, alpha: 0 };
  const color = target.map((t, k) => Math.max(0, (t - (1 - alpha) * underlay[k]!) / alpha)) as Rgb;
  return { color, alpha };
}

/**
 * Registers of the 2.31 deferred hair light (`m_shaderLightsComputeGlobal*_Clustered_*1****` compute
 * programs) and of the ambient composite's Hair branch, whose values come from engine options at runtime
 * (GameOptions `Editor/Characters/Hair/...`). They are NOT in any resource, and no shipped
 * `config_override.ini` changes them. Field → register → option, read from the executable's option table
 * and the copy into `cb0` [observed, shader-hair.md §6.4]:
 *   shiftR cb0[16].x AlphaShifts/R · shiftTRT cb0[16].z AlphaShifts/TRT ·
 *   specularRandomMin/Max cb0[17].z/w SpecularRandom_Min/Max · roughnessFactor cb0[17].x RoughnessFactor ·
 *   albedoMultiplier cb0[17].y AlbedoMultiplier · intensityR/intensityTRT/scatter cb0[12].x/z/w
 *   GlobalLight/{R,TRT,MultiScatter} · localR/localTRT/localScatter cb0[13].x/z/w LocalLight/{R,TRT,MultiScatter} ·
 *   envR/envTRT/envMultiScatter cb0[14].x/z/w EnvProbe/{R,TRT,MultiScatter} (the environment path, §6.5) ·
 *   wrap/kajiyaMix/scatterMask cb0[18].x/y/w MultiScatter/{Wrap,DiffuseScatterFactor,Mask_Intensity} ·
 *   specularWrap/specularMask cb0[19].y/z Specular/{Wrap,Mask_Intensity} · additionalAreaRoughness cb0[19].x
 *   AdditionalAreaRoughness (widens both environment lobes) · trtNpScale/trtNpBias cb0[20].x/y TRT_Params/{EXP_SCALE,EXP_BIAS}.
 */
export interface HairLighting {
  readonly shiftR: number; readonly shiftTRT: number; readonly intensityR: number; readonly intensityTRT: number;
  readonly trtNpScale: number; readonly trtNpBias: number; readonly wrap: number; readonly kajiyaMix: number;
  readonly scatter: number; readonly albedoMultiplier: number; readonly scatterMask: number;
  readonly specularWrap: number; readonly specularMask: number; readonly roughnessFactor: number;
  readonly specularRandomMin: number; readonly specularRandomMax: number;
  readonly localR: number; readonly localTRT: number; readonly localScatter: number;
  readonly envR: number; readonly envTRT: number; readonly envMultiScatter: number; readonly additionalAreaRoughness: number;
}
/**
 * The 2.31 executable's defaults of those options [observed, shader-hair.md §6.4]. They equal the "Vanilla" preset of Arkhe's
 * Character Rendering Editor for every option it lists. A CET preset can still change them in a session (a capture must record them).
 * Default for the preview.
 */
export const HAIR_LIGHTING_VANILLA: HairLighting = Object.freeze({
  shiftR: -0.083, shiftTRT: -0.5, intensityR: 0.3, intensityTRT: 0.8,
  trtNpScale: 1, trtNpBias: 1.5, wrap: 0.35, kajiyaMix: 0, scatter: 0.47, albedoMultiplier: 1,
  scatterMask: 1, specularWrap: 0.3, specularMask: 1, roughnessFactor: 1,
  specularRandomMin: -0.2, specularRandomMax: 0.2,
  localR: 0.35, localTRT: 0.8, localScatter: 0.47,
  envR: 0.3, envTRT: 0.8, envMultiScatter: 0.47, additionalAreaRoughness: 0.1,
});
/**
 * The published model's defaults (Karis, "Physically Based Hair Shading in Unreal", 2016), used before
 * the option values were known. Kept for comparison; the extra terms are set to leave them inert.
 */
export const HAIR_LIGHTING_KARIS: HairLighting = Object.freeze({
  shiftR: -0.07, shiftTRT: 0.14, intensityR: 1, intensityTRT: 1,
  trtNpScale: 17, trtNpBias: 16.78, wrap: 1, kajiyaMix: 0.33, scatter: 1, albedoMultiplier: 1,
  scatterMask: 0, specularWrap: 1, specularMask: 0, roughnessFactor: 1,
  specularRandomMin: 0, specularRandomMax: 0,
  localR: 1, localTRT: 1, localScatter: 1,
  envR: 1, envTRT: 1, envMultiScatter: 1, additionalAreaRoughness: 0,
});

/** Per-strand random value the light hashes from the stored Strand_ID (G-buffer 2.w, in 0..1). */
export function hairStrandRandom(strandId: number): number {
  const fract = (x: number) => x - Math.floor(x);
  return fract(fract(strandId * 0.06711056 + strandId * 0.00583715) * 52.982918);
}

const dot3 = (a: Readonly<Rgb>, b: Readonly<Rgb>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Readonly<Rgb>): Rgb => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const gaussian = (b: number, x: number) => Math.exp(-0.5 * x * x / (b * b)) / (Math.sqrt(2 * Math.PI) * b);
const schlick = (cos: number) => 0.0466 + 0.9535 * (1 - cos) ** 5;

/** The three intensities one hair light path scales its lobes by (R, TRT, multiple-scatter diffuse). */
export type HairIntensities = { readonly r: number; readonly trt: number; readonly scatter: number };
/** The intensities of each path: the sun (`GlobalLight`), local lights (`LocalLight`) and the environment (`EnvProbe`) [observed, §6.4]. */
export const hairIntensities = (lighting: HairLighting, path: "global" | "local" | "env"): HairIntensities =>
  path === "global" ? { r: lighting.intensityR, trt: lighting.intensityTRT, scatter: lighting.scatter }
    : path === "local" ? { r: lighting.localR, trt: lighting.localTRT, scatter: lighting.localScatter }
    : { r: lighting.envR, trt: lighting.envTRT, scatter: lighting.envMultiScatter };

/**
 * The hair model for one light direction, as both light programs and the ambient composite evaluate it: white R lobe +
 * albedo-tinted TRT lobe (no TT) + wrapped Kajiya "multiple scatter" diffuse. `area` widens both lobes (the composite's
 * `AdditionalAreaRoughness`; 0 for real lights).
 */
function hairLobes(L: Readonly<Rgb>, V: Readonly<Rgb>, T: Readonly<Rgb>, N: Readonly<Rgb>, albedo: Readonly<Rgb>, roughness: number,
                   lighting: HairLighting, strandId: number, intensity: HairIntensities, area: number): { specular: Rgb; diffuse: Rgb } {
  const r = Math.min(1, Math.max(0.04, roughness));
  const C = albedo.map(c => Math.min(1, Math.max(1e-5, c * lighting.albedoMultiplier))) as Rgb;
  const sinL = dot3(T, L), sinV = dot3(T, V), NdotL = dot3(N, L);
  const cosThetaD = Math.cos(Math.abs(Math.asin(Math.max(-1, Math.min(1, sinV))) - Math.asin(Math.max(-1, Math.min(1, sinL)))) / 2);
  const lp = unit(L.map((l, k) => l - sinL * T[k]!) as Rgb), vp = unit(V.map((v, k) => v - sinV * T[k]!) as Rgb);
  const cosPhi = dot3(lp, vp), cosHalfPhi = Math.sqrt(saturate(0.5 + 0.5 * cosPhi));
  const random = lighting.specularRandomMin + hairStrandRandom(strandId) * (lighting.specularRandomMax - lighting.specularRandomMin);
  // Wrapped N.L terms, each gated by clamp(wrapped + 1 - Mask_Intensity).
  const wrapTerm = (w: number) => saturate((NdotL + w) / (1 + w) ** 2);
  const specularGate = saturate(wrapTerm(lighting.specularWrap) + 1 - lighting.specularMask);
  // R: shifted by angle (shiftR + random), width sqrt(2) * ((r/RoughnessFactor)^2 * cosHalfPhi + area),
  // Np = cosHalfPhi / 4, Fresnel at sqrt(0.5 + 0.5 V.L).
  const alpha = lighting.shiftR + random, rr = r / lighting.roughnessFactor;
  const shift = 2 * Math.sin(alpha) * (Math.cos(alpha) * cosHalfPhi * Math.sqrt(Math.max(0, 1 - sinV * sinV)) + Math.sin(alpha) * sinV);
  const mpR = gaussian(Math.SQRT2 * (rr * rr * cosHalfPhi + area), sinL + sinV - shift);
  const specR = specularGate * intensity.r * mpR * 0.25 * cosHalfPhi * schlick(Math.sqrt(saturate(0.5 + 0.5 * dot3(L, V))));
  // TRT: width 2r^2 + area at (sinL + sinV - random - shiftTRT), Fp = (1-f)^2 f with f at cosThetaD/2,
  // Tp = C^(0.8/cosThetaD), Np = exp(EXP_SCALE cosPhi - EXP_BIAS).
  const mpTRT = gaussian(2 * r * r + area, sinL + sinV - random - lighting.shiftTRT);
  const f = schlick(0.5 * cosThetaD), fp = (1 - f) ** 2 * f;
  const np = Math.exp(lighting.trtNpScale * cosPhi - lighting.trtNpBias);
  const specular = C.map(c => specR + mpTRT * fp * np * c ** (0.8 / cosThetaD) * intensity.trt) as Rgb;
  // Multiple-scatter diffuse: (1/pi) * lerp(wrapped, 1 - |sinL|, DiffuseScatterFactor)
  //   * clamp(wrapped + 1 - Mask_Intensity) * MultiScatter * C   (fully lit: tint term = 1).
  const wrapped = wrapTerm(lighting.wrap), scatterGate = saturate(wrapped + 1 - lighting.scatterMask);
  const scatter = (wrapped + ((1 - Math.abs(sinL)) - wrapped) * lighting.kajiyaMix) / Math.PI * scatterGate * intensity.scatter;
  return { specular, diffuse: C.map(c => c * scatter) as Rgb };
}

/**
 * One light's response for a hair fibre, as the 2.31 deferred hair light computes it (the sun path's `GlobalLight`
 * intensities by default; `path: "local"` for the tiled local-light loop, which evaluates the same model with `LocalLight`).
 * T is the strand direction, N the stored normal, L/V unit vectors toward light/eye. strandId (0..1) seeds the per-strand
 * highlight shift; the fully lit case (shadow 1) is modelled.
 */
export function hairDirectLight(L: Readonly<Rgb>, V: Readonly<Rgb>, T: Readonly<Rgb>, N: Readonly<Rgb>,
                                albedo: Readonly<Rgb>, roughness: number,
                                lighting: HairLighting = HAIR_LIGHTING_VANILLA, strandId = 0, path: "global" | "local" = "global"): { specular: Rgb; diffuse: Rgb } {
  return hairLobes(L, V, T, N, albedo, roughness, lighting, strandId, hairIntensities(lighting, path), 0);
}

/**
 * The ambient composite's Hair branch [observed, shader-hair.md §6.5], per unit of the diffuse irradiance `E` (the value that lights a
 * Standard pixel as `albedo × E`; in the `NoEnvProbes` lighting-integrate program, the global six-colour ambient cube taken along `L_e`). It evaluates the hair model once for a virtual light along the view with its along-strand
 * part removed, `L_e = normalize(V − (V·T)T)` (so `sinθL = 0`, `cosφ = 1`), with the `EnvProbe` intensities and both lobes widened by
 * `AdditionalAreaRoughness`, and scales it by `2π·E`. The composite multiplies the diffuse by the albedo once more, so ambient diffuse
 * carries the albedo twice (`2·E·EnvMS·C·w²·albedo`); the R and TRT lobes are coloured by the irradiance, not by a reflection.
 */
export function hairEnvironmentLight(V: Readonly<Rgb>, T: Readonly<Rgb>, N: Readonly<Rgb>, albedo: Readonly<Rgb>, roughness: number,
                                     lighting: HairLighting = HAIR_LIGHTING_VANILLA, strandId = 0): { specular: Rgb; diffuse: Rgb } {
  const sinV = dot3(T, V);
  const Le = unit(V.map((v, k) => v - sinV * T[k]!) as Rgb);
  const model = hairLobes(Le, V, T, N, albedo, roughness, lighting, strandId, hairIntensities(lighting, "env"), lighting.additionalAreaRoughness);
  return { specular: model.specular.map(c => 2 * Math.PI * c) as Rgb, diffuse: model.diffuse.map((c, k) => 2 * Math.PI * c * albedo[k]!) as Rgb };
}
