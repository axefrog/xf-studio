import { expect, test } from "bun:test";
import { CollectionService } from "../src/collection-service";
import { collectionDraft } from "../src/collection-workspace";
import { PreviewActions } from "../src/preview-actions";
import { CharacterContextActions } from "../src/character-context-actions";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { freshWorkspace } from "../src/workspace-state";
import { ViewportAttachment } from "../src/viewport-attachment";
import { RECIPE_ACTION_KINDS } from "../src/engines/layered-makeup/recipe-actions";
import { ACTION_DESCRIPTORS, type ActionDescriptor } from "../src/studio-action-descriptors";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS } from "../src/compose/studio-registry";

function fixture() {
  const workspace = freshWorkspace();
  const core = createTrustedAuthoringCore(workspace, { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
  return { workspace, document: core.document, app: core.app, core };
}

test("facade discovers target-specific commands, validates at invocation and detaches snapshots", () => {
  const { app, document } = fixture();
  const id = document.recipe.layers[1].id;
  const choices = app.actionsFor({ kind: "layer", id });
  expect(choices.find(item => item.action.kind === "layer.edit" && item.action.command.kind === "duplicate")?.capability.available).toBe(true);
  expect(app.actionsFor({ kind: "point", layerId: id, index: 999 })[1].capability.available).toBe(false);
  expect(app.actionKinds()).toContain("glitter.selectModel");
  expect(app.requestKinds()).toContain("package");
  const view = app.snapshot() as unknown as { document: { recipe: typeof document.recipe } };
  view.document.recipe.layers[1].name = "Forged";
  expect(document.recipe.layers[1].name).not.toBe("Forged");
  let notifications = 0; const unsubscribe = app.subscribe(() => notifications++);
  const duplicate = choices.find(item => item.action.kind === "layer.edit" && item.action.command.kind === "duplicate")!;
  expect(app.dispatch(duplicate.action).ok).toBe(true);
  expect(document.recipe.layers).toHaveLength(5);
  expect(document.undoDepth).toBe(1);
  expect(app.dispatch({ kind: "layer.edit", command: { kind: "remove", id: "stale" } })).toMatchObject({ ok: false });
  expect(notifications).toBeGreaterThan(0);
  unsubscribe();
});

test("recipe Undo is a current workspace action with live capability and one atomic restore", () => {
  const { app, document } = fixture();
  expect(app.capability({ kind: "history.undo" })).toMatchObject({ available: false });
  const firstId = document.recipe.layers[0].id;
  expect(app.dispatch({ kind: "layer.edit", command: { kind: "duplicate", id: firstId } }).ok).toBe(true);
  expect(document.recipe.layers).toHaveLength(5);
  expect(app.actionsFor({ kind: "workspace" })).toMatchObject([{
    action: { kind: "history.undo" }, capability: { available: true }, undo: "none" }]);
  expect(app.dispatch({ kind: "history.undo" })).toMatchObject({ ok: true, result: true });
  expect(document.recipe.layers).toHaveLength(4);
  expect(document.active).toBeLessThan(document.recipe.layers.length);
  expect(app.dispatch({ kind: "history.undo" })).toMatchObject({ ok: false });
});

test("unavailable 3D device leaves authoring and Undo available with explicit reasons", () => {
  const { app, document } = fixture();
  const reason = "The 3D preview needs your Cyberpunk 2077 game folder.";
  app.setPreviewUnavailable(reason);
  expect(app.capability({ kind: "camera.front" })).toEqual({ available: false, code: "asset_unavailable", reason });
  expect(app.capability({ kind: "motion.setBlink", value: .5 })).toEqual({ available: false, code: "asset_unavailable", reason });
  expect(app.capability({ kind: "preview.setWire", enabled: true })).toEqual({ available: false, code: "asset_unavailable", reason });
  const layer = document.recipe.layers[0], originalColor = layer.color;
  expect(app.canBeginGesture("surface", layer.id)).toMatchObject({ available: false, code: "asset_unavailable" });
  expect(app.canBeginGesture("uv", layer.id).available).toBe(true);
  expect(app.dispatch({ kind: "layer.setColor", layerId: layer.id, color: "#123456" })).toMatchObject({ ok: true });
  expect(document.recipe.layers[0].color).toBe("#123456");
  expect(app.capability({ kind: "history.undo" }).available).toBe(true);
  expect(app.dispatch({ kind: "history.undo" })).toMatchObject({ ok: true });
  expect(document.recipe.layers[0].color).toBe(originalColor);
});

test("saved-V eye suggestion updates application state without applying the morph a second time", async () => {
  const { app } = fixture(), calls: number[] = [];
  const preview = new PreviewActions(freshWorkspace().preview, {
    cameraState: () => ({ position: [0, 0, 1], target: [0, 0, 0], fov: 30 }),
    front: () => false, setFov: () => false, endFovGesture: () => {}, restoreCamera: () => {},
    setExposure: () => {}, setLightAngle: () => {}, setSurfaceControls: () => {},
    setWire: () => {}, setNormals: () => {}, setEyeOptics: () => {}, setHair: () => {},
    setEyeShape: index => calls.push(index), setPiercings: () => {},
    setDetail: () => {},
  });
  app.attach({ preview });
  // Every creator choice is the character context's: before it exists (no 3D preview yet) a change is refused as not ready (CORE-64).
  expect(app.capability({ kind: "character.setOption", part: "head", option: "eyes_color", choice: "x" })).toMatchObject({ available: false, code: "not_ready" });
  app.recordAppliedSavedAppearance({ suggestedEyeShape: 9 });
  const snapshot = app.snapshot();
  expect(snapshot.preview?.eyeShape).toBe(9);
  expect(calls).toEqual([]);
  // With the context attached, its actions route to it; its large reads are shared and frozen, its snapshot is a copy.
  const context = new CharacterContextActions({ showSave: () => {}, creator: {
    panel: async () => ({ phase: "ready", message: "", panel: { schema: "xfs/cc-panel-2", bodyGender: "female", identity: "t", language: null, mods: [], notes: [""],
      options: [{ id: "head/eyes_color", part: "head", name: "eyes_color", label: "Eye Color", type: "appearance", grid: true, count: 2, off: null, defaultChoice: "a",
        mod: -1, link: null, dependsOn: [], coverage: ["rendered", 0] }], sections: [{ id: "Eyes", label: "Eyes", makeup: false, rows: [{ slot: "eyes_color", part: "head", options: [0] }] }],
      counts: { options: 1, choices: 2, modChoices: 0 } } }),
    page: async () => ({ identity: "t", option: "head/eyes_color", query: "", offset: 0, total: 2, choices: [] }),
    view: async () => ({ bodyGender: "female", identity: "t", values: {}, missing: { entries: [], summary: [] }, saveCheck: null, faceMorphs: [] }),
    preset: async () => ({ text: "", values: 0, leftOut: 0, personal: 0 }), wait: async () => {} } });
  context.start();
  await new Promise(resolve => setTimeout(resolve, 5));
  app.attach({ characterContext: context });
  expect(app.dispatch({ kind: "character.setOption", part: "head", option: "eyes_color", choice: "b" }).ok).toBe(true);
  expect(app.previewState().character).toMatchObject({ phase: "ready", set: 1, undo: "Change Eye Color" });
  expect(Object.isFrozen(app.characterPanel())).toBe(true);
  expect(app.dispatch({ kind: "character.undo" }).ok).toBe(true);
  expect(app.previewState().character).toMatchObject({ set: 0, redo: "Change Eye Color" });
  context.dispose();
});

test("facade groups form changes and hides live gesture targets", () => {
  const { app, document } = fixture(), id = document.recipe.layers[0].id;
  const before = document.recipe.layers[0].opacity;
  expect(app.controlBegin("opacity", id)).toBe(true);
  app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .5 });
  app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: id, opacity: .6 });
  app.controlCommit("opacity");
  expect(document.undoDepth).toBe(1);
  expect(document.undoRecipe()?.layers[0].opacity).toBe(before);
  expect(app.canBeginGesture("uv", "stale")).toMatchObject({ available: false, code: "missing_target" });
  expect(app.beginGesture("uv", id)).toBe(true);
  expect(app.canBeginGesture("surface", id)).toMatchObject({ available: false, code: "busy" });
  expect(app.gestureCapability("uv", { kind: "point", index: 0 })).toEqual({ available: true });
  expect(app.gestureCapability("uv", { kind: "point", index: 999 }))
    .toMatchObject({ available: false, code: "missing_target" });
  const point = document.recipe.layers[0].points[0], originalU = point.u;
  expect(app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: originalU + .002 } })).toBe(true);
  app.endGesture("uv", true);
  expect(document.recipe.layers[0].points[0].u).toBe(originalU);
  expect(app.beginGesture("uv", id)).toBe(true);
  document.recipe = structuredClone(document.recipe);
  expect(app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: originalU + .002 } })).toBe(false);
  app.endGesture("uv");
});

