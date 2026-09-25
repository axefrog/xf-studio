/**
 * The game's eye materials for the browser renderer (knowledge/eye-rendering.md): the eyeball of `eye.mt` and
 * `eye_gradient.mt`, and the wetness shell of `eye_shadow.mt`. Both follow the decompiled 2.31 programs where the
 * preview implements them; nothing here names a mod, a colour choice or a texture file.
 *
 * Eyeball, surface (§2.2) [source]:
 * - colour, normal and mask are sampled at `uvC = (fold(u), 1 − v)`, V-flipped relative to the mesh's raw UV0;
 *   roughness is sampled at the raw UV (neither folded nor flipped; the sampler repeats);
 * - `eye_gradient.mt`: base colour `lerp(Albedo(uvC), Gradient(IrisMask(uvC).R), IrisMask(uvC).A)`, with the ramp
 *   baked from the resolved `CGradient` stops (8-bit stops interpolated, stored as sRGB so the sampler decodes them,
 *   the hair-profile model) [bake: hypothesis];
 * - the mask's R is read raw by default (`IRIS_MASK_ENCODING`); in-game test ask 9 settles raw against decoded (§2.3);
 * - roughness `RoughnessScale · Roughness.R`, metalness `saturate(Specularity)`.
 * Not yet (ranks 4–5): the refracted iris coordinate (`uvC` inside the iris is the mesh coordinate here), the cornea
 * and iris normals and the Eye-class light. The eyeball keeps the preview's standard lighting, with the roughness
 * either flat (the preview's earlier value) or the source map (the "source eye roughness" switch). `EYE_SURFACE`
 * computes the fold, the side and `uvC` in one place so those ranks slot in there and in `RE_Direct`.
 *
 * Wetness shell (§4) [source]: a forward pass after the opaque eye, skin and makeup, blending `out.rgb + dst·alpha`
 * with `alpha = saturate(1 + shadow·(lum − 1))`, `shadow = saturate(Intensity·R^Exponent)`, `lum` the mean of the
 * decoded `ShadowColor`, and a GGX highlight at roughness `clamp(WetnessRoughness·G, 0.04, 1)` on the vertex normal,
 * with the eye's visibility term, no Fresnel, no N·L and no environment, scaled by `WetnessStrength·B`. The blend is
 * exact only in the creator display's scene-linear target; drawn straight to the canvas it multiplies tone-mapped
 * colour (close for the darkening, slightly off for the highlight) [hypothesis about the visible error].
 */
import * as THREE from "three";
import type { RenderChunkMaterial, RenderGradientStop } from "./render-detail";

/** How the iris mask's R reaches the gradient lookup: raw bytes (default) or sRGB-decoded like other gamma textures. */
export type IrisMaskEncoding = "raw" | "decoded";
/** Internal switch until in-game test ask 9 settles it (knowledge/eye-rendering.md §2.3). */
export const IRIS_MASK_ENCODING: IrisMaskEncoding = "raw";
/** The preview's flat eye roughness when the source roughness is off (its earlier look). */
export const EYE_FLAT_ROUGHNESS = 0.18;
/** Ramp width for a baked `CGradient` (texels at their centres, linear filtering between them). */
export const GRADIENT_RAMP_SIZE = 256;

/** `eye.mt` / `eye_gradient.mt` 2.31 template defaults the preview reads [resource]; the record normally carries them already. */
export const EYE_TEMPLATE_DEFAULTS = Object.freeze({
  RoughnessScale: 0.493420988, Specularity: 0,
  // Optics for ranks 4–5 (refraction, cornea bulge, per-eye axis), carried now so the adapter needs no new inputs later.
  RefractionIndex: 0.970000029, RefractionAmount: 1, IrisSize: 0.737374008, EyeRadius: 0.0152000003, EyeParallaxPlane: 0.0133999996,
  EyeHorizAngleRight: 5, EyeHorizAngleLeft: -5, BubbleNormalTile: 0.631313026, EggFullRadius: 1, EggMarginExponent: 1,
  EggMarginFactor: 0.400000006, EggSubFactor: 0.200000003, IrisCoordFactor: 0.164983004, IrisCoordMargin: 0.0202019997,
});
/** `eye_shadow.mt` 2.31 template defaults [resource]. */
export const SHELL_TEMPLATE_DEFAULTS = Object.freeze({ Intensity: 1, Exponent: 2.20000005, WetnessRoughness: 1, WetnessStrength: 4 });
const SHELL_DEFAULT_COLOUR: readonly number[] = [255, 0, 0, 233];

