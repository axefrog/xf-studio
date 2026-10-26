// Geometry equality for the offline overlay. Streaming levels are loading bands; only measured matches are removed.
import type { Solid, Vec3 } from "./model.ts";

export const OVERLAP_POSITION_M = 0.001;
export const OVERLAP_ANGLE_RAD = 0.0001;
export interface ColliderPose extends Pick<Solid, "center" | "axes"> {
  id: string; actor: string; actorShapes: number; level: number; category: string;
  kind: "box" | "sphere" | "capsule" | "convexMesh" | "triangleMesh";
  size?: Vec3; hash?: string;
}
const lengths = (c: ColliderPose) => c.axes.map(a => Math.hypot(...a));
export function sameCollider(a: ColliderPose, b: ColliderPose): boolean {
  if (a.kind !== b.kind || a.hash !== b.hash || Math.hypot(...a.center.map((x, i) => x - b.center[i])) > OVERLAP_POSITION_M) return false;
  const al = lengths(a), bl = lengths(b);
  // Equal total capsule bounds alone do not prove equal geometry: keep the cap radius and cylinder length distinct.
  if (a.kind === "capsule" && (Math.abs(2 * a.size![0] * al[2] - 2 * b.size![0] * bl[2]) > OVERLAP_POSITION_M ||
    Math.abs(a.size![1] * al[2] - b.size![1] * bl[2]) > OVERLAP_POSITION_M)) return false;
  for (let i = 0; i < 3; i++) {
    const dim = (c: ColliderPose, ls: number[]) => c.kind === "box" ? 2 * c.size![i] * ls[i] : c.kind === "sphere" ? 2 * c.size![0] * ls[i]
      : c.kind === "capsule" ? (i === 2 ? c.size![1] + 2 * c.size![0] : 2 * c.size![0]) * ls[i] : ls[i];
    const tolerance = a.size ? OVERLAP_POSITION_M : 0.000001; // A shared cooked hash identifies dimensions; compare its scale.
    if (Math.abs(dim(a, al) - dim(b, bl)) > tolerance) return false;
    if (al[i] && bl[i]) {
      const cosine = a.axes[i].reduce((n, x, j) => n + x * b.axes[i][j], 0) / (al[i] * bl[i]);
      if (cosine < Math.cos(OVERLAP_ANGLE_RAD)) return false;
    } else if (al[i] !== bl[i]) return false;
  }
  return true;
}

/** Call in ascending level order. Adjacent cells are searched so quantisation boundaries never hide a 1 mm match. */
export class ColliderOverlap {
  private readonly spaces = new Map<string, Map<string | undefined, Map<number, Map<number, ColliderPose[]>>>>();
  private readonly width = 0.01;
  add(c: ColliderPose): ColliderPose | undefined {
    const p = c.center.map(x => Math.floor(x / this.width));
    let hashes = this.spaces.get(c.kind); if (!hashes) this.spaces.set(c.kind, hashes = new Map());
    let cells = hashes.get(c.hash); if (!cells) hashes.set(c.hash, cells = new Map());
    // A numeric XY key avoids allocating 27 strings per input shape. Exact geometry tests still decide equality.
    const key = (x: number, y: number) => x * 2 ** 24 + y;
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) {
      const zs = cells.get(key(p[0] + x, p[1] + y)); if (!zs) continue;
      for (let z = -1; z <= 1; z++) for (const other of zs.get(p[2] + z) ?? []) if (sameCollider(c, other)) return other;
    }
    const cell = key(p[0], p[1]); let zs = cells.get(cell); if (!zs) cells.set(cell, zs = new Map());
    const list = zs.get(p[2]) ?? []; list.push(c); zs.set(p[2], list); return undefined;
  }
}
