import { expect, test } from "bun:test";
import * as THREE from "three";
import { initialRecipe, type Layer, type Recipe } from "../src/engines/layered-makeup/recipe";
import { createSurfaceEditor } from "../src/surface-editor";
import { createUVEditor } from "../src/uv-editor";
import { defaultUVView, uvRegion, uvToPixel } from "../src/uv-view";
import { ViewportAttachment, type ViewportAttachmentPort } from "../src/viewport-attachment";
import type { EditorInputState } from "../src/input-bindings";
import { applyAdapterProposal } from "./gesture-test-adapter";

/**
 * The gesture adapters resolve every input through the binding catalogue (B-17 option b) and
 * report hover/gesture state for hints and cursors. Geometry fixtures follow the shape-gesture tests.
 */
function surfaceFixture(options: { lazy?: boolean } = {}) {
  class Canvas extends EventTarget {
    style = { cursor: "" };
    captures = new Set<number>();
    getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 1000 }; }
    setPointerCapture(id: number) { this.captures.add(id); }
    hasPointerCapture(id: number) { return this.captures.has(id); }
    releasePointerCapture(id: number) { this.captures.delete(id); }
  }
  const fakeWindow = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  const canvas = new Canvas(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, .01, 10);
  camera.position.z = 2; camera.updateMatrixWorld();
  const mesh = () => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    return Object.assign(m, { computeBoundingSphere: () => m.geometry.computeBoundingSphere() });
  };
  const plate = mesh(), head = mesh(), eyes = mesh();
  head.position.z = -.02; eyes.position.x = 5;
  scene.add(plate, head, eyes); scene.updateMatrixWorld(true);
  // `document` is the authored layer; `view` mimics AuthoringGeometry's detached view, which is
  // synced in place only when read again (the lazy case), preserving its identity.
  const document = initialRecipe().layers[0];
  document.pathMode = "bezier";
  document.points = [[.2, .3], [.4, .3], [.4, .5], [.2, .5]].map(([u, v]) => ({ u, v, weight: 1,
    handles: { in: { u: 0, v: 0 }, out: { u: 0, v: 0 }, mode: "corner" as const } }));
  document.fields = []; document.symmetry = false;
  const view: Layer = structuredClone(document);
  const read = () => { if (options.lazy) Object.assign(view, structuredClone(document)); return options.lazy ? view : document; };
  let selected = 0, frame = () => {};
  const controls = { enabled: true }, reports: EditorInputState[] = [], camera_ = { events: 0 };
  let checkpoints = 0;
  const viewer = { renderer: { domElement: canvas }, scene, camera, plate, head, eyes, controls, onFrame: (fn: () => void) => { frame = fn; } };
  const editor = createSurfaceEditor(viewer as unknown as Parameters<typeof createSurfaceEditor>[0], {
    layer: read, selected: () => selected, select: i => { selected = i; }, selectedField: () => undefined, selectField: () => {},
    begin: () => { checkpoints++; }, apply: action => applyAdapterProposal(document, action), cancel: () => {}, message: () => {},
    input: state => reports.push(state),
  });
  // Orbit controls listen in the bubble phase; anything the adapter consumes never reaches them.
  for (const type of ["pointerdown", "wheel"]) canvas.addEventListener(type, () => camera_.events++);
  const emit = (type: string, u: number, v: number, extra: Record<string, unknown> = {}) => {
    const world = new THREE.Vector3(u - .5, v - .5, 0).project(camera), e = new Event(type, { cancelable: true });
    Object.assign(e, { clientX: (world.x + 1) * 500, clientY: (1 - world.y) * 500, pointerId: 1, button: 0, ...extra });
    canvas.dispatchEvent(e); return e;
  };
  frame();
  return { editor, emit, reports, camera: camera_, document, controls, get checkpoints() { return checkpoints; }, frame: () => frame(), fakeWindow };
}

