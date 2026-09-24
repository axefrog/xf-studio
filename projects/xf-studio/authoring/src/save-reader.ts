/** Read-only, bounded CSAV appearance reader. Format references: README.md.
 * No save writer, filesystem access, compression or game deployment exists here.
 */
export class Reader {
  pos = 0;
  view: DataView;
  constructor(public bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  take(n: number) {
    if (!Number.isSafeInteger(n) || n < 0 || this.pos + n > this.bytes.length)
      throw Error("Truncated or invalid save data");
    const b = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
  u8() {
    return this.take(1)[0];
  }
  u32() {
    const p = this.pos;
    this.take(4);
    return this.view.getUint32(p, true);
  }
  i32() {
    const p = this.pos;
    this.take(4);
    return this.view.getInt32(p, true);
  }
  u64() {
    const p = this.pos;
    this.take(8);
    return this.view.getBigUint64(p, true).toString();
  }
  bool() {
    const b = this.u8();
    if (b > 1) throw Error("Invalid boolean");
    return b === 1;
  }
  vlq() {
    const b = this.u8(),
      negative = !!(b & 128);
    let n = b & 63,
      more = !!(b & 64),
      shift = 6;
    while (more) {
      if (shift > 27) throw Error("Invalid VLQ");
      const q = this.u8();
      n += (q & 127) * 2 ** shift;
      more = !!(q & 128);
      shift += 7;
    }
    if (n > 0x7fffffff) throw Error("VLQ overflow");
    return negative ? -n : n;
  }
  text() {
    const n = this.vlq();
    if (Math.abs(n) > 65536) throw Error("Save string too long");
    return new TextDecoder(n > 0 ? "utf-16le" : "utf-8", {
      fatal: true,
    }).decode(this.take(Math.abs(n) * (n > 0 ? 2 : 1)));
  }
  count(max = 4096) {
    const n = this.u32();
    if (n > max) throw Error("Save collection exceeds supported size");
    return n;
  }
}
export function decodeLz4(input: Uint8Array, size: number): Uint8Array {
  if (size < 0 || size > 16 * 1024 * 1024)
    throw Error("Unsupported chunk size");
  const r = new Reader(input),
    out = new Uint8Array(size);
  let pos = 0;
  const length = (base: number) => {
    let n = base;
    if (base === 15) {
      let b;
      do {
        b = r.u8();
        n += b;
      } while (b === 255);
    }
    return n;
  };
  while (r.pos < input.length) {
    const token = r.u8(),
      literal = length(token >>> 4);
    if (pos + literal > size) throw Error("LZ4 literal overflow");
    out.set(r.take(literal), pos);
    pos += literal;
    if (r.pos === input.length) break;
    const offset = r.u8() + r.u8() * 256,
      match = length(token & 15) + 4;
    if (offset === 0 || offset > pos || pos + match > size)
      throw Error("Invalid LZ4 match");
    for (let k = 0; k < match; k++) out[pos + k] = out[pos + k - offset];
    pos += match;
  }
  if (pos !== size) throw Error("LZ4 output size mismatch");
  return out;
}
export type Appearance = {
  resourceHash: string;
  definition: string;
  name: string;
  censorFlag: number;
  censorAction: number;
};
export type Morph = {
  region: string;
  target: string;
  censorFlag: number;
  censorAction: number;
};
export type CustomizationGroup = {
  name: string;
  appearances: Appearance[];
  morphs: Morph[];
};
export type SavedV = {
  schema: "eye-artistry/saved-v-1";
  saveVersion: number;
  gameVersion: number;
  presetVersion: number;
  isMale: boolean;
  brainIsMale: boolean;
  groups: {
    head: CustomizationGroup[];
    arms: CustomizationGroup[];
    body: CustomizationGroup[];
  };
  perspectives: { name: string; fpp: string; tpp: string }[];
  tags: string[];
  evidence: {
    nodeName: string;
    nodeBytes: number;
    bytesRead: number;
    trailingBytes: number;
    chunks: number;
    decompressedBytes: number;
  };
};
/** Validate decoded browser storage without retaining raw save bytes. */
export function parseSavedV(value: unknown): SavedV {
  const v = value as SavedV;
  const text = (x: unknown): x is string => typeof x === "string" && x.length <= 65536;
  const uint = (x: unknown) => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 0xffffffff;
  const array = <T>(x: unknown, valid: (item: T) => boolean): x is T[] =>
    Array.isArray(x) && x.length <= 4096 && x.every(item => item && valid(item));
  const group = (g: CustomizationGroup) => text(g.name) &&
    array<Appearance>(g.appearances, a => text(a.resourceHash) && /^\d{1,20}$/.test(a.resourceHash) &&
      text(a.definition) && text(a.name) && uint(a.censorFlag) && uint(a.censorAction)) &&
    array<Morph>(g.morphs, m => text(m.region) && text(m.target) && uint(m.censorFlag) && uint(m.censorAction));
  if (!v || v.schema !== "eye-artistry/saved-v-1" || !uint(v.saveVersion) || !uint(v.gameVersion) ||
    !uint(v.presetVersion) || typeof v.isMale !== "boolean" || typeof v.brainIsMale !== "boolean" ||
    !v.groups || ![v.groups.head, v.groups.arms, v.groups.body].every(x => array(x, group)) ||
    !array<SavedV["perspectives"][number]>(v.perspectives, p => text(p.name) && text(p.fpp) && text(p.tpp)) ||
    !Array.isArray(v.tags) || v.tags.length > 4096 || !v.tags.every(text) || !v.evidence ||
    !text(v.evidence.nodeName) || ![v.evidence.nodeBytes, v.evidence.bytesRead, v.evidence.trailingBytes,
      v.evidence.chunks, v.evidence.decompressedBytes].every(uint))
    throw Error("Invalid stored V appearance");
  return structuredClone(v);
}
export function readSavedV(bytes: Uint8Array): SavedV {
  if (bytes.length < 40 || bytes.length > 128 * 1024 * 1024)
    throw Error("Unsupported save size");
  const r = new Reader(bytes);
  if (r.u32() !== 0x43534156)
    throw Error("This is not a Cyberpunk sav.dat file");
  const saveVersion = r.u32(),
    gameVersion = r.u32();
  r.text();
  r.u64();
  r.u32();
  if (gameVersion < 2000 || gameVersion > 2310)
    throw Error(
      `Save game version ${gameVersion} is outside the researched 2.0–2.31 range`,
    );
  const table = r.pos;
  if (new TextDecoder().decode(r.take(4)) !== "FZLC")
    throw Error("Unsupported compression table");
  const chunkCount = r.count(4096);
  if (!chunkCount) throw Error("Empty save");
  const chunks = Array.from({ length: chunkCount }, () => ({
    offset: r.u32(),
    compressed: r.u32(),
    size: r.u32(),
  }));
  const dataStart = chunks[0].offset;
  if (
    dataStart < table + 8 + chunkCount * 12 ||
    dataStart > 2 * 1024 * 1024 ||
    (dataStart - table - 8) % 12
  )
    throw Error("Invalid chunk table offsets");
  const footer = new Reader(bytes.subarray(bytes.length - 8)),
    index = footer.u32();
  if (footer.u32() !== 0x444f4e45 || index >= bytes.length - 8)
    throw Error("Invalid save footer");
  let total = dataStart,
    last = dataStart;
  for (const c of chunks) {
    if (
      c.offset !== last ||
      c.compressed < 1 ||
      c.size > 16 * 1024 * 1024 ||
      c.offset + c.compressed > index
    )
      throw Error("Invalid chunk boundaries");
    total += c.size;
    last += c.compressed;
  }
  if (total > 256 * 1024 * 1024)
    throw Error("Decompressed save exceeds the preview limit");
  const expanded = new Uint8Array(total);
  let cursor = dataStart;
  for (const c of chunks) {
    const raw = bytes.subarray(c.offset, c.offset + c.compressed),
      part = new Reader(raw);
    let out: Uint8Array;
    if (new TextDecoder().decode(raw.subarray(0, 4)) === "4ZLX") {
      part.take(4);
      if (part.u32() !== c.size) throw Error("Chunk length mismatch");
      out = decodeLz4(raw.subarray(8), c.size);
    } else {
      if (c.size !== c.compressed)
        throw Error("Unsupported uncompressed chunk");
      out = raw;
    }
    expanded.set(out, cursor);
    cursor += out.length;
  }
  const directory = new Reader(bytes.subarray(index, bytes.length - 8));
  if (directory.u32() !== 0x4e4f4445) throw Error("Missing node directory");
  const count = directory.vlq();
  if (count < 1 || count > 200000) throw Error("Invalid node count");
  let target: { name: string; offset: number; size: number } | undefined;
  for (let i = 0; i < count; i++) {
    const name = directory.text();
    directory.i32();
    directory.i32();
    const offset = directory.u32(),
      size = directory.u32();
    if (name === "CharacetrCustomization_Appearances") {
      if (target) throw Error("Ambiguous appearance nodes");
      target = { name, offset, size };
    }
  }
  if (
    !target ||
    target.offset < dataStart ||
    target.offset + target.size > expanded.length
  )
    throw Error("Appearance node missing or out of bounds");
  const n = new Reader(
    expanded.subarray(target.offset, target.offset + target.size),
  );
  n.u32();
  const exists = n.bool();
  n.u32();
  if (!exists) throw Error("Save contains no player appearance");
  const presetVersion = n.u32(),
    isMale = n.bool(),
    brainIsMale = n.bool();
  const array = <T>(fn: () => T) => Array.from({ length: n.count() }, fn);
  const groups = (): CustomizationGroup[] =>
    array(() => ({
      name: n.text(),
      appearances: array(() => ({
        resourceHash: n.u64(),
        definition: n.text(),
        name: n.text(),
        censorFlag: n.u32(),
        censorAction: n.u32(),
      })),
      morphs: array(() => ({
        region: n.text(),
        target: n.text(),
        censorFlag: n.u32(),
        censorAction: n.u32(),
      })),
    }));
  const head = groups(),
    arms = groups(),
    body = groups(),
    perspectives = array(() => ({
      name: n.text(),
      fpp: n.text(),
      tpp: n.text(),
    }));
  const tagCount = n.vlq();
  if (tagCount < 0 || tagCount > 4096) throw Error("Invalid tag count");
  const tags = Array.from({ length: tagCount }, () => n.text());
  const trailingBytes = n.bytes.length - n.pos;
  if (trailingBytes)
    throw Error(
      `Appearance node has ${trailingBytes} unparsed bytes; refusing an incomplete preset`,
    );
  return {
    schema: "eye-artistry/saved-v-1",
    saveVersion,
    gameVersion,
    presetVersion,
    isMale,
    brainIsMale,
    groups: { head, arms, body },
    perspectives,
    tags,
    evidence: {
      nodeName: target.name,
      nodeBytes: target.size,
      bytesRead: n.pos,
      trailingBytes,
      chunks: chunkCount,
      decompressedBytes: total,
    },
  };
}
