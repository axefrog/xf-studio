import { expect, test } from "bun:test";
import * as THREE from "three";
import { initialRecipe } from "../src/recipe";
import { createSurfaceEditor } from "../src/surface-editor";

/** Exercise real ray picking/anchors without a WebGL context or game assets. */
test("surface tangents retain knot identity, mirror edits and report missing anchors", () => {
  class Canvas extends EventTarget {
    style = { cursor: "" };
    captures = new Set<number>();
    getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 1000 }; }
    setPointerCapture(id: number) { this.captures.add(id); }
    hasPointerCapture(id: number) { return this.captures.has(id); }
    releasePointerCapture(id: number) { this.captures.delete(id); }
  }
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const fakeWindow = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  try {
    const canvas = new Canvas(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, .01, 10);
    camera.position.z = 2;
    camera.updateMatrixWorld();
    const makeMesh = () => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
      return Object.assign(mesh, { computeBoundingSphere: () => mesh.geometry.computeBoundingSphere() });
    };
    const plate = makeMesh(), head = makeMesh(), eyes = makeMesh();
    head.position.z = -.02;
    eyes.position.x = 5;
    scene.add(plate, head, eyes);
    scene.updateMatrixWorld(true);
    const layer = initialRecipe().layers[0];
    layer.fields = [];
    const knot = layer.points[0];
    knot.handles = { in: { u: -.02, v: -.01 }, out: { u: .02, v: .01 }, mode: "symmetric" };
    const controls = { enabled: true };
    let frame = () => {}, checkpoints = 0, changes = 0, cancels = 0;
    const messages: string[] = [];
    const viewer = { renderer: { domElement: canvas }, scene, camera, plate, head, eyes, controls,
      onFrame: (fn: () => void) => { frame = fn; } };
    const editor = createSurfaceEditor(viewer as unknown as Parameters<typeof createSurfaceEditor>[0], {
      layer: () => layer, selected: () => 0, select: () => {},
      selectedField: () => undefined, selectField: () => {},
      begin: () => checkpoints++, change: () => changes++, cancel: () => cancels++,
      message: text => messages.push(text),
    });
    frame();
    const tangents = editor.diagnostics().handles.filter(h => h.kind === "tangent");
    expect(tangents).toHaveLength(4);
    expect(editor.diagnostics().unmappedTangents).toBe(0);
    const handle = tangents.find(h => h.mirror && h.side === "out")!;
    expect(handle.selectable).toBe(true);
    const emit = (type: string, x: number, y: number) => {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { clientX: x, clientY: y, pointerId: 1, button: 0 });
      canvas.dispatchEvent(event);
    };
    emit("pointerdown", handle.screen.x, handle.screen.y);
    expect(controls.enabled).toBe(false);
    emit("pointermove", handle.screen.x + 5, handle.screen.y + 3);
    expect(layer.points[0]).toBe(knot);
    expect(checkpoints).toBe(1);
    expect(changes).toBe(1);
    expect(knot.handles.out.u).toBeLessThan(.02);
    expect(knot.handles.in.u).toBe(-knot.handles.out.u);
    expect(knot.handles.in.v).toBe(-knot.handles.out.v);
    const escape = new Event("keydown", { cancelable: true });
    Object.assign(escape, { key: "Escape" });
    fakeWindow.dispatchEvent(escape);
    expect(cancels).toBe(1);
    expect(controls.enabled).toBe(true);
    expect(editor.diagnostics().dragging).toBe(false);
    // Outside the UV plate: no fabricated geometry anchor; UV editing is advertised.
    knot.handles.out = { u: 1, v: 1 };
    frame();
    expect(editor.diagnostics().unmappedTangents).toBe(2);
    expect(editor.diagnostics().handles.filter(h => h.kind === "tangent")).toHaveLength(2);
    expect(editor.diagnostics().tangentFallback).toContain("UV pane");
    expect(messages.at(-1)).toContain("UV pane");
    expect(editor.diagnostics().segments).toBeLessThanOrEqual(editor.diagnostics().capacity.segments);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
