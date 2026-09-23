import { describe, expect, test } from "bun:test";
import { insertPathPoint, nearestPathSection } from "../src/path-edit";
import { curve, type Point } from "../src/recipe";

const square = (): Point[] => [
  { u: .3, v: .3, weight: 0 }, { u: .7, v: .3, weight: .4 },
  { u: .7, v: .7, weight: 1 }, { u: .3, v: .7, weight: .6 },
];
const pixels = { u: 1000, v: 1000 };

describe("nearest displayed path insertion", () => {
  test("selects curved sections, including the closing section, with their strength", () => {
    const points = square();
    // Catmull–Rom's midpoint bows outside the straight square edges.
    for (const [segment, u, v, weight] of [
      [0, .5, .25, .2], [1, .75, .5, .7],
      [2, .5, .75, .8], [3, .25, .5, .3],
    ]) {
      const found = nearestPathSection(points, { u, v }, pixels)!;
      expect(found.segment).toBe(segment);
      expect(found.index).toBe(segment + 1);
      expect(found.t).toBeCloseTo(.5, 12);
      expect(found.weight).toBeCloseTo(weight, 12);
      expect(found.distancePx).toBeLessThan(1e-10);
    }
    const closing = insertPathPoint(points, { u: .24, v: .5 }, pixels)!;
    expect(closing.index).toBe(4);
    expect(closing.points[4]).toEqual({ u: .24, v: .5, weight: closing.weight });
    expect(closing.points.slice(0, 4)).toEqual(points);
  });

  test("inserts the click rather than snapping to the curve, preserving input", () => {
    const points = square();
    const before = structuredClone(points);
    Object.freeze(points);
    points.forEach(Object.freeze);
    const result = insertPathPoint(points, { u: .5, v: .2 }, pixels)!;
    expect(result.index).toBe(1);
    expect(result.point.u).toBe(.5);
    expect(result.point.v).toBe(.2);
    expect(result.nearest.v).toBeCloseTo(.25, 12);
    expect(result.distancePx).toBeCloseTo(50, 10);
    expect(result.points.filter((_, i) => i !== result.index)).toEqual(before);
    expect(points).toEqual(before);
    result.points[0].weight = .9;
    expect(points[0].weight).toBe(0);
    expect(insertPathPoint(square(), { u: -1, v: .5 }, pixels)!.point.u).toBe(0);
  });

  test("uses displayed pixel distances for an asymmetric pane", () => {
    const click = { u: .5, v: .51 };
    expect(nearestPathSection(square(), click, { u: 100, v: 1000 })!.segment).toBe(1);
    expect(nearestPathSection(square(), click, { u: 1000, v: 100 })!.segment).toBe(2);
    // Uniform display scaling changes distances, not path selection/parameter.
    const a = nearestPathSection(square(), { u: .56, v: .32 }, { u: 100, v: 320 })!;
    const b = nearestPathSection(square(), { u: .56, v: .32 }, { u: 250, v: 800 })!;
    expect(b.segment).toBe(a.segment);
    expect(b.t).toBeCloseTo(a.t, 12);
    expect(b.distancePx).toBeCloseTo(a.distancePx * 2.5, 10);
  });

  test("maps every displayed edge back to its original section", () => {
    const points = [
      { u: .2, v: .2, weight: .1 }, { u: .6, v: .1, weight: .3 },
      { u: .8, v: .6, weight: .7 }, { u: .3, v: .8, weight: .9 },
    ];
    const path = curve(points);
    for (let i = 0; i < path.length; i++) {
      const a = path[i], b = path[(i + 1) % path.length];
      const click = { u: a.u * .7 + b.u * .3, v: a.v * .7 + b.v * .3 };
      const found = nearestPathSection(points, click, { u: 1250, v: 340 })!;
      expect(found.segment).toBe(Math.floor(i / 10));
      expect(found.t).toBeCloseTo((i % 10 + .3) / 10, 12);
      expect(found.weight).toBeCloseTo(a.weight * .7 + b.weight * .3, 12);
      expect(found.distancePx).toBeLessThan(1e-10);
    }
  });

  test("duplicate knots and exact ties give deterministic finite results", () => {
    const duplicate = Array.from({ length: 3 }, () => ({ u: .5, v: .5, weight: .2 }));
    const result = insertPathPoint(duplicate, { u: .6, v: .7 }, pixels)!;
    expect(result.segment).toBe(0);
    expect(result.index).toBe(1);
    expect(result.t).toBe(0);
    expect(result.weight).toBe(.2);
    expect(result.distancePx).toBeCloseTo(Math.hypot(100, 200), 10);
    const first = nearestPathSection(square(), { u: .3, v: .3 }, pixels)!;
    expect(first.segment).toBe(0);
    expect(first.t).toBe(0);
    // The exact center is equidistant from all four symmetric sections.
    expect(nearestPathSection(square(), { u: .5, v: .5 }, pixels)!.segment).toBe(0);
  });

  test("24-point budget and invalid inputs remain no-ops", () => {
    const points = Array.from({ length: 23 }, (_, i) => ({
      u: .5 + .2 * Math.cos(i * Math.PI * 2 / 23),
      v: .5 + .2 * Math.sin(i * Math.PI * 2 / 23), weight: .5,
    }));
    const last = insertPathPoint(points, { u: .7, v: .5 }, pixels)!;
    expect(last.points.length).toBe(24);
    expect(nearestPathSection(last.points, { u: .7, v: .5 }, pixels)).not.toBeNull();
    expect(insertPathPoint(last.points, { u: .7, v: .5 }, pixels)).toBeNull();
    expect(insertPathPoint([], { u: .5, v: .5 }, pixels)).toBeNull();
    expect(insertPathPoint(square(), { u: NaN, v: .5 }, pixels)).toBeNull();
    expect(insertPathPoint(square(), { u: .5, v: .5 }, { u: 0, v: 1 })).toBeNull();
    expect(insertPathPoint(square(), { u: .5, v: .5 }, { u: 1, v: Infinity })).toBeNull();
    const invalid = square(); invalid[1].weight = NaN;
    expect(insertPathPoint(invalid, { u: .5, v: .5 }, pixels)).toBeNull();
  });
});
