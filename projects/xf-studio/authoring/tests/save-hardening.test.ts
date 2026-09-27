// The save engines and the Save Explorer against hostile input (the code-health review at 9f71a56: SAVE-01..05 and SAVE-09), each built
// from the review's reproductions scaled down: names many descriptors share, an entry of millions of values, nested arrays in the
// inspector, a script bundle repeating one name, a chunk declaring more than it holds, and a 2,400-case mutation fuzz over every engine.
// Synthetic data only; no real save is read.
import { describe, expect, test } from "bun:test";
import { decodeChunk, detectSavePackage, MAX_OPEN_NAME_BYTES, MAX_PACKAGE_NAME_BYTES, nameBudget, packageNames, PackageFrameError, readPackageFrame } from "../src/engines/red-object/package";
import { decodePersistencyEntry, MAX_ENTRY_VALUES, PersistencyError, readPersistencyIndex } from "../src/engines/red-object/persistency";
import { MAX_NAME_BYTES, readScriptBundleNames, ScriptBundleError } from "../src/engines/red-object/script-bundle";
import { readTypeDatabase, TypeDatabaseError } from "../src/engines/red-object/type-database";
import { createTypeOracle } from "../src/engines/red-object/type-oracle";
import { openSave, readSaveHeader, SaveFormatError } from "../src/engines/save/container";
import { decodeLz4, lz4CanExpand } from "../src/engines/save/lz4";
import { openExplorer, type InspectField } from "../src/features/save-explorer";
import { EXPLORER_NAMES, nestedSave, syntheticSave } from "./fixtures/synthetic-explorer-save";
import { buildSave, cat, PackageBuilder, packageNodeBody, persistencyBody, prop, props, scriptBundle, typeDatabaseBody, u16, u32, u64, type SynthType } from "./fixtures/synthetic-save";
import { fnv1a64 } from "../src/engines/red-object/hash";

/** The review's SAVE-01 package: `count` name descriptors all pointing at one 255-byte name inside the name data, and no chunks. */
function sameNamePackage(count = 65_536) {
  const nameData = count * 4, chunkDesc = nameData + 255;
  const descriptors = new Uint8Array(count * 4), view = new DataView(descriptors.buffer);
  for (let i = 0; i < count; i++) view.setUint32(i * 4, (nameData & 0xffffff) | (255 << 24), true);
  const name = new Uint8Array(255).fill(65);
  name[254] = 0;
  return cat(new Uint8Array([4, 2]), u16(6), u32(0), u32(0), u32(nameData), u32(chunkDesc), u32(chunkDesc), u32(0), descriptors, name);
}
const countOf = (names: Iterable<string>) => { let n = 0; for (const _ of names) n++; return n; };

describe("SAVE-01: package names", () => {
  test("names many descriptors share decode to at most a package's cap, and a reading's packages to the shared cap", () => {
    const frame = readPackageFrame(sameNamePackage(), "save");
    expect(countOf(packageNames(frame))).toBe(Math.floor(MAX_PACKAGE_NAME_BYTES / 254));
    // Nine such packages share one reading's budget: together they stop at it.
    const budget = nameBudget();
    let decoded = 0;
    for (let i = 0; i < 9; i++) decoded += countOf(packageNames(readPackageFrame(sameNamePackage(), "save", { names: budget }))) * 254;
    expect(decoded).toBeLessThanOrEqual(MAX_OPEN_NAME_BYTES);
    expect(budget.remaining).toBeGreaterThanOrEqual(0);
    expect(budget.remaining).toBeLessThan(254);
  });

  test("a name outside the name data is refused when used, as one outside the package is", () => {
    const b = new PackageBuilder();
    b.chunk(b.object("Thing", [["value", b.int(7)]]));
    const bytes = b.build(), field = b.names.indexOf("value"), view = new DataView(bytes.buffer);
    // Point the field's name at the chunk table (inside the package, outside the name data).
    const chunkDesc = view.getUint32(16, true);
    view.setUint32(28 + field * 4, (chunkDesc & 0xffffff) | (6 << 24), true);
    const frame = readPackageFrame(bytes, "save");
    expect(() => decodeChunk(frame, 0, new Set())).toThrow(/name \d+ lies outside the name data/);
  });

  test("a save of such packages opens with its names bounded (the review's 418 MB reproduction, scaled)", () => {
    const body = packageNodeBody(sameNamePackage());
    const save = buildSave([{ name: "PkgA", body }, { name: "PkgB", body }], { chunkSize: 4 * 1024 * 1024 });
    const began = performance.now();
    const explorer = openExplorer(save, {});
    expect(explorer.tree().filter(row => row.encoding === "package")).toHaveLength(2);
    // One distinct name at most comes from them; the frames keep none of what the oracle read.
    expect(explorer.oracle.stats.package).toBe(1);
    expect(performance.now() - began).toBeLessThan(5000);
    expect(detectSavePackage(body)?.frame.nameCount).toBe(65_536);
  });
});

