import type { Layer, Point } from "./recipe";

export type UV = { u: number; v: number };
export type TangentSide = "in" | "out";
export type TangentMode = "aligned" | "symmetric" | "corner";
export type Handles = { in: UV; out: UV; mode: TangentMode };
export type BezierSample = Point & { segment: number; t: number };

export const BEZIER_TOLERANCE = 0.000025;

// For validated knots in [0,1] and vector components in [-1,1], both
// second differences have components at most 4. Subdivision reduces the
// control/chord error bound by 4 per level: 4*sqrt(2)/4^9 < tolerance.
// Thus depth 9 is a proved capacity bound for this recipe contract, not an
// intentional coarse fallback that can silently exceed the stated tolerance.
export const BEZIER_MAX_DEPTH = 9;
export const MAX_CURVE_POINTS = 24 * 2 ** BEZIER_MAX_DEPTH;

const mix = (a: UV, b: UV, t: number): UV => ({ u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t });
const vector = (a: UV, b: UV): UV => ({ u: a.u - b.u, v: a.v - b.v });
const finite = (p: UV) => Number.isFinite(p.u) && Number.isFinite(p.v);
const bounded = (p: UV) => finite(p) && Math.abs(p.u) <= 1 && Math.abs(p.v) <= 1;

export function tangentEndpoint(point: Point, side: TangentSide): UV {
  const h = point.handles?.[side];
  return { u: point.u + (h?.u ?? 0), v: point.v + (h?.v ?? 0) };
}

/** Pure conversion of the existing uniform Catmull–Rom cubic, without resampling. */
export function convertToBezier(layer: Layer): Layer {
  const result = structuredClone(layer);
  if (layer.pathMode === "bezier") return result;
  result.pathMode = "bezier";
  result.points = layer.points.map((p, i, points) => {
    const before = points[(i + points.length - 1) % points.length], after = points[(i + 1) % points.length];
    const out = { u: (after.u - before.u) / 6, v: (after.v - before.v) / 6 };
    return { ...p, handles: { in: { u: -out.u, v: -out.v }, out, mode: "symmetric" } };
  });
  return result;
}

/** Relative vectors survive knot movement; rejected edits leave input untouched. */
export function moveTangent(point: Point, side: TangentSide, endpoint: UV): Point {
  const result = structuredClone(point);
  if (!point.handles || !finite(endpoint)) return result;
  let moved = vector(endpoint, point);
  // Scale rather than independently clamp axes, retaining the dragged direction.
  const bound = Math.max(1, Math.abs(moved.u), Math.abs(moved.v));
  moved = { u: moved.u / bound, v: moved.v / bound };
  const other = side === "in" ? "out" : "in";
  result.handles![side] = moved;
  if (point.handles.mode === "symmetric") result.handles![other] = { u: -moved.u, v: -moved.v };
  else if (point.handles.mode === "aligned") {
    const length = Math.hypot(moved.u, moved.v), oldLength = Math.hypot(point.handles[other].u, point.handles[other].v);
    // At zero direction leave the other arm intact; a zero arm has no direction.
    if (length > 0) {
      let factor = oldLength / length;
      factor = Math.min(factor, 1 / Math.max(Math.abs(moved.u), Math.abs(moved.v)));
      result.handles![other] = { u: -moved.u * factor, v: -moved.v * factor };
    }
  }
  return result;
}

export function setPointMode(layer: Layer, index: number, mode: TangentMode): Layer {
  const result = structuredClone(layer), point = result.points[index];
  if (result.pathMode !== "bezier" || !point?.handles || !["aligned", "symmetric", "corner"].includes(mode)) return result;
  point.handles.mode = mode;
  // Outgoing arm is authoritative unless collapsed. Corner only decouples.
  if (mode !== "corner") {
    const side = Math.hypot(point.handles.out.u, point.handles.out.v) > 0 ? "out" : "in";
    result.points[index] = moveTangent(point, side, tangentEndpoint(point, side));
  }
  return result;
}

