import { expect, test } from "bun:test";
import { AuthoringDocument } from "../src/authoring-document";
import { AuthoringGeometry } from "../src/authoring-geometry";
import { AuthoringPresentation } from "../src/authoring-presentation";
import { freshWorkspace } from "../src/workspace-state";

test("control read port detaches live recipe, caches repeated reads and tracks selection", () => {
  const document = new AuthoringDocument(freshWorkspace());
  const view = new AuthoringPresentation(document, new AuthoringGeometry(document));
  const recipe = view.recipe(), layer = view.layer()!;
  expect(view.recipe()).toBe(recipe);
  expect(view.layer()).toBe(layer);
  if (false) {
    // @ts-expect-error presentation cannot assign into authored geometry
    view.layer()!.points[0].u = .9;
    // @ts-expect-error presentation cannot change the layer stack
    view.recipe().layers.push(document.recipe.layers[0]);
  }
  expect(recipe).not.toBe(document.recipe);
  expect(layer).not.toBe(document.recipe.layers[0]);
  expect(view.selectedField()?.id).toBe(layer.fields[0].id);
  document.active = 1;
  expect(view.recipe()).toBe(recipe);
  expect(view.layer()).toBe(recipe.layers[1]);
  const original = document.recipe.layers[1].points[0].u;
  // The detached view can be coerced by untrusted JavaScript, but cannot write
  // the authoring document. TypeScript clients see only readonly fields.
  (view.layer()!.points[0] as { u: number }).u = .9;
  expect(document.recipe.layers[1].points[0].u).toBe(original);
});

test("atomic editor restore publishes coherent recipe, point, field and history to subscribers", () => {
  const document = new AuthoringDocument(freshWorkspace());
  const view = new AuthoringPresentation(document, new AuthoringGeometry(document));
  const changes: string[] = [];
  const stop = view.subscribe(change => changes.push(change));
  const editor = document.export();
  editor.active = 1;
  editor.selected = 2;
  editor.fieldSelection = { [editor.recipe.layers[1].id]: editor.recipe.layers[1].fields[0].id };
  document.restore(editor);
  expect(changes).toEqual(["restore"]);
  expect(view.active).toBe(1);
  expect(view.selected).toBe(2);
  expect(view.selectedField()?.id).toBe(editor.recipe.layers[1].fields[0].id);
  expect(view.layer()?.id).toBe(editor.recipe.layers[1].id);
  expect(view.recipe()).not.toBe(editor.recipe);
  stop();
});
