/**
 * Arithmetic of the creator-lighting capture protocol (knowledge/creator-lighting.md §8): patch means,
 * the single exposure fit on the forehead, and the pass marks. Pure: images arrive as RGBA bytes.
 * tools/calibrate-creator-capture.ts is the read-only command-line wrapper.
 */
import { displayTransform, invertNeutralAxis, sampleGradingLut, logC3Encode, srgbDecode, type GradingLut } from "./grading-lut";

export type Rgba8Image = { width: number; height: number; data: Uint8Array };
/** x, y, width, height, in the patch file's declared units. */
export type PatchBox = readonly [number, number, number, number];
/** How a patch file's boxes are measured: image pixels, or fractions of the image's width and height. Never guessed. */
export type PatchUnits = "pixels" | "fractions";
export const PATCH_UNITS: readonly PatchUnits[] = ["pixels", "fractions"];
export type PatchSet = Readonly<Record<string, PatchBox>>;
export type PatchMean = { srgb: [number, number, number]; pixels: number };

export const SKIN_PATCHES = ["forehead", "cheek_left", "cheek_right", "chin"] as const;
/** Patch name prefixes the protocol groups; front-lit hair excludes the `hair_rim_*` edges. */
export const PATCH_GROUPS = Object.freeze({ hair: /^hair_(?!rim)/, brow: /^brow_/, lash: /^lash_/ });

export function patchMean(image: Rgba8Image, box: PatchBox, units: PatchUnits): PatchMean {
  if (!PATCH_UNITS.includes(units)) throw Error(`Patch units must be one of ${PATCH_UNITS.join(", ")}.`);
  if (units === "fractions" && box.some(v => v < 0 || v > 1)) throw Error("A fractional patch box has a value outside 0–1.");
  const [x, y, w, h] = units === "fractions" ? [box[0] * image.width, box[1] * image.height, box[2] * image.width, box[3] * image.height] : box;
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(image.width, Math.round(x + w)), y1 = Math.min(image.height, Math.round(y + h));
  if (x1 - x0 < 1 || y1 - y0 < 1) throw Error("A patch lies outside the image.");
  const sum = [0, 0, 0];
  for (let row = y0; row < y1; row++) for (let column = x0; column < x1; column++) {
    const i = (row * image.width + column) * 4;
    sum[0] += image.data[i]!; sum[1] += image.data[i + 1]!; sum[2] += image.data[i + 2]!;
  }
  const n = (x1 - x0) * (y1 - y0);
  return { srgb: [sum[0]! / n / 255, sum[1]! / n / 255, sum[2]! / n / 255], pixels: n };
}

/** Display-linear Rec. 709 luminance of a display sRGB colour in [0, 1]. */
export const displayLuminance = (srgb: readonly number[]) => 0.2126 * srgbDecode(srgb[0]!) + 0.7152 * srgbDecode(srgb[1]!) + 0.0722 * srgbDecode(srgb[2]!);

