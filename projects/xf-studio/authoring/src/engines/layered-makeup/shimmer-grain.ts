// Shimmer's game-matched surface ("shimmer-grain-2"): dense pearl specks over a satin base. Pure: no IO.
//
// Why it looks like this (research/materials/finish-designs/shimmer.md): pearl and shimmer pigments are dense, fine
// platelets lying mostly flat, tens of micrometres across, far below one screen pixel at any in-game framing, and
// REDengine's G-buffer holds one normal, one roughness and one metalness per pixel (no anisotropy, sheen or second lobe
// on skin). Shimmer reads as a coherent sliding sheen, faint pinpoints up close and a slight tint.
//
// - Specks. Nearly every texel (70 % + 25 % × the layer's density; 86 % by default) is a speck: its normal tilts by a
//   narrow 13–(13 + 8 × tilt)° at a random azimuth. 13° clears the mode-1 gate saturate(50 − 50z) (full weight from about
//   11.5°) with room for BC5's ≈ 1° error, so no speck fades into a ripple; the narrow band keeps the specks' mean on the
//   surface normal, so together they make one coherent lobe that slides with the light. Specks are glossy and a little
//   metallic (roughness 0.26, metalness 0.35): each is a pinpoint when it mirrors the light, tinted by the pigment.
// - Base. The remaining texels are flat, so `NormalsBlendingMode` 1 writes nothing there and the skin's own normal stays,
//   under a rougher satin surface (roughness 0.5, metalness 0.05, below the 0.1 at which skin loses its scattering).
//   shimmer-grain-1 wrote one glossy surface everywhere (0.32, 0.3) under a sparse 26 % grain; in game it read as glossy
//   vinyl (session 6), because the uniform lobe dominated and a lone one-texel grain is what temporal filtering removes.
// - White noise. Specks are independent per cell (white noise at the cell pitch): no lattice, no discs. The one static
//   variation, speck against base, is one texel wide, so it averages away one mip down.
// - Scale. One grain cell is about the plate window's texel (4096 cells per unit of head UV: about 0.14 × 0.10 mm
//   on the lids; the 2048 × 512 window texel is 0.13 × 0.12 mm). Close up, specks are a pixel or two and twinkle as
//   the light or view moves; from face framing they are sub-pixel, the mip chain averages them away and their
//   slope variance widens the roughness (route-mip-chains.ts), so the far look is a broad, soft, tinted sheen.
//
// A map whose texels are coarser than a grain cell (a head-UV atlas diagnostic) holds the mean of its cells: the
// mean tilt, the mean roughness widened by the variance of the cells inside the texel (the same α'² = ᾱ² + v rule as
// the export's lower mips, ᾱ from the mean roughness), and the mean metalness. From 16 cells per texel the mean tilt is
// only a few degrees, below the gate, so the texel is written flat with the full expected variance and the expected
// surface. The browser preview never takes that path: it bakes the grain one cell per texel over the region's optics
// window (`previewGrainGrid`).
//
// Determinism. The bytes are a pure function of the settings and the grid on every platform: the hash is 32-bit
// integer arithmetic, and the only real-valued operations on the byte path are +, −, ×, ÷ and square roots, which
// IEEE 754 rounds exactly (ECMAScript fixes them to double precision, with no fused multiply-add). Sines and
// cosines are polynomials evaluated with those operations (`sinRad`, `turn`), not `Math.sin`/`Math.cos`/`Math.pow`,
// whose last bit the language leaves to each engine and platform (PREV-186).
import type { FlakeMaps, LegacyFlakes } from "./finish";
import { HEAD_UV_WINDOW, type UvWindow } from "./plate-uv-window";

export const SHIMMER_GRAIN = Object.freeze({
  model: "shimmer-grain-2",
  /** Grain cells per unit of head UV along each axis. */
  cellsPerUv: 4096,
  /** Smallest speck tilt: above the ≈ 11.5° at which mode 1 writes a normal at full weight, with room for BC5's ≈ 1°. */
  tiltFloorDeg: 13,
  /** Tilt range above the floor at the layer's tilt 1 (default 0.65: specks tilt 13–18.2°): narrow, so the sheen stays coherent. */
  tiltSpanDeg: 8,
  /** Share of grain cells that are specks: shareBase + shareSpan × the layer's density (default 0.65: 86 %). */
  shareBase: .7,
  shareSpan: .25,
  /** A speck's surface: glossy, and metallic enough for the pigment to tint its pinpoint. Metalness above 0.1 skips the skin's
   * subsurface scattering on that texel, as the game's own gold and silver blush does. */
  speck: Object.freeze({ roughness: .26, metalness: .35 }),
  /** The flat texels between specks: a rougher satin, below the 0.1 metalness at which skin loses its scattering. */
  base: Object.freeze({ roughness: .5, metalness: .05 }),
  /** From this many cells per texel the mean tilt is written flat (see the header). */
  analyticCells: 16,
  /** Largest preview grain grid (texels): the bound `assessPreviewQuality` counts and `previewGrainGrid` enforces. */
  previewMaxTexels: 2048 * 1024,
});

