/**
 * The starter shapes against the real eye plate (skipped without a prepared 3D preview, failing under XFS_REQUIRE_ORACLES=1): the
 * landmarks `EYE_LANDMARKS` restates are the plate's own (the slit and its corners), and every contributed starter's outline, with room
 * for its feather, lies on the plate, so no starter ends in a hard line at the plate's edge in game (PREV-146). Both default plates, the
 * feminine and the masculine V's, share the head UV, so both are checked when prepared.
 */
import { expect } from "bun:test";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SurfaceMap, uvHoleBridges } from "../src/legacy/eye-makeup/browser/surface-map";
import { curve, layerCoverageSampler } from "../src/engines/layered-makeup/recipe";
import { layerWithShape } from "../src/engines/layered-makeup/starter-shape";
import { EYE_MAKEUP_REGION, newLayerTemplate } from "../src/features/eye-makeup/region";
import { EYE_LANDMARKS, EYE_STARTERS } from "../src/features/eye-makeup/starters";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { oracleTest } from "./optional-oracles";

type UV = { u: number; v: number };
const cacheRoot = resolve(process.env.XFS_PREVIEW_CORE_CACHE || resolve(import.meta.dir, "..", "data", "preview-cache"));
for (const body of ["female", "male"] as const) {
  let head: string | undefined;
  try { head = readdirSync(cacheRoot).filter(name => name.startsWith(`xfs-preview-core-${body}-average`)).sort()
    .map(name => resolve(cacheRoot, name, "assets", "head.glb")).find(path => existsSync(path)); } catch { /* No prepared cache. */ }
  const plateTest = oracleTest(!!head, `no prepared ${body}-average preview cache; prepare this body's preview or set XFS_PREVIEW_CORE_CACHE to its cache root.`);
  plateTest(`${body} real plate: the landmarks are the slit's rims and corners, and every starter lies on the plate with room for its feather`, async () => {
    const gltf = await new GLTFLoader().parseAsync(await Bun.file(head!).arrayBuffer(), "");
    const plate = gltf.scene.getObjectByName("makeup_plate") as THREE.Mesh, uv = plate.geometry.getAttribute("uv");
    // The eye opening of the u < ½ eye: the bridged hole's boundary vertices.
    const rim = [...new Set(uvHoleBridges(plate.geometry).flat())].map(i => ({ u: uv.getX(i), v: uv.getY(i) })).filter(point => point.u < 0.5);
    expect(rim.length).toBeGreaterThan(20);
    const innerU = Math.max(...rim.map(point => point.u)), outerU = Math.min(...rim.map(point => point.u));
    expect(innerU).toBeCloseTo(EYE_LANDMARKS.innerCorner[0], 3);
    expect(outerU).toBeCloseTo(EYE_LANDMARKS.outerCorner[0], 3);
    expect(rim.find(point => point.u === innerU)!.v).toBeCloseTo(EYE_LANDMARKS.innerCorner[1], 3);
    expect(rim.find(point => point.u === outerU)!.v).toBeCloseTo(EYE_LANDMARKS.outerCorner[1], 3);
    // The slit follows the rims: each landmark sample lies within 0.0015 of a rim vertex.
    for (const [u, v] of EYE_LANDMARKS.slit)
      expect(Math.min(...rim.map(point => Math.hypot(point.u - u, point.v - v)))).toBeLessThan(0.0015);
    // The plate's UV bounds are the region's area.
    let u0 = 1, u1 = 0, v0 = 1, v1 = 0;
    for (let i = 0; i < uv.count; i++) { u0 = Math.min(u0, uv.getX(i)); u1 = Math.max(u1, uv.getX(i)); v0 = Math.min(v0, uv.getY(i)); v1 = Math.max(v1, uv.getY(i)); }
    expect([u0, u1, v0, v1].map(value => Math.round(value * 1000) / 1000)).toEqual([EYE_LANDMARKS.plate.u0, EYE_LANDMARKS.plate.u1, EYE_LANDMARKS.plate.v0, EYE_LANDMARKS.plate.v1]);
    // The plate's outer edge (the boundary edges of the mesh, welded by position and UV; the eye opening's loop left out).
    const position = plate.geometry.getAttribute("position"), index = plate.geometry.index!;
    const key = (i: number) => [position.getX(i), position.getY(i), position.getZ(i), uv.getX(i), uv.getY(i)].map(value => value.toFixed(5)).join(",");
    const uses = new Map<string, { a: number; b: number; count: number }>();
    for (let t = 0; t < index.count; t += 3) for (const [from, to] of [[0, 1], [1, 2], [2, 0]] as const) {
      const a = index.getX(t + from), b = index.getX(t + to), edge = [key(a), key(b)].sort().join("|"), seen = uses.get(edge);
      if (seen) seen.count++; else uses.set(edge, { a, b, count: 1 });
    }
    const edge: UV[] = [];
    for (const { a, b, count } of uses.values()) if (count === 1) for (const i of [a, b]) {
      const point = { u: uv.getX(i), v: uv.getY(i) };
      if (point.u < 0.49 && !(point.u > 0.37 && point.u < 0.43 && point.v > 0.244 && point.v < 0.258)) edge.push(point);
    }
    expect(edge.length).toBeGreaterThan(40);
    // No starter paints at the plate's edge (coverage under 2/255, the edge warning's threshold), and each one's outline, one feather out,
    // is still on the plate.
    const map = new SurfaceMap(plate.geometry, { bridgeHoles: true });
    for (const starter of EYE_STARTERS) {
      const layer = layerWithShape(newLayerTemplate(), starter.shape), sample = layerCoverageSampler(layer, EYE_MAKEUP_REGION.mirror);
      expect(Math.max(...edge.map(point => sample(point.u, point.v))), `${starter.name} still paints at the plate's edge`).toBeLessThan(2 / 255);
      const outline = curve(structuredClone(starter.shape.points) as never, 10), off: string[] = [];
      for (const point of outline) for (let k = 0; k < 16; k++) {
        const angle = k * Math.PI / 8, probe = { u: point.u + starter.shape.feather * Math.cos(angle), v: point.v + starter.shape.feather * Math.sin(angle) };
        if (!map.anchor(probe, true)) off.push(`${probe.u.toFixed(4)},${probe.v.toFixed(4)}`);
      }
      expect(off, `${starter.name} has probes outside the ${body} plate`).toEqual([]);
    }
  });
}
