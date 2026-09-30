/**
 * The native CR2W writer: a WolvenKit-shaped JSON resource document to the resource's bytes, as WolvenKit 9.0.1's
 * `convert deserialize` writes them. Pure apart from the injected buffer store (which compresses each buffer).
 *
 * Layout [resource: WolvenKit 9.0.1's output, knowledge/archive-format.md §3]:
 * - A 40-byte header (`CR2W`, version, flags 0, timestamp 0, build version, objects end, buffers end, CRC32, 6) and ten table headers
 *   (offset, count, CRC32 of the table's bytes; an empty table is all zero). The header CRC32 covers those 160 bytes with 0xDEADBEEF
 *   in its own place.
 * - Tables in order: the string pool (the empty name, every name, then every import path, each NUL-terminated), names (pool offset,
 *   a folded FNV-1a 64 of the text), imports (pool offset, class name 0, flags), one all-zero property record, exports (class name, 0, parent 0,
 *   data size, data offset, template 0, CRC 0), buffers (JSON flags, 0, offset, stored size, size, CRC32 of the stored bytes).
 * - Then every export's body, then every buffer as stored.
 * - Names and imports are numbered in first use while writing; exports in depth-first order: a handle's target is written where the
 *   handle first names it. An export body is 0, its property records (name, type, u32 size counting itself, value), then u16 0.
 * - `meshMeshMaterialBuffer.materials` become `rawData` (each material its own CR2W file, back to back) and `rawDataHeaders`
 *   (offset and size of each); `appearanceAppearanceDefinition.components` become its `compiledData` package (package-writer.ts);
 *   `CMaterialInstance.values` are written after the terminator (u32 count; per value u32 size counting itself and the two names,
 *   u16 name, u16 type, value).
 */
import { crc32 } from "node:zlib";
import { ByteWriter } from "./byte-writer";
import { writeAppearancePackage } from "./package-writer";
import { type EncodeContext, type Json, NativeWriteRefusal, propertiesToWrite, writeValue } from "./red-encoder";

const HEADER_SIZE = 40, TABLES = 10, CR2W_MAGIC = 0x57325243;

/** How a buffer is stored: its bytes as the file holds them (a KARK stream, or the raw bytes). */
export type StoreBuffer = (raw: Uint8Array) => Uint8Array;

/**
 * A CR2W name's hash: FNV-1a 64 of its UTF-8 text folded to 32 bits (low word xor high word); 0 for the empty name
 * [resource: WolvenKit 9.0.1's name tables].
 */
export function nameHash(bytes: Uint8Array): number {
  if (!bytes.length) return 0;
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return Number((hash ^ (hash >> 32n)) & 0xffffffffn);
}

const utf8 = new TextEncoder();
const IMPORT_FLAGS: Record<string, number> = { Default: 0, Obligatory: 1, Template: 2, Soft: 4, Embedded: 8, Inplace: 16 };
/** `EImportFlags` from their JSON text ("Default", or names joined by ", "). */
export function importFlags(text: unknown): number {
  if (typeof text !== "string") throw new NativeWriteRefusal("A reference has no flags.");
  let flags = 0;
  for (const part of text.split(",").map(item => item.trim())) {
    const bit = IMPORT_FLAGS[part];
    if (bit === undefined) throw new NativeWriteRefusal(`Unknown import flag ${part}.`);
    flags |= bit;
  }
  return flags;
}

/** CR2W's length-prefixed string, always UTF-8: first byte 0x80 | "more" 0x40 | 6 bits of the byte count, then 7 bits per byte. */
export function writeVarString(out: ByteWriter, value: string): void {
  const bytes = utf8.encode(value);
  let length = bytes.length;
  if (length === 0) { out.u8(0); return; }
  let first = 0x80 | (length & 0x3f);
  length = Math.floor(length / 64);
  if (length) first |= 0x40;
  out.u8(first);
  while (length) {
    let next = length & 0x7f;
    length = Math.floor(length / 128);
    if (length) next |= 0x80;
    out.u8(next);
  }
  out.bytes(bytes);
}

