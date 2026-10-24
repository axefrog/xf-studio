import { expect, test } from "bun:test";
import * as THREE from "three";
import { createSurfaceEditor, surfaceGuideStandIns } from "../src/legacy/eye-makeup/browser/surface-editor";
import { createBrowserViewportDevice } from "../src/preview/browser/browser-viewport-device";
import type { createSceneRuntime } from "../src/platform/scene/scene-host";
import { applyAdapterProposal } from "./gesture-test-adapter";
import { initialRecipe, EYE_REGION } from "./fixtures/eye-region";

/**
 * The on-head editor's guides draw with the head's own materials (experiment 043 §15, G3's warm-switch row): Three keys even an unlit
 * material's program on the scene's light counts, so each lighting setup the head is drawn under has its own variant of the guides'
 * programs. Materials made per mount and disposed per unmount took the variants drawn while mounted with them; a warm switch back to a head
 * shown under a setup its stand-ins were never compiled for linked them again in its first frame. With the head's materials, every variant
 * stays linked while the head lives.
 */

function mountOn(scene: THREE.Scene, guides?: ReturnType<typeof surfaceGuideStandIns>["materials"]) {
  class Canvas extends EventTarget {
    style = { cursor: "" };
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
    setPointerCapture() {}
    hasPointerCapture() { return false; }
    releasePointerCapture() {}
  }
  const mesh = () => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    return Object.assign(m, { computeBoundingSphere: () => m.geometry.computeBoundingSphere() });
  };
  const plate = mesh(), head = mesh(), eyes = mesh(), camera = new THREE.PerspectiveCamera(35, 1, .01, 10);
  scene.add(plate, head, eyes);
  const layer = initialRecipe().layers[0]!;
  const viewer = { renderer: { domElement: new Canvas() }, scene, camera, plate, head, eyes, controls: { enabled: true },
    onFrame: () => () => {}, requestRender: () => {} };
  return createSurfaceEditor(viewer as unknown as Parameters<typeof createSurfaceEditor>[0], { region: EYE_REGION,
    layer: () => layer, selected: () => 0, select: () => {}, selectedField: () => undefined, selectField: () => {},
    begin: () => {}, apply: action => applyAdapterProposal(layer, action), cancel: () => {}, message: () => {} }, undefined, guides);
}

const withWindow = (run: () => void) => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  try { run(); } finally { if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window"); }
};

test("an editor given the head's guide materials draws with them on every mount and never disposes them; one without makes and disposes its own", () => withWindow(() => {
  const standIns = surfaceGuideStandIns(), scene = new THREE.Scene();
  let disposed = 0;
  for (const material of Object.values(standIns.materials)) material.addEventListener("dispose", () => disposed++);
  // The stand-ins compiled with the head are the same materials.
  expect((standIns.objects[0] as THREE.Points).material).toBe(standIns.materials.point);
  expect((standIns.objects[1] as THREE.LineSegments).material).toBe(standIns.materials.line);
  for (let mount = 0; mount < 2; mount++) {
    const editor = mountOn(scene, standIns.materials);
    const drawn = new Set<THREE.Material>();
    scene.traverse(object => { if ((object as THREE.Points).isPoints || (object as THREE.LineSegments).isLineSegments) drawn.add((object as THREE.Points).material as THREE.Material); });
    expect([...drawn].sort((a, b) => a.uuid.localeCompare(b.uuid))).toEqual(Object.values(standIns.materials).sort((a, b) => a.uuid.localeCompare(b.uuid)));
    editor.dispose();
    expect(disposed).toBe(0);
  }
  // Without the head's materials: the editor's own, disposed with it.
  const own = new THREE.Scene(), editor = mountOn(own);
  const made: THREE.Material[] = [];
  own.traverse(object => { if ((object as THREE.Points).isPoints || (object as THREE.LineSegments).isLineSegments) made.push((object as THREE.Points).material as THREE.Material); });
  let ownDisposed = 0;
  for (const material of new Set(made)) material.addEventListener("dispose", () => ownDisposed++);
  editor.dispose();
  expect(ownDisposed).toBe(4);
  // The head goes: its materials with it.
  standIns.dispose();
  expect(disposed).toBe(4);
}));

test("the viewport device mounts each head's editor with that head's guide materials, the ones its stand-ins compiled; they go with the head", async () => {
  const host = { clientWidth: 600, clientHeight: 400, contains: () => false };
  const given: unknown[] = [];
  let built = 0;
  const device = createBrowserViewportDevice({ region: EYE_REGION,
    headHost: host as unknown as HTMLElement, uvHost: host as unknown as HTMLElement, queryContext: () => { throw Error("No hit expected"); },
    sceneFactory: (async () => ({ slot: ++built, dispose: () => {}, resize: () => {} })) as unknown as typeof createSceneRuntime,
    deviceFactory: (() => ({ show: () => {} })) as never,
    surfaceFactory: ((_viewer: unknown, _hooks: unknown, _parts: unknown, guides: unknown) => { given.push(guides);
      return { resize: () => {}, cancelInput: () => {}, inputCapture: () => false, hitAt: () => undefined, dispose: () => {} }; }) as unknown as typeof createSurfaceEditor,
  });
  const a = await device.buildHead(), b = await device.buildHead(), surface = {} as THREE.SkinnedMesh;
  const standInsA = device.surfaceGuides(a);
  device.showHead(a); device.mountSurface(surface, {} as Parameters<typeof createSurfaceEditor>[1]);
  device.showHead(b); device.mountSurface(surface, {} as Parameters<typeof createSurfaceEditor>[1]);
  device.showHead(a); device.mountSurface(surface, {} as Parameters<typeof createSurfaceEditor>[1]);
  const [first, other, again] = given as { point: THREE.Material }[];
  expect(first!.point).toBe((standInsA[0] as THREE.Points).material as THREE.Material);
  expect(again).toBe(first);
  expect(other).not.toBe(first);
  let disposed = false;
  first!.point.addEventListener("dispose", () => { disposed = true; });
  device.disposeHead(a);
  expect(disposed).toBe(true);
});
