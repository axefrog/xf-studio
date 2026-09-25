import { describe, expect, test } from "bun:test";
import { readArchiveXlConfig } from "../src/archivexl-config";
import { CATEGORY_LIST_RECORD, iconKey, readCreatorPresentation } from "../src/cc-presentation";
import { fnv1a64 } from "../src/depot-path";
import { displayLabel, isTextKey, readableName, readOnscreenEntries, TextTable } from "../src/game-text";
import { childId, crc32, TWEAKDB_MAGIC, TweakDbBlob, tweakDbId } from "../src/tweakdb-flats";

const bytes = (text: string) => new TextEncoder().encode(text);

/** A synthetic TweakDB blob with CName, TweakDBID and array:TweakDBID flats (WolvenKit TweakDBReader layout). */
function blob(flats: { cname?: [string, string][]; ids?: [string, number][]; lists?: [string, number[]][]; raRef?: [string, bigint][] }): Uint8Array {
  const parts: number[] = [];
  const u32 = (v: number, into = parts) => { into.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); };
  const u64 = (v: bigint, into = parts) => { for (let i = 0n; i < 8n; i++) into.push(Number((v >> (8n * i)) & 0xffn)); };
  const id = (v: number, into = parts) => u64(BigInt(v), into);
  const vlq = (n: number, negative: boolean, into: number[]) => {
    // Values below 64 fit the first byte.
    if (n >= 64) throw Error("test helper only encodes short strings");
    into.push((negative ? 0x80 : 0) | n);
  };
  type Section = { type: string; values: number[][]; keys: [number, number][] };
  const sections: Section[] = [];
  const add = <T>(type: string, entries: [string, T][], encode: (value: T) => number[]) => {
    if (!entries.length) return;
    sections.push({ type, values: entries.map(([, value]) => encode(value)), keys: entries.map(([name], i) => [tweakDbId(name), i]) });
  };
  add("CName", flats.cname ?? [], text => { const out: number[] = []; vlq(text.length, true, out); out.push(...bytes(text)); return out; });
  add("TweakDBID", flats.ids ?? [], value => { const out: number[] = []; id(value, out); return out; });
  add("array:TweakDBID", flats.lists ?? [], values => { const out: number[] = []; vlq(values.length, false, out); for (const v of values) id(v, out); return out; });
  add("raRef:CResource", flats.raRef ?? [], value => { const out: number[] = []; u64(value, out); return out; });
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
    u64(fnv1a64(bytes(section.type))); u32(section.values.length); u32(section.keys.length); u32(offset);
    offset += body.length;
    bodies.push(body);
  }
  for (const body of bodies) parts.push(...body);
  return Uint8Array.from(parts);
}

describe("TweakDB flats", () => {
  test("CRC-32 matches the standard check value and continues like zlib", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(bytes("56789"), crc32(bytes("1234")))).toBe(0xcbf43926);
  });

  test("a record's field ID is derived from the record's ID alone", () => {
    expect(childId(tweakDbId("OptionsIcons.Pale"), ".atlasPartName")).toBe(tweakDbId("OptionsIcons.Pale.atlasPartName"));
  });

  test("creator categories and icons are read in the list's order", () => {
    const ui = (name: string) => `CharacterRandomization.${name}UI`;
    const data = blob({
      lists: [[`${CATEGORY_LIST_RECORD}.list`, [tweakDbId(ui("Skin")), tweakDbId(ui("Hair")), tweakDbId(ui("Broken"))]]],
      ids: [[`${ui("Skin")}.categoryType`, tweakDbId("CharacterRandomization.Skin")], [`${ui("Hair")}.categoryType`, tweakDbId("CharacterRandomization.Hair")]],
      cname: [[`${ui("Skin")}.categoryName`, "UI-CharacterCreation-skin"], [`${ui("Hair")}.categoryName`, "UI-CharacterCreation-hair"],
        ["CharacterRandomization.Skin.enumName", "Skin"], ["CharacterRandomization.Hair.enumName", "Hair"],
        ["OptionsIcons.Pale.atlasPartName", "01_pale"]],
      raRef: [["OptionsIcons.Pale.atlasResourcePath", 123456789012345678n]],
    });
    const presentation = readCreatorPresentation(new TweakDbBlob(data), ["OptionsIcons.Pale", "OptionsIcons.FromAMod"], "test");
    expect(presentation.categories).toEqual([{ id: "Skin", labelKey: "UI-CharacterCreation-skin", order: 0 }, { id: "Hair", labelKey: "UI-CharacterCreation-hair", order: 1 }]);
    expect(presentation.icons.get("OptionsIcons.Pale")).toEqual({ record: "OptionsIcons.Pale", atlas: { hash: "123456789012345678", path: null }, part: "01_pale" });
    expect(presentation.icons.has("OptionsIcons.FromAMod")).toBe(false);
    expect(presentation.gaps.map(gap => gap.code).sort()).toEqual(["category-unreadable", "icons-not-in-tweakdb"]);
  });

  test("a blob without the category list says so; a foreign file is refused", () => {
    expect(readCreatorPresentation(new TweakDbBlob(blob({ cname: [["A.b", "c"]] })), [], "test").gaps[0]!.code).toBe("category-list-missing");
    expect(() => new TweakDbBlob(new Uint8Array(64))).toThrow("not a TweakDB blob");
  });

  test("icon identities as the resource stores them", () => {
    expect(iconKey({ storage: "string", value: "OptionsIcons.Pale" })).toBe("OptionsIcons.Pale");
    expect(iconKey({ storage: "uint64", value: "0" })).toBeNull();
    expect(iconKey({ storage: "uint64", value: "12345" })).toBe("#12345");
  });
});