/** Base64 bytes of a JSON buffer value. */
function bufferBytes(value: Json, owner: string): Uint8Array {
  if (value && typeof value.Bytes === "string") return new Uint8Array(Buffer.from(value.Bytes, "base64"));
  throw new NativeWriteRefusal(`${owner}: a buffer without bytes is not written.`);
}

class Cr2wWriter implements EncodeContext {
  private readonly names: string[] = [""];
  private readonly nameIndex = new Map<string, number>([["", 0]]);
  private readonly imports: { path: string; flags: number }[] = [];
  private readonly importIndex = new Map<string, number>();
  private readonly exports: { className: string; body: Uint8Array | null }[] = [];
  private readonly handles = new Map<string, number>();
  private readonly buffers: { flags: number; raw: Uint8Array }[] = [];

  constructor(private readonly store: StoreBuffer) {}

  name(value: string): number {
    let index = this.nameIndex.get(value);
    if (index === undefined) {
      index = this.names.length;
      if (index > 0xffff) throw new NativeWriteRefusal("More names than a CR2W file can index.");
      this.names.push(value);
      this.nameIndex.set(value, index);
    }
    return index;
  }

  /** Write an object as a new export (depth first) and return its index. */
  export(object: Json): number {
    if (!object || typeof object.$type !== "string") throw new NativeWriteRefusal("An export has no class.");
    const index = this.exports.length;
    const entry = { className: object.$type as string, body: null as Uint8Array | null };
    this.exports.push(entry);
    this.name(entry.className);
    const out = new ByteWriter(1024);
    this.body(out, entry.className, object, entry.className);
    entry.body = out.toBytes();
    return index;
  }

  private body(out: ByteWriter, type: string, value: Json, owner: string): void {
    const className = typeof value?.$type === "string" ? value.$type : type;
    const prepared = this.prepare(className, value);
    out.u8(0);
    for (const property of propertiesToWrite(className, prepared)) {
      out.u16(this.name(property.name));
      out.u16(this.name(property.type));
      const at = out.length;
      out.u32(0);
      writeValue(this, out, property.type, property.value, `${className}.${property.name}`);
      out.patchU32(at, out.length - at);
    }
    out.u16(0);
    if (className === "CMaterialInstance") this.materialValues(out, value.values ?? [], owner);
  }

  /** Derived JSON properties turned into the ones the file stores. */
  private prepare(className: string, value: Json): Json {
    if (className === "meshMeshMaterialBuffer" && Array.isArray(value.materials) && value.materials.length) {
      if (value.rawData !== null || (Array.isArray(value.rawDataHeaders) && value.rawDataHeaders.length))
        throw new NativeWriteRefusal("A material buffer gives both materials and raw data.");
      const files = value.materials.map((material: Json) =>
        writeCr2wObject({ Version: 195, BuildVersion: 0, RootChunk: material, EmbeddedFiles: [] }, this.store));
      let offset = 0;
      const headers = files.map((file: Uint8Array) => {
        const header = { $type: "meshLocalMaterialHeader", offset, size: file.length };
        offset += file.length;
        return header;
      });
      const raw = new Uint8Array(offset);
      offset = 0;
      for (const file of files) { raw.set(file, offset); offset += file.length; }
      return { ...value, materials: [], rawData: { Flags: 0, raw }, rawDataHeaders: headers };
    }
    if (className === "appearanceAppearanceDefinition" && Array.isArray(value.components) && value.components.length) {
      if (value.compiledData !== null && value.compiledData !== undefined) throw new NativeWriteRefusal("An appearance gives both components and compiled data.");
      return { ...value, components: [], compiledData: { Flags: 0, raw: writeAppearancePackage(value.components) } };
    }
    return value;
  }

  private materialValues(out: ByteWriter, values: Json[], owner: string): void {
    out.u32(values.length);
    for (const entry of values) {
      const type = entry?.$type;
      const keys = Object.keys(entry ?? {}).filter(key => key !== "$type");
      if (typeof type !== "string" || keys.length !== 1) throw new NativeWriteRefusal(`${owner}: a material value is not {$type, name}.`);
      const at = out.length;
      out.u32(0);
      out.u16(this.name(keys[0]!));
      out.u16(this.name(type));
      writeValue(this, out, type, entry[keys[0]!], `${owner}.values`);
      out.patchU32(at, out.length - at);
    }
  }

