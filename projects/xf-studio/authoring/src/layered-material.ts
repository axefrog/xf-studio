import * as THREE from "three";
import { clampLayer, type RenderChunkMaterial, type RenderLayer, type RenderLayered } from "./render-detail";

/**
 * The layered (`multilayered.mt`) material for the browser renderer: a chunk's `.mlsetup` stack (layer templates with their colour,
 * normal, roughness and metalness maps, each layer's CName-selected values, its microblend and its `.mlmask` layer) baked once per
 * material into three surface maps (linear base colour, tangent normal, roughness/metalness) over the mesh's own UV range, then lit
 * every frame as a standard metal/rough surface (the template's lighting class is Standard). Nothing here knows which choice or mod a
 * chunk came from.
 *
 * What the game does [source: decompiled 2.31 `multilayered` G-buffer pixel program `4792354088802328889` (MeshSkinned and MeshStatic)
 * and the static `m_surfaceCache_GenerateMultilayer` compute program `7318179378413828262`, which repeats the same arithmetic;
 * knowledge/materials-and-shaders.md §4.6 has the evidence and grades]:
 * - layers are evaluated per pixel, **front to back** (highest index first), and each takes an additive share of the coverage still
 *   remaining: `w = min(remaining, a)`, `remaining −= w`; the bottom layer uses a full mask; coverage left over is black and zero
 *   roughness/metalness. This is not a lerp stack;
 * - a layer's coverage is its mask (bilinear, at `frac(uv)` in the exported image's rows), crossfaded with its microblend's
 *   `1 − alpha` by the contrast: `mp = saturate(k + (m − k)·c)`, `a = mp · opacity`; a masked layer with no mask data there is skipped;
 * - maps are read at `offset + tile · frac(uv)` in the game's texture rows (tile = `matTile`, U times the setup's ratio); roughness and
 *   metalness go through their levels as a clamped scale/bias chain `saturate(saturate(x·in₀ + in₁)·out₀ + out₁)`; the colour is the
 *   map times `lerp(1, colorScale, cm)` with `cm` the same chain on the roughness map through the template's colour-mask levels;
 * - layer normals add up weighted by `w`, microblend normals blend in at the mask's edges (`e`), the two mix by the strongest
 *   microblend weight, and the result is laid over the mesh-wide `GlobalNormal` with reoriented normal mapping.
 * The per-layer step is `accumulateLayer` (CPU reference, used by the tests) and `LAYER_ACCUMULATE_GLSL` (the GPU bake); the two must
 * stay identical. Runtime weather (the program's wet variant) is not part of the material and is not baked.
 */
export type Rgb = [number, number, number];
export type LayerMaps = { color: boolean; normal: boolean; roughness: boolean; metalness: boolean; microblend: boolean; mask: boolean };
/** One layer's bake inputs, in the program's units. */
export type LayerBakeParameters = {
  index: number;
  opacity: number;
  /** The template maps' UV scale (`matTile × tilingMultiplier`) and offset. */
  tile: number; offset: [number, number];
  /** The microblend's UV scale, offset, contrast and normal strength. */
  mbTile: number; mbOffset: [number, number]; mbContrast: number; mbNormal: number;
  /** `colorScale`, as stored (the program multiplies it raw). */
  colour: Rgb;
  normalStrength: number;
  /** Levels as stored, each a scale/bias pair: `saturate(saturate(x·in[0] + in[1])·out[0] + out[1])`. */
  roughIn: [number, number]; roughOut: [number, number]; metalIn: [number, number]; metalOut: [number, number];
  colourMaskIn: [number, number]; colourMaskOut: [number, number];
  maps: LayerMaps;
};

const saturate = (value: number) => Math.min(1, Math.max(0, value));
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
const frac = (value: number) => value - Math.floor(value);

/**
 * `microblendContrast` → the program's mask-contrast factor. Taken as the value itself [hypothesis: the CPU upload is unread; a direct
 * copy makes contrast a crossfade between the mask and the microblend, as the community guide describes it, and makes a contrast of 0
 * hide a layer whose microblend is opaque, as its warning says].
 */
export const microblendContrastFactor = (contrast: number) => Math.max(0, finite(contrast, 1));
/**
 * The template's colour-mask levels as the program's scale/bias pairs. Most templates (every earring template) store `Out = (0, 0)`,
 * which as a straight copy would never tint; the game's gold and paint are tinted, so that pair reads as "tint everywhere"
 * [hypothesis: the CPU mapping is unread; knowledge/materials-and-shaders.md open question].
 */
export function colourMaskLevels(input: readonly [number, number], output: readonly [number, number]): { in: [number, number]; out: [number, number] } {
  if (output[0] === 0 && output[1] === 0) return { in: [0, 1], out: [0, 1] };
  return { in: [input[0], input[1]], out: [output[0], output[1]] };
}

/**
 * A recorded layer → its bake parameters. Every number is clamped to the record's plausible ranges (`LAYER_RANGES`, PIPE-43) as the
 * host's readers do, so a hostile value can't make a sampling coordinate NaN.
 */
