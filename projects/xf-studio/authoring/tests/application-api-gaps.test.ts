import { expect, test } from "bun:test";
import { CollectionService, type CollectionTransport } from "../src/collection-service";
import { collectionDraft } from "../src/collection-workspace";
import { cancelsGesture } from "../src/gesture-cancel";
import { IRREGULAR_RANGE_MESSAGE } from "../src/engines/layered-makeup/recipe-actions";
import { StudioFileOperations } from "../src/studio-file-operations";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { freshWorkspace } from "./fixtures/eye-region";

export function coreFixture() {
  const workspace = freshWorkspace();
  const core = createTrustedAuthoringCore(workspace, { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
  return { workspace, core, app: core.app, document: core.document };
}
const unusedTransport: CollectionTransport = { list: async () => [], get: async () => { throw Error("not used"); },
  save: async () => { throw Error("not used"); }, package: async () => { throw Error("not used"); } };
export function withCollection(transport: CollectionTransport = unusedTransport) {
  const fixture = coreFixture(), { document, workspace, app } = fixture, presetId = crypto.randomUUID();
  const collection = { schema: "xfas/collection-1" as const, id: crypto.randomUUID(), name: "Draft",
    presets: [{ id: presetId, name: "One", revision: 1, recipe: document.export().recipe }] };
  const service = new CollectionService(STUDIO_DOCUMENTS, collectionDraft(collection, STUDIO_DOCUMENTS), workspace.library, () => document.export(),
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
  expect(app.fileKinds()).toEqual(["recipe.import", "recipe.export", "mask.export", "savedV.import", "savedV.export", "characterPreset.import", "characterPreset.export",
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
  expect(app.capability({ kind: "history.redo" })).toMatchObject({ available: false });
  expect(app.dispatch({ kind: "layer.setColor", layerId: id, color: "#112233" }).ok).toBe(true);
  expect(app.dispatch({ kind: "layer.edit", command: { kind: "rename", id, name: "Wing" } }).ok).toBe(true);
  expect(app.history().undo).toEqual({ label: "Rename layer", actionKind: "layer.edit.rename", layerId: id });
  expect(app.dispatch({ kind: "history.undo" }).ok).toBe(true);
  expect(app.history()).toMatchObject({ undo: { label: "Colour" }, redo: { label: "Rename layer" }, depth: 1, redoDepth: 1 });
  expect(app.dispatch({ kind: "history.undo" }).ok).toBe(true);
  expect(document.recipe.layers[0].color).not.toBe("#112233");
  expect(app.dispatch({ kind: "history.redo" }).ok).toBe(true);
  expect(app.dispatch({ kind: "history.redo" }).ok).toBe(true);
  expect(document.recipe.layers[0]).toMatchObject({ color: "#112233", name: "Wing" });
  expect(app.history()).toMatchObject({ undo: { label: "Rename layer" }, depth: 2, redoDepth: 0 });
  expect(app.dispatch({ kind: "history.undo" }).ok).toBe(true);
  expect(app.capability({ kind: "history.redo" }).available).toBe(true);
  expect(app.dispatch({ kind: "layer.setOpacity", layerId: id, opacity: .3 }).ok).toBe(true);
  expect(app.capability({ kind: "history.redo" })).toMatchObject({ available: false, reason: expect.stringContaining("redo") });
  expect(app.dispatch({ kind: "history.undo" }).ok).toBe(true);
  document.restore(document.export());
  expect(app.history().redoDepth).toBe(0);
});

test("form and gesture transactions are labelled by their first edit; cancelling never creates Redo", () => {
  const { app, document } = coreFixture(), id = document.recipe.layers[0].id, u = document.recipe.layers[0].points[0].u;
  app.controlBegin("opacity", id);
  app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .25 });
  app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .35 });
  expect(app.capability({ kind: "history.undo" })).toMatchObject({ available: false, code: "busy" });
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
  // The refusal says why in the person's terms, so the Colour & finish panel shows it as it is (UI-54).
  expect(app.capability({ kind: "glitter.setIrregular", layerId: id, key: "count", value: 40000 }))
    .toMatchObject({ available: false, reason: IRREGULAR_RANGE_MESSAGE, issue: { code: "range", field: "count" } });
  expect(IRREGULAR_RANGE_MESSAGE).toContain("denser than 32,768 flakes need flakes of 0.06% UV or smaller");
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

test("draft persistence compares the live draft with the library revision it was saved or opened from", async () => {
  const library = new Map<string, { collection: import("../src/platform/api").LookCollection; revision: number }>();
  const transport: CollectionTransport = {
    list: async () => [...library.values()].map(item => ({ id: item.collection.id, name: item.collection.name, revision: item.revision,
      presetCount: item.collection.presets.length, updated: "now" })) as never,
    get: async id => structuredClone(library.get(id)!) as never,
    save: async (collection, revision) => {
      const stored = { collection: structuredClone(collection), revision: (revision ?? 0) + 1 };
      library.set(collection.id, stored); return structuredClone(stored) as never; },
    package: async () => { throw Error("not used"); } };
  const { app, document, presetId, service } = withCollection(transport);
  expect(service.persistence()).toMatchObject({ baseline: "none", dirty: true, dirtyPresets: [presetId], structureDirty: true });
  expect(await app.execute({ kind: "save" })).toMatchObject({ ok: true });
  expect(service.persistence()).toMatchObject({ baseline: "known", savedRevision: 1, dirty: false, dirtyPresets: [], structureDirty: false });
  const layerId = document.recipe.layers[0].id, u = document.recipe.layers[0].points[0].u;
  app.beginGesture("uv", layerId);
  app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: u + .004 } });
  app.endGesture("uv");
  expect(service.persistence()).toMatchObject({ dirty: true, dirtyPresets: [presetId], structureDirty: false });
  expect(app.dispatch({ kind: "history.undo" }).ok).toBe(true);
  expect(service.persistence()).toMatchObject({ dirty: false });
  expect(app.dispatch({ kind: "collection.rename", name: "Other" }).ok).toBe(true);
  expect(service.persistence()).toMatchObject({ dirty: true, dirtyPresets: [], structureDirty: true });
  expect(app.dispatch({ kind: "collection.rename", name: "Draft" }).ok).toBe(true);
  expect(service.persistence()?.dirty).toBe(false);
  // Naming the collection's mod through the application is a collection change too; an empty name goes back to the default.
  const productId = service.summary().products![0].id;
  expect(app.capability({ kind: "package.rename", productId, modName: "a|b" })).toMatchObject({ available: false, code: "invalid_value" });
  expect(app.dispatch({ kind: "package.rename", productId, modName: "My looks" }).ok).toBe(true);
  expect(service.persistence()).toMatchObject({ dirty: true, dirtyPresets: [], structureDirty: true });
  expect(app.dispatch({ kind: "package.rename", productId, modName: "" }).ok).toBe(true);
  expect(service.persistence()?.dirty).toBe(false);
  expect(app.capability({ kind: "package.split", feature: "eye-makeup" })).toMatchObject({ available: false, code: "unavailable" });

  // After a reload the restored draft knows only its revision until initialize loads that revision once.
  const restored = coreFixture();
  const reloaded = new CollectionService(STUDIO_DOCUMENTS, service.snapshot(), restored.workspace.library, () => restored.document.export(),
    editor => restored.document.restore({ ...editor, fieldSelection: editor.fieldSelection ?? {} }), transport,
    () => ({ recipe: restored.document.recipe, revision: restored.document.geometryVersion.revision }));
  expect(reloaded.persistence()).toMatchObject({ baseline: "unknown", savedRevision: 1 });
  expect(reloaded.persistence()?.dirty).toBeUndefined();
  expect(await reloaded.execute({ kind: "initialize" })).toMatchObject({ ok: true });
  expect(reloaded.persistence()).toMatchObject({ baseline: "known" });
});

