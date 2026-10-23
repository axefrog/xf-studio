import { expect, test } from "bun:test";
import { newPresetName } from "../src/app/workspace/collection-workspace";
import { profileStudio } from "./fixtures/profile-studio";
import { RECIPE_HISTORY, recipeHistory } from "../src/legacy/eye-makeup/editor-actions";
import { recipeActionCapability, type RecipeActionState } from "../src/engines/layered-makeup/recipe-actions";
import type { Recipe } from "../src/engines/layered-makeup/recipe";
import { createTrustedAuthoringCore } from "../src/app/trusted-authoring-core";
import { PreviewActions, type PreviewPort } from "../src/preview/preview-actions";
import { ViewportAdapter, type ViewportPort } from "../src/app/viewport-adapter";
import { glitterModel, type GlitterChoices } from "../src/engines/layered-makeup/glitter-model";
import { EYE_MAKEUP } from "../src/features/eye-makeup";
import type { GestureEdit } from "../src/engines/layered-makeup/recipe-actions";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { applyLayerAction, applyRecipeAction, freshWorkspace, initialRecipe } from "./fixtures/eye-region";
import { layerCapability } from "../src/engines/layered-makeup/layer-stack";
import { RecipeActions } from "../src/legacy/eye-makeup/authoring-eye-makeup";

import { namedCore } from "./fixtures/named-targets";
test("collection commands keep UI views isolated and notify only after valid transitions", async () => {
  const studio = await profileStudio({ name: "Collection", looks: [{ name: "First", recipe: initialRecipe() }] });
  await studio.collection.initialize();
  await studio.settle();
  const service = studio.service, preset = studio.scene.look()!.look;
  let changes = 0;
  const unsubscribe = service.subscribe(() => changes++);
  const view = service.view(); (view.draft as unknown as { presets: { name: string }[] }).presets[0]!.name = "Tampered";
  expect(service.view().draft!.presets[0]!.name).toBe("First");
  expect(service.actionCapability({ kind: "preset.edit", collection: studio.shown()!, command: { kind: "restore" } })).toEqual({
    available: false, code: "invalid_value", reason: "No removed preset to restore." });
  expect(() => service.dispatch({ kind: "preset.edit", collection: studio.shown()!, command: { kind: "remove", id: crypto.randomUUID() } })).toThrow("no longer exists");
  expect(changes).toBe(0);
  service.dispatch({ kind: "preset.edit", collection: studio.shown()!, command: { kind: "copy", id: preset } });
  const copyId = service.view().draft!.selected!;
  expect(copyId).not.toBe(preset);
  studio.app.dispatch({ kind: "layer.setColor", layerId: studio.document.recipe.layers[0]!.id, color: "#112233" });
  studio.app.dispatch(studio.choose(preset));
  studio.app.dispatch(studio.choose(copyId));
  expect(studio.document.recipe.layers[0]!.color).toBe("#112233");
  service.dispatch({ kind: "collection.rename", collection: studio.shown()!, name: " Renamed " });
  expect(service.view().draft!.name).toBe("Renamed");
  expect(changes).toBeGreaterThan(0);
  await studio.settle();
  unsubscribe();
  const seen = changes;
  service.dispatch({ kind: "collection.rename", collection: studio.shown()!, name: "Unobserved" });
  expect(changes).toBe(seen);
});

/** One recipe's Undo stack on its own: the history service's stack over eye makeup's part. */
const recipeStack = (entries: Recipe[] = []) => recipeHistory(entries);
const EYE = RECIPE_HISTORY.feature;

test("layer commands preserve source recipes and history restores a complete edit", async () => {
  const source = initialRecipe(), id = source.layers[0].id;
  let history = recipeStack();
  history.checkpoint(() => source, [EYE]); history.checkpoint(() => source, [EYE]);
  const hidden = applyLayerAction(source, id, { kind: "layer.setEnabled", id, enabled: false });
  expect(source.layers[0].enabled).toBe(true);
  expect(hidden.recipe.layers[0].enabled).toBe(false);
  expect(hidden.structure).toBe(false);
  expect(layerCapability(source, { kind: "layer.edit", command: { kind: "move", id, to: 100 } }).available).toBe(false);
  expect(() => applyLayerAction(source, id, { kind: "layer.edit", command: { kind: "rename", id: "stale", name: "Lost" } })).toThrow("no longer exists");
  expect(history.revert()?.[EYE]).toEqual(source);
  expect(history.canUndo).toBe(false);
  history = recipeStack([source]);
  const view = history.bodies(EYE) as Recipe[]; view[0].layers[0].name = "Changed";
  expect((history.revert()?.[EYE] as Recipe).layers[0].name).toBe(source.layers[0].name);
});

