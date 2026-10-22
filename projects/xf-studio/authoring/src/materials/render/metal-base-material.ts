import * as THREE from "three";

/**
 * The engine's plain metal/rough surface, `engine\materials\metal_base.remt` (template name `metal_base`), for the browser renderer:
 * the earrings a CCXL hairstyle carries, many garments and accessories, arm cyberware decals and the teeth's unreached `default`
 * appearance. Nothing here knows which choice or mod a chunk came from.
 *
 * What the game does [source: decompiled 2.31 `metal_base` `gbuffer_regular` program `4684655453878116559`;
 * research/materials/shader-metal-glass.md §3.3]:
 * - every texture except `Emissive` is read at `LayerTile · uv`;
 * - colour `saturate(BaseColor.rgb · BaseColorScale.rgb)` (the texture sampled through its own `isGamma`);
 * - metalness `saturate(Metalness.r · MetalnessScale + MetalnessBias)` and roughness `saturate(Roughness.r · RoughnessScale +
 *   RoughnessBias)`: each the **red** channel of its own map, unlike Three's packed G/B;
 * - the normal: `t = 2·Normal.rg − 1`, `n = normalize(t · NormalStrength, sqrt(max(1 − t·t, 0)))`, in the mesh's tangent frame;
 * - lit as the Standard class (one GGX lobe, F0 0.04 for dielectrics), so Three's standard light draws it.
 * - the Discarded variant's alpha test (PREV-117): where the instance sets `enableMask` (the Gorilla Arms and Mantis Blades decal and logo
 *   chunks), `discard` where `BaseColor.a < AlphaThreshold` (default 0.38), the raw texture alpha at the tiled UV. That `enableMask`
 *   selects this variant is [hypothesis] (shader-metal-glass.md §3.3); the resolver carries the flag (`ResolvedChunkMaterial.enableMask`).
 * Not drawn: emission (`EmissiveEV` > 0; no character instance read uses it), the variant's per-draw dither dissolve (a gameplay fade),
 * the weather variant and the `post_gbuffer` mode.
 */
export type MetalBaseParameters = {
  baseColorScale: [number, number, number];
  metalnessScale: number; metalnessBias: number;
  roughnessScale: number; roughnessBias: number;
  normalStrength: number; layerTile: number;
  /** The instance's `enableMask`: alpha-test `BaseColor.a` against `alphaThreshold`. */
  masked: boolean; alphaThreshold: number;
};
export type MetalBaseTextures = { baseColor: THREE.Texture; metalness: THREE.Texture; roughness: THREE.Texture; normal: THREE.Texture };

const saturate = (value: number) => Math.min(1, Math.max(0, value));

/** The adapter's parameters from a chunk's effective scalars (instance chain, then the template's defaults; `BaseColorScale.x` … from its vector). */
export function metalBaseParameters(scalars: Readonly<Record<string, number>>): MetalBaseParameters {
  const scalar = (name: string, fallback: number) => Number.isFinite(scalars[name]) ? scalars[name]! : fallback;
  return {
    baseColorScale: [scalar("BaseColorScale.x", 1), scalar("BaseColorScale.y", 1), scalar("BaseColorScale.z", 1)],
    metalnessScale: scalar("MetalnessScale", 1), metalnessBias: scalar("MetalnessBias", 0),
    roughnessScale: scalar("RoughnessScale", 1), roughnessBias: scalar("RoughnessBias", 0),
    normalStrength: scalar("NormalStrength", 1), layerTile: scalar("LayerTile", 1),
    masked: scalars.enableMask === 1, alphaThreshold: scalar("AlphaThreshold", 0.38),
  };
}

/**
 * The G-buffer surface for one texel (CPU reference of `METAL_BASE_GLSL`, used by the tests): linear colour, metalness, roughness and
 * the tangent-space normal, from the sampled (already decoded) texture values in 0–1.
 */
export function metalBaseSurface(sample: { baseColor: readonly number[]; metalness: number; roughness: number; normal: readonly number[] },
  p: MetalBaseParameters): { colour: [number, number, number]; metalness: number; roughness: number; normal: [number, number, number] } {
  const colour = [0, 1, 2].map(i => saturate(sample.baseColor[i]! * p.baseColorScale[i]!)) as [number, number, number];
  const tx = 2 * sample.normal[0]! - 1, ty = 2 * sample.normal[1]! - 1;
  const z = Math.sqrt(Math.max(1 - (tx * tx + ty * ty), 0));
  const nx = tx * p.normalStrength, ny = ty * p.normalStrength, length = Math.hypot(nx, ny, z) || 1;
  return { colour, metalness: saturate(sample.metalness * p.metalnessScale + p.metalnessBias),
    roughness: saturate(sample.roughness * p.roughnessScale + p.roughnessBias), normal: [nx / length, ny / length, z / length] };
}

