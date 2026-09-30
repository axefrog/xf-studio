/**
 * The native archive packer: CR2W resource files to one `.archive`, laid out as WolvenKit 9.0.1's `pack` lays it out. Pure apart
 * from the injected compressor. Facts [resource: WolvenKit 9.0.1's archives of the Build's resources, and 6,511 entries of 271
 * WolvenKit-packed mod archives for the inline-buffer rule; knowledge/archive-format.md §1–2]:
 *
 * - Header: `RDAR`, 12, u64 index offset, u32 index size, u64 debug offset 0, u32 debug size 0, u64 file size; at byte 40 the length of
 *   the file-name block that starts at byte 172 (zeros between).
 * - The file-name block: `LXRS` (u32), 1, u32 raw size, u32 stored size, u32 count, then the depot paths, each NUL-terminated, in
 *   the staging folder's walk order (a folder's files, then its folders, breadth first), as one Oodle Kraken stream at Normal (no
 *   `KARK` header), or raw if that is not smaller.
 * - Then every resource's segments, entries in depot-hash order: its CR2W body (up to the objects end) as a `KARK` stream at
 *   Normal (raw if not smaller), then each buffer exactly as the file stores it. No padding between segments.
 * - Then 0xD9 bytes to the next 4 KiB boundary, the index, and 0xD9 bytes to the next 4 KiB boundary (the file size).
 * - Index: u32 8, u32 index size − 8, u64 CRC-64/XZ of everything after the CRC, u32 file count, u32 segment count, u32 0
 *   dependencies; entries (u64 depot hash, i64 file time, u32 buffers − 1 (0 without buffers), u32 first and end segment, u32 0, u32 0,
 *   the SHA-1 of nothing); segments (u64 offset, u32 stored size, u32 size).
 */
import { depotPathHash } from "./package-writer";
import { KARK_HEADER_SIZE } from "../kark";
import type { Compress } from "../oodle";
import { ByteWriter } from "./byte-writer";
import { karkSegment, LEVEL_NORMAL, OODLE_KRAKEN } from "./segments";
import { NativeWriteRefusal } from "./red-encoder";

export const RDAR_VERSION = 12;
const HEADER_SIZE = 40, NAME_BLOCK_AT = 172, LXRS_MAGIC = 0x4c585253, PAGE = 4096, PADDING = 0xd9;
/** WolvenKit writes the SHA-1 of an empty input in every entry. */
const EMPTY_SHA1 = Uint8Array.from(Buffer.from("da39a3ee5e6b4b0d3255bfef95601890afd80709", "hex"));

/** One resource to pack: its depot path (backslashes), its file's bytes and its file time (100 ns since 1601). */
export interface PackFile { readonly path: string; readonly bytes: Uint8Array; readonly fileTime: bigint }

let crcTable: BigUint64Array | null = null;
/** CRC-64/XZ (reflected ECMA-182 polynomial, all-ones start and final xor). */
export function crc64xz(bytes: Uint8Array): bigint {
  if (!crcTable) {
    crcTable = new BigUint64Array(256);
    for (let i = 0; i < 256; i++) {
      let c = BigInt(i);
      for (let k = 0; k < 8; k++) c = c & 1n ? (c >> 1n) ^ 0xc96c5795d7870f42n : c >> 1n;
      crcTable[i] = c;
    }
  }
  // Two 32-bit halves keep the loop out of BigInt for speed.
  let lo = 0xffffffff, hi = 0xffffffff;
  const loT = new Uint32Array(256), hiT = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { loT[i] = Number(crcTable[i]! & 0xffffffffn); hiT[i] = Number(crcTable[i]! >> 32n); }
  for (const byte of bytes) {
    const index = (lo ^ byte) & 0xff;
    const nextLo = ((lo >>> 8) | (hi << 24)) >>> 0, nextHi = hi >>> 8;
    lo = (nextLo ^ loT[index]!) >>> 0; hi = (nextHi ^ hiT[index]!) >>> 0;
  }
  return ((BigInt(hi ^ 0xffffffff) & 0xffffffffn) << 32n) | (BigInt((lo ^ 0xffffffff) >>> 0));
}

