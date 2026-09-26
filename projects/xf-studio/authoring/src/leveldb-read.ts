/**
 * A small read-only LevelDB reader: enough to read another program's database files without opening the database, so its
 * `LOCK` is never taken and nothing is written. Pure: callers pass the directory's file names and bytes (null for a file
 * that could not be read) and get the live key/value pairs back. Used for Vortex's `state.v2` (vortex-state.ts).
 *
 * Formats follow the LevelDB documentation and source (google/leveldb `doc/log_format.md`, `doc/table_format.md`,
 * `db/version_edit.cc`, `db/write_batch.cc`, `table/format.cc`): the MANIFEST and write-ahead logs are 32 KiB-block
 * record logs; tables end in a 48-byte footer whose index block points at prefix-compressed data blocks, each
 * uncompressed or Snappy-compressed. Internal keys carry an 8-byte trailer of `(sequence << 8) | type`.
 *
 * Which files are live comes from `CURRENT` → `MANIFEST-n` (tables added minus tables deleted, and logs numbered at or
 * above the recorded log number). When the MANIFEST can't be read (another process holds it open), every table and log
 * present is read instead and the newest sequence number of each key wins; that is right unless a stale table survived a
 * compaction that dropped a deletion, so the result says which way it was read.
 */

export interface LevelDbFile { readonly name: string; readonly bytes: Uint8Array | null }
export interface LevelDbRead {
  /** Live pairs, keys and values decoded as UTF-8 (Vortex stores text). */
  readonly entries: ReadonlyMap<string, string>;
  /** `manifest`: the live file set came from the MANIFEST. `all-files`: every table and log present was read. */
  readonly mode: "manifest" | "all-files";
  /** Files that should have been read but could not be (e.g. a log held open by the writer), and format problems. */
  readonly gaps: readonly string[];
  readonly tablesRead: number;
  readonly logsRead: number;
}

type Entry = { key: Uint8Array; value: Uint8Array | null; seq: bigint };
const utf8 = new TextDecoder("utf-8", { fatal: false });

class Cursor {
  constructor(readonly bytes: Uint8Array, public pos = 0, readonly end = bytes.length) {}
  get done() { return this.pos >= this.end; }
  byte() { if (this.pos >= this.end) throw Error("truncated"); return this.bytes[this.pos++]!; }
  varint(): bigint {
    let result = 0n, shift = 0n;
    for (let i = 0; i < 10; i++) {
      const b = this.byte();
      result |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return result;
      shift += 7n;
    }
    throw Error("bad varint");
  }
  varint32() { return Number(this.varint()); }
  take(length: number) {
    if (length < 0 || this.pos + length > this.end) throw Error("truncated");
    const out = this.bytes.subarray(this.pos, this.pos + length); this.pos += length; return out;
  }
  slice() { return this.take(this.varint32()); }
  fixed64() { const view = this.take(8); return new DataView(view.buffer, view.byteOffset, 8).getBigUint64(0, true); }
  fixed32() { const view = this.take(4); return new DataView(view.buffer, view.byteOffset, 4).getUint32(0, true); }
}

/** Snappy block decompression (the raw format, not the framing format). */
export function snappyDecompress(input: Uint8Array): Uint8Array {
  const cursor = new Cursor(input);
  const length = cursor.varint32();
  const out = new Uint8Array(length);
  let o = 0;
  while (!cursor.done) {
    const tag = cursor.byte();
    const kind = tag & 3;
    if (kind === 0) {
      let len = tag >> 2;
      if (len >= 60) { const bytes = len - 59; len = 0; for (let i = 0; i < bytes; i++) len |= cursor.byte() << (8 * i); }
      len += 1;
      out.set(cursor.take(len), o); o += len;
      continue;
    }
    let len: number, offset: number;
    if (kind === 1) { len = ((tag >> 2) & 7) + 4; offset = ((tag >> 5) << 8) | cursor.byte(); }
    else if (kind === 2) { len = (tag >> 2) + 1; offset = cursor.byte() | (cursor.byte() << 8); }
    else { len = (tag >> 2) + 1; offset = (cursor.byte() | (cursor.byte() << 8) | (cursor.byte() << 16) | (cursor.byte() << 24)) >>> 0; }
    if (offset === 0 || offset > o || o + len > length) throw Error("bad snappy copy");
    for (let i = 0; i < len; i++, o++) out[o] = out[o - offset]!;
  }
  if (o !== length) throw Error("snappy length mismatch");
  return out;
}

