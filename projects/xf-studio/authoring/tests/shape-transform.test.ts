import { describe, expect, test } from "bun:test";
import { coverage, initialRecipe, parseRecipe, warpFields, type Layer } from "../src/engines/layered-makeup/recipe";
import { bezierAt, splitBezierSegment } from "../src/engines/layered-makeup/bezier-path";
import { shapeHit, shapeWheelScaleFactor, transformLayer, wheelScaleFactor, type ShapeTransform } from "../src/engines/layered-makeup/shape-transform";

const sample = (): Layer => {
  const layer = initialRecipe().layers[0];
  layer.fields[0] = {...layer.fields[0], du: .007, dv: -.002};
  layer.fields.push({id: "second", u: .39, v: .24, du: -.002, dv: .003, radius: .023});
  layer.points.forEach((p, i) => p.weight = .4 + i / 10);
  return layer;
};
function map(uv: {u:number;v:number}, c: ShapeTransform) {
  if (c.kind === "translate") return {u: uv.u + c.du, v: uv.v + c.dv};
  const u = uv.u - c.pivot.u, v = uv.v - c.pivot.v;
  if (c.kind === "scale") return {u: c.pivot.u + u * c.factor, v: c.pivot.v + v * c.factor};
  return {u: c.pivot.u + u * Math.cos(c.radians) - v * Math.sin(c.radians), v: c.pivot.v + u * Math.sin(c.radians) + v * Math.cos(c.radians)};
}

