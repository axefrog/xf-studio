/**
 * Embedded object packages (`compiledData` of `.ent` templates and `.app` appearance definitions). Pure. Layout and sources:
 * knowledge/archive-format.md §5.3. The frame (header, sections, names, references, chunks and their bounds) is the one package reader's
 * (engines/red-object/package.ts, `resource` variant), shared with the save's packages; this module adds the resource values, read with
 * the RTTI and the CR2W value reader, and the resource refusal policy.
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
 * TweakDBIDs, and none was verified), and a type name the RTTI does not know as a class (rtti.ts `kindOf`) is refused rather than
 * read as a struct.
 */
import { float32Value } from "./json-numbers";
import { DecodeSession } from "./limits";
import { NativeMalformedError, NativeUnsupportedError } from "./native-errors";
import { type ParsedBuffer, RedBuffer, RedHandle, RedObject } from "./red-model";
import { cname, Cursor, emptyReference, normalizedPath, noteStoredType, readValue, type ValueContext } from "./red-values";
import { kindOf, propertyTypes } from "./rtti";
import { PackageFrameError, readPackageFrame, type PackageFrame } from "../engines/red-object/package";

const utf8 = new TextDecoder();

/** Owners whose packages store references as u64 path hashes; every other owner stores path text. */
const HASH_REFERENCE_OWNERS = new Set(["appearanceAppearanceDefinition.compiledData"]);

class PackageDecoder implements ValueContext {
  readonly names: string[] = [];
  readonly references: { path: string | null; hash: string | null; sync: boolean }[] = [];
  readonly chunks: { type: string; offset: number; end: number }[] = [];
  private readonly objects = new Map<number, RedObject>();
  readonly referenced = new Set<number>();
  private readonly view: DataView;

  private readonly bytes: Uint8Array;
  private readonly base: number;

  constructor(frame: PackageFrame, hashReferences: boolean,
    /** The header's second byte (2 in game 2.x packages): with 2, compiled effect infos keep their arrays in memory layout. */
    readonly layout: number, readonly session: DecodeSession) {
    this.bytes = frame.bytes; this.base = frame.base; this.view = frame.view;
    // Every name and reference is decoded up front, each counted against the session's budget.
    for (let i = 0; i < frame.nameCount; i++) {
      session.name(frame.nameLength(i));
      this.names.push(frame.name(i));
    }
    for (let i = 0; i < frame.referenceCount; i++) {
      const { length, sync, data } = frame.reference(i);
      if (hashReferences) {
        if (length !== 8) throw new NativeUnsupportedError(`Package reference ${i} holds ${length} bytes where a path hash (8) is expected.`);
        this.references.push({ path: null, hash: new DataView(data.buffer, data.byteOffset, 8).getBigUint64(0, true).toString(), sync });
      } else {
        session.name(length);
        this.references.push({ path: utf8.decode(data), hash: null, sync });
      }
    }
    session.nodes(frame.chunks.length);
    for (const chunk of frame.chunks) this.chunks.push({ type: chunk.type, offset: chunk.start - frame.base, end: chunk.end - frame.base });
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
    this.readFields(new Cursor(this.bytes, this.base + entry.offset, this.base + entry.end, this.view), object);
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
    const types = propertyTypes(object.type);
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]!, next = fields[i + 1];
      if (field.offset !== expected) throw new NativeMalformedError(`${object.type}.${field.name}: value at ${field.offset}, expected ${expected}.`);
      if (next && next.offset <= field.offset) throw new NativeMalformedError(`${object.type}.${next.name}: field offsets do not increase.`);
      const valueEnd = next ? start + next.offset : cursor.end;
      if (valueEnd > cursor.end) throw new NativeMalformedError(`${object.type}.${field.name}: value passes the end of its object.`);
      const value = cursor.span(start + field.offset, valueEnd);
      try {
        noteStoredType(this.session, object.type, types, field.name, field.type);
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
    // A name the RTTI does not know may be an enum or struct from a newer game; reading it as a struct would guess its layout.
    const kind = kindOf(type);
    if (kind !== "class" && kind !== "unsliced-class") throw new NativeUnsupportedError(`Package values of type ${type} are not decoded (not a class the RTTI knows).`);
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
  // The shared frame's refusals, as the native reader's errors.
  const framed = <T>(read: () => T): T => {
    try { return read(); }
    catch (error) {
      if (!(error instanceof PackageFrameError)) throw error;
      throw error.kind === "unsupported" ? new NativeUnsupportedError(`${owner}: ${error.message}`) : new NativeMalformedError(`${owner}: ${error.message}`);
    }
  };
  const frame = framed(() => readPackageFrame(bytes, "resource"));
  const decoder = framed(() => new PackageDecoder(frame, HASH_REFERENCE_OWNERS.has(owner), frame.layout, session));
  for (let i = 0; i < decoder.chunks.length; i++) decoder.chunk(i);
  const roots: RedObject[] = [];
  for (let i = 0; i < decoder.chunks.length; i++) if (!decoder.referenced.has(i)) roots.push(decoder.chunk(i));
  const cruidDict: Record<string, string> = {};
  roots.forEach((_, i) => { if (i < frame.cruids.length) cruidDict[String(i)] = frame.cruids[i]!.toString(); });
  return { kind: "package", version: frame.version, sections: frame.sections, cruidIndex: frame.rootIndex, cruidDict, chunks: roots };
}
