// Regression tests for the native reader reviews at 5e64894 (NATIVE-01..16) and fa74f98 (NATIVE-18..23; the Oodle checks NATIVE-21/22
// are in native-oodle.test.ts), research/authoring/code-health.md. Every hostile input
// here reproduced a hang, a memory blow-up or a silent misread before the fixes; each must now be refused quickly with a typed
// error, or decoded with the right note. Synthetic fixtures only (no game data).
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { depotHash } from "../src/depot-path";
import { ArchiveChangedError, NativeArchive, NativeArchivePool } from "../src/native/archive-reader";
import { Cr2wFile } from "../src/native/cr2w-file";
import { compareDocuments, HASH_ONLY_PATH } from "../src/native/document-diff";
import { DecodeSession, DEFAULT_LIMITS, type NativeLimits } from "../src/native/limits";
import { type DecodeWorker, type NativeDecodeOutcome, type WorkerDecodeMessage, WorkerDecoder, type WorkerDecoderOptions, type WorkerInit } from "../src/native/native-decode";
import { NativeBudgetError, NativeMalformedError, NativeUnsupportedError } from "../src/native/native-errors";
import { parseLxrsNames } from "../src/native/rdar-archive";
import { learnedKeysMemoSize } from "../src/native/red-defaults";
import { readPackage } from "../src/native/red-package";
import { Cursor, decoderCacheSize, readVarString } from "../src/native/red-values";
import { readResource, readResourceJson } from "../src/native/resource-document";
import { fakeDecompress, kark, syntheticArchive } from "./fixtures/native-archive";
import { buildPackage, Bytes, Cr2wBuilder, prop, v } from "./fixtures/native-cr2w";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const temp = () => { const root = mkdtempSync(join(tmpdir(), "xfs-native-hardening-")); roots.push(root); return root; };
const json = (bytes: Uint8Array) => readResourceJson(bytes, fakeDecompress) as unknown as { Data: { RootChunk: Record<string, any> } };
const text = (value: string) => new TextEncoder().encode(value);

/** Run `fn`, expect it to throw `type`, and within `ms` milliseconds (generous: other work may load the machine). */
function refusedQuickly(fn: () => unknown, type: new (...args: any[]) => Error, ms = 1000): Error {
  const started = performance.now();
  let thrown: unknown = null;
  try { fn(); } catch (error) { thrown = error; }
  expect(performance.now() - started).toBeLessThan(ms);
  expect(thrown).toBeInstanceOf(type);
  return thrown as Error;
}

/** CR2W bytes with an embedded-file table of `records` (import index, export index) appended. */
function withEmbedded(body: Uint8Array, records: [number, number][], tableAt = body.length): Uint8Array {
  const out = new Uint8Array(Math.max(body.length, tableAt) + records.length * 16);
  out.set(body);
  const view = new DataView(out.buffer);
  view.setUint32(40 + 6 * 12, tableAt, true); view.setUint32(40 + 6 * 12 + 4, records.length, true);
  records.forEach(([importIndex, chunk], i) => { view.setUint32(tableAt + i * 16, importIndex, true); view.setUint32(tableAt + i * 16 + 4, chunk, true); });
  return out;
}

test("NATIVE-01: string lengths are arithmetic and bounded; a cursor never moves backwards", () => {
  // The reviewer's case: `array:String` claiming 2 million elements, one normal string and one whose 32-bit length read as -8.
  const hostile = new Cr2wBuilder();
  hostile.export("CMaterialInstance", [prop("x", "array:String", w => { w.u32(2_000_000); w.u8(0x8a).bytes(text("aaaaaaaaaa")); w.bytes([0x78, 0xff, 0xff, 0xff, 0x1f]); })]);
  refusedQuickly(() => json(hostile.build()), NativeMalformedError, 500);
  // With an honest count the long length itself is refused: it is 4,294,967,288 units now, far past the value's end.
  const honest = new Cr2wBuilder();
  honest.export("CMaterialInstance", [prop("x", "array:String", w => { w.u32(2); w.u8(0x8a).bytes(text("aaaaaaaaaa")); w.bytes([0x78, 0xff, 0xff, 0xff, 0x1f]); })]);
  expect(() => json(honest.build())).toThrow("passes the end");
  // A fifth continuation byte is malformed; a normal string still reads.
  expect(() => readVarString(new Cursor(new Uint8Array([0x40, 0x80, 0x80, 0x80, 0x80, 0x01])))).toThrow(NativeMalformedError);
  expect(readVarString(new Cursor(new Uint8Array([0x83, 0x61, 0x62, 0x63])))).toBe("abc");
  expect(readVarString(new Cursor(new Uint8Array([0x02, 0x61, 0x00, 0x62, 0x00])))).toBe("ab");
  // Sizes must be non-negative integers.
  for (const size of [-8, 1.5, Number.NaN]) expect(() => new Cursor(new Uint8Array(16), 8).take(size)).toThrow(NativeMalformedError);
  expect(() => new Cursor(new Uint8Array(16), 12, 8)).toThrow(NativeMalformedError);
});

