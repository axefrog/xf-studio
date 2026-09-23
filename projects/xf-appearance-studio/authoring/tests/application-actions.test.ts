import { expect, test } from "bun:test";
import { CollectionActions } from "../src/collection-actions";
import { collectionDraft, emptyMemory, type CollectionWorkspace } from "../src/collection-workspace";
import { applyLayerAction, layerCapability, RecipeHistory } from "../src/editor-actions";
import { initialRecipe } from "../src/recipe";
import type { EditorSnapshot } from "../src/collection-session";

test("collection commands keep UI views isolated and notify only after valid transitions", () => {
  const preset = { id: crypto.randomUUID(), name: "First", revision: 1, recipe: initialRecipe() };
  const collection = { schema: "xfas/collection-1" as const, id: crypto.randomUUID(), name: "Collection", presets: [preset] };
  let editor: EditorSnapshot = { recipe: preset.recipe, ...emptyMemory() };
  const actions = new CollectionActions(collectionDraft(collection), () => editor, value => editor = value);
  let changes = 0;
  const unsubscribe = actions.subscribe(() => changes++);
  const view = actions.view() as unknown as CollectionWorkspace; view.collection.presets[0].name = "Tampered";
  expect(actions.view().collection.presets[0].name).toBe("First");
  expect(actions.capability({ kind: "preset.edit", command: { kind: "restore" } })).toEqual({
    available: false, reason: "No removed preset to restore." });
  expect(() => actions.dispatch({ kind: "preset.edit", command: { kind: "remove", id: crypto.randomUUID() } })).toThrow("no longer exists");
  expect(changes).toBe(0);
  actions.dispatch({ kind: "preset.edit", command: { kind: "copy", id: preset.id } });
  const copyId = actions.view().selected!;
  expect(copyId).not.toBe(preset.id);
  editor.recipe.layers[0].color = "#112233";
  actions.dispatch({ kind: "preset.select", id: preset.id });
  actions.dispatch({ kind: "preset.select", id: copyId });
  expect(editor.recipe.layers[0].color).toBe("#112233");
  actions.dispatch({ kind: "collection.rename", name: " Renamed " });
  expect(actions.snapshot().collection.name).toBe("Renamed");
  const other = { ...collection, id: crypto.randomUUID(), name: "Other", presets: [] };
  actions.dispatch({ kind: "collection.open", collection: other });
  expect(editor.recipe.layers).toHaveLength(0);
  actions.dispatch({ kind: "collection.undoOpen" });
  expect(actions.view().collection.name).toBe("Renamed");
  expect(changes).toBe(6);
  unsubscribe();
  actions.dispatch({ kind: "collection.filesOpen", open: true });
  expect(changes).toBe(6);
});

test("layer commands preserve source recipes and history restores a complete edit", () => {
  const source = initialRecipe(), id = source.layers[0].id, history = new RecipeHistory();
  history.checkpoint(source); history.checkpoint(source);
  const hidden = applyLayerAction(source, id, { kind: "layer.setEnabled", id, enabled: false });
  expect(source.layers[0].enabled).toBe(true);
  expect(hidden.recipe.layers[0].enabled).toBe(false);
  expect(hidden.structure).toBe(false);
  expect(layerCapability(source, { kind: "layer.edit", command: { kind: "move", id, to: 100 } }).available).toBe(false);
  expect(() => applyLayerAction(source, id, { kind: "layer.edit", command: { kind: "rename", id: "stale", name: "Lost" } })).toThrow("no longer exists");
  expect(history.undo()).toEqual(source);
  expect(history.canUndo).toBe(false);
  history.restore([source]);
  const view = history.snapshot(); view[0].layers[0].name = "Changed";
  expect(history.undo()!.layers[0].name).toBe(source.layers[0].name);
});
