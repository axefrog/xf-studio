/**
 * Read-only lookups in the game's compiled TweakDB blob (`r6/cache/tweakdb.bin`, or `tweakdb_ep1.bin` with Phantom
 * Liberty). Pure: the host passes the file's bytes. Only flats (record fields) of a few value types are decoded, and only
 * the IDs asked for, so the 40–50 MB blob is scanned without building an index of millions of keys.
 *
 * Format [source: WolvenKit `WolvenKit.RED4/TweakDB/TweakDBReader.cs` and `Header.cs` at commit 11720772]: magic
 * `0x0BB1DB47`, a 28-byte header (blob version 8, parser version 4, record checksum, then the offsets of the flats,
 * records, queries and group tags). The flats section lists value types by FNV-1a 64 of the type name, each with its
 * values and a `(TweakDBID, value index)` key table. Strings are length-prefixed with a signed VLQ (negative: one byte per
 * character, positive: UTF-16).
 *
 * A TweakDBID is CRC-32 of the name plus the name's length in the next byte. A record's field is the flat
 * `<record>.<field>`; its CRC continues the record's CRC over `.<field>`, so a field of a record known only by ID is
 * still addressable (`childId`) [source: the same CRC-32 continuation zlib's `crc32(data, start)` performs].
 */
import { fnv1a64 } from "./depot-path";

