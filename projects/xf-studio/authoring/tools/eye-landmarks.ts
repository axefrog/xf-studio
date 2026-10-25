/**
 * Measures where the eye sits on the eye plate's UV (the numbers `EYE_LANDMARKS` in src/features/eye-makeup/starters.ts restates), from
 * the prepared 3D preview's plate. Read-only; prints JSON.
 *
 *   bun tools/eye-landmarks.ts [path to a prepared preview's head.glb]      (default: the ready preview cache, XFS_PREVIEW_CORE_CACHE)
 *
 * - **Slit and corners:** the eye opening is the plate's one interior hole of the u < ½ eye (`uvHoleBridges`); its rims fold onto each
 *   other in UV, so one polyline is both lash lines. The inner corner is the rim vertex nearest the face's centre line, the outer the farthest.
 * - **Crease:** the groove between lid and brow bone. Per vertex, the uniform Laplacian's component along the surface normal says how
 *   concave the surface is there (neighbours further out than the vertex); per 0.01 of u, the most concave vertex above the slit is the crease.
 *   Vertices are sparse, so it is good to about 0.003 in v; the two default plates agree to that (knowledge/face-makeup.md).
 * - **Plate:** its UV bounds.
 */
import { resolve } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { uvHoleBridges } from "../src/legacy/eye-makeup/browser/surface-map";
import { derivedPreviewPath } from "../tests/private-assets";

const file = process.argv[2] ? resolve(process.argv[2]) : derivedPreviewPath("head.glb");
if (!file) throw Error("No prepared 3D preview: pass a head.glb, or set XFS_PREVIEW_CORE_CACHE to a ready cache.");
const gltf = await new GLTFLoader().parseAsync(await Bun.file(file).arrayBuffer(), "");
gltf.scene.updateMatrixWorld(true);
const plate = gltf.scene.getObjectByName("makeup_plate") as THREE.Mesh, geometry = plate.geometry;
const position = geometry.getAttribute("position"), uv = geometry.getAttribute("uv"), index = geometry.index!;
const world = (i: number) => new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(plate.matrixWorld);
const round = (value: number) => Math.round(value * 10000) / 10000;

// The slit of the u < ½ eye.
const rimIds = [...new Set(uvHoleBridges(geometry).flat())].filter(i => uv.getX(i) < 0.5);
const rim = rimIds.map(i => ({ u: uv.getX(i), v: uv.getY(i), x: Math.abs(world(i).x) }));
const inner = rim.reduce((a, b) => a.x < b.x ? a : b), outer = rim.reduce((a, b) => a.x > b.x ? a : b);
const lashLine = rim.sort((a, b) => b.u - a.u).filter((point, i, all) => !i || Math.abs(point.u - all[i - 1]!.u) > 0.003).map(point => [round(point.u), round(point.v)]);

// Concavity per welded position: the uniform Laplacian along the (area-weighted) normal; the outward normal points -z on this plate.
const weld = new Map<string, number>(), rep: number[] = [];
const keyOf = (i: number) => [position.getX(i), position.getY(i), position.getZ(i)].map(value => value.toFixed(6)).join(",");
const id = (i: number) => { const key = keyOf(i); let at = weld.get(key); if (at === undefined) { at = rep.length; weld.set(key, at); rep.push(i); } return at; };
const neighbours: Set<number>[] = [], normals: THREE.Vector3[] = [];
for (let t = 0; t < index.count; t += 3) {
  const ids = [0, 1, 2].map(k => id(index.getX(t + k))), points = [0, 1, 2].map(k => world(index.getX(t + k)));
  const face = new THREE.Vector3().crossVectors(points[1]!.clone().sub(points[0]!), points[2]!.clone().sub(points[0]!));
  for (const a of ids) { neighbours[a] ??= new Set(); normals[a] ??= new THREE.Vector3(); normals[a]!.add(face); for (const b of ids) if (a !== b) neighbours[a]!.add(b); }
}
const concavity = rep.map((vertex, a) => {
  const around = [...neighbours[a]!], here = world(vertex), mean = around.reduce((sum, b) => sum.add(world(rep[b]!)), new THREE.Vector3()).divideScalar(around.length);
  return mean.sub(here).dot(normals[a]!.clone().normalize());
});
const crease: number[][] = [];
for (let u = 0.37; u < 0.435; u += 0.01) {
  const slit = lashLine.reduce((best, point) => Math.abs(point[0]! - u) < Math.abs(best[0]! - u) ? point : best)[1]!;
  let best: { v: number; h: number } | undefined;
  rep.forEach((vertex, a) => {
    const ux = uv.getX(vertex), vx = uv.getY(vertex);
    if (Math.abs(ux - u) <= 0.005 && vx > 0.215 && vx < slit - 0.003 && (!best || concavity[a]! > best.h) && world(vertex).x > 0) best = { v: vx, h: concavity[a]! };
  });
  if (best) crease.push([round(u), round(best.v)]);
}
let u0 = 1, u1 = 0, v0 = 1, v1 = 0;
for (let i = 0; i < uv.count; i++) { u0 = Math.min(u0, uv.getX(i)); u1 = Math.max(u1, uv.getX(i)); v0 = Math.min(v0, uv.getY(i)); v1 = Math.max(v1, uv.getY(i)); }
console.log(JSON.stringify({ file: "head.glb", innerCorner: [round(inner.u), round(inner.v)], outerCorner: [round(outer.u), round(outer.v)], lashLine, crease,
  plate: { u0: round(u0), u1: round(u1), v0: round(v0), v1: round(v1) } }));
