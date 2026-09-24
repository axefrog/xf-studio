import { expect, test } from "bun:test";
import { browScreenMetrics } from "../src/brow-study-metrics";

test("brow-only silhouette ignores RGB shading but reports it separately", () => {
  const dark = new Uint8ClampedArray([30, 30, 30, 200, 10, 10, 10, 50, 0, 0, 0, 0]);
  const light = new Uint8ClampedArray([210, 210, 210, 200, 150, 150, 150, 50, 0, 0, 0, 0]);
  const a = browScreenMetrics(dark, 3, 1), b = browScreenMetrics(light, 3, 1);
  expect([a.visible10, a.visible50, a.bounds]).toEqual([b.visible10, b.visible50, b.bounds]);
  expect(a.strongMeanRgb).toBe(30);
  expect(b.strongMeanRgb).toBe(210);
});
