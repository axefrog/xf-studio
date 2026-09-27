/**
 * The one object-package reader (research/save/save-editor-design.md §5.1, §8.2): the frame every REDengine object package shares, and a
 * generic, type-oracle-driven value decoder for the self-describing packages of a save. Pure and bounded.
 *
 * Header, byte-packed [source: WolvenKit `RedPackageReader.File.cs` at 11720772, studied only; knowledge/archive-format.md §5.3]: u8
 * version (4), u8 layout, u16 section count (7 with a reference pool, else 6), u32 root count, [u32 reference descriptor offset, u32
 * reference data offset], u32 name descriptor offset, u32 name data offset, u32 chunk descriptor offset, u32 chunk data offset, then per
 * variant:
 * - `resource` (`compiledData` of `.ent` and `.app` files): i16 root index, u16 CRUID count, CRUIDs;
 * - `save` (`ScriptableSystemsContainer`): u32 CRUID count, CRUIDs;
 * - `save-plain` (the native-system packages: `StatsSystem`, `tierSystem` …): nothing.
 * Section offsets count from the end of that part. Names are u32 descriptors (bits 0–23 offset, 24–31 size with the NUL); references
 * u32 descriptors (bits 0–22 offset, 23–30 size, 31 "sync"); chunks (u32 type name index, u32 offset). An object is a u16 field count,
 * then (u16 name index, u16 type index, u32 offset from the object's start) per field, then the values in table order.
 *
 * The frame is shared: native/red-package.ts decodes resource packages through it with the RTTI and its refusal policy (a type the RTTI
 * doesn't know as a class is refused); `decodeChunk` here decodes save packages generically, asking the type oracle only which named
 * types are enums or bitfields, and keeping anything it can't read opaque but bounded by the next field's offset.
 *
 * Strictness, so a hostile file can't make one value decode many times: tables are capped (`MAX_NAMES`, `MAX_CHUNKS`) and names are
 * decoded only when used; sections lie in order inside the package; a chunk ends where the next one starts; within an object the first
 * value starts right after the field table, offsets strictly increase and each value ends exactly where the next begins; counts can't
 * exceed the bytes left; nesting and decoded values are capped.
 */

export type PackageVariant = "resource" | "save" | "save-plain";
export class PackageFrameError extends Error {
  override name = "PackageFrameError";
  constructor(message: string, readonly kind: "malformed" | "unsupported" | "limit") { super(message); }
}

/** Names a package may list (fields index them by a u16) and chunks it may hold (far above any save's script data; CORE-92). */
export const MAX_NAMES = 65_536, MAX_CHUNKS = 65_536;
const MAX_DEPTH = 32, MAX_VALUES = 1_000_000;

export type PackageReference = { readonly offset: number; readonly length: number; readonly sync: boolean };
export type PackageFrame = {
  readonly variant: PackageVariant;
  readonly version: number;
  readonly layout: number;
  readonly sections: number;
  readonly rootCount: number;
  /** The resource variant's root index (-1 elsewhere). */
  readonly rootIndex: number;
  readonly cruids: readonly bigint[];
  readonly bytes: Uint8Array;
  readonly view: DataView;
  /** Where section offsets count from, and the package's size from there. */
  readonly base: number;
  readonly size: number;
  readonly offsets: { readonly refDesc: number; readonly refData: number; readonly nameDesc: number; readonly nameData: number; readonly chunkDesc: number; readonly chunkData: number };
  readonly nameCount: number;
  readonly referenceCount: number;
  /** A name by index, decoded once when first used. */
  name(index: number): string;
  /** A name's stored length (without the NUL), for a caller's accounting. */
  nameLength(index: number): number;
  reference(index: number): PackageReference & { readonly data: Uint8Array };
  /** The chunks: type name, and where the object starts and ends (absolute in `bytes`). */
  readonly chunks: readonly { readonly type: string; readonly start: number; readonly end: number }[];
};

const utf8 = new TextDecoder("utf-8", { fatal: false });
const malformed = (message: string) => new PackageFrameError(message, "malformed");

