// Shared, asset-free pieces for synthetic package builds on the plate-local UV window: the window of a
// synthetic plate, texel-to-UV mapping, the head-UV coverage reference and the stored BC4 level the
// verifier decodes. Test-only use of the builder's window arithmetic (src/plate-uv-window.ts); the
// verifier re-derives all of it independently.
import { referenceCrop } from "../src/package-bake";
import { plateUvBounds, plateUvWindow, uvTransformConstants, type UvWindow } from "../src/plate-uv-window";

export const WINDOW_W = 2048, WINDOW_H = 512;

/** The builder's window and material constants for a plate document pair. */
export function plateWindow(plate: { mesh: any }) {
  const bounds = plateUvBounds(plate.mesh.Data.RootChunk), window = plateUvWindow(bounds);
  return { bounds, window, transform: uvTransformConstants(window) };
}

/** Authored UV of texel (x, y) of a width × height map over `window`. */
export const texelUv = (window: UvWindow, width: number, height: number, x: number, y: number): [number, number] =>
  [window.u0 + (x + .5) / width * (window.u1 - window.u0), window.v0 + (y + .5) / height * (window.v1 - window.v0)];

/** Head-UV linear coverage bytes over the builder's reference crop, from an authored coverage function. */
export function coverageReference(window: UvWindow, coverage: (u: number, v: number) => number) {
  const crop = referenceCrop(window), data = new Uint8Array(crop.width * crop.height);
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++)
    data[y * crop.width + x] = Math.round(Math.max(0, Math.min(1, coverage((crop.x0 + x + .5) / crop.grid, (crop.y0 + y + .5) / crop.grid))) * 255);
  return { crop, data };
}

/**
 * The serialized `renderTextureResource` of a BC4 XBM whose level 0 holds `bytes` (width × height, image rows top
 * to bottom) stored bottom to top, as WolvenKit's import stores them. Every 4 × 4 block must be uniform, so the
 * encoding is exact (both endpoints the block's value, all indices 0).
 */
export function storedBc4(bytes: Uint8Array, width: number, height: number) {
  const blocksWide = Math.ceil(width / 4), blocksHigh = Math.ceil(height / 4), data = Buffer.alloc(blocksWide * blocksHigh * 8);
  for (let by = 0; by < blocksHigh; by++) for (let bx = 0; bx < blocksWide; bx++) {
    const value = bytes[(height - 1 - by * 4) * width + bx * 4];
    for (let k = 0; k < 16; k++) {
      const x = bx * 4 + (k & 3), y = height - 1 - (by * 4 + (k >> 2));
      if (bytes[y * width + x] !== value) throw Error("storedBc4 needs uniform 4x4 blocks");
    }
    data[(by * blocksWide + bx) * 8] = value; data[(by * blocksWide + bx) * 8 + 1] = value;
  }
  return { renderResourceBlobPC: { Data: { header: { mipMapInfo: [{ layout: { rowPitch: blocksWide * 8, slicePitch: data.length },
    placement: { offset: 0, size: data.length } }] }, textureData: { Bytes: data.toString("base64") } } } };
}
