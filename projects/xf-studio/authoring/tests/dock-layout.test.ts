import { expect, test } from "bun:test";
import { allCollapsed, allGroups, applyDrop, closePanel, foldAxes, group, lastExpandedDocked, locate, openPanel, panelsIn, parseTree, recoverWindows,
  isStripStack, keepDockExpanded, parkPanels, revealPanel, setCollapsed, setMaximized, split, splitShares, splitterPair, unparkPanels, type DockNode, type DockTree, type Rect, type SplitNode } from "../src/studio-ui/dock/layout";
import { compassGuides, edgeGuides, resolveDrop, type DropGeometry } from "../src/studio-ui/dock/snap";
import { defaultCompact, defaultWide } from "../src/studio-ui/layout-defaults";
import { PANEL_IDS, STUDIO_CATALOGUE } from "../src/compose/views";
import { restoreDockPreference, serializeDockState } from "../src/studio-ui/dock/persist";
import { recoverDockLayout } from "../src/ui-preferences";

const area = { x: 0, y: 0, w: 1600, h: 900 };
const everyPanelOnce = (tree: DockTree) => {
  const panels = panelsIn(tree);
  expect(new Set(panels).size).toBe(panels.length);
  expect([...panels].sort()).toEqual([...PANEL_IDS].sort());
};

test("default layouts contain every panel exactly once in both size classes", () => {
  everyPanelOnce(defaultWide(STUDIO_CATALOGUE));
  everyPanelOnce(defaultCompact(STUDIO_CATALOGUE));
});

/** Group rectangles from split fractions alone (splitters and borders ignored). */
function groupRects(node: DockNode, rect: Rect, out = new Map<string, Rect>()) {
  if (node.kind === "group") return out.set(node.id, rect);
  let offset = 0;
  node.children.forEach((child, i) => {
    const share = node.sizes[i];
    groupRects(child, node.axis === "row" ? { x: rect.x + offset * rect.w, y: rect.y, w: share * rect.w, h: rect.h }
      : { x: rect.x, y: rect.y + offset * rect.h, w: rect.w, h: share * rect.h }, out);
    offset += share;
  });
  return out;
}

test("factory defaults give the portrait head a portrait viewport beside a visible UV map", () => {
  // Dock areas measured in Chrome for 1100×800, 1366×768, 1600×1000 and 1920×1080 (wide) and
  // 900×900 and 640×900 (compact). The tab bar is 34 px; the UV panel's toolbar, hint and
  // padding take about 115 px of height and 20 px of width around its 720:310 both-eyes canvas.
  const cases = [...[[1092, 722], [1358, 690], [1592, 922], [1912, 1002]].map(size => ({ tree: defaultWide(STUDIO_CATALOGUE), size, wide: true })),
    ...[[892, 822], [632, 822]].map(size => ({ tree: defaultCompact(STUDIO_CATALOGUE), size, wide: false }))];
  for (const { tree, size: [w, h], wide } of cases) {
    const rects = groupRects(tree.root!, { x: 0, y: 0, w, h });
    const head = locate(tree, "head")!, uv = locate(tree, "uv")!, finish = locate(tree, "finish")!;
    // Head and UV map are each the active tab of their own docked group, so both are visible.
    expect([head.group.active, uv.group.active, head.group.id !== uv.group.id]).toEqual(["head", "uv", true]);
    const stage = rects.get(head.group.id)!, aspect = stage.w / (stage.h - 34);
    expect({ size: [w, h], aspect: aspect >= .5 && aspect <= .85 }).toEqual({ size: [w, h], aspect: true });
    const map = rects.get(uv.group.id)!, canvas = Math.min(map.w - 20, (map.h - 115) * 720 / 310);
    expect(canvas).toBeGreaterThanOrEqual(360);
    // The wide head column spans the full height; inspectors stay wide enough for their controls.
    if (wide) expect(stage.h).toBe(h);
    expect(rects.get(finish.group.id)!.w).toBeGreaterThanOrEqual(wide ? 440 : 360);
  }
});

