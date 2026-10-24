/**
 * Studio modules and derived view tools (research/authoring/view-graph-design.md §3.9, §4, phase P2): pure derivation across module
 * visibility, research preference and scene kind; the application's resolved tool list and `view.setTool`; parked panel layouts per
 * size class; collapsed groups; the modules preference.
 */
import { MAIN_VIEW } from "../src/platform/api/view-graph";
import { expect, test } from "bun:test";
import { deriveViewSummaries, deriveViewTools, moduleRegistrationIssues, viewTitles, type ModuleRegistration, type ViewToolContribution } from "../src/platform/api";
import { PLATFORM_VIEW_TOOLS } from "../src/platform/core/view-tools";
import { STUDIO_MODULE_REGISTRATION } from "../src/compose/modules";
import { STUDIO_COMPOSITION } from "../src/compose/studio-registry";
import { createTrustedAuthoringCore } from "../src/app/trusted-authoring-core";
import { activate, allGroups, applyDrop, closePanel, locate, openShares, panelsIn, parkPanels, parseTree, setCollapsed, unparkPanels, type DockNode, type DockTree } from "../src/studio-ui/dock/layout";
import { defaultCompact, defaultWide } from "../src/studio-ui/layout-defaults";
import { activeModules, toolFilter } from "../src/studio-ui/runtime";
import { STUDIO_CATALOGUE } from "../src/compose/views";
import { defaultDockStateFor, restoreDockPreference, serializeDockState } from "../src/studio-ui/dock/persist";
import { parseUIPreferences, UIPreferenceActions } from "../src/app/ui-preferences";
import type { LayoutTab } from "../src/app/profiles/profile-session";
import { group } from "../src/studio-ui/dock/layout";
import { EYE_MAKEUP_GRANDFATHERED_PANELS } from "../src/features/eye-makeup/view/contribution";
import { freshWorkspace } from "./fixtures/eye-region";
import { PreviewActions, type PreviewPort } from "../src/preview/preview-actions";

import { namedCore } from "./fixtures/named-targets";
const ids = (tools: readonly ViewToolContribution[]) => tools.map(tool => tool.id);

test("a view's tools: the platform's always, a module's only while it shows, research tools only with research on", () => {
  const all = { modules: ["eye-makeup"], research: true }, everyday = { modules: ["eye-makeup"], research: false };
  expect(ids(deriveViewTools(STUDIO_MODULE_REGISTRATION, "character", all)))
    .toEqual(["camera.front", "camera.body", "eye-makeup.surface", "eye-makeup.wire", "motion.idle"]);
  // The wireframe is a research tool everywhere at once (the audit's inconsistency: the toolbar showed it without research on).
  expect(ids(deriveViewTools(STUDIO_MODULE_REGISTRATION, "character", everyday))).toEqual(["camera.front", "camera.body", "eye-makeup.surface", "motion.idle"]);
  // Hiding eye makeup removes its tools; the platform's stay.
  expect(ids(deriveViewTools(STUDIO_MODULE_REGISTRATION, "character", { modules: [], research: true }))).toEqual(["camera.front", "camera.body", "motion.idle"]);
  // A scene kind the character tools don't name gets none of them (World's location view, P5).
  const world: ModuleRegistration = { ...STUDIO_MODULE_REGISTRATION, scenes: ["character", "location"],
    modules: [...STUDIO_MODULE_REGISTRATION.modules, { id: "world", label: "World", icon: "category", group: "world", stage: "preview", shownByDefault: false, description: "" }],
    tools: [...STUDIO_MODULE_REGISTRATION.tools, { id: "world.radius", module: "world", label: "Streaming radius", icon: "dot", order: 5, scenes: ["location"],
      placement: "toolbar", kind: "menu", state: "scene", dispatches: "world.setRadius" }] };
  expect(moduleRegistrationIssues(world)).toEqual([]);
  expect(ids(deriveViewTools(world, "location", { modules: ["eye-makeup", "world"], research: true }))).toEqual(["world.radius"]);
  expect(ids(deriveViewTools(world, "location", { modules: ["eye-makeup"], research: true }))).toEqual([]);
  // Summaries follow the same visibility.
  expect(deriveViewSummaries(STUDIO_MODULE_REGISTRATION, "character", { modules: ["eye-makeup"] }).map(item => item.module)).toEqual(["eye-makeup"]);
  expect(deriveViewSummaries(STUDIO_MODULE_REGISTRATION, "character", { modules: [] })).toEqual([]);
});

