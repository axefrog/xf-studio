// The offline base layer: district and venue outlines and streaming cells, from a world pack built out of game
// data (tools/build-world-pack.ts). Offline geometry is an estimate of the live world: mods, variants and doors
// change it, so a pack always carries its provenance.
import { existsSync, readFileSync } from "node:fs";
import type { Area, Cell, Vec3, WorldPack } from "./model.ts";

export function loadWorldPack(path: string): WorldPack | undefined {
  if (!existsSync(path)) return undefined;
  const pack = JSON.parse(readFileSync(path, "utf8")) as WorldPack;
  if (pack.schema !== "xfh/world-pack-1") throw new Error(`Not a world pack: ${pack.schema}`);
  return pack;
}

export interface Box { min: [number, number]; max: [number, number] }
const extents = new WeakMap<WorldPack, WorldPack["extent"]>();
function fullExtent(pack: WorldPack): WorldPack["extent"] {
  if (pack.extent) return pack.extent;
  if (extents.has(pack)) return extents.get(pack);
  const min: Vec3=[Infinity,Infinity,Infinity],max: Vec3=[-Infinity,-Infinity,-Infinity];
  const include=(point:Vec3)=>{for(let i=0;i<3;i++){min[i]=Math.min(min[i],point[i]);max[i]=Math.max(max[i],point[i]);}};
  for(const cell of pack.cells){include(cell.min);include(cell.max);}
  for(const area of pack.areas)for(const [x,y] of area.poly){include([x,y,area.zlo]);include([x,y,area.zhi]);}
  const result=Number.isFinite(min[0])?{min,max}:undefined;extents.set(pack,result);return result;
}

/** The part of a pack around a box (for example a session's path plus a margin). */
export function region(pack: WorldPack, box: Box, margin = 250): WorldPack {
  const x0 = box.min[0] - margin, y0 = box.min[1] - margin, x1 = box.max[0] + margin, y1 = box.max[1] + margin;
  const overlaps = (ax0: number, ay0: number, ax1: number, ay1: number) => ax0 <= x1 && ax1 >= x0 && ay0 <= y1 && ay1 >= y0;
  const areas = pack.areas.filter(a => { const xs = a.poly.map(p => p[0]), ys = a.poly.map(p => p[1]); return overlaps(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)); });
  const cells = pack.cells.filter(c => overlaps(c.min[0], c.min[1], c.max[0], c.max[1]));
  return { ...pack, extent: fullExtent(pack), areas, cells };
}

export function boxOf(points: Vec3[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return { min: [x0, y0], max: [x1, y1] };
}

/** The smallest-footprint district whose outline and band hold the point (the places research's rule). */
export function districtAt(areas: Area[], p: Vec3): Area | undefined {
  let best: Area | undefined, bestArea = Infinity;
  for (const a of areas) {
    if (a.kind !== "district" || p[2] < a.zlo - 2 || p[2] > a.zhi + 2 || !inside(p[0], p[1], a.poly)) continue;
    const ar = footprint(a.poly);
    if (ar < bestArea) { best = a; bestArea = ar; }
  }
  return best;
}

export function inside(x: number, y: number, poly: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export function footprint(poly: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; s += x1 * y2 - x2 * y1; }
  return Math.abs(s) / 2;
}

export type { Area, Cell };
