import { describe, test, expect } from "bun:test";
import { curve } from "../src/engines/layered-makeup/recipe";
import { initialRecipe, coverage, raster } from "./fixtures/eye-region";
import { parseEyeMakeupPart, readRecipe as parseRecipe, recipeFile } from "../src/recipe-schema";
import { parseRecipe as parseInMemory } from "../src/engines/layered-makeup/recipe";
import { mottlePreset } from "../src/engines/layered-makeup/mottle";
import { NewerDataError } from "../src/platform/api";
import { EYE_MAKEUP_REGION } from "../src/features/eye-makeup/region";
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
      (r: any) => (r.layers[0].fields[0].radius = 0),
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
    l.fields[0].du = 0.025;
    l.fields[0].dv = 0.015;
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

describe("CORE-111: layer keys", () => {
  const full = () => {
    const r = initialRecipe(), l = r.layers[0] as Record<string, unknown>;
    // Every optional block at once: a Glitter layer's flakes, a mottle, and the current forms' fields.
    Object.assign(l, { finish: "glitter", flakes: { cells: 64, density: .5, tilt: .5, seed: 1 }, effects: { mottle: mottlePreset("powder", 3) } });
    return r;
  };
  test("an unknown layer key is a newer build's in the current form, and invalid in an older recipe file", () => {
    const current = full();
    expect(parseInMemory(structuredClone(current), EYE_MAKEUP_REGION.models)).toEqual(current);
    for (const key of ["stroke", "space", "geometry", "clip"]) {
      const layered = structuredClone(current);
      (layered.layers[0] as Record<string, unknown>)[key] = { kind: "later" };
      // The old reader kept the key, and the next save of this build would have dropped it silently.
      expect(() => parseInMemory(layered, EYE_MAKEUP_REGION.models)).toThrow(NewerDataError);
      expect(() => parseEyeMakeupPart({ schema: "xfs/eye-makeup-part-2", body: layered })).toThrow(NewerDataError);
      expect(() => parseEyeMakeupPart({ schema: "xfs/eye-makeup-part-2", body: layered })).toThrow(`layer setting from a newer version of XF Studio (${key})`);
      const file = { ...recipeFile(current)!, layers: layered.layers };
      let error: unknown;
      try { parseRecipe(file); } catch (e) { error = e; }
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(NewerDataError);
    }
  });
  test("older recipe files, with their legacy single warp field, read as before", () => {
    const r = initialRecipe(), { fields, strength: _s, pathMode: _p, softness: _o, ...rest } = r.layers[0];
    const { id: _id, ...field } = fields[0];
    const legacy = { schema: "xfs/recipe-2", uv: r.uv, layers: [{ ...rest, points: rest.points.map(({ u, v, weight }) => ({ u, v, weight })), field }] };
    expect(parseRecipe(legacy).layers[0].fields[0]).toEqual({ ...field, id: `${rest.id}-field-1` });
  });
});
