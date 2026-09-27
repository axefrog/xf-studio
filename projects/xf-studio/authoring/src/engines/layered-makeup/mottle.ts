/**
 * Mottle (`mottle-1`): an optional per-layer effect that breaks a layer's coverage up with a seeded, tileable,
 * skin-scale noise, the uneven way powder, cream and mascara sit on skin close up ([vector engine extensions §7]).
 * It runs inside the shared coverage evaluator (`recipe.ts`), so the preview's mask worker, PNG export and every
 * compiler route draw the same thing: the exported decal's alpha carries it and the game pays nothing for it.
 *
 * The arithmetic, per texel, with c the layer's coverage (pigment and opacity included):
 *
 *     d  = tile(skin millimetres / grain)            // zero-mean noise in [-1, 1]: pores and clumps mixed by `clumping`
 *     w  = where == "edges" ? 4·c·(1 − c) : c         // edges: only the soft edge breaks up; everywhere: the whole film
 *     c' = saturate(c + amount · w · d)
 *
 * - **Skin millimetres.** A texel's authored UV maps to millimetres on the skin through the region's `skin` scale, so
 *   pores are the same physical size wherever a layer sits. The grain is floored at two export texels.
 * - **Mean-preserving away from clamping.** Every level of the tile has zero mean, so at a distance (and down the mip
 *   chain) a mottled layer averages to the unmottled coverage wherever c' stays inside 0–1. A fully opaque film in
 *   "everywhere" mode can only lose product (c' ≤ 1), so there it thins slightly: that is forced, not a choice.
 * - **Footprint.** Each raster samples the tile at the mip level of its own texel spacing (trilinear), the way the
 *   game's mips average the exported texture. Export and preview therefore evaluate the same function; a coarser
 *   preview resolution shows it as its mips would. At equal sample points they are identical.
 * - **Streaks** average the noise along a direction (a line kernel), stretching pores into strands: at a fixed angle
 *   on the skin, or across the nearest contour edge (strands off a lash line, the mascara smudge). A symmetric
 *   layer's mirrored copy mirrors its streak direction.
 * - **Deterministic.** The tile is built from integer hashing and + − × ÷ √ only, so a seed gives the same tile in
 *   every engine. Tiles and their mips are cached per seed (and mixed per clumping) in each worker or process.
 *
 * "Version the model whenever appearance changes": any change to this arithmetic, the tile or its constants
 * registers a new model ID (`mottle-2`); `mottle-1` layers keep this look.
 *
 * [vector engine extensions §7]: ../../../../../research/authoring/vector-engine-extensions.md
 */
import type { Mirror } from "./region";

export const MOTTLE_MODEL = "mottle-1" as const;
/** Streaks: at an angle on the skin (degrees, 0 = along u, 90 = along v), or across the nearest contour edge. */
export type MottleStreaks = { mode: "angle"; angle: number; length: number } | { mode: "edge"; length: number };
export type Mottle = {
  model: typeof MOTTLE_MODEL;
  /** Strength of the breakup, 0–1. */
  amount: number;
  /** Grain size in millimetres on the skin (floored at two export texels). */
  grain: number;
  /** 0 = pores (small pits), 1 = clumps (patchy build-up). */
  clumping: number;
  where: "edges" | "everywhere";
  /** Absent: no streaks. */
  streaks?: MottleStreaks;
  seed: number;
};
/** A layer's effects. Absent on a layer without any, which is then byte-identical to before effects existed. */
export type LayerEffects = { mottle?: Mottle };
/**
 * The physical scale of a region's texture space: millimetres on the skin per unit of authored UV along each axis,
 * and the size of one export texel in millimetres (the mottle grain's floor is two of them).
 */
export type SkinScale = Readonly<{ mmPerUv: Readonly<{ u: number; v: number }>; texelMm: number }>;

