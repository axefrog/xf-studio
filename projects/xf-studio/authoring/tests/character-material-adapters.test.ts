import { expect, test } from "bun:test";
import * as THREE from "three";
import { chunkOfMesh, releaseDetailObject } from "../src/character-detail-loader";
import { materialAdapter, MATERIAL_ADAPTERS, textureColourSpace, type AdapterContext, type ChunkTextures } from "../src/character-material-adapters";
import { hairMaterialFromScalars, HAIR_TEMPLATE_DEFAULTS } from "../src/hair-colour-model";
import type { RenderChunkMaterial, RenderTexture } from "../src/render-detail";
import { RENDER_TEMPLATES } from "../src/render-templates";

const texture = (depotPath: string, isGamma = false): RenderTexture =>
  ({ file: `${"a".repeat(64)}.png`, sha256: "a".repeat(64), sources: [], depotPath, width: 4, height: 4, isGamma });
const chunk = (template: string, textures: string[], extra: Partial<RenderChunkMaterial> = {}): RenderChunkMaterial => ({
  chunk: 0, name: "m", template, templateName: null, materialPriority: null, scalars: {}, colours: {}, profiles: {}, skinProfiles: {}, gradients: {},
  textures: Object.fromEntries(textures.map(name => [name, texture(`x\\${name}.xbm`)])), ...extra });
const requests: string[] = [];
const textures: ChunkTextures = (parameter, use, wrap) => { requests.push(`${parameter}:${use}:${wrap}`); return new THREE.Texture(); };
const noTextures: ChunkTextures = () => undefined;
const context = (overrides: Partial<AdapterContext> = {}): AdapterContext => ({ slot: "hair", overMakeup: false, profileEncoding: "srgb-decoded", ...overrides });
const mesh = () => new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3)));
const compile = (material: THREE.Material) => {
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: "#include <common>\n#include <begin_vertex>",
    fragmentShader: "#include <common>\n#include <map_pars_fragment>\n#include <map_fragment>\n#include <alphamap_fragment>\n#include <lights_fragment_begin>\n#include <lights_fragment_end>" };
  material.onBeforeCompile(shader as never, {} as never);
  return shader;
};
const profile = { depotPath: "p.hp", archive: null, sha256: null, sampleCount: 8,
  id: [{ value: 0, color: [128, 128, 128] as [number, number, number] }], rootToTip: [{ value: 0, color: [40, 20, 10] as [number, number, number] }] };

test("every template the host exports for has an adapter", () => {
  for (const [name, inputs] of Object.entries(RENDER_TEMPLATES)) {
    // By the template's own name, and by the vanilla depot path when the name could not be read.
    expect(materialAdapter(null, name)?.id).toBe(inputs.adapter);
    expect(materialAdapter(inputs.path)?.id).toBe(inputs.adapter);
  }
  expect(materialAdapter("base\\materials\\glass.mt")).toBeUndefined();
  expect(materialAdapter("BASE/MATERIALS/HAIR.MT")?.id).toBe("hair-strand");
  expect(Object.keys(MATERIAL_ADAPTERS).sort()).toEqual([...new Set(Object.values(RENDER_TEMPLATES).map(t => t.adapter))].sort());
});

test("colour inputs decode sRGB only when the resource says so; data inputs never do", () => {
  expect(textureColourSpace("colour", true)).toBe(THREE.SRGBColorSpace);
  expect(textureColourSpace("colour", false)).toBe(THREE.NoColorSpace);
  expect(textureColourSpace("data", true)).toBe(THREE.NoColorSpace);
});

test("hair.mt: strand textures as data, the profile row texture, scalars from the chain and hair coverage", () => {
  requests.length = 0;
  const target = mesh();
  const adapted = materialAdapter("base\\materials\\hair.mt")!.create(chunk("base\\materials\\hair.mt", ["Strand_Alpha", "Strand_ID", "Strand_Gradient"],
    { scalars: { AlphaCutoff: 0, ShadowStrength: 0.9, ShadowMin: -0.4, RoughnessScale: 0.15, Animation_PeriodScale: 3, RoughnessBias: 7 },
      profiles: { HairProfile: profile } }), textures, target, context());
  const material = adapted.material as THREE.MeshPhysicalMaterial;
  expect(requests).toEqual(["Strand_Alpha:data:repeat", "Strand_ID:data:repeat", "Strand_Gradient:data:repeat"]);
  expect(material.alphaToCoverage).toBe(true);
  expect(material.transparent).toBe(false);
  expect(adapted.owned.length).toBe(1);
  expect((adapted.owned[0] as THREE.DataTexture).image.width).toBe(8);
  expect(target.geometry.getAttribute("xfsVertexRed")).toBeDefined();
  const shader = compile(material);
  expect(shader.fragmentShader).toContain("xfsProfileIndex(strandId)");
  expect((shader.uniforms.xfsShadow!.value as THREE.Vector3).toArray()).toEqual([-0.4, HAIR_TEMPLATE_DEFAULTS.shadowMax, 0.9]);
  // Out-of-range values clamp to the model's ranges; unknown parameters are ignored.
  expect(hairMaterialFromScalars({ RoughnessBias: 7, AlphaCutoff: 0 })).toMatchObject({ roughnessBias: 1, alphaCutoff: 0 });
  // Lashes draw after the makeup plates: transparent queue, but unblended.
  const lash = materialAdapter("base\\materials\\hair.mt")!.create(chunk("base\\materials\\hair.mt", ["Strand_Alpha", "Strand_ID", "Strand_Gradient"],
    { profiles: { HairProfile: profile } }), textures, mesh(), context({ slot: "lashes", overMakeup: true }));
  expect(lash.material.transparent).toBe(true);
  expect(lash.material.blending).toBe(THREE.NoBlending);
  expect(() => materialAdapter("base\\materials\\hair.mt")!.create(chunk("base\\materials\\hair.mt", ["Strand_Alpha", "Strand_ID", "Strand_Gradient"]),
    textures, mesh(), context())).toThrow("HairProfile");
});

