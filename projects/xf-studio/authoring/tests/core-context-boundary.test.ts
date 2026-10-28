import { expect, test } from "bun:test";
import { createAuthoringEditing, createTrustedAuthoringCore } from "../src/app/trusted-authoring-core";
import { StudioApplication } from "../src/app/studio-application";
import { createStudioPresentation } from "../src/app/studio-presentation";
import { STUDIO_OWNERS, STUDIO_COMPOSITION } from "../src/compose/studio-registry";
import type { FeatureApplication } from "../src/app/feature-application";
import { Registry, type AnyOwner } from "../src/platform/core/registry";
import { createHistoryService, lookScope } from "../src/platform/core/history-service";
import { editorComposition, SYNTHETIC_ID, SYNTHETIC_LAYERED, FIXTURE_LOOK } from "./fixtures/editor-composition";
import { freshWorkspace } from "../src/app/workspace/makeup-workspace";
import { opticsRecipe } from "./fixtures/workspace-v1-fixtures";
import { Frame, StudioRuntime, type Port } from "../src/studio-ui/runtime";
import type { Feedback } from "../src/studio-ui/feedback";
import { contextItems } from "../src/studio-ui/target-menus";
import { ViewportInputHints } from "../src/studio-ui/input-hints";

function neutral(synthetic: boolean) {
  const contribution: FeatureApplication = { context(s) {
    return {
      handles: hit => hit.kind === "layer", revision: () => s.document.version,
      target: target => target.kind === "layer" ? { available: target.id === "first" } : undefined,
      validate: () => undefined, detail: () => "Synthetic detail",
      selected: () => ({ hit: { kind: "layer", id: "first" }, label: "Synthetic selection" }),
      inputFacts: () => ({ hasTarget: true, enabled: true, locked: false }),
      candidates: () => [{ id: "synthetic.value", label: "Synthetic value", icon: "target", requiresInput: true,
        actionKind: "synthetic.setValue" as never,
        input: { kind: "integer", label: "Value", value: 1, min: 0, max: 10, title: "Synthetic value", apply: "Apply",
          make: value => ({ kind: "synthetic.setValue", id: "first", value: Number(value) } as never) } }],
    };
  } };
  const spec = SYNTHETIC_LAYERED.actions["synthetic.setValue"];
  const module = { ...SYNTHETIC_LAYERED, application: contribution, actions: {
    "synthetic.setValue": { ...spec, descriptor: { ...spec.descriptor, scope: ["look", "layer"] as const } } } };
  const fixtures = editorComposition(synthetic ? [module as never] : []), history = createHistoryService(), life = new AbortController();
  const registry = new Registry<AnyOwner>([...STUDIO_OWNERS.filter(owner => owner.owner !== "feature"), ...(synthetic ? [module as never] : [])]);
  const editing = createAuthoringEditing(synthetic ? { features: { [SYNTHETIC_ID]: { part: module.part.starter() } } } : {},
    { history, signal: life.signal, look: FIXTURE_LOOK, scope: lookScope(FIXTURE_LOOK) }, { registry, documents: { parts: fixtures.parts } });
  const app = new StudioApplication({ ...editing, history }, registry);
  const port = createStudioPresentation({ authoring: app, naming: () => ({ look: FIXTURE_LOOK, scope: lookScope(FIXTURE_LOOK) }),
    library: {} as never, files: {} as never, viewport: {} as never, preferences: {} as never, previewReadiness: {} as never });
  return { app, port, editing, life, close() { app.dispose(); life.abort(); } };
}

test("slice 7: empty runtime, frame input facts and context queries require no makeup facade or recipe", () => {
  const f = neutral(false);
  try {
    const rt = new StudioRuntime(f.port as unknown as Port, { toast() {}, record() {} } as unknown as Feedback);
    Object.defineProperties(rt, { editor: { get() { throw Error("Deprecated editor touched"); } },
      finishes: { get() { throw Error("Deprecated finishes touched"); } } });
    expect(rt.key("plain")).toBe("plain");
    rt.changed();
    expect(rt.dispatch({ kind: "history.undo", scope: lookScope(FIXTURE_LOOK) })).toBe(false);
    expect(rt.descriptors).toEqual(f.port.authoring.actionDescriptors());
    expect(new Frame(rt.port).inputFacts).toEqual({ hasTarget: false, enabled: false, locked: false });
    expect(f.port.feature("eye-makeup")).toBeUndefined();
    expect(f.app.contextQuery({ kind: "point", layerId: "absent", index: 0 }).options).toEqual([]);
    expect(f.app.contextSelected()).toBeUndefined();
    expect(f.app.contextQuery({ kind: "uv-empty" }).targetCapability).toEqual({ available: true });
    expect("recipe" in f.editing.document).toBe(false);
  } finally { f.close(); }
});

