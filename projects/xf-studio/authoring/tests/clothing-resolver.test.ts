// The clothing resolver on a synthetic installation (asset-free): item records → factory → root appearance by suffix → `.app` → garment
// components, the game's hiding rules, ArchiveXL's tag rules and entity-wide parts overrides onto V's body, feet state and layer scores.
import { describe, expect, test } from "bun:test";
import { tagRuleOf } from "../src/archivexl-config";
import { componentPrefix, NO_OVERRIDES, overriddenMask, overridesKey, resolveCharacter } from "../src/character-resolver";
import { itemWords, layerScore, pickRootAppearance, resolveClothing, SLOT_TAGS, type ItemRecord } from "../src/clothing-resolver";
import { depotHash } from "../src/depot-path";
import type { ClothingArea, WornArea } from "../src/save-loadout";
import { ALL_CHUNKS, cn, cr2w, fixtureInstallation, handle, mesh, rp } from "./resolver-fixtures";

const tags = (...names: string[]) => ({ $type: "redTagList", tags: names.map(cn) });
const schema = (...names: string[]) => handle({ $type: "entVisualTagsSchema", visualTags: tags(...names) });
const garment = (name: string, meshPath: string, meshAppearance = "default", chunkMask = ALL_CHUNKS) =>
  ({ $type: "entGarmentSkinnedMeshComponent", name: cn(name), mesh: rp(meshPath), meshAppearance: cn(meshAppearance), chunkMask });
const partEnt = (components: object[], ...visualTags: string[]) => cr2w({ $type: "entEntityTemplate", components,
  ...(visualTags.length ? { visualTagsSchema: schema(...visualTags) } : {}),
  compiledData: { BufferId: "0", Flags: 0, Data: { Version: 4, Sections: 7, CruidIndex: -1, CruidDict: {}, Chunks: [{ $type: "entEntity" }, ...components] } } });
type Definition = { name: string; parts: string[]; visualTags?: string[]; entityOverrides?: { componentName: string; meshAppearance?: string; chunkMask: string }[] };
const itemApp = (definitions: Definition[]) => cr2w({ $type: "appearanceAppearanceResource", appearances: definitions.map(d => handle({
  $type: "appearanceAppearanceDefinition", name: cn(d.name), components: [],
  compiledData: { BufferId: "0", Flags: 0, Data: { Version: 4, Sections: 7, CruidIndex: -1, CruidDict: {}, Chunks: [] } },
  partsValues: d.parts.map(part => ({ $type: "appearanceAppearancePart", resource: rp(part, "Soft") })),
  partsOverrides: d.entityOverrides ? [{ $type: "appearanceAppearancePartOverrides", componentsOverrides: d.entityOverrides.map(o => ({
    $type: "appearancePartComponentOverrides", componentName: cn(o.componentName), meshAppearance: cn(o.meshAppearance ?? "default"), chunkMask: o.chunkMask })) }] : [],
  ...(d.visualTags ? { visualTags: tags(...d.visualTags) } : {}) })) });
const root = (appearances: [name: string, app: string, definition: string][], ...visualTags: string[]) => cr2w({ $type: "entEntityTemplate",
  appearances: appearances.map(([name, app, definition]) => ({ $type: "entTemplateAppearance", name: cn(name), appearanceResource: rp(app, "Soft"),
    appearanceName: cn(definition) })), ...(visualTags.length ? { visualTagsSchema: schema(...visualTags) } : {}), components: [] });
const csv = (rows: [string, string][]) => cr2w({ $type: "C2dArray", headers: ["name", "path", "preload"], compiledData: rows.map(([name, path]) => [name, path, "true"]) });
const multilayered = (chunks: number) => mesh({ appearances: [{ name: "default", chunkMaterials: Array(chunks).fill("ml") }, { name: "red", chunkMaterials: Array(chunks).fill("ml") }],
  entries: [{ name: "ml", local: false, index: 0 }], external: ["engine\\materials\\multilayered.mt"], chunks });

