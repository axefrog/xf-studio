import { describe, expect, test } from "bun:test";
import { bezierAt, convertToBezier, moveTangent, setPointMode, splitBezierSegment, tangentEndpoint, tessellateBezier, MAX_CURVE_POINTS, BEZIER_TOLERANCE } from "../src/engines/layered-makeup/bezier-path";
import { curve, initialRecipe, parseRecipe, parseRecipeFile, raster, type Layer, type Point } from "../src/engines/layered-makeup/recipe";

const legacy = (): Layer => {
  const l = initialRecipe().layers[0];
  l.pathMode = "catmull-rom";
  l.points = l.points.map(({ handles: _handles, ...p }) => p);
  return l;
};
const compare = (a: Point, b: Point, tolerance = 2e-14) => {
  expect(Math.abs(a.u - b.u)).toBeLessThan(tolerance);
  expect(Math.abs(a.v - b.v)).toBeLessThan(tolerance);
  expect(Math.abs(a.weight - b.weight)).toBeLessThan(tolerance);
};

describe("explicit closed cubic paths", () => {
  test("Catmull conversion preserves each analytic cubic and linear pigment", () => {
    const l = legacy(); l.points.forEach((p, i) => p.weight = i / 6);
    const before = structuredClone(l), b = convertToBezier(l), dense = curve(l.points, 101);
    for (let segment = 0; segment < l.points.length; segment++)
      for (let j = 0; j < 101; j++) compare(bezierAt(b.points, segment, j / 101), dense[segment * 101 + j]);
    expect(l).toEqual(before);
    expect(b.pathMode).toBe("bezier");
    expect(convertToBezier(b)).toEqual(b);
  });

  test("split preserves all cubics including closing section and pigment parameter", () => {
    const b = initialRecipe().layers[0]; b.points.forEach((p, i) => p.weight = i / 6);
    const original = structuredClone(b.points);
    for (let segment = 0; segment < b.points.length; segment++) {
      for (const split of [.00001, .07, .5, .823, .99999]) {
        const next = splitBezierSegment(b.points, segment, split)!;
        expect(next.length).toBe(b.points.length + 1);
        for (let j = 0; j <= 100; j++) {
          const t = j / 100;
          compare(bezierAt(next, segment, t), bezierAt(b.points, segment, split * t));
          compare(bezierAt(next, segment + 1, t), bezierAt(b.points, segment, split + (1 - split) * t));
        }
        for (let i = 0; i < b.points.length; i++) if (i !== segment)
          for (const t of [0, .3, .7, 1]) compare(bezierAt(next, i > segment ? i + 1 : i, t), bezierAt(b.points, i, t));
        const recipe = initialRecipe(); recipe.layers[0].points = next;
        expect(parseRecipe(recipe).layers[0].points).toEqual(next);
      }
    }
    expect(b.points).toEqual(original);
    for (const t of [0, 1, NaN, -1, 1e-8]) expect(splitBezierSegment(b.points, 0, t)).toBeNull();
    const tooMany = Array.from({ length: 24 }, (_, i) => structuredClone(b.points[i % 6]));
    expect(splitBezierSegment(tooMany, 0, .5)).toBeNull();
  });

  test("symmetric, aligned and independent arms have distinct predictable edits", () => {
    const b = initialRecipe().layers[0], p = b.points[0];
    let moved = moveTangent(p, "out", { u: p.u + .02, v: p.v + .01 });
    expect(moved.handles!.in.u).toBeCloseTo(-.02, 15);
    expect(moved.handles!.in.v).toBeCloseTo(-.01, 15);
    const corner = setPointMode(b, 0, "corner").points[0];
    moved = moveTangent(corner, "in", { u: p.u - .04, v: p.v });
    expect(moved.handles!.out).toEqual(corner.handles!.out);
    const changed = structuredClone(b); changed.points[0] = moved;
    const aligned = setPointMode(changed, 0, "aligned").points[0];
    const length = Math.hypot(aligned.handles!.in.u, aligned.handles!.in.v);
    moved = moveTangent(aligned, "out", { u: p.u, v: p.v + .07 });
    expect(Math.hypot(moved.handles!.in.u, moved.handles!.in.v)).toBeCloseTo(length, 14);
    expect(moved.handles!.in.u).toBeCloseTo(0, 14);
    expect(moved.handles!.in.v).toBeLessThan(0);
    expect(moveTangent(aligned, "out", p).handles!.in).toEqual(aligned.handles!.in);
    const huge = moveTangent(p, "in", { u: 100, v: -10 });
    expect(Math.max(Math.abs(huge.handles!.in.u), Math.abs(huge.handles!.in.v))).toBe(1);
    expect(moveTangent(p, "in", {u: NaN, v: 0})).toEqual(p);
    expect(tangentEndpoint({ ...p, u: p.u + .1 }, "in").u).toBeCloseTo(tangentEndpoint(p, "in").u + .1, 14);
  });

  test("near-endpoint corner splits survive strict mode validation without cancellation", () => {
    let seed = 103003;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 500; i++) {
      const r = initialRecipe();
      for (const p of r.layers[0].points) p.handles = {in: {u: (random() - .5) * .2, v: (random() - .5) * .2}, out: {u: (random() - .5) * .2, v: (random() - .5) * .2}, mode: "corner"};
      r.layers[0].points = splitBezierSegment(r.layers[0].points, i % 6, i % 2 ? .00001 : .99999)!;
      expect(parseRecipe(r)).toEqual(r);
    }
  });

  test("adaptive tessellation bounds pointwise error and is independent of legacy steps", () => {
    const b = initialRecipe().layers[0];
    b.points[1].handles = { in: {u: -.8, v: .9}, out: {u: .7, v: -.9}, mode: "corner" };
    const samples = tessellateBezier(b.points);
    expect(samples.length).toBeLessThanOrEqual(MAX_CURVE_POINTS);
    for (let i = 0; i < samples.length; i++) {
      const a = samples[i], end = samples[(i + 1) % samples.length], t1 = end.segment === a.segment ? end.t : 1;
      for (const q of [.1, .3, .5, .7, .9]) {
        const exact = bezierAt(b.points, a.segment, a.t + (t1 - a.t) * q);
        expect(Math.hypot(exact.u - (a.u + (end.u - a.u) * q), exact.v - (a.v + (end.v - a.v) * q))).toBeLessThanOrEqual(BEZIER_TOLERANCE);
      }
    }
    expect(curve(b.points, 6)).toEqual(curve(b.points, 10));
    const reflected = structuredClone(b.points).map(p => ({ ...p, u: 1 - p.u, handles: { ...p.handles!, in: {...p.handles!.in, u: -p.handles!.in.u}, out: {...p.handles!.out, u: -p.handles!.out.u} } }));
    const other = tessellateBezier(reflected);
    expect(other.length).toBe(samples.length);
    samples.forEach((p, i) => { expect(other[i].u).toBeCloseTo(1 - p.u, 13); expect(other[i].v).toBeCloseTo(p.v, 13); });
    const collapsed = b.points.map(() => ({u: .5, v: .5, weight: .3, handles: {in: {u: 0, v: 0}, out: {u: 0, v: 0}, mode: "corner" as const}}));
    expect(curve(collapsed).length).toBe(6);
    expect(curve(collapsed).every(p => Number.isFinite(p.u + p.v + p.weight))).toBe(true);
  });

  test("legacy loading remains exact; new path data is strict and explicit", () => {
    const l = legacy(), v4 = {schema: "xfs/recipe-4", uv: "gltf-uv0-top-left", layers: [structuredClone(l)]} as any;
    delete v4.layers[0].pathMode; delete v4.layers[0].softness;
    v4.layers[0].points.forEach((p:any) => delete p.feather);
    const before = raster(l, 128), loaded = parseRecipe(v4);
    expect(parseRecipeFile(v4).schema).toBe("xfs/recipe-7"); expect(loaded).not.toHaveProperty("schema"); expect(loaded.layers[0].pathMode).toBe("catmull-rom");
    expect(raster(loaded.layers[0], 128)).toEqual(before);
    const recipe = initialRecipe();
    expect(parseRecipe(JSON.parse(JSON.stringify(recipe)))).toEqual(recipe);
    for (const mutate of [
      (r: any) => { r.schema = "xfs/recipe-4"; },
      (r: any) => { r.layers[0].pathMode = "catmull-rom"; },
      (r: any) => { delete r.layers[0].points[0].handles; },
      (r: any) => { r.layers[0].points[0].handles.in.u = 1.1; },
      (r: any) => { r.layers[0].points[0].handles.out.v = NaN; },
      (r: any) => { r.layers[0].points[0].handles.in.u = .5; },
      (r: any) => { r.layers[0].points[0].handles.mode = "auto"; },
    ]) { const r = structuredClone(recipe); mutate(r); expect(() => parseRecipe(r)).toThrow(); }
  });

  test("conversion raster error is quantified rather than assumed byte exact", () => {
    const l = legacy(), b = convertToBezier(l), old = raster(l, 1024), next = raster(b, 1024);
    let maximum = 0, changed = 0, total = 0;
    for (let i = 3; i < old.length; i += 4) { const d = Math.abs(old[i] - next[i]); maximum = Math.max(maximum, d); total += d; if (d) changed++; }
    expect(changed).toBeGreaterThan(0); expect(maximum).toBeLessThanOrEqual(5);
    expect(total / (1024 ** 2)).toBeLessThan(.01);
    console.log("Bezier conversion petal 1024 alpha", {maximum, changed, total, samples: curve(b.points).length});
  });

  test("continuous split introduces at most one alpha byte of tessellation error in petal fixtures", () => {
    for (const varied of [false, true]) {
      const l = initialRecipe().layers[0];
      if (varied) l.points.forEach((p, i) => p.weight = i / 5);
      const split = structuredClone(l); split.points = splitBezierSegment(l.points, 5, .373)!;
      const before = raster(l, 1024), after = raster(split, 1024);
      let maximum = 0, changed = 0;
      for (let i = 3; i < before.length; i += 4) {const d = Math.abs(before[i] - after[i]); maximum = Math.max(maximum, d); if (d) changed++;}
      expect(maximum).toBeLessThanOrEqual(1); expect(changed).toBeLessThanOrEqual(72);
    }
  });
});
