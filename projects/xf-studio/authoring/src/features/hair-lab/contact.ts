import { add, clamp, cross, dot, magnitude, mul, normalise, sub, vertex, type Capsule, type HeadSurface, type Vec3 } from "./types";
import { closeVoxels, squaredDistances } from "./distance-transform";
type Triangle = { a: Vec3; b: Vec3; c: Vec3; normal: Vec3; centre: Vec3; index?: number };
type Bounds = { min: Vec3; max: Vec3 };
type Tree = Bounds & { triangles?: Triangle[]; left?: Tree; right?: Tree };
export type DistanceGrid = Bounds & { resolution: number; cell: Vec3; values: Float32Array; others?: DistanceGrid[]; active?: Bounds; exclude?: Bounds };
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

/** Close unambiguous physical boundary loops in collision data only; UV seams are welded first. */
function boundaryCaps(positions: number[], indices: number[]): Vec3[][] {
  const welded = new Map<string, number>(), ids: number[] = [];
  for (let i = 0; i < positions.length / 3; i++) {
    const key = vertex(positions, i).map(v => Math.round(v * 1e6)).join(",");
    if (!welded.has(key)) welded.set(key, i); ids.push(welded.get(key)!);
  }
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (let t = 0; t < indices.length; t += 3) for (let j = 0; j < 3; j++) {
    const a = ids[indices[t + j]], b = ids[indices[t + (j + 1) % 3]];
    if (a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`, edge = edges.get(key);
    if (edge) edge.count++; else edges.set(key, { a, b, count: 1 });
  }
  const outgoing = new Map<number, number[]>(), incoming = new Map<number, number[]>();
  for (const edge of edges.values()) if (edge.count === 1) {
    const out = outgoing.get(edge.a) ?? [], into = incoming.get(edge.b) ?? [];
    out.push(edge.b); into.push(edge.a); outgoing.set(edge.a, out); incoming.set(edge.b, into);
  }
  const seen = new Set<number>(), caps: Vec3[][] = [];
  for (const first of outgoing.keys()) {
    if (seen.has(first)) continue;
    const loop: number[] = []; let at = first;
    while (!seen.has(at) && outgoing.get(at)?.length === 1 && incoming.get(at)?.length === 1) { seen.add(at); loop.push(at); at = outgoing.get(at)![0]; }
    if (at !== first || loop.length < 3) continue;
    const centre: Vec3 = [0, 0, 0];
    for (const id of loop) for (let k = 0; k < 3; k++) centre[k] += positions[id * 3 + k] / loop.length;
    for (let i = 0; i < loop.length; i++) caps.push([vertex(positions, loop[(i + 1) % loop.length]), vertex(positions, loop[i]), centre]);
  }
  return caps;
}
/** Oriented scanline crossings supply a solid sign at sharp edges and overlapping skin pieces. */
function solidMask(triangles: Triangle[], min: Vec3, cell: Vec3, n: number): Uint8Array {
  const lines = Array.from({ length: n * n }, () => [] as { x: number; winding: number }[]);
  const epsilonY = cell[1] * .00013, epsilonZ = cell[2] * .00017;
  for (const { a, b, c, normal } of triangles) {
    const denominator = (b[2] - c[2]) * (a[1] - c[1]) + (c[1] - b[1]) * (a[2] - c[2]);
    if (Math.abs(denominator) < 1e-14 || Math.abs(normal[0]) < 1e-10) continue;
    const y0 = clamp(Math.ceil((Math.min(a[1], b[1], c[1]) - min[1] - epsilonY) / cell[1]), 0, n - 1), y1 = clamp(Math.floor((Math.max(a[1], b[1], c[1]) - min[1] - epsilonY) / cell[1]), 0, n - 1);
    const z0 = clamp(Math.ceil((Math.min(a[2], b[2], c[2]) - min[2] - epsilonZ) / cell[2]), 0, n - 1), z1 = clamp(Math.floor((Math.max(a[2], b[2], c[2]) - min[2] - epsilonZ) / cell[2]), 0, n - 1);
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) {
      const py = min[1] + y * cell[1] + epsilonY, pz = min[2] + z * cell[2] + epsilonZ;
      const u = ((b[2] - c[2]) * (py - c[1]) + (c[1] - b[1]) * (pz - c[2])) / denominator;
      const v = ((c[2] - a[2]) * (py - c[1]) + (a[1] - c[1]) * (pz - c[2])) / denominator, w = 1 - u - v;
      if (Math.min(u, v, w) < -1e-10) continue;
      lines[y + n * z].push({ x: u * a[0] + v * b[0] + w * c[0], winding: normal[0] < 0 ? 1 : -1 });
    }
  }
  const inside = new Uint8Array(n ** 3);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) {
    const events = lines[y + n * z].sort((a, b) => a.x - b.x); let at = 0, winding = 0;
    for (let x = 0; x < n; x++) {
      const px = min[0] + x * cell[0];
      while (at < events.length && events[at].x < px) winding += events[at++].winding;
      inside[x + n * (y + n * z)] = winding > 0 ? 1 : 0;
    }
  }
  return inside;
}
/** Worker-owned cache, rebuilt only for a new geometry revision. */
export function buildDistanceGrid(head: HeadSurface, resolution = 48, method: "surface" | "voxel" = "surface", domain?: Pick<HeadSurface, "positions" | "indices">): DistanceGrid {
  if (!Number.isInteger(resolution) || resolution < 8 || resolution > 96) throw Error("Invalid contact grid budget.");
  const triangles: Triangle[] = [];
  for (let t = 0; t < head.indices.length; t += 3) {
    const [a, b, c] = head.indices.slice(t, t + 3).map(i => vertex(head.positions, i));
    const normal = cross(sub(b, a), sub(c, a));
    if (magnitude(normal) > 1e-12) triangles.push({ a, b, c, normal: normalise(normal), centre: mul(add(add(a, b), c), 1 / 3) });
  }
  for (const [a, b, c] of boundaryCaps(head.positions, head.indices)) {
    const normal = cross(sub(b, a), sub(c, a));
    if (magnitude(normal) > 1e-12) triangles.push({ a, b, c, normal: normalise(normal), centre: mul(add(add(a, b), c), 1 / 3) });
  }
  if (!triangles.length) throw Error("No head contact geometry.");
  const tree = makeTree(triangles), bounds = { min: [...tree.min] as Vec3, max: [...tree.max] as Vec3 };
  if (domain) {
    bounds.min.fill(Infinity); bounds.max.fill(-Infinity);
    for (const i of domain.indices) for (let k = 0; k < 3; k++) { bounds.min[k] = Math.min(bounds.min[k], domain.positions[i * 3 + k]); bounds.max[k] = Math.max(bounds.max[k], domain.positions[i * 3 + k]); }
  }
  const min = sub(bounds.min, [.03, .03, .03]), max = add(bounds.max, [.03, .03, .03]);
  const cell = mul(sub(max, min), 1 / (resolution - 1)), values = new Float32Array(resolution ** 3), inside = solidMask(triangles, min, cell, resolution);
  if (method === "voxel") {
    const solid = closeVoxels(inside, resolution), outside = squaredDistances(solid, resolution, cell, 1), interior = squaredDistances(solid, resolution, cell, 0);
    const halfCell = Math.min(...cell) / 2;
    for (let i = 0; i < values.length; i++) values[i] = solid[i] ? halfCell - Math.sqrt(interior[i]) : Math.sqrt(outside[i]) - halfCell;
    return smoothDistanceGrid({ min, max, resolution, cell, values });
  }
  // Exact triangle distance matters near contact. A coarse field fills the distant interior/exterior;
  // only the 8 mm surface band needs exact nearest queries on the fine lattice.
  let coarse: DistanceGrid | undefined;
  if (resolution >= 64) {
    const n = 28, coarseCell = mul(sub(max, min), 1 / (n - 1)), coarseValues = new Float32Array(n ** 3), coarseInside = solidMask(triangles, min, coarseCell, n);
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const p: Vec3 = [min[0] + x * coarseCell[0], min[1] + y * coarseCell[1], min[2] + z * coarseCell[2]], near = nearest(tree, p);
      coarseValues[x + n * (y + n * z)] = Math.sqrt(near.distanceSquared) * (coarseInside[x + n * (y + n * z)] ? -1 : 1);
    }
    coarse = { min, max, resolution: n, cell: coarseCell, values: coarseValues };
  }
  for (let z = 0; z < resolution; z++) for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    const p: Vec3 = [min[0] + x * cell[0], min[1] + y * cell[1], min[2] + z * cell[2]];
    if (coarse) { const d = sample(coarse, p); if (Math.abs(d) > .008) { values[x + resolution * (y + resolution * z)] = Math.abs(d) * (inside[x + resolution * (y + resolution * z)] ? -1 : 1); continue; } }
    const near = nearest(tree, p);
    values[x + resolution * (y + resolution * z)] = Math.sqrt(near.distanceSquared) * (inside[x + resolution * (y + resolution * z)] ? -1 : 1);
  }
  return { min, max, resolution, cell, values };
}
/** Remove voxel stair-step curvature before tracing; retain a conservative contact margin. */
export function smoothDistanceGrid(grid: DistanceGrid, passes = 2): DistanceGrid {
  const n = grid.resolution; let source = grid.values, target = new Float32Array(source.length);
  for (let pass = 0; pass < passes; pass++) for (let axis = 0; axis < 3; axis++) {
    const stride = n ** axis;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const at = x + n * (y + n * z), position = axis === 0 ? x : axis === 1 ? y : z;
      target[at] = (source[at - (position ? stride : 0)] + 2 * source[at] + source[at + (position < n - 1 ? stride : 0)]) * .25;
    }
    [source, target] = [target, source];
  }
  const margin = Math.min(...grid.cell) * .3 * passes;
  for (let i = 0; i < source.length; i++) source[i] -= margin;
  return { ...grid, values: source };
}
/** Both resolutions sample one solid; an internal head/body join can never act as a contact lid. */
export function buildCharacterContact(head: HeadSurface, resolution = 96): DistanceGrid {
  if (!head.body) return buildDistanceGrid(head, resolution, "voxel");
  const union = { ...head, positions: [...head.positions, ...head.body.positions], indices: [...head.indices, ...head.body.indices.map(i => i + head.positions.length / 3)] };
  const fine = buildDistanceGrid(union, resolution, "voxel", head), coarse = buildDistanceGrid(union, resolution, "voxel", head.body);
  const inner = { min: add(fine.min, [.01, .025, .01]), max: sub(fine.max, [.01, .01, .01]) };
  const outer = { min: add(fine.min, [.005, .015, .005]), max: sub(fine.max, [.005, .005, .005]) };
  fine.active = outer; coarse.exclude = inner; fine.others = [coarse]; return fine;
}
function inBounds(p: Vec3, bounds: Bounds) { return p.every((v, k) => v >= bounds.min[k] && v <= bounds.max[k]); }
function queryActive(grid: DistanceGrid, p: Vec3) { return (!grid.active || inBounds(p, grid.active)) && (!grid.exclude || !inBounds(p, grid.exclude)); }
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
  if (!queryActive(grid, p)) return { distance: Infinity, normal: [0, 0, 0] };
  const clamped = p.map((v, k) => clamp(v, grid.min[k], grid.max[k])) as Vec3, outside = sub(p, clamped);
  if (magnitude(outside) > 0) return { distance: .03 + magnitude(outside), normal: normalise(outside) };
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
    if (!queryActive(grid, p) || p.some((value, k) => value < grid.min[k] || value > grid.max[k])) continue;
    const distance = sample(grid, p);
    if (distance < bestDistance) { bestDistance = distance; bestT = t; bestPoint = p; }
  }
  if (!Number.isFinite(bestDistance)) return { ...ownContactAt(grid, a), t: 0 };
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