/** Read a package's frame. Throws `PackageFrameError` when the bytes are not a package of `variant`. */
export function readPackageFrame(bytes: Uint8Array, variant: PackageVariant): PackageFrame {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 24) throw malformed("The package is truncated.");
  const u32 = (at: number) => { if (at + 4 > bytes.length) throw malformed("The package is truncated."); return view.getUint32(at, true); };
  const version = bytes[0]!, layout = bytes[1]!;
  if (version !== 4) throw new PackageFrameError(`Package version ${version} is not read.`, "unsupported");
  const sections = view.getUint16(2, true);
  if (sections !== 6 && sections !== 7) throw new PackageFrameError(`A package with ${sections} sections is not read.`, "unsupported");
  const rootCount = view.getUint32(4, true);
  let pos = 8, refDesc = 0, refData = 0;
  if (sections === 7) { refDesc = u32(pos); refData = u32(pos + 4); pos += 8; }
  const nameDesc = u32(pos), nameData = u32(pos + 4), chunkDesc = u32(pos + 8), chunkData = u32(pos + 12);
  pos += 16;
  let rootIndex = -1, cruidCount = 0;
  if (variant === "resource") {
    if (pos + 4 > bytes.length) throw malformed("The package is truncated.");
    rootIndex = view.getInt16(pos, true); cruidCount = view.getUint16(pos + 2, true); pos += 4;
  } else if (variant === "save") { cruidCount = u32(pos); pos += 4; }
  if (cruidCount > (bytes.length - pos) / 8) throw malformed(`${cruidCount} CRUIDs cannot fit in the package.`);
  const cruids: bigint[] = [];
  for (let i = 0; i < cruidCount; i++) cruids.push(view.getBigUint64(pos + i * 8, true));
  const base = pos + cruidCount * 8, size = bytes.length - base;
  const order = sections === 7 ? [refDesc, refData, nameDesc, nameData, chunkDesc, chunkData] : [nameDesc, nameData, chunkDesc, chunkData];
  for (let i = 1; i < order.length; i++) if (order[i]! < order[i - 1]!) throw malformed("The package's sections are out of order.");
  if (chunkData > size) throw malformed("The package's sections lie outside the package.");
  if ((nameData - nameDesc) % 4 || (refData - refDesc) % 4 || (chunkData - chunkDesc) % 8) throw malformed("A package table is not a whole number of entries.");
  // Bounded before anything is decoded (CORE-92): a field names its name and type by a u16, so more names than that can never be used.
  const nameCount = (nameData - nameDesc) / 4, chunkCount = (chunkData - chunkDesc) / 8, referenceCount = (refData - refDesc) / 4;
  if (nameCount > MAX_NAMES) throw new PackageFrameError(`A package with ${nameCount} names is not read.`, "limit");
  // A save's packages are capped here; a resource package's chunks are counted against its decode session's budget instead.
  if (variant !== "resource" && chunkCount > MAX_CHUNKS) throw new PackageFrameError(`A package with ${chunkCount} chunks is not read.`, "limit");
  const names = new Map<number, string>();
  const nameSpan = (index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= nameCount) throw malformed(`Package name ${index} doesn't exist.`);
    const d = view.getUint32(base + nameDesc + index * 4, true), offset = d & 0xffffff, length = Math.max(0, (d >>> 24) - 1);
    if (offset + length > size) throw malformed("A package name lies outside the package.");
    return { offset, length };
  };
  const name = (index: number) => {
    const known = names.get(index);
    if (known !== undefined) return known;
    const span = nameSpan(index);
    const value = utf8.decode(bytes.subarray(base + span.offset, base + span.offset + span.length));
    names.set(index, value);
    return value;
  };
  const reference = (index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= referenceCount) throw malformed(`Package reference ${index} doesn't exist.`);
    const d = view.getUint32(base + refDesc + index * 4, true), offset = d & 0x7fffff, length = (d >>> 23) & 0xff, sync = (d >>> 31) === 1;
    if (offset + length > size) throw malformed("A package reference lies outside the package.");
    return { offset, length, sync, data: bytes.subarray(base + offset, base + offset + length) };
  };
  const chunks: { type: string; start: number; end: number }[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const at = base + chunkDesc + i * 8;
    chunks.push({ type: name(view.getUint32(at, true)), start: base + view.getUint32(at + 4, true), end: bytes.length });
  }
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!, next = chunks[i + 1];
    if (chunk.start < base + chunkData || chunk.start >= bytes.length) throw malformed(`Package chunk ${i} starts outside the chunk data.`);
    if (next) { if (next.start <= chunk.start) throw malformed(`Package chunk ${i + 1} does not follow chunk ${i}.`); chunk.end = next.start; }
  }
  return { variant, version, layout, sections, rootCount, rootIndex, cruids, bytes, view, base, size,
    offsets: { refDesc, refData, nameDesc, nameData, chunkDesc, chunkData }, nameCount, referenceCount, name,
    nameLength: index => nameSpan(index).length, reference, chunks };
}

/**
 * A save node's package, if its bytes are one (a u32 package size, the package, optional trailing bytes): the `save` variant (with a
 * CRUID list) first, then `save-plain`. Decided by the structure alone, and strictly: the first chunk must start exactly at the chunk
 * data. Returns null when neither fits.
 */
