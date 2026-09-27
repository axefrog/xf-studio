/**
 * The view graph service (research/authoring/view-graph-design.md §3, phase P1): nodes, sharing, link, fork and collect, validation
 * against scene kinds, the default one-view graph from the workspace's preview, persistence and the View and lighting history.
 */
import { expect, test } from "bun:test";
import { MAIN_VIEW, validViewId, viewPanelId, type ViewGraphChange } from "../src/platform/api/view-graph";
import { parseViewGraph, ViewGraph } from "../src/platform/core/view-graph";
import { createStudioViewGraph, defaultViewGraph, isDefaultViewGraph, previewMirror, storedViewGraph, STUDIO_VIEW_GRAPH_RULES,
  workspaceViewGraph } from "../src/preview-view-graph";
import { PreviewActions, type PreviewPort } from "../src/preview-actions";
import { parseWorkspace, serializeWorkspace } from "../src/workspace-state";
import { WorkspaceComposer } from "../src/workspace-composer";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { freshWorkspace } from "./fixtures/eye-region";

const graph = () => ({ graph: createStudioViewGraph(freshWorkspace().preview) });

test("the default graph is one main view over the workspace's preview, and mirrors it field for field", () => {
  const preview = freshWorkspace().preview;
  preview.camera = { position: [0, 1.6, -0.6], target: [0, 1.6, 0], fov: 30 };
  const data = defaultViewGraph(preview);
  expect(isDefaultViewGraph(data)).toBe(true);
  expect(data.views).toEqual([{ id: "main", kind: "3d", scene: "s1", camera: "c1", lights: "l1", display: "d1", tools: "t1" }]);
  expect(data.lights[0]).toMatchObject({ id: "l1", kind: "studio", exposure: 1.2, lightAngle: 329 });
  expect(data.tools[0]).toEqual({ id: "t1", on: { "eye-makeup.surface": true, "eye-makeup.wire": false } });
  const views = new ViewGraph(data, STUDIO_VIEW_GRAPH_RULES);
  // The mirror has the workspace's own field order, so a captured preview keeps its bytes.
  const { camera, ...mirror } = previewMirror(views);
  const expected = Object.fromEntries(Object.keys(mirror).map(key => [key, preview[key as keyof typeof preview]]));
  expect(JSON.stringify(mirror)).toBe(JSON.stringify(expected));
  expect(camera).toEqual(preview.camera);
  expect(viewPanelId(MAIN_VIEW)).toBe("head");
  expect(viewPanelId("v2")).toBe("view.v2");
});

test("a new view shares scene, lights and display, forks the camera and starts with fresh tools; a node lives while referenced", () => {
  const { graph: views } = graph(), changes: ViewGraphChange[] = [];
  views.subscribe(change => changes.push(change));
  const v2 = views.addView(MAIN_VIEW, { scene: true, lights: true, display: true }, { label: "New 3D view" });
  expect(v2).toBe("v2");
  expect(views.shares(MAIN_VIEW, v2, "lights")).toBe(true);
  expect(views.shares(MAIN_VIEW, v2, "camera")).toBe(false);
  expect(views.state(v2, "tools")).toEqual({ on: {} });
  expect(views.snapshot().views.map(view => [view.id, view.shared])).toEqual([["main", ["scene", "lights", "display"]], ["v2", ["scene", "lights", "display"]]]);
  expect(changes.at(-1)).toMatchObject({ structure: true, views: ["v2"], origin: "edit" });
  // A light change in either view reaches both (they share the rig); a camera change reaches only its own view.
  views.edit(v2, "lights", { state: { exposure: 2 } }, { label: "Exposure" });
  expect(views.state(MAIN_VIEW, "lights")).toMatchObject({ exposure: 2 });
  expect([...changes.at(-1)!.views].sort()).toEqual(["main", "v2"]);
  views.cameraMoved(v2, { pose: { position: [0, 1, 2], target: [0, 1, 0], fov: 40 } });
  expect(changes.at(-1)!.views).toEqual(["v2"]);
  // Unlink forks (both start identical); link points back at the other view's node and collects the fork.
  expect(views.unlink(v2, "lights", { label: "Unlink lights" })).toBe(true);
  expect(views.shares(MAIN_VIEW, v2, "lights")).toBe(false);
  expect(views.state(v2, "lights")).toEqual(views.state(MAIN_VIEW, "lights"));
  const fork = views.node(v2, "lights").id;
  expect(views.data().lights.map(node => node.id)).toContain(fork);
  views.link(v2, "lights", MAIN_VIEW, { label: "Link lights" });
  expect(views.data().lights.map(node => node.id)).not.toContain(fork);
  // Closing a view collects what only it referenced; the main view can't be closed.
  const camera = views.node(v2, "camera").id;
  views.closeView(v2, { label: "Close view" });
  expect(views.data().cameras.map(node => node.id)).not.toContain(camera);
  expect(() => views.closeView(MAIN_VIEW)).toThrow("can't be closed");
  expect(isDefaultViewGraph(views.data())).toBe(true);
});

