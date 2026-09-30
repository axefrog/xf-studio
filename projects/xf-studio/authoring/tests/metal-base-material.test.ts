import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { materialAdapter } from "../src/character-material-adapters";
import { createMetalBaseMaterial, metalBaseKeeps, metalBaseParameters, metalBaseSurface, patchMetalBaseShader } from "../src/metal-base-material";
import { renderTemplate } from "../src/render-templates";

describe("metal_base.remt (research/materials/shader-metal-glass.md §3.3)", () => {
  test("the template is known by its own name and by its vanilla path; every input is optional", () => {
    const byName = renderTemplate("mod\\copy\\metal.remt", "metal_base"), byPath = renderTemplate("engine\\materials\\metal_base.remt");
    expect(byName?.adapter).toBe("metal-base");
    expect(byPath).toBe(byName);
    expect(byName!.required).toEqual([]);
    expect(byName!.textures).toEqual(["BaseColor", "Metalness", "Roughness", "Normal"]);
    expect(byName!.vectors).toEqual(["BaseColorScale"]);
    expect(materialAdapter("engine\\materials\\metal_base.remt", "metal_base", "hair")?.id).toBe("metal-base");
  });

  test("parameters: the chunk's scalars, the colour scale from its vector's components, the template's defaults otherwise", () => {
    expect(metalBaseParameters({})).toEqual({ baseColorScale: [1, 1, 1], metalnessScale: 1, metalnessBias: 0, roughnessScale: 1, roughnessBias: 0,
      normalStrength: 1, layerTile: 1, masked: false, alphaThreshold: 0.38 });
    // The Gorilla Arms end decal's values (shader-metal-glass.md §5).
    const decal = metalBaseParameters({ "BaseColorScale.x": 0.448, "BaseColorScale.y": 0.448, "BaseColorScale.z": 0.448, MetalnessScale: 0.955,
      MetalnessBias: 0.425, RoughnessScale: 0.733, RoughnessBias: 0.439, LayerTile: 2 });
    expect(decal.baseColorScale).toEqual([0.448, 0.448, 0.448]);
    expect([decal.metalnessScale, decal.metalnessBias, decal.roughnessScale, decal.roughnessBias, decal.layerTile]).toEqual([0.955, 0.425, 0.733, 0.439, 2]);
  });

  test("the surface arithmetic: saturated colour × scale, red-channel metalness and roughness through scale and bias, RG normal", () => {
    const p = metalBaseParameters({ "BaseColorScale.x": 2, "BaseColorScale.y": 0.5, "BaseColorScale.z": 1, MetalnessScale: 0.955, MetalnessBias: 0.425,
      RoughnessScale: 0.733, RoughnessBias: 0.439, NormalStrength: 2 });
    // A black metalness map and a white roughness map, as the Gorilla Arms decal binds them.
    const s = metalBaseSurface({ baseColor: [0.8, 0.4, 0.2], metalness: 0, roughness: 1, normal: [0.5, 0.5] }, p);
    expect(s.colour.map(v => +v.toFixed(6))).toEqual([1, 0.2, 0.2]);
    expect(s.metalness).toBeCloseTo(0.425, 6);
    expect(s.roughness).toBeCloseTo(1, 6);
    expect(s.normal.map(v => +v.toFixed(6))).toEqual([0, 0, 1]);
    // A tilted normal: Z is reconstructed from the unscaled RG, then XY × strength and renormalised.
    const tilted = metalBaseSurface({ baseColor: [1, 1, 1], metalness: 1, roughness: 0.2, normal: [0.75, 0.5] }, p);
    const z = Math.sqrt(1 - 0.25), length = Math.hypot(1, z);
    expect(tilted.normal[0]).toBeCloseTo(1 / length, 6);
    expect(tilted.normal[2]).toBeCloseTo(z / length, 6);
    expect(tilted.metalness).toBe(1);
    expect(tilted.roughness).toBeCloseTo(0.733 * 0.2 + 0.439, 6);
  });

  test("the program reads the red channels and the RG normal at the tiled UV, and the colour scale is the material colour", () => {
    const shader = patchMetalBaseShader({ fragmentShader: THREE.ShaderLib.standard.fragmentShader });
    expect(shader.fragmentShader).toContain("texture2D( roughnessMap, xfsUv ).r * xfsMetalScales.y + xfsMetalBias.y");
    expect(shader.fragmentShader).toContain("texture2D( metalnessMap, xfsUv ).r * xfsMetalScales.x + xfsMetalBias.x");
    expect(shader.fragmentShader).toContain("vMapUv * xfsMetalScales.z");
    expect(shader.fragmentShader).not.toContain("#include <roughnessmap_fragment>");
    const texture = () => new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    const material = createMetalBaseMaterial({ baseColor: texture(), metalness: texture(), roughness: texture(), normal: texture() },
      metalBaseParameters({ "BaseColorScale.x": 0.5, "BaseColorScale.y": 0.25, "BaseColorScale.z": 1 }));
    expect(material.color.toArray()).toEqual([0.5, 0.25, 1]);
    expect(material.side).toBe(THREE.FrontSide);
    expect(material.customProgramCacheKey()).toBe("xfs-metal-base-2");
    expect(material.alphaTest).toBe(0);
  });

  test("PREV-117: an instance with enableMask alpha-tests the colour map's own alpha against AlphaThreshold; others draw opaque", () => {
    const masked = metalBaseParameters({ enableMask: 1, AlphaThreshold: 0.5 }), plain = metalBaseParameters({});
    expect([masked.masked, masked.alphaThreshold]).toEqual([true, 0.5]);
    expect(metalBaseParameters({ enableMask: 1 }).alphaThreshold).toBe(0.38);
    expect(metalBaseKeeps(0.49, masked)).toBe(false);
    expect(metalBaseKeeps(0.5, masked)).toBe(true);
    expect(metalBaseKeeps(0, plain)).toBe(true);
    const texture = () => new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    const material = createMetalBaseMaterial({ baseColor: texture(), metalness: texture(), roughness: texture(), normal: texture() }, masked);
    expect(material.alphaTest).toBe(0.5);
    expect(material.customProgramCacheKey()).toBe("xfs-metal-base-2-masked");
    // The program sets the fragment's alpha from the texture only in the alpha-tested program (Three's alphatest chunk then discards).
    const shader = patchMetalBaseShader({ fragmentShader: THREE.ShaderLib.standard.fragmentShader });
    expect(shader.fragmentShader).toContain("#ifdef USE_ALPHATEST\ndiffuseColor.a = xfsBase.a;");
    expect(shader.fragmentShader.indexOf("diffuseColor.a = xfsBase.a")).toBeLessThan(shader.fragmentShader.indexOf("#include <alphatest_fragment>"));
  });
});
