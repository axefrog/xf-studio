import { test, expect } from "bun:test";
import * as THREE from "three";
import { SurfaceMap, anchorPosition } from "../src/surface-map";
import { extendSkin } from "../src/skin";

function geometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  g.setIndex([0, 1, 2]);
  return g;
}
test("UV anchors interpolate a deformed triangle and reject outside/degenerate UVs", () => {
  const g = geometry(),
    map = new SurfaceMap(g),
    a = map.anchor({ u: 0.2, v: 0.3 })!;
  const vertices = [
    new THREE.Vector3(1, 2, 3),
    new THREE.Vector3(3, 2, 3),
    new THREE.Vector3(1, 6, 3),
  ];
  const p = anchorPosition(a, (i) => vertices[i], 0.01);
  expect(p.x).toBeCloseTo(1.4);
  expect(p.y).toBeCloseTo(3.2);
  expect(p.z).toBeCloseTo(3.01);
  expect(map.anchor({ u: 0.8, v: 0.8 })).toBeUndefined();
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2));
  expect(new SurfaceMap(g).anchor({ u: 0, v: 0 })).toBeUndefined();
});
test("drag paths cannot bridge missing UV surface or jump across an atlas seam", () => {
  const g = geometry();
  g.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(
      [0, 0, 0.02, 0, 0, 0.02, 0.03, 0, 0.05, 0, 0.05, 0.02],
      2,
    ),
  );
  g.setIndex([0, 1, 2, 3, 4, 5]);
  const map = new SurfaceMap(g);
  expect(map.anchor({ u: 0.005, v: 0.005 })).toBeDefined();
  expect(map.anchor({ u: 0.045, v: 0.005 })).toBeDefined();
  expect(map.continuous({ u: 0.005, v: 0.005 }, { u: 0.045, v: 0.005 })).toBe(
    false,
  );
  expect(map.continuous({ u: 0.005, v: 0.005 }, { u: 0.007, v: 0.006 })).toBe(
    true,
  );
  expect(
    new SurfaceMap(geometry()).continuous(
      { u: 0.1, v: 0.1 },
      { u: 0.5, v: 0.1 },
    ),
  ).toBe(false);
});
test("anchors follow simultaneous morphs and skin weights beyond the first four", () => {
  const g = geometry();
  g.morphTargetsRelative = true;
  g.morphAttributes.position = [
    new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2, 0, 0, 2], 3),
  ];
  g.setAttribute(
    "skinIndex",
    new THREE.Uint16BufferAttribute(Array(3).fill([0, 0, 0, 0]).flat(), 4),
  );
  g.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute(Array(3).fill([0.4, 0, 0, 0]).flat(), 4),
  );
  g.setAttribute(
    "joints_1",
    new THREE.Uint16BufferAttribute(Array(3).fill([1, 0, 0, 0]).flat(), 4),
  );
  g.setAttribute(
    "weights_1",
    new THREE.Float32BufferAttribute(Array(3).fill([0.6, 0, 0, 0]).flat(), 4),
  );
  const mat = new THREE.MeshStandardMaterial(),
    mesh = new THREE.SkinnedMesh(g, mat),
    bones = [new THREE.Bone(), new THREE.Bone()];
  bones[1].position.y = 2;
  bones.forEach((b) => b.updateMatrixWorld(true));
  mesh.skeleton = new THREE.Skeleton(
    bones,
    bones.map(() => new THREE.Matrix4()),
  );
  mesh.morphTargetInfluences![0] = 0.5;
  extendSkin(mesh, mat);
  const a = new SurfaceMap(g).anchor({ u: 0.2, v: 0.3 })!,
    p = anchorPosition(a, (i) =>
      mesh.getVertexPosition(i, new THREE.Vector3()),
    );
  expect(p.x).toBeCloseTo(0.2);
  expect(p.y).toBeCloseTo(1.5);
  expect(p.z).toBeCloseTo(1);
});
