import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { HAIR_LIGHTING_VANILLA, resolveHairMaterial, sampleStopsEncoded } from "../src/hair-colour-model";
import { attachHairColor, attachHairLighting, HAIR_LOCAL_LIGHT, sampleHairGradient } from "../src/hair-shading";

/** Run a material's shader patch over Three's physical shaders, as the renderer would before compiling. */
function patched(material: THREE.MeshPhysicalMaterial) {
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

describe("the hair light in the strand and lash shaders", () => {
  test("every path is patched in: sun and local lights with their own intensities, and the environment path along L_e", () => {
    const lash = new THREE.MeshPhysicalMaterial({ specularIntensity: 0, anisotropy: 1e-4 });
    attachHairLighting(lash, 1, 107 / 255);
    const strand = new THREE.MeshPhysicalMaterial({ specularIntensity: 0, anisotropy: 1e-4 });
    const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    attachHairColor(strand, { kind: "strand", id: texture, gradient: texture, profile: texture, sampleCount: 127, material: resolveHairMaterial() });
    for (const material of [lash, strand]) {
      const shader = patched(material);
      const fragment = shader.fragmentShader;
      expect(fragment).toContain("xfsHairDirect(hairLight.direction");
      expect(fragment).toContain("xfsHairLocal, 0.0, specular, diffuse");
      // The environment path: a virtual light along the view less its along-strand part, lit by the irradiance there.
      expect(fragment).toContain("vec3 hairLe = hairVp * inversesqrt");
      expect(fragment).toContain("getLightProbeIrradiance(lightProbe, hairLe)");
      expect(fragment).toContain("reflectedLight.indirectDiffuse = 2.0 * hairE * envDiffuse * material.diffuseColor;");
      expect(fragment).toContain("reflectedLight.indirectSpecular = 2.0 * hairE * envSpecular;");
      // The old stand-in (ambient × EnvProbe/MultiScatter) survives only where there is no tangent frame.
      expect(fragment.match(/reflectedLight\.indirectDiffuse \*= xfsHairEnv\.z;/g)?.length).toBe(1);
      // Every uniform the GLSL declares is supplied, with the executable's defaults.
      for (const name of ["xfsHairLobes", "xfsHairScatter", "xfsHairGates", "xfsHairEnv", "xfsHairLocal", "xfsHairTrt", "xfsHairRandom"])
        expect(shader.uniforms[name]).toBeDefined();
      const env = shader.uniforms.xfsHairEnv!.value as THREE.Vector4;
      expect(env.toArray()).toEqual([0.3, 0.8, 0.47, 0.1]);
      expect((shader.uniforms.xfsHairLocal!.value as THREE.Vector3).toArray()).toEqual([0.35, 0.8, 0.47]);
      expect((shader.uniforms.xfsHairRandom!.value as THREE.Vector2).toArray()).toEqual([-0.2, 0.2]);
    }
    expect(HAIR_LOCAL_LIGHT).toEqual({ intensityR: HAIR_LIGHTING_VANILLA.localR, intensityTRT: HAIR_LIGHTING_VANILLA.localTRT, scatter: HAIR_LIGHTING_VANILLA.localScatter });
  });

  test("a displayed profile colour uses the positions the bake rescales the stops to", () => {
    const stops = [{ value: 0.2, color: [0, 0, 0] as const }, { value: 0.6, color: [200, 100, 50] as const }];
    // 0.4 of the way along the stored range is the middle of the rescaled one.
    expect(sampleHairGradient(stops, 0.5)).toEqual([100, 50, 25]);
    expect(sampleHairGradient(stops, 0)).toEqual([0, 0, 0]);
    expect(sampleHairGradient(stops, 0.5)).toEqual(sampleStopsEncoded(stops, 0.5).map(Math.round) as [number, number, number]);
  });
});
