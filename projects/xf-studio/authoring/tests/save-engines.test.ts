// The save engines on synthetic bytes (tests/fixtures/synthetic-save.ts): the container codec, the name hashes, the save's type database,
// the type oracle, the one package reader (save, native-system and resource variants), the world-object persistency stream and the
// script bundle's names. Real saves are private; their measured results are in research/save/save-editor-design.md.
import { describe, expect, test } from "bun:test";
import { openSave, readSaveHeader, SaveFormatError } from "../src/engines/save/container";
import { fnv1a32, fnv1a64, hashText } from "../src/engines/red-object/hash";
import { readTypeDatabase, TypeDatabaseError } from "../src/engines/red-object/type-database";
import { createTypeOracle } from "../src/engines/red-object/type-oracle";
import { decodeChunk, detectSavePackage, packageNames, PackageFrameError, readPackageFrame } from "../src/engines/red-object/package";
import { decodePersistencyEntry, readPersistencyIndex } from "../src/engines/red-object/persistency";
import { readScriptBundleNames, ScriptBundleError } from "../src/engines/red-object/script-bundle";
import { buildSave, cat, f32, i32, PackageBuilder, packageNodeBody, persistencyBody, prop, props, scriptBundle, struct, text, typeDatabaseBody, u16, u32,
  u64, u8, type SynthType } from "./fixtures/synthetic-save";

/** FNV-1a 64 the long way (BigInt), to check the two-halves implementation. */
const reference64 = (name: string) => {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(name)) { hash ^= BigInt(byte); hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn; }
  return hash;
};

describe("name hashes", () => {
  test("FNV-1a 64 matches the definition, and FNV-1a 32 the known vector", () => {
    for (const name of ["", "a", "Bool", "EquipmentEx.OutfitState", "array:handle:gameItemData", "é", "z".repeat(300)]) expect(fnv1a64(name)).toBe(reference64(name));
    expect(hashText(fnv1a64(""))).toBe("cbf29ce484222325");
    expect(fnv1a32("a")).toBe(0xe40c292c);
  });
});

describe("save container", () => {
  const tree = () => buildSave([
    { name: "GameSessionDesc", body: new Uint8Array([1, 2, 3]), children: [{ name: "game::SessionConfig", body: new Uint8Array(40).fill(7) }] },
    { name: "inventory", body: u32(2), children: [{ name: "itemData", body: new Uint8Array(30).fill(1) }, { name: "itemData", body: new Uint8Array(30).fill(2) }] },
    { name: "Solo", body: new Uint8Array(100).fill(9) },
  ], { chunkSize: 64 });

  test("reads the header, expands every chunk and builds the node tree from its links", () => {
    const bytes = tree(), save = openSave(bytes);
    expect(readSaveHeader(bytes)).toMatchObject({ saveVersion: 269, gameVersion: 2310, archiveVersion: 195 });
    expect(save.chunks.length).toBeGreaterThan(3);
    expect(save.chunks.every(chunk => chunk.compressed)).toBe(true);
    expect(save.nodes.map(node => [node.name, node.parent, node.depth])).toEqual([["GameSessionDesc", null, 0], ["game::SessionConfig", 0, 1],
      ["inventory", null, 0], ["itemData", 2, 1], ["itemData", 2, 1], ["Solo", null, 0]]);
    expect(save.roots).toEqual([0, 2, 5]);
    expect(save.nodes[2]!.children).toEqual([3, 4]);
    expect(save.issues).toEqual([]);
    expect(save.nodes.every(node => node.idMatches)).toBe(true);
    // A node's data starts with its ID; `body` is its own part, before its first child.
    expect([...save.body(0)]).toEqual([1, 2, 3]);
    expect([...save.body(5)]).toEqual(new Array(100).fill(9));
    expect(save.data(1).length).toBe(44);
    expect(save.find("itemData").map(node => node.id)).toEqual([3, 4]);
    const offset = save.nodes[5]!.offset;
    expect(save.chunkAt(offset)).toBe(save.chunks.filter(chunk => chunk.start <= offset).length - 1);
  });

  test("stored (uncompressed) chunks read the same", () => {
    const stored = openSave(buildSave([{ name: "A", body: new Uint8Array(10).fill(4) }], { stored: true }));
    expect(stored.chunks[0]!.compressed).toBe(false);
    expect([...stored.body(0)]).toEqual(new Array(10).fill(4));
  });

  test("refuses what isn't a save, and a broken footer or chunk table", () => {
    expect(() => openSave(new Uint8Array(100))).toThrow(SaveFormatError);
    expect(() => openSave(new Uint8Array(10))).toThrow(/size/);
    const bytes = tree();
    const footer = bytes.slice(); footer[footer.length - 1] = 0;
    expect(() => openSave(footer)).toThrow(/footer/);
    const table = bytes.slice(); new DataView(table.buffer).setUint32(readSaveHeader(bytes).tableOffset + 8, 1, true);
    expect(() => openSave(table)).toThrow(SaveFormatError);
  });

  test("a table whose links don't form a tree still lists every node, with plain notes", () => {
    const bytes = tree(), save = openSave(bytes);
    // Point the last root's next link back at node 0: a loop.
    const rows = save.nodeTableOffset;
    const patched = bytes.slice();
    const view = new DataView(patched.buffer);
    // Walk the table to node 5's next field: name (VLQ + text), i32 next.
    let at = rows + 4 + 1;
    for (let id = 0; id < 6; id++) {
      const length = -((patched[at]! & 0x80) ? -(patched[at]! & 63) : patched[at]! & 63);
      at += 1 + Math.abs(length);
      if (id === 5) view.setInt32(at, 0, true);
      at += 16;
    }
    const looped = openSave(patched);
    expect(looped.nodes).toHaveLength(6);
    expect(looped.issues.some(issue => /linked twice/.test(issue))).toBe(true);
  });
});

