import { expect, test } from "bun:test";
import { skinPackedRgToRgb, skinRoughnessToGreen } from "../src/skin-study-maps";

test("skin source roughness maps R to Three's G and brackets B detail", () => {
  const source = new Uint8Array([200, 0, 255, 255, 100, 73, 0, 255]);
  expect([...skinRoughnessToGreen(source, "base-r")]).toEqual([200, 200, 255, 255, 100, 100, 0, 255]);
  expect([...skinRoughnessToGreen(source, "r-b-lower-bound")]).toEqual([200, 186, 255, 255, 100, 100, 0, 255]);
  expect(source[1]).toBe(0);
});

test("skin packed RG reconstructs nonnegative tangent Z", () => {
  const decoded = skinPackedRgToRgb(new Uint8Array([128, 128, 0, 255, 255, 128, 0, 255]));
  expect(decoded[2]).toBe(255);
  expect(decoded[6]).toBeGreaterThanOrEqual(127);
  expect(decoded[6]).toBeLessThanOrEqual(129);
});

test("source adapters reject partial pixels", () => {
  expect(() => skinPackedRgToRgb(new Uint8Array([1, 2, 3]))).toThrow();
  expect(() => skinRoughnessToGreen(new Uint8Array([1]), "base-r")).toThrow();
});
