import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DecodeBudget, LEVELDB_BLOCK_BYTES, readLevelDb, readLogRecords, readTable, snappyDecompress, type LevelDbFile } from "../src/leveldb-read";

// A minimal LevelDB writer for fixtures, following google/leveldb doc/log_format.md and doc/table_format.md.
const enc = new TextEncoder();
const varint = (value: number | bigint) => {
  const out: number[] = []; let v = BigInt(value);
  do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; out.push(b); } while (v);
  return out;
};
const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
const u64 = (v: bigint) => Array.from({ length: 8 }, (_, i) => Number((v >> BigInt(8 * i)) & 0xffn));
const slice = (bytes: number[] | Uint8Array) => [...varint(bytes.length), ...bytes];
/** A log file holding `records`, fragmented across 32 KiB blocks as LevelDB does. */
function logFile(records: number[][]): Uint8Array {
  const out: number[] = [];
  for (const record of records) {
    let rest = record, first = true;
    do {
      const left = 32768 - (out.length % 32768);
      if (left < 7) { out.push(...new Array(left).fill(0)); continue; }
      const room = left - 7, part = rest.slice(0, room), last = part.length === rest.length;
      const type = first && last ? 1 : first ? 2 : last ? 4 : 3;
      out.push(0, 0, 0, 0, part.length & 255, part.length >> 8, type, ...part);
      rest = rest.slice(part.length); first = false;
    } while (rest.length);
  }
  return new Uint8Array(out);
}
const batch = (seq: bigint, ops: [string, string | null][]) => [...u64(seq), ...u32(ops.length),
  ...ops.flatMap(([key, value]) => value === null ? [0, ...slice(enc.encode(key))] : [1, ...slice(enc.encode(key)), ...slice(enc.encode(value))])];
/** A table with one uncompressed data block (no prefix sharing) and its index. */
function table(entries: [string, string | null, bigint][]): Uint8Array {
  const block = (rows: [number[], number[]][]) => [...rows.flatMap(([k, v]) => [0, ...varint(k.length), ...varint(v.length), ...k, ...v]), ...u32(0), ...u32(1)];
  const ikey = (key: string, seq: bigint, value: boolean) => [...enc.encode(key), ...u64((seq << 8n) | (value ? 1n : 0n))];
  const data = block(entries.map(([k, v, s]) => [ikey(k, s, v !== null), [...enc.encode(v ?? "")]]));
  const out = [...data, 0, 0, 0, 0, 0];
  const last = entries.at(-1)!;
  const index = block([[ikey(last[0], last[2], true), [...varint(0), ...varint(data.length)]]]);
  const indexOffset = out.length;
  out.push(...index, 0, 0, 0, 0, 0);
  const footer = [...varint(0), ...varint(0), ...varint(indexOffset), ...varint(index.length)];
  out.push(...footer, ...new Array(40 - footer.length).fill(0), ...u64(0xdb4775248b80fb57n));
  return new Uint8Array(out);
}
const manifest = (logNumber: number, tables: number[], deleted: number[] = []) => logFile([[
  ...varint(1), ...slice(enc.encode("leveldb.BytewiseComparator")), ...varint(2), ...varint(logNumber),
  ...tables.flatMap(n => [...varint(7), ...varint(0), ...varint(n), ...varint(100), ...slice(enc.encode("a")), ...slice(enc.encode("z"))]),
  ...deleted.flatMap(n => [...varint(6), ...varint(0), ...varint(n)]),
]]);

test("Snappy literals and back-references decompress", () => {
  expect(new TextDecoder().decode(snappyDecompress(new Uint8Array([9, 0x08, 97, 98, 99, 0x09, 0x03])))).toBe("abcabcabc");
  // A two-byte-offset copy (kind 2) of length 4 at offset 3.
  expect(new TextDecoder().decode(snappyDecompress(new Uint8Array([7, 0x08, 120, 121, 122, 0x0e, 3, 0])))).toBe("xyzxyzx");
  expect(() => snappyDecompress(new Uint8Array([5, 0x09, 0x03]))).toThrow();
});

test("log records are reassembled across block boundaries", () => {
  const big = Array.from({ length: 70000 }, (_, i) => i & 255);
  const { records, problems } = readLogRecords(logFile([[1, 2, 3], big, [4]]));
  expect(problems).toEqual([]);
  expect(records.map(r => r.length)).toEqual([3, 70000, 1]);
  expect(records[1]![69999]).toBe(big[69999]);
});

test("tables yield internal entries with sequence numbers and deletions", () => {
  const rows = readTable(table([["a###x", "1", 5n], ["b###y", null, 6n]]));
  expect(rows.map(r => [new TextDecoder().decode(r.key), r.value && new TextDecoder().decode(r.value), r.seq]))
    .toEqual([["a###x", "1", 5n], ["b###y", null, 6n]]);
  expect(() => readTable(new Uint8Array(60))).toThrow();
});

