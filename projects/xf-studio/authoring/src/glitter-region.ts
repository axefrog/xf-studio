// Geometry of a diagnostic glitter region (glitter-route.ts): the UV rectangle its flakes are drawn over and the
// flake budget. Pure: no IO. Planning (preset-collection.ts) and the bake use the same rules, so Check and Build
// agree; the independent verifier restates them (mod-verifier/resource-checks.ts).
//
// A region's rectangle is its layer's **outline bounds** (PIPE-72): everywhere the layer's coverage can be non-zero.
// - The drawn curve lies inside the convex hull of its control polygon: each knot and both tangent endpoints on a
//   Bézier outline (every knot has handles), or on a Catmull–Rom outline each knot b with the equivalent Bézier
//   controls b + (c − a)/6 and c − (d − b)/6 of the segment b → c (a, d its neighbours), which covers overshoot.
// - Coverage reaches half the softness width outside the curve (x = ½ + d/w in recipe.ts); the widest width is the
//   layer feather or the largest knot feather.
// - Warp fields move the sampled point by at most the summed |du| and |dv|.
// Build then clips the rectangle to the plate window before sizing the catalogue (PIPE-69); planning, which knows no
// plate yet, clips to the unit square, so its flake count bounds the window's from above.
import type { Layer } from "./engines/layered-makeup/recipe";

/** Area-weighted median world length per unit UV on the plate (experiment 018, built-in plate): U and V, in mm. */
export const MM_PER_UV = { u: 569, v: 405 } as const;
/** The most flakes one region may draw (its catalogue), so a build stays within its time and memory budget. */
export const MAX_REGION_FLAKES = 200_000;
/** Regular hexagon area / width². */
export const HEX_AREA = 3 * Math.sqrt(3) / 8;

export type RectUv = { u0: number; v0: number; u1: number; v1: number };
type RegionLayer = Pick<Layer, "id" | "points" | "symmetry" | "feather" | "fields">;
type FlakeSize = { sizeMm: number; sizeSigma: number; cover: number };

/** The UV rectangle a layer's coverage can reach (the rule above). A mirrored (symmetry) layer is refused. */
export function layerOutlineBounds(layer: RegionLayer): RectUv {
  if (layer.symmetry) throw Error(`Glitter region layer ${layer.id} is mirrored by symmetry; give each lid its own layer.`);
  const points = layer.points, n = points.length, hull: { u: number; v: number }[] = [];
  if (n && points.every(p => p.handles)) {
    for (const p of points) hull.push(p, { u: p.u + p.handles!.in.u, v: p.v + p.handles!.in.v }, { u: p.u + p.handles!.out.u, v: p.v + p.handles!.out.v });
  } else {
    for (let i = 0; i < n; i++) {
      const a = points[(i + n - 1) % n], b = points[i], c = points[(i + 1) % n], d = points[(i + 2) % n];
      hull.push(b, { u: b.u + (c.u - a.u) / 6, v: b.v + (c.v - a.v) / 6 }, { u: c.u - (d.u - b.u) / 6, v: c.v - (d.v - b.v) / 6 });
    }
  }
  let width = layer.feather;
  for (const p of points) if (p.feather !== undefined && p.feather > width) width = p.feather;
  let warpU = 0, warpV = 0;
  for (const field of layer.fields) { warpU += Math.abs(field.du); warpV += Math.abs(field.dv); }
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const p of hull) { if (p.u < u0) u0 = p.u; if (p.u > u1) u1 = p.u; if (p.v < v0) v0 = p.v; if (p.v > v1) v1 = p.v; }
  const padU = width / 2 + warpU, padV = width / 2 + warpV;
  return { u0: u0 - padU, v0: v0 - padV, u1: u1 + padU, v1: v1 + padV };
}

/** `rect` clipped to `bounds`; null when nothing is left. */
export function clipRect(rect: RectUv, bounds: RectUv): RectUv | null {
  const out = { u0: Math.max(rect.u0, bounds.u0), v0: Math.max(rect.v0, bounds.v0), u1: Math.min(rect.u1, bounds.u1), v1: Math.min(rect.v1, bounds.v1) };
  return out.u1 > out.u0 && out.v1 > out.v0 ? out : null;
}
export const UNIT_SQUARE: RectUv = Object.freeze({ u0: 0, v0: 0, u1: 1, v1: 1 });

/** A region's rectangle in window millimetres (x from the window's u0, y from its authored v0) and its area. */
export function rectMm(rect: RectUv, window: RectUv) {
  const x0 = (rect.u0 - window.u0) * MM_PER_UV.u, x1 = (rect.u1 - window.u0) * MM_PER_UV.u;
  const y0 = (rect.v0 - window.v0) * MM_PER_UV.v, y1 = (rect.v1 - window.v0) * MM_PER_UV.v;
  return { x0, x1, y0, y1, area: (x1 - x0) * (y1 - y0) };
}
/** Flakes a region's catalogue holds: its cover over the rectangle's area, in flakes of the mean (log-normal, hexagon-like) area. */
export function flakeCount(rect: RectUv, window: RectUv, f: FlakeSize): number {
  const meanArea = HEX_AREA * f.sizeMm ** 2 * Math.exp(2 * f.sizeSigma ** 2) * 1.2;
  return Math.round(f.cover * rectMm(rect, window).area / meanArea);
}

/** Plain refusal when a region's catalogue would exceed the budget. */
export function checkFlakeBudget(count: number, layer: string, preset: string) {
  if (count > MAX_REGION_FLAKES)
    throw Error(`Glitter region ${layer} of ${preset} would draw about ${count.toLocaleString("en-US")} flakes, more than the ` +
      `${MAX_REGION_FLAKES.toLocaleString("en-US")} one region may hold. Use a smaller layer, larger flakes or a lower cover.`);
}

/**
 * Planning's view of a glitter knob against its preset's layers (PIPE-69, PIPE-71): every region layer has outline
 * bounds (no symmetry) that reach the unit square, and no region's catalogue exceeds the budget there.
 */
export function checkRegionPlan(preset: string, layers: ReadonlyMap<string, RegionLayer>,
  regions: readonly { layer: string; flakes?: FlakeSize }[]) {
  for (const region of regions) {
    const layer = layers.get(region.layer)!, rect = clipRect(layerOutlineBounds(layer), UNIT_SQUARE);
    if (!rect) throw Error(`Glitter region ${region.layer} of ${preset} lies outside the head's UV square.`);
    // A mirrored region draws its source's catalogue; its own rectangle only places the sheen.
    if (region.flakes) checkFlakeBudget(flakeCount(rect, UNIT_SQUARE, region.flakes), region.layer, preset);
  }
}