/** Whether a texel survives the masked variant's alpha test (CPU reference of the program's test): kept unless masked and below the threshold. */
export const metalBaseKeeps = (alpha: number, p: Pick<MetalBaseParameters, "masked" | "alphaThreshold">) => !p.masked || alpha >= p.alphaThreshold;

const DECLARATIONS = /* glsl */`
uniform vec3 xfsMetalScales;
uniform vec3 xfsMetalBias;
uniform float xfsNormalFlipY;
`;
/** The surface, replacing Three's map, roughness, metalness and normal-map chunks (the red channels, scale and bias, RG normal). */
const MAP_GLSL = /* glsl */`
vec2 xfsUv = vMapUv * xfsMetalScales.z;
vec4 xfsBase = texture2D( map, xfsUv );
diffuseColor.rgb = clamp( diffuseColor.rgb * xfsBase.rgb, 0.0, 1.0 );
#ifdef USE_ALPHATEST
diffuseColor.a = xfsBase.a; // the masked variant tests the texture's own alpha (alphatest_fragment discards below AlphaThreshold)
#endif`;
const ROUGHNESS_GLSL = /* glsl */`
float roughnessFactor = clamp( texture2D( roughnessMap, xfsUv ).r * xfsMetalScales.y + xfsMetalBias.y, 0.0, 1.0 );`;
const METALNESS_GLSL = /* glsl */`
float metalnessFactor = clamp( texture2D( metalnessMap, xfsUv ).r * xfsMetalScales.x + xfsMetalBias.x, 0.0, 1.0 );`;
const NORMAL_GLSL = /* glsl */`
vec2 xfsT = texture2D( normalMap, xfsUv ).rg * 2.0 - 1.0;
vec3 xfsN = normalize( vec3( xfsT * xfsMetalBias.z, sqrt( max( 1.0 - dot( xfsT, xfsT ), 0.0 ) ) ) );
normal = normalize( tbn * vec3( xfsN.x, xfsN.y * xfsNormalFlipY, xfsN.z ) );`;

const replaceChunk = (source: string, find: string, by: string) => {
  if (!source.includes(find)) throw Error(`The metal_base shader expects ${find} in this Three.js build.`);
  return source.replace(find, by);
};

/** Patch a `MeshStandardMaterial` program for `metal_base`; throws when this Three.js build lacks an expected chunk. */
export function patchMetalBaseShader(shader: { fragmentShader: string }) {
  let fragment = shader.fragmentShader;
  fragment = replaceChunk(fragment, "#include <common>", `#include <common>\n${DECLARATIONS}`);
  fragment = replaceChunk(fragment, "#include <map_fragment>", MAP_GLSL);
  fragment = replaceChunk(fragment, "#include <roughnessmap_fragment>", ROUGHNESS_GLSL);
  fragment = replaceChunk(fragment, "#include <metalnessmap_fragment>", METALNESS_GLSL);
  fragment = replaceChunk(fragment, "#include <normal_fragment_maps>", NORMAL_GLSL);
  shader.fragmentShader = fragment;
  return shader;
}

/**
 * Build the material. `baseColor` must carry its colour space (sRGB when the resource is gamma); the other maps are data. The normal's
 * green is flipped for Three's tangent frame, as the skin adapter does (skin-material.ts); the engine applies no flip in its own frame.
 * Front faces only, as the template's `CULL_Back`.
 */
export function createMetalBaseMaterial(textures: MetalBaseTextures, parameters: MetalBaseParameters): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ map: textures.baseColor, roughnessMap: textures.roughness, metalnessMap: textures.metalness,
    normalMap: textures.normal, roughness: 1, metalness: 1, side: THREE.FrontSide, ...(parameters.masked ? { alphaTest: parameters.alphaThreshold } : {}) });
  material.color.setRGB(...parameters.baseColorScale, THREE.LinearSRGBColorSpace);
  const uniforms = {
    xfsMetalScales: { value: new THREE.Vector3(parameters.metalnessScale, parameters.roughnessScale, parameters.layerTile) },
    xfsMetalBias: { value: new THREE.Vector3(parameters.metalnessBias, parameters.roughnessBias, parameters.normalStrength) },
    xfsNormalFlipY: { value: -1 },
  };
  material.onBeforeCompile = shader => {
    Object.assign((shader as unknown as { uniforms: Record<string, unknown> }).uniforms, uniforms);
    patchMetalBaseShader(shader);
  };
  material.customProgramCacheKey = () => `xfs-metal-base-2${parameters.masked ? "-masked" : ""}`;
  material.name = "xfs_metal_base";
  return material;
}
