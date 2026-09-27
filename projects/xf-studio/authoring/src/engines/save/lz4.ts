/**
 * LZ4 block decoding for a save's `4ZLX` chunks (knowledge/save-files.md §1). Pure and bounded: the output size is given and checked
 * exactly, literal runs and matches may not pass it, and a match may not reach before the start. The encoder (for the later writer)
 * belongs beside it.
 */
import { Reader } from "./reader";

/** Largest expanded chunk a save may declare (saves use 256 KiB). */
export const MAX_CHUNK_BYTES = 16 * 1024 * 1024;

export function decodeLz4(input: Uint8Array, size: number): Uint8Array {
  if (size < 0 || size > MAX_CHUNK_BYTES) throw Error("Unsupported chunk size");
  const r = new Reader(input), out = new Uint8Array(size);
  let pos = 0;
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
    if (pos + literal > size) throw Error("LZ4 literal overflow");
    out.set(r.take(literal), pos);
    pos += literal;
    if (r.pos === input.length) break;
    const offset = r.u8() + r.u8() * 256, match = length(token & 15) + 4;
    if (offset === 0 || offset > pos || pos + match > size) throw Error("Invalid LZ4 match");
    for (let k = 0; k < match; k++) out[pos + k] = out[pos + k - offset]!;
    pos += match;
  }
  if (pos !== size) throw Error("LZ4 output size mismatch");
  return out;
}
