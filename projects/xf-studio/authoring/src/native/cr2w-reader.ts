/**
 * Decodes a CR2W file into the red model (red-model.ts). Pure apart from the injected decompressor. Layout and sources:
 * knowledge/archive-format.md §3-§5.
 *
 * An export's body is a 0x00 byte, then property records (u16 name index, u16 type-name index, u32 size counting itself, value),
 * then a u16 0. Nested struct values repeat that layout. A few classes append data after the terminator; this reader decodes
 * the `CMaterialInstance` parameter list (`values`) and the `CMaterialTemplate` parameter table (`parameterInfo`) and refuses any
 * other trailing data. Every record's size is checked against what its value used, so a misread fails instead of drifting, with one
 * exception: an array record may hold more elements than the count at its front says (some mod tools write the count short). Its
 * elements are read to the record's end, as WolvenKit shows them, and a note says so (`arrayPastCount`); each must use at least one
 * byte, so a record can't make the reader loop.
 *
 * One `DecodeSession` (limits.ts) spans the file and every buffer parsed inside it: it counts decoded values and bytes, caps
 * nesting, and collects notes such as a property stored with a type the RTTI slice disagrees with (decoded by the stored type).
 */
import { Cr2wError, Cr2wFile, CR2W_MIN_SIZE } from "./cr2w-file";
import type { Decompress } from "./kark";
import { DecodeSession } from "./limits";
import { NativeUnsupportedError } from "./native-errors";
import { readPackage } from "./red-package";
import { RedBuffer, RedHandle, RedObject, type RedDocument } from "./red-model";
import { cname, Cursor, emptyReference, importFlagsText, normalizedPath, noteStoredType, readValue, readVarString, type ValueContext } from "./red-values";
import { propertyTypes } from "./rtti";

/** Which buffers are parsed, by owning `Class.property` (others stay bytes). */
const PARSED_BUFFERS: Record<string, "package" | "cr2w-list"> = {
  "entEntityTemplate.compiledData": "package",
  "appearanceAppearanceDefinition.compiledData": "package",
  "meshMeshMaterialBuffer.rawData": "cr2w-list",
};

export class Cr2wDecoder implements ValueContext {
  private readonly objects = new Map<number, RedObject>();
  readonly session: DecodeSession;

  constructor(readonly file: Cr2wFile, private readonly decompress: Decompress) { this.session = file.session; }

  name(index: number): string { return this.file.name(index); }

  /** The object of export `index` (decoded once; handles to it share it). */
  exportObject(index: number): RedObject {
    let object = this.objects.get(index);
    if (object) return object;
    const entry = this.file.exports[index];
    if (!entry) throw new Cr2wError(`CR2W export ${index} does not exist.`);
    object = new RedObject(entry.className);
    this.objects.set(index, object);
    this.session.enter();
    const cursor = new Cursor(this.file.bytes, entry.dataOffset, entry.dataOffset + entry.dataSize, this.file.view);
    this.readBody(cursor, object);
    this.readAppendix(cursor, object);
    if (cursor.pos !== cursor.end) throw new NativeUnsupportedError(`${entry.className} has ${cursor.end - cursor.pos} bytes of data after its properties that this reader does not decode.`);
    this.session.leave();
    return object;
  }

  /** A property list: 0x00, records, u16 0. */
  private readBody(cursor: Cursor, object: RedObject): void {
    const lead = cursor.u8();
    if (lead !== 0) throw new Cr2wError(`${object.type}: property list starts with ${lead}, not 0.`);
    const types = propertyTypes(object.type);
    for (;;) {
      const nameIndex = cursor.u16();
      if (nameIndex === 0) return;
      const type = this.name(cursor.u16());
      const start = cursor.pos, size = cursor.u32();
      const name = this.name(nameIndex);
      const end = start + size;
      if (size < 4 || end > cursor.end) throw new Cr2wError(`${object.type}.${name}: record size ${size} is out of range.`);
      noteStoredType(this.session, object.type, types, name, type);
      const inner = cursor.span(cursor.pos, end);
      const value = object.fields[name] = readValue(this, inner, type, `${object.type}.${name}`);
      if (inner.pos !== end && Array.isArray(value) && type.startsWith("array:")) this.readPastCount(inner, value, type, `${object.type}.${name}`);
      if (inner.pos !== end) throw new Cr2wError(`${object.type}.${name} (${type}) read ${inner.pos - start} of ${size} bytes.`);
      cursor.pos = end;
    }
  }

  /**
   * The elements an array record holds past its declared count, to the record's end (the count at the front is short in some mod files:
   * a hair mesh's `renderLODs` says 1 and holds 4). Stops, leaving the record's size check to refuse it, at an element that uses no bytes.
   */
  private readPastCount(cursor: Cursor, items: unknown[], type: string, property: string): void {
    const declared = items.length, element = type.slice("array:".length);
    while (cursor.pos < cursor.end) {
      const before = cursor.pos;
      items.push(readValue(this, cursor, element, property));
      if (cursor.pos === before) return;
    }
    this.session.arrayPastCount(property, declared, items.length);
  }