const TYPES: SynthType[] = [{ name: "Bool", kind: "fundamental", size: 1 }, { name: "Int32", kind: "fundamental", size: 4 }, { name: "array:Bool", kind: "array", inner: "Bool" },
  { name: "array:Int32", kind: "array", inner: "Int32" }, { name: "gameDeviceComponentPS", kind: "class" }];
const oracle = () => createTypeOracle({ database: readTypeDatabase(cat(u32(0), typeDatabaseBody(TYPES, []))) });
const boolArray = (count: number) => cat(u64(fnv1a64("flags")), u64(fnv1a64("array:Bool")), u32(count), new Uint8Array(count));

describe("SAVE-02: world-object values", () => {
  test("an entry of more values than any save's is kept raw, and its array is refused before it is allocated", () => {
    // The review's 8 MB entry (231 MB decoded), scaled to 1 MB.
    const body = persistencyBody([{ id: 1n, type: "gameDeviceComponentPS", data: boolArray(1 << 20) }]);
    const index = readPersistencyIndex(body);
    const result = decodePersistencyEntry(body, index.entries[0]!, oracle());
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/more values than any save's entry/) });
    expect(result.values).toBeLessThanOrEqual(MAX_ENTRY_VALUES + (1 << 20));
    if (!result.ok) expect(result.partial.props).toHaveLength(0);
    // Just under the cap, it reads.
    const fits = persistencyBody([{ id: 1n, type: "gameDeviceComponentPS", data: boolArray(MAX_ENTRY_VALUES - 2) }]);
    expect(decodePersistencyEntry(fits, readPersistencyIndex(fits).entries[0]!, oracle())).toMatchObject({ ok: true, values: MAX_ENTRY_VALUES - 1 });
  });

  test("the explorer's decoded entries are bounded by what they decoded to, not only by count", () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({ id: BigInt(i + 1), type: "gameDeviceComponentPS", data: boolArray(40_000) }));
    const save = buildSave([{ name: "TypeDatabase_v2", body: typeDatabaseBody(TYPES, [["flags", "array:Bool"]]) }, { name: "PersistencySystem2", body: persistencyBody(entries) }],
      { chunkSize: 4 * 1024 * 1024 });
    const explorer = openExplorer(save, {});
    const page = explorer.entries(0, 50);
    expect(page.rows).toHaveLength(12);
    expect(page.rows.every(row => row.status === "decoded")).toBe(true);
    const stats = explorer.cacheStats();
    expect(stats.values).toBeLessThanOrEqual(200_000);
    expect(stats.entries).toBeLessThan(12);
  });
});

/** Fields in an inspection, children included. */
const fieldCount = (fields: readonly InspectField[]): number => fields.reduce((sum, field) => sum + 1 + fieldCount(field.children ?? []), 0);

