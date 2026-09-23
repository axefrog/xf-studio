import { test, expect } from "bun:test";
import { initialRecipe, MAX_LAYERS, parseRecipe } from "../src/recipe";
import { editLayers } from "../src/layer-stack";
import { compileFlatPreset } from "../src/preset-compiler";
import { freshWorkspace, parseWorkspace } from "../src/workspace-state";

test("legacy recipes upgrade explicitly; empty and variable stacks persist without corrupting history", () => {
  const legacy = { ...initialRecipe(), schema: "eye-artistry/recipe-1",
    layers: initialRecipe().layers.map(({ fields, strength: _strength, pathMode: _pathMode, points, ...l }) => ({ ...l, points: points.map(({ handles: _handles, ...point }) => point), field: fields[0] })) };
  expect(parseRecipe(legacy).schema).toBe("xfs/recipe-5");
  expect(legacy.schema).toBe("eye-artistry/recipe-1");
  expect(() => parseRecipe({ ...legacy, layers: [] })).toThrow();
  const empty = { ...initialRecipe(), layers: [] };
  const state = freshWorkspace(empty);
  state.active = 12; state.selected = 17; state.history.push(initialRecipe());
  const restored = parseWorkspace(JSON.parse(JSON.stringify(state)));
  expect(restored.recipe.layers).toHaveLength(0);
  expect(restored.active).toBe(0); expect(restored.selected).toBe(0);
  expect(restored.history[0].layers).toHaveLength(4);
  expect(compileFlatPreset(empty, 32).metadata.coveredTexels).toBe(0);
  expect(() => parseRecipe({ ...empty, layers: Array(MAX_LAYERS + 1).fill(initialRecipe().layers[0]) })).toThrow();
});

test("layer operations preserve identity, isolate copies, allow removal of the last layer and reject invalid changes atomically", () => {
  const original = initialRecipe(), originalText = JSON.stringify(original), selected = original.layers[0].id;
  let next = editLayers(original, selected, { kind: "duplicate", id: selected });
  const copy = next.recipe.layers[next.active];
  expect(copy.id).not.toBe(selected);
  copy.points[0].u = .1;
  expect(original.layers[0].points[0].u).not.toBe(.1);
  next = editLayers(next.recipe, copy.id, { kind: "move", id: copy.id, to: 4 });
  expect(next.active).toBe(4);
  next = editLayers(next.recipe, copy.id, { kind: "rename", id: copy.id, name: "Custom" });
  next = editLayers(next.recipe, copy.id, { kind: "reset", id: copy.id });
  expect(next.recipe.layers[4].id).toBe(copy.id); expect(next.recipe.layers[4].name).toBe("Custom");
  expect(() => editLayers(next.recipe, copy.id, { kind: "rename", id: copy.id, name: " " })).toThrow();
  expect(() => editLayers(next.recipe, copy.id, { kind: "move", id: copy.id, to: 500 })).toThrow();
  while (next.recipe.layers.length) next = editLayers(next.recipe, next.recipe.layers[next.active]?.id,
    { kind: "remove", id: next.recipe.layers[0].id });
  expect(next.recipe.layers).toHaveLength(0);
  next = editLayers(next.recipe, undefined, { kind: "add" });
  expect(next.recipe.layers).toHaveLength(1); expect(next.recipe.layers[0].enabled).toBe(true);
  expect(JSON.stringify(original)).toBe(originalText);
});

test("reordering changes compiled overlapping colour, not recipe identities or source shapes", () => {
  const recipe = initialRecipe(); recipe.layers = recipe.layers.slice(0, 1);
  recipe.layers[0].color = "#ff0000";
  let next = editLayers(recipe, recipe.layers[0].id, { kind: "duplicate", id: recipe.layers[0].id });
  next.recipe.layers[1].color = "#0000ff";
  const before = compileFlatPreset(next.recipe, 64);
  const moved = editLayers(next.recipe, next.recipe.layers[1].id, { kind: "move", id: next.recipe.layers[1].id, to: 0 });
  const after = compileFlatPreset(moved.recipe, 64);
  expect(before.diffuse).not.toEqual(after.diffuse);
  expect(before.metadata.coveredTexels).toBe(after.metadata.coveredTexels);
  expect(after.metadata.layerOrder).toEqual([...before.metadata.layerOrder].reverse());
});
