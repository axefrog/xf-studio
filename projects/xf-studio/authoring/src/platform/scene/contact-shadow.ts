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
 * matter); at most as many lights as the term's list holds. Unflagged lights and the image-based light are untouched.
 *
 * This module is the scene's pass (renderer adapter): the caster depth prepass and the flagged-light list. The shader term and its shared
 * uniforms are the skin light's (skin-material.ts `contactShadowUniforms`), so every material built on it reads the same values without
 * reaching the scene; the lighting stage hands them to this pass.
 */

/** The flagged lights among `lights` as the shader's list (view space), at most `max`. Pure; tests call it. */
export function contactLightList(lights: readonly { position: THREE.Vector3; directional: boolean; direction?: THREE.Vector3 }[],
  view: THREE.Matrix4, max: number): THREE.Vector4[] {
  return lights.slice(0, max).map(light => {
    if (!light.directional) { const p = light.position.clone().applyMatrix4(view); return new THREE.Vector4(p.x, p.y, p.z, 1); }
    const d = (light.direction ?? light.position).clone().transformDirection(view);
    return new THREE.Vector4(d.x, d.y, d.z, 0);
  });
}

/** The skin light's shared contact-shadow uniforms this pass fills (skin-material.ts `contactShadowUniforms`). */
export type ContactShadowUniforms = {
  xfsContactDepth: { value: THREE.Texture | null }; xfsContactCount: { value: number }; xfsContactLights: { value: THREE.Vector4[] };
  xfsContactProjection: { value: THREE.Matrix4 }; xfsContactClip: { value: THREE.Vector2 };
};

/** Marks a light as flagged for character contact shadows (the lighting rig sets it from the setup). */
export const setContactShadows = (light: THREE.Light, on: boolean) => { light.userData.xfsContactShadows = on; };

export function createContactShadows(renderer: THREE.WebGLRenderer, contactShadowUniforms: ContactShadowUniforms) {
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
      const list = contactLightList(flagged, view, contactShadowUniforms.xfsContactLights.value.length);
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
