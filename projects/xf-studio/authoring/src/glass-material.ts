import * as THREE from "three";

/**
 * The engine's one-sided glass, `base\materials\glass_onesided.mt` (template name `glass_onesided`): the Gorilla Arms' glass window, and
 * any garment or accessory pane, for the browser renderer. Nothing here knows which part or mod a chunk came from.
 *
 * What the game does [source: decompiled 2.31 `transparent` program `4256218839974653439`; research/materials/shader-metal-glass.md §4.3]:
 * the glass is drawn after the deferred light as `out = radiance + background × T` (dual-source blend), with the per-channel
 * transmittance
 * - `tint = GlassTint.rgb · TintColor.rgb` (`TintFromVertexPaint` 0 in every character instance read),
 * - `f = saturate((1 − saturate(n·V)) · 1.25) ^ p`, `p = 0.5 + b + saturate(fb − 1)·(3.5 − b)`, `b = saturate(fb)`, `fb = FresnelBias`,
 * - `tint′ = lerp(tint, 0.75 · saturate(tint)^1.5, f)` (darker and more saturated at grazing angles),
 * - `T = lerp(1, tint′ · (1 − w), Opacity)`, `w = MaskOpacity · Mask.a` (the opaque "dirt" layer; 0 by default).
 *
 * This adapter is the reference's rank 3 (§7): the **transmission pass** alone, a forward pass after the opaque parts that multiplies what
 * is behind the pane by `T` (blend `Zero/SrcColor`, depth tested, no depth write, back faces culled as the template's `CULL_Back`). For the
 * Gorilla Arms pane that is the whole look but its distortion: its `GlassSpecularColor` is black, so it reflects nothing [resource].
 * Not drawn [hypothesis for their effect on the creator's look]: the reflection (sun-only GGX and the environment through Karis's analytic
 * BRDF, rank 4: a pane with a non-black `GlassSpecularColor` says so in its notes), the mask layer's own diffuse and reflection, the
 * distortion and blur (rank 5), and the normal map's effect on the grazing term (the geometric normal is used).
 */
export type GlassParameters = {
  /** `TintColor` in the program's units (linear: `Color` parameters arrive sRGB-decoded). */
  tint: [number, number, number];
  opacity: number; fresnelBias: number; maskOpacity: number;
  /** `GlassSpecularColor` (linear): black means the pane reflects nothing. */
  specular: [number, number, number];
  /** `GlassTintTileAndOffset` (x, y scale; z, w offset) [hypothesis: the order the vertex program applies them]. */
  tintTileOffset: [number, number, number, number];
};
export type GlassTextures = { glassTint?: THREE.Texture; mask?: THREE.Texture };

const saturate = (value: number) => Math.min(1, Math.max(0, value));
const srgbToLinear = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
type Rgba = readonly number[];
const linear = (bytes: Rgba | undefined, fallback: [number, number, number]): [number, number, number] =>
  bytes ? [0, 1, 2].map(k => srgbToLinear((bytes[k] ?? 0) / 255)) as [number, number, number] : fallback.map(v => srgbToLinear(v / 255)) as [number, number, number];

/** The adapter's parameters from a chunk's effective scalars and colours (the instance chain, then the template's defaults). */
export function glassParameters(scalars: Readonly<Record<string, number>>, colours: Readonly<Record<string, Rgba>>): GlassParameters {
  const scalar = (name: string, fallback: number) => Number.isFinite(scalars[name]) ? scalars[name]! : fallback;
  return {
    tint: linear(colours.TintColor, [229, 229, 229]), specular: linear(colours.GlassSpecularColor, [255, 255, 255]),
    opacity: saturate(scalar("Opacity", 1)), fresnelBias: scalar("FresnelBias", 1), maskOpacity: saturate(scalar("MaskOpacity", 0)),
    tintTileOffset: [scalar("GlassTintTileAndOffset.x", 1), scalar("GlassTintTileAndOffset.y", 1), scalar("GlassTintTileAndOffset.z", 0),
      scalar("GlassTintTileAndOffset.w", 0)],
  };
}

/** The grazing exponent `p` for a `FresnelBias`. */
export const glassGrazingPower = (fresnelBias: number) => {
  const b = saturate(fresnelBias);
  return 0.5 + b + saturate(fresnelBias - 1) * (3.5 - b);
};

/**
 * The per-channel transmittance (CPU reference of `GLASS_T`, used by the tests): the pane's tint (`GlassTint` sample × `TintColor`), the
 * cosine between the normal and the view direction, and the mask's alpha (0 without a mask layer).
 */
export function glassTransmittance(tint: readonly number[], nDotV: number, p: Pick<GlassParameters, "opacity" | "fresnelBias" | "maskOpacity">,
  maskAlpha = 0): [number, number, number] {
  const f = saturate((1 - saturate(nDotV)) * 1.25) ** glassGrazingPower(p.fresnelBias);
  const w = p.maskOpacity * maskAlpha;
  return [0, 1, 2].map(k => {
    const t = tint[k]!, grazing = 0.75 * saturate(t) ** 1.5, shifted = t + (grazing - t) * f;
    return 1 + (shifted * (1 - w) - 1) * p.opacity;
  }) as [number, number, number];
}