/** A CR2W file's segments: its body (to the objects end) and each buffer as stored, with the buffer's size. */
function segmentsOf(file: PackFile): { body: Uint8Array; buffers: { stored: Uint8Array; size: number }[] } {
  const bytes = file.bytes;
  if (bytes.length < 160) throw new NativeWriteRefusal(`${file.path} is not a CR2W file.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x57325243) throw new NativeWriteRefusal(`${file.path} is not a CR2W file.`);
  const objectsEnd = view.getUint32(24, true), buffersEnd = view.getUint32(28, true);
  if (buffersEnd !== bytes.length || objectsEnd > buffersEnd) throw new NativeWriteRefusal(`${file.path}: its CR2W header disagrees with its size.`);
  const tableAt = view.getUint32(HEADER_SIZE + 5 * 12, true), count = view.getUint32(HEADER_SIZE + 5 * 12 + 4, true);
  const buffers: { stored: Uint8Array; size: number }[] = [];
  let at = objectsEnd;
  for (let i = 0; i < count; i++) {
    const entry = tableAt + i * 24;
    const offset = view.getUint32(entry + 8, true), disk = view.getUint32(entry + 12, true), size = view.getUint32(entry + 16, true);
    // The archive stores buffers back to back after the body; a file laid out otherwise is not packed natively.
    if (offset !== at || offset + disk > bytes.length) throw new NativeWriteRefusal(`${file.path}: its buffers are not stored back to back.`);
    if (disk !== size && (disk < KARK_HEADER_SIZE || view.getUint32(offset, true) !== 0x4b52414b)) throw new NativeWriteRefusal(`${file.path}: a compressed buffer has no KARK header.`);
    buffers.push({ stored: bytes.subarray(offset, offset + disk), size });
    at = offset + disk;
  }
  if (at !== bytes.length) throw new NativeWriteRefusal(`${file.path}: bytes follow its last buffer.`);
  return { body: bytes.subarray(0, objectsEnd), buffers };
}

const utf8 = new TextEncoder();
const pad = (out: ByteWriter) => { while (out.length % PAGE) out.u8(PADDING); };

/**
 * Pack `files` (given in the staging folder's walk order, which the name block keeps) into one archive's bytes. `compress` is the
 * game's Oodle compressor.
 */
export function packArchive(files: readonly PackFile[], compress: Compress): Uint8Array {
  if (!files.length) throw new NativeWriteRefusal("Nothing to pack.");
  const entries = files.map(file => ({ file, hash: depotPathHash(file.path), ...segmentsOf(file) }));
  const seen = new Set<bigint>();
  for (const entry of entries) {
    if (seen.has(entry.hash)) throw new NativeWriteRefusal(`Two resources share the depot hash of ${entry.file.path}.`);
    seen.add(entry.hash);
  }
  const names = new ByteWriter(4096);
  for (const { path } of files) { names.bytes(utf8.encode(path)); names.u8(0); }
  const rawNames = names.toBytes();
  const stream = compress(rawNames, OODLE_KRAKEN, LEVEL_NORMAL);
  const storedNames = stream.length < rawNames.length ? stream : rawNames;
  const out = new ByteWriter(files.reduce((n, file) => n + file.bytes.length, 0) + 3 * PAGE);
  out.u32(0x52414452); out.u32(RDAR_VERSION); out.u64(0n); out.u32(0); out.u64(0n); out.u32(0); out.u64(0n);
  out.u32(20 + storedNames.length);
  while (out.length < NAME_BLOCK_AT) out.u8(0);
  out.u32(LXRS_MAGIC); out.u32(1); out.u32(rawNames.length); out.u32(storedNames.length); out.u32(files.length);
  out.bytes(storedNames);
  const sorted = [...entries].sort((a, b) => a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0);
  const segments: { offset: number; stored: number; size: number }[] = [];
  const records: { hash: bigint; fileTime: bigint; inline: number; first: number; end: number }[] = [];
  for (const entry of sorted) {
    const first = segments.length;
    const body = karkSegment(entry.body, LEVEL_NORMAL, compress);
    segments.push({ offset: out.length, stored: body.length, size: entry.body.length });
    out.bytes(body);
    for (const buffer of entry.buffers) {
      segments.push({ offset: out.length, stored: buffer.stored.length, size: buffer.size });
      out.bytes(buffer.stored);
    }
    records.push({ hash: entry.hash, fileTime: entry.file.fileTime, inline: Math.max(0, entry.buffers.length - 1), first, end: segments.length });
  }
  pad(out);
  const indexOffset = out.length;
  const index = new ByteWriter(28 + records.length * 56 + segments.length * 16);
  index.u32(8); index.u32(0); index.u64(0n);
  index.u32(records.length); index.u32(segments.length); index.u32(0);
  for (const record of records) {
    index.u64(record.hash); index.i64(record.fileTime); index.u32(record.inline); index.u32(record.first); index.u32(record.end);
    index.u32(0); index.u32(0); index.bytes(EMPTY_SHA1);
  }
  for (const segment of segments) { index.u64(BigInt(segment.offset)); index.u32(segment.stored); index.u32(segment.size); }
  const indexBytes = index.toBytes();
  const indexView = new DataView(indexBytes.buffer);
  indexView.setUint32(4, indexBytes.length - 8, true);
  indexView.setBigUint64(8, crc64xz(indexBytes.subarray(16)), true);
  out.bytes(indexBytes);
  pad(out);
  const bytes = out.toBytes();
  const header = new DataView(bytes.buffer);
  header.setBigUint64(8, BigInt(indexOffset), true);
  header.setUint32(16, indexBytes.length, true);
  header.setBigUint64(32, BigInt(bytes.length), true);
  return bytes;
}

/** A file time (100 ns units since 1601) from a modification time in nanoseconds since 1970. */
export const fileTimeOf = (mtimeNs: bigint) => mtimeNs / 100n + 116444736000000000n;

/**
 * The files below `root` as WolvenKit's pack walks them: a folder's files, then its folders, breadth first, each in the file
 * system's name order (case-insensitive, as NTFS lists them). Symbolic links and junctions are refused. File-system access is the
 * caller's (`list` reads one folder: its entries with whether each is a folder).
 */
export function walkOrder(list: (relative: string) => readonly { name: string; folder: boolean; link: boolean }[]): string[] {
  const order = (a: string, b: string) => { const x = a.toUpperCase(), y = b.toUpperCase(); return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0; };
  const files: string[] = [];
  const queue: string[] = [""];
  while (queue.length) {
    const folder = queue.shift()!;
    const entries = [...list(folder)].sort((a, b) => order(a.name, b.name));
    for (const entry of entries) {
      if (entry.link) throw new NativeWriteRefusal(`The staging folder holds a link: ${folder}${entry.name}`);
      if (!entry.folder) files.push(folder + entry.name);
    }
    for (const entry of entries) if (entry.folder) queue.push(folder + entry.name + "\\");
  }
  return files;
}