/** A CR2W header whose string pool is `pool` and whose name table has one entry per offset. */
function nameTable(pool: Uint8Array, offsets: number[]): Uint8Array {
  const head = 40 + 120, namesAt = head + pool.length;
  const bytes = new Uint8Array(namesAt + offsets.length * 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x57325243, true);
  view.setUint32(40, head, true); view.setUint32(44, pool.length, true);
  view.setUint32(52, namesAt, true); view.setUint32(56, offsets.length, true);
  bytes.set(pool, head);
  offsets.forEach((offset, i) => view.setUint32(namesAt + i * 8, offset, true));
  return bytes;
}

test("NATIVE-02: the name table indexes the pool's terminators once, decodes each offset once and caps one name", () => {
  // The reviewer's case: a pool with no terminator and many names at offset 0 (was 3.0 s and 5.8 GB for a 391 KB body).
  refusedQuickly(() => new Cr2wFile(nameTable(new Uint8Array(200_000).fill(0x61), new Array(25_000).fill(0))), NativeBudgetError, 500);
  // Short names shared by many entries decode once each.
  const pool = text("abc\0def\0");
  const started = performance.now();
  const file = new Cr2wFile(nameTable(pool, Array.from({ length: 50_000 }, (_, i) => (i % 2) * 4)));
  expect(performance.now() - started).toBeLessThan(500);
  expect(file.names.slice(0, 3)).toEqual(["abc", "def", "abc"]);
  // Names at many distinct offsets are charged to the decoded-bytes budget.
  const long = new Uint8Array(40_000).fill(0x62);
  for (let i = 2000; i < long.length; i += 2000) long[i] = 0;
  const limits: NativeLimits = { ...DEFAULT_LIMITS, maxDecodedBytes: 1 << 20 };
  refusedQuickly(() => new Cr2wFile(nameTable(long, Array.from({ length: 40_000 }, (_, i) => i)), new DecodeSession(limits)), NativeBudgetError, 500);
});

/** A package struct value: u16 field count, (name, type, offset) per field, then the values (offsets from the struct's start). */
function packageStruct(names: string[], fields: { name: string; type: string; value: Uint8Array }[]): Uint8Array {
  const w = new Bytes();
  w.u16(fields.length);
  let offset = 2 + 8 * fields.length;
  for (const field of fields) { w.u16(names.indexOf(field.name)).u16(names.indexOf(field.type)).u32(offset); offset += field.value.length; }
  for (const field of fields) w.bytes(field.value);
  return w.done();
}

test("NATIVE-03/07: package values are contiguous and in order, nesting is capped, and only verified versions and known types decode", () => {
  // The reviewer's case: two fields per level pointing at the same next level (2^D decodes; D = 30 was 0.9 s and 1.3 GB at 452 bytes).
  const names = ["X", "f", "g"].map(text);
  const hdr = new Bytes();
  const nameData = names.length * 4, nameBytes = names.reduce((sum, n) => sum + n.length + 1, 0), chunkDesc = nameData + nameBytes, chunkData = chunkDesc + 8;
  hdr.u8(4).u8(2).u16(6).u32(1).u32(0).u32(nameData).u32(chunkDesc).u32(chunkData).u16(0).u16(0);
  let at = nameData; for (const n of names) { hdr.u32(((n.length + 1) << 24 | at) >>> 0); at += n.length + 1; }
  for (const n of names) hdr.bytes(n).u8(0);
  hdr.u32(0).u32(chunkData);
  for (let i = 0; i < 30; i++) hdr.u16(2).u16(1).u16(0).u32(18).u16(2).u16(0).u32(18);
  hdr.u16(0);
  refusedQuickly(() => readPackage(hdr.done(), "entEntityTemplate.compiledData"), NativeMalformedError, 500);

  // Well-formed but 300 levels deep: refused by the nesting cap, not by a stack overflow.
  const deepNames = ["Vector3", "f"];
  let value = packageStruct(deepNames, []);
  for (let i = 0; i < 300; i++) value = packageStruct(deepNames, [{ name: "f", type: "Vector3", value }]);
  const deep = buildPackage({ names: deepNames, refs: [], cruids: [], rootIndex: 0, objects: [{ type: "Vector3", fields: [{ name: "f", type: "Vector3", write: w => { w.bytes(value.subarray(0)); } }] }] });
  refusedQuickly(() => readPackage(deep, "entEntityTemplate.compiledData"), NativeBudgetError, 500);
  // 50 levels decode.
  let shallow = packageStruct(deepNames, []);
  for (let i = 0; i < 50; i++) shallow = packageStruct(deepNames, [{ name: "f", type: "Vector3", value: shallow }]);
  expect((readPackage(buildPackage({ names: deepNames, refs: [], cruids: [], rootIndex: 0, objects: [{ type: "Vector3", fields: [{ name: "f", type: "Vector3", write: w => { w.bytes(shallow); } }] }] }), "x") as { chunks: unknown[] }).chunks).toHaveLength(1);
  // A class the RTTI knows but the slice leaves out (no property list) still decodes; only unknown names are refused.
  const unsliced = buildPackage({ names: ["entEntity", "destructionParams", "physicsDestructionParams", "startInactive", "Bool"], refs: [], cruids: [], rootIndex: 0,
    objects: [{ type: "entEntity", fields: [{ name: "destructionParams", type: "physicsDestructionParams", write: w => { w.bytes(packageStruct(["entEntity", "destructionParams", "physicsDestructionParams", "startInactive", "Bool"], [{ name: "startInactive", type: "Bool", value: new Uint8Array([1]) }])); } }] }] });
  expect(((readPackage(unsliced, "x") as { chunks: { fields: Record<string, any> }[] }).chunks[0]!.fields.destructionParams).fields).toEqual({ startInactive: 1 });

  const one = (fields: { name: string; type: string; write: (w: Bytes) => void }[], names = ["entEntity", "a", "b", "Uint32", "Uint8", "XfsNotInRtti"]) =>
    buildPackage({ names, refs: [], cruids: [], rootIndex: 0, objects: [{ type: "entEntity", fields }] });
  // A value that stops short of the next field's start.
  const short = one([{ name: "a", type: "Uint8", write: w => { w.u8(1).u8(0); } }, { name: "b", type: "Uint8", write: w => { w.u8(2); } }]);
  expect(() => readPackage(short, "x")).toThrow("used 1 of 2 bytes");
  // A type outside the RTTI slice is not guessed at as a struct.
  expect(() => readPackage(one([{ name: "a", type: "XfsNotInRtti", write: w => { w.u16(0); } }]), "x")).toThrow(NativeUnsupportedError);
  // Versions 2 and 3 are refused until verified.
  const good = one([{ name: "a", type: "Uint32", write: w => { w.u32(7); } }]);
  expect((readPackage(good, "x") as { chunks: { fields: Record<string, unknown> }[] }).chunks[0]!.fields.a).toBe(7);
  for (const version of [2, 3]) { const old = good.slice(); old[0] = version; expect(() => readPackage(old, "x")).toThrow(NativeUnsupportedError); }
});