/** OKLab of a display sRGB colour (Ottosson's published matrices). */
export function oklab(srgb: readonly number[]): [number, number, number] {
  const [r, g, b] = srgb.map(v => srgbDecode(v)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export const hueDegrees = (lab: readonly number[]) => (Math.atan2(lab[2]!, lab[1]!) * 180 / Math.PI + 360) % 360;
export const hueDifference = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
export const deltaE = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/**
 * Fit the exposure scalar on the forehead: invert both forehead patches through the LUT's grey response
 * to scene values, then k_fit = k_render · scene(game) / scene(studio).
 */
export function fitExposure(game: PatchMean, studio: PatchMean, lut: GradingLut, renderExposure: number): { exposure: number; scale: number } {
  const sceneGame = invertNeutralAxis(lut, displayLuminance(game.srgb)), sceneStudio = invertNeutralAxis(lut, displayLuminance(studio.srgb));
  const scale = sceneStudio > 0 ? sceneGame / sceneStudio : NaN;
  return { exposure: renderExposure * scale, scale };
}

/** The scene value per channel that the LUT's grey axis maps to a display channel value (a near-neutral approximation). */
function channelScene(lut: GradingLut, channel: 0 | 1 | 2, display: number): number {
  let low = 0, high = 1;
  const out = (t: number) => Math.min(1, Math.max(0, sampleGradingLut(lut, t, t, t)[channel]));
  const target = srgbDecode(display);
  for (let i = 0; i < 50; i++) { const mid = (low + high) / 2; if (out(mid) < target) low = mid; else high = mid; }
  const t = (low + high) / 2;
  // Back from LogC to linear: find x with logC3Encode(x) = t by bisection on a monotone function.
  let a = 0, b = 64;
  for (let i = 0; i < 80; i++) { const mid = (a + b) / 2; if (logC3Encode(mid) < t) a = mid; else b = mid; }
  return (a + b) / 2;
}
/** A Studio patch as it would display after changing its exposure by `scale` (per-channel grey-axis inversion). */
export function rescaleDisplay(studio: PatchMean, lut: GradingLut, scale: number): [number, number, number] {
  const scene = [0, 1, 2].map(c => channelScene(lut, c as 0 | 1 | 2, studio.srgb[c]!));
  return displayTransform(scene.map(v => v * scale), 1, lut);
}

export type Mark = { measure: string; target: string; value: string; pass: boolean | null; tests: string };

/** Every pass mark of the protocol that the supplied patches allow; missing patches give `pass: null`. */
export function passMarks(game: Record<string, PatchMean>, studio: Record<string, PatchMean>, lut: GradingLut, renderExposure: number,
  repeat?: Record<string, PatchMean>): { exposure: number | null; marks: Mark[] } {
  const marks: Mark[] = [];
  const both = (name: string) => game[name] && studio[name];
  const background = game.background;
  marks.push({ measure: "Background (game)", target: "≤ 3/255", tests: "no ambient in the box",
    value: background ? `${Math.round(Math.max(...background.srgb) * 255)}/255` : "no patch",
    pass: background ? Math.max(...background.srgb) * 255 <= 3 : null });
  let exposure: number | null = null, scale = 1;
  if (both("forehead")) ({ exposure, scale } = fitExposure(game.forehead!, studio.forehead!, lut, renderExposure));
  marks.push({ measure: "Exposure fit (forehead)", target: "one scalar", tests: "fixed exposure k",
    value: exposure === null ? "no forehead patch" : `k = ${exposure.toPrecision(4)} (×${scale.toFixed(3)} of the render's ${renderExposure})`, pass: null });
  const ratio = (set: Record<string, PatchMean>, a: string, b: string) => displayLuminance(set[a]!.srgb) / displayLuminance(set[b]!.srgb);
  if (both("cheek_left") && both("cheek_right")) {
    const g = ratio(game, "cheek_left", "cheek_right"), s = ratio(studio, "cheek_left", "cheek_right");
    marks.push({ measure: "Left/right cheek luminance ratio", target: "within 10 %", tests: "intensity form, cone reading, yaw",
      value: `game ${g.toFixed(3)} · studio ${s.toFixed(3)}`, pass: Math.abs(s / g - 1) <= 0.1 });
  } else marks.push({ measure: "Left/right cheek luminance ratio", target: "within 10 %", tests: "rig strengths and yaw", value: "no cheek patches", pass: null });
  const skin = (set: Record<string, PatchMean>) => {
    const present = SKIN_PATCHES.filter(name => set[name]);
    return present.length ? present.reduce((sum, name) => sum + displayLuminance(set[name]!.srgb), 0) / present.length : NaN;
  };
  const group = (set: Record<string, PatchMean>, pattern: RegExp) => Object.keys(set).filter(name => pattern.test(name));
  for (const [label, pattern] of Object.entries(PATCH_GROUPS)) {
    const names = group(game, pattern).filter(name => studio[name]);
    if (!names.length) { marks.push({ measure: `${label}/skin luminance ratio`, target: "within 10 %", tests: "material and lighting", value: "no patches", pass: null }); continue; }
    const mean = (set: Record<string, PatchMean>) => names.reduce((sum, name) => sum + displayLuminance(set[name]!.srgb), 0) / names.length;
    const g = mean(game) / skin(game), s = mean(studio) / skin(studio);
    marks.push({ measure: `${label}/skin luminance ratio`, target: "within 10 %", tests: "material and lighting together, independent of k",
      value: `game ${g.toFixed(3)} · studio ${s.toFixed(3)}`, pass: Number.isFinite(g) && Number.isFinite(s) ? Math.abs(s / g - 1) <= 0.1 : null });
    // Hue is compared after the exposure fit, since a grading LUT shifts hue with level.
    const hues = names.map(name => hueDifference(hueDegrees(oklab(game[name]!.srgb)),
      hueDegrees(oklab(exposure === null ? studio[name]!.srgb : rescaleDisplay(studio[name]!, lut, scale)))));
    marks.push({ measure: `${label} hue (OKLab)`, target: "within 5°", tests: "LUT, profile bake and rim colour",
      value: `worst ${Math.max(...hues).toFixed(1)}°${exposure === null ? " (no exposure fit)" : " after the k fit"}`, pass: Math.max(...hues) <= 5 });
  }
  const skinNames = SKIN_PATCHES.filter(both);
  if (skinNames.length && exposure !== null) {
    const errors = skinNames.map(name => deltaE(oklab(game[name]!.srgb), oklab(rescaleDisplay(studio[name]!, lut, scale))));
    marks.push({ measure: "Skin ΔE OKLab after the k fit", target: "≤ 0.02", tests: "display transform",
      value: `worst ${Math.max(...errors).toFixed(4)} (${skinNames.join(", ")})`, pass: Math.max(...errors) <= 0.02 });
  } else marks.push({ measure: "Skin ΔE OKLab after the k fit", target: "≤ 0.02", tests: "display transform", value: "needs skin and forehead patches", pass: null });
  if (repeat) {
    const names = Object.keys(game).filter(name => repeat[name]);
    const worst = Math.max(0, ...names.flatMap(name => game[name]!.srgb.map((v, i) => Math.abs(v - repeat[name]!.srgb[i]!) * 255)));
    marks.push({ measure: "Two hair-page frames", target: "< 1/255 on patches", tests: "fixed exposure over time",
      value: `worst ${worst.toFixed(2)}/255 over ${names.length} patches`, pass: worst < 1 });
  }
  return { exposure, marks };
}
