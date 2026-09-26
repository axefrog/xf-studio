import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { attachHeadCameraInput, CAMERA_EFFECTS, headCameraEffect, orbitMouseAction, orbitSlotFor, orbitSwapsSlots,
  orbitTouchAction, type CameraEffect } from "../src/head-camera-input";
import { ADAPTER_INPUTS, ALL_TARGETS, MAKEUP_TARGETS, MODIFIER_KEYS, POINTER_BINDINGS, PRESS_INPUTS, pointerBinding,
  pointerBindingById, pointerInputOf, targetTip, viewportHints, type HeldModifiers, type ModifierKey, type PointerInput,
  type PointerTarget, type ViewportScope } from "../src/input-bindings";
import { initialRecipe, type Layer, type Recipe } from "../src/engines/layered-makeup/recipe";
import { createSurfaceEditor } from "../src/surface-editor";
import { createUVEditor } from "../src/uv-editor";
import { defaultUVView, uvRegion, uvToPixel } from "../src/uv-view";
import { applyAdapterProposal } from "./gesture-test-adapter";

/**
 * The binding catalogue is authoritative for every head camera input: whatever modifiers are held,
 * the orbit controls do exactly the bound camera effect, or nothing. These tests pin three's
 * OrbitControls swap rule and drive the real controls through the real adapters.
 */
const held = (key: ModifierKey): HeldModifiers => ({ ctrl: key.includes("ctrl"), alt: key.includes("alt"), shift: key.includes("shift") });
const flags = (key: ModifierKey) => ({ ctrlKey: key.includes("ctrl"), altKey: key.includes("alt"), shiftKey: key.includes("shift") });
const orbitSource = readFileSync(resolve(import.meta.dir, "../node_modules/three/examples/jsm/controls/OrbitControls.js"), "utf8");

test("three 0.186 OrbitControls swap rule is pinned: Ctrl, Meta or Shift swaps rotate and pan; Alt and dolly never swap", () => {
  // If three is upgraded and these source lines change, re-derive orbitMouseAction() before updating this test.
  expect(JSON.parse(readFileSync(resolve(import.meta.dir, "../node_modules/three/package.json"), "utf8")).version).toBe("0.186.0");
  const lines = orbitSource.split("\n");
  const at = (line: number) => lines[line - 1].trim();
  expect(at(1647)).toBe("function onMouseDown( event ) {");
  expect(at(1686)).toBe("case MOUSE.ROTATE:");
  expect(at(1688)).toBe("if ( event.ctrlKey || event.metaKey || event.shiftKey ) {");
  expect(at(1694)).toBe("this.state = _STATE.PAN;");
  expect(at(1708)).toBe("case MOUSE.PAN:");
  expect(at(1710)).toBe("if ( event.ctrlKey || event.metaKey || event.shiftKey ) {");
  expect(at(1716)).toBe("this.state = _STATE.ROTATE;");
  expect(at(1730)).toBe("default:");
  expect(at(1798)).toBe("function onTouchStart( event ) {");
  // The dolly case and the touch handler read no modifier.
  const dolly = orbitSource.slice(orbitSource.indexOf("case MOUSE.DOLLY:"), orbitSource.indexOf("case MOUSE.ROTATE:"));
  expect(dolly).not.toMatch(/Key/);
  const touchStart = orbitSource.slice(orbitSource.indexOf("function onTouchStart( event )"), orbitSource.indexOf("function onTouchMove( event )"));
  expect(touchStart).not.toMatch(/ctrlKey|metaKey|shiftKey|altKey/);

  expect(orbitSwapsSlots(held(""))).toBe(false);
  expect(orbitSwapsSlots(held("alt"))).toBe(false);
  for (const mods of MODIFIER_KEYS.filter(key => key.includes("ctrl") || key.includes("shift"))) expect(orbitSwapsSlots(held(mods))).toBe(true);
  // Meta counts as Ctrl, as it does in the controls' own test.
  expect(orbitSlotFor({ button: 2, metaKey: true }, "empty")).toEqual({ kind: "mouse", name: "RIGHT", value: THREE.MOUSE.ROTATE });
  expect(orbitMouseAction("camera-orbit", held(""))).toBe(THREE.MOUSE.ROTATE);
  expect(orbitMouseAction("camera-orbit", held("alt"))).toBe(THREE.MOUSE.ROTATE);
  expect(orbitMouseAction("camera-orbit", held("ctrl"))).toBe(THREE.MOUSE.PAN);
  expect(orbitMouseAction("camera-pan", held(""))).toBe(THREE.MOUSE.PAN);
  expect(orbitMouseAction("camera-pan", held("shift"))).toBe(THREE.MOUSE.ROTATE);
  expect(orbitMouseAction("camera-pan", held("ctrl"))).toBe(THREE.MOUSE.ROTATE);
  expect(orbitMouseAction("camera-zoom", held("ctrl+shift"))).toBe(THREE.MOUSE.DOLLY);
  expect(orbitMouseAction(undefined, held(""))).toBeNull();
  expect(orbitTouchAction("two-finger-drag", "camera-zoom-pan")).toBe(THREE.TOUCH.DOLLY_PAN);
});

