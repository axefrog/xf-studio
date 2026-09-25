import { describe, expect, test } from "bun:test";
import {
  MAX_FIELDS, coverage, curve, initialRecipe, parseRecipe, parseRecipeFile, raster, warp, warpFields,
  type Field, type Layer, type Point, type WarpField,
} from "../src/recipe";

type LegacyLayer = Omit<Layer, "fields" | "strength" | "pathMode" | "softness"> & { field: Field };
const oldLayer = (): LegacyLayer => ({
  id: "legacy-eye", name: "Legacy shape", enabled: true, color: "#905774",
  finish: "matte", opacity: 0.85, feather: 0.012, symmetry: true,
  points: [
    [0.303, 0.231, 0.25], [0.33, 0.206, 1], [0.378, 0.206, 0.7],
    [0.427, 0.229, 0.8], [0.439, 0.253, 0.1], [0.369, 0.235, 1],
  ].map(([u, v, weight]) => ({ u, v, weight })),
  field: { u: 0.342, v: 0.223, du: 0, dv: 0, radius: 0.07 },
});
const legacyRecipe = (layer = oldLayer()) => ({
  schema: "xfs/recipe-2", uv: "gltf-uv0-top-left", layers: [layer],
});
const bounded = (n: number) => Math.min(1, Math.max(0, n));

// Frozen pre-migration evaluator. Deliberately does not call the production
// curve, warp, coverage or raster helpers: this catches accidental look changes.
function oldPolygon(points: Point[]): Point[] {
  const polygon: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[(i + points.length - 1) % points.length], b = points[i];
    const c = points[(i + 1) % points.length], d = points[(i + 2) % points.length];
    for (let j = 0; j < 10; j++) {
      const t = j / 10, t2 = t * t, t3 = t2 * t;
      const at = (k: "u" | "v") => 0.5 * (2 * b[k] + (-a[k] + c[k]) * t +
        (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 +
        (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3);
      polygon.push({ u: at("u"), v: at("v"), weight: b.weight * (1 - t) + c.weight * t });
    }
  }
  return polygon;
}
function oldCoverage(u: number, v: number, layer: LegacyLayer, polygon: Point[], fields = [layer.field]): number {
  if (!layer.enabled) return 0;
  const at = (u: number, v: number) => {
    let du = 0, dv = 0;
    for (const f of fields) {
      const influence = Math.exp(-((u - f.u) ** 2 + (v - f.v) ** 2) / (2 * f.radius ** 2));
      du += f.du * influence;
      dv += f.dv * influence;
    }
    u -= du; v -= dv;
    let inside = false, best = Infinity, weight = 1;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[j], b = polygon[i];
      if (a.v > v !== b.v > v && u < (b.u - a.u) * (v - a.v) / (b.v - a.v) + a.u)
        inside = !inside;
      const dx = b.u - a.u, dy = b.v - a.v;
      const t = bounded(((u - a.u) * dx + (v - a.v) * dy) / (dx * dx + dy * dy || 1));
      const distance = (u - a.u - dx * t) ** 2 + (v - a.v - dy * t) ** 2;
      if (distance < best) {
        best = distance;
        weight = a.weight * (1 - t) + b.weight * t;
      }
    }
    const x = bounded(0.5 + (inside ? 1 : -1) * Math.sqrt(best) / layer.feather);
    return x * x * (3 - 2 * x) * weight * layer.opacity;
  };
  return layer.symmetry ? Math.max(at(u, v), at(1 - u, v)) : at(u, v);
}
function fullRaster(size: number, evaluate: (u: number, v: number) => number) {
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      pixels[(y * size + x) * 4 + 3] = Math.round(255 * evaluate((x + 0.5) / size, (y + 0.5) / size));
  return pixels;
}
const field = (id: string, overrides: Partial<Field> = {}): WarpField => ({
  id, u: 0.34, v: 0.23, du: 0.03, dv: -0.01, radius: 0.07, ...overrides,
});

