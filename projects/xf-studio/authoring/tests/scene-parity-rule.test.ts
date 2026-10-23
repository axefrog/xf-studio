/** The scene parity rule (experiment 043 §8; tools/parity-rule.ts): one channel step on fewer than 0.01 % of the pixels is noise. */
import { expect, test } from "bun:test";
import { withinNoise } from "../tools/parity-rule";

test("identical frames pass; one step on fewer than 0.01 % of the pixels is noise; more pixels, a larger step or another size is not", () => {
  const total = 584 * 788;
  expect(withinNoise({ size: null, pixels: 0, max: 0, total })).toBe(true);
  // G1's worst frame: 8 pixels, one step.
  expect(withinNoise({ size: null, pixels: 8, max: 1, total })).toBe(true);
  expect(withinNoise({ size: null, pixels: Math.ceil(total * 0.0001), max: 1, total })).toBe(false);
  expect(withinNoise({ size: null, pixels: 1, max: 2, total })).toBe(false);
  expect(withinNoise({ size: "584x788 vs 600x800", pixels: -1, max: 0, total: 0 })).toBe(false);
});
