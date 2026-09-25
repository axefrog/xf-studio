/**
 * `base\materials\skin.mt` for the browser renderer: the resolved chunk's parameters, the engine's surface
 * arithmetic and a stated approximation of its skin lighting. The surface part (normal, detail normal,
 * microdetail, cavity, tone tint, secondary albedo, roughness bias) follows the decompiled 2.31 G-buffer
 * program `12806642364631437234` line for line (knowledge/head-cc-rendering.md §2,
 * knowledge/materials-and-shaders.md §4.1) [source]. The lighting is an approximation:
 * - specular: the two GGX lobes of the skin profile, at roughness × `roughness0` and × `roughness1`,
 *   summed and scaled by (1 + `lobeMix`) / 2, with the engine's fixed dielectric F0 of 0.04 [source];
 * - diffuse: renormalised Burley at the surface roughness [source], with a per-channel wrap from the
 *   profile's falloff colour and blur size standing in for the screen-space subsurface blur, which is
 *   not reproduced [approximation];
 * - image-based light uses the same two lobes (the creator scene has no probe term; the ordinary stage does).
 * Not drawn: the wrinkle maps and blood flow (animation-driven, neutral at rest) and the emissive mask
 * (no emissive path yet; the adapter says so when a mask would glow).
 *
 * Pure parameter mapping and tint maths are exported for tests; the shader is injected into a
 * `MeshStandardMaterial` with `onBeforeCompile`. Nothing here names a mod or a choice.
 */
import * as THREE from "three";
import type { RenderChunkMaterial, RenderSkinProfile } from "./render-detail";

/**
 * How a `TintColor` byte reaches the program. The engine's encoding is still open (materials open
 * question 11); byte/255 is the working choice, and it sets how strong every tone is [hypothesis].
 */
export type SkinTintEncoding = "byte" | "srgb-decoded";
export const SKIN_TINT_ENCODING: SkinTintEncoding = "byte";

/** `skin.mt` 2.31 template defaults for the scalars the adapter reads [resource]; the record normally carries them already. */
export const SKIN_TEMPLATE_DEFAULTS = Object.freeze({
  TintScale: 0, DetailNormalInfluence: 0, MicroDetailInfluence: 1, MicroDetailUVScale01: 10, MicroDetailUVScale02: 10,
  DetailRoughnessBiasMin: 1, DetailRoughnessBiasMax: 0.68, CavityIntensity: 0.25, SecondaryAlbedoInfluence: 0,
  SecondaryAlbedoTintColorInfluence: 0, EmissiveEV: 0,
});
/** The base game's `engine\materials\defaults\default.sp` (2.31) [resource]: used only when a chunk names no readable profile. */
export const VANILLA_SKIN_PROFILE: Omit<RenderSkinProfile, "depotPath" | "archive" | "sha256"> = Object.freeze({
  roughness0: 0.966366, roughness1: 1.59684, lobeMix: 1, blurSize: 1.4, diffuse: [255, 255, 255], falloff: [255, 178, 165],
}) as Omit<RenderSkinProfile, "depotPath" | "archive" | "sha256">;

/** Wrap strength at full falloff and blur (the approximation's one tuning constant, chosen by eye, not measured). */
export const SKIN_WRAP_SCALE = 0.5;
/** Blur size at which the wrap reaches full strength (the base game's profile uses 1.4, the reference complexion mod 2.5). */
export const SKIN_WRAP_FULL_BLUR = 2.5;

export type SkinParameters = {
  /** Tone tint colour in the program's units, and `TintScale` (negative: overlay). */
  tintColor: [number, number, number]; tintScale: number;
  detailNormalInfluence: number; microDetailInfluence: number; microDetailUVScale: [number, number];
  detailRoughnessBias: [number, number]; cavityIntensity: number;
  secondaryInfluence: number; secondaryTintInfluence: number; emissiveEV: number;
  /** Dual specular lobe: roughness scales and the lobe weight (1 + lobeMix) / 2. */
  lobes: { roughness0: number; roughness1: number; weight: number };
  /** Per-channel diffuse wrap standing in for the subsurface blur (approximation). */
  wrap: [number, number, number];
  /** The skin profile the values came from, or null when the template's default was unreadable. */
  profile: string | null;
};

