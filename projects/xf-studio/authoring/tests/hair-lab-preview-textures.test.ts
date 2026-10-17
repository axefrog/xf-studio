import { expect, test } from "bun:test";
import * as THREE from "three";
import { defaultHairAtlas, generateHairAtlas } from "../src/features/hair-lab/textures";
import { prepareHairAtlasStrips } from "../src/features/hair-lab/strand-strips";
import { attachHairAtlasFlow, createHairAtlasPreview } from "../src/hair-atlas-preview-adapter";
import type { RenderChunkMaterial } from "../src/render-detail";
type Shader = Parameters<THREE.Material["onBeforeCompile"]>[0];

const fixture = () => {
  const d = defaultHairAtlas(256); d.regions = [{ ...d.regions[0]!, count: 12, mirrored: true }];
  return prepareHairAtlasStrips(generateHairAtlas(d));
};
const chunk: RenderChunkMaterial = { chunk: 0, name: "diagnostic", template: "base/materials/hair.mt", templateName: "hair", materialPriority: null,
  scalars: { AlphaCutoff: .7, FlowStrength: .5 }, colours: {}, textures: {}, skinProfiles: {}, gradients: {},
  profiles: { HairProfile: { depotPath: "diagnostic.hp", archive: null, sha256: null, sampleCount: 4,
    id: [{ value: 0, color: [80, 60, 40] }, { value: 1, color: [180, 150, 100] }],
    rootToTip: [{ value: 0, color: [60, 40, 20] }, { value: 1, color: [160, 120, 80] }] } } };

test("preview texture port preserves manual mips, red data, gamma Flow and atlas-content UVs", () => {
  const atlas = fixture(), life = new AbortController(), preview = createHairAtlasPreview(atlas, life.signal), strip = atlas.strips[0]!;
  const read = preview.textures(strip.key), alpha = read("Strand_Alpha", "data", "repeat") as THREE.DataTexture;
  const flow = read("Flow", "colour", "repeat") as THREE.DataTexture;
  expect(read("Strand_Alpha", "data", "repeat")).toBe(alpha); expect(read("Unknown", "data", "repeat")).toBeUndefined();
  expect(alpha.format).toBe(THREE.RedFormat); expect(alpha.colorSpace).toBe(THREE.NoColorSpace);
  expect(flow.format).toBe(THREE.RGBAFormat); expect(flow.colorSpace).toBe(THREE.SRGBColorSpace);
  for (const map of [alpha, flow]) {
    expect(map.generateMipmaps).toBe(false); expect(map.flipY).toBe(false); expect(map.unpackAlignment).toBe(1);
    expect(map.wrapS).toBe(THREE.ClampToEdgeWrapping); expect(map.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(map.mipmaps.length).toBe(strip.levels.length); expect(map.mipmaps.at(-1)!.width).toBe(1);
    const uv = new THREE.Vector2(strip.atlasUV.u0, strip.atlasUV.v0); uv.applyMatrix3(map.matrix);
    expect(uv.x).toBeCloseTo(0, 10); expect(uv.y).toBeCloseTo(0, 10);
  }
  expect(alpha.image.data).toBe(strip.levels[0]!.alpha);
  expect(Array.from(flow.image.data!.slice(0, 4))).toEqual([...strip.levels[0]!.flow.slice(0, 3), 255]);
  life.abort(); expect(() => preview.textures(strip.key)("Flow", "colour", "clamp")).toThrow();
});

test("scoped shader proposal reuses the hair adapter and decoded strength arithmetic, with abort-owned resources", () => {
  const atlas = fixture(), life = new AbortController(), preview = createHairAtlasPreview(atlas, life.signal), strip = atlas.strips[0]!;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry()), material = preview.createMaterial(strip.key, chunk, mesh,
    { slot: "hair", overMakeup: false, profileEncoding: "srgb-decoded" }) as THREE.MeshPhysicalMaterial;
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader } as Shader;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  const uniforms = shader.uniforms as Record<string, { value: unknown }>;
  expect(uniforms.xfsAlphaCutoff!.value).toBe(atlas.alphaCutoff); expect(chunk.scalars.AlphaCutoff).toBe(.7);
  expect(uniforms.xfsAtlasFlowStrength!.value).toBe(.5); expect(uniforms.xfsAtlasTangentSign!.value).toBe(-1);
  expect(shader.fragmentShader).toContain("2.0 * atlasFlow.g - 2.0) + 1.0");
  expect(shader.fragmentShader).toContain("atlasT * xfsAtlasTangentSign * tbn[0] + atlasB * tbn[1]");
  expect(shader.fragmentShader).not.toContain("vec3 hairT = normalize(tbn[1]);");
  expect(shader.fragmentShader).toContain("texture2D(alphaMap, vAlphaMapUv");
  expect(material.alphaToCoverage).toBe(true); expect(material.transparent).toBe(false);
  expect(mesh.geometry.hasAttribute("xfsVertexRed")).toBe(true);
  expect(mesh.geometry.hasAttribute("tangent")).toBe(true);
  let disposed = 0; material.addEventListener("dispose", () => disposed++);
  for (const name of ["Strand_Alpha", "Strand_ID", "Strand_Gradient", "Flow"]) preview.textures(strip.key)(name, "data", "repeat")!.addEventListener("dispose", () => disposed++);
  const profile = uniforms.xfsProfile!.value as THREE.Texture; profile.addEventListener("dispose", () => disposed++);
  life.abort(); life.abort(); expect(disposed).toBe(6);
  expect(() => preview.createMaterial(strip.key, chunk, mesh, { slot: "hair", overMakeup: false, profileEncoding: "srgb-decoded" })).toThrow();
});

test("Flow proposal fails closed if the shared shader contract moves", () => {
  const m = new THREE.MeshPhysicalMaterial(); attachHairAtlasFlow(m, new THREE.Texture(), 1, false);
  expect(() => m.onBeforeCompile({ uniforms: {}, vertexShader: "", fragmentShader: "#include <common>" } as Shader, {} as THREE.WebGLRenderer)).toThrow("no longer matches");
});
