/**
 * Pure model of the REDengine 2.31 `base\materials\hair.mt` colour and coverage
 * arithmetic, plus the sqrt-encoded G-buffer blend used by post-G-buffer mesh
 * decals such as the saved brow. No Three.js, DOM or network dependency.
 *
 * Grades (see knowledge/hair-shading.md):
 * - [source] compiled 2.31 pixel programs: profile lookup by truncated index,
 *   luminance-switched overlay, vertex-red shadow term, cutoff remap, roughness
 *   and sqrt(albedo) G-buffer writes.
 * - [hypothesis] the CPU bake of CHairProfile stops into the per-profile rows:
 *   sample k at t = k/(N-1), stops interpolated in stored 8-bit space and then
 *   decoded from sRGB. The encoding is an explicit option, not a silent choice.
 */

export type Rgb = [number, number, number];
export type ProfileStop = { value: number; color: readonly [number, number, number] };
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

/** Interpolate stored 8-bit stop colours at t; clamps outside the first/last stop. */
export function sampleStopsEncoded(stops: readonly ProfileStop[], t: number): Rgb {
  const sorted = sortStops(stops);
  if (!sorted.length) throw Error("A hair gradient needs at least one stop");
  const first = sorted[0]!, last = sorted.at(-1)!;
  if (t < first.value) return [...first.color] as Rgb;
  if (t >= last.value) return [...last.color] as Rgb;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!, b = sorted[i]!;
    if (t > b.value) continue;
    if (t === b.value) {
      // Duplicate positions: the last entry at this position wins.
      let j = i; while (j + 1 < sorted.length && sorted[j + 1]!.value === t) j++;
      return [...sorted[j]!.color] as Rgb;
    }
    const f = (t - a.value) / (b.value - a.value);
    return a.color.map((c, k) => c + (b.color[k]! - c) * f) as Rgb;
  }
  return [...last.color] as Rgb;
}