const P = "base\\gameplay\\items\\equipment\\";
const APPS = "base\\characters\\appearances\\player\\items\\";
const PARTS = "base\\characters\\garment\\player_equipment\\";
const files: Record<string, object> = {
  "base\\gameplay\\factories\\items\\clothing.csv": csv([["player_inner_torso_item", `${P}torso\\player_inner_torso_item.ent`],
    ["player_outer_torso_item", `${P}torso\\player_outer_torso_item.ent`], ["player_legs_item", `${P}legs\\player_legs_item.ent`],
    ["player_feet_item", `${P}feet\\player_feet_item.ent`], ["player_head_item", `${P}head\\player_head_item.ent`],
    ["player_underwear_bottom_item", `${P}underwear\\player_underwear_bottom_item.ent`]]),
  [`${P}torso\\player_inner_torso_item.ent`]: root([["t1_shirt_01_basic_01_&Male", `${APPS}t1_shirt.app`, "basic_01_m"],
    ["t1_shirt_01_basic_01_&Female", `${APPS}t1_shirt.app`, "basic_01_w"], ["t1_shirt_01_basic_01_&Female&Part", `${APPS}t1_shirt.app`, "basic_01_w_partial"]]),
  [`${APPS}t1_shirt.app`]: itemApp([{ name: "basic_01_w", parts: [`${PARTS}t1_shirt.ent`] }, { name: "basic_01_w_partial", parts: [`${PARTS}t1_shirt.ent`] },
    { name: "basic_01_m", parts: [`${PARTS}t1_shirt.ent`] }]),
  [`${PARTS}t1_shirt.ent`]: partEnt([garment("t1_001_pwa_shirt", `${PARTS}t1_shirt.mesh`, "red")], "Tight"),
  [`${PARTS}t1_shirt.mesh`]: multilayered(2),
  [`${P}torso\\player_outer_torso_item.ent`]: root([["t2_coat_01_basic_01_&Female&TPP", `${APPS}t2_coat.app`, "basic_01_w"],
    ["t2_coat_01_basic_01_&Female&FPP", `${APPS}t2_coat.app`, "basic_01_w_fpp"], ["t2_coat_01_basic_01_&Female", `${APPS}t2_coat.app`, "basic_01_w_fpp"]]),
  [`${APPS}t2_coat.app`]: itemApp([{ name: "basic_01_w", parts: [`${PARTS}t2_coat.ent`], visualTags: ["hide_Torso"],
    entityOverrides: [{ componentName: "a0_000_pwa_base__full", chunkMask: "1" }] }, { name: "basic_01_w_fpp", parts: [`${PARTS}t2_coat.ent`] }]),
  [`${PARTS}t2_coat.ent`]: partEnt([garment("t2_001_pwa_coat", `${PARTS}t2_coat.mesh`)], "Large"),
  [`${PARTS}t2_coat.mesh`]: multilayered(1),
  [`${P}legs\\player_legs_item.ent`]: root([["l1_pants_01_basic_01_&Female", `${APPS}l1_pants.app`, "basic_01_w"]]),
  [`${APPS}l1_pants.app`]: itemApp([{ name: "basic_01_w", parts: [`${PARTS}l1_pants.ent`] }]),
  [`${PARTS}l1_pants.ent`]: partEnt([garment("l1_001_pwa_pants", `${PARTS}l1_pants.mesh`)]),
  [`${PARTS}l1_pants.mesh`]: multilayered(1),
  [`${P}feet\\player_feet_item.ent`]: root([["s1_boots_01_basic_01_&Female", `${APPS}s1_boots.app`, "basic_01_w"]]),
  [`${APPS}s1_boots.app`]: itemApp([{ name: "basic_01_w", parts: [`${PARTS}s1_boots.ent`] }]),
  [`${PARTS}s1_boots.ent`]: partEnt([garment("s1_001_pwa_boots", `${PARTS}s1_boots.mesh`)]),
  [`${PARTS}s1_boots.mesh`]: multilayered(1),
  [`${P}head\\player_head_item.ent`]: root([["h1_cap_01_basic_01_&Female&Long", `${APPS}h1_cap.app`, "basic_01_w_long"],
    ["h1_cap_01_basic_01_&Female&Short", `${APPS}h1_cap.app`, "basic_01_w_short"]]),
  [`${APPS}h1_cap.app`]: itemApp([{ name: "basic_01_w_long", parts: [`${PARTS}h1_cap.ent`] }, { name: "basic_01_w_short", parts: [`${PARTS}h1_cap.ent`] }]),
  [`${PARTS}h1_cap.ent`]: partEnt([garment("h1_001_pwa_cap", `${PARTS}h1_cap.mesh`)]),
  [`${PARTS}h1_cap.mesh`]: multilayered(1),
  [`${P}underwear\\player_underwear_bottom_item.ent`]: root([["l1_underwear_01_basic_01_&Female", `${APPS}l1_underwear.app`, "basic_01_w"]]),
  [`${APPS}l1_underwear.app`]: itemApp([{ name: "basic_01_w", parts: [`${PARTS}l1_underwear.ent`] }]),
  [`${PARTS}l1_underwear.ent`]: partEnt([garment("l1_000_pwa_underwear", `${PARTS}l1_underwear.mesh`)], "Tight"),
  [`${PARTS}l1_underwear.mesh`]: multilayered(1),
  "engine\\materials\\multilayered.mt": cr2w({ $type: "CMaterialTemplate", name: cn("multilayered") }),
};
const VISUAL_TAGS_XL = { id: "red4ext/plugins/ArchiveXL/Bundle/VisualTags.xl", document: { overrides: { tags: {
  hide_Torso: { t0_000_pwa_base__full: { hide: [0, 1, 2, 3] }, n0_: { hide: 0 } },
  HighHeels: { t0_000_pwa_base__full: { hide: [5, 6, 7] }, l0_000_pwa_base__high_heels: { show: [0, 1, 2] } } } } } };

