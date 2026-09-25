import * as THREE from "three";
import type { DecalKind } from "./render-templates";
import { patchSkinLight, skinLightUniforms, type SkinParameters } from "./skin-material";

/**
 * The face-detail decal family for the browser renderer: one material for the post-G-buffer decal templates the game
 * draws on the skin (`mesh_decal`, `mesh_decal_double_diffuse`, `mesh_decal_gradientmap_recolor`), driven by a resolved
 * chunk's own parameters. Nothing here knows which choice or mod a chunk came from.
 *
 * What the game does [source: decompiled 2.31 `mesh_decal` pixel program `16098255505177109230` and
 * `mesh_decal_double_diffuse` `8834363738920290566`; register names by the templates' parameter order]:
 * - every texture is read at the transformed UV `rotate((uv − ½)·UVScale, UVRotation·π) + ½ + UVOffset` (stored V);
 * - coverage is the colour map's contrast-adjusted alpha, squared, times `1 − SecondaryMaskInfluence · SecondaryMask.R`
 *   (the mask at `SecondaryMaskUVScale ×` the transformed UV); double diffuse first adds the secondary alpha where the
 *   primary is uncovered (`p + (1 − p)·s·SecondaryDiffuseAlphaIntensity`);
 * - three G-buffer targets blend with `SrcAlpha/InvSrcAlpha`, each with its own alpha, clamped by the 8-bit target:
 *   colour `DiffuseAlpha · coverage` over `sqrt(colour)` (so colour blends in square-root space), surface
 *   `RoughnessMetalnessAlpha · coverage` over (metalness, roughness) from each map's R × scale + bias, and normal
 *   `NormalAlpha · (UseNormalAlphaTex ? NormalAlphaTex.R : colour-map alpha)` (not squared; in `NormalsBlendingMode` 1
 *   also × `saturate(50 − 50·z)`, so a flat texel writes nothing);
 * - the pixel keeps its lighting class: makeup on skin is lit as skin.
 *
 * What the preview does [approximation]: it draws the decal mesh (lifted 0.4 mm like the game's) as one blended forward
 * pass lit by the skin's own light (skin-material.ts). With the skin colour, roughness and metalness under each vertex
 * (`xfsUnderlay`, `xfsUnderRoughness`, `xfsUnderMetalness`, read on the drawn head), it solves the ordinary "over" colour and alpha that give
 * the square-root-space colour blend exactly per channel, uses the largest of the three target alphas so a surface or
 * normal write shows where the colour is faint, and interpolates roughness, metalness and the normal from the skin's
 * value towards the decal's by each target's share of that alpha. Limits: the skin under the decal is known per vertex
 * only, overlapping decals each blend against the skin (not against the decal below), and where only the surface or the
 * normal changes the fine skin texture is softened by that coverage. Without the underlay the decal falls back to a
 * plain linear colour blend. The solve is in linear light, so it holds only where the pass blends in linear light: both
 * lighting presets draw into the display's scene-linear target (linear-display.ts; PREV-50).
 */
export type Rgb = [number, number, number];
/**
 * How a `Color` parameter's bytes reach the program. The engine's encoding is open (materials open question 11); the
 * decal family uses the same sRGB decoding as the brow adapter, so brows and the other face decals agree [hypothesis].
 */
export type DecalColourEncoding = "srgb-decoded" | "byte";
export const DECAL_COLOUR_ENCODING: DecalColourEncoding = "srgb-decoded";

export type FaceDecalParameters = {
  kind: DecalKind;
  /** `DiffuseColor` in the program's units (linear), and `DiffuseAlpha` (may exceed 1: blush uses 2). */
  diffuseColor: Rgb; diffuseAlpha: number;
  uvOffset: [number, number]; uvRotation: number; uvScale: [number, number];
  /** `AlphaMaskContrast`. */
  contrast: number;
  secondaryMask: { uvScale: number; influence: number };
  normal: { alpha: number; useAlphaTexture: boolean; blendMode: 0 | 1 };
  roughness: { scale: number; bias: number }; metalness: { scale: number; bias: number };
  /** `RoughnessMetalnessAlpha`. */
  surfaceAlpha: number;
  /** Double diffuse: the secondary colour and alpha intensity, and the gradient tint. */
  secondaryColor: Rgb; secondaryIntensity: number;
  gradient: { use: boolean; uv: number; intensity: number };
};