test("rule 7: the module registration is complete, and an incomplete one says what is wrong", () => {
  expect(moduleRegistrationIssues(STUDIO_MODULE_REGISTRATION)).toEqual([]);
  expect(PLATFORM_VIEW_TOOLS.every(tool => tool.module === "platform")).toBe(true);
  const broken: ModuleRegistration = { ...STUDIO_MODULE_REGISTRATION,
    modules: [...STUDIO_MODULE_REGISTRATION.modules, STUDIO_MODULE_REGISTRATION.modules[0]],
    tools: [...STUDIO_MODULE_REGISTRATION.tools, { ...PLATFORM_VIEW_TOOLS[0] }, { id: "world.menu", module: "world", label: "World", icon: "dot", order: 1,
      scenes: ["character"], placement: "toolbar", kind: "menu", state: "scene", dispatches: "world.apply" }, { id: "surface", module: "eye-makeup", label: "x",
      icon: "dot", order: 1, scenes: ["garage"], placement: "menu", kind: "toggle", state: "tools", dispatches: "view.setTool" },
    // Tools name the action they dispatch; a toggle in the tools node dispatches view.setTool, and only such a toggle turns on editing.
    { id: "eye-makeup.mute", module: "eye-makeup", label: "x", icon: "dot", order: 1, scenes: ["character"], placement: "menu", kind: "toggle", state: "scene" } as never,
    { id: "eye-makeup.frame", module: "eye-makeup", label: "x", icon: "dot", order: 1, scenes: ["character"], placement: "menu", kind: "action", state: "tools",
      dispatches: "camera.front" },
    { id: "eye-makeup.edit", module: "eye-makeup", label: "x", icon: "dot", order: 1, scenes: ["character"], placement: "menu", kind: "action", state: "camera",
      dispatches: "camera.front", editing: true }],
    summaries: [{ module: "nobody", scenes: ["character"] }] };
  expect(moduleRegistrationIssues(broken)).toEqual(["module eye-makeup is registered twice", "tool camera.front is registered twice",
    "tool world.menu names unregistered module world", "tool surface is not prefixed with its module eye-makeup", "tool surface names an unregistered scene kind",
    "tool eye-makeup.mute names no action to dispatch",
    "tool eye-makeup.frame must be a toggle dispatching view.setTool exactly when its state is the view's tools node",
    "tool eye-makeup.edit turns on editing but isn't held in the view's tools node",
    "summary names unregistered module nobody"]);
});

/** A preview device that records what it was told (surface and wire), for the tools a head applies. */
function recordingPreviewPort(calls: string[]): PreviewPort {
  const camera = { position: [0, 1.6, -0.6], target: [0, 1.6, 0.005], fov: 30 };
  return { cameraState: () => camera, front: () => false, setFov: () => false, endFovGesture: () => {}, restoreCamera: () => {},
    setLighting: () => {}, setSurfaceControls: enabled => calls.push(`surface:${enabled}`),
    setWire: enabled => calls.push(`wire:${enabled}`), setNormals: () => {}, setEyeOptics: () => {}, setHair: () => {}, setEyeShape: () => {},
    setPiercings: () => {}, setDetail: () => {} };
}

