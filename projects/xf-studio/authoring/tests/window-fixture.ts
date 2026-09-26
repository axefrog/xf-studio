// Shared, asset-free pieces for synthetic package builds on the plate-local UV window: the window of a
// synthetic plate, texel-to-UV mapping, the head-UV coverage reference and the stored BC4 level the
// verifier decodes. Test-only use of the builder's window arithmetic (src/plate-uv-window.ts); the
// verifier re-derives all of it independently.
import { referenceCrop } from "../src/package-bake";
import { plateUvBounds, plateUvWindow, uvTransformConstants, type UvWindow } from "../src/engines/layered-makeup/plate-uv-window";

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

/**
 * A BC4 encoding of any level 0 (`bytes`, width × height, image rows top to bottom; sides multiples of 4), stored
 * bottom to top: each block's endpoints are its largest and smallest value with the eight-value palette, each texel
 * the nearest entry. Returns the serialized `renderTextureResource` and the level as the encoding decodes it (image
 * rows top to bottom), which a fake texture export must return so the stored-row check compares like with like.
 */
export function encodedBc4(bytes: Uint8Array, width: number, height: number) {
  const blocksWide = width / 4, blocksHigh = height / 4, data = Buffer.alloc(blocksWide * blocksHigh * 8), decoded = new Uint8Array(width * height);
  for (let by = 0; by < blocksHigh; by++) for (let bx = 0; bx < blocksWide; bx++) {
    const texels = Array.from({ length: 16 }, (_, k) => (height - 1 - (by * 4 + (k >> 2))) * width + bx * 4 + (k & 3));
    let hi = 0, lo = 255;
    for (const t of texels) { hi = Math.max(hi, bytes[t]); lo = Math.min(lo, bytes[t]); }
    const at = (by * blocksWide + bx) * 8;
    let bits = 0n;
    if (hi === lo) { data[at] = hi; data[at + 1] = lo; for (const t of texels) decoded[t] = hi; }
    else {
      const palette = [hi, lo, ...Array.from({ length: 6 }, (_, j) => ((6 - j) * hi + (j + 1) * lo) / 7)];
      data[at] = hi; data[at + 1] = lo;
      texels.forEach((t, k) => {
        let best = 0;
        for (let i = 1; i < 8; i++) if (Math.abs(palette[i] - bytes[t]) < Math.abs(palette[best] - bytes[t])) best = i;
        bits |= BigInt(best) << BigInt(3 * k);
        decoded[t] = Math.round(palette[best]);
      });
    }
    for (let k = 0; k < 6; k++) data[at + 2 + k] = Number((bits >> BigInt(8 * k)) & 0xffn);
  }
  return { renderTextureResource: { renderResourceBlobPC: { Data: { header: { mipMapInfo: [{ layout: { rowPitch: blocksWide * 8, slicePitch: data.length },
    placement: { offset: 0, size: data.length } }] }, textureData: { Bytes: data.toString("base64") } } } }, decoded };
}