test("facade exposes collection target capabilities and typed async outcomes", async () => {
  const { app, document, workspace } = fixture(), presetId = crypto.randomUUID();
  const collection = { schema: "xfas/collection-1" as const, id: crypto.randomUUID(),
    name: "Draft", presets: [{ id: presetId, name: "One", revision: 1, recipe: document.export().recipe }] };
  const service = new CollectionService(STUDIO_DOCUMENTS, collectionDraft(collection, STUDIO_DOCUMENTS), workspace.library,
    () => document.export(), editor => document.restore({ ...editor,
      fieldSelection: editor.fieldSelection ?? {} }), {
      list: async () => [], get: async () => { throw Error("not used"); },
      save: async () => { throw Error("not used"); }, package: async () => { throw Error("not used"); },
    });
  app.attach({ collection: service });
  const copy = app.actionsFor({ kind: "preset", id: presetId }).find(item =>
    item.action.kind === "preset.edit" && item.action.command.kind === "copy")!;
  expect(copy.capability.available).toBe(true);
  expect(copy.undo).toBe("none");
  expect(app.dispatch(copy.action).ok).toBe(true);
  expect(service.view().draft?.collection.presets).toHaveLength(2);
  expect(app.requestCapability({ kind: "package", action: "check" }).available).toBe(true);
  expect(await app.execute({ kind: "refresh" })).toMatchObject({ ok: true, result: { kind: "list" } });
  expect(app.dispatch({ kind: "preset.select", id: "stale" })).toMatchObject({ ok: false });
});

