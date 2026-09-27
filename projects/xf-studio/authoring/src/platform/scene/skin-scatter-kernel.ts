/**
 * The game's skin subsurface-scattering kernel (research/materials/shader-skin.md §6.3.2), as a pure module: no Three, no GPU.
 *
 * The engine builds one kernel row per skin profile on the CPU (2.31 `0xae35f4`, with `profile` at `0xae389c` and `gaussian` at
 * `0xae39b0`) whenever the profile list changes, and the two blur passes read it (§6.3.1). This module reproduces that builder and
 * the table the passes read: per slot, the strength `P` (the combine's lerp weight, the profile's sRGB-decoded `diffuse`) and the
 * `n` stored entries of the kernel for a quality, each an RGB weight and an offset. The builder is Jimenez et al.'s published
 * separable-SSS reference kernel (`calculateKernel`, exponent 2) over d'Eon and Luebke's skin profile without its narrowest term, as
 * the game's is; it is written here from the decoded routine (§6.3.2), and the credits carry that algorithm's notice.
 *
 * Differences from the reference that the game makes, and this module keeps: colour enters only through `falloff`; the strength is not
 * baked into the kernel (the combine applies it once); every offset carries `blurSize` (so it scales the radius and nothing else).
 */

export type Rgb = readonly [number, number, number];
/** The subsurface quality setting: the game's 11-, 17- and 25-sample kernels (`SubsurfaceScatteringQuality` 0, 1, 2). */
export type ScatterQuality = "low" | "medium" | "high";
/** Stored entries per quality: the centre and the positive offsets (`n`), so a pass takes `2n − 1` taps. */
export const SCATTER_ENTRIES: Readonly<Record<ScatterQuality, number>> = Object.freeze({ low: 6, medium: 9, high: 13 });
/** The largest entry count, the width of one slot's row in the passes' uniform array. */
export const SCATTER_MAX_ENTRIES = SCATTER_ENTRIES.high;
/** The engine keeps eight profile slots per frame (the 3-bit slot, the 8-row tables). */
export const SCATTER_SLOTS = 8;

/** One kernel entry: RGB weight and offset (in the profile's units, before any screen scale). */
export type KernelEntry = { weight: Rgb; offset: number };
/** A skin profile's fields that reach the scatter (`CSkinProfile`: colours as stored 8-bit sRGB). */
export type ScatterProfile = { blurSize: number; diffuse: readonly number[]; falloff: readonly number[] };

/** The engine's 256-entry sRGB-to-linear table (built at `0xf55d0` from 0.04045, 1/12.92, 1/1.055 and 2.4), for one byte. */
export const srgbByteToLinear = (byte: number) => {
  const c = Math.min(255, Math.max(0, Math.round(byte))) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The profile's strength `P`: `srgb(diffuse)` clamped to [0, 1] (kernel table column 0). */
export const scatterStrength = (profile: Pick<ScatterProfile, "diffuse">): [number, number, number] =>
  [0, 1, 2].map(k => clamp(srgbByteToLinear(profile.diffuse[k] ?? 255), 0, 1)) as [number, number, number];
/** The profile's per-channel width: `srgb(falloff)` clamped to [0.009, 1] (kernel table column 1). */
export const scatterFalloff = (profile: Pick<ScatterProfile, "falloff">): [number, number, number] =>
  [0, 1, 2].map(k => clamp(srgbByteToLinear(profile.falloff[k] ?? 255), 0.009, 1)) as [number, number, number];

/** `gaussian(v, r)` per channel: `exp(−(r / (falloff + 0.001))² / (2v)) / (2πv)`. */
function gaussian(variance: number, r: number, falloff: Rgb): [number, number, number] {
  return [0, 1, 2].map(k => {
    const rr = r / (falloff[k]! + 0.001);
    return Math.exp(-(rr * rr) / (2 * variance)) / (2 * Math.PI * variance);
  }) as [number, number, number];
}
/** `profile(r)`: d'Eon and Luebke's skin fit without its narrowest Gaussian, with that fit's red weights for all three channels. */
const PROFILE_TERMS: readonly (readonly [number, number])[] = [[0.100, 0.0484], [0.118, 0.187], [0.113, 0.567], [0.358, 1.99], [0.078, 7.41]];
function profileAt(r: number, falloff: Rgb): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (const [weight, variance] of PROFILE_TERMS) {
    const g = gaussian(variance, r, falloff);
    for (let k = 0; k < 3; k++) out[k] += weight * g[k]!;
  }
  return out;
}

