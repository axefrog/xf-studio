/**
 * RDAR archive index reading. Pure: the adapter reads the header and index bytes.
 * Layout [source: WolvenKit ArchiveReader.cs at 11720772, cross-checked by tools/archive_winners.py]:
 * `RDAR` magic, u64 index position at byte 8, u32 index size at byte 16; the index holds a u32 file
 * count at +16 and 56-byte file entries from +28, each starting with the u64 depot-path hash.
 */
export const RDAR_HEADER_BYTES = 24;

export function parseRdarHeader(bytes: Uint8Array): { indexOffset: number; indexSize: number } {
  if (bytes.length < RDAR_HEADER_BYTES || String.fromCharCode(...bytes.subarray(0, 4)) !== "RDAR") throw Error("Not an RDAR archive.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = view.getBigUint64(8, true);
  if (offset > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("RDAR index offset is out of range.");
  return { indexOffset: Number(offset), indexSize: view.getUint32(16, true) };
}

/** Where the index block keeps its u32 file count, and the bytes to read to get it. */
export const RDAR_INDEX_COUNT_BYTES = 20;
/** The file count from the first `RDAR_INDEX_COUNT_BYTES` of an index block. */
export function parseRdarIndexCount(indexHead: Uint8Array): number {
  if (indexHead.length < RDAR_INDEX_COUNT_BYTES) throw Error("Truncated RDAR index.");
  return new DataView(indexHead.buffer, indexHead.byteOffset, indexHead.byteLength).getUint32(16, true);
}

/** Sorted file hashes of an RDAR index block. */
export function parseRdarIndexHashes(index: Uint8Array): BigUint64Array {
  if (index.length < 28) throw Error("Truncated RDAR index.");
  const view = new DataView(index.buffer, index.byteOffset, index.byteLength);
  const count = parseRdarIndexCount(index);
  if (28 + count * 56 > index.length) throw Error("RDAR file entries exceed the index block.");
  const hashes = new BigUint64Array(count);
  for (let i = 0; i < count; i++) hashes[i] = view.getBigUint64(28 + i * 56, true);
  return hashes.sort();
}