const srgbToLinear = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const saturate = (value: number) => Math.min(1, Math.max(0, value));

/** A `Color` parameter's bytes in the program's units. */
export function decalColourUnits(bytes: readonly number[], encoding: DecalColourEncoding = DECAL_COLOUR_ENCODING): Rgb {
  return [0, 1, 2].map(k => encoding === "byte" ? (bytes[k] ?? 0) / 255 : srgbToLinear((bytes[k] ?? 0) / 255)) as Rgb;
}

/**
 * A resolved chunk's effective scalars and colours → the family's parameters. The record already carries the template's
 * defaults; the fallbacks here are the 2.31 `mesh_decal.mt` defaults, so a missing value never invents coverage.
 */
export function faceDecalParameters(kind: DecalKind, scalars: Readonly<Record<string, number>>, colours: Readonly<Record<string, readonly number[]>>,
  encoding: DecalColourEncoding = DECAL_COLOUR_ENCODING): FaceDecalParameters {
  const scalar = (name: string, fallback: number) => Number.isFinite(scalars[name]) ? scalars[name]! : fallback;
  const colour = (name: string) => decalColourUnits(colours[name] ?? [255, 255, 255], encoding);
  return {
    kind, diffuseColor: colour("DiffuseColor"), diffuseAlpha: Math.max(0, scalar("DiffuseAlpha", 0)),
    uvOffset: [scalar("UVOffsetX", 0), scalar("UVOffsetY", 0)], uvRotation: scalar("UVRotation", 0), uvScale: [scalar("UVScaleX", 1), scalar("UVScaleY", 1)],
    contrast: scalar("AlphaMaskContrast", 0),
    secondaryMask: { uvScale: scalar("SecondaryMaskUVScale", 1), influence: scalar("SecondaryMaskInfluence", 0) },
    normal: { alpha: Math.max(0, scalar("NormalAlpha", 0)), useAlphaTexture: scalar("UseNormalAlphaTex", 0) > 0.5,
      blendMode: scalar("NormalsBlendingMode", 0) > 0.5 ? 1 : 0 },
    roughness: { scale: scalar("RoughnessScale", 1), bias: scalar("RoughnessBias", 0) },
    metalness: { scale: scalar("MetalnessScale", 1), bias: scalar("MetalnessBias", 0) },
    surfaceAlpha: Math.max(0, scalar("RoughnessMetalnessAlpha", 0)),
    secondaryColor: colour("SecondaryDiffuseColor"), secondaryIntensity: saturate(scalar("SecondaryDiffuseAlphaIntensity", 0)),
    gradient: { use: scalar("UseGradientMap", 0) >= 0.5, uv: saturate(scalar("GradientMapUV", 1)), intensity: Math.max(0, scalar("GradientMapIntensity", 1)) },
  };
}

/** The engine's alpha contrast: `saturate((a − ½)·tan((c + 1)·π/4) + ½)`; contrast 0 leaves the alpha unchanged. */
export const decalContrast = (alpha: number, contrast: number) => saturate((alpha - 0.5) * Math.tan((contrast + 1) * Math.PI / 4) + 0.5);

/** `mesh_decal` coverage: the contrast-adjusted colour-map alpha, squared, times `1 − influence · secondary`. */
export function decalCoverage(alpha: number, contrast: number, secondary = 1, influence = 0): number {
  const adjusted = decalContrast(alpha, contrast);
  return adjusted * adjusted * (1 - influence * secondary);
}

/** Double-diffuse coverage: primary plus the secondary where the primary is uncovered, squared, times the mask term. */
export function doubleDiffuseCoverage(primary: number, secondary: number, contrast: number, intensity: number, mask = 1, influence = 0): number {
  const p = decalContrast(primary, contrast), s = decalContrast(secondary, contrast);
  const combined = p + (1 - p) * s * intensity;
  return combined * combined * (1 - influence * mask);
}

/**
 * The three G-buffer target alphas for one texel, clamped as the 8-bit targets clamp them. `normalSource` is
 * `NormalAlphaTex.R` or the raw colour-map alpha (per `UseNormalAlphaTex`); `normalZ` is the decal normal's reconstructed
 * Z, which mode 1 uses to fade flat texels out.
 */
