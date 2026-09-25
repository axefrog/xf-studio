import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { materialAdapter, type AdapterContext, type ChunkTextures } from "../src/character-material-adapters";
import { compareHeadSurfaces, type HeadSurface } from "../src/head-surface";
import type { RenderChunkMaterial, RenderSkinProfile, RenderTexture } from "../src/render-detail";
import { createSkinMaterial, imageTexels, patchSkinShader, SKIN_TEMPLATE_DEFAULTS, skinBaseColour, skinBaseImage, skinBaseTexels, skinLobes, skinParameters,
  skinRoughness, tintChannel, tintUnits, VANILLA_SKIN_PROFILE } from "../src/skin-material";
import { sampleUnderlayAlbedo } from "../src/brow-material";

const close = (a: readonly number[], b: readonly number[], digits = 6) => a.forEach((value, k) => expect(value).toBeCloseTo(b[k]!, digits));
const profile = (values: Partial<RenderSkinProfile> = {}): RenderSkinProfile => ({ depotPath: "engine\\materials\\defaults\\default.sp", archive: "x.archive",
  sha256: null, roughness0: 1, roughness1: 1.6, lobeMix: 0.6, blurSize: 2.5, diffuse: [255, 255, 255], falloff: [255, 155, 119], ...values });
const texture = (depotPath: string, isGamma = false): RenderTexture =>
  ({ file: `${"a".repeat(64)}.png`, sha256: "a".repeat(64), sources: [], depotPath, width: 4, height: 4, isGamma });

describe("tone tint maths (decompiled skin G-buffer program)", () => {
  test("a positive TintScale multiplies, weighted by abs(scale) · mask.R", () => {
    // senna: TintColor (202, 177, 153) at 0.70; albedo 0.5, full mask.
    const c = 202 / 255;
    expect(tintChannel(0.5, c, 0.7, 1)).toBeCloseTo(0.5 + 0.7 * (c * 0.5 - 0.5), 12);
    // Outside the mask the albedo is untouched; a zero scale (pale) changes nothing.
    expect(tintChannel(0.5, c, 0.7, 0)).toBe(0.5);
    expect(tintChannel(0.37, 171 / 255, 0, 1)).toBe(0.37);
  });

  test("a negative TintScale overlays, so warm ivory brightens instead of darkening", () => {
    const [r, g, b] = tintUnits([255, 245, 181]);
    // Below 0.5: 2·a·c; above: 1 − 2(1 − a)(1 − c).
    expect(tintChannel(0.3, b, -0.15, 1)).toBeCloseTo(0.3 + 0.15 * (2 * 0.3 * b - 0.3), 12);
    expect(tintChannel(0.8, g, -0.15, 1)).toBeCloseTo(0.8 + 0.15 * ((1 - 2 * 0.2 * (1 - g)) - 0.8), 12);
    expect(tintChannel(0.3, r, -0.15, 1)).toBeGreaterThan(0.3);
    // The same colour as a multiply would darken.
    expect(tintChannel(0.3, b, 0.15, 1)).toBeLessThan(0.3);
  });

  test("the tinted value saturates before it is blended in", () => {
    expect(tintChannel(0.9, 1, -1, 1)).toBeCloseTo(1, 12);
    expect(tintChannel(0.2, 0, 1, 1)).toBe(0);
  });

  test("TintColor bytes reach the program as byte/255 unless the encoding is switched", () => {
    close(tintUnits([255, 0, 128]), [1, 0, 128 / 255]);
    expect(tintUnits([128, 128, 128], "srgb-decoded")[0]).toBeCloseTo(0.2158605, 6);
  });

  test("the secondary albedo composites by influence · A, tinted toward the toned base", () => {
    const params = { tintColor: [0.8, 0.7, 0.6] as [number, number, number], tintScale: 0.5, secondaryInfluence: 1, secondaryTintInfluence: 1 };
    const base = [0, 1, 2].map(k => tintChannel(0.4, params.tintColor[k]!, 0.5, 1));
    // Fully opaque overlay: the result is the overlay, pulled toward overlay · base by abs(scale) · mask.R.
    const out = skinBaseColour([0.4, 0.4, 0.4], 1, [0.9, 0.5, 0.1, 1], params);
    close(out, [0.9, 0.5, 0.1].map((s, k) => s + 0.5 * (s * base[k]! - s)));
    // A transparent overlay or zero influence leaves the toned base.
    close(skinBaseColour([0.4, 0.4, 0.4], 1, [0.9, 0.5, 0.1, 0], params), base);
    close(skinBaseColour([0.4, 0.4, 0.4], 1, [0.9, 0.5, 0.1, 1], { ...params, secondaryInfluence: 0 }), base);
  });

  test("roughness after the detail bias", () => {
    // B = 0: the base roughness; B = 1: R · bias, bias between min and max by the microdetail term.
    expect(skinRoughness(0.6, 0, [1, 0.68], 0.5)).toBeCloseTo(0.6, 12);
    expect(skinRoughness(0.6, 1, [1, 0.68], 0)).toBeCloseTo(0.6 * 0.68, 12);
    expect(skinRoughness(0.6, 1, [1, 0.68], 1)).toBeCloseTo(0.6, 12);
    expect(skinRoughness(0.9, 1, [0.93, 1], 2)).toBeCloseTo(0.9 * 1.07, 12);
    expect(skinRoughness(0.9, 1, [0.93, 1], 10)).toBe(1);
  });

  test("the toned base image for decals: sRGB in, sRGB out, tone applied inside the mask only", () => {
    const albedo = { width: 2, height: 1, data: [188, 188, 188, 255, 188, 188, 188, 255] };
    const mask = { width: 2, height: 1, data: [255, 0, 0, 255, 0, 0, 0, 255] };
    const params = { tintColor: tintUnits([202, 177, 153]), tintScale: 0.7, secondaryInfluence: 0, secondaryTintInfluence: 0 };
    const image = skinBaseImage(albedo, mask, null, params);
    expect(Array.from(image.data.slice(4, 8))).toEqual([188, 188, 188, 255]);
    expect(image.data[0]).toBeLessThan(188);
    expect(image.data[2]!).toBeLessThan(image.data[0]!);
  });
});