const clip01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const toByte = (v: number) => Math.round(clip01(v) * 255);
const radians = (deg: number) => deg * Math.PI / 180;
/** x^¼ through two correctly rounded square roots (never `Math.pow`). */
const quarterPower = (x: number) => Math.sqrt(Math.sqrt(x));

// Taylor coefficients to x¹⁷ / x¹⁶: on [0, π/4] the first omitted term is below 1e-19, far under one unit in the last place.
const SIN = [1, -1 / 6, 1 / 120, -1 / 5040, 1 / 362880, -1 / 39916800, 1 / 6227020800, -1 / 1307674368000, 1 / 355687428096000];
const COS = [1, -1 / 2, 1 / 24, -1 / 720, 1 / 40320, -1 / 3628800, 1 / 479001600, -1 / 87178291200, 1 / 20922789888000];
function poly(c: readonly number[], x2: number) {
  let s = c[c.length - 1];
  for (let i = c.length - 2; i >= 0; i--) s = s * x2 + c[i];
  return s;
}
const sinSmall = (x: number) => x * poly(SIN, x * x), cosSmall = (x: number) => poly(COS, x * x);
/** sin x for x in [0, π/2], with IEEE arithmetic only. */
export function sinRad(x: number): number {
  if (!(x >= 0 && x <= Math.PI / 2 + 1e-12)) throw RangeError("sinRad takes [0, π/2].");
  return x <= Math.PI / 4 ? sinSmall(x) : cosSmall(Math.PI / 2 - x);
}
/** (cos 2πt, sin 2πt) for t in [0, 1) into out[k], out[k + 1], with IEEE arithmetic only; quarter-turn reduction is exact for t = k/2³². */
function turnInto(t: number, out: Float64Array, k: number) {
  const q = Math.floor(t * 4), f = t - q / 4; // f in [0, ¼), exact
  let c: number, s: number;
  if (f <= 1 / 8) { const a = 2 * Math.PI * f; c = cosSmall(a); s = sinSmall(a); }
  else { const a = 2 * Math.PI * (1 / 4 - f); c = sinSmall(a); s = cosSmall(a); }
  if (q === 0) { out[k] = c; out[k + 1] = s; } else if (q === 1) { out[k] = -s; out[k + 1] = c; }
  else if (q === 2) { out[k] = -c; out[k + 1] = -s; } else { out[k] = s; out[k + 1] = -c; }
}
/** (cos 2πt, sin 2πt) for t in [0, 1), with IEEE arithmetic only. */
export function turn(t: number): [number, number] {
  const out = new Float64Array(2);
  turnInto(t, out, 0);
  return [out[0], out[1]];
}

/** murmur3's 32-bit finaliser. */
function fmix(h: number) {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) | 0;
}
/** The seed every layer has today; the key below keeps its stream (and so every Shimmer map built so far) unchanged. */
const ANCHOR_SEED = 2077, ANCHOR = fmix(ANCHOR_SEED);
/**
 * The hash key of one draw of `seed` (PREV-185). A plain `seed + salt` made seed s + 1's first draw seed s's second, so
 * neighbouring seeds shared one stream shifted by a draw. The seed is now avalanched first; the anchor term cancels for
 * the default seed, whose key stays `seed + salt`.
 */
const drawKey = (seed: number, salt: number) => Math.imul((fmix(seed) ^ ANCHOR) ^ (seed + salt), 0x9e3779b1);
/** Integer hash of one grain cell and draw to [0, 1); decorrelated along rows, columns and diagonals. */
function hash(x: number, y: number, key: number) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y ^ 0x5bd1e995, 0x165667b1) ^ key;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** The share of grain cells that are specks, and the speck tilt range (radians), for a layer's classic flake settings. */
export function grainSettings(p: Pick<LegacyFlakes, "density" | "tilt">) {
  const low = radians(SHIMMER_GRAIN.tiltFloorDeg), high = radians(SHIMMER_GRAIN.tiltFloorDeg + SHIMMER_GRAIN.tiltSpanDeg * p.tilt);
  return { share: SHIMMER_GRAIN.shareBase + SHIMMER_GRAIN.shareSpan * p.density, low, high };
}
/** The expected surface of one grain cell: the speck share's mean roughness and metalness (what averaging keeps). */
export function grainMeanSurface(p: Pick<LegacyFlakes, "density" | "tilt">) {
  const { share } = grainSettings(p), { speck, base } = SHIMMER_GRAIN;
  return { roughness: share * speck.roughness + (1 - share) * base.roughness, metalness: share * speck.metalness + (1 - share) * base.metalness };
}