export function detectSavePackage(body: Uint8Array): { frame: PackageFrame; trailing: number } | null {
  if (body.length < 28) return null;
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength), size = view.getUint32(0, true);
  if (size < 24 || size > body.length - 4 || body[4] !== 4) return null;
  const bytes = body.subarray(4, 4 + size);
  for (const variant of ["save", "save-plain"] as const) {
    try {
      const frame = readPackageFrame(bytes, variant);
      const first = frame.chunks[0];
      if (first && first.start !== frame.base + frame.offsets.chunkData) continue;
      if (frame.offsets[frame.sections === 7 ? "refDesc" : "nameDesc"] !== 0) continue;
      return { frame, trailing: body.length - 4 - size };
    } catch { /* not this variant */ }
  }
  return null;
}

// ---- The generic decoder for save packages ----

export type PackageValue = number | string | boolean | null | PackageObject | PackageHandle | PackageOpaque | PackageValue[];
/** A decoded object; `types` (with `fieldTypes: true`) gives each field's stored type name. */
export type PackageObject = { readonly $type: string; readonly fields: Readonly<Record<string, PackageValue>>; readonly types?: Readonly<Record<string, string>> };
export type PackageHandle = { readonly $handle: number };
/** A value the decoder kept opaque (with `opaque: true`): its stored type, byte count and why. */
export type PackageOpaque = { readonly $opaque: string; readonly bytes: number; readonly at: number };
/** Which named types are enums or bitfields: a type oracle, or a plain set of enum names. */
export type PackageTypes = { isEnum(name: string): boolean; isBitfield?(name: string): boolean } | ReadonlySet<string>;
export type DecodeOptions = {
  /** Keep unread values as `PackageOpaque` instead of null (the explorer shows their size). */
  readonly opaque?: boolean;
  /** Record each object's field types (`PackageObject.types`). */
  readonly fieldTypes?: boolean;
};

