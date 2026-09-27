/**
 * Saved layouts (research/authoring/view-graph-design.md §4.5): the library's actions and bounds, the working state kept on switching,
 * forward-compatible restore (an unknown panel stays parked), switching with a module hidden, automatic switching by size class with
 * the manual choice winning, and existing workspaces keeping their bytes.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { installLightDom, uninstallLightDom } from "./light-dom";
import { activeLayout, applyLayoutAction, autoSwitchTarget, layoutCapability, layoutLibraryOf, MAX_LAYOUTS, parseLayoutLibrary, type LayoutAction,
  type LayoutLibrary, type LayoutPreferences } from "../src/layout-library";
import { parseDockLayout, parseUIPreferences, UIPreferenceActions, type DockLayout, type UIPreferences } from "../src/ui-preferences";
import { applyDrop, closePanel, locate, parkPanels, type DockState, type SizeClass } from "../src/studio-ui/dock/layout";
import { defaultDockStateFor, restoreDockPreference, sameDockState, serializeDockState } from "../src/studio-ui/dock/persist";
import { defaultDockState } from "../src/studio-ui/layout-defaults";
import { STUDIO_CATALOGUE } from "../src/compose/views";
import { STUDIO_MODULE_REGISTRATION } from "../src/compose/modules";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { parseWorkspace, serializeWorkspace } from "../src/workspace-state";
import { freshWorkspace } from "./fixtures/eye-region";
import type { StudioModule } from "../src/platform/api";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());

const area = { x: 0, y: 0, w: 1600, h: 900 };
const dockOf = (state: DockState) => serializeDockState(state);
const factory = () => dockOf(defaultDockState(STUDIO_CATALOGUE));
/** The factory arrangement with one panel floated: a distinct, recognisable arrangement (made once per panel: new windows get new IDs). */
const floats = new Map<string, DockLayout>();
const floated = (panel = "history") => {
  if (!floats.has(panel)) {
    const state = defaultDockState(STUDIO_CATALOGUE);
    floats.set(panel, dockOf({ ...state, wide: applyDrop(state.wide, { kind: "panel", panelId: panel }, { kind: "float", x: 300, y: 200, w: 340, h: 420 }) }));
  }
  return structuredClone(floats.get(panel)!);
};
const shown = { "eye-makeup": true, poses: false, expressions: false, "save-explorer": false };
const run = (prefs: LayoutPreferences, action: LayoutAction) => {
  const allowed = layoutCapability(prefs, action, parseDockLayout);
  if (!allowed.available) throw Error(allowed.reason);
  return applyLayoutAction(prefs, action, parseDockLayout);
};
const names = (prefs: LayoutPreferences) => prefs.layouts!.layouts.map(layout => layout.name);

test("a workspace without a library shows one layout holding the live arrangement, and writes nothing until it changes", () => {
  const prefs: LayoutPreferences = { layout: floated() };
  const virtual = layoutLibraryOf(prefs, shown);
  expect(virtual.layouts.map(layout => layout.name)).toEqual(["My layout"]);
  expect(activeLayout(virtual).dock).toEqual(floated());
  // Recording the size class seen needs a library: an untouched workspace keeps its bytes.
  expect(run(prefs, { kind: "layouts.seen", size: "compact" })).toEqual(prefs);
  // Revert has nothing to go back to yet.
  expect(layoutCapability(prefs, { kind: "layouts.revert" }, parseDockLayout).available).toBe(false);
});

