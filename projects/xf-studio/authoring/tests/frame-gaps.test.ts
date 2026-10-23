/** The presentation-gap gate (tools/frame-gaps.ts; experiment 043 §13): the interval that ends at the takeover counts. */
import { expect, test } from "bun:test";
import { FRAME_GAP_MS, gapsPass, preparationGaps } from "../tools/frame-gaps";

test("a gap that ends at the takeover fails the gate (Sol's 4a-v-c case: samples at 0, 16 and 1,016 ms, takeover at 1,016 ms)", () => {
  expect(preparationGaps([0, 16, 1016], 2)).toEqual([16, 1000]);
  expect(gapsPass([0, 16, 1016], 2)).toBe(false);
});

test("frames every 16 ms pass; samples after the takeover don't count; without a takeover every interval counts", () => {
  const steady = Array.from({ length: 20 }, (_, i) => i * 16);
  expect(gapsPass(steady, 10)).toBe(true);
  expect(Math.max(...preparationGaps(steady, 10))).toBe(16);
  // A long gap after the takeover is the second after the show, gated by its long tasks instead.
  expect(gapsPass([0, 16, 32, 1032], 2)).toBe(true);
  expect(gapsPass([0, 16, 32, 1032], null)).toBe(false);
  expect(gapsPass([0, 16, 16 + FRAME_GAP_MS], 2)).toBe(true);
  expect(gapsPass([0, 16, 17 + FRAME_GAP_MS], 2)).toBe(false);
});