/** Bake N linear samples (N×3 floats), mirroring the per-profile row read by the compiled shader. */
export function bakeHairProfile(stops: readonly ProfileStop[], sampleCount: number,
                                encoding: ProfileEncoding = "srgb-decoded"): Float32Array {
  if (!Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount > 1024)
    throw Error("Hair profile sampleCount must be an integer from 2 to 1024");
  const out = new Float32Array(sampleCount * 3);
  for (let k = 0; k < sampleCount; k++) {
    const encoded = sampleStopsEncoded(stops, k / (sampleCount - 1));
    for (let c = 0; c < 3; c++)
      out[k * 3 + c] = encoding === "srgb-decoded" ? srgbToLinear(encoded[c]!) : encoded[c]! / 255;
  }
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
 * programs) whose values come from engine options at runtime (GameOptions `Editor/Characters/Hair/...`).
 * They are NOT in any resource. Field → register → option (the option names are strings in the 2.31
 * executable; the register pairing follows each register's role in the program [hypothesis]):
 *   shiftR cb0[16].x AlphaShifts/R · shiftTRT cb0[16].z AlphaShifts/TRT ·
 *   specularRandomMin/Max cb0[17].z/w SpecularRandom_Min/Max · roughnessFactor cb0[17].x RoughnessFactor ·
 *   albedoMultiplier cb0[17].y AlbedoMultiplier · intensityR/intensityTRT/scatter cb0[12].x/z/w
 *   GlobalLight/{R,TRT,MultiScatter} · wrap/kajiyaMix/scatterMask cb0[18].x/y/w
 *   MultiScatter/{Wrap,DiffuseScatterFactor,Mask_Intensity} · specularWrap/specularMask cb0[19].y/z
 *   Specular/{Wrap,Mask_Intensity} · trtNpScale/trtNpBias cb0[20].x/y TRT_Params/{EXP_SCALE,EXP_BIAS} ·
 *   envMultiScatter EnvProbe/MultiScatter (environment path not decoded; the preview scales its ambient
 *   diffuse by it).
 */
export interface HairLighting {
  readonly shiftR: number; readonly shiftTRT: number; readonly intensityR: number; readonly intensityTRT: number;
  readonly trtNpScale: number; readonly trtNpBias: number; readonly wrap: number; readonly kajiyaMix: number;
  readonly scatter: number; readonly albedoMultiplier: number; readonly scatterMask: number;
  readonly specularWrap: number; readonly specularMask: number; readonly roughnessFactor: number;
  readonly specularRandomMin: number; readonly specularRandomMax: number; readonly envMultiScatter: number;
}
/**
 * The 2.31 defaults of those options as listed by the "Vanilla" preset of Arkhe's Character Rendering
 * Editor (a CET tool targeting 2.31 that reads and writes these GameOptions) [community]; not yet
 * confirmed by our own runtime dump. Default for the preview.
 */
export const HAIR_LIGHTING_VANILLA: HairLighting = Object.freeze({
  shiftR: -0.083, shiftTRT: -0.5, intensityR: 0.3, intensityTRT: 0.8,
  trtNpScale: 1, trtNpBias: 1.5, wrap: 0.35, kajiyaMix: 0, scatter: 0.47, albedoMultiplier: 1,
  scatterMask: 1, specularWrap: 0.3, specularMask: 1, roughnessFactor: 1,
  specularRandomMin: -0.2, specularRandomMax: 0.2, envMultiScatter: 0.47,
});
/**
 * The published model's defaults (Karis, "Physically Based Hair Shading in Unreal", 2016), used before
 * the option values were known. Kept for comparison; the extra terms are set to leave them inert.
 */
export const HAIR_LIGHTING_KARIS: HairLighting = Object.freeze({
  shiftR: -0.07, shiftTRT: 0.14, intensityR: 1, intensityTRT: 1,
  trtNpScale: 17, trtNpBias: 16.78, wrap: 1, kajiyaMix: 0.33, scatter: 1, albedoMultiplier: 1,
  scatterMask: 0, specularWrap: 1, specularMask: 0, roughnessFactor: 1,
  specularRandomMin: 0, specularRandomMax: 0, envMultiScatter: 1,
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

/**
 * One directional light's response for a hair fibre, as the 2.31 deferred hair light computes it:
 * white R lobe + albedo-tinted TRT lobe (no TT in this path) + wrapped Kajiya "multiple scatter"
 * diffuse. T is the strand direction, N the stored normal, L/V unit vectors toward light/eye.
 * strandId (0..1) seeds the per-strand highlight shift; the fully lit case (shadow 1) is modelled.
 */
export function hairDirectLight(L: Readonly<Rgb>, V: Readonly<Rgb>, T: Readonly<Rgb>, N: Readonly<Rgb>,
                                albedo: Readonly<Rgb>, roughness: number,
                                lighting: HairLighting = HAIR_LIGHTING_VANILLA, strandId = 0): { specular: Rgb; diffuse: Rgb } {
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
  // R: shifted by angle (shiftR + random), width (r/RoughnessFactor)^2 * sqrt(2) * cosHalfPhi,
  // Np = cosHalfPhi / 4, Fresnel at sqrt(0.5 + 0.5 V.L).
  const alpha = lighting.shiftR + random, rr = r / lighting.roughnessFactor;
  const shift = 2 * Math.sin(alpha) * (Math.cos(alpha) * cosHalfPhi * Math.sqrt(Math.max(0, 1 - sinV * sinV)) + Math.sin(alpha) * sinV);
  const mpR = gaussian(rr * rr * Math.SQRT2 * cosHalfPhi, sinL + sinV - shift);
  const specR = specularGate * lighting.intensityR * mpR * 0.25 * cosHalfPhi * schlick(Math.sqrt(saturate(0.5 + 0.5 * dot3(L, V))));
  // TRT: width 2r^2 at (sinL + sinV - random - shiftTRT), Fp = (1-f)^2 f with f at cosThetaD/2,
  // Tp = C^(0.8/cosThetaD), Np = exp(EXP_SCALE cosPhi - EXP_BIAS).
  const mpTRT = gaussian(2 * r * r, sinL + sinV - random - lighting.shiftTRT);
  const f = schlick(0.5 * cosThetaD), fp = (1 - f) ** 2 * f;
  const np = Math.exp(lighting.trtNpScale * cosPhi - lighting.trtNpBias);
  const specular = C.map(c => specR + mpTRT * fp * np * c ** (0.8 / cosThetaD) * lighting.intensityTRT) as Rgb;
  // Multiple-scatter diffuse: (1/pi) * lerp(wrapped, 1 - |sinL|, DiffuseScatterFactor)
  //   * clamp(wrapped + 1 - Mask_Intensity) * MultiScatter * C   (fully lit: tint term = 1).
  const wrapped = wrapTerm(lighting.wrap), scatterGate = saturate(wrapped + 1 - lighting.scatterMask);
  const scatter = (wrapped + ((1 - Math.abs(sinL)) - wrapped) * lighting.kajiyaMix) / Math.PI * scatterGate * lighting.scatter;
  return { specular, diffuse: C.map(c => c * scatter) as Rgb };
}
