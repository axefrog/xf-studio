import { describe, expect, test } from "bun:test";
import { buildCatalogue, CatalogueIndex, type CcCatalogue, readCcoWithPresentation, userFacing } from "../src/cc-catalogue";
import type { CcoResource } from "../src/cco-model";
import { catalogueCoverage, refineCoverage } from "../src/cc-render-coverage";
import { CC_PAGE_SIZE, choicePage, panelProjection, readCcPanel, readChoicePage } from "../src/cc-panel";
import { loadMergedCco } from "../src/character-resolver";
import { appearance, BASE_CCO, creator, fixtureSource, MOD_CCO, MOD_NAME, PRESENTATION, vanillaCreator } from "./cc-fixtures";
import { fixtureInstallation } from "./resolver-fixtures";

describe("creator catalogue from the merged resource", () => {
  test("vanilla options: order, rows, sections, labels, Off choices and swatches", async () => {
    const { catalogue } = await fixtureSource(false);
    const index = new CatalogueIndex(catalogue);
    // Options follow their creator index; body options come after the head's.
    expect(catalogue.options.filter(o => userFacing(o)).map(o => o.name))
      .toEqual(["skin_color", "skin_type", "eyes", "eyes_color", "scars", "piercings", "piercings_00", "piercings_01", "teeth", "breast"]);
    // Sections in TweakDB's order, titled from the texts; a category the list names but nothing uses is left out.
    expect(catalogue.sections.map(s => [s.id, s.label.text, s.source])).toEqual([["Skin", "Skin", "tweakdb"], ["Eyes", "Eyes", "tweakdb"],
      ["Scars", "Scars all", "tweakdb"], ["FaceModification", "Face modification", "tweakdb"], ["Body", "Body", "tweakdb"]]);
    // Link followers (the skin types follow the skin tone) get no row; switcher targets share their slot's row.
    const skin = catalogue.sections[0]!;
    expect(skin.rows.map(row => [row.slot, row.options])).toEqual([["skin_color", ["head/skin_color"]], ["skin_type_switcher", ["head/skin_type"]]]);
    const piercingRow = catalogue.sections.flatMap(s => s.rows).find(r => r.slot === "piercings_color")!;
    expect(piercingRow.options).toEqual(["head/piercings_00", "head/piercings_01"]);
    expect(index.option("head", "skin_type_02")!.controlledBy).toEqual(["skin_type"]);
    // Labels: text by secondary key and LocKey, choice numbers as written, a readable fallback.
    expect(index.option("head", "skin_color")!.label).toEqual({ text: "Skin Tone", key: "UI-CharacterCreation-skin_color", source: "game" });
    expect(index.option("head", "eyes_color")!.label.text).toBe("Eye Color");
    expect(index.option("head", "eyes")!.choices.map(c => c.label.text)).toEqual(["01", "02", "03"]);
    expect(index.option("head", "eyes_color")!.choices[1]!.label).toEqual({ text: "Blue", key: "", source: "derived" });
    expect(index.option("head", "teeth")!.label.text).toBe("Teeth");
    // Off: a None definition, a switcher choice whose options add nothing, a morph's None.
    expect(index.option("head", "scars")!.choices.map(c => [c.key, c.off, c.label.text])).toEqual([["", true, "OFF"], ["scar_01", false, "01"]]);
    expect(index.option("head", "piercings")!.choices.map(c => [c.key, c.off, c.activates])).toEqual([["Common-Off", true, ["piercings_00"]], ["01", false, ["piercings_01"]]]);
    expect(index.option("head", "eyes")!.choices[0]).toMatchObject({ key: "", off: true });
    // Swatches: the tint and the icon's atlas part (unknown icons keep their record name).
    expect(index.option("head", "skin_color")!.choices[0]!.swatch).toEqual({ color: null, iconRecord: "OptionsIcons.ToneA", icon: { record: "OptionsIcons.ToneA", atlas: { hash: "42", path: null }, part: "tone_a" } });
    expect(index.option("head", "eyes_color")!.choices[0]!.swatch!.color).toEqual([80, 50, 20, 255]);
    expect(index.option("head", "eyes_color")!.choices[1]!.swatch).toEqual({ color: null, iconRecord: "OptionsIcons.Blue", icon: null });
    expect(catalogue.options.every(o => o.provenance.kind === "vanilla" && o.choices.every(c => c.provenance.kind === "vanilla"))).toBe(true);
    expect(catalogue.counts.modChoices).toBe(0);
  });

  test("a CCXL mod: named merge, anonymous overlay and a new switcher choice, each with its provenance", async () => {
    const { catalogue } = await fixtureSource(true);
    const index = new CatalogueIndex(catalogue);
    const eyes = index.option("head", "eyes_color")!;
    expect(eyes.provenance.kind).toBe("vanilla");
    expect(eyes.choices.map(c => [c.key, c.provenance.kind, c.provenance.mod])).toEqual([["he__01_brown", "vanilla", null], ["he__02_blue", "vanilla", null],
      ["he__03_violet", "mod", MOD_NAME], ["he__04_green", "mod", MOD_NAME]]);
    expect(eyes.choices[2]!.provenance.resource).toBe(MOD_CCO);
    expect(eyes.choices[2]!.swatch!.iconRecord).toBe("OptionsIcons.ModViolet");
    const piercings = index.option("head", "piercings")!;
    const ring = piercings.choices.find(c => c.activates.includes("xl_ring"))!;
    expect(ring.label.text).toBe("Pretty ring");
    expect(ring.provenance.mod).toBe(MOD_NAME);
    const newOption = index.option("head", "xl_ring")!;
    expect(newOption.provenance).toEqual({ kind: "mod", mod: MOD_NAME, resource: MOD_CCO });
    expect(newOption.groups).toEqual(["face"]);
    // The new option takes turns in the vanilla piercing row.
    const row = catalogue.sections.flatMap(s => s.rows).find(r => r.slot === "piercings_color")!;
    expect(row.options).toEqual(["head/piercings_00", "head/piercings_01", "head/xl_ring"]);
    expect(catalogue.counts).toMatchObject({ modOptions: 1, modChoices: 5, modChoicesOnVanillaOptions: 3 });
  });

  test("links: the hidden followers are catalogued with their link and never get a row", async () => {
    const { catalogue } = await fixtureSource(false);
    const index = new CatalogueIndex(catalogue);
    expect(index.option("head", "neck")).toMatchObject({ hidden: true, link: { key: "skin color", controller: false } });
    expect(index.option("head", "skin_color")!.link).toEqual({ key: "skin color", controller: true });
    expect(catalogue.sections.flatMap(s => s.rows).some(r => r.options.includes("head/neck") || r.options.includes("body/body_color"))).toBe(false);
  });

  test("preview coverage is the preview side's projection of the catalogue, decided from the data (CORE-60)", async () => {
    const { catalogue } = await fixtureSource(true);
    const index = new CatalogueIndex(catalogue);
    // The catalogue carries no coverage of its own; the preview projects it when asked.
    expect("render" in index.option("head", "eyes")!).toBe(false);
    const coverage = catalogueCoverage(catalogue);
    const status = (part: "head" | "body", name: string) => [coverage.get(`${part}/${name}`)!.status, coverage.get(`${part}/${name}`)!.detail];
    expect(status("head", "eyes")).toEqual(["rendered", "morph"]);
    expect(status("head", "eyes_color")).toEqual(["rendered", "eyes"]);
    expect(status("head", "skin_type_01")).toEqual(["rendered", "skin"]);
    expect(status("head", "skin_type")).toEqual(["rendered", "skin"]);
    expect(status("head", "skin_color")).toEqual(["rendered", "skin"]);
    expect(status("head", "piercings")).toEqual(["rendered", "piercings"]);
    expect(status("head", "xl_ring")).toEqual(["rendered", "piercings"]);
    // The Off placeholder reads like its slot: drawing nothing is what the game shows.
    expect(status("head", "piercings_00")).toEqual(["rendered", "piercings"]);
    expect(status("head", "teeth")).toEqual(["rendered", "teeth"]);
    expect(status("head", "scars")).toEqual(["conditional", "face"]);
    // The body draws since the body render: its skin (consumed by the third-person body group) and its shape.
    expect(status("body", "breast")).toEqual(["rendered", "body"]);
    expect(status("body", "body_color")).toEqual(["rendered", "body"]);
    // A conditional face option settles from the plan; a rendered one (the teeth, which have a slot of their own) is kept.
    const scars = coverage.get("head/scars")!;
    expect(refineCoverage(scars, [{ drawn: false }]).status).toBe("not-rendered");
    expect(refineCoverage(scars, [{ drawn: true }]).status).toBe("rendered");
    expect(refineCoverage(scars, []).status).toBe("conditional");
    expect(refineCoverage(coverage.get("head/teeth")!, [{ drawn: false }])).toEqual(coverage.get("head/teeth")!);
  });

  test("a mod archive replacing the base creator resource names that mod, not vanilla (PIPE-46)", async () => {
    const { graph } = fixtureInstallation([
      { virtualPath: "archive/pc/content/basegame_4_gamedata.archive", files: { [BASE_CCO]: vanillaCreator() } },
      { virtualPath: "archive/pc/mod/replacer.archive", provider: "mo2-mod", providerName: "Creator Replacer", priority: 1, files: { [BASE_CCO]: vanillaCreator() } },
    ], []);
    const merged = await loadMergedCco(graph, "female", readCcoWithPresentation);
    expect(merged.base.group).toBe("mod");
    const catalogue = buildCatalogue({ bodyGender: "female", cco: merged.merged.cco, customs: [], text: null, presentation: PRESENTATION,
      base: { path: BASE_CCO, mod: merged.base.provider } });
    const option = new CatalogueIndex(catalogue).option("head", "eyes_color")!;
    expect(option.provenance).toEqual({ kind: "mod", mod: "Creator Replacer", resource: BASE_CCO });
    expect(option.choices.every(choice => choice.provenance.mod === "Creator Replacer")).toBe(true);
  });

  test("a head option without a category is filed beside its neighbours, not under Body (UI-60)", async () => {
    const withLonely = creator([...(vanillaCreator() as { Data: { RootChunk: { headCustomizationOptions: object[] } } }).Data.RootChunk.headCustomizationOptions,
      appearance("lonely", "xl\\lonely.app", ["a", "b"], { uiSlot: "lonely", index: 185 })], { TPP: ["lonely"] });
    // Remove the category the fixture helper writes, as a resource that doesn't name one would.
    const root = (withLonely as { Data: { RootChunk: { headCustomizationOptions: { Data: Record<string, unknown> }[] } } }).Data.RootChunk;
    delete root.headCustomizationOptions.find(option => (option.Data.name as { $value: string }).$value === "lonely")!.Data.randomizeCategory;
    const { graph } = fixtureInstallation([{ virtualPath: "archive/pc/content/basegame_4_gamedata.archive", files: { [BASE_CCO]: withLonely } }], []);
    const merged = await loadMergedCco(graph, "female", readCcoWithPresentation);
    const catalogue = buildCatalogue({ bodyGender: "female", cco: merged.merged.cco, customs: [], text: null, presentation: PRESENTATION });
    expect(new CatalogueIndex(catalogue).option("head", "lonely")!.categoryExplicit).toBe(false);
    // Index 185 sits among the Eyes options (170, 180): the row goes there.
    expect(catalogue.sections.find(section => section.rows.some(row => row.slot === "lonely"))!.id).toBe("Eyes");
  });

  test("the catalogue shares no list with the merged resource it was built from (CORE-62)", async () => {
    const { catalogue, cco } = await fixtureSource(true);
    const option = new CatalogueIndex(catalogue).option("head", "piercings")!;
    const source = cco.parts.head.options.find(item => item.name === "piercings")!;
    expect(option.editTags).not.toBe(source.editTags);
    expect(option.uiSlots).not.toBe(source.type === "switcher" ? source.uiSlots : null);
    expect(option.choices[1]!.activates).not.toBe(source.type === "switcher" ? source.options[1]!.names : null);
    (option.editTags as string[]).push("changed");
    expect(source.editTags).not.toContain("changed");
  });

  test("the panel's projection: sections, rows and options without their choices; paged choices; tables by index (UI-59)", async () => {
    const { catalogue } = await fixtureSource(true);
    const { panel, mods } = panelProjection(catalogue, catalogueCoverage(catalogue), "id");
    expect(readCcPanel(JSON.parse(JSON.stringify(panel)))).toEqual(panel);
    expect(panel.mods).toEqual([MOD_NAME]);
    const piercings = panel.options.find(option => option.id === "head/piercings")!;
    expect(piercings).toMatchObject({ type: "switcher", off: "Common-Off", count: 3, mod: -1, coverage: ["rendered", expect.any(Number)] });
    // A colour-only controller's choices all add nothing themselves: no Off.
    expect(panel.options.find(option => option.id === "head/skin_color")!.off).toBeNull();
    expect(panel.options.find(option => option.id === "head/piercings_01")!.dependsOn).toEqual(["Piercings"]);
    const index = new CatalogueIndex(catalogue);
    const page = choicePage(index, mods, "head/eyes_color", 0)!;
    expect(page.choices.map(choice => [choice.key, choice.color, choice.mod])).toEqual([["he__01_brown", "#503214", -1], ["he__02_blue", null, -1],
      ["he__03_violet", "#7828a0", 0], ["he__04_green", null, 0]]);
    expect(readChoicePage(JSON.parse(JSON.stringify(page)), panel.mods.length)).toEqual(page);
    expect(choicePage(index, mods, "head/neck", 0)).toBeNull();
    expect(choicePage(index, mods, "head/nope", 0)).toBeNull();
  });

  test("size budget: the first paint of a creator with a thousand options and 130,000 choices stays well under 1 MB (UI-59)", () => {
    const options: CcoResource["parts"]["head"]["options"] = [];
    for (let o = 0; o < 1000; o++) options.push({ type: "appearance", name: `option_${o}`, uiSlot: `slot_${o % 60}`, link: "", linkController: false, hidden: false,
      enabled: o % 60 === 0, index: o, defaultIndex: 0, localizedName: `LocKey#${o}`, editTags: ["NewGame"], definedBy: o % 3 ? `mod ${o % 200}` : "base game",
      resource: { hash: String(1000 + o), path: `base\\o${o}.app` },
      definitions: Array.from({ length: 130 }, (_, d) => ({ name: `option_${o}__choice_with_a_long_name_${d}`, index: d, localizedName: "", tags: [], providedBy: `mod ${d % 250}` })) });
    const cco: CcoResource = { label: "t", version: 1, parts: { head: { options, groups: [{ name: "TPP", options: options.map(o => o.name) }] },
      body: { options: [], groups: [] }, arms: { options: [], groups: [] } } };
    const catalogue: CcCatalogue = buildCatalogue({ bodyGender: "female", cco, text: null, presentation: null,
      customs: Array.from({ length: 250 }, (_, i) => ({ path: `xl\\mod${i}.inkcharcustomization`, label: `mod ${i}`, mod: `A mod with a fairly long name ${i}` })) });
    expect(catalogue.counts.choices).toBe(130_000);
    const { panel, mods } = panelProjection(catalogue, catalogueCoverage(catalogue), "id");
    const bytes = JSON.stringify(panel).length;
    expect(bytes).toBeLessThan(600_000);
    // A page is bounded too.
    const page = choicePage(new CatalogueIndex(catalogue), mods, "head/option_0", 0)!;
    expect(page.choices).toHaveLength(Math.min(CC_PAGE_SIZE, 130));
    expect(JSON.stringify(page).length).toBeLessThan(40_000);
  });
});
