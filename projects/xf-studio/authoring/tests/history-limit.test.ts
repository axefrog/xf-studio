import { expect, test } from "bun:test";
import { RECIPE_HISTORY_LIMIT } from "../src/editor-actions";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { freshWorkspace } from "../src/workspace-state";
import { STUDIO_COMPOSITION } from "../src/compose/studio-registry";

// Transactions identify the Undo entry their checkpoint added. At the limit a new entry
// displaces the oldest, so the depth no longer grows; depth-based detection used to
// mislabel entries and keep no-op entries there.

function fullHistory() {
  const workspace = freshWorkspace();
  workspace.history = Array.from({ length: RECIPE_HISTORY_LIMIT }, (_, i) => {
    const recipe = structuredClone(workspace.recipe);
    recipe.layers[0].opacity = (i + 1) / 200;
    return recipe;
  });
  const core = createTrustedAuthoringCore(workspace, { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
  expect(core.document.undoDepth).toBe(RECIPE_HISTORY_LIMIT);
  return core;
}

test("a form edit at the history limit labels its own entry and Undo restores the start value", () => {
  const { app, document } = fullHistory();
  const id = document.recipe.layers[0].id, before = document.recipe.layers[0].opacity;
  expect(app.controlBegin("opacity", id)).toBe(true);
  expect(app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .9 })).toEqual({ ok: true, result: true });
  app.controlCommit("opacity");
  expect(document.undoDepth).toBe(RECIPE_HISTORY_LIMIT);
  expect(app.history().undo).toMatchObject({ label: "Opacity", actionKind: "layer.setOpacity" });
  expect(app.dispatch({ kind: "recipe.undo" }).ok).toBe(true);
  expect(document.recipe.layers[0].opacity).toBe(before);
  // Undoing the entry that displaced the oldest one brings that oldest entry back.
  expect(document.undoDepth).toBe(RECIPE_HISTORY_LIMIT);
  expect(document.historySnapshot()[0].layers[0].opacity).toBe(1 / 200);
});

test("empty form and gesture transactions at the limit leave the history exactly as they found it", () => {
  const { app, document } = fullHistory();
  const id = document.recipe.layers[0].id, history = JSON.stringify(document.historySnapshot());
  const label = app.history().undo;
  expect(app.controlBegin("opacity", id)).toBe(true);
  app.controlCommit("opacity");
  expect(JSON.stringify(document.historySnapshot())).toBe(history);
  expect(app.beginGesture("uv", id)).toBe(true);
  app.endGesture("uv");
  expect(JSON.stringify(document.historySnapshot())).toBe(history);
  expect(app.history().undo).toEqual(label);
  // No entry equals the current recipe, so Undo always changes something.
  const current = JSON.stringify(document.recipe);
  expect(document.historySnapshot().some(entry => JSON.stringify(entry) === current)).toBe(false);
});

test("a gesture at the limit is labelled by its first change and cancelling it restores everything", () => {
  const { app, document } = fullHistory();
  const layer = document.recipe.layers[0], history = JSON.stringify(document.historySnapshot());
  const start = JSON.stringify(document.recipe), u = layer.points[0].u;
  expect(app.beginGesture("uv", layer.id)).toBe(true);
  expect(app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: u + .002 } })).toBe(true);
  expect(app.history().undo).toMatchObject({ label: "Move point" });
  app.endGesture("uv", true);
  expect(JSON.stringify(document.recipe)).toBe(start);
  expect(JSON.stringify(document.historySnapshot())).toBe(history);

  expect(app.beginGesture("uv", layer.id)).toBe(true);
  expect(app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: u + .002 } })).toBe(true);
  app.endGesture("uv");
  expect(document.undoDepth).toBe(RECIPE_HISTORY_LIMIT);
  expect(app.history().undo).toMatchObject({ label: "Move point", actionKind: "gesture.point.replace" });
});