test("presses classify by button and finger", () => {
  expect(pointerInputOf({ button: 0 })).toBe("drag");
  expect(pointerInputOf({ button: 1 })).toBe("middle-drag");
  expect(pointerInputOf({ button: 2 })).toBe("right-drag");
  expect(pointerInputOf({ button: 3 })).toBeUndefined();
  expect(pointerInputOf({ button: 0, pointerType: "touch", isPrimary: true })).toBe("drag");
  expect(pointerInputOf({ button: 0, pointerType: "touch", isPrimary: false })).toBe("two-finger-drag");
  expect(pointerInputOf({ button: 0, pointerType: "pen", isPrimary: true })).toBe("drag");
  expect(new Set(PRESS_INPUTS)).toEqual(new Set(["drag", "middle-drag", "right-drag", "two-finger-drag"] as PointerInput[]));
});

test("every head camera binding is representable in the controls for its input, whatever modifiers are held", () => {
  const problems: string[] = [];
  for (const binding of POINTER_BINDINGS.filter(item => item.scope === "head" && (CAMERA_EFFECTS as readonly string[]).includes(item.effect))) {
    expect(PRESS_INPUTS.includes(binding.input) || binding.input === "wheel").toBe(true);
    if (binding.input === "wheel") { expect(binding.effect).toBe("camera-zoom"); continue; }
    for (const mods of binding.mods) for (const target of binding.targets) {
      const touch = binding.input === "drag" || binding.input === "two-finger-drag";
      const event = { ...flags(mods), button: binding.input === "middle-drag" ? 1 : binding.input === "right-drag" ? 2 : 0,
        pointerType: binding.input === "two-finger-drag" ? "touch" : "mouse", isPrimary: binding.input !== "two-finger-drag" };
      if (orbitSlotFor(event, target)?.value == null) problems.push(`${binding.id} ${mods || "none"} ${target}`);
      if (touch && binding.effect !== "camera-zoom" && orbitSlotFor({ ...event, pointerType: "touch" }, target)?.value == null)
        problems.push(`${binding.id} touch ${mods || "none"} ${target}`);
    }
  }
  expect(problems).toEqual([]);
});

// ---------- The real controls, driven through the real adapters ----------
class FakeDocument extends EventTarget {}
class FakeCanvas extends EventTarget {
  style: Record<string, string> = {};
  clientWidth = 1000; clientHeight = 1000;
  ownerDocument = new FakeDocument();
  captures = new Set<number>();
  getRootNode() { return this.ownerDocument; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000, x: 0, y: 0 }; }
  setPointerCapture(id: number) { this.captures.add(id); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); }
}
type Motion = "orbit" | "pan" | "zoom" | "zoom-pan" | "nothing";
const EXPECTED: Record<CameraEffect, Motion> = { "camera-orbit": "orbit", "camera-pan": "pan", "camera-zoom": "zoom", "camera-zoom-pan": "zoom-pan" };