test("edits are validated by the slot's codec, and a camera or rig must suit the view's scene kind", () => {
  const { graph: views } = graph();
  expect(() => views.edit(MAIN_VIEW, "lights", { state: { exposure: "bright" } })).toThrow("isn't valid");
  expect(() => views.edit(MAIN_VIEW, "lights", { kind: "sun" })).toThrow("isn't valid");
  expect(views.edit(MAIN_VIEW, "lights", { kind: "creator" })).toBe(true);
  expect(views.edit(MAIN_VIEW, "lights", { kind: "creator" })).toBe(false);
  expect(() => views.target("nowhere")).toThrow("no longer exists");
  // A location scene (World, P5) registers its own rules; a character camera can't link across.
  const rules = { ...STUDIO_VIEW_GRAPH_RULES, codecs: { ...STUDIO_VIEW_GRAPH_RULES.codecs,
    scene: { kinds: ["character", "location"], parse: (state: Readonly<Record<string, unknown>>, kind: string | undefined) =>
      kind === "location" ? {} : STUDIO_VIEW_GRAPH_RULES.codecs.scene.parse(state, kind) },
    camera: { kinds: ["orbit", "fly"], parse: STUDIO_VIEW_GRAPH_RULES.codecs.camera.parse } },
  scenes: [...STUDIO_VIEW_GRAPH_RULES.scenes, { kind: "location", cameras: ["fly"], rigs: ["studio"] }] };
  const data = defaultViewGraph(freshWorkspace().preview);
  const world = parseViewGraph({ ...data, views: [...data.views, { id: "w1", kind: "3d", scene: "s9", camera: "c9", lights: "l1", display: "d1", tools: "t1" }],
    scenes: [...data.scenes, { id: "s9", kind: "location" }], cameras: [...data.cameras, { id: "c9", kind: "fly" }] }, rules);
  expect(world).toBeDefined();
  const mixed = new ViewGraph(world!, rules);
  expect(() => mixed.link(MAIN_VIEW, "camera", "w1")).toThrow("can't look at a character scene");
  // A graph whose view breaks its scene's rules, names a missing node or lacks the main view is refused as a whole.
  expect(parseViewGraph({ ...data, cameras: [{ id: "c1", kind: "fly" }] }, rules)).toBeUndefined();
  expect(parseViewGraph({ ...data, views: [{ ...data.views[0], camera: "c7" }] }, STUDIO_VIEW_GRAPH_RULES)).toBeUndefined();
  expect(parseViewGraph({ ...data, views: [{ ...data.views[0], id: "other" }], focused: "other" }, STUDIO_VIEW_GRAPH_RULES)).toBeUndefined();
});

