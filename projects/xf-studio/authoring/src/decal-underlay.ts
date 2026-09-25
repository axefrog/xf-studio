/**
 * The surface under a decal mesh, per decal vertex: the nearest vertex of the drawn head (same bind space) and a bilinear
 * read of a head image at that vertex's UV. Decals over the skin blend against the skin's colour and roughness here,
 * because a forward renderer cannot read the G-buffer under the decal (face-decal-material.ts). Pure over typed arrays.
 */
import type { SkinTexels } from "./skin-material";

export type NearestVertices = {
  /** Nearest source vertex per target vertex, or −1 when none lies within the distance limit. */
  index: Int32Array;
  maxMatchedDistance: number;
  unmatched: number;
};

/**
 * Nearest source vertex for every target vertex within `maxDistance`, through a uniform grid of that cell size (the same
 * answer as a full search, in time proportional to the vertices, not their product).
 */
export function nearestVertices(targetPositions: ArrayLike<number>, sourcePositions: ArrayLike<number>, maxDistance = 0.02): NearestVertices {
  const targets = targetPositions.length / 3, sources = sourcePositions.length / 3;
  // Cells of a few millimetres (about the head's vertex spacing), searched in growing shells until no closer vertex can exist.
  const cell = Math.max(1e-6, Math.min(maxDistance, 0.004));
  const rings = Math.ceil(maxDistance / cell);
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const grid = new Map<string, number[]>();
  for (let s = 0; s < sources; s++) {
    const k = key(Math.floor(sourcePositions[s * 3]! / cell), Math.floor(sourcePositions[s * 3 + 1]! / cell), Math.floor(sourcePositions[s * 3 + 2]! / cell));
    const bucket = grid.get(k);
    if (bucket) bucket.push(s); else grid.set(k, [s]);
  }
  const index = new Int32Array(targets).fill(-1);
  let maxMatchedDistance = 0, unmatched = 0;
  const limit = maxDistance * maxDistance;
  for (let t = 0; t < targets; t++) {
    const tx = targetPositions[t * 3]!, ty = targetPositions[t * 3 + 1]!, tz = targetPositions[t * 3 + 2]!;
    const cx = Math.floor(tx / cell), cy = Math.floor(ty / cell), cz = Math.floor(tz / cell);
    let best = -1, bestD = Infinity;
    for (let ring = 0; ring <= rings; ring++) {
      // Every vertex in shell `ring` is at least (ring − 1) cells away.
      if (best >= 0 && ((ring - 1) * cell) ** 2 > bestD) break;
      for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) for (let dz = -ring; dz <= ring; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== ring) continue;
        const bucket = grid.get(key(cx + dx, cy + dy, cz + dz));
        if (!bucket) continue;
        for (const s of bucket) {
          const ex = sourcePositions[s * 3]! - tx, ey = sourcePositions[s * 3 + 1]! - ty, ez = sourcePositions[s * 3 + 2]! - tz;
          const d = ex * ex + ey * ey + ez * ez;
          if (d < bestD || (d === bestD && s < best)) { bestD = d; best = s; }
        }
      }
    }
    if (best < 0 || bestD > limit) { unmatched++; continue; }
    index[t] = best;
    maxMatchedDistance = Math.max(maxMatchedDistance, Math.sqrt(bestD));
  }
  return { index, maxMatchedDistance, unmatched };
}

/**
 * Bilinear read of `channels` of an image at each matched vertex's source UV (wrapped into 0–1); unmatched vertices read
 * zero. `decode` turns a stored byte into the value wanted (e.g. sRGB decoding for colour, byte/255 for data).
 */
export function sampleAtVertices(nearest: NearestVertices, sourceUvs: ArrayLike<number>, image: SkinTexels, channels: number,
  decode: (byte: number, channel: number) => number): Float32Array {
  const out = new Float32Array(nearest.index.length * channels);
  const texel = (x: number, y: number, c: number) =>
    decode(image.texel(Math.min(image.width - 1, Math.max(0, x)), Math.min(image.height - 1, Math.max(0, y)), c), c);
  nearest.index.forEach((source, t) => {
    if (source < 0) return;
    const u = (sourceUvs[source * 2]! % 1 + 1) % 1, v = (sourceUvs[source * 2 + 1]! % 1 + 1) % 1;
    const fx = u * image.width - 0.5, fy = v * image.height - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), wx = fx - x0, wy = fy - y0;
    for (let c = 0; c < channels; c++)
      out[t * channels + c] = (texel(x0, y0, c) * (1 - wx) + texel(x0 + 1, y0, c) * wx) * (1 - wy) +
        (texel(x0, y0 + 1, c) * (1 - wx) + texel(x0 + 1, y0 + 1, c) * wx) * wy;
  });
  return out;
}

/** sRGB byte → linear. */
export const decodeSrgbByte = (byte: number) => { const c = byte / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