export const MOTTLE_LIMITS = Object.freeze({
  amount: Object.freeze({ min: 0, max: 1 }),
  grain: Object.freeze({ min: .25, max: 3 }),
  clumping: Object.freeze({ min: 0, max: 1 }),
  angle: Object.freeze({ min: 0, max: 180 }),
  length: Object.freeze({ min: 1, max: 8 }),
  seed: Object.freeze({ min: 0, max: 2147483647 }),
});
/** A newly turned-on streak's settings. */
export const DEFAULT_STREAK_ANGLE = 90;
export const DEFAULT_STREAK_LENGTH = 4;

export type MottlePresetId = "powder" | "cream" | "mascara" | "sponge";
export type MottleLook = Omit<Mottle, "model" | "seed">;
/**
 * Presets set every control but the seed at once. Powder is what turning mottle on starts from (VQ6: edges).
 * Sponge is the stippled, sponge-applied look (nails' ombré later).
 */
export const MOTTLE_PRESETS: Readonly<Record<MottlePresetId, Readonly<{ label: string; look: Readonly<MottleLook> }>>> = Object.freeze({
  powder: Object.freeze({ label: "Powder", look: Object.freeze({ amount: .55, grain: .4, clumping: .2, where: "edges" as const }) }),
  cream: Object.freeze({ label: "Cream", look: Object.freeze({ amount: .2, grain: 1.2, clumping: .85, where: "everywhere" as const }) }),
  mascara: Object.freeze({ label: "Mascara smudge", look: Object.freeze({ amount: .75, grain: .3, clumping: .3, where: "edges" as const,
    streaks: Object.freeze({ mode: "edge" as const, length: 5 }) }) }),
  sponge: Object.freeze({ label: "Sponge", look: Object.freeze({ amount: .5, grain: 1.6, clumping: .55, where: "everywhere" as const }) }),
});
export const MOTTLE_PRESET_IDS = Object.freeze(Object.keys(MOTTLE_PRESETS) as MottlePresetId[]);

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const within = (x: unknown, range: { min: number; max: number }) => typeof x === "number" && Number.isFinite(x) && x >= range.min && x <= range.max;
const keysAre = (value: Record<string, unknown>, keys: string) => Object.keys(value).sort().join() === keys;

/** Whether `value` is a valid `mottle-1` block: exactly its fields, each in range. */
export function validMottle(value: unknown): value is Mottle {
  if (!record(value) || value.model !== MOTTLE_MODEL) return false;
  const streaks = value.streaks;
  if (!keysAre(value, streaks === undefined ? "amount,clumping,grain,model,seed,where" : "amount,clumping,grain,model,seed,streaks,where")) return false;
  if (!within(value.amount, MOTTLE_LIMITS.amount) || !within(value.grain, MOTTLE_LIMITS.grain) ||
    !within(value.clumping, MOTTLE_LIMITS.clumping) || (value.where !== "edges" && value.where !== "everywhere") ||
    !Number.isInteger(value.seed) || !within(value.seed, MOTTLE_LIMITS.seed)) return false;
  if (streaks === undefined) return true;
  if (!record(streaks)) return false;
  if (streaks.mode === "edge") return keysAre(streaks, "length,mode") && within(streaks.length, MOTTLE_LIMITS.length);
  return streaks.mode === "angle" && keysAre(streaks, "angle,length,mode") && within(streaks.angle, MOTTLE_LIMITS.angle) &&
    within(streaks.length, MOTTLE_LIMITS.length);
}

