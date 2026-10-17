import { expect, test } from "bun:test";
import * as THREE from "three";
import { copyMaterialShading, extendSkin } from "../src/skin";

test("generated geometry inherits template uniforms without the source mesh's additional skin attributes", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
  for (const name of ["skinIndex", "skinWeight", "joints_1", "weights_1"]) geometry.setAttribute(name, new THREE.Float32BufferAttribute([0, 0, 0, 0], 4));
  const material = new THREE.MeshStandardMaterial();
  material.onBeforeCompile = shader => { shader.uniforms.testGradient = { value: "template gradient" }; };
  extendSkin(new THREE.SkinnedMesh(geometry, material), material);
  const shader = () => ({ uniforms: {}, vertexShader: "#include <common>\n#include <skinbase_vertex>\n#include <skinning_vertex>", fragmentShader: "" }) as any;
  const original = shader(); material.onBeforeCompile(original, {} as THREE.WebGLRenderer);
  expect(original.vertexShader).toContain("joints_1");
  const copy = copyMaterialShading(material), independent = shader(); copy.onBeforeCompile(independent, {} as THREE.WebGLRenderer);
  expect(independent.vertexShader).not.toContain("joints_1");
  expect(independent.uniforms.testGradient.value).toBe("template gradient");
  expect(copy.customProgramCacheKey()).not.toBe(material.customProgramCacheKey());
  copy.dispose(); material.dispose(); geometry.dispose();
});