test("the application resolves each tool's state and action; view.setTool edits the view's tools node, and a hidden module's tool stays dispatchable", () => {
  const workspace = freshWorkspace();
  const { app, views } = namedCore(createTrustedAuthoringCore(workspace, { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION));
  const tools = app.viewTools(MAIN_VIEW, { modules: ["eye-makeup"], research: false });
  expect(tools.map(tool => [tool.id, tool.action.kind, tool.on])).toEqual([["camera.front", "camera.front", undefined], ["camera.body", "camera.body", undefined],
    ["eye-makeup.surface", "view.setTool", true], ["motion.idle", "motion.setIdle", false]]);
  // Idle hides where the head has no idle; the camera tools act on the view they belong to.
  expect(tools.find(tool => tool.id === "motion.idle")?.shown).toBe(false);
  expect(tools[0].action).toEqual({ kind: "camera.front", view: "main" });
  // Before the 3D view is ready a toggle would reach no device and not be saved: it waits, and says so (UI-106).
  expect(app.capability({ kind: "view.setTool", view: "main", tool: "eye-makeup.surface", enabled: false })).toMatchObject({ available: false, code: "not_ready" });
  app.attach({ preview: new PreviewActions(workspace.preview, recordingPreviewPort([]), views) });
  // Toggle Surface controls: the graph's tools node changes; no View and lighting step is recorded.
  expect(app.dispatch({ kind: "view.setTool", view: "main", tool: "eye-makeup.surface", enabled: false })).toEqual({ ok: true, result: undefined });
  expect(views.state("main", "tools")).toEqual({ on: { "eye-makeup.surface": false, "eye-makeup.wire": false } });
  expect(views.history().depth).toBe(0);
  // A slider's drag is one View and lighting step until it is released (view.endEdit), however long it pauses (CORE-95).
  for (const value of [1.3, 1.4]) app.dispatch({ kind: "preview.setExposure", view: "main", value });
  expect(app.dispatch({ kind: "view.endEdit" })).toMatchObject({ ok: true });
  app.dispatch({ kind: "preview.setExposure", view: "main", value: 1.5 });
  expect(views.history()).toMatchObject({ undo: "Exposure", depth: 2 });
  // Even with eye makeup hidden (the presentation's filter), its action is still valid: visibility is presentation state.
  expect(app.viewTools(MAIN_VIEW, { modules: [], research: true }).map(tool => tool.id)).not.toContain("eye-makeup.wire");
  expect(app.capability({ kind: "view.setTool", view: "main", tool: "eye-makeup.wire", enabled: true }).available).toBe(true);
  expect(app.capability({ kind: "view.setTool", view: "main", tool: "camera.front", enabled: true })).toMatchObject({ available: false, code: "invalid_value" });
  expect(app.capability({ kind: "view.setTool", tool: "eye-makeup.wire", enabled: true, view: "gone" })).toMatchObject({ available: false, code: "missing_target" });
  expect(app.capability({ kind: "view.undo" })).toMatchObject({ available: true });
  expect(app.modules().map(module => module.id)).toEqual(["eye-makeup", "save-explorer", "expressions", "poses"]);
  expect(app.views()?.views.map(view => [view.id, view.panel, view.sceneKind])).toEqual([["main", "head", "character"]]);
});

test("a tool the presentation withdraws keeps its state but reaches no device until it is offered again (UI-102)", () => {
  const workspace = freshWorkspace(), calls: string[] = [];
  workspace.preview.wire = true;
  let stackResets = 0;
  const { app, views } = namedCore(createTrustedAuthoringCore(workspace, { resetStack: () => { stackResets++; }, selectedCollection: () => "draft" }, STUDIO_COMPOSITION));
  const recipe = structuredClone(workspace.recipe), resetsBefore = stackResets;
  // Research tools are hidden before the head loads: the head starts with the wireframe it stored, then turns it off at once.
  app.withdrawViewTools(["eye-makeup.wire", "no.such-tool"]);
  const preview = new PreviewActions(workspace.preview, recordingPreviewPort(calls), views);
  app.attach({ preview });
  expect(calls).toEqual(["wire:false"]);
  // Eye makeup is hidden: Surface controls stops drawing and editing, while the view keeps (and saves) the choice.
  app.withdrawViewTools(["eye-makeup.wire", "eye-makeup.surface"]);
  expect(calls).toEqual(["wire:false", "surface:false"]);
  expect(views.state("main", "tools")).toEqual({ on: { "eye-makeup.surface": true, "eye-makeup.wire": true } });
  expect(preview.snapshot()).toMatchObject({ surface: true, wire: true });
  // Withdrawing editing tools does not clear or recompile the makeup a scene keeps drawing.
  expect(workspace.recipe).toEqual(recipe);
  expect(stackResets).toBe(resetsBefore);
  expect(views.history().depth).toBe(0);
  // A choice made while withdrawn is kept and reaches the device only once the tool is offered again.
  app.dispatch({ kind: "view.setTool", view: "main", tool: "eye-makeup.surface", enabled: false });
  app.dispatch({ kind: "view.setTool", view: "main", tool: "eye-makeup.surface", enabled: true });
  expect(calls).toEqual(["wire:false", "surface:false"]);
  app.withdrawViewTools([]);
  expect(calls).toEqual(["wire:false", "surface:false", "surface:true", "wire:true"]);
  preview.dispose();
});

/** A node without its generated IDs, sizes rounded. */
const strip = (node: DockNode | null): unknown => !node ? null : node.kind === "group" ? { panels: node.panels, active: node.active }
  : { axis: node.axis, sizes: node.sizes, children: node.children.map(strip) };
/** A tree's shape without generated IDs: groups (their panels and active tab), floating windows and closed panels. */
const shape = (tree: DockTree) => ({ groups: allGroups(tree).map(entry => ({ panels: entry.group.panels, active: entry.group.active, floating: !!entry.windowId })),
  closed: tree.closed });

test("hiding a module parks its panels per size class, and showing it puts each back exactly where it was", () => {
  const eye = EYE_MAKEUP_GRANDFATHERED_PANELS;
  for (const factory of [defaultWide(STUDIO_CATALOGUE), defaultCompact(STUDIO_CATALOGUE)]) {
    const parked = parkPanels(factory, eye);
    expect(panelsIn(parked).some(id => eye.includes(id))).toBe(false);
    expect(Object.keys(parked.parked ?? {}).sort()).toEqual([...eye].sort());
    const back = unparkPanels(parked, eye, factory, { x: 0, y: 0, w: 1600, h: 900 });
    expect(shape(back)).toEqual(shape(factory));
    // The whole tree returns, split fractions included (a group that left whole comes back beside its neighbour at its share).
    expect(strip(back.root)).toEqual(strip(factory.root));
    expect(back.parked).toBeUndefined();
  }
  // A person's own arrangement: UV floating on its own, Warp closed, Shape the shown tab of its group.
  const custom = activate(closePanel(applyDrop(defaultWide(STUDIO_CATALOGUE), { kind: "panel", panelId: "uv" }, { kind: "float", x: 400, y: 120, w: 500, h: 260 }),
    "warp"), "shape");
  const parsed = parseTree(JSON.parse(JSON.stringify(custom)), STUDIO_CATALOGUE.ids, defaultWide(STUDIO_CATALOGUE))!;
  const hidden = parkPanels(parsed, eye);
  expect(hidden.floating).toEqual([]);
  expect(hidden.parked?.uv).toEqual({ group: ["uv"], index: 0, active: true, window: { x: 400, y: 120, w: 500, h: 260 } });
  expect(hidden.parked?.warp).toEqual({ closed: true });
  const shown = unparkPanels(hidden, eye, defaultWide(STUDIO_CATALOGUE), { x: 0, y: 0, w: 1600, h: 900 });
  expect(shape(shown)).toEqual(shape(parsed));
  expect(shown.floating[0]).toMatchObject({ x: 400, y: 120, w: 500, h: 260 });
});

test("the parser keeps parked panels withdrawn (never re-added) and remembers where a saved tree still held them", () => {
  const eye = EYE_MAKEUP_GRANDFATHERED_PANELS, known = STUDIO_CATALOGUE.ids.filter(id => !eye.includes(id));
  const factory = defaultWide(STUDIO_CATALOGUE);
  // A layout saved while eye makeup showed, read with it hidden: its panels leave, their places kept.
  const read = parseTree(structuredClone(factory), known, factory, eye)!;
  expect(panelsIn(read).some(id => eye.includes(id))).toBe(false);
  expect(read.parked?.layers).toMatchObject({ index: 0, active: true });
  // Round trip: the parked places survive serialization, and nothing parked is re-added.
  const again = parseTree(JSON.parse(JSON.stringify(read)), known, factory, eye)!;
  expect(again.parked).toEqual(read.parked);
  expect(panelsIn(again).some(id => eye.includes(id))).toBe(false);
  // Shown again, the parked places are dropped and the panels are known.
  expect(parseTree(JSON.parse(JSON.stringify(read)), STUDIO_CATALOGUE.ids, factory)!.parked).toBeUndefined();
  // Restore through the preference gate, both size classes, with the defaults parked for a layout with no saved places.
  const state = defaultDockStateFor(STUDIO_CATALOGUE, eye);
  expect(Object.keys(state.wide.parked ?? {}).sort()).toEqual([...eye].sort());
  expect(Object.keys(state.compact.parked ?? {}).sort()).toEqual([...eye].sort());
  const restored = restoreDockPreference(serializeDockState({ wide: defaultWide(STUDIO_CATALOGUE), compact: defaultCompact(STUDIO_CATALOGUE) }),
    { x: 0, y: 0, w: 1600, h: 900 }, STUDIO_CATALOGUE, eye);
  expect(restored.recovered).toBe(true);
  for (const tree of [restored.state.wide, restored.state.compact]) {
    expect(panelsIn(tree).some(id => eye.includes(id))).toBe(false);
    expect(Object.keys(tree.parked ?? {}).sort()).toEqual([...eye].sort());
  }
});

test("a collapsed group keeps its flag through a save and restore, and expanding clears it", () => {
  const factory = defaultWide(STUDIO_CATALOGUE), inspect = locate(factory, "character")!.group.id;
  const collapsed = setCollapsed(factory, inspect, true);
  expect(locate(collapsed, "character")!.group.collapsed).toBe(true);
  const read = parseTree(JSON.parse(JSON.stringify(collapsed)), STUDIO_CATALOGUE.ids, factory)!;
  expect(locate(read, "character")!.group.collapsed).toBe(true);
  expect("collapsed" in locate(setCollapsed(read, inspect, false), "character")!.group).toBe(false);
});

test("a view's title comes from the graph: its own name, else \"3D view\", numbered when there are several; the panel ID never changes", () => {
  expect(viewTitles([{ id: "main" }])).toEqual(["3D view"]);
  expect(viewTitles([{ id: "main" }, { id: "side" }, { id: "close", title: "Close-up" }])).toEqual(["3D view 1", "3D view 2", "Close-up"]);
  const { app } = namedCore(createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION));
  // Without a character context the scene still shows a V: the creator's default one.
  expect(app.viewTitles()).toEqual([{ view: "main", panel: "head", title: "3D view", subject: "V (the character creator's default V)" }]);
  expect(STUDIO_CATALOGUE.meta.head?.title).toBe("3D view");
});