const srgbToLinear = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const linearToSrgb = (c: number) => c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A `Color` parameter's bytes in the program's units under an encoding. */
export function tintUnits(bytes: readonly number[], encoding: SkinTintEncoding = SKIN_TINT_ENCODING): [number, number, number] {
  return [0, 1, 2].map(k => encoding === "byte" ? (bytes[k] ?? 0) / 255 : srgbToLinear((bytes[k] ?? 0) / 255)) as [number, number, number];
}

/** Map a resolved `skin.mt` chunk to the renderer's parameters (template defaults fill anything unset). */
export function skinParameters(chunk: Pick<RenderChunkMaterial, "scalars" | "colours" | "skinProfiles">,
  encoding: SkinTintEncoding = SKIN_TINT_ENCODING): SkinParameters {
  const scalar = (name: keyof typeof SKIN_TEMPLATE_DEFAULTS) => {
    const value = chunk.scalars[name];
    return typeof value === "number" && Number.isFinite(value) ? value : SKIN_TEMPLATE_DEFAULTS[name];
  };
  const resolved = chunk.skinProfiles.SkinProfile ?? null;
  const profile = resolved ?? VANILLA_SKIN_PROFILE;
  const blur = clamp01(profile.blurSize / SKIN_WRAP_FULL_BLUR);
  return {
    tintColor: tintUnits(chunk.colours.TintColor ?? [0, 0, 0, 0], encoding), tintScale: Math.max(-1, Math.min(1, scalar("TintScale"))),
    detailNormalInfluence: scalar("DetailNormalInfluence"), microDetailInfluence: scalar("MicroDetailInfluence"),
    microDetailUVScale: [scalar("MicroDetailUVScale01"), scalar("MicroDetailUVScale02")],
    detailRoughnessBias: [scalar("DetailRoughnessBiasMin"), scalar("DetailRoughnessBiasMax")], cavityIntensity: scalar("CavityIntensity"),
    secondaryInfluence: scalar("SecondaryAlbedoInfluence"), secondaryTintInfluence: scalar("SecondaryAlbedoTintColorInfluence"),
    emissiveEV: scalar("EmissiveEV"),
    lobes: skinLobes(profile),
    wrap: profile.falloff.map(c => SKIN_WRAP_SCALE * (c / 255) * blur) as [number, number, number],
    profile: resolved?.depotPath ?? null,
  };
}

/** The skin light's dual lobe from a profile: roughness scales and the weight (1 + lobeMix) / 2 [source]. */
export function skinLobes(profile: Pick<RenderSkinProfile, "roughness0" | "roughness1" | "lobeMix">) {
  return { roughness0: profile.roughness0, roughness1: profile.roughness1, weight: (1 + profile.lobeMix) / 2 };
}

/**
 * One channel of the tone tint, exactly as the program does it: weight `abs(TintScale) · mask.R`; a
 * positive scale multiplies, a negative one overlays; the tinted value is saturated, then blended in.
 */
export function tintChannel(albedo: number, tint: number, tintScale: number, maskR: number): number {
  const weight = Math.abs(tintScale) * maskR;
  const tinted = tintScale >= 0 ? tint * albedo : albedo < 0.5 ? 2 * albedo * tint : 1 - 2 * (1 - albedo) * (1 - tint);
  return albedo + weight * (clamp01(tinted) - albedo);
}

/**
 * The skin's linear base colour at one texel without the cavity term (which needs the microdetail and
 * detail normal): tone tint, then the secondary albedo composited by `influence · A` and tinted toward the
 * toned base by `abs(TintScale) · mask.R · SecondaryAlbedoTintColorInfluence`. Inputs are linear.
 */
export function skinBaseColour(albedo: readonly number[], maskR: number, secondary: readonly number[],
  params: Pick<SkinParameters, "tintColor" | "tintScale" | "secondaryInfluence" | "secondaryTintInfluence">): [number, number, number] {
  const base = [0, 1, 2].map(k => tintChannel(albedo[k]!, params.tintColor[k]!, params.tintScale, maskR));
  const clamped = base.map(clamp01);
  const tintWeight = Math.abs(params.tintScale) * maskR * params.secondaryTintInfluence;
  const weight = params.secondaryInfluence * (secondary[3] ?? 0);
  return [0, 1, 2].map(k => {
    const s = secondary[k] ?? 0;
    const tinted = s + tintWeight * (s * base[k]! - s);
    return clamped[k]! + weight * (tinted - clamped[k]!);
  }) as [number, number, number];
}