const DECLARATIONS = /* glsl */`
uniform vec3 xfsGlassTint;
uniform vec4 xfsGlassParams; // opacity, grazing power, mask opacity, (unused)
uniform vec4 xfsGlassTileOffset;
#ifdef XFS_GLASS_TINT_MAP
uniform sampler2D xfsGlassTintMap;
#endif
#ifdef XFS_GLASS_MASK
uniform sampler2D xfsGlassMask;
#endif`;
/** The transmittance, written as the fragment's colour last (after tone mapping and colour space: `T` multiplies the linear target). */
const GLASS_T = /* glsl */`
{
  vec3 xfsTint = xfsGlassTint;
#ifdef XFS_GLASS_TINT_MAP
  xfsTint *= texture2D( xfsGlassTintMap, vXfsGlassUv * xfsGlassTileOffset.xy + xfsGlassTileOffset.zw ).rgb;
#endif
  float xfsW = 0.0;
#ifdef XFS_GLASS_MASK
  xfsW = xfsGlassParams.z * texture2D( xfsGlassMask, vXfsGlassUv ).a;
#endif
  vec3 xfsN = normalize( vNormal );
  float xfsF = pow( clamp( ( 1.0 - clamp( dot( xfsN, normalize( vViewPosition ) ), 0.0, 1.0 ) ) * 1.25, 0.0, 1.0 ), xfsGlassParams.y );
  vec3 xfsShifted = mix( xfsTint, 0.75 * pow( clamp( xfsTint, 0.0, 1.0 ), vec3( 1.5 ) ), xfsF );
  gl_FragColor = vec4( mix( vec3( 1.0 ), xfsShifted * ( 1.0 - xfsW ), xfsGlassParams.x ), 1.0 );
}`;

const replaceChunk = (source: string, find: string, by: string) => {
  if (!source.includes(find)) throw Error(`The glass shader expects ${find} in this Three.js build.`);
  return source.replace(find, by);
};

/** Patch a lit `MeshStandardMaterial` program so its output is the glass's transmittance; throws when this Three.js build lacks a chunk. */
export function patchGlassShader(shader: { fragmentShader: string; vertexShader: string }) {
  shader.fragmentShader = replaceChunk(replaceChunk(shader.fragmentShader, "#include <common>", `#include <common>\n${DECLARATIONS}`),
    "#include <dithering_fragment>", `#include <dithering_fragment>\n${GLASS_T}`);
  // The UV the tint and mask read: Three declares its UV varyings only with a map, so the pane carries its own.
  shader.vertexShader = replaceChunk(replaceChunk(shader.vertexShader, "#include <common>", "#include <common>\nvarying vec2 vXfsGlassUv;"),
    "#include <uv_vertex>", "#include <uv_vertex>\nvXfsGlassUv = uv;");
  shader.fragmentShader = replaceChunk(shader.fragmentShader, "#include <common>", "#include <common>\nvarying vec2 vXfsGlassUv;");
  return shader;
}

/**
 * Build the transmission pass's material: multiplies what is behind it by `T` (the destination is the scene's linear target), front faces
 * only, depth tested without writing, drawn after the opaque parts. Casts no shadow (a pane in game is not in the cascades' opaque pass
 * either [hypothesis]).
 */
export function createGlassMaterial(textures: GlassTextures, parameters: GlassParameters): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ side: THREE.FrontSide, transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
  const uniforms = {
    xfsGlassTint: { value: new THREE.Vector3(...parameters.tint) },
    xfsGlassParams: { value: new THREE.Vector4(parameters.opacity, glassGrazingPower(parameters.fresnelBias), parameters.maskOpacity, 0) },
    xfsGlassTileOffset: { value: new THREE.Vector4(...parameters.tintTileOffset) },
    ...(textures.glassTint ? { xfsGlassTintMap: { value: textures.glassTint } } : {}),
    ...(textures.mask ? { xfsGlassMask: { value: textures.mask } } : {}),
  };
  material.defines = { ...(textures.glassTint ? { XFS_GLASS_TINT_MAP: "" } : {}), ...(textures.mask && parameters.maskOpacity > 0 ? { XFS_GLASS_MASK: "" } : {}) };
  material.onBeforeCompile = shader => {
    Object.assign((shader as unknown as { uniforms: Record<string, unknown> }).uniforms, uniforms);
    patchGlassShader(shader);
  };
  material.customProgramCacheKey = () => `xfs-glass-onesided-1|${Object.keys(material.defines ?? {}).join(",")}`;
  material.name = "xfs_glass_onesided";
  return material;
}
