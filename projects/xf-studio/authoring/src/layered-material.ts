import * as THREE from "three";
import type { RenderChunkMaterial, RenderLayer, RenderLayered } from "./render-detail";

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

/** A recorded layer → its bake parameters. */
export function layerBakeParameters(layer: RenderLayer, index: number): LayerBakeParameters {
  const tile = finite(layer.matTile, 1) * finite(layer.tilingMultiplier, 1);
  const mask = colourMaskLevels(layer.colorMaskLevelsIn, layer.colorMaskLevelsOut);
  return { index, opacity: Math.max(0, finite(layer.opacity, 0)), tile, offset: [finite(layer.offsetU, 0), finite(layer.offsetV, 0)],
    mbTile: finite(layer.mbTile, 1), mbOffset: [finite(layer.microblendOffsetU, 0), finite(layer.microblendOffsetV, 0)],
    mbContrast: microblendContrastFactor(layer.microblendContrast), mbNormal: finite(layer.microblendNormalStrength, 0),
    colour: layer.colorScale.map(c => finite(c, 1)) as Rgb, normalStrength: finite(layer.normalStrength, 0),
    roughIn: layer.roughLevelsIn, roughOut: layer.roughLevelsOut, metalIn: layer.metalLevelsIn, metalOut: layer.metalLevelsOut,
    colourMaskIn: mask.in, colourMaskOut: mask.out,
    maps: { color: !!layer.textures.color, normal: !!layer.textures.normal, roughness: !!layer.textures.roughness, metalness: !!layer.textures.metalness,
      microblend: !!layer.textures.microblend, mask: !!layer.textures.mask } };
}

/**
 * The layers the bake draws, **front to back** (the program's order): every masked layer that has mask data and a visible opacity,
 * from the highest index down, then the bottom layer (index 0, full mask). A layer at zero opacity adds nothing; a masked layer whose
 * mask layer is absent has no coverage anywhere (as a tile without that layer's bit).
 */
