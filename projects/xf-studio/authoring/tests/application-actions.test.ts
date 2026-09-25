import { expect, test } from "bun:test";
import { CollectionActions } from "../src/collection-actions";
import { collectionDraft, emptyMemory, type CollectionWorkspace } from "../src/collection-workspace";
import { applyLayerAction, layerCapability, RecipeHistory } from "../src/editor-actions";
import { applyRecipeAction, RecipeActions, recipeActionCapability, type RecipeActionState } from "../src/recipe-actions";
import { PreviewActions, type PreviewPort } from "../src/preview-actions";
import { ViewportAdapter, type ViewportPort } from "../src/viewport-adapter";
import { freshWorkspace } from "../src/workspace-state";
import { glitterModel, type GlitterChoices } from "../src/glitter-model";
import { initialRecipe } from "../src/recipe";
import type { EditorSnapshot } from "../src/collection-session";
import { EYE_MAKEUP } from "../src/features/eye-makeup";
import type { GestureEdit } from "../src/recipe-actions";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";

test("collection commands keep UI views isolated and notify only after valid transitions", () => {
  const preset = { id: crypto.randomUUID(), name: "First", revision: 1, recipe: initialRecipe() };
  const collection = { schema: "xfas/collection-1" as const, id: crypto.randomUUID(), name: "Collection", presets: [preset] };
  let editor: EditorSnapshot = { recipe: preset.recipe, ...emptyMemory() };
  const actions = new CollectionActions(STUDIO_DOCUMENTS, collectionDraft(collection, STUDIO_DOCUMENTS), () => editor, value => editor = value);
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
  actions.dispatch({ kind: "collection.rename", name: "Unobserved" });
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

test("recipe actions validate point, field, pigment, softness and material edits atomically", () => {
  const recipe = initialRecipe(), layerId = recipe.layers[0].id;
  const start: RecipeActionState = { recipe, active: 0, selected: 0, fieldSelection: {} };
  const added = applyRecipeAction(start, { kind: "field.add", layerId });
  expect(added.state.recipe.layers[1]).toBe(start.recipe.layers[1]); // Pending renders for other layers keep their identity.
  const otherEdited = applyRecipeAction(added.state, { kind: "layer.setOpacity",
    layerId: recipe.layers[1].id, opacity: .6 });
  expect(otherEdited.state.recipe.layers[0]).toBe(added.state.recipe.layers[0]);
  expect(added.state.recipe.layers[0].fields).toHaveLength(2);
  const fieldId = added.state.fieldSelection[layerId];
  expect(fieldId).toBe(added.state.recipe.layers[0].fields[1].id);
  expect(start.recipe.layers[0].fields).toHaveLength(1);
  const reached = applyRecipeAction(added.state, { kind: "field.setReach", layerId, fieldId, radius: .08 });
  expect(reached.state.recipe.layers[0].fields[1].radius).toBe(.08);
  const removed = applyRecipeAction(reached.state, { kind: "field.remove", layerId, fieldId });
  expect(removed.state.recipe.layers[0].fields).toHaveLength(1);
  expect(recipeActionCapability(removed.state, { kind: "field.clear", layerId, fieldId }).reason).toBe("That warp control no longer exists.");
  expect(() => applyRecipeAction(removed.state, { kind: "layer.setColor", layerId, color: "bad" })).toThrow("Invalid layer settings");
  expect(removed.state.recipe.layers[0].color).toBe(recipe.layers[0].color);
  const pigment = applyRecipeAction(removed.state, { kind: "pigment.edit", layerId,
    command: { kind: "point-strength", index: 0, value: .4 } });
  expect(pigment.state.recipe.layers[0].points[0].weight).toBe(.4);
  const softness = applyRecipeAction(pigment.state, { kind: "softness.edit", layerId,
    command: { kind: "uniform-softness", value: .02 } });
  expect(softness.state.recipe.layers[0].feather).toBe(.02);
  const path = applyRecipeAction(softness.state, { kind: "path.edit", layerId,
    command: { kind: "point-mode", index: 0, mode: "corner" } });
  expect(path.state.recipe.layers[0].points[0].handles?.mode).toBe("corner");
  const point = applyRecipeAction(path.state, { kind: "point.remove", layerId, index: 0 });
  expect(point.state.recipe.layers[0].points).toHaveLength(recipe.layers[0].points.length - 1);
  expect(point.effect.kind).toBe("immediate");
});

test("recipe controller records discrete changes once and keeps inactive Glitter choices local", () => {
  const original = initialRecipe(), layerId = original.layers[0].id;
  let state: RecipeActionState = { recipe: original, active: 0, selected: 0, fieldSelection: {} };
  const choices: GlitterChoices = {}, history = new RecipeHistory(), effects: string[] = [];
  const actions = new RecipeActions(() => state, (next, effect) => { state = next; effects.push(effect.kind); },
    history, choices, () => "preset-one");
  const unsubscribe = actions.subscribe(effect => effects.push(`notify:${effect.kind}`));
  expect(actions.dispatch({ kind: "layer.setFinish", layerId, finish: "glitter" }, true)).toBe(true);
  expect(history.canUndo).toBe(true);
  expect(actions.dispatch({ kind: "glitter.selectModel", layerId, model: "fine" }, true)).toBe(true);
  expect(glitterModel(state.recipe.layers[0].flakes)).toBe("fine");
  expect(actions.dispatch({ kind: "glitter.setDirect", layerId, key: "strength", value: 2.1 }, true)).toBe(true);
  expect(actions.dispatch({ kind: "glitter.selectModel", layerId, model: "classic" }, true)).toBe(true);
  expect(glitterModel(state.recipe.layers[0].flakes)).toBe("classic");
  expect(choices[`preset-one/${layerId}`].fine).toBeDefined();
  expect(actions.dispatch({ kind: "glitter.selectModel", layerId, model: "fine" }, true)).toBe(true);
  expect(state.recipe.layers[0].flakes).toMatchObject({ strength: 2.1 });
  expect(() => actions.dispatch({ kind: "glitter.setIrregular", layerId, key: "count", value: 100 })).toThrow("irregular");
  const detached = actions.snapshot() as unknown as RecipeActionState;
  detached.recipe.layers[0].color = "#000000";
  expect(state.recipe.layers[0].color).toBe(original.layers[0].color);
  expect(history.undo()!.layers[0].finish).toBe("glitter");
  expect(effects).toEqual(["immediate", "notify:immediate", "immediate", "notify:immediate",
    "scheduled", "notify:scheduled", "immediate", "notify:immediate", "immediate", "notify:immediate"]);
  unsubscribe();
});

test("pointer edits preserve target identity, reject stale presets and leave one gesture Undo entry", () => {
  const recipe = initialRecipe(), id = recipe.layers[0].id, target = recipe.layers[0], point = target.points[0];
  let state: RecipeActionState = { recipe, active: 0, selected: 0, fieldSelection: {} }, changes = 0;
  const history = new RecipeHistory(), actions = new RecipeActions(() => state, next => state = next,
    history, {}, () => "draft", () => changes++);
  // Eye makeup's registered gestures apply each frame; the recipe service publishes it.
  const gestures = EYE_MAKEUP.gestures!;
  const applyGesture = (edit: GestureEdit) => {
    const changed = gestures.apply(state.recipe, edit);
    if (changed) actions.publishGesture(changed.layerIndex, changed.kind);
    return !!changed;
  };
  history.checkpoint(recipe);
  expect(applyGesture({ kind: "point.replace", layerId: id, expectedLayer: target,
    index: 0, expectedPoint: point, next: { u: point.u + .005 } })).toBe(true);
  expect(applyGesture({ kind: "point.replace", layerId: id, expectedLayer: target,
    index: 0, expectedPoint: point, next: { u: point.u + .005 } })).toBe(true);
  expect(state.recipe.layers[0]).toBe(target);
  expect(state.recipe.layers[0].points[0]).toBe(point);
  expect(changes).toBe(2);
  const replaced = structuredClone(recipe);
  state = { ...state, recipe: replaced };
  expect(applyGesture({ kind: "point.replace", layerId: id, expectedLayer: target,
    index: 0, expectedPoint: point, next: { u: .9 } })).toBe(false);
  expect(replaced.layers[0].points[0].u).not.toBe(.9);
  expect(history.undo()!.layers[0].points[0].u).toBe(initialRecipe().layers[0].points[0].u);
  expect(history.canUndo).toBe(false);
});

test("viewport lifecycle cancels capture before disposal and routes resize to attached ports", () => {
  const events: string[] = [], viewport = new ViewportAdapter();
  const port = (name: string): ViewportPort => ({
    resize: () => events.push(`${name}:resize`), cancelInput: () => events.push(`${name}:cancel`),
    inputCapture: () => name === "uv", dispose: () => events.push(`${name}:dispose`),
  });
  viewport.attach("uv", port("uv")); viewport.attach("surface", port("surface"));
  expect(viewport.capture()).toEqual({ uv: true, surface: false });
  viewport.resize(); viewport.detach("uv");
  expect(viewport.capture()).toEqual({ uv: false, surface: false });
  viewport.detach();
  expect(events).toEqual(["uv:resize", "surface:resize", "uv:resize", "surface:resize",
    "uv:cancel", "uv:dispose", "surface:cancel", "surface:dispose"]);
});

test("preview commands keep camera and lighting state readable without DOM and explain unavailable actions", () => {
  const calls: string[] = [], camera = { position: [0, 0, 1], target: [0, 0, 0], fov: 30 };
  const port: PreviewPort = {
    cameraState: () => structuredClone(camera), front: () => { calls.push("front"); return false; },
    setFov: degrees => { camera.fov = degrees; return degrees === 10; },
    endFovGesture: () => calls.push("end"), restoreCamera: value => { camera.fov = value.fov; },
    setExposure: value => calls.push(`exposure:${value}`), setLightAngle: value => calls.push(`angle:${value}`),
    setSurfaceControls: () => {}, setWire: () => {}, setNormals: () => {}, setEyeOptics: () => {},
    setHair: () => {}, setDetail: () => {}, setEyeShape: index => calls.push(`eye:${index}`),
    setPiercings: enabled => calls.push(`piercings:${enabled}`),
    setPiercingPreview: (style, definition) => calls.push(`piercing:${style}:${definition}`),
    piercingOptions: () => [{ id: "stud", label: "Stud", choices: [
      { index: 1, definition: "silver", label: "Silver" }] }],
    availability: target => target === "hair" ? "Saved hair unavailable." : undefined,
  };
  const actions = new PreviewActions(freshWorkspace().preview, port);
  expect(actions.capability({ kind: "preview.setHair", enabled: true })).toEqual({ available: false, reason: "Saved hair unavailable." });
  expect(() => actions.dispatch({ kind: "camera.setFov", degrees: 200 })).toThrow("Field of view");
  let notifications = 0; actions.subscribe(() => notifications++);
  expect(actions.dispatch({ kind: "camera.setFov", degrees: 10 }).limited).toBe(true);
  actions.dispatch({ kind: "preview.setExposure", value: 1.5 });
  actions.dispatch({ kind: "preview.setKeyAngle", degrees: 120 });
  const detached = actions.snapshot();
  expect(detached.camera.fov).toBe(10);
  expect(detached.exposure).toBe(1.5);
  const choices = actions.piercingOptions();
  choices[0].choices[0].label = "Forged";
  expect(actions.piercingOptions()[0].choices[0].label).toBe("Silver");
  expect(notifications).toBe(3);
  expect(calls).toEqual(["exposure:1.5", "angle:120"]);
  expect(actions.capability({ kind: "preview.setPiercingPreview", style: "stud", definition: "gold" }).available).toBe(false);
  actions.dispatch({ kind: "preview.setEyeShape", index: 12 });
  actions.dispatch({ kind: "preview.setPiercingPreview", style: "stud", definition: "silver" });
  expect(actions.snapshot()).toMatchObject({ eyeShape: 12, piercingStyle: "stud", piercingDefinition: "silver" });
  actions.rememberEyeShape(9); // A saved morph was already applied by the renderer.
  expect(actions.snapshot().eyeShape).toBe(9);
  expect(calls.filter(call => call.startsWith("eye:"))).toEqual(["eye:12"]);
});

test("eye-shape choices come from the loaded head, and only those choices are accepted", () => {
  const calls: number[] = [];
  const choices = [null, "h011", "h021"].map((target, index) => ({ index, region: "eyes", target, number: String(index + 1).padStart(2, "0") }));
  const port = { cameraState: () => ({ position: [0, 0, 1], target: [0, 0, 0], fov: 30 }), front: () => false, setFov: () => false,
    endFovGesture: () => {}, restoreCamera: () => {}, setExposure: () => {}, setLightAngle: () => {}, setSurfaceControls: () => {},
    setWire: () => {}, setNormals: () => {}, setEyeOptics: () => {}, setHair: () => {}, setDetail: () => {},
    setEyeShape: (index: number) => calls.push(index), setPiercings: () => {}, setPiercingPreview: () => {},
    eyeShapeOptions: () => ({ choices, eyesFollow: true, eyeSource: "base\he_morphs.morphtarget" }) } satisfies PreviewPort;
  const actions = new PreviewActions(freshWorkspace().preview, port);
  expect(actions.eyeShapeOptions().choices.map(choice => choice.target)).toEqual([null, "h011", "h021"]);
  expect(actions.capability({ kind: "preview.setEyeShape", index: 3 })).toMatchObject({ available: false });
  expect(actions.capability({ kind: "preview.setEyeShape", index: 2 }).available).toBe(true);
  actions.dispatch({ kind: "preview.setEyeShape", index: 2 });
  actions.rememberEyeShape(9); // Not offered by this head: ignored.
  expect(actions.snapshot().eyeShape).toBe(2);
  expect(calls).toEqual([2]);
  // A copy: presentation cannot edit the renderer's choice list.
  actions.eyeShapeOptions().choices[0]!.target = "h999";
  expect(actions.eyeShapeOptions().choices[0]!.target).toBeNull();
});
