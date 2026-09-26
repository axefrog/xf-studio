/**
 * Segment decoding. Pure apart from the injected decompressor (oodle.ts loads the game's own Oodle library).
 *
 * A segment whose stored size equals its size is stored raw. Otherwise its stored bytes are a `KARK` header (u32 magic
 * `KARK`, u32 uncompressed size) followed by one Oodle LZ stream [resource: every compressed segment of game 2.31's content
 * archives; source: knowledge/archive-format.md §2]. A compressed segment without that header is refused (never seen; the
 * caller falls back to another reader) rather than guessed at.
 */
export const KARK_MAGIC = 0x4b52414b; // "KARK" little-endian
export const KARK_HEADER_SIZE = 8;

/** Decompress one Oodle stream to exactly `size` bytes, or throw. */
export type Decompress = (stored: Uint8Array, size: number) => Uint8Array;

export class SegmentError extends Error {}

export function decodeSegment(stored: Uint8Array, size: number, decompress: Decompress): Uint8Array {
  if (stored.length === size) return stored;
  if (stored.length < KARK_HEADER_SIZE) throw new SegmentError("Truncated compressed segment.");
  const view = new DataView(stored.buffer, stored.byteOffset, stored.byteLength);
  if (view.getUint32(0, true) !== KARK_MAGIC) throw new SegmentError("Compressed segment without a KARK header.");
  const declared = view.getUint32(4, true);
  if (declared !== size) throw new SegmentError(`Segment header declares ${declared} bytes, the index ${size}.`);
  const out = decompress(stored.subarray(KARK_HEADER_SIZE), size);
  if (out.length !== size) throw new SegmentError(`Segment decompressed to ${out.length} bytes, expected ${size}.`);
  return out;
}
