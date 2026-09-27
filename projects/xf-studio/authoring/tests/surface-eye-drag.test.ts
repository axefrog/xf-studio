import { expect, test } from "bun:test";
import * as THREE from "three";
import { createSurfaceEditor } from "../src/surface-editor";
import { SurfaceMap, uvHoleBridges } from "../src/surface-map";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { extendSkin, restoreFirstWeights } from "../src/skin";
import { applyAdapterProposal } from "./gesture-test-adapter";
import { initialRecipe, EYE_REGION } from "./fixtures/eye-region";
import { derivedPreviewFile, derivedPreviewTest } from "./private-assets";

/**
 * A plate at real scale (metres) with a clean 20 × 8 mm eye opening. Its rim is rolled back 4 mm like a lid margin, and an
 * eyeball bulges through the opening about 1 mm in front of the rim. UV: u = (x + 0.02) / 0.04, v = (y + 0.016) / 0.032, so
 * the opening spans u 0.25–0.75, v 0.375–0.625.
 */
function eyeOpening() {
  const geometry = new THREE.PlaneGeometry(0.04, 0.032, 20, 16), index = Array.from(geometry.index!.array);
  const position = geometry.getAttribute("position");
  const inside = (x: number, y: number) => Math.abs(x) < 0.01 && Math.abs(y) < 0.004;
  geometry.setIndex(index.filter((_, i) => {
    const start = i - i % 3, triangle = index.slice(start, start + 3);
    return !inside(triangle.reduce((s, v) => s + position.getX(v), 0) / 3, triangle.reduce((s, v) => s + position.getY(v), 0) / 3);
  }));
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i);
    if (Math.abs(x) <= 0.01 + 1e-9 && Math.abs(y) <= 0.004 + 1e-9) position.setZ(i, -0.004);
  }
  return geometry;
}
const UV_OF = (x: number, y: number) => ({ u: (x + 0.02) / 0.04, v: (y + 0.016) / 0.032 });

test("interior UV holes are bridged on their plane; islands, outer edges and pinched holes are not", () => {
  const plate = eyeOpening(), bridges = uvHoleBridges(plate);
  // The opening's boundary has 2 × (10 + 4) = 28 vertices: 26 bridge triangles.
  expect(bridges.length).toBe(26);
  const map = new SurfaceMap(plate, { bridgeHoles: true }), unbridged = new SurfaceMap(plate);
  expect(map.bridged).toBe(true);
  const centre = UV_OF(0, 0), above = UV_OF(0, 0.006), below = UV_OF(0, -0.006);
  expect(unbridged.anchor(centre, true)).toBeUndefined();
  expect(map.anchor(centre)).toBeUndefined();
  expect(map.anchor(centre, true)?.bridge).toBe(true);
  // Plate triangles keep priority on the rim; a bridge never replaces a painted-surface anchor.
  expect(map.anchor(UV_OF(0, 0.004), true)?.bridge).toBeUndefined();
  expect(map.anchor(above, true)?.bridge).toBeUndefined();
  // Drags step from the lid onto the bridge and off it onto the other lid (continuity still limits one step's length).
  // Only when asked: outlines and every other plate lookup keep to the plate.
  for (const [a, b] of [[UV_OF(0, 0.0045), UV_OF(0, 0.003)], [UV_OF(0.001, 0.0008), UV_OF(0.001, -0.0008)], [UV_OF(0, -0.003), UV_OF(0, -0.0045)]]) {
    expect(unbridged.continuous(a, b, true)).toBe(false);
    expect(map.continuous(a, b)).toBe(false);
    expect(map.continuous(a, b, true)).toBe(true);
  }
  expect(map.continuous(above, below, true)).toBe(false);
  // The membrane follows the posed rim: a ray through the opening lands on it with the matching UV.
  const vertex = (i: number) => new THREE.Vector3().fromBufferAttribute(plate.getAttribute("position"), i);
  const hit = map.rayBridge(new THREE.Ray(new THREE.Vector3(0.002, -0.001, 1), new THREE.Vector3(0, 0, -1)), vertex)!;
  expect(hit.distance).toBeCloseTo(1.004, 6);
  expect(hit.uv.u).toBeCloseTo(UV_OF(0.002, -0.001).u, 6);
  expect(hit.uv.v).toBeCloseTo(UV_OF(0.002, -0.001).v, 6);
  expect(map.rayBridge(new THREE.Ray(new THREE.Vector3(0.015, 0, 1), new THREE.Vector3(0, 0, -1)), vertex)).toBeUndefined();
  // A plain plate, and two separate islands, have only outer edges.
  expect(uvHoleBridges(new THREE.PlaneGeometry(1, 1, 4, 4))).toEqual([]);
  const islands = new THREE.BufferGeometry();
  islands.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 3, 0, 0, 4, 0, 0, 3, 1, 0], 3));
  islands.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, .1, 0, 0, .1, .3, 0, .4, 0, .3, .1], 2));
  expect(uvHoleBridges(islands)).toEqual([]);
});

