/** Slice 6: production registered editing, with no application or compatibility document/view. */
import { expect, test } from "bun:test";
import { createAuthoringEditing, createTrustedAuthoringCore } from "./fixtures/makeup-core";
import { makeupEditingState, freshWorkspace } from "../src/app/workspace/makeup-workspace";
import { STUDIO_COMPOSITION } from "../src/compose/studio-registry";
import { createHistoryService } from "../src/platform/core/history-service";
import type { MakeupEditing, MakeupPublication } from "../src/engines/layered-makeup/editor";
import type { RecipeActionState } from "../src/engines/layered-makeup/recipe-actions";
import type { EyeMakeupAction } from "../src/engines/layered-makeup/eye-makeup-model";
import type { EyeMakeupSpec } from "../src/engines/layered-makeup/editing-actions";
import { opticsRecipe } from "./fixtures/workspace-v1-fixtures";

function fixture() {
  const life = new AbortController(), history = createHistoryService();
  const workspace = freshWorkspace(opticsRecipe("owner"));
  const core = createAuthoringEditing(makeupEditingState(workspace, STUDIO_COMPOSITION),
    { signal: life.signal, history, look: { collection: "test", look: "a" }, newId: () => "assigned" }, STUDIO_COMPOSITION);
  const editor = core.editors.get("eye-makeup") as unknown as MakeupEditing;
  const events: MakeupPublication[] = [];
  editor.subscribePublication(event => events.push(event));
  const apply = (action: EyeMakeupAction, record = true) => {
    const route = STUDIO_COMPOSITION.registry.route(action.kind);
    if (!route.ok) throw Error(action.kind);
    return editor.eyeMakeup.apply(route.spec as EyeMakeupSpec, action, record);
  };
  return { ...core, editor, events, apply, life, history };
}

test("slice 6: the registered editor publishes actions, selection and stack changes without the compatibility bundle", () => {
  const f = fixture();
  try {
    const part = f.document.features.document("eye-makeup")!, scope = f.document.history;
    const layer = f.editor.eyeMakeup.state().part.layers[0];
    const version = f.document.version;
    f.apply({ kind: "point.select", layerId: layer.id, index: 1 }, false);
    expect(f.document.version).toBe(version);
    expect(f.events.at(-1)?.effect.kind).toBe("selection");
    f.apply({ kind: "layer.setOpacity", layerId: layer.id, opacity: 0.37 });
    expect(part.part).toBe(f.editor.eyeMakeup.state().part);
    expect(f.editor.eyeMakeup.state().part.layers[0].opacity).toBe(0.37);
    expect(scope.state().depth).toBe(1);
    const previous = f.editor.eyeMakeup.state().part;
    f.apply({ kind: "layer.edit", command: { kind: "add" } });
    expect(f.events.at(-1)).toMatchObject({ effect: { kind: "structure" }, previous });
    expect(f.editor.eyeMakeup.state().part.layers.at(-1)?.id).toBe("assigned");
    expect(f.document.history).toBe(scope);
    expect(scope.undo()).toBe(true);
    expect(f.events.at(-1)?.effect.kind).toBe("restore");
    expect(f.editor.eyeMakeup.state().editor.selected).toBe(0);
  } finally { f.life.abort(); }
});

test("registered controls retain same-content and Escape semantics with one shared history scope", () => {
  const f = fixture();
  try {
    const { controls } = f.editor, layer = f.editor.eyeMakeup.state().part.layers[0], original = layer.opacity;
    expect(controls.begin("opacity", layer.id)).toBe(true);
    expect(controls.edit("opacity", layer.id, { kind: "layer.setOpacity", layerId: layer.id, opacity: 0.2 })).toBe("changed");
    controls.edit("opacity", layer.id, { kind: "layer.setOpacity", layerId: layer.id, opacity: original });
    controls.commit("opacity");
    expect(f.document.history.state().depth).toBe(0);
    controls.begin("opacity", layer.id);
    controls.edit("opacity", layer.id, { kind: "layer.setOpacity", layerId: layer.id, opacity: 0.3 });
    controls.cancel("opacity");
    expect(f.editor.eyeMakeup.state().part.layers[0].opacity).toBe(original);
    expect(f.document.history.state()).toMatchObject({ depth: 0, redoDepth: 0 });
    expect(controls.snapshot()).toBeUndefined();
  } finally { f.life.abort(); }
});