test("panels move between tab groups, split beside groups and dock at workspace edges", () => {
  let tree = defaultWide(STUDIO_CATALOGUE);
  tree = applyDrop(tree, { kind: "panel", panelId: "motion" }, { kind: "tab", groupId: "g-layers", index: 0 });
  expect(locate(tree, "motion")!.group).toMatchObject({ id: "g-layers", panels: ["motion", "layers", "history"], active: "motion" });
  // Beside a group inside a column: a nested row replaces it.
  tree = applyDrop(tree, { kind: "panel", panelId: "quality" }, { kind: "split", groupId: "g-uv", side: "right" });
  const root = tree.root!, right = root.kind === "split" ? root.children[2] : undefined;
  const nested = right?.kind === "split" ? right.children[0] : undefined;
  expect(nested?.kind === "split" && nested.axis).toBe("row");
  expect(nested?.kind === "split" && nested.children.map(child => child.id)[0]).toBe("g-uv");
  expect(locate(tree, "quality")!.group.panels).toEqual(["quality"]);
  // Beside a group whose parent already splits on that axis: a sibling in the same split.
  tree = applyDrop(tree, { kind: "panel", panelId: "character" }, { kind: "split", groupId: "g-head", side: "right" });
  const row = tree.root!;
  expect(row.kind === "split" && row.children.map(child => child.id).indexOf("g-head")).toBe(1);
  expect(row.kind === "split" && row.children[2].kind === "group" && row.children[2].panels).toEqual(["character"]);
  tree = applyDrop(tree, { kind: "panel", panelId: "activity" }, { kind: "edge", side: "bottom" });
  const after = tree.root!;
  expect(after.kind === "split" && after.axis).toBe("column");
  everyPanelOnce(tree);
});

test("floating panels magnetize into a composite that grows instead of squeezing", () => {
  let tree = applyDrop(defaultWide(STUDIO_CATALOGUE), { kind: "panel", panelId: "lighting" }, { kind: "float", x: 300, y: 200 },
    { x: 0, y: 0, w: 320, h: 400 });
  const window = tree.floating[0];
  expect(window).toMatchObject({ x: 300, y: 200, w: 320, h: 400 });
  const lightingGroup = locate(tree, "lighting")!.group.id;
  tree = applyDrop(tree, { kind: "panel", panelId: "motion" }, { kind: "split", groupId: lightingGroup, side: "right" },
    { x: 0, y: 0, w: 280, h: 300 });
  expect(tree.floating).toHaveLength(1);
  expect(tree.floating[0]).toMatchObject({ x: 300, w: 600 });
  expect(tree.floating[0].node.kind === "split" && tree.floating[0].node.axis).toBe("row");
  // A member leaving the composite gives its share back instead of stretching the rest.
  const shrunk = applyDrop(tree, { kind: "panel", panelId: "motion" }, { kind: "tab", groupId: "g-layers", index: 1 });
  expect(shrunk.floating[0].node.kind).toBe("group");
  expect(shrunk.floating[0].w).toBe(320);
  // Moving the whole composite into a docked group merges its panels as tabs.
  tree = applyDrop(tree, { kind: "window", windowId: tree.floating[0].id }, { kind: "tab", groupId: "g-layers", index: 1 });
  expect(tree.floating).toHaveLength(0);
  expect(locate(tree, "lighting")!.group.panels).toEqual(["layers", "lighting", "motion", "history"]);
  everyPanelOnce(tree);
});

test("closing and reopening restores a panel beside its siblings", () => {
  let tree = closePanel(defaultWide(STUDIO_CATALOGUE), "warp");
  expect(tree.closed).toEqual(["activity", "help", "warp"]);
  expect(locate(tree, "warp")).toBeUndefined();
  tree = openPanel(tree, "warp", ["shape", "edge"], area);
  expect(locate(tree, "warp")!.group.id).toBe("g-inspect");
  everyPanelOnce(tree);
});

test("recovery keeps off-screen floating windows reachable", () => {
  let tree = applyDrop(defaultWide(STUDIO_CATALOGUE), { kind: "panel", panelId: "quality" }, { kind: "float", x: 9000, y: -400, w: 5000, h: 40 });
  tree = recoverWindows(tree, area);
  const window = tree.floating[0];
  expect(window.w).toBeLessThanOrEqual(area.w);
  expect(window.h).toBeGreaterThanOrEqual(160);
  expect(window.x).toBeLessThanOrEqual(area.w - 88);
  expect(window.y).toBeGreaterThanOrEqual(0);
});

