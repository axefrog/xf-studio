import { expect, test } from "bun:test";
import * as THREE from "three";
import { initialRecipe } from "../src/recipe";
import { createSurfaceEditor } from "../src/surface-editor";
import { applyAdapterProposal } from "./gesture-test-adapter";

const HOVER = new THREE.Color(0xffffb5);

test("releasing a drag asks for a frame that shows the hover resolved under the still pointer (UI-47)", () => {
  class Canvas extends EventTarget {
    style = { cursor: "" };
    captures = new Set<number>();
    getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 1000 }; }
    setPointerCapture(id: number) { this.captures.add(id); }
    hasPointerCapture(id: number) { return this.captures.has(id); }
    releasePointerCapture(id: number) { this.captures.delete(id); }
  }
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  try {
    const canvas = new Canvas(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, .01, 10);
    camera.position.z = 2; camera.updateMatrixWorld();
    const mesh = () => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
      return Object.assign(m, { computeBoundingSphere: () => m.geometry.computeBoundingSphere() });
    };
    const plate = mesh(), head = mesh(), eyes = mesh();
    head.position.z = -.02; eyes.position.x = 5;
    scene.add(plate, head, eyes); scene.updateMatrixWorld(true);
    const layer = initialRecipe().layers[0]!;
    layer.pathMode = "bezier";
    layer.points = [[.2, .3], [.4, .3], [.4, .5], [.2, .5]].map(([u, v]) => ({ u: u!, v: v!, weight: 1,
      handles: { in: { u: 0, v: 0 }, out: { u: 0, v: 0 }, mode: "corner" as const } }));
    layer.fields = [];
    let frame = () => {}, renders = 0;
    // The viewport draws only when asked; a request here draws at once, like the next animation frame.
    const viewer = { renderer: { domElement: canvas }, scene, camera, plate, head, eyes, controls: { enabled: true },
      onFrame: (fn: () => void) => { frame = fn; return () => {}; }, requestRender: () => { renders++; frame(); } };
    let selected = 0;
    createSurfaceEditor(viewer as unknown as Parameters<typeof createSurfaceEditor>[0], {
      layer: () => layer, selected: () => selected, select: i => { selected = i; }, selectedField: () => undefined, selectField: () => {},
      begin: () => {}, apply: action => applyAdapterProposal(layer, action), cancel: () => {}, message: () => {},
    });
    const emit = (type: string, u: number, v: number, extra: Record<string, unknown> = {}) => {
      const world = new THREE.Vector3(u - .5, v - .5, 0).project(camera), e = new Event(type, { cancelable: true });
      Object.assign(e, { clientX: (world.x + 1) * 500, clientY: (1 - world.y) * 500, pointerId: 1, button: 0, ...extra });
      canvas.dispatchEvent(e); return e;
    };
    const points = scene.getObjectsByProperty("type", "Points")[0] as THREE.Points;
    const highlighted = () => {
      const colors = points.geometry.getAttribute("color"), count = points.geometry.drawRange.count;
      let n = 0;
      for (let i = 0; i < Math.min(count, colors.count); i++)
        if (Math.abs(colors.getX(i) - HOVER.r) < 1e-6 && Math.abs(colors.getY(i) - HOVER.g) < 1e-6 && Math.abs(colors.getZ(i) - HOVER.b) < 1e-6) n++;
      return n;
    };
    frame();
    // Hover the first point: it draws highlighted.
    emit("pointermove", .2, .3);
    frame();
    expect(highlighted()).toBe(1);
    // Drag the shape by its interior; the first point moves away from under the pointer.
    emit("pointerdown", .3, .4);
    emit("pointermove", .32, .42);
    emit("pointermove", .34, .44);
    // The release lands on the shape's interior, not a handle: the highlight must go without a further move.
    expect(layer.points[0]!.u).toBeCloseTo(.24, 8);
    // Nothing drew during the drag in this fixture, so the stale highlight is still in the buffer.
    expect(highlighted()).toBe(1);
    const before = renders;
    emit("pointerup", .34, .44);
    expect(renders).toBeGreaterThan(before);
    expect(highlighted()).toBe(0);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
  }
});
