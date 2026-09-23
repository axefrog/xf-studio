import { clamp, curve, type Point } from "./recipe";

export type PathUV = { u: number; v: number };
/** Display pixels per UV unit, after the editor's crop/aspect mapping. */
export type PathPixelScale = { u: number; v: number };
export type PathSection = {
  /** Original knot before the selected section, including the closing section. */
  segment: number;
  /** Array splice position; the closing section inserts at points.length. */
  index: number;
  /** Approximate original curve parameter, based on the displayed tessellation. */
  t: number;
  nearest: PathUV;
  weight: number;
  distancePx: number;
};

const steps = 10; // Matches curve() and the UV editor's displayed polyline.
const maxPoints = 24;
const finiteUV = (p: PathUV) =>
  p != null && Number.isFinite(p.u) && Number.isFinite(p.v);

/**
 * Find the closest displayed section in pixel space. The caller maps mirrored
 * instances back into source UV first. Exact/numerically equivalent ties retain
 * the earliest section in path order; zero-length sections remain selectable.
 */
export function nearestPathSection(
  points: Point[],
  click: PathUV,
  scale: PathPixelScale,
): PathSection | null {
  if (
    !Array.isArray(points) || points.length < 3 || points.length > maxPoints ||
    points.some(p => !finiteUV(p) || p.u < 0 || p.u > 1 || p.v < 0 || p.v > 1 ||
      !Number.isFinite(p.weight) || p.weight < 0 || p.weight > 1) ||
    !finiteUV(click) || !finiteUV(scale) || scale.u <= 0 || scale.v <= 0
  ) return null;

  const path = curve(points, steps);
  let result: PathSection | null = null;
  let best = Infinity;
  for (let i = 0; i < path.length; i++) {
    const a = path[i], b = path[(i + 1) % path.length];
    const dx = (b.u - a.u) * scale.u, dy = (b.v - a.v) * scale.v;
    const x = (click.u - a.u) * scale.u, y = (click.v - a.v) * scale.v;
    const length2 = dx * dx + dy * dy;
    const localT = length2 > 0 ? clamp((x * dx + y * dy) / length2) : 0;
    const distance2 = (x - dx * localT) ** 2 + (y - dy * localT) ** 2;
    const tie = 32 * Number.EPSILON * Math.max(best, distance2);
    if (result && !(distance2 < best - tie)) continue;
    best = distance2;
    const segment = Math.floor(i / steps);
    const t = (i % steps + localT) / steps;
    result = {
      segment,
      index: segment + 1,
      t,
      nearest: { u: a.u + (b.u - a.u) * localT, v: a.v + (b.v - a.v) * localT },
      weight: points[segment].weight * (1 - t) + points[(segment + 1) % points.length].weight * t,
      distancePx: Math.sqrt(distance2),
    };
  }
  return result;
}

/**
 * Add the clicked position to the nearest section, inheriting that section's
 * interpolated strength. This edits a Catmull–Rom knot list: adding a knot can
 * change neighboring curvature; it is not an exact shape-preserving split.
 * Neither the input array nor its points is mutated. A full/invalid path is a
 * no-op (null), so callers must not add an Undo entry or change selection.
 */
export function insertPathPoint(
  points: Point[],
  click: PathUV,
  scale: PathPixelScale,
): (PathSection & { point: Point; points: Point[] }) | null {
  if (!Array.isArray(points) || points.length >= maxPoints) return null;
  const section = nearestPathSection(points, click, scale);
  if (!section) return null;
  const point = { u: clamp(click.u), v: clamp(click.v), weight: section.weight };
  const next = points.map(p => ({ ...p }));
  next.splice(section.index, 0, point);
  return { ...section, point, points: next };
}