test("round trip: save, change, switch away and back keeps the working state; Revert and Save changes; the library survives parsing", () => {
  let prefs: LayoutPreferences = { layout: factory() };
  prefs = run(prefs, { kind: "layouts.saveAs", name: "Focus", remember: true, shown });
  expect(names(prefs)).toEqual(["My layout", "Focus"]);
  expect(prefs.layouts!.active).toBe(prefs.layouts!.layouts[1]!.id);
  const focus = prefs.layouts!.active, first = prefs.layouts!.layouts[0]!.id;
  // Mess with Focus, then switch to My layout: Focus keeps its working state.
  prefs = { ...prefs, layout: floated() };
  prefs = run(prefs, { kind: "layouts.switch", id: first, modified: true, shown });
  expect(prefs.layout).toEqual(factory());
  expect(prefs.layouts!.layouts[1]!.working?.dock).toEqual(floated());
  expect(prefs.layouts!.layouts[1]!.dock).toEqual(factory());
  // Switching back returns to the working state, not the saved one.
  prefs = run(prefs, { kind: "layouts.switch", id: focus, modified: false, shown });
  expect(prefs.layout).toEqual(floated());
  expect(prefs.layouts!.layouts[1]!.working).toBeUndefined();
  expect(prefs.layouts!.layouts[0]!.working).toBeUndefined();
  // Revert to saved brings the saved arrangement back.
  prefs = run(prefs, { kind: "layouts.revert" });
  expect(prefs.layout).toEqual(factory());
  // Save changes makes the live arrangement the saved one.
  prefs = { ...prefs, layout: floated("activity") };
  prefs = run(prefs, { kind: "layouts.update", shown });
  expect(activeLayout(prefs.layouts!).dock).toEqual(floated("activity"));
  // Through the UI preferences' parser and action boundary, losslessly.
  const reparsed = parseUIPreferences(JSON.parse(JSON.stringify({ schema: "xfs/ui-preferences-1", theme: "system", inputHints: true, ...prefs })));
  expect(reparsed.layouts).toEqual(prefs.layouts);
  const actions = new UIPreferenceActions(reparsed);
  actions.dispatch({ kind: "layouts.switch", id: first, modified: false, shown });
  expect(actions.snapshot().layout).toEqual(factory());
});

test("names are unique and bounded; duplicate, rename, delete and its undo; the last layout can't be deleted", () => {
  let prefs: LayoutPreferences = { layout: factory() };
  expect(layoutCapability(prefs, { kind: "layouts.saveAs", name: " my LAYOUT ", remember: false, shown }, parseDockLayout))
    .toEqual({ available: false, reason: "A layout is already called “my LAYOUT”." });
  expect(layoutCapability(prefs, { kind: "layouts.saveAs", name: "   ", remember: false, shown }, parseDockLayout).reason).toBe("Give the layout a name.");
  expect(layoutCapability(prefs, { kind: "layouts.saveAs", name: "x".repeat(49), remember: false, shown }, parseDockLayout).reason).toBe("Keep the name to 48 characters.");
  // The first layout can be renamed (the library is written then).
  prefs = run(prefs, { kind: "layouts.rename", id: "l1", name: "Maximised", shown });
  expect(names(prefs)).toEqual(["Maximised"]);
  expect(layoutCapability(prefs, { kind: "layouts.delete", id: "l1", shown }, parseDockLayout).reason).toBe("This is your only layout. Save another before deleting it.");
  prefs = run(prefs, { kind: "layouts.duplicate", id: "l1", shown });
  prefs = run(prefs, { kind: "layouts.duplicate", id: "l1", shown });
  expect(names(prefs)).toEqual(["Maximised", "Maximised copy 2", "Maximised copy"]);
  expect(prefs.layouts!.active).toBe("l1");
  // Deleting the active layout switches to its neighbour; putting it back (the notice's Undo) returns to it.
  const kept = structuredClone(activeLayout(prefs.layouts!));
  prefs = run(prefs, { kind: "layouts.delete", id: "l1", shown });
  expect(names(prefs)).toEqual(["Maximised copy 2", "Maximised copy"]);
  expect(activeLayout(prefs.layouts!).name).toBe("Maximised copy 2");
  prefs = run(prefs, { kind: "layouts.insert", layout: kept, index: 0, activate: true, modified: false, shown });
  expect(names(prefs)).toEqual(["Maximised", "Maximised copy 2", "Maximised copy"]);
  expect(activeLayout(prefs.layouts!).name).toBe("Maximised");
  // At most MAX_LAYOUTS.
  for (let i = prefs.layouts!.layouts.length; i < MAX_LAYOUTS; i++) prefs = run(prefs, { kind: "layouts.saveAs", name: `L${i}`, remember: false, shown });
  expect(layoutCapability(prefs, { kind: "layouts.saveAs", name: "One more", remember: false, shown }, parseDockLayout).available).toBe(false);
});