export function decalTargets(parameters: Pick<FaceDecalParameters, "diffuseAlpha" | "surfaceAlpha" | "normal">, coverage: number,
  normalSource: number, normalZ = 0): { colour: number; surface: number; normal: number } {
  const flat = parameters.normal.blendMode === 1 ? saturate(50 - 50 * normalZ) : 1;
  return { colour: saturate(parameters.diffuseAlpha * coverage), surface: saturate(parameters.surfaceAlpha * coverage),
    normal: saturate(parameters.normal.alpha * normalSource * flat) };
}

/** The engine's colour result: `SrcAlpha` blend of `sqrt(colour)` over `sqrt(underlay)`, decoded by squaring. */
export function gbufferColour(decal: Readonly<Rgb>, alpha: number, underlay: Readonly<Rgb>): Rgb {
  const a = saturate(alpha);
  return decal.map((c, k) => (a * Math.sqrt(Math.max(c, 0)) + (1 - a) * Math.sqrt(Math.max(underlay[k]!, 0))) ** 2) as Rgb;
}

/**
 * The forward "over" colour and alpha that reproduce `gbufferColour` over a known underlay, with the alpha at least
 * `minimum` (the largest target alpha, so a surface or normal write shows). Exact per channel when the underlay is right.
 */
export function forwardDecal(decal: Readonly<Rgb>, colourAlpha: number, underlay: Readonly<Rgb>, minimum = 0): { color: Rgb; alpha: number } {
  const target = gbufferColour(decal, colourAlpha, underlay);
  let alpha = Math.max(saturate(colourAlpha), saturate(minimum));
  for (let k = 0; k < 3; k++)
    if (underlay[k]! - decal[k]! > 1e-6) alpha = Math.max(alpha, (underlay[k]! - target[k]!) / (underlay[k]! - decal[k]!));
  alpha = Math.min(1, alpha);
  if (alpha <= 0) return { color: [...decal] as Rgb, alpha: 0 };
  return { color: target.map((t, k) => Math.max(0, (t - (1 - alpha) * underlay[k]!) / alpha)) as Rgb, alpha };
}

/**
 * The surface the forward pass is lit with: roughness and metalness move from the skin's towards the decal's by the
 * surface write's share of the drawn alpha (so a decal that writes no surface keeps the skin's roughness).
 */
export function forwardSurface(under: { roughness: number; metalness: number }, decal: { roughness: number; metalness: number },
  surfaceAlpha: number, drawnAlpha: number): { roughness: number; metalness: number } {
  const share = drawnAlpha > 0 ? saturate(surfaceAlpha / drawnAlpha) : 0;
  return { roughness: under.roughness + share * (decal.roughness - under.roughness), metalness: under.metalness + share * (decal.metalness - under.metalness) };
}

/** The textures the family samples; each optional one falls back to the template's own default (grey, white, flat, black). */
export type FaceDecalTextures = {
  /** `DiffuseTexture` as colour (its RGB is sRGB-decoded when the resource is gamma), or as data for the gradient ID map. */
  diffuse: THREE.Texture; secondaryMask: THREE.Texture; normal: THREE.Texture; normalAlpha: THREE.Texture;
  roughness: THREE.Texture; metalness: THREE.Texture;
  /** Double diffuse: `SecondaryDiffuseAlpha` (data) and `GradientMap` (colour); gradient recolour: `MaskTexture` and `GradientMap`. */
  secondaryDiffuse?: THREE.Texture; gradient?: THREE.Texture; mask?: THREE.Texture;
};
export type FaceDecalOptions = {
  /** The geometry carries `xfsUnderlay` (linear skin colour), `xfsUnderRoughness` and `xfsUnderMetalness` per vertex. */
  underlay: boolean;
  /** Light with the skin's own light (its lobes and subsurface wrap); null lights the decal as a standard surface. */
  skinLight: Pick<SkinParameters, "lobes" | "wrap"> | null;
};

const KIND_DEFINE: Record<DecalKind, string> = { "mesh-decal": "XFS_DECAL_MESH", "double-diffuse": "XFS_DECAL_DOUBLE", "gradient-recolor": "XFS_DECAL_GRADIENT" };

