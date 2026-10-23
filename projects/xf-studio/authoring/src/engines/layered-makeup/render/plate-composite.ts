import * as THREE from "three";
import { compositeTargetSize, MODE1_FULL_TILT, FACET_ZERO, type BlendWindow } from "./plate-blend";
import { halfFloatRenderable } from "../../../preview/render/linear-display";
import { linkedPrograms, releaseShadersWithPrograms } from "../../../materials/render/linked-programs";

/**
 * The makeup plate's composite pass (renderer adapter): the export's merged decal and its faceted mip chain, drawn on the GPU
 * over the plate's UV rectangle (plate-blend.ts has the arithmetic and the lit plate that reads this).
 *
 * One update, only when a layer or the plan changed (nothing per frame):
 * 1. **Layers.** One small draw per included layer, in order, as premultiplied "over" into an accumulation target (no mips):
 *    √colour, roughness, metalness and the facet normal, each times coverage, and the coverage (preset-compiler.ts `accumulate`).
 * 2. **Resolve.** One draw writes the merged decal as the export stores it (preset-compiler.ts `encodeSurface`): the premultiplied
 *    colour, roughness and metalness with the coverage, the merged normal per texel (premultiplied normal / coverage, rounded to
 *    the export's UNORM bytes; flat texels are the flat byte), and that normal's squared length. The GPU then builds the mips of
 *    this target once: plain box means, which are the export's means (route-mip-chains.ts `facetedMipChain`): coverage-weighted
 *    colour, roughness and metalness (the flat chain's contributions), and the plain means of the normal and its moment.
 * 3. **Roughness chain.** One draw per level writes the export's roughness bytes for that level: level 0 is the merged roughness
 *    unchanged; lower levels widen the level's coverage-weighted roughness r by the facet variance the averaging lost,
 *    (r⁴ + max(0, E[|n|²] − |E[n]|²))^¼, zero where nothing covers. The plate samples this chain as the game samples the exported
 *    roughness map, so the widening follows the mip level and never appears between texel centres at level 0.
 *
 * Every program writes one output (profiles phase 4a-v-c): the layers and the resolve are drawn once per target, because ANGLE on Direct3D 11
 * builds a program that writes several outputs again at its first draw, on the GPU process's main thread, with no frame presented meanwhile
 * (experiment 043 §12). Each target gets exactly what one draw into all three wrote there: the blend is per target.
 *
 * Half-float targets when the GPU can render them, otherwise 8-bit (the merged values then carry 8-bit steps per layer; see
 * tests/webgl-plate-composite.test.ts: within 2 byte steps of the export). The chain equals `facetedMipChain` at texel centres of power-of-two sizes;
 * other sizes use the GPU's own reduction of odd edges.
 */

const blankTexture = (rgba: number[]) => {
  const texture = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
  texture.needsUpdate = true;
  return texture;
};
/** Nothing (all zero), the neutral surface map (all one) and a flat normal. Shared, never disposed. */
const IDENTITY = new THREE.Matrix3();
const NOTHING = blankTexture([0, 0, 0, 0]), NEUTRAL_MAP = blankTexture([255, 255, 255, 255]), FLAT_NORMAL = blankTexture([128, 128, 255, 255]);

const PASS_VERTEX = /* glsl */`
uniform vec4 uWindow;
varying vec2 vUv;
void main() {
	vUv = uWindow.xy + ( position.xy * 0.5 + 0.5 ) * uWindow.zw;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;
/** Full-target passes that read texels by position (`texelFetch`), so no filtering or UVs are involved. */
const TEXEL_VERTEX = /* glsl */`void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

/** The composite's three targets, in order: colour, surface (roughness, metalness) and the facet normal. */
type CompositeTarget = 0 | 1 | 2;
const TARGETS: readonly CompositeTarget[] = [0, 1, 2];
/**
 * One layer's premultiplied contribution to target `target`, read exactly as its own plate reads it (colour × mask, roughness and metalness
 * × maps, the facet normal of a faceted layer, its mode-1 fade undone). Normals are stored offset (x / 2 + ½) so an 8-bit target holds them.
 * `xfsUnfade` mirrors plate-blend.ts `unfadeFacet`.
 */