test("NATIVE-04: the embedded-file table is bounds-checked and names distinct non-root exports, no more than there are", () => {
  const file = new Cr2wBuilder();
  file.export("CMaterialInstance", [prop("x", "array:Float", v.array(Array.from({ length: 200 }, () => v.f32(0.1))))]);
  file.export("CMaterialInstance", []);
  file.import("base\\embedded.mi");
  const body = file.build();
  // The reviewer's case: a thousand records naming the same export (157 KB file → 1.2 GB of JSON).
  refusedQuickly(() => json(withEmbedded(body, Array.from({ length: 1000 }, () => [0, 0] as [number, number]))), NativeMalformedError, 500);
  expect(() => json(withEmbedded(body, [[1, 0]]))).toThrow("names export 0");
  expect(() => json(withEmbedded(body, [[1, 1], [1, 1]]))).toThrow("repeat export 1");
  expect(() => json(withEmbedded(body, [[5, 1]]))).toThrow("names import 5");
  const outside = withEmbedded(body, [[1, 1]]);
  new DataView(outside.buffer).setUint32(40 + 6 * 12, outside.length - 8, true);
  expect(() => json(outside)).toThrow("outside the file");
  const embedded = (json(withEmbedded(body, [[1, 1]])).Data as any).EmbeddedFiles;
  expect(embedded).toHaveLength(1);
  expect(embedded[0].FileName.$value).toBe("base\\embedded.mi");
});

/** An archive with one entry whose body segment is described by the caller. */
function hostileArchive(segment: { offset: number; stored: number; size: number }, fileSize: bigint, customDataLength = 0): Uint8Array {
  const b = new Uint8Array(0x200), view = new DataView(b.buffer);
  view.setUint32(0, 0x52414452, true); view.setUint32(4, 12, true);
  const index = 0x100;
  view.setBigUint64(8, BigInt(index), true); view.setUint32(16, 28 + 56 + 16, true);
  view.setBigUint64(32, fileSize, true);
  view.setUint32(40, customDataLength, true);
  view.setUint32(0x80, 0x4b52414b, true); view.setUint32(0x84, segment.size, true);
  view.setUint32(index + 16, 1, true); view.setUint32(index + 20, 1, true);
  const entry = index + 28;
  view.setBigUint64(entry, 42n, true); view.setUint32(entry + 20, 0, true); view.setUint32(entry + 24, 1, true);
  const s = entry + 56;
  view.setBigUint64(s, BigInt(segment.offset), true); view.setUint32(s + 8, segment.stored, true); view.setUint32(s + 12, segment.size, true);
  return b;
}

