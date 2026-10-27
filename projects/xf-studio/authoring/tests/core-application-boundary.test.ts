/** Slice 5 proves routing/facade construction, not shell mounting or concrete gesture migration. */
import { expect, test } from "bun:test";
import { createAuthoringEditing } from "../src/app/trusted-authoring-core";
import { StudioApplication } from "../src/app/studio-application";
import { createStudioPresentation, type GenericFeatureFacade } from "../src/app/studio-presentation";
import type { FeatureApplication } from "../src/app/feature-application";
import { STUDIO_OWNERS } from "../src/compose/studio-registry";
import { Registry, type AnyOwner } from "../src/platform/core/registry";
import { createHistoryService, lookScope } from "../src/platform/core/history-service";
import { actionRegistry } from "../src/app/studio-action-descriptors";
import { editorComposition, FIXTURE_LOOK, SYNTHETIC_ID, SYNTHETIC_LAYERED } from "./fixtures/editor-composition";

function application(synthetic = false, contribution?: FeatureApplication) {
  const module = { ...SYNTHETIC_LAYERED, gestures: { apply: () => undefined,
    descriptors: { "synthetic.paint": { scope: ["look"], undo: "transaction", effect: "content", payload: {} } } as const },
    ...(contribution ? { application: contribution } : {}) };
  const fixture = editorComposition(synthetic ? [module] : []), life = new AbortController(), history = createHistoryService();
  const registry = new Registry<AnyOwner>([...STUDIO_OWNERS.filter(owner => owner.owner !== "feature"), ...(synthetic ? [module] : [])]);
  const editing = createAuthoringEditing(synthetic ? { features: { [SYNTHETIC_ID]: { part: module.part.starter() } } } : {},
    { history, signal: life.signal, scope: lookScope(FIXTURE_LOOK), look: FIXTURE_LOOK },
    { registry, documents: { parts: fixture.parts } });
  const app = new StudioApplication({ ...editing, history }, registry);
  const port = createStudioPresentation({ authoring: app, naming: () => ({ look: FIXTURE_LOOK, scope: lookScope(FIXTURE_LOOK) }),
    library: {} as never, files: {} as never, viewport: {} as never, preferences: {} as never,
    previewReadiness: {} as never });
  return { app, port, editing, history, life, registry, close() { app.dispose(); life.abort(); } };
}

test("slice 5: zero-feature application and feature lookup construct without any makeup projection", () => {
  const w = application();
  try {
    expect(w.app.features()).toEqual([]); expect(w.port.features()).toEqual([]);
    expect(w.port.feature("eye-makeup")).toBeUndefined();
    expect(Object.keys(w.app.gestureDescriptors())).toEqual([]);
    expect(w.app.actionKinds().some(kind => kind.startsWith("layer."))).toBe(false);
    expect(w.app.registry().some(entry => entry.family === "gesture")).toBe(false);
    expect(w.app.targetCapability({ kind: "workspace" })).toEqual({ available: true });
    expect(w.app.targetCapability({ kind: "layer", id: "absent" })).toMatchObject({ available: false, code: "missing_target" });
    expect(w.app.capability({ kind: "history.undo", scope: lookScope(FIXTURE_LOOK) }).available).toBe(false);
    expect(w.editing.document.export().features).toEqual({});
    expect("recipe" in w.editing.document).toBe(false);
  } finally { w.close(); }
});