/** Head scene stand-in: a 1×1 eye plate with one square shape, the real OrbitControls and both adapters. */
function headFixture() {
  const canvas = new FakeCanvas(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, .01, 10);
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  const controls = new OrbitControls(camera, canvas as unknown as HTMLElement);
  const cameraInput = attachHeadCameraInput(canvas, controls);
  const reset = () => { camera.position.set(0, 0, 2); controls.target.set(0, 0, 0); controls.update(); camera.updateMatrixWorld(); };
  reset();
  const mesh = () => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    return Object.assign(m, { computeBoundingSphere: () => m.geometry.computeBoundingSphere() });
  };
  const plate = mesh(), head = mesh(), eyes = mesh();
  head.position.z = -.02; eyes.position.x = 5;
  scene.add(plate, head, eyes); scene.updateMatrixWorld(true);
  const layer: Layer = initialRecipe().layers[0];
  layer.pathMode = "bezier";
  layer.points = [[.2, .3], [.4, .3], [.4, .5], [.2, .5]].map(([u, v]) => ({ u, v, weight: 1,
    handles: { in: { u: 0, v: 0 }, out: { u: 0, v: 0 }, mode: "corner" as const } }));
  layer.fields = []; layer.symmetry = false;
  const original = structuredClone(layer);
  let frame = () => {};
  const reports: { target?: PointerTarget; gesture?: string }[] = [];
  const viewer = { renderer: { domElement: canvas }, scene, camera, plate, head, eyes, controls, cameraInput,
    onFrame: (fn: () => void) => { frame = fn; } };
  const editor = createSurfaceEditor(viewer as unknown as Parameters<typeof createSurfaceEditor>[0], {
    layer: () => layer, selected: () => 0, select: () => {}, selectedField: () => undefined, selectField: () => {},
    begin: () => {}, apply: action => applyAdapterProposal(layer, action), cancel: () => {}, message: () => {},
    input: state => reports.push(state),
  });
  // In a browser, events on the canvas bubble to its document (where the controls follow moves and releases).
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"])
    canvas.addEventListener(type, event => canvas.ownerDocument.dispatchEvent(Object.assign(new Event(type), (event as Event & { init: object }).init)));
  const at = (u: number, v: number) => {
    const world = new THREE.Vector3(u - .5, v - .5, 0).project(camera);
    return { x: (world.x + 1) * 500, y: (1 - world.y) * 500 };
  };
  const emit = (type: string, point: { x: number; y: number }, init: Record<string, unknown>) => {
    const full = { clientX: point.x, clientY: point.y, pageX: point.x, pageY: point.y, ...init };
    const event = Object.assign(new Event(type, { cancelable: true }), full, { init: full });
    canvas.dispatchEvent(event);
  };
  const state = () => ({ position: camera.position.clone(), target: controls.target.clone() });
  /** Classifies what one gesture did to the camera. */
  const motion = (before: ReturnType<typeof state>): Motion => {
    const after = state(), eps = 1e-6;
    const moved = after.target.distanceTo(before.target) > eps;
    const zoomed = Math.abs(after.position.distanceTo(after.target) - before.position.distanceTo(before.target)) > eps;
    const turned = after.position.distanceTo(before.position) > eps;
    return moved && zoomed ? "zoom-pan" : moved ? "pan" : zoomed ? "zoom" : turned ? "orbit" : "nothing";
  };
  return { canvas, controls, emit, at, state, motion, reports, editor,
    prepare() { reset(); Object.assign(layer, structuredClone(original)); frame(); } };
}
const LOCATIONS: Record<"empty" | "shape" | "point", [number, number]> = { empty: [.8, .8], shape: [.3, .4], point: [.4, .3] };

