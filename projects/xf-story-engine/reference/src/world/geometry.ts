import type { CellGeometry, Volume, XY, XYZ } from './types.ts';

export const area = (poly: readonly XY[]): number => Math.abs(poly.reduce((s, p, i) => {
  const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2;

/** Closed boundary, matching the W1 reader. */
export function inside(poly: readonly XY[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const cross = (x - a[0]) * (b[1] - a[1]) - (y - a[1]) * (b[0] - a[0]);
    if (Math.abs(cross) <= 1e-8 && x >= Math.min(a[0], b[0]) && x <= Math.max(a[0], b[0]) && y >= Math.min(a[1], b[1]) && y <= Math.max(a[1], b[1])) return true;
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
export const contains = (v: Volume, p: XYZ): boolean => p[2] >= v.zlo && p[2] <= v.zhi && inside(v.poly, p[0], p[1]);

/** Exact XY union area by vertical slabs. Vertex and edge-intersection Xs
 * partition the plane into slabs where the union's height is linear. This
 * avoids double counting stacked/overlapping venue volumes in the report. */
export function footprint(volumes: readonly Volume[]): number {
  if (volumes.length === 1) return area(volumes[0].poly);
  const xs = new Set(volumes.flatMap((v) => v.poly.map((p) => p[0])));
  for (let i = 0; i < volumes.length; i++) for (let j = i + 1; j < volumes.length; j++) {
    const p = volumes[i].poly, q = volumes[j].poly;
    for (let a = 0; a < p.length; a++) for (let b = 0; b < q.length; b++) {
      const u = p[a], v = p[(a+1)%p.length], w = q[b], z = q[(b+1)%q.length];
      const dx = v[0]-u[0], dy = v[1]-u[1], ex = z[0]-w[0], ey = z[1]-w[1], det = dx*ey-dy*ex;
      if (det === 0) continue;
      const t = ((w[0]-u[0])*ey-(w[1]-u[1])*ex)/det;
      const s = ((w[0]-u[0])*dy-(w[1]-u[1])*dx)/det;
      if (t > 0 && t < 1 && s > 0 && s < 1) xs.add(u[0]+t*dx);
    }
  }
  const cuts = [...xs].sort((a,b)=>a-b);
  let result = 0;
  for (let i = 1; i < cuts.length; i++) {
    const x = (cuts[i-1]+cuts[i])/2, intervals: Array<[number,number]> = [];
    for (const {poly} of volumes) {
      const ys: number[] = [];
      for (let j = 0; j < poly.length; j++) {
        const a = poly[j], b = poly[(j+1)%poly.length];
        if ((a[0]>x)!==(b[0]>x)) ys.push(a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]));
      }
      ys.sort((a,b)=>a-b);
      for (let j = 0; j+1 < ys.length; j+=2) intervals.push([ys[j],ys[j+1]]);
    }
    intervals.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    let length = 0, lo = 0, hi = 0, active = false;
    for (const [a,b] of intervals) {
      if (!active) { lo=a; hi=b; active=true; }
      else if (a<=hi) hi=Math.max(hi,b);
      else { length+=hi-lo; lo=a; hi=b; }
    }
    if (active) length+=hi-lo;
    result += length*(cuts[i]-cuts[i-1]);
  }
  return result;
}

/** Sutherland–Hodgman rectangle clipping. A concave outline can retain boundary
 * bridges between disconnected components; their even/odd interior and area
 * remain exact, rather than replacing the outline with a bounding rectangle. */
export function clip(poly: readonly XY[], xmin: number, ymin: number, xmax: number, ymax: number): XY[] {
  let out = poly.map((p) => [...p] as XY);
  for (const [axis, bound, sign] of [[0, xmin, 1], [0, xmax, -1], [1, ymin, 1], [1, ymax, -1]]) {
    const input = out; out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length];
      const ia = sign * (a[axis] - bound) >= 0, ib = sign * (b[axis] - bound) >= 0;
      if (ia) out.push(a);
      if (ia !== ib) {
        const t = (bound - a[axis]) / (b[axis] - a[axis]);
        const p: XY = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        p[axis] = bound; out.push(p);
      }
    }
    out = out.filter((p, i) => { const q = out[(i + out.length - 1) % out.length]; return p[0] !== q[0] || p[1] !== q[1]; });
  }
  return out;
}
export function centre(volumes: Volume[]): XYZ {
  let sum = 0, x = 0, y = 0, z = 0;
  for (const v of volumes) {
    let twice = 0, cx = 0, cy = 0;
    for (let i = 0; i < v.poly.length; i++) {
      const a = v.poly[i], b = v.poly[(i + 1) % v.poly.length], c = a[0] * b[1] - b[0] * a[1];
      twice += c; cx += (a[0] + b[0]) * c; cy += (a[1] + b[1]) * c;
    }
    const w = Math.abs(twice) / 2;
    if (!w) continue;
    sum += w; x += cx / (3 * twice) * w; y += cy / (3 * twice) * w; z += (v.zlo + v.zhi) / 2 * w;
  }
  return [x / sum, y / sum, z / sum];
}
/** Venue precedence and the caller's canonical cell order settle boundary ties. */
export function cellAt(geometry: Record<string, CellGeometry>, p: XYZ): string | undefined {
  if (!p.every(Number.isFinite)) return undefined;
  const cells = Object.entries(geometry).sort(([, a], [, b]) => {
    if (a.place && b.place) return a.place < b.place ? -1 : a.place > b.place ? 1 : 0;
    if (a.place || b.place) return a.place ? -1 : 1;
    return a.grid![0] - b.grid![0] || a.grid![1] - b.grid![1];
  });
  return cells.find(([, g]) => g.place && g.volumes.some((v) => contains(v, p)))?.[0]
    ?? cells.find(([, g]) => g.grid && g.volumes.some((v) => contains(v, p)))?.[0];
}