test("hair cap decal: mask as data, gradient as colour clamped, blended without depth writes", () => {
  requests.length = 0;
  const adapted = materialAdapter("base\\materials\\mesh_decal_gradientmap_recolor.mt")!.create(
    chunk("base\\materials\\mesh_decal_gradientmap_recolor.mt", ["MaskTexture", "GradientMap"]), textures, mesh(), context());
  expect(requests).toEqual(["MaskTexture:data:repeat", "GradientMap:colour:clamp"]);
  expect(adapted.material.transparent).toBe(true);
  expect(adapted.material.depthWrite).toBe(false);
  expect(compile(adapted.material).fragmentShader).toContain("xfsCapGradient");
  expect(() => materialAdapter("base\\materials\\mesh_decal_gradientmap_recolor.mt")!.create(
    chunk("base\\materials\\mesh_decal_gradientmap_recolor.mt", []), noTextures, mesh(), context())).toThrow("MaskTexture");
});

test("double-diffuse decal: the chunk's own parameters, sqrt-space blend when the skin underneath is known", () => {
  requests.length = 0;
  const brow = chunk("base\\materials\\mesh_decal_double_diffuse.mt", ["DiffuseTexture", "SecondaryDiffuseAlpha", "GradientMap"],
    { scalars: { UseGradientMap: 1, GradientMapIntensity: 0.5, GradientMapUV: 1, SecondaryDiffuseAlphaIntensity: 0.7 },
      colours: { SecondaryDiffuseColor: [62, 49, 42, 255], DiffuseColor: [103, 81, 71, 255] } });
  const target = mesh();
  const adapted = materialAdapter(brow.template)!.create(brow, textures, target,
    context({ slot: "brows", underlay: m => new THREE.BufferAttribute(new Float32Array(m.geometry.getAttribute("position").count * 3), 3) }));
  expect(requests).toEqual(["DiffuseTexture:colour:repeat", "SecondaryDiffuseAlpha:data:repeat", "GradientMap:colour:clamp"]);
  expect((adapted.material as THREE.MeshStandardMaterial).defines).toHaveProperty("XFS_GBUFFER_DECAL");
  expect(target.geometry.getAttribute("xfsUnderlay")).toBeDefined();
  const shader = compile(adapted.material);
  expect((shader.uniforms.browGradientParams!.value as THREE.Vector4).toArray().map(v => Math.round(v * 100) / 100)).toEqual([1, 1, 0.5, 0.7]);
  // Without a usable underlay the decal falls back to the linear blend and says so.
  const linear = materialAdapter(brow.template)!.create(brow, textures, mesh(), context({ slot: "brows", underlay: () => { throw Error("not over the head"); } }));
  expect((linear.material as THREE.MeshStandardMaterial).defines ?? {}).not.toHaveProperty("XFS_GBUFFER_DECAL");
  expect(linear.notes[0]).toContain("linear decal blend");
});

test("exported chunk meshes map back to their render chunk", () => {
  expect(chunkOfMesh("submesh_00_LOD_1")).toBe(0);
  expect(chunkOfMesh("submesh_07_LOD_1")).toBe(7);
  expect(chunkOfMesh("submesh_00_LOD_1_doubled")).toBe(0);
  expect(chunkOfMesh("Armature")).toBeNull();
});

// PREV-28: releasing loaded details frees each skinned mesh's bone texture along with its geometry.
test("releasing a detail object disposes geometry and every skeleton's bone texture", () => {
  const root = new THREE.Group(), parent = new THREE.Scene();
  parent.add(root);
  const bones = [new THREE.Bone(), new THREE.Bone()];
  bones[0]!.add(bones[1]!);
  const skeleton = new THREE.Skeleton(bones);
  skeleton.computeBoneTexture();
  const geometry = new THREE.BufferGeometry(), mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  mesh.add(bones[0]!);
  mesh.bind(skeleton);
  root.add(mesh);
  let geometryDisposed = false, boneTextureDisposed = false;
  geometry.addEventListener("dispose", () => { geometryDisposed = true; });
  skeleton.boneTexture!.addEventListener("dispose", () => { boneTextureDisposed = true; });
  releaseDetailObject(root);
  expect(root.parent).toBeNull();
  expect(geometryDisposed).toBe(true);
  expect(boneTextureDisposed).toBe(true);
  expect(skeleton.boneTexture).toBeNull();
});