test("the View and lighting history records settings and camera jumps, coalesces a drag until it is sealed, and never records navigation or tools", () => {
  const { graph: views } = graph();
  // One drag is one step however long it pauses; releasing the slider seals it, so the next drag is a step of its own (CORE-95).
  for (const value of [1.3, 1.4, 1.5]) views.edit(MAIN_VIEW, "lights", { state: { exposure: value } }, { label: "Exposure", coalesce: "exposure" });
  expect(views.history()).toEqual({ undo: "Exposure", depth: 1, redoDepth: 0 });
  views.seal();
  views.edit(MAIN_VIEW, "lights", { state: { exposure: 1.6 } }, { label: "Exposure", coalesce: "exposure" });
  expect(views.history().depth).toBe(2);
  // A different edit also ends the run: the same slider afterwards starts a new step.
  views.edit(MAIN_VIEW, "lights", { state: { lightAngle: 300 } }, { label: "Key light direction", coalesce: "angle" });
  views.edit(MAIN_VIEW, "lights", { state: { exposure: 1.7 } }, { label: "Exposure", coalesce: "exposure" });
  expect(views.history().depth).toBe(4);
  views.undo(); views.undo();
  expect(views.history().depth).toBe(2);

  views.edit(MAIN_VIEW, "tools", { state: { on: { "eye-makeup.surface": false } } });
  views.cameraMoved(MAIN_VIEW, { pose: { position: [0, 1, 2], target: [0, 1, 0], fov: 30 } });
  expect(views.history().depth).toBe(2);
  // A jump records where the camera really was (the device's pose), not the node's older one.
  const orbit = { position: [0.3, 1.6, -0.5], target: [0, 1.6, 0], fov: 30 }, front = { position: [0, 1.67, -0.6], target: [0, 1.67, 0], fov: 30 };
  views.cameraJump(MAIN_VIEW, { pose: orbit }, { pose: front }, "Front view");
  expect(views.history()).toMatchObject({ undo: "Front view", depth: 3 });
  const changes: ViewGraphChange[] = [];
  views.subscribe(change => changes.push(change));
  expect(views.undo()).toBe(true);
  expect(views.state(MAIN_VIEW, "camera")).toEqual({ pose: orbit });
  expect(changes.at(-1)).toMatchObject({ origin: "history", applied: false, views: ["main"] });
  expect(views.undo()).toBe(true);
  expect(views.state(MAIN_VIEW, "lights")).toMatchObject({ exposure: 1.5 });
  expect(views.redo()).toBe(true);
  expect(views.state(MAIN_VIEW, "lights")).toMatchObject({ exposure: 1.6 });
  // Undo restores only the nodes a step touched: the tool toggle and the camera stay as they are.
  expect(views.state(MAIN_VIEW, "tools")).toEqual({ on: { "eye-makeup.surface": false } });
  // Restore-time state records nothing.
  views.withoutHistory(() => views.edit(MAIN_VIEW, "display", { state: { brows: false } }, { label: "Hide eyebrows" }));
  views.edit(MAIN_VIEW, "display", { state: { lashes: false } }, { label: "Hide eyelashes", seed: true });
  expect(views.history()).toMatchObject({ undo: "Exposure", redo: "Front view" });
  // Graph edits undo too: a closed view comes back with its own nodes.
  const v2 = views.addView(MAIN_VIEW, { scene: true }, { label: "New 3D view" });
  views.edit(v2, "lights", { state: { exposure: 3 } }, { label: "Exposure" });
  views.closeView(v2, { label: "Close view" });
  expect(views.has(v2)).toBe(false);
  views.undo();
  expect(views.state(v2, "lights")).toMatchObject({ exposure: 3 });
  expect(views.shares(MAIN_VIEW, v2, "scene")).toBe(true);
});

