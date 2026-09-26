/**
 * Embedded object packages (`compiledData` of `.ent` templates and `.app` appearance definitions). Pure. Layout and sources:
 * knowledge/archive-format.md §5.3.
 *
 * Header, byte-packed: u8 version (4), u8 (2), u16 section count (7 with a reference pool, else 6), u32 root count, [u32 reference
 * descriptor offset, u32 reference data offset], u32 name descriptor offset, u32 name data offset, u32 chunk descriptor offset,
 * u32 chunk data offset, i16 root index, u16 CRUID count, CRUIDs (u64 each). Section offsets count from the end of the CRUIDs.
 * - Reference descriptors (u32): bits 0-22 offset, 23-30 size, 31 "sync" (rRef; clear for raRef). Data: path text (`.ent`) or a
 *   u64 path hash (`.app`).
 * - Name descriptors (u32): bits 0-23 offset, 24-31 size (with the NUL).
 * - Chunk descriptors: u32 type name index, u32 offset.
 * - An object: u16 field count, then (u16 name index, u16 type index, u32 offset from the object's start) per field, then the values.
 *   Handles are i32 object indexes (-1 null), references i16 indexes (-1 none), strings u16-length UTF-8, bitfields a u8 count of
 *   u16 names, data buffers inline (u32 length and bytes); everything else as in CR2W.
 * The roots are the objects no handle refers to, in chunk order, paired with the CRUIDs by position.
 */
import { Cr2wError } from "./cr2w-file";
import { NativeUnsupportedError, type ParsedBuffer, RedBuffer, RedHandle, RedObject } from "./red-model";
import { float32Value } from "./json-numbers";
import { cname, Cursor, emptyReference, normalizedPath, readValue, type ValueContext } from "./red-values";

const utf8 = new TextDecoder();

class PackageDecoder implements ValueContext {
  readonly names: string[] = [];
  readonly references: { path: string | null; hash: string | null; sync: boolean }[] = [];
  readonly chunks: { type: string; offset: number }[] = [];
  private readonly objects = new Map<number, RedObject>();
  readonly referenced = new Set<number>();

  constructor(private readonly bytes: Uint8Array, private readonly base: number, header: { refDesc: number; refData: number; nameDesc: number; nameData: number; chunkDesc: number; chunkData: number }, private readonly version: number,
    /** The header's second byte (2 in game 2.x packages): with 2, compiled effect infos keep their arrays in memory layout. */
    readonly layout: number) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const at = (offset: number) => base + offset;
    for (let o = header.nameDesc; o < header.nameData; o += 4) {
      const d = view.getUint32(at(o), true), offset = d & 0xffffff, size = d >>> 24;
      this.names.push(utf8.decode(bytes.subarray(at(offset), at(offset) + Math.max(0, size - 1))));
    }
    for (let o = header.refDesc; o < header.refData; o += 4) {
      const d = view.getUint32(at(o), true), offset = d & 0x7fffff, size = (d >>> 23) & 0xff, sync = (d >>> 31) === 1;
      const data = bytes.subarray(at(offset), at(offset) + size);
      if (size === 8 && !isPathText(data)) this.references.push({ path: null, hash: new DataView(data.buffer, data.byteOffset, 8).getBigUint64(0, true).toString(), sync });
      else this.references.push({ path: utf8.decode(data), hash: null, sync });
    }
    for (let o = header.chunkDesc; o < header.chunkData; o += 8)
      this.chunks.push({ type: this.name(view.getUint32(at(o), true)), offset: view.getUint32(at(o) + 4, true) });
  }

  name(index: number): string {
    const value = this.names[index];
    if (value === undefined) throw new Cr2wError(`Package name index ${index} out of range.`);
    return value;
  }

  chunk(index: number): RedObject {
    let object = this.objects.get(index);
    if (object) return object;
    const entry = this.chunks[index];
    if (!entry) throw new Cr2wError(`Package chunk ${index} does not exist.`);
    object = new RedObject(entry.type);
    this.objects.set(index, object);
    this.readFields(new Cursor(this.bytes, this.base + entry.offset), object);
    return object;
  }

  private readFields(cursor: Cursor, object: RedObject): void {
    const start = cursor.pos, count = cursor.u16();
    const fields: { name: string; type: string; offset: number }[] = [];
    for (let i = 0; i < count; i++) fields.push({ name: this.name(cursor.u16()), type: this.name(cursor.u16()), offset: cursor.u32() });
    let end = cursor.pos;
    for (const field of fields) {
      const value = new Cursor(this.bytes, start + field.offset);
      try {
        const compiled = this.layout === 2 && object.type === "worldCompiledEffectInfo" ? readCompiledEffectField(this, value, field.name) : undefined;
        object.fields[field.name] = compiled !== undefined ? compiled : readValue(this, value, field.type, `${object.type}.${field.name}`);
      }
      catch (error) {
        if (error instanceof Error && !error.message.startsWith("In ")) error.message = `In ${object.type}.${field.name} (${field.type}): ${error.message}`;
        throw error;
      }
      end = Math.max(end, value.pos);
    }
    cursor.pos = end;
  }

  object(cursor: Cursor, type: string): RedObject {
    const object = new RedObject(type);
    this.readFields(cursor, object);
    return object;
  }

  handle(cursor: Cursor): RedHandle {
    const index = this.version >= 3 ? cursor.i32() : cursor.i16();
    if (index < 0) return new RedHandle(null);
    this.referenced.add(index);
    return new RedHandle(this.chunk(index));
  }

  reference(cursor: Cursor): unknown {
    const index = cursor.i16();
    // An empty reference in a package is written with the Default flag, whichever kind it is [resource: WolvenKit 9.0.1 output].
    if (index < 0) return emptyReference(false);
    const entry = this.references[index];
    if (!entry) throw new Cr2wError(`Package reference ${index} does not exist.`);
    const flags = entry.sync ? "Obligatory" : "Default";
    if (entry.hash !== null) return { DepotPath: { $type: "ResourcePath", $storage: "uint64", $value: entry.hash }, Flags: flags };
    const path = normalizedPath(entry.path ?? "");
    return { DepotPath: path ? { $type: "ResourcePath", $storage: "string", $value: path } : { $type: "ResourcePath", $storage: "uint64", $value: "0" }, Flags: flags };
  }

  string(cursor: Cursor): string { const size = cursor.u16(); return utf8.decode(cursor.take(size)); }
  nodeRef(cursor: Cursor): string { const size = cursor.i16(); return size > 0 ? utf8.decode(cursor.take(size)) : ""; }

  bitfield(cursor: Cursor): string[] {
    const count = cursor.u8(), names: string[] = [];
    for (let i = 0; i < count; i++) names.push(this.name(cursor.u16()));
    return names;
  }

  buffer(cursor: Cursor, deferred: boolean): RedBuffer | null {
    if (deferred) throw new NativeUnsupportedError("Deferred buffers inside packages are not decoded.");
    const size = cursor.u32(), bytes = cursor.take(size);
    return new RedBuffer(0, size, () => bytes);
  }
}