test("slice 5: synthetic registered actions and generic facade share neutral state and one Undo scope", () => {
  const w = application(true);
  try {
    const face = w.port.feature(SYNTHETIC_ID) as GenericFeatureFacade;
    expect(face.kinds()).toEqual(["synthetic.setValue"]);
    expect(face.dispatch({ kind: "synthetic.setValue", id: "first", value: 7 } as never).ok).toBe(true);
    expect(face.view()).toMatchObject({ part: { layers: [{ id: "first", value: 7 }, { id: "second", value: 2 }] } });
    expect(w.app.history(lookScope(FIXTURE_LOOK)).depth).toBe(1);
    expect(w.app.dispatch({ kind: "history.undo", scope: lookScope(FIXTURE_LOOK) }).ok).toBe(true);
    expect(face.view()).toMatchObject({ part: { layers: [{ id: "first", value: 1 }, { id: "second", value: 2 }] } });
    expect(w.app.dispatch({ kind: "history.redo", scope: lookScope(FIXTURE_LOOK) }).ok).toBe(true);
    expect(face.controlBegin("value")).toBe(true);
    expect(face.controlEdit("value", { kind: "synthetic.setValue", id: "first", value: 9 } as never).ok).toBe(true);
    face.controlCancel("value");
    expect(face.view()).toMatchObject({ part: { layers: [{ id: "first", value: 7 }, { id: "second", value: 2 }] } });
    expect(face.dispatch({ kind: "layer.setOpacity" } as never).ok).toBe(false);
    expect(w.app.featureEnvelope(SYNTHETIC_ID)?.schema).toBe(SYNTHETIC_LAYERED.part.current);
  } finally { w.close(); }
});

test("slice 5: descriptors come only from registered features and detached catalogue reads preserve parity", () => {
  const w = application(true);
  try {
    expect(JSON.stringify(w.app.actionDescriptors())).toBe(JSON.stringify(w.registry.descriptors()));
    expect(JSON.stringify(w.app.gestureDescriptors())).toBe(JSON.stringify({ "synthetic.paint": { scope: ["look"], undo: "transaction", effect: "content", payload: {} } }));
    const descriptors = w.app.gestureDescriptors(); Object.assign(descriptors, { "shape.replace": {} });
    expect(w.app.gestureDescriptors()).not.toHaveProperty("shape.replace");
    expect(w.app.registry().filter(entry => entry.family === "gesture").map(entry => entry.id)).toEqual(["synthetic.paint"]);
    expect(actionRegistry({})).toEqual([]);
  } finally { w.close(); }
});

test("slice 5: facade contributions follow registration, with no ID branch or fabricated makeup facade", () => {
  let called = 0;
  const w = application(true, { facade(base, host) { called++; return { ...base, view: () => host.application.featureState(base.id), marker: "registered" }; } });
  try {
    expect(called).toBe(1);
    expect(w.port.feature(SYNTHETIC_ID)).toHaveProperty("marker", "registered");
    expect(w.port.feature("eye-makeup")).toBeUndefined();
  } finally { w.close(); }
});

test("slice 5: AbortSignal releases the application and retained input refuses without opening another scope", () => {
  const w = application(true), retained = w.port.feature(SYNTHETIC_ID)!;
  w.life.abort();
  expect(w.history.scope(lookScope(FIXTURE_LOOK))).toBeUndefined();
  expect(retained.dispatch({ kind: "synthetic.setValue", id: "first", value: 9 } as never)).toMatchObject({ ok: false, code: "missing_target" });
  expect(() => new StudioApplication({ document: w.editing.document, history: w.history, signal: w.life.signal }, w.registry)).toThrow("released");
  w.close();
});

test("slice 5: failed registration and abort during a binding install no application subscriptions", () => {
  const w = application(true), onReplacing = w.editing.document.onReplacing.bind(w.editing.document);
  let subscriptions = 0;
  w.editing.document.onReplacing = listener => { subscriptions++; return onReplacing(listener); };
  try {
    const missingSystem = new Registry<AnyOwner>([...STUDIO_OWNERS.filter(owner => owner.owner !== "feature" && owner.id !== "history"), SYNTHETIC_LAYERED]);
    expect(() => new StudioApplication({ ...w.editing, history: w.history }, missingSystem)).toThrow("do not match");
    expect(subscriptions).toBe(0);
    const module = { ...SYNTHETIC_LAYERED, application: { bind() {
      w.life.abort(); return { capability: () => ({ available: true }), dispatch() {} };
    } } satisfies FeatureApplication };
    const registry = new Registry<AnyOwner>([...STUDIO_OWNERS.filter(owner => owner.owner !== "feature"), module]);
    expect(() => new StudioApplication({ ...w.editing, history: w.history }, registry)).toThrow("released");
    expect(subscriptions).toBe(0);
    expect(w.history.scope(lookScope(FIXTURE_LOOK))).toBeUndefined();
  } finally { w.close(); }
});
