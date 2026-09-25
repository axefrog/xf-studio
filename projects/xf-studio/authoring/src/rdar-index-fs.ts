import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseRdarHeader, parseRdarIndexCount, parseRdarIndexHashes, RDAR_HEADER_BYTES, RDAR_INDEX_COUNT_BYTES } from "./rdar-index";

/** File adapter for RDAR archive indexes: reads only the header and the index block, never file payloads. */
export function readRdarIndexHashes(path: string): BigUint64Array {
  const fd = openSync(path, "r");
  try {
    const header = new Uint8Array(RDAR_HEADER_BYTES);
    if (readSync(fd, header, 0, RDAR_HEADER_BYTES, 0) !== RDAR_HEADER_BYTES) throw Error("Truncated RDAR header.");
    const { indexOffset, indexSize } = parseRdarHeader(header);
    if (indexOffset + indexSize > statSync(path).size) throw Error("RDAR index lies outside the file.");
    const index = new Uint8Array(indexSize);
    if (readSync(fd, index, 0, indexSize, indexOffset) !== indexSize) throw Error("Truncated RDAR index.");
    return parseRdarIndexHashes(index);
  } finally { closeSync(fd); }
}

/** The file count an archive's index declares, reading only the header and the start of the index block. */
export function readRdarIndexCount(path: string): number {
  const fd = openSync(path, "r");
  try {
    const header = new Uint8Array(RDAR_HEADER_BYTES);
    if (readSync(fd, header, 0, RDAR_HEADER_BYTES, 0) !== RDAR_HEADER_BYTES) throw Error("Truncated RDAR header.");
    const { indexOffset, indexSize } = parseRdarHeader(header);
    if (indexSize < RDAR_INDEX_COUNT_BYTES || indexOffset + indexSize > statSync(path).size) throw Error("RDAR index lies outside the file.");
    const head = new Uint8Array(RDAR_INDEX_COUNT_BYTES);
    if (readSync(fd, head, 0, RDAR_INDEX_COUNT_BYTES, indexOffset) !== RDAR_INDEX_COUNT_BYTES) throw Error("Truncated RDAR index.");
    return parseRdarIndexCount(head);
  } finally { closeSync(fd); }
}

/** Binary search in a sorted hash list. */
export function sortedHashesContain(hashes: BigUint64Array, value: bigint): boolean {
  let low = 0, high = hashes.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1, item = hashes[middle]!;
    if (item === value) return true;
    if (item < value) low = middle + 1; else high = middle - 1;
  }
  return false;
}

/**
 * Which of `hashes` (decimal depot hashes) are indexed by the archive file or any `.archive` in the
 * directory. Throws when no archive index can be read, so a caller never mistakes an unreadable
 * source for a missing resource.
 */
export function archiveSourceContains(archivePath: string, hashes: readonly string[]): Set<string> {
  const files = statSync(archivePath).isDirectory()
    ? readdirSync(archivePath).filter(name => name.toLowerCase().endsWith(".archive")).map(name => join(archivePath, name))
    : [archivePath];
  const wanted = new Map(hashes.map(hash => [BigInt(hash), hash]));
  const found = new Set<string>();
  let readable = 0;
  for (const file of files) {
    let index: BigUint64Array;
    try { index = readRdarIndexHashes(file); readable++; } catch { continue; }
    for (const [value, hash] of wanted) if (!found.has(hash) && sortedHashesContain(index, value)) found.add(hash);
    if (found.size === wanted.size) break;
  }
  if (!readable) throw Error("No readable archive index in the export source.");
  return found;
}
