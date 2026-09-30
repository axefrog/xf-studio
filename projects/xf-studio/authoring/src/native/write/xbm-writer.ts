/**
 * The native texture import: an uncompressed DX10 DDS mip chain and WolvenKit's import settings to the `.xbm` WolvenKit 9.0.1's
 * `import` writes [resource: byte for byte on the Build's textures, tests/native-writer.test.ts; the layout is knowledge/archive-format.md
 * §10.1]. Pure apart from the injected compressor and buffer store.
 *
 * - Every level's rows are reversed first (WolvenKit flips on import, and on export; §10.2), then the chain is block-compressed:
 *   `TCM_QualityR` from R8 to BC4 and `TCM_Normalmap` from RGBA8 to BC5 on the CPU, `TCM_QualityColor` from sRGB RGBA8 to sRGB BC7
 *   on the GPU (bcn.ts). Any other combination is refused (the caller imports that texture with WolvenKit).
 * - The resource: `CBitmapTexture` (PC, the size, depth 1, the import settings as `setup` with `hasMipchain` and no downgrade) holding a
 *   `rendRenderTextureBlobPC`: header version 2, flags 1, the size, `textureInfo` (alignment 8, one slice, the mip count and data size,
 *   2-D) and per level its pitches and placement (levels back to back, each at least one block); `textureData` in buffer flags 0x20000.
 */
import type { TextureImportSettings } from "../../platform/api";
import { BCN_GPU, DXGI, type BcnLibrary } from "./bcn";
import { writeCr2wObject, type StoreBuffer } from "./cr2w-writer";
import { NativeWriteRefusal } from "./red-encoder";

/** A DX10 DDS as the builder writes it: one 2-D texture with a full mip chain. */
export interface DdsTexture { readonly format: number; readonly width: number; readonly height: number; readonly levels: number; readonly pixels: Uint8Array }

const BYTES_PER_TEXEL: Record<number, number> = { [DXGI.R8_UNORM]: 1, [DXGI.R8G8B8A8_UNORM]: 4, [DXGI.R8G8B8A8_UNORM_SRGB]: 4 };

/** Parse the builder's DDS (a DX10 header and a complete chain of an uncompressed format). */
export function readDds(bytes: Uint8Array): DdsTexture {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 148 || ascii(0) !== "DDS " || ascii(84) !== "DX10") throw new NativeWriteRefusal("Not a DX10 DDS.");
  const height = view.getUint32(12, true), width = view.getUint32(16, true), levels = view.getUint32(28, true), format = view.getUint32(128, true);
  if (view.getUint32(132, true) !== 3 || view.getUint32(140, true) !== 1) throw new NativeWriteRefusal("Not a single 2-D texture.");
  const texel = BYTES_PER_TEXEL[format];
  if (!texel) throw new NativeWriteRefusal(`DDS format ${format} is not imported natively.`);
  if (levels !== Math.floor(Math.log2(Math.max(width, height))) + 1) throw new NativeWriteRefusal("The DDS has no complete mip chain.");
  let size = 0;
  for (let level = 0; level < levels; level++) size += Math.max(1, width >> level) * Math.max(1, height >> level) * texel;
  if (148 + size !== bytes.length) throw new NativeWriteRefusal("The DDS size disagrees with its chain.");
  return { format, width, height, levels, pixels: bytes.subarray(148) };
}

/** Each level's rows in reverse order (WolvenKit's import flip). */
export function flipLevels(texture: DdsTexture): Uint8Array {
  const texel = BYTES_PER_TEXEL[texture.format]!, out = new Uint8Array(texture.pixels.length);
  let at = 0;
  for (let level = 0; level < texture.levels; level++) {
    const width = Math.max(1, texture.width >> level), height = Math.max(1, texture.height >> level), row = width * texel;
    for (let y = 0; y < height; y++) out.set(texture.pixels.subarray(at + y * row, at + (y + 1) * row), at + (height - 1 - y) * row);
    at += row * height;
  }
  return out;
}

