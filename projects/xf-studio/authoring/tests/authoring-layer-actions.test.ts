import { expect, test } from "bun:test";
import { freshWorkspace } from "../src/workspace-state";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { STUDIO_COMPOSITION } from "../src/compose/studio-registry";

// Layer-stack edits dispatch through the registered eye-makeup apply and its port (CORE-31); the
// former AuthoringLayerActions service is gone.
function core(resetStack: (previous: import("../src/recipe").Recipe) => void = () => {}) {
  return createTrustedAuthoringCore(freshWorkspace(), { resetStack, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
}

test("layer transactions checkpoint once and reconcile the preview only for stack edits", () => {
  let resets = 0;
  const { app, document } = core(() => resets++);
  const id = document.recipe.layers[0].id;
  expect(app.dispatch({ kind: "layer.setEnabled", id, enabled: false }).ok).toBe(true);
  expect(document.recipe.layers[0].enabled).toBe(false);
  expect(document.undoDepth).toBe(1);
  expect(resets).toBe(0);
  expect(app.dispatch({ kind: "layer.edit", command: { kind: "duplicate", id } }).ok).toBe(true);
  expect(document.recipe.layers).toHaveLength(5);
  expect(document.undoDepth).toBe(2);
  expect(resets).toBe(1);
  expect(app.capability({ kind: "layer.edit", command: { kind: "remove", id: "missing" } }).available).toBe(false);
  const prior = document.undoRecipe()!;
  document.replaceRecipe(prior, prior.layers.findIndex(layer => layer.id === document.recipe.layers[document.active]?.id));
  expect(document.recipe.layers).toHaveLength(4);
  expect(document.active).toBeLessThan(document.recipe.layers.length);
  expect(document.recipe.layers[document.active].points).toHaveLength(6);
});

test("adding a selected layer then Undo cannot leave an orphan active index", () => {
  const { app, document } = core();
  expect(app.dispatch({ kind: "layer.edit", command: { kind: "add" } }).ok).toBe(true);
  expect(document.active).toBe(4);
  const prior = document.undoRecipe()!;
  document.replaceRecipe(prior, prior.layers.findIndex(layer => layer.id === document.recipe.layers[document.active]?.id));
  expect(document.active).toBe(0);
  expect(document.recipe.layers[document.active].points.length).toBeGreaterThan(0);
  expect(document.selected).toBe(0);
});

test("rename, move and Undo preserve the selected point while a reset clamps it", () => {
  const previous = [] as string[];
  const c = core(recipe => previous.push(recipe.layers.map(layer => layer.id).join(",")));
  const id = c.document.recipe.layers[0].id;
  c.document.selected = 3;
  c.app.dispatch({ kind: "layer.edit", command: { kind: "rename", id, name: "One" } });
  expect(c.document.selected).toBe(3);
  expect(c.document.undoDepth).toBe(1);
  c.undo();
  expect(c.document.selected).toBe(3);
  c.app.dispatch({ kind: "layer.edit", command: { kind: "move", id, to: 2 } });
  expect(c.document.active).toBe(2);
  expect(c.document.selected).toBe(3);
  c.undo();
  expect(c.document.active).toBe(0);
  expect(c.document.selected).toBe(3);
  expect(previous).toHaveLength(4);
  c.document.selected = 5;
  c.app.dispatch({ kind: "layer.edit", command: { kind: "reset", id } });
  expect(c.document.selected).toBe(3);
  c.undo();
  expect(c.document.selected).toBe(3);
});

test("a new layer's ID comes from the host's ID source, so the applied action replays exactly", () => {
  let next = 0;
  const c = createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "draft",
    newId: () => `layer-from-host-${++next}` }, STUDIO_COMPOSITION);
  c.app.dispatch({ kind: "layer.edit", command: { kind: "add" } });
  c.app.dispatch({ kind: "layer.edit", command: { kind: "duplicate", id: c.document.recipe.layers[0].id } });
  expect(c.document.recipe.layers.map(layer => layer.id)).toContain("layer-from-host-1");
  expect(c.document.recipe.layers.map(layer => layer.id)).toContain("layer-from-host-2");
  // An ID the recipe already uses is refused, never silently replaced.
  expect(c.app.capability({ kind: "layer.edit", command: { kind: "add", newId: "layer-from-host-1" } }))
    .toMatchObject({ available: false, code: "invalid_value" });
});
