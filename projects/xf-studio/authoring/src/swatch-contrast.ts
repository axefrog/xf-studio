/**
 * Contrast enhancement for a set of colour swatches shown together (a creator colour row, or one maker's group within it): an adaptive,
 * per-set "auto levels" in OKLab that spreads a tightly clustered set so its members can be told apart, and leaves an already varied set
 * alone. Pure and DOM-free; the presentation shows the result and says that it did (the true colour stays in the header chip and the
 * swatch card).
 *
 * - **What moves.** Each swatch's colours go to OKLab (Ottosson). The set's statistics are taken over one representative per swatch (the
 *   mean of its stops), and one mapping is applied to every stop, so a gradient keeps its shape. Three axes, each with its own spread and
 *   gain: **lightness** L (distances from the set's mean L scaled by `gL`), **saturation** C/L (so a brightened brown stays as saturated
 *   as it was instead of greying), and **hue** (the chroma-weighted circular deviation from the set's mean hue, scaled by `gH`).
 * - **How much** (`contrastGain`): the gain is a curve of the axis's spread σ, not a fixed normalisation. At or above a comfortable spread
 *   `T` it is 1 (untouched); below, it rises as `(T/σ)^(1−γ)` (γ = ½, so the output spread is `√(σ·T)`), capped at `maxGain`. Identical
 *   colours stay identical (a zero distance scaled is zero), and a near-identical set is spread by at most `maxGain`, which keeps
 *   differences under a just-noticeable step from turning into noise. The curve is drawn in the style guide's swatch entry.
 * - **Honest limits.** Hue rotation is capped per colour (`maxHueShift`) and fades out below `hueChromaFloor`, where hue means nothing, so
 *   a brown stays brown. Lightness stays inside `[L_FLOOR, L_CEIL]` (the set is re-centred, and the gain lowered if its range would not
 *   fit); every colour is brought back into the sRGB gamut by lowering its chroma at the same lightness and hue. Order along each axis is
 *   preserved.
 */

export interface ContrastAxis { readonly spread: number; readonly gain: number }
export interface ContrastResult {
  /** The enhanced colours, in the input's shape (each swatch's stops as `#rrggbb`). */
  readonly colours: readonly (readonly string[])[];
  readonly lightness: ContrastAxis;
  readonly saturation: ContrastAxis;
  readonly hue: ContrastAxis;
  /** Any axis was stretched noticeably (the presentation marks the set as contrast-enhanced). */
  readonly enhanced: boolean;
}

/** The comfortable spread per axis (σ at which the gain reaches 1), the curve exponent and the caps. */
export const CONTRAST = {
  /** OKLab L standard deviation of a set that reads as clearly varied (vanilla hair and lash colours: 0.20–0.21). */
  lightnessTarget: 0.2,
  /** Saturation (C/L) standard deviation. */
  saturationTarget: 0.06,
  /** Chroma-weighted hue deviation, in degrees. */
  hueTarget: 30,
  exponent: 0.5,
  maxGain: 3,
  maxHueGain: 2,
  /** No colour's hue moves by more than this (degrees). */
  maxHueShift: 12,
  /** Below this OKLab chroma a colour's hue is not moved at all; full rotation from twice it. */
  hueChromaFloor: 0.02,
  /** Overall OKLab spread of a set that is already comfortably separated (vanilla hair colours: about 0.21); see `separationWeight`. */
  separated: 0.2,
  /** A gain below this is not worth marking (nor applying). */
  noticeable: 1.05,
} as const;
const L_FLOOR = 0.08, L_CEIL = 0.95;

/** How much of the per-axis gains applies, from the set's overall OKLab spread: all of it up to 0.6 × `separated`, none from `separated`. */
export function separationWeight(overall: number): number {
  const full = CONTRAST.separated * 0.6, t = Math.max(0, Math.min(1, (overall - full) / (CONTRAST.separated - full)));
  return 1 - t * t * (3 - 2 * t);
}
/** The gain for an axis with spread `spread`: 1 at or above `target`, `(target/spread)^(1−γ)` below, capped. */
export function contrastGain(spread: number, target: number, maxGain: number = CONTRAST.maxGain, exponent: number = CONTRAST.exponent): number {
  if (!(spread > 0) || !(target > 0)) return spread > 0 ? 1 : maxGain;
  if (spread >= target) return 1;
  return Math.min(maxGain, (target / spread) ** (1 - exponent));
}

// ---------------------------------------------------------------------------------------------------------------
// OKLab (Björn Ottosson's published matrices), on display sRGB.