describe("whole authored shape transformations", () => {
  test("moves exact cubic geometry, all fields and preserved metadata together", () => {
    const layer = sample(), before = structuredClone(layer);
    const commands: ShapeTransform[] = [
      {kind: "translate", du: .08, dv: .1},
      {kind: "scale", pivot: layer.points[2], factor: 1.4},
      {kind: "rotate", pivot: layer.points[3], radians: .4},
    ];
    for (const command of commands) {
      const next = transformLayer(layer, command)!;
      expect(next).not.toBeNull();
      expect(next.id).toBe(layer.id); expect(next.name).toBe(layer.name);
      expect(next.color).toBe(layer.color); expect(next.finish).toBe(layer.finish);
      expect(next.fields.map(f => f.id)).toEqual(layer.fields.map(f => f.id));
      expect(next.points.map(p => p.handles!.mode)).toEqual(layer.points.map(p => p.handles!.mode));
      for (let segment = 0; segment < layer.points.length; segment++) for (const t of [0, .1, .4, .7, 1]) {
        const expected = map(bezierAt(layer.points, segment, t), command), actual = bezierAt(next.points, segment, t);
        expect(actual.u).toBeCloseTo(expected.u, 13); expect(actual.v).toBeCloseTo(expected.v, 13);
      }
      for (const query of [{u: .35, v: .22}, {u: .42, v: .25}, {u: .3, v: .19}]) {
        const [wu, wv] = warpFields(query.u, query.v, layer.fields), moved = map(query, command), expected = map({u: wu, v: wv}, command);
        const actual = warpFields(moved.u, moved.v, next.fields);
        expect(actual[0]).toBeCloseTo(expected.u, 13); expect(actual[1]).toBeCloseTo(expected.v, 13);
      }
      const factor = command.kind === "scale" ? command.factor : 1;
      expect(next.feather).toBe(layer.feather * factor);
      expect(next.strength).toEqual({mode: "smooth-boundary", blend: .0005 * factor});
      expect(next.fields[0].radius).toBe(layer.fields[0].radius * factor);
      expect(next.fields[1].radius).toBe(layer.fields[1].radius * factor);
      next.points[0].weight = 0; next.fields[0].du = 0;
    }
    expect(layer).toEqual(before);
  });

  test("legacy geometry and strengths retain their modes and covariant coverage", () => {
    for (const strengthMode of ["legacy-nearest", "smooth-boundary"] as const) {
      const layer = sample(); layer.pathMode = "catmull-rom"; layer.symmetry = false;
      layer.points = layer.points.map(({handles: _, ...p}) => p);
      layer.strength = strengthMode === "legacy-nearest" ? {mode: strengthMode} : {mode: strengthMode, blend: .0005};
      for (const c of [
        {kind: "translate", du: .06, dv: .04},
        {kind: "scale", pivot: {u: .37, v: .23}, factor: 1.5},
        {kind: "rotate", pivot: {u: .37, v: .23}, radians: .63},
      ] as ShapeTransform[]) {
        const moved = transformLayer(layer, c)!;
        expect(moved.pathMode).toBe("catmull-rom"); expect(moved.points.every(p => !p.handles)).toBe(true);
        expect(moved.strength.mode).toBe(strengthMode);
        for (const uv of [{u: .34, v: .22}, {u: .405, v: .23}, {u: .3, v: .21}, {u: .38, v: .23}]) {
          const m = map(uv, c);
          expect(coverage(m.u, m.v, moved)).toBeCloseTo(coverage(uv.u, uv.v, layer), 10);
        }
      }
    }
  });

  test("atomic bound rejection never clamps or partially changes a design", () => {
    const layer = sample(), before = structuredClone(layer);
    const commands: ShapeTransform[] = [
      {kind: "translate", du: 1, dv: 0}, {kind: "translate", du: NaN, dv: 0},
      {kind: "scale", pivot: {u: .35, v: .23}, factor: 0},
      {kind: "scale", pivot: {u: .35, v: .23}, factor: -1},
      {kind: "scale", pivot: {u: .35, v: .23}, factor: 1e-200},
      {kind: "scale", pivot: {u: .35, v: .23}, factor: 100},
      {kind: "rotate", pivot: {u: Infinity, v: 0}, radians: 1},
      {kind: "rotate", pivot: {u: .35, v: .23}, radians: NaN},
    ];
    commands.forEach(c => expect(transformLayer(layer, c)).toBeNull());
    expect(layer).toEqual(before);
    const byField = sample(); byField.fields[1].u = .99;
    expect(transformLayer(byField, {kind: "translate", du: .02, dv: 0})).toBeNull();
    const byRadius = sample(); byRadius.fields[1].radius = .2;
    expect(transformLayer(byRadius, {kind: "scale", pivot: byRadius.points[0], factor: 1.01})).toBeNull();
    const byFeather = sample(); byFeather.feather = .06;
    expect(transformLayer(byFeather, {kind: "scale", pivot: byFeather.points[0], factor: 1.01})).toBeNull();
    const byBlend = sample(); byBlend.strength = {mode: "smooth-boundary", blend: .02};
    expect(transformLayer(byBlend, {kind: "scale", pivot: byBlend.points[0], factor: 1.01})).toBeNull();
    const badSource = sample(); badSource.points[0].weight = 2;
    expect(transformLayer(badSource, {kind: "translate", du: 0, dv: 0})).toBeNull();
  });

  test("no-ops clone exactly and tiny split arms retain valid relationships", () => {
    const layer = sample(); layer.points = splitBezierSegment(layer.points, 2, .00001)!;
    for (const c of [
      {kind: "translate", du: 0, dv: 0},
      {kind: "scale", pivot: {u: 1e200, v: -1e200}, factor: 1},
      {kind: "rotate", pivot: {u: 1e200, v: -1e200}, radians: 0},
    ] as ShapeTransform[]) {const result = transformLayer(layer, c); expect(result).toEqual(layer); expect(result).not.toBe(layer);}
    for (const radians of [.0000001, .3, -.7, Math.PI]) {
      const result = transformLayer(layer, {kind: "rotate", pivot: {u: .37, v: .23}, radians})!;
      expect(result).not.toBeNull();
      expect(parseRecipe({schema: "xfs/recipe-6", uv: "gltf-uv0-top-left", layers: [result]}).layers[0]).toEqual(result);
    }
  });

  test("painted footprint picking selects the strongest mirrored instance", () => {
    const layer = initialRecipe().layers[0]; layer.opacity = 1;
    expect(shapeHit(layer, {u: .36, v: .22})).toEqual({mirror: false});
    expect(shapeHit(layer, {u: .64, v: .22})).toEqual({mirror: true});
    expect(shapeHit(layer, {u: .1, v: .8})).toBeNull();
    layer.symmetry = false;
    expect(shapeHit(layer, {u: .64, v: .22})).toBeNull();
    layer.symmetry = true; layer.enabled = false;
    expect(shapeHit(layer, {u: .36, v: .22})).toBeNull();
    layer.enabled = true; layer.opacity = .005;
    expect(shapeHit(layer, {u: .36, v: .22})).toBeNull();
    layer.opacity = 1;
    const overlapping = transformLayer(layer, {kind: "translate", du: .13, dv: 0})!;
    expect(shapeHit(overlapping, {u: .5, v: .22})).toEqual({mirror: false});
    expect(shapeHit(layer, {u: NaN, v: .22})).toBeNull();
    // Large displacement makes source hull picking incorrect; shared evaluator
    // moves the visible footprint, and the hit follows that actual coverage.
    layer.fields[0].du = .09; layer.fields[0].radius = .2;
    expect(shapeHit(layer, {u: .35, v: .22})).toBeNull();
    expect(shapeHit(layer, {u: .43, v: .22})).toEqual({mirror: false});
  });

  test("wheel units agree, direction is natural, and event bursts are bounded", () => {
    expect(wheelScaleFactor(0)).toBe(1);
    expect(wheelScaleFactor(-10)).toBeGreaterThan(1); expect(wheelScaleFactor(10)).toBeLessThan(1);
    expect(wheelScaleFactor(16)).toBe(wheelScaleFactor(1, 1));
    expect(wheelScaleFactor(80)).toBe(wheelScaleFactor(.1, 2));
    expect(wheelScaleFactor(1e200)).toBeCloseTo(.8, 15); expect(wheelScaleFactor(-1e200)).toBe(1.25);
    for (const delta of [NaN, Infinity, -Infinity]) expect(wheelScaleFactor(delta)).toBe(1);
    expect(wheelScaleFactor(100, 3)).toBe(1);
    expect(wheelScaleFactor(10) * wheelScaleFactor(-10)).toBeCloseTo(1, 14);
  });

  test("shape wheel uses fine notches and proportional trackpad deltas without changing view zoom", () => {
    const notch = shapeWheelScaleFactor(-120);
    expect(notch).toBeCloseTo(1.02, 14);
    expect(shapeWheelScaleFactor(-3, 1)).toBeCloseTo(notch, 14);
    expect(shapeWheelScaleFactor(-1, 2)).toBeCloseTo(notch, 14);
    expect(shapeWheelScaleFactor(-30) ** 4).toBeCloseTo(notch, 14);
    expect(shapeWheelScaleFactor(120) * notch).toBeCloseTo(1, 14);
    expect(shapeWheelScaleFactor(-10000)).toBeLessThan(1.051);
    expect(shapeWheelScaleFactor(10000)).toBeGreaterThan(1 / 1.051);
    expect(wheelScaleFactor(-120)).toBe(1.25);
    for (const delta of [NaN, Infinity, -Infinity]) expect(shapeWheelScaleFactor(delta)).toBe(1);
    expect(shapeWheelScaleFactor(120, 3)).toBe(1);
  });
});