test("head: every press, modifier set and target does exactly the table's camera effect, or nothing (real OrbitControls)", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    const f = headFixture(), problems: string[] = [];
    for (const [name, [u, v]] of Object.entries(LOCATIONS) as [PointerTarget, [number, number]][]) {
      f.prepare();
      const point = f.at(u, v);
      f.emit("pointermove", point, { pointerId: 9, pointerType: "mouse", button: -1 });
      expect(f.reports.at(-1)?.target).toBe(name);
      for (const mods of MODIFIER_KEYS) {
        const keys = flags(mods);
        for (const [input, button] of [["drag", 0], ["middle-drag", 1], ["right-drag", 2]] as const) {
          f.prepare();
          const before = f.state();
          f.emit("pointerdown", point, { pointerId: 1, pointerType: "mouse", isPrimary: true, button, ...keys });
          f.emit("pointermove", { x: point.x + 30, y: point.y + 40 }, { pointerId: 1, pointerType: "mouse", button: -1, ...keys });
          f.emit("pointerup", { x: point.x + 30, y: point.y + 40 }, { pointerId: 1, pointerType: "mouse", button, ...keys });
          const effect = headCameraEffect(input, name, mods), expected = effect ? EXPECTED[effect] : "nothing";
          const actual = f.motion(before);
          if (actual !== expected) problems.push(`${input} ${mods || "none"} ${name}: ${actual}, table says ${expected}`);
        }
        // One finger, then a second: the second joins only a gesture the first gave to the camera.
        f.prepare();
        let before = f.state();
        f.emit("pointerdown", point, { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, ...keys });
        f.emit("pointermove", { x: point.x + 30, y: point.y + 40 }, { pointerId: 1, pointerType: "touch", button: -1, ...keys });
        f.emit("pointerup", { x: point.x + 30, y: point.y + 40 }, { pointerId: 1, pointerType: "touch", button: 0, ...keys });
        const one = headCameraEffect("drag", name, mods), oneExpected = one === "camera-orbit" || one === "camera-pan" ? EXPECTED[one] : "nothing";
        if (f.motion(before) !== oneExpected) problems.push(`touch drag ${mods || "none"} ${name}: ${f.motion(before)}, table says ${oneExpected}`);
        f.prepare();
        before = f.state();
        const empty = f.at(...LOCATIONS.empty);
        f.emit("pointerdown", empty, { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, ...keys });
        f.emit("pointerdown", point, { pointerId: 2, pointerType: "touch", isPrimary: false, button: 0, ...keys });
        f.emit("pointermove", { x: point.x + 60, y: point.y + 30 }, { pointerId: 2, pointerType: "touch", button: -1, ...keys });
        f.emit("pointerup", { x: point.x + 60, y: point.y + 30 }, { pointerId: 2, pointerType: "touch", button: 0, ...keys });
        f.emit("pointerup", empty, { pointerId: 1, pointerType: "touch", button: 0, ...keys });
        const first = headCameraEffect("drag", "empty", mods), two = headCameraEffect("two-finger-drag", name, mods);
        const twoExpected = first && two ? EXPECTED[two] : "nothing";
        if (f.motion(before) !== twoExpected) problems.push(`two-finger ${mods || "none"} ${name}: ${f.motion(before)}, table says ${twoExpected}`);
      }
    }
    expect(problems).toEqual([]);
    // Between presses every slot rests empty: nothing can reach the controls' default mapping.
    expect(f.controls.mouseButtons).toEqual({ LEFT: null, MIDDLE: null, RIGHT: null });
    expect(f.controls.touches).toEqual({ ONE: null, TWO: null });
    f.editor.dispose();
  } finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
});