test("a remembering layout restores its modules; one that doesn't leaves them; modules unknown to this build are kept", () => {
  let prefs: LayoutPreferences = { layout: factory() };
  prefs = run(prefs, { kind: "layouts.saveAs", name: "Makeup", remember: true, shown });
  const makeup = prefs.layouts!.active;
  prefs = run(prefs, { kind: "layouts.saveAs", name: "Posing", remember: true, shown: { ...shown, "eye-makeup": false, poses: true } });
  const posing = prefs.layouts!.active;
  prefs = run(prefs, { kind: "layouts.setModules", remember: false, shown }); // turned off …
  expect(activeLayout(prefs.layouts!).modules).toBeUndefined();
  prefs = run(prefs, { kind: "layouts.setModules", remember: true, shown: { ...shown, "eye-makeup": false, poses: true } }); // … and on again
  // A newer build's module in the saved map stays there.
  const entry = prefs.layouts!.layouts.find(layout => layout.id === posing)!;
  entry.modules = { ...entry.modules, "world": true };
  prefs = run(prefs, { kind: "layouts.switch", id: makeup, modified: false, shown: { ...shown, "eye-makeup": false, poses: true } });
  expect(prefs.modules).toMatchObject({ "eye-makeup": true, poses: false });
  prefs = run(prefs, { kind: "layouts.switch", id: posing, modified: false, shown });
  expect(prefs.modules).toMatchObject({ "eye-makeup": false, poses: true, world: true });
  prefs = run(prefs, { kind: "layouts.update", shown: { ...shown, "eye-makeup": false, poses: true } });
  expect(activeLayout(prefs.layouts!).modules).toMatchObject({ world: true, poses: true });
  // A layout that doesn't remember modules leaves them as they are.
  prefs = run(prefs, { kind: "layouts.saveAs", name: "Plain", remember: false, shown });
  const plain = prefs.layouts!.active;
  prefs = run(prefs, { kind: "layouts.switch", id: posing, modified: false, shown });
  prefs = { ...prefs, modules: { ...prefs.modules, expressions: true } };
  prefs = run(prefs, { kind: "layouts.switch", id: plain, modified: false, shown });
  expect(prefs.modules?.expressions).toBe(true);
});

test("automatic switching: one layout per size class, on crossings and at start, never within a class", () => {
  let prefs: LayoutPreferences = { layout: factory() };
  prefs = run(prefs, { kind: "layouts.saveAs", name: "Small", remember: false, autoSize: "compact", shown });
  prefs = run(prefs, { kind: "layouts.saveAs", name: "Small too", remember: false, shown });
  prefs = run(prefs, { kind: "layouts.setAutoSize", size: "compact", shown });
  // Choosing a class for a layout releases it from any other.
  expect(prefs.layouts!.layouts.map(layout => layout.autoSize ?? "-")).toEqual(["-", "-", "compact"]);
  prefs = run(prefs, { kind: "layouts.switch", id: "l1", modified: false, shown });
  const library = prefs.layouts!;
  expect(autoSwitchTarget(library, "compact", true)?.name).toBe("Small too");
  expect(autoSwitchTarget(library, "wide", true)).toBeUndefined();
  // At start: only when the window opens in another class than the one last seen.
  expect(autoSwitchTarget(library, "compact", false)).toBeUndefined();
  expect(autoSwitchTarget({ ...library, seen: "wide" }, "compact", false)?.name).toBe("Small too");
  expect(autoSwitchTarget({ ...library, seen: "compact" }, "compact", false)).toBeUndefined();
  // Already showing: nothing to do.
  expect(autoSwitchTarget({ ...library, active: library.layouts[2]!.id }, "compact", true)).toBeUndefined();
  expect(run(prefs, { kind: "layouts.seen", size: "compact" }).layouts!.seen).toBe("compact");
});

test("parsing is bounded and drops only what is damaged", () => {
  const dock = factory();
  const library = parseLayoutLibrary({ schema: "xfs/layout-library-1", active: "missing", seen: "tiny", layouts: [
    { id: "a", name: "A", dock, autoSize: "wide", working: { dock: floated() } },
    { id: "a", name: "Duplicate ID", dock },
    { id: "b", name: "B", dock, autoSize: "wide", modules: { "eye-makeup": false, "Bad ID!": true, poses: "yes" } },
    { id: "c", name: "", dock },
    { id: "d", name: "D", dock: { format: "xfs/dock" } },
  ] }, parseDockLayout) as LayoutLibrary;
  expect(library.layouts.map(layout => layout.id)).toEqual(["a", "b"]);
  expect(library.active).toBe("a");
  expect(library.seen).toBeUndefined();
  // The active layout's working state is the live one; a second claim on a size class is dropped.
  expect(library.layouts[0]!.working).toBeUndefined();
  expect(library.layouts[1]!.autoSize).toBeUndefined();
  expect(library.layouts[1]!.modules).toEqual({ "eye-makeup": false });
  expect(parseLayoutLibrary({ schema: "xfs/layout-library-2", layouts: [] }, parseDockLayout)).toBeUndefined();
  expect(parseUIPreferences({ schema: "xfs/ui-preferences-1", theme: "dark", inputHints: true, layouts: "nope" }).layouts).toBeUndefined();
});