export function layerBakeParameters(layer: RenderLayer, index: number): LayerBakeParameters {
  const tile = clampLayer(clampLayer(layer.matTile, "tile", 1) * clampLayer(layer.tilingMultiplier, "tile", 1), "tile", 1);
  const pair = (value: readonly [number, number], fallback: [number, number]): [number, number] =>
    [clampLayer(value[0], "levels", fallback[0]), clampLayer(value[1], "levels", fallback[1])];
  const mask = colourMaskLevels(pair(layer.colorMaskLevelsIn, [0, 1]), pair(layer.colorMaskLevelsOut, [0, 1]));
  return { index, opacity: clampLayer(layer.opacity, "opacity", 0), tile, offset: [clampLayer(layer.offsetU, "offset", 0), clampLayer(layer.offsetV, "offset", 0)],
    mbTile: clampLayer(layer.mbTile, "tile", 1), mbOffset: [clampLayer(layer.microblendOffsetU, "offset", 0), clampLayer(layer.microblendOffsetV, "offset", 0)],
    mbContrast: microblendContrastFactor(clampLayer(layer.microblendContrast, "contrast", 1)), mbNormal: clampLayer(layer.microblendNormalStrength, "normal", 0),
    colour: layer.colorScale.map(c => clampLayer(c, "colour", 1)) as Rgb, normalStrength: clampLayer(layer.normalStrength, "normal", 0),
    roughIn: pair(layer.roughLevelsIn, [1, 0]), roughOut: pair(layer.roughLevelsOut, [1, 0]), metalIn: pair(layer.metalLevelsIn, [1, 0]),
    metalOut: pair(layer.metalLevelsOut, [1, 0]), colourMaskIn: mask.in, colourMaskOut: mask.out,
    maps: { color: !!layer.textures.color, normal: !!layer.textures.normal, roughness: !!layer.textures.roughness, metalness: !!layer.textures.metalness,
      microblend: !!layer.textures.microblend, mask: !!layer.textures.mask } };
}

/**
 * The layers the bake draws, **front to back** (the program's order): every masked layer that has mask data and a visible opacity,
 * from the highest index down, then the bottom layer (index 0, full mask). A layer at zero opacity adds nothing; a masked layer whose
 * mask layer is absent has no coverage anywhere (as a tile without that layer's bit). A layer whose `.mltemplate` the host could not
 * read is left out (PREV-67): drawn with neutral values it would cover its mask with opaque white.
 */
export function bakeOrder(layered: RenderLayered): LayerBakeParameters[] {
  const layers = layered.layers.map(layerBakeParameters);
  const drawn = (layer: LayerBakeParameters) => layer.opacity > 0 && !layered.layers[layer.index]!.templateUnreadable;
  const masked = layers.slice(1).filter(layer => drawn(layer) && layer.maps.mask).reverse();
  return layers[0] && drawn(layers[0]) ? [...masked, layers[0]] : masked;
}
/**
 * Why a stack draws less than it should, from what the host could read (PREV-67): `mask` when the `.mlmask` it names could not be read
 * (no mask layer at all, or a masked layer inside the mask's layer count without its image); `templates` counts drawn layers skipped
 * because their `.mltemplate` could not be read. A mask with fewer layers than the setup is not a problem: the upper layers cover
 * nothing, as in game.
 */
export function stackProblems(layered: RenderLayered): { mask: boolean; templates: number } {
  const mask = layered.mask;
  const unreadMask = !!mask && (mask.layers === 0 ||
    layered.layers.some((layer, index) => index > 0 && index < mask.layers && layer.opacity > 0 && !layer.templateUnreadable && !layer.textures.mask));
  return { mask: unreadMask, templates: layered.layers.filter(layer => layer.opacity > 0 && layer.templateUnreadable).length };
}

/** What the program accumulates over the layers at one texel. */
export type LayerAccumulator = { colour: Rgb; remaining: number; roughness: number; metalness: number; sumA: number; microMix: number;
  normal: [number, number]; microNormal: [number, number] };
export const EMPTY_ACCUMULATOR: LayerAccumulator = { colour: [0, 0, 0], remaining: 1, roughness: 0, metalness: 0, sumA: 0, microMix: 0,
  normal: [0, 0], microNormal: [0, 0] };
/** One layer's samples at a texel: colour linear, normals as their stored RG in −1…1, the rest 0…1; `mask` is ignored for the bottom layer. */
export type LayerSamples = { colour: Rgb; normal: [number, number]; roughness: number; metalness: number; microblend: [number, number, number, number];
  mask: number };

/** A levels pair chain as the program runs it. */
export const levels = (value: number, input: readonly [number, number], output: readonly [number, number]) =>
  saturate(saturate(value * input[0] + input[1]) * output[0] + output[1]);

/** One layer front to back over what the layers above it left (CPU reference of `LAYER_ACCUMULATE_GLSL`). */
export function accumulateLayer(acc: LayerAccumulator, layer: LayerBakeParameters, samples: LayerSamples, bottom: boolean): LayerAccumulator {
  const m = bottom ? 1 : samples.mask;
  if (acc.remaining <= 0 || m <= 0) return acc;
  const k = 1 - samples.microblend[3];
  const mp = saturate(k + (m - k) * layer.mbContrast);
  const a = mp * layer.opacity;
  const e = saturate(saturate(Math.sqrt(Math.max(0, 1 - 2 * Math.abs(mp - 0.5)))) * layer.opacity - acc.sumA);
  const micro: [number, number] = [samples.microblend[0] * 2 - 1, samples.microblend[1] * 2 - 1];
  const microNormal: [number, number] = [acc.microNormal[0] + (micro[0] * layer.mbNormal - acc.microNormal[0]) * e,
    acc.microNormal[1] + (micro[1] * layer.mbNormal - acc.microNormal[1]) * e];
  const next: LayerAccumulator = { ...acc, microNormal, microMix: Math.max(acc.microMix, Math.abs(layer.mbNormal) * e), sumA: acc.sumA + a };
  const w = Math.min(acc.remaining, a);
  if (w <= 0) return next;
  const cm = levels(samples.roughness, layer.colourMaskIn, layer.colourMaskOut);
  return { ...next, remaining: acc.remaining - w,
    metalness: acc.metalness + w * levels(samples.metalness, layer.metalIn, layer.metalOut),
    roughness: acc.roughness + w * levels(samples.roughness, layer.roughIn, layer.roughOut),
    colour: acc.colour.map((c, i) => c + w * samples.colour[i]! * (1 + (layer.colour[i]! - 1) * cm)) as Rgb,
    normal: [acc.normal[0] + w * samples.normal[0] * layer.normalStrength, acc.normal[1] + w * samples.normal[1] * layer.normalStrength] };
}

