import {expect,test} from "bun:test";
import * as THREE from "three";
import {installGlitterMixtureStudy} from "../tools/glitter-study-material";

test("isolated glitter adapter chains shader ownership and restores the prior owner",()=>{
  const material=new THREE.MeshPhysicalMaterial({opacity:.37});
  let calls=0;
  const hook:typeof material.onBeforeCompile=shader=>{calls++;shader.vertexShader+="\n// prior deformation hook";};
  const cache=()=>"prior-skin-program";
  material.onBeforeCompile=hook;material.customProgramCacheKey=cache;
  const adapter=installGlitterMixtureStudy(material,{baseColor:"#592640",flakeColor:"#f5df9f"});
  // Only these compile fields are read by the study hook; the renderer supplies
  // the remaining WebGL program parameters in the actual browser check.
  const shader={vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader,uniforms:{}} as Parameters<typeof material.onBeforeCompile>[0];
  material.onBeforeCompile(shader,{} as THREE.WebGLRenderer);
  expect(calls).toBe(1);expect(shader.vertexShader).toContain("// prior deformation hook");
  expect(material.customProgramCacheKey()).toStartWith("prior-skin-program|");
  expect(shader.fragmentShader).toContain("#include <alphatest_fragment>");
  expect(shader.fragmentShader).toContain("#include <opaque_fragment>");
  expect(material.opacity).toBe(.37);
  expect(()=>installGlitterMixtureStudy(material,{baseColor:"#000000",flakeColor:"#ffffff"})).toThrow();
  adapter.dispose();expect(material.onBeforeCompile).toBe(hook);expect(material.customProgramCacheKey).toBe(cache);
  expect(()=>adapter.setEnabled(true)).toThrow();material.dispose();
});

test("study requires valid coverage before activation and leaves a later shader owner intact",()=>{
  const material=new THREE.MeshPhysicalMaterial(),surface=new THREE.DataTexture(new Uint8Array(4),1,1);
  const adapter=installGlitterMixtureStudy(material,{baseColor:"#592640",flakeColor:"#f5df9f"});
  expect(()=>adapter.setEnabled(true)).toThrow();
  surface.colorSpace=THREE.SRGBColorSpace;expect(()=>adapter.setSurface(surface)).toThrow();
  surface.colorSpace=THREE.NoColorSpace;surface.channel=1;expect(()=>adapter.setSurface(surface)).toThrow();
  surface.channel=0;adapter.setSurface(surface);adapter.setEnabled(true);
  expect(()=>adapter.setFlakeRoughness(NaN)).toThrow();expect(()=>adapter.setFlakeMetalness(2)).toThrow();
  const later=()=>{};material.onBeforeCompile=later;adapter.dispose();expect(material.onBeforeCompile).toBe(later);
  surface.dispose();material.dispose();
});