/** Roughness after the detail bias: `saturate(R · (1 + B · (bias − 1)))`, bias between min and max by the microdetail term [source]. */
export function skinRoughness(r: number, b: number, bias: readonly [number, number], microTerm: number): number {
  const lo = Math.min(bias[0], bias[1]), hi = Math.max(bias[0], bias[1]);
  const value = (hi - lo) * microTerm + lo;
  return clamp01((value * r - r) * b + r);
}

export type SkinImage = { width: number; height: number; data: ArrayLike<number> };
/**
 * An 8-bit sRGB image read texel by texel (`texel` returns 0–255 for channel 0–2). Decals sample the skin
 * only under their own vertices, so a lazily evaluated image avoids toning every texel of the skin (PREV-43).
 */
export type SkinTexels = { width: number; height: number; texel(x: number, y: number, channel: number): number };
export const imageTexels = (image: SkinImage): SkinTexels => ({ width: image.width, height: image.height,
  texel: (x, y, channel) => image.data[(y * image.width + x) * 4 + channel]! });
type SkinBaseParameters = Pick<SkinParameters, "tintColor" | "tintScale" | "secondaryInfluence" | "secondaryTintInfluence">;
type SkinBaseGamma = { albedo: boolean; secondary: boolean; mask?: boolean };

/** One toned texel as 8-bit sRGB RGB, from same-size images (see `skinBaseImage`). */
function skinBaseTexel(at: number, albedo: SkinImage, mask: SkinImage | null, secondary: SkinImage | null,
  params: SkinBaseParameters, gamma: SkinBaseGamma): [number, number, number] {
  const decode = (value: number, isGamma: boolean) => isGamma ? srgbToLinear(value / 255) : value / 255;
  const a = [0, 1, 2].map(k => decode(albedo.data[at + k]!, gamma.albedo));
  const sec = secondary ? [decode(secondary.data[at]!, gamma.secondary), decode(secondary.data[at + 1]!, gamma.secondary),
    decode(secondary.data[at + 2]!, gamma.secondary), secondary.data[at + 3]! / 255] : [0, 0, 0, 0];
  const colour = skinBaseColour(a, mask ? decode(mask.data[at]!, !!gamma.mask) : 0, sec, params);
  return [0, 1, 2].map(k => Math.round(linearToSrgb(clamp01(colour[k]!)) * 255)) as [number, number, number];
}
const sameSize = (albedo: SkinImage, image: SkinImage | null) => image && image.width === albedo.width && image.height === albedo.height ? image : null;

/**
 * The toned base colour as an 8-bit sRGB RGBA image (for decals that blend over the skin), from same-size
 * 8-bit images: albedo, tint mask and secondary albedo, each decoded from sRGB when its resource is gamma.
 */
export function skinBaseImage(albedo: SkinImage, mask: SkinImage | null, secondary: SkinImage | null,
  params: SkinBaseParameters, gamma: SkinBaseGamma = { albedo: true, secondary: true }): { width: number; height: number; data: Uint8ClampedArray } {
  const { width, height } = albedo, out = new Uint8ClampedArray(width * height * 4);
  const m = sameSize(albedo, mask), s = sameSize(albedo, secondary);
  for (let i = 0; i < width * height; i++) {
    const at = i * 4, colour = skinBaseTexel(at, albedo, m, s, params, gamma);
    out[at] = colour[0]; out[at + 1] = colour[1]; out[at + 2] = colour[2]; out[at + 3] = 255;
  }
  return { width, height, data: out };
}

/** The same toned image, evaluated only at the texels read, each once (the same values as `skinBaseImage`). */
export function skinBaseTexels(albedo: SkinImage, mask: SkinImage | null, secondary: SkinImage | null,
  params: SkinBaseParameters, gamma: SkinBaseGamma = { albedo: true, secondary: true }): SkinTexels {
  const m = sameSize(albedo, mask), s = sameSize(albedo, secondary);
  const toned = new Map<number, [number, number, number]>();
  return { width: albedo.width, height: albedo.height, texel(x, y, channel) {
    const index = y * albedo.width + x;
    let colour = toned.get(index);
    if (!colour) { colour = skinBaseTexel(index * 4, albedo, m, s, params, gamma); toned.set(index, colour); }
    return colour[channel]!;
  } };
}

export type SkinTextures = {
  albedo: THREE.Texture; normal: THREE.Texture; roughness: THREE.Texture;
  detailNormal: THREE.Texture; microDetail: THREE.Texture; tintMask: THREE.Texture; secondary: THREE.Texture;
};
export type SkinMaterialHandle = {
  /** Show or flatten the normal maps (the viewport's normals toggle). */
  setNormals(enabled: boolean): void;
  parameters: SkinParameters;
};

