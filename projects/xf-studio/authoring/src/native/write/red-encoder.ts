/**
 * Value encoding for the native resource writer: WolvenKit-shaped JSON (WKitJsonVersion 0.0.9) to the bytes of a CR2W file or an
 * embedded object package. Pure. The inverse of red-values.ts; the encodings are those of knowledge/archive-format.md §3–5.
 *
 * Which properties an object writes, and in which order, is WolvenKit 9.0.1's rule, from its generated classes (`writer-classes.json`,
 * made by tools/native-writer-classes.ps1): each class's properties in WolvenKit's write order with their types; a property is left
 * out when it equals the class's default instance, except in the classes that write every property (`sd`: vectors, quaternions,
 * boxes, colours and a few more). Equality is WolvenKit's JSON compared value by value (floats as float32). [source: WolvenKit's
 * generated classes; resource: its `convert deserialize` output compared byte for byte in tests/native-writer.test.ts.] Anything this
 * writer can't encode exactly is refused (`NativeWriteRefusal`), and the caller converts that file with WolvenKit instead.
 */
import { bitfieldMembers, enumMembers, kindOf } from "../rtti";
import writerClasses from "./writer-classes.json";
import type { ByteWriter } from "./byte-writer";

// WolvenKit JSON is untyped here.
export type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The writer won't encode this input exactly; the caller falls back to WolvenKit for the file. */
export class NativeWriteRefusal extends Error {
  override name = "NativeWriteRefusal";
}

type ClassEntry = { sd: number; props: [string, string][]; defaults?: Record<string, Json> };
const CLASSES = (writerClasses as unknown as { classes: Record<string, ClassEntry> }).classes;
/** Where the class table came from (for the Build's record). */
export const WRITER_CLASSES_SOURCE = (writerClasses as unknown as { source: string }).source;

/** Properties WolvenKit's JSON derives from other data (they are written by the class's own rule, never as properties). */
const DERIVED: Record<string, readonly string[]> = {
  CMaterialInstance: ["values", "metadata"],
  meshMeshMaterialBuffer: ["materials"],
  appearanceAppearanceDefinition: ["components"],
};

/** A class's table entry, or a refusal when WolvenKit's classes (as generated) don't include it. */
function classEntry(className: string): ClassEntry {
  const entry = Object.hasOwn(CLASSES, className) ? CLASSES[className] : undefined;
  if (!entry || !entry.defaults) throw new NativeWriteRefusal(`The writer's class table doesn't know ${className}.`);
  return entry;
}

/** A class's properties in write order, with their types. */
export function writeOrder(className: string): readonly (readonly [string, string])[] { return classEntry(className).props; }

const isObject = (value: unknown): value is Record<string, Json> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Bitfield text as a set of member names. */
const bitSet = (text: string) => text === "0" || text === "" ? "" : text.split(",").map(part => part.trim()).sort().join(",");

const hasOnly = (value: Record<string, Json>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));

/** Deep equality of two WolvenKit JSON values of `type` (numbers as float32 or integers, bitfields as sets). */
function sameJson(a: Json, b: Json, type: string): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a === "number" && typeof b === "number") return type === "Float" ? Math.fround(a) === Math.fround(b) : a === b;
  if (typeof a === "string" && typeof b === "string") return kindOf(type) === "bitfield" ? bitSet(a) === bitSet(b) : false;
  if ((typeof a === "number" && typeof b === "string") || (typeof a === "string" && typeof b === "number")) return String(a) === String(b);
  let match: RegExpExecArray | null;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    const inner = (match = /^array:(.+)$/.exec(type)) ? match[1]! : "";
    return a.every((item, i) => sameJson(item, b[i], inner));
  }
  if (!isObject(a) || !isObject(b)) return false;
  // A wrapper with a key it shouldn't have is never the default, so the writer encodes it and refuses it (NATIVE-73).
  if ((match = /^static:\d+,(.+)$/.exec(type)))
    return hasOnly(a, ["Elements"]) && hasOnly(b, ["Elements"]) && sameJson(a.Elements, b.Elements, `array:${match[1]}`);
  if (/^ra?Ref:/.test(type)) {
    if (!hasOnly(a, ["DepotPath", "Flags"]) || !hasOnly(b, ["DepotPath", "Flags"])) return false;
    const empty = (value: Json) => value.DepotPath?.$value === "0" || value.DepotPath?.$value === 0;
    const pathA = empty(a) ? "" : String(a.DepotPath?.$value ?? ""), pathB = empty(b) ? "" : String(b.DepotPath?.$value ?? "");
    return pathA === pathB && (a.Flags ?? "Default") === (b.Flags ?? "Default");
  }
  if (type === "CName" || type === "NodeRef" || type === "TweakDBID")
    return hasOnly(a, ["$type", "$storage", "$value"]) && hasOnly(b, ["$type", "$storage", "$value"]) && String(a.$value) === String(b.$value);
  if (/^w?handle:/.test(type) || type === "DataBuffer" || type === "serializationDeferredDataBuffer") return false; // only null is default
  // A class or struct: every property equal (missing ones read as the class default).
  const className = typeof a.$type === "string" ? a.$type : typeof b.$type === "string" ? b.$type : type;
  if (typeof a.$type === "string" && typeof b.$type === "string" && a.$type !== b.$type) return false;
  if (hasDerivedData(a) || hasDerivedData(b)) return false;
  const entry = classEntry(className);
  // A key the class doesn't have makes it no default, so it is written, and refused there (NATIVE-73).
  const keys = ["$type", ...entry.props.map(([name]) => name), ...DERIVED[className] ?? []];
  if (!hasOnly(a, keys) || !hasOnly(b, keys)) return false;
  for (const [name, propType] of entry.props) {
    const fallback = entry.defaults![name];
    if (!sameJson(name in a ? a[name] : fallback, name in b ? b[name] : fallback, propType)) return false;
  }
  return true;
}

