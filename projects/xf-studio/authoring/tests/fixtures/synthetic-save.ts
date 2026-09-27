/**
 * Synthetic save parts for tests (never a real save): a CSAV container with LZ4 chunks and a node tree, a `TypeDatabase_v2`, a
 * `PersistencySystem2` stream, object packages (save, native-system and resource variants) and a compiled script bundle, each built
 * from the layouts the readers document. Small and deterministic; nothing here reads a file.
 */
import { fnv1a64 } from "../../src/engines/red-object/hash";

export const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
};
export const u8 = (n: number) => new Uint8Array([n]);
export const u16 = (n: number) => new Uint8Array(new Uint16Array([n]).buffer);
export const u32 = (n: number) => new Uint8Array(new Uint32Array([n]).buffer);
export const i32 = (n: number) => new Uint8Array(new Int32Array([n]).buffer);
export const u64 = (n: bigint) => new Uint8Array(new BigUint64Array([n]).buffer);
export const f32 = (n: number) => new Uint8Array(new Float32Array([n]).buffer);
export const ascii = (text: string) => new TextEncoder().encode(text);

/** A signed VLQ as the save writes it (bit 7 of the first byte: negative; bit 6: more). */
export function vlq(value: number): Uint8Array {
  const negative = value < 0;
  let n = Math.abs(value);
  const out = [(negative ? 0x80 : 0) | (n & 63) | (n > 63 ? 0x40 : 0)];
  n = Math.floor(n / 64);
  while (n > 0) { out.push((n & 127) | (n > 127 ? 0x80 : 0)); n = Math.floor(n / 128); }
  return new Uint8Array(out);
}
/** A save string: UTF-8, so a negative length. */
export const text = (value: string) => { const bytes = ascii(value); return cat(vlq(-bytes.length), bytes); };
/** An LZ4 block of literals only (valid LZ4: the last sequence has no match). */
export function lz4Literals(data: Uint8Array): Uint8Array {
  const n = data.length, head: number[] = [(Math.min(n, 15) << 4)];
  if (n >= 15) { let rest = n - 15; while (rest >= 255) { head.push(255); rest -= 255; } head.push(rest); }
  return cat(new Uint8Array(head), data);
}

export type SynthNode = { name: string; body?: Uint8Array; children?: SynthNode[]; /** Bytes after the children, inside the parent. */ tail?: Uint8Array };

/** A CSAV file holding `roots` (IDs in depth-first order), split into chunks of `chunkSize` expanded bytes. */
export function buildSave(roots: SynthNode[], options: { chunkSize?: number; gameVersion?: number; saveVersion?: number; stored?: boolean } = {}): Uint8Array {
  type Row = { name: string; next: number; child: number; offset: number; size: number };
  const rows: Row[] = [];
  const bodies: Uint8Array[] = [];
  // IDs first (depth-first), then data with offsets once the stream start is known.
  const assign = (nodes: SynthNode[]): number[] => nodes.map(node => {
    const id = rows.length;
    rows.push({ name: node.name, next: -1, child: -1, offset: 0, size: 0 });
    const kids = assign(node.children ?? []);
    rows[id]!.child = kids[0] ?? -1;
    kids.forEach((kid, i) => { rows[kid]!.next = kids[i + 1] ?? -1; });
    return id;
  });
  const top = assign(roots);
  top.forEach((id, i) => { rows[id]!.next = top[i + 1] ?? -1; });
  const header = cat(u32(0x43534156), u32(options.saveVersion ?? 269), u32(options.gameVersion ?? 2310), vlq(0), u64(0n), u32(195));
  const tableOffset = header.length;
  // The stream: the node data, laid out after the header and chunk table (chunk count is decided from the data size).
  const layout = (nodes: SynthNode[], ids: number[], at: number): number => {
    nodes.forEach((node, i) => {
      const id = ids[i]!, row = rows[id]!;
      row.offset = at;
      const own = cat(u32(id), node.body ?? new Uint8Array(0));
      bodies[id] = own;
      at += own.length;
      const kids: number[] = [];
      for (let k = row.child; k !== -1; k = rows[k]!.next) kids.push(k);
      at = layout(node.children ?? [], kids, at);
      if (node.tail) at += node.tail.length;
      row.size = at - row.offset;
    });
    return at;
  };
  const chunkSize = options.chunkSize ?? 256 * 1024;
  // First pass with a guessed chunk count, then fix the start.
  let chunkCount = 1, dataStart = 0, streamEnd = 0;
  for (let pass = 0; pass < 3; pass++) {
    dataStart = tableOffset + 8 + chunkCount * 12;
    streamEnd = layout(roots, top, dataStart);
    chunkCount = Math.max(1, Math.ceil((streamEnd - dataStart) / chunkSize));
  }
  dataStart = tableOffset + 8 + chunkCount * 12;
  streamEnd = layout(roots, top, dataStart);
  const stream = new Uint8Array(streamEnd);
  const write = (nodes: SynthNode[], ids: number[]) => nodes.forEach((node, i) => {
    const id = ids[i]!, row = rows[id]!;
    stream.set(bodies[id]!, row.offset);
    const kids: number[] = [];
    for (let k = row.child; k !== -1; k = rows[k]!.next) kids.push(k);
    write(node.children ?? [], kids);
    if (node.tail) stream.set(node.tail, row.offset + row.size - node.tail.length);
  });
  write(roots, top);
  const data = stream.subarray(dataStart);
  const chunks: Uint8Array[] = [], table: Uint8Array[] = [];
  let fileAt = dataStart;
  for (let i = 0; i < chunkCount; i++) {
    const part = data.subarray(i * chunkSize, Math.min(data.length, (i + 1) * chunkSize));
    const stored = options.stored ? part : cat(ascii("4ZLX"), u32(part.length), lz4Literals(part));
    table.push(cat(u32(fileAt), u32(stored.length), u32(part.length)));
    chunks.push(stored);
    fileAt += stored.length;
  }
  const nodeTable = cat(u32(0x4e4f4445), vlq(rows.length), ...rows.map(row => cat(text(row.name), i32(row.next), i32(row.child), u32(row.offset), u32(row.size))));
  return cat(header, ascii("FZLC"), u32(chunkCount), ...table, ...chunks, nodeTable, u32(fileAt), u32(0x444f4e45));
}