const FIXED: Readonly<Record<string, [size: number, read: (view: DataView, at: number) => number | string | boolean]>> = {
  Bool: [1, (v, at) => v.getUint8(at) !== 0], Int8: [1, (v, at) => v.getInt8(at)], Uint8: [1, (v, at) => v.getUint8(at)],
  Int16: [2, (v, at) => v.getInt16(at, true)], Uint16: [2, (v, at) => v.getUint16(at, true)],
  Int32: [4, (v, at) => v.getInt32(at, true)], Uint32: [4, (v, at) => v.getUint32(at, true)], Float: [4, (v, at) => v.getFloat32(at, true)],
  Int64: [8, (v, at) => v.getBigInt64(at, true).toString()], Uint64: [8, (v, at) => v.getBigUint64(at, true).toString()],
  Double: [8, (v, at) => v.getFloat64(at, true)], CRUID: [8, (v, at) => v.getBigUint64(at, true).toString()],
  /** A TweakDBID as its u64 (CRC-32 of the name and the name's length in the next byte), in decimal. */
  TweakDBID: [8, (v, at) => v.getBigUint64(at, true).toString()],
};
/** Types whose layout isn't a field table and isn't read here (kept opaque). */
const OPAQUE = /^(static:|\[|r(?:a)?Ref:|curveData:|multiChannelCurve:)|^(NodeRef|LocalizationString|CGUID|DataBuffer|CVariant|serializationDeferredDataBuffer|SharedDataBuffer)$/;

/**
 * Decode one chunk of a save package. `types` answers which named types are enums (read as their member names) and bitfields (member
 * name lists); everything else with a field table is a class or struct. A field of a type not read is skipped by the next field's
 * offset; one that can't be skipped that way (the last field of an array element) makes the element, and so the field holding it,
 * unreadable. `skipped` lists every such field as `owner.field: type`.
 */
export function decodeChunk(frame: PackageFrame, index: number, types: PackageTypes, options: DecodeOptions = {}): { object: PackageObject; skipped: string[] } {
  const { bytes, view } = frame, name = frame.name;
  const chunk = frame.chunks[index];
  if (!chunk) throw malformed(`Package chunk ${index} doesn't exist.`);
  const isEnum = "has" in types ? (type: string) => types.has(type) : (type: string) => types.isEnum(type);
  const isBitfield = "has" in types ? () => false : (type: string) => types.isBitfield?.(type) ?? false;
  const skipped: string[] = [];
  let values = 0;
  const past = (owner: string) => malformed(`${owner} passes the end of its object.`);
  /** One value of `type` at `at`, within `end`; returns the value and where it ends, or null when the type isn't read. */
  const value = (type: string, at: number, end: number, exact: boolean, depth: number, owner: string): [PackageValue, number] | null => {
    if (++values > MAX_VALUES) throw malformed("The package holds more values than a save's script data can.");
    const fixed = FIXED[type];
    if (fixed) {
      if (at + fixed[0] > end) throw past(owner);
      return [fixed[1](view, at), at + fixed[0]];
    }
    if (type === "CName" || isEnum(type)) {
      if (at + 2 > end) throw past(owner);
      return [name(view.getUint16(at, true)), at + 2];
    }
    if (isBitfield(type)) {
      if (at + 1 > end) throw past(owner);
      const count = view.getUint8(at);
      if (at + 1 + count * 2 > end) throw past(owner);
      return [Array.from({ length: count }, (_, i) => name(view.getUint16(at + 1 + i * 2, true))), at + 1 + count * 2];
    }
    if (type === "String") {
      if (at + 2 > end) throw past(owner);
      const length = view.getUint16(at, true);
      if (at + 2 + length > end) throw past(owner);
      return [utf8.decode(bytes.subarray(at + 2, at + 2 + length)), at + 2 + length];
    }
    if (/^w?handle:/.test(type)) {
      if (at + 4 > end) throw past(owner);
      return [{ $handle: view.getInt32(at, true) }, at + 4];
    }
    if (type.startsWith("array:")) {
      if (at + 4 > end) throw past(owner);
      const count = view.getUint32(at, true), inner = type.slice(6);
      if (count > end - at - 4) throw malformed(`${owner}: ${count} elements cannot fit.`);
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
    if (OPAQUE.test(type)) return null;
    return object(type, at, end, exact, depth + 1, owner);
  };
  const object = (type: string, at: number, end: number, exact: boolean, depth: number, owner: string): [PackageObject, number] | null => {
    if (depth > MAX_DEPTH) throw malformed("The package nests objects deeper than a save's script data does.");
    if (at + 2 > end) throw malformed(`${owner} passes the end of its chunk.`);
    const count = view.getUint16(at, true);
    if (at + 2 + count * 8 > end) throw malformed(`${owner}: ${count} fields cannot fit.`);
    const fields: Record<string, PackageValue> = {}, fieldTypes: Record<string, string> = {};
    let expected = 2 + count * 8, finish = at + expected;
    for (let i = 0; i < count; i++) {
      const entry = at + 2 + i * 8;
      const field = name(view.getUint16(entry, true)), fieldType = name(view.getUint16(entry + 2, true)), offset = view.getUint32(entry + 4, true);
      if (offset !== expected) throw malformed(`${owner}.${field}: value at ${offset}, expected ${expected}.`);
      const nextOffset = i + 1 < count ? view.getUint32(at + 2 + (i + 1) * 8 + 4, true) : null;
      if (nextOffset !== null && nextOffset <= offset) throw malformed(`${owner}: field offsets don't increase.`);
      const valueEnd = nextOffset !== null ? at + nextOffset : end;
      if (valueEnd > end) throw malformed(`${owner}.${field} passes the end of its object.`);
      if (options.fieldTypes) fieldTypes[field] = fieldType;
      const read = value(fieldType, at + offset, valueEnd, nextOffset !== null || exact, depth, `${owner}.${field}`);
      if (read) {
        if (nextOffset !== null && read[1] !== valueEnd) throw malformed(`${owner}.${field} (${fieldType}) used ${read[1] - at - offset} of ${valueEnd - at - offset} bytes.`);
        fields[field] = read[0];
        finish = read[1];
        expected = read[1] - at;
      } else {
        // Skipped by the next field's offset; the last field only when the object's own end is known.
        skipped.push(`${owner}.${field}: ${fieldType}`);
        if (nextOffset === null && !exact) return null;
        const stop = nextOffset === null ? end : valueEnd;
        fields[field] = options.opaque ? { $opaque: fieldType, bytes: stop - at - offset, at: at + offset } : null;
        if (nextOffset === null) { finish = end; break; }
        finish = valueEnd;
        expected = nextOffset;
      }
    }
    return [options.fieldTypes ? { $type: type, fields, types: fieldTypes } : { $type: type, fields }, finish];
  };
  const found = object(chunk.type, chunk.start, chunk.end, true, 1, chunk.type);
  if (!found) throw malformed(`${chunk.type} could not be read.`);
  return { object: found[0], skipped };
}

/** A field of a decoded object, when it has the expected shape. */
export const field = (object: PackageValue | undefined, name: string): PackageValue | undefined =>
  object && typeof object === "object" && !Array.isArray(object) && "fields" in object ? object.fields[name] : undefined;

/** Every name the package's objects spell out (class, field and type names), as candidate names for hashes elsewhere in the save. */
export function packageNames(frame: PackageFrame): string[] {
  const out: string[] = [];
  for (let i = 0; i < frame.nameCount; i++) { try { out.push(frame.name(i)); } catch { /* a broken name is no candidate */ } }
  return out;
}
