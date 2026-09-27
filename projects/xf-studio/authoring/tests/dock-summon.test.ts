// Summoning a panel (the palette, the Panels menu, Help, guidance, any reveal) shows it and moves focus to it, whatever state it was
// in (UI-110): in an expanded group its tab becomes active; in a collapsed group the group expands; a panel not in the layout goes back
// to an obvious home (where it was closed from, or its factory group) and otherwise opens floating, never into an arbitrary group
// (the maintainer's "I summoned Help, where is it?").
import { afterAll, beforeAll, expect, test } from "bun:test";
import { installLightDom, uninstallLightDom } from "./light-dom";
import { closePanel, locate, parseTree, setCollapsed, summonPanel, applyDrop, type DockTree, type GroupNode } from "../src/studio-ui/dock/layout";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());

const g = (id: string, panels: string[], collapsed = false, active = panels[0]!): GroupNode =>
  ({ kind: "group", id, panels, active, ...(collapsed ? { collapsed: true } : {}) });
/** The factory wide layout's shape: a left stack, the head, and the UV map over the inspectors on the right; Help and Activity closed. */
const factory = (inspectCollapsed = false): DockTree => ({ floating: [], closed: ["activity", "help"], root: { kind: "split", id: "s-root", axis: "row", sizes: [.21, .37, .42],
  children: [{ kind: "split", id: "s-left", axis: "column", sizes: [.4, .6], children: [g("g-collection", ["presets", "library"]), g("g-layers", ["layers", "history"])] },
    g("g-head", ["head"]),
    { kind: "split", id: "s-right", axis: "column", sizes: [.42, .58], children: [g("g-uv", ["uv"]), g("g-inspect", ["finish", "shape", "edge"], inspectCollapsed)] }] } });
const float = { x: 600, y: 80, w: 380, h: 620 };
const ids = ["presets", "library", "layers", "history", "head", "uv", "finish", "shape", "edge", "activity", "help"];

test("not in the layout and without a home (Help): it opens floating, and the collapsed group stays as it was", () => {
  const tree = factory(true);
  const next = summonPanel(tree, "help", factory(), float);
  const at = locate(next, "help")!;
  expect(at.windowId).toBeDefined();
  expect(next.floating.at(-1)).toMatchObject({ ...float, node: { kind: "group", panels: ["help"], active: "help" } });
  // The maintainer's case: never dropped into the collapsed lower-right group.
  expect(locate(next, "finish")!.group).toEqual(g("g-inspect", ["finish", "shape", "edge"], true));
  expect(next.closed).toEqual(["activity"]);
});

test("not in the layout, closed by the person from a group: it goes back into that group at its tab, and the group expands", () => {
  let tree = factory();
  tree = closePanel(tree, "shape");
  expect(tree.lastPlace?.shape).toEqual({ group: ["finish", "shape", "edge"], index: 1, active: false });
  tree = setCollapsed(tree, "g-inspect", true);
  const next = summonPanel(tree, "shape", factory(), float);
  expect(locate(next, "shape")!.group).toEqual(g("g-inspect", ["finish", "shape", "edge"], false, "shape"));
  expect(next.floating).toEqual([]);
  expect(next.lastPlace).toBeUndefined();
});

test("not in the layout, closed from a floating window: it floats where it was", () => {
  let tree = applyDrop(factory(), { kind: "panel", panelId: "history" }, { kind: "float", x: 40, y: 50, w: 300, h: 360 });
  tree = closePanel(tree, "history");
  const next = summonPanel(tree, "history", factory(), float);
  expect(next.floating).toMatchObject([{ x: 40, y: 50, w: 300, h: 360, node: { panels: ["history"] } }]);
});

test("not in the layout with no remembered place: it joins its factory group when one of that group's panels is open", () => {
  // A layout saved before places were remembered: History closed, nothing known about where it was.
  const tree: DockTree = { ...factory(), closed: ["activity", "help", "history"] };
  const root = tree.root!, layers = root.kind === "split" && root.children[0]!.kind === "split" ? root.children[0].children[1] as GroupNode : undefined;
  layers!.panels = ["layers"];
  const next = summonPanel(tree, "history", factory(), float);
  expect(locate(next, "history")!.group).toEqual(g("g-layers", ["layers", "history"], false, "history"));
});