/** GLSL declarations and helpers (fragment scope). */
const DECLARATIONS = /* glsl */`
uniform sampler2D xfsDetailNormal;
uniform sampler2D xfsMicroDetail;
uniform sampler2D xfsSkinRoughness;
uniform sampler2D xfsTintMask;
uniform sampler2D xfsSecondaryAlbedo;
uniform vec4 xfsTint;
uniform vec4 xfsSkinScalars;
uniform vec2 xfsMicroScale;
uniform vec2 xfsRoughnessBias;
uniform vec2 xfsSecondaryParams;
uniform vec3 xfsLobes;
uniform vec3 xfsWrap;
uniform float xfsNormalFlipY;
vec3 xfsUnpackRG( const in vec4 texel ) {
	vec2 xy = texel.xy * 2.0 - 1.0;
	return vec3( xy, sqrt( max( 1.0 - dot( xy, xy ), 0.0 ) ) );
}
vec3 xfsBlendNormal( const in vec3 n, const in vec3 d, const in float weight ) {
	return n + weight * ( vec3( d.x * n.z + d.z * n.x, d.y * n.z + d.z * n.y, d.z * n.z ) - n );
}
float xfsHermite( const in float t ) { return t * t * ( 3.0 - 2.0 * t ); }
vec3 xfsOverlay( const in vec3 a, const in vec3 c ) {
	return mix( 1.0 - 2.0 * ( 1.0 - a ) * ( 1.0 - c ), 2.0 * a * c, step( a, vec3( 0.4999999 ) ) );
}
`;

/** The surface: replaces `map_fragment`, and leaves the composed normal, roughness and metalness for later chunks. */
const SURFACE = /* glsl */`
vec2 xfsUv = vMapUv;
vec3 xfsN = xfsUnpackRG( texture2D( normalMap, xfsUv ) );
vec3 xfsD = xfsUnpackRG( texture2D( xfsDetailNormal, xfsUv ) );
xfsN = normalize( xfsBlendNormal( xfsN, xfsD, xfsSkinScalars.x ) );
vec4 xfsR = texture2D( xfsSkinRoughness, xfsUv );
vec4 xfsM = texture2D( xfsTintMask, xfsUv );
float xfsQb = xfsHermite( clamp( floor( xfsM.z * 5.0 ) * 0.2, 0.0, 1.0 ) );
float xfsQg = xfsHermite( clamp( floor( xfsM.y * 6.0 ) * 0.16666667, 0.0, 1.0 ) );
vec2 xfsMicroSize = vec2( textureSize( xfsMicroDetail, 0 ) );
float xfsHx = 0.5 / xfsMicroSize.x, xfsHy = 0.5 / xfsMicroSize.y;
float xfsKx = xfsHx - 1.0 / ( xfsMicroSize.x * 0.5 - 1.0 ), xfsKy = xfsHy - 1.0 / ( xfsMicroSize.y - 1.0 );
vec2 xfsP1 = ( xfsQb + 1.4 ) * xfsUv * xfsMicroScale.x;
vec2 xfsP2 = ( xfsQb + 1.0 ) * xfsUv * xfsMicroScale.y;
vec4 xfsT1 = textureGrad( xfsMicroDetail, vec2( fract( xfsKx * xfsP1.x + xfsP1.x ) * 0.5 + xfsHx, fract( xfsKy * xfsP1.y + xfsP1.y ) + xfsHy ), dFdx( xfsP1 ), dFdy( xfsP1 ) );
vec4 xfsT2 = textureGrad( xfsMicroDetail, vec2( xfsHx + 0.5 + fract( xfsKx * xfsP2.x + xfsP2.x ) * 0.5, fract( xfsKy * xfsP2.y + xfsP2.y ) + xfsHy ), dFdx( xfsP2 ), dFdy( xfsP2 ) );
vec2 xfsM1 = xfsT1.xy * 2.0 - 1.0, xfsM2 = xfsT2.xy * 2.0 - 1.0;
float xfsMz1 = sqrt( max( 1.0 - dot( xfsM1, xfsM1 ), 0.0 ) ), xfsMz2 = sqrt( max( 1.0 - dot( xfsM2, xfsM2 ), 0.0 ) );
vec3 xfsMicro = vec3( mix( xfsM2, xfsM1, xfsQg ), mix( xfsMz2, xfsMz1, xfsQg ) );
xfsN = normalize( xfsBlendNormal( xfsN, xfsMicro, xfsSkinScalars.y * xfsR.z ) );
float xfsA1 = xfsM1.x * ( 2.0 * xfsT1.x ) + xfsM1.y * ( 2.0 * xfsT1.y );
float xfsA2 = xfsM2.x * ( 2.0 * xfsT2.x ) + xfsM2.y * ( 2.0 * xfsT2.y );
float xfsMicroTerm = 2.5 * mix( xfsA1, xfsA2, xfsQg ) + 0.2;
float xfsCav = xfsR.z * xfsR.z * xfsMicroTerm + xfsD.x;
float xfsCavStep = clamp( ( xfsCav * xfsSkinScalars.z - 0.15 ) * -6.6666665, 0.0, 1.0 );
float xfsCavity = ( xfsCavStep * xfsCavStep * 0.01 * ( 3.0 - 2.0 * xfsCavStep ) + xfsSkinScalars.z * -0.1 * xfsCav ) * xfsR.z;
vec3 xfsA = texture2D( map, xfsUv ).rgb + xfsCavity;
float xfsTintWeight = abs( xfsTint.w ) * xfsM.x;
vec3 xfsTinted = xfsTint.w >= 0.0 ? xfsTint.rgb * xfsA : xfsOverlay( xfsA, xfsTint.rgb );
vec3 xfsBase = xfsA + xfsTintWeight * ( clamp( xfsTinted, 0.0, 1.0 ) - xfsA );
vec4 xfsS = texture2D( xfsSecondaryAlbedo, xfsUv );
vec3 xfsSecondaryTinted = xfsS.rgb + xfsTintWeight * xfsSecondaryParams.y * ( xfsS.rgb * xfsBase - xfsS.rgb );
vec3 xfsClamped = clamp( xfsBase, 0.0, 1.0 );
diffuseColor.rgb = xfsClamped + xfsSecondaryParams.x * xfsS.a * ( xfsSecondaryTinted - xfsClamped );
float xfsBiasValue = ( max( xfsRoughnessBias.x, xfsRoughnessBias.y ) - min( xfsRoughnessBias.x, xfsRoughnessBias.y ) ) * xfsMicroTerm + min( xfsRoughnessBias.x, xfsRoughnessBias.y );
float xfsRoughnessValue = clamp( ( xfsBiasValue * xfsR.x - xfsR.x ) * xfsR.z + xfsR.x, 0.0, 1.0 );
vec3 xfsTangentNormal = normalize( mix( vec3( 0.0, 0.0, 1.0 ), vec3( xfsN.x, xfsN.y * xfsNormalFlipY, xfsN.z ), xfsSkinScalars.w ) );
`;

