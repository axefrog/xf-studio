import { describe, expect, test } from "bun:test";
import { coneFactor, contribution, CREATOR_HEAD_SLOT, CREATOR_RIG_FEMALE, CREATOR_RIG_MALE, creatorCamera, creatorRigSpecs,
  DEFAULT_CREATOR_EXPOSURE, DEFAULT_CREATOR_LIGHTING, defaultCreatorExposure, halfAngles, inverseSquareFalloff, lightColourLinear,
  linearFalloff, lumensToCandela, spotLightSpec, validCreatorLighting, type Vec3 } from "../src/creator-lighting";

const byName = (name: string) => CREATOR_RIG_FEMALE.find(light => light.name === name)!;
const angleTo = (from: Vec3, axis: Vec3, to: Vec3) => {
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]], l = Math.hypot(...d), a = Math.hypot(...axis);
  return Math.acos((d[0]! * axis[0] + d[1]! * axis[1] + d[2]! * axis[2]) / (l * a)) * 180 / Math.PI;
};

describe("creator rig table", () => {
  test("female has the 15 lights of the resource, male the same layout without Main_Feet", () => {
    expect(CREATOR_RIG_FEMALE.map(light => light.name)).toEqual(["Main_Face", "Main_Eyes", "Main_Top", "Main_Body", "Main_Feet",
      "Fill_Upper", "Fill_Base", "Fill_Left", "Fill_Lower", "Highlight_Right", "Highlight_Body", "Rim_Right", "Rim_Top", "Rim_Left_Head", "Rim_Left_Body"]);
    expect(CREATOR_RIG_MALE.map(light => light.name).sort()).toEqual(CREATOR_RIG_FEMALE.map(light => light.name).filter(name => name !== "Main_Feet").sort());
    // The male rig's documented differences.
    const male = (name: string) => CREATOR_RIG_MALE.find(light => light.name === name)!;
    expect([male("Fill_Upper").lumen, male("Highlight_Body").lumen, male("Main_Body").lumen, male("Main_Body").outer, male("Main_Face").lumen,
      male("Main_Eyes").lumen, male("Main_Top").lumen, male("Rim_Left_Head").lumen, male("Rim_Left_Body").lumen]).toEqual([75, 35, 40, 75, 35, 25, 200, 250, 250]);
    expect(male("Main_Top").colour).toEqual([229, 247, 255]);
  });

  test("axes are unit vectors and the key, fill and rim lights aim at the head slot", () => {
    for (const light of [...CREATOR_RIG_FEMALE, ...CREATOR_RIG_MALE]) expect(Math.hypot(...light.axis)).toBeCloseTo(1, 2);
    const head = CREATOR_HEAD_SLOT.female;
    expect(angleTo(byName("Main_Eyes").position, byName("Main_Eyes").axis, head)).toBeCloseTo(3.7, 0);
    expect(angleTo(byName("Rim_Top").position, byName("Rim_Top").axis, head)).toBeLessThan(3);
    for (const name of ["Main_Face", "Main_Top", "Fill_Upper", "Highlight_Right", "Rim_Right", "Rim_Top"])
      expect(angleTo(byName(name).position, byName(name).axis, head)).toBeLessThan(13);
  });

  test("a spot spec follows the table: falloff mode, cone reading, colour and target", () => {
    const head = CREATOR_HEAD_SLOT.female;
    const rim = spotLightSpec(byName("Rim_Right"), { intensity: "isotropic", cone: "full" }, head);
    expect([rim.decay, rim.distance]).toEqual([2, 5]);
    expect(rim.intensity).toBeCloseTo(600 / (4 * Math.PI), 6);
    expect(rim.angle).toBeCloseTo(37.5 * Math.PI / 180, 6);
    expect(rim.penumbra).toBeCloseTo(1 - 1 / 75, 6);
    expect(rim.target).toEqual([-2.253 + 0.788, 1.5 - 0.156, 1.577 - 0.595]);
    // Linear lights: no Three falloff; intensity folded by 1 − d/r at the head.
    const face = spotLightSpec(byName("Main_Face"), { intensity: "isotropic", cone: "full" }, head);
    const d = Math.hypot(0.304, 0.62, 0.794);
    expect([face.decay, face.distance]).toEqual([0, 0]);
    expect(face.intensity).toBeCloseTo(40 / (4 * Math.PI) * (1 - d / 5), 6);
    // Half-angle reading doubles the angles (capped below 90° for Three).
    const half = spotLightSpec(byName("Rim_Left_Head"), { intensity: "isotropic", cone: "half" }, head);
    expect(half.angle).toBeCloseTo(89.9 * Math.PI / 180, 6);
    // Unset colour is white; the magenta rim decodes from sRGB.
    expect(spotLightSpec(byName("Main_Top"), DEFAULT_CREATOR_LIGHTING, head).colour).toEqual([1, 1, 1]);
    const magenta = lightColourLinear([255, 25, 128]);
    expect(magenta[0]).toBe(1); expect(magenta[1]).toBeCloseTo(0.0097, 3); expect(magenta[2]).toBeCloseTo(0.2159, 3);
    expect(creatorRigSpecs("female", DEFAULT_CREATOR_LIGHTING)).toHaveLength(15);
    expect(creatorRigSpecs("male", DEFAULT_CREATOR_LIGHTING)).toHaveLength(14);
  });
});

