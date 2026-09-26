/**
 * CR2W file structure: header, tables, exports and buffers. Pure. Property values are decoded by cr2w-values.ts.
 * Layout and sources: knowledge/archive-format.md §3.
 *
 * - Header (40 bytes): `CR2W`, u32 version (195 in game 2.31), u32 flags, u64 timestamp, u32 build version, u32 objects end,
 *   u32 buffers end, u32 CRC32, u32 chunk count; then ten table headers of (u32 offset, u32 item count, u32 CRC32).
 * - Tables: 0 string pool (count = bytes), 1 names (u32 string offset, u32 FNV-1a 32 hash), 2 imports (u32 string offset,
 *   u16 class name index, u16 flags), 3 properties (16 bytes, unused here), 4 exports (u16 class name index, u16 object flags,
 *   u32 parent, u32 data size, u32 data offset, u32 template, u32 CRC32), 5 buffers (u32 flags, u32 index, u32 offset, u32 disk
 *   size, u32 memory size, u32 CRC32), 6 embedded files (u32 import index, u32 chunk index, u64 path hash, u32 data offset,
 *   u32 data size... read only as a count here).
 * - A buffer whose disk size differs from its memory size is stored as a `KARK` segment (kark.ts), exactly as the archive held it.
 */
import { decodeSegment, type Decompress } from "./kark";

export const CR2W_MAGIC = 0x57325243; // "CR2W"
const HEADER_SIZE = 40, TABLES = 10;

export interface Cr2wImport { readonly path: string; readonly className: string; readonly flags: number }
export interface Cr2wExport { readonly className: string; readonly objectFlags: number; readonly parent: number; readonly dataSize: number; readonly dataOffset: number; readonly template: number }
export interface Cr2wBuffer { readonly flags: number; readonly index: number; readonly offset: number; readonly diskSize: number; readonly memSize: number }

export class Cr2wError extends Error {}

export class Cr2wFile {
  readonly version: number;
  readonly flags: number;
  readonly buildVersion: number;
  readonly objectsEnd: number;
  readonly buffersEnd: number;
  readonly names: readonly string[];
  readonly imports: readonly Cr2wImport[];
  readonly exports: readonly Cr2wExport[];
  readonly buffers: readonly Cr2wBuffer[];
  readonly embeddedCount: number;
  readonly view: DataView;

  constructor(readonly bytes: Uint8Array) {
    if (bytes.length < HEADER_SIZE + TABLES * 12) throw new Cr2wError("Truncated CR2W header.");
    const view = this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== CR2W_MAGIC) throw new Cr2wError("Not a CR2W file.");
    this.version = view.getUint32(4, true);
    this.flags = view.getUint32(8, true);
    this.buildVersion = view.getUint32(20, true);
    this.objectsEnd = view.getUint32(24, true);
    this.buffersEnd = view.getUint32(28, true);
    const table = (i: number) => ({ offset: view.getUint32(HEADER_SIZE + i * 12, true), count: view.getUint32(HEADER_SIZE + i * 12 + 4, true) });
    const within = (offset: number, size: number, what: string) => {
      if (offset + size > bytes.length) throw new Cr2wError(`CR2W ${what} table lies outside the file.`);
    };
    const strings = table(0);
    within(strings.offset, strings.count, "string");
    const decoder = new TextDecoder();
    const text = (offset: number) => {
      const start = strings.offset + offset;
      if (offset >= strings.count) throw new Cr2wError("CR2W string offset out of range.");
      let end = start;
      while (end < strings.offset + strings.count && bytes[end] !== 0) end++;
      return decoder.decode(bytes.subarray(start, end));
    };
    const names = table(1);
    within(names.offset, names.count * 8, "name");
    this.names = Array.from({ length: names.count }, (_, i) => text(view.getUint32(names.offset + i * 8, true)));
    const name = (index: number) => {
      const value = this.names[index];
      if (value === undefined) throw new Cr2wError(`CR2W name index ${index} out of range.`);
      return value;
    };
    const imports = table(2);
    within(imports.offset, imports.count * 8, "import");
    this.imports = Array.from({ length: imports.count }, (_, i) => {
      const at = imports.offset + i * 8;
      return { path: text(view.getUint32(at, true)), className: name(view.getUint16(at + 4, true)), flags: view.getUint16(at + 6, true) };
    });
    const exports = table(4);
    within(exports.offset, exports.count * 24, "export");
    this.exports = Array.from({ length: exports.count }, (_, i) => {
      const at = exports.offset + i * 24;
      const entry = { className: name(view.getUint16(at, true)), objectFlags: view.getUint16(at + 2, true), parent: view.getUint32(at + 4, true),
        dataSize: view.getUint32(at + 8, true), dataOffset: view.getUint32(at + 12, true), template: view.getUint32(at + 16, true) };
      within(entry.dataOffset, entry.dataSize, "export data");
      return entry;
    });
    const buffers = table(5);
    within(buffers.offset, buffers.count * 24, "buffer");
    this.buffers = Array.from({ length: buffers.count }, (_, i) => {
      const at = buffers.offset + i * 24;
      return { flags: view.getUint32(at, true), index: view.getUint32(at + 4, true), offset: view.getUint32(at + 8, true),
        diskSize: view.getUint32(at + 12, true), memSize: view.getUint32(at + 16, true) };
    });
    this.embeddedCount = table(6).count;
  }

  name(index: number): string {
    const value = this.names[index];
    if (value === undefined) throw new Cr2wError(`CR2W name index ${index} out of range.`);
    return value;
  }

  /** A buffer's bytes as the resource holds them in memory (decompressed when stored compressed). */
  bufferBytes(index: number, decompress: Decompress): Uint8Array {
    const buffer = this.buffers[index];
    if (!buffer) throw new Cr2wError(`CR2W buffer ${index} does not exist.`);
    if (buffer.offset + buffer.diskSize > this.bytes.length) throw new Cr2wError(`CR2W buffer ${index} lies outside the file.`);
    return decodeSegment(this.bytes.subarray(buffer.offset, buffer.offset + buffer.diskSize), buffer.memSize, decompress);
  }
}
