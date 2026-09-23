import { describe, test, expect } from "bun:test";
import {
  initialRecipe,
  parseRecipe,
  coverage,
  raster,
  curve,
} from "../src/recipe";
describe("portable authoring contract", () => {
  test("round trips without aliasing the loaded document", () => {
    const a = initialRecipe(),
      b = parseRecipe(JSON.parse(JSON.stringify(a)));
    b.layers[0].points[0].u = 0.1;
    expect(a.layers[0].points[0].u).not.toBe(0.1);
    expect(parseRecipe(a)).toEqual(a);
  });
  test("rejects malformed and unbounded work before rendering", () => {
    for (const edit of [
      (r: any) => (r.layers[0].points[0].u = NaN),
      (r: any) => (r.layers[0].field.radius = 0),
      (r: any) =>
        (r.layers[0].points = Array(200).fill({ u: 0.3, v: 0.2, weight: 1 })),
      (r: any) => (r.layers[1].id = r.layers[0].id),
      (r: any) => (r.schema = "other"),
    ]) {
      const r = initialRecipe();
      edit(r);
      expect(() => parseRecipe(r)).toThrow();
    }
  });
  test("mirrored field and weighted shape produce matching halves", () => {
    const l = initialRecipe().layers[0];
    l.field.du = 0.025;
    l.field.dv = 0.015;
    l.points[0].weight = 0.2;
    const p = curve(l.points);
    for (let u = 0.27; u < 0.47; u += 0.017)
      for (let v = 0.19; v < 0.28; v += 0.013)
        expect(coverage(u, v, l, p)).toBeCloseTo(coverage(1 - u, v, l, p), 10);
  });
  test("zero opacity/weights and disabled layers cannot leak alpha", () => {
    const l = initialRecipe().layers[0];
    for (const condition of ["opacity", "weight", "enabled"]) {
      const a = structuredClone(l);
      if (condition === "opacity") a.opacity = 0;
      if (condition === "weight") a.points.forEach((p) => (p.weight = 0));
      if (condition === "enabled") a.enabled = false;
      const data = raster(a, 128);
      expect(data.some((n, i) => i % 4 === 3 && n !== 0)).toBe(false);
    }
  });
  test("palette changes do not change the exported mask", () => {
    const a = initialRecipe().layers[0],
      b = { ...a, color: "#ffffff", finish: "metallic" as const };
    expect(raster(a, 128)).toEqual(raster(b, 128));
  });
  test("raster has coverage, clean white transparent texels and symmetric pixels", () => {
    const data = raster(initialRecipe().layers[0], 256);
    let count = 0;
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++) {
        const i = (y * 256 + x) * 4;
        expect(data[i]).toBe(255);
        expect(data[i + 3]).toBe(data[(y * 256 + 255 - x) * 4 + 3]);
        if (data[i + 3]) count++;
      }
    expect(count).toBeGreaterThan(100);
    expect(data[3]).toBe(0);
  });
});
