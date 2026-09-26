import { expect, test } from "bun:test";
import { convertToBezier, moveTangent, setPointMode, splitBezierSegment, tangentEndpoint } from "../src/engines/layered-makeup/bezier-path";
import { parseWorkspace } from "../src/workspace-state";
import { historyRecipes, storedWorkspace } from "./fixtures/looks";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { initialRecipe, raster, freshWorkspace, editLayers } from "./fixtures/eye-region";
import { readRecipe as parseRecipe } from "../src/recipe-schema";

test("old v4 shapes stay unchanged; edited handles and legacy Undo coexist through workspace reload", () => {
  const old = { ...initialRecipe(), schema: "xfs/recipe-4", layers: initialRecipe().layers.map(({ pathMode: _mode, softness: _softness, points, ...layer }) =>
    ({ ...layer, points: points.map(({ handles: _handles, feather: _feather, ...point }) => point) })) };
  old.layers[0].points[2].weight = .2;
  const oldText = JSON.stringify(old), migrated = parseRecipe(old);
  expect(migrated.layers.every(layer => layer.pathMode === "catmull-rom")).toBe(true);
  const oldPixels = raster(migrated.layers[0], 256), history = structuredClone(migrated);
  const state = freshWorkspace(structuredClone(migrated));
  state.history = [history];
  let layer = convertToBezier(state.recipe.layers[0]);
  layer = setPointMode(layer, 2, "corner");
  const endpoint = tangentEndpoint(layer.points[2], "out");
  layer.points[2] = moveTangent(layer.points[2], "out", { u: endpoint.u + .015, v: endpoint.v - .009 });
  layer.points = splitBezierSegment(layer.points, layer.points.length - 1, .41)!;
  expect(layer.points).toHaveLength(7);
  state.recipe.layers[0] = layer;
  const restored = parseWorkspace(storedWorkspace(state), STUDIO_DOCUMENTS);
  expect(restored.recipe).toEqual(state.recipe);
  expect(historyRecipes(restored.history).at(-1)).toEqual(history);
  expect(raster(historyRecipes(restored.history).at(-1)!.layers[0], 256)).toEqual(oldPixels);
  expect(restored.recipe.layers[0].points[2].handles!.mode).toBe("corner");
  expect(JSON.stringify(old)).toBe(oldText);
  const duplicate = editLayers(restored.recipe, layer.id, { kind: "duplicate", id: layer.id, newId: "duplicate-layer" });
  duplicate.recipe.layers[duplicate.active].points[2].handles!.out.u += .01;
  expect(restored.recipe.layers[0]).toEqual(layer);
});
