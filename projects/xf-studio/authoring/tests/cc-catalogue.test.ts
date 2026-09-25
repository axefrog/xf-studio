import { describe, expect, test } from "bun:test";
import { CatalogueIndex, userFacing } from "../src/cc-catalogue";
import { refineCoverage } from "../src/cc-render-coverage";
import { fixtureSource, MOD_CCO, MOD_NAME } from "./cc-fixtures";

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

  test("preview coverage is decided from the data", async () => {
    const { catalogue } = await fixtureSource(true);
    const index = new CatalogueIndex(catalogue);
    const status = (part: "head" | "body", name: string) => [index.option(part, name)!.render.status, index.option(part, name)!.render.detail];
    expect(status("head", "eyes")).toEqual(["rendered", "morph"]);
    expect(status("head", "eyes_color")).toEqual(["rendered", "eyes"]);
    expect(status("head", "skin_type_01")).toEqual(["rendered", "skin"]);
    expect(status("head", "skin_type")).toEqual(["rendered", "skin"]);
    expect(status("head", "skin_color")).toEqual(["rendered", "skin"]);
    expect(status("head", "piercings")).toEqual(["rendered", "piercings"]);
    expect(status("head", "xl_ring")).toEqual(["rendered", "piercings"]);
    // The Off placeholder reads like its slot: drawing nothing is what the game shows.
    expect(status("head", "piercings_00")).toEqual(["rendered", "piercings"]);
    expect(status("head", "teeth")).toEqual(["conditional", "face"]);
    expect(status("head", "scars")).toEqual(["conditional", "face"]);
    expect(status("body", "breast")).toEqual(["not-rendered", null]);
    const teeth = index.option("head", "teeth")!.render;
    expect(refineCoverage(teeth, [{ drawn: false }]).status).toBe("not-rendered");
    expect(refineCoverage(teeth, [{ drawn: true }]).status).toBe("rendered");
    expect(refineCoverage(teeth, []).status).toBe("conditional");
  });
});
