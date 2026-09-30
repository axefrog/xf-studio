/**
 * Host adapter: XF Studio's block-compression library (`xfs_bcn.dll`, native/bcn: a C entry point over DirectXTex's encoders, MIT)
 * through Bun's FFI. It compresses a whole mip chain the way WolvenKit 9.0.1's texture import does [resource: byte for byte on the
 * Build's textures, tests/native-writer.test.ts]: BC4 on the CPU; BC7 with DirectXTex's DirectCompute encoder on the GPU (WolvenKit's
 * import makes a hardware Direct3D 11 device when it can, and its BC7 then comes from that encoder). A machine without a usable
 * device gets a refusal, and the caller imports that texture with WolvenKit instead.
 */
import { NativeWriteRefusal } from "./red-encoder";

/** The contract version `xfs_bcn_version` must report. */
export const BCN_LIBRARY_VERSION = 1;
/** `DXGI_FORMAT` values used here. */
export const DXGI = { R8G8B8A8_UNORM: 28, R8G8B8A8_UNORM_SRGB: 29, R8_UNORM: 61, BC4_UNORM: 80, BC5_UNORM: 83, BC7_UNORM: 98, BC7_UNORM_SRGB: 99 } as const;
/** Our entry point's flag: compress on the GPU (DirectCompute). */
export const BCN_GPU = 0x80000000;
/** DirectXTex's `TEX_COMPRESS_PARALLEL`. */
export const BCN_PARALLEL = 0x10000000;

export interface BcnLibrary {
  readonly path: string;
  /** Compress a mip chain (levels back to back, in `source` format) to `target`; the compressed levels back to back. */
  compress(source: number, pixels: Uint8Array, width: number, height: number, levels: number, target: number, flags: number, weight: number, outBytes: number): Uint8Array;
  close(): void;
}

type Ffi = typeof import("bun:ffi");

/** Load the library at `path`, or refuse (not loadable, or the wrong contract version). The caller checks that the file is there. */
export function loadBcnLibrary(path: string): BcnLibrary {
  if (process.platform !== "win32" || process.arch !== "x64") throw new NativeWriteRefusal("The texture compressor runs on 64-bit Windows only.");
  let ffi: Ffi;
  try { ffi = import.meta.require("bun:ffi") as Ffi; }
  catch (error) { throw new NativeWriteRefusal(`Native libraries cannot be loaded here: ${(error as Error).message}`); }
  const { FFIType } = ffi;
  let library: { symbols: { xfs_bcn_version: () => number; xfs_bcn_compress: (...args: unknown[]) => number }; close(): void };
  try {
    library = ffi.dlopen(path, {
      xfs_bcn_version: { args: [], returns: FFIType.u32 },
      xfs_bcn_compress: { args: [FFIType.u32, FFIType.ptr, FFIType.u64, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.f32,
        FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
    }) as unknown as typeof library;
  } catch (error) { throw new NativeWriteRefusal(`XF Studio's texture compressor could not be loaded: ${(error as Error).message}`); }
  const version = library.symbols.xfs_bcn_version();
  if (version !== BCN_LIBRARY_VERSION) { library.close(); throw new NativeWriteRefusal(`The texture compressor is version ${version}, not ${BCN_LIBRARY_VERSION}.`); }
  let closed = false;
  return {
    path,
    compress(source, pixels, width, height, levels, target, flags, weight, outBytes) {
      if (closed) throw new NativeWriteRefusal("The texture compressor was closed.");
      const out = new Uint8Array(outBytes), written = new BigUint64Array(1);
      const code = library.symbols.xfs_bcn_compress(source, ffi.ptr(pixels), pixels.length, width, height, levels, target, flags >>> 0, weight,
        ffi.ptr(out), out.length, ffi.ptr(written));
      if (code !== 0) throw new NativeWriteRefusal(`The texture compressor refused a ${width}x${height} texture (code ${code >>> 0 === code ? code : (code >>> 0).toString(16)}).`);
      if (Number(written[0]) !== outBytes) throw new NativeWriteRefusal(`The texture compressor wrote ${written[0]} of ${outBytes} bytes.`);
      return out;
    },
    close() { if (!closed) { closed = true; library.close(); } },
  };
}

/**
 * A load check: compress one 4x4 gradient to BC4 on the CPU (needs no GPU), decode the block and require it to be close to the gradient.
 * Throws a refusal when the entry point does not work. Used by the library's build script and the desktop packaging gate.
 */
export function checkBcnLibrary(library: BcnLibrary): void {
  const pixels = new Uint8Array(16).map((_, i) => i * 17);
  const block = library.compress(DXGI.R8_UNORM, pixels, 4, 4, 1, DXGI.BC4_UNORM, 0, 0.5, 8);
  const [a, b] = [block[0]!, block[1]!];
  const palette = a > b ? [a, b, ...[1, 2, 3, 4, 5, 6].map(i => ((7 - i) * a + i * b) / 7)]
    : [a, b, ...[1, 2, 3, 4].map(i => ((5 - i) * a + i * b) / 5), 0, 255];
  let bits = 0n;
  for (let i = 7; i >= 2; i--) bits = (bits << 8n) | BigInt(block[i]!);
  const worst = Math.max(...[...pixels].map((value, i) => Math.abs(palette[Number((bits >> BigInt(3 * i)) & 7n)]! - value)));
  // Eight levels over a 0–255 ramp of sixteen: about 26 at worst for any good encoder; a broken one is far off.
  if (worst > 32) throw new NativeWriteRefusal(`The texture compressor made an unexpected BC4 block (${[...block].join(" ")}).`);
}
