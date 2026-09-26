// The save's loadout (save-loadout.ts) and the object package reader it uses (save-package.ts), on synthetic packages built here: the
// layout WolvenKit's `RedPackageReader` reads for a save's script systems (u32 CRUID count), with self-describing field tables.
import { describe, expect, test } from "bun:test";
import { readSavePackage, SavePackageError } from "../src/save-package";
import { parseSavedLoadout, readSavedLoadout, wornAreas } from "../src/save-loadout";
import { parseSavedV, readSavedV } from "../src/save-reader";
import { tweakDbId } from "../src/tweakdb-flats";

type Value = { type: string; bytes: Uint8Array };
class PackageBuilder {
  readonly names: string[] = [""];
  readonly chunks: { type: string; bytes: Uint8Array }[] = [];
  name(text: string) { let index = this.names.indexOf(text); if (index < 0) { index = this.names.length; this.names.push(text); } return index; }
  u16 = (n: number) => new Uint8Array(new Uint16Array([n]).buffer);
  u32 = (n: number) => new Uint8Array(new Uint32Array([n]).buffer);
  i32 = (n: number) => new Uint8Array(new Int32Array([n]).buffer);
  u64 = (n: bigint) => new Uint8Array(new BigUint64Array([n]).buffer);
  cat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of parts) { out.set(part, at); at += part.length; } return out; };
  enumValue = (type: string, member: string): Value => ({ type, bytes: this.u16(this.name(member)) });
  tweak = (id: bigint): Value => ({ type: "TweakDBID", bytes: this.u64(id) });
  bool = (value: boolean): Value => ({ type: "Bool", bytes: new Uint8Array([value ? 1 : 0]) });
  int = (value: number): Value => ({ type: "Int32", bytes: this.i32(value) });
  handles = (type: string, indexes: number[]): Value => ({ type: `array:handle:${type}`, bytes: this.cat(this.u32(indexes.length), ...indexes.map(this.i32)) });
  array = (type: string, items: Value[]): Value => ({ type: `array:${type}`, bytes: this.cat(this.u32(items.length), ...items.map(item => item.bytes)) });
  /** An object: u16 field count, (name, type, offset) per field, then the values. */
  object = (type: string, fields: [string, Value][]): Value => {
    const table: Uint8Array[] = [], values: Uint8Array[] = [];
    let offset = 2 + fields.length * 8;
    for (const [name, value] of fields) {
      table.push(this.u16(this.name(name)), this.u16(this.name(value.type)), this.u32(offset));
      values.push(value.bytes); offset += value.bytes.length;
    }
    return { type, bytes: this.cat(this.u16(fields.length), ...table, ...values) };
  };
  chunk(value: Value) { this.chunks.push({ type: value.type, bytes: value.bytes }); return this.chunks.length - 1; }
  /** The package: header, u32 CRUID count, names and chunks (six sections, no reference pool). */
  build(): Uint8Array {
    const typeIndexes = this.chunks.map(chunk => this.name(chunk.type));
    const nameBytes = this.names.map(text => this.cat(new TextEncoder().encode(text), new Uint8Array([0])));
    const nameDesc = 0, nameData = this.names.length * 4, chunkDesc = nameData + nameBytes.reduce((sum, bytes) => sum + bytes.length, 0);
    const chunkData = chunkDesc + this.chunks.length * 8;
    let at = nameData; const desc = nameBytes.map(bytes => { const d = this.u32((at & 0xffffff) | (bytes.length << 24)); at += bytes.length; return d; });
    let chunkAt = chunkData; const chunkTable = this.chunks.map((chunk, i) => { const entry = this.cat(this.u32(typeIndexes[i]!), this.u32(chunkAt)); chunkAt += chunk.bytes.length; return entry; });
    return this.cat(new Uint8Array([4, 0]), this.u16(6), this.u32(this.chunks.length), this.u32(nameDesc), this.u32(nameData), this.u32(chunkDesc), this.u32(chunkData),
      this.u32(0), ...desc, ...nameBytes, ...chunkTable, ...this.chunks.map(chunk => chunk.bytes));
  }
}
const AREA = "gamedataEquipmentArea";
const TSHIRT = BigInt(tweakDbId("Items.TShirt_01_basic_01")), PANTS = BigInt(tweakDbId("Items.Pants_01_basic_01"));
const UNDERWEAR = BigInt(tweakDbId("Items.Underwear_Basic_01_Bottom")), JACKET = BigInt(tweakDbId("Items.Jacket_01_basic_01"));
const HAT = BigInt(tweakDbId("Items.Helmet_01_basic_01"));

