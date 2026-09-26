/**
 * Segment decoding. Pure apart from the injected decompressor (oodle.ts loads the game's own Oodle library).
 *
 * A segment whose stored size equals its size is stored raw. Otherwise its stored bytes are a `KARK` header (u32 magic
 * `KARK`, u32 uncompressed size) followed by one Oodle LZ stream [resource: every compressed segment of game 2.31's content
 * archives; source: knowledge/archive-format.md §2]. A compressed segment without that header is refused (never seen; the
 * caller falls back to another reader) rather than guessed at.
 */
import { NativeBudgetError, NativeDecompressError, NativeMalformedError } from "./native-errors";

export const KARK_MAGIC = 0x4b52414b; // "KARK" little-endian
export const KARK_HEADER_SIZE = 8;

/** Decompress one Oodle stream to exactly `size` bytes, or throw (`NativeDecompressError` when the stream is refused). */
export type Decompress = (stored: Uint8Array, size: number) => Uint8Array;

/** A segment whose framing is wrong (a malformed input, not a decompressor failure). */
export class SegmentError extends NativeMalformedError { override name = "SegmentError"; }

/** Decode one segment to `size` bytes. `maxSize` caps what the decompressor is asked to allocate. */
export function decodeSegment(stored: Uint8Array, size: number, decompress: Decompress, maxSize = Number.MAX_SAFE_INTEGER): Uint8Array {
  if (stored.length === size) return stored;
  if (size > maxSize) throw new NativeBudgetError(`A segment of ${size} bytes passes the ${maxSize}-byte cap.`);
  if (stored.length < KARK_HEADER_SIZE) throw new SegmentError("Truncated compressed segment.");
  const view = new DataView(stored.buffer, stored.byteOffset, stored.byteLength);
  if (view.getUint32(0, true) !== KARK_MAGIC) throw new SegmentError("Compressed segment without a KARK header.");
  const declared = view.getUint32(4, true);
  if (declared !== size) throw new SegmentError(`Segment header declares ${declared} bytes, the index ${size}.`);
  const out = decompress(stored.subarray(KARK_HEADER_SIZE), size);
  if (out.length !== size) throw new NativeDecompressError(`Segment decompressed to ${out.length} bytes, expected ${size}.`);
  return out;
}