/**
 * `worldCompiledEffectInfo` in a package whose second header byte is 2 stores its arrays as i32 count and elements in memory
 * layout, not as field lists [source: knowledge/archive-format.md §5.3]: names as u16 name indexes, `Vector3` as 3 f32,
 * `Quaternion` as 4 f32 (i, j, k, r), placement infos as 4 u8, and event infos as u64 CRUID, u64, u64, u8 and 7 padding bytes.
 */
function readCompiledEffectField(ctx: PackageDecoder, cursor: Cursor, name: string): unknown {
  const list = <T>(read: () => T) => { const count = cursor.i32(); return Array.from({ length: Math.max(0, count) }, read); };
  const f32 = () => float32Value(cursor.f32());
  switch (name) {
    case "placementTags": case "componentNames": return list(() => cname(ctx.name(cursor.u16())));
    case "relativePositions": return list(() => new RedObject("Vector3", { X: f32(), Y: f32(), Z: f32() }));
    case "relativeRotations": return list(() => new RedObject("Quaternion", { i: f32(), j: f32(), k: f32(), r: f32() }));
    case "placementInfos": return list(() => new RedObject("worldCompiledEffectPlacementInfo",
      { placementTagIndex: cursor.u8(), relativePositionIndex: cursor.u8(), relativeRotationIndex: cursor.u8(), flags: cursor.u8() }));
    case "eventsSortedByRUID": return list(() => {
      const event = new RedObject("worldCompiledEffectEventInfo", { eventRUID: cursor.u64().toString(), placementIndexMask: cursor.u64().toString(),
        componentIndexMask: cursor.u64().toString(), flags: cursor.u8() });
      cursor.take(7);
      return event;
    });
  }
  return undefined;
}

/** Path text holds no NUL and only printable bytes; a hash almost never does. */
const isPathText = (data: Uint8Array) => data.every(byte => byte >= 0x20 && byte < 0x7f);

/** Decode a package buffer. `owner` names the property that holds it (for messages). */
export function readPackage(bytes: Uint8Array, owner: string): ParsedBuffer {
  const cursor = new Cursor(bytes);
  const version = cursor.u8();
  if (version < 2 || version > 4) throw new NativeUnsupportedError(`${owner}: package version ${version} is not decoded.`);
  const layout = cursor.u8();
  const sections = cursor.u16();
  cursor.u32(); // root count
  let refDesc = 0, refData = 0;
  if (sections === 7) { refDesc = cursor.u32(); refData = cursor.u32(); }
  else if (sections !== 6) throw new NativeUnsupportedError(`${owner}: a package with ${sections} sections is not decoded.`);
  const nameDesc = cursor.u32(), nameData = cursor.u32(), chunkDesc = cursor.u32(), chunkData = cursor.u32();
  const rootIndex = cursor.i16();
  const cruidCount = cursor.u16();
  const cruids: string[] = [];
  for (let i = 0; i < cruidCount; i++) cruids.push(cursor.u64().toString());
  const decoder = new PackageDecoder(bytes, cursor.pos, { refDesc, refData, nameDesc, nameData, chunkDesc, chunkData }, version, layout);
  for (let i = 0; i < decoder.chunks.length; i++) decoder.chunk(i);
  const roots: RedObject[] = [];
  for (let i = 0; i < decoder.chunks.length; i++) if (!decoder.referenced.has(i)) roots.push(decoder.chunk(i));
  const cruidDict: Record<string, string> = {};
  roots.forEach((_, i) => { if (i < cruids.length) cruidDict[String(i)] = cruids[i]!; });
  return { kind: "package", version, sections, cruidIndex: rootIndex, cruidDict, chunks: roots };
}
