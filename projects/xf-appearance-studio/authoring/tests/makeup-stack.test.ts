import { expect, test } from "bun:test";
import * as THREE from "three";
import { createMakeupStack } from "../src/makeup-stack";
import { initialRecipe } from "../src/recipe";

test("new makeup layers inherit morphs and extra bone weights; removal frees only owned resources", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([1, 2, 3], 3));
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute([2, 0, 0], 3)];
  geometry.morphTargetsRelative = true;
  for (const [j, w, joint] of [["skinIndex", "skinWeight", 0], ["joints_1", "weights_1", 1]] as const) {
    geometry.setAttribute(j, new THREE.Uint16BufferAttribute([joint, 0, 0, 0], 4));
    geometry.setAttribute(w, new THREE.Float32BufferAttribute([.5, 0, 0, 0], 4));
  }
  const anchor = new THREE.SkinnedMesh(geometry), root = new THREE.Group(); root.add(anchor);
  const bones = [new THREE.Bone(), new THREE.Bone()];
  anchor.skeleton = new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4()));
  anchor.morphTargetInfluences![0] = .75;
  const stack = createMakeupStack(anchor, 4);
  const canvas = () => ({ width: 8, height: 8 }) as HTMLCanvasElement;
  stack.setWire(true); stack.setCanvases([canvas(), canvas(), canvas(), canvas(), canvas()]);
  expect(stack.plates).toHaveLength(5);
  bones[1].position.x = 8; bones[1].updateMatrixWorld(true);
  for (const plate of stack.plates) {
    expect(plate.geometry).toBe(geometry); expect(plate.skeleton).toBe(anchor.skeleton);
    expect(plate.morphTargetInfluences).toBe(anchor.morphTargetInfluences);
    expect(plate.getVertexPosition(0, new THREE.Vector3()).x).toBeCloseTo(6.5, 6);
  }
  let disposed = 0, sharedDisposed = false;
  geometry.addEventListener("dispose", () => sharedDisposed = true);
  const layer = initialRecipe().layers[0]; layer.finish = "glitter";
  stack.updateLayer(4, layer);
  const removed = stack.plates[4], material = stack.materials[4];
  for (const resource of [material, stack.textures[4], material.normalMap!, material.roughnessMap!])
    resource.addEventListener("dispose", () => disposed++);
  stack.setCanvases([]);
  expect(disposed).toBe(4); expect(sharedDisposed).toBe(false);
  expect(removed.parent).toBeNull(); expect(root.children).toEqual([anchor]);
  anchor.morphTargetInfluences![0] = .25;
  stack.setCanvases([canvas()]); stack.updateLayer(0, { ...layer, finish: "matte" });
  expect(stack.plates[0].getVertexPosition(0, new THREE.Vector3()).x).toBeCloseTo(5.5, 6);
  expect(stack.materials[0].wireframe).toBe(true); expect(stack.plates[0].visible).toBe(true);
  stack.setCanvases([]);
});