/** How WolvenKit's import compresses a texture of these settings from this DDS format, or null when not done natively. */
export function importPlan(settings: TextureImportSettings, format: number): { target: number; blockBytes: number; flags: number; weight: number } | null {
  if (settings.GenerateMipMaps || settings.PremultiplyAlpha) return null;
  if (settings.Compression === "TCM_QualityR" && settings.RawFormat === "TRF_Grayscale" && !settings.IsGamma && format === DXGI.R8_UNORM)
    return { target: DXGI.BC4_UNORM, blockBytes: 8, flags: 0, weight: 1 };
  if (settings.Compression === "TCM_QualityColor" && settings.RawFormat === "TRF_TrueColor" && settings.IsGamma && format === DXGI.R8G8B8A8_UNORM_SRGB)
    return { target: DXGI.BC7_UNORM_SRGB, blockBytes: 16, flags: BCN_GPU, weight: 1 };
  if (settings.Compression === "TCM_Normalmap" && settings.RawFormat === "TRF_TrueColor" && !settings.IsGamma && format === DXGI.R8G8B8A8_UNORM)
    return { target: DXGI.BC5_UNORM, blockBytes: 16, flags: 0, weight: 1 };
  return null;
}

/** The mip layout of a block-compressed chain: per level its pitches and placement, and the total size. */
export function blockLayout(width: number, height: number, levels: number, blockBytes: number) {
  const mips: { rowPitch: number; slicePitch: number; offset: number }[] = [];
  let offset = 0;
  for (let level = 0; level < levels; level++) {
    const across = Math.max(1, Math.ceil(Math.max(1, width >> level) / 4)), down = Math.max(1, Math.ceil(Math.max(1, height >> level) / 4));
    const rowPitch = across * blockBytes, slicePitch = rowPitch * down;
    mips.push({ rowPitch, slicePitch, offset });
    offset += slicePitch;
  }
  return { mips, size: offset };
}

/** The `.xbm` bytes WolvenKit's import makes of `dds` with `settings`, or a refusal. */
export function importTexture(dds: Uint8Array, settings: TextureImportSettings, bcn: BcnLibrary, store: StoreBuffer): Uint8Array {
  const texture = readDds(dds);
  const plan = importPlan(settings, texture.format);
  if (!plan) throw new NativeWriteRefusal(`${settings.Compression} from DDS format ${texture.format} is not imported natively.`);
  const layout = blockLayout(texture.width, texture.height, texture.levels, plan.blockBytes);
  const data = bcn.compress(texture.format, flipLevels(texture), texture.width, texture.height, texture.levels, plan.target, plan.flags, plan.weight, layout.size);
  const resource = {
    $type: "CBitmapTexture", cookingPlatform: "PLATFORM_PC", width: texture.width, height: texture.height, depth: 1,
    setup: { $type: "STextureGroupSetup", group: settings.TextureGroup, rawFormat: settings.RawFormat, compression: settings.Compression,
      isStreamable: settings.IsStreamable ? 1 : 0, hasMipchain: 1, isGamma: settings.IsGamma ? 1 : 0, allowTextureDowngrade: 0 },
    renderTextureResource: { $type: "rendRenderTextureResource", renderResourceBlobPC: { HandleId: "0", Data: {
      $type: "rendRenderTextureBlobPC",
      header: { $type: "rendRenderTextureBlobHeader", version: 2, flags: 1,
        sizeInfo: { $type: "rendRenderTextureBlobSizeInfo", width: texture.width, height: texture.height, depth: 1 },
        textureInfo: { $type: "rendRenderTextureBlobTextureInfo", type: "TEXTYPE_2D", textureDataSize: layout.size, sliceSize: layout.size,
          dataAlignment: 8, sliceCount: 1, mipCount: texture.levels },
        mipMapInfo: layout.mips.map(mip => ({ $type: "rendRenderTextureBlobMipMapInfo",
          layout: { $type: "rendRenderTextureBlobMemoryLayout", rowPitch: mip.rowPitch, slicePitch: mip.slicePitch },
          placement: { $type: "rendRenderTextureBlobPlacement", offset: mip.offset, size: mip.slicePitch } })) },
      textureData: { Flags: 0x20000, raw: data } } } },
  };
  return writeCr2wObject({ Version: 195, BuildVersion: 0, RootChunk: resource, EmbeddedFiles: [] }, store);
}
