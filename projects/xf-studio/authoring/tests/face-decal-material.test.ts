import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { materialAdapter, type AdapterContext, type ChunkTextures } from "../src/character-material-adapters";
import { decodeSrgbByte, nearestVertices, sampleAtVertices } from "../src/decal-underlay";
import { createFaceDecalMaterial, decalColourUnits, decalContrast, decalCoverage, decalTargets, doubleDiffuseCoverage, faceDecalParameters,
  forwardDecal, forwardSurface, gbufferColour, patchFaceDecalShader, type Rgb } from "../src/face-decal-material";
import type { RenderChunkMaterial, RenderTexture } from "../src/render-detail";
import { VANILLA_SKIN_PROFILE, skinParameters } from "../src/skin-material";

const close = (a: readonly number[], b: readonly number[], digits = 6) => a.forEach((value, k) => expect(value).toBeCloseTo(b[k]!, digits));
const srgb = (byte: number) => decodeSrgbByte(byte);

describe("parameter mapping", () => {
  test("a vanilla glossy lipstick chunk: colour decoded from sRGB bytes, the three target alphas, the normal mode", () => {
    // Lip style 08 glossy, colour red (the reference save's), with the template's defaults filled in [resource].
    const p = faceDecalParameters("mesh-decal", { DiffuseAlpha: 0.400000006, NormalAlpha: 0, NormalsBlendingMode: 1, RoughnessMetalnessAlpha: 0,
      DepthThreshold: 1, UVScaleX: 1, UVScaleY: 1, SecondaryMaskInfluence: 0 }, { DiffuseColor: [106, 40, 40, 255] });
    close(p.diffuseColor, [srgb(106), srgb(40), srgb(40)]);
    expect(p.diffuseAlpha).toBeCloseTo(0.4, 6);
    expect(p.surfaceAlpha).toBe(0);
    expect(p.normal).toEqual({ alpha: 0, useAlphaTexture: false, blendMode: 1 });
    expect(p.uvScale).toEqual([1, 1]);
  });

  test("blush above one, cyberware's normal and surface writes, and the template defaults for anything unset", () => {
    expect(faceDecalParameters("mesh-decal", { DiffuseAlpha: 2 }, {}).diffuseAlpha).toBe(2);
    const cyber = faceDecalParameters("mesh-decal", { NormalAlpha: 0.425, UseNormalAlphaTex: 1, RoughnessMetalnessAlpha: 1, RoughnessScale: 0.5,
      RoughnessBias: 0.1, MetalnessScale: 1, MetalnessBias: 0 }, {});
    expect(cyber.normal).toEqual({ alpha: 0.425, useAlphaTexture: true, blendMode: 0 });
    expect(cyber).toMatchObject({ surfaceAlpha: 1, roughness: { scale: 0.5, bias: 0.1 }, metalness: { scale: 1, bias: 0 } });
    // Nothing set: the 2.31 template's own defaults, so no coverage is invented (every target alpha is 0).
    const empty = faceDecalParameters("mesh-decal", {}, {});
    expect(empty).toMatchObject({ diffuseAlpha: 0, surfaceAlpha: 0, normal: { alpha: 0, useAlphaTexture: false, blendMode: 0 }, contrast: 0,
      secondaryMask: { uvScale: 1, influence: 0 }, uvOffset: [0, 0], uvRotation: 0 });
    close(empty.diffuseColor, [1, 1, 1]);
  });

  test("double diffuse: the secondary colour and intensity and the gradient tint; the byte encoding is one switch", () => {
    const p = faceDecalParameters("double-diffuse", { UseGradientMap: 1, GradientMapUV: 0.4, GradientMapIntensity: 0.5, SecondaryDiffuseAlphaIntensity: 0.8 },
      { SecondaryDiffuseColor: [145, 18, 18, 255] });
    expect(p.gradient).toEqual({ use: true, uv: 0.4, intensity: 0.5 });
    expect(p.secondaryIntensity).toBeCloseTo(0.8, 6);
    close(p.secondaryColor, [srgb(145), srgb(18), srgb(18)]);
    close(decalColourUnits([255, 128, 0], "byte"), [1, 128 / 255, 0]);
  });
});