/** The skin light: two specular lobes and a wrapped Burley diffuse (appended after `lights_physical_pars_fragment`). */
const LIGHT = /* glsl */`
#ifdef USE_ENVMAP
vec3 xfsSkinIBL( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
	return ( getIBLRadiance( viewDir, normal, clamp( roughness * xfsLobes.x, 0.0525, 1.0 ) ) +
		getIBLRadiance( viewDir, normal, clamp( roughness * xfsLobes.y, 0.0525, 1.0 ) ) ) * xfsLobes.z;
}
#endif
void RE_Direct_XfsSkin( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float xfsNoL = dot( geometryNormal, directLight.direction );
	vec3 irradiance = saturate( xfsNoL ) * directLight.color;
	PhysicalMaterial lobe0 = material;
	PhysicalMaterial lobe1 = material;
	lobe0.roughness = clamp( material.roughness * xfsLobes.x, 0.04, 1.0 );
	lobe1.roughness = clamp( material.roughness * xfsLobes.y, 0.04, 1.0 );
	vec3 specular = ( BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, lobe0 ) +
		BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, lobe1 ) ) * xfsLobes.z;
	reflectedLight.directSpecular += irradiance * specular * material.multiScatteringCompensation;
	vec3 halfDir = normalize( directLight.direction + geometryViewDir );
	float dotLH = saturate( dot( directLight.direction, halfDir ) );
	float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
	float r = material.roughness;
	float fd90 = 0.5 * r + 2.0 * dotLH * dotLH * r;
	float burley = ( 1.0 + ( fd90 - 1.0 ) * pow( 1.0 - saturate( xfsNoL ), 5.0 ) ) * ( 1.0 + ( fd90 - 1.0 ) * pow( 1.0 - dotNV, 5.0 ) ) * ( 1.0 - 0.338 * r );
	// Subsurface stand-in: the profile's falloff wraps light past the terminator per channel (metal skips it, as the engine's SSS does).
	vec3 wrap = material.metalness > 0.1 ? vec3( 0.0 ) : xfsWrap;
	vec3 wrapped = saturate( ( xfsNoL + wrap ) / ( 1.0 + wrap ) ) / ( 1.0 + wrap );
	reflectedLight.directDiffuse += directLight.color * wrapped * burley * BRDF_Lambert( material.diffuseContribution );
}
#undef RE_Direct
#define RE_Direct RE_Direct_XfsSkin
`;