test("parser drops unknown/duplicate panels, rejects malformed trees and re-adds missing panels", () => {
  const tampered = { root: split("row", [group(["layers", "ghost"], "layers", "g-a"), group(["layers", "head"], "head", "g-b")]),
    floating: [], closed: ["ghost"] };
  const parsed = parseTree(JSON.parse(JSON.stringify(tampered)), PANEL_IDS, defaultWide(STUDIO_CATALOGUE))!;
  everyPanelOnce(parsed);
  expect(parseTree({ root: { kind: "split", id: "x", axis: "diagonal", children: [], sizes: [] }, floating: [], closed: [] },
    PANEL_IDS, defaultWide(STUDIO_CATALOGUE))).toBeUndefined();
  expect(parseTree({ root: null, floating: [{ id: "w", x: NaN, y: 0, w: 1, h: 1, node: group(["head"]) }], closed: [] },
    PANEL_IDS, defaultWide(STUDIO_CATALOGUE))).toBeUndefined();
});

test("a layout saved with the previous factory arrangement restores exactly, not as the new default", () => {
  // The pre-portrait defaults (head over UV map in a landscape stage column; one compact stage group).
  const wide: DockTree = { floating: [], root: split("row", [
    split("column", [group(["presets", "library", "package"], "presets", "g-collection"), group(["layers"], "layers", "g-layers")], [.4, .6], "s-left"),
    split("column", [group(["head"], "head", "g-head"), group(["uv"], "uv", "g-uv")], [.62, .38], "s-stage"),
    split("column", [group(["finish"], "finish", "g-finish"), group(["shape", "edge", "warp"], "shape", "g-inspect"),
      group(["character", "lighting", "motion", "quality"], "character", "g-preview")], [.37, .35, .28], "s-right"),
  ], [.2, .54, .26], "s-root"), closed: ["activity"] };
  const compact: DockTree = { floating: [], root: split("column", [group(["head", "uv"], "head", "g-stage"),
    split("row", [group(["layers", "presets", "library", "package"], "layers", "g-stack"),
      group(["finish", "shape", "edge", "warp", "character", "lighting", "motion", "quality"], "finish", "g-inspect")], [.42, .58], "s-lower")],
  [.5, .5], "s-root"), closed: ["activity"] };
  const saved = JSON.parse(JSON.stringify(serializeDockState({ wide, compact })));
  const restored = restoreDockPreference(saved, area, STUDIO_CATALOGUE);
  expect(restored.recovered).toBe(true);
  // Panels added since (History) join beside their default siblings as background tabs; nothing else moves.
  const expected = structuredClone(saved.state) as { wide: DockTree; compact: DockTree };
  locate(expected.wide, "layers")!.group.panels.push("history");
  locate(expected.compact, "layers")!.group.panels.push("history");
  // A module's panel (the Save Explorer's, restored here as if its module were shown) joins beside the UV map the same way.
  locate(expected.wide, "uv")!.group.panels.push("save-explorer.explorer");
  locate(expected.compact, "uv")!.group.panels.push("save-explorer.explorer");
  // The Expressions panel (a module hidden by default, which the shell parks) joins its default group too.
  locate(expected.wide, "finish")!.group.panels.push("expressions.controls");
  locate(expected.compact, "finish")!.group.panels.push("expressions.controls");
  // Panels closed by default (Help) stay closed until someone opens them.
  expected.wide.closed.push("help"); expected.compact.closed.push("help");
  expect(restored.state).toEqual(expected);
  expect(locate(restored.state.wide, "history")!.group.active).toBe("layers");
});