/** Derived data (a material buffer's materials, an appearance's components) is written as stored properties, so it is never default. */
function hasDerivedData(value: Json): boolean {
  if (!isObject(value) || typeof value.$type !== "string") return false;
  return (DERIVED[value.$type] ?? []).some(name => Array.isArray(value[name]) && value[name].length > 0);
}

/** Whether `className.name` holds its default (then WolvenKit leaves it out, unless the class writes every property). */
export function isDefaultProperty(className: string, name: string, type: string, value: Json): boolean {
  const entry = classEntry(className);
  if (!Object.hasOwn(entry.defaults!, name)) throw new NativeWriteRefusal(`${className}.${name} has no known default.`);
  return sameJson(value, entry.defaults![name], type);
}

/** What differs between a CR2W file and an object package. */
export interface EncodeContext {
  /** The index of a name, adding it in first-use order. */
  name(value: string): number;
  handle(out: ByteWriter, value: Json, type: string, owner: string): void;
  reference(out: ByteWriter, value: Json, type: string): void;
  string(out: ByteWriter, value: string): void;
  bitfield(out: ByteWriter, names: readonly string[]): void;
  buffer(out: ByteWriter, value: Json, deferred: boolean, owner: string): void;
  /** A nested struct value (not a handle target). */
  struct(out: ByteWriter, type: string, value: Json, owner: string): void;
}

const INT_RANGES: Record<string, [number, number]> = {
  Int8: [-128, 127], Uint8: [0, 255], Int16: [-32768, 32767], Uint16: [0, 65535], Int32: [-2147483648, 2147483647], Uint32: [0, 4294967295],
};

function integer(type: string, value: Json): number {
  const [min, max] = INT_RANGES[type]!;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new NativeWriteRefusal(`${JSON.stringify(value)} is not a ${type}.`);
  return value;
}

const BIG_RANGES: Record<string, [bigint, bigint]> = {
  Int64: [-(1n << 63n), (1n << 63n) - 1n], Uint64: [0n, (1n << 64n) - 1n], CRUID: [0n, (1n << 64n) - 1n],
};

/** A 64-bit integer of `type`, refused outside its range rather than wrapped (NATIVE-73). */
function bigint(type: string, value: Json): bigint {
  let parsed: bigint | null = null;
  if (typeof value === "string" && /^-?\d+$/.test(value)) parsed = BigInt(value);
  else if (typeof value === "number" && Number.isSafeInteger(value)) parsed = BigInt(value);
  const [min, max] = BIG_RANGES[type]!;
  if (parsed === null || parsed < min || parsed > max) throw new NativeWriteRefusal(`${JSON.stringify(value)} is not a ${type}.`);
  return parsed;
}

/** Refuse keys a JSON wrapper (a handle, reference, name, buffer, fixed array) doesn't have: nothing in the input is ignored (NATIVE-73). */
export function onlyKeys(value: Json, allowed: readonly string[], owner: string): void {
  if (!isObject(value)) return;
  const extra = Object.keys(value).find(key => !allowed.includes(key));
  if (extra !== undefined) throw new NativeWriteRefusal(`${owner}: ${extra} is not a key the writer knows here.`);
}

/** The CName text of a JSON name value. */
export function cnameText(value: Json): string {
  if (!isObject(value) || value.$type !== "CName") throw new NativeWriteRefusal("A CName value is not a CName object.");
  if (value.$storage !== "string" || typeof value.$value !== "string") throw new NativeWriteRefusal("A CName stored as a hash is not written.");
  onlyKeys(value, ["$type", "$storage", "$value"], "A CName");
  return value.$value;
}

