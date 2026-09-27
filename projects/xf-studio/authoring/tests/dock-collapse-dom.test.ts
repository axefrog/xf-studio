// The dock renders the folding rule (view-graph-design.md §4.4): a folded cell takes no share, the expanded cells of its split share
// all of it, a collapsed group is marked with the axis it folded along, a column whose groups all collapsed folds as one, and a tab
// of a collapsed group expands it. Rendered in the light DOM (no layout: the flex values are what the browser lays out).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { installLightDom, lightEvent, uninstallLightDom, type LightElement } from "./light-dom";
import type { DockTree, GroupNode } from "../src/studio-ui/dock/layout";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());

const ids = ["head", "finish", "shape", "pigment", "warp", "lighting", "motion", "quality"];
const g = (id: string, panels: string[], collapsed = false): GroupNode =>
  ({ kind: "group", id, panels, active: panels[0]!, ...(collapsed ? { collapsed: true } : {}) });
const tree = (a: boolean, b: boolean, c: boolean): DockTree => ({ floating: [], closed: [], root: { kind: "split", id: "s-root", axis: "row", sizes: [.6, .4],
  children: [g("stage", ["head"]), { kind: "split", id: "s-right", axis: "column", sizes: [.3, .3, .4],
    children: [g("a", ["finish", "shape"], a), g("b", ["pigment", "warp"], b), g("c", ["lighting", "motion", "quality"], c)] }] } });

async function mount(wide: DockTree) {
  const { DockView } = await import("../src/studio-ui/dock/dock-view");
  const saved: DockTree[] = [];
  const view = new DockView({
    panels: ids.map(id => ({ id, title: id, icon: "layers" as const, description: id, element: document.createElement("div") })),
    state: { wide, compact: wide }, sizeClass: () => "wide", defaults: () => wide,
    save: state => saved.push(state.wide), announce: () => {},
  });
  view.render();
  const root = view.element as unknown as LightElement;
  const cells = (split: string) => root.querySelector(`[data-split="${split}"]`)!.children.filter(child => child.classList.contains("dock-cell"));
  const splitters = (split: string) => root.querySelector(`[data-split="${split}"]`)!.children.filter(child => child.classList.contains("dock-splitter"));
  const flex = (cell: LightElement) => (cell.style as unknown as { flex: string }).flex;
  return { view, root, saved, cells, splitters, flex };
}

test("two of three stacked groups collapsed: full-width header rows, and the third fills the column", async () => {
  const { root, cells, splitters, flex } = await mount(tree(true, true, false));
  expect(cells("s-right").map(flex)).toEqual(["0 0 auto", "0 0 auto", "1 1 0"]);
  expect(cells("s-right").map(cell => cell.dataset.collapsed)).toEqual(["column", "column", undefined]);
  expect(root.querySelector('[data-group="a"]')!.dataset.fold).toBe("column");
  expect(root.querySelector('[data-group="c"]')!.dataset.fold).toBeUndefined();
  // Neither splitter has an expanded group above it: both stay as spacing but can't be dragged or focused.
  expect(splitters("s-right").map(s => [s.classList.contains("inert"), s.getAttribute("tabindex")])).toEqual([[true, null], [true, null]]);
  // The column itself still has an expanded group, so it keeps its share of the row.
  expect(cells("s-root").map(flex)).toEqual(["0.6 1 0", "0.4 1 0"]);
});

test("every group in the column collapsed: the column folds to a vertical strip and the head takes the row", async () => {
  const { root, cells, flex } = await mount(tree(true, true, true));
  expect(cells("s-root").map(flex)).toEqual(["1 1 0", "0 0 auto"]);
  expect(cells("s-root")[1]!.dataset.collapsed).toBe("row");
  expect(["a", "b", "c"].map(id => root.querySelector(`[data-group="${id}"]`)!.dataset.fold)).toEqual(["row", "row", "row"]);
  // Each strip is as long as its tabs need, sharing what is left; there is nothing to resize between them.
  expect(cells("s-right").map(flex)).toEqual(["1 1 auto", "1 1 auto", "1 1 auto"]);
});

test("a tab of a collapsed group expands it, showing that tab, and the sizes come back as they were", async () => {
  const { view, root, saved, cells, flex } = await mount(tree(true, true, false));
  const tab = root.querySelector('[data-panel="shape"]')!;
  tab.dispatchEvent(lightEvent("click"));
  const top = view.tree.root, right = top?.kind === "split" ? top.children[1] : undefined;
  expect(right?.kind === "split" ? right.children[0] : undefined).toEqual({ ...g("a", ["finish", "shape"]), active: "shape" });
  expect(saved.length).toBe(1);
  expect(cells("s-right").map(flex).map(value => value.replace(/^(\d\.\d{4})\d*/, "$1"))).toEqual(["0.4285 1 0", "0 0 auto", "0.5714 1 0"]);
});

