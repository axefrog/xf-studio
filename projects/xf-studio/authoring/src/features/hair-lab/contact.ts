import { add, clamp, cross, dot, magnitude, mul, normalise, sub, vertex, type Capsule, type HeadSurface, type Vec3 } from "./types";
type Triangle = { a: Vec3; b: Vec3; c: Vec3; normal: Vec3; centre: Vec3; index?: number };
type Bounds = { min: Vec3; max: Vec3 };
type Tree = Bounds & { triangles?: Triangle[]; left?: Tree; right?: Tree };
export type DistanceGrid = Bounds & { resolution: number; cell: Vec3; values: Float32Array; others?: DistanceGrid[] };
export type Contact = { distance: number; normal: Vec3 };

function trianglePoint(p: Vec3, { a, b, c }: Triangle): Vec3 {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, mul(ab, d1 / (d1 - d3)));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, mul(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, mul(sub(c, b), (d4 - d3) / (d4 - d3 + d5 - d6)));
  const inv = 1 / (va + vb + vc);
  return add(a, add(mul(ab, vb * inv), mul(ac, vc * inv)));
}
function makeTree(triangles: Triangle[]): Tree {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const tri of triangles) for (const p of [tri.a, tri.b, tri.c]) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  if (triangles.length <= 8) return { min, max, triangles };
  const size = sub(max, min), axis = size.indexOf(Math.max(...size));
  triangles.sort((a, b) => a.centre[axis] - b.centre[axis]);
  const mid = triangles.length >>> 1;
  return { min, max, left: makeTree(triangles.slice(0, mid)), right: makeTree(triangles.slice(mid)) };
}
const boxDistance = (p: Vec3, box: Bounds) => p.reduce((sum, v, k) => sum + (v - clamp(v, box.min[k], box.max[k])) ** 2, 0);
function nearest(tree: Tree, p: Vec3): { point: Vec3; normal: Vec3; distanceSquared: number; triangle?: Triangle } {
  let point: Vec3 = [0, 0, 0], normal: Vec3 = [0, 1, 0], best = Infinity;
  let triangle: Triangle | undefined;
  const visit = (node: Tree) => {
    if (boxDistance(p, node) > best) return;
    if (node.triangles) for (const tri of node.triangles) {
      const q = trianglePoint(p, tri), d = dot(sub(p, q), sub(p, q));
      if (d < best) { best = d; point = q; normal = tri.normal; triangle = tri; }
    } else {
      const a = node.left!, b = node.right!;
      if (boxDistance(p, a) < boxDistance(p, b)) { visit(a); visit(b); } else { visit(b); visit(a); }
    }
  };
  visit(tree); return { point, normal, distanceSquared: best, triangle };
}
/** Reusable exact projection for scalar maps on another indexed surface. */
export function surfaceProjector(positions: number[], indices: number[]) {
  const triangles: Triangle[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = indices.slice(t, t + 3).map(i => vertex(positions, i));
    if (magnitude(cross(sub(b, a), sub(c, a))) < 1e-12) continue;
    triangles.push({ a, b, c, normal: normalise(cross(sub(b, a), sub(c, a))), centre: mul(add(add(a, b), c), 1 / 3), index: t });
  }
  if (!triangles.length) throw Error("No projection surface.");
  const tree = makeTree(triangles);
  return (p: Vec3) => nearest(tree, p);
}
/** Worker-owned cache, rebuilt only for a new geometry revision. Nearest oriented surface supplies sign. */
export function buildDistanceGrid(head: HeadSurface, resolution = 48): DistanceGrid {
  if (!Number.isInteger(resolution) || resolution < 8 || resolution > 96) throw Error("Invalid contact grid budget.");
  const triangles: Triangle[] = [];
  for (let t = 0; t < head.indices.length; t += 3) {
    const [a, b, c] = head.indices.slice(t, t + 3).map(i => vertex(head.positions, i));
    const normal = cross(sub(b, a), sub(c, a));
    if (magnitude(normal) > 1e-12) triangles.push({ a, b, c, normal: normalise(normal), centre: mul(add(add(a, b), c), 1 / 3) });
  }
  if (!triangles.length) throw Error("No head contact geometry.");
  const tree = makeTree(triangles), min = sub(tree.min, [.03, .03, .03]), max = add(tree.max, [.03, .03, .03]);
  const cell = mul(sub(max, min), 1 / (resolution - 1)), values = new Float32Array(resolution ** 3);
  // Exact triangle distance matters near contact. A coarse field fills the distant interior/exterior;
  // only the 8 mm surface band needs exact nearest queries on the fine lattice.
  let coarse: DistanceGrid | undefined;
  if (resolution >= 64) {
    const n = 28, coarseCell = mul(sub(max, min), 1 / (n - 1)), coarseValues = new Float32Array(n ** 3);
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const p: Vec3 = [min[0] + x * coarseCell[0], min[1] + y * coarseCell[1], min[2] + z * coarseCell[2]], near = nearest(tree, p);
      coarseValues[x + n * (y + n * z)] = Math.sqrt(near.distanceSquared) * (dot(sub(p, near.point), near.normal) < 0 ? -1 : 1);
    }
    coarse = { min, max, resolution: n, cell: coarseCell, values: coarseValues };
  }
  for (let z = 0; z < resolution; z++) for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    const p: Vec3 = [min[0] + x * cell[0], min[1] + y * cell[1], min[2] + z * cell[2]];
    if (coarse) { const d = sample(coarse, p); if (Math.abs(d) > .008) { values[x + resolution * (y + resolution * z)] = d; continue; } }
    const near = nearest(tree, p);
    values[x + resolution * (y + resolution * z)] = Math.sqrt(near.distanceSquared) * (dot(sub(p, near.point), near.normal) < 0 ? -1 : 1);
  }
  return { min, max, resolution, cell, values };
}
function sample(grid: DistanceGrid, p: Vec3): number {
  const n = grid.resolution, limit = n - 1 - 1e-7;
  const x = clamp((p[0] - grid.min[0]) / grid.cell[0], 0, limit), y = clamp((p[1] - grid.min[1]) / grid.cell[1], 0, limit), z = clamp((p[2] - grid.min[2]) / grid.cell[2], 0, limit);
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz, row = n, plane = n * n;
  const at = ix + row * iy + plane * iz, v = grid.values;
  const a = v[at] * (1 - fx) + v[at + 1] * fx, b = v[at + row] * (1 - fx) + v[at + row + 1] * fx;
  const c = v[at + plane] * (1 - fx) + v[at + plane + 1] * fx, d = v[at + plane + row] * (1 - fx) + v[at + plane + row + 1] * fx;
  return (a * (1 - fy) + b * fy) * (1 - fz) + (c * (1 - fy) + d * fy) * fz;
}
function ownContactAt(grid: DistanceGrid, p: Vec3): Contact {
  const clamped = p.map((v, k) => clamp(v, grid.min[k], grid.max[k])) as Vec3, outside = sub(p, clamped);
  if (magnitude(outside) > 0) return { distance: Math.max(0, sample(grid, clamped)) + magnitude(outside), normal: normalise(outside) };
  const gradient: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) { const a = [...p] as Vec3, b = [...p] as Vec3; a[k] -= grid.cell[k] * .5; b[k] += grid.cell[k] * .5; gradient[k] = (sample(grid, b) - sample(grid, a)) / grid.cell[k]; }
  return { distance: sample(grid, p), normal: normalise(gradient) };
}
export function contactAt(grid: DistanceGrid, p: Vec3): Contact {
  let result = ownContactAt(grid, p);
  for (const other of grid.others ?? []) { const contact = contactAt(other, p); if (contact.distance < result.distance) result = contact; }
  return result;
}
function ownSegmentContact(grid: DistanceGrid, a: Vec3, b: Vec3): Contact & { t: number } {
  // Disjoint segment/grid bounds need no interior samples; only a potential collision needs a normal.
  for (let k = 0; k < 3; k++) {
    // The lattice has a 30 mm empty margin around all source triangles. Distance to the lattice
    // boundary alone is not a surface clearance (and would falsely report contact at its edge).
    if (Math.min(a[k], b[k]) > grid.max[k]) return { distance: .03 + Math.min(a[k], b[k]) - grid.max[k], normal: [0, 0, 0], t: 0 };
    if (Math.max(a[k], b[k]) < grid.min[k]) return { distance: .03 + grid.min[k] - Math.max(a[k], b[k]), normal: [0, 0, 0], t: 0 };
  }
  const count = Math.max(1, Math.min(256, Math.ceil(magnitude(sub(b, a)) / (Math.min(...grid.cell) * .5))));
  let bestDistance = Infinity, bestT = 0, bestPoint = a;
  for (let i = 0; i <= count; i++) {
    const t = i / count, p = add(a, mul(sub(b, a), t));
    if (p.some((value, k) => value < grid.min[k] || value > grid.max[k])) continue;
    const distance = sample(grid, p);
    if (distance < bestDistance) { bestDistance = distance; bestT = t; bestPoint = p; }
  }
  if (!Number.isFinite(bestDistance)) return { ...contactAt(grid, a), t: 0 };
  return { distance: bestDistance, normal: bestDistance < .002 ? contactAt(grid, bestPoint).normal : [0, 0, 0], t: bestT };
}
export function segmentContact(grid: DistanceGrid, a: Vec3, b: Vec3): Contact & { t: number } {
  let result = ownSegmentContact(grid, a, b);
  for (const other of grid.others ?? []) { const contact = segmentContact(other, a, b); if (contact.distance < result.distance) result = contact; }
  return result;
}
export function capsuleContact(p: Vec3, capsule: Capsule): Contact {
  if (capsule.radii) {
    const scale = capsule.radii, scaled = (v: Vec3): Vec3 => [v[0] / scale[0], v[1] / scale[1], v[2] / scale[2]];
    const q = scaled(p), a = scaled(capsule.a), b = scaled(capsule.b), ab = sub(b, a), t = clamp(dot(sub(q, a), ab) / (dot(ab, ab) || 1));
    const delta = sub(q, add(a, mul(ab, t))), distance = magnitude(delta), radial = distance > 1e-10 ? mul(delta, 1 / distance) : [0, 0, 1] as Vec3;
    const gradient: Vec3 = [radial[0] / scale[0], radial[1] / scale[1], radial[2] / scale[2]], length = magnitude(gradient);
    return { distance: (distance - capsule.radius) / length, normal: mul(gradient, 1 / length) };
  }
  const ab = sub(capsule.b, capsule.a), t = clamp(dot(sub(p, capsule.a), ab) / (dot(ab, ab) || 1));
  const delta = sub(p, add(capsule.a, mul(ab, t))), length = magnitude(delta);
  return { distance: length - capsule.radius, normal: length > 1e-10 ? mul(delta, 1 / length) : [1, 0, 0] };
}
/** Closest pair of the fibre segment and capsule axis in the capsule's scaled metric. */
export function segmentCapsuleContact(a: Vec3, b: Vec3, capsule: Capsule): Contact & { t: number } {
  const radii = capsule.radii ?? [1, 1, 1], scaled = (v: Vec3): Vec3 => [v[0] / radii[0], v[1] / radii[1], v[2] / radii[2]];
  const p = scaled(a), q = scaled(capsule.a), u = sub(scaled(b), p), v = sub(scaled(capsule.b), q), w = sub(p, q);
  const aa = dot(u, u), bb = dot(u, v), cc = dot(v, v), dd = dot(u, w), ee = dot(v, w), determinant = aa * cc - bb * bb;
  let t = determinant > 1e-12 ? clamp((bb * ee - cc * dd) / determinant) : 0;
  let axis = cc > 1e-12 ? (bb * t + ee) / cc : 0;
  if (axis < 0) { axis = 0; t = aa > 1e-12 ? clamp(-dd / aa) : 0; }
  else if (axis > 1) { axis = 1; t = aa > 1e-12 ? clamp((bb - dd) / aa) : 0; }
  return { ...capsuleContact(add(a, mul(sub(b, a), t)), capsule), t };
}