test("NATIVE-05: sizes are capped before anything is allocated and segments must lie inside the real file", () => {
  const root = temp();
  let asked = 0;
  const counting = (stored: Uint8Array, size: number) => { asked++; return fakeDecompress(stored, size); };
  // The reviewer's case: a 512-byte archive whose body claims 4 GB and whose header claims a 1 TB file.
  const huge = join(root, "huge.archive");
  writeFileSync(huge, hostileArchive({ offset: 0x80, stored: 16, size: 0xfffffff0 }, 1n << 40n));
  refusedQuickly(() => NativeArchive.open(huge, counting).read("42"), NativeBudgetError, 500);
  expect(asked).toBe(0);
  // A segment inside the claimed size but past the real end of the file.
  const past = join(root, "past.archive");
  writeFileSync(past, hostileArchive({ offset: 0x180, stored: 0x1000, size: 0x2000 }, 1n << 40n));
  expect(() => NativeArchive.open(past, counting).read("42")).toThrow(NativeMalformedError);
  // A custom-data length of 4 GB, and one past the end of the file.
  const names = join(root, "names.archive");
  writeFileSync(names, hostileArchive({ offset: 0x80, stored: 16, size: 16 }, 0x200n, 0xffffffff));
  refusedQuickly(() => NativeArchive.open(names, counting).names(), NativeBudgetError, 500);
  writeFileSync(names, hostileArchive({ offset: 0x80, stored: 16, size: 16 }, 0x200n, 0x1000));
  expect(() => NativeArchive.open(names, counting).names()).toThrow("outside the file");
  // An LXRS block whose decompressed size passes the cap.
  const lxrs = new Uint8Array(24), lv = new DataView(lxrs.buffer);
  lv.setUint32(0, 0x4c585253, true); lv.setUint32(8, 0x7fffffff, true); lv.setUint32(12, 4, true); lv.setUint32(16, 1, true);
  expect(() => parseLxrsNames(lxrs, () => { throw Error("not called"); }, DEFAULT_LIMITS.maxNameListBytes)).toThrow(NativeBudgetError);

  // A CR2W buffer claiming 2 GB decompressed, parsed as a package: refused before the decompressor is asked.
  const cr2w = new Cr2wBuilder();
  const buffer = cr2w.buffer(kark(new Uint8Array(32)), 0x7fffffff);
  cr2w.export("entEntityTemplate", [prop("compiledData", "DataBuffer", v.buffer(buffer))]);
  asked = 0;
  refusedQuickly(() => readResourceJson(cr2w.build(), counting), NativeBudgetError, 500);
  expect(asked).toBe(0);

  // Decoded values and written JSON values are budgeted.
  const many = new Cr2wBuilder();
  many.export("CMaterialInstance", [prop("x", "array:Bool", w => { w.u32(100_000); for (let i = 0; i < 100_000; i++) w.u8(1); })]);
  expect(() => readResource(many.build(), fakeDecompress, { buffers: "trim" }, { ...DEFAULT_LIMITS, maxNodes: 50_000 })).toThrow(NativeBudgetError);
  const expanding = new Cr2wBuilder();
  // Three bytes per element in the file, a full default `CMaterialInstance` per element in the JSON.
  expanding.export("CMaterialInstance", [prop("x", "array:CMaterialInstance", w => { w.u32(20_000); for (let i = 0; i < 20_000; i++) w.u8(0).u16(0); })]);
  expect(() => readResource(expanding.build(), fakeDecompress, { buffers: "trim" }, { ...DEFAULT_LIMITS, maxJsonNodes: 100_000 })).toThrow(NativeBudgetError);
  expect(readResource(expanding.build(), fakeDecompress).usage.jsonNodes).toBeGreaterThan(100_000);
});

test("NATIVE-06: package references are hashes or paths by their owner, never by how the bytes look", () => {
  const names = ["entSkinnedMeshComponent", "mesh", "raRef:CMesh"];
  const component = { type: "entSkinnedMeshComponent", fields: [{ name: "mesh", type: "raRef:CMesh", write: (w: Bytes) => { w.i16(0); } }] };
  const decode = (owner: string, ref: string) => {
    const bytes = buildPackage({ names, refs: [{ path: ref, sync: false }], cruids: [], rootIndex: -1, objects: [component] });
    return (readPackage(bytes, owner) as { chunks: { fields: Record<string, any> }[] }).chunks[0]!.fields.mesh.DepotPath;
  };
  // Eight printable bytes in an `.app` package are a hash (the old heuristic made them a garbage path).
  const printable = "abcdefgh";
  const hash = new DataView(text(printable).buffer).getBigUint64(0, true).toString();
  expect(decode("appearanceAppearanceDefinition.compiledData", printable)).toEqual({ $type: "ResourcePath", $storage: "uint64", $value: hash });
  expect(() => decode("appearanceAppearanceDefinition.compiledData", "base\\x.mesh")).toThrow("path hash (8) is expected");
  // Eight non-printable bytes in an `.ent` package are still path text.
  expect(decode("entEntityTemplate.compiledData", "\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008").$storage).toBe("string");
  expect(decode("entEntityTemplate.compiledData", "Base\\Hair.mesh")).toEqual({ $type: "ResourcePath", $storage: "string", $value: "base\\hair.mesh" });
});

test("NATIVE-08: a property stored with a type the RTTI disagrees with is noted and still readable", () => {
  const file = new Cr2wBuilder();
  file.export("entSkinnedMeshComponent", [prop("castShadows", "Bool", v.bool(true)), prop("castShadows2", "Bool", v.bool(true))]);
  const result = readResource(file.build(), fakeDecompress);
  expect(result.document.Data.RootChunk as Record<string, unknown>).toMatchObject({ castShadows: 1 });
  expect(result.notes).toEqual([{ kind: "type-mismatch", property: "entSkinnedMeshComponent.castShadows", stored: "Bool", rtti: "shadowsShadowCastingMode", count: 1 }]);
  // The same inside a package (where the body-UV framework mod's `.app` stores it).
  const names = ["entSkinnedMeshComponent", "castShadows", "Bool"];
  const compiled = buildPackage({ names, refs: [], cruids: [], rootIndex: -1, objects: [{ type: "entSkinnedMeshComponent", fields: [{ name: "castShadows", type: "Bool", write: w => { w.u8(1); } }] }] });
  const session = new DecodeSession();
  readPackage(compiled, "appearanceAppearanceDefinition.compiledData", session);
  expect(session.notes.map(note => note.property)).toEqual(["entSkinnedMeshComponent.castShadows"]);
});

