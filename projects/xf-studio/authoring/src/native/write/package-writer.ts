/**
 * The native object-package writer: an appearance definition's `components` to its `compiledData` package, as WolvenKit 9.0.1
 * writes it. Pure. The layout is the reader's (red-package.ts, knowledge/archive-format.md §5.3) [resource: WolvenKit's output]:
 *
 * - Header: u8 4, u8 2, u16 7 sections (6 without references), u32 root count, [u32 reference descriptors, u32 reference data],
 *   u32 name descriptors, u32 name data, u32 chunk descriptors, u32 chunk data (each offset counted from the end of the CRUIDs),
 *   i16 root index -1 (an appearance has no entity), u16 CRUID count, then each root's `id` as u64.
 * - Reference descriptors: offset | size << 23 | sync << 31 (sync for `Obligatory` references); the data of an `.app` package's
 *   reference is the u64 depot hash of its path. Name descriptors: offset | (length + 1) << 24, then the NUL-terminated names.
 *   Chunk descriptors: u32 class name, u32 offset.
 * - Chunks: the roots, then every handle's target in the order first named (breadth first). Names in first use, chunk by chunk.
 * - An object: u16 field count, (u16 name, u16 type, u32 offset from the object's start) per field, then the values; handles are
 *   i32 chunk indexes (-1 null), references i16 (-1 none), strings u16-length UTF-8, bitfields a u8 count of u16 names, buffers inline.
 */
import { ByteWriter } from "./byte-writer";
import { type EncodeContext, type Json, NativeWriteRefusal, propertiesToWrite, writeValue } from "./red-encoder";

const utf8 = new TextEncoder();

/** FNV-1a 64 of a depot path after the game's sanitizer (knowledge/archive-format.md §1.3). */
export function depotPathHash(path: string): bigint {
  let text = path;
  if (text.startsWith("\"")) text = text.slice(1);
  const quote = text.indexOf("\"");
  if (quote >= 0) text = text.slice(0, quote);
  text = text.replace(/^[\\/]+/, "").replace(/[\\/]+/g, "\\").replace(/[A-Z]/g, c => c.toLowerCase());
  let hash = 0xcbf29ce484222325n;
  for (const byte of utf8.encode(text)) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return hash;
}

class PackageWriter implements EncodeContext {
  private readonly names: string[] = [];
  private readonly nameIndex = new Map<string, number>();
  private readonly references: { path: string; sync: boolean }[] = [];
  private readonly referenceIndex = new Map<string, number>();
  readonly chunks: { object: Json; type: number; body: Uint8Array | null }[] = [];
  private readonly handles = new Map<string, number>();

  name(value: string): number {
    let index = this.nameIndex.get(value);
    if (index === undefined) {
      index = this.names.length;
      if (index > 0xffff) throw new NativeWriteRefusal("More names than a package can index.");
      this.names.push(value);
      this.nameIndex.set(value, index);
    }
    return index;
  }

  add(object: Json): number {
    if (!object || typeof object.$type !== "string") throw new NativeWriteRefusal("A package object has no class.");
    this.chunks.push({ object, type: -1, body: null });
    return this.chunks.length - 1;
  }

