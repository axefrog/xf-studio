import { expect, test } from "bun:test";
import { filterStrandId } from "../src/features/hair-lab/strand-id-filter";

test("ID bake filtering and monotone calibration are deterministic and leave all other maps untouched", () => {
  const width = 64, height = 128, alpha = new Uint8Array(width * height), id = new Uint8Array(alpha.length);
  for (let y = 4; y < 124; y++) for (const [j, x] of [10, 24, 39, 53].entries()) {
    const centre = x + Math.sin(y / 17 + j) * 3;
    for (let px = Math.floor(centre - 1); px <= centre + 1; px++) {
      const k = y * width + px; alpha[k] = 255; id[k] = [20, 80, 150, 230][j]!;
    }
  }
  const target = [0, .02, .04, .08, .09, .12, .3, .09, .06, .07, .05, .03, .03, .02, 0, 0];
  const a = { width, height, alpha, id: id.slice() }, b = { width, height, alpha, id: id.slice() }, before = alpha.slice();
  const options = { size: 4, background: 104 / 255 }, rect = { x: 0, y: 0, width, height };
  const error = filterStrandId(a, rect, rect, 0, options, target);
  expect(filterStrandId(b, rect, rect, 0, options, target)).toBe(error);
  expect(a.id).toEqual(b.id); expect(alpha).toEqual(before);
  expect(error).toBeLessThan(.1);
});
test("ID filtering never invents coordinate noise to split a single constant value", () => {
  const map = { width: 16, height: 16, alpha: new Uint8Array(256).fill(255), id: new Uint8Array(256).fill(104) };
  const target = Array(16).fill(1 / 16), rect = { x: 0, y: 0, width: 16, height: 16 };
  const error = filterStrandId(map, rect, rect, 0, { size: 4, background: 104 / 255 }, target);
  expect(new Set(map.id).size).toBe(1);
  expect(error).toBeGreaterThan(.9); // Unattainable distributions are measured, never concealed with noise.
});
test("ID filtering rejects invalid footprints and histogram data before mutation", () => {
  const map = { width: 16, height: 16, alpha: new Uint8Array(256).fill(255), id: new Uint8Array(256).fill(104) }, rect = { x: 0, y: 0, width: 16, height: 16 };
  for (const sampling of [{ size: 0, background: .5 }, { size: 2.5, background: .5 }, { size: 17, background: .5 }, { size: 4, background: NaN }])
    expect(() => filterStrandId(map, rect, rect, 0, sampling)).toThrow();
  expect(() => filterStrandId(map, rect, rect, 0, { size: 4, background: .5 }, Array(16).fill(0))).toThrow();
  expect(map.id.every(v => v === 104)).toBe(true);
});
