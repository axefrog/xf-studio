import { expect, test } from "bun:test";
import { createTrustedAuthoringCore } from "./fixtures/makeup-core";
import { namedCore } from "./fixtures/named-targets";
import { EYE_REGION, freshWorkspace } from "./fixtures/eye-region";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { parseWorkspace, serializeWorkspace } from "../src/app/workspace/makeup-workspace";
import { AuthoringDocument } from "./fixtures/makeup-document";
import { createLayeredEditorAdapters } from "../src/preview/browser/layered-editor-adapters";
import { defaultUVView, uvRegion, uvToPixel } from "../src/legacy/eye-makeup/uv-view";
import type { StudioAction } from "../src/app/studio-application";

function fixture(workspace = freshWorkspace()) {
  const core = namedCore(createTrustedAuthoringCore(workspace, {}, STUDIO_COMPOSITION));
  const dispatch = (action: Parameters<typeof core.app.dispatch>[0]) => expect(core.app.dispatch(action).ok).toBe(true);
  return { ...core, dispatch, selected: () => core.document.recipe.layers[core.document.active]?.id };
}

function dragOutAndBack(core: ReturnType<typeof fixture>) {
  const { app, document } = core, id = document.recipe.layers[0].id, u = document.recipe.layers[0].points[0].u;
  expect(app.beginGesture("uv", id)).toBe(true);
  expect(app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: u + .001 } })).toBe(true);
  expect(app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u } })).toBe(true);
  app.endGesture("uv");
  expect(app.history().depth).toBe(1);
  core.dispatch({ kind: "point.select", layerId: id, index: 1 });
  return id;
}

test.each([0, 1])("a reused gesture checkpoint cancels to its own selection baseline (later navigation: %i)", navigate => {
  const core = fixture(), { app, document, dispose } = core;
  try {
    const id = dragOutAndBack(core), before = structuredClone(document.recipe);
    expect(app.beginGesture("uv", id)).toBe(true);
    const u = document.recipe.layers[0].points[1].u;
    expect(app.applyGesture("uv", { kind: "point.replace", index: 1, next: { u: u + .001 } })).toBe(true);
    // Exercise the owner's cancellation baseline even if editor navigation happens during the run.
    if (navigate) document.selected = 0;
    app.endGesture("uv", true);
    expect(document.selected).toBe(1);
    expect(document.recipe).toEqual(before);
    expect(app.history()).toMatchObject({ depth: 1, redoDepth: 0 });
  } finally { dispose(); }
});

test.each(["gesture", "finish"] as const)("a reused checkpoint rebases selection for a committed %s edit", edit => {
  const core = fixture(), { app, document, dispatch, dispose } = core;
  try {
    const id = dragOutAndBack(core);
    if (edit === "gesture") {
      expect(app.beginGesture("uv", id)).toBe(true);
      const u = document.recipe.layers[0].points[1].u;
      expect(app.applyGesture("uv", { kind: "point.replace", index: 1, next: { u: u + .001 } })).toBe(true);
      app.endGesture("uv");
    } else dispatch({ kind: "layer.setFinish", layerId: id, finish: "metallic" });
    expect(app.history().depth).toBe(1);
    dispatch({ kind: "point.select", layerId: id, index: 2 });
    dispatch({ kind: "history.undo" });
    expect(document.selected).toBe(2);
    dispatch({ kind: "history.redo" });
    expect(document.selected).toBe(2);
  } finally { dispose(); }
});

function squareWorkspace() {
  const workspace = freshWorkspace(), layer = workspace.recipe.layers[0];
  layer.pathMode = "catmull-rom";
  layer.points = [ { u: .3, v: .3, weight: 0 }, { u: .7, v: .3, weight: .4 },
    { u: .7, v: .7, weight: 1 }, { u: .3, v: .7, weight: .6 } ];
  return workspace;
}

