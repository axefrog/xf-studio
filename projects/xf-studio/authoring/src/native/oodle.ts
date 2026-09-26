/**
 * Host adapter: the game's own Oodle decompressor, loaded at runtime from the user's installation through Bun's FFI. XF Studio
 * never ships or copies the library; it reads `bin/x64/oo2ext_7_win64.dll` where the game installed it.
 *
 * The export is `OodleLZ_Decompress`, the public Oodle Data API entry point [source: knowledge/archive-format.md §2, from the
 * published Oodle signature as declared by RED4ext.SDK-era tools and the modding wiki; runtime: game 2.31's DLL, 26 Sep 2026]:
 *
 *   SINTa OodleLZ_Decompress(const void* compBuf, SINTa compBufSize, void* rawBuf, SINTa rawLen,
 *     OodleLZ_FuzzSafe fuzzSafe, OodleLZ_CheckCRC checkCRC, OodleLZ_Verbosity verbosity,
 *     void* decBufBase, SINTa decBufSize, OodleDecompressCallback* fpCallback, void* callbackUserData,
 *     void* decoderMemory, SINTa decoderMemorySize, OodleLZ_Decode_ThreadPhase threadPhase)
 *
 * `SINTa` is pointer-sized (64-bit here). It returns the number of bytes written, or 0 on failure. We pass fuzzSafe = 1 (the
 * decoder checks its input and never reads or writes out of bounds), checkCRC = 0 (the streams carry no CRC we rely on),
 * verbosity = 0, no dictionary base, no callback, no caller-provided decoder memory, and threadPhase = 3 (both phases in this
 * call, the unthreaded mode). The output buffer gets 64 spare bytes, a margin some Oodle builds want past `rawLen`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Decompress } from "./kark";

/** Where the game keeps the library, relative to the game folder. */
export const GAME_OODLE_LIBRARY = ["bin", "x64", "oo2ext_7_win64.dll"] as const;
const OUTPUT_MARGIN = 64;

export interface OodleLibrary {
  readonly path: string;
  /** Stable text for cache keys: a short SHA-256 of the library (game 2.31's carries no version resource). */
  readonly identity: string;
  readonly decompress: Decompress;
  close(): void;
}

export class OodleUnavailableError extends Error {}

/** The game folder's Oodle library, or a typed error saying why it can't be used (not Windows x64, missing, won't load). */
export function loadGameOodle(gameRoot: string): OodleLibrary {
  const path = join(gameRoot, ...GAME_OODLE_LIBRARY);
  if (process.platform !== "win32" || process.arch !== "x64") throw new OodleUnavailableError("The game's Oodle library runs on 64-bit Windows only.");
  if (!existsSync(path)) throw new OodleUnavailableError("The game folder has no Oodle library (bin/x64/oo2ext_7_win64.dll).");
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  let library: { symbols: { OodleLZ_Decompress: (...args: unknown[]) => number | bigint }; close(): void };
  let pointer: (view: Uint8Array, offset?: number) => unknown;
  try {
    const ffi = import.meta.require("bun:ffi") as typeof import("bun:ffi");
    const { FFIType } = ffi;
    pointer = (view, offset = 0) => ffi.ptr(view, offset);
    library = ffi.dlopen(path, {
      OodleLZ_Decompress: { args: [FFIType.ptr, FFIType.i64, FFIType.ptr, FFIType.i64, FFIType.i32, FFIType.i32, FFIType.i32,
        FFIType.ptr, FFIType.i64, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i64, FFIType.i32], returns: FFIType.i64 },
    }) as unknown as typeof library;
  } catch (error) { throw new OodleUnavailableError(`The game's Oodle library could not be loaded: ${(error as Error).message}`); }
  const decompress: Decompress = (stored, size) => {
    if (!stored.length || !size) throw Error("Empty Oodle stream.");
    const out = new Uint8Array(size + OUTPUT_MARGIN);
    const written = Number(library.symbols.OodleLZ_Decompress(pointer(stored), stored.length, pointer(out), size, 1, 0, 0, null, 0, null, null, null, 0, 3));
    if (written !== size) throw Error(`Oodle decompressed ${written} of ${size} bytes.`);
    return out.subarray(0, size);
  };
  return { path, identity: `oodle:${sha256.slice(0, 16)}`, decompress, close: () => library.close() };
}