describe("falloff and intensity maths", () => {
  test("the decoded falloff forms", () => {
    expect(inverseSquareFalloff(2, 5)).toBeCloseTo((1 - (2 / 5) ** 4) ** 2 / 4, 9);
    expect(inverseSquareFalloff(5, 5)).toBe(0);
    expect(inverseSquareFalloff(0, 5)).toBeCloseTo(1e4, 6);
    expect(linearFalloff(1, 5)).toBeCloseTo(0.8, 9);
    expect(linearFalloff(6, 5)).toBe(0);
  });

  test("lumens to candela under both forms and both cone readings", () => {
    const light = byName("Rim_Top"); // 600 lm, outer 25°
    expect(lumensToCandela(light, "isotropic", "full")).toBeCloseTo(600 / (4 * Math.PI), 9);
    expect(lumensToCandela(light, "isotropic", "half")).toBeCloseTo(600 / (4 * Math.PI), 9);
    expect(lumensToCandela(light, "cone", "full")).toBeCloseTo(600 / (2 * Math.PI * (1 - Math.cos(12.5 * Math.PI / 180))), 6);
    expect(lumensToCandela(light, "cone", "half")).toBeCloseTo(600 / (2 * Math.PI * (1 - Math.cos(25 * Math.PI / 180))), 6);
    expect(halfAngles(light, "full")).toEqual({ outer: 12.5, inner: 0.5 });
    expect(coneFactor(light, "full", 1)).toBe(1);
    expect(coneFactor(light, "full", Math.cos(13 * Math.PI / 180))).toBe(0);
  });

  test("at-head contributions reproduce the evidence scripts' full-angle Φ/4π ranking", () => {
    // rig_gains.py (creator-lighting evidence): Rim_Right 4.217, Fill_Upper 2.827, Rim_Top 2.675, Rim_Left_Head 2.482, Main_Face 1.666.
    const head = CREATOR_HEAD_SLOT.female, e = (name: string) => contribution(byName(name), DEFAULT_CREATOR_LIGHTING, head).illuminance;
    expect(e("Rim_Right")).toBeCloseTo(4.217, 1);
    expect(e("Fill_Upper")).toBeCloseTo(2.827, 1);
    expect(e("Rim_Left_Head")).toBeCloseTo(2.482, 1);
    expect(e("Main_Face")).toBeCloseTo(1.666, 1);
    expect(Math.abs(e("Rim_Top") - 2.675) / 2.675).toBeLessThan(0.05);
    expect(e("Main_Feet")).toBe(0);
    // The half-angle reading nearly doubles the magenta head rim.
    const half = contribution(byName("Rim_Left_Head"), { intensity: "isotropic", cone: "half" }, head).illuminance;
    expect(half / e("Rim_Left_Head")).toBeGreaterThan(1.8);
  });

  test("the default exposure is the documented forehead fit, and options validate", () => {
    expect(Math.abs(defaultCreatorExposure() - DEFAULT_CREATOR_EXPOSURE) / DEFAULT_CREATOR_EXPOSURE).toBeLessThan(0.02);
    expect(validCreatorLighting(DEFAULT_CREATOR_LIGHTING)).toBe(true);
    expect(validCreatorLighting({ ...DEFAULT_CREATOR_LIGHTING, cone: "quarter" })).toBe(false);
    expect(validCreatorLighting({ ...DEFAULT_CREATOR_LIGHTING, exposure: 0 })).toBe(false);
  });
});

test("creator camera pages: 15° at the head slot, 1.2 m for the face and 2 m for the hair", () => {
  expect(creatorCamera("female", "face")).toEqual({ position: [0, 1.62, -1.2], target: [0, 1.62, 0], fov: 15 });
  expect(creatorCamera("female", "hair").position).toEqual([0, 1.62, -2]);
  expect(creatorCamera("male", "face").target).toEqual([0, 1.67, 0]);
});
