import type { Point } from "./recipe";

export type PigmentStrength = (u: number, v: number) => number;
const bounded = (value: number) => Math.min(1, Math.max(0, value));

/** Prepare a positive, arclength-weighted boundary blend in control UV space.
 * The footprint is resolution-independent and deliberately never zero: crossing
 * edges can request contradictory strengths. Knots are blend targets, not exact
 * interpolation constraints. Preparation happens once for a raster, not a pixel.
 */
export function preparePigmentStrength(polygon: readonly Point[], blend: number): PigmentStrength {
  if (!Number.isFinite(blend) || blend <= 0) throw Error("Pigment blend must be positive.");
  if (polygon.length === 0) return () => 0;
  const uniform = polygon[0].weight;
  if (polygon.every(point => point.weight === uniform)) return () => uniform;
  const edges = polygon.flatMap((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    const length = Math.hypot(b.u - a.u, b.v - a.v);
    return length === 0 ? [] : [{
      u: a.u, v: a.v, x: (b.u - a.u) / length, y: (b.v - a.v) / length,
      length, weight: a.weight, delta: b.weight - a.weight,
    }];
  });
  // A fully collapsed path has no arclength. Define its pigment independently
  // of edge ordering; geometry still controls whether it covers any pixel.
  if (edges.length === 0) {
    const mean = polygon.reduce((sum, point) => sum + point.weight, 0) / polygon.length;
    return () => mean;
  }
  const epsilon2 = blend * blend;
  return (u, v) => {
    let numerator = 0, denominator = 0;
    for (const edge of edges) {
      const du = u - edge.u, dv = v - edge.v;
      const along = du * edge.x + dv * edge.y, across = du * edge.y - dv * edge.x;
      const h2 = across * across + epsilon2;
      const center = edge.length / 2 - along;
      if (edge.length < 1e-5 * Math.sqrt(center * center + h2)) {
        // For tiny/distant segments the first-moment expression subtracts
        // nearly equal terms. Two-node Gauss integration avoids cancellation;
        // this small-ratio branch keeps roundoff from dominating the contribution.
        // Linear endpoint strengths are still integrated, not point-averaged.
        const offset = edge.length / Math.sqrt(12);
        const k0 = edge.length / 2 / ((center - offset) ** 2 + h2);
        const k1 = edge.length / 2 / ((center + offset) ** 2 + h2);
        numerator += (edge.weight + edge.delta * (0.5 - 1 / Math.sqrt(12))) * k0
          + (edge.weight + edge.delta * (0.5 + 1 / Math.sqrt(12))) * k1;
        denominator += k0 + k1;
      } else {
        const h = Math.sqrt(h2), end = edge.length - along;
        const integral = Math.atan2(edge.length * h, h2 - along * end) / h;
        const firstMoment = 0.5 * Math.log1p(edge.length * (edge.length - 2 * along)
          / (along * along + h2)) + along * integral;
        numerator += edge.weight * integral + edge.delta * (firstMoment / edge.length);
        denominator += integral;
      }
    }
    return bounded(numerator / denominator);
  };
}
