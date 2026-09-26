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
 *
 * Before loading, the library is checked: its SHA-256 is on the known list (game releases whose DLL was verified), or its
 * Authenticode signature is valid and its signer is CD PROJEKT S.A. (game 2.31's DLL is signed so). While checking and loading, the
 * file is held open without write or delete sharing, so it cannot be changed, replaced or renamed between the check and the load;
 * the identity comes from the same bytes that were checked. Anything else is refused with `OodleUnavailableError`, and the caller
 * uses WolvenKit instead.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Decompress } from "./kark";
import { NativeDecompressError } from "./native-errors";

/** Where the game keeps the library, relative to the game folder. */
export const GAME_OODLE_LIBRARY = ["bin", "x64", "oo2ext_7_win64.dll"] as const;
const OUTPUT_MARGIN = 64;

/** SHA-256 of Oodle libraries shipped with game releases and checked to carry the CD PROJEKT S.A. signature. */
export const KNOWN_OODLE_SHA256: Readonly<Record<string, string>> = {
  "4f73be5d986b2b11e04fc29ebe478cd38c03d4d3e51da7de5f7d705ea0968eff": "Cyberpunk 2077 2.31 (1,234,056 bytes, signed by CD PROJEKT S.A.)",
};
/** The organisation that signs the game's binaries. */
export const OODLE_SIGNER = "CD PROJEKT S.A.";

export interface OodleLibrary {
  readonly path: string;
  /** Stable text for cache keys: a short SHA-256 of the library bytes that were checked (game 2.31's carries no version resource). */
  readonly identity: string;
  /** SHA-256 of the library bytes that were checked and loaded. */
  readonly sha256: string;
  /** How the library was trusted: `known-hash` or `authenticode`. */
  readonly trustedBy: string;
  readonly decompress: Decompress;
  close(): void;
}

export class OodleUnavailableError extends Error { override name = "OodleUnavailableError"; }

/** An Authenticode verdict: the signature status and the signer certificate's subject, for the file whose SHA-256 is `sha256`. */
export interface AuthenticodeResult { readonly status: string; readonly subject: string; readonly sha256: string }

/** Decides whether library bytes may be loaded: how they are trusted, or the reason to refuse them. */
export type OodleVerifier = (path: string, sha256: string) => { readonly trustedBy: string } | { readonly refused: string };