/**
 * The whole symmetric kernel of `N = 2n − 1` samples, centre first, normalised so each channel sums to one over all `N`
 * (§6.3.2): offsets `sign(o)·o²/range` over `o` evenly spaced in [−range, range] (`range` 3 above 20 samples, else 2), each weighted
 * by the half-width of its interval times the profile there. Offsets are in the profile's units (before `blurSize`).
 */
export function fullKernel(entries: number, falloff: Rgb): KernelEntry[] {
  if (!Number.isInteger(entries) || entries < 2) throw Error(`A scatter kernel needs at least 2 entries, not ${entries}`);
  const count = 2 * entries - 1, range = count > 20 ? 3 : 2, step = 2 * range / (count - 1);
  const offsets = Array.from({ length: count }, (_, i) => { const o = -range + i * step; return Math.sign(o) * o * o / range; });
  const samples = offsets.map((x, i) => {
    const left = i > 0 ? Math.abs(x - offsets[i - 1]!) : 0, right = i < count - 1 ? Math.abs(x - offsets[i + 1]!) : 0;
    const area = (left + right) / 2, p = profileAt(x, falloff);
    return { weight: [area * p[0], area * p[1], area * p[2]] as [number, number, number], offset: x };
  });
  // The centre moves to the front, the others keep their order.
  const centre = samples.splice(entries - 1, 1)[0]!;
  samples.unshift(centre);
  const sums = [0, 1, 2].map(k => samples.reduce((sum, s) => sum + s.weight[k]!, 0));
  return samples.map(s => ({ weight: s.weight.map((w, k) => w / sums[k]!) as unknown as Rgb, offset: s.offset }));
}

/**
 * The `n` stored entries the passes read: the centre, then the `n − 1` positive offsets in increasing order (each pair of taps shares
 * one weight, so centre + 2 × the rest = 1 per channel), offsets in the profile's units.
 */
export function storedKernel(entries: number, falloff: Rgb): KernelEntry[] {
  const all = fullKernel(entries, falloff);
  return [all[0]!, ...all.slice(1).filter(s => s.offset > 0)];
}

/** One slot of the passes' table: the strength, and the stored entries with offsets scaled by `blurSize`. */
export type ScatterSlot = { strength: [number, number, number]; entries: KernelEntry[]; blurSize: number };

/** A profile's slot for a quality: `P` = sRGB-decoded `diffuse`, the kernel over its sRGB-decoded `falloff`, offsets × `blurSize`. */
export function scatterSlot(profile: ScatterProfile, quality: ScatterQuality): ScatterSlot {
  const blurSize = Number.isFinite(profile.blurSize) && profile.blurSize > 0 ? profile.blurSize : 0;
  const entries = storedKernel(SCATTER_ENTRIES[quality], scatterFalloff(profile))
    .map(entry => ({ weight: entry.weight, offset: entry.offset * blurSize }));
  return { strength: scatterStrength(profile), entries, blurSize };
}

/**
 * The passes' uniform table, packed: per slot one `vec4` of strength (RGB) and entry count (A), then `SCATTER_MAX_ENTRIES` `vec4`s of
 * weight (RGB) and offset (A), unused entries zero; slots without a profile are zero throughout (no scatter).
 */
export const SCATTER_ROW = 1 + SCATTER_MAX_ENTRIES;
export function packScatterTable(slots: readonly (ScatterSlot | null)[]): Float32Array {
  const table = new Float32Array(SCATTER_SLOTS * SCATTER_ROW * 4);
  slots.slice(0, SCATTER_SLOTS).forEach((slot, s) => {
    if (!slot) return;
    const base = s * SCATTER_ROW * 4;
    table.set([...slot.strength, slot.entries.length], base);
    slot.entries.forEach((entry, i) => table.set([...entry.weight, entry.offset], base + (1 + i) * 4));
  });
  return table;
}

/** A profile's identity for slot assignment: the fields the scatter reads (two chunks naming equal values share a slot). */
export const scatterProfileKey = (profile: ScatterProfile) =>
  `${profile.blurSize}|${[...profile.diffuse].slice(0, 3).join(",")}|${[...profile.falloff].slice(0, 3).join(",")}`;

