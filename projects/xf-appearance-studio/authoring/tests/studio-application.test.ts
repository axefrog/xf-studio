import { expect, test } from "bun:test";
import { AuthoringControlEdits } from "../src/authoring-control-edits";
import { AuthoringDocument } from "../src/authoring-document";
import { AuthoringGestures } from "../src/authoring-gestures";
import { CollectionService } from "../src/collection-service";
import { collectionDraft } from "../src/collection-workspace";
import { applyLayerAction } from "../src/editor-actions";
import { RecipeActions } from "../src/recipe-actions";
import { StudioApplication } from "../src/studio-application";
import { freshWorkspace } from "../src/workspace-state";

function fixture() {
  const workspace = freshWorkspace(), document = new AuthoringDocument(workspace);
  const undo = () => { const prior = document.undoRecipe(); if (prior) document.recipe = prior; };
  const recipe = new RecipeActions(() => ({ recipe: document.recipe, active: document.active,
    selected: document.selected, fieldSelection: document.fieldSelection }),
  (next, effect) => document.applyActionState(next, effect), document, {}, () => "draft",
  index => document.gestureChanged(index));
  const gestures = new AuthoringGestures(document, recipe, undo);
  const controls = new AuthoringControlEdits(document, action => { recipe.dispatch(action); }, undo);
  const app = new StudioApplication({ document, recipe, gestures, controls,
    layer: action => {
      const next = applyLayerAction(document.recipe, document.recipe.layers[document.active]?.id, action);
      document.checkpoint(); document.recipe = next.recipe;
    } });
  return { workspace, document, app };
}

test("facade discovers target-specific commands, validates at invocation and detaches snapshots", () => {
  const { app, document } = fixture();
  const id = document.recipe.layers[1].id;
  const choices = app.actionsFor({ kind: "layer", id });
  expect(choices.find(item => item.action.kind === "layer.edit" && item.action.command.kind === "duplicate")?.capability.available).toBe(true);
  expect(app.actionsFor({ kind: "point", layerId: id, index: 999 })[1].capability.available).toBe(false);
  expect(app.actionKinds()).toContain("glitter.selectModel");
  expect(app.requestKinds()).toContain("package");
  const view = app.snapshot() as unknown as { document: { recipe: typeof document.recipe } };
  view.document.recipe.layers[1].name = "Forged";
  expect(document.recipe.layers[1].name).not.toBe("Forged");
  let notifications = 0; const unsubscribe = app.subscribe(() => notifications++);
  const duplicate = choices.find(item => item.action.kind === "layer.edit" && item.action.command.kind === "duplicate")!;
  expect(app.dispatch(duplicate.action).ok).toBe(true);
  expect(document.recipe.layers).toHaveLength(5);
  expect(document.undoDepth).toBe(1);
  expect(app.dispatch({ kind: "layer.edit", command: { kind: "remove", id: "stale" } })).toMatchObject({ ok: false });
  expect(notifications).toBeGreaterThan(0);
  unsubscribe();
});

test("facade groups form changes and hides live gesture targets", () => {
  const { app, document } = fixture(), id = document.recipe.layers[0].id;
  const before = document.recipe.layers[0].opacity;
  expect(app.controlBegin("opacity", id)).toBe(true);
  app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .5 });
  app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .6 });
  app.controlCommit("opacity");
  expect(document.undoDepth).toBe(1);
  expect(document.undoRecipe()?.layers[0].opacity).toBe(before);
  expect(app.canBeginGesture("uv", "stale")).toMatchObject({ available: false, code: "missing_target" });
  expect(app.beginGesture("uv", id)).toBe(true);
  expect(app.canBeginGesture("surface", id)).toMatchObject({ available: false, code: "busy" });
  expect(app.gestureCapability("uv", { kind: "point", index: 0 })).toEqual({ available: true });
  expect(app.gestureCapability("uv", { kind: "point", index: 999 }))
    .toMatchObject({ available: false, code: "missing_target" });
  const point = document.recipe.layers[0].points[0], originalU = point.u;
  expect(app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: originalU + .002 } })).toBe(true);
  app.endGesture("uv", true);
  expect(document.recipe.layers[0].points[0].u).toBe(originalU);
  expect(app.beginGesture("uv", id)).toBe(true);
  document.recipe = structuredClone(document.recipe);
  expect(app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: originalU + .002 } })).toBe(false);
  app.endGesture("uv");
});

