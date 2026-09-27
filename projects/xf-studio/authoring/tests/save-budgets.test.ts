// The Save Explorer's and the loadout's budgets against hostile input (the code-health review at 62637f4: SAVE-11..15), each built from
// the review's reproductions scaled down: chunks of hundreds of thousands of empty structs, packages of 65,536 one-byte chunks, a save of
// thousands of tiny packages, a package whose names fill most of its cap, and a world-object index of 100,000 entries. Synthetic data
// only; no real save is read. Every test here failed on the code before the fix.
import { describe, expect, test } from "bun:test";
import { chunkBudget, decodeChunk, detectSavePackage, MAX_OPEN_CHUNKS, MAX_READING_VALUES, MAX_VALUES, packageNames, PackageFrameError, readPackageFrame, valueBudget }
  from "../src/engines/red-object/package";
import { readPersistencyIndex } from "../src/engines/red-object/persistency";
import { openExplorer, SaveExplorerActions, type SaveExplorerDevice } from "../src/features/save-explorer";
import { readSavedLoadout } from "../src/save-loadout";
import { buildSave, packageNodeBody, PackageBuilder, persistencyBody, u32 } from "./fixtures/synthetic-save";

/**
 * A `save` package of chunks of `type`, each one field `f: array:Foo` of `counts[i]` zero-field structs (2 bytes each): written directly,
 * as the review's reproduction did, since the builder would concatenate hundreds of thousands of parts.
 */
function structArrays(type: string, counts: readonly number[]): Uint8Array {
  const names = [type, "f", "array:Foo", "Foo"].map(name => new TextEncoder().encode(`${name}\0`));
  const nameData = names.length * 4, chunkDesc = nameData + names.reduce((sum, name) => sum + name.length, 0) + 1, chunkData = chunkDesc + counts.length * 8;
  const base = 28, objects = counts.map(n => 14 + 2 * n), total = base + chunkData + objects.reduce((sum, bytes) => sum + bytes, 0);
  const bytes = new Uint8Array(total), view = new DataView(bytes.buffer);
  bytes[0] = 4; view.setUint16(2, 6, true); view.setUint32(4, counts.length, true);
  view.setUint32(12, nameData, true); view.setUint32(16, chunkDesc, true); view.setUint32(20, chunkData, true);
  let at = nameData;
  names.forEach((name, i) => { view.setUint32(base + i * 4, at | (name.length << 24), true); bytes.set(name, base + at); at += name.length; });
  let start = chunkData;
  counts.forEach((n, c) => {
    view.setUint32(base + chunkDesc + c * 8, 0, true); view.setUint32(base + chunkDesc + c * 8 + 4, start, true);
    const o = base + start;
    view.setUint16(o, 1, true); view.setUint16(o + 2, 1, true); view.setUint16(o + 4, 2, true); view.setUint32(o + 6, 10, true); view.setUint32(o + 10, n, true);
    start += objects[c]!;
  });
  return bytes;
}

/** A save node body: a `save-plain` package of `count` one-byte chunks of type `A` (the review's SAVE-12 package). */
function oneByteChunks(count = 65_536): Uint8Array {
  const name = new TextEncoder().encode("A\0");
  const nameData = 4, chunkDesc = nameData + name.length + 1, chunkData = chunkDesc + count * 8, base = 24, size = base + chunkData + count;
  const body = new Uint8Array(4 + size), view = new DataView(body.buffer, 4);
  new DataView(body.buffer).setUint32(0, size, true);
  body[4] = 4; view.setUint16(2, 6, true); view.setUint32(4, 1, true);
  view.setUint32(12, nameData, true); view.setUint32(16, chunkDesc, true); view.setUint32(20, chunkData, true);
  view.setUint32(base, nameData | (name.length << 24), true); body.set(name, 4 + base + nameData);
  for (let c = 0; c < count; c++) { view.setUint32(base + chunkDesc + c * 8, 0, true); view.setUint32(base + chunkDesc + c * 8 + 4, chunkData + c, true); }
  return body;
}

