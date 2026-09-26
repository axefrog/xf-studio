import { expect, test } from "bun:test";
import { AuthoringDocument } from "../src/authoring-document";
import { AuthoringGestures } from "../src/authoring-gestures";
import { AuthoringRenderScheduler } from "../src/authoring-render-scheduler";
import { registeredEditing } from "./gesture-test-adapter";
import { RecipeActions } from "../src/authoring-eye-makeup";
import { freshWorkspace } from "./fixtures/eye-region";
import { eyeMakeupPort } from "./fixtures/eye-region";

test("document effects route immediate, deferred, selection and gesture rendering by live layer identity", () => {
  const document = new AuthoringDocument(freshWorkspace());
  const frames: (() => void)[] = [], events: string[] = [];
  const scheduler = new AuthoringRenderScheduler(document, {
    frame: run => { frames.push(run); },
    render: index => events.push(`render:${index}`),
    refreshSelection: () => events.push("selection"),
  });
  const state = () => ({ recipe: document.recipe, active: document.active,
    selected: document.selected, fieldSelection: document.fieldSelection });
  document.applyActionState(state(), { kind: "selection", layerIndex: 0 });
  document.applyActionState(state(), { kind: "immediate", layerIndex: 0 });
  document.applyActionState(state(), { kind: "scheduled", layerIndex: 0 });
  expect(events).toEqual(["selection", "render:0", "selection"]);
  expect(frames.length).toBe(1);
  document.applyActionState(state(), { kind: "scheduled", layerIndex: 1 });
  expect(events.at(-1)).toBe("render:1");
  document.publishLayer(document.recipe, 2);
  expect(events.at(-1)).toBe("render:2");
  document.gestureChanged(0);
  expect(frames.length).toBe(1);
  frames.shift()!();
  expect(events.at(-1)).toBe("render:0");
  const stale = document.recipe.layers[0];
  document.gestureChanged(0);
  document.recipe = structuredClone(document.recipe);
  frames.shift()!();
  expect(document.recipe.layers[0]).not.toBe(stale);
  expect(events.filter(e => e === "render:0").length).toBe(2);
  scheduler.dispose();
  document.gestureChanged(0);
  expect(frames.length).toBe(0);
});

test("gesture service owns one checkpoint, commit and Escape restoration without stale-target Undo", () => {
  const document = new AuthoringDocument(freshWorkspace());
  const actions = new RecipeActions(() => ({ recipe: document.recipe, active: document.active,
    selected: document.selected, fieldSelection: document.fieldSelection }),
  (next, effect) => document.applyActionState(next, effect), document, {}, () => "draft",
  index => document.gestureChanged(index));
  let restores = 0;
  const gestures = new AuthoringGestures(document, registeredEditing(eyeMakeupPort(document, actions)).gestures, () => {
    restores++;
    const prior = document.undoRecipe();
    if (prior) document.recipe = prior;
  });
  const layer = document.recipe.layers[0], point = layer.points[0], original = point.u;
  const emptyDepth = document.undoDepth;
  expect(gestures.begin("uv", layer)).toBe(true);
  gestures.commit("uv");
  expect(document.undoDepth).toBe(emptyDepth);
  expect(gestures.begin("uv", layer)).toBe(true);
  expect(gestures.apply("uv", { kind: "point.replace", layerId: layer.id, expectedLayer: layer,
    index: 0, expectedPoint: point, next: { u: original + .005 } })).toBe(true);
  expect(gestures.apply("uv", { kind: "point.replace", layerId: layer.id, expectedLayer: layer,
    index: 0, expectedPoint: point, next: { u: original + .01 } })).toBe(true);
  gestures.cancel("uv");
  expect(restores).toBe(1);
  expect(document.recipe.layers[0].points[0].u).toBe(original);
  expect(document.canUndo).toBe(false);

  const later = document.recipe.layers[0], target = later.points[0];
  gestures.begin("surface", later);
  expect(gestures.apply("surface", { kind: "point.replace", layerId: later.id, expectedLayer: later,
    index: 0, expectedPoint: target, next: { u: original + .01 } })).toBe(true);
  gestures.commit("surface");
  gestures.cancel("surface");
  expect(restores).toBe(1);
  expect(document.canUndo).toBe(true);
  const stale = document.recipe.layers[0];
  gestures.begin("uv", stale);
  document.recipe = structuredClone(document.recipe);
  gestures.cancel("uv");
  expect(restores).toBe(1);
});

test("full rebuilds preserve stack ordering and prioritize the active layer for quality recovery", () => {
  const document = new AuthoringDocument(freshWorkspace());
  const rendered: number[] = [];
  const scheduler = new AuthoringRenderScheduler(document, {
    frame: () => { throw Error("unexpected frame"); },
    render: index => rendered.push(index), refreshSelection: () => {},
  });
  document.active = 2;
  scheduler.renderAll("stack");
  expect(rendered).toEqual([0, 1, 2, 3]);
  rendered.length = 0;
  scheduler.renderAll();
  expect(rendered).toEqual([2, 0, 1, 3]);
  scheduler.dispose();
});