const layerFragment = (target: CompositeTarget) => /* glsl */`
precision highp float;
uniform sampler2D uMask;
uniform sampler2D uRoughnessMap;
uniform sampler2D uMetalnessMap;
uniform sampler2D uNormalMap;
uniform mat3 uMapTransform;
uniform vec3 uColour;
uniform vec3 uSurface;
varying vec2 vUv;
layout( location = 0 ) out highp vec4 oTarget;
vec2 xfsUnfade( vec2 xy ) {
	xy = mix( xy, vec2( 0.0 ), step( abs( xy ), vec2( ${FACET_ZERO} ) ) );
	float t = length( xy ), full = ${MODE1_FULL_TILT.toFixed(8)};
	if ( t <= 0.0 || t >= full ) return xy;
	float lo = t, hi = full;
	for ( int i = 0; i < 20; i++ ) {
		float mid = 0.5 * ( lo + hi );
		if ( mid * clamp( 50.0 - 50.0 * sqrt( max( 1.0 - mid * mid, 0.0 ) ), 0.0, 1.0 ) < t ) lo = mid; else hi = mid;
	}
	return xy * ( 0.5 * ( lo + hi ) / t );
}
void main() {
	vec4 mask = textureLod( uMask, vUv, 0.0 );
	float a = clamp( mask.a, 0.0, 1.0 );
	vec3 colour = max( uColour * mask.rgb, vec3( 0.0 ) );
	// The optical maps' own UV: head UV, or a window of it (Shimmer's grain), by the maps' texture transform.
	vec2 mapUv = ( uMapTransform * vec3( vUv, 1.0 ) ).xy;
	float roughness = clamp( uSurface.x * textureLod( uRoughnessMap, mapUv, 0.0 ).g, 0.0, 1.0 );
	float metalness = clamp( uSurface.y * textureLod( uMetalnessMap, mapUv, 0.0 ).b, 0.0, 1.0 );
	vec2 facet = uSurface.z > 0.5 ? xfsUnfade( clamp( textureLod( uNormalMap, mapUv, 0.0 ).xy * 2.0 - 1.0, -1.0, 1.0 ) ) : vec2( 0.0 );
	oTarget = ${["vec4( a * sqrt( colour ), a )", "vec4( a * roughness, a * metalness, 0.0, a )", "vec4( a * ( facet * 0.5 + 0.5 ), 0.0, a )"][target]};
}`;

/** The merged decal per texel for target `target`, as the export encodes it (preset-compiler.ts `encodeSurface`), with the normal's moment. */
const resolveFragment = (target: CompositeTarget) => /* glsl */`
precision highp float;
uniform sampler2D uColour;
uniform sampler2D uSurface;
uniform sampler2D uNormal;
layout( location = 0 ) out highp vec4 oTarget;
void main() {
	ivec2 p = ivec2( gl_FragCoord.xy );
	vec4 colour = texelFetch( uColour, p, 0 ), surface = texelFetch( uSurface, p, 0 ), normal = texelFetch( uNormal, p, 0 );
	float coverage = colour.a;
	// The export's normal bytes: floor(clip01(x / 2 + ½) · 255 + ½), the flat byte where nothing covers.
	vec2 encoded = coverage > 0.0 ? clamp( normal.xy / coverage, 0.0, 1.0 ) : vec2( 0.5 );
	encoded = floor( encoded * 255.0 + 0.5 ) / 255.0;
	vec2 facet = encoded * 2.0 - 1.0;
	oTarget = ${["colour", "vec4( surface.xy, dot( facet, facet ), coverage )", "vec4( encoded, 0.0, 1.0 )"][target]};
}`;