  struct(out: ByteWriter, type: string, value: Json, owner: string): void { this.body(out, type, value, owner); }

  handle(out: ByteWriter, value: Json, _type: string, owner: string): void {
    if (value === null) { out.i32(0); return; }
    if (typeof value.HandleRefId === "string") {
      const index = this.handles.get(value.HandleRefId);
      if (index === undefined) throw new NativeWriteRefusal(`${owner}: a handle refers to ${value.HandleRefId} before it is written.`);
      out.i32(index + 1);
      return;
    }
    if (typeof value.HandleId !== "string" || !value.Data) throw new NativeWriteRefusal(`${owner}: a handle has no data.`);
    if (this.handles.has(value.HandleId)) throw new NativeWriteRefusal(`${owner}: handle ${value.HandleId} is written twice.`);
    // The index is taken before the target's body is written, so nested handles number after it.
    const index = this.exports.length;
    this.handles.set(value.HandleId, index);
    const written = this.export(value.Data);
    if (written !== index) throw new NativeWriteRefusal(`${owner}: export numbering drifted.`);
    out.i32(index + 1);
  }

  reference(out: ByteWriter, value: Json, _type: string): void {
    const path = value?.DepotPath;
    if (!path || path.$value === "0" || path.$value === 0) { out.u16(0); return; }
    if (path.$storage !== "string" || typeof path.$value !== "string") throw new NativeWriteRefusal("A reference stored as a hash is not written.");
    const flags = importFlags(value.Flags);
    const key = `${flags}|${path.$value}`;
    let index = this.importIndex.get(key);
    if (index === undefined) {
      index = this.imports.length;
      this.imports.push({ path: path.$value, flags });
      this.importIndex.set(key, index);
    }
    out.u16(index + 1);
  }

  string(out: ByteWriter, value: string): void { writeVarString(out, value); }

  bitfield(out: ByteWriter, names: readonly string[]): void {
    for (const name of names) out.u16(this.name(name));
    out.u16(0);
  }

  buffer(out: ByteWriter, value: Json, deferred: boolean, owner: string): void {
    if (value === null) { if (deferred) out.u16(0); else out.u32(0x80000000); return; }
    const raw: Uint8Array = value.raw instanceof Uint8Array ? value.raw : bufferBytes(value, owner);
    if (!raw.length) throw new NativeWriteRefusal(`${owner}: an empty buffer is not written.`);
    const flags = Number(value.Flags ?? 0);
    if (!Number.isInteger(flags) || flags < 0 || flags > 0xffffffff) throw new NativeWriteRefusal(`${owner}: buffer flags ${value.Flags}.`);
    const index = this.buffers.length;
    this.buffers.push({ flags, raw });
    if (deferred) out.u16(index + 1);
    else out.u32(((index + 1) | 0x80000000) >>> 0);
  }

