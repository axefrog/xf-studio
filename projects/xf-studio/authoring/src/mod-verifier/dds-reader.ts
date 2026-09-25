// Independent reader for the uncompressed DX10 DDS files the package verifier
// inspects: the supplied import chain and WolvenKit's decompressed XBM export.
// Pure; deliberately separate from the compiler's DDS writer.

export interface DdsChain {
  readonly side: number;
  /** One byte array per level, largest first; texel size depends on the format. */
  readonly levels: readonly Uint8Array[];
}

/** Texture channels, plus the two normal-map encodings: the RGBA8 import input and WolvenKit's decoded BC5 (RG8). */
export type DdsKind = "diffuse" | "roughness" | "metalness" | "mask" | "gradient" | "normal" | "normal-input";

const FORMAT_RGBA8_SRGB = 29, FORMAT_RGBA8 = 28, FORMAT_RG8 = 49, FORMAT_R8 = 61, TEXTURE_2D = 3;
const KIND: Record<DdsKind, { format: number; bytes: number }> = {
  diffuse: { format: FORMAT_RGBA8_SRGB, bytes: 4 }, gradient: { format: FORMAT_RGBA8_SRGB, bytes: 4 },
  roughness: { format: FORMAT_R8, bytes: 1 }, metalness: { format: FORMAT_R8, bytes: 1 }, mask: { format: FORMAT_R8, bytes: 1 },
  normal: { format: FORMAT_RG8, bytes: 2 }, "normal-input": { format: FORMAT_RGBA8, bytes: 4 },
};

export function readDdsChain(data: Uint8Array, kind: DdsKind, label = "DDS"): DdsChain {
  const spec = KIND[kind];
  if (!spec) throw new Error(`Unsupported DDS kind ${kind}: ${label}`);
  const ascii = (from: number) => String.fromCharCode(...data.subarray(from, from + 4));
  if (data.length < 148 || ascii(0) !== "DDS " || ascii(84) !== "DX10") throw new Error(`Unsupported DDS header: ${label}`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength), u32 = (at: number) => view.getUint32(at, true);
  const height = u32(12), width = u32(16), count = u32(28);
  const format = u32(128), dimension = u32(132), arraySize = u32(140);
  const bytesPerTexel = spec.bytes;
  const powerOfTwo = width >= 1 && (width & (width - 1)) === 0;
  if (height !== width || !powerOfTwo || count !== Math.log2(width) + 1)
    throw new Error(`Unexpected DDS dimensions or mip count: ${label}`);
  if (format !== spec.format || dimension !== TEXTURE_2D || arraySize !== 1)
    throw new Error(`Unexpected DDS format: ${label}`);
  const levels: Uint8Array[] = [];
  let offset = 148;
  for (let level = 0; level < count; level++) {
    const side = Math.max(1, width >>> level), length = side * side * bytesPerTexel;
    if (offset + length > data.length) throw new Error(`Truncated DDS mip: ${label}`);
    levels.push(data.slice(offset, offset + length));
    offset += length;
  }
  if (offset !== data.length) throw new Error(`Unexpected trailing DDS data: ${label}`);
  return { side: width, levels };
}