export type EyeParameters = {
  roughnessScale: number;
  /** `saturate(Specularity)`, the metalness slot. */
  metalness: number;
  /** The optics scalars (effective values), unused until ranks 4–5. */
  optics: Record<Exclude<keyof typeof EYE_TEMPLATE_DEFAULTS, "RoughnessScale" | "Specularity">, number>;
};
export type ShellParameters = { intensity: number; exponent: number; shadowColor: [number, number, number];
  /** `dot(pow(ShadowColor/255, 2.2), 0.33)`: only the colour's mean reaches the program. */
  luminance: number; wetnessRoughness: number; wetnessStrength: number };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const srgbToLinear = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
function scalars<T extends Record<string, number>>(chunk: Pick<RenderChunkMaterial, "scalars">, defaults: T): T {
  return Object.fromEntries(Object.entries(defaults).map(([name, fallback]) => {
    const value = chunk.scalars[name];
    return [name, typeof value === "number" && Number.isFinite(value) ? value : fallback];
  })) as T;
}

export function eyeParameters(chunk: Pick<RenderChunkMaterial, "scalars">): EyeParameters {
  const { RoughnessScale, Specularity, ...optics } = scalars(chunk, EYE_TEMPLATE_DEFAULTS);
  return { roughnessScale: Math.max(0, RoughnessScale), metalness: clamp01(Specularity), optics };
}

export function shellLuminance(colour: readonly number[]): number {
  return [0, 1, 2].reduce((sum, k) => sum + ((colour[k] ?? 0) / 255) ** 2.2, 0) * 0.33;
}

export function shellParameters(chunk: Pick<RenderChunkMaterial, "scalars" | "colours">): ShellParameters {
  const values = scalars(chunk, SHELL_TEMPLATE_DEFAULTS);
  const colour = chunk.colours.ShadowColor ?? SHELL_DEFAULT_COLOUR;
  return { intensity: values.Intensity, exponent: values.Exponent, shadowColor: [colour[0]!, colour[1]!, colour[2]!],
    luminance: shellLuminance(colour), wetnessRoughness: values.WetnessRoughness, wetnessStrength: values.WetnessStrength };
}

/** What the shell multiplies the pixels behind it by, for a mask R in 0–1 (no fog). */
export function shellAlpha(maskR: number, p: Pick<ShellParameters, "intensity" | "exponent" | "luminance">): number {
  const shadow = clamp01(p.intensity * Math.max(0, maskR) ** p.exponent);
  return clamp01(1 + shadow * (p.luminance - 1));
}
/** The shell's wet roughness for a mask G in 0–1. */
export const shellRoughness = (maskG: number, p: Pick<ShellParameters, "wetnessRoughness">) => Math.min(1, Math.max(0.04, p.wetnessRoughness * maskG));
/** The shell's highlight for one light: GGX D times the eye's visibility, no Fresnel and no N·L (the shader's `RE_Direct`). */
export function shellSpecular(dotNH: number, dotNV: number, dotNL: number, roughness: number): number {
  const a = roughness * roughness, a2 = a * a, d = dotNH * dotNH * (a2 - 1) + 1;
  return (a2 / (Math.PI * d * d)) * (0.25 / ((Math.max(0, dotNV) + Math.max(0, dotNL)) * (1 - a / 2) + a));
}

/**
 * The eye program's sampling rule for one raw UV0: which eye's parameters apply (raw U > 0 → "right"), the colour,
 * normal and mask coordinate (folded U, flipped V) and the roughness coordinate (the raw UV itself).
 */
export function eyeSampleCoordinates(u: number, v: number): { side: "right" | "left"; colour: [number, number]; roughness: [number, number] } {
  const right = u > 0;
  return { side: right ? "right" : "left", colour: [u + (right ? -1 : 1), 1 - v], roughness: [u, v] };
}

