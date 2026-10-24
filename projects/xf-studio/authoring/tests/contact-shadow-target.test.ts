import { expect, test } from "bun:test";
import * as THREE from "three";
import { headSurface, recordingRenderer } from "./fixtures/recording-gl";
import { contactShadowUniforms } from "../src/materials/render/skin-material";
import { createContactShadows, setContactShadows } from "../src/platform/scene/contact-shadow";

/**
 * The contact shadows' depth target and the uniforms every scene shares (profiles phase 4a, Sol's final review): a target the pass replaces on
 * a resize, as one it releases when its runtime is hidden, must not stay bound in the shared uniform, or the next sampler bind recreates the
 * disposed texture's storage.
 */
test("a resize followed by hiding leaves no disposed contact depth texture in the shared uniform", () => {
  const { renderer, scene, camera } = recordingRenderer();
  const head = headSurface();
  head.castShadow = true;
  scene.add(head.parent!);
  const key = new THREE.DirectionalLight(0xffffff, 1);
  key.position.set(1, 1, 2);
  setContactShadows(key, true);
  scene.add(key);
  camera.position.set(0, 0, 2); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const contact = createContactShadows(renderer, contactShadowUniforms);

  expect(contact.prepare(scene, camera)).toBe(true);
  const first = contactShadowUniforms.xfsContactDepth.value as THREE.DepthTexture | null;
  expect(first).not.toBeNull();
  let disposed = false;
  first!.addEventListener("dispose", () => { disposed = true; });

  // The pane resizes: the pass makes a new target at the new size and lets the old one go.
  renderer.setSize(renderer.domElement.width + 64, renderer.domElement.height + 32, false);
  contact.allocate(scene);
  expect(disposed).toBe(true);
  expect(contactShadowUniforms.xfsContactDepth.value).not.toBe(first);

  // The runtime is hidden before it draws again: nothing it made stays bound.
  contact.releaseTarget();
  expect(contactShadowUniforms.xfsContactDepth.value).toBeNull();
  contact.dispose();
});