test("head: the maintainer's report — right-drag pans with no modifier, Ctrl or Shift; left orbits; Ctrl-left pans; Shift-left off makeup does nothing", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    const f = headFixture();
    const gesture = (at: [number, number], button: number, keys: Record<string, boolean> = {}) => {
      f.prepare();
      const point = f.at(...at), before = f.state();
      f.emit("pointerdown", point, { pointerId: 1, pointerType: "mouse", isPrimary: true, button, ...keys });
      f.emit("pointermove", { x: point.x + 30, y: point.y + 40 }, { pointerId: 1, pointerType: "mouse", button: -1, ...keys });
      f.emit("pointerup", { x: point.x + 30, y: point.y + 40 }, { pointerId: 1, pointerType: "mouse", button, ...keys });
      return f.motion(before);
    };
    for (const at of [LOCATIONS.empty, LOCATIONS.shape]) {
      expect(gesture(at, 2)).toBe("pan");
      expect(gesture(at, 2, { ctrlKey: true })).toBe("pan");
      expect(gesture(at, 2, { shiftKey: true })).toBe("pan");
      expect(gesture(at, 2, { metaKey: true })).toBe("pan");
      expect(gesture(at, 2, { altKey: true })).toBe("pan");
      expect(gesture(at, 0, { ctrlKey: true })).toBe("pan");
      expect(gesture(at, 1, { shiftKey: true })).toBe("zoom");
    }
    expect(gesture(LOCATIONS.empty, 0)).toBe("orbit");
    expect(gesture(LOCATIONS.shape, 0, { altKey: true })).toBe("orbit");
    expect(gesture(LOCATIONS.empty, 0, { shiftKey: true })).toBe("nothing");
    expect(gesture(LOCATIONS.empty, 0, { ctrlKey: true, altKey: true })).toBe("nothing");
    f.editor.dispose();
  } finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
});

// ---------- Press sequences the conformance loop does not reach (UI-37) ----------
function withHeadFixture(run: (f: ReturnType<typeof headFixture>) => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    const f = headFixture();
    run(f);
    f.editor.dispose();
  } finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
}
const RESTING = { mouseButtons: { LEFT: null, MIDDLE: null, RIGHT: null }, touches: { ONE: null, TWO: null } };
const slots = (f: ReturnType<typeof headFixture>) => ({ mouseButtons: f.controls.mouseButtons, touches: f.controls.touches });
const moved = (point: { x: number; y: number }, dx: number, dy: number) => ({ x: point.x + dx, y: point.y + dy });
const finger = (pointerId: number, isPrimary: boolean) => ({ pointerId, pointerType: "touch", isPrimary, button: 0 });
/** The camera motion the table binds to one finger on empty space (with no modifier held). */
const oneFingerOnEmpty = () => {
  const effect = headCameraEffect("drag", "empty", "");
  expect(effect === "camera-orbit" || effect === "camera-pan").toBe(true);
  return { slot: orbitTouchAction("drag", effect), motion: EXPECTED[effect!] };
};

