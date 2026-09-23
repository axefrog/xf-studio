import * as THREE from "three";

export type UV = { u: number; v: number };
export type Anchor = {
  indices: [number, number, number];
  weights: [number, number, number];
};

/** UV lookup stays in the undeformed atlas; barycentric anchors follow the mesh. */
export class SurfaceMap {
  private triangles: {
    indices: Anchor["indices"];
    uv: number[];
    den: number;
  }[] = [];
  constructor(geometry: THREE.BufferGeometry) {
    const uv = geometry.getAttribute("uv"),
      index = geometry.index;
    for (let i = 0; i < (index?.count ?? uv.count); i += 3) {
      const ids = [0, 1, 2].map((k) =>
        index ? index.getX(i + k) : i + k,
      ) as Anchor["indices"];
      const p = ids.flatMap((id) => [uv.getX(id), uv.getY(id)]);
      const den = (p[3] - p[5]) * (p[0] - p[4]) + (p[4] - p[2]) * (p[1] - p[5]);
      if (Math.abs(den) > 1e-12)
        this.triangles.push({ indices: ids, uv: p, den });
    }
  }
  anchor({ u, v }: UV): Anchor | undefined {
    for (const { indices, uv: p, den } of this.triangles) {
      const a = ((p[3] - p[5]) * (u - p[4]) + (p[4] - p[2]) * (v - p[5])) / den;
      const b = ((p[5] - p[1]) * (u - p[4]) + (p[0] - p[4]) * (v - p[5])) / den,
        c = 1 - a - b;
      if (Math.min(a, b, c) >= -1e-6) return { indices, weights: [a, b, c] };
    }
  }
  continuous(a: UV, b: UV) {
    const distance = Math.hypot(a.u - b.u, a.v - b.v);
    if (distance > 0.06) return false;
    // Clip the segment against every UV triangle and require continuous coverage.
    // Unlike point sampling, this also catches arbitrarily narrow eyelid gaps.
    const intervals: [number, number][] = [];
    for (const { uv: p, den } of this.triangles) {
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
