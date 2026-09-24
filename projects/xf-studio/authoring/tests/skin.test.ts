import { test, expect } from "bun:test";
import * as THREE from "three";
import { extendSkin, restoreFirstWeights } from "../src/skin";
import { privateAssetTest } from "./private-assets";
test("CPU surface picking retains contributions beyond the first four", () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([1, 2, 3], 3));
  for (let i = 0; i < 3; i++) {
    g.setAttribute(
      i ? `joints_${i}` : "skinIndex",
      new THREE.Uint16BufferAttribute([i, 0, 0, 0], 4),
    );
    g.setAttribute(
      i ? `weights_${i}` : "skinWeight",
      new THREE.Float32BufferAttribute([i ? 0.3 : 0.4, 0, 0, 0], 4),
    );
  }
  const mat = new THREE.MeshStandardMaterial(),
    m = new THREE.SkinnedMesh(g, mat);
  const bones = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone()];
  bones[0].position.x = 1;
  bones[1].position.y = 2;
  bones[2].position.z = 3;
  bones.forEach((b) => b.updateMatrixWorld(true));
  m.skeleton = new THREE.Skeleton(
    bones,
    bones.map(() => new THREE.Matrix4()),
  );
  extendSkin(m, mat);
  const p = m.applyBoneTransform(0, new THREE.Vector3(1, 2, 3));
  expect(p.x).toBeCloseTo(1.4, 6);
  expect(p.y).toBeCloseTo(2.6, 6);
  expect(p.z).toBeCloseTo(3.9, 6);
  const q = m.applyBoneTransform(0, new THREE.Vector4(1, 2, 3, 1));
  expect(q.w).toBeCloseTo(1, 6);
  expect(q.x).toBeCloseTo(p.x, 6);
});
for (const [asset, morphCount, skinCount] of [
  ["head", 105, 2],
  ["brows", 105, 1],
  ["lashes", 21, 1],
] as const)
  privateAssetTest(`${asset} GLB retains customization morphs, all skin sets and normalized totals`, async () => {
    const file = Bun.file(
      new URL(`../public/assets/${asset}.glb`, import.meta.url),
    );
    if (!(await file.exists()))
      throw Error("Run local preview/detail intake before asset tests.");
    const buffer = await file.arrayBuffer(),
      view = new DataView(buffer),
      n = view.getUint32(12, true),
      json = JSON.parse(
        new TextDecoder().decode(new Uint8Array(buffer, 20, n)),
      ),
      start = 28 + n;
    const first = restoreFirstWeights(buffer);
    expect(first.size).toBe(skinCount);
    for (const mesh of json.meshes) {
      const p = mesh.primitives[0];
      if (!p.targets) continue;
      expect(p.targets.length).toBe(morphCount);
      expect(p.attributes.JOINTS_1).toBeDefined();
      expect(p.attributes.WEIGHTS_1).toBeDefined();
      const arrays = [];
      for (let k = 0; p.attributes[`WEIGHTS_${k}`] !== undefined; k++) {
        const a = json.accessors[p.attributes[`WEIGHTS_${k}`]],
          b = json.bufferViews[a.bufferView];
        arrays.push({
          count: a.count,
          offset: start + (b.byteOffset ?? 0) + (a.byteOffset ?? 0),
          stride: b.byteStride ?? 16,
        });
      }
      for (let i = 0; i < arrays[0].count; i++) {
        let sum = 0;
        for (const a of arrays)
          for (let k = 0; k < 4; k++)
            sum += view.getFloat32(a.offset + i * a.stride + k * 4, true);
        expect(sum).toBeCloseTo(1, 5);
      }
      expect(first.get(mesh.name)!.length).toBe(arrays[0].count * 4);
    }
  });
