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

test("limitsFor publishes static and state-dependent input limits for a concrete target", () => {
  const { app, document } = coreFixture(), layer = document.recipe.layers[0], id = layer.id;
  expect(app.limitsFor({ kind: "layer", id }, "layer.setOpacity")).toEqual({ opacity: { min: 0, max: 1, unit: "fraction" } });
  expect(app.limitsFor({ kind: "layer", id }, "layer.edit", "move").to).toEqual({ min: 0, max: 3, unit: "index" });
  expect(app.limitsFor({ kind: "layer", id }, "layer.edit", "rename").name).toMatchObject({ minLength: 1, maxLength: 80 });
  expect(app.dispatch({ kind: "layer.setFinish", layerId: id, finish: "glitter" }).ok).toBe(true);
  expect(app.dispatch({ kind: "glitter.selectModel", layerId: id, model: "irregular" }).ok).toBe(true);
  const target = { kind: "layer" as const, id };
  const dense = app.limitsFor(target, "glitter.setIrregular", "radius").value;
  expect(dense).toMatchObject({ min: .00025, max: .0006, dependsOn: ["count"], unit: "uv" });
  expect(dense.note).toContain("Dense");
  expect(app.dispatch({ kind: "glitter.setIrregular", layerId: id, key: "count", value: 20000 }).ok).toBe(true);
  expect(app.limitsFor(target, "glitter.setIrregular", "radius").value).toMatchObject({ min: .0004, max: .003 });
  expect(app.dispatch({ kind: "glitter.setIrregular", layerId: id, key: "radius", value: .002 }).ok).toBe(true);
  const count = app.limitsFor(target, "glitter.setIrregular", "count").value;
  expect(count).toMatchObject({ min: 0, max: 32768, dependsOn: ["radius"] });
  expect(app.dispatch({ kind: "glitter.setIrregular", layerId: id, key: "count", value: 40000 }).ok).toBe(false);
  const other = document.recipe.layers[1].id;
  app.dispatch({ kind: "softness.edit", layerId: other, command: { kind: "variable-softness", enabled: false } });
  expect(app.limitsFor({ kind: "point", layerId: other, index: 0 }, "softness.edit", "point-softness").value.requires?.reason)
    .toContain("point edge softness");
});

test("refusals carry structured validation issues instead of text to parse", () => {
  const { app, document, presetId } = withCollection(), front = document.recipe.layers.at(-1)!.id;
  const back = document.recipe.layers[0].id;
  expect(app.capability({ kind: "layer.edit", command: { kind: "move", id: front, to: document.recipe.layers.length } }))
    .toMatchObject({ available: false, code: "limit", reason: "This layer is already at the front.", issue: { code: "range", field: "to" } });
  expect(app.capability({ kind: "layer.edit", command: { kind: "move", id: back, to: -1 } }).reason).toBe("This layer is already at the back.");
  expect(app.capability({ kind: "layer.edit", command: { kind: "rename", id: back, name: "   " } }))
    .toMatchObject({ code: "invalid_value", issue: { code: "name.blank", field: "name" } });
  expect(app.capability({ kind: "layer.edit", command: { kind: "rename", id: back, name: "x".repeat(81) } }).issue?.code).toBe("name.too-long");
  expect(app.capability({ kind: "preset.edit", command: { kind: "rename", id: presetId, name: "" } }).issue?.code).toBe("name.blank");
  expect(app.capability({ kind: "preset.edit", command: { kind: "move", id: presetId, to: 1 } }).reason).toBe("This preset is already last.");
  expect(app.capability({ kind: "collection.rename", name: " " }).issue?.code).toBe("name.blank");
  expect(app.capability({ kind: "glitter.setIrregular", layerId: back, key: "count", value: 1 }))
    .toMatchObject({ code: "incompatible_mode", issue: { code: "mode", field: "finish" } });
  expect(app.contextCapability({ kind: "layer", id: back }, { kind: "layer.setOpacity", layerId: back, opacity: 2 }))
    .toMatchObject({ code: "limit", issue: { code: "range", field: "opacity" } });
  expect(app.contextCapability({ kind: "layer", id: back }, { kind: "layer.setOpacity", layerId: back } as never))
    .toMatchObject({ code: "needs_input", issue: { code: "required", field: "opacity" } });
});

test("save progress and list refreshes keep an open collection menu bound; content edits invalidate it", async () => {
  const saved: { collection: unknown; revision: number }[] = [];
  const transport: CollectionTransport = { list: async () => [], get: async () => { throw Error("not used"); },
    save: async (collection, revision) => { const stored = { collection: structuredClone(collection), revision: (revision ?? 0) + 1 };
      saved.push(stored); return stored as never; },
    package: async () => { throw Error("not used"); } };
  const { app, presetId, service } = withCollection(transport);
  const query = app.contextQuery({ kind: "preset", id: presetId });
  const copy = { kind: "preset.edit", command: { kind: "copy", id: presetId } } as const;
  expect(app.boundActionCapability(query.context, copy).available).toBe(true);
  const before = service.contentVersion();
  expect(await app.execute({ kind: "save" })).toMatchObject({ ok: true });
  expect(await app.execute({ kind: "refresh" })).toMatchObject({ ok: true });
  expect(saved).toHaveLength(1);
  expect(service.contentVersion()).toBe(before);
  expect(app.boundActionCapability(query.context, copy).available).toBe(true);
  expect(app.dispatch({ kind: "preset.edit", command: { kind: "rename", id: presetId, name: "Renamed" } }).ok).toBe(true);
  expect(app.boundActionCapability(query.context, copy)).toMatchObject({ available: false, code: "missing_target" });
});
