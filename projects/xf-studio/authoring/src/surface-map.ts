import * as THREE from "three";

export type UV = { u: number; v: number };
export type Anchor = {
  indices: [number, number, number];
  weights: [number, number, number];
  /**
   * On a bridge across an interior hole of the UV map (the eye opening), not on a plate triangle.
   * Bridges carry drags and control positions across the opening; nothing is ever painted there.
   */
  bridge?: true;
};

type Bounds = { minU: number; maxU: number; minV: number; maxV: number };
type UVNode = Bounds & { ids?: number[]; left?: UVNode; right?: UVNode };
const intersects = (a: Bounds, b: Bounds) => a.minU <= b.maxU && a.maxU >= b.minU && a.minV <= b.maxV && a.maxV >= b.minV;

const triangleIds = (geometry: THREE.BufferGeometry) => {
  const index = geometry.index, count = index?.count ?? geometry.getAttribute("uv").count, result: Anchor["indices"][] = [];
  for (let i = 0; i + 2 < count; i += 3)
    result.push([0, 1, 2].map((k) => index ? index.getX(i + k) : i + k) as Anchor["indices"]);
  return result;
};

/** A loop's bind-pose positions projected onto their Newell plane, or undefined without positions or a plane. */
function planarContour(geometry: THREE.BufferGeometry, loop: number[]) {
  const position = geometry.getAttribute("position");
  if (!position) return;
  const points = loop.map((id) => new THREE.Vector3().fromBufferAttribute(position, id)), normal = new THREE.Vector3();
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    normal.x += (p.y - q.y) * (p.z + q.z); normal.y += (p.z - q.z) * (p.x + q.x); normal.z += (p.x - q.x) * (p.y + q.y);
  });
  if (!(normal.lengthSq() > 0)) return;
  normal.normalize();
  const tangent = new THREE.Vector3(1, 0, 0).cross(normal);
  if (tangent.lengthSq() < 1e-6) tangent.set(0, 1, 0).cross(normal);
  tangent.normalize();
  const bitangent = normal.clone().cross(tangent);
  return points.map((p) => new THREE.Vector2(p.dot(tangent), p.dot(bitangent)));
}

/**
 * Triangulations of the interior holes in a mesh's UV map, as vertex-index triples. On the eye plate these are the eye
 * openings: the lid margins bound a thin slit of UV that no plate triangle covers. A hole is a boundary loop whose UV
 * winding opposes its triangles' (an island's outer edge winds with them), so separate islands, atlas seams and the plate's
 * outer edge are never bridged. A loop that meets another, mixes windings or has no exact triangulation is skipped.
 */
