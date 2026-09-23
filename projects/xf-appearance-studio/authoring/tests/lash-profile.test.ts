import { expect, test } from "bun:test";
import { approximateLashColor, parseLashProfile, sampleStops } from "../src/lash-profile";

const profile = {
  schema: "xfs/lash-profile-preview-1", appearanceHash: "6047185506343464350",
  definition: "05_brown_liquorice", profileResourceSha256: "a".repeat(64),
  strandId: [107, 105, 107], strandGradient: [255, 255, 255], selectorSwatch: [50, 44, 40],
  id: [{ value: 0.8, color: [160, 140, 120] }, { value: 0.2, color: [80, 90, 100] }],
  rootToTip: [{ value: 0, color: [100, 100, 100] }, { value: 1, color: [220, 200, 180] }],
} as const;

test("saved lash profile is bound to the chosen definition and finite gradients", () => {
  expect(parseLashProfile(profile).definition).toBe(profile.definition);
  expect(() => parseLashProfile({ ...profile, definition: "another" })).toThrow();
  expect(() => parseLashProfile({ ...profile, id: [{ value: -1, color: [1, 2, 3] }] })).toThrow();
});

test("profile lookup sorts unsorted source stops and respects constant placeholders", () => {
  expect(sampleStops([{ value: 1, color: [200, 100, 50] }, { value: 0, color: [0, 0, 0] }], 0.5))
    .toEqual([100, 50, 25]);
  const color = approximateLashColor(parseLashProfile(profile));
  const hex = color.getHexString();
  expect(hex).toMatch(/^[0-9a-f]{6}$/);
  // Exposure is anchored to the saved selector swatch, while the profile
  // product controls the RGB balance. It must not invent strand variation.
  expect(Number.parseInt(hex.slice(0, 2), 16)).toBeGreaterThan(40);
  expect(Number.parseInt(hex.slice(4, 6), 16)).toBeLessThan(50);
});
