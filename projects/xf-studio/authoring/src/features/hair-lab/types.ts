/** Plain authored data and discardable head-space results; metres, radians and seconds. */
export type Vec3 = [number, number, number];
export type Unit = "m" | "rad" | "ratio";
export type Chart = "scalp" | "volume";
export type Field = { unit: Unit; chart: Chart } & (
  | { op: "constant"; value: number }
  | { op: "ramp"; axis: "u" | "v" | "distance" | "entrance"; from: number; to: number }
  | { op: "variation"; seed: number; from: number; to: number }
  | { op: "smoothstep"; input: Field; low: number; high: number }
  | { op: "multiply" | "override"; a: Field; b: Field }
  | { op: "blend"; a: Field; b: Field; mask: Field }
  | { op: "min" | "max"; a: Field; b: Field; smoothness: number });
export type MaterialSample = { id: string; index: number; uv: readonly [number, number]; cross: readonly [number, number]; distance: number; entrance: number; phase: number };
export type ChartMapping = { matrix: readonly [number, number, number, number]; offset: readonly [number, number] };
export type Capsule = { a: Vec3; b: Vec3; radius: number; radii?: Vec3 };
export type HeadSurface = { resource: string; topology: string; revision: string; positions: number[]; indices: number[]; uv: number[];
  coverageSurface?: { resource: string; positions: number[]; indices: number[]; uv: number[]; mask?: { width: number; height: number; values: string | Uint8Array } };
  down: Vec3; front?: Vec3; capsules: Capsule[]; cap?: { source: string; points: number[]; indices?: number[]; uv?: number[]; mask?: { width: number; height: number; values: string | Uint8Array } }; body?: { positions: number[]; indices: number[] } };
export type VolumeNode = { kind: "root"; next: string } | { kind: "convergence"; next: string; tie?: { position: Vec3; radiusMetres: number } } | { kind: "volume"; next: string; length: string; section?: string; clump?: string; mapping?: ChartMapping }
  | { kind: "branch"; outlets: string[]; selection: number | Field } | { kind: "termination" };
export type Groom = {
  schema: "xfs/hair-groom-part-1"; name: string; population: { seed: number; count: number };
  scalp: { resource: string; topology: string; densitySeed: { method: "cap-projected" | "head-estimated"; source: string; revision: string }; density?: number[]; binding?: { triangles: number[]; cumulativeAreas: number[] } };
  graph: { root: string; nodes: Record<string, VolumeNode> }; fields: Record<string, Field>;
  cut?: { normal: Vec3; offsetMetres: number };
  flow?: { part: number; emergenceRadians: number; foreheadSweep: number; crownLiftMetres: number; rearPreference: number; foreheadDirection?: Vec3; partCombing?: Vec3 };
  solver: { samples: number; intervals: number; steps: number; iterations: number; stepSeconds: number; clearanceMetres: number };
};
export type Root = MaterialSample & { position: Vec3; normal: Vec3; triangle: number; barycentric: Vec3; density: number };
export type HairPath = { root: Root; points: Vec3[]; intrinsicMetres: number; segmentMetres?: number[]; holds?: { index: number; position: Vec3 }[]; termination?: { normal: Vec3; offsetMetres: number } };
export type Paths = { paths: HairPath[] };
export type Residuals = { rootMetres: number; lengthRatio: number; penetrationMetres: number; minimumClearanceMetres: number; visibleExtentMetres: number; colliders?: { name: string; minimumClearanceMetres: number; penetrationMetres: number }[] };
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const magnitude = (a: Vec3) => Math.hypot(...a);
export const normalise = (a: Vec3): Vec3 => mul(a, 1 / (magnitude(a) || 1));
export const lerp = (a: Vec3, b: Vec3, t: number) => add(mul(a, 1 - t), mul(b, t));
export const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
export const smooth = (lo: number, hi: number, value: number) => { const t = clamp((value - lo) / (hi - lo)); return t * t * (3 - 2 * t); };
/** Stable integer hash, never ambient randomness. */
export function randomAt(seed: number, index: number): number {
  let x = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ x >>> 16, 0x21f0aaad); x = Math.imul(x ^ x >>> 15, 0x735a2d97);
  return ((x ^ x >>> 15) >>> 0) / 4294967296;
}
export const vertex = (p: readonly number[], index: number): Vec3 => [p[index * 3], p[index * 3 + 1], p[index * 3 + 2]];
