import * as THREE from "three";

/**
 * Screen-space contact shadows for the character (renderer adapter, PREV-148), for the lights the game flags `contactShadows`
 * `CSR_CharacterOnly` (creator-lighting.ts: Main_Face, Rim_Right, Rim_Top and the magenta head rim) [resource flags; the game's own
 * march is not decoded, so its length, steps and thickness here are a Studio choice, hypothesis].
 *
 * Why: those lights' shadow maps (the preview's stand-in, `CREATOR_SHADOW`) keep a 1.5 mm normal bias and a 3 mm penumbra against acne,
 * so nothing smaller than a few millimetres shadows. The fold at the corner of the mouth is about a millimetre deep and faces the low key
 * (Main_Face shines up from chest height), so it was lit as if open and showed as a bright streak where the game shows a dark crease.
 * Contact shadows are what resolves that scale in a deferred renderer: a short march toward the light through the depth buffer.
 *
 * How: before the forward scene, the shadow casters (the character renderer's: skin, body, clothing, hair strands by coverage) draw their
 * depth alone through their own depth materials (all eight skin influences). Every skin-lit program (skin, decals over it, the makeup
 * plate: skin-material.ts `patchSkinLight`) then scales a flagged light's direct light by the fraction of a march toward it, from the
 * shaded point, that no caster's depth hides. A light is recognised by its direction from the point (so Three's light order doesn't
 * matter); at most `CONTACT_SHADOW.lights` lights. Unflagged lights and the image-based light are untouched.
 */
export const CONTACT_SHADOW = Object.freeze({
  /** Longest march toward the light (m): creases, the lip parting and the nostrils, not the nose's whole shadow (the maps keep that). */
  length: 0.012,
  /** Samples along the march. */
  steps: 12,
  /** A caster this far (m) in front of a sample, or less, hides it; a thicker gap is a silhouette the ray passes behind. */
  thickness: 0.006,
  /** Depth (m) a caster must be in front of a sample to count, and the start offset along the normal, against self-shadowing. */
  bias: 0.0004,
  /** At most this many flagged lights. */
  lights: 4,
});

/** Uniforms every skin-lit program shares (one object: the prepass updates them for all). */
export const contactShadowUniforms = Object.freeze({
  xfsContactDepth: { value: null as THREE.Texture | null },
  xfsContactCount: { value: 0 },
  /** View-space position (w 1) or direction to the light (w 0) of each flagged light. */
  xfsContactLights: { value: Array.from({ length: CONTACT_SHADOW.lights }, () => new THREE.Vector4()) },
  xfsContactProjection: { value: new THREE.Matrix4() },
  /** Camera near and far, for the depth's view z. */
  xfsContactClip: { value: new THREE.Vector2(0.01, 100) },
});

/** GLSL: `xfsContactVisibility( position, normal, toLight )` in view space, 1 for unflagged lights. */
export const CONTACT_SHADOW_GLSL = /* glsl */`
uniform highp sampler2D xfsContactDepth;
uniform int xfsContactCount;
uniform vec4 xfsContactLights[ ${CONTACT_SHADOW.lights} ];
uniform mat4 xfsContactProjection;
uniform vec2 xfsContactClip;
// A perspective depth-buffer value's view z (negative in front of the camera).
float xfsContactViewZ( const in float depth ) {
	return ( xfsContactClip.x * xfsContactClip.y ) / ( ( xfsContactClip.y - xfsContactClip.x ) * depth - xfsContactClip.y );
}
float xfsContactVisibility( const in vec3 position, const in vec3 normal, const in vec3 toLight ) {
	if ( xfsContactCount == 0 ) return 1.0;
	bool flagged = false;
	for ( int i = 0; i < ${CONTACT_SHADOW.lights}; i ++ ) {
		if ( i >= xfsContactCount ) break;
		vec4 light = xfsContactLights[ i ];
		vec3 direction = light.w > 0.5 ? normalize( light.xyz - position ) : light.xyz;
		if ( dot( direction, toLight ) > 0.99999 ) flagged = true;
	}
	if ( !flagged ) return 1.0;
	vec3 origin = position + normal * ${CONTACT_SHADOW.bias.toFixed(6)};
	for ( int s = 1; s <= ${CONTACT_SHADOW.steps}; s ++ ) {
		float along = ${CONTACT_SHADOW.length.toFixed(6)} * float( s ) / ${CONTACT_SHADOW.steps}.0;
		vec3 marchPoint = origin + toLight * along;
		vec4 clip = xfsContactProjection * vec4( marchPoint, 1.0 );
		vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
		if ( any( lessThan( uv, vec2( 0.0 ) ) ) || any( greaterThan( uv, vec2( 1.0 ) ) ) ) break;
		float casterZ = xfsContactViewZ( texture2D( xfsContactDepth, uv ).r );
		float inFront = casterZ - marchPoint.z;
		// Hidden: the fade lets the far end of the march soften into the shadow maps' penumbra instead of ending in a hard line.
		if ( inFront > ${CONTACT_SHADOW.bias.toFixed(6)} && inFront < ${CONTACT_SHADOW.thickness.toFixed(6)} ) return smoothstep( 0.5, 1.0, along / ${CONTACT_SHADOW.length.toFixed(6)} );
	}
	return 1.0;
}`;

