// Complete DDS mip chains for the flat mesh-decal package adapter. Pure: no IO.
//
// TypeScript port of experiments/005-preset-collection/mip_maps.py, which remains
// the research oracle. REDengine's selected mesh-decal pass squares filtered
// diffuse alpha and blends sqrt(linear colour), roughness and metalness by that
// coverage. Lower mip texel centres therefore average those *destination
// contributions*, not the source bytes. This cannot make bilinear/trilinear
// filtering exact between centres.
//
// The arithmetic deliberately mirrors the NumPy float64 order so that the bytes
// match the oracle: each 2x2 box is summed row-major ((a + b) + c) + d and then
// divided by four; squares are x * x (NumPy's fast path for ** 2) and only the
// 2.4 and 1/2.4 exponents use Math.pow. Byte quantisation is floor(clip * 255 + .5).
//
// Non-square chains (the plate-local UV window's 2048x512 maps) halve both sides until the
// shorter reaches 1; after that each level is the two-texel mean (a + b) / 2 along the longer
// side, down to 1x1. The Python oracle covers square chains only.

export type FlatMapChannel = "diffuse" | "roughness" | "metalness";

export interface FlatMipChain {
  readonly diffuse: readonly Uint8Array[];
  readonly roughness: readonly Uint8Array[];
  readonly metalness: readonly Uint8Array[];
}

/** Six float64 channels per texel: premultiplied sqrt-linear RGB, roughness, metalness, coverage. */
export const CONTRIBUTION_CHANNELS = 6;

const INV_GAMMA = 1 / 2.4;

function srgbToLinear(v: number): number {
  return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4);
}

function linearToSrgb(v: number): number {
  return v <= .0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), INV_GAMMA) - .055;
}

function clip01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function toByte(v: number): number {
  return Math.floor(clip01(v) * 255 + .5);
}

function isPowerOfTwo(size: number): boolean {
  return Number.isInteger(size) && size >= 1 && (size & (size - 1)) === 0 && size <= 1 << 30;
}

/** Number of levels in a complete power-of-two chain: log2 of the longer side plus one (Python's size.bit_length() when square). */
export function mipLevelCount(width: number, height = width): number {
  if (!isPowerOfTwo(width) || !isPowerOfTwo(height)) throw new RangeError("Texture size must be a positive power of two");
  return Math.log2(Math.max(width, height)) + 1;
}

/** Dimensions of each level of a complete chain: both sides halve, and a side that reaches 1 stays 1. */
export function mipDimensions(width: number, height = width): { width: number; height: number }[] {
  const count = mipLevelCount(width, height), out: { width: number; height: number }[] = [];
  for (let level = 0; level < count; level++) out.push({ width: Math.max(1, width >> level), height: Math.max(1, height >> level) });
  return out;
}

/** Destination contributions of a base level; `size` must be square power-of-two. */
export function destinationContributions(diffuse: Uint8Array, roughness: Uint8Array,
  metalness: Uint8Array, width: number, height = width): Float64Array {
  const texels = width * height;
  if (diffuse.length !== texels * 4 || roughness.length !== texels || metalness.length !== texels)
    throw new RangeError("Base map byte length does not match size");
  const out = new Float64Array(texels * CONTRIBUTION_CHANNELS);
  // Only 256 distinct inputs reach the colour transfer; a table avoids 3M pow calls.
  const sqrtLinear = new Float64Array(256);
  for (let b = 0; b < 256; b++) sqrtLinear[b] = Math.sqrt(srgbToLinear(b / 255));
  for (let i = 0; i < texels; i++) {
    const a = diffuse[i * 4 + 3] / 255, coverage = a * a, o = i * CONTRIBUTION_CHANNELS;
    out[o] = sqrtLinear[diffuse[i * 4]] * coverage;
    out[o + 1] = sqrtLinear[diffuse[i * 4 + 1]] * coverage;
    out[o + 2] = sqrtLinear[diffuse[i * 4 + 2]] * coverage;
    out[o + 3] = roughness[i] / 255 * coverage;
    out[o + 4] = metalness[i] / 255 * coverage;
    out[o + 5] = coverage;
  }
  return out;
}