/** One level of the export's faceted roughness chain (route-mip-chains.ts `facetedMipChain`). */
const ROUGHNESS_FRAGMENT = /* glsl */`
precision highp float;
uniform sampler2D uSurface;
uniform sampler2D uNormal;
uniform int uLevel;
layout( location = 0 ) out highp vec4 oRoughness;
void main() {
	ivec2 p = ivec2( gl_FragCoord.xy );
	vec4 surface = texelFetch( uSurface, p, uLevel );
	float coverage = surface.w, roughness = 0.0;
	if ( coverage > 0.0 ) {
		float r = clamp( surface.x / coverage, 0.0, 1.0 ), variance = 0.0;
		if ( uLevel > 0 ) {
			vec2 mean = texelFetch( uNormal, p, uLevel ).xy * 2.0 - 1.0;
			variance = max( 0.0, surface.z - dot( mean, mean ) );
		}
		roughness = clamp( sqrt( sqrt( r * r * r * r + variance ) ), 0.0, 1.0 );
	}
	oRoughness = vec4( roughness, 0.0, 0.0, 1.0 );
}`;

/** What the composite reads from one included layer: its own plate material (colour, mask, surface and facet maps). */
export type CompositeLayer = THREE.MeshPhysicalMaterial;
/** What the lit plate samples: the merged colour, surface and normal (with mips) and the roughness chain. */
export type CompositeTextures = { colour: THREE.Texture; surface: THREE.Texture; normal: THREE.Texture; roughness: THREE.Texture };
export type CompositePrecision = "auto" | "8-bit";

/** Levels of a complete chain for a `width` × `height` target (the GPU's: halve with floor down to 1 × 1). */
export const compositeLevels = (width: number, height: number) => Math.floor(Math.log2(Math.max(width, height, 1))) + 1;

/**
 * The merged decal of the included layers over the plate's UV rectangle. `update` redraws it (only when called: the stack calls
 * it when a layer or the plan changed). `precision: "8-bit"` forces the 8-bit targets (tests).
 */
