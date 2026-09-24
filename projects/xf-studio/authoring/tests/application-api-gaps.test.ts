import { expect, test } from "bun:test";
import { CollectionService, type CollectionTransport } from "../src/collection-service";
import { collectionDraft } from "../src/collection-workspace";
import { cancelsGesture } from "../src/gesture-cancel";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { freshWorkspace } from "../src/workspace-state";

export function coreFixture() {
  const workspace = freshWorkspace();
  const core = createTrustedAuthoringCore(workspace, { resetStack: () => {}, selectedCollection: () => "draft",
    controlAction: action => { core.recipe.dispatch(action); } });
  return { workspace, core, app: core.app, document: core.document };
}
const unusedTransport: CollectionTransport = { list: async () => [], get: async () => { throw Error("not used"); },
  save: async () => { throw Error("not used"); }, package: async () => { throw Error("not used"); } };
export function withCollection(transport: CollectionTransport = unusedTransport) {
  const fixture = coreFixture(), { document, workspace, app } = fixture, presetId = crypto.randomUUID();
  const collection = { schema: "xfas/collection-1" as const, id: crypto.randomUUID(), name: "Draft",
    presets: [{ id: presetId, name: "One", revision: 1, recipe: document.export().recipe }] };
  const service = new CollectionService(collectionDraft(collection), workspace.library, () => document.export(),
    editor => document.restore({ ...editor, fieldSelection: editor.fieldSelection ?? {} }), transport);
  app.attach({ collection: service });
  return { ...fixture, service, presetId };
}

test("gesture cancel keys ignore letter case but never plain z", () => {
  expect(cancelsGesture({ key: "Escape", ctrlKey: false, metaKey: false })).toBe(true);
  expect(cancelsGesture({ key: "z", ctrlKey: true, metaKey: false })).toBe(true);
  expect(cancelsGesture({ key: "Z", ctrlKey: true, metaKey: false })).toBe(true);
  expect(cancelsGesture({ key: "Z", ctrlKey: false, metaKey: true })).toBe(true);
  expect(cancelsGesture({ key: "z", ctrlKey: false, metaKey: false })).toBe(false);
});

test("a gesture commits an open form transaction, so a late Escape cannot revert the gesture", () => {
  const { app, document } = coreFixture(), layer = document.recipe.layers[0], id = layer.id;
  const u = layer.points[0].u;
  expect(app.controlBegin("opacity", id)).toBe(true);
  app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .42 });
  expect(app.beginGesture("uv", id)).toBe(true);
  expect(app.snapshot().control).toBeUndefined();
  expect(app.controlBegin("opacity", id)).toBe(false);
  app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .9 });
  expect(app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: u + .002 } })).toBe(true);
  app.endGesture("uv");
  app.controlCancel("opacity");
  expect(document.recipe.layers[0].opacity).toBe(.42);
  expect(document.recipe.layers[0].points[0].u).toBeCloseTo(u + .002, 9);
  expect(document.undoDepth).toBe(2);
});

test("content edits are refused while a loaded collection has no selected preset", () => {
  const { app, presetId, service } = withCollection();
  expect(app.capability({ kind: "layer.edit", command: { kind: "add" } }).available).toBe(true);
  expect(app.dispatch({ kind: "preset.edit", command: { kind: "remove", id: presetId } }).ok).toBe(true);
  expect(service.selectedPreset()).toEqual({ loaded: true, id: undefined });
  expect(app.capability({ kind: "layer.edit", command: { kind: "add" } }))
    .toMatchObject({ available: false, code: "missing_target", reason: expect.stringContaining("preset") });
  expect(app.dispatch({ kind: "layer.edit", command: { kind: "add" } }).ok).toBe(false);
  expect(app.capability({ kind: "preset.edit", command: { kind: "add" } }).available).toBe(true);
  expect(app.dispatch({ kind: "preset.edit", command: { kind: "restore" } }).ok).toBe(true);
  expect(app.capability({ kind: "layer.edit", command: { kind: "add" } }).available).toBe(true);
});