describe("type database and oracle", () => {
  const types: SynthType[] = [
    { name: "Bool", kind: "fundamental", size: 1 }, { name: "Int32", kind: "fundamental", size: 4 }, { name: "CName", kind: "name", size: 8 },
    { name: "SomeMod.Mode", kind: "enum", size: 4 }, { name: "SomeMod.State", kind: "class" }, { name: "SomeMod.Part", kind: "class" },
    { name: "array:SomeMod.Part", kind: "array", inner: "SomeMod.Part" }, { name: "handle:SomeMod.State", kind: "handle", inner: "SomeMod.State" },
    { name: "[3]Int32", kind: "static-array", inner: "Int32", count: 3 },
  ];
  const data = () => cat(u32(1), typeDatabaseBody(types, [["mode", "SomeMod.Mode"], ["parts", "array:SomeMod.Part"], ["m_hidden", "Bool"]], 2));

  test("reads the tables, sorted by hash, with kinds and sizes from the flags", () => {
    const db = readTypeDatabase(data());
    expect(db.version).toBe(3);
    expect(db.types).toHaveLength(types.length);
    expect(db.unknownCount).toBe(2);
    const hashes = db.types.map(type => type.hash);
    expect([...hashes].sort((a, b) => a < b ? -1 : 1)).toEqual(hashes);
    expect(db.type(fnv1a64("SomeMod.Mode"))).toMatchObject({ kind: "enum", size: 4 });
    expect(db.type(fnv1a64("array:SomeMod.Part"))).toMatchObject({ kind: "array", inner: fnv1a64("SomeMod.Part") });
    expect(db.propertyType(db.properties[0]!)?.hash).toBe(fnv1a64("SomeMod.Mode"));
    // A table that doesn't add up to the node's size is an unknown layout.
    expect(() => readTypeDatabase(data().subarray(0, 60))).toThrow(TypeDatabaseError);
  });

  test("the oracle answers from the save first, then the engine list; container types are named from their elements", () => {
    const database = readTypeDatabase(data());
    const oracle = createTypeOracle({ database, engine: { enums: ["gameNative"], bitfields: ["gameFlags"], classes: ["gameThing", "SomeMod.Mode"], properties: ["value"] },
      names: [{ source: "scripts", names: ["SomeMod.State", "SomeMod.Part", "SomeMod.Mode", "m_hidden", "mode"] }, { source: "package", names: ["parts"] }] });
    expect(oracle.kindOf("SomeMod.Mode")).toEqual({ kind: "enum", source: "save" });
    expect(oracle.kindOf("gameNative")).toEqual({ kind: "enum", source: "engine" });
    expect(oracle.isBitfield("gameFlags")).toBe(true);
    expect(oracle.kindOf("gameThing")).toEqual({ kind: "class", source: "engine" });
    expect(oracle.kindOf("Unknown.Type")).toBeUndefined();
    expect(oracle.type(fnv1a64("array:SomeMod.Part"))?.name).toBe("array:SomeMod.Part");
    expect(oracle.type(fnv1a64("handle:SomeMod.State"))?.name).toBe("handle:SomeMod.State");
    expect(oracle.type(fnv1a64("[3]Int32"))?.name).toBe("[3]Int32");
    // A script field `m_hidden` is persisted as `hidden`.
    expect(oracle.name(fnv1a64("hidden"))).toEqual({ name: "hidden", source: "scripts" });
    expect(oracle.name(fnv1a64("parts"))).toEqual({ name: "parts", source: "package" });
    expect(oracle.name(fnv1a64("nobody"))).toBeUndefined();
    expect(oracle.stats).toMatchObject({ types: types.length, typesNamed: types.length, properties: 3 });
    expect(oracle.stats.propertiesNamed).toBe(3);
  });
});

