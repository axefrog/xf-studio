/**
 * A `.xbm` (`CBitmapTexture`) resource's pixels: its `rendRenderTextureBlobPC` header, mip layout and data, decoded to RGBA8. Pure
 * apart from the injected decompressor. knowledge/archive-format.md §10 documents the format and the evidence.
 *
 * - `CBitmapTexture.setup` (`STextureGroupSetup`) names the storage: `compression` (`ETextureCompression`) and, when that is
 *   `TCM_None`, `rawFormat` (`ETextureRawFormat`); `isGamma` says whether the colours are sRGB-encoded. Omitted properties are their
 *   class defaults: `TCM_None`, `TRF_TrueColor`, `isGamma` false.
 * - `renderTextureResource.renderResourceBlobPC` is a handle to the `rendRenderTextureBlobPC`: `header.sizeInfo` (width, height,
 *   depth), `header.textureInfo` (type, data size, slice size and count, mip count), `header.mipMapInfo` (one per mip: its placement
 *   offset and size within a slice) and `textureData`, the buffer holding every slice's mips back to back.
 * - The blob holds the texture as cooked for PC: a texture whose `platformMipBiasPC` is 1 stores its top mip at half the
 *   `CBitmapTexture` width and height, so the blob's own `sizeInfo` is the size of mip 0.
 * - The mip layout's `rowPitch` and `slicePitch` are not trusted (a microblend's first mip gives a row pitch of 595 M bytes). Each
 *   mip's size is computed from its format and dimensions and must fit inside its placement, and every placement inside the slice.
 *
 * Only what the preview draws is decoded: 2-D textures with one slice, in the block formats BC1, BC3, BC4, BC5 and BC7, or the raw
 * formats RGBA8 (`TRF_TrueColor`), R8 (`TRF_Grayscale`) and R8G8 (`TRF_R8G8`). Anything else (cube maps, arrays, volume LUTs, HDR,
 * BC6H) is refused as unsupported, and the caller falls back to WolvenKit. A block format's expanded channels follow bcn.ts; R8 is
 * written as grey (R = G = B), R8G8 as red and green with blue 0, as WolvenKit's PNGs show them.
 */
import { blockImageBytes, BlockRowDecoder, type BlockFormat } from "./bcn";
import { NativeBudgetError, NativeMalformedError, NativeUnsupportedError } from "./native-errors";
import { RedBuffer, type RedDocument, RedHandle, RedObject } from "./red-model";

export type RawFormat = "rgba8" | "r8" | "rg8";
export type TextureFormat = BlockFormat | RawFormat;
/** Bytes per texel of the raw formats. */
const RAW_BYTES: Readonly<Record<RawFormat, number>> = { rgba8: 4, r8: 1, rg8: 2 };

/** `ETextureCompression` members this reader decodes, and their block format. */
const COMPRESSIONS: Readonly<Record<string, BlockFormat>> = {
  TCM_DXTNoAlpha: "bc1", TCM_DXTAlpha: "bc3", TCM_DXTAlphaLinear: "bc3", TCM_Normalmap: "bc5", TCM_QualityR: "bc4", TCM_QualityRG: "bc5",
  TCM_QualityColor: "bc7", TCM_Normals_DEPRECATED: "bc1", TCM_NormalsHigh_DEPRECATED: "bc3", TCM_NormalsGloss_DEPRECATED: "bc3",
};
/** `ETextureRawFormat` members this reader decodes (with `TCM_None`). */
const RAW_FORMATS: Readonly<Record<string, RawFormat>> = { TRF_TrueColor: "rgba8", TRF_Grayscale: "r8", TRF_R8G8: "rg8" };

/** Bytes one `width`×`height` image takes in `format`. */
export function imageBytes(format: TextureFormat, width: number, height: number): number {
  return format in RAW_BYTES ? width * height * RAW_BYTES[format as RawFormat] : blockImageBytes(format as BlockFormat, width, height);
}

export interface TextureMip { readonly width: number; readonly height: number; readonly offset: number; readonly size: number }
export interface TextureLayout {
  readonly format: TextureFormat;
  /** The `setup` values that chose it (for messages and records). */
  readonly compression: string;
  readonly rawFormat: string;
  readonly isGamma: boolean;
  /** Mip 0's size as the blob stores it. */
  readonly width: number;
  readonly height: number;
  readonly mips: readonly TextureMip[];
  /** Bytes of `textureData` as the header gives them (every slice). */
  readonly dataSize: number;
  /** The texture data, decompressed on first use (within the decode session's caps). */
  readonly data: () => Uint8Array;
}