  /** Assemble the file. */
  file(version: number, buildVersion: number): Uint8Array {
    const pool = new ByteWriter(4096);
    const nameOffsets = this.names.map(name => { const at = pool.length; pool.bytes(utf8.encode(name)); pool.u8(0); return at; });
    const importOffsets = this.imports.map(({ path }) => { const at = pool.length; pool.bytes(utf8.encode(path)); pool.u8(0); return at; });
    const tables: Uint8Array[] = [];
    tables[0] = pool.toBytes();
    const names = new ByteWriter(this.names.length * 8);
    this.names.forEach((name, i) => { names.u32(nameOffsets[i]!); names.u32(nameHash(utf8.encode(name))); });
    tables[1] = names.toBytes();
    const imports = new ByteWriter(this.imports.length * 8 + 1);
    this.imports.forEach(({ flags }, i) => { imports.u32(importOffsets[i]!); imports.u16(0); imports.u16(flags); });
    tables[2] = imports.toBytes();
    tables[3] = new Uint8Array(16);
    const stored = this.buffers.map(({ raw }) => this.store(raw));
    const tablesEnd = HEADER_SIZE + TABLES * 12 + tables[0].length + tables[1].length + tables[2].length + 16 + this.exports.length * 24 + this.buffers.length * 24;
    const exports = new ByteWriter(this.exports.length * 24);
    let dataOffset = tablesEnd;
    for (const entry of this.exports) {
      exports.u16(this.nameIndex.get(entry.className)!); exports.u16(0); exports.u32(0);
      exports.u32(entry.body!.length); exports.u32(dataOffset); exports.u32(0); exports.u32(0);
      dataOffset += entry.body!.length;
    }
    tables[4] = exports.toBytes();
    const objectsEnd = dataOffset;
    const buffers = new ByteWriter(this.buffers.length * 24 + 1);
    this.buffers.forEach(({ flags, raw }, i) => {
      buffers.u32(flags); buffers.u32(0); buffers.u32(dataOffset); buffers.u32(stored[i]!.length); buffers.u32(raw.length);
      buffers.u32(crc32(stored[i]!) >>> 0);
      dataOffset += stored[i]!.length;
    });
    tables[5] = buffers.toBytes();
    const out = new ByteWriter(dataOffset);
    out.u32(CR2W_MAGIC); out.u32(version); out.u32(0); out.u64(0n); out.u32(buildVersion); out.u32(objectsEnd); out.u32(dataOffset);
    out.u32(0xdeadbeef); out.u32(6);
    let offset = HEADER_SIZE + TABLES * 12;
    const counts = [tables[0].length, this.names.length, this.imports.length, 1, this.exports.length, this.buffers.length];
    for (let i = 0; i < TABLES; i++) {
      const table = tables[i];
      if (!table || !counts[i]) { out.u32(0); out.u32(0); out.u32(0); continue; }
      out.u32(offset); out.u32(counts[i]!); out.u32(crc32(table) >>> 0);
      offset += table.length;
    }
    out.patchU32(32, crc32(out.view_()) >>> 0);
    for (const table of tables) if (table?.length) out.bytes(table);
    for (const entry of this.exports) out.bytes(entry.body!);
    for (const bytes of stored) out.bytes(bytes);
    if (out.length !== dataOffset) throw new NativeWriteRefusal("The CR2W layout drifted.");
    return out.toBytes();
  }
}

/** Write a document's `Data` (`Version`, `BuildVersion`, `RootChunk`, `EmbeddedFiles`) as a CR2W file. */
export function writeCr2wObject(data: Json, store: StoreBuffer): Uint8Array {
  if (!data || typeof data !== "object") throw new NativeWriteRefusal("A resource document has no data.");
  if (Array.isArray(data.EmbeddedFiles) && data.EmbeddedFiles.length) throw new NativeWriteRefusal("Embedded files are not written.");
  const version = Number(data.Version), buildVersion = Number(data.BuildVersion ?? 0);
  if (version !== 195) throw new NativeWriteRefusal(`CR2W version ${data.Version} is not written.`);
  if (!Number.isInteger(buildVersion) || buildVersion < 0 || buildVersion > 0xffffffff) throw new NativeWriteRefusal("Bad build version.");
  const writer = new Cr2wWriter(store);
  writer.export(data.RootChunk);
  return writer.file(version, buildVersion);
}

/** The WolvenKit JSON format the writer reads: WolvenKit 9.0.1's (`WKitJsonVersion`), which its class table follows (PIPE-135). */
export const WKIT_JSON_VERSION = "0.0.9";

/** Write a WolvenKit JSON resource document (`{Header, Data}`) as a CR2W file. */
export function writeCr2wDocument(document: Json, store: StoreBuffer): Uint8Array {
  if (document?.Header?.DataType !== "CR2W") throw new NativeWriteRefusal("Not a CR2W document.");
  if (document.Header.WKitJsonVersion !== WKIT_JSON_VERSION)
    throw new NativeWriteRefusal(`WolvenKit JSON version ${JSON.stringify(document.Header.WKitJsonVersion ?? null)} is not written (only ${WKIT_JSON_VERSION}).`);
  return writeCr2wObject(document.Data, store);
}
