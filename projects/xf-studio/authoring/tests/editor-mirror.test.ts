import { expect, test } from "bun:test";
import { createUVEditor } from "../src/uv-editor";
import { defaultUVView, fitUVView, reflectUV, selectionVisibility } from "../src/uv-view";
import { flakeCatalogue, mirrorCatalogue, MM_PER_UV } from "../src/glitter-route";
import type { Mirror } from "../src/engines/layered-makeup/region";
import { initialRecipe, EYE_REGION, EYE_MIRROR } from "./fixtures/eye-region";
import { applyAdapterProposal } from "./gesture-test-adapter";

// CORE-82: eye makeup's editors and the diagnostic Glitter route follow the region's mirror, as the engine, raster, worker, hit
// tests and compiler do; nothing assumes u = ½. Eye makeup's own mirror (u = ½) gives exactly what it gave before.

const AT_U = { axis: "u", centre: .4 } as const satisfies Mirror, AT_V = { axis: "v", centre: .3 } as const satisfies Mirror;

test("a symmetric layer's mirrored instance is across the region's mirror line, u or v", () => {
  const p = { u: .3, v: .25 };
  expect(reflectUV(p, true, EYE_MIRROR)).toEqual({ u: 1 - .3, v: .25 });
  expect(reflectUV(p, true, AT_U)).toEqual({ u: .8 - .3, v: .25 });
  expect(reflectUV(p, true, AT_V)).toEqual({ u: .3, v: .6 - .25 });
  expect(reflectUV(p, false, AT_V)).toBe(p);
});

test("UV Fit's single side and the selection check use the region's mirror line", () => {
  const layer = { ...initialRecipe().layers[0]!, symmetry: true };
  const low = fitUVView({ ...defaultUVView(), mode: "single", side: "low" }, layer, AT_V);
  const high = fitUVView({ ...defaultUVView(), mode: "single", side: "high" }, layer, AT_V);
  // Across a v line, the low side holds what lies above v = 0.3 and the high side its mirror below it.
  expect(low.v).toBeLessThan(.3);
  expect(high.v).toBeGreaterThan(.3);
  // The mirrored instance counts as visible where the region's mirror puts it, not across u = ½.
  const point = { u: .1, v: .1 }, only = { symmetry: true, points: [point], fields: [] };
  const around = (u: number, v: number) => ({ u: u - .05, v: v - .05, w: .1, h: .1 });
  expect(selectionVisibility(defaultUVView(), around(.1, .5), only, 0, undefined, AT_V).point?.visible).toBe(true);
  expect(selectionVisibility(defaultUVView(), around(.9, .1), only, 0, undefined, AT_V).point?.visible).toBe(false);
  expect(selectionVisibility(defaultUVView(), around(.9, .1), only, 0, undefined, EYE_MIRROR).point?.visible).toBe(true);
});

test("the UV editor draws, picks and drags a mirrored handle across the region's mirror line", () => {
  const oldDocument = globalThis.document, oldWindow = globalThis.window, oldObserver = globalThis.ResizeObserver;
  const ctx = new Proxy({}, { get: () => () => {} });
  let captured: number | undefined;
  const canvas: any = { width: 720, height: 310, getContext: () => ctx, addEventListener() {},
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 720, height: 310 }),
    setPointerCapture: (id: number) => { captured = id; }, hasPointerCapture: (id: number) => captured === id,
    releasePointerCapture: () => { captured = undefined; } };
  Object.assign(globalThis, { document: { createElement: () => ({ getContext: () => ctx }) },
    window: { addEventListener() {} }, ResizeObserver: class { observe() {} } });
  try {
    const recipe = initialRecipe();
    recipe.layers[0]!.symmetry = true;
    const element = () => ({ setAttribute() {}, disabled: false, textContent: "" }) as any;
    const editor = createUVEditor(canvas, { both: element(), single: element(), other: element(), fit: element(), note: element() }, {
      region: { ...EYE_REGION, mirror: AT_U },
      recipe: () => recipe, layer: () => recipe.layers[0]!, selected: () => 0, canvases: () => [], albedo: () => undefined, select() {},
      selectedField: () => undefined, selectField() {}, begin() {}, apply: action => applyAdapterProposal(recipe.layers[0]!, action),
      cancel() {}, persist() {}, message() {} }, defaultUVView());
    editor.draw();
    const knot = recipe.layers[0]!.points[0]!, original = { u: knot.u, v: knot.v };
    const mirrored = editor.diagnostics().handles.find(h => h.kind === "point" && h.index === 0 && h.mirror)!;
    expect(mirrored.uv.u).toBeCloseTo(.8 - original.u, 12);
    expect(mirrored.uv.v).toBeCloseTo(original.v, 12);
    // Dragging the mirrored knot right moves the authored knot left, about the region's line.
    const event = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, pointerId: 3, preventDefault() {} });
    canvas.onpointerdown(event(mirrored.screen.x, mirrored.screen.y));
    canvas.onpointermove(event(mirrored.screen.x + 12, mirrored.screen.y));
    canvas.onpointerup(event(mirrored.screen.x + 12, mirrored.screen.y));
    expect(knot.u).toBeLessThan(original.u);
    expect(knot.v).toBeCloseTo(original.v, 12);
  } finally {
    Object.assign(globalThis, { document: oldDocument, window: oldWindow, ResizeObserver: oldObserver });
  }
});

test("the Glitter route mirrors a catalogue across a u line or a v line", () => {
  const window = { u0: .2, v0: .1, u1: .8, v1: .4 }, rect = { u0: .25, v0: .15, u1: .35, v1: .25 };
  const flakes = { cover: .2, sizeMm: .2, sizeSigma: .2, tiltSigmaDeg: 20, tiltMaxDeg: 50, roughness: .3, seed: 7 } as Parameters<typeof flakeCatalogue>[2];
  const c = flakeCatalogue(rect, window, flakes);
  const uOf = (x: number) => window.u0 + x / MM_PER_UV.u, vOf = (y: number) => window.v0 + y / MM_PER_UV.v;
  const u = mirrorCatalogue(c, window, AT_U);
  expect(uOf(u.cx[0]!)).toBeCloseTo(.8 - uOf(c.cx[0]!), 12);
  expect([u.cy[0], u.ny[0], u.nx[0], u.rot[0]]).toEqual([c.cy[0], c.ny[0], -c.nx[0]!, -c.rot[0]!]);
  const v = mirrorCatalogue(c, window, AT_V);
  expect(vOf(v.cy[0]!)).toBeCloseTo(.6 - vOf(c.cy[0]!), 12);
  expect([v.cx[0], v.nx[0], v.ny[0], v.rot[0]]).toEqual([c.cx[0], c.nx[0], -c.ny[0]!, -c.rot[0]!]);
  expect(v.key).toEqual(c.key);
});