test("revealing a panel in a collapsed group expands it (UI-103)", async () => {
  const { view } = await mount(tree(true, true, false));
  view.reveal("pigment", false);
  expect(view.isCollapsed("pigment")).toBe(false);
  expect(view.isVisible("pigment")).toBe(true);
  expect(view.isCollapsed("finish")).toBe(true);
});

test("a saved layout with every docked group collapsed never shows a blank dock (UI-105)", async () => {
  const { view, cells, flex } = await mount({ ...tree(true, true, true), root: { kind: "split", id: "s-right", axis: "column", sizes: [.3, .3, .4],
    children: [g("a", ["finish", "shape"], true), g("b", ["pigment", "warp"], true), g("c", ["lighting", "motion", "quality"], true)] } });
  // The largest expands; the others stay full-width header rows.
  expect(["finish", "pigment", "lighting"].map(id => view.isCollapsed(id))).toEqual([true, true, false]);
  expect(cells("s-right").map(flex)).toEqual(["0 0 auto", "0 0 auto", "1 1 0"]);
});

test("the last expanded docked group offers no collapse; collapsing it through the view is refused", async () => {
  const { view, root } = await mount({ ...tree(true, true, false), root: { kind: "split", id: "s-right", axis: "column", sizes: [.3, .3, .4],
    children: [g("a", ["finish", "shape"], true), g("b", ["pigment", "warp"], true), g("c", ["lighting", "motion", "quality"])] } });
  expect(view.collapseBlocked("lighting")).toBe("Nothing else is docked to take its space.");
  expect(root.querySelector('[data-group="c"] .dock-collapse-btn')).toBeNull();
  expect(view.collapseBlocked("finish")).toBeUndefined();
});

test("a folded strip reads top to bottom: Up and Down switch and reorder its tabs, and Down on a bar still moves into the panel (UI-122)", async () => {
  const { view, root } = await mount(tree(true, true, true));
  const { findGroup } = await import("../src/studio-ui/dock/layout");
  const group = (id: string) => findGroup(view.tree, id)!.group;
  const press = (panel: string, key: string, mods: { altKey?: boolean; shiftKey?: boolean } = {}) => {
    const event = lightEvent("keydown", { key, ...mods });
    root.querySelector(`[data-panel="${panel}"]`)!.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(root.querySelector('[data-group="c"]')!.querySelector('[role="tablist"]')!.getAttribute("aria-orientation")).toBe("vertical");
  expect(press("lighting", "ArrowDown")).toBe(true);
  expect(group("c").active).toBe("motion");
  press("motion", "ArrowUp"); press("lighting", "ArrowUp");
  expect(group("c").active).toBe("quality");
  // Alt+Shift+Up moves the tab one place up the strip; Left and Right still switch.
  press("quality", "ArrowUp", { altKey: true, shiftKey: true });
  expect(group("c").panels).toEqual(["lighting", "quality", "motion"]);
  press("quality", "ArrowRight");
  expect(group("c").active).toBe("motion");
  // On an expanded group's horizontal bar, Down moves into the panel and never switches the tab.
  const bar = await mount(tree(true, true, false));
  expect(bar.root.querySelector('[data-group="c"]')!.querySelector('[role="tablist"]')!.getAttribute("aria-orientation")).toBeNull();
  bar.root.querySelector('[data-panel="lighting"]')!.dispatchEvent(lightEvent("keydown", { key: "ArrowDown" }));
  expect(findGroup(bar.view.tree, "c")!.group.active).toBe("lighting");
});

test("the dock's splitters are the library's: a focusable separator whose arrow keys resize and whose Enter shares evenly (UI-121)", async () => {
  const { view, splitters } = await mount(tree(false, false, false));
  const splitter = splitters("s-right")[0]!;
  expect([splitter.getAttribute("role"), splitter.getAttribute("tabindex"), splitter.getAttribute("aria-orientation"), splitter.getAttribute("aria-label"),
    splitter.getAttribute("aria-valuenow")]).toEqual(["separator", "0", "horizontal", "Resize rows", "50"]);
  const sizes = () => { const r = view.tree.root; return r?.kind === "split" && r.children[1]!.kind === "split" ? r.children[1]!.sizes.map(v => Math.round(v * 1000) / 1000) : []; };
  splitter.dispatchEvent(lightEvent("keydown", { key: "ArrowDown" }));
  expect(sizes()).toEqual([.324, .276, .4]);
  // Left and Right don't resize rows.
  splitters("s-right")[0]!.dispatchEvent(lightEvent("keydown", { key: "ArrowRight" }));
  expect(sizes()).toEqual([.324, .276, .4]);
  splitters("s-right")[0]!.dispatchEvent(lightEvent("keydown", { key: "Enter" }));
  expect(sizes()).toEqual([.3, .3, .4]);
});