test("an unknown panel in a saved layout stays parked with its place through restore and save, and comes back in a build that knows it", () => {
  const state = defaultDockState(STUDIO_CATALOGUE);
  const at = locate(state.wide, "history")!;
  // A newer build's panel beside History, and one closed.
  const future = structuredClone(state);
  for (const tree of [future.wide, future.compact]) {
    const group = locate(tree, "history")!.group;
    group.panels.push("future.panel");
    tree.closed = [...tree.closed, "future.closed"];
  }
  const restored = restoreDockPreference(dockOf(future), area, STUDIO_CATALOGUE);
  expect(restored.recovered).toBe(true);
  expect(locate(restored.state.wide, "future.panel")).toBeUndefined();
  expect(restored.state.wide.closed).not.toContain("future.closed");
  expect(restored.state.wide.parked?.["future.panel"]).toMatchObject({ group: [...at.group.panels, "future.panel"] });
  expect(restored.state.wide.parked?.["future.closed"]).toEqual({ closed: true });
  // Saved again and restored again, it is still there.
  const again = restoreDockPreference(dockOf(restored.state), area, STUDIO_CATALOGUE);
  expect(again.state.wide.parked?.["future.panel"]).toEqual(restored.state.wide.parked?.["future.panel"]);
  expect(sameDockState(again.state, restored.state)).toBe(true);
  // A build whose catalogue has the panel puts it back in History's group.
  const newer = { ...STUDIO_CATALOGUE, ids: [...STUDIO_CATALOGUE.ids, "future.panel"] };
  const back = restoreDockPreference(dockOf(restored.state), area, newer as typeof STUDIO_CATALOGUE);
  expect(locate(back.state.wide, "future.panel")?.group.panels).toEqual([...at.group.panels, "future.panel"]);
});

test("a panel the saved layout parked whose module is shown now returns to its parked place, not its factory home", () => {
  const state = defaultDockState(STUDIO_CATALOGUE);
  // Move Poses' panel (hidden by default) somewhere of its own, then hide the module.
  const poses = STUDIO_CATALOGUE.panels.find(panel => panel.owner === "poses")!.id;
  const moved = applyDrop(state.wide, { kind: "panel", panelId: poses }, { kind: "float", x: 500, y: 100, w: 360, h: 400 });
  const saved = dockOf({ wide: parkPanels(moved, [poses]), compact: parkPanels(state.compact, [poses]) });
  const restored = restoreDockPreference(saved, area, STUDIO_CATALOGUE, []);
  const window = restored.state.wide.floating.find(item => item.node.kind === "group" && item.node.panels.includes(poses));
  expect(window).toMatchObject({ x: 500, y: 100, w: 360, h: 400 });
  expect(restored.state.wide.parked?.[poses]).toBeUndefined();
});

test("sameDockState ignores key order and floating-point noise but not a real change", () => {
  const state = defaultDockState(STUDIO_CATALOGUE);
  const noisy = JSON.parse(JSON.stringify(state), (key, value) => typeof value === "number" && key !== "x" ? value * (1 + 1e-12) : value);
  expect(sameDockState(state, noisy)).toBe(true);
  expect(sameDockState(state, { ...state, wide: closePanel(state.wide, "history") })).toBe(false);
});