test("a new preset's default name never repeats another preset's", () => {
  expect(newPresetName([])).toBe("Preset 1");
  expect(newPresetName([{ name: "Untitled look" }])).toBe("Preset 2");
  // "Untitled look" removed after "Preset 2" was added: the next count is taken, so the next free number follows.
  expect(newPresetName([{ name: "Preset 2" }])).toBe("Preset 3");
  expect(newPresetName([{ name: "Preset 3" }, { name: "Preset 4" }])).toBe("Preset 5");
  // A removed preset Restore can bring back keeps its name: Preset 2 removed, Add gives Preset 3, not a second Preset 2.
  expect(newPresetName([{ name: "Preset 1" }], [{ name: "Preset 2" }])).toBe("Preset 3");
});

test("add, remove, add, then Restore never leaves two presets with one name (CORE-124)", async () => {
  const studio = await profileStudio({ looks: [{ name: "Preset 1", recipe: initialRecipe() }] });
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const names = () => studio.service.summary().draft!.presets.map(preset => preset.name);
  const edit = (command: Parameters<typeof studio.service.dispatch>[0] extends infer A ? A extends { kind: "preset.edit"; command: infer C } ? C : never : never) =>
    studio.service.dispatch({ kind: "preset.edit", collection: studio.shown()!, command });
  edit({ kind: "add", newId: id(2) });
  edit({ kind: "add", newId: id(3) });
  expect(names()).toEqual(["Preset 1", "Preset 2", "Preset 3"]);
  edit({ kind: "remove", id: id(3) });
  edit({ kind: "add", newId: id(4) });
  expect(names()).toEqual(["Preset 1", "Preset 2", "Preset 4"]);
  edit({ kind: "restore" });
  expect(names()).toEqual(["Preset 1", "Preset 2", "Preset 3", "Preset 4"]);
  expect(new Set(names()).size).toBe(names().length);
});

test("preset add and copy take their IDs from the host or the action (CORE-44)", async () => {
  // A new preset's ID comes from the host (or the action); one already in use is refused.
  const studio = await profileStudio({ looks: [{ name: "First", recipe: initialRecipe() }] });
  const preset = studio.scene.look()!.look;
  let n = 10;
  const id = () => `00000000-0000-4000-8000-0000000000${n++}`;
  expect(studio.app.dispatch({ kind: "preset.edit", collection: studio.shown()!, command: { kind: "add", newId: id() } }).ok).toBe(true);
  studio.app.dispatch(studio.choose(preset));
  expect(studio.app.dispatch({ kind: "preset.edit", collection: studio.shown()!, command: { kind: "copy", id: preset, newId: id() } }).ok).toBe(true);
  expect(studio.service.summary().draft!.presets.map(look => look.id)).toEqual([preset, "00000000-0000-4000-8000-000000000011",
    "00000000-0000-4000-8000-000000000010"]);
  expect(studio.app.capability({ kind: "preset.edit", collection: studio.shown()!, command: { kind: "add", newId: preset } }))
    .toMatchObject({ available: false, reason: "That preset ID is already in use." });
});

