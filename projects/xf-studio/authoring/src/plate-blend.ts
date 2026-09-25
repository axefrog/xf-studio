import * as THREE from "three";
import { forwardDecal, forwardSurface, type Rgb } from "./face-decal-material";

/**
 * The Studio's authored makeup plate, blended over the skin the way the exported plate will be (renderer adapter).
 *
 * What the game does with the export [source: preset-compiler.ts and the decompiled `mesh_decal`; knowledge/materials-and-shaders.md
 * §2.4]: a preset's exportable layers merge into one decal texture, in square-root colour space, premultiplied, in layer order
 * (`accumulate`), and the colour-map alpha stores √coverage, so the template's squared coverage is the merged coverage again. The
 * decal then blends `sqrt(colour)` over the skin's `sqrt(colour)` in the G-buffer at that coverage, and roughness and metalness
 * linearly at the same coverage (`RoughnessMetalnessAlpha` 1). Because premultiplied "over" is associative, that single draw equals
 * blending each layer in turn, in square-root space, over everything below it: skin, then the layers under it.
 *
 * What the preview does [approximation]: it keeps one lit plate per layer (so each finish keeps its own preview model) and draws each
 * as an ordinary forward "over" whose colour and alpha are solved so the blend lands on that square-root result exactly per channel
 * (`forwardDecal`, as the face decals do). The layer needs what is under it: the skin's colour, roughness and metalness per plate
 * vertex (the same underlay the face decals read, `head-skin-placement.ts`), and the layers below it, which a UV-space pass
 * accumulates once per change into a small target per layer (the premultiplied square-root colour, roughness, metalness and
 * coverage of every blended layer below; the plate's own UV rectangle only). Roughness and metalness move from the surface below
 * towards the layer's by its coverage's share of the drawn alpha (`forwardSurface`), so the layer writes its surface at its coverage
 * as the export does.
 *
 * Limits: the skin under the plate is known per vertex (texel detail between vertices shows through at 1 − alpha, exact for black);
 * each plate is lit on its own rather than once with the blended surface (the forward approximation of a G-buffer); a Colour-shifting
 * layer's view-dependent tint is not part of what the layers above see; and preview-only models (Glitter, the earlier Glossy clear coat
 * and thin-film study) keep their plain linear blend and are not part of what the layers above see, because the game never draws them.
 * The solve is in linear light, so it holds where the pass blends in linear light: both lighting presets draw into the display's
 * scene-linear target (linear-display.ts); a GPU without a renderable half-float buffer draws straight to the canvas and is approximate.
 */

/** A UV rectangle: the plate's own bounds, which the per-layer "below" targets cover. */
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

/** Texels of a "below" target: the layer masks' own texel density over the window (masks span the whole atlas). */
export function belowTargetSize(maskSize: number, window: BlendWindow, maxSize: number): { width: number; height: number } {
  const side = (span: number) => Math.min(maxSize, Math.max(1, Math.ceil(maskSize * span - 1e-9)));
  return { width: side(window.u1 - window.u0), height: side(window.v1 - window.v0) };
}

/** One layer at one texel: its linear colour, coverage (mask alpha, opacity included) and the surface it writes. */
export type PlateTexel = { colour: Readonly<Rgb>; coverage: number; roughness: number; metalness: number };
/** The layers below one texel, premultiplied: √colour, roughness and metalness times coverage, and the coverage. */
export type PlatePrefix = { sqrtColour: Rgb; roughness: number; metalness: number; coverage: number };
export const EMPTY_PREFIX: Readonly<PlatePrefix> = Object.freeze({ sqrtColour: [0, 0, 0] as Rgb, roughness: 0, metalness: 0, coverage: 0 });
export type PlateSkin = { colour: Readonly<Rgb>; roughness: number; metalness: number };