test("head: pointercancel ends a camera gesture and rests every slot, and the next press starts clean", () => withHeadFixture(f => {
  const empty = f.at(...LOCATIONS.empty), one = oneFingerOnEmpty();
  // A touch gesture the browser takes over (a system swipe, a scroll) ends in pointercancel, not pointerup.
  f.prepare();
  let before = f.state();
  f.emit("pointerdown", empty, finger(1, true));
  expect(f.controls.touches.ONE).toBe(one.slot);
  f.emit("pointermove", moved(empty, 30, 40), { ...finger(1, true), button: -1 });
  expect(f.motion(before)).toBe(one.motion);
  f.emit("pointercancel", moved(empty, 30, 40), finger(1, true));
  expect(slots(f)).toEqual(RESTING);
  // The cancelled finger no longer moves the camera.
  before = f.state();
  f.emit("pointermove", moved(empty, 90, 10), { ...finger(1, true), button: -1 });
  expect(f.motion(before)).toBe("nothing");

  // A cancelled mouse press rests its slot too.
  f.emit("pointerdown", empty, { pointerId: 2, pointerType: "mouse", isPrimary: true, button: 2 });
  expect(f.controls.mouseButtons.RIGHT).not.toBeNull();
  f.emit("pointercancel", empty, { pointerId: 2, pointerType: "mouse", isPrimary: true, button: 2 });
  expect(slots(f)).toEqual(RESTING);

  // A cancelled makeup edit gives the controls back and rests the slots.
  const shape = f.at(...LOCATIONS.shape);
  f.emit("pointerdown", shape, finger(3, true));
  expect(f.reports.at(-1)?.gesture).toBeDefined();
  expect(f.controls.enabled).toBe(false);
  f.emit("pointercancel", shape, finger(3, true));
  expect(f.reports.at(-1)?.gesture).toBeUndefined();
  expect(f.controls.enabled).toBe(true);
  expect(slots(f)).toEqual(RESTING);

  // The next press does exactly its bound effect.
  f.prepare();
  before = f.state();
  f.emit("pointerdown", empty, { pointerId: 4, pointerType: "mouse", isPrimary: true, button: 0 });
  f.emit("pointermove", moved(empty, 30, 40), { pointerId: 4, pointerType: "mouse", button: -1 });
  f.emit("pointerup", moved(empty, 30, 40), { pointerId: 4, pointerType: "mouse", button: 0 });
  expect(f.motion(before)).toBe("orbit");
  expect(slots(f)).toEqual(RESTING);
}));

test("head: when the first finger lifts before the second, the second carries on with the first finger's slot until it lifts", () => withHeadFixture(f => {
  const empty = f.at(...LOCATIONS.empty), second = moved(empty, -200, 0), one = oneFingerOnEmpty();
  const two = headCameraEffect("two-finger-drag", "empty", "");
  expect(two).toBe("camera-zoom-pan");
  f.prepare();
  f.emit("pointerdown", empty, finger(1, true));
  f.emit("pointerdown", second, finger(2, false));
  expect(f.controls.touches).toEqual({ ONE: one.slot, TWO: orbitTouchAction("two-finger-drag", two) });
  let before = f.state();
  f.emit("pointermove", moved(second, -60, 30), { ...finger(2, false), button: -1 });
  expect(f.motion(before)).toBe(EXPECTED[two!]);
  // The first finger lifts: the controls restart a one-finger gesture for the second finger and read
  // the ONE slot, so the slots must not rest while any finger is down.
  f.emit("pointerup", empty, finger(1, true));
  expect(f.controls.touches.ONE).toBe(one.slot);
  before = f.state();
  f.emit("pointermove", moved(second, -20, 80), { ...finger(2, false), button: -1 });
  expect(f.motion(before)).toBe(one.motion);
  // The last finger lifts: everything rests and nothing moves the camera any more.
  f.emit("pointerup", moved(second, -20, 80), finger(2, false));
  expect(slots(f)).toEqual(RESTING);
  before = f.state();
  f.emit("pointermove", moved(second, 40, 40), { ...finger(2, false), button: -1 });
  expect(f.motion(before)).toBe("nothing");
}));