test("each camera keeps a Back and Forward trail of its jumps, shared by views that share the camera", () => {
  const { graph: views } = graph();
  const a = { position: [0, 1.6, -1], target: [0, 1.6, 0], fov: 30 }, b = { position: [0, 1.67, -0.6], target: [0, 1.67, 0], fov: 30 },
    c = { position: [0, 1, -3], target: [0, 1, 0], fov: 30 };
  views.cameraJump(MAIN_VIEW, { pose: a }, { pose: b }, "Front view");
  views.cameraJump(MAIN_VIEW, { pose: b }, { pose: c }, "Whole body view");
  const v2 = views.addView(MAIN_VIEW, { camera: true, scene: true, lights: true, display: true });
  expect(views.cameraTrail(v2)).toEqual({ back: 2, forward: 0 });
  expect(views.cameraStep(v2, "back", { pose: c })).toBe(true);
  expect(views.state(MAIN_VIEW, "camera")).toEqual({ pose: b });
  expect(views.cameraTrail(MAIN_VIEW)).toEqual({ back: 1, forward: 1 });
  expect(views.cameraStep(MAIN_VIEW, "forward", { pose: b })).toBe(true);
  expect(views.state(MAIN_VIEW, "camera")).toEqual({ pose: c });
  expect(views.cameraStep(MAIN_VIEW, "forward", { pose: c })).toBe(false);
});

test("a workspace that never adds a view keeps its bytes; one with views round-trips and mirrors its main view into preview", () => {
  const workspace = freshWorkspace();
  workspace.preview.camera = { position: [0, 1.6, -0.6], target: [0, 1.6, 0], fov: 30 };
  const bytes = JSON.stringify(serializeWorkspace(workspace, STUDIO_DOCUMENTS));
  const restored = parseWorkspace(JSON.parse(bytes), STUDIO_DOCUMENTS);
  expect(restored.views).toBeUndefined();
  const views = createStudioViewGraph(restored.preview, restored.views);
  expect(storedViewGraph(views)).toBeUndefined();
  expect(JSON.stringify(serializeWorkspace(restored, STUDIO_DOCUMENTS))).toBe(bytes);
  // Add a view: the graph is now stored, and survives a round trip.
  const v2 = views.addView(MAIN_VIEW, { scene: true, lights: true }, { title: "Whole body" });
  views.edit(v2, "display", { state: { hair: false } });
  const withViews = { ...restored, views: storedViewGraph(views) };
  const read = parseWorkspace(JSON.parse(JSON.stringify(serializeWorkspace(withViews, STUDIO_DOCUMENTS))), STUDIO_DOCUMENTS);
  expect(read.views).toEqual(views.data());
  // The legacy preview fields win for the main view (an older build may have changed them): no appearance change.
  read.preview.exposure = 2.5;
  const again = workspaceViewGraph(read.preview, read.views);
  expect(again.lights.find(node => node.id === again.views[0].lights)).toMatchObject({ exposure: 2.5 });
  expect(new ViewGraph(again, STUDIO_VIEW_GRAPH_RULES).state(v2, "display")).toMatchObject({ hair: false });
  // A damaged graph falls back to the default one.
  expect(parseWorkspace({ ...JSON.parse(bytes), views: { schema: "xfs/view-graph-1", views: [] } }, STUDIO_DOCUMENTS).views).toBeUndefined();
});

test("the composer stores the graph only when it differs from the default one", () => {
  const workspace = freshWorkspace(), views = createStudioViewGraph(workspace.preview);
  const ports = { editor: () => ({ recipe: workspace.recipe, active: 0, selected: 0, history: workspace.history, fieldSelection: {} }),
    uvView: () => workspace.uvView, savedV: () => undefined, collections: () => undefined, quality: () => workspace.preview.textureSize,
    preview: () => undefined, motion: () => undefined, views: () => storedViewGraph(views) };
  const composer = new WorkspaceComposer(workspace, ports as never);
  expect("views" in composer.capture()).toBe(false);
  views.addView(MAIN_VIEW, { scene: true });
  expect(composer.capture().views?.views).toHaveLength(2);
});

