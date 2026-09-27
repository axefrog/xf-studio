import * as THREE from "three";
import { passParticipation, SCATTER_INPUT_DEFINE, SCATTER_INPUT_OUTPUTS, type PassParticipation } from "../api/scene";
import { createPassVariants, occluderCutoff, type PassSpec } from "./pass-variants";
import { assignScatterSlots, packScatterTable, SCATTER_MAX_ENTRIES, SCATTER_ROW, SCATTER_SLOTS, scatterSlot, type ScatterProfile,
  type ScatterQuality } from "./skin-scatter-kernel";

/**
 * The game's screen-space skin scatter in the preview (research/materials/shader-skin.md §6.3 and §11), a renderer adapter the display
 * runs between the forward scene and its display pass:
 *
 * 1. **Input** (S0–S2, one three-target draw, pass-variants.ts): every visible mesh through its scatter-input variant. S0 = the direct
 *    diffuse irradiance at albedo 1 (RGB, half float) and the Subsurface flag as the pixel's view depth (A); S1 = √albedo after decals and
 *    the plate (RGB, 8 bit, blended by decals in that space as the G-buffer is) and the profile slot (A); S2 = the blended metalness (R).
 * 2. **Horizontal blur** S0 → P0 and 3. **vertical blur and combine** P0 → P1 = Δ = P · (B − E) · albedo: the §6.3.1 loop with the game's
 *    kernel (skin-scatter-kernel.ts) as a uniform table, the game's rules and nothing stricter: a tap counts only on a Subsurface pixel
 *    with positive red irradiance (no depth or normal test), whole-pixel taps (truncated, unfiltered), per-channel renormalisation, and
 *    only the centre's metalness (> 0.1) gates.
 * 4. The display adds Δ to the scene value before its exposure and grade (linear-display.ts). Specular and image-based light never enter
 *    E, so they stay sharp; the albedo multiplies after the blur, so makeup and freckle colour stay sharp.
 *
 * The forward skin must light with the same E, so while the scatter runs every skin-lit material's wrap is gated off (`wrapGate`); the
 * wrap stays the fallback when the scatter is off or impossible (no renderable half-float target). The full-screen passes are
 * scissored to the projected bounds of the skin (the stand-in for the game's tile list). Slots follow the distinct resolved `.sp`
 * profiles among the drawn skin in first-seen order, up to eight; a ninth falls back to slot 0 and is reported.
 *
 * Screen scale [hypothesis until the parity capture fits it, §11.6]: one kernel unit is `blurSize` millimetres, so a stored offset
 * lands `offset · 1e-3 · focal / depth` pixels away.
 */

const OCCLUDER_DEFINE = "XFS_SCATTER_OCCLUDER";
/** An occluder's write: nothing here (class 0, no irradiance), where the surface is at least `XFS_OCCLUDER_CUTOFF` covered. */
const OCCLUDER_WRITE = /* glsl */`
#include <alphatest_fragment>
#ifdef XFS_SCATTER_OCCLUDER
	if ( diffuseColor.a < XFS_OCCLUDER_CUTOFF ) discard;
	gl_FragColor = vec4( 0.0 );
	xfsScatterOccluder1 = vec4( 0.0 );
	xfsScatterOccluder2 = vec4( 0.0 );
	return;
#endif`;
const OCCLUDER_OUTPUTS = /* glsl */`
#ifdef XFS_SCATTER_OCCLUDER
layout( location = 1 ) out highp vec4 xfsScatterOccluder1;
layout( location = 2 ) out highp vec4 xfsScatterOccluder2;
#endif`;