test("persisted preferences pass the engine's recovery gate and round-trip", () => {
  let wide = applyDrop(defaultWide(STUDIO_CATALOGUE), { kind: "panel", panelId: "package" }, { kind: "float", x: 4000, y: 4000 });
  const saved = serializeDockState({ wide, compact: defaultCompact(STUDIO_CATALOGUE) });
  const restored = restoreDockPreference(saved, area, STUDIO_CATALOGUE);
  expect(restored.recovered).toBe(true);
  expect(restored.state.wide.floating[0].x).toBeLessThan(area.w);
  everyPanelOnce(restored.state.wide);
  expect(recoverDockLayout({ format: "xfs/dock", version: 99, state: {} }, { workAreas: [{ x: 0, y: 0, width: 10, height: 10 }], panelIds: [] })).toBeUndefined();
  const broken = restoreDockPreference({ format: "xfs/dock", version: 1, state: { wide: "nope" } }, area, STUDIO_CATALOGUE);
  expect(broken.recovered).toBe(false);
  everyPanelOnce(broken.state.wide);
});

function geometryFor(tree: DockTree, rects: Record<string, { x: number; y: number; w: number; h: number }>,
  floatingIds: string[] = []): DropGeometry {
  return { workspace: area, groups: allGroups(tree).filter(entry => rects[entry.group.id]).map(entry => ({
    id: entry.group.id, floating: floatingIds.includes(entry.group.id), rect: rects[entry.group.id],
    tabStrip: { ...rects[entry.group.id], h: 30 }, tabs: entry.group.panels.map((_, i) => ({ x: rects[entry.group.id].x + i * 90, y: rects[entry.group.id].y, w: 90, h: 30 })),
  })) };
}

test("snapping uses cursor position only: large overlapping panels do not snap until the cursor reaches a guide", () => {
  const tree = defaultWide(STUDIO_CATALOGUE);
  const geometry = geometryFor(tree, { "g-head": { x: 320, y: 0, w: 860, h: 560 }, "g-layers": { x: 0, y: 360, w: 320, h: 540 } });
  // A dragged 900×700 panel held near its corner would overlap g-head almost entirely, but the
  // cursor is in g-layers' body away from its compass: nothing snaps.
  const cursor = { x: 30, y: 870 };
  expect(resolveDrop(cursor, geometry).target.kind).toBe("float");
  // The same panel's cursor on g-head's centre guide stacks it as a tab there.
  const centre = compassGuides(geometry.groups.find(item => item.id === "g-head")!)[0].rect;
  expect(resolveDrop({ x: centre.x + 5, y: centre.y + 5 }, geometry).target).toMatchObject({ kind: "tab", groupId: "g-head" });
  // Tab strip insertion index is chosen from the cursor x.
  expect(resolveDrop({ x: 330, y: 10 }, geometry).target).toMatchObject({ kind: "tab", groupId: "g-head", index: 0 });
  // Edge guides dock to the workspace edge.
  const left = edgeGuides(area)[0].rect;
  expect(resolveDrop({ x: left.x + 3, y: left.y + 3 }, geometry).target).toMatchObject({ kind: "edge", side: "left" });
  // Holding the suppress modifier always floats.
  expect(resolveDrop({ x: centre.x + 5, y: centre.y + 5 }, geometry, { suppress: true }).target.kind).toBe("float");
});

test("floating windows magnetize only when the cursor enters their edge band", () => {
  let tree = applyDrop(defaultWide(STUDIO_CATALOGUE), { kind: "panel", panelId: "motion" }, { kind: "float", x: 700, y: 300 });
  const id = locate(tree, "motion")!.group.id;
  const geometry = geometryFor(tree, { [id]: { x: 700, y: 300, w: 320, h: 300 } }, [id]);
  expect(resolveDrop({ x: 690, y: 450 }, geometry).target).toMatchObject({ kind: "split", groupId: id, side: "left" });
  expect(resolveDrop({ x: 1030, y: 450 }, geometry).target).toMatchObject({ kind: "split", groupId: id, side: "right" });
  expect(resolveDrop({ x: 660, y: 450 }, geometry).target.kind).toBe("float");
});