/** Caps for a texture decode, besides the reader's resource caps (limits.ts). */
export interface TextureLimits {
  /** Largest side of any texture accepted (the header's mip 0). */
  readonly maxSide: number;
  /** Most mips a texture may list. */
  readonly maxMips: number;
}
export const DEFAULT_TEXTURE_LIMITS: TextureLimits = Object.freeze({ maxSide: 16384, maxMips: 15 });

const fieldsOf = (value: unknown): Record<string, unknown> => value instanceof RedObject ? value.fields : {};
const objectAt = (value: unknown): RedObject | null => value instanceof RedHandle ? value.target : value instanceof RedObject ? value : null;
function count(value: unknown, what: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new NativeMalformedError(`The texture's ${what} is not a count (${String(value)}).`);
  return value;
}

/** The layout of a decoded `CBitmapTexture` document, checked against itself before any pixel is read. */
export function textureLayout(document: RedDocument, limits: TextureLimits = DEFAULT_TEXTURE_LIMITS): TextureLayout {
  const root = document.root;
  if (root.type !== "CBitmapTexture") throw new NativeUnsupportedError(`A ${root.type} is not a bitmap texture.`);
  const setup = fieldsOf(root.fields.setup);
  const compression = typeof setup.compression === "string" ? setup.compression : "TCM_None";
  const rawFormat = typeof setup.rawFormat === "string" ? setup.rawFormat : "TRF_TrueColor";
  const format: TextureFormat | undefined = compression === "TCM_None" ? RAW_FORMATS[rawFormat] : COMPRESSIONS[compression];
  if (!format) throw new NativeUnsupportedError(`Textures stored as ${compression === "TCM_None" ? rawFormat : compression} are not decoded.`);
  const isGamma = setup.isGamma === 1 || setup.isGamma === true;

  const blob = objectAt(fieldsOf(root.fields.renderTextureResource).renderResourceBlobPC);
  if (!blob || blob.type !== "rendRenderTextureBlobPC") throw new NativeUnsupportedError("The texture has no PC texture blob.");
  const header = fieldsOf(blob.fields.header), sizeInfo = fieldsOf(header.sizeInfo), info = fieldsOf(header.textureInfo);
  const type = typeof info.type === "string" ? info.type : "TEXTYPE_2D";
  if (type !== "TEXTYPE_2D") throw new NativeUnsupportedError(`A ${type} texture is not decoded.`);
  const width = count(sizeInfo.width, "width"), height = count(sizeInfo.height, "height"), depth = count(sizeInfo.depth, "depth", 1);
  if (!width || !height || width > limits.maxSide || height > limits.maxSide)
    throw new (width > limits.maxSide || height > limits.maxSide ? NativeBudgetError : NativeMalformedError)(`A ${width}×${height} texture is outside what is decoded (sides 1 to ${limits.maxSide}).`);
  if (depth > 1) throw new NativeUnsupportedError(`A texture ${depth} deep is not decoded.`);
  const slices = count(info.sliceCount, "slice count", 1);
  if (slices !== 1) throw new NativeUnsupportedError(`A texture with ${slices} slices is not decoded.`);
  const dataSize = count(info.textureDataSize, "data size"), sliceSize = count(info.sliceSize, "slice size");
  const mipCount = count(info.mipCount, "mip count", 1);
  const listed = Array.isArray(header.mipMapInfo) ? header.mipMapInfo : [];
  if (mipCount < 1 || mipCount > limits.maxMips || listed.length !== mipCount)
    throw new NativeMalformedError(`The texture lists ${listed.length} mips and counts ${mipCount}.`);
  if (sliceSize > dataSize) throw new NativeMalformedError(`A ${sliceSize}-byte slice is larger than its ${dataSize}-byte data.`);
  const mips: TextureMip[] = listed.map((entry, level) => {
    const placement = fieldsOf(fieldsOf(entry).placement);
    const mipWidth = Math.max(1, width >> level), mipHeight = Math.max(1, height >> level);
    const offset = count(placement.offset, `mip ${level} offset`, 0), size = count(placement.size, `mip ${level} size`);
    const need = imageBytes(format, mipWidth, mipHeight);
    if (size < need) throw new NativeMalformedError(`Mip ${level} (${mipWidth}×${mipHeight}) holds ${size} bytes; ${format} needs ${need}.`);
    if (offset + size > sliceSize) throw new NativeMalformedError(`Mip ${level} lies outside its slice.`);
    return { width: mipWidth, height: mipHeight, offset, size };
  });
  const buffer = blob.fields.textureData;
  if (!(buffer instanceof RedBuffer)) throw new NativeMalformedError("The texture blob has no data buffer.");
  if (buffer.memSize !== dataSize) throw new NativeMalformedError(`The texture data holds ${buffer.memSize} bytes; its header says ${dataSize}.`);
  let bytes: Uint8Array | null = null;
  const data = () => {
    if (bytes) return bytes;
    const read = buffer.bytes();
    if (read.length !== dataSize) throw new NativeMalformedError(`The texture data decompressed to ${read.length} bytes; its header says ${dataSize}.`);
    return (bytes = read);
  };
  return { format, compression, rawFormat, isGamma, width, height, mips, dataSize, data };
}

