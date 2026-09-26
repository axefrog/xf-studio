/**
 * RDAR (`.archive`) container layout. Pure: callers pass the bytes of the header and index block and a decompressor for the
 * optional file-name block. The facts, their sources and grades are in knowledge/archive-format.md §1; in short
 * [resource: bytes of game 2.31 and mod archives; source: RED4ext.SDK, WolvenKit and the modding wiki, learned as format facts only]:
 *
 * - Header, 40 bytes: `RDAR` magic, u32 version (12), u64 index offset, u32 index size, u64 debug offset, u32 debug size,
 *   u64 file size. A u32 at byte 40 holds the length of an optional custom-data block at byte 172 (`LXRS`: a file-name list
 *   some mod tools write).
 * - Index block: u32 table offset (8), u32 table size, u64 CRC, u32 file count, u32 segment count, u32 dependency count, then
 *   the file entries (56 bytes each), the segments (16 bytes each) and the dependencies (u64 depot hash each).
 * - File entry: u64 depot hash, i64 timestamp, u32 inline buffer count, u32 first segment, u32 end segment (exclusive),
 *   u32 first dependency, u32 end dependency, 20-byte SHA-1.
 * - Segment: u64 offset in the archive, u32 stored size, u32 size. Stored size equal to size means stored raw; otherwise the
 *   stored bytes start with a `KARK` header (u32 magic, u32 size) followed by an Oodle stream (kark.ts).
 * - A resource's file is its segments in order: the first holds the CR2W body, the rest its buffers.
 *
 * Every offset and count is checked before use: segments must lie inside the file as it is on disk (not only as its header
 * claims), and the name block's sizes are capped before anything is allocated. Refusals are `NativeMalformedError` or
 * `NativeBudgetError` (native-errors.ts).
 */
import { NativeBudgetError, NativeMalformedError } from "./native-errors";

export const RDAR_MAGIC = 0x52414452; // "RDAR" little-endian
export const RDAR_HEADER_SIZE = 40;
/** Where the optional custom-data block (`LXRS`) starts, when the u32 at byte 40 gives it a length. */
export const RDAR_CUSTOM_DATA_OFFSET = 172;
export const LXRS_MAGIC = 0x4c585253; // bytes "SRXL", read as a little-endian u32 (conventionally called LXRS)
const ENTRY_SIZE = 56, SEGMENT_SIZE = 16, INDEX_HEAD = 28;

export interface RdarHeader {
  readonly version: number;
  readonly indexOffset: number;
  readonly indexSize: number;
  readonly debugOffset: number;
  readonly debugSize: number;
  readonly fileSize: number;
  /** Length of the custom-data block at `RDAR_CUSTOM_DATA_OFFSET`, 0 when there is none. */
  readonly customDataLength: number;
}

export interface RdarSegment { readonly offset: number; readonly storedSize: number; readonly size: number }

export interface RdarFileEntry {
  /** Depot hash (FNV-1a 64 of the sanitized path), decimal. */
  readonly hash: string;
  readonly timestamp: bigint;
  readonly inlineBuffers: number;
  readonly segmentStart: number;
  readonly segmentEnd: number;
  readonly dependencyStart: number;
  readonly dependencyEnd: number;
  /** SHA-1 recorded by the packer, lower-case hex. */
  readonly sha1: string;
}

const u64 = (view: DataView, offset: number, what: string): number => {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new NativeMalformedError(`RDAR ${what} is out of range.`);
  return Number(value);
};

