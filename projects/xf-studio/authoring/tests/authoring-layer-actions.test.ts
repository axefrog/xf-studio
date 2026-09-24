import { expect, test } from "bun:test";
import { AuthoringDocument } from "../src/authoring-document";
import { AuthoringLayerActions } from "../src/authoring-layer-actions";
import { freshWorkspace } from "../src/workspace-state";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";

test("layer transactions checkpoint once and reconcile the preview only for stack edits", () => {
  const document = new AuthoringDocument(freshWorkspace());
  let resets = 0;
  const actions = new AuthoringLayerActions(document, () => resets++);
  const id = document.recipe.layers[0].id;
  actions.dispatch({ kind: "layer.setEnabled", id, enabled: false });
  expect(document.recipe.layers[0].enabled).toBe(false);
  expect(document.undoDepth).toBe(1);
  expect(resets).toBe(0);
  actions.dispatch({ kind: "layer.edit", command: { kind: "duplicate", id } });
  expect(document.recipe.layers).toHaveLength(5);
  expect(document.undoDepth).toBe(2);
  expect(resets).toBe(1);
  expect(actions.capability({ kind: "layer.edit", command: { kind: "remove", id: "missing" } }).available).toBe(false);
  const prior = document.undoRecipe()!;
  document.replaceRecipe(prior, prior.layers.findIndex(layer => layer.id === document.recipe.layers[document.active]?.id));
  expect(document.recipe.layers).toHaveLength(4);
  expect(document.active).toBeLessThan(document.recipe.layers.length);
  expect(document.recipe.layers[document.active].points).toHaveLength(6);
});

test("adding a selected layer then Undo cannot leave an orphan active index", () => {
  const document = new AuthoringDocument(freshWorkspace());
  const actions = new AuthoringLayerActions(document, () => {});
  actions.dispatch({ kind: "layer.edit", command: { kind: "add" } });
  expect(document.active).toBe(4);
  const prior = document.undoRecipe()!;
  document.replaceRecipe(prior, prior.layers.findIndex(layer => layer.id === document.recipe.layers[document.active]?.id));
  expect(document.active).toBe(0);
  expect(document.recipe.layers[document.active].points.length).toBeGreaterThan(0);
  expect(document.selected).toBe(0);
});

test("rename, move and Undo preserve the selected point while a reset clamps it", () => {
  const previous = [] as string[];
  const core = createTrustedAuthoringCore(freshWorkspace(), {
    resetStack: recipe => previous.push(recipe.layers.map(layer => layer.id).join(",")),
    selectedCollection: () => "draft", controlAction: () => {},
  });
  const id = core.document.recipe.layers[0].id;
  core.document.selected = 3;
  core.layers.dispatch({ kind: "layer.edit", command: { kind: "rename", id, name: "One" } });
  expect(core.document.selected).toBe(3);
  expect(core.document.undoDepth).toBe(1);
  core.undo();
  expect(core.document.selected).toBe(3);
  core.layers.dispatch({ kind: "layer.edit", command: { kind: "move", id, to: 2 } });
  expect(core.document.active).toBe(2);
  expect(core.document.selected).toBe(3);
  core.undo();
  expect(core.document.active).toBe(0);
  expect(core.document.selected).toBe(3);
  expect(previous).toHaveLength(4);
  core.document.selected = 5;
  core.layers.dispatch({ kind: "layer.edit", command: { kind: "reset", id } });
  expect(core.document.selected).toBe(3);
  core.undo();
  expect(core.document.selected).toBe(3);
});
