/**
 * How the native writers store compressed data: a `KARK` header (u32 magic, u32 raw size) and one Oodle Kraken stream, made by the
 * game's own `oo2ext_7_win64.dll` (oodle.ts). WolvenKit 9.0.1 compresses CR2W buffers at Optimal2 (level 6) and archive segments
 * (resource bodies) at Normal (level 4) [resource: knowledge/archive-format.md §2, every segment of a Build reproduced byte for byte].
 * Pure apart from the injected compressor.
 */
import type { Compress } from "../kark";
import { KARK_HEADER_SIZE, KARK_MAGIC } from "../kark";

export const OODLE_KRAKEN = 8;
export const LEVEL_NORMAL = 4;
export const LEVEL_OPTIMAL2 = 6;

/**
 * The stored form of `raw` at `level`: the KARK stream, or the raw bytes when compressing doesn't make them smaller (as WolvenKit
 * stores them then).
 */
export function karkSegment(raw: Uint8Array, level: number, compress: Compress): Uint8Array {
  if (!raw.length) return raw;
  const stream = compress(raw, OODLE_KRAKEN, level);
  if (stream.length + KARK_HEADER_SIZE >= raw.length) return raw;
  const out = new Uint8Array(KARK_HEADER_SIZE + stream.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, KARK_MAGIC, true);
  view.setUint32(4, raw.length, true);
  out.set(stream, KARK_HEADER_SIZE);
  return out;
}
