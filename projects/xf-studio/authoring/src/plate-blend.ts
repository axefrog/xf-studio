import * as THREE from "three";
import { forwardDecal, gbufferColour, type Rgb } from "./face-decal-material";
import { FRESNEL_EXPONENT, FRESNEL_MAX_INTENSITY } from "./finish-export";
import { FRESNEL_TINT_TERM } from "./fresnel-tint";
import { patchSkinLight, skinLightMapsChunk, skinLightUniforms, type SkinParameters } from "./skin-material";

/**
 * The Studio's authored makeup plate, drawn the way the game draws the exported plate (renderer adapter).
 *
 * What the game does with the export [source: preset-compiler.ts and the decompiled `mesh_decal`; knowledge/materials-and-shaders.md
 * §2.3–2.4]: a preset's exportable layers merge into one decal texture, in square-root colour space, premultiplied, in layer order
 * (`accumulate`), and the colour-map alpha stores √coverage, so the template's squared coverage is the merged coverage again. The
 * decal blends `sqrt(colour)` over the skin's `sqrt(colour)` in the G-buffer at that coverage, roughness and metalness linearly at
 * the same coverage, and (faceted route) its normal at √coverage × the mode-1 fade. The deferred light then shades that one blended
 * surface with the pixel's own lighting class: makeup on skin is lit as skin, once.
 *
 * What the preview does [approximation of a G-buffer in a forward renderer]:
 * 1. **Composite** (plate-composite.ts). Small UV-space passes per change draw the preset's included layers (the export plan's),
 *    in order, as premultiplied "over" over the plate's UV rectangle at the masks' texel density, then resolve the export's merged
 *    decal per texel (√colour, roughness, metalness, coverage and the merged facet normal) and its faceted mip chain: the colour,
 *    metalness and normal chains are the GPU's box means, and the roughness chain is the export's, level by level.
 * 2. **One lit plate.** One plate mesh reads that composite and the skin under each plate vertex (colour, roughness, metalness:
 *    the face decals' underlay, read on the drawn head) and forms the blended G-buffer surface G exactly as the game does. It lights
 *    G with the skin's own light when a resolved skin is drawn (skin-material.ts: the profile's two lobes, the subsurface stand-in,
 *    which metalness above 0.1 skips) and lights the skin under the vertex, S, the same way. It writes colour Y at alpha A with
 *    A·Y + (1 − A)·L(S) = L(G), so over the skin as drawn, L(S_texel), it shows L(G) + (1 − A)·(L(S_texel) − L(S)): the blended
 *    surface's light, plus the skin's own texel detail where the skin still shows. A is the colour solve's alpha
 *    (face-decal-material.ts `forwardDecal`, so colour detail shows through as the square-root blend passes it), raised only where Y
 *    would go negative.
 *
 * Why one plate and not one per layer: lighting is not linear in roughness or metalness, so separately lit layers mixed after
 * lighting differ from one lit blend wherever layers overlap or cover partially (two highlights instead of one in between, and no
 * metalness threshold), and the SSS switch at metalness 0.1 applies to the blended pixel in game.
 *
 * Limits: the skin under the plate is known per vertex (its texel colour detail passes through at 1 − A, exact for black), and the
 * skin's own normal detail under the covered part is replaced by the plate's geometric normal; overlapping face decals below are not
 * part of what the plate sees; Colour-shifting's view-dependent tint is added in the plate shader (one pigment, as the export
 * requires); the colour and metalness are filtered premultiplied, so between texel centres at coverage edges they weigh by coverage
 * where the game filters the stored colour (the composite undoes the mode-1 fade the per-layer preview maps carry, to within their
 * 8-bit steps, so the plate fades once).
 * Preview-only models (Glitter, the earlier Glossy clear coat and thin-film study, and Colour-shifting layers the export omits from a
 * mixed preset) keep their own plates with the ordinary linear blend and light, and are not part of the composite; one between
 * exported layers draws above all of them. The solve is in linear light, so it holds where the pass blends in linear
 * light: both lighting presets draw into the display's scene-linear target (linear-display.ts); on a GPU without a renderable
 * half-float buffer the studio stage draws straight to the canvas and is approximate there.
 */

