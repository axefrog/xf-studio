import { expect, test } from "bun:test";
import { initialRecipe } from "../src/recipe";
import { convertToBezier, tangentEndpoint } from "../src/bezier-path";
import { createUVEditor } from "../src/uv-editor";
import { defaultUVView, fitUVView, parseUVView, reflectUV, uvRegion, uvToPixel } from "../src/uv-view";

test("UV Fit includes all explicit tangents, including outside-atlas and mirrored endpoints", () => {
  const layer = convertToBezier(initialRecipe().layers[0]);
  layer.points[0].handles!.in = { u: -.4, v: -.1 };
  layer.points[0].handles!.out = { u: -.2, v: .15 };
  const before = structuredClone(layer);
  for (const mode of ["both", "single"] as const) for (const side of ["low", "high"] as const) {
    const view = fitUVView({ ...defaultUVView(), mode, side }, layer), region = uvRegion(view);
    for (const point of layer.points) for (const arm of ["in", "out"] as const) for (const mirror of [false, true]) {
      const endpoint = reflectUV(tangentEndpoint(point, arm), mirror);
      if (mode === "single" && (side === "low" ? endpoint.u > .5 : endpoint.u < .5)) continue;
      const pixel = uvToPixel(endpoint, region, 720, mode === "both" ? 310 : 520);
      expect(pixel.x).toBeGreaterThan(0); expect(pixel.x).toBeLessThan(720);
      expect(pixel.y).toBeGreaterThan(0); expect(pixel.y).toBeLessThan(mode === "both" ? 310 : 520);
    }
  }
  expect(layer).toEqual(before);
});

test("UV Fit and persisted bounds expose extreme legal arms on their owner's eye", () => {
  const layer = convertToBezier(initialRecipe().layers[0]);
  layer.points[0].u = 0; layer.points[0].v = 0;
  layer.points[0].handles = { in: { u: -1, v: -1 }, out: { u: 1, v: 1 }, mode: "symmetric" };
  layer.points[1].u = .3; layer.points[1].v = 1;
  layer.points[1].handles = { in: { u: 1, v: 1 }, out: { u: -1, v: -1 }, mode: "symmetric" };
  for (const mode of ["both", "single"] as const) for (const side of ["low", "high"] as const) {
    const view = fitUVView({ ...defaultUVView(), mode, side }, layer);
    expect(parseUVView(JSON.parse(JSON.stringify(view)))).toEqual(view);
    for (const point of layer.points) for (const arm of ["in", "out"] as const) for (const mirror of [false, true]) {
      const owner = reflectUV(point, mirror);
      if (mode === "single" && (side === "low" ? owner.u > .5 : owner.u < .5)) continue;
      const pixel = uvToPixel(reflectUV(tangentEndpoint(point, arm), mirror), uvRegion(view), 720, mode === "both" ? 310 : 520);
      expect(pixel.x).toBeGreaterThan(0); expect(pixel.x).toBeLessThan(720);
      expect(pixel.y).toBeGreaterThan(0); expect(pixel.y).toBeLessThan(mode === "both" ? 310 : 520);
    }
  }
});

