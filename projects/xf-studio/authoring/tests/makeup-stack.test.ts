import { expect, test } from "bun:test";
import * as THREE from "three";
import { initialRecipe } from "./fixtures/eye-region";
import { createMakeupStack } from "./fixtures/eye-region";

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
  // The one lit plate (plate-blend.ts) deforms with them.
  expect((stack.plate.material as THREE.Material & { wireframe: boolean }).wireframe).toBe(true);
  // Each draws the stack's own geometry over the anchor's buffers (PREV-97): morphs and both weight sets shared, none copied.
  for (const name of ["position", "skinIndex", "skinWeight", "joints_1", "weights_1"]) expect(stack.geometry.getAttribute(name)).toBe(geometry.getAttribute(name));
  expect(stack.geometry.morphAttributes.position![0]).toBe(geometry.morphAttributes.position![0]);
  expect(stack.geometry.morphTargetsRelative).toBe(true);
  for (const plate of [...stack.plates, stack.plate]) {
    expect(plate.geometry).toBe(stack.geometry); expect(plate.skeleton).toBe(anchor.skeleton);
    expect(plate.morphTargetInfluences).toBe(anchor.morphTargetInfluences);
    expect(plate.getVertexPosition(0, new THREE.Vector3()).x).toBeCloseTo(6.5, 6);
  }
  let disposed = 0, sharedDisposed = false;
  geometry.addEventListener("dispose", () => sharedDisposed = true);
  const layer = initialRecipe().layers[0]; layer.finish = "glitter";
  stack.updateLayer(4, layer, { size: 8, normal: new Uint8Array(8 * 8 * 4), surface: new Uint8Array(8 * 8 * 4) });
  const removed = stack.plates[4], material = stack.materials[4];
  for (const resource of [material, stack.textures[4], material.normalMap!, material.roughnessMap!])
    resource.addEventListener("dispose", () => disposed++);
  stack.setCanvases([]);
  expect(disposed).toBe(4); expect(sharedDisposed).toBe(false);
  expect(removed.parent).toBeNull(); expect(root.children).toEqual([anchor, stack.plate]);
  anchor.morphTargetInfluences![0] = .25;
  stack.setCanvases([canvas()]); stack.updateLayer(0, { ...layer, finish: "matte" });
  expect(stack.plates[0].getVertexPosition(0, new THREE.Vector3()).x).toBeCloseTo(5.5, 6);
  expect(stack.materials[0].wireframe).toBe(true); expect(stack.plates[0].visible).toBe(true);
  stack.setCanvases([]);
});

test("reordering keeps each layer's complete mask and optical resources with its ID", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const root = new THREE.Group(), anchor = new THREE.SkinnedMesh(geometry);
  root.add(anchor);
  const stack = createMakeupStack(anchor, 1);
  const recipe = initialRecipe(), ids = recipe.layers.slice(0, 2).map(layer => layer.id);
  const canvases = ids.map(() => ({ width: 32, height: 32 }) as HTMLCanvasElement);
  stack.setCanvases(canvases, ids);
  const shimmer = { ...recipe.layers[0], finish: "shimmer" as const };
  stack.updateLayer(0, shimmer, { size: 32, normal: new Uint8Array(4096), surface: new Uint8Array(4096) });
  stack.updateLayer(1, recipe.layers[1]);
  const firstPlate = stack.plates[0], firstMaterial = stack.materials[0];
  const firstMask = stack.textures[0], firstOptics = firstMaterial.normalMap;
  stack.reconcileLayerCanvases([...ids].reverse(), [...canvases].reverse());
  expect(stack.plates[1]).toBe(firstPlate);
  expect(stack.materials[1]).toBe(firstMaterial);
  expect(stack.textures[1]).toBe(firstMask);
  expect(stack.materials[1].normalMap).toBe(firstOptics);
  expect(stack.plates.map(plate => plate.renderOrder)).toEqual([10, 11]);
  let disposed = 0;
  firstMaterial.addEventListener("dispose", () => disposed++);
  stack.reconcileLayerCanvases([ids[1]], [canvases[1]]);
  expect(disposed).toBe(1);
  expect(firstPlate.parent).toBeNull();
  stack.setCanvases([]);
});

test("disposing the stack frees its own geometry, never the anchor's shared buffers (PREV-100)", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex([0, 1, 2]);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Array(12).fill(0), 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(new Array(12).fill(0.25), 4));
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(new Float32Array(9), 3)];
  const anchor = new THREE.SkinnedMesh(geometry), root = new THREE.Group(); root.add(anchor);
  anchor.skeleton = new THREE.Skeleton([new THREE.Bone()], [new THREE.Matrix4()]);
  const stack = createMakeupStack(anchor, 4);
  // The skin under the plate is the stack's own attribute on its geometry.
  const underlay = new THREE.Float32BufferAttribute(new Float32Array(9).fill(0.4), 3);
  stack.geometry.setAttribute("xfsUnderlay", underlay);
  const seen: { index: unknown; attributes: string[]; morphs: string[] }[] = [];
  let anchorDisposed = false;
  // What the renderer's dispose frees is what the geometry holds when it fires (three's WebGLGeometries).
  stack.geometry.addEventListener("dispose", () => { seen.push({ index: stack.geometry.index, attributes: Object.keys(stack.geometry.attributes), morphs: Object.keys(stack.geometry.morphAttributes) }); });
  geometry.addEventListener("dispose", () => { anchorDisposed = true; });
  stack.dispose();
  expect(seen).toEqual([{ index: null, attributes: ["xfsUnderlay"], morphs: [] }]);
  expect(anchorDisposed).toBe(false);
  // The anchor keeps every buffer it had.
  expect(geometry.index!.count).toBe(3);
  expect(Object.keys(geometry.attributes).sort()).toEqual(["position", "skinIndex", "skinWeight"]);
  expect(geometry.morphAttributes.position).toHaveLength(1);
  expect(root.children).toEqual([anchor]);
});