test("maximize applies only to docked groups; showing a docked panel elsewhere leaves maximize mode", async () => {
  const { setMaximized, showPanelDocked } = await import("../src/studio-ui/dock/layout");
  let tree = applyDrop(defaultWide(STUDIO_CATALOGUE), { kind: "panel", panelId: "motion" }, { kind: "float", x: 200, y: 200 });
  const floatingGroup = locate(tree, "motion")!.group.id;
  expect(setMaximized(tree, floatingGroup).maximized).toBeUndefined();
  tree = setMaximized(tree, "g-head");
  expect(tree.maximized).toBe("g-head");
  expect(showPanelDocked(tree, "motion").maximized).toBe("g-head");
  expect(showPanelDocked(tree, "head").maximized).toBe("g-head");
  expect(showPanelDocked(tree, "layers").maximized).toBeUndefined();
});

test("composites keep member pixels when growing and when a nested split collapses", () => {
  let tree = applyDrop(defaultWide(STUDIO_CATALOGUE), { kind: "panel", panelId: "lighting" }, { kind: "float", x: 400, y: 200, w: 300, h: 300 });
  const a = locate(tree, "lighting")!.group.id;
  tree = applyDrop(tree, { kind: "panel", panelId: "motion" }, { kind: "split", groupId: a, side: "right" }, { x: 0, y: 0, w: 300, h: 300 });
  const b = locate(tree, "motion")!.group.id;
  // Third member on the same axis: every existing member keeps 300 px.
  tree = applyDrop(tree, { kind: "panel", panelId: "quality" }, { kind: "split", groupId: b, side: "right" }, { x: 0, y: 0, w: 300, h: 300 });
  const window = tree.floating[0];
  expect(window.w).toBe(900);
  expect(window.node.kind === "split" && window.node.sizes.map(size => Math.round(size * window.w))).toEqual([300, 300, 300]);
  // Nested: attach below Motion, then remove that nested member; the window keeps its width.
  tree = applyDrop(tree, { kind: "panel", panelId: "activity" }, { kind: "split", groupId: b, side: "bottom" }, { x: 0, y: 0, w: 300, h: 200 });
  const before = tree.floating[0].w;
  tree = applyDrop(tree, { kind: "panel", panelId: "activity" }, { kind: "tab", groupId: "g-layers", index: 1 });
  expect(tree.floating[0].w).toBe(before);
  panelsIn(tree);
});

// ----- Collapsed groups: the folding rule (view-graph-design.md §4.4) -----
const fold = (id: string, panels: string[], collapsed = false) => ({ ...group(panels, panels[0], id), ...(collapsed ? { collapsed: true } : {}) });

test("a collapsed group folds along its split's axis and the expanded groups in that split share all of its space", () => {
  // The right-hand column of the maintainer's screenshot: three stacked groups, the first two collapsed.
  const column = split("column", [fold("a", ["finish", "shape"], true), fold("b", ["pigment", "warp"], true), fold("c", ["lighting", "motion", "quality"])],
    [.3, .3, .4], "s-col");
  const folds = foldAxes(column);
  expect([...folds]).toEqual([["a", "column"], ["b", "column"]]);
  const { folded, shares } = splitShares(column, folds);
  expect(folded).toEqual([true, true, false]);
  // The expanded group's flex-grow is the whole split, never its stored 0.4 (which left 60% of the column empty).
  expect(shares).toEqual([0, 0, 1]);
  // The stored sizes are untouched, so expanding a group restores the shares it had before collapsing.
  expect(column.sizes).toEqual([.3, .3, .4]);
  const reopened = splitShares({ ...column, children: [fold("a", ["finish", "shape"]), column.children[1], column.children[2]] }, foldAxes(
    { ...column, children: [fold("a", ["finish", "shape"]), column.children[1], column.children[2]] }));
  expect(reopened.shares.map(share => +share.toFixed(4))).toEqual([.4286, 0, .5714]);
});