describe("multiple local warp fields", () => {
  test("v1 and v3 migration retain independent old pixels with varied strength and eight fields", () => {
    const old = oldLayer(), polygon = oldPolygon(old.points);
    const first = { schema: "eye-artistry/recipe-1", uv: "gltf-uv0-top-left",
      layers: Array.from({length:4},(_,i)=>({...old,id:`old-${i}`})) };
    expect(raster(parseRecipe(first).layers[0],256))
      .toEqual(fullRaster(256,(u,v)=>oldCoverage(u,v,old,polygon)));
    const fields = Array.from({length:8},(_,i)=>field(`field-${i}`,{
      u:.31+i*.02, v:.22+i*.003, du:(i%2?1:-1)*.017, dv:.004, radius:.025+i*.005,
    }));
    const {field:_field,...settings} = old;
    const third = {schema:"xfs/recipe-3",uv:"gltf-uv0-top-left",layers:[{...settings,fields}]};
    const migrated = parseRecipe(third);
    expect(migrated.layers[0].strength).toEqual({mode:"legacy-nearest"});
    expect(raster(migrated.layers[0],256))
      .toEqual(fullRaster(256,(u,v)=>oldCoverage(u,v,old,polygon,fields)));
  });
  test("legacy migration preserves independent old mask pixels, symmetry and displacement", () => {
    for (const symmetry of [false, true]) {
      for (const vector of [[0, 0], [0.035, -0.02], [-0.1, 0.1]]) {
        const old = oldLayer();
        old.symmetry = symmetry;
        [old.field.du, old.field.dv] = vector;
        const input = legacyRecipe(old), before = JSON.stringify(input);
        const migrated = parseRecipe(input), polygon = oldPolygon(old.points);
        expect(parseRecipeFile(input).schema).toBe("xfs/recipe-7");
        expect(migrated.layers[0].fields).toEqual([{ ...old.field, id: "legacy-eye-field-1" }]);
        expect("field" in migrated.layers[0]).toBe(false);
        expect(raster(migrated.layers[0], 256)).toEqual(fullRaster(256, (u, v) => oldCoverage(u, v, old, polygon)));
        expect(JSON.stringify(input)).toBe(before);
        migrated.layers[0].fields[0].du = 0.09;
        expect(JSON.stringify(input)).toBe(before);
      }
    }
  });

  test("empty and zero vectors are identity; a single field is the exact old warp", () => {
    for (const [u, v] of [[0, 0], [1, 1], [0.325, 0.231], [0.4, 0.25]]) {
      expect(warpFields(u, v, [])).toEqual([u, v]);
      expect(warpFields(u, v, [field("zero", { du: 0, dv: 0 })])).toEqual([u, v]);
      const f = field("one");
      expect(warpFields(u, v, [f])).toEqual(warp(u, v, f));
      expect(warpFields(u, v, [f, field("zero", { du: 0, dv: 0 })])).toEqual(warp(u, v, f));
    }
    const l = initialRecipe().layers[0], zero = raster(l, 256);
    l.fields = [];
    expect(raster(l, 256)).toEqual(zero);
  });

  test("overlapping influences add without normalization, cancel, and sample the original query", () => {
    const a = field("a"), b = field("b", { u: 0.37, v: 0.24, du: -0.016, dv: 0.024 });
    const u = 0.353, v = 0.238;
    const [au, av] = warp(u, v, a), [bu, bv] = warp(u, v, b);
    const result = warpFields(u, v, [a, b]);
    expect(result[0]).toBeCloseTo(au + bu - u, 15);
    expect(result[1]).toBeCloseTo(av + bv - v, 15);
    expect(Math.hypot(result[0] - warp(au, av, b)[0], result[1] - warp(au, av, b)[1])).toBeGreaterThan(1e-4);
    const duplicate: WarpField = { ...a, id: "copy" };
    const opposed: WarpField = { ...a, id: "opposed", du: -a.du, dv: -a.dv };
    expect(warpFields(a.u, a.v, [a, duplicate])).toEqual([a.u - 2 * a.du, a.v - 2 * a.dv]);
    expect(warpFields(u, v, [a, opposed])).toEqual([u, v]);
    const fields = [a, b, field("c", { radius: 0.025 }), field("d", { du: -0.07, dv: -0.055 })];
    for (let i = 0; i < 100; i++) {
      const p = warpFields(i / 100, 0.24, fields), q = warpFields(i / 100, 0.24, [...fields].reverse());
      expect(p[0]).toBeCloseTo(q[0], 14);
      expect(p[1]).toBeCloseTo(q[1], 14);
    }
  });

  test("summed-displacement raster bounds match full-atlas evaluation, including clipping and symmetry", () => {
    for (const symmetry of [false, true]) {
      for (const vector of [[0.1, 0.1], [-0.1, -0.1], [0.1, -0.07]]) {
        const l = initialRecipe().layers[0];
        l.symmetry = symmetry;
        l.fields = Array.from({ length: MAX_FIELDS }, (_, i) => field(`f-${i}`, {
          u: 0.36, v: 0.23, radius: 0.2, du: vector[0], dv: vector[1],
        }));
        const polygon = curve(l.points), result = raster(l, 192);
        expect(result).toEqual(fullRaster(192, (u, v) => coverage(u, v, l, polygon)));
        if (vector[0] === 0.1 && vector[1] === 0.1) {
          // There really are pixels outside the old single-vector vertical bound.
          const oldMaxV = Math.max(...polygon.map((p) => p.v)) + l.feather + Math.hypot(0.1, 0.1);
          let escaped = 0;
          for (let y = Math.ceil(oldMaxV * 192); y < 192; y++)
            for (let x = 0; x < 192; x++) escaped += result[(y * 192 + x) * 4 + 3] > 0 ? 1 : 0;
          expect(escaped).toBeGreaterThan(0);
        }
      }
    }
  });

  test("recipe validation bounds arrays and IDs, rejects ambiguous formats, and retains independent data", () => {
    const valid = initialRecipe();
    valid.layers[0].fields = [];
    valid.layers[1].fields = Array.from({ length: MAX_FIELDS }, (_, i) => field(`field-${i}`));
    expect(parseRecipe(valid)).toEqual(valid);
    const parsed = parseRecipe(valid);
    parsed.layers[1].fields[0].radius = 0.15;
    expect(valid.layers[1].fields[0].radius).toBe(0.07);
    const edits: ((r: any) => void)[] = [
      r => { r.layers[0].fields = undefined; },
      r => { r.layers[0].fields = {}; },
      r => { r.layers[0].fields = [null]; },
      r => { r.layers[0].fields = Array.from({ length: MAX_FIELDS + 1 }, (_, i) => field(`f-${i}`)); },
      r => { r.layers[0].fields = [field("same"), field("same")]; },
      r => { r.layers[0].fields = [field(" ")]; },
      r => { r.layers[0].fields = [field("a".repeat(81))]; },
      r => { r.layers[0].fields = [field("a", { u: -0.01 })]; },
      r => { r.layers[0].fields = [field("a", { v: 1.01 })]; },
      r => { r.layers[0].fields = [field("a", { du: 0.101 })]; },
      r => { r.layers[0].fields = [field("a", { dv: NaN })]; },
      r => { r.layers[0].fields = [field("a", { radius: 0.004 })]; },
      r => { r.layers[0].fields = [field("a", { radius: 0.201 })]; },
      r => { r.layers[0].field = oldLayer().field; },
      r => { r.layers[0].field = undefined; },
    ];
    for (const edit of edits) {
      const bad = structuredClone(valid);
      edit(bad);
      expect(() => parseRecipe(bad)).toThrow();
    }
    const old: any = legacyRecipe();
    old.layers[0].fields = [];
    expect(() => parseRecipe(old)).toThrow();
    delete old.layers[0].fields;
    delete old.layers[0].field;
    expect(() => parseRecipe(old)).toThrow();
    const four = { schema: "eye-artistry/recipe-1", uv: "gltf-uv0-top-left",
      layers: Array.from({ length: 4 }, (_, i) => ({ ...oldLayer(), id: `old-${i}` })) };
    const converted = parseRecipe(four);
    expect(converted.layers.map(l => l.fields[0].id)).toEqual(["old-0-field-1", "old-1-field-1", "old-2-field-1", "old-3-field-1"]);
    expect(parseRecipe(four)).toEqual(converted);
    const long = legacyRecipe({ ...oldLayer(), id: "a".repeat(80) });
    expect(parseRecipe(parseRecipe(long))).toEqual(parseRecipe(long));
  });
});