/** A UV rectangle: the plate's own bounds, which the composite covers. */
export type BlendWindow = { u0: number; v0: number; u1: number; v1: number };
export const FULL_WINDOW: BlendWindow = Object.freeze({ u0: 0, v0: 0, u1: 1, v1: 1 });

/** The UV bounds of a mesh's UVs, padded and clamped to the atlas; the whole atlas when there are none. */
export function plateBlendWindow(uvs: ArrayLike<number> | null | undefined, pad = 0.002): BlendWindow {
  if (!uvs || uvs.length < 2) return FULL_WINDOW;
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (let i = 0; i + 1 < uvs.length; i += 2) {
    const u = uvs[i]!, v = uvs[i + 1]!;
    if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const window = { u0: clamp(u0 - pad), v0: clamp(v0 - pad), u1: clamp(u1 + pad), v1: clamp(v1 + pad) };
  return window.u1 > window.u0 && window.v1 > window.v0 ? window : FULL_WINDOW;
}

/** Texels of the composite: the layer masks' own texel density over the window (masks span the whole atlas). */
export function compositeTargetSize(maskSize: number, window: BlendWindow, maxSize: number): { width: number; height: number } {
  const side = (span: number) => Math.min(maxSize, Math.max(1, Math.ceil(maskSize * span - 1e-9)));
  return { width: side(window.u1 - window.u0), height: side(window.v1 - window.v0) };
}

/** One layer at one texel: its linear colour, coverage (mask alpha, opacity included) and the surface it writes. */
export type PlateTexel = { colour: Readonly<Rgb>; coverage: number; roughness: number; metalness: number };
/** Layers merged at one texel, premultiplied: √colour, roughness and metalness times coverage, and the coverage. */
export type PlateComposite = { sqrtColour: Rgb; roughness: number; metalness: number; coverage: number };
export const EMPTY_COMPOSITE: Readonly<PlateComposite> = Object.freeze({ sqrtColour: [0, 0, 0] as Rgb, roughness: 0, metalness: 0, coverage: 0 });
export type PlateSkin = { colour: Readonly<Rgb>; roughness: number; metalness: number };
/** One G-buffer pixel's surface: linear base colour, roughness and metalness. */
export type PlateSurface = { colour: Rgb; roughness: number; metalness: number };

/** The composite pass's arithmetic: premultiplied "over" in square-root colour space (preset-compiler.ts `accumulate`). */
export function accumulateComposite(below: Readonly<PlateComposite>, layer: PlateTexel): PlateComposite {
  const a = Math.min(1, Math.max(0, layer.coverage)), keep = 1 - a;
  return { sqrtColour: layer.colour.map((c, k) => a * Math.sqrt(Math.max(c, 0)) + keep * below.sqrtColour[k]!) as Rgb,
    roughness: a * layer.roughness + keep * below.roughness, metalness: a * layer.metalness + keep * below.metalness,
    coverage: a + keep * below.coverage };
}

/** The merged decal's own colour (linear), as the export stores it: (premultiplied √colour / coverage)². */
const decalColour = (composite: Readonly<PlateComposite>): Rgb =>
  composite.sqrtColour.map(s => composite.coverage > 0 ? (s / composite.coverage) ** 2 : 0) as Rgb;

/** The G-buffer surface after the merged decal blends over the skin: √-space colour, linear roughness and metalness. */
export function plateSurface(skin: PlateSkin, composite: Readonly<PlateComposite>): PlateSurface {
  const keep = 1 - composite.coverage;
  return { colour: gbufferColour(decalColour(composite), composite.coverage, skin.colour),
    roughness: composite.roughness + keep * skin.roughness, metalness: composite.metalness + keep * skin.metalness };
}

/** The plate's drawn alpha before lighting: the colour solve's (at least the coverage; exact per channel for the colour detail). */
export const plateDrawnAlpha = (skin: PlateSkin, composite: Readonly<PlateComposite>) =>
  forwardDecal(decalColour(composite), composite.coverage, skin.colour).alpha;

/**
 * What the plate writes over the lit skin: `lit` is the blended surface's light L(G), `under` the skin's light at the vertex L(S).
 * Returns Y and A with A·Y + (1 − A)·L(S) = L(G) (the alpha raised from `alpha` only where Y would be negative).
 */
export function residualForward(lit: Readonly<Rgb>, under: Readonly<Rgb>, alpha: number): { colour: Rgb; alpha: number } {
  let a = Math.min(1, Math.max(0, alpha));
  for (let k = 0; k < 3; k++) if (under[k]! >= lit[k]! && under[k]! > 1e-6) a = Math.max(a, 1 - lit[k]! / under[k]!);
  a = Math.min(1, a);
  if (a <= 0) return { colour: [0, 0, 0], alpha: 0 };
  return { colour: lit.map((l, k) => Math.max(0, (l - (1 - a) * under[k]!) / a)) as Rgb, alpha: a };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The facets the composite reads (the GPU pass is plate-composite.ts).

const blankTexture = (rgba: number[]) => {
  const texture = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
  texture.needsUpdate = true;
  return texture;
};
/** Nothing (all zero) and a flat normal. Shared, never disposed. */
const NOTHING = blankTexture([0, 0, 0, 0]), FLAT_NORMAL = blankTexture([128, 128, 255, 255]);

/** Tilt (length of the facet's X, Y) from which `NormalsBlendingMode` 1 keeps a facet whole: saturate(50 − 50z) = 1 at z = 0.98. */
export const MODE1_FULL_TILT = Math.sqrt(1 - 0.98 * 0.98);
/** Components within this of zero are the tangent-normal encoding's zero (bytes 127 and 128 decode to ∓0.0039). */
export const FACET_ZERO = 0.005;
const mode1Fade = (t: number) => Math.min(1, Math.max(0, 50 - 50 * Math.sqrt(Math.max(0, 1 - t * t))));

/**
 * Undo the mode-1 fade the preview's facet maps carry (route-mip-chains.ts `previewFacetChains` stores X, Y × saturate(50 − 50z)),
 * so the plate fades the filtered merged normal once, as the game does. The fade is monotonic in the tilt, so the tilt is found by
 * bisection; tilts past `MODE1_FULL_TILT` were never faded. Mirrors the composite pass's `xfsUnfade` (plate-composite.ts).
 */
export function unfadeFacet(x: number, y: number): [number, number] {
  if (Math.abs(x) < FACET_ZERO) x = 0;
  if (Math.abs(y) < FACET_ZERO) y = 0;
  const t = Math.hypot(x, y);
  if (t <= 0 || t >= MODE1_FULL_TILT) return [x, y];
  let lo = t, hi = MODE1_FULL_TILT;
  for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (mid * mode1Fade(mid) < t) lo = mid; else hi = mid; }
  const scale = (lo + hi) / 2 / t;
  return [x * scale, y * scale];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The one lit plate.

const VERTEX_DECLARATIONS = /* glsl */`
attribute vec3 xfsUnderlay;
attribute float xfsUnderRoughness;
attribute float xfsUnderMetalness;
varying vec3 vXfsPlateUnder;
varying vec2 vXfsPlateSurface;
varying vec2 vXfsPlateUv;`;
const VERTEX_BODY = /* glsl */`
vXfsPlateUnder = xfsUnderlay;
vXfsPlateSurface = vec2( xfsUnderRoughness, xfsUnderMetalness );
vXfsPlateUv = uv;`;
const FRAGMENT_DECLARATIONS = /* glsl */`
uniform sampler2D xfsPlateColour;
uniform sampler2D xfsPlateSurface;
uniform sampler2D xfsPlateNormal;
uniform sampler2D xfsPlateRoughness;
uniform vec4 xfsPlateWindow;
uniform float xfsPlateNormals;
#ifdef XFS_PLATE_FRESNEL
uniform vec3 xfsShiftColor;
uniform float xfsShiftIntensity;
uniform float xfsShiftExponent;
#endif
varying vec3 vXfsPlateUnder;
varying vec2 vXfsPlateSurface;
varying vec2 vXfsPlateUv;`;
/** Replaces `map_fragment`: the merged decal at this pixel (colour unpremultiplied; the normal is stored per texel), and the skin under it. */
const SAMPLE = /* glsl */`
vec2 xfsCompositeUv = ( vXfsPlateUv - xfsPlateWindow.xy ) * xfsPlateWindow.zw;
vec4 xfsPc = texture2D( xfsPlateColour, xfsCompositeUv );
vec4 xfsPs = texture2D( xfsPlateSurface, xfsCompositeUv );
vec4 xfsPn = texture2D( xfsPlateNormal, xfsCompositeUv );
float xfsPr = texture2D( xfsPlateRoughness, xfsCompositeUv ).r;
float xfsCoverage = clamp( xfsPc.a, 0.0, 1.0 );
if ( xfsCoverage < 0.001 ) discard;
float xfsInv = 1.0 / xfsCoverage;
vec3 xfsSqrtDecal = max( xfsPc.rgb * xfsInv, vec3( 0.0 ) );
vec3 xfsDecal = xfsSqrtDecal * xfsSqrtDecal;
vec2 xfsFacetXy = clamp( xfsPn.xy, 0.0, 1.0 ) * 2.0 - 1.0;
vec3 xfsUnder = max( vXfsPlateUnder, vec3( 0.0 ) );`;
/**
 * Replaces `roughnessmap_fragment`: the G-buffer's roughness, the decal's at its coverage over the skin's. The decal's roughness is
 * the export's own chain (plate-composite.ts): level 0 as merged, lower levels widened by the facet variance their averaging lost,
 * sampled as the game samples the exported map.
 */
const ROUGHNESS = /* glsl */`
float xfsDecalRough = clamp( xfsPr, 0.0, 1.0 );
float roughnessFactor = xfsCoverage * xfsDecalRough + ( 1.0 - xfsCoverage ) * vXfsPlateSurface.x;`;
const METALNESS = /* glsl */`
float metalnessFactor = xfsCoverage * clamp( xfsPs.y * xfsInv, 0.0, 1.0 ) + ( 1.0 - xfsCoverage ) * vXfsPlateSurface.y;`;
/** Replaces `normal_fragment_maps`: `NormalsBlendingMode` 1 writes the facet at √coverage × saturate(50 − 50z); flat texels write nothing. */
const NORMAL = /* glsl */`
vec3 xfsFacet = vec3( xfsFacetXy, sqrt( max( 1.0 - dot( xfsFacetXy, xfsFacetXy ), 0.0 ) ) );
float xfsNormalAlpha = sqrt( xfsCoverage ) * clamp( 50.0 - 50.0 * xfsFacet.z, 0.0, 1.0 ) * xfsPlateNormals;
normal = normalize( tbn * normalize( mix( vec3( 0.0, 0.0, 1.0 ), xfsFacet, xfsNormalAlpha ) ) );`;
/** Before the lighting: the blended colour, the drawn alpha, and the skin under the vertex lit the same way (`MAPS` is filled in). */
const BLEND = /* glsl */`
#ifdef XFS_PLATE_FRESNEL
xfsDecal += ${FRESNEL_TINT_TERM};
xfsSqrtDecal = sqrt( max( xfsDecal, vec3( 0.0 ) ) );
#endif
vec3 xfsRoot = xfsCoverage * xfsSqrtDecal + ( 1.0 - xfsCoverage ) * sqrt( xfsUnder );
vec3 xfsBlended = xfsRoot * xfsRoot;
vec3 xfsGap = xfsUnder - xfsDecal;
vec3 xfsNeeded = mix( vec3( 0.0 ), ( xfsUnder - xfsBlended ) / max( xfsGap, vec3( 1e-6 ) ), step( vec3( 1e-6 ), xfsGap ) );
diffuseColor = vec4( xfsBlended, clamp( max( max( xfsCoverage, xfsNormalAlpha ), max( xfsNeeded.r, max( xfsNeeded.g, xfsNeeded.b ) ) ), 0.0, 1.0 ) );
vec3 xfsUnderLight = vec3( 0.0 );
{
	vec4 diffuseColor = vec4( xfsUnder, 1.0 );
	float roughnessFactor = vXfsPlateSurface.x;
	float metalnessFactor = vXfsPlateSurface.y;
	vec3 normal = nonPerturbedNormal;
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	MAPS
	#include <lights_fragment_end>
	xfsUnderLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular;
}
#include <lights_physical_fragment>`;
/** Before the output: Y and A so that A·Y + (1 − A)·L(skin) = L(blended surface) (`residualForward`). */
const RESIDUAL = /* glsl */`
{
	vec3 xfsRaise = mix( vec3( 0.0 ), 1.0 - outgoingLight / max( xfsUnderLight, vec3( 1e-6 ) ),
		step( outgoingLight, xfsUnderLight ) * step( vec3( 1e-6 ), xfsUnderLight ) );
	float xfsAlpha = clamp( max( diffuseColor.a, max( xfsRaise.r, max( xfsRaise.g, xfsRaise.b ) ) ), 0.0, 1.0 );
	if ( xfsAlpha < 0.001 ) discard;
	outgoingLight = max( ( outgoingLight - ( 1.0 - xfsAlpha ) * xfsUnderLight ) / xfsAlpha, vec3( 0.0 ) );
	diffuseColor.a = xfsAlpha;
}
#include <opaque_fragment>`;

/**
 * Patch a `MeshStandardMaterial` program into the plate's single lit pass. `skinLight` lights with the skin light (both the
 * blended surface and the skin under it); otherwise Three's standard light. Throws when this Three.js build lacks a chunk.
 */
export function patchPlateLightShader(shader: { vertexShader: string; fragmentShader: string }, options: { skinLight: boolean },
  chunks: Record<string, string> = THREE.ShaderChunk as unknown as Record<string, string>) {
  const replace = (source: string, find: string, by: string) => {
    if (source.split(find).length !== 2) throw Error(`The makeup plate expects ${find} once in this Three.js build.`);
    return source.replace(find, by);
  };
  shader.vertexShader = replace(shader.vertexShader, "#include <common>", `#include <common>\n${VERTEX_DECLARATIONS}`);
  shader.vertexShader = replace(shader.vertexShader, "#include <begin_vertex>", `#include <begin_vertex>\n${VERTEX_BODY}`);
  let fragment = shader.fragmentShader;
  fragment = replace(fragment, "#include <common>", `#include <common>\n${FRAGMENT_DECLARATIONS}`);
  // The main light's image-based chunk is replaced here, before the skin's own copy below is added.
  if (options.skinLight) fragment = patchSkinLight(fragment, chunks, "makeup plate");
  fragment = replace(fragment, "#include <map_fragment>", SAMPLE);
  fragment = replace(fragment, "#include <roughnessmap_fragment>", ROUGHNESS);
  fragment = replace(fragment, "#include <metalnessmap_fragment>", METALNESS);
  fragment = replace(fragment, "#include <normal_fragment_maps>", NORMAL);
  fragment = replace(fragment, "#include <lights_physical_fragment>",
    BLEND.replace("MAPS", options.skinLight ? skinLightMapsChunk(chunks, "makeup plate") : "#include <lights_fragment_maps>"));
  fragment = replace(fragment, "#include <opaque_fragment>", RESIDUAL);
  shader.fragmentShader = fragment;
  return shader;
}

/** What the plate samples from the composite (plate-composite.ts `CompositeTextures`). */
export type PlateCompositeTextures = { colour: THREE.Texture; surface: THREE.Texture; normal: THREE.Texture; roughness: THREE.Texture };

export type PlateLightHandle = {
  /** Read this composite (plate-composite.ts `createPlateComposite`) over `window`; null draws nothing. */
  setComposite(textures: PlateCompositeTextures | null, window: BlendWindow): void;
  /** Light with the skin's own light (the drawn skin's profile) or, with null, Three's standard light. Recompiles on a change. */
  setSkinLight(parameters: Pick<SkinParameters, "lobes" | "wrap"> | null): void;
  readonly skinLight: boolean;
  /** Colour-shifting (the Fresnel route's one pigment): the shift colour (sRGB hex) and strength 0–1, or null. */
  setFresnel(shift: { color: string; strength: number } | null): void;
  readonly fresnel: boolean;
  /** Show or flatten the facet normals (the viewport's normals toggle). */
  setNormals(enabled: boolean): void;
};

/**
 * The plate's single lit material: blended over the skin, no depth writes, both sides (as the per-layer plates), and no map of its
 * own (it reads the composite). Install `extendSkin` on it afterwards, as for every plate.
 */
export function createPlateLightMaterial(): { material: THREE.MeshStandardMaterial; handle: PlateLightHandle } {
  // The normal map only switches on Three's tangent frame; the shader reads the composite's normals itself.
  const material = new THREE.MeshStandardMaterial({ normalMap: FLAT_NORMAL, roughness: 1, metalness: 0, transparent: true,
    depthWrite: false, side: THREE.DoubleSide });
  material.name = "xfs_makeup_plate";
  const uniforms = {
    xfsPlateColour: { value: NOTHING as THREE.Texture }, xfsPlateSurface: { value: NOTHING as THREE.Texture },
    xfsPlateNormal: { value: NOTHING as THREE.Texture }, xfsPlateRoughness: { value: NOTHING as THREE.Texture },
    xfsPlateWindow: { value: new THREE.Vector4(0, 0, 1, 1) },
    xfsPlateNormals: { value: 1 },
    xfsShiftColor: { value: new THREE.Color() }, xfsShiftIntensity: { value: 0 }, xfsShiftExponent: { value: FRESNEL_EXPONENT },
    ...skinLightUniforms({ lobes: { roughness0: 1, roughness1: 1, weight: 1 }, wrap: [0, 0, 0] }),
  };
  let skinLight = false, fresnel = false;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    patchPlateLightShader(shader, { skinLight });
  };
  material.customProgramCacheKey = () => `xfs-plate-light-2|${skinLight ? "s" : ""}`;
  const define = (name: string, on: boolean) => {
    const defines = { ...material.defines };
    if (on) defines[name] = ""; else delete defines[name];
    material.defines = defines;
  };
  return { material, handle: {
    setComposite(textures, window) {
      uniforms.xfsPlateColour.value = textures?.colour ?? NOTHING;
      uniforms.xfsPlateSurface.value = textures?.surface ?? NOTHING;
      uniforms.xfsPlateNormal.value = textures?.normal ?? NOTHING;
      uniforms.xfsPlateRoughness.value = textures?.roughness ?? NOTHING;
      uniforms.xfsPlateWindow.value.set(window.u0, window.v0, 1 / (window.u1 - window.u0), 1 / (window.v1 - window.v0));
    },
    get skinLight() { return skinLight; },
    setSkinLight(parameters) {
      if (parameters) {
        uniforms.xfsLobes.value.set(parameters.lobes.roughness0, parameters.lobes.roughness1, parameters.lobes.weight);
        uniforms.xfsWrap.value.set(...parameters.wrap);
      }
      if (!!parameters === skinLight) return;
      skinLight = !!parameters;
      material.needsUpdate = true;
    },
    get fresnel() { return fresnel; },
    setFresnel(shift) {
      if (shift) {
        uniforms.xfsShiftColor.value.set(shift.color); // Three converts the sRGB hex to linear working colour, as the per-layer tint.
        uniforms.xfsShiftIntensity.value = FRESNEL_MAX_INTENSITY * shift.strength;
      }
      if (!!shift === fresnel) return;
      fresnel = !!shift;
      define("XFS_PLATE_FRESNEL", fresnel);
      material.needsUpdate = true;
    },
    setNormals(enabled) { uniforms.xfsPlateNormals.value = enabled ? 1 : 0; },
  } };
}
