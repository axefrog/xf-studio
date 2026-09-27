/**
 * LZ4 block decoding for a save's `4ZLX` chunks (knowledge/save-files.md §1). Pure and bounded: the output size is given and checked
 * exactly, literal runs and matches may not pass it, and a match may not reach before the start. The encoder (for the later writer)
 * belongs beside it.
 */
import { Reader } from "./reader";

/** Largest expanded chunk a save may declare (saves use 256 KiB). */
export const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
/**
 * The most an LZ4 block can expand, per stored byte: a match's length continues in bytes of 255 each. A declared size past it can't be
 * the block's, so it is refused before anything is allocated (SAVE-05).
 */
export const MAX_LZ4_RATIO = 255;
/** Whether `stored` bytes of LZ4 block can expand to `size` bytes (the largest sequences, plus a token's worth). */
export const lz4CanExpand = (stored: number, size: number) => size <= stored * MAX_LZ4_RATIO + 64;

export function decodeLz4(input: Uint8Array, size: number): Uint8Array {
  if (size < 0 || size > MAX_CHUNK_BYTES) throw Error("Unsupported chunk size");
  const out = new Uint8Array(size);
  decodeLz4Into(input, out, 0, size);
  return out;
}

/** Decode a block of `size` bytes straight into `out` at `at` (the save's expanded stream), without a copy of its own. */
export function decodeLz4Into(input: Uint8Array, out: Uint8Array, at: number, size: number): void {
  if (size < 0 || size > MAX_CHUNK_BYTES || at < 0 || at + size > out.length) throw Error("Unsupported chunk size");
  if (!lz4CanExpand(input.length, size)) throw Error("LZ4 block too small for its size");
  const r = new Reader(input), end = at + size;
  let pos = at;
  const length = (base: number) => {
    let n = base;
    if (base === 15) {
      let b;
      do { b = r.u8(); n += b; } while (b === 255);
    }
    return n;
  };
  while (r.pos < input.length) {
    const token = r.u8(), literal = length(token >>> 4);
    if (pos + literal > end) throw Error("LZ4 literal overflow");
    out.set(r.take(literal), pos);
    pos += literal;
    if (r.pos === input.length) break;
    const offset = r.u8() + r.u8() * 256, match = length(token & 15) + 4;
    if (offset === 0 || offset > pos - at || pos + match > end) throw Error("Invalid LZ4 match");
    for (let k = 0; k < match; k++) out[pos + k] = out[pos + k - offset]!;
    pos += match;
  }
  if (pos !== end) throw Error("LZ4 output size mismatch");
}
