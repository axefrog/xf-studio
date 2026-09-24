import { expect, test } from "bun:test";
import { allGroups, applyDrop, closePanel, group, locate, openPanel, panelsIn, parseTree, recoverWindows,
  split, type DockTree } from "../src/studio-ui/dock/layout";
import { compassGuides, edgeGuides, resolveDrop, type DropGeometry } from "../src/studio-ui/dock/snap";
import { defaultCompact, defaultWide, PANEL_IDS } from "../src/studio-ui/layout-defaults";
import { restoreDockPreference, serializeDockState } from "../src/studio-ui/dock/persist";
import { recoverDockLayout } from "../src/ui-preferences";

const area = { x: 0, y: 0, w: 1600, h: 900 };
const everyPanelOnce = (tree: DockTree) => {
  const panels = panelsIn(tree);
  expect(new Set(panels).size).toBe(panels.length);
  expect([...panels].sort()).toEqual([...PANEL_IDS].sort());
};

test("default layouts contain every panel exactly once in both size classes", () => {
  everyPanelOnce(defaultWide());
  everyPanelOnce(defaultCompact());
});

test("panels move between tab groups, split beside groups and dock at workspace edges", () => {
  let tree = defaultWide();
  tree = applyDrop(tree, { kind: "panel", panelId: "motion" }, { kind: "tab", groupId: "g-layers", index: 0 });
  expect(locate(tree, "motion")!.group).toMatchObject({ id: "g-layers", panels: ["motion", "layers"], active: "motion" });
  tree = applyDrop(tree, { kind: "panel", panelId: "quality" }, { kind: "split", groupId: "g-head", side: "right" });
  const root = tree.root!, stage = root.kind === "split" ? root.children[1] : undefined;
  expect(stage?.kind === "split" && stage.children[0].kind === "split" && stage.children[0].axis).toBe("row");
  tree = applyDrop(tree, { kind: "panel", panelId: "activity" }, { kind: "edge", side: "bottom" });
  const after = tree.root!;
  expect(after.kind === "split" && after.axis).toBe("column");
  everyPanelOnce(tree);
});

test("floating panels magnetize into a composite that grows instead of squeezing", () => {
  let tree = applyDrop(defaultWide(), { kind: "panel", panelId: "lighting" }, { kind: "float", x: 300, y: 200 },
    { x: 0, y: 0, w: 320, h: 400 });
  const window = tree.floating[0];
  expect(window).toMatchObject({ x: 300, y: 200, w: 320, h: 400 });
  const lightingGroup = locate(tree, "lighting")!.group.id;
  tree = applyDrop(tree, { kind: "panel", panelId: "motion" }, { kind: "split", groupId: lightingGroup, side: "right" },
    { x: 0, y: 0, w: 280, h: 300 });
  expect(tree.floating).toHaveLength(1);
  expect(tree.floating[0]).toMatchObject({ x: 300, w: 600 });
  expect(tree.floating[0].node.kind === "split" && tree.floating[0].node.axis).toBe("row");
  // Moving the whole composite into a docked group merges its panels as tabs.
  tree = applyDrop(tree, { kind: "window", windowId: tree.floating[0].id }, { kind: "tab", groupId: "g-layers", index: 1 });
  expect(tree.floating).toHaveLength(0);
  expect(locate(tree, "lighting")!.group.panels).toEqual(["layers", "lighting", "motion"]);
  everyPanelOnce(tree);
});

test("closing and reopening restores a panel beside its siblings", () => {
  let tree = closePanel(defaultWide(), "warp");
  expect(tree.closed).toEqual(["activity", "warp"]);
  expect(locate(tree, "warp")).toBeUndefined();
  tree = openPanel(tree, "warp", ["shape", "edge"], area);
  expect(locate(tree, "warp")!.group.id).toBe("g-inspect");
  everyPanelOnce(tree);
});

test("recovery keeps off-screen floating windows reachable", () => {
  let tree = applyDrop(defaultWide(), { kind: "panel", panelId: "quality" }, { kind: "float", x: 9000, y: -400, w: 5000, h: 40 });
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
  const parsed = parseTree(JSON.parse(JSON.stringify(tampered)), PANEL_IDS, defaultWide())!;
  everyPanelOnce(parsed);
  expect(parseTree({ root: { kind: "split", id: "x", axis: "diagonal", children: [], sizes: [] }, floating: [], closed: [] },
    PANEL_IDS, defaultWide())).toBeUndefined();
  expect(parseTree({ root: null, floating: [{ id: "w", x: NaN, y: 0, w: 1, h: 1, node: group(["head"]) }], closed: [] },
    PANEL_IDS, defaultWide())).toBeUndefined();
});

test("persisted preferences pass the engine's recovery gate and round-trip", () => {
  let wide = applyDrop(defaultWide(), { kind: "panel", panelId: "package" }, { kind: "float", x: 4000, y: 4000 });
  const saved = serializeDockState({ wide, compact: defaultCompact() });
  const restored = restoreDockPreference(saved, area);
  expect(restored.recovered).toBe(true);
  expect(restored.state.wide.floating[0].x).toBeLessThan(area.w);
  everyPanelOnce(restored.state.wide);
  expect(recoverDockLayout({ format: "xfs/dock", version: 99, state: {} }, { workAreas: [{ x: 0, y: 0, width: 10, height: 10 }], panelIds: [] })).toBeUndefined();
  const broken = restoreDockPreference({ format: "xfs/dock", version: 1, state: { wide: "nope" } }, area);
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
  const tree = defaultWide();
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
  let tree = applyDrop(defaultWide(), { kind: "panel", panelId: "motion" }, { kind: "float", x: 700, y: 300 });
  const id = locate(tree, "motion")!.group.id;
  const geometry = geometryFor(tree, { [id]: { x: 700, y: 300, w: 320, h: 300 } }, [id]);
  expect(resolveDrop({ x: 690, y: 450 }, geometry).target).toMatchObject({ kind: "split", groupId: id, side: "left" });
  expect(resolveDrop({ x: 1030, y: 450 }, geometry).target).toMatchObject({ kind: "split", groupId: id, side: "right" });
  expect(resolveDrop({ x: 660, y: 450 }, geometry).target.kind).toBe("float");
});
