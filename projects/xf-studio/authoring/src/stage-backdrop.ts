/**
 * The neutral viewport stage, as colour data for the renderer. Pure: no Three.js or DOM.
 *
 * The stage used to be the CSS `--stage` gradient behind a transparent WebGL canvas, so any
 * fragment that wrote alpha below one (alpha-to-coverage hair, the hair cap) let the page show
 * through, and hair looked lighter in the light theme than in the dark one. The renderer now
 * draws this backdrop itself into an opaque canvas. It is a background only: the lighting
 * environment never depends on it or on the theme.
 *
 * The token values mirror `--stage` in public/studio.css (tests/stage-backdrop.test.ts checks
 * that they agree), and the geometry mirrors its `radial-gradient(120% 90% at 50% 38%, …, … 70%)`.
 */

export type StageTheme = "light" | "dark";
/** CSS `oklch(L C H)`: lightness 0–1, chroma, hue in degrees. */
export type Oklch = readonly [lightness: number, chroma: number, hue: number];
export type Rgb = [number, number, number];

export const STAGE_TOKENS: Readonly<Record<StageTheme, { readonly centre: Oklch; readonly edge: Oklch }>> = Object.freeze({
  light: { centre: [0.93, 0.004, 255], edge: [0.79, 0.005, 255] },
  dark: { centre: [0.31, 0.006, 255], edge: [0.205, 0.006, 255] },
});

/** Ellipse radii as fractions of the viewport, centre position (y from the top), and the edge stop. */
export const STAGE_GRADIENT = Object.freeze({ radiusX: 1.2, radiusY: 0.9, centreX: 0.5, centreY: 0.38, edgeStop: 0.7 });

export function oklchToOklab([l, c, h]: Oklch): Rgb {
  const radians = (h * Math.PI) / 180;
  return [l, c * Math.cos(radians), c * Math.sin(radians)];
}

/** OKLab to linear-light sRGB (Ottosson's published matrices), unclamped. */
export function oklabToLinearSrgb([l, a, b]: Readonly<Rgb>): Rgb {
  const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
}

export function linearToSrgbByte(value: number): number {
  const v = Math.min(1, Math.max(0, value));
  return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
}

/** Gradient position (0 = centre colour, 1 = edge colour) of a point in normalised viewport coordinates (y down). */
export function stageGradientPosition(x: number, y: number): number {
  const g = STAGE_GRADIENT;
  const distance = Math.hypot((x - g.centreX) / g.radiusX, (y - g.centreY) / g.radiusY);
  return Math.min(1, distance / g.edgeStop);
}

/** Linear sRGB stage colour at gradient position t, interpolated in OKLab as CSS does for oklch() stops. */
export function stageColour(theme: StageTheme, t: number): Rgb {
  const { centre, edge } = STAGE_TOKENS[theme];
  const a = oklchToOklab(centre), b = oklchToOklab(edge), k = Math.min(1, Math.max(0, t));
  return oklabToLinearSrgb([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
}

/**
 * sRGB-encoded RGBA bytes of the stage at texel centres, rows ordered bottom-up (GL texture
 * order), for a texture stretched over the whole viewport: the ellipse then scales with the
 * viewport exactly as the CSS percentages do.
 */
export function stageBackdropPixels(theme: StageTheme, width: number, height: number): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    throw Error("Stage backdrop size must be positive integers");
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const y = 1 - (row + 0.5) / height;
    for (let column = 0; column < width; column++) {
      const colour = stageColour(theme, stageGradientPosition((column + 0.5) / width, y));
      const i = (row * width + column) * 4;
      pixels[i] = linearToSrgbByte(colour[0]);
      pixels[i + 1] = linearToSrgbByte(colour[1]);
      pixels[i + 2] = linearToSrgbByte(colour[2]);
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}