test("existing workspaces keep their bytes, and a workspace with a library round-trips", () => {
  const workspace = freshWorkspace();
  workspace.uiPreferences = { ...workspace.uiPreferences, layout: floated() };
  const stored = JSON.stringify(serializeWorkspace(workspace, STUDIO_DOCUMENTS));
  const again = parseWorkspace(JSON.parse(stored), STUDIO_DOCUMENTS);
  expect(again.uiPreferences.layouts).toBeUndefined();
  expect(JSON.stringify(serializeWorkspace(again, STUDIO_DOCUMENTS))).toBe(stored);
  const actions = new UIPreferenceActions(again.uiPreferences);
  actions.dispatch({ kind: "layouts.saveAs", name: "Focus", remember: true, shown });
  again.uiPreferences = actions.snapshot() as UIPreferences;
  const withLibrary = JSON.stringify(serializeWorkspace(again, STUDIO_DOCUMENTS));
  const third = parseWorkspace(JSON.parse(withLibrary), STUDIO_DOCUMENTS);
  expect(third.uiPreferences.layouts).toEqual(again.uiPreferences.layouts);
  expect(JSON.stringify(serializeWorkspace(third, STUDIO_DOCUMENTS))).toBe(withLibrary);
});

/** The shell's side, over a real DockView and the real preference boundary: the controller, a module and the size class. */
async function studio(initialSize: SizeClass = "wide", initial?: unknown) {
  const { DockView } = await import("../src/studio-ui/dock/dock-view");
  const { layoutController } = await import("../src/studio-ui/layouts");
  const modules = STUDIO_MODULE_REGISTRATION.modules as readonly StudioModule[];
  const preferences = new UIPreferenceActions(initial);
  const shownModules = () => { const chosen = preferences.snapshot().modules ?? {}; return modules.filter(module => chosen[module.id] ?? module.shownByDefault).map(module => module.id); };
  const moduleOf = (owner: string) => modules.find(module => (module.feature ?? module.id) === owner);
  const parkedPanels = () => STUDIO_CATALOGUE.panels.filter(panel => { const module = moduleOf(panel.owner); return !!module && !shownModules().includes(module.id); }).map(panel => panel.id);
  const panelsOf = (id: string) => STUDIO_CATALOGUE.panels.filter(panel => moduleOf(panel.owner)?.id === id).map(panel => panel.id);
  const specs = new Map(STUDIO_CATALOGUE.panels.map(panel => [panel.id, { id: panel.id, title: panel.id, icon: "layers" as const, description: "", element: document.createElement("div") }]));
  let size = initialSize;
  const toasts: string[] = [];
  const feedback = { toast: (_tone: string, _source: string, message: string) => { toasts.push(message); }, record: () => {}, announce: () => {} };
  const restored = restoreDockPreference(preferences.snapshot().layout, area, STUDIO_CATALOGUE, parkedPanels());
  const dock = new DockView({ panels: [...specs.values()].filter(spec => !parkedPanels().includes(spec.id)), state: restored.state, sizeClass: () => size,
    defaults: which => defaultDockStateFor(STUDIO_CATALOGUE, parkedPanels())[which],
    save: state => preferences.dispatch({ kind: "layout.set", layout: serializeDockState(state) }), announce: () => {} });
  dock.render();
  const port = { preferences } as never;
  const layouts = layoutController({ port, feedback: feedback as never, dock, catalogue: STUDIO_CATALOGUE, modules, shownModules, parkedPanels,
    panelSpecs: () => [...specs.values()], area: () => area, finishInput: () => {}, changed: () => {} });
  /** Show or hide a module as the shell does (app.ts setModuleShown). */
  const setModule = (id: string, on: boolean) => {
    preferences.dispatch({ kind: "modules.set", module: id, shown: on });
    if (on) dock.addPanels(panelsOf(id).map(panel => specs.get(panel)!)); else dock.removePanels(panelsOf(id));
  };
  const resize = (next: SizeClass) => { if (next === size) return; size = next; dock.render(); layouts.sizeClass(size, true); };
  /** A saved arrangement as the dock would load it now (the same gate the controller compares through). */
  const loaded = (saved: DockLayout) => restoreDockPreference(saved, area, STUDIO_CATALOGUE, parkedPanels()).state;
  return { dock, layouts, preferences, setModule, resize, toasts, panelsOf, loaded, active: () => activeLayout(layouts.library()).name };
}