test("NATIVE-10: the pool holds no handles, so an archive can be replaced by rename, and a replaced archive is re-indexed", () => {
  const root = temp(), path = join(root, "h.archive"), next = join(root, "h.tmp");
  writeFileSync(path, syntheticArchive([{ path: "a\\x.mi", segments: [{ bytes: new Uint8Array([1, 2, 3]) }] }]));
  const pool = new NativeArchivePool(fakeDecompress);
  try {
    const first = pool.get(path), direct = NativeArchive.open(path, fakeDecompress);
    expect(first.read(depotHash("a\\x.mi"))).toEqual(new Uint8Array([1, 2, 3]));
    expect(first.names()).toEqual([]);
    // What an installer or mod manager does: write the new file beside it and rename it over the old one.
    writeFileSync(next, syntheticArchive([{ path: "a\\x.mi", segments: [{ bytes: new Uint8Array([9, 9, 9, 9]) }] }]));
    renameSync(next, path);
    expect(pool.read(path, depotHash("a\\x.mi"))).toEqual(new Uint8Array([9, 9, 9, 9]));
    expect(pool.get(path)).not.toBe(first);
    // The pool dropped the old index; an archive object still holding it refuses rather than reading the new file through it.
    expect(() => first.read(depotHash("a\\x.mi"))).toThrow("closed");
    expect(direct.stale()).toBe(true);
    expect(() => direct.read(depotHash("a\\x.mi"))).toThrow(ArchiveChangedError);
    // Deleting works too, and a vanished archive is stale.
    unlinkSync(path);
    expect(() => pool.get(path)).toThrow();
  } finally { pool.close(); }
});

test("NATIVE-13: a long handle chain is refused by the nesting cap, in decoding and in writing", () => {
  // The reviewer's case: exports 0 → 1 → … → 9,999 (relied on a caught stack overflow).
  const chain = new Cr2wBuilder();
  for (let i = 0; i < 10_000; i++) chain.export("CMaterialInstance", i + 1 < 10_000 ? [prop("next", "handle:CMaterialInstance", v.handle(i + 1))] : []);
  refusedQuickly(() => json(chain.build()), NativeBudgetError, 2000);
  // Decoding in file order stays shallow here, but writing in key order walks the whole chain: the writer is capped too.
  const n = 1000, file = new Cr2wBuilder();
  file.export("XfsTestRoot", [prop("zz", "array:handle:XfsTestNode", v.array(Array.from({ length: n }, (_, i) => v.handle(n - i)))), prop("aa", "handle:XfsTestNode", v.handle(1))]);
  for (let k = 1; k <= n; k++) file.export("XfsTestNode", k < n ? [prop("next", "handle:XfsTestNode", v.handle(k + 1))] : []);
  const error = refusedQuickly(() => json(file.build()), NativeBudgetError, 2000);
  expect(error.message).toContain("nest deeper");
});

test("NATIVE-14: caches keyed by type names from files stay bounded", () => {
  const file = new Cr2wBuilder();
  file.export("XfsTestRoot", Array.from({ length: 5000 }, (_, i) => prop(`p${i}`, `XfsType${i}`, v.struct([]))));
  json(file.build());
  expect(decoderCacheSize()).toBeLessThanOrEqual(4096);
  expect(learnedKeysMemoSize()).toBeLessThanOrEqual(4096);
});

test("NATIVE-15: the diff harness excuses a hash-only path only when the reference's path hashes to it", () => {
  const mine = (hash: string) => ({ $type: "ResourcePath", $storage: "uint64", $value: hash });
  const reference = { $type: "ResourcePath", $storage: "string", $value: "base\\hair.mesh" };
  expect(compareDocuments(mine(depotHash("base\\hair.mesh")), reference).map(m => m.kind)).toEqual([HASH_ONLY_PATH]);
  expect(compareDocuments(mine(depotHash("base\\other.mesh")), reference).map(m => m.kind)).toEqual(["ResourcePath: different hash"]);
});

test("NATIVE-16: a watched property the file left out is reported with its path (the document can only show it as 0)", () => {
  const file = new Cr2wBuilder();
  const chunk = (...flags: string[]) => v.struct(flags.length ? [prop("renderMask", "EMeshChunkFlags", v.bitfield(...flags))] : [prop("lodMask", "Uint8", v.u8(1))]);
  file.export("CMesh", [prop("renderResourceBlob", "handle:IRenderResourceBlob", v.handle(1))]);
  file.export("rendRenderMeshBlob", [prop("header", "rendRenderMeshBlobHeader", v.struct([prop("renderChunkInfos", "array:rendChunk", v.array([chunk("MCF_RenderInScene"), chunk(), chunk()]))]))]);
  const result = readResource(file.build(), fakeDecompress);
  const infos = (result.document.Data.RootChunk as any).renderResourceBlob.Data.header.renderChunkInfos;
  expect(infos.map((info: any) => info.renderMask)).toEqual(["MCF_RenderInScene", "0", "0"]);
  expect(result.defaulted).toEqual([{ property: "rendChunk.renderMask", count: 2, paths: [
    ".Data.RootChunk.renderResourceBlob.Data.header.renderChunkInfos[1].renderMask",
    ".Data.RootChunk.renderResourceBlob.Data.header.renderChunkInfos[2].renderMask"] }]);
});