/** Encode one value of `type`. */
export function writeValue(ctx: EncodeContext, out: ByteWriter, type: string, value: Json, owner: string): void {
  let match: RegExpExecArray | null;
  if ((match = /^array:(.+)$/.exec(type))) {
    if (!Array.isArray(value)) throw new NativeWriteRefusal(`${owner}: ${type} is not an array.`);
    out.u32(value.length);
    for (const item of value) writeValue(ctx, out, match[1]!, item, owner);
    return;
  }
  if ((match = /^static:(\d+),(.+)$/.exec(type)) || (match = /^\[(\d+)\](.+)$/.exec(type))) {
    const elements = isObject(value) ? value.Elements : null;
    if (!Array.isArray(elements) || elements.length > Number(match[1])) throw new NativeWriteRefusal(`${owner}: ${type} is not a fixed array.`);
    onlyKeys(value, ["Elements"], owner);
    out.u32(elements.length);
    for (const item of elements) writeValue(ctx, out, match[2]!, item, owner);
    return;
  }
  if (/^w?handle:/.test(type)) {
    onlyKeys(value, typeof value?.HandleRefId === "string" ? ["HandleRefId"] : ["HandleId", "Data"], owner);
    return ctx.handle(out, value, type, owner);
  }
  if (/^ra?Ref:/.test(type)) {
    onlyKeys(value, ["DepotPath", "Flags"], owner);
    onlyKeys(value?.DepotPath, ["$type", "$storage", "$value"], owner);
    return ctx.reference(out, value, type);
  }
  switch (type) {
    case "Bool":
      if (value !== 0 && value !== 1 && value !== true && value !== false) throw new NativeWriteRefusal(`${owner}: ${JSON.stringify(value)} is not a Bool.`);
      return out.u8(value ? 1 : 0);
    case "Int8": return out.i8(integer(type, value));
    case "Uint8": return out.u8(integer(type, value));
    case "Int16": return out.i16(integer(type, value));
    case "Uint16": return out.u16(integer(type, value));
    case "Int32": return out.i32(integer(type, value));
    case "Uint32": return out.u32(integer(type, value));
    case "Int64": return out.i64(bigint(type, value));
    case "Uint64": case "CRUID": return out.u64(bigint(type, value));
    case "Float":
      if (typeof value !== "number") throw new NativeWriteRefusal(`${owner}: ${JSON.stringify(value)} is not a Float.`);
      return out.f32(value);
    case "Double":
      if (typeof value !== "number") throw new NativeWriteRefusal(`${owner}: ${JSON.stringify(value)} is not a Double.`);
      return out.f64(value);
    case "CName": return out.u16(ctx.name(cnameText(value)));
    case "String":
      if (typeof value !== "string") throw new NativeWriteRefusal(`${owner}: ${JSON.stringify(value)} is not a String.`);
      return ctx.string(out, value);
    case "DataBuffer": case "serializationDeferredDataBuffer":
      // `raw` is the writer's own form of a buffer it derived (a material buffer's files, an appearance's package).
      onlyKeys(value, ["BufferId", "Flags", "Bytes", "raw"], owner);
      return ctx.buffer(out, value, type === "serializationDeferredDataBuffer", owner);
  }
  const kind = kindOf(type);
  if (kind === "enum") {
    if (typeof value !== "string" || !enumMembers(type)?.some(([member]) => member === value))
      throw new NativeWriteRefusal(`${owner}: ${JSON.stringify(value)} is not a member of ${type}.`);
    return out.u16(ctx.name(value));
  }
  if (kind === "bitfield") {
    if (typeof value !== "string") throw new NativeWriteRefusal(`${owner}: ${JSON.stringify(value)} is not a ${type}.`);
    const names = value === "0" || value === "" ? [] : value.split(",").map(part => part.trim());
    const members = new Map(bitfieldMembers(type));
    if (names.some(name => !members.has(name))) throw new NativeWriteRefusal(`${owner}: ${value} names a bit ${type} doesn't have.`);
    names.sort((a, b) => members.get(a)! - members.get(b)!);
    return ctx.bitfield(out, names);
  }
  // A struct held by value: any class the writer's table knows (its properties and defaults decide what is written).
  if (kind === "class" || Object.hasOwn(CLASSES, type)) return ctx.struct(out, type, value, owner);
  throw new NativeWriteRefusal(`${owner}: values of type ${type} are not written.`);
}

/** The properties of `value` (a class or struct of `type`) to write, in order, with their types. */
export function propertiesToWrite(type: string, value: Json): { name: string; type: string; value: Json }[] {
  if (!isObject(value)) throw new NativeWriteRefusal(`A ${type} value is not an object.`);
  const className = typeof value.$type === "string" ? value.$type : type;
  const entry = classEntry(className);
  const known = new Set(entry.props.map(([name]) => name));
  const derived = DERIVED[className] ?? [];
  for (const key of Object.keys(value))
    if (key !== "$type" && !known.has(key) && !derived.includes(key)) throw new NativeWriteRefusal(`${className}.${key} is not a property the writer knows.`);
  const out: { name: string; type: string; value: Json }[] = [];
  for (const [name, propType] of entry.props) {
    // A property the JSON leaves out is the class default: written only by a class that writes every property.
    const item = name in value ? value[name] : entry.defaults![name];
    if (!entry.sd && isDefaultProperty(className, name, propType, item)) continue;
    out.push({ name, type: propType, value: item });
  }
  return out;
}