test("a database directory resolves the newest value of each key from its live files", () => {
  const files = [
    { name: "CURRENT", bytes: enc.encode("MANIFEST-000004\n") },
    { name: "MANIFEST-000004", bytes: manifest(7, [3, 5], [5]) },
    { name: "000003.ldb", bytes: table([["app###instanceId", "\"one\"", 1n], ["settings###x", "1", 2n]]) },
    // Deleted from the version by the MANIFEST: not read.
    { name: "000005.ldb", bytes: table([["stale###key", "\"stale\"", 3n]]) },
    // Older than the MANIFEST's log number: already in tables.
    { name: "000006.log", bytes: logFile([batch(1n, [["old###key", "\"old\""]])]) },
    { name: "000007.log", bytes: logFile([batch(10n, [["settings###x", "2"], ["app###instanceId", null], ["new###k", "\"v\""]])]) },
  ];
  const read = readLevelDb(files);
  expect(read.mode).toBe("manifest");
  expect(read.gaps).toEqual([]);
  expect([...read.entries]).toEqual([["new###k", "\"v\""], ["settings###x", "2"]]);
  expect([read.tablesRead, read.logsRead]).toEqual([1, 1]);
});

test("without a readable MANIFEST every file is read and the gap is reported", () => {
  const read = readLevelDb([
    { name: "CURRENT", bytes: enc.encode("MANIFEST-000004\n") },
    { name: "MANIFEST-000004", bytes: null },
    { name: "000003.ldb", bytes: table([["k", "\"table\"", 1n]]) },
    { name: "000007.log", bytes: null },
  ]);
  expect(read.mode).toBe("all-files");
  expect([...read.entries]).toEqual([["k", "\"table\""]]);
  expect(read.gaps.join(" ")).toContain("MANIFEST-000004 could not be read");
  expect(read.gaps.join(" ")).toContain("000007.log could not be read");
});

// Real databases from experiment 023 (Vortex 2.7.1 in Windows Sandbox): see tests/fixtures/vortex/sandbox-023.
const sandbox = join(import.meta.dir, "fixtures", "vortex", "sandbox-023");
const dbFiles = (dir: string, unreadable: string[] = []): LevelDbFile[] => [
  ...readdirSync(join(sandbox, dir)).map(name => ({ name, bytes: new Uint8Array(readFileSync(join(sandbox, dir, name))) })),
  ...unreadable.map(name => ({ name, bytes: null })),
];

test("Vortex's closed state.v2 reads through its MANIFEST, including a Snappy-compressed table", () => {
  const read = readLevelDb(dbFiles("state.v2-closed"));
  expect(read.mode).toBe("manifest");
  expect(read.gaps).toEqual([]);
  expect([read.tablesRead, read.logsRead]).toEqual([1, 1]);
  expect(read.entries.get("app###instanceId")).toBe(JSON.stringify("bd4ee12d-7bf6-4784-a79f-fb54a81f527f"));
  expect(read.entries.get("persistent###profiles###xfstest###modState###XF Test Mod D###enabled")).toBe("true");
  expect(read.entries.get("persistent###mods###cyberpunk2077###XF Test Mod A###attributes###fileName")).toBe(JSON.stringify("XF Test Mod A.zip"));
  expect(read.entries.get("settings###nexus###associateNXM")).toBe("false");
});

test("while Vortex runs, its MANIFEST and newest log are locked and only earlier sessions' tables can be read", () => {
  // The two files another process could not open during the run (sharing violation), as a directory listing reports them.
  const read = readLevelDb(dbFiles("state.v2-live", ["MANIFEST-000034", "000036.log"]));
  expect(read.mode).toBe("all-files");
  expect(read.gaps).toEqual(["MANIFEST-000034 could not be read; every table and log present was read instead.", "000036.log could not be read."]);
  expect(read.tablesRead).toBe(11);
  // Only the state seeded before Vortex started: none of the session's installs, not even its new instance id.
  expect(read.entries.has("app###instanceId")).toBe(false);
  expect([...read.entries.keys()].some(key => key.startsWith("persistent###mods###"))).toBe(false);
  expect(read.entries.get("settings###profiles###activeProfileId")).toBe(JSON.stringify("xfstest"));
});