/** Reoriented normal mapping: `detail` laid over `base` (both unit, tangent space). */
export function reorientedNormal(base: readonly [number, number, number], detail: readonly [number, number, number]): [number, number, number] {
  const t = [base[0], base[1], base[2] + 1], u = [-detail[0], -detail[1], detail[2]];
  const dot = t[0]! * u[0]! + t[1]! * u[1]! + t[2]! * u[2]!;
  const r = [t[0]! * dot - u[0]! * t[2]!, t[1]! * dot - u[1]! * t[2]!, t[2]! * dot - u[2]! * t[2]!];
  const length = Math.hypot(r[0]!, r[1]!, r[2]!) || 1;
  return [r[0]! / length, r[1]! / length, r[2]! / length];
}
/** The mesh-wide normal at an intensity: `normalize(I·x, I·y, I·(z − 1) + 1)`. */
export function globalNormal(xy: readonly [number, number], intensity: number): [number, number, number] {
  const z = Math.sqrt(Math.max(0, 1 - xy[0] * xy[0] - xy[1] * xy[1]));
  const v = [intensity * xy[0], intensity * xy[1], intensity * (z - 1) + 1];
  const length = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / length, v[1]! / length, v[2]! / length];
}
/** The surface the program writes from the accumulated layers (normal in the game's tangent frame). */
export function resolveSurface(acc: LayerAccumulator, global: readonly [number, number, number] = [0, 0, 1]):
  { colour: Rgb; normal: [number, number, number]; roughness: number; metalness: number } {
  const lift = (xy: readonly [number, number]): [number, number, number] => [xy[0], xy[1], Math.sqrt(saturate(1 - xy[0] * xy[0] - xy[1] * xy[1]))];
  const nl = lift(acc.normal), nm = lift(acc.microNormal);
  const detail = nl.map((c, i) => c + (nm[i]! - c) * acc.microMix) as [number, number, number];
  return { colour: acc.colour, normal: reorientedNormal(global, detail), roughness: acc.roughness, metalness: acc.metalness };
}

/**
 * Where a layer reads its maps at a mesh UV (the glTF UV the exported geometry carries, whose V is the game's `1 − v`): the game reads
 * `offset + tile · (frac(u)·ratio, frac(v))` in its own texture rows, and the exported images are stored flipped, so the image row is
 * `1 −` that. Returns the image coordinate (the sampler repeats).
 */
export function layerMapUv(uv: readonly [number, number], tile: number, offset: readonly [number, number], ratio = 1): [number, number] {
  return [offset[0] + tile * frac(uv[0]) * ratio, 1 - (offset[1] + tile * frac(1 - uv[1]))];
}

/** GLSL twin of `levels`, `accumulateLayer` and `resolveSurface`. */
export const LAYER_ACCUMULATE_GLSL = /* glsl */`
float xfsLevels( float value, vec2 inLevels, vec2 outLevels ) {
	return clamp( clamp( value * inLevels.x + inLevels.y, 0.0, 1.0 ) * outLevels.x + outLevels.y, 0.0, 1.0 );
}
vec3 xfsRnm( vec3 base, vec3 detail ) {
	vec3 t = base + vec3( 0.0, 0.0, 1.0 );
	vec3 u = vec3( -detail.xy, detail.z );
	return normalize( t * dot( t, u ) - u * t.z );
}
vec3 xfsGlobalNormal( vec2 xy, float intensity ) {
	float z = sqrt( max( 1.0 - dot( xy, xy ), 0.0 ) );
	return normalize( vec3( intensity * xy, intensity * ( z - 1.0 ) + 1.0 ) );
}`;

// ---------------------------------------------------------------------------------------------------------------------------------
// The GPU bake.