test("file workflow IDs are part of the one application registry with unique IDs", () => {
  const { app } = coreFixture();
  expect(app.fileKinds()).toEqual(["recipe.import", "recipe.export", "mask.export", "savedV.import", "savedV.export",
    "collection.import", "collection.export", "collection.plan", "package.check", "package.build", "collection.recover"]);
  const registry = app.registry(), ids = registry.map(entry => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(registry.filter(entry => entry.family === "file").map(entry => entry.id)).toEqual(app.fileKinds());
  expect(registry.filter(entry => entry.family === "action")).toHaveLength(app.actionKinds().length);
  expect(app.fileDescriptors()["collection.export"]).toMatchObject({ savesFirst: true, async: true, cancellable: false });
  expect(app.fileDescriptors()["collection.import"].undo).toBe("recovery");
  const detached = app.fileDescriptors(); (detached["package.check"] as { cancellable: boolean }).cancellable = true;
  expect(app.fileDescriptors()["package.check"].cancellable).toBe(false);
});

test("Undo and Redo are labelled application actions; a new edit or preset switch discards Redo", () => {
  const { app, document } = coreFixture(), id = document.recipe.layers[0].id;
  expect(app.history()).toEqual({ undo: undefined, redo: undefined, depth: 0, redoDepth: 0 });
  expect(app.capability({ kind: "recipe.redo" })).toMatchObject({ available: false });
  expect(app.dispatch({ kind: "layer.setColor", layerId: id, color: "#112233" }).ok).toBe(true);
  expect(app.dispatch({ kind: "layer.edit", command: { kind: "rename", id, name: "Wing" } }).ok).toBe(true);
  expect(app.history().undo).toEqual({ label: "Rename layer", actionKind: "layer.edit.rename", layerId: id });
  expect(app.dispatch({ kind: "recipe.undo" }).ok).toBe(true);
  expect(app.history()).toMatchObject({ undo: { label: "Colour" }, redo: { label: "Rename layer" }, depth: 1, redoDepth: 1 });
  expect(app.dispatch({ kind: "recipe.undo" }).ok).toBe(true);
  expect(document.recipe.layers[0].color).not.toBe("#112233");
  expect(app.dispatch({ kind: "recipe.redo" }).ok).toBe(true);
  expect(app.dispatch({ kind: "recipe.redo" }).ok).toBe(true);
  expect(document.recipe.layers[0]).toMatchObject({ color: "#112233", name: "Wing" });
  expect(app.history()).toMatchObject({ undo: { label: "Rename layer" }, depth: 2, redoDepth: 0 });
  expect(app.dispatch({ kind: "recipe.undo" }).ok).toBe(true);
  expect(app.capability({ kind: "recipe.redo" }).available).toBe(true);
  expect(app.dispatch({ kind: "layer.setOpacity", layerId: id, opacity: .3 }).ok).toBe(true);
  expect(app.capability({ kind: "recipe.redo" })).toMatchObject({ available: false, reason: expect.stringContaining("redo") });
  expect(app.dispatch({ kind: "recipe.undo" }).ok).toBe(true);
  document.restore(document.export());
  expect(app.history().redoDepth).toBe(0);
});

test("form and gesture transactions are labelled by their first edit; cancelling never creates Redo", () => {
  const { app, document } = coreFixture(), id = document.recipe.layers[0].id, u = document.recipe.layers[0].points[0].u;
  app.controlBegin("opacity", id);
  app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .25 });
  app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .35 });
  expect(app.capability({ kind: "recipe.undo" })).toMatchObject({ available: false, code: "busy" });
  app.controlCommit("opacity");
  expect(app.history().undo).toMatchObject({ label: "Opacity", actionKind: "layer.setOpacity" });
  app.beginGesture("uv", id);
  app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: u + .003 } });
  app.endGesture("uv", true);
  expect(app.history()).toMatchObject({ undo: { label: "Opacity" }, redoDepth: 0, depth: 1 });
  app.beginGesture("uv", id);
  app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: u + .003 } });
  app.endGesture("uv");
  expect(app.history().undo).toMatchObject({ label: "Move point", actionKind: "gesture.point.replace", layerId: id });
  const restored = coreFixture(); restored.document.restore({ ...document.export() });
  expect(restored.app.history().undo).toEqual({ label: "Earlier change", actionKind: "unknown" });
});
