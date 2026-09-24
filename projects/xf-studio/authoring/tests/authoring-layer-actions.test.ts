import { expect, test } from "bun:test";
import { AuthoringDocument } from "../src/authoring-document";
import { AuthoringLayerActions } from "../src/authoring-layer-actions";
import { freshWorkspace } from "../src/workspace-state";

test("layer transactions checkpoint once and invoke renderer reset only for structural edits", () => {
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
