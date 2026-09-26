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
 * Authenticode signature is valid and its signer is CD PROJEKT S.A. (game 2.31's DLL is signed so). From the check to the load, the
 * file is held open without write or delete sharing, so it cannot be changed, replaced or renamed, and neither can a folder above
 * it. The bytes hashed are read through that handle, and the library is loaded by the handle's final path (junctions and links
 * resolved), so a junction in the game folder repointed during the check cannot swap in another file. The one residual window is
 * a drive letter redefined for the process's user between the check and the load, which needs code already running as that
 * user. Anything else is refused with `OodleUnavailableError`, and the caller uses WolvenKit instead.
 *
 * `openGameOodle` never blocks the event loop (an unknown library's signature is checked by an asynchronous PowerShell call, up
 * to 30 s); hosts use it. `loadGameOodle` is its blocking twin for command-line tools and workers.
 */
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Decompress } from "./kark";
import { NativeDecompressError } from "./native-errors";

/** Where the game keeps the library, relative to the game folder. */
export const GAME_OODLE_LIBRARY = ["bin", "x64", "oo2ext_7_win64.dll"] as const;
const OUTPUT_MARGIN = 64;
/** The largest library file read for checking (game 2.31's is 1.2 MB). */
const MAX_LIBRARY_BYTES = 64 * 2 ** 20;
const AUTHENTICODE_TIMEOUT_MS = 30_000;

/** SHA-256 of Oodle libraries shipped with game releases and checked to carry the CD PROJEKT S.A. signature. */
export const KNOWN_OODLE_SHA256: Readonly<Record<string, string>> = {
  "4f73be5d986b2b11e04fc29ebe478cd38c03d4d3e51da7de5f7d705ea0968eff": "Cyberpunk 2077 2.31 (1,234,056 bytes, signed by CD PROJEKT S.A.)",
};
/** The organisation that signs the game's binaries. */
export const OODLE_SIGNER = "CD PROJEKT S.A.";

