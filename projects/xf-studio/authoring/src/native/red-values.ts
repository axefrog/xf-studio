/**
 * Property value decoding shared by CR2W files and embedded object packages. Pure. The two containers encode most values the same
 * way and differ in handles, references, strings, bitfields, nested objects and buffers; a `ValueContext` supplies those.
 * Encodings and sources: knowledge/archive-format.md §4.
 *
 * Every size and count comes from the file, so each is checked before it is used: a read never moves backwards or past its
 * window, a count never exceeds the bytes left (every value takes at least one byte), and decoded values are counted against the
 * resource's budget (limits.ts).
 */
import { doubleValue, float32Value } from "./json-numbers";
import type { DecodeSession } from "./limits";
import { NativeMalformedError, NativeUnsupportedError } from "./native-errors";
import { RedBuffer, type RedHandle, type RedObject } from "./red-model";
import { bitfieldMembers, kindOf, propertyType, sameType } from "./rtti";

export class Cursor {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array, public pos = 0, public end = bytes.length) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (!Number.isSafeInteger(pos) || !Number.isSafeInteger(end) || pos < 0 || end < pos || end > bytes.length)
      throw new NativeMalformedError(`A read window ${pos}..${end} lies outside ${bytes.length} bytes.`);
  }
  /** Bytes left before `end`. */
  get remaining() { return this.end - this.pos; }
  private need(n: number) {
    if (!Number.isSafeInteger(n) || n < 0) throw new NativeMalformedError(`A read of ${n} bytes is not a size.`);
    if (this.pos + n > this.end) throw new NativeMalformedError(`Read of ${n} bytes at ${this.pos} passes the end (${this.end}).`);
  }
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
  /** A u32 element count, refused when more elements than bytes remain (every encoded value takes at least one byte). */
  count(what: string) {
    const count = this.u32();
    if (count > this.remaining) throw new NativeMalformedError(`${what}: ${count} elements cannot fit in ${this.remaining} bytes.`);
    return count;
  }
}

const utf8 = new TextDecoder(), utf16 = new TextDecoder("utf-16le");

/**
 * CR2W's length-prefixed string: a signed variable-length count (first byte: bit 7 sign, bit 6 "more", bits 0-5 value; then
 * bit 7 "more" and 7 value bits per byte), negative for a UTF-8 byte count, positive for a UTF-16 unit count. The count is built
 * arithmetically (never wraps negative), takes at most four continuation bytes, and must fit in the bytes left.
 */
export function readVarString(cursor: Cursor): string {
  const first = cursor.u8();
  let value = first & 0x3f, scale = 64, more = (first & 0x40) !== 0, extra = 0;
  while (more) {
    if (++extra > 4) throw new NativeMalformedError("Malformed string length.");
    const next = cursor.u8();
    value += (next & 0x7f) * scale; scale *= 128; more = (next & 0x80) !== 0;
  }
  if (value === 0) return "";
  const bytes = first & 0x80 ? value : value * 2;
  if (bytes > cursor.remaining) throw new NativeMalformedError(`A string of ${bytes} bytes passes the end of its value.`);
  return first & 0x80 ? utf8.decode(cursor.take(bytes)) : utf16.decode(cursor.take(bytes));
}