test("head: Shift off makeup is consumed (no camera pan or zoom); camera modifiers pass through; hover is reported", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    const f = surfaceFixture();
    f.emit("pointermove", .3, .4);
    expect(f.reports.at(-1)).toEqual({ target: "shape", editable: true });
    f.emit("pointermove", .8, .8);
    expect(f.reports.at(-1)).toEqual({ target: "empty", editable: true });
    // Shift-drag off makeup: consumed, no gesture, nothing reaches the orbit controls.
    const down = f.emit("pointerdown", .8, .8, { shiftKey: true });
    expect(down.defaultPrevented).toBe(true);
    expect(f.editor.diagnostics().gesture).toBeNull();
    expect(f.camera.events).toBe(0);
    expect(f.emit("wheel", .8, .8, { shiftKey: true, deltaY: -120, deltaMode: 0 }).defaultPrevented).toBe(true);
    expect(f.camera.events).toBe(0);
    // Ctrl-drag pans and Alt-drag orbits: both left to the orbit controls, even over makeup.
    f.emit("pointerdown", .3, .4, { ctrlKey: true }); expect(f.camera.events).toBe(1);
    f.emit("pointerdown", .3, .4, { altKey: true }); expect(f.camera.events).toBe(2);
    f.emit("pointerdown", .8, .8); expect(f.camera.events).toBe(3);
    // An unbound combination does nothing at all.
    f.emit("pointerdown", .3, .4, { ctrlKey: true, shiftKey: true }); expect(f.camera.events).toBe(3);
    expect(f.editor.diagnostics().gesture).toBeNull();
    // Plain wheel zooms (passes through); Shift-wheel over makeup scales.
    f.emit("wheel", .3, .4, { deltaY: -120, deltaMode: 0 }); expect(f.camera.events).toBe(4);
    f.emit("wheel", .3, .4, { shiftKey: true, deltaY: -120, deltaMode: 0 });
    expect(f.editor.diagnostics().gesture).toBe("scale");
    expect(f.reports.at(-1)?.gesture).toBe("scale");
    expect(f.camera.events).toBe(4);
    f.editor.cancelInput();
    expect(f.reports.at(-1)?.gesture).toBeUndefined();
  } finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
});

test("head: Chromium's horizontal Shift-wheel still scales, and a burst continues after the shape leaves the pointer", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    const f = surfaceFixture();
    const width = f.document.points[1].u - f.document.points[0].u;
    f.emit("wheel", .3, .4, { shiftKey: true, deltaX: -120, deltaY: 0, deltaMode: 0 });
    expect(f.document.points[1].u - f.document.points[0].u).toBeCloseTo(width * 1.02, 10);
    // Scaling about point 0 shrinks the shape away from this pointer; the open burst keeps going.
    for (let i = 0; i < 40; i++) f.emit("wheel", .38, .48, { shiftKey: true, deltaY: 120, deltaMode: 0 });
    expect(f.checkpoints).toBe(1);
    expect(f.document.points[1].u - f.document.points[0].u).toBeLessThan(width * .6);
    f.editor.cancelInput();
  } finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
});

test("head: a shape drag keeps going when the detached geometry view syncs lazily (live Studio regression)", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    const f = surfaceFixture({ lazy: true });
    f.emit("pointerdown", .3, .4);
    expect(f.editor.diagnostics().gesture).toBe("translate");
    f.emit("pointermove", .31, .4); f.frame();
    f.emit("pointermove", .32, .4); f.frame();
    f.emit("pointermove", .33, .4);
    expect(f.editor.diagnostics().gesture).toBe("translate");
    expect(f.document.points[0].u).toBeCloseTo(.23, 8);
    f.emit("pointerup", .33, .4);
    expect(f.checkpoints).toBe(1);
    expect(f.reports.at(-1)).toMatchObject({ target: "shape" });
  } finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
});