test("view titles number within each tab, preserve renamed views and renumber after removal", () => {
  const views = [{ id: "main", tab: "a" }, { id: "poses", tab: "b" }, { id: "side", tab: "a", title: "Side view" },
    { id: "close", tab: "c", title: "Close-up" }, { id: "back", tab: "b" }];
  expect(viewTitles(views)).toEqual(["3D view 1", "3D view 1", "Side view", "Close-up", "3D view 2"]);
  expect(viewTitles(views.filter(view => view.id !== "side" && view.id !== "back"))).toEqual(["3D view", "3D view", "Close-up"]);
  const core = createTrustedAuthoringCore(freshWorkspace(), { resetStack() {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
  // Separate tabs each have a sole view; the application supplies these same titles to every presentation.
  core.views.adoptViews("tab-a");
  core.views.addView(MAIN_VIEW, {}, { label: "New view", tab: "tab-b" });
  expect(core.app.viewTitles().map(view => view.title)).toEqual(["3D view", "3D view"]);
});

test("a collapsed group's neighbours share all of its split's space, whatever their stored shares", () => {
  // Flex grow factors summing to less than 1 would leave the collapsed group's share empty.
  expect(openShares([0.42, 0.58], [false, true])).toEqual([1, 0]);
  expect(openShares([0.2, 0.3, 0.5], [false, true, false]).map(share => +share.toFixed(4))).toEqual([0.2857, 0, 0.7143]);
  expect(openShares([0.5, 0.5], [false, false])).toEqual([0.5, 0.5]);
});

test("legacy modules, layout and layouts survive a newer build, unrelated edits and an older-build JSON reader unchanged", () => {
  const legacy = { modules: { "eye-makeup": false, "Bad Id": true, poses: "yes", future: { nested: true } },
    layout: { format: "future/dock", version: 2, state: { unknown: [1, "panel"] }, extra: "keep" },
    layouts: { future: true, entries: [{ working: { modules: { poses: false } } }] } };
  const actions = new UIPreferenceActions({ schema: "xfs/ui-preferences-1", theme: "dark", ...legacy });
  actions.dispatch({ kind: "theme.set", theme: "light" });
  actions.dispatch({ kind: "researchTools.set", enabled: true });
  expect(() => actions.dispatch({ kind: "modules.set", module: "poses", shown: true } as never)).toThrow("That preference isn't available.");
  const oldReader = (value: unknown) => JSON.parse(JSON.stringify(value));
  const older = oldReader(new UIPreferenceActions(oldReader(actions.snapshot())).snapshot());
  for (const key of ["modules", "layout", "layouts"] as const) expect(older[key]).toEqual(legacy[key]);
  for (const value of [{}, null, []]) expect(parseUIPreferences({ schema: "xfs/ui-preferences-1", modules: value }).modules as unknown).toEqual(value);
});

// Instances retained after closing, parked places and another size class must not activate tools.
test("feature focus derives per tab from docked instances, including collapsed and floating panels", () => {
  const make = (type: string): LayoutTab => {
    const id = `${type}--1`, tree = { root: group([id]), floating: [], closed: [] };
    return { id: type, name: type, panels: [{ id, type }], dock: serializeDockState({ wide: tree, compact: tree }) };
  };
  const eye = make("presets"), poses = make("poses.library"), library = make("library");
  const focused = (tab: LayoutTab, size: "wide" | "compact" = "wide") => activeModules(tab, (tab.dock?.state as unknown as import("../src/studio-ui/dock/layout").DockState | undefined)?.[size], STUDIO_MODULE_REGISTRATION.modules, STUDIO_CATALOGUE);
  expect(focused(eye)).toEqual(["eye-makeup"]);
  expect(focused(library)).toEqual(["eye-makeup"]);
  expect(activeModules(eye, { root: group(["presets"]), floating: [], closed: [] }, STUDIO_MODULE_REGISTRATION.modules, STUDIO_CATALOGUE)).toEqual(["eye-makeup"]);
  expect(activeModules(eye, { root: null, floating: [], closed: ["presets"] }, STUDIO_MODULE_REGISTRATION.modules, STUDIO_CATALOGUE)).toEqual([]);
  expect(focused(poses)).toEqual(["poses"]);
  const closed = structuredClone(eye), state = closed.dock!.state as unknown as import("../src/studio-ui/dock/layout").DockState;
  state.wide = { root: null, floating: [], closed: ["presets--1"], parked: { "presets--1": { closed: true } } };
  expect(focused(closed)).toEqual([]);
  expect(focused(closed, "compact")).toEqual(["eye-makeup"]);
  state.wide = { root: null, floating: [{ id: "f", x: 0, y: 0, w: 300, h: 200, node: { ...group(["presets--1"]), collapsed: true } }], closed: [] };
  expect(focused(closed)).toEqual(["eye-makeup"]);
  expect(focused({ ...eye, panels: [] })).toEqual([]);
  expect(activeModules(undefined, undefined, STUDIO_MODULE_REGISTRATION.modules, STUDIO_CATALOGUE)).toEqual([]);
  let shown = eye;
  const port = { preferences: { snapshot: () => ({ modules: { "eye-makeup": false, poses: true } }) },
    views: { modules: () => STUDIO_MODULE_REGISTRATION.modules },
    tabs: { snapshot: () => ({ shown: shown.id, tabs: [eye, poses] }) } };
  const filter = () => toolFilter(port as never, STUDIO_CATALOGUE, (shown.dock!.state as unknown as import("../src/studio-ui/dock/layout").DockState).wide);
  expect(ids(deriveViewTools(STUDIO_MODULE_REGISTRATION, "character", filter()))).toContain("eye-makeup.surface");
  shown = poses;
  expect(ids(deriveViewTools(STUDIO_MODULE_REGISTRATION, "character", filter()))).not.toContain("eye-makeup.surface");
});