/** Expected slope variance E[x² + y²] of one grain cell: share × E[sin²θ] for θ uniform on [low, high]. */
export function grainVariance(p: Pick<LegacyFlakes, "density" | "tilt">): number {
  const { share, low, high } = grainSettings(p), s = sinRad(low);
  const meanSin2 = high - low < 1e-9 ? s * s : .5 - (sinRad(2 * high) - sinRad(2 * low)) / (4 * (high - low));
  return share * meanSin2;
}

type Keys = { share: number; tilt: number; azimuth: number };
const keysOf = (seed: number): Keys => ({ share: drawKey(seed, 1), tilt: drawKey(seed, 2), azimuth: drawKey(seed, 3) });
/** Tangent X, Y of grain cell (x, y) into `out` (flat: 0, 0). No allocation: the bake's inner loop. */
function grainInto(x: number, y: number, keys: Keys, settings: ReturnType<typeof grainSettings>, out: Float64Array) {
  if (hash(x, y, keys.share) >= settings.share) { out[0] = 0; out[1] = 0; return; }
  const s = sinRad(settings.low + (settings.high - settings.low) * hash(x, y, keys.tilt));
  turnInto(hash(x, y, keys.azimuth), out, 0);
  out[0] *= s; out[1] *= s;
}
/** Tangent X, Y of grain cell (x, y); [0, 0] for a flat cell. */
export function grainAt(x: number, y: number, p: LegacyFlakes, settings = grainSettings(p)): [number, number] {
  const out = new Float64Array(2);
  grainInto(x, y, keysOf(p.seed), settings, out);
  return [out[0], out[1]];
}

function validSettings(p: LegacyFlakes | undefined): p is LegacyFlakes {
  return !!p && Number.isFinite(p.density) && p.density >= 0 && p.density <= 1 && Number.isFinite(p.tilt) && p.tilt >= 0 && p.tilt <= 1 &&
    Number.isInteger(p.seed) && p.seed >= 0 && p.seed <= 2147483647;
}

/** Grain cells per texel along each axis of a width × height map over `area` (the nearest whole number, at least 1). */
export function grainCellsPerTexel(width: number, height: number, area: UvWindow = HEAD_UV_WINDOW) {
  return { u: Math.max(1, Math.round(SHIMMER_GRAIN.cellsPerUv * (area.u1 - area.u0) / width)),
    v: Math.max(1, Math.round(SHIMMER_GRAIN.cellsPerUv * (area.v1 - area.v0) / height)) };
}
/** Grain cells per unit of head UV actually laid on a width × height map over `area` (its texel pitch times the cells per texel). */
export function grainPitch(width: number, height: number, area: UvWindow = HEAD_UV_WINDOW) {
  const cells = grainCellsPerTexel(width, height, area);
  return { u: cells.u * width / (area.u1 - area.u0), v: cells.v * height / (area.v1 - area.v0) };
}

/**
 * The preview's grain grid over a region's optics window: one cell per texel at the true 4096 cells per unit of head UV,
 * the window's edges on the cell grid, each side a power of two (so the route's mip chain halves exactly). Refused when
 * the window is not such a rectangle or its grid exceeds `SHIMMER_GRAIN.previewMaxTexels`.
 */
export function previewGrainGrid(area: UvWindow): { width: number; height: number; window: UvWindow } {
  const n = SHIMMER_GRAIN.cellsPerUv, cells = (a: number) => a * n;
  const width = cells(area.u1 - area.u0), height = cells(area.v1 - area.v0);
  const pow2 = (k: number) => Number.isInteger(k) && k >= 1 && !(k & (k - 1));
  if (![area.u0, area.u1, area.v0, area.v1].every(e => Number.isInteger(cells(e)) && e >= 0 && e <= 1) || !pow2(width) || !pow2(height) ||
      width * height > SHIMMER_GRAIN.previewMaxTexels)
    throw Error("The preview optics rectangle must sit on the grain grid with power-of-two sides within the preview limit.");
  return { width, height, window: area };
}