test("one rule for every column: a single group or a whole stack collapsed in a row becomes a vertical strip", () => {
  const single = split("row", [fold("stage", ["head"]), fold("inspect", ["finish"], true)], [.6, .4], "s-root");
  expect(foldAxes(single).get("inspect")).toBe("row");
  expect(splitShares(single, foldAxes(single)).shares).toEqual([1, 0]);
  // The same column with several stacked groups, all collapsed: the column folds as one along the row, and its groups become
  // vertical strips sharing the column's height by their stored sizes.
  const stack = split("column", [fold("a", ["finish"], true), fold("b", ["pigment"], true), fold("c", ["lighting"], true)], [.2, .3, .5], "s-right");
  const root = split("row", [fold("stage", ["head"]), stack], [.6, .4], "s-root");
  const folds = foldAxes(root);
  expect(allCollapsed(stack)).toBe(true);
  expect(folds.get("s-right")).toBe("row");
  expect(["a", "b", "c"].map(id => folds.get(id))).toEqual(["row", "row", "row"]);
  expect(splitShares(root, folds)).toEqual({ folded: [false, true], shares: [1, 0] });
  // Inside the strip nothing folds along the column; it is a stack of strips, each as long as its tabs need (the stored shares
  // wait for a group to expand).
  expect(splitShares(stack, folds).folded).toEqual([false, false, false]);
  expect(isStripStack(stack, folds)).toBe(true);
  expect(isStripStack(root, folds)).toBe(false);
  expect(stack.sizes).toEqual([.2, .3, .5]);
});

test("nested splits: a fully collapsed inner split gives its space to its neighbours along the outer axis", () => {
  // A column whose top half is a row of two groups: both collapsed, the row is one full-width header row of two segments.
  const top = split("row", [fold("a", ["finish"], true), fold("b", ["shape"], true)], [.5, .5], "s-top");
  const column = split("column", [top, fold("c", ["lighting"])], [.5, .5], "s-col");
  const folds = foldAxes(column);
  expect(folds.get("s-top")).toBe("column");
  expect(folds.get("a")).toBe("column");
  expect(splitShares(column, folds)).toEqual({ folded: [true, false], shares: [0, 1] });
  // A row of header rows shares the column's width by the stored sizes (it is not a stack of strips).
  expect(splitShares(top, folds)).toEqual({ folded: [false, false], shares: [.5, .5] });
  expect(isStripStack(top, folds)).toBe(false);
  // With one of them expanded again, only the collapsed one folds, along the inner row: a vertical strip beside it.
  const partly = { ...column, children: [{ ...top, children: [fold("a", ["finish"], true), fold("b", ["shape"])] }, column.children[1]] } as SplitNode;
  const partial = foldAxes(partly);
  expect(partial.get("s-top")).toBeUndefined();
  expect(partial.get("a")).toBe("row");
  expect(splitShares(partly, partial).folded).toEqual([false, false]);
});

test("floating windows: a composite whose groups all collapse shrinks to its header rows, and partial collapse fills the window", () => {
  const rowComposite = split("row", [fold("a", ["finish"], true), fold("b", ["shape"], true)], [.5, .5], "s-w");
  const folds = foldAxes(rowComposite);
  expect(folds.get("s-w")).toBe("column");
  expect(splitShares(rowComposite, folds).shares).toEqual([.5, .5]);
  const columnComposite = split("column", [fold("a", ["finish"], true), fold("b", ["shape"])], [.7, .3], "s-w");
  expect(splitShares(columnComposite, foldAxes(columnComposite)).shares).toEqual([0, 1]);
  expect(foldAxes(fold("lone", ["finish"], true)).get("lone")).toBe("column");
  expect(foldAxes(null).size).toBe(0);
});

test("a splitter resizes the nearest unfolded cells on each side, and is inert beside a folded edge", () => {
  expect(splitterPair([true, true, false], 1)).toBeUndefined();
  expect(splitterPair([true, true, false], 2)).toBeUndefined();
  expect(splitterPair([false, true, false], 1)).toEqual([0, 2]);
  expect(splitterPair([false, true, false], 2)).toEqual([0, 2]);
  expect(splitterPair([false, false, true], 1)).toEqual([0, 1]);
  expect(splitterPair([false, false, true], 2)).toBeUndefined();
  expect(splitterPair([false, false], 1)).toEqual([0, 1]);
});

test("the last expanded docked group can't collapse (nothing would take its space); floating ones always can", () => {
  const tree: DockTree = { root: split("column", [fold("a", ["finish"], true), fold("b", ["shape"])], [.5, .5], "s"), floating: [
    { id: "w", x: 0, y: 0, w: 300, h: 300, node: fold("f", ["lighting"]) }], closed: [] };
  expect(lastExpandedDocked(tree, "b")).toBe(true);
  expect(lastExpandedDocked(tree, "a")).toBe(false);
  expect(lastExpandedDocked(tree, "f")).toBe(false);
  expect(lastExpandedDocked({ ...tree, root: split("column", [fold("a", ["finish"]), fold("b", ["shape"])], [.5, .5], "s") }, "b")).toBe(false);
});

