/**
 * Embedded object packages (`compiledData` of `.ent` templates and `.app` appearance definitions). Pure. Layout and sources:
 * knowledge/archive-format.md §5.3.
 *
 * Header, byte-packed: u8 version (4), u8 (2), u16 section count (7 with a reference pool, else 6), u32 root count, [u32 reference
 * descriptor offset, u32 reference data offset], u32 name descriptor offset, u32 name data offset, u32 chunk descriptor offset,
 * u32 chunk data offset, i16 root index, u16 CRUID count, CRUIDs (u64 each). Section offsets count from the end of the CRUIDs.
 * - Reference descriptors (u32): bits 0-22 offset, 23-30 size, 31 "sync" (rRef; clear for raRef). Data: path text in `.ent`
 *   packages, a u64 path hash in `.app` packages (decided by the owner, never by the bytes).
 * - Name descriptors (u32): bits 0-23 offset, 24-31 size (with the NUL).
 * - Chunk descriptors: u32 type name index, u32 offset.
 * - An object: u16 field count, then (u16 name index, u16 type index, u32 offset from the object's start) per field, then the values.
 *   Handles are i32 object indexes (-1 null), references i16 indexes (-1 none), strings u16-length UTF-8, bitfields a u8 count of
 *   u16 names, data buffers inline (u32 length and bytes); everything else as in CR2W.
 * The roots are the objects no handle refers to, in chunk order, paired with the CRUIDs by position.
 *
 * Strictness, so file-chosen offsets cannot make one value decode many times: the sections lie in order inside the package; within
 * an object the first value starts right after the field table, offsets strictly increase and each value ends exactly where the
 * next begins; a chunk ends at or before the next chunk's start. Only version 4 is decoded (versions 2-3 differ, e.g. in
 * TweakDBIDs, and none was verified), and a type the RTTI slice does not know is refused rather than read as a struct.
 */
import { float32Value } from "./json-numbers";
import { DecodeSession } from "./limits";
import { NativeMalformedError, NativeUnsupportedError } from "./native-errors";
import { type ParsedBuffer, RedBuffer, RedHandle, RedObject } from "./red-model";
import { cname, Cursor, emptyReference, normalizedPath, noteStoredType, readValue, type ValueContext } from "./red-values";
import { kindOf } from "./rtti";

const utf8 = new TextDecoder();

/** Owners whose packages store references as u64 path hashes; every other owner stores path text. */
const HASH_REFERENCE_OWNERS = new Set(["appearanceAppearanceDefinition.compiledData"]);

interface Sections { refDesc: number; refData: number; nameDesc: number; nameData: number; chunkDesc: number; chunkData: number }

class PackageDecoder implements ValueContext {
  readonly names: string[] = [];
  readonly references: { path: string | null; hash: string | null; sync: boolean }[] = [];
  readonly chunks: { type: string; offset: number; end: number }[] = [];
  private readonly objects = new Map<number, RedObject>();
  readonly referenced = new Set<number>();