export function createPlateComposite(window: BlendWindow, options: { precision?: CompositePrecision } = {}) {
  const quad = new THREE.PlaneGeometry(2, 2);
  const shared = { depthTest: false, depthWrite: false, glslVersion: THREE.GLSL3 } as const;
  const layerUniforms = { uWindow: { value: new THREE.Vector4(window.u0, window.v0, window.u1 - window.u0, window.v1 - window.v0) },
    uMask: { value: NOTHING as THREE.Texture }, uRoughnessMap: { value: NEUTRAL_MAP as THREE.Texture },
    uMetalnessMap: { value: NEUTRAL_MAP as THREE.Texture }, uNormalMap: { value: FLAT_NORMAL as THREE.Texture },
    uMapTransform: { value: new THREE.Matrix3() }, uColour: { value: new THREE.Color() }, uSurface: { value: new THREE.Vector3() } };
  const layerPasses = TARGETS.map(target => new THREE.ShaderMaterial({ ...shared, vertexShader: PASS_VERTEX, fragmentShader: layerFragment(target),
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, uniforms: layerUniforms }));
  const resolveUniforms = { uColour: { value: null as THREE.Texture | null }, uSurface: { value: null as THREE.Texture | null }, uNormal: { value: null as THREE.Texture | null } };
  const resolvePasses = TARGETS.map(target => new THREE.ShaderMaterial({ ...shared, vertexShader: TEXEL_VERTEX, fragmentShader: resolveFragment(target),
    blending: THREE.NoBlending, uniforms: resolveUniforms }));
  const roughnessPass = new THREE.ShaderMaterial({ ...shared, vertexShader: TEXEL_VERTEX, fragmentShader: ROUGHNESS_FRAGMENT, blending: THREE.NoBlending,
    uniforms: { uSurface: { value: null }, uNormal: { value: null }, uLevel: { value: 0 } } });
  const mesh = new THREE.Mesh(quad, layerPasses[0]);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene(), camera = new THREE.Camera();
  scene.add(mesh);
  /** `accumulate` and `merged`: one target each for colour, surface and normal. */
  type Targets = { accumulate: THREE.WebGLRenderTarget[]; merged: THREE.WebGLRenderTarget[]; roughness: THREE.WebGLRenderTarget; levels: number };
  let targets: Targets | null = null, halfFloat = false;
  const stats = { layerDraws: 0, resolves: 0, levelDraws: 0 };

  const texturesOf = (from: Targets): CompositeTextures => {
    const [colour, surface, normal] = from.merged.map(target => target.texture) as [THREE.Texture, THREE.Texture, THREE.Texture];
    return { colour, surface, normal, roughness: from.roughness.texture };
  };
  function release() {
    if (!targets) return;
    for (const target of [...targets.accumulate, ...targets.merged, targets.roughness]) target.dispose();
    targets = null;
  }
  function ensure(renderer: THREE.WebGLRenderer, size: { width: number; height: number }, anisotropy: number): Targets {
    const half = options.precision !== "8-bit" && halfFloatRenderable(renderer.extensions);
    if (targets && targets.roughness.width === size.width && targets.roughness.height === size.height && half === halfFloat) return targets;
    release();
    halfFloat = half;
    const type = half ? THREE.HalfFloatType : THREE.UnsignedByteType, { width, height } = size;
    const base = { type, format: THREE.RGBAFormat, depthBuffer: false } as const;
    const accumulate = TARGETS.map(() => new THREE.WebGLRenderTarget(width, height, { ...base, generateMipmaps: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }));
    // Mips once, after the resolve: the renderer generates them after a draw into level 0 of a target that asks for them.
    const merged = TARGETS.map(() => new THREE.WebGLRenderTarget(width, height, { ...base, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter }));
    // Drawn level by level: every level's storage and framebuffer are allocated up front (the mip list's length is what counts).
    const roughness = new THREE.WebGLRenderTarget(width, height, { ...base, generateMipmaps: false,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    const levels = compositeLevels(width, height);
    roughness.texture.mipmaps = Array.from({ length: levels }, (_, level) =>
      ({ data: null, width: Math.max(1, width >> level), height: Math.max(1, height >> level) })) as unknown as typeof roughness.texture.mipmaps;
    // Only the channels each attachment carries: the normals are two (X, Y), the roughness chain one.
    accumulate[2]!.texture.format = merged[2]!.texture.format = THREE.RGFormat;
    roughness.texture.format = THREE.RedFormat;
    for (const [list, name, filtered] of [[accumulate, "xfs_plate_accumulate", false], [merged, "xfs_plate_composite", true],
      [[roughness], "xfs_plate_roughness", true]] as const)
      for (const { texture } of list) { texture.name = name; texture.anisotropy = filtered ? anisotropy : 1; }
    targets = { accumulate, merged, roughness, levels };
    return targets;
  }

  return {
    window,
    /** The textures the lit plate samples, or null before the first update (and after `release`). */
    get textures(): CompositeTextures | null { return targets ? texturesOf(targets) : null; },
    /** The composite's size (the merged targets'), or null. */
    get size() { return targets ? { width: targets.roughness.width, height: targets.roughness.height, levels: targets.levels } : null; },
    /** Draws since creation: one per layer (into each of the three targets), one resolve (likewise) and one per roughness level per update. */
    get stats() { return { ...stats }; },
    /** Redraw the composite from `layers` in stack order; `maskSize` is the texel density (per unit of UV) to composite at: the masks'
     * side, or a grain's pitch when a layer's optical maps are finer. Returns the textures the plate samples. */
    update(renderer: THREE.WebGLRenderer, layers: readonly CompositeLayer[], maskSize: number, anisotropy = 1): CompositeTextures {
      const into = ensure(renderer, compositeTargetSize(maskSize, window, renderer.capabilities.maxTextureSize), anisotropy);
      const previousTarget = renderer.getRenderTarget(), autoClear = renderer.autoClear;
      const clearColour = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
      renderer.autoClear = false;
      renderer.setClearColor(0x000000, 0);
      try {
        // 1. The layers, premultiplied "over", into each accumulation target in turn.
        const u = layerUniforms;
        for (const target of TARGETS) {
          mesh.material = layerPasses[target]!;
          renderer.setRenderTarget(into.accumulate[target]!);
          renderer.clear(true, false, false);
          for (const layer of layers) {
            u.uMask.value = layer.map ?? NOTHING;
            u.uRoughnessMap.value = layer.roughnessMap ?? NEUTRAL_MAP;
            u.uMetalnessMap.value = layer.metalnessMap ?? NEUTRAL_MAP;
            u.uNormalMap.value = layer.normalMap ?? FLAT_NORMAL;
            // A layer's normal and surface maps share one grid (head UV, or the grain's window).
            const maps = layer.normalMap ?? layer.roughnessMap;
            u.uMapTransform.value.copy(maps ? maps.matrix : IDENTITY);
            u.uColour.value.copy(layer.color);
            u.uSurface.value.set(layer.roughness, layer.metalness, layer.normalMap ? 1 : 0);
            renderer.render(scene, camera);
          }
        }
        stats.layerDraws += layers.length;
        // 2. The merged decal per texel, into each merged target; their mips follow once each.
        [resolveUniforms.uColour.value, resolveUniforms.uSurface.value, resolveUniforms.uNormal.value] = into.accumulate.map(target => target.texture);
        for (const target of TARGETS) {
          mesh.material = resolvePasses[target]!;
          renderer.setRenderTarget(into.merged[target]!);
          renderer.render(scene, camera);
        }
        stats.resolves++;
        // 3. The roughness chain, level by level, from the merged targets' own mips.
        roughnessPass.uniforms.uSurface!.value = into.merged[1]!.texture;
        roughnessPass.uniforms.uNormal!.value = into.merged[2]!.texture;
        mesh.material = roughnessPass;
        const { width, height } = into.roughness;
        try {
          for (let level = 0; level < into.levels; level++) {
            roughnessPass.uniforms.uLevel!.value = level;
            into.roughness.viewport.set(0, 0, Math.max(1, width >> level), Math.max(1, height >> level));
            renderer.setRenderTarget(into.roughness, 0, level);
            renderer.render(scene, camera);
            stats.levelDraws++;
          }
        } finally { into.roughness.viewport.set(0, 0, width, height); }
      } finally {
        mesh.material = layerPasses[0]!;
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(clearColour, clearAlpha);
        renderer.autoClear = autoClear;
      }
      return texturesOf(into);
    },
    /**
     * Compile the composite's passes ahead (profiles phase 4a-v), each bound to a target as `update` binds one, so its first update links
     * nothing on the page's thread. Three's `compileAsync`: resolves once the driver has linked them. Released unused (the scene
     * goes before its first composite), their shaders go with them (`releaseShadersWithPrograms`).
     */
    compile(renderer: THREE.WebGLRenderer): Promise<void> {
      const previousTarget = renderer.getRenderTarget(), stand = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
      const pending: Promise<unknown>[] = [], passes = [...layerPasses, ...resolvePasses, roughnessPass];
      try {
        renderer.setRenderTarget(stand);
        for (const pass of passes) { mesh.material = pass; pending.push(renderer.compileAsync(scene, camera)); }
      } finally {
        mesh.material = layerPasses[0]!;
        renderer.setRenderTarget(previousTarget);
        stand.dispose();
      }
      releaseShadersWithPrograms(renderer, linkedPrograms(renderer, passes));
      return Promise.all(pending).then(() => undefined);
    },
    /** GPU bytes held by the composite: the accumulation targets (10 channels), and the merged targets (10) and roughness chain (1) with their mips. */
    bytes() {
      if (!targets) return 0;
      const channel = halfFloat ? 2 : 1, { width, height } = targets.roughness;
      return Math.round(width * height * channel * (10 + 11 * 4 / 3));
    },
    get halfFloat() { return halfFloat; },
    release,
    dispose() { release(); quad.dispose(); for (const pass of [...layerPasses, ...resolvePasses, roughnessPass]) pass.dispose(); },
  };
}