const DECLARATIONS = /* glsl */`
uniform sampler2D xfsSecondaryMask, xfsNormalAlphaTex, xfsDecalRoughness, xfsDecalMetalness, xfsSecondaryDiffuse, xfsDecalGradient, xfsDecalMask;
uniform vec4 xfsDecalColour;
uniform vec4 xfsUv;
uniform vec2 xfsUvScale;
uniform vec4 xfsDecalMisc;
uniform vec4 xfsDecalNormal;
uniform vec4 xfsDecalSurface;
uniform vec4 xfsDecalSecondary;
uniform vec4 xfsDecalGradientParams;
uniform vec2 xfsDecalView;
#ifdef XFS_GBUFFER_DECAL
varying vec3 vXfsUnderlay;
varying float vXfsUnderRoughness;
varying float vXfsUnderMetalness;
#endif
float xfsContrast( const in float a ) { return clamp( ( a - 0.5 ) * tan( ( xfsDecalMisc.x + 1.0 ) * 0.78539816 ) + 0.5, 0.0, 1.0 ); }
vec3 xfsDecalPow2( const in vec3 v ) { return v * v; }
`;

/** Replaces `map_fragment`: the template's colour and coverage, the three target alphas and the forward blend. */
const SURFACE = /* glsl */`
// The engine reads the stored V; the exported images and glTF UVs are flipped relative to it (as for the brows).
vec2 xfsStored = vec2( vMapUv.x, 1.0 - vMapUv.y );
vec2 xfsCentred = ( xfsStored - 0.5 ) * xfsUvScale;
float xfsSin = sin( xfsUv.z * PI ), xfsCos = cos( xfsUv.z * PI );
vec2 xfsEngineUv = vec2( xfsCentred.x * xfsCos - xfsCentred.y * xfsSin, xfsCentred.x * xfsSin + xfsCentred.y * xfsCos ) + 0.5 + xfsUv.xy;
vec2 xfsDecalUv = vec2( xfsEngineUv.x, 1.0 - xfsEngineUv.y );
vec2 xfsSecondaryUv = xfsEngineUv * xfsDecalMisc.y;
float xfsMaskTerm = 1.0 - xfsDecalMisc.z * texture2D( xfsSecondaryMask, vec2( xfsSecondaryUv.x, 1.0 - xfsSecondaryUv.y ) ).r;
vec4 xfsD = texture2D( map, xfsDecalUv );
vec3 xfsColour;
float xfsCoverage;
float xfsNormalSource = xfsD.a;
#if defined( XFS_DECAL_DOUBLE )
	float xfsP = xfsContrast( xfsD.a );
	float xfsS = xfsContrast( texture2D( xfsSecondaryDiffuse, xfsDecalUv ).a );
	float xfsCombined = xfsP + ( 1.0 - xfsP ) * xfsS * xfsDecalSecondary.w;
	xfsCoverage = xfsCombined * xfsCombined * xfsMaskTerm;
	vec3 xfsPrimaryTint = xfsDecalGradientParams.x > 0.5
		? clamp( texture2D( xfsDecalGradient, vec2( xfsDecalGradientParams.y, 0.5 ) ).rgb * xfsDecalGradientParams.z, 0.0, 1.0 )
		: xfsDecalColour.rgb;
	xfsColour = xfsPrimaryTint * xfsD.rgb + xfsDecalSecondary.rgb * ( xfsS * ( 1.0 - xfsD.a ) * xfsDecalSecondary.w );
#elif defined( XFS_DECAL_GRADIENT )
	vec4 xfsG = texture2D( xfsDecalGradient, vec2( xfsD.r, 0.5 ) );
	xfsColour = xfsDecalColour.rgb * xfsG.rgb;
	xfsCoverage = xfsG.a * texture2D( xfsDecalMask, xfsDecalUv ).r * xfsMaskTerm;
	xfsNormalSource = xfsCoverage;
#else
	float xfsAdjusted = xfsContrast( xfsD.a );
	xfsCoverage = xfsAdjusted * xfsAdjusted * xfsMaskTerm;
	xfsColour = xfsDecalColour.rgb * xfsD.rgb;
#endif
vec2 xfsNxy = texture2D( normalMap, xfsDecalUv ).xy * 2.0 - 1.0;
vec3 xfsDecalN = vec3( xfsNxy, sqrt( max( 1.0 - dot( xfsNxy, xfsNxy ), 0.0 ) ) );
float xfsColourA = clamp( xfsDecalColour.w * xfsCoverage, 0.0, 1.0 );
float xfsSurfaceA = clamp( xfsDecalSurface.w * xfsCoverage, 0.0, 1.0 );
float xfsNormalA = xfsDecalNormal.x * ( xfsDecalNormal.y > 0.5 ? texture2D( xfsNormalAlphaTex, xfsDecalUv ).r : xfsNormalSource );
if ( xfsDecalNormal.z > 0.5 ) xfsNormalA *= clamp( 50.0 - 50.0 * xfsDecalN.z, 0.0, 1.0 );
xfsNormalA = clamp( xfsNormalA, 0.0, 1.0 );
float xfsDecalRough = clamp( texture2D( xfsDecalRoughness, xfsDecalUv ).r * xfsDecalSurface.x + xfsDecalSurface.y, 0.0, 1.0 );
float xfsDecalMetal = clamp( texture2D( xfsDecalMetalness, xfsDecalUv ).r * xfsDecalMisc.w + xfsDecalNormal.w, 0.0, 1.0 );
float xfsDrawn;
float xfsUnderRough;
float xfsUnderMetal;
#ifdef XFS_GBUFFER_DECAL
{
	vec3 xfsUnder = max( vXfsUnderlay, vec3( 0.0 ) );
	vec3 xfsTarget = xfsDecalPow2( xfsColourA * sqrt( max( xfsColour, vec3( 0.0 ) ) ) + ( 1.0 - xfsColourA ) * sqrt( xfsUnder ) );
	vec3 xfsGap = xfsUnder - xfsColour;
	vec3 xfsNeeded = mix( vec3( 0.0 ), ( xfsUnder - xfsTarget ) / max( xfsGap, vec3( 1e-6 ) ), step( vec3( 1e-6 ), xfsGap ) );
	xfsDrawn = clamp( max( max( xfsColourA, max( xfsSurfaceA, xfsNormalA ) ), max( xfsNeeded.r, max( xfsNeeded.g, xfsNeeded.b ) ) ), 0.0, 1.0 );
	if ( xfsDrawn > 0.0 ) xfsColour = max( vec3( 0.0 ), ( xfsTarget - ( 1.0 - xfsDrawn ) * xfsUnder ) / xfsDrawn );
	xfsUnderRough = vXfsUnderRoughness;
	xfsUnderMetal = vXfsUnderMetalness;
}
#else
	// No skin colour under the decal: a plain linear colour blend, and nothing where only the surface or normal changes.
	xfsDrawn = xfsColourA;
	xfsUnderRough = xfsDecalRough;
	xfsUnderMetal = 0.0;
#endif
float xfsSurfaceShare = xfsDrawn > 0.0 ? clamp( xfsSurfaceA / xfsDrawn, 0.0, 1.0 ) : 0.0;
float xfsNormalShare = xfsDrawn > 0.0 ? clamp( xfsNormalA / xfsDrawn, 0.0, 1.0 ) : 0.0;
float xfsRoughnessValue = mix( xfsUnderRough, xfsDecalRough, xfsSurfaceShare );
float xfsMetalnessValue = mix( xfsUnderMetal, xfsDecalMetal, xfsSurfaceShare );
vec3 xfsTangentNormal = normalize( mix( vec3( 0.0, 0.0, 1.0 ), vec3( xfsDecalN.x, xfsDecalN.y * xfsDecalView.x, xfsDecalN.z ), xfsNormalShare * xfsDecalView.y ) );
if ( xfsDrawn < 0.002 ) discard;
diffuseColor = vec4( xfsColour, xfsDrawn );
`;