export function parseRdarHeader(bytes: Uint8Array): RdarHeader {
  if (bytes.length < RDAR_HEADER_SIZE) throw new NativeMalformedError("Truncated RDAR header.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== RDAR_MAGIC) throw new NativeMalformedError("Not an RDAR archive.");
  return { version: view.getUint32(4, true), indexOffset: u64(view, 8, "index offset"), indexSize: view.getUint32(16, true),
    debugOffset: u64(view, 20, "debug offset"), debugSize: view.getUint32(28, true), fileSize: u64(view, 32, "file size"),
    customDataLength: bytes.length >= RDAR_HEADER_SIZE + 4 ? view.getUint32(RDAR_HEADER_SIZE, true) : 0 };
}

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");

/**
 * The index block, decoded on demand: opening reads only the entry hashes (one pass), and an entry, its segments and its
 * dependencies are decoded when asked for. Game archives list entries sorted by hash, so a lookup is a binary search; an index
 * that is not sorted gets a sorted order of its positions (4 bytes per entry) searched the same way. Of equal hashes, the last in
 * index order wins.
 */
export class RdarIndex {
  readonly crc: bigint;
  readonly fileCount: number;
  readonly segmentCount: number;
  readonly dependencyCount: number;
  /** Entry hashes in index order. */
  readonly hashes: BigUint64Array;
  private readonly view: DataView;
  private readonly segmentsAt: number;
  private readonly dependenciesAt: number;
  /** Positions in hash order (stable), when the index itself is not sorted. */
  private readonly order: Uint32Array | null;

  /** Where segments must end: the smaller of the header's file size and the real file's size (when the caller knows it). */
  readonly dataEnd: number;

  constructor(readonly header: RdarHeader, private readonly block: Uint8Array, actualSize = Number.MAX_SAFE_INTEGER) {
    this.dataEnd = Math.min(header.fileSize, actualSize);
    if (block.length < INDEX_HEAD) throw new NativeMalformedError("Truncated RDAR index.");
    this.view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    this.crc = this.view.getBigUint64(8, true);
    this.fileCount = this.view.getUint32(16, true); this.segmentCount = this.view.getUint32(20, true); this.dependencyCount = this.view.getUint32(24, true);
    this.segmentsAt = INDEX_HEAD + this.fileCount * ENTRY_SIZE;
    this.dependenciesAt = this.segmentsAt + this.segmentCount * SEGMENT_SIZE;
    if (this.dependenciesAt + this.dependencyCount * 8 > block.length) throw new NativeMalformedError("RDAR index tables exceed the index block.");
    this.hashes = new BigUint64Array(this.fileCount);
    let sorted = true;
    for (let i = 0; i < this.fileCount; i++) {
      const hash = this.view.getBigUint64(INDEX_HEAD + i * ENTRY_SIZE, true);
      this.hashes[i] = hash;
      if (i && hash <= this.hashes[i - 1]!) sorted = false;
    }
    if (sorted) this.order = null;
    else {
      const hashes = this.hashes;
      this.order = Uint32Array.from({ length: this.fileCount }, (_, i) => i).sort((a, b) => hashes[a]! < hashes[b]! ? -1 : hashes[a]! > hashes[b]! ? 1 : a - b);
    }
  }

  /** Position of an entry by depot hash, or -1. */
  find(hash: bigint): number {
    const order = this.order;
    if (!order) {
      let low = 0, high = this.fileCount - 1;
      while (low <= high) {
        const middle = (low + high) >>> 1, value = this.hashes[middle]!;
        if (value === hash) return middle;
        if (value < hash) low = middle + 1; else high = middle - 1;
      }
      return -1;
    }
    // The first position whose hash is greater; the one before it is the last equal one, if any.
    let low = 0, high = order.length;
    while (low < high) { const middle = (low + high) >>> 1; if (this.hashes[order[middle]!]! <= hash) low = middle + 1; else high = middle; }
    return low > 0 && this.hashes[order[low - 1]!] === hash ? order[low - 1]! : -1;
  }

  entryAt(i: number): RdarFileEntry {
    if (i < 0 || i >= this.fileCount) throw new NativeMalformedError(`RDAR entry ${i} does not exist.`);
    const view = this.view, at = INDEX_HEAD + i * ENTRY_SIZE;
    const entry: RdarFileEntry = { hash: view.getBigUint64(at, true).toString(), timestamp: view.getBigInt64(at + 8, true),
      inlineBuffers: view.getUint32(at + 16, true), segmentStart: view.getUint32(at + 20, true), segmentEnd: view.getUint32(at + 24, true),
      dependencyStart: view.getUint32(at + 28, true), dependencyEnd: view.getUint32(at + 32, true), sha1: hex(this.block.subarray(at + 36, at + 56)) };
    if (entry.segmentStart >= entry.segmentEnd || entry.segmentEnd > this.segmentCount) throw new NativeMalformedError(`RDAR entry ${entry.hash} has an invalid segment range.`);
    if (entry.dependencyStart > entry.dependencyEnd || entry.dependencyEnd > this.dependencyCount) throw new NativeMalformedError(`RDAR entry ${entry.hash} has an invalid dependency range.`);
    return entry;
  }

  /** The entry for a decimal depot hash, or null. */
  entry(hash: string): RdarFileEntry | null {
    const i = this.find(BigInt(hash));
    return i < 0 ? null : this.entryAt(i);
  }

  *entries(): IterableIterator<RdarFileEntry> { for (let i = 0; i < this.fileCount; i++) yield this.entryAt(i); }

  segmentAt(i: number): RdarSegment {
    if (!Number.isInteger(i) || i < 0 || i >= this.segmentCount) throw new NativeMalformedError(`RDAR segment ${i} does not exist.`);
    const at = this.segmentsAt + i * SEGMENT_SIZE;
    const segment = { offset: u64(this.view, at, "segment offset"), storedSize: this.view.getUint32(at + 8, true), size: this.view.getUint32(at + 12, true) };
    if (segment.offset + segment.storedSize > this.dataEnd) throw new NativeMalformedError("An RDAR segment lies outside the archive.");
    return segment;
  }

  /** The segments of one file, in order: the CR2W body, then its buffers. */
  segments(entry: RdarFileEntry): RdarSegment[] {
    const out: RdarSegment[] = [];
    for (let i = entry.segmentStart; i < entry.segmentEnd; i++) out.push(this.segmentAt(i));
    return out;
  }

  /** Dependency depot hashes of one file, decimal. */
  dependencies(entry: RdarFileEntry): string[] {
    const out: string[] = [];
    for (let i = entry.dependencyStart; i < entry.dependencyEnd; i++) out.push(this.view.getBigUint64(this.dependenciesAt + i * 8, true).toString());
    return out;
  }

  /** Uncompressed size of one file (the sum of its segments' sizes). */
  size(entry: RdarFileEntry): number { return this.segments(entry).reduce((sum, segment) => sum + segment.size, 0); }
}

/**
 * The `LXRS` custom-data block: u32 magic, u32 version (1), u32 uncompressed size, u32 stored size, u32 name count, then the
 * stored bytes (an Oodle stream without a `KARK` header when stored size < size, else raw), which hold `count` NUL-terminated
 * depot paths. Some mod packers write it so tools can show names; the game does not need it. Returns [] for anything else.
 * `maxBytes` caps the decompressed size before it is allocated.
 */
export function parseLxrsNames(block: Uint8Array, decompress: (stored: Uint8Array, size: number) => Uint8Array, maxBytes = Number.MAX_SAFE_INTEGER): string[] {
  if (block.length < 20) return [];
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
  if (view.getUint32(0, true) !== LXRS_MAGIC) return [];
  const size = view.getUint32(8, true), stored = view.getUint32(12, true), count = view.getUint32(16, true);
  if (20 + stored > block.length) throw new NativeMalformedError("Truncated LXRS name block.");
  if (size > maxBytes) throw new NativeBudgetError(`An LXRS name list of ${size} bytes passes the ${maxBytes}-byte cap.`);
  if (count > size) throw new NativeMalformedError(`An LXRS name list claims ${count} names in ${size} bytes.`);
  const payload = block.subarray(20, 20 + stored);
  const text = stored < size ? decompress(payload, size) : payload;
  const names: string[] = [];
  let start = 0;
  const decoder = new TextDecoder();
  for (let i = 0; i < text.length && names.length < count; i++)
    if (text[i] === 0) { names.push(decoder.decode(text.subarray(start, i))); start = i + 1; }
  return names;
}
