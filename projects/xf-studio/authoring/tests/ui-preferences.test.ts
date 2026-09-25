import { expect, test } from "bun:test";
import { WorkspaceComposer } from "../src/workspace-composer";
import { freshWorkspace, loadWorkspace, parseWorkspace, workspaceKeys } from "../src/workspace-state";
import { defaultUIPreferences, effectiveTheme, parseDockLayout, parseUIPreferences,
  recoverDockLayout, UIPreferenceActions, type DockLayout } from "../src/ui-preferences";

const layout: DockLayout = { format: "xfs/dock", version: 1,
  state: { panels: [{ id: "viewport", x: 40, y: 10 }, { id: "layers", x: 500, y: 10 }] } };

test("theme preference defaults to system and stays separate from recipe/library data", () => {
  const state = freshWorkspace(), recipe = structuredClone(state.recipe), library = structuredClone(state.library);
  expect(state.uiPreferences).toEqual(defaultUIPreferences());
  expect(effectiveTheme("system", true)).toBe("dark");
  expect(effectiveTheme("system", false)).toBe("light");
  expect(effectiveTheme("light", true)).toBe("light");
  expect(effectiveTheme("dark", false)).toBe("dark");
  state.uiPreferences = { schema: "xfs/ui-preferences-1", theme: "dark", inputHints: false, layout };
  const restored = parseWorkspace(JSON.parse(JSON.stringify(state)));
  expect(restored.uiPreferences).toEqual(state.uiPreferences);
  expect(restored.recipe).toEqual(recipe);
  expect(restored.library).toEqual(library);
  const legacy = structuredClone(state) as Partial<typeof state>;
  delete legacy.uiPreferences;
  expect(parseWorkspace(legacy).uiPreferences).toEqual(defaultUIPreferences());
  expect(parseWorkspace({ ...state, uiPreferences: { schema: "future", theme: "dark", layout } }).uiPreferences)
    .toEqual(defaultUIPreferences());
  expect(parseWorkspace({ ...state, uiPreferences: { schema: "xfs/ui-preferences-1", theme: "neon", layout } })
    .uiPreferences).toMatchObject({ theme: "system", layout });
  const damaged = { ...state, uiPreferences: { schema: "xfs/ui-preferences-1", theme: "dark",
    layout: { ...layout, format: "<bad>" } } };
  const loaded = loadWorkspace({ getItem: key => key === workspaceKeys(true).workspace
    ? JSON.stringify(damaged) : null }, true);
  expect(loaded.writable).toBe(true);
  expect(loaded.state.recipe).toEqual(recipe);
  expect(loaded.state.uiPreferences).toEqual({ schema: "xfs/ui-preferences-1", theme: "dark", inputHints: true });
});

test("viewport input hints are on by default, persist when turned off and ignore malformed values", () => {
  expect(defaultUIPreferences().inputHints).toBe(true);
  expect(parseUIPreferences({ schema: "xfs/ui-preferences-1", theme: "dark" }).inputHints).toBe(true);
  expect(parseUIPreferences({ schema: "xfs/ui-preferences-1", theme: "dark", inputHints: "no" }).inputHints).toBe(true);
  const actions = new UIPreferenceActions();
  let changes = 0;
  actions.subscribe(() => changes++);
  expect(actions.capability({ kind: "inputHints.set", enabled: "off" as unknown as boolean }).available).toBe(false);
  actions.dispatch({ kind: "inputHints.set", enabled: false });
  expect(changes).toBe(1);
  const reloaded = new UIPreferenceActions(JSON.parse(JSON.stringify(actions.snapshot())));
  expect(reloaded.snapshot()).toMatchObject({ theme: "system", inputHints: false });
});