/** A `CGradient`'s 8-bit colour at `t`: linear between the stops around it, clamped to the end stops (stops sorted by value). */
export function gradientColourAt(stops: readonly RenderGradientStop[], t: number): [number, number, number, number] {
  if (!stops.length) return [0, 0, 0, 255];
  const first = stops[0]!, last = stops[stops.length - 1]!;
  if (t <= first.value) return [...first.color];
  if (t >= last.value) return [...last.color];
  const next = stops.findIndex(stop => stop.value >= t);
  const a = stops[next - 1]!, b = stops[next]!, span = b.value - a.value;
  const f = span > 0 ? (t - a.value) / span : 1;
  return [0, 1, 2, 3].map(k => a.color[k]! + (b.color[k]! - a.color[k]!) * f) as [number, number, number, number];
}

/** The baked ramp: RGBA bytes, texel `i` holding the gradient at its centre `(i + 0.5) / size`. */
export function bakeGradientRamp(stops: readonly RenderGradientStop[], size = GRADIENT_RAMP_SIZE): Uint8Array {
  const out = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const colour = gradientColourAt(stops, (i + 0.5) / size);
    for (let k = 0; k < 4; k++) out[i * 4 + k] = Math.round(Math.min(255, Math.max(0, colour[k]!)));
  }
  return out;
}

/** The gradient coordinate from the mask's stored R (0–1) under an encoding. */
export const irisCoordinate = (maskR: number, encoding: IrisMaskEncoding = IRIS_MASK_ENCODING) =>
  encoding === "raw" ? clamp01(maskR) : srgbToLinear(clamp01(maskR));

/**
 * The linear base colour of one `eye_gradient.mt` texel: the (linear) albedo, the ramp at the mask's R, blended by
 * the mask's A. Mirrors the shader and its baked ramp.
 */
export function irisBaseColour(albedo: readonly number[], maskR: number, maskA: number, stops: readonly RenderGradientStop[],
  encoding: IrisMaskEncoding = IRIS_MASK_ENCODING): [number, number, number] {
  const ramp = gradientColourAt(stops, irisCoordinate(maskR, encoding));
  return [0, 1, 2].map(k => {
    const g = srgbToLinear(ramp[k]! / 255);
    return albedo[k]! + (g - albedo[k]!) * clamp01(maskA);
  }) as [number, number, number];
}

