// The Character panel's one hierarchy (character-panel-sections.ts): parts of V, sections from the creator projection, and the
// contributions' switches and controls placed by what they show, derived from data (Next 4 of the cc-controls backlog).
import { describe, expect, test } from "bun:test";
import { panelProjection } from "../src/cc-panel";
import { catalogueCoverage } from "../src/cc-render-coverage";
import { CHARACTER_CONTRIBUTIONS, characterPanelTree, type CharacterSectionContribution } from "../src/character-panel-sections";
import { fixtureSource } from "./cc-fixtures";

const tree = async (contributions?: readonly CharacterSectionContribution[]) => {
  const source = await fixtureSource(true);
  const { panel } = panelProjection(source.catalogue, catalogueCoverage(source.catalogue), "fixture");
  return characterPanelTree(panel, contributions);
};

describe("the Character panel's hierarchy", () => {
  test("Head, Body and Clothing; a creator row goes to the group of its part", async () => {
    const groups = await tree();
    expect(groups.map(group => group.id)).toEqual(["head", "body", "clothing"]);
    const head = groups[0]!, body = groups[1]!;
    expect(head.sections.flatMap(section => section.rows).every(row => row.part === "head")).toBe(true);
    expect(body.sections.flatMap(section => section.rows).every(row => row.part !== "head")).toBe(true);
    expect(body.sections.some(section => section.creator === "Body")).toBe(true);
  });

  test("a switch naming a detail sits on the heading of the creator section holding that detail's row; without one it is its own section", async () => {
    const groups = await tree();
    const head = groups[0]!;
    // The fixture's piercing colours are in Face Modifications: the piercings switch goes there, whatever the section is called.
    const piercings = head.sections.find(section => section.toggles.some(toggle => toggle.id === "piercings"))!;
    expect(piercings.creator).toBe("FaceModification");
    // The eye shape joins the Eyes section (the eye colour's row).
    expect(head.sections.find(section => section.controls.includes("eyeShape"))?.creator).toBe("Eyes");
    // The fixture has no hair: the hair switch is a section of its own, after the creator's sections.
    const hair = head.sections.find(section => section.toggles.some(toggle => toggle.id === "hair"))!;
    expect([hair.creator, hair.title, hair.rows.length]).toEqual([null, "Hair", 0]);
    expect(head.sections.indexOf(hair)).toBeGreaterThan(head.sections.findIndex(section => section.creator === "FaceModification"));
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

  test("before the creator options arrive the tree still holds the contributions; a module's contribution adds a section", async () => {
    const empty = characterPanelTree(null);
    expect(empty.find(group => group.id === "head")!.sections.map(section => section.title)).toEqual(["Eyes", "Eyebrows", "Eyelashes", "Hair", "Piercings"]);
    const withModule = await tree([...CHARACTER_CONTRIBUTIONS, { id: "poses.idle", module: "poses", group: "body", title: "Pose", order: -1, controls: ["idle"] }]);
    const body = withModule.find(group => group.id === "body")!;
    expect(body.sections[0]).toMatchObject({ key: "body/poses.idle", title: "Pose", creator: null, controls: ["idle"] });
  });
});