test("preview actions edit the graph node of the view they name, and the device follows the view it draws", () => {
  const calls: string[] = [];
  let camera = { position: [0, 1.6, -0.6], target: [0, 1.6, 0.005], fov: 30 };
  const port: PreviewPort = { cameraState: () => camera, front: () => { camera = { ...camera, position: [0, 1.67, -0.6] }; calls.push("front"); return false; },
    setFov: () => false, endFovGesture: () => {}, restoreCamera: next => { camera = next; calls.push("restore"); },
    setExposure: value => calls.push(`exposure:${value}`), setLightAngle: () => calls.push("angle"), setStudioLights: () => calls.push("studio"),
    setSurfaceControls: enabled => calls.push(`surface:${enabled}`), setWire: () => {}, setNormals: () => {}, setEyeOptics: () => {},
    setHair: enabled => calls.push(`hair:${enabled}`), setEyeShape: () => {}, setPiercings: () => {}, setDetail: () => {} };
  const workspace = freshWorkspace(), views = createStudioViewGraph(workspace.preview);
  const actions = new PreviewActions(workspace.preview, port, views);
  actions.dispatch({ kind: "preview.setExposure", value: 2 });
  expect(calls).toEqual(["exposure:2"]);
  expect(views.history().undo).toBe("Exposure");
  // Undo in the View and lighting history: the device follows the graph.
  views.undo();
  expect(calls.at(-1)).toBe("exposure:1.2");
  expect(actions.snapshot().exposure).toBe(1.2);
  // A second view that shares the lights: editing it changes what the shown view draws; its own display does not.
  const v2 = views.addView(MAIN_VIEW, { scene: true, lights: true });
  calls.length = 0;
  actions.dispatch({ kind: "preview.setExposure", value: 3, view: v2 });
  actions.dispatch({ kind: "preview.setHair", enabled: false, view: v2 });
  expect(calls).toEqual(["exposure:3"]);
  expect(actions.snapshot().hair).toBe(true);
  expect(actions.capability({ kind: "camera.front", view: v2 })).toMatchObject({ available: false, reason: "That view isn't shown." });
  expect(actions.capability({ kind: "preview.setHair", enabled: true, view: "gone" })).toMatchObject({ available: false });
  // A camera jump: the device computes it, the graph records it, Undo moves the device back.
  calls.length = 0;
  actions.dispatch({ kind: "camera.front" });
  expect(calls).toEqual(["front"]);
  expect(views.cameraTrail(MAIN_VIEW).back).toBe(1);
  views.undo();
  expect(calls).toEqual(["front", "restore"]);
  expect(camera.position).toEqual([0, 1.6, -0.6]);
  // Tools record nothing; a released head stops following the graph.
  actions.dispatch({ kind: "preview.setSurfaceControls", enabled: false });
  expect(calls.at(-1)).toBe("surface:false");
  actions.dispose();
  calls.length = 0;
  views.edit(MAIN_VIEW, "lights", { state: { exposure: 1.7 } });
  expect(calls).toEqual([]);
});

test("every structure edit records a step, an unrecorded one clears the history it would break, and a replay is checked first (CORE-94)", () => {
  const { graph: views } = graph();
  const v2 = views.addView(MAIN_VIEW, { scene: true });
  expect(views.history()).toMatchObject({ undo: "New view", depth: 1 });
  expect(views.unlink(v2, "scene")).toBe(true);
  expect(views.history()).toMatchObject({ undo: "Unlink scene", depth: 2 });
  views.edit(v2, "lights", { state: { exposure: 3 } }, { label: "Exposure" });
  // A structure change the history doesn't hold (a restore) leaves no step that could name its removed nodes.
  views.withoutHistory(() => views.closeView(v2));
  expect(views.history()).toMatchObject({ depth: 0, redoDepth: 0 });
  expect(views.undo()).toBe(false);
  expect(views.viewIds()).toEqual([MAIN_VIEW]);
  // The check itself: a step whose views would name a missing node is dropped with the steps behind it, and nothing changes.
  views.edit(MAIN_VIEW, "lights", { state: { exposure: 2 } }, { label: "Exposure" });
  const broken = { views: [{ id: MAIN_VIEW, kind: "3d", scene: "s1", camera: "gone", lights: "l1", display: "d1", tools: "t1" }], focused: MAIN_VIEW };
  (views as unknown as { undoSteps: unknown[] }).undoSteps.push({ label: "Broken", nodes: new Map(), structure: { before: broken, after: broken } });
  const changes: ViewGraphChange[] = [];
  views.subscribe(change => changes.push(change));
  expect(views.undo()).toBe(false);
  expect(views.history()).toMatchObject({ depth: 0 });
  expect(views.state(MAIN_VIEW, "lights")).toMatchObject({ exposure: 2 });
  expect(changes).toHaveLength(1);
  expect(views.node(MAIN_VIEW, "camera").id).toBe("c1");
});

