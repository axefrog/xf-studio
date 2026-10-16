/** Opt-in Hair Lab renderer adapter. No shared material changes or live feature registration. */
import * as THREE from "three";
import { MATERIAL_ADAPTERS, type AdapterContext, type ChunkTextures } from "./character-material-adapters";
import type { RenderChunkMaterial } from "./render-detail";
/** Structural renderer input: feature outputs conform without the scene adapter importing a feature. */
export type HairAtlasPreviewInput = { alphaCutoff: number; strips: readonly {
  key: string; mirrored: boolean; atlasUV: { u0: number; u1: number; v0: number; v1: number };
  levels: readonly { width: number; height: number; alpha: Uint8Array; id: Uint8Array; gradient: Uint8Array; flow: Uint8Array }[];
}[] };
type HairAtlasStrip = HairAtlasPreviewInput["strips"][number];

type Maps = Record<"Strand_Alpha" | "Strand_ID" | "Strand_Gradient" | "Flow", THREE.DataTexture>;

function texture(strip: HairAtlasStrip, key: "alpha" | "id" | "gradient" | "flow"): THREE.DataTexture {
  const flow = key === "flow";
  const mipmaps = strip.levels.map(level => {
    let data = level[key];
    if (flow) {
      data = new Uint8Array(level.width * level.height * 4);
      for (let i = 0; i < level.width * level.height; i++) {
        data[i * 4] = level.flow[i * 3]!; data[i * 4 + 1] = level.flow[i * 3 + 1]!;
        data[i * 4 + 2] = level.flow[i * 3 + 2]!; data[i * 4 + 3] = 255;
      }
    }
    return { width: level.width, height: level.height, data };
  });
  const first = mipmaps[0]!, result = new THREE.DataTexture(first.data, first.width, first.height, flow ? THREE.RGBAFormat : THREE.RedFormat);
  result.name = `xfs_hair_lab_${strip.key}_${key}`;
  result.mipmaps = mipmaps; result.generateMipmaps = false; result.flipY = false; result.unpackAlignment = 1;
  result.colorSpace = flow ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  result.wrapS = result.wrapT = THREE.ClampToEdgeWrapping;
  result.minFilter = THREE.LinearMipmapLinearFilter; result.magFilter = THREE.LinearFilter;
  const uv = strip.atlasUV, du = uv.u1 - uv.u0, dv = uv.v1 - uv.v0;
  result.repeat.set(1 / du, 1 / dv); result.offset.set(-uv.u0 / du, -uv.v0 / dv); result.updateMatrix();
  result.needsUpdate = true;
  return result;
}

/** Proposal hook, scoped to the newly created material. Flow bytes are gamma-decoded once by the sRGB texture. */
export function attachHairAtlasFlow(material: THREE.Material, flow: THREE.Texture, strength: number, mirrored: boolean): void {
  if (!Number.isFinite(strength) || strength < 0) throw Error("Invalid hair FlowStrength.");
  const previous = material.onBeforeCompile, priorKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    const token = "vec3 hairT = normalize(tbn[1]);";
    if (!shader.fragmentShader.includes(token)) throw Error("Hair Lab Flow hook no longer matches the shared hair lighting adapter.");
    shader.uniforms.xfsAtlasFlow = { value: flow }; shader.uniforms.xfsAtlasFlowStrength = { value: strength };
    shader.uniforms.xfsAtlasTangentSign = { value: mirrored ? -1 : 1 };
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
      uniform sampler2D xfsAtlasFlow;
      uniform float xfsAtlasFlowStrength, xfsAtlasTangentSign;`).replace(token, `
      vec2 atlasFlow = texture2D(xfsAtlasFlow, vAlphaMapUv).rg;
      float atlasT = max(xfsAtlasFlowStrength * (2.0 * atlasFlow.r - 1.0), 0.01);
      float atlasB = max(xfsAtlasFlowStrength * (2.0 * atlasFlow.g - 2.0) + 1.0, 0.01);
      vec3 hairT = normalize(atlasT * xfsAtlasTangentSign * tbn[0] + atlasB * tbn[1]);`);
  };
  material.customProgramCacheKey = () => `${priorKey()}-xfs-hair-lab-flow-1`;
}

/**
 * One abort-owned renderer scope. Use the worker's prepared strips and the already resolved hair chunk/profile.
 * UVs stay in the original atlas content rectangle; alphaMap's transform drives all four samplers.
 * The forced Three dispose protocol is confined here. No resources or global caches outlive `signal`.
 */
export function createHairAtlasPreview(atlas: HairAtlasPreviewInput, signal: AbortSignal) {
  signal.throwIfAborted();
  const cached = new Map<string, Maps>(), ownedTextures = new Set<THREE.Texture>(), materials = new Set<THREE.Material>();
  const get = (key: string): { strip: HairAtlasStrip; maps: Maps } => {
    signal.throwIfAborted();
    const strip = atlas.strips.find(s => s.key === key);
    if (!strip || !strip.levels.length) throw Error(`Unknown Hair Lab strip: ${key}`);
    let maps = cached.get(key);
    if (!maps) {
      maps = { Strand_Alpha: texture(strip, "alpha"), Strand_ID: texture(strip, "id"), Strand_Gradient: texture(strip, "gradient"), Flow: texture(strip, "flow") };
      for (const map of Object.values(maps)) ownedTextures.add(map);
      cached.set(key, maps);
    }
    return { strip, maps };
  };
  signal.addEventListener("abort", () => {
    for (const material of materials) material.dispose();
    for (const map of ownedTextures) map.dispose();
    materials.clear(); ownedTextures.clear(); cached.clear();
  }, { once: true });
  const textures = (key: string): ChunkTextures => (parameter) => {
    const maps = get(key).maps;
    return typeof parameter === "string" && Object.hasOwn(maps, parameter) ? maps[parameter as keyof Maps] : undefined;
  };
  return {
    textures,
    createMaterial(key: string, chunk: RenderChunkMaterial, mesh: THREE.Mesh, context: AdapterContext): THREE.Material {
      signal.throwIfAborted();
      const geometry = mesh.geometry;
      if (!geometry.index || !geometry.hasAttribute("position") || !geometry.hasAttribute("uv"))
        throw Error("Hair Lab preview requires indexed card geometry with positions and UVs.");
      if (!geometry.hasAttribute("normal")) geometry.computeVertexNormals();
      if (!geometry.hasAttribute("tangent")) geometry.computeTangents();
      const { strip, maps } = get(key);
      const resolved = { ...chunk, scalars: { ...chunk.scalars, AlphaCutoff: atlas.alphaCutoff } };
      const adapted = MATERIAL_ADAPTERS["hair-strand"].create(resolved, textures(key), mesh, context);
      materials.add(adapted.material); for (const map of adapted.owned) ownedTextures.add(map);
      attachHairAtlasFlow(adapted.material, maps.Flow, chunk.scalars.FlowStrength ?? 1, strip.mirrored);
      return adapted.material;
    },
  };
}