/** What differs between the containers. */
export interface ValueContext {
  /** The budgets and notes of the resource being decoded. */
  readonly session: DecodeSession;
  name(index: number): string;
  /** A nested class or struct value of `type`. */
  object(cursor: Cursor, type: string): RedObject;
  handle(cursor: Cursor): RedHandle;
  /** An `rRef`/`raRef` value as JSON (`{DepotPath, Flags}`). */
  reference(cursor: Cursor): unknown;
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

/** A compiled decoder for one type string. */
type Decoder = (ctx: ValueContext, cursor: Cursor, owner: string) => unknown;
/** Compiled decoders by type string. Type strings come from files, so the cache is bounded (cleared when full). */
const decoders = new Map<string, Decoder>();
const MAX_DECODERS = 4096;

const unsupported = (type: string): Decoder => () => { throw new NativeUnsupportedError(`Values of type ${type} are not decoded.`); };

const FUNDAMENTALS: Record<string, Decoder> = {
  Bool: (_, c) => c.u8() ? 1 : 0,
  Int8: (_, c) => c.i8(), Uint8: (_, c) => c.u8(), Int16: (_, c) => c.i16(), Uint16: (_, c) => c.u16(), Int32: (_, c) => c.i32(), Uint32: (_, c) => c.u32(),
  Int64: (_, c) => c.i64().toString(), Uint64: (_, c) => c.u64().toString(),
  Float: (_, c) => float32Value(c.f32()), Double: (_, c) => doubleValue(c.f64()),
  CName: (ctx, c) => cname(ctx.name(c.u16())),
  String: (ctx, c) => ctx.string(c),
  NodeRef: (ctx, c) => ({ $type: "NodeRef", $storage: "string", $value: ctx.nodeRef(c) }),
  LocalizationString: (ctx, c) => { const unk1 = c.u64().toString(); return { unk1, value: ctx.string(c) }; },
  TweakDBID: (_, c) => ({ $type: "TweakDBID", $storage: "uint64", $value: c.u64().toString() }),
  CRUID: (_, c) => c.u64().toString(),
  gamedataLocKeyWrapper: (_, c) => { c.u64(); return {}; },
  CGUID: (_, c) => Buffer.from(c.take(16)).toString("base64"),
  CDateTime: (_, c) => { const value = c.u64(); return (value === 0n ? 1048576n : value & ~0x3ffn).toString(); },
  DataBuffer: (ctx, c, owner) => ctx.buffer(c, false, owner),
  serializationDeferredDataBuffer: (ctx, c, owner) => ctx.buffer(c, true, owner),
  SharedDataBuffer: (_, c) => { const size = c.u32(); const bytes = c.take(size); return new RedBuffer(0, size, () => bytes, null, true); },
  CVariant: (ctx, c, owner) => readVariant(ctx, c, owner),
  EditorObjectID: unsupported("EditorObjectID"), MessageResourcePath: unsupported("MessageResourcePath"),
  CRUIDRef: unsupported("CRUIDRef"), RuntimeEntityRef: unsupported("RuntimeEntityRef"),
};

function compile(type: string): Decoder {
  let match: RegExpExecArray | null;
  if ((match = /^array:(.+)$/.exec(type))) {
    const inner = decoderFor(match[1]!);
    return (ctx, cursor, owner) => {
      const count = cursor.count(type);
      ctx.session.nodes(count);
      const out: unknown[] = new Array(count);
      for (let i = 0; i < count; i++) out[i] = inner(ctx, cursor, owner);
      return out;
    };
  }
  if ((match = /^static:\d+,(.+)$/.exec(type)) || (match = /^\[\d+\](.+)$/.exec(type))) {
    const inner = decoderFor(match[1]!);
    return (ctx, cursor, owner) => {
      const count = cursor.count(type);
      ctx.session.nodes(count);
      const out: unknown[] = new Array(count);
      for (let i = 0; i < count; i++) out[i] = inner(ctx, cursor, owner);
      return { Elements: out };
    };
  }
  if (/^w?handle:/.test(type)) return (ctx, cursor) => ctx.handle(cursor);
  if (/^r(?:a)?Ref:/.test(type)) return (ctx, cursor) => ctx.reference(cursor);
  // Curves (`curveData:T`, `multiChannelCurve:T`) do not occur in the resource types this reader serves; they are refused.
  if (/^(?:curveData|multiChannelCurve):/.test(type)) return unsupported(type);
  const fundamental = FUNDAMENTALS[type];
  if (fundamental) return fundamental;
  const kind = kindOf(type);
  if (kind === "enum") return (ctx, cursor) => ctx.name(cursor.u16());
  if (kind === "bitfield") return (ctx, cursor) => bitfieldText(type, ctx.bitfield(cursor));
  // A class or struct; the context decides what to do with a type the RTTI slice does not know (packages refuse it).
  return (ctx, cursor) => ctx.object(cursor, type);
}

function decoderFor(type: string): Decoder {
  let decoder = decoders.get(type);
  if (!decoder) {
    decoder = compile(type);
    if (decoders.size >= MAX_DECODERS) decoders.clear();
    decoders.set(type, decoder);
  }
  return decoder;
}

/** Decode one value of `type` (a type string such as `array:handle:meshMeshAppearance`). */
export function readValue(ctx: ValueContext, cursor: Cursor, type: string, owner: string): unknown {
  ctx.session.nodes(1);
  return decoderFor(type)(ctx, cursor, owner);
}

function readVariant(ctx: ValueContext, cursor: Cursor, owner: string): unknown {
  const type = ctx.name(cursor.u16());
  const start = cursor.pos, size = cursor.u32();
  if (size <= 4) return null;
  if (start + size > cursor.end) throw new NativeMalformedError(`CVariant of ${type} claims ${size} bytes, past the end of its value.`);
  const inner = new Cursor(cursor.bytes, cursor.pos, start + size);
  const value = readValue(ctx, inner, type, owner);
  if (inner.pos !== start + size) throw new NativeMalformedError(`CVariant of ${type} read ${inner.pos - start} of ${size} bytes.`);
  cursor.pos = inner.pos;
  return { $type: type, Value: value };
}

/**
 * Record a property stored with a type the RTTI slice disagrees with (a mod's `castShadows` stored as `Bool` where the RTTI has
 * `shadowsShadowCastingMode`). The value is still decoded by the stored type; the note lets a consumer say so.
 */
export function noteStoredType(session: DecodeSession, className: string, property: string, stored: string): void {
  const rtti = propertyType(className, property);
  if (rtti !== null && !sameType(stored, rtti)) session.typeMismatch(`${className}.${property}`, stored, rtti);
}

/** Test hook: how many compiled decoders the bounded cache holds. */
export const decoderCacheSize = () => decoders.size;