test("a camera jump that didn't move the camera records nothing and leaves no Back step", () => {
  const { graph: views } = graph();
  const pose = { position: [0, 1.67, -0.6], target: [0, 1.67, 0.005], fov: 30 };
  views.cameraJump(MAIN_VIEW, { pose }, { pose }, "Front view");
  expect(views.cameraTrail(MAIN_VIEW)).toEqual({ back: 0, forward: 0 });
  expect(views.history().depth).toBe(0);
  expect(views.state(MAIN_VIEW, "camera")).toEqual({ pose });
});

test("node codecs enforce the ranges parseWorkspace does (CORE-96)", () => {
  const { graph: views } = graph();
  expect(() => views.edit(MAIN_VIEW, "scene", { state: { eyeShape: 999.5 } })).toThrow("isn't valid");
  expect(() => views.edit(MAIN_VIEW, "scene", { state: { eyeShape: -1 } })).toThrow("isn't valid");
  expect(views.edit(MAIN_VIEW, "scene", { state: { eyeShape: 3.4 } })).toBe(true);
  expect(views.state(MAIN_VIEW, "scene")).toMatchObject({ eyeShape: 3 });
  expect(() => views.edit(MAIN_VIEW, "lights", { state: { exposure: 100 } })).toThrow("isn't valid");
  expect(() => views.edit(MAIN_VIEW, "lights", { state: { lightAngle: 400 } })).toThrow("isn't valid");
  for (const pose of [{ position: [0, 1.6, -60], target: [0, 1.6, 60], fov: 30 }, { position: [0, 1.6, -0.6], target: [0, 1.6, 0], fov: 5 },
    { position: [0, 1.6, -200], target: [0, 1.6, -199], fov: 30 }])
    expect(() => views.cameraMoved(MAIN_VIEW, { pose })).toThrow("isn't valid");
  // A far orbit a narrow lens, a tall pane or the whole body needs (the scene's limits, camera-framing.ts) is a valid pose.
  views.cameraMoved(MAIN_VIEW, { pose: { position: [0, .93, -40], target: [0, .93, 0], fov: 10 } });
  expect(views.state(MAIN_VIEW, "camera")).toEqual({ pose: { position: [0, .93, -40], target: [0, .93, 0], fov: 10 } });
  // The same values are refused on read, from the graph and from the legacy fields alike.
  const data = defaultViewGraph(freshWorkspace().preview);
  expect(parseViewGraph({ ...data, scenes: [{ ...data.scenes[0], eyeShape: 999.5 }] }, STUDIO_VIEW_GRAPH_RULES)).toBeUndefined();
  const bytes = serializeWorkspace(freshWorkspace(), STUDIO_DOCUMENTS) as { preview: Record<string, unknown> };
  const read = parseWorkspace({ ...bytes, preview: { ...bytes.preview, eyeShape: 999.5, exposure: 100, camera: { position: [0, 1.6, -60], target: [0, 1.6, 60], fov: 30 } } }, STUDIO_DOCUMENTS);
  expect([read.preview.eyeShape, read.preview.exposure, read.preview.camera]).toEqual([9, 1.2, undefined]);
});