test("head: a second finger after a first touch the surface editor consumed never moves the camera", () => withHeadFixture(f => {
  const shape = f.at(...LOCATIONS.shape), empty = f.at(...LOCATIONS.empty), one = oneFingerOnEmpty();
  // Every modifier set whose one-finger press on makeup is not a camera effect: an edit (the editor
  // takes the controls away) or a consumed no-op (the controls stay enabled and see only the second finger).
  const consumed = MODIFIER_KEYS.filter(mods => !headCameraEffect("drag", "shape", mods));
  expect(consumed).toContain("");
  expect(consumed.some(mods => !pointerBinding("head", "drag", "shape", mods))).toBe(true);
  for (const mods of consumed) {
    const keys = flags(mods), editing = !!pointerBinding("head", "drag", "shape", mods);
    f.prepare();
    const before = f.state();
    f.emit("pointerdown", shape, { ...finger(1, true), ...keys });
    expect(f.reports.at(-1)?.gesture !== undefined, mods).toBe(editing);
    expect(f.controls.touches.ONE, mods).toBeNull();
    // A second finger joins. Its two-finger slot is set, but the controls never saw the first finger,
    // so this is their first finger: it reads the ONE slot the consumed press left empty.
    f.emit("pointerdown", empty, { ...finger(2, false), ...keys });
    f.emit("pointermove", moved(empty, -60, 30), { ...finger(2, false), button: -1, ...keys });
    f.emit("pointerup", moved(empty, -60, 30), { ...finger(2, false), ...keys });
    expect(f.motion(before), mods).toBe("nothing");
    // The first finger still owns its press, then ends it.
    f.emit("pointermove", moved(shape, 10, 10), { ...finger(1, true), button: -1, ...keys });
    f.emit("pointerup", moved(shape, 10, 10), { ...finger(1, true), ...keys });
    expect(f.motion(before), mods).toBe("nothing");
    expect(f.reports.at(-1)?.gesture, mods).toBeUndefined();
    expect(f.controls.enabled, mods).toBe(true);
    expect(slots(f), mods).toEqual(RESTING);
    // Nothing is left half-tracked: the next single finger on empty space does its bound effect.
    f.prepare();
    const next = f.state();
    f.emit("pointerdown", empty, finger(3, true));
    f.emit("pointermove", moved(empty, 30, 40), { ...finger(3, true), button: -1 });
    f.emit("pointerup", moved(empty, 30, 40), finger(3, true));
    expect(f.motion(next), mods).toBe(one.motion);
  }
}));

test("UV: every press, modifier set and target pans the view exactly when the table says so", () => {
  const previous = { document: globalThis.document, window: globalThis.window, ResizeObserver: globalThis.ResizeObserver };
  const context = new Proxy({}, { get: () => () => {} });
  let captured: number | undefined;
  const canvas: any = { width: 720, height: 310, getContext: () => context,
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 720, height: 310 }),
    setPointerCapture: (id: number) => { captured = id; }, hasPointerCapture: (id: number) => id === captured,
    releasePointerCapture: () => { captured = undefined; }, addEventListener: () => {} };
  Object.assign(globalThis, { document: { createElement: () => ({ getContext: () => context }) },
    window: { addEventListener: () => {} }, ResizeObserver: class { observe() {} } });
  try {
    const recipe: Recipe = initialRecipe();
    recipe.layers[0].pathMode = "bezier";
    recipe.layers[0].points = [[.3, .2], [.45, .2], [.45, .35], [.3, .35]].map(([u, v]) => ({ u, v, weight: 1,
      handles: { in: { u: 0, v: 0 }, out: { u: 0, v: 0 }, mode: "corner" as const } }));
    recipe.layers[0].fields = []; recipe.layers[0].symmetry = false;
    const original = structuredClone(recipe.layers[0]);
    const editor = createUVEditor(canvas, undefined, {
      recipe: () => recipe, layer: () => recipe.layers[0], selected: () => 0, canvases: () => [], albedo: () => undefined,
      select() {}, selectedField: () => undefined, selectField() {}, begin: () => {},
      apply: action => applyAdapterProposal(recipe.layers[0], action), cancel() {}, persist() {}, message() {},
    }, defaultUVView());
    const screen = (u: number, v: number) => { const p = uvToPixel({ u, v }, uvRegion(editor.snapshot()), 720, 310); return { x: p.x + 10, y: p.y + 20 }; };
    const problems: string[] = [];
    const presses = [["drag", { button: 0, pointerType: "mouse", isPrimary: true }], ["middle-drag", { button: 1, pointerType: "mouse", isPrimary: true }],
      ["right-drag", { button: 2, pointerType: "mouse", isPrimary: true }], ["two-finger-drag", { button: 0, pointerType: "touch", isPrimary: false }]] as const;
    for (const [target, at] of [["empty", screen(.9, .9)], ["shape", screen(.38, .28)]] as const)
      for (const mods of MODIFIER_KEYS) for (const [input, press] of presses) {
        Object.assign(recipe.layers[0], structuredClone(original));
        canvas.onpointerdown({ clientX: at.x, clientY: at.y, pointerId: 3, preventDefault() {}, ...press, ...flags(mods) });
        const effect = pointerBinding("uv", input, target, mods)?.effect;
        const panning = editor.diagnostics().gesture === "pan";
        if (panning !== (effect === "view-pan")) problems.push(`${input} ${mods || "none"} ${target}: ${panning ? "pans" : "no pan"}, table says ${effect ?? "unbound"}`);
        canvas.onpointerup({ clientX: at.x, clientY: at.y, pointerId: 3 });
      }
    expect(problems).toEqual([]);
  } finally { Object.assign(globalThis, previous); }
});

