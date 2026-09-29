// The car-paint metallic flake layer, measured (experiment 032, task 5). Offline; reads one extracted game texture.
//
//   bun experiments/033-finishes-rework/car-paint.ts PATH_TO_GAME [XBM]   # car-paint-result.json (asset-free numbers only)
//
// Input: `base\surfaces\materials\paint\car_paint\car_paint_01_n.xbm`, the normal map of `car_paint_metallic_01.mltemplate`
// (the layer the game's car paint setups use), extracted read-only with WolvenKit 9.0.1 into the ignored
// `research/consumers/car-paint/extracted/`. The game folder is read only for its Oodle library. The script reports the
// flake field's statistics as the multilayer shader would see them at the template's normal strength (0.66, override
// `d2b4dd` in the setups): the tilt distribution (and its share above `mesh_decal` mode 1's ≈ 11.5° fade), the correlation
// length (the flake size in texels) and how the mip chain keeps the tilt. Nothing from the texture is written out but numbers.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readCr2w } from "../../projects/xf-studio/authoring/src/native/cr2w-reader";
import { DecodeSession } from "../../projects/xf-studio/authoring/src/native/limits";
import { loadGameOodle } from "../../projects/xf-studio/authoring/src/native/oodle";
import { TEXTURE_READ_LIMITS } from "../../projects/xf-studio/authoring/src/native/texture-decode";
import { decodeMip, textureLayout } from "../../projects/xf-studio/authoring/src/native/xbm-texture";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "../..");
const game = process.argv[2];
if (!game) throw Error("Usage: bun car-paint.ts PATH_TO_GAME");
// The extracted texture: the checkout's ignored research folder unless a path is given (a worktree has no copy).
const file = process.argv[3] ?? join(root, "research/consumers/car-paint/extracted/base/surfaces/materials/paint/car_paint/car_paint_01_n.xbm");
if (!existsSync(file)) throw Error(`Extract ${file} first (see the README).`);
const bytes = new Uint8Array(readFileSync(file));
const layout = textureLayout(readCr2w(bytes, loadGameOodle(game).decompress, new DecodeSession(TEXTURE_READ_LIMITS)));
const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
/** The template's normal strength in the car setups (`normalStrength` override `d2b4dd`). */
const STRENGTH = .66;
const FADE_DEG = Math.acos(.98) * 180 / Math.PI;
const unorm = (b: number) => b / 255 * 2 - 1;

/** Tilt (degrees) of a decoded texel: the multilayer shader scales the tangent XY by the strength and renormalises. */
function tiltOf(data: Uint8Array, t: number, strength: number) {
  const x = unorm(data[t * 4]) * strength, y = unorm(data[t * 4 + 1]) * strength;
  const z = Math.sqrt(Math.max(0, 1 - (unorm(data[t * 4]) ** 2 + unorm(data[t * 4 + 1]) ** 2)));
  return Math.atan2(Math.hypot(x, y), Math.max(1e-6, z)) * 180 / Math.PI;
}
const percentile = (xs: Float64Array, p: number) => { const s = Float64Array.from(xs).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

function level(L: number) {
  const { width: w, height: h, data } = decodeMip(layout, L), n = w * h, tilt = new Float64Array(n), raw = new Float64Array(n), gx = new Float64Array(n);
  for (let t = 0; t < n; t++) { tilt[t] = tiltOf(data, t, STRENGTH); raw[t] = tiltOf(data, t, 1); gx[t] = unorm(data[t * 4]); }
  let mean = 0; for (const v of gx) mean += v; mean /= n;
  let variance = 0; for (const v of gx) variance += (v - mean) ** 2; variance /= n;
  // Correlation of the tangent X component with its neighbour `lag` texels along x (wrapping: the texture tiles).
  const correlation = (lag: number) => {
    let s = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) s += (gx[y * w + x] - mean) * (gx[y * w + (x + lag) % w] - mean);
    return variance > 0 ? s / n / variance : 0;
  };
  let half = 0;
  while (half < 32 && correlation(half + 1) > .5) half++;
  let above = 0; for (const v of tilt) if (v >= FADE_DEG) above++;
  return { level: L, width: w, height: h, rawTiltDeg: { median: +percentile(raw, .5).toFixed(2), p90: +percentile(raw, .9).toFixed(2) }, tiltDeg: { median: +percentile(tilt, .5).toFixed(2), p90: +percentile(tilt, .9).toFixed(2), max: +percentile(tilt, 1).toFixed(2) },
    shareAboveModeOneFade: +(above / n).toFixed(4), correlationLag1: +correlation(1).toFixed(3), flakeHalfWidthTexels: half };
}

const result = {
  texture: { path: "base\\surfaces\\materials\\paint\\car_paint\\car_paint_01_n.xbm", sha256, format: layout.format, width: layout.width, height: layout.height, mips: layout.mips.length },
  template: { path: "base\\surfaces\\materials\\paint\\car_paint\\car_paint_metallic_01.mltemplate", tilingMultiplier: 4, normalStrength: STRENGTH,
    roughLevelsOut: [.2667, 0], metalLevelsOut: [0, 1] },
  setup: { path: "…\\ml_v_standard2_chevalier_thrax_exterior_carpaint_clean_01.mlsetup", matTile: 15, tilesPerUv: 60 },
  modeOneFadeDeg: +FADE_DEG.toFixed(2),
  levels: [0, 1, 2, 3, 4].map(level),
};
writeFileSync(join(here, "car-paint-result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 1));