describe("the one package reader", () => {
  const modPackage = (variant: "save" | "save-plain" | "resource" = "save") => {
    const b = new PackageBuilder();
    b.chunk(b.object("SomeMod.System", [["state", b.handle("SomeMod.State", 1)]]));
    b.chunk(b.object("SomeMod.State", [["mode", b.enumValue("SomeMod.Mode", "Wide")], ["flags", b.bitfield("gameFlags", ["A", "C"])],
      ["name", b.string("Outfit one")], ["tag", b.cname("tag_a")], ["fixed", b.raw("[2]Int32", cat(i32(1), i32(2)))], ["count", b.int(3)],
      ["parts", b.array("SomeMod.Part", [b.object("SomeMod.Part", [["on", b.bool(true)]])])]]));
    return b.build(variant);
  };
  const types = { isEnum: (name: string) => name === "SomeMod.Mode", isBitfield: (name: string) => name === "gameFlags" };

  test("decodes any class by its own field tables; the oracle settles enums and bitfields; unread values are skipped by offset", () => {
    const frame = readPackageFrame(modPackage(), "save");
    expect(frame.chunks.map(chunk => chunk.type)).toEqual(["SomeMod.System", "SomeMod.State"]);
    expect(decodeChunk(frame, 0, types).object.fields.state).toEqual({ $handle: 1 });
    const { object, skipped } = decodeChunk(frame, 1, types, { opaque: true, fieldTypes: true });
    expect(object.fields).toMatchObject({ mode: "Wide", flags: ["A", "C"], name: "Outfit one", tag: "tag_a", count: 3,
      parts: [{ $type: "SomeMod.Part", fields: { on: true } }] });
    expect(object.fields.fixed).toMatchObject({ $opaque: "[2]Int32", bytes: 8 });
    expect(object.types?.mode).toBe("SomeMod.Mode");
    expect(skipped).toEqual(["SomeMod.State.fixed: [2]Int32"]);
    // Without the oracle's enum answer the enum is read as a struct and the object can't be read.
    expect(() => decodeChunk(frame, 1, new Set<string>())).toThrow(PackageFrameError);
    expect(packageNames(frame)).toContain("array:SomeMod.Part");
  });

  test("a save node's package is found by its structure, with or without a CRUID list; the resource frame is shared", () => {
    expect(detectSavePackage(packageNodeBody(modPackage("save")))?.frame.variant).toBe("save");
    const plain = detectSavePackage(packageNodeBody(modPackage("save-plain"), new Uint8Array(9)));
    expect(plain?.frame.variant).toBe("save-plain");
    expect(plain?.trailing).toBe(9);
    expect(detectSavePackage(new Uint8Array(64).fill(3))).toBeNull();
    expect(detectSavePackage(cat(u32(40), new Uint8Array(40)))).toBeNull();
    const resource = readPackageFrame(modPackage("resource"), "resource");
    expect(resource.rootIndex).toBe(0);
    expect(resource.chunks).toHaveLength(2);
    expect(() => readPackageFrame(cat(u8(3), new Uint8Array(40)), "save")).toThrow(/version 3/);
  });
});