test("switching with a module hidden: each layout shows its modules and its panels come back where they were", async () => {
  const s = await studio();
  const eye = s.panelsOf("eye-makeup");
  expect(eye.length).toBeGreaterThan(0);
  s.dock.float("history");
  s.layouts.saveNamed("Makeup", true);
  const makeup = serializeDockState(s.dock.dockState);
  // Hide eye makeup: the layout now differs from its saved one (its modules and its parked panels).
  s.setModule("eye-makeup", false);
  expect(s.layouts.modified()).toBe(true);
  expect(eye.every(id => s.dock.panelState(id) === "parked")).toBe(true);
  s.layouts.saveNamed("No makeup", true);
  expect(s.layouts.modified()).toBe(false);
  // Back to Makeup: eye makeup shows again with its panels exactly where they were, and nothing counts as changed.
  s.layouts.switchTo("l2");
  expect(s.active()).toBe("Makeup");
  expect(eye.every(id => s.dock.panelState(id) !== "parked")).toBe(true);
  expect(sameDockState(s.dock.dockState, s.loaded(makeup))).toBe(true);
  expect(s.layouts.modified()).toBe(false);
  // And to No makeup: hidden again.
  s.layouts.switchTo("l3");
  expect(s.preferences.snapshot().modules?.["eye-makeup"]).toBe(false);
  expect(eye.every(id => s.dock.panelState(id) === "parked")).toBe(true);
  expect(s.layouts.modified()).toBe(false);
});

test("the controller keeps the working state, reverts, and Reset to factory layout can be reverted even before any save", async () => {
  const s = await studio();
  s.dock.float("history");
  const mine = serializeDockState(s.dock.dockState);
  // No library yet: resetting saves the first layout first, so Revert to saved brings the arrangement back.
  s.layouts.resetFactory();
  expect(s.preferences.snapshot().layouts?.layouts.map(layout => layout.name)).toEqual(["My layout"]);
  expect(s.layouts.modified()).toBe(true);
  s.layouts.revert();
  expect(sameDockState(s.dock.dockState, s.loaded(mine))).toBe(true);
  expect(s.layouts.modified()).toBe(false);
  // A second layout, changed, then left and returned to: the change is still there.
  s.layouts.saveNamed("Second", true);
  s.dock.close("library");
  expect(s.layouts.modified()).toBe(true);
  s.layouts.switchTo("l1");
  expect(s.dock.isOpen("library")).toBe(true);
  s.layouts.switchTo("l2");
  expect(s.dock.isOpen("library")).toBe(false);
  expect(s.layouts.modified()).toBe(true);
  // The menu offers Save changes and Revert only while something changed.
  const item = (label: string) => s.layouts.menuItems({ x: 0, y: 0 }).find(entry => entry.kind === "action" && entry.label === label) as { capability?: { available: boolean } };
  expect(item("Save changes").capability).toBeUndefined();
  s.layouts.update();
  expect(s.layouts.modified()).toBe(false);
  expect(item("Save changes").capability?.available).toBe(false);
  // Deleting the active layout switches to its neighbour, and the notice's Undo returns to it with the arrangement it had.
  s.dock.close("history");
  s.layouts.remove();
  expect(s.active()).toBe("My layout");
  expect(s.dock.isOpen("history")).toBe(true);
});

test("size-class switching: a layout chosen for compact windows is switched to on crossing, and a manual choice wins until the next crossing", async () => {
  const s = await studio();
  s.layouts.saveNamed("Big", false, "wide");
  s.dock.close("library");
  s.layouts.saveNamed("Small", false, "compact");
  s.layouts.switchTo("l2");
  expect(s.active()).toBe("Big");
  s.resize("compact");
  expect(s.active()).toBe("Small");
  expect(s.toasts.at(-1)).toContain("for compact windows");
  // A manual choice within the class stands: nothing re-applies until the class changes.
  s.layouts.switchTo("l1");
  expect(s.active()).toBe("My layout");
  s.resize("compact");
  expect(s.active()).toBe("My layout");
  s.resize("wide");
  expect(s.active()).toBe("Big");
  s.resize("compact");
  expect(s.active()).toBe("Small");
  expect(s.preferences.snapshot().layouts?.seen).toBe("compact");
  // A Studio that opens wide after last being compact switches at start; one opening in the class last seen doesn't.
  const reopened = await studio("wide", s.preferences.snapshot());
  reopened.layouts.sizeClass("wide", false);
  expect(reopened.active()).toBe("Big");
  const same = await studio("compact", s.preferences.snapshot());
  same.layouts.switchTo("l1");
  same.layouts.sizeClass("compact", false);
  expect(same.active()).toBe("My layout");
});