test("opaque layout accepts only bounded, lossless JSON without choosing dock geometry", () => {
  const valid = parseDockLayout(layout)!;
  expect(valid).toEqual(layout);
  (valid.state as { panels: { id: string }[] }).panels[0].id = "changed";
  expect((layout.state as { panels: { id: string }[] }).panels[0].id).toBe("viewport");
  expect(parseDockLayout({ ...layout, state: { x: Infinity } })).toBeUndefined();
  expect(parseDockLayout({ ...layout, state: { x: undefined } })).toBeUndefined();
  expect(parseDockLayout({ ...layout, state: { bad: () => null } })).toBeUndefined();
  expect(parseDockLayout({ ...layout, state: { __proto__: null, x: 1 } })).toBeDefined();
  const dangerous = JSON.parse('{"__proto__":1}');
  expect(parseDockLayout({ ...layout, state: dangerous })).toBeUndefined();
  const throwing = Object.defineProperty({}, "panels", { enumerable: true,
    get() { throw Error("broken plugin state"); } });
  expect(parseDockLayout({ ...layout, state: throwing })).toBeUndefined();
  expect(parseUIPreferences(Object.defineProperty({}, "schema", { enumerable: true,
    get() { throw Error("broken preference"); } }))).toEqual(defaultUIPreferences());
  const extra = [1] as unknown[] & { panel?: string }; extra.panel = "hidden";
  expect(parseDockLayout({ ...layout, state: extra })).toBeUndefined();
  const custom = { panels: ["viewport"] } as { panels: string[]; toJSON?: () => unknown };
  Object.defineProperty(custom, "toJSON", { value: () => ({ panels: ["forged"] }) });
  expect(parseDockLayout({ ...layout, state: custom })?.state).toEqual({ panels: ["viewport"] });
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  expect(parseDockLayout({ ...layout, state: cyclic })).toBeUndefined();
  expect(parseDockLayout({ ...layout, state: { text: "x".repeat(129 * 1024) } })).toBeUndefined();
  expect(parseDockLayout({ ...layout, version: 0 })).toBeUndefined();
  expect(parseDockLayout({ ...layout, format: "<script>" })).toBeUndefined();
  expect(parseDockLayout({ ...layout, state: null })).toBeUndefined();
  expect(parseUIPreferences({ schema: "xfs/ui-preferences-1", theme: "light",
    layout: { ...layout, state: { x: Infinity } } })).toEqual({ schema: "xfs/ui-preferences-1", theme: "light", inputHints: true });
});

test("layout restore requires the panel engine to recover and certify current-screen usability", () => {
  const context = { workAreas: [{ x: 0, y: 0, width: 1024, height: 768 }],
    panelIds: ["viewport", "layers"] };
  expect(recoverDockLayout(layout, context)).toBeUndefined();
  expect(recoverDockLayout(layout, context, () => undefined)).toBeUndefined();
  let calls = 0;
  const recovered = recoverDockLayout(layout, context, (candidate, environment) => {
    calls++;
    expect(candidate).toEqual(layout); expect(environment.panelIds).toEqual(["viewport", "layers"]);
    return { onScreen: true as const, layout: { ...candidate,
      state: { panels: [{ id: "viewport", x: 0, y: 0 }, { id: "layers", x: 400, y: 0 }] } } };
  });
  expect(calls).toBe(1);
  expect(recovered?.state).toEqual({ panels: [{ id: "viewport", x: 0, y: 0 }, { id: "layers", x: 400, y: 0 }] });
  expect(recoverDockLayout(layout, { ...context, workAreas: [] }, () => {
    throw Error("should not be called");
  })).toBeUndefined();
  expect(recoverDockLayout(layout, context, () => { throw Error("bad panel engine"); })).toBeUndefined();
  expect(recoverDockLayout(layout, context, () => ({ onScreen: true,
    layout: { ...layout, version: 2 } }))).toBeUndefined();
});

test("preference actions publish detached state and workspace composition captures an optional UI port", () => {
  const state = freshWorkspace(), actions = new UIPreferenceActions(state.uiPreferences);
  let notifications = 0; const unsubscribe = actions.subscribe(() => notifications++);
  actions.dispatch({ kind: "theme.set", theme: "light" });
  actions.dispatch({ kind: "layout.set", layout });
  expect(actions.capability({ kind: "layout.set", layout: { ...layout, version: 0 } })).toMatchObject({ available: false });
  expect(() => actions.dispatch({ kind: "theme.set", theme: "wrong" as "light" })).toThrow();
  expect(notifications).toBe(2);
  const detached = actions.snapshot() as typeof state.uiPreferences;
  detached.theme = "dark";
  expect(actions.snapshot().theme).toBe("light");
  const composer = new WorkspaceComposer(state, {
    editor: () => ({ recipe: state.recipe, active: state.active, selected: state.selected,
      fieldSelection: state.fieldSelection, history: state.history }),
    uvView: () => state.uvView, savedV: () => state.savedV,
    collections: () => state.collections, quality: () => state.preview.textureSize,
    preview: () => undefined, motion: () => undefined,
    sidebar: () => ({ sidebarLeft: state.panels.sidebarLeft, sidebarRight: state.panels.sidebarRight }),
    layout: () => state.panels, uiPreferences: () => actions.snapshot() as typeof state.uiPreferences,
  });
  expect(composer.capture().uiPreferences).toEqual(actions.snapshot());
  composer.setPreviewReady();
  expect(composer.capture().uiPreferences).toEqual(actions.snapshot());
  actions.dispatch({ kind: "layout.set" });
  expect(actions.snapshot().layout).toBeUndefined();
  unsubscribe();
});