test("already in a collapsed group: the group expands with the panel's tab active", () => {
  const next = summonPanel(factory(true), "edge", factory(), float);
  expect(locate(next, "edge")!.group).toEqual(g("g-inspect", ["finish", "shape", "edge"], false, "edge"));
});

test("already in an expanded group: only its tab becomes active", () => {
  const tree = factory();
  const next = summonPanel(tree, "library", factory(), float);
  expect(locate(next, "library")!.group).toEqual(g("g-collection", ["presets", "library"], false, "library"));
  expect({ ...next, root: null }).toEqual({ ...tree, root: null });
});

test("the remembered places of closed panels are saved with the layout and read back strictly", () => {
  const closed = closePanel(factory(), "shape");
  const parsed = parseTree(JSON.parse(JSON.stringify(closed)), ids, factory())!;
  expect(parsed.lastPlace).toEqual(closed.lastPlace);
  // Malformed places, and places of panels that are not closed, are dropped.
  const hostile = { ...JSON.parse(JSON.stringify(closed)), lastPlace: { shape: { group: "x" }, head: { group: ["head"], index: 0, active: true } } };
  expect(parseTree(hostile, ids, factory())!.lastPlace).toBeUndefined();
  // Opening the panel any other way (a drop) forgets its place.
  const dropped = applyDrop(closed, { kind: "panel", panelId: "shape" }, { kind: "tab", groupId: "g-uv", index: 1 });
  expect(dropped.lastPlace).toBeUndefined();
});

async function mount(tree: DockTree) {
  const { DockView } = await import("../src/studio-ui/dock/dock-view");
  document.body.replaceChildren();
  const view = new DockView({
    panels: ids.map(id => ({ id, title: id, icon: "layers" as const, description: id, element: document.createElement("div") })),
    state: { wide: tree, compact: tree }, sizeClass: () => "wide", defaults: () => factory(), save: () => {}, announce: () => {},
  });
  document.body.append(view.element);
  view.render();
  return view;
}
const frame = () => new Promise(resolve => setTimeout(resolve, 5));

test("every summon moves focus to the panel's tab: floating, expanding a collapsed group, or switching tabs", async () => {
  const view = await mount(factory(true));
  view.reveal("help");
  await frame();
  expect(view.panelState("help")).toBe("open");
  expect(view.isVisible("help")).toBe(true);
  expect(document.activeElement?.id).toBe("dock-tab-help");
  view.reveal("shape");
  await frame();
  expect(view.isCollapsed("shape")).toBe(false);
  expect(view.isVisible("shape")).toBe(true);
  expect(document.activeElement?.id).toBe("dock-tab-shape");
  view.reveal("library");
  await frame();
  expect(view.isVisible("library")).toBe(true);
  expect(document.activeElement?.id).toBe("dock-tab-library");
  // A caller that focuses inside the panel itself (Help's search) keeps its own focus.
  (document.activeElement as HTMLElement | null)?.blur?.();
  view.reveal("presets", false);
  await frame();
  expect(document.activeElement?.id).toBe("dock-tab-library");
});

test("a collapsed group's header keeps its expand and menu buttons, and every tab is named by its label", async () => {
  const view = await mount(factory(true));
  const group = view.element.querySelector('[data-group="g-inspect"]')!;
  const collapse = group.querySelector(".dock-collapse-btn")!, menu = group.querySelector(".dock-menu-btn")!;
  expect([collapse.getAttribute("aria-expanded"), collapse.parentElement?.className]).toEqual(["false", "panel-header-actions"]);
  expect([menu.getAttribute("aria-haspopup"), menu.parentElement?.className]).toEqual(["menu", "panel-header-actions"]);
  expect(Array.from(group.querySelectorAll<HTMLElement>(".dock-tab")).map(tab => [tab.getAttribute("aria-label"), tab.title.startsWith(tab.getAttribute("aria-label")!)]))
    .toEqual([["finish", true], ["shape", true], ["edge", true]]);
});