export function uvHoleBridges(geometry: THREE.BufferGeometry): Anchor["indices"][] {
  const uv = geometry.getAttribute("uv");
  if (!uv) return [];
  const uses = new Map<string, number>(), directed: { from: number; to: number; sign: number }[] = [];
  for (const [a, b, c] of triangleIds(geometry)) {
    const area = (uv.getX(b) - uv.getX(a)) * (uv.getY(c) - uv.getY(a)) - (uv.getX(c) - uv.getX(a)) * (uv.getY(b) - uv.getY(a));
    if (!Number.isFinite(area) || a === b || b === c || c === a) continue;
    // A zero-area UV triangle is still a face of the mesh: it closes topology but has no winding.
    for (const [from, to] of [[a, b], [b, c], [c, a]]) {
      const key = from < to ? `${from},${to}` : `${to},${from}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
      directed.push({ from, to, sign: Math.abs(area) <= 1e-12 ? 0 : Math.sign(area) });
    }
  }
  const outgoing = new Map<number, { from: number; to: number; sign: number }[]>();
  for (const edge of directed) {
    if (uses.get(edge.from < edge.to ? `${edge.from},${edge.to}` : `${edge.to},${edge.from}`) !== 1) continue;
    outgoing.set(edge.from, [...outgoing.get(edge.from) ?? [], edge]);
  }
  const used = new Set<object>(), bridges: Anchor["indices"][] = [];
  for (const start of [...outgoing.values()].flat()) {
    if (used.has(start)) continue;
    const loop: number[] = [], signs = new Set<number>();
    let edge = start, valid = true;
    while (!used.has(edge)) {
      used.add(edge); loop.push(edge.from); if (edge.sign) signs.add(edge.sign);
      const next = outgoing.get(edge.to) ?? [];
      // A vertex where two boundary loops meet has no unique continuation: leave that loop open.
      if (next.length !== 1) { valid = false; break; }
      edge = next[0];
    }
    if (!valid || edge !== start || loop.length < 3 || signs.size !== 1) continue;
    const uvContour = loop.map((id) => new THREE.Vector2(uv.getX(id), uv.getY(id)));
    const area = THREE.ShapeUtils.area(uvContour), winding = [...signs][0];
    if (!(Math.sign(area) === -winding)) continue;
    // Triangulate where the opening is a clean loop: its bind-pose positions, flattened onto their best-fit plane. The
    // lid margins crowd the slit's UV (collinear, zero-area and touching stretches), so the UV loop itself need not be simple.
    for (const contour of [planarContour(geometry, loop), uvContour]) {
      if (!contour) continue;
      const faces = THREE.ShapeUtils.triangulateShape(contour.map((p) => p.clone()), []);
      const whole = Math.abs(THREE.ShapeUtils.area(contour)),
        covered = faces.reduce((sum, [a, b, c]) => sum + Math.abs(THREE.ShapeUtils.area([contour[a], contour[b], contour[c]])), 0);
      if (faces.length !== loop.length - 2 || !(whole > 0) || Math.abs(covered - whole) > 1e-6 * whole) continue;
      for (const [a, b, c] of faces) bridges.push([loop[a], loop[b], loop[c]]);
      break;
    }
  }
  return bridges;
}

/** UV lookup stays in the undeformed atlas; barycentric anchors follow the mesh. */
export class SurfaceMap {
  private triangles: {
    indices: Anchor["indices"];
    uv: number[];
    den: number;
    bounds: Bounds;
    bridge?: true;
  }[] = [];
  private root?: UVNode;
  /** Every bridge triangle, zero-area UV ones included, so the 3D membrane has no gaps. */
  private bridgeTriangles: { indices: Anchor["indices"]; uv: number[] }[] = [];
  /**
   * With `bridgeHoles`, interior UV holes (the eye openings) are bridged: anchors and continuity cross them, and
   * `rayBridge` finds them in 3D. Plate triangles always win where a bridge shares their edge.
   */
  constructor(geometry: THREE.BufferGeometry, options: { bridgeHoles?: boolean } = {}) {
    const uv = geometry.getAttribute("uv");
    const bridges = options.bridgeHoles ? uvHoleBridges(geometry) : [];
    const all = [...triangleIds(geometry), ...bridges], plateCount = all.length - bridges.length;
    this.bridgeTriangles = bridges.map((indices) => ({ indices, uv: indices.flatMap((id) => [uv.getX(id), uv.getY(id)]) }));
    for (let t = 0; t < all.length; t++) {
      const ids = all[t];
      const p = ids.flatMap((id) => [uv.getX(id), uv.getY(id)]);
      const den = (p[3] - p[5]) * (p[0] - p[4]) + (p[4] - p[2]) * (p[1] - p[5]);
      if (Number.isFinite(den) && Math.abs(den) > 1e-12) {
        const minU = Math.min(p[0], p[2], p[4]), maxU = Math.max(p[0], p[2], p[4]),
          minV = Math.min(p[1], p[3], p[5]), maxV = Math.max(p[1], p[3], p[5]);
        // Accepted barycentric weights may be -1e-6. Expanding by three times
        // that tolerance times the axis extent contains that entire relaxed
        // triangle, including the smaller segment-clip tolerance below.
        const padU = 3e-6 * (maxU - minU) + 1e-12, padV = 3e-6 * (maxV - minV) + 1e-12;
        this.triangles.push({ indices: ids, uv: p, den,
          bounds: { minU: minU - padU, maxU: maxU + padU, minV: minV - padV, maxV: maxV + padV },
          ...(t >= plateCount ? { bridge: true as const } : {}) });
      }
    }
    this.root = this.build(this.triangles.map((_, i) => i));
  }
  private build(ids: number[]): UVNode | undefined {
    if (!ids.length) return;
    const bounds = ids.map(i => this.triangles[i].bounds);
    const node: UVNode = { minU: Math.min(...bounds.map(b => b.minU)), maxU: Math.max(...bounds.map(b => b.maxU)),
      minV: Math.min(...bounds.map(b => b.minV)), maxV: Math.max(...bounds.map(b => b.maxV)) };
    if (ids.length <= 8) node.ids = ids;
    else {
      const axis = node.maxU - node.minU >= node.maxV - node.minV ? "U" : "V";
      ids.sort((a, b) => { const x = this.triangles[a].bounds, y = this.triangles[b].bounds;
        return (x[`min${axis}`] + x[`max${axis}`]) - (y[`min${axis}`] + y[`max${axis}`]) || a - b; });
      const middle = Math.floor(ids.length / 2);
      node.left = this.build(ids.slice(0, middle)); node.right = this.build(ids.slice(middle));
    }
    return node;
  }
  private candidates(bounds: Bounds): number[] {
    const result: number[] = [], stack = this.root ? [this.root] : [];
    while (stack.length) {
      const node = stack.pop()!;
      if (!intersects(node, bounds)) continue;
      if (node.ids) for (const i of node.ids) { if (intersects(this.triangles[i].bounds, bounds)) result.push(i); }
      else { if (node.left) stack.push(node.left); if (node.right) stack.push(node.right); }
    }
    // Overlapping islands and shared edges retain the original first-triangle
    // winner. The hierarchy filters candidates; it never changes narrow tests.
    return result.sort((a, b) => a - b);
  }
  anchor({ u, v }: UV): Anchor | undefined {
    if (!Number.isFinite(u) || !Number.isFinite(v)) return;
    for (const i of this.candidates({ minU: u, maxU: u, minV: v, maxV: v })) {
      const { indices, uv: p, den, bridge } = this.triangles[i];
      const a = ((p[3] - p[5]) * (u - p[4]) + (p[4] - p[2]) * (v - p[5])) / den;
      const b = ((p[5] - p[1]) * (u - p[4]) + (p[0] - p[4]) * (v - p[5])) / den,
        c = 1 - a - b;
      if (Math.min(a, b, c) >= -1e-6) return { indices, weights: [a, b, c], ...(bridge ? { bridge } : {}) };
    }
  }
  continuous(a: UV, b: UV) {
    if (![a.u, a.v, b.u, b.v].every(Number.isFinite)) return false;
    const distance = Math.hypot(a.u - b.u, a.v - b.v);
    if (distance > 0.06) return false;
    // Clip against candidate UV triangles and require continuous coverage.
    // Unlike point sampling, this also catches arbitrarily narrow eyelid gaps.
    const intervals: [number, number][] = [];
    for (const i of this.candidates({ minU: Math.min(a.u, b.u), maxU: Math.max(a.u, b.u),
      minV: Math.min(a.v, b.v), maxV: Math.max(a.v, b.v) })) {
      const { uv: p, den } = this.triangles[i];
      const weights = ({ u, v }: UV) => {
        const x =
          ((p[3] - p[5]) * (u - p[4]) + (p[4] - p[2]) * (v - p[5])) / den;
        const y =
          ((p[5] - p[1]) * (u - p[4]) + (p[0] - p[4]) * (v - p[5])) / den;
        return [x, y, 1 - x - y];
      };
      const start = weights(a),
        end = weights(b);
      let lo = 0,
        hi = 1;
      for (let k = 0; k < 3; k++) {
        const delta = end[k] - start[k];
        if (Math.abs(delta) < 1e-12) {
          if (start[k] < -1e-7) {
            hi = -1;
            break;
          }
        } else {
          const edge = (-1e-7 - start[k]) / delta;
          if (delta > 0) lo = Math.max(lo, edge);
          else hi = Math.min(hi, edge);
        }
      }
      if (lo <= hi) intervals.push([lo, hi]);
    }
    let covered = 0;
    for (const [lo, hi] of intervals.sort((a, b) => a[0] - b[0])) {
      if (lo > covered + 1e-7) return false;
      covered = Math.max(covered, hi);
      if (covered >= 1) return true;
    }
    return false;
  }
  /** Whether any interior hole is bridged. */
  get bridged() { return this.bridgeTriangles.length > 0; }
  /**
   * The nearest bridge the ray crosses, from either side, with its UV and anchor. A bridge is the flat membrane spanning
   * the hole between its posed boundary vertices (`vertex` gives world positions), so it follows the lids through every pose.
   */
  rayBridge(ray: THREE.Ray, vertex: (i: number) => THREE.Vector3): { uv: UV; distance: number; anchor: Anchor } | undefined {
    let best: { uv: UV; distance: number; anchor: Anchor } | undefined;
    const point = new THREE.Vector3(), weights = new THREE.Vector3();
    for (const { indices, uv: p } of this.bridgeTriangles) {
      const [a, b, c] = indices.map(vertex);
      if (!ray.intersectTriangle(a, b, c, false, point)) continue;
      const distance = point.distanceTo(ray.origin);
      if (best && distance >= best.distance) continue;
      if (!THREE.Triangle.getBarycoord(point, a, b, c, weights)) continue;
      best = { distance, uv: { u: weights.x * p[0] + weights.y * p[2] + weights.z * p[4], v: weights.x * p[1] + weights.y * p[3] + weights.z * p[5] },
        anchor: { indices, weights: [weights.x, weights.y, weights.z], bridge: true } };
    }
    return best;
  }
}

export function anchorPosition(
  anchor: Anchor,
  vertex: (i: number) => THREE.Vector3,
  offset = 0,
) {
  const [a, b, c] = anchor.indices.map(vertex),
    [x, y, z] = anchor.weights;
  const position = a
    .clone()
    .multiplyScalar(x)
    .addScaledVector(b, y)
    .addScaledVector(c, z);
  if (offset)
    position.addScaledVector(
      new THREE.Vector3()
        .subVectors(b, a)
        .cross(new THREE.Vector3().subVectors(c, a))
        .normalize(),
      offset,
    );
  return position;
}