for (const selected of [99, 5, -1, 1.5]) test(`a path gesture rejects resulting selection ${selected} without changing content, selection or history`, () => {
  const core = fixture(squareWorkspace()), { app, document, dispose } = core;
  try {
    const id = dragOutAndBack(core), before = structuredClone(document.recipe), history = document.history.data(), timeline = document.history.timeline();
    const points = [...structuredClone(document.recipe.layers[0].points), { u: .2, v: .5, weight: .5 }];
    expect(app.beginGesture("uv", id)).toBe(true);
    const pending = document.history.data();
    expect(app.applyGesture("uv", { kind: "path.replacePoints", points, selected })).toBe(false);
    expect(document.recipe).toEqual(before);
    expect(document.selected).toBe(1);
    expect(document.history.data()).toEqual(pending);
    app.endGesture("uv");
    expect(document.recipe).toEqual(before);
    expect(document.selected).toBe(1);
    expect(document.history.data()).toEqual(history);
    expect(document.history.timeline()).toEqual(timeline);
  } finally { dispose(); }
});

test("a path gesture validates selection against the resulting contour rather than the old one", () => {
  const { app, document, dispose } = fixture(squareWorkspace());
  try {
    const layer = document.recipe.layers[0], points = [...structuredClone(layer.points), { u: .2, v: .5, weight: .5 }];
    expect(app.beginGesture("uv", layer.id)).toBe(true);
    expect(app.applyGesture("uv", { kind: "path.replacePoints", points, selected: 4 })).toBe(true);
    app.endGesture("uv");
    expect(document.recipe.layers[0].points).toHaveLength(5);
    expect(document.selected).toBe(4);
  } finally { dispose(); }
});