const IBL_CALL = "vec3 iblRadiance = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );";

/** Patch a `MeshStandardMaterial` program for the skin; throws when this Three.js build lacks an expected chunk. */
export function patchSkinShader(shader: { vertexShader: string; fragmentShader: string }, chunks: Record<string, string> = THREE.ShaderChunk as unknown as Record<string, string>) {
  const replace = (source: string, find: string, by: string) => {
    if (!source.includes(find)) throw Error(`The skin shader expects ${find} in this Three.js build.`);
    return source.replace(find, by);
  };
  const iblChunk = chunks.lights_fragment_maps ?? "";
  if (!iblChunk.includes(IBL_CALL)) throw Error("The skin shader expects the image-based radiance call in this Three.js build.");
  let fragment = shader.fragmentShader;
  fragment = replace(fragment, "#include <common>", `#include <common>\n${DECLARATIONS}`);
  fragment = replace(fragment, "#include <lights_physical_pars_fragment>", `#include <lights_physical_pars_fragment>\n${LIGHT}`);
  fragment = replace(fragment, "#include <map_fragment>", SURFACE);
  fragment = replace(fragment, "#include <roughnessmap_fragment>", "float roughnessFactor = xfsRoughnessValue;");
  fragment = replace(fragment, "#include <metalnessmap_fragment>", "float metalnessFactor = xfsR.y;");
  fragment = replace(fragment, "#include <normal_fragment_maps>", "normal = normalize( tbn * xfsTangentNormal );");
  fragment = replace(fragment, "#include <lights_fragment_maps>",
    iblChunk.replace(IBL_CALL, "vec3 iblRadiance = xfsSkinIBL( geometryViewDir, geometryNormal, material.roughness );"));
  shader.fragmentShader = fragment;
  return shader;
}

/**
 * Build the skin material. `albedo` must carry its colour space (sRGB when the resource is gamma), every
 * other map is data. The normal map's green is flipped for Three's tangent frame (the previous preview's
 * measured orientation); the engine applies no flip because its frame differs.
 */
export function createSkinMaterial(textures: SkinTextures, parameters: SkinParameters): { material: THREE.MeshStandardMaterial; handle: SkinMaterialHandle } {
  const material = new THREE.MeshStandardMaterial({ map: textures.albedo, normalMap: textures.normal, roughness: 1, metalness: 0 });
  const uniforms = {
    xfsDetailNormal: { value: textures.detailNormal }, xfsMicroDetail: { value: textures.microDetail },
    xfsSkinRoughness: { value: textures.roughness }, xfsTintMask: { value: textures.tintMask }, xfsSecondaryAlbedo: { value: textures.secondary },
    xfsTint: { value: new THREE.Vector4(...parameters.tintColor, parameters.tintScale) },
    xfsSkinScalars: { value: new THREE.Vector4(parameters.detailNormalInfluence, parameters.microDetailInfluence, parameters.cavityIntensity, 1) },
    xfsMicroScale: { value: new THREE.Vector2(...parameters.microDetailUVScale) },
    xfsRoughnessBias: { value: new THREE.Vector2(...parameters.detailRoughnessBias) },
    xfsSecondaryParams: { value: new THREE.Vector2(parameters.secondaryInfluence, parameters.secondaryTintInfluence) },
    xfsLobes: { value: new THREE.Vector3(parameters.lobes.roughness0, parameters.lobes.roughness1, parameters.lobes.weight) },
    xfsWrap: { value: new THREE.Vector3(...parameters.wrap) },
    xfsNormalFlipY: { value: -1 },
  };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    patchSkinShader(shader);
  };
  material.customProgramCacheKey = () => "xfs-skin-1";
  material.name = "xfs_skin";
  return { material, handle: { parameters, setNormals: enabled => { uniforms.xfsSkinScalars.value.w = enabled ? 1 : 0; } } };
}