// NATIVE-18..23: the review at fa74f98.

test("NATIVE-18: the string pool is capped, and its terminator index and entries are charged before they are allocated", () => {
  // Over the pool cap: refused before the pool is scanned. The default cap refuses a pool of zeros one byte past it (the index
  // was a JS array of 16 bytes per zero: 530 MB for a 32 MiB pool that compresses to KB).
  refusedQuickly(() => new Cr2wFile(nameTable(new Uint8Array((1 << 20) + 1), []), new DecodeSession({ ...DEFAULT_LIMITS, maxStringPoolBytes: 1 << 20 })), NativeBudgetError, 500);
  refusedQuickly(() => new Cr2wFile(nameTable(new Uint8Array(DEFAULT_LIMITS.maxStringPoolBytes + 1), [])), NativeBudgetError, 500);
  // Under the pool cap, the terminators are charged 4 bytes each before their index is allocated.
  const zeros = refusedQuickly(() => new Cr2wFile(nameTable(new Uint8Array(512 << 10), []), new DecodeSession({ ...DEFAULT_LIMITS, maxDecodedBytes: 1 << 20 })), NativeBudgetError, 500);
  expect(zeros.message).toContain("terminator index");
  // Many distinct one-byte entries (each a string and a slot, ~150 bytes) are budgeted by count, not only by their bytes.
  const pool = new Uint8Array(200_000);
  for (let i = 0; i < pool.length; i += 2) pool[i] = 0x61;
  const offsets = Array.from({ length: 100_000 }, (_, i) => i * 2);
  const many = refusedQuickly(() => new Cr2wFile(nameTable(pool, offsets), new DecodeSession({ ...DEFAULT_LIMITS, maxNames: 50_000 })), NativeBudgetError, 500);
  expect(many.message).toContain("50000-name budget");
  expect(new Cr2wFile(nameTable(pool, offsets)).session.usage.names).toBe(100_000);
  // An ordinary pool reads as before, and its usage counts the index and each distinct entry once.
  const file = new Cr2wFile(nameTable(text("abc\0def\0"), [0, 4, 0]));
  expect(file.names).toEqual(["abc", "def", "abc"]);
  expect(file.session.usage).toMatchObject({ decodedBytes: 2 * 4 + 3 + 3, names: 2 });
});

/** A worker the test drives by hand: it records what it is sent and emits what the test tells it to. */
class FakeWorker implements DecodeWorker {
  readonly sent: (WorkerInit | WorkerDecodeMessage)[] = [];
  terminated = false;
  private readonly listeners = new Map<string, ((event: any) => void)[]>();
  postMessage(message: WorkerInit | WorkerDecodeMessage): void { this.sent.push(message); }
  addEventListener(type: string, listener: (event: any) => void): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  terminate(): void { this.terminated = true; }
  emit(type: "message" | "error" | "close", data?: unknown): void { for (const listener of this.listeners.get(type) ?? []) listener(type === "message" ? { data } : { message: data }); }
  get lastDecode(): WorkerDecodeMessage { return this.sent.filter((message): message is WorkerDecodeMessage => message.type === "decode").at(-1)!; }
}
const answer = (tag: string): NativeDecodeOutcome => ({ ok: true, document: { tag }, extractedSha256: "", root: "CHairProfile", name: null, notes: [], defaulted: [] });
const decodeRequest = (hash: string) => ({ archivePath: "a.archive", hash, needName: false });
function fakeDecoder(options: Partial<WorkerDecoderOptions> = {}): { decoder: WorkerDecoder; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  const decoder = new WorkerDecoder({ decompressor: { test: "fake" }, roots: new Set(), identity: "test", ...options,
    createWorker: () => { const worker = new FakeWorker(); workers.push(worker); return worker; } });
  return { decoder, workers };
}
const settled = async (promise: Promise<unknown>) => { let done = false; void promise.then(() => { done = true; }); await Bun.sleep(5); return done; };

test("NATIVE-19: a worker decoder hears only its current worker, and only the answer for the resource in progress", async () => {
  const { decoder, workers } = fakeDecoder({ timeoutMs: 150 });
  try {
    const first = decoder.decode(decodeRequest("1"));
    workers[0]!.emit("message", { type: "ready" });
    const firstId = workers[0]!.lastDecode.id;
    expect(await first).toMatchObject({ ok: false, kind: "over-budget" });
    expect(workers[0]!.terminated).toBe(true);

    const second = decoder.decode(decodeRequest("2"));
    expect(workers.length).toBe(2);
    workers[1]!.emit("message", { type: "ready" });
    const secondId = workers[1]!.lastDecode.id;
    expect(secondId).not.toBe(firstId);
    // The replaced worker's late answer, even one carrying the new id, and its error and exit are ignored.
    workers[0]!.emit("message", { type: "outcome", id: firstId, outcome: answer("late") });
    workers[0]!.emit("message", { type: "outcome", id: secondId, outcome: answer("replaced") });
    workers[0]!.emit("error", "late failure");
    workers[0]!.emit("close");
    // So is the current worker's answer for an earlier id.
    workers[1]!.emit("message", { type: "outcome", id: firstId, outcome: answer("stale") });
    expect(await settled(second)).toBe(false);
    expect(workers[1]!.terminated).toBe(false);
    workers[1]!.emit("message", { type: "outcome", id: secondId, outcome: answer("right") });
    expect(await second).toMatchObject({ ok: true, document: { tag: "right" } });
  } finally { decoder.close(); }
});

