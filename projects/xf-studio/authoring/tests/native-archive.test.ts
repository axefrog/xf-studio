import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { depotHash } from "../src/depot-path";
import { NativeArchive, NativeArchivePool } from "../src/native/archive-reader";
import { decodeSegment, SegmentError } from "../src/native/kark";
import { parseRdarHeader, RdarIndex } from "../src/native/rdar-archive";
import { fakeDecompress, kark, syntheticArchive } from "./fixtures/native-archive";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const bytes = (...values: number[]) => new Uint8Array(values);
const write = (name: string, data: Uint8Array) => {
  const root = mkdtempSync(join(tmpdir(), "xfs-native-archive-")); roots.push(root);
  const path = join(root, name); writeFileSync(path, data); return path;
};

test("the header and index parse into entries, segments and dependencies", () => {
  const data = syntheticArchive([
    { path: "base\\a.mi", segments: [{ bytes: bytes(1, 2, 3) }], dependencies: ["base\\t.mt"] },
    { path: "base\\b.mesh", segments: [{ bytes: bytes(4, 5, 6, 7), compress: true }, { bytes: bytes(8, 9), compress: true }], inlineBuffers: 1 },
  ]);
  const header = parseRdarHeader(data);
  expect(header).toMatchObject({ version: 12, fileSize: data.length, customDataLength: 0 });
  const index = new RdarIndex(header, data.subarray(header.indexOffset, header.indexOffset + header.indexSize));
  expect([...index.entries()].map(entry => entry.hash).sort()).toEqual([depotHash("base\\a.mi"), depotHash("base\\b.mesh")].sort());
  const a = index.entry(depotHash("base\\a.mi"))!;
  const b = index.entry(depotHash("base\\b.mesh"))!;
  expect(index.dependencies(a)).toEqual([depotHash("base\\t.mt")]);
  expect(b.inlineBuffers).toBe(1);
  expect(index.size(b)).toBe(6);
  expect(index.entry(depotHash("base\\none.mi"))).toBeNull();
  expect(() => parseRdarHeader(bytes(1, 2, 3))).toThrow("Truncated");
  expect(() => parseRdarHeader(new Uint8Array(44))).toThrow("Not an RDAR");
});

test("a read decodes the body and keeps buffers as stored, like an extractor", () => {
  const body = bytes(10, 20, 30, 40), buffer = bytes(50, 60);
  const path = write("x.archive", syntheticArchive([
    { path: "base\\b.mesh", segments: [{ bytes: body, compress: true }, { bytes: buffer, compress: true }] },
    { path: "base\\raw.mi", segments: [{ bytes: bytes(7, 7) }] },
  ], { gap: true }));
  const archive = NativeArchive.open(path, fakeDecompress);
  try {
    expect(archive.read(depotHash("base\\b.mesh"))).toEqual(new Uint8Array([...body, ...kark(buffer)]));
    expect(archive.read(depotHash("base\\raw.mi"))).toEqual(bytes(7, 7));
    expect(archive.read(depotHash("base\\missing.mi"))).toBeNull();
    expect(archive.names()).toEqual([]);
  } finally { archive.close(); }
});

test("an LXRS block lists the archive's own paths", () => {
  const path = write("named.archive", syntheticArchive([{ path: "mod\\x.app", segments: [{ bytes: bytes(1) }] },
    { path: "mod\\y.ent", segments: [{ bytes: bytes(2) }] }], { names: true }));
  const archive = NativeArchive.open(path, fakeDecompress);
  try { expect(archive.names()).toEqual(["mod\\x.app", "mod\\y.ent"]); } finally { archive.close(); }
});

test("segments are checked: sizes must agree and a compressed segment needs its KARK header", () => {
  const good = kark(bytes(1, 2, 3));
  expect(decodeSegment(good, 3, fakeDecompress)).toEqual(bytes(1, 2, 3));
  expect(() => decodeSegment(good, 4, fakeDecompress)).toThrow(SegmentError);
  expect(() => decodeSegment(bytes(1, 2, 3, 4, 5, 6, 7, 8, 9), 20, fakeDecompress)).toThrow("without a KARK header");
  expect(decodeSegment(bytes(9, 9), 2, () => { throw Error("not called"); })).toEqual(bytes(9, 9));
});

test("the pool reuses open archives, bounds how many stay open and reopens a changed file", () => {
  const first = write("one.archive", syntheticArchive([{ path: "a\\1.mi", segments: [{ bytes: bytes(1) }] }]));
  const second = write("two.archive", syntheticArchive([{ path: "a\\2.mi", segments: [{ bytes: bytes(2) }] }]));
  const pool = new NativeArchivePool(fakeDecompress, 1);
  try {
    const one = pool.get(first);
    expect(pool.get(first)).toBe(one);
    pool.get(second);
    expect(() => one.read(depotHash("a\\1.mi"))).toThrow("closed");
    const reopened = pool.get(first);
    expect(reopened).not.toBe(one);
    writeFileSync(first, syntheticArchive([{ path: "a\\3.mi", segments: [{ bytes: bytes(3, 3) }] }]));
    expect(pool.read(first, depotHash("a\\3.mi"))).toEqual(bytes(3, 3));
    writeFileSync(first, syntheticArchive([{ path: "a\\4.mi", segments: [{ bytes: bytes(4, 4, 4) }] }]));
    expect(pool.get(first).read(depotHash("a\\4.mi"))).toEqual(bytes(4, 4, 4));
  } finally { pool.close(); }
});