test("a lid-margin point drawn over the eye can be grabbed and dragged across the opening to the other lid", () => {
  class Canvas extends EventTarget {
    style = { cursor: "" };
    captures = new Set<number>();
    getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 1000 }; }
    setPointerCapture(id: number) { this.captures.add(id); }
    hasPointerCapture(id: number) { return this.captures.has(id); }
    releasePointerCapture(id: number) { this.captures.delete(id); }
  }
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), fakeWindow = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  try {
    const canvas = new Canvas(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10);
    camera.position.set(0, 0, 0.12); camera.updateMatrixWorld();
    const mesh = (geometry: THREE.BufferGeometry, side: THREE.Side) => {
      const result = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side }));
      return Object.assign(result, { computeBoundingSphere: () => result.geometry.computeBoundingSphere() });
    };
    const plate = mesh(eyeOpening(), THREE.DoubleSide), head = mesh(eyeOpening(), THREE.FrontSide);
    const eyes = mesh(new THREE.SphereGeometry(0.012, 48, 32), THREE.FrontSide);
    eyes.position.z = -0.015;
    scene.add(plate, head, eyes); scene.updateMatrixWorld(true);
    const layer = initialRecipe().layers[0];
    layer.fields = []; layer.symmetry = false; layer.pathMode = "bezier";
    const rim = UV_OF(0, 0.004);
    layer.points = [[rim.u, rim.v], [.62, .72], [.62, .28], [.38, .28], [.38, .72]].map(([u, v]) => ({ u, v, weight: 1,
      handles: { in: { u: -.02, v: 0 }, out: { u: .02, v: 0 }, mode: "symmetric" as const } }));
    const controls = { enabled: true };
    let frame = () => {}, checkpoints = 0, finished = 0, selected = 0;
    const messages: string[] = [];
    const viewer = { renderer: { domElement: canvas }, scene, camera, plate, head, eyes, controls, onFrame: (fn: () => void) => { frame = fn; } };
    const editor = createSurfaceEditor(viewer as unknown as Parameters<typeof createSurfaceEditor>[0], { region: EYE_REGION,
      layer: () => layer, selected: () => selected, select: (i) => { selected = i; }, selectedField: () => undefined, selectField: () => {},
      begin: () => { checkpoints++; }, apply: (action) => applyAdapterProposal(layer, action), cancel: () => {},
      finish: () => { finished++; }, message: (text) => messages.push(text),
    });
    // Screen position of a world point; points over the opening lie on its bridge, 4 mm back.
    const at = (x: number, y: number, z = Math.abs(x) < 0.01 && Math.abs(y) < 0.004 ? -0.004 : 0) => {
      const s = new THREE.Vector3(x, y, z).project(camera); return [(s.x + 1) * 500, (1 - s.y) * 500]; };
    let pointer = [0, 0];
    const emit = (type: string, [x, y]: number[], shiftKey = false) => {
      pointer = [x, y];
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { clientX: x, clientY: y, pointerId: 1, button: 0, buttons: 1, shiftKey }); canvas.dispatchEvent(event); return event;
    };
    // A pointer sweep in steps of about 5 px, as a real drag delivers it.
    const sweep = ([x, y]: number[], shiftKey = false) => {
      const [x0, y0] = pointer, steps = Math.max(1, Math.ceil(Math.hypot(x - x0, y - y0) / 5));
      for (let i = 1; i <= steps; i++) emit("pointermove", [x0 + (x - x0) * i / steps, y0 + (y - y0) * i / steps], shiftKey);
    };
    frame();
    const point = () => editor.diagnostics().handles.find((h) => h.kind === "point" && h.index === 0)!;
    // The rim is rolled back steeply, so the handle, lifted along its normal, is drawn over the opening with no plate
    // beneath it. It is visible (in front of the eye within the pick allowance) and must be pickable where it is drawn.
    const start = point();
    expect(start.selectable).toBe(true);
    expect(start.bridge).toBe(false);
    expect(editor.hitAt(start.screen.x, start.screen.y)).toMatchObject({ hit: { kind: "point", index: 0 } });
    expect(emit("pointerdown", [start.screen.x, start.screen.y]).defaultPrevented).toBe(true);
    expect(editor.diagnostics().gesture).toBe("handle");
    // Across the eyeball: the point follows the pointer onto the opening's bridge instead of pausing at the rim.
    sweep(at(0.001, 0));
    expect(editor.diagnostics().lastDragRejection).toBeNull();
    expect(layer.points[0].u).toBeCloseTo(UV_OF(0.001, 0).u, 4);
    expect(layer.points[0].v).toBeCloseTo(UV_OF(0.001, 0).v, 4);
    sweep(at(0, -0.0035));
    expect(layer.points[0].v).toBeCloseTo(UV_OF(0, -0.0035).v, 4);
    // And on to the lower lid.
    sweep(at(0, -0.006));
    expect(editor.diagnostics().lastDragRejection).toBeNull();
    expect(layer.points[0].v).toBeCloseTo(UV_OF(0, -0.006).v, 3);
    expect(messages.filter((m) => m.includes("paused"))).toEqual([]);
    // Back into the opening and release there: one gesture, one Undo step.
    sweep(at(0, 0.001));
    emit("pointerup", at(0, 0.001));
    expect(checkpoints).toBe(1); expect(finished).toBe(1);
    expect(controls.enabled).toBe(true); expect(canvas.captures.size).toBe(0);
    // A point inside the opening is legitimate UV: it sits on the bridge, drawn without depth, and stays grabbable.
    frame();
    const inside = point();
    expect(inside.bridge).toBe(true);
    expect(inside.shown).toBe(true);
    expect(inside.selectable).toBe(true);
    // The outline never runs through the opening (nothing is painted there, and the thin UV slit would stretch it across
    // the eye), and tangents need a plate triangle under their parent: on the bridge they stay with the UV pane.
    expect(editor.diagnostics().segments).toBeGreaterThan(0);
    expect(editor.diagnostics().handles.filter((h) => h.kind === "tangent")).toEqual([]);
    expect(editor.diagnostics().unmappedTangents).toBe(2);
    expect(messages.at(-1)).toContain("edit them in the UV pane");
    emit("pointerdown", [inside.screen.x, inside.screen.y]);
    sweep(at(0, 0.006));
    emit("pointerup", at(0, 0.006));
    expect(layer.points[0].v).toBeCloseTo(UV_OF(0, 0.006).v, 3);
    expect(checkpoints).toBe(2);
    // A fresh press on the eyeball over painted makeup still belongs to the camera: bare shape hits never use the bridge.
    frame();
    const eyePress = emit("pointerdown", at(0.004, -0.001));
    expect(eyePress.defaultPrevented).toBe(false);
    expect(editor.diagnostics().dragging).toBe(false);
    expect(editor.hitAt(...(at(0.004, -0.001) as [number, number]))).toEqual({ hit: { kind: "head" }, affordance: "empty" });
    // Shift-drag (rotate about the selected point) crosses the opening without pausing.
    const before = structuredClone(layer.points);
    expect(emit("pointerdown", at(0.003, -0.007), true).defaultPrevented).toBe(true);
    expect(editor.diagnostics().gesture).toBe("rotate");
    sweep(at(0.002, -0.002), true);
    sweep(at(0.0015, 0.002), true);
    expect(messages.filter((m) => m.includes("paused"))).toEqual([]);
    expect(layer.points).not.toEqual(before);
    emit("pointerup", at(0.0015, 0.002), true);
    expect(checkpoints).toBe(3);
    // The head still hides everything behind it: head skin in front of the opening stops the drag.
    frame();
    const again = point();
    emit("pointerdown", [again.screen.x, again.screen.y]);
    head.geometry = new THREE.PlaneGeometry(0.04, 0.032); head.position.z = 0.01; head.updateMatrixWorld();
    const held = structuredClone(layer.points[0]);
    sweep(at(0, 0));
    expect(layer.points[0]).toEqual(held);
    expect(editor.diagnostics().lastDragRejection?.reason).toBe("bridge-head-occlusion");
    emit("pointerup", at(0, 0));
    editor.dispose();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window");
  }
});