describe("persistency stream", () => {
  const types = [
    { name: "Bool", kind: "fundamental", size: 1 }, { name: "Int32", kind: "fundamental", size: 4 }, { name: "Float", kind: "fundamental", size: 4 },
    { name: "CName", kind: "name", size: 8 }, { name: "String", kind: "fundamental" }, { name: "EDoorState", kind: "enum", size: 4 },
    { name: "DoorSetup", kind: "class" }, { name: "DoorControllerPS", kind: "class" }, { name: "SubPS", kind: "class" },
    { name: "array:Int32", kind: "array", inner: "Int32" }, { name: "handle:SubPS", kind: "handle", inner: "SubPS" },
    { name: "[2]Int32", kind: "static-array", inner: "Int32", count: 2 },
  ] satisfies SynthType[];
  const database = readTypeDatabase(cat(u32(0), typeDatabaseBody(types, [])));
  const oracle = createTypeOracle({ database, names: [{ source: "scripts", names: ["isOpen", "state", "setup", "speed", "tags", "sub", "label", "extra", "DoorControllerPS", "SubPS"] }] });
  const door = props([prop("isOpen", "Bool", u8(1)), prop("state", "EDoorState", u32(2)), prop("speed", "Float", f32(1.5)),
    prop("label", "String", text("front")), prop("tags", "array:Int32", cat(u32(2), i32(7), i32(8))),
    prop("setup", "DoorSetup", struct([prop("isOpen", "Bool", u8(0))])), prop("sub", "handle:SubPS", cat(u64(fnv1a64("SubPS")), struct([prop("state", "EDoorState", u32(1))]))),
    prop("extra", "CName", u64(fnv1a64("tag_open")))]);
  const body = persistencyBody([{ id: 11n, type: "DoorControllerPS", data: door }, { id: 0n },
    { id: 12n, type: "DoorControllerPS", data: cat(props([prop("isOpen", "Bool", u8(1))]), u64(0n)) },
    { id: 13n, type: "DoorControllerPS", data: props([prop("isOpen", "Bool", u8(1)), prop("tags", "[2]Int32", cat(i32(1), i32(2)))]) },
    { id: 14n, type: "Mystery", data: cat(u64(fnv1a64("x")), u64(12345n), u32(1)) }], [5, 6]);

  test("indexes every entry by ID, class and extent, empty slots included", () => {
    const index = readPersistencyIndex(body);
    expect(index.ids).toBe(2);
    expect(index.entries.map(entry => [entry.id, entry.start >= 0])).toEqual([[11n, true], [0n, false], [12n, true], [13n, true], [14n, true]]);
    expect(index.filled).toBe(4);
    expect(() => readPersistencyIndex(cat(body, u8(0)))).toThrow(/after its last entry/);
  });

  test("walks an entry from the save's own types; names come from the oracle; an unwalkable entry stays raw with its reason", () => {
    const index = readPersistencyIndex(body);
    const first = decodePersistencyEntry(body, index.entries[0]!, oracle);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const values = Object.fromEntries(first.object.props.map(item => [oracle.name(item.nameHash)?.name, item.value]));
    expect(values).toMatchObject({ isOpen: true, state: 2, speed: 1.5, label: "front", tags: [7, 8] });
    expect(values.setup).toMatchObject({ $class: fnv1a64("DoorSetup"), props: [{ value: false }] });
    expect(values.sub).toMatchObject({ $class: fnv1a64("SubPS"), props: [{ value: 1 }] });
    expect(values.extra).toEqual({ $hash: hashText(fnv1a64("tag_open")) });
    // An entry that ends with a zero name hash reads completely.
    expect(decodePersistencyEntry(body, index.entries[2]!, oracle).ok).toBe(true);
    const fixed = decodePersistencyEntry(body, index.entries[3]!, oracle);
    expect(fixed).toMatchObject({ ok: false, reason: expect.stringMatching(/fixed arrays/) });
    if (!fixed.ok) { expect(fixed.partial.props).toHaveLength(1); expect(fixed.raw.length).toBe(index.entries[3]!.size); }
    expect(decodePersistencyEntry(body, index.entries[4]!, oracle)).toMatchObject({ ok: false, reason: expect.stringMatching(/type database/) });
  });
});

describe("script bundle names", () => {
  test("reads every CName; refuses what isn't a version-14 bundle", () => {
    expect(readScriptBundleNames(scriptBundle(["DoorControllerPS", "m_isOpen", "EquipmentEx.OutfitState"]))).toEqual(["DoorControllerPS", "m_isOpen", "EquipmentEx.OutfitState"]);
    expect(() => readScriptBundleNames(scriptBundle(["a"], 13))).toThrow(/version 13/);
    expect(() => readScriptBundleNames(new Uint8Array(200))).toThrow(ScriptBundleError);
    expect(() => readScriptBundleNames(new Uint8Array(10))).toThrow(/truncated/);
  });
});

// Keep the fixture helpers' encodings honest where the readers rely on them.
test("fixture encodings: u16 and a zero-length save string", () => {
  expect([...u16(258)]).toEqual([2, 1]);
  expect([...text("")]).toEqual([0]);
});