// VORTEX-02: another program's files may be damaged or hostile; decoding them is bounded.
/** A literal-only Snappy block of `data` (valid, if uncompressed). */
const snappyLiteral = (data: number[]) => {
  const out = [...varint(data.length)];
  for (let at = 0; at < data.length; at += 65536) {
    const part = data.slice(at, at + 65536), n = part.length - 1;
    out.push(n < 60 ? n << 2 : n < 256 ? 60 << 2 : 61 << 2, ...(n < 60 ? [] : n < 256 ? [n] : [n & 255, n >> 8]), ...part);
  }
  return out;
};
/** A table whose one Snappy data block is listed `handles` times by its index. */
function repeatedBlockTable(handles: number, rows = 200): Uint8Array {
  const ikey = (key: string, seq: bigint) => [...enc.encode(key), ...u64((seq << 8n) | 1n)];
  const plain = [...Array.from({ length: rows }, (_, i) => ikey(`k###${String(i).padStart(5, "0")}`, BigInt(i + 1)))
    .flatMap(k => [0, ...varint(k.length), ...varint(1), ...k, 49]), ...u32(0), ...u32(1)];
  const data = snappyLiteral(plain);
  const out = [...data, 1, 0, 0, 0, 0];
  const handle = [...varint(0), ...varint(data.length)];
  const index = [...Array.from({ length: handles }, (_, i) => ikey(`k###${String(i).padStart(9, "0")}`, 1n))
    .flatMap(k => [0, ...varint(k.length), ...varint(handle.length), ...k, ...handle]), ...u32(0), ...u32(1)];
  const indexOffset = out.length;
  out.push(...index, 0, 0, 0, 0, 0);
  const footer = [...varint(0), ...varint(0), ...varint(indexOffset), ...varint(index.length)];
  out.push(...footer, ...new Array(40 - footer.length).fill(0), ...u64(0xdb4775248b80fb57n));
  return new Uint8Array(out);
}

test("a Snappy header claiming more than its bytes can hold, or than the limit, is refused before anything is allocated", () => {
  // A megabyte claimed by a five-byte block.
  expect(() => snappyDecompress(new Uint8Array([...varint(1 << 20), 0x00, 97]))).toThrow("more than 5 compressed bytes can hold");
  expect(() => snappyDecompress(new Uint8Array(snappyLiteral([1, 2, 3, 4])), 3)).toThrow("more than the 3-byte limit");
  const budget = new DecodeBudget(3);
  expect(() => snappyDecompress(new Uint8Array(snappyLiteral([1, 2, 3, 4])), 64, budget)).toThrow("decoding budget");
  // A literal running past the claimed length is corrupt, not an overflow of the output.
  expect(() => snappyDecompress(new Uint8Array([2, 0x08, 97, 98, 99]))).toThrow("bad snappy literal");
});

test("a block listed many times by a table's index is decoded once", () => {
  const once = new DecodeBudget(Number.MAX_SAFE_INTEGER), many = new DecodeBudget(Number.MAX_SAFE_INTEGER);
  const one = readTable(repeatedBlockTable(1), undefined, once), repeated = readTable(repeatedBlockTable(2000), undefined, many);
  expect(repeated.length).toBe(one.length);
  // Only the index grows with the handles; the data block is decompressed once, not 2,000 times.
  expect(many.spent - once.spent).toBeLessThan(2000 * 30);
  expect(many.spent).toBeLessThan(3 * once.spent + 2000 * 30);
});

test("a database whose decoding passes its budget reports the table as a gap and still reads the rest", () => {
  // Every key shares the whole previous key and adds one byte: the expanded keys grow quadratically with the entries.
  const rows = 3000, entries: number[] = [];
  for (let i = 0; i < rows; i++) entries.push(...varint(i === 0 ? 0 : i + 8), ...varint(i === 0 ? 9 : 1), ...varint(0), ...(i === 0 ? [...enc.encode("k"), ...u64(1n << 8n | 1n)] : [65]));
  const block = [...entries, ...u32(0), ...u32(1)];
  const growing = [...block, 0, 0, 0, 0, 0];
  const handle = [...varint(0), ...varint(block.length)];
  const index = [0, ...varint(9), ...varint(handle.length), ...enc.encode("k"), ...u64(1n << 8n | 1n), ...handle, ...u32(0), ...u32(1)];
  const indexOffset = growing.length;
  growing.push(...index, 0, 0, 0, 0, 0);
  const footer = [...varint(0), ...varint(0), ...varint(indexOffset), ...varint(index.length)];
  growing.push(...footer, ...new Array(40 - footer.length).fill(0), ...u64(0xdb4775248b80fb57n));
  const read = readLevelDb([
    { name: "CURRENT", bytes: enc.encode("MANIFEST-000004\n") },
    { name: "MANIFEST-000004", bytes: manifest(7, [3, 5]) },
    { name: "000003.ldb", bytes: new Uint8Array(growing) },
    { name: "000005.ldb", bytes: table([["ok###key", "1", 2n]]) },
  ], { maxBlockBytes: LEVELDB_BLOCK_BYTES, maxDecodedBytes: 1_000_000 });
  expect(read.gaps.filter(gap => gap.startsWith("000003.ldb:") && gap.includes("decoding budget")), read.gaps.join("; ")).toHaveLength(1);
  expect(read.entries.get("ok###key")).toBe("1");
});