  constructor(private readonly bytes: Uint8Array, private readonly base: number, header: Sections, hashReferences: boolean,
    /** The header's second byte (2 in game 2.x packages): with 2, compiled effect infos keep their arrays in memory layout. */
    readonly layout: number, readonly session: DecodeSession) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const size = bytes.length - base;
    const region = (offset: number, length: number, what: string) => {
      if (offset + length > size) throw new NativeMalformedError(`Package ${what} lies outside the package.`);
      return bytes.subarray(base + offset, base + offset + length);
    };
    const table = (from: number, to: number, stride: number, what: string) => {
      if ((to - from) % stride) throw new NativeMalformedError(`Package ${what} table is not a whole number of entries.`);
      return (to - from) / stride;
    };
    for (let i = 0, count = table(header.nameDesc, header.nameData, 4, "name"); i < count; i++) {
      const d = view.getUint32(base + header.nameDesc + i * 4, true), offset = d & 0xffffff, length = d >>> 24;
      const data = region(offset, Math.max(0, length - 1), "name");
      session.name(data.length);
      this.names.push(utf8.decode(data));
    }
    for (let i = 0, count = table(header.refDesc, header.refData, 4, "reference"); i < count; i++) {
      const d = view.getUint32(base + header.refDesc + i * 4, true), offset = d & 0x7fffff, length = (d >>> 23) & 0xff, sync = (d >>> 31) === 1;
      const data = region(offset, length, "reference");
      if (hashReferences) {
        if (length !== 8) throw new NativeUnsupportedError(`Package reference ${i} holds ${length} bytes where a path hash (8) is expected.`);
        this.references.push({ path: null, hash: new DataView(data.buffer, data.byteOffset, 8).getBigUint64(0, true).toString(), sync });
      } else {
        session.name(length);
        this.references.push({ path: utf8.decode(data), hash: null, sync });
      }
    }
    const chunkCount = table(header.chunkDesc, header.chunkData, 8, "chunk");
    session.nodes(chunkCount);
    for (let i = 0; i < chunkCount; i++) {
      const at = base + header.chunkDesc + i * 8;
      this.chunks.push({ type: this.name(view.getUint32(at, true)), offset: view.getUint32(at + 4, true), end: size });
    }
    // Chunks lie in order inside the chunk data: each ends at or before the next one's start.
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i]!, next = this.chunks[i + 1];
      if (chunk.offset < header.chunkData || chunk.offset >= size) throw new NativeMalformedError(`Package chunk ${i} starts outside the chunk data.`);
      if (next) { if (next.offset <= chunk.offset) throw new NativeMalformedError(`Package chunk ${i + 1} does not follow chunk ${i}.`); chunk.end = next.offset; }
    }
  }

  name(index: number): string {
    const value = this.names[index];
    if (value === undefined) throw new NativeMalformedError(`Package name index ${index} out of range.`);
    return value;
  }

  chunk(index: number): RedObject {
    let object = this.objects.get(index);
    if (object) return object;
    const entry = this.chunks[index];
    if (!entry) throw new NativeMalformedError(`Package chunk ${index} does not exist.`);
    object = new RedObject(entry.type);
    this.objects.set(index, object);
    this.session.enter();
    this.readFields(new Cursor(this.bytes, this.base + entry.offset, this.base + entry.end), object);
    this.session.leave();
    return object;
  }

  /**
   * An object's field table and values. The values are contiguous and in table order: the first starts right after the table, and
   * each ends exactly where the next begins, so every byte of the object is read once.
   */
  private readFields(cursor: Cursor, object: RedObject): void {
    const start = cursor.pos, count = cursor.u16();
    if (count * 8 > cursor.remaining) throw new NativeMalformedError(`${object.type}: ${count} fields cannot fit in the object.`);
    this.session.nodes(count);
    const fields: { name: string; type: string; offset: number }[] = [];
    for (let i = 0; i < count; i++) fields.push({ name: this.name(cursor.u16()), type: this.name(cursor.u16()), offset: cursor.u32() });
    let expected = cursor.pos - start;
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]!, next = fields[i + 1];
      if (field.offset !== expected) throw new NativeMalformedError(`${object.type}.${field.name}: value at ${field.offset}, expected ${expected}.`);
      if (next && next.offset <= field.offset) throw new NativeMalformedError(`${object.type}.${next.name}: field offsets do not increase.`);
      const valueEnd = next ? start + next.offset : cursor.end;
      if (valueEnd > cursor.end) throw new NativeMalformedError(`${object.type}.${field.name}: value passes the end of its object.`);
      const value = new Cursor(this.bytes, start + field.offset, valueEnd);
      try {
        noteStoredType(this.session, object.type, field.name, field.type);
        const compiled = this.layout === 2 && object.type === "worldCompiledEffectInfo" ? readCompiledEffectField(this, value, field.name) : undefined;
        object.fields[field.name] = compiled !== undefined ? compiled : readValue(this, value, field.type, `${object.type}.${field.name}`);
      }
      catch (error) {
        if (error instanceof Error && !error.message.startsWith("In ")) error.message = `In ${object.type}.${field.name} (${field.type}): ${error.message}`;
        throw error;
      }
      if (next && value.pos !== valueEnd) throw new NativeMalformedError(`${object.type}.${field.name} (${field.type}) used ${value.pos - start - field.offset} of ${valueEnd - start - field.offset} bytes.`);
      expected = value.pos - start;
    }
    cursor.pos = start + expected;
  }

  object(cursor: Cursor, type: string): RedObject {
    // A type outside the RTTI slice may be an enum or struct from a newer game; reading it as a struct would guess its layout.
    if (kindOf(type) !== "class") throw new NativeUnsupportedError(`Package values of type ${type} are not decoded (not in the RTTI slice).`);
    const object = new RedObject(type);
    this.session.enter();
    this.readFields(cursor, object);
    this.session.leave();
    return object;
  }

  handle(cursor: Cursor): RedHandle {
    const index = cursor.i32();
    if (index < 0) return new RedHandle(null);
    this.referenced.add(index);
    return new RedHandle(this.chunk(index));
  }

  reference(cursor: Cursor): unknown {
    const index = cursor.i16();
    // An empty reference in a package is written with the Default flag, whichever kind it is [resource: WolvenKit 9.0.1 output].
    if (index < 0) return emptyReference(false);
    const entry = this.references[index];
    if (!entry) throw new NativeMalformedError(`Package reference ${index} does not exist.`);
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
  const list = <T>(size: number, read: () => T) => {
    const count = cursor.i32();
    if (count > cursor.remaining / size) throw new NativeMalformedError(`worldCompiledEffectInfo.${name}: ${count} elements cannot fit in ${cursor.remaining} bytes.`);
    ctx.session.nodes(Math.max(0, count));
    return Array.from({ length: Math.max(0, count) }, read);
  };
  const f32 = () => float32Value(cursor.f32());
  switch (name) {
    case "placementTags": case "componentNames": return list(2, () => cname(ctx.name(cursor.u16())));
    case "relativePositions": return list(12, () => new RedObject("Vector3", { X: f32(), Y: f32(), Z: f32() }));
    case "relativeRotations": return list(16, () => new RedObject("Quaternion", { i: f32(), j: f32(), k: f32(), r: f32() }));
    case "placementInfos": return list(4, () => new RedObject("worldCompiledEffectPlacementInfo",
      { placementTagIndex: cursor.u8(), relativePositionIndex: cursor.u8(), relativeRotationIndex: cursor.u8(), flags: cursor.u8() }));
    case "eventsSortedByRUID": return list(32, () => {
      const event = new RedObject("worldCompiledEffectEventInfo", { eventRUID: cursor.u64().toString(), placementIndexMask: cursor.u64().toString(),
        componentIndexMask: cursor.u64().toString(), flags: cursor.u8() });
      cursor.take(7);
      return event;
    });
  }
  return undefined;
}

