/**
 * A synthetic compiled TweakDB blob for tests (no game data): the layout src/tweakdb-flats.ts reads (magic, versions, flats section with
 * one value table and one key table per type). Strings are written with a one-byte length, so each must be shorter than 64 bytes.
 */
import { fnv1a64 } from "../../src/depot-path";
import { TWEAKDB_MAGIC, tweakDbId } from "../../src/tweakdb-flats";

export type BlobFlat =
  | { type: "CName" | "String"; value: string }
  | { type: "array:CName" | "array:String"; value: string[] }
  | { type: "Float"; value: number }
  | { type: "Bool"; value: boolean }
  | { type: "Vector3"; value: [number, number, number] }
  | { type: "TweakDBID"; value: number }
  | { type: "array:TweakDBID"; value: number[] }
  | { type: "raRef:CResource"; value: bigint };

const bytes = (text: string) => new TextEncoder().encode(text);

/** Flats by full name (`Record.field`) or by a raw TweakDBID number (an inline record's field: `childId`). */
export function tweakDbBlob(flats: readonly (readonly [string | number, BlobFlat])[]): Uint8Array {
  const parts: number[] = [];
  const u32 = (v: number, into = parts) => { into.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); };
  const u64 = (v: bigint, into = parts) => { for (let i = 0n; i < 8n; i++) into.push(Number((v >> (8n * i)) & 0xffn)); };
  const f32 = (v: number, into: number[]) => into.push(...new Uint8Array(new Float32Array([v]).buffer));
  const text = (value: string, into: number[]) => {
    const b = bytes(value);
    if (b.length >= 64) throw Error("the test blob writes strings shorter than 64 bytes");
    into.push(0x80 | b.length, ...b);
  };
  const count = (n: number, into: number[]) => { if (n >= 64) throw Error("the test blob writes arrays shorter than 64"); into.push(n); };
  const encode = (flat: BlobFlat): number[] => {
    const out: number[] = [];
    switch (flat.type) {
      case "CName": case "String": text(flat.value, out); break;
      case "array:CName": case "array:String": count(flat.value.length, out); for (const item of flat.value) text(item, out); break;
      case "Float": f32(flat.value, out); break;
      case "Bool": out.push(flat.value ? 1 : 0); break;
      case "Vector3": for (const v of flat.value) f32(v, out); break;
      case "TweakDBID": u64(BigInt(flat.value), out); break;
      case "array:TweakDBID": count(flat.value.length, out); for (const v of flat.value) u64(BigInt(v), out); break;
      case "raRef:CResource": u64(flat.value, out); break;
    }
    return out;
  };
  const sections = new Map<string, { values: number[][]; keys: [number, number][] }>();
  for (const [name, flat] of flats) {
    const section = sections.get(flat.type) ?? { values: [], keys: [] };
    section.keys.push([typeof name === "number" ? name : tweakDbId(name), section.values.length]);
    section.values.push(encode(flat));
    sections.set(flat.type, section);
  }
  u32(TWEAKDB_MAGIC); u32(8); u32(4); u32(0);
  const flatsOffset = 32;
  u32(flatsOffset); u32(0); u32(0); u32(0);
  u32(sections.size);
  let offset = flatsOffset + 4 + sections.size * 20;
  const bodies: number[][] = [];
  for (const [type, section] of sections) {
    const body: number[] = [];
    u32(section.values.length, body);
    for (const value of section.values) body.push(...value);
    u32(section.keys.length, body);
    for (const [key, index] of section.keys) { u64(BigInt(key), body); u32(index, body); }
    u64(fnv1a64(bytes(type))); u32(section.values.length); u32(section.keys.length); u32(offset);
    offset += body.length;
    bodies.push(body);
  }
  for (const body of bodies) parts.push(...body);
  return Uint8Array.from(parts);
}
