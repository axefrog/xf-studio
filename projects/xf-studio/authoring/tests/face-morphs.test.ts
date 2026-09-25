import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  faceMorphChoiceIndex, faceMorphChoices, faceMorphWeights, followsFaceMorphChoices, morphTargetName, parseMorphTargetName,
} from "../src/face-morphs";

// Asset-free inventory of the vanilla 2.31 character-creator resources (names only).
const inventory = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "..", "research", "character-customization",
  "cc-option-inventory.json"), "utf8"));
const REGIONS = ["eyes", "nose", "mouth", "jaw", "ear"];
/** The morph resource's `targets[]` order: per shape number, one target per region (`h011_eyes`, `h012_nose`, …). */
const headTargets = (shapes: number) => Array.from({ length: shapes }, (_, shape) =>
  REGIONS.map((region, r) => `h${String((shape + 1) * 10 + r + 1).padStart(3, "0")}_${region}`)).flat();
/** A base CCO's morph option choices; the EP1 twins are stored as diffs and must not change them. */
function ccoMorphNames(resource: "female_cco" | "male_cco", option: string): (string | null)[] {
  const entry = inventory.resources[resource].headOptions.find((item: any) => item.name === option && item.type === "MorphInfo");
  if (!entry) throw Error(`${resource} has no ${option} morph option`);
  expect(inventory.resources[`${resource}_ep1`].optionDiffs.some((diff: any) => diff.name === option)).toBe(false);
  return entry.morphNames;
}

test("WolvenKit shape-key names split into the game's (target, region) pair", () => {
  expect(parseMorphTargetName("h091_eyes")).toEqual({ target: "h091", region: "eyes" });
  expect(parseMorphTargetName("h145_ear")).toEqual({ target: "h145", region: "ear" });
  expect(parseMorphTargetName("eyes")).toBeNull();
  expect(parseMorphTargetName("t0_000_wa_base__full_breast_big")).toBeNull();
  expect(morphTargetName({ target: "h091", region: "eyes" })).toBe("h091_eyes");
});

test("eye-shape choices derived from the head's targets reproduce the character creator's eyes option", () => {
  for (const [resource, shapes] of [["female_cco", 21], ["male_cco", 20]] as const) {
    const choices = faceMorphChoices(headTargets(shapes), "eyes");
    expect(choices.map(choice => choice.target)).toEqual(ccoMorphNames(resource, "eyes"));
    // The other regions offer the same pairs, but not always in resource order: the female nose option
    // lists h112 after h162. Their selectors must take the order from the CCO, not from the head.
    for (const region of ["nose", "mouth", "jaw", "ear"])
      expect(faceMorphChoices(headTargets(shapes), region).map(choice => choice.target).sort()).toEqual([...ccoMorphNames(resource, region)].sort());
  }
  expect(ccoMorphNames("female_cco", "nose").indexOf("h112")).toBe(16);
  const female = faceMorphChoices(headTargets(21), "eyes");
  expect(female).toHaveLength(22);
  // The creator lists `None` as 01 and `h091` as 10.
  expect(female[0]).toEqual({ index: 0, region: "eyes", target: null, number: "01" });
  expect(female[9]).toEqual({ index: 9, region: "eyes", target: "h091", number: "10" });
  expect(faceMorphChoiceIndex(female, "h091")).toBe(9);
  expect(faceMorphChoiceIndex(female, null)).toBe(0);
  expect(faceMorphChoiceIndex(female, "h999")).toBeUndefined();
  // A head without any eye targets offers only its base shape.
  expect(faceMorphChoices(["h012_nose"], "eyes").map(choice => choice.target)).toEqual([null]);
});

test("one choice reaches every mesh carrying that (target, region) pair, and nothing else", () => {
  const head = headTargets(21);
  const eyes = Array.from({ length: 21 }, (_, i) => `h${String((i + 1) * 10 + 1).padStart(3, "0")}_eyes`);
  const nosering = Array.from({ length: 21 }, (_, i) => `h${String((i + 1) * 10 + 2).padStart(3, "0")}_nose`);
  const headWeights = faceMorphWeights(head, "eyes", "h091");
  expect(headWeights.size).toBe(21);
  expect([...headWeights].filter(([, weight]) => weight === 1).map(([index]) => head[index])).toEqual(["h091_eyes"]);
  // Other regions are untouched, so a saved nose stays applied while the eye shape changes.
  expect([...headWeights.keys()].every(index => head[index]!.endsWith("_eyes"))).toBe(true);
  const eyeWeights = faceMorphWeights(eyes, "eyes", "h091");
  expect([...eyeWeights].filter(([, weight]) => weight === 1).map(([index]) => eyes[index])).toEqual(["h091_eyes"]);
  expect(faceMorphWeights(nosering, "eyes", "h091").size).toBe(0);
  // Choosing the base clears every target of the region.
  expect([...faceMorphWeights(eyes, "eyes", null).values()].every(weight => weight === 0)).toBe(true);
  const choices = faceMorphChoices(head, "eyes");
  expect(followsFaceMorphChoices(eyes, choices)).toBe(true);
  expect(followsFaceMorphChoices(eyes.slice(1), choices)).toBe(false);
  // Developer-prepared eyes without shape keys do not follow.
  expect(followsFaceMorphChoices([], choices)).toBe(false);
});