/** Patch a `MeshStandardMaterial` program for the decal family; throws when this Three.js build lacks an expected chunk. */
export function patchFaceDecalShader(shader: { vertexShader: string; fragmentShader: string }, options: { underlay: boolean; skinLight: boolean },
  chunks?: Record<string, string>) {
  const replace = (source: string, find: string, by: string) => {
    if (!source.includes(find)) throw Error(`The face decal shader expects ${find} in this Three.js build.`);
    return source.replace(find, by);
  };
  if (options.underlay) {
    shader.vertexShader = replace(shader.vertexShader, "#include <common>", `#include <common>
attribute vec3 xfsUnderlay;
attribute float xfsUnderRoughness;
attribute float xfsUnderMetalness;
varying vec3 vXfsUnderlay;
varying float vXfsUnderRoughness;
varying float vXfsUnderMetalness;`);
    shader.vertexShader = replace(shader.vertexShader, "#include <begin_vertex>", `#include <begin_vertex>
vXfsUnderlay = xfsUnderlay;
vXfsUnderRoughness = xfsUnderRoughness;
vXfsUnderMetalness = xfsUnderMetalness;`);
  }
  let fragment = shader.fragmentShader;
  fragment = replace(fragment, "#include <common>", `#include <common>\n${DECLARATIONS}`);
  if (options.skinLight) fragment = patchSkinLight(fragment, chunks, "face decal");
  fragment = replace(fragment, "#include <map_fragment>", SURFACE);
  fragment = replace(fragment, "#include <alphamap_fragment>", "");
  fragment = replace(fragment, "#include <roughnessmap_fragment>", "float roughnessFactor = xfsRoughnessValue;");
  fragment = replace(fragment, "#include <metalnessmap_fragment>", "float metalnessFactor = xfsMetalnessValue;");
  fragment = replace(fragment, "#include <normal_fragment_maps>", "normal = normalize( tbn * xfsTangentNormal );");
  shader.fragmentShader = fragment;
  return shader;
}

