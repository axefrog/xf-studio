// Collision primitives as an architect's model: faint faces and crisp edges. No guessed mesh bounds.
import type { HoloSolid, Vec3 } from "../types";
import { clipToRect, type camera, type ClippedRun } from "./projection";

export const SOLID_DRAW_CAP = 1_500;
type Point = [number, number];
export interface SolidDrawing { kind: "solid"; id: string; lines: ClippedRun[]; faces: { points: Point[]; top: boolean }[]; opacity: number }
export interface SolidInstance { kind: "solid"; id: string; source: HoloSolid; opacity: number }
type Camera = ReturnType<typeof camera>;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a: Vec3): Vec3 => { const d = Math.hypot(...a) || 1; return [a[0] / d, a[1] / d, a[2] / d]; };
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

const geometry = new WeakMap<HoloSolid, ReturnType<typeof prepare>>();
const FACE_IDS = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3]];
function prepare(s: HoloSolid) {
  const half: Vec3 = s.kind === "box" ? s.size : [s.size[0], s.size[0], s.size[0] + (s.kind === "capsule" ? s.size[1] / 2 : 0)];
  const corners = Array.from({ length: 8 }, (_, i): Vec3 => {
    const x = half[0] * (i & 1 ? 1 : -1), y = half[1] * (i & 2 ? 1 : -1), z = half[2] * (i & 4 ? 1 : -1);
    return [s.center[0] + s.axes[0][0] * x + s.axes[1][0] * y + s.axes[2][0] * z,
      s.center[1] + s.axes[0][1] * x + s.axes[1][1] * y + s.axes[2][1] * z,
      s.center[2] + s.axes[0][2] * x + s.axes[1][2] * y + s.axes[2][2] * z];
  });
  const faces = FACE_IDS.map(ids => {
    const ps = ids.map(i => corners[i]), center = mul(ps.reduce(add, [0, 0, 0] as Vec3), 0.25);
    let n = cross(sub(ps[1], ps[0]), sub(ps[2], ps[0]));
    if (dot(n, sub(center, s.center)) < 0) n = mul(n, -1);
    return { ids, center, normal: n, top: unit(n)[2] > 0.5 };
  });
  return { corners, faces, radius: Math.max(...corners.map(p => Math.hypot(...sub(p, s.center)))) };
}
/** Immutable snapshot geometry is prepared once; camera-dependent projection is never retained. */
export function solidGeometry(s: HoloSolid) { let g = geometry.get(s); if (!g) geometry.set(s, g = prepare(s)); return g; }

export function solidDrawing(s: HoloSolid, C: Camera, opacity: number): SolidDrawing {
  const out: SolidDrawing = { kind: "solid", id: s.id, lines: [], faces: [], opacity };
  const world = (p: Vec3): Vec3 => [s.center[0] + s.axes[0][0] * p[0] + s.axes[1][0] * p[1] + s.axes[2][0] * p[2],
    s.center[1] + s.axes[0][1] * p[0] + s.axes[1][1] * p[1] + s.axes[2][1] * p[2],
    s.center[2] + s.axes[0][2] * p[0] + s.axes[1][2] * p[1] + s.axes[2][2] * p[2]];
  const line = (ps: Vec3[], closed = false) => out.lines.push(...C.line(ps, closed));
  const face = (ps: Vec3[], top = false) => { const points = C.polygon(ps); if (points.length >= 3) out.faces.push({ points, top }); };
  if (s.kind === "box") {
    const { corners, faces } = solidGeometry(s), projected = corners.map(C.point);
    for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) {
      const a = projected[i], b = projected[i | bit];
      if (a && b) out.lines.push(...clipToRect([a, b], -32, -32, C.width + 32, C.height + 32));
      else line([corners[i], corners[i | bit]]);
    }
    for (const f of faces) if (dot(f.normal, sub(C.position, f.center)) > 0) {
      const ps = f.ids.map(i => projected[i]);
      const points = ps.every((p): p is Point => p !== null) ? C.clipPolygon(ps) : C.polygon(f.ids.map(i => corners[i]));
      if (points.length >= 3) out.faces.push({ points, top: f.top });
    }
    return out;
  }
  // Work in primitive coordinates, so nonuniform actor scales still give the correct perspective tangent contour.
  const [a, b, c] = s.axes, det = dot(a, cross(b, c)); if (Math.abs(det) < 1e-10) return out;
  const eye = sub(C.position, s.center), localEye: Vec3 = [dot(eye, cross(b, c)) / det, dot(eye, cross(c, a)) / det, dot(eye, cross(a, b)) / det];
  const r = s.size[0], h = s.kind === "capsule" ? s.size[1] / 2 : 0;
  const contour: Vec3[] = [];
  for (const sign of h ? [-1, 1] : [0]) {
    const origin: Vec3 = [0, 0, h * sign], k = sub(localEye, origin), d = dot(k, k);
    if (d <= r * r || !r) continue;
    const n = unit(k), u = unit(cross(n, Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0])), v = cross(n, u);
    const center = add(origin, mul(k, r * r / d)), radius = r * Math.sqrt(1 - r * r / d);
    for (let i = 0; i < 24; i++) {
      const angle = i * Math.PI / 12, p = add(center, add(mul(u, radius * Math.cos(angle)), mul(v, radius * Math.sin(angle))));
      if (!h || sign * (p[2] - origin[2]) >= 0) contour.push(world(p));
    }
  }
  if (h) {
    const d = Math.hypot(localEye[0], localEye[1]);
    if (d > r) for (const sign of [-1, 1]) {
      const angle = Math.atan2(localEye[1], localEye[0]) + sign * Math.acos(r / d);
      for (const z of [-h, h]) contour.push(world([r * Math.cos(angle), r * Math.sin(angle), z]));
    }
  }
  // The projected convex hull joins the two cap arcs and their cylinder tangents in screen order.
  const ring = hull(contour, C); if (ring.length < 3) return out;
  line(ring, true); face(ring);
  const meridian: Vec3[] = [];
  for (let i = 0; i < 24; i++) {
    const angle = i * Math.PI / 12;
    meridian.push(world([r * Math.cos(angle), 0, r * Math.sin(angle) + (Math.sin(angle) >= 0 ? h : -h)]));
  }
  line(meridian, true);
  return out;
}

function hull(ps: Vec3[], C: Camera): Vec3[] {
  const projected = ps.map(p => ({ p, q: C.point(p) })).filter((p): p is { p: Vec3; q: Point } => !!p.q).sort((a, b) => a.q[0] - b.q[0] || a.q[1] - b.q[1]);
  type P = typeof projected[number];
  const turn = (a: P, b: P, c: P) => (b.q[0] - a.q[0]) * (c.q[1] - a.q[1]) - (b.q[1] - a.q[1]) * (c.q[0] - a.q[0]);
  const half = (xs: P[]) => { const out: P[] = []; for (const p of xs) { while (out.length > 1 && turn(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop(); out.push(p); } return out; };
  const lo = half(projected), hi = half([...projected].reverse()); lo.pop(); hi.pop();
  return [...lo, ...hi].map(p => p.p);
}
