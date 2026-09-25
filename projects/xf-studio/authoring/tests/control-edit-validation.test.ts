import { expect, test } from "bun:test";
import { CollectionServiceError } from "../src/collection-service";
import { PreviewQualityActions } from "../src/preview-quality-actions";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { freshWorkspace } from "../src/workspace-state";

const makeCore = () => createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "draft" });

test("capability applies descriptor payload ranges to every entry point, not only context menus", () => {
  const { app, document } = makeCore(), id = document.recipe.layers[0].id;
  expect(app.capability({ kind: "layer.setOpacity", layerId: id, opacity: 1.5 }))
    .toMatchObject({ available: false, code: "limit", issue: { code: "range", field: "opacity" } });
  expect(app.capability({ kind: "layer.setOpacity", layerId: id, opacity: Number.NaN }))
    .toMatchObject({ available: false, code: "invalid_value" });
  expect(app.capability({ kind: "field.setReach", layerId: id, fieldId: "x", radius: 5 }).available).toBe(false);
  expect(app.capability({ kind: "layer.setOpacity", layerId: id, opacity: .5 })).toEqual({ available: true });
  // Dispatch uses the same gate: an out-of-range value never reaches the recipe.
  const before = document.recipe.layers[0].opacity;
  expect(app.dispatch({ kind: "layer.setOpacity", layerId: id, opacity: 2 })).toMatchObject({ ok: false, code: "limit" });
  expect(document.recipe.layers[0].opacity).toBe(before);
  // The domain's own wording still wins for a range it can explain.
  const last = document.recipe.layers.length;
  expect(app.capability({ kind: "layer.edit", command: { kind: "move", id, to: last } }))
    .toMatchObject({ available: false, reason: "This layer is already at the front." });
});

test("controlEdit validates like dispatch, returns typed results and never opens a transaction when refused", () => {
  const { app, document } = makeCore(), id = document.recipe.layers[0].id;
  const before = document.recipe.layers[0].opacity;
  const refused = app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: 7 });
  expect(refused).toMatchObject({ ok: false, code: "limit" });
  expect(app.snapshot().control).toBeUndefined();
  expect(document.undoDepth).toBe(0);
  expect(app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: "missing", opacity: .5 }))
    .toMatchObject({ ok: false, code: "missing_target" });
  expect(app.controlEdit("opacity", { kind: "layer.select", layerId: id })).toMatchObject({ ok: false, code: "invalid_value" });
  expect(app.snapshot().control).toBeUndefined();

  // Inside an open transaction a refused value leaves the recipe and the transaction intact.
  expect(app.controlBegin("opacity", id)).toBe(true);
  expect(app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .4 })).toEqual({ ok: true, result: true });
  expect(app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: -1 })).toMatchObject({ ok: false });
  expect(document.recipe.layers[0].opacity).toBe(.4);
  expect(app.snapshot().control).toEqual({ id: "opacity", layerId: id });
  expect(app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .4 })).toEqual({ ok: true, result: false });
  app.controlCommit("opacity");
  expect(app.snapshot().control).toBeUndefined();
  expect(document.undoDepth).toBe(1);
  expect(document.undoRecipe()?.layers[0].opacity).toBe(before);
});

test("controlEdit reports a domain rejection thrown after validation and closes an implicit transaction", () => {
  const { app, document } = makeCore(), id = document.recipe.layers[0].id;
  const depth = document.undoDepth;
  // Passes the descriptor (a string) but the recipe parser rejects it.
  const outcome = app.controlEdit("color", { kind: "layer.setColor", layerId: id, color: "not a colour" });
  expect(outcome).toMatchObject({ ok: false, code: "invalid_value" });
  expect(app.snapshot().control).toBeUndefined();
  expect(document.undoDepth).toBe(depth);
});

test("controlEdit refuses while a pointer gesture owns the Undo transaction", () => {
  const { app, document } = makeCore(), id = document.recipe.layers[0].id;
  expect(app.beginGesture("uv", id)).toBe(true);
  expect(app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .3 })).toMatchObject({ ok: false, code: "busy" });
  app.endGesture("uv");
});

test("dispatch classifies thrown errors by their source instead of calling everything invalid", () => {
  const { app } = makeCore();
  let fault: Error = new TypeError("boom");
  const quality = new PreviewQualityActions(512, { assess: () => ({ accepted: true }), replace: () => { throw fault; } });
  app.attach({ quality });
  expect(app.dispatch({ kind: "quality.set", size: 1024 })).toMatchObject({ ok: false, code: "internal" });
  fault = Error("The preview device is gone.");
  expect(app.dispatch({ kind: "quality.set", size: 2048 })).toMatchObject({ ok: false, code: "unavailable",
    message: "The preview device is gone." });
  const service = { capability: () => ({ available: true }), actionCapability: () => ({ available: true }),
    dispatch: () => { throw new CollectionServiceError("conflict", "Saved elsewhere."); },
    subscribe: () => () => {}, contentVersion: () => 0, view: () => ({}), summary: () => ({}),
    selectedPreset: () => ({ loaded: false }) };
  app.attach({ collection: service as never });
  expect(app.dispatch({ kind: "collection.rename", name: "X" })).toEqual({ ok: false, code: "conflict", message: "Saved elsewhere." });
});