/** The prefix pass's arithmetic: premultiplied "over" in square-root colour space (preset-compiler.ts `accumulate`). */
export function accumulatePrefix(below: Readonly<PlatePrefix>, layer: PlateTexel): PlatePrefix {
  const a = Math.min(1, Math.max(0, layer.coverage)), keep = 1 - a;
  return { sqrtColour: layer.colour.map((c, k) => a * Math.sqrt(Math.max(c, 0)) + keep * below.sqrtColour[k]!) as Rgb,
    roughness: a * layer.roughness + keep * below.roughness, metalness: a * layer.metalness + keep * below.metalness,
    coverage: a + keep * below.coverage };
}

/** What the plate shader draws for one layer: the forward colour, alpha and surface over the skin and the layers below. */
export function plateForward(skin: PlateSkin, below: Readonly<PlatePrefix>, layer: PlateTexel): { colour: Rgb; alpha: number; roughness: number; metalness: number } {
  const keep = 1 - below.coverage;
  const under = below.sqrtColour.map((s, k) => (s + keep * Math.sqrt(Math.max(skin.colour[k]!, 0))) ** 2) as Rgb;
  const solved = forwardDecal(layer.colour, layer.coverage, under);
  const surface = forwardSurface({ roughness: below.roughness + keep * skin.roughness, metalness: below.metalness + keep * skin.metalness },
    layer, layer.coverage, solved.alpha);
  return { colour: solved.color, alpha: solved.alpha, ...surface };
}

const blankTexture = (value: number) => {
  const texture = new THREE.DataTexture(new Uint8Array([value, value, value, value]), 1, 1);
  texture.needsUpdate = true;
  return texture;
};
/** Nothing below (all zero), and the neutral surface map (all one). Shared, never disposed. */
const NOTHING_BELOW = blankTexture(0), NEUTRAL_MAP = blankTexture(255);

const VERTEX_DECLARATIONS = /* glsl */`
#ifdef XFS_PLATE_SQRT
attribute vec3 xfsUnderlay;
attribute float xfsUnderRoughness;
attribute float xfsUnderMetalness;
varying vec3 vXfsPlateUnder;
varying vec2 vXfsPlateSurface;
varying vec2 vXfsPlateUv;
#endif`;
const VERTEX_BODY = /* glsl */`
#ifdef XFS_PLATE_SQRT
vXfsPlateUnder = xfsUnderlay;
vXfsPlateSurface = vec2( xfsUnderRoughness, xfsUnderMetalness );
vXfsPlateUv = uv;
#endif`;
const FRAGMENT_DECLARATIONS = /* glsl */`
#ifdef XFS_PLATE_SQRT
uniform sampler2D xfsBelowColour;
uniform sampler2D xfsBelowSurface;
uniform vec4 xfsBelowWindow;
varying vec3 vXfsPlateUnder;
varying vec2 vXfsPlateSurface;
varying vec2 vXfsPlateUv;
#endif`;
/**
 * Before the lighting reads the surface: the layer's colour (after any Colour-shifting tint, which the game adds before its square
 * root) and coverage become the forward colour and alpha of the square-root blend over the skin and the layers below.
 */