const PASS_VERTEX = /* glsl */`
in vec3 position;
out vec2 vBakeUv;
void main() {
	vBakeUv = position.xy * 0.5 + 0.5;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

/**
 * One layer, front to back. Three accumulation targets: (colour RGB, remaining), (roughness, metalness, Σa, microblend mix),
 * (layer normal XY, microblend normal XY).
 */
const LAYER_FRAGMENT = /* glsl */`
precision highp float;
precision highp sampler2D;
in vec2 vBakeUv;
uniform sampler2D uAcc0;
uniform sampler2D uAcc1;
uniform sampler2D uAcc2;
uniform sampler2D uColour;
uniform sampler2D uNormal;
uniform sampler2D uRoughness;
uniform sampler2D uMetalness;
uniform sampler2D uMicroblend;
uniform sampler2D uMask;
/** The baked domain in mesh UV: min.xy, size.zw. */
uniform vec4 uDomain;
uniform vec3 uTint;
/** Material tile, offset U, offset V, setup ratio. */
uniform vec4 uTile;
/** Microblend tile, offset U, offset V, normal strength. */
uniform vec4 uMicro;
uniform vec4 uRough;
uniform vec4 uMetal;
uniform vec4 uColourMask;
/** Bottom layer, opacity, normal strength, contrast. */
uniform vec4 uLayer;
uniform vec4 uMaps0;
uniform vec2 uMaps1;
layout( location = 0 ) out highp vec4 oAcc0;
layout( location = 1 ) out highp vec4 oAcc1;
layout( location = 2 ) out highp vec4 oAcc2;
${LAYER_ACCUMULATE_GLSL}
vec4 xfsTiled( sampler2D map, vec2 uv, float tile, vec2 offset, float ratio ) {
	vec2 fr = vec2( fract( uv.x ), fract( 1.0 - uv.y ) );
	vec2 at = vec2( offset.x + tile * fr.x * ratio, 1.0 - ( offset.y + tile * fr.y ) );
	// Derivatives of the continuous coordinate, so the frac seam never picks a tiny mip.
	vec2 dx = dFdx( uv ) * vec2( tile * ratio, tile ), dy = dFdy( uv ) * vec2( tile * ratio, tile );
	return textureGrad( map, at, dx, dy );
}
void main() {
	vec2 uv = uDomain.xy + vBakeUv * uDomain.zw;
	ivec2 texel = ivec2( gl_FragCoord.xy );
	vec4 acc0 = texelFetch( uAcc0, texel, 0 );
	vec4 acc1 = texelFetch( uAcc1, texel, 0 );
	vec4 acc2 = texelFetch( uAcc2, texel, 0 );
	oAcc0 = acc0; oAcc1 = acc1; oAcc2 = acc2;
	float bottom = uLayer.x, opacity = uLayer.y;
	float m = bottom > 0.5 ? 1.0 : ( uMaps1.y > 0.5 ? textureLod( uMask, fract( uv ), 0.0 ).r : 0.0 );
	float remaining = acc0.w;
	if ( remaining <= 0.0 || m <= 0.0 ) return;
	vec4 mb = uMaps1.x > 0.5 ? xfsTiled( uMicroblend, uv, uMicro.x, uMicro.yz, uTile.w ) : vec4( 0.5, 0.5, 1.0, 1.0 );
	float k = 1.0 - mb.a;
	float mp = clamp( k + ( m - k ) * uLayer.w, 0.0, 1.0 );
	float a = mp * opacity;
	float e = clamp( clamp( sqrt( max( 1.0 - 2.0 * abs( mp - 0.5 ), 0.0 ) ), 0.0, 1.0 ) * opacity - acc1.z, 0.0, 1.0 );
	vec2 microNormal = mix( acc2.zw, ( mb.rg * 2.0 - 1.0 ) * uMicro.w, e );
	oAcc1.z = acc1.z + a;
	oAcc1.w = max( acc1.w, abs( uMicro.w ) * e );
	oAcc2.zw = microNormal;
	float w = min( remaining, a );
	if ( w <= 0.0 ) return;
	float roughness = uMaps0.z > 0.5 ? xfsTiled( uRoughness, uv, uTile.x, uTile.yz, uTile.w ).r : 1.0;
	float metalness = uMaps0.w > 0.5 ? xfsTiled( uMetalness, uv, uTile.x, uTile.yz, uTile.w ).r : 0.0;
	vec3 colour = uMaps0.x > 0.5 ? xfsTiled( uColour, uv, uTile.x, uTile.yz, uTile.w ).rgb : vec3( 1.0 );
	vec2 normal = uMaps0.y > 0.5 ? xfsTiled( uNormal, uv, uTile.x, uTile.yz, uTile.w ).rg * 2.0 - 1.0 : vec2( 0.0 );
	float cm = xfsLevels( roughness, uColourMask.xy, uColourMask.zw );
	oAcc0 = vec4( acc0.rgb + w * colour * mix( vec3( 1.0 ), uTint, cm ), remaining - w );
	oAcc1.x = acc1.x + w * xfsLevels( roughness, uRough.xy, uRough.zw );
	oAcc1.y = acc1.y + w * xfsLevels( metalness, uMetal.xy, uMetal.zw );
	oAcc2.xy = acc2.xy + w * normal * uLayer.z;
}`;

/**
 * Final pass: the accumulated layers as the lit material's two packed maps (PREV-63): base colour with roughness in alpha (an sRGB
 * 8-bit target: the hardware encodes the colour and keeps alpha linear), and the tangent normal (game frame, over the mesh-wide normal)
 * with metalness in alpha (linear 8-bit).
 */
const RESOLVE_FRAGMENT = /* glsl */`
precision highp float;
precision highp sampler2D;
in vec2 vBakeUv;
uniform sampler2D uAcc0;
uniform sampler2D uAcc1;
uniform sampler2D uAcc2;
uniform sampler2D uGlobalNormal;
uniform vec4 uDomain;
/** Global normal: UV scale xy, UV bias zw. */
uniform vec4 uGlobalUv;
/** Global normal intensity, whether it is set. */
uniform vec2 uGlobal;
layout( location = 0 ) out highp vec4 oColour;
layout( location = 1 ) out highp vec4 oNormal;
${LAYER_ACCUMULATE_GLSL}
void main() {
	ivec2 texel = ivec2( gl_FragCoord.xy );
	vec4 acc0 = texelFetch( uAcc0, texel, 0 );
	vec4 acc1 = texelFetch( uAcc1, texel, 0 );
	vec4 acc2 = texelFetch( uAcc2, texel, 0 );
	vec3 nl = vec3( acc2.xy, sqrt( clamp( 1.0 - dot( acc2.xy, acc2.xy ), 0.0, 1.0 ) ) );
	vec3 nm = vec3( acc2.zw, sqrt( clamp( 1.0 - dot( acc2.zw, acc2.zw ), 0.0, 1.0 ) ) );
	vec3 detail = mix( nl, nm, acc1.w );
	vec3 base = vec3( 0.0, 0.0, 1.0 );
	if ( uGlobal.y > 0.5 ) {
		vec2 uv = uDomain.xy + vBakeUv * uDomain.zw;
		// The game reads uv·scale + bias in its own rows; the exported image is stored flipped.
		vec2 at = vec2( uv.x * uGlobalUv.x + uGlobalUv.z, 1.0 - ( ( 1.0 - uv.y ) * uGlobalUv.y + uGlobalUv.w ) );
		base = xfsGlobalNormal( texture( uGlobalNormal, at ).rg * 2.0 - 1.0, uGlobal.x );
	}
	vec3 n = xfsRnm( base, detail );
	oColour = vec4( clamp( acc0.rgb, 0.0, 1.0 ), clamp( acc1.x, 0.0, 1.0 ) );
	oNormal = vec4( n * 0.5 + 0.5, clamp( acc1.y, 0.0, 1.0 ) );
}`;

/** Before the first layer: nothing accumulated, all coverage remaining (alpha of the first target), zero normals. */
const CLEAR_FRAGMENT = /* glsl */`
precision highp float;
layout( location = 0 ) out highp vec4 o0;
layout( location = 1 ) out highp vec4 o1;
layout( location = 2 ) out highp vec4 o2;
void main() { o0 = vec4( 0.0, 0.0, 0.0, 1.0 ); o1 = vec4( 0.0 ); o2 = vec4( 0.0 ); }`;

/** The textures one layer samples (the loader's, with their colour flags already applied; data maps are never colour-decoded). */
export type LayerTextures = { color?: THREE.Texture; normal?: THREE.Texture; roughness?: THREE.Texture; metalness?: THREE.Texture;
  microblend?: THREE.Texture; mask?: THREE.Texture };
/** The chunk-wide inputs: the setup's ratio and the template's mesh-wide normal. */
export type LayeredGlobals = { ratio: number; normal?: THREE.Texture; normalIntensity: number; normalUvScale: [number, number]; normalUvBias: [number, number] };
export type LayeredInput = {
  /** Front to back (`bakeOrder`). */
  layers: { parameters: LayerBakeParameters; textures: LayerTextures }[];
  globals: LayeredGlobals;
  /** The mesh's UV range the bake covers (min and max U, V); the lit material samples the maps over it. */
  domain: { min: [number, number]; max: [number, number] };
  /** Bake size in texels (square). */
  size: number;
};
export type LayeredEvidence = { state: "pending" | "baked" | "failed"; size: number; layers: number[]; domain: { min: [number, number]; max: [number, number] };
  globalNormal: boolean; error?: string;
  /** Bytes the kept maps take on the GPU (both packed maps with their mips), shared with every chunk baked from the same stack. */
  bytes: number; shared: boolean };
export type LayeredHandle = {
  readonly state: "pending" | "baked" | "failed";
  /** Bake the stack with this renderer (once). Returns false if it failed; the chunk is then left out. */
  bake(renderer: THREE.WebGLRenderer): boolean;
  /**
   * The renderer's context was lost and restored: the kept maps are gone, so the material hides and the stack is baked again by the
   * next `bake` (PREV-62). A failed bake stays failed.
   */
  contextRestored(): void;
  /** Plain data for the developer evidence. */
  evidence(): LayeredEvidence;
  /** The baked maps (colour + roughness, normal + metalness) once baked: read by the real-GPU test. */
  readonly target: THREE.WebGLRenderTarget | null;
};

/** The chunk-wide values a layered chunk's template instance sets (the record carries scalars; vectors fall back to identity). */
export function layeredGlobals(chunk: Pick<RenderChunkMaterial, "scalars">, layered: RenderLayered): Omit<LayeredGlobals, "normal"> {
  const scalar = (name: string, fallback: number) => Number.isFinite(chunk.scalars[name]) ? chunk.scalars[name]! : fallback;
  const scale = scalar("GlobalNormalUVScale", 1), bias = scalar("GlobalNormalUVBias", 0);
  return { ratio: clampLayer(layered.ratio, "ratio", 1), normalIntensity: scalar("GlobalNormalIntensity", 1),
    normalUvScale: [scale, scale], normalUvBias: [bias, bias] };
}

/** Bake size limits in texels: the smallest bake, the one used when the surface can't be measured, and the largest. */
export const BAKE_SIZE = { min: 256, usual: 1024, max: 2048 } as const;
/**
 * The texel density a bake aims for on the part's surface: 20 texels per millimetre (0.05 mm per texel), finer than the preview's
 * closest creator framing resolves on a head. A small stud gets the smallest bake; an eyeball about 1024 (PREV-63).
 */
export const BAKE_TEXELS_PER_METRE = 20_000;
/** A part's surface: its world area (square metres) and the area its UVs cover (UV units), from its triangles. */
export type BakeSurface = { worldArea: number; uvArea: number };
/** The world and UV areas of a mesh's triangles (world scale from its transform), or null when it has no measurable triangles. */
export function bakeSurface(mesh: THREE.Mesh): BakeSurface | null {
  const geometry = mesh.geometry, position = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
  if (!position || !uv) return null;
  mesh.updateWorldMatrix(true, false);
  const scale = new THREE.Vector3();
  mesh.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  const index = geometry.getIndex(), count = index ? index.count : position.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let worldArea = 0, uvArea = 0;
  for (let i = 0; i + 2 < count; i += 3) {
    const [i0, i1, i2] = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
    a.fromBufferAttribute(position, i0).multiply(scale); b.fromBufferAttribute(position, i1).multiply(scale); c.fromBufferAttribute(position, i2).multiply(scale);
    worldArea += b.sub(a).cross(c.sub(a)).length() / 2;
    const u0 = uv.getX(i0), v0 = uv.getY(i0);
    uvArea += Math.abs((uv.getX(i1) - u0) * (uv.getY(i2) - v0) - (uv.getX(i2) - u0) * (uv.getY(i1) - v0)) / 2;
  }
  return Number.isFinite(worldArea) && Number.isFinite(uvArea) && worldArea > 0 && uvArea > 0 ? { worldArea, uvArea } : null;
}
/**
 * The bake's side, a power of two within `BAKE_SIZE` (PREV-63): the texel density `BAKE_TEXELS_PER_METRE` over the part's own surface.
 * The baked square covers the UV domain, of which the UVs use `uvArea`; so a side of `N` gives `worldArea · domainArea / uvArea / N²`
 * square metres per texel. Without a measurable surface, the older rule: the finest mask over the domain, or the usual density of a
 * one-tile part.
 */
export function layeredBakeSize(layered: RenderLayered, domain: LayeredInput["domain"], surface?: BakeSurface | null): number {
  const width = Math.max(domain.max[0] - domain.min[0], 1e-3), height = Math.max(domain.max[1] - domain.min[1], 1e-3);
  let wanted: number;
  if (surface) wanted = BAKE_TEXELS_PER_METRE * Math.sqrt(surface.worldArea * width * height / surface.uvArea);
  else {
    const span = Math.max(width, height);
    const mask = Math.max(0, ...layered.layers.map(layer => Math.max(layer.textures.mask?.width ?? 0, layer.textures.mask?.height ?? 0)));
    wanted = Math.max(mask * Math.min(span, 4), BAKE_SIZE.usual * Math.min(span, 2));
  }
  return Math.min(BAKE_SIZE.max, Math.max(BAKE_SIZE.min, 2 ** Math.round(Math.log2(Math.max(1, wanted)))));
}

/** The mesh UV range a bake covers: the vertices' bounds, padded by 1/256 of the span, never empty. */
export function uvDomain(uv: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined): LayeredInput["domain"] {
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (let i = 0; i < (uv?.count ?? 0); i++) {
    const u = uv!.getX(i), v = uv!.getY(i);
    if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  if (!Number.isFinite(minU)) return { min: [0, 0], max: [1, 1] };
  const pad = (lo: number, hi: number): [number, number] => { const span = Math.max(hi - lo, 1e-3); return [lo - span / 256, hi + span / 256]; };
  const [u0, u1] = pad(minU, maxU), [v0, v1] = pad(minV, maxV);
  return { min: [u0, v0], max: [u1, v1] };
}

const white = (() => {
  let made: THREE.DataTexture | null = null;
  return () => {
    if (!made) { made = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); made.needsUpdate = true; }
    return made;
  };
})();

/**
 * Why a bake can't run here: it accumulates in half-float colour targets (signed normals, coverage sums above 1), which WebGL 2 renders
 * to with `EXT_color_buffer_float` or `EXT_color_buffer_half_float`.
 */
export const bakeUnsupported = (renderer: THREE.WebGLRenderer): string | null =>
  renderer.capabilities.isWebGL2 === false ? "WebGL 2 is required"
    : !renderer.extensions?.has?.("EXT_color_buffer_float") && !renderer.extensions?.has?.("EXT_color_buffer_half_float") ? "half-float render targets are unavailable" : null;

/**
 * The bake's programs and quad, made once per renderer (PREV-66): every bake reuses them, so a V's five piercing chunks compile three
 * programs once instead of fifteen times. Uniforms are set per layer. After a context restore three.js compiles them again on first use.
 */
type BakeKit = { pass: THREE.RawShaderMaterial; resolve: THREE.RawShaderMaterial; clear: THREE.RawShaderMaterial; mesh: THREE.Mesh;
  scene: THREE.Scene; camera: THREE.Camera };
const kits = new WeakMap<THREE.WebGLRenderer, BakeKit>();
function bakeKit(renderer: THREE.WebGLRenderer): BakeKit {
  let kit = kits.get(renderer);
  if (kit) return kit;
  const quad = new THREE.BufferGeometry();
  quad.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const raw = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3,
    vertexShader: PASS_VERTEX, fragmentShader, depthTest: false, depthWrite: false, uniforms });
  const pass = raw(LAYER_FRAGMENT, { uAcc0: { value: null }, uAcc1: { value: null }, uAcc2: { value: null }, uColour: { value: white() }, uNormal: { value: white() },
    uRoughness: { value: white() }, uMetalness: { value: white() }, uMicroblend: { value: white() }, uMask: { value: white() },
    uDomain: { value: new THREE.Vector4() }, uTint: { value: new THREE.Vector3() }, uTile: { value: new THREE.Vector4() }, uMicro: { value: new THREE.Vector4() },
    uRough: { value: new THREE.Vector4() }, uMetal: { value: new THREE.Vector4() }, uColourMask: { value: new THREE.Vector4() },
    uLayer: { value: new THREE.Vector4() }, uMaps0: { value: new THREE.Vector4() }, uMaps1: { value: new THREE.Vector2() } });
  const resolve = raw(RESOLVE_FRAGMENT, { uAcc0: { value: null }, uAcc1: { value: null }, uAcc2: { value: null }, uGlobalNormal: { value: white() },
    uDomain: { value: new THREE.Vector4() }, uGlobalUv: { value: new THREE.Vector4() }, uGlobal: { value: new THREE.Vector2() } });
  const clear = raw(CLEAR_FRAGMENT, {});
  const mesh = new THREE.Mesh(quad, pass);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  kit = { pass, resolve, clear, mesh, scene, camera: new THREE.Camera() };
  kits.set(renderer, kit);
  return kit;
}

/**
 * Whether the last draw with `material` ran: its program compiled and linked (three.js keeps the diagnostics when it checks shader
 * errors, as it does by default), the bound framebuffer is complete and WebGL reported no error (PREV-65). A driver that fails any of
 * these would otherwise leave black maps reported as baked.
 */
function drawFailed(renderer: THREE.WebGLRenderer, material: THREE.Material): string | null {
  const gl = renderer.getContext();
  const program = (renderer.properties.get(material) as { currentProgram?: { diagnostics?: { runnable: boolean; programLog: string } } }).currentProgram;
  if (!program) return "the bake program was not built";
  if (program.diagnostics && !program.diagnostics.runnable) return `the bake program failed to build: ${program.diagnostics.programLog.slice(0, 200)}`;
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) return `the bake target is incomplete (0x${status.toString(16)})`;
  const error = gl.getError();
  return error !== gl.NO_ERROR ? `WebGL error 0x${error.toString(16)} while baking` : null;
}

/** three.js's roughness and metalness map chunks, reading the packed maps' alpha instead of G and B. */
export const PACKED_ROUGHNESS_GLSL = /* glsl */`
float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	roughnessFactor *= texture2D( roughnessMap, vRoughnessMapUv ).a;
#endif`;
export const PACKED_METALNESS_GLSL = /* glsl */`
float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	metalnessFactor *= texture2D( metalnessMap, vMetalnessMapUv ).a;
#endif`;
/** Bytes the two packed 8-bit maps take with their mips. */
const keptBytes = (size: number) => Math.round(size * size * 8 * 4 / 3);
/**
 * Baked maps shared between chunks whose stacks, domains and sizes are identical (PREV-63: the same part drawn twice bakes once).
 * Keyed by renderer, then by the input's identity; released when the last material using one is disposed.
 */