describe("toned skin under decals, read only where sampled (PREV-43)", () => {
  // A deterministic 32×32 skin with a tint mask and a secondary albedo.
  const size = 32, pixels = (seed: number) => ({ width: size, height: size,
    data: Uint8ClampedArray.from({ length: size * size * 4 }, (_, i) => (i * seed + (i >> 5) * 7) % 256) });
  const albedo = pixels(13), mask = pixels(29), secondary = pixels(71);
  const params = { tintColor: tintUnits([202, 177, 153]), tintScale: -0.4, secondaryInfluence: 0.6, secondaryTintInfluence: 0.5 };
  const gamma = { albedo: true, secondary: true, mask: false };

  test("the lazy texels equal the full toned image everywhere", () => {
    const image = skinBaseImage(albedo, mask, secondary, params, gamma), texels = skinBaseTexels(albedo, mask, secondary, params, gamma);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let c = 0; c < 3; c++)
      expect(texels.texel(x, y, c)).toBe(image.data[(y * size + x) * 4 + c]!);
  });

  test("a decal's underlay reads only the texels under its vertices, with the same result as the full image", () => {
    let reads = 0;
    const counted = { ...albedo, data: new Proxy(albedo.data, { get: (target, key) => { if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key); } }) as unknown as Uint8ClampedArray };
    const texels = skinBaseTexels(counted, mask, secondary, params, gamma);
    expect(reads).toBe(0);
    const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), uvs = new Float32Array([0.1, 0.1, 0.5, 0.5, 0.9, 0.2]);
    const target = new Float32Array([0.001, 0, 0, 1, 0.001, 0]);
    const lazy = sampleUnderlayAlbedo(target, source, uvs, texels, 0.01);
    const full = sampleUnderlayAlbedo(target, source, uvs, skinBaseImage(albedo, mask, secondary, params, gamma), 0.01);
    expect(Array.from(lazy.underlay)).toEqual(Array.from(full.underlay));
    // Two vertices, four bilinear texels each, three albedo channels per toned texel: nowhere near the 1,024 texels of the image.
    expect(reads).toBeLessThanOrEqual(2 * 4 * 3);
    expect(Array.from(sampleUnderlayAlbedo(target, source, uvs, imageTexels(albedo), 0.01).underlay))
      .toEqual(Array.from(sampleUnderlayAlbedo(target, source, uvs, albedo, 0.01).underlay));
  });
});

