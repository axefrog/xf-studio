/**
 * Where a layer's makeup is cut off by the edge of the surface it is drawn on (PREV-146). Pure: arrays in, numbers out.
 *
 * A layered surface (eye makeup's expanded eye plate) covers only part of the head. The game draws the exported decal on that mesh
 * alone (`mesh_decal` has no edge fade: research/materials/mesh-decal-shader-contract.md), and the preview draws the same mesh, so
 * makeup whose coverage has not fallen to nothing by the surface's outer edge ends there in a hard line: a soft wash feathered past the
 * plate's top shows as a thin seam above the brows, in game as in the preview. Output is left as authored (the maintainer's choice:
 * warn, don't fade); this finds the edge segments where a layer still has coverage, so the editor can say so where the layer is edited.
 *
 * The outline is the surface's outer boundary in UV: triangle edges used once (vertices welded by position, so UV and normal seams of
 * the head cut don't count), assembled into loops; a loop inside another (the eye openings) is a hole, where makeup meeting the lid
 * margin is expected, and is left out.
 */
import { layerCoverageSampler, type Layer } from "./recipe";
import type { Mirror } from "./region";

/** The surface's outer boundary: one UV segment per boundary edge, `u0, v0, u1, v1` each. */
export type SurfaceOutline = Readonly<{ segments: Float64Array }>;

/**
 * Smallest coverage byte at an edge sample that counts as cut off: 2/255 of black darkens the skin by about 1.6 %, around where a hard
 * line starts to show on smooth skin (the plate-reach test's threshold, plate-reach.ts `PLATE_REACH_MIN_BYTE`).
 */
export const EDGE_REACH_MIN_BYTE = 2;
/** Samples per edge segment, its start included (the next segment's start is its end). */
const SAMPLES_PER_SEGMENT = 3;

/** The outer boundary of a triangle mesh in UV (see the header). `index` null: consecutive triples. */
export function surfaceOutline(mesh: { positions: ArrayLike<number>; uvs: ArrayLike<number>; index: ArrayLike<number> | null }): SurfaceOutline {
  const vertexCount = Math.floor(mesh.positions.length / 3);
  const indexAt = (i: number) => mesh.index ? mesh.index[i]! : i, triangles = Math.floor((mesh.index?.length ?? vertexCount) / 3);
  // Weld by position (0.01 mm), so split vertices at the head's UV or normal seams share one key.
  const keys = new Map<string, number>(), weld = new Int32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const key = `${Math.round(mesh.positions[3 * v]! * 1e5)},${Math.round(mesh.positions[3 * v + 1]! * 1e5)},${Math.round(mesh.positions[3 * v + 2]! * 1e5)}`;
    let id = keys.get(key);
    if (id === undefined) { id = keys.size; keys.set(key, id); }
    weld[v] = id;
  }
  // Edges by welded ends: how many triangles use each, and one directed occurrence (vertex indices, for their UVs).
  const edges = new Map<number, { count: number; a: number; b: number }>(), welded = keys.size;
  for (let t = 0; t < triangles; t++) for (let k = 0; k < 3; k++) {
    const a = indexAt(3 * t + k), b = indexAt(3 * t + (k + 1) % 3), wa = weld[a]!, wb = weld[b]!;
    if (wa === wb) continue;
    const key = Math.min(wa, wb) * welded + Math.max(wa, wb), entry = edges.get(key);
    if (entry) entry.count++; else edges.set(key, { count: 1, a, b });
  }
  const boundary = [...edges.values()].filter(edge => edge.count === 1);
  // Loops: follow each boundary edge's end to the next boundary edge leaving it.
  const leaving = new Map<number, number[]>();
  boundary.forEach((edge, i) => { const from = weld[edge.a]!; leaving.set(from, [...leaving.get(from) ?? [], i]); });
  const used = new Uint8Array(boundary.length), loops: number[][] = [];
  for (let start = 0; start < boundary.length; start++) {
    if (used[start]) continue;
    const loop: number[] = [];
    for (let i: number | undefined = start; i !== undefined && !used[i];) {
      used[i] = 1; loop.push(i);
      i = leaving.get(weld[boundary[i]!.b]!)?.find(next => !used[next]);
    }
    loops.push(loop);
  }
  const uv = (v: number): [number, number] => [mesh.uvs[2 * v]!, mesh.uvs[2 * v + 1]!];
  const polygons = loops.map(loop => loop.map(i => uv(boundary[i]!.a)));
  const inside = (point: readonly [number, number], polygon: readonly (readonly [number, number])[]) => {
    let odd = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [ui, vi] = polygon[i]!, [uj, vj] = polygon[j]!;
      if ((vi > point[1]) !== (vj > point[1]) && point[0] < (uj - ui) * (point[1] - vi) / (vj - vi) + ui) odd = !odd;
    }
    return odd;
  };
  const outer = loops.filter((_, i) => !polygons.some((other, j) => j !== i && other.length > 2 && inside(polygons[i]![0]!, other)));
  const segments = new Float64Array(outer.reduce((sum, loop) => sum + loop.length, 0) * 4);
  let o = 0;
  for (const loop of outer) for (const i of loop) {
    const [u0, v0] = uv(boundary[i]!.a), [u1, v1] = uv(boundary[i]!.b);
    segments[o++] = u0; segments[o++] = v0; segments[o++] = u1; segments[o++] = v1;
  }
  return { segments };
}

const reachCache = new WeakMap<SurfaceOutline, WeakMap<Layer, Float64Array>>();

/**
 * The outline segments where `layer` (shown, mirrored across `mirror` when symmetric) still has coverage of at least
 * EDGE_REACH_MIN_BYTE / 255 at a sample: empty when the layer fades out inside the surface. Cached per layer object.
 */
export function layerEdgeReach(layer: Layer, outline: SurfaceOutline, mirror: Mirror): Float64Array {
  let byLayer = reachCache.get(outline);
  if (!byLayer) { byLayer = new WeakMap(); reachCache.set(outline, byLayer); }
  const cached = byLayer.get(layer);
  if (cached) return cached;
  const sample = layerCoverageSampler(layer.enabled ? layer : { ...layer, enabled: true }, mirror), { segments } = outline;
  const reached: number[] = [];
  for (let s = 0; s < segments.length; s += 4) {
    const u0 = segments[s]!, v0 = segments[s + 1]!, du = segments[s + 2]! - u0, dv = segments[s + 3]! - v0;
    for (let k = 0; k <= SAMPLES_PER_SEGMENT; k++) {
      const t = k / SAMPLES_PER_SEGMENT;
      if (Math.round(255 * sample(u0 + t * du, v0 + t * dv)) >= EDGE_REACH_MIN_BYTE) { reached.push(s); break; }
    }
  }
  const out = new Float64Array(reached.length * 4);
  reached.forEach((s, i) => out.set(segments.subarray(s, s + 4), i * 4));
  byLayer.set(layer, out);
  return out;
}