export function bakeOrder(layered: RenderLayered): LayerBakeParameters[] {
  const layers = layered.layers.map(layerBakeParameters);
  const masked = layers.slice(1).filter(layer => layer.opacity > 0 && layer.maps.mask).reverse();
  return layers[0] && layers[0].opacity > 0 ? [...masked, layers[0]] : masked;
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
 * Final pass: the accumulated layers as the lit material's three maps: linear base colour, the tangent normal (game frame) with the
 * mesh-wide normal under it, and roughness (G) / metalness (B).
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
layout( location = 2 ) out highp vec4 oSurface;
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
	oColour = vec4( max( acc0.rgb, vec3( 0.0 ) ), 1.0 );
	oNormal = vec4( n * 0.5 + 0.5, 1.0 );
	oSurface = vec4( 1.0, clamp( acc1.x, 0.0, 1.0 ), clamp( acc1.y, 0.0, 1.0 ), 1.0 );
}`;

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
  globalNormal: boolean; error?: string };
export type LayeredHandle = {
  readonly state: "pending" | "baked" | "failed";
  /** Bake the stack with this renderer (once). Returns false if it failed; the chunk is then left out. */
  bake(renderer: THREE.WebGLRenderer): boolean;
  /** Plain data for the developer evidence. */
  evidence(): LayeredEvidence;
  /** The baked maps (colour, normal, roughness/metalness) once baked: read by the real-GPU test. */
  readonly target: THREE.WebGLRenderTarget | null;
};

/** The chunk-wide values a layered chunk's template instance sets (the record carries scalars; vectors fall back to identity). */
export function layeredGlobals(chunk: Pick<RenderChunkMaterial, "scalars">, layered: RenderLayered): Omit<LayeredGlobals, "normal"> {
  const scalar = (name: string, fallback: number) => Number.isFinite(chunk.scalars[name]) ? chunk.scalars[name]! : fallback;
  const scale = scalar("GlobalNormalUVScale", 1), bias = scalar("GlobalNormalUVBias", 0);
  return { ratio: finite(layered.ratio, 1) > 0 ? layered.ratio : 1, normalIntensity: scalar("GlobalNormalIntensity", 1),
    normalUvScale: [scale, scale], normalUvBias: [bias, bias] };
}

/** Bake size limits in texels: the smallest bake, the usual one, and the largest (a part whose UVs span several tiles, like the eye). */
export const BAKE_SIZE = { min: 256, usual: 1024, max: 2048 } as const;
/**
 * The bake's side: enough for the finest mask layer over the baked UV range and for the usual texel density of a one-tile part,
 * within `BAKE_SIZE`, as a power of two.
 */
export function layeredBakeSize(layered: RenderLayered, domain: LayeredInput["domain"]): number {
  const span = Math.max(domain.max[0] - domain.min[0], domain.max[1] - domain.min[1], 1e-3);
  const mask = Math.max(0, ...layered.layers.map(layer => Math.max(layer.textures.mask?.width ?? 0, layer.textures.mask?.height ?? 0)));
  const wanted = Math.max(mask * Math.min(span, 4), BAKE_SIZE.usual * Math.min(span, 2));
  return Math.min(BAKE_SIZE.max, Math.max(BAKE_SIZE.min, 2 ** Math.ceil(Math.log2(Math.max(1, wanted)))));
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

/** Why a bake can't run here: it needs float colour targets (accumulated normals are signed and coverage sums exceed 1). */
export const bakeUnsupported = (renderer: THREE.WebGLRenderer): string | null =>
  renderer.capabilities.isWebGL2 === false ? "WebGL 2 is required" : !renderer.extensions?.has?.("EXT_color_buffer_float") ? "float render targets are unavailable" : null;

/**
 * The layered material: a standard metal/rough material whose maps the handle bakes from the stack once. Until the bake runs the
 * material is invisible (so nothing unbaked is ever drawn). The game's tangent normal has its green along the game's V, which runs
 * opposite the exported UV's V, so the lit material reads it with Y negated (as the core head's normal map).
 */
export function createLayeredMaterial(input: LayeredInput): { material: THREE.MeshStandardMaterial; handle: LayeredHandle } {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1, visible: false });
  material.name = "xfs_layered";
  material.normalScale.set(1, -1);
  let state: "pending" | "baked" | "failed" = "pending", error: string | undefined;
  let result: THREE.WebGLRenderTarget | null = null;
  // The baked maps live as long as the material: whoever disposes the material (the loader, per V) releases them.
  material.addEventListener("dispose", () => { result?.dispose(); result = null; });
  const { min, max } = input.domain;
  const domain = new THREE.Vector4(min[0], min[1], max[0] - min[0], max[1] - min[1]);
  const handle: LayeredHandle = {
    get state() { return state; },
    get target() { return result; },
    bake(renderer) {
      if (state !== "pending") return state === "baked";
      const unsupported = bakeUnsupported(renderer);
      if (unsupported) { state = "failed"; error = unsupported; return false; }
      const targets: THREE.WebGLRenderTarget[] = [];
      const quad = new THREE.BufferGeometry();
      quad.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
      const pass = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: PASS_VERTEX, fragmentShader: LAYER_FRAGMENT,
        depthTest: false, depthWrite: false, uniforms: {
          uAcc0: { value: null }, uAcc1: { value: null }, uAcc2: { value: null }, uColour: { value: white() }, uNormal: { value: white() },
          uRoughness: { value: white() }, uMetalness: { value: white() }, uMicroblend: { value: white() }, uMask: { value: white() },
          uDomain: { value: domain }, uTint: { value: new THREE.Vector3() }, uTile: { value: new THREE.Vector4() }, uMicro: { value: new THREE.Vector4() },
          uRough: { value: new THREE.Vector4() }, uMetal: { value: new THREE.Vector4() }, uColourMask: { value: new THREE.Vector4() },
          uLayer: { value: new THREE.Vector4() }, uMaps0: { value: new THREE.Vector4() }, uMaps1: { value: new THREE.Vector2() } } });
      const g = input.globals;
      const resolve = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: PASS_VERTEX, fragmentShader: RESOLVE_FRAGMENT,
        depthTest: false, depthWrite: false, uniforms: { uAcc0: { value: null }, uAcc1: { value: null }, uAcc2: { value: null },
          uGlobalNormal: { value: g.normal ?? white() }, uDomain: { value: domain },
          uGlobalUv: { value: new THREE.Vector4(g.normalUvScale[0], g.normalUvScale[1], g.normalUvBias[0], g.normalUvBias[1]) },
          uGlobal: { value: new THREE.Vector2(g.normalIntensity, g.normal ? 1 : 0) } } });
      const mesh = new THREE.Mesh(quad, pass);
      mesh.frustumCulled = false;
      const scene = new THREE.Scene(), camera = new THREE.Camera();
      scene.add(mesh);
      const previousTarget = renderer.getRenderTarget(), autoClear = renderer.autoClear;
      const clearColour = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
      try {
        const accumulate = () => new THREE.WebGLRenderTarget(input.size, input.size, { count: 3, type: THREE.FloatType, format: THREE.RGBAFormat,
          depthBuffer: false, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
        targets.push(accumulate(), accumulate());
        renderer.autoClear = false;
        // Before the first layer: nothing accumulated, all coverage remaining (alpha of the first target), zero normals.
        renderer.setRenderTarget(targets[0]!);
        renderer.setClearColor(0x000000, 0);
        renderer.clear(true, false, false);
        const clearFirst = new THREE.Mesh(quad, new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: PASS_VERTEX, depthTest: false, depthWrite: false,
          fragmentShader: `precision highp float;\nlayout( location = 0 ) out highp vec4 o0;\nlayout( location = 1 ) out highp vec4 o1;\nlayout( location = 2 ) out highp vec4 o2;\nvoid main() { o0 = vec4( 0.0, 0.0, 0.0, 1.0 ); o1 = vec4( 0.0 ); o2 = vec4( 0.0 ); }` }));
        clearFirst.frustumCulled = false;
        const clearScene = new THREE.Scene();
        clearScene.add(clearFirst);
        renderer.render(clearScene, camera);
        (clearFirst.material as THREE.Material).dispose();
        let from = 0;
        const u = pass.uniforms;
        input.layers.forEach(({ parameters: layer, textures }, order) => {
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
          renderer.setRenderTarget(targets[to]!);
          renderer.render(scene, camera);
          from = to;
        });
        result = new THREE.WebGLRenderTarget(input.size, input.size, { count: 3, type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
          generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
        resolve.uniforms.uAcc0!.value = targets[from]!.textures[0];
        resolve.uniforms.uAcc1!.value = targets[from]!.textures[1];
        resolve.uniforms.uAcc2!.value = targets[from]!.textures[2];
        mesh.material = resolve;
        renderer.setRenderTarget(result);
        renderer.render(scene, camera);
        // The lit material samples the maps over the baked UV range: uv' = (uv − min) / (max − min).
        const repeat = new THREE.Vector2(1 / (max[0] - min[0]), 1 / (max[1] - min[1]));
        const offset = new THREE.Vector2(-min[0] * repeat.x, -min[1] * repeat.y);
        const [colour, normal, surface] = result.textures as [THREE.Texture, THREE.Texture, THREE.Texture];
        for (const texture of [colour, normal, surface]) {
          texture.repeat.copy(repeat); texture.offset.copy(offset); texture.name = "xfs_layered_bake";
          texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
        }
        material.map = colour;
        material.normalMap = normal;
        material.roughnessMap = surface;
        material.metalnessMap = surface;
        material.visible = true;
        material.needsUpdate = true;
        state = "baked";
      } catch (reason) {
        state = "failed";
        error = (reason as Error).message;
        result?.dispose();
        result = null;
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(clearColour, clearAlpha);
        renderer.autoClear = autoClear;
        for (const target of targets) target.dispose();
        quad.dispose(); pass.dispose(); resolve.dispose();
      }
      return state === "baked";
    },
    evidence: () => ({ state, size: input.size, layers: input.layers.map(entry => entry.parameters.index),
      domain: { min: [...min] as [number, number], max: [...max] as [number, number] }, globalNormal: !!input.globals.normal, ...(error ? { error } : {}) }),
  };
  return { material, handle };
}