  /** Write every chunk in order; handles met on the way append theirs. */
  writeChunks(): void {
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i]!;
      chunk.type = this.name(chunk.object.$type);
      const out = new ByteWriter(256);
      this.object(out, chunk.object.$type, chunk.object);
      chunk.body = out.toBytes();
    }
  }

  private object(out: ByteWriter, type: string, value: Json): void {
    const className = typeof value?.$type === "string" ? value.$type : type;
    const fields = propertiesToWrite(className, value);
    const table: [number, number][] = [];
    const values = new ByteWriter(256);
    const offsets: number[] = [];
    for (const field of fields) {
      table.push([this.name(field.name), this.name(field.type)]);
      offsets.push(values.length);
      writeValue(this, values, field.type, field.value, `${className}.${field.name}`);
    }
    const tableSize = 2 + fields.length * 8;
    out.u16(fields.length);
    table.forEach(([name, fieldType], i) => { out.u16(name); out.u16(fieldType); out.u32(tableSize + offsets[i]!); });
    out.bytes(values.view_());
  }

  struct(out: ByteWriter, type: string, value: Json): void { this.object(out, type, value); }

  handle(out: ByteWriter, value: Json, _type: string, owner: string): void {
    if (value === null) { out.i32(-1); return; }
    if (typeof value.HandleRefId === "string") {
      const index = this.handles.get(value.HandleRefId);
      if (index === undefined) throw new NativeWriteRefusal(`${owner}: a handle refers to ${value.HandleRefId} before it is written.`);
      out.i32(index);
      return;
    }
    if (typeof value.HandleId !== "string" || !value.Data) throw new NativeWriteRefusal(`${owner}: a handle has no data.`);
    if (this.handles.has(value.HandleId)) throw new NativeWriteRefusal(`${owner}: handle ${value.HandleId} is written twice.`);
    const index = this.add(value.Data);
    this.handles.set(value.HandleId, index);
    out.i32(index);
  }

  reference(out: ByteWriter, value: Json): void {
    const path = value?.DepotPath;
    if (!path || path.$value === "0" || path.$value === 0) { out.i16(-1); return; }
    if (path.$storage !== "string" || typeof path.$value !== "string") throw new NativeWriteRefusal("A package reference stored as a hash is not written.");
    const flags = value.Flags ?? "Default";
    if (flags !== "Default" && flags !== "Obligatory" && flags !== "Soft") throw new NativeWriteRefusal(`Package reference flags ${flags} are not written.`);
    const sync = flags === "Obligatory";
    const key = `${sync}|${path.$value}`;
    let index = this.referenceIndex.get(key);
    if (index === undefined) {
      index = this.references.length;
      if (index > 0x7fff) throw new NativeWriteRefusal("More references than a package can index.");
      this.references.push({ path: path.$value, sync });
      this.referenceIndex.set(key, index);
    }
    out.i16(index);
  }

  string(out: ByteWriter, value: string): void {
    const bytes = utf8.encode(value);
    if (bytes.length > 0xffff) throw new NativeWriteRefusal("A package string is too long.");
    out.u16(bytes.length);
    out.bytes(bytes);
  }

  bitfield(out: ByteWriter, names: readonly string[]): void {
    if (names.length > 0xff) throw new NativeWriteRefusal("A package bitfield has too many members.");
    out.u8(names.length);
    for (const name of names) out.u16(this.name(name));
  }

  buffer(out: ByteWriter, value: Json, deferred: boolean, owner: string): void {
    if (deferred) throw new NativeWriteRefusal(`${owner}: deferred buffers are not written inside packages.`);
    if (value === null) { out.u32(0); return; }
    if (typeof value.Bytes !== "string") throw new NativeWriteRefusal(`${owner}: a buffer without bytes.`);
    const bytes = Buffer.from(value.Bytes, "base64");
    out.u32(bytes.length);
    out.bytes(bytes);
  }

  file(roots: readonly Json[]): Uint8Array {
    const hasReferences = this.references.length > 0;
    const header = new ByteWriter(64);
    header.u8(4); header.u8(2); header.u16(hasReferences ? 7 : 6); header.u32(roots.length);
    const referenceData = this.references.map(({ path }) => { const w = new ByteWriter(8); w.u64(depotPathHash(path)); return w.toBytes(); });
    const nameBytes = this.names.map(name => { const bytes = utf8.encode(name); if (bytes.length + 1 > 0xff) throw new NativeWriteRefusal("A package name is too long."); return bytes; });
    const referenceDescriptors = 0, referenceDataAt = this.references.length * 4;
    const nameDescriptors = referenceDataAt + referenceData.reduce((n, data) => n + data.length, 0);
    const nameData = nameDescriptors + this.names.length * 4;
    const chunkDescriptors = nameData + nameBytes.reduce((n, bytes) => n + bytes.length + 1, 0);
    const chunkData = chunkDescriptors + this.chunks.length * 8;
    if (hasReferences) { header.u32(referenceDescriptors); header.u32(referenceDataAt); }
    header.u32(nameDescriptors); header.u32(nameData); header.u32(chunkDescriptors); header.u32(chunkData);
    header.i16(-1);
    header.u16(roots.length);
    for (const root of roots) {
      const id = root?.id;
      if (typeof id !== "string" || !/^\d+$/.test(id)) throw new NativeWriteRefusal("A package root has no CRUID.");
      header.u64(BigInt(id));
    }
    const out = new ByteWriter(chunkData + 1024);
    out.bytes(header.view_());
    let at = referenceDataAt;
    this.references.forEach(({ sync }, i) => {
      const size = referenceData[i]!.length;
      if (at > 0x7fffff || size > 0xff) throw new NativeWriteRefusal("A package's references don't fit its descriptors.");
      out.u32(((at & 0x7fffff) | (size << 23) | (sync ? 0x80000000 : 0)) >>> 0);
      at += size;
    });
    for (const data of referenceData) out.bytes(data);
    at = nameData;
    for (const bytes of nameBytes) {
      if (at > 0xffffff) throw new NativeWriteRefusal("A package's names don't fit its descriptors.");
      out.u32(((at & 0xffffff) | ((bytes.length + 1) << 24)) >>> 0); at += bytes.length + 1;
    }
    for (const bytes of nameBytes) { out.bytes(bytes); out.u8(0); }
    at = chunkData;
    for (const chunk of this.chunks) { out.u32(chunk.type); out.u32(at); at += chunk.body!.length; }
    for (const chunk of this.chunks) out.bytes(chunk.body!);
    return out.toBytes();
  }
}

/** The `compiledData` package of an appearance definition's `components` (each a root, paired with its `id` as CRUID). */
export function writeAppearancePackage(components: readonly Json[]): Uint8Array {
  const writer = new PackageWriter();
  for (const component of components) writer.add(component);
  writer.writeChunks();
  return writer.file(components);
}