/** The mip the preview is served: the largest at or under `maxSide` on both sides (the smallest mip when none is). */
export function servedMip(layout: Pick<TextureLayout, "mips">, maxSide: number): number {
  const index = layout.mips.findIndex(mip => mip.width <= maxSide && mip.height <= maxSide);
  return index >= 0 ? index : layout.mips.length - 1;
}

/** One mip's texels, row by row in the served orientation, without the whole image in memory. */
export interface MipRows {
  readonly width: number;
  readonly height: number;
  /** Whether any texel's alpha is below 255. */
  readonly alpha: boolean;
  /** Row `r` of the served image (RGBA8, `width` texels), valid until the next call; rows must be asked for in order 0, 1, 2… */
  row(r: number): Uint8Array;
}

/**
 * One mip's rows as RGBA8, with the channel expansion documented above, **rows flipped**: served row 0 is the last row stored. That is
 * the orientation of WolvenKit's PNG exports, which the preview has always been served (its UVs are read against it), so the native PNG
 * is the same image, texel for texel. Block formats are decoded one block row at a time.
 */
export function mipRows(layout: TextureLayout, level: number): MipRows {
  const mip = layout.mips[level];
  if (!mip) throw new NativeMalformedError(`The texture has no mip ${level}.`);
  const bytes = layout.data().subarray(mip.offset, mip.offset + mip.size);
  const { width, height } = mip, format = layout.format;
  if (format === "rgba8" || format === "r8" || format === "rg8") {
    const step = RAW_BYTES[format], out = new Uint8Array(width * 4);
    let alpha = false;
    if (format === "rgba8") for (let i = 3; i < width * height * 4 && !alpha; i += 4) alpha = bytes[i] !== 255;
    return { width, height, alpha, row(r) {
      const from = (height - 1 - r) * width * step;
      if (format === "rgba8") { out.set(bytes.subarray(from, from + width * 4)); return out; }
      for (let x = 0, o = 0; x < width; x++, o += 4) {
        const red = bytes[from + x * step]!;
        out[o] = red; out[o + 1] = format === "r8" ? red : bytes[from + x * step + 1]!; out[o + 2] = format === "r8" ? red : 0; out[o + 3] = 255;
      }
      return out;
    } };
  }
  const decoder = new BlockRowDecoder(format, bytes, width, height);
  let decoded = -1;
  return { width, height, alpha: decoder.hasAlpha(), row(r) {
    const stored = height - 1 - r, block = stored >> 2;
    if (block !== decoded) { decoder.row(block); decoded = block; }
    const at = (stored & 3) * width * 4;
    return decoder.rows.subarray(at, at + width * 4);
  } };
}

/** One mip's texels as one RGBA8 image in the served orientation (`mipRows`, collected: tests and tools). */
export function decodeMip(layout: TextureLayout, level: number): { width: number; height: number; data: Uint8Array } {
  const rows = mipRows(layout, level), data = new Uint8Array(rows.width * rows.height * 4);
  for (let r = 0; r < rows.height; r++) data.set(rows.row(r), r * rows.width * 4);
  return { width: rows.width, height: rows.height, data };
}

/** Whether a texture's texels need an alpha channel (any alpha below 255). */
export function hasAlpha(data: Uint8Array): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true;
  return false;
}