test("UV: Ctrl-drag pans, Shift off makeup does nothing, Shift-double-click never inserts, and hover is reported", async () => {
  const previous = { document: globalThis.document, window: globalThis.window, ResizeObserver: globalThis.ResizeObserver };
  const listeners: Record<string, (event: any) => void> = {}, canvasListeners: Record<string, (event: any) => void> = {};
  const context = new Proxy({}, { get: () => () => {} });
  let captured: number | undefined;
  const canvas: any = { width: 720, height: 310, getContext: () => context,
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 720, height: 310 }),
    setPointerCapture: (id: number) => { captured = id; }, hasPointerCapture: (id: number) => id === captured,
    releasePointerCapture: () => { captured = undefined; }, addEventListener: (kind: string, fn: (e: any) => void) => { canvasListeners[kind] = fn; } };
  Object.assign(globalThis, { document: { createElement: () => ({ getContext: () => context }) },
    window: { addEventListener: (kind: string, fn: (e: any) => void) => { listeners[kind] = fn; } }, ResizeObserver: class { observe() {} } });
  try {
    const recipe: Recipe = initialRecipe();
    recipe.layers[0].pathMode = "bezier";
    recipe.layers[0].points = [[.3, .2], [.45, .2], [.45, .35], [.3, .35]].map(([u, v]) => ({ u, v, weight: 1,
      handles: { in: { u: 0, v: 0 }, out: { u: 0, v: 0 }, mode: "corner" as const } }));
    recipe.layers[0].fields = []; recipe.layers[0].symmetry = false;
    const reports: EditorInputState[] = [];
    let begins = 0;
    const editor = createUVEditor(canvas, undefined, {
      recipe: () => recipe, layer: () => recipe.layers[0], selected: () => 0, canvases: () => [], albedo: () => undefined,
      select() {}, selectedField: () => undefined, selectField() {}, begin: () => { begins++; },
      apply: action => applyAdapterProposal(recipe.layers[0], action), cancel() {}, persist() {}, message() {},
      input: state => reports.push(state),
    }, defaultUVView());
    expect(reports.at(-1)).toEqual({ editable: true });
    const screen = (u: number, v: number) => { const p = uvToPixel({ u, v }, uvRegion(editor.snapshot()), 720, 310); return { x: p.x + 10, y: p.y + 20 }; };
    const event = (at: { x: number; y: number }, extra: Record<string, unknown> = {}) => ({ clientX: at.x, clientY: at.y, pointerId: 3, button: 0,
      defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra });
    const inside = screen(.38, .28), outside = screen(.9, .9);
    canvas.onpointermove(event(inside)); expect(reports.at(-1)).toEqual({ target: "shape", editable: true });
    canvas.onpointermove(event(outside)); expect(reports.at(-1)).toEqual({ target: "empty", editable: true });
    // Shift-wheel off makeup neither zooms the view nor scales the shape.
    const view = editor.snapshot(), points = structuredClone(recipe.layers[0].points);
    const wheel = event(outside, { shiftKey: true, deltaY: -120, deltaMode: 0 }); canvasListeners.wheel(wheel);
    expect(wheel.defaultPrevented).toBe(true); expect(editor.snapshot()).toEqual(view); expect(recipe.layers[0].points).toEqual(points);
    // Shift-drag off makeup does nothing.
    canvas.onpointerdown(event(outside, { shiftKey: true })); expect(editor.diagnostics().gesture).toBeNull();
    // Ctrl-drag pans the view (a view change, never an edit), even over a shape.
    canvas.onpointerdown(event(inside, { ctrlKey: true })); expect(editor.diagnostics().gesture).toBe("pan");
    expect(reports.at(-1)?.gesture).toBe("pan");
    canvas.onpointermove(event({ x: inside.x + 40, y: inside.y }, { ctrlKey: true }));
    canvas.onpointerup(event({ x: inside.x + 40, y: inside.y }));
    expect(editor.snapshot().u).not.toBe(view.u); expect(begins).toBe(0); expect(recipe.layers[0].points).toEqual(points);
    expect(reports.at(-1)?.gesture).toBeUndefined();
    // Shift-double-click is not an insert.
    canvas.ondblclick(event(screen(.375, .2), { shiftKey: true })); expect(recipe.layers[0].points.length).toBe(4);
    canvas.ondblclick(event(screen(.375, .2))); expect(recipe.layers[0].points.length).toBe(5);
    listeners.blur?.({});
  } finally { Object.assign(globalThis, previous); }
});

test("viewport attachment publishes deduplicated input reports and modifier resets on its own channel", () => {
  const port = { moveHost() {}, measure: () => ({ width: 1, height: 1 }), resize() {}, cancelInput() {}, inputCapture: () => false,
    headView: () => undefined, uvView: () => undefined, uvCommand: () => false, hitAt: () => undefined, queryContext: () => { throw Error(); } } as unknown as ViewportAttachmentPort<unknown>;
  const attachment = new ViewportAttachment(port);
  let input = 0, general = 0;
  attachment.subscribeInput(() => input++); attachment.subscribe(() => general++);
  attachment.reportInput("head", { target: "shape", editable: true });
  attachment.reportInput("head", { target: "shape", editable: true });
  attachment.reportModifiers({ ctrl: false, alt: false, shift: true });
  attachment.reportModifiers({ ctrl: false, alt: false, shift: true });
  expect(input).toBe(2); expect(general).toBe(0);
  const snapshot = attachment.input();
  expect(snapshot).toEqual({ modifiers: { ctrl: false, alt: false, shift: true }, head: { target: "shape", editable: true }, uv: { editable: false } });
  (snapshot.head as { target?: string }).target = "point";
  expect(attachment.input().head.target).toBe("shape");
  attachment.reportModifiers({ ctrl: false, alt: false, shift: false });
  expect(attachment.input().modifiers.shift).toBe(false);
});
