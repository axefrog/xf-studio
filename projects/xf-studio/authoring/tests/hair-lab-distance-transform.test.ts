import { expect, test } from "bun:test";
import { closeVoxels, squaredDistances } from "../src/features/hair-lab/distance-transform";

test("anisotropic Euclidean distances match an independent exhaustive point oracle", () => {
  const n = 7, spacing = [.01, .02, .03], mask = new Uint8Array(n ** 3), points = [[1, 3, 2], [5, 2, 4], [4, 5, 1]];
  for (const [x, y, z] of points) mask[x + n * (y + n * z)] = 1;
  const distances = squaredDistances(mask, n, spacing, 1);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const expected = Math.min(...points.map(p => [x, y, z].reduce((sum, v, k) => sum + ((v - p[k]) * spacing[k]) ** 2, 0)));
    expect(distances[x + n * (y + n * z)]).toBeCloseTo(expected, 7);
  }
});
test("closing fills a narrow interior gap without changing a flat exterior or the input", () => {
  const n = 9, mask = new Uint8Array(n ** 3);
  for (let z = 2; z <= 6; z++) for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) mask[x + n * (y + n * z)] = 1;
  mask[4 + n * (4 + n * 4)] = 0;
  const closed = closeVoxels(mask, n);
  expect(closed[4 + n * (4 + n * 4)]).toBe(1); expect(mask[4 + n * (4 + n * 4)]).toBe(0);
  expect(closed.reduce((a, b) => a + b, 0)).toBe(125);
});