const sharedBakes = new WeakMap<THREE.WebGLRenderer, Map<string, { target: THREE.WebGLRenderTarget; users: number }>>();
const textureId = (texture: THREE.Texture | undefined) => texture ? texture.uuid : "-";
/** A bake's identity: every parameter and input texture of its layers, its globals, domain and size. */
export function bakeKey(input: LayeredInput): string {
  const g = input.globals;
  return JSON.stringify([input.size, input.domain, g.ratio, g.normalIntensity, g.normalUvScale, g.normalUvBias, textureId(g.normal),
    input.layers.map(({ parameters, textures }) => [parameters, textureId(textures.color), textureId(textures.normal), textureId(textures.roughness),
      textureId(textures.metalness), textureId(textures.microblend), textureId(textures.mask)])]);
}

/**
 * The layered material: a standard metal/rough material whose maps the handle bakes from the stack once. Until the bake runs the
 * material is invisible (so nothing unbaked is ever drawn). The game's tangent normal has its green along the game's V, which runs
 * opposite the exported UV's V, so the lit material reads it with Y negated (as the core head's normal map). Roughness and metalness
 * are packed into the alpha of the colour and normal maps (PREV-63); the material reads them there.
 */
export function createLayeredMaterial(input: LayeredInput): { material: THREE.MeshStandardMaterial; handle: LayeredHandle } {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1, visible: false });
  material.name = "xfs_layered";
  material.normalScale.set(1, -1);
  // Roughness in the colour map's alpha, metalness in the normal map's alpha (the packed bake), instead of G and B of their own maps.
  // (The chunks are still `#include` directives when this runs, so the includes themselves are replaced.)
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <roughnessmap_fragment>", PACKED_ROUGHNESS_GLSL)
      .replace("#include <metalnessmap_fragment>", PACKED_METALNESS_GLSL);
  };
  material.customProgramCacheKey = () => "xfs_layered_packed";
  let state: "pending" | "baked" | "failed" = "pending", error: string | undefined;
  let result: THREE.WebGLRenderTarget | null = null, shared = false, release: (() => void) | null = null;
  // The baked maps live as long as the material: whoever disposes the material (the loader, per V) releases them.
  material.addEventListener("dispose", () => { release?.(); release = null; result = null; });
  const { min, max } = input.domain;
  const domain = new THREE.Vector4(min[0], min[1], max[0] - min[0], max[1] - min[1]);
  const show = (target: THREE.WebGLRenderTarget) => {
    // The lit material samples the maps over the baked UV range: uv' = (uv − min) / (max − min).
    const repeat = new THREE.Vector2(1 / (max[0] - min[0]), 1 / (max[1] - min[1]));
    const offset = new THREE.Vector2(-min[0] * repeat.x, -min[1] * repeat.y);
    const [colour, normal] = target.textures as [THREE.Texture, THREE.Texture];
    // A shared target is shared only by bakes of the same domain, so every user sets the same transform.
    material.map = colour; material.roughnessMap = colour;
    material.normalMap = normal; material.metalnessMap = normal;
    for (const texture of [colour, normal]) {
      texture.repeat.copy(repeat); texture.offset.copy(offset); texture.name = "xfs_layered_bake";
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    }
    material.visible = true;
    material.needsUpdate = true;
  };
  const hide = () => {
    release?.(); release = null; result = null;
    material.map = material.normalMap = material.roughnessMap = material.metalnessMap = null;
    material.visible = false;
    material.needsUpdate = true;
  };
  const handle: LayeredHandle = {
    get state() { return state; },
    get target() { return result; },
    contextRestored() {
      if (state !== "baked") return;
      // The kept maps died with the context (they are not disposed: their GL objects belong to the lost context). The renderer's
      // shared bakes are forgotten (`layeredContextRestored`), and the next `bake` rebuilds them.
      release = null; hide();
      state = "pending";
    },
    bake(renderer) {
      if (state !== "pending") return state === "baked";
      const unsupported = bakeUnsupported(renderer);
      if (unsupported) { state = "failed"; error = unsupported; return false; }
      const key = bakeKey(input);
      let bakes = sharedBakes.get(renderer);
      if (!bakes) { bakes = new Map(); sharedBakes.set(renderer, bakes); }
      const known = bakes.get(key);
      if (known) {
        known.users++; shared = true; result = known.target;
        release = () => { if (--known.users <= 0) { known.target.dispose(); if (bakes!.get(key) === known) bakes!.delete(key); } };
        show(known.target);
        state = "baked";
        return true;
      }
      const kit = bakeKit(renderer);
      const targets: THREE.WebGLRenderTarget[] = [];
      const previousTarget = renderer.getRenderTarget(), autoClear = renderer.autoClear;
      const clearColour = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
      let made: THREE.WebGLRenderTarget | null = null;
      try {
        // Start from a clean error state: an earlier draw's error is not the bake's.
        const gl = renderer.getContext();
        for (let i = 0; i < 8 && gl.getError() !== gl.NO_ERROR; i++) { /* drain */ }
        // Half-float accumulation (PREV-63): signed normals and coverage sums above 1 need a float format; half precision keeps the
        // bake within the CPU reference's tolerance.
        const accumulate = () => new THREE.WebGLRenderTarget(input.size, input.size, { count: 3, type: THREE.HalfFloatType, format: THREE.RGBAFormat,
          depthBuffer: false, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
        targets.push(accumulate(), accumulate());
        renderer.autoClear = false;
        kit.mesh.material = kit.clear;
        renderer.setRenderTarget(targets[0]!);
        renderer.render(kit.scene, kit.camera);
        let failure = drawFailed(renderer, kit.clear);
        let from = 0;
        const u = kit.pass.uniforms, g = input.globals;
        (u.uDomain!.value as THREE.Vector4).copy(domain);
        kit.mesh.material = kit.pass;
        input.layers.forEach(({ parameters: layer, textures }, order) => {
          if (failure) return;
          const to = 1 - from;
          u.uAcc0!.value = targets[from]!.textures[0];
          u.uAcc1!.value = targets[from]!.textures[1];
          u.uAcc2!.value = targets[from]!.textures[2];
          u.uColour!.value = textures.color ?? white();
          u.uNormal!.value = textures.normal ?? white();
          u.uRoughness!.value = textures.roughness ?? white();
          u.uMetalness!.value = textures.metalness ?? white();
          u.uMicroblend!.value = textures.microblend ?? white();
          u.uMask!.value = textures.mask ?? white();
          (u.uTint!.value as THREE.Vector3).set(...layer.colour);
          (u.uTile!.value as THREE.Vector4).set(layer.tile, layer.offset[0], layer.offset[1], g.ratio);
          (u.uMicro!.value as THREE.Vector4).set(layer.mbTile, layer.mbOffset[0], layer.mbOffset[1], layer.mbNormal);
          (u.uRough!.value as THREE.Vector4).set(layer.roughIn[0], layer.roughIn[1], layer.roughOut[0], layer.roughOut[1]);
          (u.uMetal!.value as THREE.Vector4).set(layer.metalIn[0], layer.metalIn[1], layer.metalOut[0], layer.metalOut[1]);
          (u.uColourMask!.value as THREE.Vector4).set(layer.colourMaskIn[0], layer.colourMaskIn[1], layer.colourMaskOut[0], layer.colourMaskOut[1]);
          (u.uLayer!.value as THREE.Vector4).set(order === input.layers.length - 1 && layer.index === 0 ? 1 : 0, layer.opacity, layer.normalStrength, layer.mbContrast);
          (u.uMaps0!.value as THREE.Vector4).set(+!!textures.color, +!!textures.normal, +!!textures.roughness, +!!textures.metalness);
          (u.uMaps1!.value as THREE.Vector2).set(+!!textures.microblend, +!!textures.mask);
          kit.pass.uniformsNeedUpdate = true;
          renderer.setRenderTarget(targets[to]!);
          renderer.render(kit.scene, kit.camera);
          failure = drawFailed(renderer, kit.pass);
          from = to;
        });
        if (failure) throw Error(failure);
        // The kept maps: colour (sRGB) with roughness in alpha, and the normal with metalness in alpha, both 8-bit with mips.
        made = new THREE.WebGLRenderTarget(input.size, input.size, { count: 2, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false,
          generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
        made.textures[0]!.colorSpace = THREE.SRGBColorSpace;
        const r = kit.resolve.uniforms;
        r.uAcc0!.value = targets[from]!.textures[0];
        r.uAcc1!.value = targets[from]!.textures[1];
        r.uAcc2!.value = targets[from]!.textures[2];
        r.uGlobalNormal!.value = g.normal ?? white();
        (r.uDomain!.value as THREE.Vector4).copy(domain);
        (r.uGlobalUv!.value as THREE.Vector4).set(g.normalUvScale[0], g.normalUvScale[1], g.normalUvBias[0], g.normalUvBias[1]);
        (r.uGlobal!.value as THREE.Vector2).set(g.normalIntensity, g.normal ? 1 : 0);
        kit.resolve.uniformsNeedUpdate = true;
        kit.mesh.material = kit.resolve;
        renderer.setRenderTarget(made);
        renderer.render(kit.scene, kit.camera);
        const resolveFailure = drawFailed(renderer, kit.resolve);
        if (resolveFailure) throw Error(resolveFailure);
        const entry = { target: made, users: 1 };
        bakes.set(key, entry);
        result = made; shared = false;
        release = () => { if (--entry.users <= 0) { entry.target.dispose(); if (bakes!.get(key) === entry) bakes!.delete(key); } };
        made = null;
        show(result);
        state = "baked";
      } catch (reason) {
        state = "failed";
        error = (reason as Error).message;
        made?.dispose();
        result = null;
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(clearColour, clearAlpha);
        renderer.autoClear = autoClear;
        for (const target of targets) target.dispose();
      }
      return state === "baked";
    },
    evidence: () => ({ state, size: input.size, layers: input.layers.map(entry => entry.parameters.index),
      domain: { min: [...min] as [number, number], max: [...max] as [number, number] }, globalNormal: !!input.globals.normal,
      bytes: state === "baked" && !shared ? keptBytes(input.size) : 0, shared, ...(error ? { error } : {}) }),
  };
  return { material, handle };
}

/**
 * A restored context has none of the baked maps: forget the renderer's shared bakes (their GL objects died with the lost context, so
 * they are not disposed), then call each handle's `contextRestored` and bake again (PREV-62).
 */
export function layeredContextRestored(renderer: THREE.WebGLRenderer): void {
  sharedBakes.delete(renderer);
}