test("every hint the strip or a tooltip can show comes from a binding the adapters consult", () => {
  const scopes: ViewportScope[] = ["head", "uv"], problems: string[] = [];
  for (const binding of POINTER_BINDINGS)
    if (!ADAPTER_INPUTS[binding.scope].includes(binding.input)) problems.push(`${binding.id}: no adapter consults ${binding.input}`);
  for (const scope of scopes) for (const target of [undefined, ...ALL_TARGETS]) for (const mods of MODIFIER_KEYS) {
    const context = { scope, target, modifiers: held(mods) };
    const hints = viewportHints(context), tip = targetTip(context);
    for (const item of [...hints.items, ...hints.hold, ...(tip?.lines ?? [])]) for (const id of item.ids) {
      if (!POINTER_BINDINGS.some(binding => binding.id === id)) continue;
      const binding = pointerBindingById(id);
      if (!ADAPTER_INPUTS[scope].includes(binding.input)) problems.push(`${scope} hint "${item.label}" (${id}) is not consulted`);
      // A shown pointer hint is exactly what the adapter resolves for this target and modifier set.
      if (hints.items.includes(item) && target !== undefined && pointerBinding(scope, binding.input, target, mods)?.id !== id)
        problems.push(`${scope} hint "${item.label}" (${id}) differs from the resolved binding`);
    }
  }
  expect(problems).toEqual([]);
  // The adapters really do resolve these inputs through the catalogue (and classify presses one way).
  const source = (file: string) => readFileSync(resolve(import.meta.dir, "../src", file), "utf8");
  const head = source("surface-editor.ts") + source("head-camera-input.ts"), uv = source("uv-editor.ts");
  const viewports = source("studio-ui/panels/viewports.ts");
  for (const pattern of ["pointerInputOf(e) !== \"drag\"", "pointerBinding(\"head\", \"drag\"", "pointerBinding(\"head\", \"wheel\"",
    "pointerBinding(\"head\", input", "const input = pointerInputOf(event)", "setTargetResolver("])
    expect(head).toContain(pattern);
  for (const pattern of ["const input = pointerInputOf(e)", "pointerBinding(\"uv\", input", "pointerBinding(\"uv\", \"wheel\"", "pointerBinding(\"uv\", \"double-click\""])
    expect(uv).toContain(pattern);
  expect(viewports).toContain("pointerBinding(kind, \"right-click\"");
  // Neither adapter hard-codes a button-to-input mapping any more.
  expect(head + uv).not.toMatch(/e\.button === 2 \? "right-drag"/);
  // Every makeup target and empty space is covered by the conformance loops above.
  expect(new Set([...MAKEUP_TARGETS, "empty"])).toEqual(new Set(ALL_TARGETS));
});
