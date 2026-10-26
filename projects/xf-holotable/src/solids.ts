// Plain geometry and selection policy. The file/archive adapter supplies poses; no native reader or device lives here.
import type { Solid, Vec3 } from "./model.ts";

export const WORLD_SOLID_CAP = 12_000;
export function rotate(p: Vec3, q: readonly number[]): Vec3 {
  const [x, y, z, w] = q, [a, b, c] = p;
  const tx = 2 * (y * c - z * b), ty = 2 * (z * a - x * c), tz = 2 * (x * b - y * a);
  return [a + w * tx + y * tz - z * ty, b + w * ty + z * tx - x * tz, c + w * tz + x * ty - y * tx];
}

function rotationAxes(q: readonly number[]): [Vec3, Vec3, Vec3] {
  const [x, y, z, w] = q;
  return [[1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
    [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
    [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)]];
}
/** Actors already have world poses. Cache their affine basis once, and cull origins before composing shape axes. */
export function actorPose(actor: { position: Vec3; orientation: readonly number[]; scale: Vec3 }) {
  const columns = rotationAxes(actor.orientation);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) columns[i][j] *= actor.scale[i];
  const vector = (p: Vec3): Vec3 => [columns[0][0] * p[0] + columns[1][0] * p[1] + columns[2][0] * p[2],
    columns[0][1] * p[0] + columns[1][1] * p[1] + columns[2][1] * p[2],
    columns[0][2] * p[0] + columns[1][2] * p[1] + columns[2][2] * p[2]];
  return {
    center(p: Vec3): Vec3 {
      if (p[0] === 0 && p[1] === 0 && p[2] === 0) return actor.position;
      const v = vector(p); return [actor.position[0] + v[0], actor.position[1] + v[1], actor.position[2] + v[2]];
    },
    axes(q: readonly number[]): Solid["axes"] { const a = rotationAxes(q); return [vector(a[0]), vector(a[1]), vector(a[2])]; },
  };
}
export function worldPose(actor: Parameters<typeof actorPose>[0], shape: { position: Vec3; rotation: readonly number[] }): Pick<Solid, "center" | "axes"> {
  const pose = actorPose(actor); return { center: pose.center(shape.position), axes: pose.axes(shape.rotation) };
}

/** Squared distance to the recording's polyline (including elevation); repeated samples need no extra segments. */
export function distanceToPath(p: Vec3, path: readonly Vec3[]): number {
  let best = Infinity;
  for (let i = 0; i < path.length; i++) {
    const a = path[i], b = path[Math.min(i + 1, path.length - 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], d = dx * dx + dy * dy + dz * dz;
    const k = d ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / d)) : 0;
    const x = p[0] - a[0] - dx * k, y = p[1] - a[1] - dy * k, z = p[2] - a[2] - dz * k;
    best = Math.min(best, x * x + y * y + z * z);
  }
  return best;
}
export function nearestSolids(solids: readonly Solid[], path: readonly Vec3[], cap = WORLD_SOLID_CAP): { solids: Solid[]; cut: number } {
  const distance = pathDistance(path);
  const ordered = solids.map(s => ({ s, d: distance(s.center) })).sort((a, b) => a.d - b.d || (a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0));
  return { solids: ordered.slice(0, cap).map(x => x.s), cut: Math.max(0, ordered.length - cap) };
}

/** Exact nearest-segment queries. A box tree avoids shapes × recorder-samples work, especially on long stationary recordings. */
export function pathDistance(path: readonly Vec3[]): (p: Vec3) => number {
  type Segment = { a: Vec3; b: Vec3 };
  type Node = { min: Vec3; max: Vec3; segments?: Segment[]; left?: Node; right?: Node };
  const segments: Segment[] = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[i], b = path[Math.min(i + 1, path.length - 1)];
    if (i > 0 && a.every((x, j) => x === b[j])) continue;
    segments.push({ a, b });
  }
  const build = (xs: Segment[]): Node => {
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const { a, b } of xs) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], a[i], b[i]); max[i] = Math.max(max[i], a[i], b[i]); }
    if (xs.length <= 8) return { min, max, segments: xs };
    let axis = 0; for (let i = 1; i < 3; i++) if (max[i] - min[i] > max[axis] - min[axis]) axis = i;
    xs.sort((a, b) => a.a[axis] + a.b[axis] - b.a[axis] - b.b[axis]);
    const mid = xs.length >> 1; return { min, max, left: build(xs.slice(0, mid)), right: build(xs.slice(mid)) };
  };
  if (!segments.length) return () => Infinity;
  const root = build(segments);
  const lower = (p: Vec3, n: Node) => { let d = 0; for (let i = 0; i < 3; i++) d += Math.max(n.min[i] - p[i], 0, p[i] - n.max[i]) ** 2; return d; };
  return p => {
    const visit = (n: Node, best: number): number => {
      if (lower(p, n) >= best) return best;
      if (n.segments) {
        for (const { a, b } of n.segments) {
          const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], d = dx * dx + dy * dy + dz * dz;
          const k = d ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / d)) : 0;
          best = Math.min(best, (p[0] - a[0] - dx * k) ** 2 + (p[1] - a[1] - dy * k) ** 2 + (p[2] - a[2] - dz * k) ** 2);
        }
      } else {
        const l = n.left!, r = n.right!;
        if (lower(p, l) < lower(p, r)) { best = visit(l, best); best = visit(r, best); }
        else { best = visit(r, best); best = visit(l, best); }
      }
      return best;
    };
    return visit(root, Infinity);
  };
}
