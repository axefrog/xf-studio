/**
 * Typed failures of the native reader. Pure. Every refusal the reader makes on purpose is one of these classes, so a caller can
 * tell a hostile or unusual file (fall back to another reader and count why) from a bug in the reader (an `internal` failure,
 * which a caller should surface rather than hide as an ordinary fallback).
 */

/** The bytes break the format's rules (bounds, sizes, counts, tables that disagree). */
export class NativeMalformedError extends Error { override name = "NativeMalformedError"; }

/** Well-formed input this reader does not decode (an unverified class, value type, package version or layout). */
export class NativeUnsupportedError extends Error { override name = "NativeUnsupportedError"; }

/** The resource exceeds a size, count, depth or time budget (limits.ts). */
export class NativeBudgetError extends Error { override name = "NativeBudgetError"; }

/** The decompressor refused a stream or returned the wrong length. */
export class NativeDecompressError extends Error { override name = "NativeDecompressError"; }

/**
 * Why a resource was not answered natively:
 * - `not-indexed`: the archive does not list the hash;
 * - `not-verified`: the root class is outside the verified set;
 * - `unsupported`, `malformed`, `decompress`, `over-budget`: the typed refusals above;
 * - `io`: the file system failed (missing, locked, replaced mid-read);
 * - `unavailable`: the decoder itself could not start (a worker that failed or timed out while starting); it answers this without
 *   retrying until its restart delay passes, or for the rest of the session after repeated failures;
 * - `internal`: anything else, i.e. a bug in the reader (TypeError, a plain RangeError, a stack overflow).
 */
export type NativeFailureKind = "not-indexed" | "not-verified" | "unsupported" | "malformed" | "decompress" | "over-budget" | "internal" | "io" | "unavailable";

export const NATIVE_FAILURE_KINDS: readonly NativeFailureKind[] = ["not-indexed", "not-verified", "unsupported", "malformed", "decompress", "over-budget", "internal", "io", "unavailable"];

/** The failure kind of an error thrown while reading or decoding a resource. */
export function classifyNativeFailure(error: unknown): NativeFailureKind {
  if (error instanceof NativeMalformedError) return "malformed";
  if (error instanceof NativeUnsupportedError) return "unsupported";
  if (error instanceof NativeBudgetError) return "over-budget";
  if (error instanceof NativeDecompressError) return "decompress";
  // Node-style system errors carry a string code such as ENOENT, EPERM, EBUSY or EACCES.
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^E[A-Z]+$/.test(code)) return "io";
  return "internal";
}
