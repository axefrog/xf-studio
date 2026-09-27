// The Character panel's one hierarchy (character-panel-sections.ts): parts of V, the panel's own taxonomy of sections (not the
// creator's categories), rows placed by what they control, and the contributions' switches and controls, derived from data.
import { describe, expect, test } from "bun:test";
import { type CcPanel, type CcPanelOption, panelProjection } from "../src/cc-panel";
import { catalogueCoverage } from "../src/cc-render-coverage";
import { allSections, CHARACTER_CONTRIBUTIONS, characterPanelTree, identifierWords, type CharacterPanelGroup,
  type CharacterSectionContribution } from "../src/character-panel-sections";
import { fixtureSource } from "./cc-fixtures";

const tree = async (contributions?: readonly CharacterSectionContribution[]) => {
  const source = await fixtureSource(true);
  const { panel } = panelProjection(source.catalogue, catalogueCoverage(source.catalogue), "fixture");
  return characterPanelTree(panel, contributions);
};
const flat = (group: CharacterPanelGroup) => allSections(group.sections);

/**
 * The vanilla creator's head rows as the game categorises them (the reference installation's projection: slot, option names and link
 * keys), with a lash mod's style on a slot of its own and two hair-part rows a mod adds. The game puts the eyelash colour under its
 * Eyebrows category and the lash style under Face.
 */
function vanillaPanel(): CcPanel {
  const options: CcPanelOption[] = [];
  const option = (name: string, link: string | null = null, mod = -1): number => {
    options.push({ id: `head/${name}`, part: "head", name, label: name, type: "appearance", grid: false, count: 3, off: null, defaultChoice: null, mod,
      link: link ? { key: link, controller: true } : null, dependsOn: [], coverage: ["rendered", 0], groups: 1, pooled: [] });
    return options.length - 1;
  };
  const row = (slot: string, ...names: [string, (string | null)?, number?][]) => ({ slot, part: "head" as const, options: names.map(([name, link, mod]) => option(name, link ?? null, mod ?? -1)) });
  const section = (id: string, ...rows: ReturnType<typeof row>[]) => ({ id, label: id, makeup: id === "Makeup", rows });
  const sections = [
    section("Skin", row("skin_color", ["skin_color", "skin color"]), row("skin_type_switcher", ["skin_type"])),
    section("Hair", row("hairstyle", ["hairstyle_cyberware", "hairstyle"], ["hairstyle", "hairstyle"]), row("hair_color", ["hair_color_cyberware_01", "hairstyle color"]),
      row("mch_hair_part_01", ["lm204mch_hair_part_01", "hairstyle_color_1", 0])),
    section("Eyes", row("eyes", ["eyes"]), row("eyes_color", ["eyes_color"])),
    section("Eyebrows", row("eyebrows", ["eyebrows"]), row("eyebrows_color", ["eyebrows_color1", "eyebrows color"]), row("eyelash_color", ["eyelash_color"])),
    section("Face", row("eyelashes_options", ["eyelashes_options", "eyelashes_options", 1]), row("nose", ["nose"]), row("mouth", ["mouth"]), row("jaw", ["jaw"]), row("ear", ["ear"])),
    section("Scars", row("scars", ["scars"])),
    section("Tattoos", row("facial_tattoo_switcher", ["facial_tattoo", "facial_tattoo"])),
    section("FaceModification", row("cyberware_switcher", ["cyberware", "cyberware"]), row("piercings", ["piercings"]), row("piercings_color", ["piercings_01", "piercings color"]),
      row("teeth", ["teeth"])),
    section("Makeup", row("xfea_layer1", ["xfea_layer1", null, 2]), row("xfea_layer1_colour", ["xfea_layer1_e01", "xfea_layer1 colour", 2]), row("makeupEyes", ["makeupEyes"]),
      row("makeupLips_type", ["makeupLips_type"]), row("makeupCheeks", ["makeupCheeks"]), row("makeupPimples", ["makeupPimples"])),
  ];
  return { schema: "xfs/cc-panel-5", bodyGender: "female", identity: "vanilla", language: null, mods: ["Hair parts", "Lashes", "XF Eye Artistry"],
    groups: [{ label: "Base game", kind: "game" }], modGroups: [0, 0, 0], notes: [""], options, sections, counts: { options: options.length, choices: 0, modChoices: 0 } };
}