test("recipe actions validate point, field, pigment, softness and material edits atomically", () => {
  const recipe = initialRecipe(), layerId = recipe.layers[0].id;
  const start: RecipeActionState = { recipe, active: 0, selected: 0, fieldSelection: {} };
  // The new warp's ID comes from the host; the pure apply never invents one (CORE-44).
  expect(() => applyRecipeAction(start, { kind: "field.add", layerId })).toThrow("ID from the host");
  const added = applyRecipeAction(start, { kind: "field.add", layerId, fieldId: "warp-2" });
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
  expect(recipeActionCapability(removed.state, { kind: "field.clear", layerId, fieldId }).reason).toBe("That warp no longer exists.");
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

test("recipe edits through app.dispatch record discrete changes once and keep inactive Glitter choices local", () => {
  const original = initialRecipe(), layerId = original.layers[0].id;
  const workspace = freshWorkspace(original), choices: GlitterChoices = workspace.glitterChoices, effects: string[] = [];
  const { app, document, recipe } = namedCore(createTrustedAuthoringCore(workspace,
    { resetStack: () => {}, selectedCollection: () => "preset-one" }, STUDIO_COMPOSITION));
  const unsubscribe = recipe.subscribe(effect => effects.push(effect.kind));
  const dispatch = (action: Parameters<typeof app.dispatch>[0]) => app.dispatch(action);
  expect(dispatch({ kind: "layer.setFinish", layerId, finish: "glitter" }).ok).toBe(true);
  expect(document.history.canUndo()).toBe(true);
  expect(dispatch({ kind: "glitter.selectModel", layerId, model: "fine" }).ok).toBe(true);
  expect(glitterModel(document.recipe.layers[0].flakes)).toBe("fine");
  expect(dispatch({ kind: "glitter.setDirect", layerId, key: "strength", value: 2.1 }).ok).toBe(true);
  expect(dispatch({ kind: "glitter.selectModel", layerId, model: "classic" }).ok).toBe(true);
  expect(glitterModel(document.recipe.layers[0].flakes)).toBe("classic");
  expect(choices[`preset-one/${layerId}`].fine).toBeDefined();
  expect(dispatch({ kind: "glitter.selectModel", layerId, model: "fine" }).ok).toBe(true);
  expect(document.recipe.layers[0].flakes).toMatchObject({ strength: 2.1 });
  expect(dispatch({ kind: "glitter.setIrregular", layerId, key: "count", value: 100 })).toMatchObject({ ok: false });
  const detached = recipe.snapshot() as unknown as RecipeActionState;
  detached.recipe.layers[0].color = "#000000";
  expect(document.recipe.layers[0].color).toBe(original.layers[0].color);
  expect(document.history.state().depth).toBe(5);
  for (let i = 0; i < 4; i++) app.dispatch({ kind: "history.undo" });
  expect(document.recipe.layers[0].finish).toBe("glitter");
  expect(effects).toEqual(["immediate", "immediate", "scheduled", "immediate", "immediate"]);
  unsubscribe();
});

test("pointer edits preserve target identity, reject stale presets and leave one gesture Undo entry", () => {
  const recipe = initialRecipe(), id = recipe.layers[0].id, target = recipe.layers[0], point = target.points[0];
  let state: RecipeActionState = { recipe, active: 0, selected: 0, fieldSelection: {} }, changes = 0;
  const history = recipeStack(), actions = new RecipeActions(() => state, next => state = next,
    { checkpoint: (value: Recipe) => history.checkpoint(() => value, [EYE]) }, {}, () => "draft", () => changes++);
  // Eye makeup's registered gestures apply each frame; the recipe service publishes it.
  const gestures = EYE_MAKEUP.gestures!;
  const applyGesture = (edit: GestureEdit) => {
    const changed = gestures.apply(state.recipe, edit);
    if (changed) actions.publishGesture(changed.layerIndex, changed.kind);
    return !!changed;
  };
  history.checkpoint(() => recipe, [EYE]);
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
  expect((history.revert()?.[EYE] as Recipe).layers[0].points[0].u).toBe(initialRecipe().layers[0].points[0].u);
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
    setLighting: source => calls.push(source.kind === "setup" ? `lighting:${source.setup.exposure}/${source.setup.lights[0]!.position.map(n => n.toFixed(3))}` : "lighting:game"),
    setSurfaceControls: () => {}, setWire: () => {}, setNormals: () => {}, setEyeOptics: () => {},
    setHair: () => {}, setDetail: () => {}, setEyeShape: index => calls.push(`eye:${index}`),
    setPiercings: enabled => calls.push(`piercings:${enabled}`),
    availability: target => target === "hair" ? "Saved hair unavailable." : undefined,
  };
  const actions = new PreviewActions(freshWorkspace().preview, port);
  expect(actions.capability({ kind: "preview.setHair", view: "main", enabled: true })).toEqual({ available: false, reason: "Saved hair unavailable." });
  expect(() => actions.dispatch({ kind: "camera.setFov", view: "main", degrees: 200 })).toThrow("Field of view");
  let notifications = 0; actions.subscribe(() => notifications++);
  expect(actions.dispatch({ kind: "camera.setFov", view: "main", degrees: 10 }).limited).toBe(true);
  actions.dispatch({ kind: "preview.setExposure", view: "main", value: 1.5 });
  actions.dispatch({ kind: "preview.setKeyAngle", view: "main", degrees: 120 });
  const detached = actions.snapshot();
  expect(detached.camera.fov).toBe(10);
  expect(detached.exposure).toBe(1.5);
  expect(notifications).toBe(3);
  // Both changes light the view by the fork of Soft studio they made: the exposure, then the key turned to 120°.
  expect(calls).toEqual(["lighting:1.5/-0.300,1.900,-0.500", "lighting:1.5/0.505,1.900,0.292"]);
  actions.dispatch({ kind: "preview.setEyeShape", view: "main", index: 12 });
  expect(actions.snapshot()).toMatchObject({ eyeShape: 12 });
  // A piercing style is a creator choice, the character context's, not a preview preference.
  expect("piercingStyle" in actions.snapshot()).toBe(false);
  actions.rememberEyeShape(9); // A saved morph was already applied by the renderer.
  expect(actions.snapshot().eyeShape).toBe(9);
  expect(calls.filter(call => call.startsWith("eye:"))).toEqual(["eye:12"]);
});

test("eye-shape choices come from the loaded head, and only those choices are accepted", () => {
  const calls: number[] = [];
  const choices = [null, "h011", "h021"].map((target, index) => ({ index, region: "eyes", target, number: String(index + 1).padStart(2, "0") }));
  const port = { cameraState: () => ({ position: [0, 0, 1], target: [0, 0, 0], fov: 30 }), front: () => false, setFov: () => false,
    endFovGesture: () => {}, restoreCamera: () => {}, setSurfaceControls: () => {},
    setWire: () => {}, setNormals: () => {}, setEyeOptics: () => {}, setHair: () => {}, setDetail: () => {},
    setEyeShape: (index: number) => calls.push(index), setPiercings: () => {},
    eyeShapeOptions: () => ({ choices, eyesFollow: true, eyeSource: "base\he_morphs.morphtarget" }) } satisfies PreviewPort;
  const actions = new PreviewActions(freshWorkspace().preview, port);
  expect(actions.eyeShapeOptions().choices.map(choice => choice.target)).toEqual([null, "h011", "h021"]);
  expect(actions.capability({ kind: "preview.setEyeShape", view: "main", index: 3 })).toMatchObject({ available: false });
  expect(actions.capability({ kind: "preview.setEyeShape", view: "main", index: 2 }).available).toBe(true);
  actions.dispatch({ kind: "preview.setEyeShape", view: "main", index: 2 });
  actions.rememberEyeShape(9); // Not offered by this head: ignored.
  expect(actions.snapshot().eyeShape).toBe(2);
  expect(calls).toEqual([2]);
  // A copy: presentation cannot edit the renderer's choice list.
  actions.eyeShapeOptions().choices[0]!.target = "h999";
  expect(actions.eyeShapeOptions().choices[0]!.target).toBeNull();
});

test("UI-79: the whole-body view is offered only while the body is shown", () => {
  const framed: string[] = [];
  const port = { cameraState: () => ({ position: [0, 0, 1], target: [0, 0, 0], fov: 30 }), front: () => false, setFov: () => false,
    endFovGesture: () => {}, restoreCamera: () => {}, setSurfaceControls: () => {},
    setWire: () => {}, setNormals: () => {}, setEyeOptics: () => {}, setHair: () => {}, setDetail: () => {}, setEyeShape: () => {}, setPiercings: () => {},
    setBody: (enabled: boolean) => framed.push(`body:${enabled}`), frameBody: () => { framed.push("frame"); return false; } } satisfies PreviewPort;
  const actions = new PreviewActions(freshWorkspace().preview, port);
  expect(actions.capability({ kind: "camera.body", view: "main" }).available).toBe(true);
  actions.dispatch({ kind: "preview.setBody", view: "main", enabled: false });
  expect(actions.capability({ kind: "camera.body", view: "main" })).toMatchObject({ available: false, reason: "Turn the body on to see the whole body." });
  expect(() => actions.dispatch({ kind: "camera.body", view: "main" })).toThrow("Turn the body on");
  actions.dispatch({ kind: "preview.setBody", view: "main", enabled: true });
  actions.dispatch({ kind: "camera.body", view: "main" });
  expect(framed).toEqual(["body:false", "body:true", "frame"]);
});