const BLOCK = 32768;
/** The records of a LevelDB log file (write-ahead log or MANIFEST), reassembled from their fragments. */
export function readLogRecords(bytes: Uint8Array): { records: Uint8Array[]; problems: string[] } {
  const records: Uint8Array[] = [], problems: string[] = [];
  let pending: Uint8Array[] | null = null;
  let pos = 0;
  while (pos + 7 <= bytes.length) {
    const blockLeft = BLOCK - (pos % BLOCK);
    if (blockLeft < 7) { pos += blockLeft; continue; }
    const length = bytes[pos + 4]! | (bytes[pos + 5]! << 8), type = bytes[pos + 6]!;
    if (type === 0 && length === 0) { pos += blockLeft; continue; } // preallocated or padded space
    if (pos + 7 + length > bytes.length) { problems.push("log ends inside a record"); break; }
    const data = bytes.subarray(pos + 7, pos + 7 + length);
    pos += 7 + length;
    if (type === 1) { if (pending) problems.push("unfinished record dropped"); pending = null; records.push(data); }
    else if (type === 2) { if (pending) problems.push("unfinished record dropped"); pending = [data]; }
    else if (type === 3) { if (pending) pending.push(data); }
    else if (type === 4) {
      if (!pending) continue;
      pending.push(data);
      const total = pending.reduce((sum, part) => sum + part.length, 0), whole = new Uint8Array(total);
      let at = 0; for (const part of pending) { whole.set(part, at); at += part.length; }
      records.push(whole); pending = null;
    } else { problems.push(`unknown log record type ${type}`); break; }
  }
  return { records, problems };
}

/** The operations of a write-ahead log (WriteBatch records). */
function readWriteBatches(bytes: Uint8Array, problems: string[]): Entry[] {
  const out: Entry[] = [];
  const read = readLogRecords(bytes);
  problems.push(...read.problems);
  for (const record of read.records) {
    try {
      const cursor = new Cursor(record);
      let seq = cursor.fixed64();
      const count = cursor.fixed32();
      for (let i = 0; i < count; i++, seq++) {
        const tag = cursor.byte();
        const key = cursor.slice();
        out.push({ key, value: tag === 1 ? cursor.slice() : null, seq });
      }
    } catch (error) { problems.push(`write batch unreadable: ${(error as Error).message}`); }
  }
  return out;
}

function readBlock(bytes: Uint8Array, offset: number, size: number): Uint8Array {
  if (offset + size + 5 > bytes.length) throw Error("block outside the table");
  const data = bytes.subarray(offset, offset + size), type = bytes[offset + size]!;
  if (type === 0) return data;
  if (type === 1) return snappyDecompress(data);
  throw Error(`unsupported block compression ${type}`);
}
function blockEntries(block: Uint8Array): { key: Uint8Array; value: Uint8Array }[] {
  if (block.length < 4) throw Error("short block");
  const view = new DataView(block.buffer, block.byteOffset, block.length);
  const restarts = view.getUint32(block.length - 4, true);
  const end = block.length - 4 - 4 * restarts;
  if (end < 0) throw Error("bad restart count");
  const cursor = new Cursor(block, 0, end);
  const out: { key: Uint8Array; value: Uint8Array }[] = [];
  let last = new Uint8Array(0);
  while (!cursor.done) {
    const shared = cursor.varint32(), unshared = cursor.varint32(), valueLength = cursor.varint32();
    if (shared > last.length) throw Error("bad shared key length");
    const key = new Uint8Array(shared + unshared);
    key.set(last.subarray(0, shared)); key.set(cursor.take(unshared), shared);
    out.push({ key, value: cursor.take(valueLength) });
    last = key;
  }
  return out;
}
const MAGIC = 0xdb4775248b80fb57n;
/** Every internal entry of one table file. */
export function readTable(bytes: Uint8Array): Entry[] {
  if (bytes.length < 48) throw Error("table shorter than its footer");
  const footer = new Cursor(bytes, bytes.length - 48);
  footer.varint(); footer.varint(); // metaindex handle (filters; not needed)
  const indexOffset = Number(footer.varint()), indexSize = Number(footer.varint());
  if (new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 8, 8).getBigUint64(0, true) !== MAGIC) throw Error("not a LevelDB table");
  const out: Entry[] = [];
  for (const { value: handle } of blockEntries(readBlock(bytes, indexOffset, indexSize))) {
    const h = new Cursor(handle);
    const offset = Number(h.varint()), size = Number(h.varint());
    for (const { key, value } of blockEntries(readBlock(bytes, offset, size))) {
      if (key.length < 8) throw Error("internal key without trailer");
      const trailer = new DataView(key.buffer, key.byteOffset + key.length - 8, 8).getBigUint64(0, true);
      out.push({ key: key.subarray(0, key.length - 8), value: (trailer & 0xffn) === 1n ? value : null, seq: trailer >> 8n });
    }
  }
  return out;
}