/**
 * Slots for the distinct profiles among the drawn skin, in first-seen order, up to eight. A ninth or later distinct profile falls
 * back to slot 0 (the game's behaviour there is unknown, shader-skin.md §6.5) and is counted in `overflow`.
 */
export function assignScatterSlots(profiles: readonly ScatterProfile[]): { slotOf: number[]; distinct: ScatterProfile[]; overflow: number } {
  const keys = new Map<string, number>(), distinct: ScatterProfile[] = [];
  let overflow = 0;
  const slotOf = profiles.map(profile => {
    const key = scatterProfileKey(profile);
    const known = keys.get(key);
    if (known !== undefined) return known;
    if (distinct.length >= SCATTER_SLOTS) { overflow++; keys.set(key, 0); return 0; }
    keys.set(key, distinct.length);
    distinct.push(profile);
    return distinct.length - 1;
  });
  return { slotOf, distinct, overflow };
}

/**
 * How far (pixels) a stored offset lands on screen: `offset (profile units × blurSize, read as millimetres [hypothesis], §11.6)` at
 * view depth `depth` (m) under a focal length of `focalPixels`, truncated toward zero as the game's whole-pixel taps are.
 */
export const scatterTapPixels = (offset: number, depth: number, focalPixels: number) =>
  Math.trunc(offset * 1e-3 * focalPixels / Math.max(depth, 1e-6));

/**
 * Reference blur (for tests and evidence): the §6.3.1 separable pass pair and the §6.3.5 combine on small CPU images, with the game's
 * rules: a neighbour counts only if it is class 1 and its red irradiance is positive (no depth test), taps are whole pixels
 * (truncated), weights renormalise per channel, and only the centre's metalness (> 0.1) gates. Returns `Δ = P · (B − E) · albedo`,
 * zero outside class 1. Images are row-major RGB (`E`, `albedo`) or scalars (`classOne`, `depth`, `metalness`, `slot`).
 */
export type ScatterReferenceInput = {
  width: number; height: number;
  irradiance: Float32Array; albedo: Float32Array;
  classOne: Uint8Array; depth: Float32Array; metalness: Float32Array; slot: Uint8Array;
  slots: readonly (ScatterSlot | null)[]; focalPixels: number;
};
export function referenceScatter(input: ScatterReferenceInput): Float32Array {
  const { width, height, irradiance, albedo, classOne, depth, metalness, slot, slots, focalPixels } = input;
  const pass = (source: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!classOne[p] || metalness[p]! > 0.1) continue;
      const row = slots[slot[p]!];
      if (!row) continue;
      const k0 = row.entries[0]!.weight, num = [0, 1, 2].map(k => k0[k]! * source[p * 3 + k]!), den = [0, 1, 2].map(k => k0[k]! + 1e-5);
      for (let i = 1; i < row.entries.length; i++) {
        const entry = row.entries[i]!, d = scatterTapPixels(entry.offset, depth[p]!, focalPixels);
        for (const sign of [-1, 1]) {
          const qx = horizontal ? x + sign * d : x, qy = horizontal ? y : y + sign * d;
          if (qx < 0 || qy < 0 || qx >= width || qy >= height) continue;
          const q = qy * width + qx;
          if (!classOne[q] || !(source[q * 3]! > 0)) continue;
          for (let k = 0; k < 3; k++) { num[k] += entry.weight[k]! * source[q * 3 + k]!; den[k] += entry.weight[k]!; }
        }
      }
      for (let k = 0; k < 3; k++) out[p * 3 + k] = num[k]! / den[k]!;
    }
    return out;
  };
  const blurred = pass(pass(irradiance, true), false);
  const delta = new Float32Array(width * height * 3);
  for (let p = 0; p < width * height; p++) {
    if (!classOne[p] || metalness[p]! > 0.1) continue;
    const row = slots[slot[p]!];
    if (!row) continue;
    for (let k = 0; k < 3; k++) delta[p * 3 + k] = row.strength[k]! * (blurred[p * 3 + k]! - irradiance[p * 3 + k]!) * albedo[p * 3 + k]!;
  }
  return delta;
}
