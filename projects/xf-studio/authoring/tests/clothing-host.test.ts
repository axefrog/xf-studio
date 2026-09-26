// The clothing host's ports (PIPE-101): item records from a synthetic TweakDB blob (every value type the resolver reads), the save's
// record IDs, the cooked preset's table, and the preset read's failure and cache paths (NATIVE-25, NATIVE-31, PIPE-100). Asset-free.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clothingPorts, itemRecords, PRESET_PATHS, PRESET_RETRY_MS, presetOf, presetTable, resetPresetMemory, tweakIdOf } from "../src/clothing-host";
import { depotHash, fnv1a64 } from "../src/depot-path";
import type { ResourceGraph } from "../src/resource-graph";
import { TWEAKDB_MAGIC, TweakDbBlob, tweakDbId } from "../src/tweakdb-flats";

const root = mkdtempSync(join(tmpdir(), "xfs-clothing-host-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const utf8 = (text: string) => new TextEncoder().encode(text);

type Flats = { cname?: [string, string][]; ids?: [string, number][]; lists?: [string, number[]][]; int32?: [string, number][]; bool?: [string, number][];
  float?: [string, number][]; names?: [string, string[]][] };
/** A synthetic TweakDB blob (WolvenKit TweakDBReader layout) with the value types the clothing resolver reads. */
function blob(flats: Flats): Uint8Array {
  const parts: number[] = [];
  const u32 = (v: number, into = parts) => { into.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); };
  const u64 = (v: bigint, into = parts) => { for (let i = 0n; i < 8n; i++) into.push(Number((v >> (8n * i)) & 0xffn)); };
  const id = (v: number, into: number[]) => u64(BigInt(v), into);
  const vlq = (n: number, negative: boolean, into: number[]) => { if (n >= 64) throw Error("short values only"); into.push((negative ? 0x80 : 0) | n); };
  // A latin-1 name is a negative length and one byte per character; any other is a positive length and UTF-16.
  const name = (text: string, into: number[]) => {
    if (/^[\x00-\xff]*$/.test(text)) { vlq(text.length, true, into); into.push(...[...text].map(c => c.charCodeAt(0))); return; }
    vlq(text.length, false, into);
    for (const c of text) { const code = c.charCodeAt(0); into.push(code & 0xff, code >> 8); }
  };
  type Section = { type: string; values: number[][]; keys: [number, number][] };
  const sections: Section[] = [];
  const add = <T>(type: string, entries: [string, T][] | undefined, encode: (value: T) => number[]) => {
    if (!entries?.length) return;
    sections.push({ type, values: entries.map(([, value]) => encode(value)), keys: entries.map(([key], i) => [tweakDbId(key), i]) });
  };
  add("CName", flats.cname, text => { const out: number[] = []; name(text, out); return out; });
  add("TweakDBID", flats.ids, value => { const out: number[] = []; id(value, out); return out; });
  add("array:TweakDBID", flats.lists, values => { const out: number[] = []; vlq(values.length, false, out); for (const v of values) id(v, out); return out; });
  add("Int32", flats.int32, value => { const out = new Uint8Array(4); new DataView(out.buffer).setInt32(0, value, true); return [...out]; });
  add("Bool", flats.bool, value => [value]);
  add("Float", flats.float, value => { const out = new Uint8Array(4); new DataView(out.buffer).setFloat32(0, value, true); return [...out]; });
  add("array:CName", flats.names, values => { const out: number[] = []; vlq(values.length, false, out); for (const v of values) name(v, out); return out; });
  u32(TWEAKDB_MAGIC); u32(8); u32(4); u32(0);
  const flatsOffset = 32;
  u32(flatsOffset); u32(0); u32(0); u32(0);
  u32(sections.length);
  let offset = flatsOffset + 4 + sections.length * 20;
  const bodies: number[][] = [];
  for (const section of sections) {
    const body: number[] = [];
    u32(section.values.length, body);
    for (const value of section.values) body.push(...value);
    u32(section.keys.length, body);
    for (const [key, index] of section.keys) { id(key, body); u32(index, body); }
    u64(fnv1a64(utf8(section.type))); u32(section.values.length); u32(section.keys.length); u32(offset);
    offset += body.length;
    bodies.push(body);
  }
  for (const body of bodies) parts.push(...body);
  return Uint8Array.from(parts);
}
const suffix = (name: string) => tweakDbId(`itemsFactoryAppearanceSuffix.${name}`);

describe("TweakDB value types (PIPE-101)", () => {
  test("Int32 (negative), Bool, Float and CName arrays decode, and each value's size is right so the next one reads", () => {
    const data = new TweakDbBlob(blob({ int32: [["A.offset", -3], ["B.offset", 7]], bool: [["A.flag", 1], ["B.flag", 0]], float: [["A.weight", 0.5]],
      // Back to back: an empty list, a latin-1 list, a UTF-16 name among others (a positive length, two bytes per character).
      names: [["A.tags", []], ["B.tags", ["hide_T1", "Tight"]], ["C.tags", ["Käse", "Ωmega", "x"]], ["D.tags", ["last"]]] }));
    const found = data.lookup(["A.offset", "B.offset", "A.flag", "B.flag", "A.weight", "A.tags", "B.tags", "C.tags", "D.tags"].map(name => tweakDbId(name)));
    const value = (name: string) => found.get(tweakDbId(name));
    expect(value("A.offset")).toEqual({ type: "Int32", value: -3 });
    expect(value("B.offset")).toEqual({ type: "Int32", value: 7 });
    expect(value("A.flag")).toEqual({ type: "Bool", value: 1 });
    expect(value("B.flag")).toEqual({ type: "Bool", value: 0 });
    expect(value("A.weight")).toEqual({ type: "Float", value: 0.5 });
    expect(value("A.tags")).toEqual({ type: "array:CName", value: [] });
    expect(value("B.tags")).toEqual({ type: "array:CName", value: ["hide_T1", "Tight"] });
    expect(value("C.tags")).toEqual({ type: "array:CName", value: ["Käse", "Ωmega", "x"] });
    expect(value("D.tags")).toEqual({ type: "array:CName", value: ["last"] });
  });

  test("a CName array whose count can't fit is refused, not read past the blob", () => {
    const bytes = blob({ names: [["A.tags", ["a"]]] });
    // The list's count byte sits after the section's value count: claim 60 names in a blob that holds one.
    const at = bytes.findIndex((byte, i) => byte === 1 && bytes[i + 1] === 0x81 && bytes[i + 2] === "a".charCodeAt(0));
    expect(at).toBeGreaterThan(0);
    bytes[at] = 60;
    expect(() => new TweakDbBlob(bytes).lookup([tweakDbId("A.tags")])).toThrow("truncated");
  });
});

describe("item records from the TweakDB (PIPE-101)", () => {
  test("a save's record ID keeps its CRC and length and drops the table offset bits", () => {
    const id = tweakDbId("Items.TShirt_01_basic_01");
    expect(tweakIdOf(String(id))).toBe(id);
    expect(tweakIdOf(String(BigInt(id) + (0x12345n << 40n)))).toBe(id);
  });

  test("records read every field the resolver uses; suffixes by name where known; a record without its entity or look is none", () => {
    const shirt = "Items.Shirt_01", bare = "Items.NoLook", unknownSuffix = tweakDbId("itemsFactoryAppearanceSuffix.ModSuffix");
    const data = new TweakDbBlob(blob({
      cname: [[`${shirt}.entityName`, "player_inner_torso_item"], [`${shirt}.appearanceName`, "t1_shirt_01_basic_01_"], [`${bare}.entityName`, "player_legs_item"]],
      lists: [[`${shirt}.appearanceSuffixes`, [suffix("Gender"), suffix("Camera"), suffix("BodyType"), unknownSuffix]]],
      names: [[`${shirt}.visualTags`, ["hide_T1part", "Tight"]]], int32: [[`${shirt}.garmentOffset`, -2]] }));
    const records = itemRecords(data, [String(tweakDbId(shirt)), String(tweakDbId(bare)), String(tweakDbId("Items.Missing")), String(tweakDbId(shirt))]);
    expect(records.get(String(tweakDbId(shirt)))).toEqual({ entityName: "player_inner_torso_item", appearanceName: "t1_shirt_01_basic_01_",
      suffixes: ["Gender", "Camera", "BodyType", String(unknownSuffix)], visualTags: ["hide_T1part", "Tight"], garmentOffset: -2 });
    expect(records.get(String(tweakDbId(bare)))).toBeNull();
    expect(records.get(String(tweakDbId("Items.Missing")))).toBeNull();
    expect(records.size).toBe(3);
  });
});

describe("the cooked visual-tag preset (PIPE-101, NATIVE-25, NATIVE-31, PIPE-100)", () => {
  let clock = 0;
  afterEach(() => resetPresetMemory());
  const document = { Data: { RootChunk: { $type: "JsonResource", root: { Data: { $type: "gameAppearanceNameVisualTagsPreset", presets: [
    { entityPathHash: "123", commonVisualTags: { tags: [{ $value: "Common" }] },
      appearancesToTags: [{ appearanceName: { $value: "t2_coat_&Female&TPP" }, visualTags: { tags: [{ $value: "Large" }, { $value: "hide_T1part" }] } }] },
    { entityPathHash: 5 }] } } } } };

  test("the table: per entity, per root appearance, the common tags under *; another resource is refused", () => {
    const table = presetTable(document);
    expect([...table.keys()]).toEqual(["123"]);
    expect(table.get("123")!.get("*")).toEqual(["Common"]);
    expect(table.get("123")!.get("t2_coat_&Female&TPP")).toEqual(["Large", "hide_T1part"]);
    expect(() => presetTable({ Data: { RootChunk: { root: { Data: { $type: "Something" } } } } })).toThrow("Not an appearance-name visual tag preset");
  });

  /** A graph whose preset path is won by a real file (the identity is its size and time), for one archive. */
  const graphOver = (file: string) => ({ depot: { plan: { ep1Installed: false } }, exists: () => false,
    locate: (ref: { hash: string }) => ({ lookup: { winner: ref.hash === depotHash(PRESET_PATHS.base) ? { id: file, name: "basegame_4_gamedata.archive" } : null } }) }) as unknown as ResourceGraph;

  test("a failed read that may pass is logged once and tried again after a while; a good read is kept, on disk too; reads in flight are shared", async () => {
    resetPresetMemory(() => clock);
    const archive = join(root, "failing.archive"), cache = join(root, "cache-a");
    writeFileSync(archive, "archive bytes");
    const logs: string[] = [];
    let calls = 0, fail = true;
    const decode = async (path: string, hash: string) => {
      calls++;
      expect([path, hash]).toEqual([archive, depotHash(PRESET_PATHS.base)]);
      if (fail) throw Error("the worker couldn't start");
      return document;
    };
    expect(await presetOf(graphOver(archive), root, cache, line => logs.push(line), decode)).toBeNull();
    expect(logs.at(-1)).toContain("couldn't be read: the worker couldn't start");
    // Remembered for a while: no second decode, no second log line (NATIVE-31).
    expect(await presetOf(graphOver(archive), root, cache, line => logs.push(line), decode)).toBeNull();
    expect([calls, logs.length]).toEqual([1, 1]);
    clock += PRESET_RETRY_MS;
    fail = false;
    // Two at once (a prefetch batch dressing several requests): one read.
    const [a, b] = await Promise.all([presetOf(graphOver(archive), root, cache, () => {}, decode), presetOf(graphOver(archive), root, cache, () => {}, decode)]);
    expect(calls).toBe(2);
    expect(a).toBe(b);
    expect(a!.get("123")!.get("*")).toEqual(["Common"]);
    // Kept in memory, and on disk for a later session (a new archive identity would read again).
    expect(await presetOf(graphOver(archive), root, cache, () => {}, decode)).toBe(a);
    expect(calls).toBe(2);
  });

  test("the disk cache answers without decoding; no winning archive is none", async () => {
    const archive = join(root, "cached.archive"), cache = join(root, "cache-b");
    writeFileSync(archive, "other bytes");
    let calls = 0;
    const decode = async () => { calls++; return document; };
    const first = await presetOf(graphOver(archive), root, cache, () => {}, decode);
    expect(first).not.toBeNull();
    const nowhere = { depot: { plan: { ep1Installed: false } }, exists: () => false, locate: () => ({ lookup: { winner: null } }) } as unknown as ResourceGraph;
    expect(await presetOf(nowhere, root, cache, () => {}, decode)).toBeNull();
    expect(calls).toBe(1);
  });

  test("a failure that would repeat (a document that isn't a preset) is remembered for the session, per archive identity (NATIVE-31)", async () => {
    resetPresetMemory(() => clock);
    const archive = join(root, "refused.archive");
    writeFileSync(archive, "refused bytes");
    let calls = 0;
    const decode = async () => { calls++; return { Data: { RootChunk: { root: { Data: { $type: "Something" } } } } }; };
    const logs: string[] = [];
    expect(await presetOf(graphOver(archive), root, join(root, "cache-d"), line => logs.push(line), decode)).toBeNull();
    clock += 10 * PRESET_RETRY_MS;
    expect(await presetOf(graphOver(archive), root, join(root, "cache-d"), line => logs.push(line), decode)).toBeNull();
    expect([calls, logs.length]).toEqual([1, 1]);
    // Another archive identity (the file changed) reads again.
    writeFileSync(archive, "changed refused bytes");
    expect(await presetOf(graphOver(archive), root, join(root, "cache-d"), () => {}, decode)).toBeNull();
    expect(calls).toBe(2);
  });

  test("without a TweakDB the records port answers null, so every item says the records couldn't be read", async () => {
    const archive = join(root, "ports.archive");
    writeFileSync(archive, "bytes");
    mkdirSync(join(root, "no-game"), { recursive: true });
    const logs: string[] = [];
    const ports = await clothingPorts(graphOver(archive), join(root, "no-game"), join(root, "cache-c"), line => logs.push(line), { decode: async () => document });
    expect(ports.tweakDb).toBeNull();
    expect(await ports.records(["1"])).toBeNull();
    expect(ports.preset).toBe(true);
    expect(ports.presetTags("123", "t2_coat_&Female&TPP")).toEqual(["Common", "Large", "hide_T1part"]);
    expect(ports.presetTags("999", "x")).toEqual([]);
    expect(logs.some(line => line.includes("TweakDB couldn't be found"))).toBe(true);
  });
});
