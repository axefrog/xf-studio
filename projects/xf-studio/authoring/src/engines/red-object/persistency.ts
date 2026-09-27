/**
 * The world-object persistency stream, `PersistencySystem2` (research/save/save-editor-design.md §5.3; knowledge/save-files.md §2):
 * the persistent states (`…PS` classes) of devices, doors, vehicles, containers and other world objects. Pure and bounded.
 *
 * Layout [source: WolvenKit `PersistencySystem2Parser.cs` at 11720772, studied only]: after the node's u32 ID, a u32 count of IDs and
 * the IDs (u32 each), a u32, and a u32 count of entries; each entry is a u64 persistent ID (0 = an empty slot, nothing follows), a u64
 * class name hash, a u32 size and that many bytes of properties. A property is a u64 property name hash, a u64 type hash and the value;
 * the top level ends at the entry's size (some entries also end with a zero name hash), a nested class at a zero name hash. Values: fixed-size values as their bytes (names and
 * `NodeRef`s are u64 hashes, enums integers of their own size), strings as a signed-VLQ length and text, arrays as a u32 count and the
 * elements, handles as a class hash and properties.
 *
 * Driven only by the type oracle (the save's own `TypeDatabase_v2`: kind, size and element type per type hash). Every entry is bounded
 * by its size, so one the walker can't follow (static and native arrays, an unknown type) is kept as raw bytes with the reason; the
 * index itself never depends on decoding an entry.
 */
import { Reader } from "../save/reader";
import type { TypeOracle } from "./type-oracle";

export type PersistencyEntry = {
  readonly index: number;
  readonly id: bigint;
  readonly classHash: bigint;
  readonly size: number;
  /** Where the entry's properties start in the node body, or -1 for an empty slot. */
  readonly start: number;
};
/**
 * The index, kept as where each entry starts in the body, 4 bytes an entry (SAVE-15: an object an entry cost about 270 bytes, so a
 * 19 MB body of a million entries kept 272 MB): how many entries, and each one made on demand from the body.
 */
export type PersistencyIndex = {
  readonly ids: number;
  readonly unknown: number;
  /** Entries, empty slots included. */
  readonly count: number;
  /** Entries with data (not empty slots). */
  readonly filled: number;
  /** One entry, or undefined past the index. */
  entry(index: number): PersistencyEntry | undefined;
  /** An entry's class hash (0 for an empty slot), and whether it has data, without making the entry. */
  classHash(index: number): bigint;
  isFilled(index: number): boolean;
};
export type PersistValue = number | string | boolean | PersistHash | PersistObject | PersistOpaque | PersistValue[];
/** A u64 that names something (a CName, a NodeRef) or a value whose meaning isn't known: its hash, and the name when a source has one. */
export type PersistHash = { readonly $hash: string; readonly name?: string };
export type PersistProperty = { readonly nameHash: bigint; readonly typeHash: bigint; readonly value: PersistValue };
export type PersistObject = { readonly $class: bigint; readonly props: readonly PersistProperty[] };
export type PersistOpaque = { readonly $opaque: string; readonly bytes: number };
/** A decoded entry; `values` counts what it decoded to (a caller's memory accounting). */
export type PersistDecode =
  | { readonly ok: true; readonly object: PersistObject; readonly values: number }
  | { readonly ok: false; readonly reason: string; readonly raw: Uint8Array; readonly partial: PersistObject; readonly values: number };

export class PersistencyError extends Error { override name = "PersistencyError"; }

const MAX_ENTRIES = 1_000_000, MAX_DEPTH = 32;
/**
 * Values one entry may decode to (properties, array elements and nested values); an entry past it is kept raw (SAVE-02). A 2.x save's
 * largest entry decodes to 458 values (468,570 across its 99,697 entries).
 */
export const MAX_ENTRY_VALUES = 50_000;

/** The index of a `PersistencySystem2` node body (the bytes after its u32 ID): every entry's ID, class hash and extent. */
export function readPersistencyIndex(body: Uint8Array): PersistencyIndex {
  const r = new Reader(body);
  const ids = r.count(MAX_ENTRIES);
  r.take(ids * 4);
  const unknown = r.u32();
  const count = r.count(MAX_ENTRIES);
  // Where each entry starts in the body (its ID); the rest is read back from the body when asked for.
  const idAt = new Uint32Array(count);
  let filled = 0;
  for (let index = 0; index < count; index++) {
    const p = r.pos;
    idAt[index] = p;
    r.take(8);
    if (r.view.getBigUint64(p, true) === 0n) continue;
    r.take(8);
    r.take(r.u32());
    filled++;
  }
  if (r.pos !== body.length) throw new PersistencyError(`The persistency node has ${body.length - r.pos} bytes after its last entry.`);
  const view = r.view;
  const inIndex = (index: number) => Number.isInteger(index) && index >= 0 && index < count;
  const isFilled = (index: number) => inIndex(index) && view.getBigUint64(idAt[index]!, true) !== 0n;
  return {
    ids, unknown, count, filled, isFilled,
    classHash: index => isFilled(index) ? view.getBigUint64(idAt[index]! + 8, true) : 0n,
    entry(index) {
      if (!inIndex(index)) return undefined;
      const at = idAt[index]!, id = view.getBigUint64(at, true);
      if (id === 0n) return { index, id, classHash: 0n, size: 0, start: -1 };
      return { index, id, classHash: view.getBigUint64(at + 8, true), size: view.getUint32(at + 16, true), start: at + 20 };
    },
  };
}