describe("SAVE-11: decoded values", () => {
  test("the chunks one reading decodes share a budget of values, as its names share one", () => {
    const frame = readPackageFrame(structArrays("Thing", [600, 600]), "save"), budget = valueBudget(1000);
    expect(Object.keys(decodeChunk(frame, 0, new Set(), { values: budget }).object.fields)).toEqual(["f"]);
    expect(budget.remaining).toBe(1000 - 601);
    let error: unknown;
    try { decodeChunk(frame, 1, new Set(), { values: budget }); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(PackageFrameError);
    expect(error).toMatchObject({ kind: "limit", message: expect.stringMatching(/more values than a save's do/) });
    // Without a budget, only the chunk's own cap applies.
    expect(decodeChunk(frame, 1, new Set()).object.$type).toBe("Thing");
  });

  test("a chunk of more values than a save's largest object by far is refused (the review's 1.9 MB chunk, which decoded to 260 MB)", () => {
    expect(MAX_VALUES).toBe(500_000);
    const frame = readPackageFrame(structArrays("Thing", [MAX_VALUES + 10]), "save");
    expect(() => decodeChunk(frame, 0, new Set(), { opaque: true, fieldTypes: true })).toThrow(/more values than a save's script data can/);
    const fits = readPackageFrame(structArrays("Thing", [1000]), "save"), read = decodeChunk(fits, 0, new Set());
    expect((read.object.fields.f as unknown[]).length).toBe(1000);
    // Field types only when asked for; objects without fields all share one empty record.
    expect(read.object.types).toBeUndefined();
    const [first, second] = read.object.fields.f as { fields: object }[];
    expect(first!.fields).toBe(second!.fields);
    expect(Object.isFrozen(first!.fields)).toBe(true);
  });

  test("the loadout's owners share one reading's budget (the review's four-chunk save, which peaked at 0.8 GB)", () => {
    expect(MAX_READING_VALUES).toBe(1_000_000);
    const pkg = structArrays("EquipmentSystemPlayerData", [400_000, 400_000, 400_000]);
    const systems = new Uint8Array(4 + pkg.length);
    new DataView(systems.buffer).setUint32(0, pkg.length, true);
    systems.set(pkg, 4);
    expect(() => readSavedLoadout(systems, null)).toThrow(/more values than a save's do/);
  });
});

describe("SAVE-12: chunk tables", () => {
  test("a frame keeps its chunks as numbers, and a reading's packages share one budget of chunks", () => {
    const body = oneByteChunks(), frame = detectSavePackage(body)!.frame;
    expect(frame.chunkCount).toBe(65_536);
    expect("chunks" in frame).toBe(false);
    expect([frame.chunkType(9), frame.chunkStart(9) + 1, frame.chunkEnd(65_535)]).toEqual(["A", frame.chunkEnd(9), frame.bytes.length]);
    expect(frame.chunk(65_536)).toBeUndefined();
    const budget = chunkBudget(100_000);
    expect(detectSavePackage(body, { chunks: budget })?.frame.chunkCount).toBe(65_536);
    expect(budget.remaining).toBe(100_000 - 65_536);
    expect(() => detectSavePackage(body, { chunks: budget })).toThrow(/more objects than a save's do/);
    expect(budget.remaining).toBe(100_000 - 65_536);
  });

  test("a save's packages past the budget are kept as bytes, and say why (the review's 20 packages, scaled to 3)", () => {
    expect(MAX_OPEN_CHUNKS).toBe(131_072);
    const body = oneByteChunks();
    const save = buildSave([{ name: "PkgA", body }, { name: "PkgB", body }, { name: "PkgC", body }], { chunkSize: 4 * 1024 * 1024 });
    const explorer = openExplorer(save, {});
    const rows = explorer.tree().filter(row => row.name.startsWith("Pkg"));
    expect(rows.map(row => row.encoding)).toEqual(["package", "package", "bespoke"]);
    expect(rows[2]!.detail).toMatch(/packages hold more objects than a save's do/);
    expect(explorer.node(rows[2]!.id)).toMatchObject({ kind: "bespoke", note: expect.stringMatching(/is an object package, but the save's packages hold more objects/) });
    for (const id of explorer.pending()) explorer.check(id);
    const first = explorer.node(rows[0]!.id);
    expect(first).toMatchObject({ kind: "package", decoded: 0, failed: 65_536 });
    if (first?.kind === "package") expect(first.objects[7]).toEqual({ index: 7, type: "A", status: "failed", note: "A passes the end of its chunk." });
  });

  test("a check keeps each distinct note once, and objects past 1,024 distinct failures share a plain one", () => {
    // 2,000 chunks, chunk i claiming i + 1 fields it can't hold: each fails with its own message.
    const b = new PackageBuilder();
    for (let i = 0; i < 2000; i++) b.chunk(b.raw("Broken", u32(i + 1).subarray(0, 2)));
    const save = buildSave([{ name: "Pkg", body: packageNodeBody(b.build("save-plain")) }], { chunkSize: 4 * 1024 * 1024 });
    const explorer = openExplorer(save, {}), id = explorer.tree().find(row => row.encoding === "package")!.id;
    const node = explorer.node(id);
    expect(node).toMatchObject({ kind: "package", failed: 2000 });
    if (node?.kind !== "package") return;
    expect(node.objects[0]!.note).toBe("Broken: 1 fields cannot fit.");
    expect(node.objects[1023]!.note).toBe("Broken: 1024 fields cannot fit.");
    expect(node.objects.slice(1024).every(row => row.note === "This object couldn't be read, like many others in this package.")).toBe(true);
    expect(new Set(node.objects.map(row => row.note)).size).toBe(1025);
  });
});

describe("SAVE-13: the tree's check", () => {
  /** A save of `count` empty `save-plain` package nodes (24 bytes each, no chunks). */
  const tinyPackages = (count: number) => {
    const body = new Uint8Array(28), view = new DataView(body.buffer);
    view.setUint32(0, 24, true); body[4] = 4; view.setUint16(6, 6, true);
    return buildSave(Array.from({ length: count }, (_, i) => ({ name: `n${i}`, body })), { chunkSize: 256 * 1024 });
  };

  test("a check replaces only its node's row, in a copy: earlier answers and the other rows stay as they were", () => {
    const explorer = openExplorer(tinyPackages(50), {});
    const before = explorer.tree(), [first, second] = explorer.pending();
    expect(before[first!]!.status).toBe("checking");
    explorer.checkStep(first!);
    const after = explorer.tree();
    expect(after).not.toBe(before);
    expect(before[first!]!.status).toBe("checking");
    expect(after[first!]!.status).toBe("decoded");
    expect(after.every((row, i) => i === first || row === before[i])).toBe(true);
    expect(after[second!]!.status).toBe("checking");
  });

  test("a save of thousands of tiny packages publishes a few times, not once a package (the review's 20,000 nodes, scaled to 2,000)", async () => {
    const save = tinyPackages(2000);
    const device: SaveExplorerDevice = { list: async () => ({ available: true, saves: [] }), read: async () => save, pick: async () => ({ name: "sav.dat", size: save.length, bytes: async () => save }),
      names: async () => { throw Error("offline"); }, thumbnail: () => null };
    // A clock one millisecond on at every look: each step seems to take a few, so the check yields often but publishes about every 250.
    let clock = 0, yields = 0, revisions = 0;
    const service = new SaveExplorerActions(device, () => { yields++; return Promise.resolve(); }, { now: () => clock++ });
    service.subscribe(() => revisions++);
    expect(await service.dispatch({ kind: "saves.openFile" })).toEqual({ ok: true });
    expect(service.tree().filter(row => row.status === "checking")).toHaveLength(0);
    expect(service.snapshot().open.checking).toBe(false);
    expect(yields).toBeGreaterThan(100);
    expect(revisions).toBeLessThan(100);
  });
});

describe("SAVE-14: package names", () => {
  test("a name the oracle's pass read is not charged again when a decode uses it", () => {
    // 2,500 fields named by 250-byte names: 625 KB, under a package's 1 MB cap once, over it twice.
    const b = new PackageBuilder();
    b.chunk(b.object("Big", Array.from({ length: 2500 }, (_, i) => [`f${String(i).padStart(4, "0")}`.padEnd(250, "x"), b.bool(true)])));
    const frame = readPackageFrame(b.build("save"), "save");
    let names = 0;
    for (const _ of packageNames(frame)) names++;
    expect(names).toBe(2503);
    expect(Object.keys(decodeChunk(frame, 0, new Set()).object.fields)).toHaveLength(2500);
  });
});

describe("SAVE-15: the world-object index", () => {
  test("the index keeps where each entry starts and makes entries on demand (the review's million entries, scaled to 100,000)", () => {
    const entries = Array.from({ length: 100_000 }, (_, i) => i % 5 === 1 ? { id: 0n } : { id: BigInt(i + 1), type: "gameDeviceComponentPS", data: new Uint8Array(0) });
    const body = persistencyBody(entries), index = readPersistencyIndex(body);
    expect("entries" in index).toBe(false);
    expect([index.count, index.filled]).toEqual([100_000, 80_000]);
    expect(index.entry(1)).toEqual({ index: 1, id: 0n, classHash: 0n, size: 0, start: -1 });
    expect([index.isFilled(1), index.classHash(1), index.isFilled(2), index.isFilled(100_000), index.entry(100_000)]).toEqual([false, 0n, true, false, undefined]);
    const entry = index.entry(99_999)!;
    expect(entry).toMatchObject({ index: 99_999, id: 100_000n, size: 0 });
    expect(entry.classHash).toBe(index.classHash(99_999));
    expect(entry.start).toBe(body.length);
  });
});