describe("the Character panel's hierarchy", () => {
  test("the vanilla rows land by what they control: every brow row in Eyebrows, every lash row in Eyelashes, one switch each", () => {
    const head = characterPanelTree(vanillaPanel())[0]!;
    const slots = (id: string) => flat(head).find(section => section.key === `head/${id}`)!.rows.map(row => row.slot);
    expect(slots("eyebrows")).toEqual(["eyebrows", "eyebrows_color"]);
    expect(slots("eyelashes")).toEqual(["eyelash_color", "eyelashes_options"]);
    expect(slots("hair")).toEqual(["hairstyle", "hair_color", "mch_hair_part_01"]);
    expect(slots("skin")).toEqual(["skin_color", "skin_type_switcher"]);
    expect(slots("eyes")).toEqual(["eyes", "eyes_color"]);
    expect([slots("nose"), slots("mouth"), slots("ears"), slots("jaw")]).toEqual([["nose"], ["mouth"], ["ear"], ["jaw"]]);
    expect(slots("details")).toEqual(["scars", "facial_tattoo_switcher", "cyberware_switcher"]);
    expect(slots("piercings")).toEqual(["piercings", "piercings_color"]);
    expect(slots("teeth")).toEqual(["teeth"]);
    // A makeup colour for the eyes is makeup (an identifier names the thing first); a mod's layer goes by the category it declared.
    expect(slots("makeup")).toEqual(["xfea_layer1", "xfea_layer1_colour", "makeupEyes", "makeupLips_type", "makeupCheeks", "makeupPimples"]);
    expect(slots("other")).toEqual([]);
    // Every section has at most one switch, for what it draws.
    for (const section of flat(head)) expect(section.toggles.length).toBeLessThanOrEqual(1);
    expect(flat(head).filter(section => section.toggles.length).map(section => [section.key, section.toggles[0]!.id]))
      .toEqual([["head/eyebrows", "brows"], ["head/eyelashes", "lashes"], ["head/piercings", "piercings"], ["head/hair", "hair"]]);
    // The taxonomy: Skin, Face (with its parts inside), Hair, Teeth, then Other.
    expect(head.sections.map(section => section.title)).toEqual(["Skin", "Face", "Hair", "Teeth", "Other"]);
    expect(head.sections[1]!.children.map(section => section.title)).toEqual(["Eyes", "Eyebrows", "Eyelashes", "Nose", "Mouth & lips", "Ears", "Jaw & shape",
      "Makeup", "Piercings", "Face details"]);
  });

  test("a row nothing claims goes to Other on Head, and keeps its creator category on Body", () => {
    const panel = vanillaPanel();
    const extra = panel.options.length;
    const options = [...panel.options, { ...panel.options[0]!, id: "head/zz_widget", name: "zz_widget", link: null },
      { ...panel.options[0]!, id: "body/zz_gadget", part: "body" as const, name: "zz_gadget", link: null }];
    const sections = [...panel.sections, { id: "Oddities", label: "Oddities", makeup: false,
      rows: [{ slot: "zz_widget", part: "head" as const, options: [extra] }, { slot: "zz_gadget", part: "body" as const, options: [extra + 1] }] }];
    const [head, body] = characterPanelTree({ ...panel, options, sections });
    expect(flat(head!).find(section => section.key === "head/other")!.rows.map(row => row.slot)).toEqual(["zz_widget"]);
    expect(body!.sections.find(section => section.creator === "Oddities")!.rows.map(row => row.slot)).toEqual(["zz_gadget"]);
  });

  test("identifier words split at case changes, digits and punctuation", () => {
    expect(identifierWords("makeupEyes_color01")).toEqual(["makeup", "eyes", "color"]);
    expect(identifierWords("lm204mch_hair_part_01")).toEqual(["lm", "mch", "hair", "part"]);
    expect(identifierWords("XFEA Layer1 colour")).toEqual(["xfea", "layer", "colour"]);
  });

  test("Head, Body and Clothing; a creator row goes to the group of its part", async () => {
    const groups = await tree();
    expect(groups.map(group => group.id)).toEqual(["head", "body", "clothing"]);
    const head = groups[0]!, body = groups[1]!;
    expect(flat(head).flatMap(section => section.rows).every(row => row.part === "head")).toBe(true);
    expect(flat(body).flatMap(section => section.rows).every(row => row.part !== "head")).toBe(true);
    expect(body.sections.some(section => section.creator === "Body")).toBe(true);
  });

  test("the eye shape is in Eyes; the hair switch is on Hair even with no hair rows", async () => {
    const head = (await tree())[0]!;
    expect(flat(head).find(section => section.controls.includes("eyeShape"))?.key).toBe("head/eyes");
    const hair = flat(head).find(section => section.toggles.some(toggle => toggle.id === "hair"))!;
    expect([hair.key, hair.title, hair.rows.length]).toEqual(["head/hair", "Hair", 0]);
  });

  test("the body's switch and the uncensored setting are on Body; the clothes' switch and controls on Clothing", async () => {
    const groups = await tree();
    const body = groups.find(group => group.id === "body")!, clothing = groups.find(group => group.id === "clothing")!;
    expect(body.toggles.map(toggle => toggle.id)).toEqual(["body"]);
    expect(body.controls).toEqual(["uncensored"]);
    expect(clothing.toggles.map(toggle => toggle.id)).toEqual(["clothing"]);
    expect(clothing.controls).toEqual(["clothingState", "clothingAreas"]);
    // Toggles are typed actions over the preview's own state.
    const toggle = clothing.toggles[0]!;
    expect(toggle.action(false)).toEqual({ kind: "character.setClothing", state: "underwear" });
    expect(toggle.shown({ clothing: { state: "saved" } })).toBe(true);
    expect(body.toggles[0]!.shown({ preview: {} })).toBe(true);
  });

  test("before the creator options arrive the tree still holds the contributions; a module adds a section, joins one or extends what one holds", async () => {
    const empty = characterPanelTree(null);
    expect(empty.find(group => group.id === "head")!.sections.map(section => section.title)).toEqual(["Skin", "Face", "Hair", "Teeth", "Other"]);
    const withModule = await tree([...CHARACTER_CONTRIBUTIONS, { id: "poses.idle", module: "poses", group: "body", title: "Pose", order: -1, controls: ["idle"] },
      { id: "poses.gaze", module: "poses", group: "head", joins: "eyes", order: 50, controls: ["gaze"] }]);
    const body = withModule.find(group => group.id === "body")!;
    expect(body.sections[0]).toMatchObject({ key: "body/poses.idle", title: "Pose", creator: null, controls: ["idle"] });
    expect(flat(withModule[0]!).find(section => section.key === "head/eyes")!.controls).toEqual(["eyeShape", "gaze"]);
    // A module teaching Teeth a word: a row with that word lands there.
    const panel = vanillaPanel();
    const teeth = CHARACTER_CONTRIBUTIONS.find(contribution => contribution.id === "teeth")!;
    const taught = characterPanelTree(panel, [...CHARACTER_CONTRIBUTIONS.filter(contribution => contribution !== teeth),
      { ...teeth, holds: { ...teeth.holds, words: [...teeth.holds!.words!, "xfea"] } }]);
    expect(flat(taught[0]!).find(section => section.key === "head/teeth")!.rows.map(row => row.slot)).toEqual(["teeth", "xfea_layer1", "xfea_layer1_colour"]);
  });
});
