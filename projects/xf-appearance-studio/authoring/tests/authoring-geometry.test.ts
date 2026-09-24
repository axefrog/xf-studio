import { expect, test } from "bun:test";
import { AuthoringDocument } from "../src/authoring-document";
import { AuthoringGeometry } from "../src/authoring-geometry";
import { freshWorkspace } from "../src/workspace-state";

function fixture() {
  const document = new AuthoringDocument(freshWorkspace());
  return { document, geometry: new AuthoringGeometry(document) };
}

test("geometry reads are detached, cached between frames and invalidated on recipe replacement", () => {
  const { document, geometry } = fixture();
  const view = geometry.recipe(), layer = geometry.layer()!;
  expect(geometry.recipe()).toBe(view);
  expect(geometry.layer()).toBe(layer);
  layer.points[0].u = .9;
  expect(document.recipe.layers[0].points[0].u).not.toBe(.9);
  document.recipe = structuredClone(document.recipe);
  expect(geometry.recipe()).not.toBe(view);
  expect(geometry.layer()).not.toBe(layer);
});

test("gesture refreshes changed layer once and preserves captured targets and arrays", () => {
  const { document, geometry } = fixture();
  const view = geometry.recipe(), layer = geometry.layer()!, points = layer.points;
  const point = points[0], field = layer.fields[0], other = view.layers[1];
  document.recipe.layers[0].points[0].u += .002;
  document.recipe.layers[0].fields[0].radius += .001;
  document.gestureChanged(0);
  expect(geometry.recipe()).toBe(view);
  expect(geometry.layer()).toBe(layer);
  expect(layer.points).toBe(points);
  expect(layer.points[0]).toBe(point);
  expect(layer.fields[0]).toBe(field);
  expect(layer.points[0].u).toBe(document.recipe.layers[0].points[0].u);
  expect(layer.fields[0].radius).toBe(document.recipe.layers[0].fields[0].radius);
  expect(view.layers[1]).toBe(other);
  document.recipe.layers[0].points = document.recipe.layers[0].points.slice(1);
  document.gestureChanged(0);
  expect(geometry.layer()!.points).not.toBe(points);
  const replacement = geometry.layer()!.points;
  document.recipe.layers[0].points = document.recipe.layers[0].points.map(point => ({ ...point }));
  document.gestureChanged(0, "path.replacePoints");
  expect(geometry.layer()!.points).not.toBe(replacement);
});

test("selection changes reuse geometry without cloning", () => {
  const { document, geometry } = fixture(), view = geometry.recipe();
  document.active = 1;
  expect(geometry.recipe()).toBe(view);
  expect(geometry.layer()).toBe(view.layers[1]);
});