/** The ramp as a texture the sampler decodes from sRGB, linear filtering, clamped at the ends. */
export function gradientTexture(stops: readonly RenderGradientStop[]): THREE.DataTexture {
  const texture = new THREE.DataTexture(bakeGradientRamp(stops), GRADIENT_RAMP_SIZE, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.name = "xfs_iris_gradient";
  texture.needsUpdate = true;
  return texture;
}

export type EyeballHandle = {
  readonly role: "eyeball";
  readonly parameters: EyeParameters;
  /** Whether the iris colour comes from a gradient ramp (`eye_gradient.mt`). */
  readonly gradient: boolean;
  /** Whether a source roughness map is bound (the switch has no effect without one). */
  readonly hasSourceRoughness: boolean;
  readonly sourceRoughness: boolean;
  /** Source roughness R × `RoughnessScale`, or the flat preview roughness. */
  setSourceRoughness(enabled: boolean): void;
};
export type EyeShellHandle = { readonly role: "shell"; readonly parameters: ShellParameters };
export type EyeHandle = EyeballHandle | EyeShellHandle;

/** The eyeball's surface: replaces `map_fragment`. Ranks 4–5 add the refracted coordinate and both normals here. */
const EYE_SURFACE = /* glsl */`
#ifdef USE_MAP
vec2 xfsEyeUv = vMapUv;
// Side and fold: raw U > 0 is the "right" parameter set; the folded U puts the pupil at 0.5 on both eyes.
// (Ranks 4–5 choose the per-eye axis and horizontal angle by this side.)
float xfsEyeRight = xfsEyeUv.x > 0.0 ? 1.0 : 0.0;
vec2 xfsEyeUvC = vec2( xfsEyeUv.x + ( xfsEyeUv.x > 0.0 ? -1.0 : 1.0 ), 1.0 - xfsEyeUv.y );
// The fold jumps by a whole tile at U = 0 (behind the eye); the raw derivatives keep the mip level continuous.
vec2 xfsEyeDx = dFdx( xfsEyeUv ), xfsEyeDy = dFdy( xfsEyeUv );
vec3 xfsEyeAlbedo = textureGrad( map, xfsEyeUvC, xfsEyeDx, xfsEyeDy ).rgb;
#ifdef XFS_EYE_GRADIENT
vec4 xfsIris = textureGrad( xfsIrisMask, xfsEyeUvC, xfsEyeDx, xfsEyeDy );
vec3 xfsIrisColour = texture2D( xfsIrisGradient, vec2( xfsIris.r, 0.5 ) ).rgb;
xfsEyeAlbedo = mix( xfsEyeAlbedo, xfsIrisColour, xfsIris.a );
#endif
diffuseColor.rgb *= xfsEyeAlbedo;
#endif
`;

/** Patch a `MeshStandardMaterial` program for the eyeball; throws when this Three.js build lacks an expected chunk. */
export function patchEyeShader(shader: { fragmentShader: string }) {
  const replace = (source: string, find: string, by: string) => {
    if (!source.includes(find)) throw Error(`The eye shader expects ${find} in this Three.js build.`);
    return source.replace(find, by);
  };
  let fragment = shader.fragmentShader;
  fragment = replace(fragment, "#include <common>", `#include <common>
uniform sampler2D xfsIrisMask;
uniform sampler2D xfsIrisGradient;
uniform sampler2D xfsEyeRoughness;
uniform vec3 xfsEyeSurface;`);
  fragment = replace(fragment, "#include <map_fragment>", EYE_SURFACE);
  // Roughness at the raw UV (not folded, not flipped) × RoughnessScale, or the flat preview value; metalness = Specularity.
  fragment = replace(fragment, "#include <roughnessmap_fragment>",
    "float roughnessFactor = mix( roughness, texture2D( xfsEyeRoughness, vMapUv ).r * xfsEyeSurface.x, xfsEyeSurface.y );");
  fragment = replace(fragment, "#include <metalnessmap_fragment>", "float metalnessFactor = xfsEyeSurface.z;");
  shader.fragmentShader = fragment;
  return shader;
}

export type EyeTextures = { albedo: THREE.Texture; roughness?: THREE.Texture; irisMask?: THREE.Texture; gradient?: THREE.Texture };

/**
 * Build the eyeball material. `albedo` carries its colour space (sRGB when the resource is gamma); roughness is data;
 * the mask's colour space is the chosen `IrisMaskEncoding` (data for raw). Every eye texture repeats: UV0 spans tiles.
 */
export function createEyeMaterial(textures: EyeTextures, parameters: EyeParameters): { material: THREE.MeshStandardMaterial; handle: EyeballHandle; owned: THREE.Texture[] } {
  const owned: THREE.Texture[] = [];
  const placeholder = () => { const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.needsUpdate = true; owned.push(t); return t; };
  const gradient = !!(textures.irisMask && textures.gradient);
  const material = new THREE.MeshStandardMaterial({ map: textures.albedo, roughness: EYE_FLAT_ROUGHNESS, metalness: 0 });
  if (gradient) material.defines = { XFS_EYE_GRADIENT: "" };
  const uniforms = {
    xfsIrisMask: { value: textures.irisMask ?? placeholder() }, xfsIrisGradient: { value: textures.gradient ?? placeholder() },
    xfsEyeRoughness: { value: textures.roughness ?? placeholder() },
    xfsEyeSurface: { value: new THREE.Vector3(parameters.roughnessScale, 0, parameters.metalness) },
  };
  material.onBeforeCompile = shader => { Object.assign(shader.uniforms, uniforms); patchEyeShader(shader); };
  material.customProgramCacheKey = () => `xfs-eye-1${gradient ? "-gradient" : ""}`;
  material.name = gradient ? "xfs_eye_gradient" : "xfs_eye";
  let sourceRoughness = false;
  const hasSourceRoughness = !!textures.roughness;
  const handle: EyeballHandle = { role: "eyeball", parameters, gradient, hasSourceRoughness,
    get sourceRoughness() { return sourceRoughness; },
    setSourceRoughness(enabled) { sourceRoughness = enabled && hasSourceRoughness; uniforms.xfsEyeSurface.value.y = sourceRoughness ? 1 : 0; } };
  return { material, handle, owned };
}

/** The shell's surface and blend output; `RE_Direct` is replaced by its highlight (no diffuse, no environment). */
const SHELL_DECLARATIONS = /* glsl */`
uniform vec4 xfsShell;
uniform float xfsShellStrength;
float xfsShellRw = 1.0;
`;
const SHELL_LIGHT = /* glsl */`
void RE_Direct_XfsShell( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 halfDir = normalize( directLight.direction + geometryViewDir );
	float dotNH = saturate( dot( geometryNormal, halfDir ) );
	float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	float alpha = xfsShellRw * xfsShellRw;
	float visibility = 0.25 / ( ( dotNV + dotNL ) * ( 1.0 - alpha * 0.5 ) + alpha );
	reflectedLight.directSpecular += directLight.color * D_GGX( alpha, dotNH ) * visibility;
}
#undef RE_Direct
#define RE_Direct RE_Direct_XfsShell
`;
const SHELL_SURFACE = /* glsl */`
vec4 xfsShellMask = texture2D( map, vMapUv );
float xfsShellShadow = clamp( xfsShell.x * pow( max( xfsShellMask.r, 0.0 ), xfsShell.y ), 0.0, 1.0 );
float xfsShellAlpha = clamp( 1.0 + xfsShellShadow * ( xfsShell.z - 1.0 ), 0.0, 1.0 );
xfsShellRw = clamp( xfsShell.w * xfsShellMask.g, 0.04, 1.0 );
diffuseColor.rgb = vec3( 0.0 );
`;

export function patchEyeShellShader(shader: { fragmentShader: string }) {
  const replace = (source: string, find: string, by: string) => {
    if (!source.includes(find)) throw Error(`The eye shell shader expects ${find} in this Three.js build.`);
    return source.replace(find, by);
  };
  let fragment = shader.fragmentShader;
  fragment = replace(fragment, "#include <common>", `#include <common>\n${SHELL_DECLARATIONS}`);
  fragment = replace(fragment, "#include <lights_physical_pars_fragment>", `#include <lights_physical_pars_fragment>\n${SHELL_LIGHT}`);
  fragment = replace(fragment, "#include <map_fragment>", SHELL_SURFACE);
  // No environment reflection: the program walks the probes but weighs them by zero.
  fragment = replace(fragment, "#include <lights_fragment_maps>", "");
  // out = (highlight, alpha); the blend state makes it `out.rgb + dst · alpha`.
  fragment = replace(fragment, "#include <opaque_fragment>",
    "gl_FragColor = vec4( reflectedLight.directSpecular * xfsShellStrength * xfsShellMask.b, xfsShellAlpha );");
  shader.fragmentShader = fragment;
  return shader;
}

/** The wetness shell: its mask is data at the raw UV; drawn blended after everything opaque, never writing depth. */
export function createEyeShellMaterial(mask: THREE.Texture, parameters: ShellParameters): { material: THREE.MeshStandardMaterial; handle: EyeShellHandle } {
  const material = new THREE.MeshStandardMaterial({ map: mask, color: 0xffffff, roughness: 1, metalness: 0,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
    // The drawing buffer's alpha is not the shell's business.
    blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
  const uniforms = {
    xfsShell: { value: new THREE.Vector4(parameters.intensity, parameters.exponent, parameters.luminance, parameters.wetnessRoughness) },
    xfsShellStrength: { value: parameters.wetnessStrength },
  };
  material.onBeforeCompile = shader => { Object.assign(shader.uniforms, uniforms); patchEyeShellShader(shader); };
  material.customProgramCacheKey = () => "xfs-eye-shell-1";
  material.name = "xfs_eye_shell";
  return { material, handle: { role: "shell", parameters } };
}