class Stop extends Error {}

/** Decode one entry's properties with the oracle's types; an entry it can't follow comes back raw, with what was read before the stop. */
export function decodePersistencyEntry(body: Uint8Array, entry: PersistencyEntry, types: TypeOracle): PersistDecode {
  const bytes = entry.start < 0 ? new Uint8Array(0) : body.subarray(entry.start, entry.start + entry.size);
  const r = new Reader(bytes);
  const top: PersistProperty[] = [];
  let values = 0;
  const count = (n: number) => { values += n; if (values > MAX_ENTRY_VALUES) throw new Stop("it holds more values than any save's entry does"); };
  const hashAt = () => { const p = r.pos; r.take(8); return r.view.getBigUint64(p, true); };
  const named = (hash: bigint): PersistHash => {
    const name = types.name(hash)?.name;
    return name !== undefined ? { $hash: hash.toString(16).padStart(16, "0"), name } : { $hash: hash.toString(16).padStart(16, "0") };
  };
  const value = (typeHash: bigint, depth: number): PersistValue => {
    if (depth > MAX_DEPTH) throw new Stop("nested deeper than any save does");
    count(1);
    const type = types.type(typeHash);
    if (!type) throw new Stop(`type ${typeHash.toString(16)} isn't in the save's type database`);
    const name = type.name;
    switch (type.kind) {
      case "class": return properties(typeHash, depth + 1, false);
      case "handle": { const cls = hashAt(); return properties(cls, depth + 1, false); }
      case "array": {
        const length = r.u32();
        if (length > bytes.length - r.pos) throw new Stop(`${length} elements can't fit`);
        if (length > MAX_ENTRY_VALUES - values) count(length); // Refused before anything is allocated.
        const out: PersistValue[] = [];
        for (let i = 0; i < length; i++) out.push(value(type.inner, depth + 1));
        return out;
      }
      case "static-array": case "native-array": throw new Stop(`${name ?? "a fixed array"}: fixed arrays aren't walked yet`);
      default: {
        if (name === "String") return r.text();
        if (type.size === 0) throw new Stop(`${name ?? typeHash.toString(16)} has no fixed size`);
        const p = r.pos;
        r.take(type.size);
        const view = r.view;
        switch (name) {
          case "Bool": return view.getUint8(p) !== 0;
          case "Float": return view.getFloat32(p, true);
          case "Double": return view.getFloat64(p, true);
          case "Int8": return view.getInt8(p);
          case "Int16": return view.getInt16(p, true);
          case "Int32": return view.getInt32(p, true);
          case "Int64": return view.getBigInt64(p, true).toString();
          case "Uint64": case "TweakDBID": case "CRUID": return view.getBigUint64(p, true).toString();
        }
        if (type.size === 8) return named(view.getBigUint64(p, true));
        if (type.size === 4) return view.getUint32(p, true);
        if (type.size === 2) return view.getUint16(p, true);
        if (type.size === 1) return view.getUint8(p);
        return { $opaque: name ?? typeHash.toString(16), bytes: type.size };
      }
    }
  };
  /** Properties until the entry's end (top level) or a zero name hash (nested). */
  const properties = (classHash: bigint, depth: number, topLevel: boolean, into: PersistProperty[] = []): PersistObject => {
    const out = into;
    while (r.pos < bytes.length) {
      const nameHash = hashAt();
      // A zero name hash ends a nested class; at the top level some entries end with one too, as their last 8 bytes [offline].
      if (nameHash === 0n) { if (topLevel && r.pos !== bytes.length) throw new Stop("a zero name hash before the entry's end"); break; }
      const typeHash = hashAt();
      out.push({ nameHash, typeHash, value: value(typeHash, depth) });
    }
    return { $class: classHash, props: out };
  };
  try {
    const object = properties(entry.classHash, 0, true, top);
    return { ok: true, object, values };
  } catch (error) {
    const reason = error instanceof Stop ? error.message : error instanceof Error ? `it ends early (${error.message})` : "it can't be read";
    return { ok: false, reason, raw: bytes, partial: { $class: entry.classHash, props: top }, values };
  }
}
