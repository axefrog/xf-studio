import { expect, test } from "bun:test";
import * as THREE from "three";
import { initialRecipe, type Layer } from "../src/recipe";
import { createSurfaceEditor } from "../src/surface-editor";
import { createUVEditor } from "../src/uv-editor";
import { defaultUVView, uvRegion, uvToPixel } from "../src/uv-view";
import type { ViewportHit } from "../src/viewport-attachment";

/** A closed square with zero Bézier arms and no warps, so shape coverage is the square itself. */
const square = (layer: Layer, u: number, v: number, size = .2) => {
  layer.pathMode = "bezier"; layer.fields = []; layer.symmetry = false; layer.enabled = true;
  layer.points = [[u, v], [u + size, v], [u + size, v + size], [u, v + size]].map(([pu, pv]) => ({ u: pu, v: pv, weight: 1,
    handles: { in: { u: 0, v: 0 }, out: { u: 0, v: 0 }, mode: "corner" as const } }));
  return layer;
};

/**
 * Real rays against stand-in geometry: a unit plate (UV 0–1) on a slightly larger head, eyes out
 * of view. Classification order: selected-layer control, painted makeup (selected first, then the
 * frontmost other visible layer), bare head (`head`), and no hit at all for background.
 */
test("head-view context hits: controls, makeup of any visible layer, head, then background", () => {
  class Canvas extends EventTarget {
    style = { cursor: "" };
    getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 1000 }; }
    setPointerCapture() {} hasPointerCapture() { return false; } releasePointerCapture() {}
  }
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  try {
    const canvas = new Canvas(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, .01, 10);
    camera.position.z = 2; camera.updateMatrixWorld();
    const mesh = (size: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial());
      return Object.assign(m, { computeBoundingSphere: () => m.geometry.computeBoundingSphere() });
    };
    const plate = mesh(1), head = mesh(1.1), eyes = mesh(.1);
    head.position.z = -.02; eyes.position.x = 5;
    scene.add(plate, head, eyes); scene.updateMatrixWorld(true);
    const recipe = initialRecipe();
    const selected = square(recipe.layers[0], .2, .3), other = square(recipe.layers[1], .6, .6);
    recipe.layers = [selected, other];
    let frame = () => {};
    const viewer = { renderer: { domElement: canvas }, scene, camera, plate, head, eyes, controls: { enabled: true },
      onFrame: (fn: () => void) => { frame = fn; } };
    const editor = createSurfaceEditor(viewer as unknown as Parameters<typeof createSurfaceEditor>[0], {
      layer: () => selected, layers: () => recipe.layers, selected: () => 0, select: () => {},
      selectedField: () => undefined, selectField: () => {}, begin: () => {}, apply: () => false, cancel: () => {}, message: () => {},
    });
    frame();
    const screen = (x: number, y: number) => {
      const p = new THREE.Vector3(x, y, 0).project(camera);
      return [(p.x + 1) * 500, (1 - p.y) * 500] as const;
    };
    const at = (u: number, v: number) => editor.hitAt(...screen(u - .5, v - .5));
    const onHead: ViewportHit = { hit: { kind: "head" }, affordance: "empty" };
    expect(at(.2, .3)).toMatchObject({ hit: { kind: "point", layerId: selected.id, index: 0 }, affordance: "point" });
    expect(at(.3, .4)).toEqual({ hit: { kind: "shape", layerId: selected.id }, mirror: false, affordance: "shape" });
    expect(at(.7, .7)).toEqual({ hit: { kind: "shape", layerId: other.id }, mirror: false, affordance: "shape" });
    // Skin: on the plate off the makeup, and on the head beyond the plate.
    expect(at(.5, .15)).toEqual(onHead);
    expect(editor.hitAt(...screen(.53, 0))).toEqual(onHead);
    // Background: no geometry under the cursor.
    expect(editor.hitAt(...screen(.6, 0))).toBeUndefined();
    expect(editor.hitAt(1001, 10)).toBeUndefined();
    // Surface controls off: no invisible handles, but makeup and skin keep their identity.
    editor.setEnabled(false);
    expect(at(.2, .3)?.hit.kind).not.toBe("point");
    expect(at(.3, .4)).toMatchObject({ hit: { kind: "shape", layerId: selected.id } });
    expect(at(.5, .15)).toEqual(onHead);
    expect(editor.hitAt(...screen(.6, 0))).toBeUndefined();
    // A hidden layer is not makeup under the cursor; the selected layer wins where layers overlap.
    other.enabled = false;
    expect(at(.7, .7)).toEqual(onHead);
    other.enabled = true; square(other, .25, .35);
    expect(at(.3, .4)).toMatchObject({ hit: { kind: "shape", layerId: selected.id } });
    // An invisible detail is not character geometry.
    const hidden = mesh(3); hidden.position.z = -.5; hidden.visible = false; scene.add(hidden); scene.updateMatrixWorld(true);
    expect(editor.hitAt(...screen(.6, 0))).toBeUndefined();
    hidden.visible = true;
    expect(editor.hitAt(...screen(.6, 0))).toEqual(onHead);
    editor.dispose();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("UV-view context hits: selected makeup, other visible makeup, empty UV space, then outside", () => {
  const originalGlobals = Object.fromEntries(["document", "window", "ResizeObserver"].map(name =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)])) as Record<string, PropertyDescriptor | undefined>;
  const ctx = new Proxy({}, { get: () => () => {} });
  const canvas: any = { width: 720, height: 310, style: {}, clientLeft: 0, clientTop: 0, getContext: () => ctx, addEventListener() {},
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 720, height: 310 }) };
  Object.assign(globalThis, {
    document: { createElement: () => ({ getContext: () => ctx }) },
    window: { addEventListener() {}, devicePixelRatio: 1 },
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  try {
    const recipe = initialRecipe();
    const selected = square(recipe.layers[0], .3, .2, .08), other = square(recipe.layers[1], .45, .2, .08);
    recipe.layers = [selected, other];
    const element = () => ({ setAttribute() {}, disabled: false, textContent: "" }) as any;
    const editor = createUVEditor(canvas, { both: element(), single: element(), other: element(), fit: element(), note: element() }, {
      recipe: () => recipe, layer: () => selected, selected: () => 0, selectedField: () => undefined,
      select: () => {}, selectField: () => {}, canvases: () => [], albedo: () => undefined,
      begin: () => {}, apply: () => false, cancel() {}, persist() {}, message() {},
    }, defaultUVView());
    editor.draw();
    const at = (u: number, v: number) => {
      const p = uvToPixel({ u, v }, uvRegion(defaultUVView()), 720, 310);
      return editor.hitAt(p.x + 10, p.y + 20);
    };
    expect(at(.34, .24)).toMatchObject({ hit: { kind: "shape", layerId: selected.id }, affordance: "shape" });
    expect(at(.49, .24)).toMatchObject({ hit: { kind: "shape", layerId: other.id }, affordance: "shape" });
    other.enabled = false;
    expect(at(.49, .24)).toEqual({ hit: { kind: "uv-empty" }, affordance: "empty" });
    expect(editor.hitAt(9, 22)).toBeUndefined();
    editor.dispose();
  } finally {
    for (const [name, descriptor] of Object.entries(originalGlobals)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
