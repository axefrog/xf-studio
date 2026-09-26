/**
 * Read-only reader for the object packages a Cyberpunk save stores in its script-system nodes (`ScriptableSystemsContainer`). Pure and
 * browser-safe (no RTTI tables): the package describes itself, and only the chunks a caller asks for are decoded.
 *
 * Layout [source: WolvenKit `RedPackageReader.File.cs` at commit 11720772, `RedPackageType.ScriptableSystem`; the resource variant is
 * native/red-package.ts]: u8 version (4), u8, u16 section count (6, or 7 with a reference pool), u32 root count, [u32 reference
 * descriptor offset, u32 reference data offset], u32 name descriptor offset, u32 name data offset, u32 chunk descriptor offset, u32
 * chunk data offset, then **a u32 CRUID count** (a resource package stores an i16 root index and a u16 count here) and the CRUIDs.
 * Section offsets count from the end of the CRUIDs. Names are u32 descriptors (bits 0-23 offset, 24-31 size with the NUL); chunks are
 * (u32 type name index, u32 offset). An object is a u16 field count, then (u16 name index, u16 type index, u32 offset from the object's
 * start) per field, then the values in table order.
 *
 * Every object names its fields' types, so a chunk of a class no dump knows (a script mod's system) is still walkable; this reader decodes
 * only what a caller asks for. Values: fixed-size numbers, `TweakDBID` (u64), `CName` and the enums the caller names (u16 name index),
 * `array:T` (u32 count), handles (i32 chunk index, kept as the index and never followed) and nested classes and structs (their own field
 * tables). A field of any other type is skipped by the next field's offset; one that can't be skipped that way (the last field of an
 * array element) makes the element, and so the field holding it, unreadable, which the caller learns from `skipped`.
 *
 * Strictness: the name and chunk tables are capped (`MAX_NAMES`, `MAX_CHUNKS`) and names are decoded only when used; every read is bounded by its chunk (a chunk ends where the next one starts), offsets must increase, a count can't exceed the
 * bytes left, and nesting and decoded values are capped, so a hostile save can't make one value decode many times.
 */

export type PackageValue = number | string | boolean | null | PackageObject | PackageHandle | PackageValue[];
export type PackageObject = { readonly $type: string; readonly fields: Readonly<Record<string, PackageValue>> };
export type PackageHandle = { readonly $handle: number };
export type PackageChunk = { readonly type: string; readonly index: number };
export type SavePackage = {
  readonly version: number;
  readonly chunks: readonly PackageChunk[];
  /** Decode one chunk; `enums` names the enum types among its fields (read as their member names). */
  decode(index: number, enums: ReadonlySet<string>): { object: PackageObject; skipped: string[] };
};

export class SavePackageError extends Error { override name = "SavePackageError"; }

const FIXED: Readonly<Record<string, [size: number, read: (view: DataView, at: number) => number | string | boolean]>> = {
  Bool: [1, (v, at) => v.getUint8(at) !== 0], Int8: [1, (v, at) => v.getInt8(at)], Uint8: [1, (v, at) => v.getUint8(at)],
  Int16: [2, (v, at) => v.getInt16(at, true)], Uint16: [2, (v, at) => v.getUint16(at, true)],
  Int32: [4, (v, at) => v.getInt32(at, true)], Uint32: [4, (v, at) => v.getUint32(at, true)], Float: [4, (v, at) => v.getFloat32(at, true)],
  Int64: [8, (v, at) => v.getBigInt64(at, true).toString()], Uint64: [8, (v, at) => v.getBigUint64(at, true).toString()],
  Double: [8, (v, at) => v.getFloat64(at, true)], CRUID: [8, (v, at) => v.getBigUint64(at, true).toString()],
  /** A TweakDBID as its u64 (CRC-32 of the name and the name's length in the next byte), in decimal. */
  TweakDBID: [8, (v, at) => v.getBigUint64(at, true).toString()],
};
const MAX_DEPTH = 32, MAX_VALUES = 1_000_000;
/** Names a package may list (fields index them by a u16) and chunks it may hold (far above any save's script data; CORE-92). */
export const MAX_NAMES = 65_536, MAX_CHUNKS = 65_536;
const utf8 = new TextDecoder("utf-8", { fatal: false });