/**
 * One box reduction of a power-of-two level with `planes` interleaved channels: the 2x2 mean
 * (((a + b) + c) + d) / 4 while both sides exceed 1, and the two-texel mean (a + b) / 2 along the
 * remaining side once the other has reached 1 (the tail of a non-square chain).
 */
export function reducePlanes(level: Float64Array<ArrayBufferLike>, width: number, height: number, planes: number): Float64Array<ArrayBufferLike> {
  if (width === 1 && height === 1) throw new RangeError("The 1x1 level has no successor");
  // Preset export is power-of-two. Stay strict rather than dropping an odd edge.
  if ((width > 1 && width % 2) || (height > 1 && height % 2)) throw new RangeError("Mip source dimensions must be even");
  if (level.length !== width * height * planes) throw new RangeError("Contribution length does not match size");
  const c = planes;
  if (width > 1 && height > 1) {
    const w = width / 2, h = height / 2, out = new Float64Array(w * h * c);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = ((2 * y) * width + 2 * x) * c, b = a + c, d = a + width * c, e = d + c, o = (y * w + x) * c;
      for (let k = 0; k < c; k++) out[o + k] = (((level[a + k] + level[b + k]) + level[d + k]) + level[e + k]) / 4;
    }
    return out;
  }
  // One row or one column: neighbouring texels are consecutive in memory either way.
  const n = width * height / 2, out = new Float64Array(n * c);
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) out[i * c + k] = (level[2 * i * c + k] + level[(2 * i + 1) * c + k]) / 2;
  return out;
}

/** One box reduction of a contribution level (see reducePlanes). */
export function reduceContributions(level: Float64Array, width: number, height = width): Float64Array {
  return reducePlanes(level, width, height, CONTRIBUTION_CHANNELS) as Float64Array;
}

/** Encode reduced contributions back to diffuse RGBA plus roughness and metalness bytes. */
export function encodeContributions(level: Float64Array, texels: number): { diffuse: Uint8Array; roughness: Uint8Array; metalness: Uint8Array } {
  if (level.length !== texels * CONTRIBUTION_CHANNELS) throw new RangeError("Contribution length does not match size");
  const diffuse = new Uint8Array(texels * 4), roughness = new Uint8Array(texels), metalness = new Uint8Array(texels);
  for (let i = 0; i < texels; i++) {
    const o = i * CONTRIBUTION_CHANNELS, coverage = level[o + 5];
    if (coverage > 0) {
      for (let k = 0; k < 3; k++) {
        const v = clip01(level[o + k] / coverage);
        diffuse[i * 4 + k] = toByte(linearToSrgb(v * v));
      }
      roughness[i] = toByte(level[o + 3] / coverage);
      metalness[i] = toByte(level[o + 4] / coverage);
    } else {
      // Zero coverage: NumPy's `where` leaves the zero-filled output, which encodes to 0.
      for (let k = 0; k < 3; k++) diffuse[i * 4 + k] = toByte(linearToSrgb(0));
    }
    diffuse[i * 4 + 3] = toByte(Math.sqrt(coverage));
  }
  return { diffuse, roughness, metalness };
}

/** Full chain. Level 0 is the compiler's exact base bytes; lower levels come from contributions. */
export function flatMipChain(diffuse: Uint8Array, roughness: Uint8Array, metalness: Uint8Array, width: number, height = width): FlatMipChain {
  const dims = mipDimensions(width, height);
  const texels = width * height;
  if (diffuse.length !== texels * 4 || roughness.length !== texels || metalness.length !== texels)
    throw new RangeError("Base map byte length does not match size");
  const chain: { diffuse: Uint8Array[]; roughness: Uint8Array[]; metalness: Uint8Array[] } =
    { diffuse: [diffuse.slice()], roughness: [roughness.slice()], metalness: [metalness.slice()] };
  let level = destinationContributions(diffuse, roughness, metalness, width, height);
  for (let i = 1; i < dims.length; i++) {
    level = reduceContributions(level, dims[i - 1].width, dims[i - 1].height);
    const encoded = encodeContributions(level, dims[i].width * dims[i].height);
    chain.diffuse.push(encoded.diffuse);
    chain.roughness.push(encoded.roughness);
    chain.metalness.push(encoded.metalness);
  }
  return chain;
}