describe("blend maths", () => {
  test("coverage: contrast 0 keeps the alpha, the result is squared, the secondary mask removes its share", () => {
    expect(decalContrast(0.3, 0)).toBeCloseTo(0.3, 6);
    // Positive contrast steepens around one half.
    expect(decalContrast(0.6, 0.5)).toBeGreaterThan(0.6);
    expect(decalContrast(0.4, 0.5)).toBeLessThan(0.4);
    expect(decalCoverage(0.5, 0)).toBeCloseTo(0.25, 6);
    expect(decalCoverage(1, 0, 0.5, 1)).toBeCloseTo(0.5, 6);
    // Brows and double-diffuse lips: the secondary alpha fills where the primary is uncovered, before squaring.
    expect(doubleDiffuseCoverage(0.5, 1, 0, 0.7)).toBeCloseTo((0.5 + 0.5 * 0.7) ** 2, 6);
  });

  test("target alphas: colour and surface follow the squared coverage, clamped as the 8-bit targets clamp them; normal does not", () => {
    const p = faceDecalParameters("mesh-decal", { DiffuseAlpha: 2, RoughnessMetalnessAlpha: 0.4, NormalAlpha: 0.425, NormalsBlendingMode: 1 }, {});
    const t = decalTargets(p, 0.36, 0.6, 0.9);
    expect(t.colour).toBeCloseTo(0.72, 6);
    expect(t.surface).toBeCloseTo(0.144, 6);
    // Mode 1 fades a nearly flat texel (z 0.9 → 50 − 45 → 1 still); a flat texel (z 1) writes no normal at all.
    expect(t.normal).toBeCloseTo(0.425 * 0.6, 6);
    expect(decalTargets(p, 0.36, 0.6, 1).normal).toBe(0);
    expect(decalTargets(p, 0.8, 1, 0).colour).toBe(1);
  });

  test("colour blends in square-root space, and the forward pass reproduces it exactly over the skin it knows", () => {
    // Black at half coverage over white: the G-buffer blend gives a quarter, a linear blend a half.
    close(gbufferColour([0, 0, 0], 0.5, [1, 1, 1]), [0.25, 0.25, 0.25]);
    const decal: Rgb = [srgb(106), srgb(40), srgb(40)], skin: Rgb = [0.55, 0.38, 0.3];
    for (const alpha of [0.1, 0.4, 0.8]) {
      const target = gbufferColour(decal, alpha, skin);
      const over = forwardDecal(decal, alpha, skin);
      close(over.color.map((c, k) => over.alpha * c + (1 - over.alpha) * skin[k]!), target);
      expect(over.alpha).toBeGreaterThanOrEqual(alpha);
      // A surface or normal write raises the drawn alpha; the colour result is unchanged.
      const raised = forwardDecal(decal, alpha, skin, 0.9);
      expect(raised.alpha).toBeGreaterThanOrEqual(0.9);
      close(raised.color.map((c, k) => raised.alpha * c + (1 - raised.alpha) * skin[k]!), target);
    }
    expect(forwardDecal(decal, 0, skin).alpha).toBeCloseTo(0, 9);
  });

  test("the surface: a decal that writes none keeps the skin's roughness; a full write takes the decal's", () => {
    expect(forwardSurface({ roughness: 0.62, metalness: 0 }, { roughness: 1, metalness: 0 }, 0, 0.6)).toEqual({ roughness: 0.62, metalness: 0 });
    expect(forwardSurface({ roughness: 0.62, metalness: 0 }, { roughness: 0.5, metalness: 0 }, 0.6, 0.6).roughness).toBeCloseTo(0.5, 6);
    // Matte lips: surface 0.4 of the coverage, colour 0.8 → halfway.
    expect(forwardSurface({ roughness: 0.4, metalness: 0 }, { roughness: 1, metalness: 0 }, 0.32, 0.64).roughness).toBeCloseTo(0.7, 6);
  });
});