test("a main-view tool the legacy fields can't hold is kept on save (CORE-97)", () => {
  const workspace = freshWorkspace(), views = createStudioViewGraph(workspace.preview);
  const on = views.state<{ on: Record<string, boolean> }>(MAIN_VIEW, "tools").on;
  expect(storedViewGraph(views)).toBeUndefined();
  views.edit(MAIN_VIEW, "tools", { state: { on: { ...on, "poses.menu": true } } });
  const stored = storedViewGraph(views);
  expect(stored).toBeDefined();
  const read = parseWorkspace(JSON.parse(JSON.stringify(serializeWorkspace({ ...workspace, views: stored }, STUDIO_DOCUMENTS))), STUDIO_DOCUMENTS);
  // The legacy field still wins for Surface controls (an older build may have changed it); the other tool is kept.
  read.preview.surface = false;
  expect(createStudioViewGraph(read.preview, read.views).state(MAIN_VIEW, "tools"))
    .toEqual({ on: { "eye-makeup.surface": false, "eye-makeup.wire": false, "poses.menu": true } });
});

test("view IDs the gestures and the viewport port reserve are refused (CORE-98)", () => {
  for (const id of ["uv", "surface", "head"]) expect(validViewId(id)).toBe(false);
  expect(validViewId("v2")).toBe(true);
  const data = defaultViewGraph(freshWorkspace().preview);
  const extra = { id: "uv", kind: "3d", scene: "s1", camera: "c1", lights: "l1", display: "d1", tools: "t1" };
  expect(parseViewGraph({ ...data, views: [...data.views, extra] }, STUDIO_VIEW_GRAPH_RULES)).toBeUndefined();
});

test("views and nodes of kinds this build doesn't know are kept and written back unchanged, never drawn", () => {
  const workspace = freshWorkspace(), data = defaultViewGraph(workspace.preview);
  // A newer build's World view (a location seen by a fly camera, sharing the main view's lights) and a 2D map view.
  const newer = { ...data,
    views: [data.views[0], { id: "w1", kind: "3d", title: "Night City", scene: "s9", camera: "c9", lights: "l1", display: "d1", tools: "t9", pinned: true },
      { id: "m1", kind: "map2d", lights: "l1", zoom: 3 }],
    scenes: [...data.scenes, { id: "s9", kind: "location", sectors: [1, 2] }], cameras: [...data.cameras, { id: "c9", kind: "fly", speed: 2 }],
    tools: [...data.tools, { id: "t9", on: {} }], focused: "w1" };
  const parsed = parseViewGraph(newer, STUDIO_VIEW_GRAPH_RULES);
  expect(parsed).toEqual({ ...newer, focused: MAIN_VIEW });
  const views = new ViewGraph(parsed!, STUDIO_VIEW_GRAPH_RULES);
  expect(views.viewIds()).toEqual([MAIN_VIEW]);
  expect(views.snapshot().views.map(view => view.id)).toEqual([MAIN_VIEW]);
  expect(isDefaultViewGraph(views.data())).toBe(false);
  // Edits here never touch them: new IDs avoid theirs, and a node they name stays while they do.
  const v2 = views.addView(MAIN_VIEW, { scene: true, lights: true });
  views.unlink(MAIN_VIEW, "lights");
  views.closeView(v2);
  expect(views.data().views.map(view => view.id)).toEqual([MAIN_VIEW, "w1", "m1"]);
  expect(views.data().lights.map(node => node.id)).toContain("l1");
  expect(views.data().scenes).toContainEqual({ id: "s9", kind: "location", sectors: [1, 2] });
  // Through a workspace round trip too.
  const read = parseWorkspace(JSON.parse(JSON.stringify(serializeWorkspace({ ...workspace, views: parsed }, STUDIO_DOCUMENTS))), STUDIO_DOCUMENTS);
  expect(read.views).toEqual(parsed);
  // Damage is still refused: a kept view naming a missing node, or a main view this build can't show.
  expect(parseViewGraph({ ...newer, views: [data.views[0], { id: "m1", kind: "map2d", lights: "l7" }] }, STUDIO_VIEW_GRAPH_RULES)).toBeUndefined();
  expect(parseViewGraph({ ...newer, views: [{ ...data.views[0], scene: "s9" }], focused: MAIN_VIEW }, STUDIO_VIEW_GRAPH_RULES)).toBeUndefined();
});