/** The live table numbers and minimum live log number recorded by a MANIFEST. */
export function readManifest(bytes: Uint8Array): { tables: Set<number>; logNumber: number; problems: string[] } {
  const tables = new Set<number>();
  let logNumber = 0;
  const read = readLogRecords(bytes);
  for (const record of read.records) {
    const c = new Cursor(record);
    while (!c.done) {
      const tag = c.varint32();
      switch (tag) {
        case 1: c.slice(); break; // comparator
        case 2: logNumber = Number(c.varint()); break;
        case 3: case 4: case 9: c.varint(); break; // next file, last sequence, previous log
        case 5: c.varint32(); c.slice(); break; // compaction pointer
        case 6: c.varint32(); tables.delete(Number(c.varint())); break;
        case 7: c.varint32(); tables.add(Number(c.varint())); c.varint(); c.slice(); c.slice(); break;
        default: throw Error(`unknown MANIFEST tag ${tag}`);
      }
    }
  }
  return { tables, logNumber, problems: read.problems };
}

const numberOf = (name: string) => Number(/^(\d+)\.(?:ldb|sst|log)$/i.exec(name)?.[1] ?? NaN);

/** Read a LevelDB directory's live key/value pairs from its files (never its LOCK). */
export function readLevelDb(files: readonly LevelDbFile[]): LevelDbRead {
  const gaps: string[] = [];
  const byName = new Map(files.map(file => [file.name.toUpperCase(), file]));
  let mode: LevelDbRead["mode"] = "all-files";
  let liveTables: Set<number> | null = null, logNumber = 0;
  const current = byName.get("CURRENT");
  const manifestName = current?.bytes ? utf8.decode(current.bytes).trim() : null;
  const manifest = manifestName ? byName.get(manifestName.toUpperCase()) : undefined;
  if (manifest?.bytes) {
    try {
      const read = readManifest(manifest.bytes);
      liveTables = read.tables; logNumber = read.logNumber; mode = "manifest";
      gaps.push(...read.problems.map(problem => `${manifest.name}: ${problem}`));
    } catch (error) { gaps.push(`${manifest.name}: ${(error as Error).message}`); }
  } else gaps.push(manifestName ? `${manifestName} could not be read; every table and log present was read instead.` : "CURRENT could not be read; every table and log present was read instead.");
  const newest = new Map<string, Entry>();
  const add = (entry: Entry) => {
    const key = utf8.decode(entry.key), seen = newest.get(key);
    if (!seen || entry.seq > seen.seq) newest.set(key, entry);
  };
  let tablesRead = 0, logsRead = 0;
  for (const file of files) {
    const number = numberOf(file.name);
    if (Number.isNaN(number)) continue;
    const isLog = /\.log$/i.test(file.name);
    if (liveTables && (isLog ? number < logNumber : !liveTables.has(number))) continue;
    if (!file.bytes) { gaps.push(`${file.name} could not be read.`); continue; }
    try {
      if (isLog) { const problems: string[] = []; readWriteBatches(file.bytes, problems).forEach(add); gaps.push(...problems.map(p => `${file.name}: ${p}`)); logsRead++; }
      else { readTable(file.bytes).forEach(add); tablesRead++; }
    } catch (error) { gaps.push(`${file.name}: ${(error as Error).message}`); }
  }
  if (liveTables) for (const number of liveTables)
    if (![...byName.keys()].some(name => numberOf(name) === number)) gaps.push(`Table ${number} listed by the MANIFEST is missing.`);
  const entries = new Map<string, string>();
  for (const [key, entry] of [...newest.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    if (entry.value) entries.set(key, utf8.decode(entry.value));
  return { entries, mode, gaps, tablesRead, logsRead };
}