describe("on-screen texts", () => {
  const entry = (primaryKey: string, secondaryKey: string, female: string, male = "") => ({ primaryKey, secondaryKey, female, male });
  const game = { id: "base", kind: "game" as const, declaredBy: null };
  const mod = { id: "mod.json", kind: "mod" as const, declaredBy: "archive/pc/mod/a.xl" };

  test("keys resolve by primary (LocKey#) and secondary key; mods replace or fill in", () => {
    const table = new TextTable("en-us")
      .add([entry("23129", "UI-CharacterCreation-eyes", "Eyes"), entry("925", "Common-Off", "OFF"), entry("7", "Gendered", "Hers", "His")], game)
      .add([entry("0", "MyMod-Style", "Braids"), entry("0", "Common-Off", "Off!"), entry("0", "-comment", "x")], mod)
      .add([entry("0", "MyMod-Style", "Fallback braids"), entry("0", "MyMod-Only", "Only in fallback")], mod, false);
    expect(table.resolve("LocKey#23129")!.text).toBe("Eyes");
    expect(table.resolve("UI-CharacterCreation-eyes")!.text).toBe("Eyes");
    expect(table.resolve("Common-Off")!.text).toBe("Off!");
    expect(table.resolve("MyMod-Style")!.text).toBe("Braids");
    expect(table.resolve("MyMod-Only")!.source.kind).toBe("mod");
    expect(table.resolve("-comment")).toBeNull();
    expect(table.resolve("LocKey#7", "male")!.text).toBe("His");
    expect(table.resolve("LocKey#7", "female")!.text).toBe("Hers");
  });

  test("labels: resolved text, values written out, or a readable key", () => {
    const table = new TextTable("en-us").add([entry("925", "Common-Off", "OFF")], game);
    expect(displayLabel(table, "Common-Off", "x")).toEqual({ text: "OFF", key: "Common-Off", source: "game" });
    expect(displayLabel(table, "01", "x")).toEqual({ text: "01", key: "01", source: "verbatim" });
    expect(displayLabel(table, "UI-CharacterCreation-05_brown_liquorice", "x").text).toBe("Brown liquorice");
    expect(displayLabel(table, "LocKey#999999", "eyes_color").text).toBe("Eyes color");
    expect(displayLabel(null, "", "12_gradient_brown").text).toBe("Gradient brown");
    expect(isTextKey("01")).toBe(false);
    expect(readableName("LocKey#1")).toBeNull();
  });

  test("entries are read from a serialized onscreens resource", () => {
    const document = { Data: { RootChunk: { $type: "JsonResource", root: { HandleId: "0", Data: { $type: "localizationPersistenceOnScreenEntries",
      entries: [{ $type: "localizationPersistenceOnScreenEntry", femaleVariant: "News", maleVariant: "", primaryKey: "40", secondaryKey: "News-Key" }] } } } } };
    expect(readOnscreenEntries(document)).toEqual([{ primaryKey: "40", secondaryKey: "News-Key", female: "News", male: "" }]);
  });

  test("ArchiveXL text declarations: languages, fallback, bare forms and extend", () => {
    const config = readArchiveXlConfig([
      { id: "archive/pc/mod/a.archive.xl", document: { localization: { onscreens: { "de-de": "a\\de.json", "en-us": ["a\\en.json", "a\\en2.json"], "xx-xx": "bad.json" } } } },
      { id: "archive/pc/mod/b.archive.xl", document: { localization: { onscreens: "b\\en.json" } } },
      { id: "archive/pc/mod/c.archive.xl", document: { localization: { extend: "a.archive.xl", onscreens: { "en-us": "c\\en.json" } } } },
    ]);
    expect(config.localization.map(unit => unit.name)).toEqual(["a.archive.xl", "b.archive.xl"]);
    const [a, b] = config.localization;
    expect(a!.fallback).toBe("de-de");
    expect(a!.onscreens.get("en-us")).toEqual(["a\\en.json", "a\\en2.json", "c\\en.json"]);
    expect(b!.onscreens.get("en-us")).toEqual(["b\\en.json"]);
    expect(config.issues.some(issue => issue.includes("xx-xx"))).toBe(true);
  });
});