test("an empty saved collection initializes with a known baseline", async () => {
  const empty = { schema: "xfas/collection-1" as const, id: crypto.randomUUID(), name: "Makeup collection", presets: [] };
  const fixture = coreFixture();
  const service = new CollectionService(STUDIO_DOCUMENTS, undefined, fixture.workspace.library, () => fixture.document.export(),
    editor => fixture.document.restore({ ...editor, fieldSelection: editor.fieldSelection ?? {} }), {
      list: async () => [{ id: empty.id, name: empty.name, revision: 1 }] as never,
      get: async () => ({ collection: structuredClone(empty), revision: 1 }) as never,
      save: async () => { throw Error("not used"); }, package: async () => { throw Error("not used"); } },
    () => ({ recipe: fixture.document.recipe, revision: fixture.document.geometryVersion.revision }));
  expect(await service.execute({ kind: "initialize" })).toMatchObject({ ok: true });
  expect(service.persistence()).toMatchObject({ baseline: "known", savedRevision: 1, dirty: true, structureDirty: true });
});

test("async work is one activity list linked to request IDs, and cancellation is honestly refused", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const transport: CollectionTransport = { list: async () => [], get: async () => { throw Error("not used"); },
    save: async (collection, revision) => { await gate; return { collection: structuredClone(collection), revision: (revision ?? 0) + 1 } as never; },
    package: async () => { throw Error("not used"); } };
  const { service, document } = withCollection(transport);
  const files = new StudioFileOperations({ pick: async () => undefined, download: () => {}, bakeMask: async () => new Blob() }, {
    recipe: () => document.recipe, selectedLayer: () => document.recipe.layers[0], importRecipe: () => {},
    hasSavedV: () => false, savedV: () => undefined, loadSavedV: () => { throw Error("not used"); }, savedVReady: () => false,
    executeCollection: request => service.execute(request), recoverCollection: () => {} });
  files.attachCollection(service);
  expect(files.activity()).toEqual([]);
  const saving = files.executeCollection({ kind: "save" });
  const [active] = files.activity();
  expect(active).toMatchObject({ scope: "collection", kind: "save", cancellable: false, requestId: 1 });
  expect(files.snapshot().progress).toMatchObject({ phase: "working", requestId: 1 });
  expect(service.cancel(1)).toMatchObject({ accepted: false, reason: expect.stringContaining("cannot be cancelled") });
  expect(files.cancel(active.id)).toMatchObject({ accepted: false, reason: expect.stringContaining("cannot be cancelled") });
  expect(files.cancel("file-99").reason).toContain("Nothing");
  const refused = await service.execute({ kind: "refresh" });
  expect(refused).toMatchObject({ ok: false, code: "unavailable" });
  expect((refused as { requestId?: number }).requestId).toBeUndefined();
  release();
  expect(await saving).toMatchObject({ ok: true, requestId: 1 });
  expect(files.activity()).toEqual([]);
  expect(files.snapshot().progress).toMatchObject({ phase: "success", requestId: 1 });
});