test("registered gesture captures reject replaced points, fields and layers before publishing", () => {
  const f = fixture();
  try {
    const { gestures, eyeMakeup } = f.editor;
    const layer = eyeMakeup.state().part.layers[0];
    expect(gestures.beginLayer("uv", layer.id)).toBe(true);
    expect(gestures.propose("main", { kind: "point.replace", index: 0, next: { u: 0.4 } })).toBe(false);
    layer.points[0] = { ...layer.points[0] };
    expect(gestures.capability("uv", { kind: "point", index: 0 })).toMatchObject({ available: false, code: "missing_target" });
    expect(gestures.propose("uv", { kind: "point.replace", index: 0, next: { u: 0.4 } })).toBe(false);
    const field = layer.fields[0]; layer.fields[0] = { ...field };
    expect(gestures.capability("uv", { kind: "field", fieldId: field.id })).toMatchObject({ available: false, code: "missing_target" });
    f.document.features.document("eye-makeup")!.set({ ...eyeMakeup.state().part, layers: [{ ...layer }] }, eyeMakeup.state().editor);
    expect(gestures.capability("uv", { kind: "shape" })).toMatchObject({ available: false, code: "missing_target" });
    expect(f.events).toEqual([]);
    gestures.cancel("uv");
  } finally { f.life.abort(); }
});

test("registered gesture Escape publishes one restore, preserves selection and never adds Redo", () => {
  const f = fixture();
  try {
    const { gestures, eyeMakeup } = f.editor, before = f.editor.recipe.snapshot();
    const layer = eyeMakeup.state().part.layers[0], point = layer.points[0];
    gestures.beginLayer("uv", layer.id);
    expect(gestures.propose("uv", { kind: "point.replace", index: 0, next: { u: point.u + 0.001 } })).toBe(true);
    expect(gestures.propose("uv", { kind: "point.replace", index: 0, next: { u: point.u + 0.001 } })).toBe(true);
    expect(f.document.history.state().depth).toBe(1);
    expect(f.events.map(e => e.effect.kind)).toEqual(["gesture", "gesture"]);
    gestures.cancel("uv");
    expect(f.editor.recipe.snapshot()).toEqual(before);
    expect(f.events.map(e => e.effect.kind)).toEqual(["gesture", "gesture", "restore"]);
    expect(f.document.history.state()).toMatchObject({ depth: 0, redoDepth: 0 });
  } finally { f.life.abort(); }
});

test("replacement settles a registered control without application listeners; abort revokes retained editing ports", () => {
  const f = fixture(), layer = f.editor.eyeMakeup.state().part.layers[0], before = f.editor.recipe.snapshot();
  f.editor.controls.begin("opacity", layer.id);
  f.editor.controls.edit("opacity", layer.id, { kind: "layer.setOpacity", layerId: layer.id, opacity: 0.25 });
  f.document.replacing();
  expect(f.editor.controls.snapshot()).toBeUndefined();
  expect(f.document.history.state().depth).toBe(1);
  expect(f.editor.controls.edit("opacity", layer.id, { kind: "layer.setOpacity", layerId: layer.id, opacity: 0.3 })).toBe("stale");
  expect(f.document.history.state().depth).toBe(1);
  f.editor.gestures.beginLayer("uv", layer.id);
  f.life.abort();
  expect(f.editor.gestures.snapshot()).toBeUndefined();
  expect(f.history.scope(f.document.scopeId)).toBeUndefined();
  expect(() => f.editor.recipe.snapshot()).toThrow("ended");
  expect(() => f.editor.recipe.commit({ kind: "layer.setOpacity", layerId: layer.id, opacity: 0.2 }, structuredClone(before) as RecipeActionState, { kind: "selection", layerIndex: 0 }, {}, false)).toThrow("ended");
  expect(() => f.editor.recipe.layerChoices()).toThrow("ended");
  expect(() => f.editor.recipe.subscribe(() => {})).toThrow("ended");
  expect(() => f.editor.subscribePublication(() => {})).toThrow("ended");
  expect(() => f.apply({ kind: "layer.setOpacity", layerId: layer.id, opacity: 0.5 })).toThrow("ended");
});