test("UV double-click publishes insertion and selection together, and Undo/Redo restore both endpoints", () => {
  const keys = ["document", "window", "ResizeObserver"] as const;
  const previous = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const context = new Proxy({}, { get: () => () => {} });
  const canvas = Object.assign(new EventTarget(), { width: 720, height: 310, style: {},
    getContext: () => context, getBoundingClientRect: () => ({ left: 10, top: 20, width: 720, height: 310 }),
    setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {} }) as unknown as HTMLCanvasElement;
  Object.assign(globalThis, { document: { createElement: () => ({ getContext: () => context }) },
    window: Object.assign(new EventTarget(), { devicePixelRatio: 1 }), ResizeObserver: class { observe() {} disconnect() {} } });
  const workspace = squareWorkspace(); workspace.recipe.layers[0].symmetry = false;
  const core = fixture(workspace), life = new AbortController();
  let editor: { dispose(): void } | undefined;
  try {
    const flat = createLayeredEditorAdapters(EYE_REGION).flat!.create(canvas, {
      state: { ...core, app: core.application }, source: "uv", signal: life.signal,
      look: () => ({ collection: "local", look: "local" }),
      complete: action => core.targets.complete(action, core.application.descriptor(action.kind)) as StudioAction,
      check: () => ({ available: true }), input() {}, message() {},
    }, { initial: defaultUVView(), persist() {}, canvases: () => [], albedo: () => undefined });
    editor = flat;
    const publications: { points: number; selected: number }[] = [];
    core.document.subscribe(change => { if (change === "recipe") publications.push({
      points: core.document.recipe.layers[0].points.length, selected: core.document.selected }); });
    const pixel = uvToPixel({ u: .75, v: .5 }, uvRegion(flat.snapshot()), 720, 310);
    canvas.ondblclick!.call(canvas, { button: 0, clientX: pixel.x + 10, clientY: pixel.y + 20,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false } as MouseEvent);
    expect(core.document.recipe.layers[0].points).toHaveLength(5);
    expect(core.document.selected).toBe(2);
    expect(core.document.history.timeline().steps.at(-1)?.label).toBe("Edit path");
    const afterInsertion = publications.slice();
    core.dispatch({ kind: "history.undo" });
    expect(core.document.recipe.layers[0].points).toHaveLength(4);
    expect(core.document.selected).toBe(0);
    core.dispatch({ kind: "history.redo" });
    expect(core.document.recipe.layers[0].points).toHaveLength(5);
    expect(core.document.selected).toBe(2);
    expect(afterInsertion).toEqual([{ points: 5, selected: 2 }]);
  } finally {
    editor?.dispose(); life.abort(); core.dispose();
    keys.forEach((key, i) => { const descriptor = previous[i];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
});

test("grouped removal and recreation of the selected warp restores selection even when the ID is reused", () => {
  const workspace = squareWorkspace(), layer = workspace.recipe.layers[0];
  layer.fields = [ { id: "W", u: .4, v: .4, du: 0, dv: 0, radius: .03 },
    { id: "V", u: .6, v: .5, du: 0, dv: 0, radius: .03 } ];
  workspace.fieldSelection = { [layer.id]: "W" };
  const { app, document, dispatch, dispose } = fixture(workspace);
  try {
    expect(app.transaction({ label: "Replace warp", actionKind: "test.replaceWarp" }, ["eye-makeup"], () => {
      dispatch({ kind: "field.remove", layerId: layer.id, fieldId: "W" });
      dispatch({ kind: "field.add", layerId: layer.id, fieldId: "W" });
      return { ok: true };
    }).ok).toBe(true);
    expect(document.fieldSelection[layer.id]).toBe("W");
    const endpoints = document.history.data().entries.at(-1)!.selection?.["eye-makeup"];
    expect(endpoints?.structural).toBe(true);
    expect(endpoints?.before).toEqual(endpoints?.after);
    dispatch({ kind: "field.select", layerId: layer.id, fieldId: "V" });
    dispatch({ kind: "history.undo" });
    expect(document.fieldSelection[layer.id]).toBe("W");
    dispatch({ kind: "field.select", layerId: layer.id, fieldId: "V" });
    dispatch({ kind: "history.redo" });
    expect(document.fieldSelection[layer.id]).toBe("W");
  } finally { dispose(); }
});

test("warp removal that leaves selection unchanged preserves later navigation", () => {
  const workspace = squareWorkspace(), layer = workspace.recipe.layers[0];
  layer.fields = ["W", "V", "Z"].map(id => ({ id, u: .4, v: .4, du: 0, dv: 0, radius: .03 }));
  workspace.fieldSelection = { [layer.id]: "V" };
  const { document, dispatch, dispose } = fixture(workspace);
  try {
    dispatch({ kind: "field.remove", layerId: layer.id, fieldId: "Z" });
    expect(document.fieldSelection[layer.id]).toBe("V");
    expect(document.history.data().entries.at(-1)!.selection?.["eye-makeup"]).toBeUndefined();
    dispatch({ kind: "field.select", layerId: layer.id, fieldId: "W" });
    dispatch({ kind: "history.undo" });
    expect(document.fieldSelection[layer.id]).toBe("W");
    dispatch({ kind: "history.redo" });
    expect(document.fieldSelection[layer.id]).toBe("W");
  } finally { dispose(); }
});

test.each(["remove", "insert"] as const)("point %s restores selection when topology reuses its numeric index", edit => {
  const { document, dispatch, dispose } = fixture(squareWorkspace());
  try {
    const id = document.recipe.layers[0].id, original = structuredClone(document.recipe.layers[0].points[1]);
    dispatch({ kind: "point.select", layerId: id, index: 1 });
    if (edit === "remove") dispatch({ kind: "point.remove", layerId: id, index: 1 });
    else dispatch({ kind: "point.insert", layerId: id, u: .5, v: .2 });
    expect(document.selected).toBe(1);
    const replacement = structuredClone(document.recipe.layers[0].points[1]);
    expect(replacement).not.toEqual(original);
    const endpoints = document.history.data().entries.at(-1)!.selection?.["eye-makeup"];
    expect(endpoints?.structural).toBe(true);
    expect(endpoints?.before).toEqual(endpoints?.after);
    const stored = serializeWorkspace({ ...freshWorkspace(), ...document.export() }, STUDIO_DOCUMENTS);
    const reloaded = new AuthoringDocument(parseWorkspace(JSON.parse(JSON.stringify(stored)), STUDIO_DOCUMENTS));
    try {
      reloaded.selected = 0;
      expect(reloaded.history.undo()).toBe(true);
      expect(reloaded.selected).toBe(1);
      reloaded.selected = 0;
      expect(reloaded.history.redo()).toBe(true);
      expect(reloaded.selected).toBe(1);
    } finally { reloaded.dispose(); }
    dispatch({ kind: "point.select", layerId: id, index: 0 });
    dispatch({ kind: "history.undo" });
    expect(document.selected).toBe(1);
    expect(document.recipe.layers[0].points[1]).toEqual(original);
    dispatch({ kind: "point.select", layerId: id, index: 0 });
    dispatch({ kind: "history.redo" });
    expect(document.selected).toBe(1);
    expect(document.recipe.layers[0].points[1]).toEqual(replacement);
  } finally { dispose(); }
});

test("one transaction replacing the selected point at the same index and count restores both selections", () => {
  const { app, document, dispatch, dispose } = fixture(squareWorkspace());
  try {
    const id = document.recipe.layers[0].id, original = structuredClone(document.recipe.layers[0].points[1]);
    dispatch({ kind: "point.select", layerId: id, index: 1 });
    expect(app.transaction({ label: "Replace point", actionKind: "test.replacePoint" }, ["eye-makeup"], () => {
      dispatch({ kind: "point.remove", layerId: id, index: 1 });
      dispatch({ kind: "point.insert", layerId: id, u: .5, v: .2 });
      return { ok: true };
    }).ok).toBe(true);
    expect(document.recipe.layers[0].points).toHaveLength(4);
    expect(document.selected).toBe(1);
    const replacement = structuredClone(document.recipe.layers[0].points[1]);
    expect(replacement).not.toEqual(original);
    dispatch({ kind: "point.select", layerId: id, index: 0 });
    dispatch({ kind: "history.undo" });
    expect(document.selected).toBe(1);
    expect(document.recipe.layers[0].points[1]).toEqual(original);
    dispatch({ kind: "point.select", layerId: id, index: 0 });
    dispatch({ kind: "history.redo" });
    expect(document.selected).toBe(1);
    expect(document.recipe.layers[0].points[1]).toEqual(replacement);
  } finally { dispose(); }
});

test.each(["same", "other"] as const)("deleting an unselected point in the %s contour preserves later navigation", contour => {
  const { document, dispatch, dispose } = fixture(squareWorkspace());
  try {
    const selectedLayer = document.recipe.layers[0], editedLayer = document.recipe.layers[contour === "same" ? 0 : 1];
    dispatch({ kind: "point.select", layerId: selectedLayer.id, index: 0 });
    dispatch({ kind: "point.remove", layerId: editedLayer.id, index: editedLayer.points.length - 1 });
    dispatch({ kind: "point.select", layerId: selectedLayer.id, index: 1 });
    dispatch({ kind: "history.undo" });
    expect(document.selected).toBe(1);
    expect(document.recipe.layers[document.active].id).toBe(selectedLayer.id);
    dispatch({ kind: "history.redo" });
    expect(document.selected).toBe(1);
    expect(document.recipe.layers[document.active].id).toBe(selectedLayer.id);
  } finally { dispose(); }
});

test("a failed insertion restores a reused step's saved endpoints and its later Undo and Redo", () => {
  const core = fixture(squareWorkspace()), { app, document, dispatch, dispose } = core;
  try {
    const id = dragOutAndBack(core), before = document.history.data();
    expect(app.transaction({ label: "Failed insertion", actionKind: "test.insertFailure" }, ["eye-makeup"], () => {
      dispatch({ kind: "point.insert", layerId: id, u: .5, v: .2 });
      return { ok: false, message: "Refused after insertion" };
    }).ok).toBe(false);
    expect(document.selected).toBe(1);
    expect(document.history.data()).toEqual(before);
    dispatch({ kind: "point.select", layerId: id, index: 0 });
    dispatch({ kind: "history.undo" });
    expect(document.selected).toBe(0);
    dispatch({ kind: "history.redo" });
    expect(document.selected).toBe(0);
  } finally { dispose(); }
});

test("add, finish, Undo twice and Redo twice reselect the restored layer", () => {
  const { document, dispatch, selected, dispose } = fixture();
  try {
    const original = selected();
    dispatch({ kind: "layer.edit", command: { kind: "add", newId: "restored-layer" } });
    dispatch({ kind: "layer.setFinish", layerId: "restored-layer", finish: "metallic" });
    dispatch({ kind: "history.undo" });
    dispatch({ kind: "history.undo" });
    expect(selected()).toBe(original);
    dispatch({ kind: "history.redo" });
    expect(selected()).toBe("restored-layer");
    dispatch({ kind: "history.redo" });
    expect(selected()).toBe("restored-layer");
    expect(document.recipe.layers[document.active].finish).toBe("metallic");
  } finally { dispose(); }
});

test.each([0, 2])("Undo delete restores the layer at point %i and Redo restores its original neighbour selection", point => {
  const { document, dispatch, selected, dispose } = fixture();
  try {
    const id = document.recipe.layers[2].id;
    dispatch({ kind: "point.select", layerId: id, index: point });
    dispatch({ kind: "layer.edit", command: { kind: "remove", id } });
    const neighbour = selected();
    dispatch({ kind: "history.undo" });
    expect(selected()).toBe(id);
    expect(document.selected).toBe(point);
    dispatch({ kind: "history.redo" });
    expect(selected()).toBe(neighbour);
  } finally { dispose(); }
});

test("a single add restores its original selections after navigation before either history move", () => {
  const { document, dispatch, selected, dispose } = fixture();
  try {
    const original = selected(), other = document.recipe.layers[1].id;
    dispatch({ kind: "layer.edit", command: { kind: "add", newId: "added" } });
    dispatch({ kind: "point.select", layerId: other, index: 2 });
    dispatch({ kind: "history.undo" });
    expect(selected()).toBe(original);
    dispatch({ kind: "point.select", layerId: other, index: 1 });
    dispatch({ kind: "history.redo" });
    expect(selected()).toBe("added");
    expect(document.selected).toBe(0);
  } finally { dispose(); }
});

test("selection endpoints survive saved workspace history, and old steps without them still load", () => {
  const { document, dispatch, dispose } = fixture();
  try {
    const original = document.recipe.layers[2].id;
    dispatch({ kind: "point.select", layerId: original, index: 2 });
    dispatch({ kind: "layer.edit", command: { kind: "add", newId: "persisted-layer" } });
    const stored = serializeWorkspace({ ...freshWorkspace(), ...document.export() }, STUDIO_DOCUMENTS);
    const restored = parseWorkspace(JSON.parse(JSON.stringify(stored)), STUDIO_DOCUMENTS);
    const reloaded = new AuthoringDocument(restored);
    try {
      expect(reloaded.history.undo()).toBe(true);
      expect(reloaded.recipe.layers[reloaded.active].id).toBe(original);
      expect(reloaded.selected).toBe(2);
      expect(reloaded.history.redo()).toBe(true);
      expect(reloaded.recipe.layers[reloaded.active].id).toBe("persisted-layer");
      const legacy = document.export();
      if (Array.isArray(legacy.history)) throw Error("Expected look history data.");
      for (const entry of legacy.history.entries) delete entry.selection;
      reloaded.restore(legacy);
      expect(reloaded.history.undo()).toBe(true);
      expect(reloaded.history.redo()).toBe(true);
      expect(reloaded.recipe.layers.some(layer => layer.id === "persisted-layer")).toBe(true);
    } finally { reloaded.dispose(); }
  } finally { dispose(); }
});

test("duplicate and history jumps restore the selection at each endpoint", () => {
  const { app, document, dispatch, selected, dispose } = fixture();
  try {
    const original = selected(), start = app.historyTimeline().startId;
    dispatch({ kind: "layer.edit", command: { kind: "duplicate", id: original!, newId: "copy-layer" } });
    dispatch({ kind: "layer.setFinish", layerId: "copy-layer", finish: "metallic" });
    const end = app.historyTimeline().steps.at(-1)!.id;
    dispatch({ kind: "history.jumpTo", entryId: start });
    expect(selected()).toBe(original);
    dispatch({ kind: "history.jumpTo", entryId: end });
    expect(selected()).toBe("copy-layer");
    expect(document.recipe.layers[document.active].finish).toBe("metallic");
  } finally { dispose(); }
});

test("Undo and Redo reorder keep the moved layer and its point selected", () => {
  const { document, dispatch, selected, dispose } = fixture();
  try {
    const id = document.recipe.layers[2].id;
    dispatch({ kind: "point.select", layerId: id, index: 2 });
    dispatch({ kind: "layer.edit", command: { kind: "move", id, to: 0 } });
    dispatch({ kind: "history.undo" });
    expect(selected()).toBe(id);
    expect(document.selected).toBe(2);
    dispatch({ kind: "history.redo" });
    expect(selected()).toBe(id);
    expect(document.selected).toBe(2);
  } finally { dispose(); }
});

test("a step that did not change selection preserves later navigation through Undo and Redo", () => {
  const { document, dispatch, selected, dispose } = fixture();
  try {
    const [edited, navigated] = document.recipe.layers;
    dispatch({ kind: "layer.setFinish", layerId: edited.id, finish: "metallic" });
    dispatch({ kind: "point.select", layerId: navigated.id, index: 2 });
    dispatch({ kind: "history.undo" });
    expect(selected()).toBe(navigated.id);
    expect(document.selected).toBe(2);
    dispatch({ kind: "history.redo" });
    expect(selected()).toBe(navigated.id);
    expect(document.selected).toBe(2);
  } finally { dispose(); }
});

test("index shifts without a selection change preserve later navigation", () => {
  const { document, dispatch, selected, dispose } = fixture();
  try {
    const [removed, , current, navigated] = document.recipe.layers;
    dispatch({ kind: "point.select", layerId: current.id, index: 2 });
    dispatch({ kind: "layer.edit", command: { kind: "remove", id: removed.id } });
    expect(selected()).toBe(current.id);
    dispatch({ kind: "point.select", layerId: navigated.id, index: 1 });
    dispatch({ kind: "history.undo" });
    expect(selected()).toBe(navigated.id);
    expect(document.selected).toBe(1);
    dispatch({ kind: "history.redo" });
    expect(selected()).toBe(navigated.id);
    expect(document.selected).toBe(1);
  } finally { dispose(); }
});

test("point removal restores the selected point in both directions", () => {
  const { document, dispatch, dispose } = fixture();
  try {
    const layer = document.recipe.layers[0], last = layer.points.length - 1;
    dispatch({ kind: "point.select", layerId: layer.id, index: last });
    dispatch({ kind: "point.remove", layerId: layer.id, index: last });
    expect(document.selected).toBe(last - 1);
    dispatch({ kind: "history.undo" });
    expect(document.selected).toBe(last);
    dispatch({ kind: "history.redo" });
    expect(document.selected).toBe(last - 1);
  } finally { dispose(); }
});

test("warp addition restores its selection through Undo and Redo", () => {
  const { document, dispatch, dispose } = fixture();
  try {
    const id = document.recipe.layers[0].id, before = structuredClone(document.fieldSelection);
    dispatch({ kind: "field.add", layerId: id, fieldId: "restored-warp" });
    dispatch({ kind: "history.undo" });
    expect(document.fieldSelection).toEqual(before);
    dispatch({ kind: "history.redo" });
    expect(document.fieldSelection[id]).toBe("restored-warp");
  } finally { dispose(); }
});