// ---- TypeDatabase_v2 ----
export const KIND = { name: 0, fundamental: 1, class: 2, array: 3, simple: 4, enum: 5, "static-array": 6, "native-array": 7, handle: 9 } as const;
export type SynthType = { name: string; kind: keyof typeof KIND; size?: number; inner?: string; count?: number };
/** A `TypeDatabase_v2` node body (after the node ID the container writes): header rest, types sorted by hash, the unknown section, properties. */
export function typeDatabaseBody(types: SynthType[], properties: [name: string, type: string][], unknown = 0): Uint8Array {
  const rows = types.map(type => ({ ...type, hash: fnv1a64(type.name) })).sort((a, b) => a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0);
  const index = new Map(rows.map((row, i) => [row.name, i]));
  const body = cat(u32(0), u32(3), u64(0n), u32(rows.length), u32(unknown), u32(properties.length),
    ...rows.map(row => cat(u64(row.hash), u64(row.inner ? fnv1a64(row.inner) : 0n), u16((KIND[row.kind] << 4) | ((row.size ?? 0) << 12)), u16(row.count ?? 0))),
    ...Array.from({ length: unknown }, () => u64(0n)),
    ...properties.map(([name, type]) => cat(u64(fnv1a64(name)), u32(index.get(type) ?? 0))));
  // The second u32 is the body size; the node's own ID comes first in the node data.
  new DataView(body.buffer).setUint32(0, body.length + 4, true);
  return body;
}

// ---- PersistencySystem2 ----
export type PersistProp = { name: string; type: string; value: Uint8Array };
export const prop = (name: string, type: string, value: Uint8Array): PersistProp => ({ name, type, value });
export const props = (list: PersistProp[], terminated = false) =>
  cat(...list.map(item => cat(u64(fnv1a64(item.name)), u64(fnv1a64(item.type)), item.value)), terminated ? u64(0n) : new Uint8Array(0));
/** A nested class value: its properties and a zero name hash. */
export const struct = (list: PersistProp[]) => props(list, true);
export type PersistEntry = { id: bigint; type?: string; data?: Uint8Array };
export function persistencyBody(entries: PersistEntry[], ids: number[] = []): Uint8Array {
  return cat(u32(ids.length), ...ids.map(u32), u32(7), u32(entries.length), ...entries.map(entry => entry.id === 0n ? u64(0n)
    : cat(u64(entry.id), u64(fnv1a64(entry.type ?? "")), u32(entry.data?.length ?? 0), entry.data ?? new Uint8Array(0))));
}

