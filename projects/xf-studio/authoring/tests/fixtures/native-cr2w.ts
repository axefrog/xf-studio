/**
 * A small CR2W and object-package writer for the native reader's tests (no game data). It writes the layouts
 * src/native/cr2w-file.ts, cr2w-reader.ts and red-package.ts read; CRCs are left at zero (the reader does not check them).
 */

/** A property value to write: the type string and a function writing its bytes. */
export type Prop = { name: string; type: string; write: (w: Bytes, file: Cr2wBuilder) => void };

export class Bytes {
  private data: number[] = [];
  get length() { return this.data.length; }
  u8(v: number) { this.data.push(v & 0xff); return this; }
  u16(v: number) { return this.u8(v).u8(v >> 8); }
  u32(v: number) { return this.u16(v & 0xffff).u16(v >>> 16); }
  i32(v: number) { return this.u32(v >>> 0); }
  i16(v: number) { return this.u16(v & 0xffff); }
  u64(v: bigint) { for (let i = 0n; i < 8n; i++) this.u8(Number((v >> (8n * i)) & 0xffn)); return this; }
  f32(v: number) { const b = new Uint8Array(new Float32Array([v]).buffer); for (const x of b) this.u8(x); return this; }
  bytes(b: Uint8Array | number[]) { for (const x of b) this.u8(x); return this; }
  set32(at: number, v: number) { for (let i = 0; i < 4; i++) this.data[at + i] = (v >>> (8 * i)) & 0xff; }
  done() { return new Uint8Array(this.data); }
}

export class Cr2wBuilder {
  readonly names: string[] = [""];
  readonly imports: { path: string; flags: number }[] = [];
  readonly exports: { className: string; props: Prop[]; appendix?: (w: Bytes, file: Cr2wBuilder) => void }[] = [];
  readonly buffers: { stored: Uint8Array; memSize: number; flags: number }[] = [];

  name(value: string): number { let i = this.names.indexOf(value); if (i < 0) { i = this.names.length; this.names.push(value); } return i; }
  import(path: string, flags = 0): number { this.imports.push({ path, flags }); return this.imports.length; }
  /** Adds an export and returns its index (a handle to it is index + 1). */
  export(className: string, props: Prop[], appendix?: (w: Bytes, file: Cr2wBuilder) => void): number {
    this.exports.push({ className, props, appendix }); return this.exports.length - 1;
  }
  buffer(stored: Uint8Array, memSize = stored.length, flags = 0): number { this.buffers.push({ stored, memSize, flags }); return this.buffers.length - 1; }

  /** A property list: 0x00, records, u16 0. */
  writeProps(w: Bytes, props: Prop[]) {
    w.u8(0);
    for (const prop of props) {
      w.u16(this.name(prop.name)).u16(this.name(prop.type));
      const at = w.length; w.u32(0);
      prop.write(w, this);
      w.set32(at, w.length - at);
    }
    w.u16(0);
  }

  build(): Uint8Array {
    // Register every name first: export bodies are written after the tables.
    const bodies = this.exports.map(entry => { const w = new Bytes(); this.writeProps(w, entry.props); entry.appendix?.(w, this); this.name(entry.className); return w.done(); });
    for (const entry of this.imports) void entry;
    const pool = new Bytes();
    const offsets = new Map<string, number>();
    const text = (value: string) => {
      if (!offsets.has(value)) { offsets.set(value, pool.length); pool.bytes(new TextEncoder().encode(value)).u8(0); }
      return offsets.get(value)!;
    };
    for (const name of this.names) text(name);
    for (const entry of this.imports) text(entry.path);
    const out = new Bytes();
    const headerSize = 40 + 10 * 12;
    const stringsAt = headerSize, namesAt = stringsAt + pool.length, importsAt = namesAt + this.names.length * 8;
    const propsAt = importsAt + this.imports.length * 8, exportsAt = propsAt + 16, buffersAt = exportsAt + this.exports.length * 24;
    let dataAt = buffersAt + this.buffers.length * 24;
    const exportOffsets = bodies.map(body => { const at = dataAt; dataAt += body.length; return at; });
    const objectsEnd = dataAt;
    const bufferOffsets = this.buffers.map(buffer => { const at = dataAt; dataAt += buffer.stored.length; return at; });
    out.u32(0x57325243).u32(195).u32(0).u64(0n).u32(0).u32(objectsEnd).u32(dataAt).u32(0).u32(6);
    const tables: [number, number][] = [[stringsAt, pool.length], [namesAt, this.names.length], [importsAt, this.imports.length], [propsAt, 1],
      [exportsAt, this.exports.length], [buffersAt, this.buffers.length], [0, 0], [0, 0], [0, 0], [0, 0]];
    for (const [offset, count] of tables) out.u32(offset).u32(count).u32(0);
    out.bytes(pool.done());
    for (const name of this.names) out.u32(text(name)).u32(0);
    for (const entry of this.imports) out.u32(text(entry.path)).u16(0).u16(entry.flags);
    out.bytes(new Uint8Array(16));
    this.exports.forEach((entry, i) => out.u16(this.name(entry.className)).u16(0).u32(0).u32(bodies[i]!.length).u32(exportOffsets[i]!).u32(0).u32(0));
    this.buffers.forEach((buffer, i) => out.u32(buffer.flags).u32(0).u32(bufferOffsets[i]!).u32(buffer.stored.length).u32(buffer.memSize).u32(0));
    for (const body of bodies) out.bytes(body);
    for (const buffer of this.buffers) out.bytes(buffer.stored);
    return out.done();
  }
}

