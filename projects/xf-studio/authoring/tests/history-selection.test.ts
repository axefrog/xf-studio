import { expect, test } from "bun:test";
import { createTrustedAuthoringCore } from "./fixtures/makeup-core";
import { namedCore } from "./fixtures/named-targets";
import { freshWorkspace } from "./fixtures/eye-region";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { parseWorkspace, serializeWorkspace } from "../src/app/workspace/makeup-workspace";
import { AuthoringDocument } from "./fixtures/makeup-document";

function fixture() {
  const core = namedCore(createTrustedAuthoringCore(freshWorkspace(), {}, STUDIO_COMPOSITION));
  const dispatch = (action: Parameters<typeof core.app.dispatch>[0]) => expect(core.app.dispatch(action).ok).toBe(true);
  return { ...core, dispatch, selected: () => core.document.recipe.layers[core.document.active]?.id };
}

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