describe("skin parameters from a resolved chunk", () => {
  const chunk = (extra: Partial<RenderChunkMaterial> = {}): Pick<RenderChunkMaterial, "scalars" | "colours" | "skinProfiles"> =>
    ({ scalars: { TintScale: -0.15, DetailNormalInfluence: 0.8, MicroDetailInfluence: 0.8, MicroDetailUVScale01: 20, MicroDetailUVScale02: 15,
      DetailRoughnessBiasMin: 1, DetailRoughnessBiasMax: 0.93, SecondaryAlbedoInfluence: 1, SecondaryAlbedoTintColorInfluence: 1, EmissiveEV: 2 },
      colours: { TintColor: [255, 245, 181, 255] }, skinProfiles: { SkinProfile: profile() }, ...extra });

  test("every parameter maps from the chain; the profile gives the two lobes and the subsurface stand-in", () => {
    const p = skinParameters(chunk());
    close(p.tintColor, [1, 245 / 255, 181 / 255]);
    expect(p).toMatchObject({ tintScale: -0.15, detailNormalInfluence: 0.8, microDetailInfluence: 0.8, microDetailUVScale: [20, 15],
      detailRoughnessBias: [1, 0.93], cavityIntensity: SKIN_TEMPLATE_DEFAULTS.CavityIntensity, secondaryInfluence: 1, secondaryTintInfluence: 1,
      emissiveEV: 2, profile: "engine\\materials\\defaults\\default.sp" });
    expect(p.lobes).toEqual({ roughness0: 1, roughness1: 1.6, weight: 0.8 });
    // Wrap follows the falloff colour, red widest, at full strength for this blur size.
    close(p.wrap, [0.5, 0.5 * 155 / 255, 0.5 * 119 / 255]);
  });

  test("template defaults fill what the chain leaves unset; a missing profile falls back to the base game's values", () => {
    const p = skinParameters({ scalars: {}, colours: {}, skinProfiles: {} });
    expect(p).toMatchObject({ tintScale: 0, detailNormalInfluence: 0, microDetailInfluence: 1, microDetailUVScale: [10, 10],
      detailRoughnessBias: [1, 0.68], secondaryInfluence: 0, profile: null });
    expect(p.tintColor).toEqual([0, 0, 0]);
    expect(p.lobes).toEqual(skinLobes(VANILLA_SKIN_PROFILE));
    // The base game's profile: lobe weight (1 + 1) / 2 = 1, a narrower wrap (blur 1.4 of 2.5).
    expect(p.lobes.weight).toBe(1);
    expect(p.wrap[0]).toBeCloseTo(0.5 * 1.4 / 2.5, 6);
    // Out-of-range scales clamp to the template's range.
    expect(skinParameters({ scalars: { TintScale: -4 }, colours: {}, skinProfiles: {} }).tintScale).toBe(-1);
  });
});