/** A save's script systems: an equipment system with two owners (an NPC's and the player's), and a script mod's chunk of an unknown class. */
function scriptSystems(options: { visuals?: [string, boolean, bigint | null][]; activeIndex?: number } = {}) {
  const b = new PackageBuilder();
  const item = (id: bigint) => b.object("gameItemID", [["id", b.tweak(id)], ["rngSeed", { type: "Uint32", bytes: b.u32(7) }]]);
  const slot = (id: bigint | null) => b.object("gameSEquipSlot", id ? [["itemID", item(id)]] : []);
  const area = (name: string, ids: (bigint | null)[], active?: number) => b.object("gameSEquipArea", [["areaType", b.enumValue(AREA, name)],
    ["equipSlots", b.array("gameSEquipSlot", ids.map(slot))], ...(active !== undefined ? [["activeIndex", b.int(active)] as [string, Value]] : [])]);
  const visual = ([name, hidden, visualItem]: [string, boolean, bigint | null]) => b.object("gameSSlotVisualInfo", [["areaType", b.enumValue(AREA, name)],
    ...(hidden ? [["isHidden", b.bool(true)] as [string, Value]] : []), ...(visualItem ? [["visualItem", item(visualItem)] as [string, Value]] : [])]);
  const entity = (hash: bigint) => b.object("entEntityID", [["hash", { type: "Uint64", bytes: b.u64(hash) }]]);
  b.chunk(b.object("EquipmentSystem", [["ownerData", b.handles("EquipmentSystemPlayerData", [2, 3])]]));
  b.chunk(b.object("SomeMod.OutfitState", [["parts", { type: "array:SomeMod.OutfitPart", bytes: b.cat(b.u32(1), b.u16(0)) }]]));
  b.chunk(b.object("EquipmentSystemPlayerData", [["ownerID", entity(9000324n)]]));
  b.chunk(b.object("EquipmentSystemPlayerData", [["ownerID", entity(1n)], ["equipment", b.object("gameSLoadout", [["equipAreas", b.array("gameSEquipArea", [
    area("Weapon", [123n, null]), area("InnerChest", [TSHIRT]), area("OuterChest", [null, JACKET], options.activeIndex ?? 1), area("Legs", [PANTS]),
    area("Head", [HAT]), area("UnderwearBottom", [UNDERWEAR]), area("Face", [null])])]])],
    ["clothingVisualsInfo", b.array("gameSSlotVisualInfo", (options.visuals ?? [["Outfit", false, null], ["OuterChest", false, null], ["InnerChest", false, null],
      ["Legs", false, null], ["Head", false, null], ["UnderwearBottom", true, null]]).map(visual))],
    ["hotkeys", b.handles("Hotkey", [])]]));
  const pkg = b.build();
  return b.cat(b.u32(pkg.length), pkg);
}
const sets = (active: number) => new Uint8Array([0, ...new Uint8Array(new Uint32Array([active]).buffer)]);