export function bezierAt(points: readonly Point[], segment: number, t: number): Point {
  const a = points[segment], b = points[(segment + 1) % points.length];
  const p = mix(a, tangentEndpoint(a, "out"), t), q = mix(tangentEndpoint(a, "out"), tangentEndpoint(b, "in"), t), r = mix(tangentEndpoint(b, "in"), b, t);
  const uv = mix(mix(p, q, t), mix(q, r, t), t);
  return { ...uv, weight: a.weight * (1 - t) + b.weight * t };
}

/** Common deterministic polygon for guides, alpha masks and compiler. */
export function tessellateBezier(points: readonly Point[]): BezierSample[] {
  const result: BezierSample[] = [];
  for (let segment = 0; segment < points.length; segment++) {
    const a = points[segment], b = points[(segment + 1) % points.length];
    const visit = (p: UV, q: UV, r: UV, s: UV, t0: number, t1: number, depth: number) => {
      // Comparing control points with the chord's 1/3 and 2/3 positions bounds
      // parametric deviation, including collinear loops and varying pigment.
      const c1 = mix(p, s, 1 / 3), c2 = mix(p, s, 2 / 3);
      const error = Math.max(Math.hypot(q.u - c1.u, q.v - c1.v), Math.hypot(r.u - c2.u, r.v - c2.v));
      if (error <= BEZIER_TOLERANCE || depth === BEZIER_MAX_DEPTH) {
        result.push({ ...p, weight: a.weight * (1 - t0) + b.weight * t0, segment, t: t0 });
        return;
      }
      const pq = mix(p, q, .5), qr = mix(q, r, .5), rs = mix(r, s, .5), left = mix(pq, qr, .5), right = mix(qr, rs, .5), center = mix(left, right, .5), tm = (t0 + t1) / 2;
      visit(p, pq, left, center, t0, tm, depth + 1);
      visit(center, right, rs, s, tm, t1, depth + 1);
    };
    visit(a, tangentEndpoint(a, "out"), tangentEndpoint(b, "in"), b, 0, 1, 0);
  }
  return result;
}

/** Exact continuous split. Endpoint/atlas/budget failures are atomic no-ops. */
export function splitBezierSegment(points: readonly Point[], segment: number, t: number): Point[] | null {
  if (points.length < 3 || points.length >= 24 || !Number.isInteger(segment) || segment < 0 || segment >= points.length || !Number.isFinite(t) || t <= 1e-6 || t >= 1 - 1e-6 || points.some(p => !p.handles)) return null;
  const next = structuredClone([...points]), ai = segment, bi = (segment + 1) % points.length, a = points[ai], b = points[bi];
  const q = mix(a, tangentEndpoint(a, "out"), t), r = mix(tangentEndpoint(a, "out"), tangentEndpoint(b, "in"), t), s = mix(tangentEndpoint(b, "in"), b, t);
  const left = mix(q, r, t), right = mix(r, s, t), middle = mix(left, right, t);
  if (!finite(middle) || middle.u < 0 || middle.u > 1 || middle.v < 0 || middle.v > 1) return null;
  // Scale original vectors rather than subtracting almost-equal UV positions:
  // tiny endpoint splits must still satisfy their serialized handle modes.
  const direction = vector(right, left);
  const outgoing = {u: a.handles!.out.u * t, v: a.handles!.out.v * t};
  const incoming = {u: b.handles!.in.u * (1 - t), v: b.handles!.in.v * (1 - t)};
  const handles: Handles = { in: {u: -direction.u * t, v: -direction.v * t}, out: {u: direction.u * (1 - t), v: direction.v * (1 - t)}, mode: "aligned" };
  if (![outgoing, incoming, handles.in, handles.out].every(bounded)) return null;
  next[ai].handles!.out = outgoing;
  next[bi].handles!.in = incoming;
  // A split changes arm lengths; retain collinearity but never relabel unequal
  // arms symmetric. Corner mode remains independent, including coincident ends.
  for (const i of [ai, bi]) if (next[i].handles!.mode === "symmetric") next[i].handles!.mode = "aligned";
  next.splice(segment + 1, 0, { ...middle, weight: a.weight * (1 - t) + b.weight * t, handles });
  return next;
}