export const TWEAKDB_MAGIC = 0x0bb1db47;
const BLOB_VERSION = 8, PARSER_VERSION = 4;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
/** CRC-32 (IEEE), continuing from `start` like zlib's `crc32(data, start)`. */
export function crc32(bytes: Uint8Array, start = 0): number {
  let c = ~start >>> 0;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

const encoder = new TextEncoder();
/** A TweakDBID's identity bits (CRC-32 and name length) as a number; the table offset bits are dropped. */
export type TweakId = number;
const make = (crc: number, length: number): TweakId => crc + (length & 0xff) * 2 ** 32;
const crcOf = (id: TweakId) => id % 2 ** 32;
const lengthOf = (id: TweakId) => Math.floor(id / 2 ** 32) & 0xff;

export function tweakDbId(name: string): TweakId {
  const bytes = encoder.encode(name);
  return make(crc32(bytes), bytes.length);
}
/** The ID of `<record>` + `suffix` (e.g. `.atlasPartName`) from the record's ID alone. */
export function childId(record: TweakId, suffix: string): TweakId {
  const bytes = encoder.encode(suffix);
  return make(crc32(bytes, crcOf(record)), lengthOf(record) + bytes.length);
}

export type TweakValue =
  | { readonly type: "CName" | "String"; readonly value: string }
  | { readonly type: "TweakDBID"; readonly value: TweakId }
  | { readonly type: "array:TweakDBID"; readonly value: readonly TweakId[] }
  /** A resource reference: the depot hash as a decimal string. */
  | { readonly type: "raRef:CResource"; readonly value: string }
  /** A localisation key: `LocKey#<n>`. */
  | { readonly type: "gamedataLocKeyWrapper"; readonly value: string };
export type TweakType = TweakValue["type"];
export const TWEAK_TYPES: readonly TweakType[] = ["CName", "String", "TweakDBID", "array:TweakDBID", "raRef:CResource", "gamedataLocKeyWrapper"];

interface FlatType { type: TweakType; values: number; keys: number; offset: number; valueStarts: Uint32Array | null; keyTable: number }

export class TweakDbBlob {
  private readonly view: DataView;
  private readonly types: FlatType[] = [];
  /** The blob's own version fields, for evidence. */
  readonly version: { readonly blob: number; readonly parser: number };

  /** Throws with a plain reason when the bytes are not a TweakDB blob this reader understands. */
  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < 32 || this.view.getUint32(0, true) !== TWEAKDB_MAGIC) throw Error("The file is not a TweakDB blob.");
    const blob = this.view.getInt32(4, true), parser = this.view.getInt32(8, true);
    this.version = { blob, parser };
    if (blob !== BLOB_VERSION || parser !== PARSER_VERSION)
      throw Error(`TweakDB blob version ${blob}/${parser} is not the supported ${BLOB_VERSION}/${PARSER_VERSION}.`);
    const flats = this.view.getInt32(16, true);
    const wanted = new Map(TWEAK_TYPES.map(type => [fnv1a64(encoder.encode(type)), type] as const));
    let pos = flats;
    const count = this.u32(pos); pos += 4;
    // Every count is bounded by the bytes that could hold it before anything is allocated or read (PIPE-49).
    if (count > 4096 || pos + count * 20 > bytes.byteLength) throw Error("TweakDB flat type table is implausibly large.");
    for (let i = 0; i < count; i++, pos += 20) {
      const type = wanted.get(this.view.getBigUint64(pos, true));
      if (type) this.types.push({ type, values: this.u32(pos + 8), keys: this.u32(pos + 12), offset: this.u32(pos + 16), valueStarts: null, keyTable: -1 });
    }
  }

  private u32(pos: number) {
    if (pos < 0 || pos + 4 > this.bytes.byteLength) throw Error("TweakDB blob is truncated.");
    return this.view.getUint32(pos, true);
  }
  private vlq(pos: number): [number, number] {
    if (pos < 0 || pos >= this.bytes.byteLength) throw Error("TweakDB blob is truncated.");
    let b = this.bytes[pos++]!;
    const negative = (b & 0x80) !== 0;
    let value = b & 0x3f, shift = 6;
    if (b & 0x40) {
      do {
        if (pos >= this.bytes.byteLength || shift > 27) throw Error("TweakDB blob has an invalid length prefix.");
        b = this.bytes[pos++]!;
        value += (b & 0x7f) * 2 ** shift;
        shift += 7;
      } while (b & 0x80);
    }
    return [negative ? -value : value, pos];
  }
  private id(pos: number): TweakId {
    if (pos < 0 || pos + 8 > this.bytes.byteLength) throw Error("TweakDB blob is truncated.");
    return make(this.view.getUint32(pos, true), this.view.getUint8(pos + 4));
  }
  /** `bytes` more bytes from `pos` lie inside the blob. */
  private within(pos: number, bytes: number) {
    if (pos < 0 || bytes < 0 || pos + bytes > this.bytes.byteLength) throw Error("TweakDB blob is truncated.");
  }

  /** Size in bytes of one value at `pos`. */
  private skip(type: TweakType, pos: number): number {
    let size: number;
    switch (type) {
      case "CName": case "String": {
        const [length, next] = this.vlq(pos);
        size = next - pos + (length < 0 ? -length : length * 2);
        break;
      }
      case "array:TweakDBID": { const [length, next] = this.vlq(pos); size = next - pos + Math.abs(length) * 8; break; }
      default: size = 8;
    }
    this.within(pos, size);
    return size;
  }
  private decode(type: TweakType, pos: number): TweakValue {
    switch (type) {
      case "CName": case "String": {
        const [length, next] = this.vlq(pos);
        const n = Math.abs(length), text = length < 0
          ? new TextDecoder("latin1").decode(this.bytes.subarray(next, next + n))
          : new TextDecoder("utf-16le").decode(this.bytes.subarray(next, next + n * 2));
        return { type, value: text };
      }
      case "TweakDBID": return { type, value: this.id(pos) };
      case "array:TweakDBID": {
        const [length, next] = this.vlq(pos);
        return { type, value: Array.from({ length: Math.abs(length) }, (_, i) => this.id(next + i * 8)) };
      }
      case "raRef:CResource": return { type, value: this.view.getBigUint64(pos, true).toString() };
      case "gamedataLocKeyWrapper": return { type, value: `LocKey#${this.view.getBigUint64(pos, true).toString()}` };
    }
  }
  /** Value offsets of one type, computed once. */
  private starts(flat: FlatType): Uint32Array {
    if (flat.valueStarts) return flat.valueStarts;
    let pos = flat.offset;
    const count = this.u32(pos); pos += 4;
    // Each value takes at least one byte (eight for fixed-size types): a larger count cannot fit, so nothing is allocated for it.
    const least = flat.type === "CName" || flat.type === "String" || flat.type === "array:TweakDBID" ? 1 : 8;
    if (count * least > this.bytes.byteLength - pos) throw Error("TweakDB blob is truncated.");
    const starts = new Uint32Array(count);
    for (let i = 0; i < count; i++) { starts[i] = pos; pos += this.skip(flat.type, pos); }
    flat.valueStarts = starts;
    flat.keyTable = pos;
    return starts;
  }

  /** The flats among `ids` this blob defines (IDs it lacks are simply absent from the result). */
  lookup(ids: Iterable<TweakId>): Map<TweakId, TweakValue> {
    const wanted = new Set(ids), found = new Map<TweakId, TweakValue>();
    if (!wanted.size) return found;
    for (const flat of this.types) {
      const starts = this.starts(flat);
      let pos = flat.keyTable;
      const keys = this.u32(pos); pos += 4;
      this.within(pos, keys * 12);
      for (let i = 0; i < keys; i++, pos += 12) {
        const id = this.id(pos);
        if (!wanted.has(id)) continue;
        const index = this.view.getInt32(pos + 8, true);
        if (index >= 0 && index < starts.length) found.set(id, this.decode(flat.type, starts[index]!));
      }
    }
    return found;
  }
}
