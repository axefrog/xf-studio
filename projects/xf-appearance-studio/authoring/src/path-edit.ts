import { bezierAt, interpolatedFeather, splitBezierSegment, tessellateBezier } from "./bezier-path";
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

  if (points.every(p => p.handles)) {
    const samples = tessellateBezier(points);
    let result: PathSection | null = null, best = Infinity;
    const distance = (segment: number, t: number) => {
      const p = bezierAt(points, segment, t);
      return ((p.u - click.u) * scale.u) ** 2 + ((p.v - click.v) * scale.v) ** 2;
    };
    const consider = (segment: number, t: number) => {
      const d = distance(segment, t), tie = 32 * Number.EPSILON * Math.max(best, d);
      if (result && !(d < best - tie)) return;
      best = d;
      const p = bezierAt(points, segment, t);
      result = { segment, index: segment + 1, t, nearest: { u: p.u, v: p.v }, weight: p.weight, distancePx: Math.sqrt(d) };
    };
    for (let i = 0; i < samples.length; i++) {
      const a = samples[i], b = samples[(i + 1) % samples.length];
      let lo = a.t, hi = b.segment === a.segment ? b.t : 1;
      consider(a.segment, lo); consider(a.segment, hi);
      // Refine every adaptive interval rather than trusting one global Newton
      // seed. Endpoints remain explicit candidates for cusps and collapsed arms.
      const ratio = (Math.sqrt(5) - 1) / 2;
      let left = hi - ratio * (hi - lo), right = lo + ratio * (hi - lo);
      let dl = distance(a.segment, left), dr = distance(a.segment, right);
      for (let j = 0; j < 40; j++) {
        if (dl < dr) { hi = right; right = left; dr = dl; left = hi - ratio * (hi - lo); dl = distance(a.segment, left); }
        else { lo = left; left = right; dl = dr; right = lo + ratio * (hi - lo); dr = distance(a.segment, right); }
      }
      consider(a.segment, (lo + hi) / 2);
    }
    return result;
  }
  if (points.some(p => p.handles)) return null;
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
 * Bézier paths snap to and split the continuous cubic. Legacy paths add the
 * clicked position to the nearest section, inheriting that section's
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
  if (points.every(p => p.handles)) {
    const next = splitBezierSegment(points, section.segment, section.t);
    if (!next) return null;
    return { ...section, point: next[section.index], points: next };
  }
  const a = points[section.segment], b = points[(section.segment + 1) % points.length];
  const point: Point = { u: clamp(click.u), v: clamp(click.v), weight: section.weight,
    ...interpolatedFeather(a,b,section.t) };
  const next = points.map(p => ({ ...p }));
  next.splice(section.index, 0, point);
  return { ...section, point, points: next };
}
