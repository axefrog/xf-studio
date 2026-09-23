import {expect,test} from "bun:test";
import * as THREE from "three";
import {installProceduralGlintStudy} from "../tools/glitter-glint-study";

test("UV-cell glint pilot chains existing shader ownership and restores it",()=>{
  const material=new THREE.MeshPhysicalMaterial({opacity:.4});
  let priorCalls=0;
  const prior:typeof material.onBeforeCompile=shader=>{priorCalls++;shader.vertexShader+="\n// existing skin hook";};
  const priorKey=()=>"existing-skin-key";
  material.onBeforeCompile=prior;material.customProgramCacheKey=priorKey;
  const study=installProceduralGlintStudy(material);
  const shader={vertexShader:THREE.ShaderLib.physical.vertexShader,
    fragmentShader:THREE.ShaderLib.physical.fragmentShader,uniforms:{}} as Parameters<typeof material.onBeforeCompile>[0];
  material.onBeforeCompile(shader,{} as THREE.WebGLRenderer);
  expect(priorCalls).toBe(1);
  expect(shader.vertexShader).toContain("// existing skin hook");
  expect(shader.fragmentShader).toContain("directionalLights[ xfsLight ].direction");
  expect(shader.fragmentShader).toContain("dFdx( uv )");
  expect(shader.fragmentShader).toContain("transpose( xfsGlintTbn )");
  expect(shader.fragmentShader).not.toContain("transpose( tbn )");
  expect(shader.fragmentShader).toContain("#include <opaque_fragment>");
  expect(material.customProgramCacheKey()).toStartWith("existing-skin-key|");
  expect(material.opacity).toBe(.4);
  study.setEnabled(true);study.setStrength(0);study.setPower(1200);
  expect(()=>study.setStrength(NaN)).toThrow();
  expect(()=>study.setPower(0)).toThrow();
  study.dispose();
  expect(material.onBeforeCompile).toBe(prior);
  expect(material.customProgramCacheKey).toBe(priorKey);
  expect(()=>study.setEnabled(true)).toThrow();
  material.dispose();
});
