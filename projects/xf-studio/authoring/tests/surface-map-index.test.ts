import { expect, test } from "bun:test";
import * as THREE from "three";
import { SurfaceMap, type UV } from "../src/surface-map";
import { privateAssetTest } from "./private-assets";

// Bypass only the new broad phase in the comparison instance. This retains the
// pre-index exhaustive triangle order and exact barycentric/clipping arithmetic.
function exhaustive(geometry: THREE.BufferGeometry) {
  const map = new SurfaceMap(geometry);
  const ids = (map as unknown as { triangles: unknown[] }).triangles.map((_, i) => i);
  Object.assign(map, { candidates: () => ids });
  return map;
}
function random() {
  let seed = 619403;
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
function compare(map: SurfaceMap, reference: SurfaceMap, a: UV, b: UV) {
  expect(map.anchor(a)).toEqual(reference.anchor(a));
  expect(map.continuous(a, b)).toBe(reference.continuous(a, b));
}

test("UV index preserves overlaps, relaxed edges, tiny gaps and outside-atlas queries", () => {
  const rand = random(), coords: number[] = [];
  for (let i = 0; i < 500; i++) {
    const u = rand() * 3 - 1, v = rand() * 3 - 1;
    coords.push(u, v, u + .001 + rand() * .05, v, u, v + .001 + rand() * .05);
  }
  // Identical overlapping islands must keep the original first triangle.
  coords.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
  // Degenerate UVs are omitted by both maps.
  coords.push(0, 0, 0, 0, 0, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute("uv", new THREE.BufferAttribute(new Float64Array(coords), 2));
  const map = new SurfaceMap(g), reference = exhaustive(g);
  for (let i = 0; i < 3000; i++) {
    const a = { u: rand() * 3 - 1, v: rand() * 3 - 1 };
    compare(map, reference, a, { u: a.u + (rand() - .5) * .08, v: a.v + (rand() - .5) * .08 });
  }
  for (const u of [-1e-6, -5e-7, 0, 1e-7, .5, 1, 1 + 5e-7])
    for (const v of [-1e-6, 0, .5, 1, 1 + 5e-7]) compare(map, reference, { u, v }, { u: u + 1e-8, v });
  expect(map.anchor({ u: .2, v: .2 })?.indices).toEqual([1500, 1501, 1502]);
  expect(map.anchor({ u: NaN, v: 0 })).toBeUndefined();
  expect(map.continuous({ u: Infinity, v: 0 }, { u: 0, v: 0 })).toBe(false);
});

privateAssetTest("real plate index matches exhaustive anchors and gap clipping with reduced search work", async () => {
  const buffer = await Bun.file(new URL("../public/assets/head.glb", import.meta.url)).arrayBuffer();
  const view = new DataView(buffer), length = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
  const primitive = json.meshes.find((m: { name: string }) => m.name.endsWith(".012")).primitives[0];
  const read = (id: number, components: number) => {
    const a = json.accessors[id], b = json.bufferViews[a.bufferView], bytes = a.componentType === 5123 ? 2 : 4;
    const start = 28 + length + (b.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = b.byteStride ?? components * bytes;
    return Array.from({ length: a.count * components }, (_, n) => {
      const at = start + Math.floor(n / components) * stride + n % components * bytes;
      return a.componentType === 5126 ? view.getFloat32(at, true) : bytes === 2 ? view.getUint16(at, true) : view.getUint32(at, true);
    });
  };
  const g = new THREE.BufferGeometry();
  g.setAttribute("uv", new THREE.Float32BufferAttribute(read(primitive.attributes.TEXCOORD_0, 2), 2));
  g.setIndex(read(primitive.indices, 1));
  const map = new SurfaceMap(g), reference = exhaustive(g), rand = random();
  let candidateCount = 0;
  const indexed = map as unknown as { candidates(bounds: {minU:number;maxU:number;minV:number;maxV:number}): number[] };
  const queries = Array.from({ length: 3000 }, () => ({ u: .25 + rand() * .5, v: .15 + rand() * .2 }));
  for (const a of queries) {
    compare(map, reference, a, { u: a.u + (rand() - .5) * .07, v: a.v + (rand() - .5) * .07 });
    candidateCount += indexed.candidates({ minU: a.u, maxU: a.u, minV: a.v, maxV: a.v }).length;
  }
  // Also sample real shared vertices and points just outside tolerance boundaries.
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) for (const offset of [0, -1e-9, 1e-9]) {
    const a = { u: uv.getX(i) + offset, v: uv.getY(i) - offset };
    expect(map.anchor(a)).toEqual(reference.anchor(a));
  }
  expect(candidateCount / queries.length).toBeLessThan(20);
  const timing = (m: SurfaceMap) => { const start = performance.now(); for (const q of queries) m.anchor(q); return performance.now() - start; };
  timing(map); timing(reference);
  console.log("Plate UV lookup", { triangles: g.index!.count / 3, queries: queries.length,
    meanCandidates: candidateCount / queries.length, indexedMs: timing(map), exhaustiveMs: timing(reference) });
});
