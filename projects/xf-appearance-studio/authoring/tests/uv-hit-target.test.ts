import { expect, test } from "bun:test";
import { createUVEditor } from "../src/uv-editor";
import { initialRecipe } from "../src/recipe";
import { defaultUVView, uvRegion, uvToPixel } from "../src/uv-view";

test("UV hit discovery uses drag handle priority and canonical mirrored identities without editing", () => {
  const originalGlobals = Object.fromEntries(["document", "window", "ResizeObserver"].map(name =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)])) as Record<string, PropertyDescriptor | undefined>;
  const ctx = new Proxy({}, { get: () => () => {} });
  const canvas: any = { width: 720, height: 310, style: {}, clientLeft: 0, clientTop: 0,
    getContext: () => ctx, addEventListener() {},
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 720, height: 310 }),
  };
  Object.assign(globalThis, {
    document: { createElement: () => ({ getContext: () => ctx }) },
    window: { addEventListener() {}, devicePixelRatio: 1 },
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  try {
    const recipe = initialRecipe(), layer = recipe.layers[0];
    layer.pathMode = "bezier";
    layer.points[0].handles = { in: { u: -.01, v: 0 },
      out: { u: layer.points[1].u - layer.points[0].u, v: layer.points[1].v - layer.points[0].v }, mode: "corner" };
    layer.fields[0].du = .02;
    const before = structuredClone(recipe);
    let selected = 0, selections = 0, begins = 0;
    const element = () => ({ setAttribute() {}, disabled: false, textContent: "" }) as any;
    const editor = createUVEditor(canvas, { both: element(), single: element(), other: element(),
      fit: element(), note: element() }, {
      recipe: () => recipe, layer: () => layer, selected: () => selected,
      selectedField: () => layer.fields[0].id,
      select: i => { selected = i; selections++; }, selectField: () => { selections++; },
      canvases: () => [], albedo: () => undefined,
      begin: () => { begins++; }, apply: () => false, cancel() {}, persist() {}, message() {},
    }, defaultUVView());
    editor.draw();
    const handle = (kind: string, index: number, mirror = false) =>
      editor.diagnostics().handles.find(h => h.kind === kind && h.index === index && h.mirror === mirror)!;
    const mirrored = handle("point", 2, true).screen;
    expect(editor.hitAt(mirrored.x, mirrored.y)).toMatchObject({
      hit: { kind: "point", layerId: layer.id, index: 2 }, mirror: true, affordance: "point" });
    const overlap = handle("point", 1).screen;
    expect(editor.hitAt(overlap.x, overlap.y)).toMatchObject({
      hit: { kind: "tangent", layerId: layer.id, index: 0, side: "outgoing" }, affordance: "tangent" });
    const origin = handle("origin", 0).screen;
    expect(editor.hitAt(origin.x, origin.y)).toMatchObject({
      hit: { kind: "field", layerId: layer.id, id: layer.fields[0].id }, affordance: "warp-origin" });
    const inside = uvToPixel({ u: .4, v: .23 }, uvRegion(defaultUVView()), 720, 310);
    expect(editor.hitAt(inside.x + 10, inside.y + 20)).toMatchObject({
      hit: { kind: "shape", layerId: layer.id }, affordance: "shape" });
    expect(editor.hitAt(12, 22)).toEqual({ hit: { kind: "uv-empty" }, affordance: "empty" });
    expect(editor.hitAt(9, 22)).toBeUndefined();
    expect(selected).toBe(0); expect(selections).toBe(0); expect(begins).toBe(0);
    expect(recipe).toEqual(before);
    editor.dispose();
  } finally {
    for (const [name, descriptor] of Object.entries(originalGlobals)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