/** 32-bit integer mixing (lowbias32): the only source of randomness in the tile. */
function mix(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
/** A seed derived from a layer ID (FNV-1a over its UTF-16 code units), used when mottle is turned on. */
export function mottleSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return mix(h >>> 0) & 0x7fffffff;
}
/** "Shuffle": the next seed after `seed`, deterministically (the action carries the result). */
export const nextMottleSeed = (seed: number) => mix((seed + 0x9e3779b9) >>> 0) & 0x7fffffff;
/** The settings a preset gives a layer, keeping its seed. */
export function mottlePreset(preset: MottlePresetId, seed: number): Mottle {
  const look = MOTTLE_PRESETS[preset].look;
  return { model: MOTTLE_MODEL, amount: look.amount, grain: look.grain, clumping: look.clumping, where: look.where,
    ...(look.streaks ? { streaks: { ...look.streaks } } : {}), seed };
}
/** The presets as plain data (ID, label, every setting but the seed), for a presentation's preset row. */
export function mottleCatalogue(): { id: MottlePresetId; label: string; look: MottleLook }[] {
  return MOTTLE_PRESET_IDS.map(id => ({ id, label: MOTTLE_PRESETS[id].label, look: structuredClone(MOTTLE_PRESETS[id].look) as MottleLook }));
}
/** The preset a layer's settings equal (seed aside), if any. */
export function matchingMottlePreset(mottle: Mottle): MottlePresetId | undefined {
  const { seed: _seed, ...look } = mottle;
  return MOTTLE_PRESET_IDS.find(id => JSON.stringify(canonical(mottlePreset(id, 0))) === JSON.stringify(canonical({ ...look, seed: 0 })));
}
const canonical = (m: Mottle) => Object.fromEntries(Object.entries(m).sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) =>
  [k, record(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)) : v]));

// ---- The tile -----------------------------------------------------------------------------------------------------

/** Tile side in texels, texels per grain, and so the tile's period in grains (64). */
const SIZE = 512, PER_GRAIN = 8, PERIOD = SIZE / PER_GRAIN;
const LEVELS = Math.log2(SIZE) + 1;
/** Pore pit radius in grains: a pit is one grain across, so the grain is the size of the smallest visible feature. */
const PORE_RADIUS = .5;
/** Samples along a streak's line kernel. */
const STREAK_SAMPLES = 7;
type Pyramid = Float32Array[];

const unit = (seed: number, a: number, b: number, c: number) => mix(mix(mix(mix(seed ^ 0x5bd1e995) ^ a) ^ b) ^ c) / 4294967296;

/** Zero mean, then scaled so the largest magnitude is 1. */
function normalise(values: Float32Array) {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  const mean = sum / values.length;
  let peak = 0;
  for (let i = 0; i < values.length; i++) peak = Math.max(peak, Math.abs(values[i] - mean));
  const scale = peak > 0 ? 1 / peak : 0;
  for (let i = 0; i < values.length; i++) values[i] = (values[i] - mean) * scale;
  // Remove the float32 rounding of the mean so each level's mean is as close to zero as its precision allows.
  let residual = 0;
  for (let i = 0; i < values.length; i++) residual += values[i];
  residual /= values.length;
  for (let i = 0; i < values.length; i++) values[i] -= residual;
  return values;
}
/** Box-filtered periodic mip chain (every level keeps level 0's mean). */
function pyramid(base: Float32Array): Pyramid {
  const levels: Pyramid = [base];
  for (let size = SIZE >> 1; size >= 1; size >>= 1) {
    const above = levels[levels.length - 1], next = new Float32Array(size * size), wide = size * 2;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = 2 * y * wide + 2 * x;
      next[y * size + x] = (above[i] + above[i + 1] + above[i + wide] + above[i + wide + 1]) * .25;
    }
    levels.push(next);
  }
  return levels;
}
/** Pores: inverted cellular noise, one jittered pit per grain cell, each with its own depth. Pits are negative. */
function pores(seed: number): Float32Array {
  const px = new Float64Array(PERIOD * PERIOD), py = new Float64Array(PERIOD * PERIOD), depth = new Float64Array(PERIOD * PERIOD);
  for (let j = 0; j < PERIOD; j++) for (let i = 0; i < PERIOD; i++) {
    const k = j * PERIOD + i;
    px[k] = i + unit(seed, 1, i, j); py[k] = j + unit(seed, 2, i, j); depth[k] = .5 + .5 * unit(seed, 3, i, j);
  }
  const out = new Float32Array(SIZE * SIZE), r2 = PORE_RADIUS * PORE_RADIUS;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const gx = (x + .5) / PER_GRAIN, gy = (y + .5) / PER_GRAIN, ci = Math.floor(gx), cj = Math.floor(gy);
    let pit = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj, k = ((j + PERIOD) % PERIOD) * PERIOD + ((i + PERIOD) % PERIOD);
      // The neighbour's point, moved into this period copy.
      const ox = px[k] + (i - ((i + PERIOD) % PERIOD)), oy = py[k] + (j - ((j + PERIOD) % PERIOD));
      const d2 = (gx - ox) ** 2 + (gy - oy) ** 2;
      if (d2 < r2) { const t = 1 - d2 / r2; pit = Math.max(pit, depth[k] * t * t); }
    }
    out[y * SIZE + x] = -pit;
  }
  return normalise(out);
}
/** Clumps: three octaves of periodic value noise (cells of 2, 1 and ½ grain), quintic interpolation. */
function clumps(seed: number): Float32Array {
  const out = new Float32Array(SIZE * SIZE);
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  for (const [octave, cells, weight] of [[0, PERIOD / 2, 1], [1, PERIOD, .5], [2, PERIOD * 2, .25]] as const) {
    const lattice = new Float64Array(cells * cells);
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) lattice[j * cells + i] = unit(seed, 10 + octave, i, j);
    const per = SIZE / cells;
    for (let y = 0; y < SIZE; y++) {
      const fy = (y + .5) / per - .5, j0 = Math.floor(fy), ty = fade(fy - j0), a = (j0 + cells) % cells, b = (j0 + 1 + cells) % cells;
      for (let x = 0; x < SIZE; x++) {
        const fx = (x + .5) / per - .5, i0 = Math.floor(fx), tx = fade(fx - i0), c = (i0 + cells) % cells, d = (i0 + 1 + cells) % cells;
        const top = lattice[a * cells + c] + (lattice[a * cells + d] - lattice[a * cells + c]) * tx;
        const bottom = lattice[b * cells + c] + (lattice[b * cells + d] - lattice[b * cells + c]) * tx;
        out[y * SIZE + x] += weight * (top + (bottom - top) * ty);
      }
    }
  }
  return normalise(out);
}