describe("skin shader", () => {
  const program = () => ({ vertexShader: "#include <common>", fragmentShader: ["#include <common>", "#include <lights_physical_pars_fragment>",
    "void main() {", "#include <map_fragment>", "#include <roughnessmap_fragment>", "#include <metalnessmap_fragment>",
    "#include <normal_fragment_begin>", "#include <normal_fragment_maps>", "#include <lights_physical_fragment>", "#include <lights_fragment_begin>",
    "#include <lights_fragment_maps>", "#include <lights_fragment_end>", "}"].join("\n") });

  test("the patch finds every chunk it needs in this Three.js build and replaces the lighting with the skin's", () => {
    const shader = patchSkinShader(program());
    const f = shader.fragmentShader;
    for (const gone of ["#include <map_fragment>", "#include <roughnessmap_fragment>", "#include <metalnessmap_fragment>", "#include <normal_fragment_maps>",
      "#include <lights_fragment_maps>"]) expect(f).not.toContain(gone);
    expect(f).toContain("#define RE_Direct RE_Direct_XfsSkin");
    expect(f).toContain("xfsSkinIBL( geometryViewDir, geometryNormal, material.roughness )");
    expect(f).toContain("textureGrad( xfsMicroDetail");
    // Two GGX lobes at scaled roughness, weighted by the profile.
    expect(f.match(/BRDF_GGX\( directLight\.direction, geometryViewDir, geometryNormal, lobe[01] \)/g)?.length).toBe(2);
    // The exact tint arithmetic: weight abs(scale) · mask.R, multiply or overlay, saturate, blend.
    expect(f).toContain("float xfsTintWeight = abs( xfsTint.w ) * xfsM.x;");
    expect(f).toContain("xfsTint.w >= 0.0 ? xfsTint.rgb * xfsA : xfsOverlay( xfsA, xfsTint.rgb )");
    expect(f).toContain("xfsA + xfsTintWeight * ( clamp( xfsTinted, 0.0, 1.0 ) - xfsA )");
  });

  test("a Three.js build without an expected chunk fails loudly instead of drawing a wrong skin", () => {
    expect(() => patchSkinShader(program(), { lights_fragment_maps: "no radiance call" })).toThrow("image-based radiance");
    expect(() => patchSkinShader({ vertexShader: "", fragmentShader: "#include <common>" })).toThrow("expects");
  });

  test("the material carries the mapped uniforms and flattens its normals on request", () => {
    const t = () => new THREE.Texture();
    const params = skinParameters({ scalars: { TintScale: 0.7, DetailNormalInfluence: 0.8 }, colours: { TintColor: [202, 177, 153, 255] },
      skinProfiles: { SkinProfile: profile() } });
    const { material, handle } = createSkinMaterial({ albedo: t(), normal: t(), roughness: t(), detailNormal: t(), microDetail: t(), tintMask: t(),
      secondary: t() }, params);
    const shader = { uniforms: {} as Record<string, { value: unknown }>, ...program() };
    material.onBeforeCompile(shader as never, {} as never);
    close((shader.uniforms.xfsTint!.value as THREE.Vector4).toArray(), [202 / 255, 177 / 255, 153 / 255, 0.7]);
    close((shader.uniforms.xfsLobes!.value as THREE.Vector3).toArray(), [1, 1.6, 0.8]);
    expect((shader.uniforms.xfsSkinScalars!.value as THREE.Vector4).w).toBe(1);
    handle.setNormals(false);
    expect((shader.uniforms.xfsSkinScalars!.value as THREE.Vector4).w).toBe(0);
    expect(material.customProgramCacheKey()).toBe("xfs-skin-1");
  });
});