  private readAppendix(cursor: Cursor, object: RedObject): void {
    if (cursor.pos === cursor.end) return;
    if (object.type === "CMaterialInstance") {
      // u32 count; per entry: u32 size (counting itself and the two names), u16 parameter name, u16 type name, value.
      const count = cursor.count("CMaterialInstance.values");
      this.session.nodes(count);
      const values: unknown[] = [];
      for (let i = 0; i < count; i++) {
        const start = cursor.pos, size = cursor.u32();
        const name = this.name(cursor.u16()), type = this.name(cursor.u16());
        if (size < 8 || start + size > cursor.end) throw new Cr2wError(`CMaterialInstance value ${name}: size ${size} is out of range.`);
        const inner = cursor.span(cursor.pos, start + size);
        const value = readValue(this, inner, type, `CMaterialInstance.values`);
        if (inner.pos !== start + size) throw new Cr2wError(`CMaterialInstance value ${name} (${type}) read ${inner.pos - start} of ${size} bytes.`);
        cursor.pos = start + size;
        values.push({ $type: type, [name]: value });
      }
      object.fields.values = values;
      return;
    }
    if (object.type === "CMaterialTemplate") {
      // Groups until the end: u8 count, then count × (u8 type, u16 offset, u16 name index).
      const groups: unknown[] = [];
      while (cursor.pos < cursor.end) {
        const count = cursor.u8();
        this.session.nodes(count + 1);
        const group: unknown[] = [];
        for (let i = 0; i < count; i++) {
          const type = cursor.u8(), offset = cursor.u16(), name = this.name(cursor.u16());
          group.push(new RedObject("CMaterialParameterInfo", { name: cname(name), offset, type }));
        }
        groups.push(group);
      }
      object.fields.parameterInfo = groups;
    }
  }

  object(cursor: Cursor, type: string): RedObject {
    const object = new RedObject(type);
    this.session.enter();
    this.readBody(cursor, object);
    this.session.leave();
    return object;
  }

  handle(cursor: Cursor): RedHandle {
    const value = cursor.i32();
    return new RedHandle(value <= 0 ? null : this.exportObject(value - 1));
  }

  reference(cursor: Cursor): unknown {
    const value = cursor.u16();
    if (value === 0) return emptyReference(false);
    const entry = this.file.imports[value - 1];
    if (!entry) throw new Cr2wError(`CR2W import ${value - 1} does not exist.`);
    const path = normalizedPath(entry.path);
    return { DepotPath: path ? { $type: "ResourcePath", $storage: "string", $value: path } : { $type: "ResourcePath", $storage: "uint64", $value: "0" },
      Flags: importFlagsText(entry.flags) };
  }

  string(cursor: Cursor): string { return readVarString(cursor); }
  nodeRef(cursor: Cursor): string { return readVarString(cursor); }

  bitfield(cursor: Cursor): string[] {
    const names: string[] = [];
    for (let index = cursor.u16(); index !== 0; index = cursor.u16()) names.push(this.name(index));
    return names;
  }

  buffer(cursor: Cursor, deferred: boolean, owner: string): RedBuffer | null {
    let index: number;
    if (deferred) {
      const value = cursor.u16();
      if (value === 0) return null;
      index = value - 1;
    } else {
      const value = cursor.u32();
      // 0x80000000 is an empty buffer, which the reference JSON still writes as one (with an id and no bytes).
      if (value === 0x80000000) return new RedBuffer(0, 0, () => new Uint8Array(0));
      if (value < 0x80000000) {
        const bytes = cursor.take(value);
        return this.parsed(0, bytes.length, () => bytes, owner);
      }
      index = (value ^ 0x80000000) - 1;
    }
    const entry = this.file.buffers[index];
    if (!entry) throw new Cr2wError(`CR2W buffer ${index} does not exist.`);
    let bytes: Uint8Array | null = null;
    return this.parsed(entry.flags, entry.memSize, () => (bytes ??= this.file.bufferBytes(index, this.decompress)), owner);
  }

  private parsed(flags: number, memSize: number, bytes: () => Uint8Array, owner: string): RedBuffer {
    // An empty buffer stays bytes (nothing to parse).
    const kind = memSize ? PARSED_BUFFERS[owner] : undefined;
    if (kind === "package") return new RedBuffer(flags, memSize, bytes, readPackage(bytes(), owner, this.session));
    if (kind === "cr2w-list") {
      this.session.enter();
      const files = readCr2wList(bytes(), this.decompress, this.session);
      this.session.leave();
      return new RedBuffer(flags, memSize, bytes, { kind: "cr2w-list", files });
    }
    return new RedBuffer(flags, memSize, bytes);
  }

  document(): RedDocument {
    const root = this.exportObject(0);
    const embedded = this.file.embedded.map(record => ({ path: normalizedPath(record.importIndex ? this.file.imports[record.importIndex - 1]!.path : ""),
      content: this.exportObject(record.chunkIndex) }));
    return { version: this.file.version, buildVersion: this.file.buildVersion, root, embedded };
  }
}

/** A CR2W file's red model. The session carries the budgets and collects notes (a fresh one with the default limits if omitted). */
export function readCr2w(bytes: Uint8Array, decompress: Decompress, session = new DecodeSession()): RedDocument {
  return new Cr2wDecoder(new Cr2wFile(bytes, session), decompress).document();
}

/** Complete CR2W files placed back to back (a mesh's local material buffer); each one's length is its own buffers end. */
export function readCr2wList(bytes: Uint8Array, decompress: Decompress, session = new DecodeSession()): RedDocument[] {
  const files: RedDocument[] = [];
  for (let at = 0; at < bytes.length;) {
    if (bytes.length - at < CR2W_MIN_SIZE) throw new Cr2wError("Truncated CR2W file in a list.");
    const length = new DataView(bytes.buffer, bytes.byteOffset + at, CR2W_MIN_SIZE).getUint32(28, true);
    if (length < CR2W_MIN_SIZE || length > bytes.length - at) throw new Cr2wError(`A CR2W file in a list claims ${length} of ${bytes.length - at} bytes.`);
    files.push(new Cr2wDecoder(new Cr2wFile(bytes.subarray(at, at + length), session), decompress).document());
    at += length;
  }
  return files;
}