test("descriptors cover every public command, including nested variants and structured reasons", () => {
  const { app, document } = fixture(), layerId = document.recipe.layers[0].id;
  expect(app.actionKinds().length).toBe(Object.keys(app.actionDescriptors()).length);
  expect(app.requestKinds().length).toBe(Object.keys(app.requestDescriptors()).length);
  expect(Object.keys(app.gestureDescriptors())).toEqual([
    "shape.replace", "point.replace", "field.replace", "path.replacePoints"]);
  const layer = app.descriptorsFor({ kind: "layer", id: layerId });
  expect(layer.find(entry => entry.id === "layer.edit")?.variants?.rename.payload.name.maxLength).toBe(80);
  expect(layer.find(entry => entry.id === "glitter.setDirect")?.variants?.strength.payload.value.max).toBe(32);
  expect(layer.find(entry => entry.id === "layer.setOpacity")?.requiresInput).toBe(true);
  expect(app.descriptorsFor({ kind: "point", layerId, index: 999 })[0].targetCapability)
    .toMatchObject({ available: false, code: "missing_target" });
  expect(app.capability({ kind: "point.remove", layerId, index: 999 }))
    .toMatchObject({ available: false, code: "missing_target" });
  document.recipe.layers[0].points.splice(3);
  expect(app.capability({ kind: "point.remove", layerId, index: 0 }))
    .toMatchObject({ available: false, code: "limit" });
  expect(app.requestCapability({ kind: "save" }))
    .toMatchObject({ available: false, code: "not_ready" });
});

test("context queries validate target, payload and live enum choices for menus and shortcuts", () => {
  const { app, document } = fixture(), id = document.recipe.layers[0].id;
  const target = { kind: "layer" as const, id };
  expect(app.contextCapability(target, { kind: "layer.setOpacity", layerId: id, opacity: 1.1 }))
    .toMatchObject({ available: false, code: "limit" });
  expect(app.contextCapability(target, { kind: "layer.setOpacity", layerId: "wrong", opacity: .5 }))
    .toMatchObject({ available: false, code: "missing_target" });
  expect(app.contextCapability(target, { kind: "point.remove", layerId: id, index: 0 }))
    .toMatchObject({ available: false, code: "invalid_value" });
  const finishes = app.choicesFor(target, "layer.setFinish", "finish");
  expect(finishes.find(choice => choice.value === "glitter")?.capability.available).toBe(true);
  const models = app.choicesFor(target, "glitter.selectModel", "model");
  expect(models.find(choice => choice.value === "fine")?.capability)
    .toMatchObject({ available: false, code: "incompatible_mode" });
  expect(app.choicesFor({ kind: "viewport" }, "quality.set", "size").map(choice => choice.value))
    .toEqual([512, 1024, 2048, 4096]);
});