export interface OodleLibrary {
  /** The file that was checked and loaded: the final path of the held handle. */
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

/**
 * The game's Oodle library can't be used. `permanent` when trying again can't help until the library file or the platform changes (not
 * Windows x64, no library, a library not signed by the publisher); a check that failed or timed out, or a library in use, may pass later.
 */
export class OodleUnavailableError extends Error {
  override name = "OodleUnavailableError";
  constructor(message: string, readonly permanent = false) { super(message); }
}

/** An Authenticode verdict: the signature status and the signer certificate's subject, for the file whose SHA-256 is `sha256`. */
export interface AuthenticodeResult { readonly status: string; readonly subject: string; readonly sha256: string }

/** How library bytes are trusted, or the reason to refuse them. */
export type OodleVerdict = { readonly trustedBy: string } | { readonly refused: string; readonly permanent?: boolean };
/** Decides whether library bytes may be loaded; `path` is the held file's final path, `sha256` the hash of the bytes read through it. */
export type OodleVerifier = (path: string, sha256: string) => OodleVerdict | Promise<OodleVerdict>;
/** A verifier that answers at once (for `loadGameOodle`). */
export type OodleVerifierSync = (path: string, sha256: string) => OodleVerdict;

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
 * Windows PowerShell's `Get-AuthenticodeSignature` (WinVerifyTrust, including the certificate chain), with the SHA-256 PowerShell
 * read in the same call so the caller can tie the verdict to its own bytes.
 */
function authenticodeCommand(path: string): { shell: string; args: string[]; env: Record<string, string | undefined> } {
  const shell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = "Import-Module Microsoft.PowerShell.Security, Microsoft.PowerShell.Utility; $p=$env:XFS_AUTHENTICODE_PATH;"
    + " $s=Get-AuthenticodeSignature -LiteralPath $p; $h=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash;"
    + " [pscustomobject]@{status=[string]$s.Status; subject=[string]$s.SignerCertificate.Subject; sha256=[string]$h} | ConvertTo-Json -Compress";
  // A PSModulePath inherited from PowerShell 7 points Windows PowerShell 5.1 at modules it cannot load; let it use its own.
  const env: Record<string, string | undefined> = { ...process.env, XFS_AUTHENTICODE_PATH: path };
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PSMODULEPATH") delete env[key];
  return { shell, args: ["-NoProfile", "-NonInteractive", "-Command", script], env };
}

function parseAuthenticode(stdout: string): AuthenticodeResult {
  let parsed: Partial<AuthenticodeResult>;
  try { parsed = JSON.parse(stdout) as Partial<AuthenticodeResult>; }
  catch { throw new OodleUnavailableError("The Oodle library's signature could not be checked (unreadable PowerShell output)."); }
  return { status: String(parsed.status ?? ""), subject: String(parsed.subject ?? ""), sha256: String(parsed.sha256 ?? "") };
}

/** The Authenticode verdict of a file, without blocking the event loop (up to 30 s). */
export function authenticodeSignature(path: string): Promise<AuthenticodeResult> {
  const { shell, args, env } = authenticodeCommand(path);
  return new Promise((resolve, reject) => {
    execFile(shell, args, { env, encoding: "utf8", timeout: AUTHENTICODE_TIMEOUT_MS, windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout) => {
      if (error) { reject(new OodleUnavailableError(`The Oodle library's signature could not be checked (PowerShell ${error.killed ? "timed out" : `exit ${error.code ?? error.message}`}).`)); return; }
      try { resolve(parseAuthenticode(stdout)); } catch (failure) { reject(failure); }
    });
  });
}

/** The Authenticode verdict of a file, blocking (command-line tools only). */
export function authenticodeSignatureSync(path: string): AuthenticodeResult {
  const { shell, args, env } = authenticodeCommand(path);
  const run = spawnSync(shell, args, { env, encoding: "utf8", timeout: AUTHENTICODE_TIMEOUT_MS, windowsHide: true });
  if (run.status !== 0) throw new OodleUnavailableError(`The Oodle library's signature could not be checked (PowerShell exit ${run.status ?? run.error?.message}).`);
  return parseAuthenticode(run.stdout);
}

/** The verdict for bytes whose hash is not on the known list, from their Authenticode result. */
function signatureVerdict(verdict: AuthenticodeResult, sha256: string): OodleVerdict {
  if (isPublisherSignature(verdict, sha256)) return { trustedBy: "authenticode" };
  if (!verdict.sha256 || !verdict.status) return { refused: "The Oodle library's signature could not be checked." };
  if (verdict.sha256.toLowerCase() !== sha256) return { refused: "The Oodle library changed while it was checked." };
  return { refused: `The Oodle library is not signed by ${OODLE_SIGNER} (signature ${verdict.status || "missing"}).`, permanent: true };
}

/** Known hash first; otherwise a valid Authenticode signature by CD PROJEKT S.A. on the same bytes (checked asynchronously). */
export const defaultOodleVerifier: OodleVerifier = async (path, sha256) =>
  Object.hasOwn(KNOWN_OODLE_SHA256, sha256) ? { trustedBy: "known-hash" } : signatureVerdict(await authenticodeSignature(path), sha256);

/** `defaultOodleVerifier`, blocking while PowerShell checks an unknown library (command-line tools only). */
export const defaultOodleVerifierSync: OodleVerifierSync = (path, sha256) =>
  Object.hasOwn(KNOWN_OODLE_SHA256, sha256) ? { trustedBy: "known-hash" } : signatureVerdict(authenticodeSignatureSync(path), sha256);

type Ffi = typeof import("bun:ffi");

/** A file held open for reading with writes, deletes and renames denied. */
export interface HeldFile {
  /** The handle's final path: every junction and link resolved, in ordinary drive-letter form where it fits. */
  readonly finalPath: string;
  /** The file's bytes, read through the handle; refused past `maxBytes`. */
  read(maxBytes: number): Uint8Array;
  release(): void;
}

/** `\\?\C:\x` → `C:\x` and `\\?\UNC\host\share` → `\\host\share`, unless the short form would be too long for ordinary paths. */
function ordinaryPath(path: string): string {
  const short = path.startsWith("\\\\?\\UNC\\") ? `\\\\${path.slice(8)}` : path.startsWith("\\\\?\\") ? path.slice(4) : path;
  return short.length < 260 ? short : path;
}

/**
 * Hold a file open for reading while denying writes, deletes and renames (Windows share mode FILE_SHARE_READ only). Windows also
 * refuses to rename a folder above a file held so.
 */
export function holdFile(ffi: Ffi, path: string): HeldFile {
  const { FFIType } = ffi;
  const kernel32 = ffi.dlopen("kernel32.dll", {
    // Handles are pointer-sized; as i64 they come back as BigInt, so INVALID_HANDLE_VALUE is exactly -1n.
    CreateFileW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.i64 },
    CloseHandle: { args: [FFIType.i64], returns: FFIType.i32 },
    GetFileSizeEx: { args: [FFIType.i64, FFIType.ptr], returns: FFIType.i32 },
    ReadFile: { args: [FFIType.i64, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    GetFinalPathNameByHandleW: { args: [FFIType.i64, FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.u32 },
  });
  const wide = Buffer.from(`${path}\0`, "utf16le");
  const GENERIC_READ = 0x80000000, FILE_SHARE_READ = 1, OPEN_EXISTING = 3, FILE_ATTRIBUTE_NORMAL = 0x80;
  const handle = BigInt(kernel32.symbols.CreateFileW(ffi.ptr(wide), GENERIC_READ, FILE_SHARE_READ, null, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, null) as bigint | number);
  if (handle === -1n || handle === 0n) {
    kernel32.close();
    throw new OodleUnavailableError("The game's Oodle library could not be opened for checking (it is in use or missing).");
  }
  const release = () => { kernel32.symbols.CloseHandle(handle); kernel32.close(); };
  try {
    // FILE_NAME_NORMALIZED | VOLUME_NAME_DOS (0): the drive-letter path with every reparse point resolved.
    const name = new Uint16Array(32_768);
    const length = kernel32.symbols.GetFinalPathNameByHandleW(handle, ffi.ptr(name), name.length, 0) as number;
    if (!length || length >= name.length) throw new OodleUnavailableError("The game's Oodle library's location could not be resolved.");
    const finalPath = ordinaryPath(Buffer.from(name.buffer, 0, length * 2).toString("utf16le"));
    return {
      finalPath,
      read(maxBytes) {
        const size = new BigInt64Array(1);
        if (!kernel32.symbols.GetFileSizeEx(handle, ffi.ptr(size))) throw new OodleUnavailableError("The game's Oodle library could not be read.");
        if (size[0]! > BigInt(maxBytes)) throw new OodleUnavailableError(`The game's Oodle library is larger than ${maxBytes} bytes.`);
        const out = new Uint8Array(Number(size[0]));
        const got = new Uint32Array(1);
        // The handle is fresh and read only here, so it starts at the file's beginning.
        for (let done = 0; done < out.length; done += got[0]!) {
          if (!kernel32.symbols.ReadFile(handle, ffi.ptr(out.subarray(done)), out.length - done, ffi.ptr(got), null) || !got[0])
            throw new OodleUnavailableError("The game's Oodle library could not be read.");
        }
        return out;
      },
      release,
    };
  } catch (error) { release(); throw error; }
}

/** The held library and the hash of the bytes read through the handle, ready for a verdict. */
interface Prepared { readonly ffi: Ffi; readonly held: HeldFile; readonly sha256: string }

function prepare(gameRoot: string): Prepared {
  const path = join(gameRoot, ...GAME_OODLE_LIBRARY);
  if (process.platform !== "win32" || process.arch !== "x64") throw new OodleUnavailableError("The game's Oodle library runs on 64-bit Windows only.", true);
  if (!existsSync(path)) throw new OodleUnavailableError("The game folder has no Oodle library (bin/x64/oo2ext_7_win64.dll).", true);
  let ffi: Ffi;
  try { ffi = import.meta.require("bun:ffi") as Ffi; }
  catch (error) { throw new OodleUnavailableError(`Native libraries cannot be loaded here: ${(error as Error).message}`); }
  const held = holdFile(ffi, path);
  try { return { ffi, held, sha256: createHash("sha256").update(held.read(MAX_LIBRARY_BYTES)).digest("hex") }; }
  catch (error) { held.release(); throw error; }
}

/** Load the held library by its final path if the verdict trusts it (the caller releases the hold afterwards). */
function load({ ffi, held, sha256 }: Prepared, verdict: OodleVerdict): OodleLibrary {
  if ("refused" in verdict) throw new OodleUnavailableError(verdict.refused, verdict.permanent === true);
  const { FFIType } = ffi;
  let library: { symbols: { OodleLZ_Decompress: (...args: unknown[]) => number | bigint }; close(): void };
  try {
    library = ffi.dlopen(held.finalPath, {
      OodleLZ_Decompress: { args: [FFIType.ptr, FFIType.i64, FFIType.ptr, FFIType.i64, FFIType.i32, FFIType.i32, FFIType.i32,
        FFIType.ptr, FFIType.i64, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i64, FFIType.i32], returns: FFIType.i64 },
    }) as unknown as typeof library;
  } catch (error) { throw new OodleUnavailableError(`The game's Oodle library could not be loaded: ${(error as Error).message}`); }
  const unload = moduleUnloader(ffi, held.finalPath);
  let closed = false;
  const pointer = (view: Uint8Array) => ffi.ptr(view);
  const decompress: Decompress = (stored, size) => {
    // Never call into a library that was unloaded.
    if (closed) throw new NativeDecompressError("The Oodle library was closed.");
    if (!stored.length || !size) throw new NativeDecompressError("Empty Oodle stream.");
    const out = new Uint8Array(size + OUTPUT_MARGIN);
    const written = Number(library.symbols.OodleLZ_Decompress(pointer(stored), stored.length, pointer(out), size, 1, 0, 0, null, 0, null, null, null, 0, 3));
    if (written !== size) throw new NativeDecompressError(`Oodle decompressed ${written} of ${size} bytes.`);
    return out.subarray(0, size);
  };
  return { path: held.finalPath, identity: `oodle:${sha256.slice(0, 16)}`, sha256, trustedBy: verdict.trustedBy, decompress,
    close: () => { if (!closed) { closed = true; unload(); } } };
}

/**
 * How to unload the library `dlopen` just loaded from `path`. Bun's own `close` doesn't unload a library on Windows (Bun 1.4.2: the module
 * stays mapped, so its file can't be overwritten), which kept the game's Oodle library locked until the Studio exited and a game update
 * or repair couldn't replace it (NATIVE-42). So `close` releases it here instead of through Bun: `FreeLibrary` once, for the one
 * `LoadLibrary` the `dlopen` made (Windows counts loads, so another holder in this process keeps it loaded). Bun's `close` is not also
 * called, so a Bun that does unload can't free it twice.
 */
function moduleUnloader(ffi: Ffi, path: string): () => void {
  const { FFIType } = ffi;
  const kernel32 = ffi.dlopen("kernel32.dll", {
    GetModuleHandleW: { args: [FFIType.ptr], returns: FFIType.ptr },
    FreeLibrary: { args: [FFIType.ptr], returns: FFIType.i32 },
  });
  const module = kernel32.symbols.GetModuleHandleW(ffi.ptr(Buffer.from(`${path}\0`, "utf16le")));
  return () => { if (module) kernel32.symbols.FreeLibrary(module); };
}

/**
 * The game folder's Oodle library, or a typed error saying why it can't be used (not Windows x64, missing, untrusted, won't load),
 * without blocking the event loop. `verify` decides trust (tests inject one); the default accepts known hashes and CD PROJEKT S.A.
 * signatures. The file stays held while the verdict is awaited.
 */
export async function openGameOodle(gameRoot: string, options: { verify?: OodleVerifier } = {}): Promise<OodleLibrary> {
  const prepared = prepare(gameRoot);
  try { return load(prepared, await (options.verify ?? defaultOodleVerifier)(prepared.held.finalPath, prepared.sha256)); }
  finally { prepared.held.release(); }
}

/** `openGameOodle`, blocking while PowerShell checks an unknown library's signature: for command-line tools and workers. */
export function loadGameOodle(gameRoot: string, options: { verify?: OodleVerifierSync } = {}): OodleLibrary {
  const prepared = prepare(gameRoot);
  try { return load(prepared, (options.verify ?? defaultOodleVerifierSync)(prepared.held.finalPath, prepared.sha256)); }
  finally { prepared.held.release(); }
}