const records: Record<string, ItemRecord> = {
  "1001": { entityName: "player_inner_torso_item", appearanceName: "t1_shirt_01_basic_01_", suffixes: ["Gender", "Partial"], visualTags: [], garmentOffset: 0 },
  "1002": { entityName: "player_outer_torso_item", appearanceName: "t2_coat_01_basic_01_", suffixes: ["Gender", "Camera"], visualTags: [], garmentOffset: 0 },
  "1003": { entityName: "player_legs_item", appearanceName: "l1_pants_01_basic_01_", suffixes: ["Gender"], visualTags: [], garmentOffset: 0 },
  "1004": { entityName: "player_feet_item", appearanceName: "s1_boots_01_basic_01_", suffixes: ["Gender"], visualTags: [], garmentOffset: 0 },
  "1005": { entityName: "player_head_item", appearanceName: "h1_cap_01_basic_01_", suffixes: ["Gender", "HairType"], visualTags: [], garmentOffset: 0 },
  "1006": { entityName: "player_underwear_bottom_item", appearanceName: "l1_underwear_01_basic_01_", suffixes: ["Gender"], visualTags: [], garmentOffset: 0 },
};
/** The cooked preset: the coat hides the inner torso's full look (`hide_T1part`); the cap hides nothing. */
const preset: Record<string, Record<string, string[]>> = {
  [depotHash(`${P}torso\\player_outer_torso_item.ent`)]: { "t2_coat_01_basic_01_&Female&TPP": ["Large", "hide_T1part"] },
  [depotHash(`${P}legs\\player_legs_item.ent`)]: { "l1_pants_01_basic_01_&Female": ["hide_S1"] },
};
const ports = (extra: Record<string, ItemRecord | null> = {}) => ({
  records: (items: readonly string[]) => new Map(items.map(item => [item, item in extra ? extra[item]! : records[item] ?? null])),
  presetTags: (entity: string, appearance: string) => preset[entity]?.[appearance] ?? [],
});
const ALL: ClothingArea[] = ["Outfit", "OuterChest", "InnerChest", "Legs", "Feet", "Head", "Face", "UnderwearTop", "UnderwearBottom"];
const wear = (entries: [ClothingArea, string, boolean?][]): WornArea[] => entries.map(([area, item, hidden]) => ({ area, item, hidden: !!hidden }));
const setup = () => fixtureInstallation([{ virtualPath: "archive/pc/content/basegame_4_gamedata.archive", files }], [VISUAL_TAGS_XL]);

