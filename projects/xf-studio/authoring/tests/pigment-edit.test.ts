import { expect, test } from "bun:test";
import { editPigment } from "../src/pigment-edit";
import { initialRecipe, parseRecipe, DEFAULT_STRENGTH_BLEND } from "../src/recipe";
import { freshWorkspace, parseWorkspace } from "../src/workspace-state";
import { editLayers } from "../src/layer-stack";
import { historyRecipes, storedWorkspace } from "./fixtures/looks";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";

test("explicit smooth upgrade and pigment edits preserve old draft/history through reload", () => {
  const old = { ...initialRecipe(), schema: "xfs/recipe-3",
    layers: initialRecipe().layers.map(({ strength: _strength, pathMode: _pathMode, softness: _softness, points, ...layer }) => ({ ...layer, points: points.map(({ handles: _handles, feather: _feather, ...point }) => point) })) };
  old.layers[0].points[0].weight = 0;
  const original = JSON.stringify(old), migrated = parseRecipe(old);
  expect(migrated.layers[0].strength).toEqual({ mode: "legacy-nearest" });
  const legacySnapshot = structuredClone(migrated);
  const state = freshWorkspace(migrated);
  state.history = [structuredClone(migrated)];
  state.recipe.layers[0] = editPigment(state.recipe.layers[0], { kind: "smooth-strength", enabled: true });
  expect(state.recipe.layers[0].strength).toEqual({ mode: "smooth-boundary", blend: DEFAULT_STRENGTH_BLEND });
  state.recipe.layers[0] = editPigment(state.recipe.layers[0], { kind: "strength-blend", value: .004 });
  state.recipe.layers[0] = editPigment(state.recipe.layers[0], { kind: "point-strength", index: 2, value: .3 });
  const restored = parseWorkspace(storedWorkspace(state), STUDIO_DOCUMENTS);
  expect(restored.recipe).toEqual(state.recipe);
  expect(historyRecipes(restored.history).at(-1)).toEqual(legacySnapshot);
  expect(JSON.stringify(old)).toBe(original);
  expect(editPigment(restored.recipe.layers[0], { kind: "smooth-strength", enabled: false }).strength)
    .toEqual({ mode: "legacy-nearest" });
});

test("new layers are smooth, duplication preserves the selected mode, invalid commands are atomic", () => {
  const recipe = initialRecipe(), layer = recipe.layers[0];
  layer.strength = { mode: "legacy-nearest" };
  const added = editLayers(recipe, layer.id, { kind: "add" });
  expect(added.recipe.layers[added.active].strength.mode).toBe("smooth-boundary");
  const copied = editLayers(recipe, layer.id, { kind: "duplicate", id: layer.id });
  expect(copied.recipe.layers[copied.active].strength.mode).toBe("legacy-nearest");
  const before = JSON.stringify(layer);
  expect(() => editPigment(layer, { kind: "strength-blend", value: .002 })).toThrow();
  for (const value of [NaN, Infinity, -1, 1.01])
    expect(() => editPigment(layer, { kind: "point-strength", index: 0, value })).toThrow();
  for (const index of [-1, 100, .5])
    expect(() => editPigment(layer, { kind: "point-strength", index, value: .5 })).toThrow();
  const smooth = editPigment(layer, { kind: "smooth-strength", enabled: true });
  for (const value of [0, -.1, NaN, Infinity, .02001])
    expect(() => editPigment(smooth, { kind: "strength-blend", value })).toThrow();
  expect(JSON.stringify(layer)).toBe(before);
});