derivedPreviewTest("real plate: an upper-lash-line point near the outer corner is grabbable and drags across the eye to the lower lid", async () => {
  const bytes = await Bun.file(derivedPreviewFile("head.glb")).arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(bytes, ""), weights = restoreFirstWeights(bytes);
  const get = (name: string) => gltf.scene.getObjectByName(name) as THREE.Mesh;
  const head = get("head") as THREE.SkinnedMesh, plate = get("makeup_plate") as THREE.SkinnedMesh, eyes = get("eyes");
  // As the head rig prepares them: all skin influences, the plate double-sided (it is a hidden pick surface).
  for (const mesh of [head, plate, eyes]) {
    const name = gltf.parser.json.meshes[gltf.parser.associations.get(mesh)?.meshes ?? -1]?.name, skin = weights.get(name);
    if (skin) mesh.geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skin, 4));
    const material = new THREE.MeshStandardMaterial({ side: mesh === plate ? THREE.DoubleSide : THREE.FrontSide });
    mesh.material = material;
    if (mesh instanceof THREE.SkinnedMesh) extendSkin(mesh, material);
    mesh.morphTargetInfluences?.fill(0);
  }
  const scene = new THREE.Scene(); scene.add(gltf.scene); scene.updateMatrixWorld(true);
  const bridges = uvHoleBridges(plate.geometry), uv = plate.geometry.getAttribute("uv");
  const world = (i: number) => plate.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(plate.matrixWorld);
  // The eye opening on the +x side: the bridged hole's rim.
  const rim = [...new Set(bridges.flat())].filter((i) => world(i).x > 0);
  expect(rim.length).toBeGreaterThan(8);
  const centre = rim.map(world).reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(rim.length);
  const xs = rim.map((i) => world(i).x), outer = Math.max(...xs), inner = Math.min(...xs);
  // An upper-margin rim vertex about three quarters of the way to the outer corner, as in the reported screenshot.
  const target = inner + (outer - inner) * 0.75;
  const upper = rim.filter((i) => world(i).y > centre.y).sort((a, b) => Math.abs(world(a).x - target) - Math.abs(world(b).x - target))[0];
  const lowerY = Math.min(...rim.map((i) => world(i).y));
  // The camera looks at the eye from the front (the face looks down -z).
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10);
  camera.position.copy(centre).add(new THREE.Vector3(0, 0, -0.12)); camera.lookAt(centre); camera.updateMatrixWorld();
  class Canvas extends EventTarget {
    style = { cursor: "" };
    captures = new Set<number>();
    getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 1000 }; }
    setPointerCapture(id: number) { this.captures.add(id); }
    hasPointerCapture(id: number) { return this.captures.has(id); }
    releasePointerCapture(id: number) { this.captures.delete(id); }
  }
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), fakeWindow = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  try {
    const canvas = new Canvas(), controls = { enabled: true };
    const layer = initialRecipe().layers[0];
    layer.fields = []; layer.symmetry = false; layer.pathMode = "catmull-rom";
    const start = { u: uv.getX(upper), v: uv.getY(upper) };
    layer.points = [start, { u: start.u + .03, v: start.v + .03 }, { u: start.u - .03, v: start.v + .03 }].map((p) => ({ ...p, weight: 1 }));
    let frame = () => {}, checkpoints = 0;
    const editor = createSurfaceEditor({ renderer: { domElement: canvas }, scene, camera, plate, head, eyes, controls,
      onFrame: (fn: () => void) => { frame = fn; } } as unknown as Parameters<typeof createSurfaceEditor>[0], { region: EYE_REGION,
      layer: () => layer, selected: () => 0, select: () => {}, selectedField: () => undefined, selectField: () => {},
      begin: () => { checkpoints++; }, apply: (action) => applyAdapterProposal(layer, action), cancel: () => {}, message: () => {} });
    frame();
    const handle = editor.diagnostics().handles.find((h) => h.kind === "point" && h.index === 0)!;
    expect(handle.selectable).toBe(true);
    const emit = (type: string, [x, y]: number[]) => {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { clientX: x, clientY: y, pointerId: 1, button: 0, buttons: 1 }); canvas.dispatchEvent(event); return event;
    };
    expect(emit("pointerdown", [handle.screen.x, handle.screen.y]).defaultPrevented).toBe(true);
    // Straight down the screen to 3 mm below the lower lid margin, 4 px at a time: never paused, always moving on.
    const end = new THREE.Vector3(world(upper).x, lowerY - 0.003, centre.z).project(camera);
    const [x1, y1] = [(end.x + 1) * 500, (1 - end.y) * 500], steps = Math.ceil((y1 - handle.screen.y) / 4);
    const visited: number[] = [];
    for (let i = 1; i <= steps; i++) {
      emit("pointermove", [handle.screen.x + (x1 - handle.screen.x) * i / steps, handle.screen.y + (y1 - handle.screen.y) * i / steps]);
      expect(editor.diagnostics().lastDragRejection).toBeNull();
      visited.push(layer.points[0].v);
    }
    emit("pointerup", [x1, y1]);
    expect(checkpoints).toBe(1);
    // It crossed the opening (onto the bridge) and ended on the lower lid's plate surface, below where it started.
    frame();
    const after = editor.diagnostics().handles.find((h) => h.kind === "point" && h.index === 0)!;
    expect(after.bridge).toBe(false);
    expect(after.selectable).toBe(true);
    // Exactly the plate UV under the final pointer (the drawn handle sits 0.7 mm off the skin, so compare UV, not pixels).
    const caster = new THREE.Raycaster(); caster.setFromCamera(new THREE.Vector2(end.x, end.y), camera);
    const under = caster.intersectObject(plate, false)[0]!;
    expect(layer.points[0].u).toBeCloseTo(under.uv!.x, 5);
    expect(layer.points[0].v).toBeCloseTo(under.uv!.y, 5);
    expect(new Set(visited).size).toBeGreaterThan(steps * 0.8);
    editor.dispose();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window");
  }
});