describe("clothing resolver", () => {
  test("picks the most specific root appearance the V's suffixes match, and reads the chain to garment components", async () => {
    expect(pickRootAppearance([{ name: "x_&Female", app: null, definition: "a" }, { name: "x_&Female&TPP", app: null, definition: "b" },
      { name: "x_&Male&TPP", app: null, definition: "c" }, { name: "x_", app: null, definition: "d" }], "x_", new Set(["Female", "TPP"]))?.definition).toBe("b");
    const { graph } = setup();
    const result = await resolveClothing(graph, { bodyGender: "female", hairType: "Long", worn: wear([["Head", "1005"], ["Legs", "1003"]]), shown: ALL }, ports());
    const cap = result.garments.find(entry => entry.area === "Head")!;
    expect(cap.status).toBe("drawn");
    expect(cap.rootAppearance).toBe("h1_cap_01_basic_01_&Female&Long");
    expect(cap.definition).toBe("basic_01_w_long");
    expect(cap.components.map(component => component.name)).toEqual(["h1_001_pwa_cap"]);
    expect(cap.layers.h1_001_pwa_cap).toBe(100);
  });

  test("the outer torso's hide_T1part gives the inner torso its partial look; tags from the preset, entity and definition are united", async () => {
    const { graph } = setup();
    const result = await resolveClothing(graph, { bodyGender: "female", hairType: "Bald", worn: wear([["OuterChest", "1002"], ["InnerChest", "1001"]]), shown: ALL }, ports());
    const shirt = result.garments.find(entry => entry.area === "InnerChest")!, coat = result.garments.find(entry => entry.area === "OuterChest")!;
    expect(coat.rootAppearance).toBe("t2_coat_01_basic_01_&Female&TPP");
    expect(coat.tags).toEqual(expect.arrayContaining(["Large", "hide_T1part", "hide_Torso"]));
    expect(shirt.rootAppearance).toBe("t1_shirt_01_basic_01_&Female&Part");
    expect(shirt.definition).toBe("basic_01_w_partial");
    // Layer scores: prefix plus the part entity's size tag.
    expect(shirt.layers.t1_001_pwa_shirt).toBe(70 - 1000);
    expect(coat.layers.t2_001_pwa_coat).toBe(120 + 1000);
    // Without the coat shown, the shirt takes its full look.
    const alone = await resolveClothing(graph, { bodyGender: "female", hairType: "Bald", worn: wear([["OuterChest", "1002"], ["InnerChest", "1001"]]),
      shown: ALL.filter(area => area !== "OuterChest") }, ports());
    expect(alone.garments.find(entry => entry.area === "InnerChest")!.rootAppearance).toBe("t1_shirt_01_basic_01_&Female");
    expect(alone.garments.find(entry => entry.area === "OuterChest")!.hiddenBy).toEqual({ kind: "dressing" });
  });

  test("the game's hiding rules: another item's slot tag, the saved hide flag, and the underwear rules", async () => {
    const { graph } = setup();
    // The pants carry hide_S1 (preset): the boots are hidden by it; the underwear bottom is hidden under the legs.
    const worn = wear([["Legs", "1003"], ["Feet", "1004"], ["UnderwearBottom", "1006", true]]);
    const result = await resolveClothing(graph, { bodyGender: "female", hairType: "Bald", worn, shown: ALL }, ports());
    const by = (area: ClothingArea) => result.garments.find(entry => entry.area === area)!;
    expect(by("Feet").hiddenBy).toEqual({ kind: "tag", tag: SLOT_TAGS.Feet, area: "Legs" });
    expect(by("UnderwearBottom").hiddenBy).toEqual({ kind: "underwear", area: "Legs" });
    expect(by("Legs").status).toBe("drawn");
    // Legs off (the dressing): the boots' saved flag is explained by the pants' tag, so they show again, and so does the underwear.
    const bare = await resolveClothing(graph, { bodyGender: "female", hairType: "Bald", worn: wear([["Legs", "1003"], ["Feet", "1004", true],
      ["UnderwearBottom", "1006", true]]), shown: ["Feet", "UnderwearBottom"] }, ports());
    expect(bare.garments.find(entry => entry.area === "Feet")!.status).toBe("drawn");
    expect(bare.garments.find(entry => entry.area === "UnderwearBottom")!.status).toBe("drawn");
    // A saved hide no saved item explains (a wardrobe set's empty area) stays.
    const player = await resolveClothing(graph, { bodyGender: "female", hairType: "Bald", worn: wear([["Head", "1005", true]]), shown: ALL }, ports());
    expect(player.garments[0]!.hiddenBy).toEqual({ kind: "saved" });
  });

  test("a drawn item's definition tags and entity-wide parts overrides reach V's body; the head keeps its parts and says so", async () => {
    const { graph } = setup();
    const result = await resolveClothing(graph, { bodyGender: "female", hairType: "Bald", worn: wear([["OuterChest", "1002"]]), shown: ALL }, ports());
    expect(result.overrides).not.toBe(NO_OVERRIDES);
    const torso = overriddenMask("t0_000_pwa_base__full", ALL_CHUNKS, result.overrides)!;
    expect(BigInt(torso.mask) & 0xffn).toBe(0xf0n);
    expect(torso.by).toEqual(["coat: hide_Torso"]);
    expect(overriddenMask("n0_000_pwa_neck", ALL_CHUNKS, result.overrides)!.mask).toBe("0");
    expect(overriddenMask("a0_000_pwa_base__full", "3", result.overrides)!.mask).toBe("1");
    expect(overriddenMask("h0_000_pwa_c__basehead", ALL_CHUNKS, result.overrides)).toBeNull();
    expect(overridesKey(result.overrides)).not.toBe("");
    expect(overridesKey(NO_OVERRIDES)).toBe("");
  });

  test("footwear sets the lifted feet; items the compiled records don't define are reported, not guessed", async () => {
    const { graph } = setup();
    const result = await resolveClothing(graph, { bodyGender: "female", hairType: "Bald", worn: wear([["Feet", "1004"], ["Face", "9999"]]), shown: ALL }, ports());
    expect(result.feet).toBe("lifted");
    expect(result.feetState).toBe("Lifted");
    const unknown = result.garments.find(entry => entry.area === "Face")!;
    expect(unknown.status).toBe("unresolved");
    expect(unknown.gap?.code).toBe("item-unknown");
    expect(result.gaps.map(gap => gap.code)).toContain("item-unknown");
    const dynamic = await resolveClothing(graph, { bodyGender: "female", hairType: "Bald", worn: wear([["Face", "2000"]]), shown: ALL },
      ports({ "2000": { entityName: "player_face_item", appearanceName: "f1_glasses!red", suffixes: [], visualTags: [], garmentOffset: 0 } }));
    expect(dynamic.garments[0]!.gap?.code).toBe("item-dynamic");
    const barefoot = await resolveClothing(graph, { bodyGender: "female", hairType: "Bald", worn: wear([["Feet", "1004"]]), shown: ["Legs"] }, ports());
    expect(barefoot.feet).toBe("flat");
  });

  test("labels, prefixes, layer scores and tag rules follow the game's and ArchiveXL's rules", () => {
    expect(itemWords("t1_tshirt_01_q000_nomad_")).toBe("tshirt nomad");
    expect(itemWords("s1_boots_05_basic_01_")).toBe("boots");
    expect(componentPrefix("h0_000_pwa_c__basehead")).toBe("h0_");
    expect(componentPrefix("heb_000")).toBe("heb_");
    expect(componentPrefix("MorphTargetSkinnedMesh3637")).toBeNull();
    expect(componentPrefix("beard")).toBeNull();
    expect(layerScore("t0_000_pwa_base__full", ["PlayerBodyPart"])).toBe(30 - 2000);
    expect(layerScore("x_thing", [])).toBeNull();
    // ChunkMask: a hide list keeps every other chunk, `hide: 0` hides the whole component, a show list ORs the chunks in.
    expect(tagRuleOf("c", { hide: [0, 2] }, "x")!.hide! & 0xfn).toBe(0b1010n);
    expect(tagRuleOf("c", { hide: 0 }, "x")!.hide).toBe(0n);
    expect(tagRuleOf("c", { show: [1] }, "x")!.show).toBe(2n);
    expect(tagRuleOf("c", [3], "x")!.hide! & 0xfn).toBe(0b0111n);
    expect(tagRuleOf("c", "nope", "x")).toBeNull();
  });

  test("the V's body resolves with the items' overrides; head parts keep theirs and the gap is reported", async () => {
    const bodyFiles = { ...files,
      "base\\player\\body.app": itemApp([{ name: "body", parts: ["base\\player\\body.ent"] }]),
      "base\\player\\body.ent": partEnt([garment("t0_000_pwa_base__full", "base\\player\\body.mesh")]),
      "base\\player\\body.mesh": multilayered(8),
      "base\\player\\head.app": itemApp([{ name: "head", parts: ["base\\player\\head.ent"] }]),
      "base\\player\\head.ent": partEnt([garment("n0_000_pwa_neck", "base\\player\\body.mesh")]),
      "base\\gameplay\\gui\\fullscreen\\main_menu\\female_cco.inkcharcustomization": cr2w({ $type: "gameuiCharacterCustomizationInfoResource", version: 12,
        headCustomizationOptions: [], headGroups: [], bodyCustomizationOptions: [], bodyGroups: [], armsCustomizationOptions: [], armsGroups: [] }) };
    const { graph } = fixtureInstallation([{ virtualPath: "archive/pc/content/basegame_4_gamedata.archive", files: bodyFiles }], [VISUAL_TAGS_XL]);
    const clothing = await resolveClothing(graph, { bodyGender: "female", hairType: "Bald", worn: wear([["OuterChest", "1002"]]), shown: ALL }, ports());
    const resolved = await resolveCharacter(graph, { bodyGender: "female", origin: "descriptors", morphs: [], appearances: [
      { part: "body", group: "TPP_Body", option: "body_color", app: { hash: depotHash("base\\player\\body.app"), path: "base\\player\\body.app" }, definition: "body" },
      { part: "head", group: "TPP", option: "neck", app: { hash: depotHash("base\\player\\head.app"), path: "base\\player\\head.app" }, definition: "head" }] },
      undefined, clothing.overrides);
    const body = resolved.appearances.find(entry => entry.part === "body")!.components[0]!;
    expect(body.geometry?.visibleChunks).toEqual([4, 5, 6, 7]);
    expect(body.overriddenBy).toContain("worn item (coat: hide_Torso)");
    const neck = resolved.appearances.find(entry => entry.part === "head")!.components[0]!;
    expect(neck.geometry?.visibleChunks).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(resolved.gaps.some(gap => gap.code === "worn-item-hides-head" && gap.subject === "n0_000_pwa_neck")).toBe(true);
  });
});