/** Decode a package buffer. `owner` names the property that holds it: it decides how references are stored, and names messages. */
export function readPackage(bytes: Uint8Array, owner: string, session = new DecodeSession()): ParsedBuffer {
  const cursor = new Cursor(bytes);
  const version = cursor.u8();
  if (version !== 4) throw new NativeUnsupportedError(`${owner}: package version ${version} is not decoded.`);
  const layout = cursor.u8();
  const sections = cursor.u16();
  cursor.u32(); // root count
  let refDesc = 0, refData = 0;
  if (sections === 7) { refDesc = cursor.u32(); refData = cursor.u32(); }
  else if (sections !== 6) throw new NativeUnsupportedError(`${owner}: a package with ${sections} sections is not decoded.`);
  const nameDesc = cursor.u32(), nameData = cursor.u32(), chunkDesc = cursor.u32(), chunkData = cursor.u32();
  const rootIndex = cursor.i16();
  const cruidCount = cursor.u16();
  if (cruidCount * 8 > cursor.remaining) throw new NativeMalformedError(`${owner}: ${cruidCount} CRUIDs cannot fit in the package.`);
  const cruids: string[] = [];
  for (let i = 0; i < cruidCount; i++) cruids.push(cursor.u64().toString());
  const order = [refDesc, refData, nameDesc, nameData, chunkDesc, chunkData];
  for (let i = 1; i < order.length; i++) if (order[i]! < order[i - 1]!) throw new NativeMalformedError(`${owner}: package sections are out of order.`);
  if (chunkData > bytes.length - cursor.pos) throw new NativeMalformedError(`${owner}: package sections lie outside the package.`);
  const decoder = new PackageDecoder(bytes, cursor.pos, { refDesc, refData, nameDesc, nameData, chunkDesc, chunkData }, HASH_REFERENCE_OWNERS.has(owner), layout, session);
  for (let i = 0; i < decoder.chunks.length; i++) decoder.chunk(i);
  const roots: RedObject[] = [];
  for (let i = 0; i < decoder.chunks.length; i++) if (!decoder.referenced.has(i)) roots.push(decoder.chunk(i));
  const cruidDict: Record<string, string> = {};
  roots.forEach((_, i) => { if (i < cruids.length) cruidDict[String(i)] = cruids[i]!; });
  return { kind: "package", version, sections, cruidIndex: rootIndex, cruidDict, chunks: roots };
}