/**
 * Game-matched Shimmer's preview maps: its grain over the region's optics window, one cell per texel whatever the preview
 * size (`previewGrainGrid`), as the route's complete RGBA mip chains (route-mip-chains.ts), built in the raster worker.
 */
export type GrainOptics = { window: UvWindow; width: number; height: number; normal: Uint8Array<ArrayBuffer>[]; surface: Uint8Array<ArrayBuffer>[] };
export const isGrainOptics = (optics: FlakeMaps | GrainOptics | undefined): optics is GrainOptics => !!optics && "window" in optics;

export type ShimmerGrainMaps = {
  width: number; height: number;
  /** Two bytes per texel: tangent X, Y (UNORM), as the export stores them. */
  normal: Uint8Array<ArrayBuffer>;
  /** Two bytes per texel: roughness, metalness. */
  surface: Uint8Array<ArrayBuffer>;
};

/**
 * Bounded cooperative bake of Shimmer's grain over a width × height map of `area` (head UV by default). Each
 * grain cell evaluated costs one unit, and a texel written flat costs one. Cell (x·ku + i, y·kv + j) of texel (x, y)
 * is the grain's identity, so on the head atlas a coarser map holds exactly the mean of a finer one's cells.
 */
export function createShimmerGrainJob(p: LegacyFlakes, width: number, height = width, area: UvWindow = HEAD_UV_WINDOW) {
  if (!validSettings(p) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096)
    throw Error("Invalid Shimmer grain settings.");
  const settings = grainSettings(p), keys = keysOf(p.seed), cells = grainCellsPerTexel(width, height, area), n = cells.u * cells.v;
  const analytic = n >= SHIMMER_GRAIN.analyticCells, { speck, base } = SHIMMER_GRAIN, mean = grainMeanSurface(p);
  const speckBytes = [toByte(speck.roughness), toByte(speck.metalness)], baseBytes = [toByte(base.roughness), toByte(base.metalness)];
  const alpha2 = (r: number) => (r * r) * (r * r);
  const full = toByte(quarterPower(alpha2(mean.roughness) + grainVariance(p))), meanMetal = toByte(mean.metalness);
  const normal = new Uint8Array(width * height * 2), surface = new Uint8Array(width * height * 2), g = new Float64Array(2);
  const texels = width * height;
  let texel = 0, done = false;
  return { width, height, normal, surface, get done() { return done; },
    advance(maxWork: number) {
      if (!(maxWork > 0) || (!Number.isInteger(maxWork) && maxWork !== Infinity)) throw Error("Invalid grain slice size.");
      let work = 0;
      while (!done && work < maxWork) {
        const x = texel % width, y = (texel - x) / width, o = texel * 2;
        if (analytic) {
          normal[o] = normal[o + 1] = 128; surface[o] = full; surface[o + 1] = meanMetal; work++;
        } else if (n === 1) {
          // One cell per texel (the export window, the preview): a speck on its glossy surface, or the flat satin base.
          grainInto(x, y, keys, settings, g);
          const own = g[0] || g[1] ? speckBytes : baseBytes;
          normal[o] = toByte(g[0] * .5 + .5); normal[o + 1] = toByte(g[1] * .5 + .5); surface[o] = own[0]; surface[o + 1] = own[1]; work++;
        } else {
          let sx = 0, sy = 0, s2 = 0, specks = 0;
          for (let j = 0; j < cells.v; j++) for (let i = 0; i < cells.u; i++) {
            grainInto(x * cells.u + i, y * cells.v + j, keys, settings, g);
            const gx = g[0], gy = g[1];
            if (gx || gy) { sx += gx; sy += gy; s2 += gx * gx + gy * gy; specks++; }
          }
          work += n;
          const mx = sx / n, my = sy / n, inner = Math.max(0, s2 / n - mx * mx - my * my), f = specks / n;
          const r = f * speck.roughness + (1 - f) * base.roughness, m = f * speck.metalness + (1 - f) * base.metalness;
          normal[o] = toByte(mx * .5 + .5); normal[o + 1] = toByte(my * .5 + .5);
          surface[o] = toByte(quarterPower(alpha2(r) + inner)); surface[o + 1] = toByte(m);
        }
        if (++texel === texels) done = true;
      }
      return done;
    },
  };
}

/** Synchronous bake (the export compiler's). */
export function bakeShimmerGrain(p: LegacyFlakes, width: number, height = width, area: UvWindow = HEAD_UV_WINDOW): ShimmerGrainMaps {
  const job = createShimmerGrainJob(p, width, height, area);
  job.advance(Infinity);
  return { width, height, normal: job.normal, surface: job.surface };
}