/** Open a save's object package (the bytes after the node's u32 size). Throws `SavePackageError` when the frame is not one. */
export function readSavePackage(bytes: Uint8Array): SavePackage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at: number) => { if (at + 4 > bytes.length) throw new SavePackageError("The package is truncated."); return view.getUint32(at, true); };
  if (bytes.length < 24) throw new SavePackageError("The package is truncated.");
  const version = bytes[0]!;
  if (version !== 4) throw new SavePackageError(`Package version ${version} is not read.`);
  const sections = view.getUint16(2, true);
  if (sections !== 6 && sections !== 7) throw new SavePackageError(`A package with ${sections} sections is not read.`);
  let pos = 8;
  if (sections === 7) pos += 8;
  const nameDesc = u32(pos), nameData = u32(pos + 4), chunkDesc = u32(pos + 8), chunkData = u32(pos + 12);
  pos += 16;
  const cruids = u32(pos);
  pos += 4;
  if (cruids > (bytes.length - pos) / 8) throw new SavePackageError("The package's CRUID count doesn't fit.");
  const base = pos + cruids * 8, size = bytes.length - base;
  if (!(nameDesc <= nameData && nameData <= chunkDesc && chunkDesc <= chunkData && chunkData <= size)) throw new SavePackageError("The package's sections are out of order.");
  if ((nameData - nameDesc) % 4 || (chunkData - chunkDesc) % 8) throw new SavePackageError("A package table is not a whole number of entries.");
  // Bounded before anything is decoded (CORE-92): a field names its name and type by a u16, so more names than that can never be used, and
  // no save's script data holds more chunks than `MAX_CHUNKS`. Names are decoded only when a chunk or field asks for them.
  const nameCount = (nameData - nameDesc) / 4, chunkCount = (chunkData - chunkDesc) / 8;
  if (nameCount > MAX_NAMES) throw new SavePackageError(`A package with ${nameCount} names is not read.`);
  if (chunkCount > MAX_CHUNKS) throw new SavePackageError(`A package with ${chunkCount} chunks is not read.`);
  const names = new Map<number, string>();
  const name = (index: number) => {
    const known = names.get(index);
    if (known !== undefined) return known;
    if (!Number.isInteger(index) || index < 0 || index >= nameCount) throw new SavePackageError(`Package name ${index} doesn't exist.`);
    const d = view.getUint32(base + nameDesc + index * 4, true), offset = d & 0xffffff, length = d >>> 24;
    if (offset + Math.max(0, length - 1) > size) throw new SavePackageError("A package name lies outside the package.");
    const value = utf8.decode(bytes.subarray(base + offset, base + offset + Math.max(0, length - 1)));
    names.set(index, value);
    return value;
  };
  const table: { type: string; start: number; end: number }[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const at = base + chunkDesc + i * 8;
    table.push({ type: name(view.getUint32(at, true)), start: base + view.getUint32(at + 4, true), end: bytes.length });
  }
  for (let i = 0; i < table.length; i++) {
    const chunk = table[i]!, next = table[i + 1];
    if (chunk.start < base + chunkData || chunk.start >= bytes.length) throw new SavePackageError(`Package chunk ${i} starts outside the chunk data.`);
    if (next) { if (next.start <= chunk.start) throw new SavePackageError(`Package chunk ${i + 1} does not follow chunk ${i}.`); chunk.end = next.start; }
  }

  const decode = (index: number, enums: ReadonlySet<string>) => {
    const chunk = table[index];
    if (!chunk) throw new SavePackageError(`Package chunk ${index} doesn't exist.`);
    const skipped: string[] = [];
    let values = 0;
    /** One value of `type` at `at`, within `end`; returns the value and where it ends, or null when the type isn't read. */
    /** `exact`: the value ends exactly at `end` (a field whose next field's offset is known, or a chunk); array elements don't. */
    const value = (type: string, at: number, end: number, exact: boolean, depth: number, owner: string): [PackageValue, number] | null => {
      if (++values > MAX_VALUES) throw new SavePackageError("The package holds more values than a save's script data can.");
      const fixed = FIXED[type];
      if (fixed) {
        if (at + fixed[0] > end) throw new SavePackageError(`${owner} passes the end of its object.`);
        return [fixed[1](view, at), at + fixed[0]];
      }
      if (type === "CName" || enums.has(type)) {
        if (at + 2 > end) throw new SavePackageError(`${owner} passes the end of its object.`);
        return [name(view.getUint16(at, true)), at + 2];
      }
      if (type === "String") {
        if (at + 2 > end) throw new SavePackageError(`${owner} passes the end of its object.`);
        const length = view.getUint16(at, true);
        if (at + 2 + length > end) throw new SavePackageError(`${owner} passes the end of its object.`);
        return [utf8.decode(bytes.subarray(at + 2, at + 2 + length)), at + 2 + length];
      }
      if (/^w?handle:/.test(type)) {
        if (at + 4 > end) throw new SavePackageError(`${owner} passes the end of its object.`);
        return [{ $handle: view.getInt32(at, true) }, at + 4];
      }
      if (type.startsWith("array:")) {
        if (at + 4 > end) throw new SavePackageError(`${owner} passes the end of its object.`);
        const count = view.getUint32(at, true), inner = type.slice(6);
        if (count > end - at - 4) throw new SavePackageError(`${owner}: ${count} elements cannot fit.`);
        const out: PackageValue[] = [];
        let next = at + 4;
        for (let i = 0; i < count; i++) {
          const element = value(inner, next, end, false, depth + 1, `${owner}[${i}]`);
          if (!element) return null;
          out.push(element[0]);
          next = element[1];
        }
        return [out, next];
      }
      // Anything else with a field table is a class or struct; a type this reader can't tell (an enum the caller didn't name, a static
      // array, a resource reference) is not read.
      if (/^(static:|\[|r(?:a)?Ref:|curveData:|multiChannelCurve:)/.test(type) || /^(NodeRef|LocalizationString|CGUID|DataBuffer|CVariant)$/.test(type)) return null;
      return object(type, at, end, exact, depth + 1, owner);
    };
    const object = (type: string, at: number, end: number, exact: boolean, depth: number, owner: string): [PackageObject, number] | null => {
      if (depth > MAX_DEPTH) throw new SavePackageError("The package nests objects deeper than a save's script data does.");
      if (at + 2 > end) throw new SavePackageError(`${owner} passes the end of its chunk.`);
      const count = view.getUint16(at, true);
      if (at + 2 + count * 8 > end) throw new SavePackageError(`${owner}: ${count} fields cannot fit.`);
      const fields: Record<string, PackageValue> = {};
      let expected = 2 + count * 8, finish = at + expected;
      for (let i = 0; i < count; i++) {
        const entry = at + 2 + i * 8;
        const field = name(view.getUint16(entry, true)), fieldType = name(view.getUint16(entry + 2, true)), offset = view.getUint32(entry + 4, true);
        if (offset !== expected) throw new SavePackageError(`${owner}.${field}: value at ${offset}, expected ${expected}.`);
        const nextOffset = i + 1 < count ? view.getUint32(at + 2 + (i + 1) * 8 + 4, true) : null;
        if (nextOffset !== null && nextOffset <= offset) throw new SavePackageError(`${owner}: field offsets don't increase.`);
        const valueEnd = nextOffset !== null ? at + nextOffset : end;
        if (valueEnd > end) throw new SavePackageError(`${owner}.${field} passes the end of its object.`);
        const read = value(fieldType, at + offset, valueEnd, nextOffset !== null || exact, depth, `${owner}.${field}`);
        if (read) {
          if (nextOffset !== null && read[1] !== valueEnd) throw new SavePackageError(`${owner}.${field} (${fieldType}) used ${read[1] - at - offset} of ${valueEnd - at - offset} bytes.`);
          fields[field] = read[0];
          finish = read[1];
          expected = read[1] - at;
        } else {
          // Skipped by the next field's offset; the last field only when the object's own end is known.
          skipped.push(`${owner}.${field}: ${fieldType}`);
          fields[field] = null;
          if (nextOffset === null) { if (!exact) return null; finish = end; break; }
          finish = valueEnd;
          expected = nextOffset;
        }
      }
      return [{ $type: type, fields }, finish];
    };
    const found = object(chunk.type, chunk.start, chunk.end, true, 1, chunk.type);
    if (!found) throw new SavePackageError(`${chunk.type} could not be read.`);
    return { object: found[0], skipped };
  };
  return { version, chunks: table.map((chunk, index) => ({ type: chunk.type, index })), decode };
}

/** A field of a decoded object, when it has the expected shape. */
export const field = (object: PackageValue | undefined, name: string): PackageValue | undefined =>
  object && typeof object === "object" && !Array.isArray(object) && "fields" in object ? object.fields[name] : undefined;