describe("skin adapter", () => {
  const requests: string[] = [];
  const all: ChunkTextures = (parameter, use, wrap) => { requests.push(`${parameter}:${use}:${wrap}`); return new THREE.Texture(); };
  const context: AdapterContext = { slot: "skin", overMakeup: false, profileEncoding: "srgb-decoded" };
  const skinChunk = (textures: string[]): RenderChunkMaterial => ({ chunk: 0, name: "skin", template: "base\\materials\\skin.mt", templateName: "skin", materialPriority: null,
    scalars: { TintScale: 0.7, EmissiveEV: 0 }, colours: { TintColor: [202, 177, 153, 255] }, profiles: {}, skinProfiles: { SkinProfile: profile() }, gradients: {},
    textures: Object.fromEntries(textures.map(name => [name, texture(`x\\${name}.xbm`, name === "Albedo")])) });
  const mesh = () => new THREE.Mesh(new THREE.BufferGeometry());

  test("inputs follow their resources' colour flags; the adapter hands out its skin handle", () => {
    requests.length = 0;
    const adapted = materialAdapter("base\\materials\\skin.mt")!.create(skinChunk(["Albedo", "Normal", "Roughness", "DetailNormal", "MicroDetail",
      "TintColorMask", "SecondaryAlbedo"]), all, mesh(), context);
    // Every input is sampled through its resource's own format (isGamma honoured), as the engine's sampler does.
    expect(requests).toEqual(["Albedo:colour:repeat", "Normal:colour:repeat", "Roughness:colour:repeat", "TintColorMask:colour:repeat",
      "SecondaryAlbedo:colour:repeat", "DetailNormal:colour:repeat", "MicroDetail:colour:repeat"]);
    expect(adapted.material.name).toBe("xfs_skin");
    expect(adapted.skin?.handle.parameters.tintScale).toBeCloseTo(0.7, 6);
    expect(adapted.owned).toEqual([]);
    // Without a browser canvas the toned base image is unavailable rather than wrong.
    expect(adapted.skin!.base()).toBeNull();
    // The emissive mask is read only when EmissiveEV would light it.
    expect(requests).not.toContain("EmissiveMask:colour:repeat");
  });

  test("optional inputs fall back to neutral values the adapter owns; the three base maps are required", () => {
    const only: ChunkTextures = parameter => typeof parameter === "string" && ["Albedo", "Normal", "Roughness"].includes(parameter) ? new THREE.Texture() : undefined;
    const adapted = materialAdapter("base\\materials\\skin.mt")!.create(skinChunk(["Albedo", "Normal", "Roughness"]), only, mesh(), context);
    expect(adapted.owned.length).toBe(4);
    const none: ChunkTextures = parameter => parameter === "Albedo" ? new THREE.Texture() : undefined;
    expect(() => materialAdapter("base\\materials\\skin.mt")!.create(skinChunk(["Albedo"]), none, mesh(), context)).toThrow("Normal");
    const noProfile = { ...skinChunk(["Albedo", "Normal", "Roughness"]), skinProfiles: {} };
    expect(materialAdapter("base\\materials\\skin.mt")!.create(noProfile, only, mesh(), context).notes[0]).toContain("no readable skin profile");
  });
});

describe("resolved head versus the core head", () => {
  const surface = (overrides: Partial<HeadSurface> = {}): HeadSurface => ({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], uvs: [0, 0, 1, 0, 0, 1], index: [0, 1, 2],
    morphNames: ["h011_eyes", "h012_nose"], morphPositions: [[0, 0, 0.001, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0.002, 0, 0, 0]], ...overrides });

  test("the same surface (a texture-only complexion mod, a geometry-neutral morph file) keeps the core head", () => {
    expect(compareHeadSurfaces(surface(), surface())).toEqual({ same: true, reason: "same surface" });
    // Target order may differ between exports; names pair them.
    expect(compareHeadSurfaces(surface(), surface({ morphNames: ["h012_nose", "h011_eyes"],
      morphPositions: [[0, 0, 0, 0, 0, 0.002, 0, 0, 0], [0, 0, 0.001, 0, 0, 0, 0, 0, 0]] })).same).toBe(true);
  });

  test("a changed shape, UV layout, triangle list or facial morph is a different surface", () => {
    expect(compareHeadSurfaces(surface(), surface({ positions: [0, 0, 0, 1, 0, 0, 0, 1.01, 0] })).reason).toBe("vertex positions differ");
    expect(compareHeadSurfaces(surface(), surface({ uvs: [0, 0, 1, 0, 0, 0.5] })).reason).toBe("UVs differ");
    expect(compareHeadSurfaces(surface(), surface({ index: [0, 2, 1] })).reason).toBe("triangles differ");
    expect(compareHeadSurfaces(surface(), surface({ morphPositions: [[0, 0, 0.005, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0.002, 0, 0, 0]] })).reason)
      .toBe("facial morph h011_eyes differs");
    expect(compareHeadSurfaces(surface(), surface({ morphNames: ["h011_eyes"], morphPositions: [[0, 0, 0.001, 0, 0, 0, 0, 0, 0]] })).same).toBe(false);
    expect(compareHeadSurfaces(surface(), surface({ positions: [0, 0, 0] })).reason).toBe("vertex count differs");
  });
});