describe("save loadout", () => {
  test("reads the player's equipped clothing, visuals and hide flags; the other owner and a mod's chunk are left alone", () => {
    const loadout = readSavedLoadout(scriptSystems(), sets(8));
    expect(loadout.evidence).toEqual({ owner: "1", owners: 2, skipped: [] });
    expect(loadout.wardrobeSet).toBeNull();
    expect(loadout.equipped).toEqual([{ area: "InnerChest", item: String(TSHIRT) }, { area: "OuterChest", item: String(JACKET) },
      { area: "Legs", item: String(PANTS) }, { area: "Head", item: String(HAT) }, { area: "UnderwearBottom", item: String(UNDERWEAR) }]);
    expect(loadout.visuals.find(entry => entry.area === "UnderwearBottom")).toEqual({ area: "UnderwearBottom", hidden: true, item: null });
    expect(wornAreas(loadout).map(entry => [entry.area, entry.hidden])).toEqual([["OuterChest", false], ["InnerChest", false], ["Legs", false],
      ["Head", false], ["UnderwearBottom", true]]);
    expect(parseSavedLoadout(JSON.parse(JSON.stringify(loadout)))).toEqual(loadout);
  });

  test("the active slot decides the equipped item, and an active wardrobe set's visual items override it (never the underwear's)", () => {
    expect(readSavedLoadout(scriptSystems({ activeIndex: 0 }), null).equipped.some(entry => entry.area === "OuterChest")).toBe(false);
    const loadout = readSavedLoadout(scriptSystems({ visuals: [["Head", true, null], ["Legs", false, TSHIRT], ["UnderwearBottom", false, PANTS]] }), sets(2));
    expect(loadout.wardrobeSet).toBe(2);
    const worn = wornAreas(loadout);
    expect(worn.find(entry => entry.area === "Legs")?.item).toBe(String(TSHIRT));
    expect(worn.find(entry => entry.area === "UnderwearBottom")?.item).toBe(String(UNDERWEAR));
    expect(worn.find(entry => entry.area === "Head")).toEqual({ area: "Head", item: String(HAT), hidden: true });
  });

  test("the package reader refuses malformed frames and walks any class by its own field tables", () => {
    expect(() => readSavePackage(new Uint8Array(10))).toThrow(SavePackageError);
    const bytes = scriptSystems().subarray(4);
    const broken = bytes.slice(); broken[0] = 3;
    expect(() => readSavePackage(broken)).toThrow(/version 3/);
    const pkg = readSavePackage(bytes);
    expect(pkg.chunks.map(chunk => chunk.type)).toEqual(["EquipmentSystem", "SomeMod.OutfitState", "EquipmentSystemPlayerData", "EquipmentSystemPlayerData"]);
    // A script mod's class is walkable by its own field tables (the loadout never needs it); a static array isn't read, only skipped.
    expect(pkg.decode(1, new Set()).object.fields.parts).toEqual([{ $type: "SomeMod.OutfitPart", fields: {} }]);
    expect(() => readSavedLoadout(new Uint8Array([1, 0, 0, 0]), null)).toThrow();
  });

  test("a stored V keeps its loadout; one stored before clothes were read has none, and one whose script data failed is null", () => {
    const stored = { schema: "eye-artistry/saved-v-1", saveVersion: 269, gameVersion: 2310, presetVersion: 12, isMale: false, brainIsMale: false,
      groups: { head: [], arms: [], body: [] }, perspectives: [], tags: ["Long"],
      evidence: { nodeName: "CharacetrCustomization_Appearances", nodeBytes: 1, bytesRead: 1, trailingBytes: 0, chunks: 1, decompressedBytes: 1 } };
    expect("loadout" in parseSavedV(stored)).toBe(false);
    expect(parseSavedV({ ...stored, loadout: null }).loadout).toBeNull();
    const loadout = readSavedLoadout(scriptSystems(), null);
    expect(parseSavedV({ ...stored, loadout }).loadout).toEqual(loadout);
    expect(() => parseSavedV({ ...stored, loadout: { ...loadout, equipped: [{ area: "Nowhere", item: "1" }] } })).toThrow();
  });

  // Private local integration fixture (never distributed): the maintainer's 2.31 check save, when this checkout has it.
  const privateSave = new URL("../../../../local/saves/2026-09-25-res01-check/sav.dat", import.meta.url);
  test("the private check save's loadout decodes to the vanilla items it wears", async () => {
    const file = Bun.file(privateSave);
    if (!(await file.exists())) return;
    const v = readSavedV(await file.bytes());
    expect(v.loadout?.evidence.owner).toBe("1");
    expect(v.loadout?.equipped.map(entry => entry.area)).toEqual(["OuterChest", "InnerChest", "UnderwearBottom", "Legs", "Feet"]);
    expect(v.loadout?.equipped.find(entry => entry.area === "UnderwearBottom")?.item).toBe(String(UNDERWEAR));
  });
});