test("hit-context query binds point, tangent and shape commands to live geometry", () => {
  const { app, document } = fixture(), layerId = document.recipe.layers[0].id;
  const empty = app.contextQuery({ kind: "uv-empty" });
  expect(empty.options).toEqual([]);
  expect(app.dispatchContext(empty.context, { kind: "field.add", layerId }))
    .toMatchObject({ ok: false, code: "invalid_value" });

  const shape = app.contextQuery({ kind: "shape", layerId });
  expect(shape.options.find(item => item.id === "shape.addWarp")?.capability.available).toBe(true);
  const fieldCount = document.recipe.layers[0].fields.length;
  expect(app.dispatchContext(shape.context, { kind: "field.add", layerId })).toMatchObject({ ok: true });
  expect(document.recipe.layers[0].fields).toHaveLength(fieldCount + 1);
  expect(app.dispatchContext(shape.context, { kind: "field.add", layerId }))
    .toMatchObject({ ok: false, code: "missing_target" });

  const point = app.contextQuery({ kind: "point", layerId, index: 1 });
  expect(point.options.find(item => item.id === "point.strength")?.requiresInput).toBe(true);
  expect(point.options.find(item => item.id === "point.softness")?.capability)
    .toMatchObject({ available: false, code: "incompatible_mode" });
  expect(app.boundActionCapability(point.context, { kind: "point.remove", layerId, index: 0 }))
    .toMatchObject({ available: false, code: "missing_target" });
  expect(app.dispatchContext(point.context, { kind: "pigment.edit", layerId,
    command: { kind: "point-strength", index: 1, value: .42 } })).toMatchObject({ ok: true });
  expect(document.recipe.layers[0].points[1].weight).toBe(.42);
  expect(app.dispatchContext(point.context, { kind: "point.remove", layerId, index: 1 }))
    .toMatchObject({ ok: false, code: "missing_target" });

  const tangent = app.contextQuery({ kind: "tangent", layerId, index: 1, side: "outgoing" });
  expect(tangent.options.find(item => item.id === "point.select")?.capability.available).toBe(true);
  expect(app.boundActionCapability(tangent.context, { kind: "point.select", layerId, index: 2 }))
    .toMatchObject({ available: false, code: "missing_target" });
});

test("viewport hit query binds the current geometry revision without selection or Undo", () => {
  const { app, document } = fixture(), layerId = document.recipe.layers[0].id;
  const port = new ViewportAttachment<string>({
    moveHost: () => {}, measure: () => ({ width: 400, height: 200 }), resize: () => {},
    cancelInput: () => {}, inputCapture: () => false,
    headView: () => undefined, uvView: () => undefined,
    uvCommand: () => false,
    hitAt: () => ({ hit: { kind: "point", layerId, index: 0 }, mirror: true, affordance: "point" }),
    queryContext: hit => app.contextQuery(hit),
  });
  expect(port.contextAt("uv", 10, 10)).toBeUndefined();
  port.setReady("uv");
  const before = document.snapshot(), hit = port.contextAt("uv", 10, 10)!;
  expect(hit).toMatchObject({ source: "uv", mirror: true, affordance: "point",
    context: { hit: { kind: "point", layerId, index: 0 },
      geometryRevision: document.geometryVersion.revision } });
  expect(hit.options.find(option => option.id === "point.select")?.capability.available).toBe(true);
  expect(document.snapshot()).toEqual(before);
  document.recipe = structuredClone(document.recipe);
  expect(app.contextOptionsFor(hit.context).every(option => option.capability.code === "missing_target")).toBe(true);
});