describe("the decal family material", () => {
  const texture = () => new THREE.Texture();
  const textures = () => ({ diffuse: texture(), secondaryMask: texture(), normal: texture(), normalAlpha: texture(), roughness: texture(), metalness: texture() });
  const program = () => ({ uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: "#include <common>\n#include <begin_vertex>",
    fragmentShader: ["#include <common>", "#include <lights_physical_pars_fragment>", "#include <map_fragment>", "#include <alphamap_fragment>",
      "#include <roughnessmap_fragment>", "#include <metalnessmap_fragment>", "#include <normal_fragment_maps>", "#include <lights_fragment_maps>"].join("\n") });

  test("the program carries the engine's arithmetic: transformed UV, squared coverage, the sqrt-space solve and the skin light", () => {
    const shader = patchFaceDecalShader(program(), { underlay: true, skinLight: true });
    expect(shader.vertexShader).toContain("attribute vec3 xfsUnderlay;");
    expect(shader.vertexShader).toContain("attribute float xfsUnderRoughness;");
    expect(shader.vertexShader).toContain("attribute float xfsUnderMetalness;");
    const fragment = shader.fragmentShader;
    expect(fragment).toContain("tan( ( xfsDecalMisc.x + 1.0 ) * 0.78539816 )");
    expect(fragment).toContain("xfsCoverage = xfsAdjusted * xfsAdjusted * xfsMaskTerm;");
    expect(fragment).toContain("xfsColourA * sqrt( max( xfsColour, vec3( 0.0 ) ) ) + ( 1.0 - xfsColourA ) * sqrt( xfsUnder )");
    expect(fragment).toContain("clamp( 50.0 - 50.0 * xfsDecalN.z, 0.0, 1.0 )");
    // Roughness and metalness both move from the skin's towards the decal's by the surface share, as forwardSurface does (PREV-52).
    expect(fragment).toContain("float xfsRoughnessValue = mix( xfsUnderRough, xfsDecalRough, xfsSurfaceShare );");
    expect(fragment).toContain("float xfsMetalnessValue = mix( xfsUnderMetal, xfsDecalMetal, xfsSurfaceShare );");
    expect(fragment).toContain("xfsUnderMetal = vXfsUnderMetalness;");
    expect(fragment).toContain("RE_Direct_XfsSkin");
    expect(fragment).toContain("xfsSkinIBL");
    for (const gone of ["#include <map_fragment>", "#include <alphamap_fragment>", "#include <roughnessmap_fragment>", "#include <lights_fragment_maps>"])
      expect(fragment).not.toContain(gone);
    // Without a skin light the decal keeps Three's standard lighting.
    expect(patchFaceDecalShader(program(), { underlay: false, skinLight: false }).fragmentShader).not.toContain("RE_Direct_XfsSkin");
    expect(() => patchFaceDecalShader({ vertexShader: "", fragmentShader: "#include <common>" }, { underlay: false, skinLight: false })).toThrow("expects");
  });

  test("one material per chunk: blended, no depth writes, front faces, a program per template kind and option", () => {
    const params = faceDecalParameters("mesh-decal", { DiffuseAlpha: 1 }, {});
    const { material, handle } = createFaceDecalMaterial(textures(), params, { underlay: true, skinLight: skinParameters({ scalars: {}, colours: {}, skinProfiles: {} }) });
    expect(material).toMatchObject({ transparent: true, depthWrite: false, side: THREE.FrontSide });
    expect(material.defines).toMatchObject({ XFS_DECAL_MESH: "", XFS_GBUFFER_DECAL: "" });
    const shader = program();
    material.onBeforeCompile(shader as never, {} as never);
    expect((shader.uniforms.xfsLobes!.value as THREE.Vector3).x).toBeCloseTo(VANILLA_SKIN_PROFILE.roughness0, 5);
    expect((shader.uniforms.xfsDecalView!.value as THREE.Vector2).y).toBe(1);
    handle.setNormals(false);
    expect((shader.uniforms.xfsDecalView!.value as THREE.Vector2).y).toBe(0);
    const double = createFaceDecalMaterial({ ...textures(), secondaryDiffuse: texture(), gradient: texture() },
      faceDecalParameters("double-diffuse", {}, {}), { underlay: false, skinLight: null }).material;
    expect(double.defines).toMatchObject({ XFS_DECAL_DOUBLE: "" });
    expect(double.defines).not.toHaveProperty("XFS_GBUFFER_DECAL");
    expect(double.customProgramCacheKey()).not.toBe(material.customProgramCacheKey());
  });
});