const tiles = new Map<number, { pores: Pyramid; clumps: Pyramid }>(), mixed = new Map<string, Pyramid>();
const remember = <K, V>(cache: Map<K, V>, key: K, value: V, cap: number) => {
  cache.set(key, value);
  while (cache.size > cap) cache.delete(cache.keys().next().value!);
  return value;
};
function tile(seed: number) {
  const hit = tiles.get(seed);
  if (hit) { tiles.delete(seed); tiles.set(seed, hit); return hit; }
  return remember(tiles, seed, { pores: pyramid(pores(seed)), clumps: pyramid(clumps(seed)) }, 4);
}
/** The tile a layer samples: its seed's pores and clumps mixed by `clumping`, with its mip chain. */
export function mottleTile(seed: number, clumping: number): readonly Float32Array[] {
  const key = `${seed}:${clumping}`, hit = mixed.get(key);
  if (hit) { mixed.delete(key); mixed.set(key, hit); return hit; }
  const source = tile(seed), k = clumping;
  return remember(mixed, key, source.pores.map((level, l) => {
    const other = source.clumps[l], out = new Float32Array(level.length);
    for (let i = 0; i < level.length; i++) out[i] = level[i] * (1 - k) + other[i] * k;
    return out;
  }), 8);
}

// ---- Evaluation ---------------------------------------------------------------------------------------------------

/**
 * One layer's mottle, prepared for one raster: `apply(c, u, v, ex, ey, flipped)` returns the mottled coverage at
 * authored (u, v). `ex, ey` is the nearest contour edge's direction in UV at the sample (only read by edge streaks)
 * and `flipped` says the coverage came from a symmetric layer's mirrored copy.
 */
export type PreparedMottle = {
  readonly streaks: "none" | "angle" | "edge";
  apply(c: number, u: number, v: number, ex: number, ey: number, flipped: boolean): number;
};

/**
 * Prepare `mottle` for a raster whose texels are `spacing` apart in UV (1/size for a head-UV raster; the window's
 * texel size for a window raster), on a region with `skin` scale and `mirror`.
 */