const SOLVE = /* glsl */`
#ifdef XFS_PLATE_SQRT
{
	float xfsA = clamp( diffuseColor.a, 0.0, 1.0 );
	vec3 xfsC = max( diffuseColor.rgb, vec3( 0.0 ) );
	vec2 xfsBelowUv = ( vXfsPlateUv - xfsBelowWindow.xy ) * xfsBelowWindow.zw;
	vec4 xfsBelow = texture2D( xfsBelowColour, xfsBelowUv );
	vec4 xfsBelowS = texture2D( xfsBelowSurface, xfsBelowUv );
	vec3 xfsSqrtUnder = xfsBelow.rgb + ( 1.0 - xfsBelow.a ) * sqrt( max( vXfsPlateUnder, vec3( 0.0 ) ) );
	vec3 xfsUnder = xfsSqrtUnder * xfsSqrtUnder;
	vec3 xfsRoot = xfsA * sqrt( xfsC ) + ( 1.0 - xfsA ) * xfsSqrtUnder;
	vec3 xfsTarget = xfsRoot * xfsRoot;
	vec3 xfsGap = xfsUnder - xfsC;
	vec3 xfsNeeded = mix( vec3( 0.0 ), ( xfsUnder - xfsTarget ) / max( xfsGap, vec3( 1e-6 ) ), step( vec3( 1e-6 ), xfsGap ) );
	float xfsDrawn = clamp( max( xfsA, max( xfsNeeded.r, max( xfsNeeded.g, xfsNeeded.b ) ) ), 0.0, 1.0 );
	float xfsShare = xfsDrawn > 0.0 ? clamp( xfsA / xfsDrawn, 0.0, 1.0 ) : 0.0;
	if ( xfsDrawn > 0.0 ) diffuseColor.rgb = max( vec3( 0.0 ), ( xfsTarget - ( 1.0 - xfsDrawn ) * xfsUnder ) / xfsDrawn );
	vec2 xfsUnderSurface = xfsBelowS.rg + ( 1.0 - xfsBelowS.a ) * vXfsPlateSurface;
	roughnessFactor = mix( xfsUnderSurface.x, roughnessFactor, xfsShare );
	metalnessFactor = mix( xfsUnderSurface.y, metalnessFactor, xfsShare );
	diffuseColor.a = xfsDrawn;
}
#endif
#include <lights_physical_fragment>`;

/** Patch a plate's `MeshPhysicalMaterial` program; the blend is compiled in only under `XFS_PLATE_SQRT`. Throws on a changed Three. */
export function patchPlateBlendShader(shader: { vertexShader: string; fragmentShader: string }) {
  const replace = (source: string, find: string, by: string) => {
    if (source.split(find).length !== 2) throw Error(`The makeup plate blend expects ${find} once in this Three.js build.`);
    return source.replace(find, by);
  };
  shader.vertexShader = replace(shader.vertexShader, "#include <common>", `#include <common>\n${VERTEX_DECLARATIONS}`);
  shader.vertexShader = replace(shader.vertexShader, "#include <begin_vertex>", `#include <begin_vertex>\n${VERTEX_BODY}`);
  shader.fragmentShader = replace(shader.fragmentShader, "#include <common>", `#include <common>\n${FRAGMENT_DECLARATIONS}`);
  shader.fragmentShader = replace(shader.fragmentShader, "#include <lights_physical_fragment>", SOLVE);
  return shader;
}

export type PlateBlendHandle = {
  /** Whether the layer blends in square-root space (an exportable layer with the skin known); recompiles only on a change. */
  setSquareRoot(enabled: boolean): void;
  readonly squareRoot: boolean;
  /** The target holding the blended layers below, or null when there are none. */
  setBelow(target: THREE.WebGLRenderTarget | null, window: BlendWindow): void;
  readonly below: THREE.WebGLRenderTarget | null;
};

/**
 * Add the square-root blend to a plate material. Install it before any later patch that adds to the base colour (the Colour-shifting
 * tint inserts earlier in the program, so its colour is part of what the blend solves for).
 */
export function installPlateBlend(material: THREE.MeshPhysicalMaterial): PlateBlendHandle {
  const uniforms = { xfsBelowColour: { value: NOTHING_BELOW as THREE.Texture }, xfsBelowSurface: { value: NOTHING_BELOW as THREE.Texture },
    xfsBelowWindow: { value: new THREE.Vector4(0, 0, 1, 1) } };
  const priorCompile = material.onBeforeCompile, priorKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (this: THREE.MeshPhysicalMaterial, shader, renderer) {
    priorCompile.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    patchPlateBlendShader(shader);
  };
  material.customProgramCacheKey = function (this: THREE.MeshPhysicalMaterial) { return `${priorKey.call(this)}|xfs-plate-blend-1`; };
  let squareRoot = false, below: THREE.WebGLRenderTarget | null = null;
  return {
    get squareRoot() { return squareRoot; },
    get below() { return below; },
    setSquareRoot(enabled) {
      if (enabled === squareRoot) return;
      squareRoot = enabled;
      const defines = { ...material.defines };
      if (enabled) defines.XFS_PLATE_SQRT = ""; else delete defines.XFS_PLATE_SQRT;
      material.defines = defines;
      material.needsUpdate = true;
    },
    setBelow(target, window) {
      below = target;
      uniforms.xfsBelowColour.value = target?.textures[0] ?? NOTHING_BELOW;
      uniforms.xfsBelowSurface.value = target?.textures[1] ?? NOTHING_BELOW;
      uniforms.xfsBelowWindow.value.set(window.u0, window.v0, 1 / (window.u1 - window.u0), 1 / (window.v1 - window.v0));
    },
  };
}