export type FaceDecalHandle = { parameters: FaceDecalParameters; underlay: boolean; skinLight: boolean;
  /** Show or flatten the decal's normal map (the viewport's normals toggle). */
  setNormals(enabled: boolean): void };

/**
 * Build one decal chunk's material: blended, no depth writes, front faces only (the engine culls the decal's back faces),
 * and the geometry's own 0.4 mm lift (no extra offset).
 */
export function createFaceDecalMaterial(textures: FaceDecalTextures, parameters: FaceDecalParameters, options: FaceDecalOptions):
  { material: THREE.MeshStandardMaterial; handle: FaceDecalHandle } {
  const material = new THREE.MeshStandardMaterial({ map: textures.diffuse, normalMap: textures.normal, roughness: 1, metalness: 0,
    transparent: true, depthWrite: false, side: THREE.FrontSide });
  const p = parameters;
  const fallback = textures.diffuse;
  const uniforms = {
    xfsSecondaryMask: { value: textures.secondaryMask }, xfsNormalAlphaTex: { value: textures.normalAlpha },
    xfsDecalRoughness: { value: textures.roughness }, xfsDecalMetalness: { value: textures.metalness },
    xfsSecondaryDiffuse: { value: textures.secondaryDiffuse ?? fallback }, xfsDecalGradient: { value: textures.gradient ?? fallback },
    xfsDecalMask: { value: textures.mask ?? fallback },
    xfsDecalColour: { value: new THREE.Vector4(...p.diffuseColor, p.diffuseAlpha) },
    xfsUv: { value: new THREE.Vector4(p.uvOffset[0], p.uvOffset[1], p.uvRotation, 0) },
    xfsUvScale: { value: new THREE.Vector2(...p.uvScale) },
    xfsDecalMisc: { value: new THREE.Vector4(p.contrast, p.secondaryMask.uvScale, p.secondaryMask.influence, p.metalness.scale) },
    xfsDecalNormal: { value: new THREE.Vector4(p.normal.alpha, p.normal.useAlphaTexture ? 1 : 0, p.normal.blendMode, p.metalness.bias) },
    xfsDecalSurface: { value: new THREE.Vector4(p.roughness.scale, p.roughness.bias, 0, p.surfaceAlpha) },
    xfsDecalSecondary: { value: new THREE.Vector4(...p.secondaryColor, p.secondaryIntensity) },
    xfsDecalGradientParams: { value: new THREE.Vector4(p.gradient.use ? 1 : 0, p.gradient.uv, p.gradient.intensity, 0) },
    // The normal map's green sign for Three's tangent frame (as the skin adapter reads it), and the normals toggle.
    xfsDecalView: { value: new THREE.Vector2(-1, 1) },
    ...(options.skinLight ? skinLightUniforms(options.skinLight) : {}),
  };
  material.defines = { ...material.defines, [KIND_DEFINE[p.kind]]: "", ...(options.underlay ? { XFS_GBUFFER_DECAL: "" } : {}) };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    patchFaceDecalShader(shader, { underlay: options.underlay, skinLight: !!options.skinLight });
  };
  material.customProgramCacheKey = () => `xfs-face-decal-2|${p.kind}|${options.underlay ? "u" : ""}|${options.skinLight ? "s" : ""}`;
  material.name = `xfs_face_decal_${p.kind}`;
  return { material, handle: { parameters, underlay: options.underlay, skinLight: !!options.skinLight,
    setNormals(enabled) { uniforms.xfsDecalView.value.y = enabled ? 1 : 0; } } };
}