test("facade exposes collection target capabilities and typed async outcomes", async () => {
  const { app, document, workspace } = fixture(), presetId = crypto.randomUUID();
  const collection = { schema: "xfas/collection-1" as const, id: crypto.randomUUID(),
    name: "Draft", presets: [{ id: presetId, name: "One", revision: 1, recipe: document.export().recipe }] };
  const service = new CollectionService(collectionDraft(collection), workspace.library,
    () => document.export(), editor => document.restore({ ...editor,
      fieldSelection: editor.fieldSelection ?? {} }), {
      list: async () => [], get: async () => { throw Error("not used"); },
      save: async () => { throw Error("not used"); }, package: async () => { throw Error("not used"); },
    });
  app.attach({ collection: service });
  const copy = app.actionsFor({ kind: "preset", id: presetId }).find(item =>
    item.action.kind === "preset.edit" && item.action.command.kind === "copy")!;
  expect(copy.capability.available).toBe(true);
  expect(copy.undo).toBe("none");
  expect(app.dispatch(copy.action).ok).toBe(true);
  expect(service.view().draft?.collection.presets).toHaveLength(2);
  expect(app.requestCapability({ kind: "package", action: "check" }).available).toBe(true);
  expect(await app.execute({ kind: "refresh" })).toMatchObject({ ok: true, result: { kind: "list" } });
  expect(app.dispatch({ kind: "preset.select", id: "stale" })).toMatchObject({ ok: false });
});

test("descriptors cover every public command, including nested variants and structured reasons", () => {
  const { app, document } = fixture(), layerId = document.recipe.layers[0].id;
  expect(app.actionKinds().length).toBe(Object.keys(app.actionDescriptors()).length);
  expect(app.requestKinds().length).toBe(Object.keys(app.requestDescriptors()).length);
  expect(Object.keys(app.gestureDescriptors())).toEqual([
    "shape.replace", "point.replace", "field.replace", "path.replacePoints"]);
  const layer = app.descriptorsFor({ kind: "layer", id: layerId });
  expect(layer.find(entry => entry.id === "layer.edit")?.variants?.rename.payload.name.maxLength).toBe(80);
  expect(layer.find(entry => entry.id === "glitter.setDirect")?.variants?.strength.payload.value.max).toBe(32);
  expect(layer.find(entry => entry.id === "layer.setOpacity")?.requiresInput).toBe(true);
  expect(app.descriptorsFor({ kind: "point", layerId, index: 999 })[0].targetCapability)
    .toMatchObject({ available: false, code: "missing_target" });
  expect(app.capability({ kind: "point.remove", layerId, index: 999 }))
    .toMatchObject({ available: false, code: "missing_target" });
  document.recipe.layers[0].points.splice(3);
  expect(app.capability({ kind: "point.remove", layerId, index: 0 }))
    .toMatchObject({ available: false, code: "limit" });
  expect(app.requestCapability({ kind: "save" }))
    .toMatchObject({ available: false, code: "not_ready" });
});

test("context queries validate target, payload and live enum choices for menus and shortcuts", () => {
  const { app, document } = fixture(), id = document.recipe.layers[0].id;
  const target = { kind: "layer" as const, id };
  expect(app.contextCapability(target, { kind: "layer.setOpacity", layerId: id, opacity: 1.1 }))
    .toMatchObject({ available: false, code: "limit" });
  expect(app.contextCapability(target, { kind: "layer.setOpacity", layerId: "wrong", opacity: .5 }))
    .toMatchObject({ available: false, code: "missing_target" });
  expect(app.contextCapability(target, { kind: "point.remove", layerId: id, index: 0 }))
    .toMatchObject({ available: false, code: "invalid_value" });
  const finishes = app.choicesFor(target, "layer.setFinish", "finish");
  expect(finishes.find(choice => choice.value === "glitter")?.capability.available).toBe(true);
  const models = app.choicesFor(target, "glitter.selectModel", "model");
  expect(models.find(choice => choice.value === "fine")?.capability)
    .toMatchObject({ available: false, code: "incompatible_mode" });
  expect(app.choicesFor({ kind: "viewport" }, "quality.set", "size").map(choice => choice.value))
    .toEqual([512, 1024, 2048, 4096]);
});
