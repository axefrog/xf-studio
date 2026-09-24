// Independent reader for the uncompressed DX10 DDS files the package verifier
// inspects: the supplied import chain and WolvenKit's decompressed XBM export.
// Pure; deliberately separate from the compiler's DDS writer.

export interface DdsChain {
  readonly side: number;
  /** One byte array per level, largest first; RGBA8 for diffuse, R8 for scalar maps. */
  readonly levels: readonly Uint8Array[];
}

const FORMAT_RGBA8_SRGB = 29, FORMAT_R8 = 61, TEXTURE_2D = 3;

export function readDdsChain(data: Uint8Array, channel: "diffuse" | "roughness" | "metalness", label = "DDS"): DdsChain {
  const ascii = (from: number) => String.fromCharCode(...data.subarray(from, from + 4));
  if (data.length < 148 || ascii(0) !== "DDS " || ascii(84) !== "DX10") throw new Error(`Unsupported DDS header: ${label}`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength), u32 = (at: number) => view.getUint32(at, true);
  const height = u32(12), width = u32(16), count = u32(28);
  const format = u32(128), dimension = u32(132), arraySize = u32(140);
  const bytesPerTexel = channel === "diffuse" ? 4 : 1;
  const powerOfTwo = width >= 1 && (width & (width - 1)) === 0;
  if (height !== width || !powerOfTwo || count !== Math.log2(width) + 1)
    throw new Error(`Unexpected DDS dimensions or mip count: ${label}`);
  if (format !== (bytesPerTexel === 4 ? FORMAT_RGBA8_SRGB : FORMAT_R8) || dimension !== TEXTURE_2D || arraySize !== 1)
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