test("the released scope-changing restore resolves the current history target for later edits", () => {
  const f = fixture();
  try {
    const before = f.document.export(), old = f.document.history;
    f.document.restore(before, "look:test/b");
    expect(f.document.history).not.toBe(old);
    const layer = f.editor.eyeMakeup.state().part.layers[0];
    f.apply({ kind: "layer.setOpacity", layerId: layer.id, opacity: 0.22 });
    expect(f.document.history.state().depth).toBe(1);
    expect(f.document.history.undo()).toBe(true);
    expect(f.editor.eyeMakeup.state().part.layers[0].opacity).toBe(layer.opacity);
  } finally { f.life.abort(); }
});

test("the compatibility view forwards the registered editor instances and one effect notification", () => {
  const workspace = freshWorkspace(opticsRecipe("view"));
  const core = createTrustedAuthoringCore(workspace, { resetStack() {}, selectedCollection: () => "a" }, STUDIO_COMPOSITION);
  try {
    const editor = core.editors.get("eye-makeup") as unknown as MakeupEditing;
    expect(core.gestures).toBe(editor.gestures);
    expect(core.controls).toBe(editor.controls);
    expect(core.recipe).toBe(editor.recipe);
    expect(core.eyeMakeup).toBe(editor.eyeMakeup);
    let effects = 0; core.document.subscribeEffects(() => effects++);
    const layer = editor.eyeMakeup.state().part.layers[0], route = STUDIO_COMPOSITION.registry.route("layer.setOpacity");
    if (!route.ok) throw Error("missing fixture action");
    editor.eyeMakeup.apply(route.spec as EyeMakeupSpec, { kind: "layer.setOpacity", layerId: layer.id, opacity: 0.4 }, true);
    expect(effects).toBe(1);
  } finally { core.app.dispose(); core.document.dispose(); }
});

test("production replacement revokes control continuations until an explicit new begin", () => {
  const workspace = freshWorkspace(opticsRecipe("replacement"));
  const core = createTrustedAuthoringCore(workspace, { resetStack() {}, selectedCollection: () => "a" }, STUDIO_COMPOSITION);
  const look = { collection: "local", look: "local" };
  try {
    const layerId = core.document.recipe.layers[0].id;
    const restored = core.document.export();
    restored.recipe.layers[0].opacity = 0.85;
    expect(core.app.controlBegin("opacity", layerId, look)).toBe(true);
    expect(core.app.controlEdit("opacity", { kind: "layer.setOpacity", layerId, opacity: 0.4, look }).ok).toBe(true);
    core.document.restore(restored);
    const before = core.document.export(), version = core.document.version;
    for (let i = 0; i < 2; i++) {
      expect(core.app.controlEdit("opacity", { kind: "layer.setOpacity", layerId, opacity: 0.3, look }))
        .toMatchObject({ ok: false, code: "missing_target" });
      expect(core.document.export()).toEqual(before);
      expect(core.document.version).toBe(version);
      expect(core.controls.snapshot()).toBeUndefined();
    }
    expect(core.document.recipe.layers[0].opacity).toBe(0.85);
    expect(core.document.history.state().depth).toBe(0);
    expect(core.app.controlBegin("opacity", layerId, look)).toBe(true);
    expect(core.app.controlEdit("opacity", { kind: "layer.setOpacity", layerId, opacity: 0.3, look }).ok).toBe(true);
    core.app.controlCommit("opacity");
    expect(core.document.recipe.layers[0].opacity).toBe(0.3);
    expect(core.document.history.state().depth).toBe(1);
  } finally { core.app.dispose(); core.document.dispose(); }
});