test("slice 7: synthetic context inputs, labels, selection and facts follow registration over neutral state", () => {
  const f = neutral(true);
  try {
    const rt = new StudioRuntime(f.port as unknown as Port, {} as Feedback);
    const query = f.port.authoring.contextQuery({ kind: "layer", id: "first" });
    expect(query.options).toHaveLength(1);
    expect(query.options[0]).toMatchObject({ label: "Synthetic value", input: { label: "Value", value: 1 } });
    expect(query.options[0].input).not.toHaveProperty("make");
    expect(contextItems(rt, query, { x: 0, y: 0 })[0]).toMatchObject({ label: "Synthetic value", icon: "target", capability: { available: true } });
    expect(f.app.contextSelected()?.label).toBe("Synthetic selection");
    expect(f.app.contextDetail(query.context.hit)).toBe("Synthetic detail");
    expect(new Frame(rt.port).inputFacts.hasTarget).toBe(true);
    const action = f.port.authoring.contextInputAction(query.context, "synthetic.value", 7)!;
    expect(f.port.authoring.dispatchContext(query.context, action).ok).toBe(true);
    expect(f.app.featureState(SYNTHETIC_ID)).toMatchObject({ part: { layers: [{ id: "first", value: 7 }, { id: "second", value: 2 }] } });
    expect(f.port.authoring.boundActionCapability(query.context, action)).toMatchObject({ available: false, code: "missing_target" });
    expect(f.port.feature("eye-makeup")).toBeUndefined();
  } finally { f.close(); }
});

test("toast Undo captures its look and step, ignores focus/selection, and refuses later edits and replacement", () => {
  const core = createTrustedAuthoringCore(freshWorkspace(opticsRecipe("undo")), { resetStack() {}, selectedCollection: () => "a" }, STUDIO_COMPOSITION);
  const look = { collection: "local", look: "local" }, layerId = core.document.recipe.layers[0].id;
  const edit = (opacity: number) => core.app.dispatch({ kind: "layer.setOpacity", layerId, opacity, look });
  try {
    const original = core.document.recipe.layers[0].opacity;
    expect(edit(0.3).ok).toBe(true);
    const undo = core.app.captureUndo();
    let blocked = true;
    core.app.attach({ access: { refusal: () => blocked ? { available: false, code: "unavailable", reason: "This workspace is read-only." } : undefined } });
    expect(undo()).toEqual({ ok: false, code: "unavailable", message: "This workspace is read-only." });
    expect(core.document.recipe.layers[0].opacity).toBe(0.3);
    blocked = false;
    core.document.selected = 1;
    const other = core.history.open("look:other/other", { read: () => undefined, apply: () => true });
    other.checkpoint(["other"]);
    expect(undo().ok).toBe(true);
    expect(core.document.recipe.layers[0].opacity).toBe(original);
    core.history.close(other.id);
    expect(edit(0.4).ok).toBe(true);
    const stale = core.app.captureUndo();
    expect(edit(0.5).ok).toBe(true);
    const state = core.document.export();
    expect(stale()).toMatchObject({ ok: false, code: "missing_target" });
    expect(core.document.export()).toEqual(state);
    const replaced = core.app.captureUndo();
    core.document.restore(state);
    expect(replaced()).toMatchObject({ ok: false, code: "missing_target" });
    const released = core.app.captureUndo();
    core.app.dispose();
    expect(core.app.contextQuery({ kind: "point", layerId, index: 0 })).toMatchObject({
      targetCapability: { available: false, code: "missing_target" }, options: [] });
    expect(core.app.contextInputAction(core.app.contextFor({ kind: "layer", id: layerId }), "layer.rename", "late")).toBeUndefined();
    expect(core.app.captureUndo()()).toMatchObject({ ok: false, code: "missing_target" });
    expect(released()).toMatchObject({ ok: false, code: "missing_target" });
  } finally { core.app.dispose(); core.document.dispose(); }
});

test("hint updater preserves the pre-refactor block precedence and editing-tool behavior", () => {
  for (const scope of ["head", "uv"] as const) for (const editing of [false, true]) for (const on of [false, true])
    for (const present of [false, true]) for (const enabled of [false, true]) for (const locked of [false, true]) {
      const hints = Object.assign(Object.create(ViewportInputHints.prototype), { scope,
        source: { input: () => ({ modifiers: { ctrl: false, alt: false, shift: false }, head: { target: "point" }, uv: { target: "point" } }) },
        render() {} }) as ViewportInputHints;
      hints.update({ preferences: { inputHints: true }, viewport: { head: { phase: "ready" }, uv: { phase: "ready" } },
        inputFacts: { hasTarget: present, enabled, locked }, viewTools: editing ? [{ editing: true, on }] : [] } as unknown as Frame);
      const canEdit = scope !== "head" || editing;
      const blocked = !canEdit ? undefined : locked ? "look-locked" : !present ? "no-layer" : scope === "head" && !on ? "surface-off"
        : scope === "head" && !enabled ? "layer-hidden" : undefined;
      expect(hints.context()).toMatchObject({ editing: canEdit, blocked });
    }
});

test("input facts preserve the old lock policy when a loaded collection has no selected preset", () => {
  const core = createTrustedAuthoringCore(freshWorkspace(opticsRecipe("facts")), { resetStack() {}, selectedCollection: () => "a" }, STUDIO_COMPOSITION);
  try {
    core.document.setBlocked("This look is locked.");
    expect(core.app.editorInputFacts().locked).toBe(true);
    let selected: string | undefined;
    core.app.attach({ collection: { selectedPreset: () => ({ loaded: true, id: selected }), contentVersion: () => 0, subscribe: () => () => {} } as never });
    expect(core.app.featureLocked("eye-makeup")).toBeUndefined();
    expect(core.app.editorInputFacts().locked).toBe(false);
    selected = "look";
    expect(core.app.editorInputFacts().locked).toBe(true);
  } finally { core.app.dispose(); core.document.dispose(); }
});