/** The flagged lights among `lights` as the shader's list (view space), at most `CONTACT_SHADOW.lights`. Pure; tests call it. */
export function contactLightList(lights: readonly { position: THREE.Vector3; directional: boolean; direction?: THREE.Vector3 }[],
  view: THREE.Matrix4): THREE.Vector4[] {
  return lights.slice(0, CONTACT_SHADOW.lights).map(light => {
    if (!light.directional) { const p = light.position.clone().applyMatrix4(view); return new THREE.Vector4(p.x, p.y, p.z, 1); }
    const d = (light.direction ?? light.position).clone().transformDirection(view);
    return new THREE.Vector4(d.x, d.y, d.z, 0);
  });
}

/** Marks a light as flagged for character contact shadows (the lighting rig sets it from the setup). */
export const setContactShadows = (light: THREE.Light, on: boolean) => { light.userData.xfsContactShadows = on; };

export function createContactShadows(renderer: THREE.WebGLRenderer) {
  let target: THREE.WebGLRenderTarget | null = null;
  const fallbackDepth = new THREE.MeshDepthMaterial();
  const size = new THREE.Vector2(), world = new THREE.Vector3(), towards = new THREE.Vector3();
  let drawn = 0;
  function ensureTarget() {
    if (!target) {
      // Three counts every sampler of a program, the vertex stage's bone and morph textures included, against the fragment stage's limit
      // and warns on every draw past it; the skin programs already reach 16 that way with six shadow maps. Binding needs only the combined
      // limit, and the fragment stage still samples at most 15 with the contact depth, so count against the combined one.
      const gl = renderer.getContext();
      renderer.capabilities.maxTextures = Math.max(renderer.capabilities.maxTextures, gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) as number);
    }
    renderer.getDrawingBufferSize(size);
    const width = Math.max(1, Math.floor(size.x)), height = Math.max(1, Math.floor(size.y));
    if (target && target.width === width && target.height === height) return target;
    target?.dispose();
    target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(width, height, THREE.FloatType) });
    target.texture.name = "xfs-contact-colour"; target.depthTexture!.name = "xfs-contact-depth";
    return target;
  }
  const off = () => { contactShadowUniforms.xfsContactCount.value = 0; drawn = 0; };
  return {
    /**
     * Before the forward scene: when a visible light is flagged and something casts, draw the casters' depth and point the shared
     * uniforms at it; otherwise switch the term off. Returns whether it drew.
     */
    prepare(scene: THREE.Scene, camera: THREE.Camera) {
      const flagged: { position: THREE.Vector3; directional: boolean; direction?: THREE.Vector3 }[] = [];
      scene.traverseVisible(object => {
        const light = object as THREE.Light;
        if (!light.isLight || !light.userData.xfsContactShadows || light.intensity <= 0) return;
        const position = light.getWorldPosition(new THREE.Vector3());
        if ((light as THREE.DirectionalLight).isDirectionalLight) {
          const target = (light as THREE.DirectionalLight).target.getWorldPosition(world);
          flagged.push({ position, directional: true, direction: towards.copy(position).sub(target).normalize().clone() });
        } else flagged.push({ position, directional: false });
      });
      // Nothing flagged, or nothing that casts: nothing to hide, and no prepass.
      let casters = false;
      if (flagged.length) scene.traverseVisible(object => { casters ||= !!(object as THREE.Mesh).isMesh && object.castShadow; });
      if (!flagged.length || !casters) { off(); return false; }
      const depth = ensureTarget();
      const hidden: THREE.Object3D[] = [], swapped: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];
      const previous = renderer.getRenderTarget(), background = scene.background, autoClear = renderer.autoClear;
      try {
        scene.traverseVisible(object => {
          const mesh = object as THREE.Mesh;
          if (mesh.isMesh && mesh.castShadow) { swapped.push({ mesh, material: mesh.material }); mesh.material = mesh.customDepthMaterial ?? fallbackDepth; }
          else if (mesh.isMesh || (object as THREE.Line).isLine || (object as THREE.Points).isPoints || (object as THREE.Sprite).isSprite) hidden.push(object);
        });
        for (const object of hidden) object.visible = false;
        scene.background = null;
        renderer.autoClear = true;
        renderer.setRenderTarget(depth);
        renderer.render(scene, camera);
      } finally {
        for (const object of hidden) object.visible = true;
        for (const { mesh, material } of swapped) mesh.material = material;
        scene.background = background; renderer.autoClear = autoClear;
        renderer.setRenderTarget(previous);
      }
      const view = camera.matrixWorldInverse, perspective = camera as THREE.PerspectiveCamera;
      const list = contactLightList(flagged, view);
      list.forEach((entry, i) => contactShadowUniforms.xfsContactLights.value[i]!.copy(entry));
      contactShadowUniforms.xfsContactCount.value = list.length;
      contactShadowUniforms.xfsContactDepth.value = depth.depthTexture;
      contactShadowUniforms.xfsContactProjection.value.copy(camera.projectionMatrix);
      contactShadowUniforms.xfsContactClip.value.set(perspective.near ?? 0.01, perspective.far ?? 100);
      drawn = list.length;
      return true;
    },
    /** Switch the term off without drawing (a frame without flagged lights, or the shadow switch off). */
    off,
    /** Developer evidence: how many flagged lights the last frame marched toward, and the target's size. */
    evidence: () => ({ lights: drawn, width: target?.width ?? 0, height: target?.height ?? 0 }),
    dispose() { off(); contactShadowUniforms.xfsContactDepth.value = null; target?.dispose(); target = null; fallbackDepth.dispose(); },
  };
}
export type ContactShadows = ReturnType<typeof createContactShadows>;