const PASS_VERTEX = /* glsl */`
uniform vec4 uWindow;
varying vec2 vUv;
void main() {
	vUv = uWindow.xy + ( position.xy * 0.5 + 0.5 ) * uWindow.zw;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;
const COPY_FRAGMENT = /* glsl */`
precision highp float;
uniform sampler2D uColour;
uniform sampler2D uSurface;
layout( location = 0 ) out highp vec4 oColour;
layout( location = 1 ) out highp vec4 oSurface;
void main() {
	ivec2 texel = ivec2( gl_FragCoord.xy );
	oColour = texelFetch( uColour, texel, 0 );
	oSurface = texelFetch( uSurface, texel, 0 );
}`;
/** One layer's premultiplied contribution, read exactly as its plate reads it (colour × mask, roughness and metalness × maps). */
const LAYER_FRAGMENT = /* glsl */`
precision highp float;
uniform sampler2D uMask;
uniform sampler2D uRoughnessMap;
uniform sampler2D uMetalnessMap;
uniform vec3 uColour;
uniform vec2 uSurface;
varying vec2 vUv;
layout( location = 0 ) out highp vec4 oColour;
layout( location = 1 ) out highp vec4 oSurface;
void main() {
	vec4 mask = textureLod( uMask, vUv, 0.0 );
	float a = clamp( mask.a, 0.0, 1.0 );
	vec3 colour = max( uColour * mask.rgb, vec3( 0.0 ) );
	float roughness = uSurface.x * textureLod( uRoughnessMap, vUv, 0.0 ).g;
	float metalness = uSurface.y * textureLod( uMetalnessMap, vUv, 0.0 ).b;
	oColour = vec4( a * sqrt( colour ), a );
	oSurface = vec4( a * roughness, a * metalness, 0.0, a );
}`;

export type BlendSlot = { material: THREE.MeshPhysicalMaterial; handle: PlateBlendHandle;
  /** The layer is drawn and blends in square-root space, so it joins what the layers above see. */
  blended: boolean };

/**
 * The per-layer "below" targets. `update` redraws them (only when called: the stack calls it when a layer changed), each from the
 * previous blended layer's target plus that layer, so a stack of n layers costs n small draws once per change and nothing per frame.
 */
export function createPlateBlendPrefix(window: BlendWindow) {
  const targets = new Map<THREE.Material, THREE.WebGLRenderTarget>();
  const quad = new THREE.PlaneGeometry(2, 2);
  const common = { glslVersion: THREE.GLSL3, vertexShader: PASS_VERTEX, depthTest: false, depthWrite: false };
  const windowUniform = { value: new THREE.Vector4(window.u0, window.v0, window.u1 - window.u0, window.v1 - window.v0) };
  const copy = new THREE.ShaderMaterial({ ...common, fragmentShader: COPY_FRAGMENT, blending: THREE.NoBlending,
    uniforms: { uWindow: windowUniform, uColour: { value: NOTHING_BELOW }, uSurface: { value: NOTHING_BELOW } } });
  const layerPass = new THREE.ShaderMaterial({ ...common, fragmentShader: LAYER_FRAGMENT, blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    uniforms: { uWindow: windowUniform, uMask: { value: NOTHING_BELOW as THREE.Texture }, uRoughnessMap: { value: NEUTRAL_MAP as THREE.Texture },
      uMetalnessMap: { value: NEUTRAL_MAP as THREE.Texture }, uColour: { value: new THREE.Color() }, uSurface: { value: new THREE.Vector2() } } });
  const copyMesh = new THREE.Mesh(quad, copy), layerMesh = new THREE.Mesh(quad, layerPass);
  copyMesh.frustumCulled = layerMesh.frustumCulled = false;
  copyMesh.renderOrder = 0; layerMesh.renderOrder = 1;
  const scene = new THREE.Scene(), camera = new THREE.Camera();
  scene.add(copyMesh, layerMesh);
  let size = { width: 0, height: 0 };

  function target(material: THREE.Material) {
    let existing = targets.get(material);
    if (existing && (existing.width !== size.width || existing.height !== size.height)) { existing.dispose(); existing = undefined; }
    if (!existing) {
      existing = new THREE.WebGLRenderTarget(size.width, size.height, { count: 2, type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
        depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
      for (const texture of existing.textures) texture.name = "xfs_plate_below";
      targets.set(material, existing);
    }
    return existing;
  }
  function drawLayer(renderer: THREE.WebGLRenderer, into: THREE.WebGLRenderTarget, previous: THREE.WebGLRenderTarget | null,
    layer: THREE.MeshPhysicalMaterial) {
    copyMesh.visible = !!previous;
    copy.uniforms.uColour!.value = previous?.textures[0] ?? NOTHING_BELOW;
    copy.uniforms.uSurface!.value = previous?.textures[1] ?? NOTHING_BELOW;
    const u = layerPass.uniforms;
    u.uMask!.value = layer.map ?? NOTHING_BELOW;
    u.uRoughnessMap!.value = layer.roughnessMap ?? NEUTRAL_MAP;
    u.uMetalnessMap!.value = layer.metalnessMap ?? NEUTRAL_MAP;
    (u.uColour!.value as THREE.Color).copy(layer.color);
    (u.uSurface!.value as THREE.Vector2).set(layer.roughness, layer.metalness);
    renderer.setRenderTarget(into);
    renderer.clear(true, false, false);
    renderer.render(scene, camera);
  }

  return {
    window,
    /** Redraw every blended layer's "below" target in stack order and hand each plate its own; `maskSize` is the masks' side. */
    update(renderer: THREE.WebGLRenderer, slots: readonly BlendSlot[], maskSize: number) {
      size = belowTargetSize(maskSize, window, renderer.capabilities.maxTextureSize);
      const used = new Set<THREE.Material>();
      const previousTarget = renderer.getRenderTarget(), autoClear = renderer.autoClear;
      const clearColour = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
      renderer.autoClear = false;
      renderer.setClearColor(0x000000, 0);
      try {
        let previous: THREE.WebGLRenderTarget | null = null, lastLayer: THREE.MeshPhysicalMaterial | null = null;
        for (const slot of slots) {
          if (!slot.blended) { slot.handle.setBelow(null, window); continue; }
          if (lastLayer) {
            const into = target(slot.material);
            drawLayer(renderer, into, previous, lastLayer);
            used.add(slot.material);
            previous = into;
          }
          slot.handle.setBelow(lastLayer ? previous : null, window);
          lastLayer = slot.material;
        }
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(clearColour, clearAlpha);
        renderer.autoClear = autoClear;
      }
      for (const [material, stale] of targets) if (!used.has(material)) { stale.dispose(); targets.delete(material); }
    },
    /** Drop one layer's target (its slot was removed). */
    release(material: THREE.Material) { targets.get(material)?.dispose(); targets.delete(material); },
    /** GPU bytes held by the targets (two RGBA8 attachments with their mips). */
    bytes() {
      let total = 0;
      for (const t of targets.values()) total += Math.round(t.width * t.height * 4 * 2 * 4 / 3);
      return total;
    },
    dispose() {
      for (const t of targets.values()) t.dispose();
      targets.clear(); quad.dispose(); copy.dispose(); layerPass.dispose();
    },
  };
}