/** The scatter's input pass over the variant swap: declared skin and decals write their own inputs; everything else occludes or is left out. */
export const SCATTER_INPUT_PASS: PassSpec = {
  name: "xfs-scatter-input-1",
  defines: (role, material): Record<string, string> => role === "occluder"
    ? { [OCCLUDER_DEFINE]: "", XFS_OCCLUDER_CUTOFF: occluderCutoff(material).toFixed(4) } : { [SCATTER_INPUT_DEFINE]: "" },
  patch(shader, role) {
    if (role !== "occluder") return;
    if (!shader.fragmentShader.includes("#include <alphatest_fragment>")) throw Error("The scatter occluder expects the alpha test chunk.");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>\n${OCCLUDER_OUTPUTS}`)
      .replace("#include <alphatest_fragment>", OCCLUDER_WRITE);
  },
  // A decal blends each target by its own output alpha and keeps the alpha below (class, slot): the game's RGB write mask.
  state: role => role === "decal"
    ? { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor }
    : { transparent: false, depthWrite: true, blending: THREE.NoBlending },
};

const QUAD_VERTEX = /* glsl */`void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;
/**
 * One separable pass (`uVertical` 0: S0 → P0; 1: P0 → Δ with the combine). P0 keeps the depth in A, so a pixel the first pass skipped
 * (outside class 1, or metallic) reads as zero red in the second and is excluded there, as in the game.
 */
const BLUR_FRAGMENT = /* glsl */`
precision highp float;
precision highp int;
uniform highp sampler2D tSource;
uniform highp sampler2D tS0;
uniform highp sampler2D tS1;
uniform highp sampler2D tS2;
uniform vec4 uTable[ ${SCATTER_SLOTS * SCATTER_ROW} ];
uniform vec2 uFocal;
uniform int uVertical;
void main() {
	ivec2 size = textureSize( tS0, 0 );
	ivec2 p = ivec2( gl_FragCoord.xy );
	vec4 s0 = texelFetch( tS0, p, 0 );
	vec4 s1 = texelFetch( tS1, p, 0 );
	int slot = int( floor( s1.a * 8.0 + 0.5 ) ) - 1;
	float depth = s0.a;
	if ( depth <= 0.0 || slot < 0 || slot >= ${SCATTER_SLOTS} || texelFetch( tS2, p, 0 ).r > 0.1 ) { gl_FragColor = vec4( 0.0 ); return; }
	int base = slot * ${SCATTER_ROW};
	vec4 head = uTable[ base ];
	int entries = int( head.a + 0.5 );
	if ( entries < 1 ) { gl_FragColor = vec4( 0.0 ); return; }
	vec3 k0 = uTable[ base + 1 ].rgb;
	vec3 centre = texelFetch( tSource, p, 0 ).rgb;
	vec3 num = k0 * centre;
	vec3 den = k0 + 1e-5;
	ivec2 axis = uVertical == 1 ? ivec2( 0, 1 ) : ivec2( 1, 0 );
	float focal = uVertical == 1 ? uFocal.y : uFocal.x;
	for ( int i = 1; i < ${SCATTER_MAX_ENTRIES}; i++ ) {
		if ( i >= entries ) break;
		vec4 k = uTable[ base + 1 + i ];
		int d = int( k.a * focal / depth );
		for ( int side = -1; side <= 1; side += 2 ) {
			ivec2 q = p + axis * ( side * d );
			if ( any( lessThan( q, ivec2( 0 ) ) ) || any( greaterThanEqual( q, size ) ) ) continue;
			vec4 t = texelFetch( tSource, q, 0 );
			if ( t.a > 0.0 && t.r > 0.0 ) { num += k.rgb * t.rgb; den += k.rgb; }
		}
	}
	vec3 blurred = num / den;
	if ( uVertical == 0 ) { gl_FragColor = vec4( blurred, depth ); return; }
	gl_FragColor = vec4( head.rgb * ( blurred - s0.rgb ) * ( s1.rgb * s1.rgb ), 1.0 );
}`;

/** The viewing preference's default: the game's High (25 samples) until its own default is known (§11.5). */
export const DEFAULT_SCATTER_QUALITY: ScatterQuality = "high";
/**
 * Millimetres per kernel unit per unit of `blurSize`: the product `w · cb0[3].x` of §6.3.3 in the preview's terms. 1 is the plan's
 * working reading (research/materials/shader-skin.md §11.6) until a parity capture fits it.
 */
export const SCATTER_SCREEN_SCALE = 1;
/** Margin (m) around each skin mesh's bind-pose bounds for the scissor: the idle moves the head a few centimetres. */
const BOUNDS_MARGIN = 0.15;

export type SkinScatterEvidence = {
  enabled: boolean; active: boolean; quality: ScatterQuality; width: number; height: number;
  /** The scissor rectangle of the last drawn frame (drawing-buffer pixels), or null for none. */
  scissor: { x: number; y: number; width: number; height: number } | null;
  slots: { blurSize: number; diffuse: number[]; falloff: number[] }[]; overflow: number;
  variants: Record<string, number>; bytes: number;
};

export function createSkinScatter(renderer: THREE.WebGLRenderer) {
  const variants = createPassVariants(SCATTER_INPUT_PASS);
  let input: THREE.WebGLRenderTarget | null = null, p0: THREE.WebGLRenderTarget | null = null, p1: THREE.WebGLRenderTarget | null = null;
  let enabled = true, active = false, bare = false, quality: ScatterQuality = DEFAULT_SCATTER_QUALITY, scale = SCATTER_SCREEN_SCALE;
  let tableKey = "", overflow = 0, distinct: ScatterProfile[] = [], lastScissor: SkinScatterEvidence["scissor"] = null;
  const table = new Float32Array(SCATTER_SLOTS * SCATTER_ROW * 4);
  const blur = new THREE.ShaderMaterial({
    uniforms: { tSource: { value: null }, tS0: { value: null }, tS1: { value: null }, tS2: { value: null }, uTable: { value: table },
      uFocal: { value: new THREE.Vector2() }, uVertical: { value: 0 } },
    vertexShader: QUAD_VERTEX, fragmentShader: BLUR_FRAGMENT, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
  });
  blur.name = "xfs-skin-scatter-blur";
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blur);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const size = new THREE.Vector2(), clearColour = new THREE.Color(), corner = new THREE.Vector3(), centre = new THREE.Vector3();
  let skins: THREE.Mesh[] = [];

  function ensureTargets() {
    renderer.getDrawingBufferSize(size);
    const width = Math.max(1, Math.floor(size.x)), height = Math.max(1, Math.floor(size.y));
    if (input && input.width === width && input.height === height) return;
    disposeTargets();
    const options = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      generateMipmaps: false, depthBuffer: false } as const;
    input = new THREE.WebGLRenderTarget(width, height, { ...options, count: 3, depthBuffer: true });
    // S1 and S2 are 8-bit, as the G-buffer's colour and surface targets are (√albedo quantises the same way).
    input.textures[1]!.type = input.textures[2]!.type = THREE.UnsignedByteType;
    input.textures.forEach((texture, i) => { texture.name = `xfs-scatter-s${i}`; });
    p0 = new THREE.WebGLRenderTarget(width, height, options);
    p1 = new THREE.WebGLRenderTarget(width, height, options);
    p0.texture.name = "xfs-scatter-p0"; p1.texture.name = "xfs-scatter-delta";
  }
  function disposeTargets() { input?.dispose(); p0?.dispose(); p1?.dispose(); input = p0 = p1 = null; }

  /** The drawn meshes' declarations (visible meshes, each material once). */
  function participants(scene: THREE.Scene) {
    const found: { mesh: THREE.Mesh; participation: PassParticipation }[] = [];
    scene.traverseVisible(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const participation = material.visible ? passParticipation(material) : undefined;
        if (participation) found.push({ mesh, participation });
      }
    });
    return found;
  }

  /** Whether any mesh in the scene, shown or hidden, wears a material declared as skin. */
  function sceneHasSkin(scene: THREE.Scene) {
    let found = false;
    scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (found || !mesh.isMesh) return;
      found = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some(material => passParticipation(material)?.role === "skin");
    });
    return found;
  }

  /** The skin's projected bounds in drawing-buffer pixels (conservative), or null when the skin is behind the camera or off screen. */
  function scissorRect(camera: THREE.Camera, width: number, height: number) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const mesh of skins) {
      const geometry = mesh.geometry;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      const sphere = geometry.boundingSphere!;
      centre.copy(sphere.center).applyMatrix4(mesh.matrixWorld);
      const radius = sphere.radius * mesh.matrixWorld.getMaxScaleOnAxis() + BOUNDS_MARGIN;
      for (let i = 0; i < 8; i++) {
        corner.set(centre.x + (i & 1 ? radius : -radius), centre.y + (i & 2 ? radius : -radius), centre.z + (i & 4 ? radius : -radius));
        corner.applyMatrix4(camera.matrixWorldInverse);
        // A corner at or behind the camera plane: the skin may cover anything, so the whole frame.
        if (corner.z > -1e-4) return { x: 0, y: 0, width, height };
        corner.applyMatrix4(camera.projectionMatrix);
        x0 = Math.min(x0, corner.x); x1 = Math.max(x1, corner.x); y0 = Math.min(y0, corner.y); y1 = Math.max(y1, corner.y);
      }
    }
    const px = (ndc: number, span: number) => Math.min(span, Math.max(0, (ndc * 0.5 + 0.5) * span));
    const left = Math.floor(px(x0, width)), right = Math.ceil(px(x1, width)), bottom = Math.floor(px(y0, height)), top = Math.ceil(px(y1, height));
    return right > left && top > bottom ? { x: left, y: bottom, width: right - left, height: top - bottom } : null;
  }

  function pass(target: THREE.WebGLRenderTarget, source: THREE.Texture, vertical: boolean) {
    blur.uniforms.tSource!.value = source;
    blur.uniforms.uVertical!.value = vertical ? 1 : 0;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCamera);
  }

  return {
    /**
     * Before the forward scene: whether the scatter runs this frame (switched on, a half-float target, and some drawn skin), with every
     * drawn skin-lit material's wrap gated to match (off while it runs), and the drawn skin's profile slots and kernel table.
     */
    prepare(scene: THREE.Scene, possible: boolean): boolean {
      const found = participants(scene);
      skins = [...new Set(found.filter(entry => entry.participation.role === "skin").map(entry => entry.mesh))];
      active = enabled && possible && skins.length > 0;
      for (const { participation } of found) if (participation.wrapGate) participation.wrapGate.value = active ? 0 : 1;
      // No skin left in the scene at all (the V removed) or no half-float target: the targets leave GPU memory, so no V costs nothing.
      // A skin only hidden (the body switched off) keeps them, as its own GPU resources are kept, so showing it again is instant.
      if (!active) { if (input && (!possible || !sceneHasSkin(scene))) { disposeTargets(); quad.geometry.dispose(); } return false; }
      const skinDeclarations = found.filter(entry => entry.participation.role === "skin" && entry.participation.profile);
      const assigned = assignScatterSlots(skinDeclarations.map(entry => entry.participation.profile!));
      skinDeclarations.forEach((entry, i) => { if (entry.participation.slot) entry.participation.slot.value = assigned.slotOf[i]!; });
      overflow = assigned.overflow;
      const key = `${quality}|${assigned.distinct.map(profile => JSON.stringify(profile)).join(";")}`;
      if (key !== tableKey) {
        tableKey = key;
        distinct = assigned.distinct;
        table.set(packScatterTable(distinct.map(profile => scatterSlot(profile, quality))));
      }
      return true;
    },
    /**
     * After the forward scene, on a frame `prepare` said runs: draw the input and both passes and return Δ (a drawing-buffer-sized
     * half-float texture, zero outside the scissor), or null when the skin is off screen. Leaves the renderer's target, clear state and
     * the scene's background as it found them.
     */
    render(scene: THREE.Scene, camera: THREE.Camera): THREE.Texture | null {
      if (!active || bare) return null;
      ensureTargets();
      const targets = [input!, p0!, p1!], width = input!.width, height = input!.height;
      const rect = scissorRect(camera, width, height);
      lastScissor = rect;
      if (!rect) return null;
      const previous = renderer.getRenderTarget(), autoClear = renderer.autoClear, background = scene.background;
      renderer.getClearColor(clearColour);
      const clearAlpha = renderer.getClearAlpha();
      try {
        renderer.setClearColor(0x000000, 0);
        renderer.autoClear = false;
        for (const target of targets) { target.scissorTest = false; renderer.setRenderTarget(target); renderer.clear(true, target === input, false); }
        for (const target of targets) { target.scissor.set(rect.x, rect.y, rect.width, rect.height); target.scissorTest = true; }
        scene.background = null;
        renderer.setRenderTarget(input);
        variants.draw(renderer, scene, camera);
        const projection = (camera as THREE.PerspectiveCamera).projectionMatrix.elements;
        (blur.uniforms.uFocal!.value as THREE.Vector2).set(projection[0]! * width / 2 * 1e-3 * scale, projection[5]! * height / 2 * 1e-3 * scale);
        blur.uniforms.tS0!.value = input!.textures[0];
        blur.uniforms.tS1!.value = input!.textures[1];
        blur.uniforms.tS2!.value = input!.textures[2];
        pass(p0!, input!.textures[0]!, false);
        pass(p1!, p0!.texture, true);
      } finally {
        scene.background = background;
        renderer.autoClear = autoClear;
        renderer.setClearColor(clearColour, clearAlpha);
        renderer.setRenderTarget(previous);
      }
      return p1!.texture;
    },
    /** Switch the scatter on or off (off: the wrap stand-in lights the skin again on the next frame). */
    setEnabled(next: boolean) { enabled = next; },
    /**
     * Developer evidence: keep the wrap off but add no Δ (the bare direct light), so a capture against the full scatter isolates Δ
     * exactly. Not a viewing mode.
     */
    setBare(next: boolean) { bare = next; },
    /** Developer evidence: a trial screen scale (millimetres per kernel unit per unit of blur size), for fitting §11.6's unknown; null resets. */
    setScale(next: number | null) { scale = next ?? SCATTER_SCREEN_SCALE; },
    get scale() { return scale; },
    get enabled() { return enabled; },
    /** The kernel's sample count: the game's Low, Medium or High (11, 17, 25 samples). */
    setQuality(next: ScatterQuality) { quality = next; },
    get quality() { return quality; },
    /** Test access: the three input textures and the passes' outputs of the last frame. */
    targets: () => input && p0 && p1 ? { s0: input.textures[0]!, s1: input.textures[1]!, s2: input.textures[2]!, p0: p0.texture, delta: p1.texture, input, p0Target: p0, p1Target: p1 } : null,
    /** Developer evidence. `bytes`: the targets' storage (S0 8, S1 and S2 4 each, depth 4, P0 and P1 8 each per pixel). */
    evidence: (): SkinScatterEvidence => ({ enabled, active, quality, width: input?.width ?? 0, height: input?.height ?? 0, scissor: lastScissor,
      slots: distinct.map(profile => ({ blurSize: profile.blurSize, diffuse: [...profile.diffuse], falloff: [...profile.falloff] })), overflow,
      variants: variants.counts(), bytes: (input?.width ?? 0) * (input?.height ?? 0) * 36 }),
    /** Developer evidence: drop the input variants, so the next frame measures their compile (a V's first scatter frame). */
    resetVariants() { variants.clear(); },
    dispose() { disposeTargets(); variants.dispose(); blur.dispose(); quad.geometry.dispose(); },
  };
}
export type SkinScatter = ReturnType<typeof createSkinScatter>;