test("consequences say what an action replaces, writes or discards and how to recover", () => {
  const { app, document, presetId, service } = withCollection();
  const layerId = document.recipe.layers[0].id;
  expect(app.consequences({ action: { kind: "layer.select", layerId } })).toEqual({ discards: [], recoverableBy: "none", confirm: false });
  expect(app.consequences({ action: { kind: "layer.edit", command: { kind: "remove", id: layerId } } }))
    .toEqual({ replaces: "layer-content", recoverableBy: "history.undo", discards: [], confirm: false });
  expect(app.consequences({ action: { kind: "preset.edit", command: { kind: "remove", id: presetId } } }))
    .toMatchObject({ replaces: "preset", recoverableBy: "preset.restore", confirm: false });
  expect(app.consequences({ file: { kind: "collection.export" } })).toMatchObject({ writes: "library-revision", confirm: false });
  expect(app.consequences({ request: { kind: "package", action: "build" } })).toMatchObject({ writes: "private-files" });
  app.dispatch({ kind: "layer.setOpacity", layerId, opacity: .2 });
  app.dispatch({ kind: "history.undo" });
  expect(app.consequences({ action: { kind: "history.undo" } }).recoverableBy).toBe("none");
  expect(app.consequences({ action: { kind: "layer.setColor", layerId, color: "#000000" } }).discards)
    .toEqual([{ kind: "redo", label: "Opacity" }]);
  // Fill the four-draft recovery queue; the next open would evict the oldest draft and needs confirmation.
  const other = (name: string) => ({ schema: "xfas/collection-1" as const, id: crypto.randomUUID(), name,
    presets: [{ id: crypto.randomUUID(), name: "P", revision: 1, recipe: document.export().recipe }] });
  expect(app.consequences({ file: { kind: "collection.import" } })).toMatchObject({ replaces: "draft", confirm: false });
  for (const name of ["A", "B", "C", "D"]) expect(app.dispatch({ kind: "collection.open", collection: other(name) }).ok).toBe(true);
  const summary = service.summary().draft!;
  expect(summary.recoveryCount).toBe(summary.recoveryLimit);
  expect(app.consequences({ file: { kind: "collection.import" } })).toEqual({ replaces: "draft", recoverableBy: "collection.undoOpen",
    discards: [{ kind: "recovery-draft", label: summary.oldestRecoverable!.name, id: summary.oldestRecoverable!.id }], confirm: true });
});

