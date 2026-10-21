import { expect, test } from "bun:test";
import { parseFieldSelection, selectedWarp } from "../src/engines/layered-makeup/field-selection";
import { initialRecipe } from "./fixtures/eye-region";
import { profileStudio } from "./fixtures/profile-studio";

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

test("per-preset warp selection survives switches, removal and restore, and a restart", async () => {
  const recipe = initialRecipe(), l = recipe.layers[0]; l.fields.push({ ...l.fields[0], id: "second", du: .015 });
  const studio = await profileStudio({ looks: [{ name: "A", recipe }] });
  const { app, document } = studio, preset = studio.scene.look()!.look, collection = studio.shown()!;
  const select = (field: string) => expect(app.dispatch({ kind: "field.select", layerId: l.id, fieldId: field }).ok).toBe(true);
  select("second");
  expect(app.dispatch({ kind: "preset.edit", command: { kind: "copy", id: preset } }).ok).toBe(true);
  select(l.fields[0].id);
  expect(app.dispatch({ kind: "preset.select", id: preset }).ok).toBe(true);
  expect(document.fieldSelection[l.id]).toBe("second");
  expect(app.dispatch({ kind: "preset.edit", command: { kind: "remove", id: preset } }).ok).toBe(true);
  expect(app.dispatch({ kind: "preset.edit", command: { kind: "restore" } }).ok).toBe(true);
  expect(document.fieldSelection[l.id]).toBe("second");
  await studio.settle();
  const again = await profileStudio({ library: studio.library, show: { collection, look: preset } });
  expect(again.document.fieldSelection[l.id]).toBe("second");
  expect(selectedWarp(again.document.recipe.layers[0]!, again.document.fieldSelection)?.du).toBe(.015);
});
