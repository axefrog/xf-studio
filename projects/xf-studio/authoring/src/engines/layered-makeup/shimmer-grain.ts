// Shimmer's game-matched surface ("shimmer-grain-1"): a pearly sheen with a fine sparkle grain. Pure: no IO.
//
// Why it looks like this (research/materials/finish-designs/shimmer.md): pearl and shimmer pigments are tens of
// micrometres across, far below one screen pixel at any in-game framing, and REDengine's G-buffer holds one
// normal, one roughness and one metalness per pixel (no anisotropy, sheen or second lobe on skin). So the finish
// is built sheen-first:
//
// - Surface. Every covered texel writes the same roughness and metalness: a soft lobe whose reflection the
//   pigment tints. Nothing static varies from texel to texel, so no pattern can show that does not move with
//   the light (the retired facet bake wrote metalness and roughness per facet: static dots).
// - Grain. A share of texels tilt their normal by 12° or more, at random azimuths; the rest are flat, so
//   `NormalsBlendingMode` 1 writes nothing there and the skin's own normal stays. 12° clears the mode-1 gate
//   saturate(50 − 50z) (full weight from about 11.5°), so a grain is never faded into a ripple. Grains are
//   independent per cell (white noise at the cell pitch): no lattice, no discs.
// - Scale. One grain cell is about the plate window's texel (4096 cells per unit of head UV: about 0.14 × 0.10 mm
//   on the lids; the 2048 × 512 window texel is 0.13 × 0.12 mm). Close up, grains are a pixel or two and twinkle as
//   the light or view moves; from face framing they are sub-pixel, the mip chain averages them away and their
//   slope variance widens the roughness (route-mip-chains.ts), so the far look is a broader, brighter sheen.
//
// A map whose texels are coarser than a grain cell (a head-UV atlas, the browser preview below 4096) holds the mean
// of its cells: the mean tilt, and roughness widened by the variance of the cells inside the texel, the same
// α'² = α² + v rule as the export's lower mips. From 16 cells per texel the mean tilt is only a few degrees, below the
// gate, so the texel is written flat with the full expected variance.
import type { LegacyFlakes } from "./finish";
import { HEAD_UV_WINDOW, type UvWindow } from "./plate-uv-window";

export const SHIMMER_GRAIN = Object.freeze({
  model: "shimmer-grain-1",
  /** Grain cells per unit of head UV along each axis. */
  cellsPerUv: 4096,
  /** Smallest grain tilt: above the ≈ 11.5° at which mode 1 writes a normal at full weight. */
  tiltFloorDeg: 12,
  /** Tilt range above the floor at the layer's tilt 1 (default 0.65: grains tilt 12–23.7°). */
  tiltSpanDeg: 18,
  /** Share of grain cells that tilt at the layer's density 1 (default 0.65: 26 %). */
  shareMax: .4,
  /** Written by every covered texel. Metalness above 0.1 also skips the skin's subsurface scattering under the
   * makeup, as the game's own gold and silver blush does. */
  roughness: .32,
  metalness: .3,
  /** From this many cells per texel the mean tilt is written flat (see the header). */
  analyticCells: 16,
});

const clip01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const toByte = (v: number) => Math.round(clip01(v) * 255);
const radians = (deg: number) => deg * Math.PI / 180;