test("NATIVE-20: a worker that fails to start is not restarted for every request, and the decoder gives up after repeated failures", async () => {
  const { decoder, workers } = fakeDecoder({ startTimeoutMs: 40, restartDelayMs: 150, maxStartFailures: 2 });
  try {
    // Never ready: the start timeout answers the resource `unavailable`, and the worker is ended.
    const started = performance.now();
    expect(await decoder.decode(decodeRequest("1"))).toMatchObject({ ok: false, kind: "unavailable", message: expect.stringContaining("did not start within 40 ms") });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(workers[0]!.terminated).toBe(true);
    // Within the restart delay nothing is started; resources are answered at once.
    expect(await decoder.decode(decodeRequest("2"))).toMatchObject({ ok: false, kind: "unavailable" });
    expect(decoder.started).toBe(1);
    // After it, one new start; a second failure (here `init-failed`) is the limit, so the decoder is off for the session.
    await Bun.sleep(170);
    const third = decoder.decode(decodeRequest("3"));
    expect(decoder.started).toBe(2);
    workers[1]!.emit("message", { type: "init-failed", message: "The Oodle library changed since it was checked." });
    expect(await third).toMatchObject({ ok: false, kind: "unavailable", message: expect.stringContaining("off for this session") });
    await Bun.sleep(170);
    expect(await decoder.decode(decodeRequest("4"))).toMatchObject({ ok: false, kind: "unavailable" });
    expect(decoder.started).toBe(2);
  } finally { decoder.close(); }

  // A worker that exits before it is ready is a start failure too; a later successful start resets the count, and a worker that
  // dies after starting is replaced at once, as before.
  const retried = fakeDecoder({ startTimeoutMs: 5000, restartDelayMs: 50, maxStartFailures: 2 });
  try {
    const first = retried.decoder.decode(decodeRequest("1"));
    retried.workers[0]!.emit("close");
    expect(await first).toMatchObject({ ok: false, kind: "unavailable" });
    await Bun.sleep(70);
    const second = retried.decoder.decode(decodeRequest("2"));
    retried.workers[1]!.emit("message", { type: "ready" });
    retried.workers[1]!.emit("message", { type: "outcome", id: retried.workers[1]!.lastDecode.id, outcome: answer("ok") });
    expect(await second).toMatchObject({ ok: true });
    const third = retried.decoder.decode(decodeRequest("3"));
    retried.workers[1]!.emit("error", "crashed");
    expect(await third).toMatchObject({ ok: false, kind: "internal" });
    const fourth = retried.decoder.decode(decodeRequest("4"));
    expect(retried.decoder.started).toBe(3);
    retried.workers[2]!.emit("close");
    expect(await fourth).toMatchObject({ ok: false, kind: "unavailable", message: expect.not.stringContaining("off for this session") });
  } finally { retried.decoder.close(); }
});

/** An archive's bytes with its index entries in reverse order (so the index is not sorted), optionally repeating one hash. */
function unsortedIndex(bytes: Uint8Array, repeatFirst = false): Uint8Array {
  const out = bytes.slice(), view = new DataView(out.buffer);
  const index = Number(view.getBigUint64(8, true)), count = view.getUint32(index + 16, true);
  const entries = Array.from({ length: count }, (_, i) => bytes.slice(index + 28 + i * 56, index + 28 + (i + 1) * 56)).reverse();
  entries.forEach((entry, i) => out.set(entry, index + 28 + i * 56));
  if (repeatFirst) out.set(out.subarray(index + 28, index + 36), index + 28 + 56);
  return out;
}