test("hit-context commands recheck field, layer and collection identity at invocation", () => {
  const { app, document, workspace } = fixture(), layerId = document.recipe.layers[0].id;
  const fieldId = document.recipe.layers[0].fields[0].id;
  const field = app.contextQuery({ kind: "field", layerId, id: fieldId });
  expect(field.options.find(item => item.id === "field.reach")?.requiresInput).toBe(true);
  expect(app.boundActionCapability(field.context, { kind: "field.setReach", layerId,
    fieldId, radius: .5 })).toMatchObject({ available: false, code: "limit" });
  expect(app.dispatchContext(field.context, { kind: "field.remove", layerId, fieldId }))
    .toMatchObject({ ok: true });
  expect(app.dispatchContext(field.context, { kind: "field.clear", layerId, fieldId }))
    .toMatchObject({ ok: false, code: "missing_target" });

  const presetId = crypto.randomUUID();
  const collection = { schema: "xfas/collection-1" as const, id: crypto.randomUUID(),
    name: "Draft", presets: [{ id: presetId, name: "One", revision: 1,
      recipe: document.export().recipe }] };
  const service = new CollectionService(STUDIO_DOCUMENTS, collectionDraft(collection, STUDIO_DOCUMENTS), workspace.library,
    () => document.export(), editor => document.restore({ ...editor,
      fieldSelection: editor.fieldSelection ?? {} }), {
      list: async () => [], get: async () => { throw Error("not used"); },
      save: async () => { throw Error("not used"); }, package: async () => { throw Error("not used"); },
    });
  app.attach({ collection: service });
  const layer = app.contextQuery({ kind: "layer", id: layerId });
  const preset = app.contextQuery({ kind: "preset", id: presetId });
  expect(preset.options.find(item => item.id === "preset.rename")?.requiresInput).toBe(true);
  expect(app.dispatchContext(preset.context, { kind: "preset.edit",
    command: { kind: "rename", id: presetId, name: "Renamed" } })).toMatchObject({ ok: true });
  expect(app.dispatchContext(preset.context, { kind: "preset.edit",
    command: { kind: "remove", id: presetId } })).toMatchObject({ ok: false, code: "missing_target" });
  expect(app.dispatchContext(layer.context, { kind: "layer.edit",
    command: { kind: "duplicate", id: layerId } })).toMatchObject({ ok: false, code: "missing_target" });
  const collectionHit = app.contextQuery({ kind: "collection" });
  expect(collectionHit.options.find(item => item.id === "preset.add")?.capability.available).toBe(true);
  expect(app.dispatchContext(collectionHit.context, { kind: "preset.edit",
    command: { kind: "add" } })).toMatchObject({ ok: true });
  expect(app.dispatchContext(collectionHit.context, { kind: "preset.edit",
    command: { kind: "add" } })).toMatchObject({ ok: false, code: "missing_target" });
});

test("Undo policies and recipe routing come from the descriptor table, not parallel lists (CORE-08)", () => {
  const { app, document } = fixture(), layer = document.recipe.layers[0];
  // Every recipe action kind has a descriptor; selection-only ones are exactly the "selection" effects.
  for (const kind of RECIPE_ACTION_KINDS) expect(kind in ACTION_DESCRIPTORS).toBe(true);
  expect([...RECIPE_ACTION_KINDS].filter(kind =>
    ACTION_DESCRIPTORS[kind as keyof typeof ACTION_DESCRIPTORS].effect === "selection").sort())
    .toEqual(["field.select", "layer.select", "point.select"]);
  const expected = (action: { kind: string; command?: { kind: string }; key?: string }) => {
    const descriptor: ActionDescriptor = ACTION_DESCRIPTORS[action.kind as keyof typeof ACTION_DESCRIPTORS];
    const variant = action.command?.kind ?? action.key;
    return (variant && descriptor.variants?.[variant]?.undo) || descriptor.undo;
  };
  const targets = [{ kind: "workspace" as const }, { kind: "collection" as const }, { kind: "viewport" as const },
    { kind: "layer" as const, id: layer.id }, { kind: "point" as const, layerId: layer.id, index: 0 }];
  let checked = 0;
  for (const target of targets) for (const info of app.actionsFor(target)) {
    expect(info.undo).toBe(expected(info.action as never)); checked++;
  }
  expect(checked).toBeGreaterThan(10);
});