/** Integer hash of one grain cell and draw to [0, 1); decorrelated along rows, columns and diagonals. */
function draw(x: number, y: number, seed: number, salt: number) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y ^ 0x5bd1e995, 0x165667b1) ^ Math.imul(seed + salt, 0x9e3779b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** The share of grain cells that tilt, and the tilt range (radians), for a layer's classic flake settings. */
export function grainSettings(p: Pick<LegacyFlakes, "density" | "tilt">) {
  const low = radians(SHIMMER_GRAIN.tiltFloorDeg), high = radians(SHIMMER_GRAIN.tiltFloorDeg + SHIMMER_GRAIN.tiltSpanDeg * p.tilt);
  return { share: SHIMMER_GRAIN.shareMax * p.density, low, high };
}

/** Expected slope variance E[x² + y²] of one grain cell: share × E[sin²θ] for θ uniform on [low, high]. */
export function grainVariance(p: Pick<LegacyFlakes, "density" | "tilt">): number {
  const { share, low, high } = grainSettings(p);
  const meanSin2 = high - low < 1e-9 ? Math.sin(low) ** 2 : .5 - (Math.sin(2 * high) - Math.sin(2 * low)) / (4 * (high - low));
  return share * meanSin2;
}

/** Tangent X, Y of grain cell (x, y); [0, 0] for a flat cell. */
export function grainAt(x: number, y: number, p: LegacyFlakes, settings = grainSettings(p)): [number, number] {
  if (draw(x, y, p.seed, 1) >= settings.share) return [0, 0];
  const tilt = settings.low + (settings.high - settings.low) * draw(x, y, p.seed, 2), azimuth = 2 * Math.PI * draw(x, y, p.seed, 3);
  const s = Math.sin(tilt);
  return [s * Math.cos(azimuth), s * Math.sin(azimuth)];
}

function validSettings(p: LegacyFlakes | undefined): p is LegacyFlakes {
  return !!p && Number.isFinite(p.density) && p.density >= 0 && p.density <= 1 && Number.isFinite(p.tilt) && p.tilt >= 0 && p.tilt <= 1 &&
    Number.isInteger(p.seed) && p.seed >= 0 && p.seed <= 2147483647;
}

/** Grain cells per texel along each axis of a width × height map over `area`. */
export function grainCellsPerTexel(width: number, height: number, area: UvWindow = HEAD_UV_WINDOW) {
  return { u: Math.max(1, Math.round(SHIMMER_GRAIN.cellsPerUv * (area.u1 - area.u0) / width)),
    v: Math.max(1, Math.round(SHIMMER_GRAIN.cellsPerUv * (area.v1 - area.v0) / height)) };
}

export type ShimmerGrainMaps = {
  width: number; height: number;
  /** RGBA: tangent X, Y, reconstructed Z (UNORM), 255. */
  normal: Uint8Array<ArrayBuffer>;
  /** RGBA: tilted share of the texel's cells, roughness, metalness, 255 (the preview's packed surface). */
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
  p = { ...p };
  const settings = grainSettings(p), cells = grainCellsPerTexel(width, height, area), n = cells.u * cells.v;
  const analytic = n >= SHIMMER_GRAIN.analyticCells, alpha2 = SHIMMER_GRAIN.roughness ** 4;
  const metal = toByte(SHIMMER_GRAIN.metalness), full = toByte(Math.pow(alpha2 + grainVariance(p), .25)), share = toByte(settings.share);
  const normal = new Uint8Array(width * height * 4), surface = new Uint8Array(width * height * 4);
  let texel = 0, done = false;
  return { width, height, normal, surface, get done() { return done; },
    advance(maxWork: number) {
      if (!(maxWork > 0) || (!Number.isInteger(maxWork) && maxWork !== Infinity)) throw Error("Invalid grain slice size.");
      let work = 0;
      while (!done && work < maxWork) {
        const x = texel % width, y = (texel - x) / width, o = texel * 4;
        if (analytic) {
          normal.set([128, 128, 255, 255], o); surface.set([share, full, metal, 255], o); work++;
        } else {
          let sx = 0, sy = 0, s2 = 0, tilted = 0;
          for (let j = 0; j < cells.v; j++) for (let i = 0; i < cells.u; i++) {
            const [gx, gy] = grainAt(x * cells.u + i, y * cells.v + j, p, settings);
            if (gx || gy) { sx += gx; sy += gy; s2 += gx * gx + gy * gy; tilted++; }
          }
          work += n;
          const mx = sx / n, my = sy / n, inner = Math.max(0, s2 / n - mx * mx - my * my);
          normal.set([toByte(mx * .5 + .5), toByte(my * .5 + .5), toByte(Math.sqrt(Math.max(0, 1 - mx * mx - my * my)) * .5 + .5), 255], o);
          surface.set([toByte(tilted / n), toByte(Math.pow(alpha2 + inner, .25)), metal, 255], o);
        }
        if (++texel === width * height) done = true;
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