export const DDS_HEADER_BYTES = 148;
/** DXGI_FORMAT_R8G8B8A8_UNORM_SRGB and DXGI_FORMAT_R8_UNORM. */
export const DXGI_RGBA8_SRGB = 29;
export const DXGI_R8 = 61;

/** DXGI_FORMAT_R8G8B8A8_UNORM, used for tangent-normal inputs. */
export const DXGI_RGBA8 = 28;
export type DdsFormat = "rgba8-srgb" | "rgba8-unorm" | "r8";
const DDS_FORMATS: Record<DdsFormat, { stride: number; dxgi: number }> = {
  "rgba8-srgb": { stride: 4, dxgi: DXGI_RGBA8_SRGB }, "rgba8-unorm": { stride: 4, dxgi: DXGI_RGBA8 }, r8: { stride: 1, dxgi: DXGI_R8 },
};

/**
 * Uncompressed DX10 DDS accepted by WolvenKit's XBM importer. The importer
 * compresses to QualityColor/QualityR while retaining the caller's levels when
 * GenerateMipMaps=false. Its exported DDS is checked separately by the verifier.
 */
export function encodeFlatDds(levels: readonly Uint8Array[], size: number | MapSize, channel: FlatMapChannel): Uint8Array {
  if (channel !== "diffuse" && channel !== "roughness" && channel !== "metalness")
    throw new RangeError("Unsupported flat-map channel");
  return encodeDds(levels, size, channel === "diffuse" ? "rgba8-srgb" : "r8");
}

export type MapSize = { readonly width: number; readonly height: number };
/** A complete power-of-two chain (square `size`, or `{ width, height }`) in one uncompressed DX10 DDS file. */
export function encodeDds(levels: readonly Uint8Array[], size: number | MapSize, format: DdsFormat): Uint8Array {
  const spec = DDS_FORMATS[format];
  if (!spec) throw new RangeError("Unsupported DDS format");
  const { width, height } = typeof size === "number" ? { width: size, height: size } : size;
  const dims = mipDimensions(width, height), stride = spec.stride;
  let payload = 0;
  levels.forEach((level, i) => {
    if (!dims[i] || level.length !== dims[i].width * dims[i].height * stride) throw new RangeError("Invalid DDS mip byte length");
    payload += level.length;
  });
  if (levels.length !== dims.length) throw new RangeError("DDS requires a complete power-of-two mip chain");
  const out = new Uint8Array(DDS_HEADER_BYTES + payload), view = new DataView(out.buffer);
  out.set([0x44, 0x44, 0x53, 0x20], 0); // "DDS "
  view.setUint32(4, 124, true); // DDS_HEADER size
  view.setUint32(8, 0x2100f, true); // CAPS|HEIGHT|WIDTH|PITCH|PIXELFORMAT|MIPMAPCOUNT
  view.setUint32(12, height, true);
  view.setUint32(16, width, true);
  view.setUint32(20, width * stride, true);
  view.setUint32(24, 0, true);
  view.setUint32(28, levels.length, true);
  view.setUint32(76, 32, true); // DDS_PIXELFORMAT size
  view.setUint32(80, 4, true); // DDPF_FOURCC
  out.set([0x44, 0x58, 0x31, 0x30], 84); // "DX10"
  view.setUint32(108, 0x401008, true); // TEXTURE|COMPLEX|MIPMAP
  view.setUint32(128, spec.dxgi, true);
  view.setUint32(132, 3, true); // D3D10_RESOURCE_DIMENSION_TEXTURE2D
  view.setUint32(136, 0, true);
  view.setUint32(140, 1, true); // array size
  view.setUint32(144, 0, true);
  let offset = DDS_HEADER_BYTES;
  for (const level of levels) { out.set(level, offset); offset += level.length; }
  return out;
}
