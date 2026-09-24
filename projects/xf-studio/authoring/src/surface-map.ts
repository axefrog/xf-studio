import * as THREE from "three";

export type UV = { u: number; v: number };
export type Anchor = {
  indices: [number, number, number];
  weights: [number, number, number];
};

type Bounds = { minU: number; maxU: number; minV: number; maxV: number };
type UVNode = Bounds & { ids?: number[]; left?: UVNode; right?: UVNode };
const intersects = (a: Bounds, b: Bounds) => a.minU <= b.maxU && a.maxU >= b.minU && a.minV <= b.maxV && a.maxV >= b.minV;

/** UV lookup stays in the undeformed atlas; barycentric anchors follow the mesh. */
export class SurfaceMap {
  private triangles: {
    indices: Anchor["indices"];
    uv: number[];
    den: number;
    bounds: Bounds;
  }[] = [];
  private root?: UVNode;
  constructor(geometry: THREE.BufferGeometry) {
    const uv = geometry.getAttribute("uv"),
      index = geometry.index;
    for (let i = 0; i < (index?.count ?? uv.count); i += 3) {
      const ids = [0, 1, 2].map((k) =>
        index ? index.getX(i + k) : i + k,
      ) as Anchor["indices"];
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
          bounds: { minU: minU - padU, maxU: maxU + padU, minV: minV - padV, maxV: maxV + padV } });
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
      const { indices, uv: p, den } = this.triangles[i];
      const a = ((p[3] - p[5]) * (u - p[4]) + (p[4] - p[2]) * (v - p[5])) / den;
      const b = ((p[5] - p[1]) * (u - p[4]) + (p[0] - p[4]) * (v - p[5])) / den,
        c = 1 - a - b;
      if (Math.min(a, b, c) >= -1e-6) return { indices, weights: [a, b, c] };
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