// ---- Object packages ----
export type PackageValueBytes = { type: string; bytes: Uint8Array };
export class PackageBuilder {
  readonly names: string[] = [""];
  readonly chunks: { type: string; bytes: Uint8Array }[] = [];
  name(value: string) { let index = this.names.indexOf(value); if (index < 0) { index = this.names.length; this.names.push(value); } return index; }
  enumValue = (type: string, member: string): PackageValueBytes => ({ type, bytes: u16(this.name(member)) });
  bitfield = (type: string, members: string[]): PackageValueBytes => ({ type, bytes: cat(u8(members.length), ...members.map(member => u16(this.name(member)))) });
  int = (value: number): PackageValueBytes => ({ type: "Int32", bytes: i32(value) });
  bool = (value: boolean): PackageValueBytes => ({ type: "Bool", bytes: u8(value ? 1 : 0) });
  cname = (value: string): PackageValueBytes => ({ type: "CName", bytes: u16(this.name(value)) });
  string = (value: string): PackageValueBytes => { const bytes = ascii(value); return { type: "String", bytes: cat(u16(bytes.length), bytes) }; };
  handle = (type: string, index: number): PackageValueBytes => ({ type: `handle:${type}`, bytes: i32(index) });
  array = (type: string, items: PackageValueBytes[]): PackageValueBytes => ({ type: `array:${type}`, bytes: cat(u32(items.length), ...items.map(item => item.bytes)) });
  raw = (type: string, bytes: Uint8Array): PackageValueBytes => ({ type, bytes });
  object = (type: string, fields: [string, PackageValueBytes][]): PackageValueBytes => {
    const table: Uint8Array[] = [], values: Uint8Array[] = [];
    let offset = 2 + fields.length * 8;
    for (const [name, value] of fields) {
      table.push(u16(this.name(name)), u16(this.name(value.type)), u32(offset));
      values.push(value.bytes); offset += value.bytes.length;
    }
    return { type, bytes: cat(u16(fields.length), ...table, ...values) };
  };
  chunk(value: PackageValueBytes) { this.chunks.push({ type: value.type, bytes: value.bytes }); return this.chunks.length - 1; }
  /** The package: header, the variant's CRUID part, names and chunks (six sections, no reference pool). */
  build(variant: "save" | "save-plain" | "resource" = "save"): Uint8Array {
    const typeIndexes = this.chunks.map(chunk => this.name(chunk.type));
    const nameBytes = this.names.map(value => cat(ascii(value), u8(0)));
    const nameDesc = 0, nameData = this.names.length * 4, chunkDesc = nameData + nameBytes.reduce((sum, bytes) => sum + bytes.length, 0);
    const chunkData = chunkDesc + this.chunks.length * 8;
    let at = nameData; const desc = nameBytes.map(bytes => { const d = u32((at & 0xffffff) | (bytes.length << 24)); at += bytes.length; return d; });
    let chunkAt = chunkData; const chunkTable = this.chunks.map((chunk, i) => { const entry = cat(u32(typeIndexes[i]!), u32(chunkAt)); chunkAt += chunk.bytes.length; return entry; });
    const variantPart = variant === "save" ? u32(0) : variant === "resource" ? cat(u16(0), u16(0)) : new Uint8Array(0);
    return cat(new Uint8Array([4, 2]), u16(6), u32(this.chunks.length), u32(nameDesc), u32(nameData), u32(chunkDesc), u32(chunkData),
      variantPart, ...desc, ...nameBytes, ...chunkTable, ...this.chunks.map(chunk => chunk.bytes));
  }
}
/** A package node's body: u32 package size, the package, optional trailing bytes. */
export const packageNodeBody = (pkg: Uint8Array, trailing = new Uint8Array(0)) => cat(u32(pkg.length), pkg, trailing);

// ---- Compiled script bundle ----
/** A `final.redscripts` holding only CNames (version 14 header, string data and the CName table). */
export function scriptBundle(names: string[], version = 14): Uint8Array {
  const strings = cat(...names.map(name => cat(ascii(name), u8(0))));
  let at = 0; const offsets = names.map(name => { const offset = at; at += ascii(name).length + 1; return offset; });
  const stringsAt = 104, cnamesAt = stringsAt + strings.length;
  const table = (offset: number, count: number) => cat(u32(offset), u32(count), u32(0));
  return cat(ascii("REDS"), u32(version), u32(0), u64(0n), u32(0), u32(0), u32(0),
    table(stringsAt, strings.length), table(cnamesAt, names.length), table(0, 0), table(0, 0), table(0, 0), table(0, 0),
    strings, ...offsets.map(u32));
}
