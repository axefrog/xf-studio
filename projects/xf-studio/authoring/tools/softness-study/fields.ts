import { preparePigmentStrength } from "../../src/pigment-strength";
import type { Point } from "../../src/recipe";

export type SoftPoint = Point & { width: number };
export type WidthMode = "linear" | "log";
export type WidthField = (u: number, v: number) => number;
const clamp = (x: number) => Math.max(0, Math.min(1, x));

export function widthField(polygon: SoftPoint[], blend: number, mode: WidthMode): WidthField {
  if (!polygon.length || polygon.some(p => !Number.isFinite(p.width) || p.width <= 0)) throw Error("Positive widths required");
  const lo = Math.min(...polygon.map(p => p.width)), hi = Math.max(...polygon.map(p => p.width));
  if (lo === hi) return () => lo; // Preserve exact uniform-width arithmetic.
  const encode = mode === "log" ? Math.log : (x: number) => x;
  const a = encode(lo), range = encode(hi) - a;
  const blendAt = preparePigmentStrength(polygon.map(p => ({...p, weight: (encode(p.width) - a) / range})), blend);
  return mode === "log" ? (u,v) => Math.exp(a + range * blendAt(u,v)) : (u,v) => a + range * blendAt(u,v);
}

export function geometry(u: number, v: number, polygon: SoftPoint[]) {
  let inside = false, best = Infinity, width = polygon[0].width, strength = polygon[0].weight;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if ((a.v > v) !== (b.v > v) && u < (b.u - a.u) * (v - a.v) / (b.v - a.v) + a.u) inside = !inside;
    const dx = b.u - a.u, dy = b.v - a.v;
    const t = clamp(((u - a.u) * dx + (v - a.v) * dy) / (dx * dx + dy * dy || 1));
    const distance = (u - a.u - dx*t)**2 + (v - a.v - dy*t)**2;
    if (distance < best) { best = distance; width = a.width * (1-t) + b.width*t; strength = a.weight * (1-t) + b.weight*t; }
  }
  return { signedDistance: (inside ? 1 : -1) * Math.sqrt(best), nearestWidth: width, nearestStrength: strength };
}

export function prepareCoverage(polygon: SoftPoint[], field: WidthField | null, opacity = 1, pigmentBlend = .0005) {
  const pigment = preparePigmentStrength(polygon, pigmentBlend);
  return (u: number, v: number) => {
    const g = geometry(u,v,polygon), width = field ? field(u,v) : g.nearestWidth;
    const x = clamp(.5 + g.signedDistance / width);
    return x*x*(3-2*x) * pigment(u,v) * opacity;
  };
}

export function subdivide(polygon: SoftPoint[], mode: WidthMode, count = 7): SoftPoint[] {
  return polygon.flatMap((a,i) => {
    const b = polygon[(i+1)%polygon.length];
    return Array.from({length: count}, (_,j) => {
      const t = j/count;
      return {u:a.u+(b.u-a.u)*t, v:a.v+(b.v-a.v)*t, weight:a.weight+(b.weight-a.weight)*t,
        width:mode === "log" ? Math.exp(Math.log(a.width)*(1-t)+Math.log(b.width)*t) : a.width*(1-t)+b.width*t};
    });
  });
}

export const strip = (gap: number): SoftPoint[] => [
  {u:.2,v:.4,weight:1,width:.001}, {u:.8,v:.4,weight:1,width:.001},
  {u:.8,v:.4+gap,weight:1,width:.04}, {u:.2,v:.4+gap,weight:1,width:.04},
];

export const fixtures: Record<string,SoftPoint[]> = {
  thin: strip(.004), narrow: strip(.001), separated: strip(.04),
  corner: [
    {u:.3,v:.3,weight:.2,width:.001}, {u:.7,v:.3,weight:.5,width:.001},
    {u:.7,v:.7,weight:1,width:.04}, {u:.3,v:.7,weight:.7,width:.04},
  ],
  concave: [[.25,.25,.001],[.65,.25,.001],[.65,.65,.04],[.55,.65,.04],[.55,.35,.001],[.35,.35,.001],[.35,.65,.04],[.25,.65,.04]].map(([u,v,width]) => ({u,v,width,weight:1})),
  crossing: [
    {u:.3,v:.3,weight:1,width:.001}, {u:.7,v:.7,weight:1,width:.001},
    {u:.3,v:.7,weight:1,width:.04}, {u:.7,v:.3,weight:1,width:.04},
  ],
};