test("UV tangent adapter mirrors drags, cancels exactly, guards replaced targets and exposes collapsed handles", () => {
  // Event adapter fixture: no raster, WebGL or browser storage is involved.
  const oldDocument = globalThis.document, oldWindow = globalThis.window, oldObserver = globalThis.ResizeObserver;
  const listeners: Record<string, (event: any) => void> = {};
  const ctx = new Proxy({}, { get: () => () => {} });
  let captured: number | undefined;
  const canvas: any = {
    width: 720, height: 310, getContext: () => ctx,
    addEventListener() {},
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 720, height: 310 }),
    setPointerCapture: (id: number) => { captured = id; }, hasPointerCapture: (id: number) => captured === id,
    releasePointerCapture: () => { captured = undefined; },
  };
  Object.assign(globalThis, {
    document: { createElement: () => ({ getContext: () => ctx }) },
    window: { addEventListener: (kind: string, listener: (event: any) => void) => { listeners[kind] = listener; } },
    ResizeObserver: class { observe() {} },
  });
  try {
    let recipe = initialRecipe(); recipe.layers[0] = convertToBezier(recipe.layers[0]);
    recipe.layers[0].points[0].handles!.mode = "corner";
    let selected = 0, checkpoint = structuredClone(recipe), begins = 0, changes = 0;
    const element = () => ({ setAttribute() {}, disabled: false, textContent: "" }) as any;
    const editor = createUVEditor(canvas, { both: element(), single: element(), other: element(), fit: element(), note: element() }, {
      recipe: () => recipe, layer: () => recipe.layers[0], selected: () => selected,
      canvases: () => [], albedo: () => undefined, select: index => { selected = index; },
      selectedField: () => undefined, selectField() {}, begin: () => { checkpoint = structuredClone(recipe); begins++; },
      change: () => { changes++; }, cancel: () => { recipe = structuredClone(checkpoint); }, persist() {}, message() {},
    }, defaultUVView());
    editor.draw();
    const event = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, pointerId: 7, preventDefault() {} });
    const handle = (side: "in" | "out", mirror: boolean) => editor.diagnostics().handles.find(h => h.kind === "tangent" && h.side === side && h.mirror === mirror)!;
    expect(editor.diagnostics().handles.filter(h => h.kind === "tangent")).toHaveLength(4);
    const original = structuredClone(recipe), target = recipe.layers[0].points[0], h = handle("out", true);
    canvas.onpointerdown(event(h.screen.x, h.screen.y));
    canvas.onpointermove(event(h.screen.x + 15, h.screen.y + 8));
    expect(recipe.layers[0].points[0]).toBe(target);
    expect(target.handles!.out.u).toBeCloseTo(original.layers[0].points[0].handles!.out.u - 15 / 720 * .5, 12);
    expect(target.handles!.out.v).toBeCloseTo(original.layers[0].points[0].handles!.out.v + 8 / 720 * .5, 12);
    expect(target.handles!.in).toEqual(original.layers[0].points[0].handles!.in);
    expect(begins).toBe(1); expect(changes).toBe(1);
    listeners.keydown({ key: "Escape", preventDefault() {}, stopImmediatePropagation() {} });
    expect(recipe).toEqual(original); expect(editor.diagnostics().dragging).toBe(false);

    const point = recipe.layers[0].points[0];
    point.handles!.in = { u: 0, v: 0 }; point.handles!.out = { u: 0, v: 0 };
    const collapsed = handle("out", false), other = handle("in", false);
    expect(collapsed.collapsed).toBe(true);
    expect(collapsed.screen.x - other.screen.x).toBeCloseTo(32, 10);
    const knot = editor.diagnostics().handles.find(h => h.kind === "point" && h.index === 0 && !h.mirror)!;
    canvas.onpointerdown(event(knot.screen.x, knot.screen.y)); canvas.onpointerup(event(knot.screen.x, knot.screen.y));
    expect(begins).toBe(1); // Central knot remains independently selectable.
    canvas.onpointerdown(event(collapsed.screen.x, collapsed.screen.y));
    canvas.onpointermove(event(collapsed.screen.x, collapsed.screen.y));
    expect(begins).toBe(1); // Proxy pickup does not jump to the displayed offset.
    canvas.onpointermove(event(collapsed.screen.x + 20, collapsed.screen.y - 10));
    expect(point.handles!.out.u).toBeCloseTo(20 / 720 * .5, 12);
    expect(point.handles!.out.v).toBeCloseTo(-10 / 720 * .5, 12);
    expect(point.handles!.in).toEqual({ u: 0, v: 0 });
    canvas.onpointercancel(event(0, 0));
    expect(recipe.layers[0].points[0].handles!.out).toEqual({ u: 0, v: 0 });

    const replacementHandle = handle("out", false);
    canvas.onpointerdown(event(replacementHandle.screen.x, replacementHandle.screen.y));
    recipe.layers[0].points[0] = structuredClone(recipe.layers[0].points[0]);
    const replacement = structuredClone(recipe.layers[0].points[0]);
    canvas.onpointermove(event(replacementHandle.screen.x + 25, replacementHandle.screen.y));
    expect(recipe.layers[0].points[0]).toEqual(replacement);
    expect(editor.diagnostics().dragging).toBe(false);
  } finally {
    Object.assign(globalThis, { document: oldDocument, window: oldWindow, ResizeObserver: oldObserver });
  }
});