// Value writers.
export const v = {
  bool: (value: boolean) => (w: Bytes) => { w.u8(value ? 1 : 0); },
  u8: (value: number) => (w: Bytes) => { w.u8(value); },
  u16: (value: number) => (w: Bytes) => { w.u16(value); },
  u32: (value: number) => (w: Bytes) => { w.u32(value); },
  u64: (value: bigint) => (w: Bytes) => { w.u64(value); },
  f32: (value: number) => (w: Bytes) => { w.f32(value); },
  cname: (value: string) => (w: Bytes, f: Cr2wBuilder) => { w.u16(f.name(value)); },
  enum: (value: string) => (w: Bytes, f: Cr2wBuilder) => { w.u16(f.name(value)); },
  bitfield: (...names: string[]) => (w: Bytes, f: Cr2wBuilder) => { for (const name of names) w.u16(f.name(name)); w.u16(0); },
  handle: (exportIndex: number | null) => (w: Bytes) => { w.i32(exportIndex === null ? 0 : exportIndex + 1); },
  ref: (importIndex: number) => (w: Bytes) => { w.u16(importIndex); },
  /** CR2W string: UTF-8, negative variable-length count (sign bit 0x80), for strings shorter than 64 bytes. */
  string: (value: string) => (w: Bytes) => { const b = new TextEncoder().encode(value); w.u8(0x80 | b.length).bytes(b); },
  buffer: (index: number) => (w: Bytes) => { w.u32((0x80000000 | (index + 1)) >>> 0); },
  array: (items: ((w: Bytes, f: Cr2wBuilder) => void)[]) => (w: Bytes, f: Cr2wBuilder) => { w.u32(items.length); for (const item of items) item(w, f); },
  struct: (props: Prop[]) => (w: Bytes, f: Cr2wBuilder) => { f.writeProps(w, props); },
};
export const prop = (name: string, type: string, write: Prop["write"]): Prop => ({ name, type, write });

/** A `CMaterialInstance` parameter list (the appendix after its properties). */
export function materialValues(entries: { name: string; type: string; write: Prop["write"] }[]) {
  return (w: Bytes, f: Cr2wBuilder) => {
    w.u32(entries.length);
    for (const entry of entries) {
      const at = w.length; w.u32(0).u16(f.name(entry.name)).u16(f.name(entry.type));
      entry.write(w, f);
      w.set32(at, w.length - at);
    }
  };
}

/**
 * An object package (version 4, 7 sections): `objects` are chunks with field lists; values are written by the callbacks with
 * package encodings (u16 name indexes into `names`, i32 handles, i16 references).
 */
export function buildPackage(options: { names: string[]; refs: { path: string; sync: boolean }[]; cruids: bigint[]; rootIndex: number;
  objects: { type: string; fields: { name: string; type: string; write: (w: Bytes) => void }[] }[] }): Uint8Array {
  const { names, refs, objects } = options;
  const nameIndex = (value: string) => { const i = names.indexOf(value); if (i < 0) throw Error(`name ${value} not listed`); return i; };
  const bodies = objects.map(object => {
    const values = object.fields.map(field => { const w = new Bytes(); field.write(w); return w.done(); });
    const w = new Bytes();
    w.u16(object.fields.length);
    let offset = 2 + 8 * object.fields.length;
    object.fields.forEach((field, i) => { w.u16(nameIndex(field.name)).u16(nameIndex(field.type)).u32(offset); offset += values[i]!.length; });
    for (const value of values) w.bytes(value);
    return { type: object.type, bytes: w.done() };
  });
  // Sections after the CRUIDs: ref descriptors, ref data, name descriptors, name data, chunk descriptors, chunk data.
  const refData = refs.map(ref => new TextEncoder().encode(ref.path));
  const nameData = names.map(name => new TextEncoder().encode(name));
  const refDesc = 0, refDataAt = refs.length * 4;
  const nameDesc = refDataAt + refData.reduce((sum, b) => sum + b.length, 0);
  const nameDataAt = nameDesc + names.length * 4;
  const chunkDesc = nameDataAt + nameData.reduce((sum, b) => sum + b.length + 1, 0);
  const chunkData = chunkDesc + bodies.length * 8;
  const w = new Bytes();
  w.u8(4).u8(2).u16(7).u32(options.cruids.length).u32(refDesc).u32(refDataAt).u32(nameDesc).u32(nameDataAt).u32(chunkDesc).u32(chunkData);
  w.i16(options.rootIndex).u16(options.cruids.length);
  for (const cruid of options.cruids) w.u64(cruid);
  let at = refDataAt;
  refs.forEach((ref, i) => { w.u32(((ref.sync ? 1 : 0) << 31 | refData[i]!.length << 23 | at) >>> 0); at += refData[i]!.length; });
  for (const data of refData) w.bytes(data);
  at = nameDataAt;
  names.forEach((_, i) => { w.u32(((nameData[i]!.length + 1) << 24 | at) >>> 0); at += nameData[i]!.length + 1; });
  for (const data of nameData) w.bytes(data).u8(0);
  at = chunkData;
  for (const body of bodies) { w.u32(nameIndex(body.type)).u32(at); at += body.bytes.length; }
  for (const body of bodies) w.bytes(body.bytes);
  return w.done();
}