describe("the adapters for a decal chunk", () => {
  const texture = (depotPath: string, isGamma = false): RenderTexture =>
    ({ file: `${"a".repeat(64)}.png`, sha256: "a".repeat(64), sources: [], depotPath, width: 4, height: 4, isGamma });
  const chunk = (template: string, names: string[], extra: Partial<RenderChunkMaterial> = {}): RenderChunkMaterial => ({
    chunk: 0, name: "m", template, templateName: null, materialPriority: null, scalars: { DiffuseAlpha: 0.4 }, colours: { DiffuseColor: [106, 40, 40, 255] },
    profiles: {}, skinProfiles: {}, gradients: {}, textures: Object.fromEntries(names.map(name => [name, texture(`x\\${name}.xbm`)])), ...extra });
  const context = (overrides: Partial<AdapterContext> = {}): AdapterContext => ({ slot: "face", overMakeup: false, profileEncoding: "srgb-decoded", ...overrides });
  const mesh = () => new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3)));

  test("routing: on the face every decal template goes through the one family; elsewhere brows and hair caps keep theirs", () => {
    expect(materialAdapter("base\\materials\\mesh_decal.mt", null, "face")?.id).toBe("mesh-decal");
    expect(materialAdapter("base\\materials\\mesh_decal_double_diffuse.mt", null, "face")?.id).toBe("mesh-decal");
    expect(materialAdapter("base\\materials\\mesh_decal_gradientmap_recolor.mt", null, "face")?.id).toBe("mesh-decal");
    expect(materialAdapter("base\\materials\\mesh_decal_double_diffuse.mt", null, "brows")?.id).toBe("double-diffuse-decal");
    expect(materialAdapter("base\\materials\\mesh_decal_gradientmap_recolor.mt", null, "hair")?.id).toBe("hair-cap-decal");
    // A copy at a mod's own path keeps the template's name, and with it the adapter; an unknown name draws nothing.
    expect(materialAdapter("some_pack\\materials\\mesh_decal_copy.mt", "mesh_decal", "face")?.id).toBe("mesh-decal");
    expect(materialAdapter("some_pack\\materials\\mesh_decal_copy.mt", null, "face")).toBeUndefined();
    expect(materialAdapter("base\\materials\\mesh_decal.mt", "glass", "face")).toBeUndefined();
  });

  test("the family samples every input through its resource's colour flag, falls back to the template's defaults and blends against the skin", () => {
    const requests: string[] = [];
    const all: ChunkTextures = (parameter, use, wrap) => { requests.push(`${parameter}:${use}:${wrap}`); return parameter === "DiffuseTexture" ? new THREE.Texture() : undefined; };
    const target = mesh();
    const colour = new THREE.BufferAttribute(new Float32Array(6), 3), roughness = new THREE.BufferAttribute(new Float32Array(2), 1);
    const metalness = new THREE.BufferAttribute(new Float32Array(2), 1);
    const evidence = { maxMatchedDistance: 0.0004, unmatched: 0, source: "resolved-skin", surface: "core-head", roughness: "resolved-skin" } as const;
    const skin = { base: () => null, chunks: [], parameters: skinParameters({ scalars: {}, colours: {}, skinProfiles: {} }) };
    const adapted = materialAdapter("base\\materials\\mesh_decal.mt", null, "face")!.create(chunk("base\\materials\\mesh_decal.mt", ["DiffuseTexture"]), all, target,
      context({ skin, surface: () => ({ colour, roughness, metalness, evidence }) }));
    expect(requests.every(request => request.includes(":colour:"))).toBe(true);
    expect(requests.map(r => r.split(":")[0]).sort()).toEqual(["DiffuseTexture", "MetalnessTexture", "NormalAlphaTex", "NormalTexture", "RoughnessTexture", "SecondaryMask"]);
    // Five neutral 1×1 textures stand in for the template's defaults (white mask, flat normal, white alpha, white roughness, black metal).
    expect(adapted.owned).toHaveLength(5);
    expect(target.geometry.getAttribute("xfsUnderlay")).toBe(colour);
    expect(target.geometry.getAttribute("xfsUnderRoughness")).toBe(roughness);
    expect(target.geometry.getAttribute("xfsUnderMetalness")).toBe(metalness);
    // How the skin was read stays with the adapted decal, whatever the scene does with its own state later (PREV-51).
    expect(adapted.decalSurface).toEqual(evidence);
    expect(adapted.decal).toMatchObject({ underlay: true, skinLight: true });
    expect(adapted.decal!.parameters.diffuseAlpha).toBeCloseTo(0.4, 6);
    expect(adapted.notes).toEqual([]);
  });

  test("without the skin under it the decal blends linearly and says so; a double-diffuse chunk needs its secondary alpha", () => {
    const none: ChunkTextures = parameter => parameter === "DiffuseTexture" ? new THREE.Texture() : undefined;
    const adapted = materialAdapter("base\\materials\\mesh_decal.mt", null, "face")!.create(chunk("base\\materials\\mesh_decal.mt", ["DiffuseTexture"]), none, mesh(),
      context({ surface: () => { throw Error("not over the head"); } }));
    expect(adapted.decal).toMatchObject({ underlay: false, skinLight: false });
    expect(adapted.decalSurface).toBeUndefined();
    expect(adapted.notes).toEqual(["linear decal blend (not over the head)", "lit as a standard surface (no resolved skin light)"]);
    expect(() => materialAdapter("base\\materials\\mesh_decal_double_diffuse.mt", null, "face")!.create(
      chunk("base\\materials\\mesh_decal_double_diffuse.mt", ["DiffuseTexture"]), none, mesh(), context())).toThrow("SecondaryDiffuseAlpha");
  });

  test("a decal template the preview can't draw yet is hidden and reported by code, never in words", () => {
    const adapted = materialAdapter("base\\materials\\mesh_decal_emissive.mt", null, "face")!.create(chunk("base\\materials\\mesh_decal_emissive.mt", []),
      () => undefined, mesh(), context());
    expect(adapted).toMatchObject({ hidden: true, limits: ["decal-template"] });
    expect(materialAdapter(null, "mesh_decal_parallax", "face")?.id).toBe("decal-placeholder");
  });
});