test("the viewport snapshot carries UV selection visibility and view-change notifications", async () => {
  const { ViewportAttachment } = await import("../src/viewport-attachment");
  let selection: { point?: { index: number; visible: boolean } } | undefined = { point: { index: 2, visible: false } };
  const attachment = new ViewportAttachment<object>({ moveHost: () => {}, measure: () => ({ width: 10, height: 10 }), resize: () => {},
    cancelInput: () => {}, inputCapture: () => false, headView: () => undefined, uvView: () => undefined,
    uvSelection: () => selection, uvCommand: () => true, hitAt: () => undefined,
    queryContext: () => { throw Error("not used"); } });
  let notified = 0; attachment.subscribe(() => notified++);
  expect(attachment.snapshot().uv.selection).toEqual({ point: { index: 2, visible: false } });
  attachment.viewChanged();
  expect(notified).toBe(1);
  selection = undefined;
  expect("selection" in attachment.snapshot().uv).toBe(false);
});

test("coordinate commands edit geometry with one Undo each and refuse invalid targets", () => {
  const { app, document } = coreFixture(), layer = document.recipe.layers[0], id = layer.id;
  const count = layer.points.length, fieldId = layer.fields[0]?.id;
  expect(app.dispatch({ kind: "point.move", layerId: id, index: 1, u: .41, v: .26 }).ok).toBe(true);
  expect(document.recipe.layers[0].points[1]).toMatchObject({ u: .41, v: .26 });
  expect(app.history().undo).toMatchObject({ label: "Move point" });
  expect(app.capability({ kind: "point.move", layerId: id, index: 99, u: .4, v: .2 })).toMatchObject({ available: false, code: "missing_target" });
  expect(app.contextCapability({ kind: "point", layerId: id, index: 1 }, { kind: "point.move", layerId: id, index: 1, u: 1.5, v: .2 }))
    .toMatchObject({ code: "limit", issue: { field: "u" } });
  const p0 = document.recipe.layers[0].points[0], p1 = document.recipe.layers[0].points[1];
  expect(app.dispatch({ kind: "point.insert", layerId: id, u: (p0.u + p1.u) / 2, v: (p0.v + p1.v) / 2 }).ok).toBe(true);
  expect(document.recipe.layers[0].points).toHaveLength(count + 1);
  expect(document.selected).toBe(1);
  const before = JSON.stringify(document.recipe.layers[0].points.map(p => [p.u, p.v]));
  expect(app.dispatch({ kind: "shape.transform", layerId: id, command: { kind: "translate", du: .01, dv: 0 } }).ok).toBe(true);
  expect(document.recipe.layers[0].points[0].u).toBeCloseTo(p0.u + .01, 9);
  expect(app.history().undo?.label).toBe("Move shape");
  const pivot = document.recipe.layers[0].points[1];
  expect(app.dispatch({ kind: "shape.transform", layerId: id, command: { kind: "scale", factor: 1.1 } }).ok).toBe(true);
  expect(document.recipe.layers[0].points[1]).toMatchObject({ u: pivot.u, v: pivot.v });
  expect(app.capability({ kind: "shape.transform", layerId: id, command: { kind: "rotate", radians: .1 }, pivotIndex: 99 }))
    .toMatchObject({ available: false, issue: { field: "pivotIndex" } });
  expect(app.dispatch({ kind: "shape.transform", layerId: id, command: { kind: "translate", du: 5, dv: 0 } }).ok).toBe(false);
  app.dispatch({ kind: "history.undo" }); app.dispatch({ kind: "history.undo" });
  expect(JSON.stringify(document.recipe.layers[0].points.map(p => [p.u, p.v]))).toBe(before);
  if (fieldId) {
    expect(app.dispatch({ kind: "field.setOrigin", layerId: id, fieldId, u: .35, v: .22 }).ok).toBe(true);
    expect(app.dispatch({ kind: "field.setVector", layerId: id, fieldId, du: .01, dv: -.005 }).ok).toBe(true);
    expect(document.recipe.layers[0].fields[0]).toMatchObject({ u: .35, v: .22, du: .01, dv: -.005 });
    expect(app.contextCapability({ kind: "field", layerId: id, id: fieldId }, { kind: "field.setVector", layerId: id, fieldId, du: .5, dv: 0 }).code).toBe("limit");
  }
});

