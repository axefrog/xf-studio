import * as THREE from "three";

/** The inspected game eye shader reads roughness R; Three MeshStandardMaterial
 * reads roughnessMap G. Copy the source red bytes into green without gamma. */
export function roughnessRedToGreen(source: Uint8ClampedArray | Uint8Array) {
  if (!source.length || source.length % 4) throw Error("Expected RGBA eye roughness pixels");
  const pixels = new Uint8Array(source);
  for (let i = 0; i < pixels.length; i += 4) pixels[i + 1] = pixels[i];
  return pixels;
}

export function eyeRoughnessMap(image: HTMLImageElement, anisotropy: number) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw Error("Eye roughness pixel decoding is unavailable");
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const texture = new THREE.DataTexture(roughnessRedToGreen(rgba), canvas.width, canvas.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false; // Match the existing eye diffuse and folded preview UV0.
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}
