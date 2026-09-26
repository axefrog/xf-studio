import { expect, test } from "bun:test";
import { readLevelDb, readLogRecords, readTable, snappyDecompress } from "../src/leveldb-read";

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