test("tangent commands need Bézier handles and respect the tangent mode", () => {
  const { app, document } = coreFixture(), id = document.recipe.layers[0].id;
  if (document.recipe.layers[0].pathMode !== "bezier") {
    expect(app.capability({ kind: "point.setTangent", layerId: id, index: 0, side: "out", du: .01, dv: 0 }))
      .toMatchObject({ available: false, code: "incompatible_mode" });
    expect(app.dispatch({ kind: "path.edit", layerId: id, command: { kind: "enable-bezier" } }).ok).toBe(true);
  }
  expect(app.dispatch({ kind: "path.edit", layerId: id, command: { kind: "point-mode", index: 0, mode: "symmetric" } }).ok).toBe(true);
  expect(app.dispatch({ kind: "point.setTangent", layerId: id, index: 0, side: "out", du: .02, dv: .01 }).ok).toBe(true);
  const handles = document.recipe.layers[0].points[0].handles!;
  expect(handles.mode).toBe("symmetric");
  expect([handles.out.u, handles.out.v, handles.in.u, handles.in.v].map(x => +x.toFixed(9))).toEqual([.02, .01, -.02, -.01]);
  expect(app.history().undo?.label).toBe("Tangent");
});

test("the contour point limit refuses insertion with a structured issue", () => {
  const { app, document } = coreFixture(), id = document.recipe.layers[0].id;
  for (let guard = 0; guard < 40 && document.recipe.layers[0].points.length < 24; guard++) {
    const pts = document.recipe.layers[0].points, a = pts[0], b = pts[1];
    app.dispatch({ kind: "point.insert", layerId: id, u: (a.u + b.u) / 2, v: (a.v + b.v) / 2 });
  }
  expect(document.recipe.layers[0].points).toHaveLength(24);
  expect(app.capability({ kind: "point.insert", layerId: id, u: .3, v: .3 })).toMatchObject({ available: false, code: "limit", issue: { field: "points" } });
});

test("camera and UV navigation commands are view-only and bounded", async () => {
  const { navigateCamera } = await import("../src/camera-navigation");
  const state = { position: [0, 0, 1], target: [0, 0, 0], fov: 30 };
  const orbited = navigateCamera(state, { kind: "orbit", yaw: Math.PI / 2, pitch: 0 });
  expect(orbited.position[0]).toBeCloseTo(1, 9); expect(Math.hypot(...orbited.position)).toBeCloseTo(1, 9);
  const flipped = navigateCamera(state, { kind: "orbit", yaw: 0, pitch: 10 });
  expect(flipped.position[1]).toBeLessThan(1); expect(flipped.position[1]).toBeGreaterThan(.99);
  expect(Math.hypot(...navigateCamera(state, { kind: "dolly", factor: .001 }).position)).toBeCloseTo(.1, 9);
  expect(Math.hypot(...navigateCamera(state, { kind: "dolly", factor: 100 }).position)).toBeCloseTo(3.5, 9);
  const panned = navigateCamera(state, { kind: "pan", dx: .5, dy: 0 });
  expect(panned.target[0]).toBeCloseTo(panned.position[0], 9); expect(panned.target[0]).not.toBe(0);
  expect(navigateCamera(state, { kind: "dolly", factor: -1 })).toEqual(state);
  const { app } = coreFixture();
  expect(app.actionKinds()).toContain("camera.navigate");
  expect(app.capability({ kind: "camera.navigate", command: { kind: "orbit", yaw: .1, pitch: 0 } }).available).toBe(false);
  const { ViewportAttachment } = await import("../src/viewport-attachment");
  const moves: unknown[] = [];
  const attachment = new ViewportAttachment<object>({ moveHost: () => {}, measure: () => ({ width: 10, height: 10 }), resize: () => {},
    cancelInput: () => {}, inputCapture: () => false, headView: () => undefined, uvView: () => undefined, uvCommand: () => true,
    uvNavigate: command => { moves.push(command); return true; }, hitAt: () => undefined, queryContext: () => { throw Error("not used"); } });
  expect(attachment.uvNavigateCapability({ kind: "pan", du: .1, dv: 0 }).available).toBe(false);
  attachment.setReady("uv");
  expect(attachment.uvNavigateCapability({ kind: "zoom", factor: 0 }).available).toBe(false);
  expect(attachment.uvNavigate({ kind: "zoom", factor: 2, at: { u: .3, v: .3 } })).toBe(true);
  expect(moves).toEqual([{ kind: "zoom", factor: 2, at: { u: .3, v: .3 } }]);
});
