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