test("a saved layout with collapsed groups in nested splits and windows still loads unchanged", () => {
  const factory = defaultWide(STUDIO_CATALOGUE);
  // Collapse both groups of the right-hand column (the UV map and the inspectors): the whole column folds to a vertical strip.
  const right = allGroups(factory).map(entry => entry.group.id).filter(id => id === "g-uv" || id === "g-inspect");
  expect(right).toEqual(["g-uv", "g-inspect"]);
  const tree = right.reduce((next, id) => setCollapsed(next, id, true), factory);
  const saved = serializeDockState({ wide: tree, compact: defaultCompact(STUDIO_CATALOGUE) });
  const restored = restoreDockPreference(JSON.parse(JSON.stringify(saved)), area, STUDIO_CATALOGUE);
  expect(restored.recovered).toBe(true);
  expect(restored.state.wide).toEqual(tree);
  expect(foldAxes(restored.state.wide.root).get("s-right")).toBe("row");
});

test("maximizing a collapsed group expands it, and revealing a panel expands its group (UI-103, UI-105)", () => {
  const tree: DockTree = { root: split("column", [fold("a", ["finish", "shape"], true), fold("b", ["lighting"])], [.5, .5], "s"), floating: [], closed: [] };
  const maximized = setMaximized(tree, "a");
  expect(maximized.maximized).toBe("a");
  expect(locate(maximized, "finish")!.group.collapsed).toBeUndefined();
  const revealed = revealPanel(tree, "shape");
  expect(locate(revealed, "shape")!.group).toEqual({ ...fold("a", ["finish", "shape"]), active: "shape" });
  expect(revealPanel(revealed, "lighting")).toEqual(revealed);
});

test("never a blank dock: with every docked group collapsed, the one with the largest share expands (UI-105)", () => {
  const stack = split("column", [fold("a", ["finish"], true), fold("b", ["pigment"], true)], [.3, .7], "s-right");
  const tree: DockTree = { root: split("row", [fold("stage", ["head"], true), stack], [.55, .45], "s-root"), floating: [], closed: [] };
  const kept = keepDockExpanded(tree);
  expect([...allGroups(kept)].map(entry => [entry.group.id, !!entry.group.collapsed])).toEqual([["stage", false], ["a", true], ["b", true]]);
  const leaning: DockTree = { ...tree, root: { ...tree.root as SplitNode, sizes: [.2, .8] } };
  expect([...allGroups(keepDockExpanded(leaning))].filter(entry => !entry.group.collapsed).map(entry => entry.group.id)).toEqual(["b"]);
  const open: DockTree = { ...tree, root: split("row", [fold("stage", ["head"]), stack], [.5, .5], "s-root") };
  expect(keepDockExpanded(open)).toBe(open);
});

test("a parked group comes back at its share of a three-way split, and a floating one comes back collapsed (UI-104)", () => {
  const tree: DockTree = { root: split("column", [fold("a", ["finish"]), fold("b", ["pigment"]), fold("c", ["lighting"], true)], [.3, .3, .4], "s"),
    floating: [{ id: "w", x: 40, y: 40, w: 300, h: 400, node: fold("f", ["quality"], true) }], closed: [] };
  const parked = parkPanels(tree, ["lighting", "quality"]);
  expect(parked.root?.kind === "split" ? parked.root.sizes : []).toEqual([.5, .5]);
  const back = unparkPanels(parked, ["lighting", "quality"], tree, area);
  expect(back.root?.kind === "split" ? back.root.sizes.map(size => +size.toFixed(6)) : []).toEqual([.3, .3, .4]);
  expect(locate(back, "lighting")!.group.collapsed).toBe(true);
  expect(locate(back, "quality")!.group.collapsed).toBe(true);
  expect(back.floating.map(window => [window.x, window.y, window.w, window.h])).toEqual([[40, 40, 300, 400]]);
});