const toLinear = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toSrgb = (c: number) => c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
export function hexToOklab(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => toLinear(v / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
/** Linear sRGB of an OKLab colour (may lie outside 0–1). */
export function oklabToLinear([L, a, b]: readonly number[]): [number, number, number] {
  const l = (L! + 0.3963377774 * a! + 0.2158037573 * b!) ** 3, m = (L! - 0.1055613458 * a! - 0.0638541728 * b!) ** 3,
    s = (L! - 0.0894841775 * a! - 1.291485548 * b!) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const inGamut = (rgb: readonly number[]) => rgb.every(c => c >= -1e-4 && c <= 1 + 1e-4);
/** An OKLab colour as `#rrggbb`, its chroma lowered (same L and hue) until it fits sRGB. */
export function oklabToHex(L: number, C: number, h: number): string {
  const at = (chroma: number) => oklabToLinear([L, chroma * Math.cos(h), chroma * Math.sin(h)]);
  let rgb = at(C);
  if (!inGamut(rgb)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (inGamut(at(mid))) lo = mid; else hi = mid; }
    rgb = at(lo);
  }
  return `#${rgb.map(c => Math.round(Math.max(0, Math.min(1, toSrgb(Math.max(0, Math.min(1, c))))) * 255).toString(16).padStart(2, "0")).join("")}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The set.

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const DEG = Math.PI / 180;

/** Enhance one set of swatches (each 1–8 stops of `#rrggbb`). Fewer than two swatches, or an already varied set, come back unchanged. */
export function enhanceSwatchSet(swatches: readonly (readonly string[])[]): ContrastResult {
  const labs = swatches.map(stops => stops.map(hexToOklab));
  const reps = labs.flatMap(stops => stops.length ? [[0, 1, 2].map(k => stops.reduce((sum, lab) => sum + lab[k]!, 0) / stops.length) as [number, number, number]] : []);
  const unchanged = (lightness: ContrastAxis, saturation: ContrastAxis, hue: ContrastAxis): ContrastResult =>
    ({ colours: swatches.map(stops => [...stops]), lightness, saturation, hue, enhanced: false });
  const none = { spread: 0, gain: 1 };
  if (reps.length < 2) return unchanged(none, none, none);
  const n = reps.length;
  const polar = reps.map(([L, a, b]) => ({ L, C: Math.hypot(a, b), h: Math.atan2(b, a) }));
  const sat = (L: number, C: number) => C / Math.max(L, 0.05);
  // Lightness.
  const meanL = polar.reduce((s, p) => s + p.L, 0) / n;
  const spreadL = Math.sqrt(polar.reduce((s, p) => s + (p.L - meanL) ** 2, 0) / n);
  const minL = Math.min(...polar.map(p => p.L)), maxL = Math.max(...polar.map(p => p.L));
  // The stretched range stays inside [L_FLOOR, L_CEIL], or the set's own range where that is wider (an untouched set never moves).
  const floor = Math.min(L_FLOOR, minL), ceil = Math.max(L_CEIL, maxL);
  let gainL = contrastGain(spreadL, CONTRAST.lightnessTarget);
  if ((maxL - minL) * gainL > ceil - floor) gainL = Math.max(1, (ceil - floor) / Math.max(maxL - minL, 1e-6));
  // Saturation.
  const sats = polar.map(p => sat(p.L, p.C));
  const meanS = sats.reduce((s, v) => s + v, 0) / n;
  const spreadS = Math.sqrt(sats.reduce((s, v) => s + (v - meanS) ** 2, 0) / n);
  const gainS = contrastGain(spreadS, CONTRAST.saturationTarget);
  // Hue: chroma-weighted circular mean and deviation.
  const weights = polar.map(p => p.C);
  const totalW = weights.reduce((s, w) => s + w, 0);
  const meanH = Math.atan2(polar.reduce((s, p, i) => s + weights[i]! * Math.sin(p.h), 0), polar.reduce((s, p, i) => s + weights[i]! * Math.cos(p.h), 0));
  const spreadH = totalW > 1e-6 ? Math.sqrt(polar.reduce((s, p, i) => s + weights[i]! * wrap(p.h - meanH) ** 2, 0) / totalW) / DEG : 0;
  const gainH = totalW > 1e-6 ? contrastGain(spreadH, CONTRAST.hueTarget, CONTRAST.maxHueGain) : 1;
  // A set already well separated overall (its OKLab spread about the centroid) is left alone whatever one axis says.
  const meanA = reps.reduce((s, r) => s + r[1], 0) / n, meanB = reps.reduce((s, r) => s + r[2], 0) / n;
  const overall = Math.sqrt(reps.reduce((s, [L, a, b]) => s + (L - meanL) ** 2 + (a - meanA) ** 2 + (b - meanB) ** 2, 0) / n);
  const weight = separationWeight(overall);
  const use = (gain: number) => { const g = 1 + (gain - 1) * weight; return g >= CONTRAST.noticeable ? g : 1; };
  const gL = use(gainL), gS = use(gainS), gH = use(gainH);
  const centreL = Math.min(Math.max(meanL, floor + gL * (meanL - minL)), ceil - gL * (maxL - meanL));
  const lightness = { spread: spreadL, gain: gL }, saturation = { spread: spreadS, gain: gS }, hue = { spread: spreadH, gain: gH };
  if (gL === 1 && gS === 1 && gH === 1) return unchanged(lightness, saturation, hue);
  const map = ([L0, a, b]: readonly number[]): string => {
    const C0 = Math.hypot(a!, b!), h0 = Math.atan2(b!, a!);
    const L = Math.min(L_CEIL, Math.max(L_FLOOR * 0.5, centreL + gL * (L0! - meanL)));
    const s = Math.max(0, meanS + gS * (sat(L0!, C0) - meanS));
    const C = s * Math.max(L, 0.05);
    const hueWeight = Math.max(0, Math.min(1, (C0 - CONTRAST.hueChromaFloor) / CONTRAST.hueChromaFloor));
    const shift = Math.max(-CONTRAST.maxHueShift * DEG, Math.min(CONTRAST.maxHueShift * DEG, (gH - 1) * wrap(h0 - meanH))) * hueWeight;
    return oklabToHex(L, C, h0 + shift);
  };
  return { colours: labs.map(stops => stops.map(map)), lightness, saturation, hue, enhanced: true };
}