describe("SAVE-03: the inspector's budget", () => {
  test("nested arrays build at most the inspection's budget of fields; the rest is counted as more", () => {
    const explorer = openExplorer(nestedSave(200), {});
    const node = explorer.tree().find(row => row.encoding === "package")!.id;
    const inspection = explorer.object({ node, kind: "chunk", index: 0 })!;
    expect(inspection.status).toBe("decoded");
    const rows = inspection.fields[0]!;
    expect(rows.children).toHaveLength(200);
    expect(fieldCount(inspection.fields)).toBeLessThanOrEqual(5_001);
    expect(rows.children!.at(-1)).toMatchObject({ children: [], more: 200 });
    expect(rows.children![0]!.children).toHaveLength(200);
  });
});

describe("SAVE-04: script bundle names", () => {
  test("entries repeating one offset decode it once", () => {
    // The review's reproduction: 100,000 CNames at offset 0 of one 1,024-byte string.
    const strings = new Uint8Array(1025).fill(66);
    strings[1024] = 0;
    const count = 100_000, header = new Uint8Array(104), view = new DataView(header.buffer);
    header.set([82, 69, 68, 83]); view.setUint32(4, 14, true);
    view.setUint32(32, 104, true); view.setUint32(36, strings.length, true); view.setUint32(44, 104 + strings.length, true); view.setUint32(48, count, true);
    const names = readScriptBundleNames(cat(header, strings, new Uint8Array(count * 4)));
    expect(names).toHaveLength(1);
    expect(names[0]).toHaveLength(1024);
  });

  test("overlapping names past the bundle cap are refused", () => {
    const strings = new Uint8Array(40_000).fill(66), count = Math.ceil(MAX_NAME_BYTES / 1024) + 16;
    const header = new Uint8Array(104), view = new DataView(header.buffer);
    header.set([82, 69, 68, 83]); view.setUint32(4, 14, true);
    view.setUint32(32, 104, true); view.setUint32(36, strings.length, true); view.setUint32(44, 104 + strings.length, true); view.setUint32(48, count, true);
    const table = new Uint8Array(count * 4), tableView = new DataView(table.buffer);
    for (let i = 0; i < count; i++) tableView.setUint32(i * 4, i % (strings.length - 1024), true);
    expect(() => readScriptBundleNames(cat(header, strings, table))).toThrow(ScriptBundleError);
    expect(() => readScriptBundleNames(cat(header, strings, table))).toThrow(/more names than a game's/);
  });
});

describe("SAVE-05: declared chunk sizes", () => {
  test("a chunk declaring more than its bytes can expand to is refused before the stream is allocated", () => {
    const save = buildSave([{ name: "A", body: new Uint8Array(64).fill(1) }]);
    const view = new DataView(save.buffer, save.byteOffset, save.byteLength);
    // The chunk table follows the header, `FZLC` and its count.
    const tableAt = readSaveHeader(save).tableOffset + 8, stored = view.getUint32(tableAt + 4, true), offset = view.getUint32(tableAt, true);
    view.setUint32(tableAt + 8, 16 * 1024 * 1024, true);
    view.setUint32(offset + 4, 16 * 1024 * 1024, true);
    expect(() => openSave(save)).toThrow(SaveFormatError);
    expect(() => openSave(save)).toThrow(/declares more data than it holds/);
    expect(lz4CanExpand(stored - 8, 16 * 1024 * 1024)).toBe(false);
  });

  test("a legitimately compressible block still expands, straight into place", () => {
    // One literal, then a match of 60,000 copies of it (offset 1): 5 + 235 continuation bytes expand to 60,001.
    const extra = 60_000 - 4 - 15, lengths: number[] = [];
    for (let rest = extra; ; rest -= 255) { if (rest >= 255) lengths.push(255); else { lengths.push(rest); break; } }
    const block = new Uint8Array([0x1f, 65, 1, 0, ...lengths, 0x10, 66]);
    const out = decodeLz4(block, 60_002);
    expect(out[0]).toBe(65);
    expect(out[59_999]).toBe(65);
    expect(out[60_001]).toBe(66);
    expect(lz4CanExpand(block.length, 60_002)).toBe(true);
  });
});

// ---- SAVE-09: a mutation fuzz over every engine ----

/** Errors a hostile save may raise: the engines' own and the bounded reader's plain `Error`; anything else is a bug. */
const expected = (error: unknown) => error instanceof SaveFormatError || error instanceof PackageFrameError || error instanceof PersistencyError
  || error instanceof TypeDatabaseError || error instanceof ScriptBundleError || (error instanceof Error && error.constructor === Error);

describe("SAVE-09: mutated saves never fail inside the readers", () => {
  test("2,400 mutated saves, packages, world-object streams, type databases and script bundles", () => {
    let seed = 0x5a7e;
    const random = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32; };
    const mutate = (source: Uint8Array) => {
      const bytes = source.slice();
      for (let k = 1 + Math.floor(random() * 4); k > 0; k--) bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256);
      return bytes;
    };
    const saves = [syntheticSave(), buildSave([{ name: "TypeDatabase_v2", body: typeDatabaseBody(TYPES, [["flags", "array:Bool"]]) },
      { name: "PersistencySystem2", body: persistencyBody([{ id: 1n, type: "gameDeviceComponentPS", data: props([prop("flags", "array:Bool", cat(u32(3), new Uint8Array([1, 0, 1])))]) }]) }],
      { stored: true })];
    const pkg = (() => { const b = new PackageBuilder(); b.chunk(b.object("Thing", [["value", b.int(7)], ["name", b.cname("x")], ["list", b.array("Int32", [b.int(1), b.int(2)])]])); return b.build("save"); })();
    const world = persistencyBody([{ id: 5n, type: "gameDeviceComponentPS", data: props([prop("flags", "array:Bool", cat(u32(2), new Uint8Array([1, 0])))]) }, { id: 0n }]);
    const database = cat(u32(0), typeDatabaseBody(TYPES, [["flags", "array:Bool"]]));
    const bundle = scriptBundle(["DoorControllerPS", "m_isOpen", "SomeMod.OutfitState"]);
    const types = oracle();
    const internal: string[] = [];
    let slowest = 0;
    const attempt = (run: () => void) => {
      const began = performance.now();
      try { run(); } catch (error) { if (!expected(error)) internal.push(String((error as Error)?.stack ?? error)); }
      slowest = Math.max(slowest, performance.now() - began);
    };
    for (let n = 0; n < 2400; n++) {
      switch (n % 6) {
        case 0: case 1: attempt(() => {
          const explorer = openExplorer(mutate(saves[n % 2]!), EXPLORER_NAMES);
          // Past the container, nothing the explorer answers may throw.
          try {
            const rows = explorer.tree();
            for (const id of explorer.pending()) explorer.check(id);
            for (const row of explorer.tree()) {
              const node = explorer.node(row.id);
              if (node?.kind === "package") for (const object of node.objects.slice(0, 4)) explorer.object({ node: row.id, kind: "chunk", index: object.index });
              if (node?.kind === "persistency") for (const entry of explorer.entries(0, 10).rows) explorer.object({ node: row.id, kind: "entry", index: entry.index });
            }
            explorer.modData(); explorer.summary();
            expect(rows.length).toBeGreaterThan(0);
          } catch (error) { internal.push(`explorer: ${String((error as Error)?.stack ?? error)}`); }
        }); break;
        case 2: attempt(() => { const frame = readPackageFrame(mutate(pkg), "save"); for (let i = 0; i < frame.chunks.length; i++) decodeChunk(frame, i, types, { opaque: true, fieldTypes: true }); countOf(packageNames(frame)); }); break;
        case 3: attempt(() => { const body = mutate(world); const index = readPersistencyIndex(body); for (const entry of index.entries) decodePersistencyEntry(body, entry, types); }); break;
        case 4: attempt(() => { const read = readTypeDatabase(mutate(database)); createTypeOracle({ database: read }); }); break;
        case 5: attempt(() => { readScriptBundleNames(mutate(bundle)); }); break;
      }
    }
    expect(internal.slice(0, 3)).toEqual([]);
    expect(slowest).toBeLessThan(2000);
  });
});