export function prepareMottle(mottle: Mottle, skin: SkinScale, spacing: { u: number; v: number }, mirror: Mirror): PreparedMottle {
  const grain = Math.max(mottle.grain, 2 * skin.texelMm);
  // Tile texels per unit UV along each axis (tile texels are square in skin millimetres).
  const scaleU = skin.mmPerUv.u / grain * PER_GRAIN, scaleV = skin.mmPerUv.v / grain * PER_GRAIN;
  const footprint = Math.max(spacing.u * scaleU, spacing.v * scaleV);
  const lod = Math.min(LEVELS - 1, Math.max(0, Math.log2(Math.max(1, footprint))));
  const levels = mottleTile(mottle.seed, mottle.clumping), l0 = Math.min(LEVELS - 2, Math.floor(lod)), blend = lod - l0;
  const fine = levels[l0], coarse = levels[l0 + 1], fineSize = SIZE >> l0, coarseSize = fineSize >> 1;
  const fineScale = 1 / (1 << l0), coarseScale = fineScale / 2;
  const bilinear = (level: Float32Array, size: number, x: number, y: number) => {
    x -= .5; y -= .5;
    const fx = Math.floor(x), fy = Math.floor(y), tx = x - fx, ty = y - fy, m = size - 1;
    const x0 = fx & m, x1 = (fx + 1) & m, r0 = (fy & m) * size, r1 = ((fy + 1) & m) * size;
    const top = level[r0 + x0] + (level[r0 + x1] - level[r0 + x0]) * tx;
    const bottom = level[r1 + x0] + (level[r1 + x1] - level[r1 + x0]) * tx;
    return top + (bottom - top) * ty;
  };
  const noise = blend === 0 ? (x: number, y: number) => bilinear(fine, fineSize, x * fineScale, y * fineScale)
    : (x: number, y: number) => {
      const a = bilinear(fine, fineSize, x * fineScale, y * fineScale);
      return a + (bilinear(coarse, coarseSize, x * coarseScale, y * coarseScale) - a) * blend;
    };
  const amount = mottle.amount, edges = mottle.where === "edges", streaks = mottle.streaks;
  const flipU = mirror.axis === "u";
  // Streak line kernel: offsets along the direction in tile texels, and the gain that restores the contrast the
  // average removes (about one independent sample per grain of length).
  const reach = streaks ? streaks.length * PER_GRAIN : 0, gain = streaks ? Math.sqrt(Math.min(STREAK_SAMPLES, 1 + streaks.length)) / STREAK_SAMPLES : 0;
  const offsets = Array.from({ length: STREAK_SAMPLES }, (_, k) => (k / (STREAK_SAMPLES - 1) - .5) * reach);
  let angleX = 0, angleY = 0;
  if (streaks?.mode === "angle") { const r = streaks.angle * Math.PI / 180; angleX = Math.cos(r); angleY = Math.sin(r); }
  const mmU = skin.mmPerUv.u, mmV = skin.mmPerUv.v;
  const streaked = (x: number, y: number, dx: number, dy: number) => {
    let sum = 0;
    for (let k = 0; k < STREAK_SAMPLES; k++) sum += noise(x + dx * offsets[k], y + dy * offsets[k]);
    return sum * gain;
  };
  return {
    streaks: streaks ? streaks.mode : "none",
    apply(c, u, v, ex, ey, flipped) {
      if (!(c > 0)) return c;
      const w = edges ? 4 * c * (1 - c) : c;
      if (w === 0) return c;
      const x = u * scaleU, y = v * scaleV;
      let d: number;
      if (!streaks) d = noise(x, y);
      else {
        // The direction in skin millimetres (tile texels are square there), mirrored for a mirrored copy.
        let dx: number, dy: number;
        if (streaks.mode === "angle") { dx = angleX; dy = angleY; }
        else { dx = -ey * mmV; dy = ex * mmU; }
        if (flipped) { if (flipU) dx = -dx; else dy = -dy; }
        const length = Math.sqrt(dx * dx + dy * dy);
        d = length > 0 ? streaked(x, y, dx / length, dy / length) : noise(x, y);
      }
      const out = c + amount * w * d;
      return out <= 0 ? 0 : out >= 1 ? 1 : out;
    },
  };
}