/** The value of attribute `key` (e.g. CN, O) in an X.500 subject. */
export function subjectField(subject: string, key: string): string | null {
  for (const part of subject.match(/(?:[^,"]|"[^"]*")+/g) ?? []) {
    const [name, ...rest] = part.split("=");
    if (name?.trim().toUpperCase() === key) return rest.join("=").trim().replace(/^"|"$/g, "");
  }
  return null;
}

/** Whether a verdict is a valid signature by the game's publisher on exactly these bytes. */
export function isPublisherSignature(result: AuthenticodeResult, sha256: string): boolean {
  return result.status === "Valid" && result.sha256.toLowerCase() === sha256.toLowerCase()
    && subjectField(result.subject, "CN") === OODLE_SIGNER && subjectField(result.subject, "O") === OODLE_SIGNER;
}

/**
 * The Authenticode verdict of a file, from Windows PowerShell's `Get-AuthenticodeSignature` (WinVerifyTrust, including the
 * certificate chain), with the SHA-256 PowerShell read in the same call so the caller can tie the verdict to its own bytes.
 */
export function authenticodeSignature(path: string): AuthenticodeResult {
  const shell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = "Import-Module Microsoft.PowerShell.Security, Microsoft.PowerShell.Utility; $p=$env:XFS_AUTHENTICODE_PATH;"
    + " $s=Get-AuthenticodeSignature -LiteralPath $p; $h=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash;"
    + " [pscustomobject]@{status=[string]$s.Status; subject=[string]$s.SignerCertificate.Subject; sha256=[string]$h} | ConvertTo-Json -Compress";
  // A PSModulePath inherited from PowerShell 7 points Windows PowerShell 5.1 at modules it cannot load; let it use its own.
  const env: Record<string, string | undefined> = { ...process.env, XFS_AUTHENTICODE_PATH: path };
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PSMODULEPATH") delete env[key];
  const run = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", script], { env, encoding: "utf8", timeout: 30_000, windowsHide: true });
  if (run.status !== 0) throw new OodleUnavailableError(`The Oodle library's signature could not be checked (PowerShell exit ${run.status ?? run.error?.message}).`);
  let parsed: Partial<AuthenticodeResult>;
  try { parsed = JSON.parse(run.stdout) as Partial<AuthenticodeResult>; }
  catch { throw new OodleUnavailableError("The Oodle library's signature could not be checked (unreadable PowerShell output)."); }
  return { status: String(parsed.status ?? ""), subject: String(parsed.subject ?? ""), sha256: String(parsed.sha256 ?? "") };
}

/** Known hash first; otherwise a valid Authenticode signature by CD PROJEKT S.A. on the same bytes. */
export const defaultOodleVerifier: OodleVerifier = (path, sha256) => {
  if (Object.hasOwn(KNOWN_OODLE_SHA256, sha256)) return { trustedBy: "known-hash" };
  const verdict = authenticodeSignature(path);
  if (isPublisherSignature(verdict, sha256)) return { trustedBy: "authenticode" };
  if (!verdict.sha256 || !verdict.status) return { refused: "The Oodle library's signature could not be checked." };
  return { refused: verdict.sha256.toLowerCase() !== sha256 ? "The Oodle library changed while it was checked."
    : `The Oodle library is not signed by ${OODLE_SIGNER} (signature ${verdict.status || "missing"}).` };
};

type Ffi = typeof import("bun:ffi");

/**
 * Hold a file open for reading while denying writes, deletes and renames (Windows share mode FILE_SHARE_READ only). Returns the
 * release function.
 */
export function holdFile(ffi: Ffi, path: string): () => void {
  const { FFIType } = ffi;
  const kernel32 = ffi.dlopen("kernel32.dll", {
    // Handles are pointer-sized; as i64 they come back as BigInt, so INVALID_HANDLE_VALUE is exactly -1n.
    CreateFileW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.i64 },
    CloseHandle: { args: [FFIType.i64], returns: FFIType.i32 },
  });
  const wide = Buffer.from(`${path}\0`, "utf16le");
  const GENERIC_READ = 0x80000000, FILE_SHARE_READ = 1, OPEN_EXISTING = 3, FILE_ATTRIBUTE_NORMAL = 0x80;
  const handle = BigInt(kernel32.symbols.CreateFileW(ffi.ptr(wide), GENERIC_READ, FILE_SHARE_READ, null, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, null) as bigint | number);
  if (handle === -1n || handle === 0n) {
    kernel32.close();
    throw new OodleUnavailableError("The game's Oodle library could not be opened for checking (it is in use or missing).");
  }
  return () => { kernel32.symbols.CloseHandle(handle); kernel32.close(); };
}

/**
 * The game folder's Oodle library, or a typed error saying why it can't be used (not Windows x64, missing, untrusted, won't load).
 * `verify` decides trust (tests inject one); the default accepts known hashes and CD PROJEKT S.A. signatures.
 */
export function loadGameOodle(gameRoot: string, options: { verify?: OodleVerifier } = {}): OodleLibrary {
  const path = join(gameRoot, ...GAME_OODLE_LIBRARY);
  if (process.platform !== "win32" || process.arch !== "x64") throw new OodleUnavailableError("The game's Oodle library runs on 64-bit Windows only.");
  if (!existsSync(path)) throw new OodleUnavailableError("The game folder has no Oodle library (bin/x64/oo2ext_7_win64.dll).");
  let ffi: Ffi;
  try { ffi = import.meta.require("bun:ffi") as Ffi; }
  catch (error) { throw new OodleUnavailableError(`Native libraries cannot be loaded here: ${(error as Error).message}`); }
  const release = holdFile(ffi, path);
  let library: { symbols: { OodleLZ_Decompress: (...args: unknown[]) => number | bigint }; close(): void };
  let sha256: string, trustedBy: string;
  try {
    // The file cannot change while held, so these bytes are the ones checked and then loaded.
    sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
    const verdict = (options.verify ?? defaultOodleVerifier)(path, sha256);
    if ("refused" in verdict) throw new OodleUnavailableError(verdict.refused);
    trustedBy = verdict.trustedBy;
    const { FFIType } = ffi;
    try {
      library = ffi.dlopen(path, {
        OodleLZ_Decompress: { args: [FFIType.ptr, FFIType.i64, FFIType.ptr, FFIType.i64, FFIType.i32, FFIType.i32, FFIType.i32,
          FFIType.ptr, FFIType.i64, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i64, FFIType.i32], returns: FFIType.i64 },
      }) as unknown as typeof library;
    } catch (error) { throw new OodleUnavailableError(`The game's Oodle library could not be loaded: ${(error as Error).message}`); }
  } finally { release(); }
  const pointer = (view: Uint8Array) => ffi.ptr(view);
  const decompress: Decompress = (stored, size) => {
    if (!stored.length || !size) throw new NativeDecompressError("Empty Oodle stream.");
    const out = new Uint8Array(size + OUTPUT_MARGIN);
    const written = Number(library.symbols.OodleLZ_Decompress(pointer(stored), stored.length, pointer(out), size, 1, 0, 0, null, 0, null, null, null, 0, 3));
    if (written !== size) throw new NativeDecompressError(`Oodle decompressed ${written} of ${size} bytes.`);
    return out.subarray(0, size);
  };
  return { path, identity: `oodle:${sha256.slice(0, 16)}`, sha256, trustedBy, decompress, close: () => library.close() };
}