test("NATIVE-23: an archive index over its cap is refused before it is read, and a pool keeps a bounded total of index bytes", () => {
  const root = temp();
  const files = (tag: number) => Array.from({ length: 8 }, (_, i) => ({ path: `a\\${tag}_${i}.mi`, segments: [{ bytes: new Uint8Array([tag, i]) }] }));
  const paths = [0, 1, 2, 3].map(tag => { const path = join(root, `${tag}.archive`); writeFileSync(path, syntheticArchive(files(tag))); return path; });
  const indexSize = NativeArchive.open(paths[0]!, fakeDecompress).index.header.indexSize;
  // One index over the cap: refused as over-budget, the decompressor never asked and nothing read.
  refusedQuickly(() => NativeArchive.open(paths[0]!, fakeDecompress, { ...DEFAULT_LIMITS, maxIndexBytes: indexSize - 1 }), NativeBudgetError, 500);
  expect(NativeArchive.open(paths[0]!, fakeDecompress, { ...DEFAULT_LIMITS, maxIndexBytes: indexSize }).size).toBe(8);
  // A pool drops the least recently used indexes past its byte budget, and re-reads one when it is needed again.
  const pool = new NativeArchivePool(fakeDecompress, 64, { ...DEFAULT_LIMITS, maxPooledIndexBytes: Math.floor(indexSize * 2.5) });
  try {
    for (const [tag, path] of paths.entries()) expect(pool.read(path, depotHash(`a\\${tag}_3.mi`))).toEqual(new Uint8Array([tag, 3]));
    expect(pool.heldArchives).toBe(2);
    expect(pool.heldIndexBytes).toBe(2 * indexSize);
    expect(pool.read(paths[0]!, depotHash("a\\0_5.mi"))).toEqual(new Uint8Array([0, 5]));
    expect(pool.heldIndexBytes).toBeLessThanOrEqual(indexSize * 2.5);
  } finally { pool.close(); }
  expect(pool.heldIndexBytes).toBe(0);
  // An index that is not sorted is searched through a sorted order of positions (no map); of repeated hashes the last wins.
  const unsorted = join(root, "unsorted.archive");
  writeFileSync(unsorted, unsortedIndex(syntheticArchive(files(7))));
  const archive = NativeArchive.open(unsorted, fakeDecompress);
  for (let i = 0; i < 8; i++) expect(archive.read(depotHash(`a\\7_${i}.mi`))).toEqual(new Uint8Array([7, i]));
  expect(archive.read(depotHash("a\\7_8.mi"))).toBeNull();
  writeFileSync(unsorted, unsortedIndex(syntheticArchive(files(7)), true));
  const repeated = NativeArchive.open(unsorted, fakeDecompress), first = repeated.index.entryAt(0).hash;
  expect(repeated.index.find(BigInt(first))).toBe(1);
});

test("NATIVE-42: an idle worker is told to release the game's library and exit; the next request starts another", async () => {
  const { decoder, workers } = fakeDecoder({ idleMs: 30 });
  try {
    const first = decoder.decode(decodeRequest("1"));
    workers[0]!.emit("message", { type: "ready" });
    workers[0]!.emit("message", { type: "outcome", id: workers[0]!.lastDecode.id, outcome: answer("one") });
    expect(await first).toMatchObject({ ok: true });
    // Busy again before the idle time is up: the worker stays.
    await Bun.sleep(10);
    const second = decoder.decode(decodeRequest("2"));
    workers[0]!.emit("message", { type: "outcome", id: workers[0]!.lastDecode.id, outcome: answer("two") });
    await second;
    expect(workers[0]!.sent.map(message => message.type)).toEqual(["init", "decode", "decode"]);
    await Bun.sleep(60);
    expect(workers[0]!.sent.at(-1) as unknown).toEqual({ type: "close" });
    // Its exit is not a failure: the next request starts a new worker, which is ready as before.
    workers[0]!.emit("close");
    expect(decoder.canAnswer()).toBe(true);
    const third = decoder.decode(decodeRequest("3"));
    expect(workers.length).toBe(2);
    workers[1]!.emit("message", { type: "ready" });
    workers[1]!.emit("message", { type: "outcome", id: workers[1]!.lastDecode.id, outcome: answer("three") });
    expect(await third).toMatchObject({ ok: true, document: { tag: "three" } });
  } finally { decoder.close(); }
});

test("NATIVE-42: the worker loop releases what its opener loaded when told to close, then ends", async () => {
  const { serveDecodes } = await import("../src/native/native-decode-serve");
  const listeners: ((event: { data: unknown }) => void)[] = [], replies: unknown[] = [];
  let released = 0, ended = 0;
  serveDecodes({ addEventListener: (_type, listener) => { listeners.push(listener); }, postMessage: message => { replies.push(message); }, close: () => { ended++; } },
    () => ({ decompress: fakeDecompress, close: () => { released++; } }));
  const send = (data: unknown) => { for (const listener of listeners) listener({ data }); };
  send({ type: "init", decompressor: { test: "fake" }, roots: [], limits: DEFAULT_LIMITS, identity: "t" });
  await Bun.sleep(1);
  expect(replies).toEqual([{ type: "ready" }]);
  send({ type: "close" });
  expect([released, ended]).toEqual([1, 1]);
});

test("NATIVE-43: a decoder that can't answer now doesn't count earlier native answers as ready", async () => {
  const { NativeFirstFetcher } = await import("../src/native/native-fetch-port");
  const { decoder } = fakeDecoder({ startTimeoutMs: 20, restartDelayMs: 10_000 });
  const archive = { id: "a.archive", name: "a.archive" } as import("../src/archive-precedence").MountedArchive;
  const port = new NativeFirstFetcher(decoder, { fetch: async () => null }, { ledger: { has: () => true, add: () => {} } });
  try {
    expect(port.answeredNatively(archive, "1")).toBe(true);
    // The worker never becomes ready: the decoder waits before starting another, and answers `unavailable` meanwhile.
    expect(await decoder.decode(decodeRequest("1"))).toMatchObject({ ok: false, kind: "unavailable" });
    expect(decoder.canAnswer()).toBe(false);
    expect(port.answeredNatively(archive, "1")).toBe(false);
  } finally { decoder.close(); }
  expect(port.answeredNatively(archive, "1")).toBe(false);
});
