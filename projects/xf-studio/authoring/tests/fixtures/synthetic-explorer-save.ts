/**
 * One synthetic save for the Save Explorer's tests: its type database, a world-object stream (a partly readable entry and a Codeware-style
 * namespaced class), a container node, a script-systems package with a mod class, a native-system package and a bespoke node. Built from
 * the documented layouts; no real save is involved.
 */
import { buildSave, cat, i32, PackageBuilder, packageNodeBody, persistencyBody, prop, props, typeDatabaseBody, u32, u8, type SynthType } from "./synthetic-save";

export const EXPLORER_TYPES: SynthType[] = [
  { name: "Bool", kind: "fundamental", size: 1 }, { name: "Int32", kind: "fundamental", size: 4 }, { name: "CName", kind: "name", size: 8 },
  { name: "SomeMod.Mode", kind: "enum", size: 4 }, { name: "SomeMod.OutfitState", kind: "class" }, { name: "DoorControllerPS", kind: "class" },
  { name: "App.DynamicEntitySystemPS", kind: "class" }, { name: "[2]Int32", kind: "static-array", inner: "Int32", count: 2 },
];

function systems() {
  const b = new PackageBuilder();
  b.chunk(b.object("OutfitSystem", [["state", b.handle("SomeMod.OutfitState", 1)]]));
  b.chunk(b.object("SomeMod.OutfitState", [["mode", b.enumValue("SomeMod.Mode", "Wide")], ["name", b.string("Night out")],
    ["fixed", b.raw("[2]Int32", cat(i32(1), i32(2)))], ["count", b.int(2)]]));
  return packageNodeBody(b.build("save"));
}
function stats() {
  const b = new PackageBuilder();
  b.chunk(b.object("gameStatsStateMapStructure", [["kind", b.enumValue("gameStatIDType", "Player")]]));
  return packageNodeBody(b.build("save-plain"), new Uint8Array(3));
}
function world() {
  return persistencyBody([
    { id: 101n, type: "DoorControllerPS", data: props([prop("isOpen", "Bool", u8(1))]) },
    { id: 0n },
    { id: 102n, type: "DoorControllerPS", data: props([prop("isOpen", "Bool", u8(0)), prop("stuck", "[2]Int32", cat(i32(0), i32(0)))]) },
    { id: 103n, type: "App.DynamicEntitySystemPS", data: props([prop("count", "Int32", i32(4))]) },
  ]);
}
export function syntheticSave() {
  return buildSave([
    { name: "TypeDatabase_v2", body: typeDatabaseBody(EXPLORER_TYPES, [["isOpen", "Bool"], ["count", "Int32"], ["stuck", "[2]Int32"]]) },
    { name: "PersistencySystem2", body: world() },
    { name: "inventory", body: u32(1), children: [{ name: "itemData", body: new Uint8Array(20).fill(5) }] },
    { name: "ScriptableSystemsContainer", body: systems() },
    { name: "StatsSystem", body: stats() },
    { name: "TimeSystem", body: new Uint8Array(40).fill(2) },
  ], { chunkSize: 128 });
}
export const EXPLORER_NAMES = { engine: { enums: ["gameStatIDType"], bitfields: [], classes: ["gameStatsStateMapStructure"], properties: ["kind"] },
  scripts: ["DoorControllerPS", "m_isOpen", "OutfitSystem", "SomeMod.OutfitState", "App.DynamicEntitySystemPS"] };

