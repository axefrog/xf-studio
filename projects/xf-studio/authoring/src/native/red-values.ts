/**
 * Property value decoding shared by CR2W files and embedded object packages. Pure. The two containers encode most values the same
 * way and differ in handles, references, strings, bitfields, nested objects and buffers; a `ValueContext` supplies those.
 * Encodings and sources: knowledge/archive-format.md §4.
 */
import { doubleValue, float32Value } from "./json-numbers";
import { NativeUnsupportedError, RedBuffer, type RedHandle, type RedObject } from "./red-model";
import { bitfieldMembers, kindOf } from "./rtti";

export class Cursor {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array, public pos = 0, public end = bytes.length) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  private need(n: number) { if (this.pos + n > this.end) throw new RangeError(`Read of ${n} bytes at ${this.pos} passes the end (${this.end}).`); }
  u8() { this.need(1); return this.view.getUint8(this.pos++); }
  i8() { this.need(1); return this.view.getInt8(this.pos++); }
  u16() { this.need(2); const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  i16() { this.need(2); const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  u32() { this.need(4); const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  i32() { this.need(4); const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  u64() { this.need(8); const v = this.view.getBigUint64(this.pos, true); this.pos += 8; return v; }
  i64() { this.need(8); const v = this.view.getBigInt64(this.pos, true); this.pos += 8; return v; }
  f32() { this.need(4); const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  f64() { this.need(8); const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }
  take(n: number) { this.need(n); const v = this.bytes.subarray(this.pos, this.pos + n); this.pos += n; return v; }
}

const utf8 = new TextDecoder();

/**
 * CR2W's length-prefixed string: a signed variable-length count (first byte: bit 7 sign, bit 6 "more", bits 0-5 value; then
 * bit 7 "more" and 7 value bits per byte), negative for a UTF-8 byte count, positive for a UTF-16 unit count.
 */
export function readVarString(cursor: Cursor): string {
  const first = cursor.u8();
  let value = first & 0x3f, shift = 6, more = (first & 0x40) !== 0;
  while (more) {
    const next = cursor.u8();
    value |= (next & 0x7f) << shift; shift += 7; more = (next & 0x80) !== 0;
    if (shift > 34) throw new RangeError("Malformed string length.");
  }
  if (value === 0) return "";
  if (first & 0x80) return utf8.decode(cursor.take(value));
  return new TextDecoder("utf-16le").decode(cursor.take(value * 2));
}

/** What differs between the containers. */
export interface ValueContext {
  name(index: number): string;
  /** A nested class or struct value of `type`. */
  object(cursor: Cursor, type: string): RedObject;
  handle(cursor: Cursor): RedHandle;
  /** An `rRef`/`raRef` value as JSON (`{DepotPath, Flags}`). */
  reference(cursor: Cursor, async: boolean): unknown;
  string(cursor: Cursor): string;
  nodeRef(cursor: Cursor): string;
  /** A bitfield's set member names, in file order. */
  bitfield(cursor: Cursor): string[];
  /** `DataBuffer` and `serializationDeferredDataBuffer` values; `owner` is `Class.property` (which buffers are parsed). */
  buffer(cursor: Cursor, deferred: boolean, owner: string): RedBuffer | null;
}

/** Import flags (`EImportFlags`) as the reference JSON names them: the flag set, or "Default" when none is set. */
const IMPORT_FLAGS: [number, string][] = [[1, "Obligatory"], [2, "Template"], [4, "Soft"], [8, "Embedded"], [16, "Inplace"]];
export const importFlagsText = (flags: number) => IMPORT_FLAGS.filter(([bit]) => flags & bit).map(([, name]) => name).join(", ") || "Default";

/**
 * Depot path text as the reference JSON shows it: trimmed of quotes, slashes, spaces and line breaks at both ends, lower-cased,
 * `/` turned into `\` and repeated separators collapsed [source: knowledge/archive-format.md §6].
 */
export function normalizedPath(path: string): string {
  return path.replace(/^['"/\\ \r\n]+|['"/\\ \r\n]+$/g, "").toLowerCase().replace(/[/\\]+/g, "\\");
}

export const emptyReference = (async: boolean) => ({ DepotPath: { $type: "ResourcePath", $storage: "uint64", $value: "0" }, Flags: async ? "Soft" : "Default" });

export const cname = (value: string) => ({ $type: "CName", $storage: "string", $value: value || "None" });

/** Bitfield text as the reference JSON writes it: names in ascending bit order joined by ", ", or "0" when none is set. */
export function bitfieldText(type: string, names: readonly string[]): string {
  if (!names.length) return "0";
  const bits = new Map(bitfieldMembers(type));
  return [...names].sort((a, b) => (bits.get(a) ?? 64) - (bits.get(b) ?? 64)).join(", ");
}

/** Decode one value of `type` (a type string such as `array:handle:meshMeshAppearance`). */
export function readValue(ctx: ValueContext, cursor: Cursor, type: string, owner: string): unknown {
  let match: RegExpExecArray | null;
  if ((match = /^array:(.+)$/.exec(type))) {
    const count = cursor.u32();
    const inner = match[1]!;
    const out: unknown[] = new Array(count);
    for (let i = 0; i < count; i++) out[i] = readValue(ctx, cursor, inner, owner);
    return out;
  }
  if ((match = /^static:\d+,(.+)$/.exec(type)) || (match = /^\[\d+\](.+)$/.exec(type))) {
    const count = cursor.u32();
    const out: unknown[] = new Array(count);
    for (let i = 0; i < count; i++) out[i] = readValue(ctx, cursor, match[1]!, owner);
    return { Elements: out };
  }
  if (/^w?handle:/.test(type)) return ctx.handle(cursor);
  if (/^rRef:/.test(type)) return ctx.reference(cursor, false);
  if (/^raRef:/.test(type)) return ctx.reference(cursor, true);
  // Curves (`curveData:T`, `multiChannelCurve:T`) do not occur in the resource types this reader serves; they are refused.
  if (/^(?:curveData|multiChannelCurve):/.test(type)) throw new NativeUnsupportedError(`Values of type ${type} are not decoded.`);
  switch (type) {
    case "Bool": return cursor.u8() ? 1 : 0;
    case "Int8": return cursor.i8();
    case "Uint8": return cursor.u8();
    case "Int16": return cursor.i16();
    case "Uint16": return cursor.u16();
    case "Int32": return cursor.i32();
    case "Uint32": return cursor.u32();
    case "Int64": return cursor.i64().toString();
    case "Uint64": return cursor.u64().toString();
    case "Float": return float32Value(cursor.f32());
    case "Double": return doubleValue(cursor.f64());
    case "CName": return cname(ctx.name(cursor.u16()));
    case "String": return ctx.string(cursor);
    case "NodeRef": return { $type: "NodeRef", $storage: "string", $value: ctx.nodeRef(cursor) };
    case "LocalizationString": { const unk1 = cursor.u64().toString(); return { unk1, value: ctx.string(cursor) }; }
    case "TweakDBID": return { $type: "TweakDBID", $storage: "uint64", $value: cursor.u64().toString() };
    case "CRUID": return cursor.u64().toString();
    case "gamedataLocKeyWrapper": cursor.u64(); return {};
    case "CGUID": return Buffer.from(cursor.take(16)).toString("base64");
    case "CDateTime": { const value = cursor.u64(); return (value === 0n ? 1048576n : value & ~0x3ffn).toString(); }
    case "DataBuffer": return ctx.buffer(cursor, false, owner);
    case "serializationDeferredDataBuffer": return ctx.buffer(cursor, true, owner);
    case "SharedDataBuffer": { const size = cursor.u32(); const bytes = cursor.take(size); return new RedBuffer(0, size, () => bytes, null, true); }
    case "CVariant": return readVariant(ctx, cursor, owner);
    case "EditorObjectID": case "MessageResourcePath": case "CRUIDRef": case "RuntimeEntityRef":
      throw new NativeUnsupportedError(`Values of type ${type} are not decoded.`);
  }
  const kind = kindOf(type);
  if (kind === "enum") return ctx.name(cursor.u16());
  if (kind === "bitfield") return bitfieldText(type, ctx.bitfield(cursor));
  return ctx.object(cursor, type);
}

function readVariant(ctx: ValueContext, cursor: Cursor, owner: string): unknown {
  const type = ctx.name(cursor.u16());
  const start = cursor.pos, size = cursor.u32();
  if (size <= 4) return null;
  const value = readValue(ctx, cursor, type, owner);
  if (cursor.pos !== start + size) throw new RangeError(`CVariant of ${type} read ${cursor.pos - start} of ${size} bytes.`);
  return { $type: type, Value: value };
}
