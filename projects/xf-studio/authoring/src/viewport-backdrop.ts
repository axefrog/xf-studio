import * as THREE from "three";
import { stageBackdropPixels, type StageTheme } from "./stage-backdrop";

const SIZE = 256;

/**
 * Three adapter for the stage backdrop (stage-backdrop.ts): an sRGB texture set as the scene
 * background, which Three draws first, full-viewport and without tone mapping. It changes
 * nothing about lighting (`scene.environment` is separate). The theme arrives as a typed input
 * (`setTheme`); this adapter never reads the DOM.
 */
export function createViewportBackdrop(scene: THREE.Scene, initial: StageTheme = "dark") {
  let theme = initial;
  const texture = new THREE.DataTexture(stageBackdropPixels(theme, SIZE, SIZE), SIZE, SIZE,
    THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.name = "xfs-stage-backdrop";
  texture.needsUpdate = true;
  scene.background = texture;
  return {
    get theme() { return theme; },
    setTheme(next: StageTheme) {
      if (next === theme) return;
      theme = next;
      (texture.image.data as Uint8Array).set(stageBackdropPixels(theme, SIZE, SIZE));
      texture.needsUpdate = true;
    },
    dispose() {
      if (scene.background === texture) scene.background = null;
      texture.dispose();
    },
  };
}
export type ViewportBackdrop = ReturnType<typeof createViewportBackdrop>;
