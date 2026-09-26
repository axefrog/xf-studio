import { expect, test } from "bun:test";
import { initialRecipe } from "../src/engines/layered-makeup/recipe";
import { parseFieldSelection, selectedWarp } from "../src/engines/layered-makeup/field-selection";
import { freshWorkspace, parseWorkspace } from "../src/workspace-state";
import { CollectionSession, type EditorSnapshot } from "../src/collection-session";
import { collectionDraft } from "../src/collection-workspace";
import { storedWorkspace } from "./fixtures/looks";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";

test("field selection follows stable layer/field IDs and safely falls back for empty or removed fields", () => {
  const recipe = initialRecipe(), l = recipe.layers[0], f = { ...l.fields[0], id: "second", du: .02 };
  l.fields.push(f);
  const selection = { [l.id]: f.id, ghost: "missing" };
  expect(parseFieldSelection(selection, recipe)).toEqual({ [l.id]: f.id });
  l.fields.reverse(); expect(selectedWarp(l, selection)).toBe(f);
  l.fields.splice(0, 1); expect(selectedWarp(l, selection)).toBe(l.fields[0]);
  l.fields = []; expect(selectedWarp(l, selection)).toBeUndefined();
  expect(parseFieldSelection(selection, recipe)).toEqual({});
  l.id = "__proto__"; l.fields = [f];
  const unusual = parseFieldSelection(JSON.parse('{"__proto__":"second"}'), recipe);
  expect(Object.hasOwn(unusual, "__proto__")).toBe(true);
  expect(selectedWarp(l, unusual)).toBe(f);
});

test("per-preset warp selection survives switches, collection recovery and complete workspace reload", () => {
  const recipe = initialRecipe(), l = recipe.layers[0]; l.fields.push({ ...l.fields[0], id: "second", du: .015 });
  const preset = { id: crypto.randomUUID(), name: "A", revision: 1, recipe };
  let editor: EditorSnapshot = { recipe, active: 0, selected: 0, history: [], fieldSelection: { [l.id]: "second" } };
  const session = new CollectionSession(STUDIO_DOCUMENTS, collectionDraft({ schema: "xfas/collection-1", id: crypto.randomUUID(), name: "Test", presets: [preset] }, STUDIO_DOCUMENTS), () => editor, e => editor = e);
  session.edit({ kind: "copy", id: preset.id });
  editor.fieldSelection = { [l.id]: l.fields[0].id };
  session.select(preset.id); expect(editor.fieldSelection?.[l.id]).toBe("second");
  session.edit({ kind: "remove", id: preset.id }); session.edit({ kind: "restore" });
  expect(editor.fieldSelection?.[l.id]).toBe("second");
  const workspace = freshWorkspace(); workspace.collections = session.snapshot();
  const reloaded = parseWorkspace(storedWorkspace(workspace), STUDIO_DOCUMENTS);
  expect(reloaded.fieldSelection[l.id]).toBe("second");
  expect(selectedWarp(reloaded.recipe.layers[0], reloaded.fieldSelection)?.du).toBe(.015);
});
