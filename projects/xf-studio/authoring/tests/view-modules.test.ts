/**
 * Studio modules and derived view tools (research/authoring/view-graph-design.md §3.9, §4, phase P2): pure derivation across module
 * visibility, research preference and scene kind; the application's resolved tool list and `view.setTool`; parked panel layouts per
 * size class; collapsed groups; the modules preference.
 */
import { expect, test } from "bun:test";
import { deriveViewSummaries, deriveViewTools, moduleRegistrationIssues, type ModuleRegistration, type ViewToolContribution } from "../src/platform/api";
import { PLATFORM_VIEW_TOOLS } from "../src/platform/core/view-tools";
import { STUDIO_MODULE_REGISTRATION } from "../src/compose/modules";
import { STUDIO_COMPOSITION } from "../src/compose/studio-registry";
import { STUDIO_CATALOGUE } from "../src/compose/views";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { activate, allGroups, applyDrop, closePanel, locate, panelsIn, parkPanels, parseTree, setCollapsed, unparkPanels, type DockNode, type DockTree } from "../src/studio-ui/dock/layout";
import { defaultCompact, defaultWide } from "../src/studio-ui/layout-defaults";
import { defaultDockStateFor, restoreDockPreference, serializeDockState } from "../src/studio-ui/dock/persist";
import { parseUIPreferences, UIPreferenceActions } from "../src/ui-preferences";
import { EYE_MAKEUP_GRANDFATHERED_PANELS } from "../src/features/eye-makeup/view/contribution";
import { freshWorkspace } from "./fixtures/eye-region";

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
      placement: "toolbar", kind: "menu", state: "scene" }] };
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
    tools: [...STUDIO_MODULE_REGISTRATION.tools, { ...PLATFORM_VIEW_TOOLS[0] }, { id: "poses.menu", module: "poses", label: "Poses", icon: "dot", order: 1,
      scenes: ["character"], placement: "toolbar", kind: "menu", state: "scene" }, { id: "surface", module: "eye-makeup", label: "x", icon: "dot", order: 1,
      scenes: ["garage"], placement: "menu", kind: "toggle", state: "tools" }],
    summaries: [{ module: "nobody", scenes: ["character"] }] };
  expect(moduleRegistrationIssues(broken)).toEqual(["module eye-makeup is registered twice", "tool camera.front is registered twice",
    "tool poses.menu names unregistered module poses", "tool surface is not prefixed with its module eye-makeup", "tool surface names an unregistered scene kind",
    "summary names unregistered module nobody"]);
});

test("the application resolves each tool's state and action; view.setTool edits the view's tools node, and a hidden module's tool stays dispatchable", () => {
  const { app, views } = createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
  const tools = app.viewTools(undefined, { modules: ["eye-makeup"], research: false });
  expect(tools.map(tool => [tool.id, tool.action.kind, tool.on])).toEqual([["camera.front", "camera.front", undefined], ["camera.body", "camera.body", undefined],
    ["eye-makeup.surface", "view.setTool", true], ["motion.idle", "motion.setIdle", false]]);
  // Idle hides where the head has no idle; the camera tools act on the view they belong to.
  expect(tools.find(tool => tool.id === "motion.idle")?.shown).toBe(false);
  expect(tools[0].action).toEqual({ kind: "camera.front", view: "main" });
  // Toggle Surface controls: the graph's tools node changes; no View and lighting step is recorded.
  expect(app.dispatch({ kind: "view.setTool", tool: "eye-makeup.surface", enabled: false })).toEqual({ ok: true, result: undefined });
  expect(views.state("main", "tools")).toEqual({ on: { "eye-makeup.surface": false, "eye-makeup.wire": false } });
  expect(views.history().depth).toBe(0);
  // Even with eye makeup hidden (the presentation's filter), its action is still valid: visibility is presentation state.
  expect(app.viewTools(undefined, { modules: [], research: true }).map(tool => tool.id)).not.toContain("eye-makeup.wire");
  expect(app.capability({ kind: "view.setTool", tool: "eye-makeup.wire", enabled: true }).available).toBe(true);
  expect(app.capability({ kind: "view.setTool", tool: "camera.front", enabled: true })).toMatchObject({ available: false, code: "invalid_value" });
  expect(app.capability({ kind: "view.setTool", tool: "eye-makeup.wire", enabled: true, view: "gone" })).toMatchObject({ available: false, code: "missing_target" });
  expect(app.capability({ kind: "view.undo" })).toMatchObject({ available: false });
  expect(app.modules().map(module => module.id)).toEqual(["eye-makeup"]);
  expect(app.views()?.views.map(view => [view.id, view.panel, view.sceneKind])).toEqual([["main", "head", "character"]]);
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

test("module visibility is a bounded presentation preference, stored only where the person chose", () => {
  expect(parseUIPreferences({ schema: "xfs/ui-preferences-1", theme: "dark", inputHints: true }).modules).toBeUndefined();
  expect(parseUIPreferences({ schema: "xfs/ui-preferences-1", theme: "dark", inputHints: true, modules: { "eye-makeup": false, "Bad Id": true, poses: "yes" } }).modules)
    .toEqual({ "eye-makeup": false });
  const actions = new UIPreferenceActions();
  expect(actions.capability({ kind: "modules.set", module: "", shown: true }).available).toBe(false);
  actions.dispatch({ kind: "modules.set", module: "eye-makeup", shown: false });
  expect(actions.snapshot().modules).toEqual({ "eye-makeup": false });
});