describe("the skin under a decal", () => {
  test("nearest head vertex within the limit, the same as a full search; bilinear reads at its UV", () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const source = Float32Array.from({ length: 3 * 400 }, () => random() * 0.2);
    const target = Float32Array.from({ length: 3 * 60 }, (_, i) => source[i]! + 0.0004);
    const nearest = nearestVertices(target, source);
    for (let t = 0; t < 60; t++) {
      let best = -1, bestD = Infinity;
      for (let s = 0; s < 400; s++) {
        const d = (source[s * 3]! - target[t * 3]!) ** 2 + (source[s * 3 + 1]! - target[t * 3 + 1]!) ** 2 + (source[s * 3 + 2]! - target[t * 3 + 2]!) ** 2;
        if (d < bestD) { bestD = d; best = s; }
      }
      expect(nearest.index[t]).toBe(best);
    }
    expect(nearest.unmatched).toBe(0);
    expect(nearestVertices([5, 5, 5], source).unmatched).toBe(1);
    // A 2×1 image: the vertex at u = 0.5 reads halfway between the two texels.
    const image = { width: 2, height: 1, texel: (x: number) => x === 0 ? 0 : 255 };
    const values = sampleAtVertices({ index: Int32Array.from([0, -1]), maxMatchedDistance: 0, unmatched: 1 }, [0.5, 0.5], image, 1, byte => byte / 255);
    expect(values[0]).toBeCloseTo(0.5, 6);
    expect(values[1]).toBe(0);
  });
});
