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
 * A uniform grid over a set of source vertices, built once and searched for many targets (PREV-106: the body's shape is searched by
 * every garment of a load). Cells of a few millimetres (about the head's vertex spacing) are keyed by one number within the sources'
 * bounds (no string per lookup), and a target farther than `maxDistance` outside those bounds is unmatched without a search.
 */
export class VertexGrid {
  private readonly cell: number;
  private readonly rings: number;
  private readonly origin: [number, number, number];
  private readonly size: [number, number, number];
  private readonly cells = new Map<number, number[]>();
  private readonly low: [number, number, number];
  private readonly high: [number, number, number];
  constructor(private readonly sourcePositions: ArrayLike<number>, readonly maxDistance = 0.02) {
    this.cell = Math.max(1e-6, Math.min(maxDistance, 0.004));
    this.rings = Math.ceil(maxDistance / this.cell);
    const sources = sourcePositions.length / 3;
    const low: [number, number, number] = [Infinity, Infinity, Infinity], high: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let s = 0; s < sources; s++) for (let k = 0; k < 3; k++) {
      const v = sourcePositions[s * 3 + k]!;
      if (v < low[k]!) low[k] = v;
      if (v > high[k]!) high[k] = v;
    }
    this.low = low; this.high = high;
    const cellOf = (v: number) => Math.floor(v / this.cell);
    this.origin = sources ? [cellOf(low[0]), cellOf(low[1]), cellOf(low[2])] : [0, 0, 0];
    this.size = sources ? [cellOf(high[0]) - this.origin[0] + 1, cellOf(high[1]) - this.origin[1] + 1, cellOf(high[2]) - this.origin[2] + 1] : [0, 0, 0];
    for (let s = 0; s < sources; s++) {
      const key = this.key(cellOf(sourcePositions[s * 3]!), cellOf(sourcePositions[s * 3 + 1]!), cellOf(sourcePositions[s * 3 + 2]!))!;
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(s); else this.cells.set(key, [s]);
    }
  }
  /** A cell's number, or null outside the sources' cells (no vertex there). */
  private key(x: number, y: number, z: number): number | null {
    const i = x - this.origin[0], j = y - this.origin[1], k = z - this.origin[2];
    if (i < 0 || j < 0 || k < 0 || i >= this.size[0] || j >= this.size[1] || k >= this.size[2]) return null;
    return (i * this.size[1] + j) * this.size[2] + k;
  }
  /** Nearest source vertex for every target vertex within the grid's distance (the same answer as a full search). */
  nearest(targetPositions: ArrayLike<number>): NearestVertices {
    const targets = targetPositions.length / 3, cell = this.cell, reach = this.maxDistance, source = this.sourcePositions;
    const index = new Int32Array(targets).fill(-1);
    let maxMatchedDistance = 0, unmatched = 0;
    const limit = reach * reach;
    for (let t = 0; t < targets; t++) {
      const tx = targetPositions[t * 3]!, ty = targetPositions[t * 3 + 1]!, tz = targetPositions[t * 3 + 2]!;
      // Farther than the reach outside the sources' bounds: nothing can be close enough.
      if (tx < this.low[0] - reach || ty < this.low[1] - reach || tz < this.low[2] - reach ||
        tx > this.high[0] + reach || ty > this.high[1] + reach || tz > this.high[2] + reach) { unmatched++; continue; }
      const cx = Math.floor(tx / cell), cy = Math.floor(ty / cell), cz = Math.floor(tz / cell);
      let best = -1, bestD = Infinity;
      for (let ring = 0; ring <= this.rings; ring++) {
        // Every vertex in shell `ring` is at least (ring − 1) cells away.
        if (best >= 0 && ((ring - 1) * cell) ** 2 > bestD) break;
        for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== ring) continue;
          const key = this.key(cx + dx, cy + dy, cz + dz);
          const bucket = key === null ? undefined : this.cells.get(key);
          if (!bucket) continue;
          for (const s of bucket) {
            const ex = source[s * 3]! - tx, ey = source[s * 3 + 1]! - ty, ez = source[s * 3 + 2]! - tz;
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
}

/**
 * Nearest source vertex for every target vertex within `maxDistance`, through a uniform grid of that cell size (the same
 * answer as a full search, in time proportional to the vertices, not their product).
 */
export function nearestVertices(targetPositions: ArrayLike<number>, sourcePositions: ArrayLike<number>, maxDistance = 0.02): NearestVertices {
  return new VertexGrid(sourcePositions, maxDistance).nearest(targetPositions);
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

/**
 * Per-vertex shape deltas carried over from a surface to a mesh lying on it: each target vertex takes the delta (3 per vertex) of its
 * nearest source vertex within `maxDistance`, zero where none is that close. A garment drawn over the body (the underwear cover) follows
 * the body's shape this way where the body's own shape keys move the surface under it (the breast size), as the game's garment system
 * keeps a garment over the body [hypothesis: an approximation of garment support; knowledge/body-rendering.md].
 */
export function transferDeltas(targetPositions: ArrayLike<number>, sourcePositions: ArrayLike<number> | VertexGrid, sourceDeltas: ArrayLike<number>,
  maxDistance = 0.02): { deltas: Float32Array; moved: number } {
  // A grid built once over the source (the body's shape, searched by every garment of a load) is reused as it is.
  const nearest = sourcePositions instanceof VertexGrid ? sourcePositions.nearest(targetPositions) : nearestVertices(targetPositions, sourcePositions, maxDistance);
  const deltas = new Float32Array(nearest.index.length * 3);
  let moved = 0;
  nearest.index.forEach((source, t) => {
    if (source < 0) return;
    const x = sourceDeltas[source * 3]!, y = sourceDeltas[source * 3 + 1]!, z = sourceDeltas[source * 3 + 2]!;
    deltas[t * 3] = x; deltas[t * 3 + 1] = y; deltas[t * 3 + 2] = z;
    if (x || y || z) moved++;
  });
  return { deltas, moved };
}
