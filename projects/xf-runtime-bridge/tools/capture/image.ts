// Pixel operations for captures: crop, area-filter downscale, and PNG encode/decode.
// Self-contained (node:zlib only) so the capture path has no image-library dependency.

import { deflateSync, inflateSync } from "node:zlib";
import type { Pixels } from "./win32.ts";

export type Rect = { x: number; y: number; width: number; height: number };

export function crop(pixels: Pixels, rect: Rect): Pixels {
  const { x, y, width, height } = rect;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > pixels.width || y + height > pixels.height) {
    throw new RangeError(`crop ${JSON.stringify(rect)} is outside ${pixels.width}x${pixels.height}`);
  }
  if (x === 0 && y === 0 && width === pixels.width && height === pixels.height) return pixels;
  const rgb = new Uint8Array(width * height * 3);
  const rowBytes = width * 3;
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * pixels.width + x) * 3;
    rgb.set(pixels.rgb.subarray(from, from + rowBytes), row * rowBytes);
  }
  return { width, height, rgb };
}

/**
 * Output size for a downscale: fits inside maxWidth x maxHeight (either may be omitted) or
 * applies `scale`, keeping the aspect ratio. Never upscales; never returns less than 1 px.
 */
export function fitSize(
  width: number,
  height: number,
  limits: { maxWidth?: number; maxHeight?: number; scale?: number },
): { width: number; height: number; factor: number } {
  let factor = 1;
  if (limits.scale !== undefined) factor = Math.min(factor, limits.scale);
  if (limits.maxWidth !== undefined) factor = Math.min(factor, limits.maxWidth / width);
  if (limits.maxHeight !== undefined) factor = Math.min(factor, limits.maxHeight / height);
  if (factor >= 1) return { width, height, factor: 1 };
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
    factor,
  };
}

// For each output index along one axis: the source indices it covers and their area weights
// (fractions of a source pixel), normalised to sum to 1.
function areaWeights(sourceSize: number, targetSize: number) {
  const ratio = sourceSize / targetSize;
  const starts = new Int32Array(targetSize);
  const counts = new Int32Array(targetSize);
  const weights: number[] = [];
  const offsets = new Int32Array(targetSize);
  for (let out = 0; out < targetSize; out++) {
    const begin = out * ratio;
    const end = Math.min(sourceSize, (out + 1) * ratio);
    const first = Math.floor(begin);
    const last = Math.min(sourceSize - 1, Math.ceil(end) - 1);
    starts[out] = first;
    counts[out] = last - first + 1;
    offsets[out] = weights.length;
    for (let s = first; s <= last; s++) {
      const covered = Math.min(end, s + 1) - Math.max(begin, s);
      weights.push(covered / (end - begin));
    }
  }
  return { starts, counts, offsets, weights: Float64Array.from(weights) };
}

/**
 * Area (box) filter downscale: each output pixel is the exact area-weighted mean of the source
 * pixels it covers, so fine detail averages instead of aliasing. Separable: rows, then columns.
 * Works in sRGB values, like most viewers' downscales.
 */
export function downscaleArea(pixels: Pixels, width: number, height: number): Pixels {
  if (width === pixels.width && height === pixels.height) return pixels;
  if (width > pixels.width || height > pixels.height) throw new RangeError("downscaleArea never upscales");
  const sw = pixels.width;
  const sh = pixels.height;
  const src = pixels.rgb;
  const h = areaWeights(sw, width);
  const v = areaWeights(sh, height);

  // Horizontal pass: sh rows x width columns, float.
  const mid = new Float32Array(width * sh * 3);
  for (let row = 0; row < sh; row++) {
    const rowBase = row * sw * 3;
    const midBase = row * width * 3;
    for (let out = 0; out < width; out++) {
      let r = 0;
      let g = 0;
      let b = 0;
      const start = h.starts[out];
      const offset = h.offsets[out];
      for (let k = 0; k < h.counts[out]; k++) {
        const weight = h.weights[offset + k];
        const i = rowBase + (start + k) * 3;
        r += src[i] * weight;
        g += src[i + 1] * weight;
        b += src[i + 2] * weight;
      }
      const o = midBase + out * 3;
      mid[o] = r;
      mid[o + 1] = g;
      mid[o + 2] = b;
    }
  }
  // Vertical pass.
  const rgb = new Uint8Array(width * height * 3);
  for (let out = 0; out < height; out++) {
    const start = v.starts[out];
    const offset = v.offsets[out];
    const count = v.counts[out];
    for (let col = 0; col < width; col++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < count; k++) {
        const weight = v.weights[offset + k];
        const i = ((start + k) * width + col) * 3;
        r += mid[i] * weight;
        g += mid[i + 1] * weight;
        b += mid[i + 2] * weight;
      }
      const o = (out * width + col) * 3;
      rgb[o] = Math.min(255, Math.round(r));
      rgb[o + 1] = Math.min(255, Math.round(g));
      rgb[o + 2] = Math.min(255, Math.round(b));
    }
  }
  return { width, height, rgb };
}

// --- PNG ---------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const typeBytes = new TextEncoder().encode(type);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return out;
}

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** 8-bit RGB PNG. Each row uses the filter with the smallest absolute sum (the libpng heuristic). */
export function encodePng(pixels: Pixels): Uint8Array {
  const { width, height, rgb } = pixels;
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  const candidate = new Uint8Array(stride);
  const best = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rgb.subarray((y - 1) * stride, y * stride) : null;
    let bestSum = Infinity;
    let bestType = 0;
    for (let type = 0; type <= 4; type++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 3 ? row[i - 3] : 0;
        const b = prev ? prev[i] : 0;
        const c = prev && i >= 3 ? prev[i - 3] : 0;
        let predicted = 0;
        if (type === 1) predicted = a;
        else if (type === 2) predicted = b;
        else if (type === 3) predicted = (a + b) >> 1;
        else if (type === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const value = (row[i] - predicted) & 0xff;
        candidate[i] = value;
        sum += value < 128 ? value : 256 - value;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) {
        bestSum = sum;
        bestType = type;
        best.set(candidate);
      }
    }
    raw[y * (stride + 1)] = bestType;
    raw.set(best, y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const parts = [
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 6 }))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Decodes 8-bit, non-interlaced RGB or RGBA PNGs (what encodePng and most tools write). */
export function decodePng(bytes: Uint8Array): Pixels {
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error("not a PNG file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Uint8Array[] = [];
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const depth = data[8];
      const colour = data[9];
      if (depth !== 8 || (colour !== 2 && colour !== 6) || data[12] !== 0) {
        throw new Error("only 8-bit, non-interlaced RGB or RGBA PNGs are supported");
      }
      channels = colour === 2 ? 3 : 4;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const compressed = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of idat) {
    compressed.set(part, at);
    at += part.length;
  }
  const raw = new Uint8Array(inflateSync(compressed));
  const stride = width * channels;
  const pixelsOut = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixelsOut.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixelsOut.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      let predicted = 0;
      if (type === 1) predicted = a;
      else if (type === 2) predicted = b;
      else if (type === 3) predicted = (a + b) >> 1;
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (type !== 0) throw new Error(`bad PNG filter ${type}`);
      row[i] = (line[i] + predicted) & 0xff;
    }
  }
  if (channels === 3) return { width, height, rgb: pixelsOut };
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < pixelsOut.length; i += 4, j += 3) {
    rgb[j] = pixelsOut[i];
    rgb[j + 1] = pixelsOut[i + 1];
    rgb[j + 2] = pixelsOut[i + 2];
  }
  return { width, height, rgb };
}
