import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { installLightDom, uninstallLightDom, lightEvent, type LightElement } from "./light-dom";
import type { TreeItemRef, TreeNodeData } from "../src/studio-ui/components/tree-view";

beforeAll(installLightDom);
afterAll(uninstallLightDom);
beforeEach(() => { document.body.replaceChildren(); });
const dispatch = (el: HTMLElement, type: string, extra = {}) => (el as unknown as LightElement).dispatchEvent(lightEvent(type, extra));
const focused = () => document.activeElement?.getAttribute("data-id");

async function fixture(nodes: readonly TreeNodeData[], open: string[] = [], initial?: string) {
  const { TreeView } = await import("../src/studio-ui/components/tree-view");
  const expanded = new Set(open), activated: string[] = [], toggled: string[] = [];
  const hovered: (TreeItemRef | null)[] = [], focusedItems: TreeItemRef[] = [], controller = new AbortController();
  let selected = initial;
  const tree: InstanceType<typeof TreeView> = new TreeView({ label: "Nested test", remember: false, signal: controller.signal,
    onActivate: id => { activated.push(id); selected = id; paint(); },
    onToggle: (id, value) => { toggled.push(`${id}:${value}`); if (value) expanded.add(id); else expanded.delete(id); paint(); },
    onHover: item => hovered.push(item), onFocus: item => focusedItems.push(item) });
  const paint = () => tree.update({ nodes, expanded, selected });
  document.body.append(tree.element); paint();
  const item = (id: string) => tree.element.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
  const key = (value: string) => dispatch(tree.element, "keydown", { key: value });
  const ids = () => [...tree.element.querySelectorAll<HTMLElement>(".tree-item")]
    .sort((a, b) => parseFloat(a.style.transform.slice(11)) - parseFloat(b.style.transform.slice(11))).map(el => el.dataset.id);
  return { tree, expanded, activated, toggled, hovered, focusedItems, controller, paint, item, key, ids };
}

test("four levels, lazy providers, explicit siblings and owned groups; collapsed data is never traversed", async () => {
  let calls = 0;
  const f = await fixture([{ id: "root", label: "Root", children: () => { calls++; return [
    { id: "branch", label: "Branch", children: [{ id: "inner", label: "Inner", children: [{ id: "leaf", label: "Leaf" }] }] },
    { id: "sibling", label: "Sibling" },
  ]; } }]);
  expect(calls).toBe(0); expect(f.ids()).toEqual(["root"]);
  f.key("ArrowRight"); expect(calls).toBe(1);
  f.expanded.add("branch"); f.expanded.add("inner"); f.paint();
  expect(calls).toBe(2);
  expect(f.ids()).toEqual(["root", "branch", "inner", "leaf", "sibling"]);
  expect(["root", "branch", "inner", "leaf"].map(id => f.item(id).getAttribute("aria-level"))).toEqual(["1", "2", "3", "4"]);
  expect([f.item("sibling").getAttribute("aria-setsize"), f.item("sibling").getAttribute("aria-posinset")]).toEqual(["2", "2"]);
  expect(f.item("leaf").hasAttribute("aria-expanded")).toBe(false);
  const groups = [...f.tree.element.querySelectorAll<HTMLElement>('[role="group"]')];
  expect(groups).toHaveLength(3);
  expect(groups.find(g => g.id === f.item("branch").getAttribute("aria-owns"))!.getAttribute("aria-owns")).toBe(f.item("inner").id);
  f.expanded.clear(); f.paint(); expect(calls).toBe(2);
  expect(f.ids()).toEqual(["root"]); expect(f.tree.element.querySelectorAll('[role="group"]')).toHaveLength(0);
});

test("arrows, Home/End and wrapping type-ahead move focus without selection; Enter/Space select", async () => {
  const f = await fixture([{ id: "a", label: "Alpha", children: [{ id: "b", label: "Beta", children: [{ id: "c", label: "Charlie" }] }] },
    { id: "d", label: "Delta" }], ["a", "b"], "c");
  f.tree.focusItem("a"); f.key("ArrowRight"); expect(focused()).toBe("b");
  f.key("ArrowRight"); expect(focused()).toBe("c");
  f.key("ArrowLeft"); expect(focused()).toBe("b");
  f.key("ArrowLeft"); expect(f.item("b").getAttribute("aria-expanded")).toBe("false");
  f.key("ArrowLeft"); expect(focused()).toBe("a");
  f.key("End"); expect(focused()).toBe("d");
  f.key("Home"); expect(focused()).toBe("a");
  f.key("ArrowDown"); expect(focused()).toBe("b");
  f.key("ArrowUp"); expect(focused()).toBe("a");
  f.key("d"); expect(focused()).toBe("d");
  f.key("a"); expect(focused()).toBe("a");
  expect(f.activated).toEqual([]);
  f.key("Enter"); expect(f.activated).toEqual(["a"]);
  expect(f.item("a").getAttribute("aria-selected")).toBe("true");
  f.key("End"); f.key(" "); expect(f.activated).toEqual(["a", "d"]);
  expect(f.tree.element.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
});

test("label selects a branch; chevron only discloses; nonselectable branches disclose; disabled leaves remain focusable", async () => {
  const f = await fixture([{ id: "a", label: "Alpha", children: [{ id: "b", label: "Beta", disabled: true, reason: "Choose a source." }] },
    { id: "group", label: "Group", selectable: false, children: [{ id: "c", label: "Charlie" }] }]);
  f.item("a").querySelector<HTMLElement>(".tree-label")!.click();
  expect(f.activated).toEqual(["a"]); expect(f.toggled).toEqual([]);
  f.item("a").querySelector<HTMLElement>(".tree-chevron")!.click();
  expect(f.toggled).toEqual(["a:true"]); expect(f.activated).toEqual(["a"]);
  f.item("b").click(); expect(focused()).toBe("b");
  f.key("Enter"); f.key(" "); expect(f.activated).toEqual(["a"]);
  expect(f.item("b").getAttribute("aria-description")).toBe("Choose a source.");
  f.item("group").click(); expect(f.toggled.at(-1)).toBe("group:true");
  expect(f.item("group").hasAttribute("aria-selected")).toBe(false);
});

test("collapse returns descendant focus to its nearest surviving ancestor without changing selection", async () => {
  const f = await fixture([{ id: "a", label: "A", children: [{ id: "b", label: "B", children: [{ id: "c", label: "C" }] }] }], ["a", "b"], "c");
  f.tree.focus(); expect(focused()).toBe("c");
  f.expanded.delete("b"); f.paint(); expect(focused()).toBe("b");
  f.expanded.delete("a"); f.paint(); expect(focused()).toBe("a");
  f.expanded.add("a"); f.expanded.add("b"); f.paint();
  expect(f.item("c").getAttribute("aria-selected")).toBe("true"); expect(f.activated).toEqual([]);
});

test("hover deduplicates movements within a row, clears on leave/collapse/abort, and focus is independent", async () => {
  const f = await fixture([{ id: "a", label: "A", children: [{ id: "b", label: "B" }] }], ["a"]);
  dispatch(f.item("b"), "pointerover");
  dispatch(f.item("b").querySelector<HTMLElement>(".tree-label")!, "pointerover");
  expect(f.hovered.map(v => v?.id ?? null)).toEqual(["b"]);
  dispatch(f.item("b"), "pointerout", { relatedTarget: f.item("a") });
  dispatch(f.item("a"), "pointerover"); expect(f.hovered.map(v => v?.id ?? null)).toEqual(["b", "a"]);
  dispatch(f.item("a"), "pointerout", { relatedTarget: null }); expect(f.hovered.at(-1)).toBe(null);
  f.tree.focusItem("b"); f.paint(); expect(f.focusedItems.map(v => v.id)).toEqual(["b"]);
  expect(f.focusedItems[0]).toEqual({ kind: "node", id: "b", group: "a", parent: "a" });
  dispatch(f.item("b"), "pointerover"); f.expanded.clear(); f.paint(); expect(f.hovered.at(-1)).toBe(null);
  dispatch(f.item("a"), "pointerover"); f.controller.abort(); expect(f.hovered.at(-1)).toBe(null);
  f.item("a").click(); f.key("Enter"); expect(f.activated).toEqual([]);
});

test("metadata and swatch supplement the label; unique IDs are required, including across branches", async () => {
  const f = await fixture([{ id: "a", label: "Coverage", secondary: "40 cards", count: 3, swatch: "#aabbcc" }]);
  const el = f.item("a"), swatch = el.querySelector<HTMLElement>(".tree-swatch")!;
  expect(el.getAttribute("aria-label")).toBe("Coverage, 40 cards, 3 items");
  expect(el.title).toBe("Coverage, 40 cards"); expect(swatch.getAttribute("aria-hidden")).toBe("true");
  expect((swatch as unknown as LightElement).style.values.get("--swatch")).toBe("#aabbcc");
  expect(() => f.tree.update({ nodes: [{ id: "a", label: "A" }, { id: "a", label: "Again" }], expanded: new Set() })).toThrow("unique");
});

test("virtualisation bounds rendered rows and retains owned ancestors of offscreen descendants", async () => {
  const f = await fixture([{ id: "root", label: "Root", children: Array.from({ length: 2000 }, (_, i) => ({ id: `n-${i}`, label: `Node ${i}` })) }], ["root"]);
  expect(f.ids().length).toBeLessThan(45);
  dispatch(f.item("n-1"), "pointerover");
  f.tree.focusItem("n-1500"); f.tree.scrollToItem("n-1500");
  expect(f.hovered.at(-1)).toBe(null);
  expect(f.ids().length).toBeLessThan(50); expect(f.item("root")).not.toBeNull();
  expect(f.item("n-1500").getAttribute("aria-setsize")).toBe("2000");
  const group = f.tree.element.querySelector<HTMLElement>('[role="group"]')!;
  expect(group.getAttribute("aria-owns")!.split(" ")).toContain(f.item("n-1500").id);
});

test("grouped input preserves whole-row toggle, one-click activation, empty filtering and trailing/key/menu routes", async () => {
  const { TreeView, favouriteToggle } = await import("../src/studio-ui/components/tree-view");
  const expanded = new Set(["pack"]), activated: string[] = [], keys: string[] = [], menus: string[] = [];
  const tree: InstanceType<typeof TreeView> = new TreeView({ label: "Legacy", remember: false,
    onActivate: id => activated.push(id), onToggle: (id, open) => { if (open) expanded.add(id); else expanded.delete(id); paint(); },
    onKey: (e, item) => { if (e.key === "F2" || e.key === "Delete" || e.key === "f") { keys.push(`${item.kind}:${e.key}`); return true; } },
    onMenu: item => menus.push(item.id), trailing: () => favouriteToggle({ on: false, onToggle: () => {} }) });
  const paint = () => tree.update({ groups: [{ id: "pack", label: "Pack", rows: [{ id: "pose", label: "Pose" }] }, { id: "empty", label: "Empty", rows: [] }], expanded, current: "pose" });
  document.body.append(tree.element); paint();
  const row = () => tree.element.querySelector<HTMLElement>('[data-id="pose"]')!;
  row().querySelector<HTMLElement>("button")!.click(); expect(activated).toEqual([]);
  row().click(); expect(activated).toEqual(["pose"]);
  for (const key of [" ", "F2", "Delete", "f"]) dispatch(tree.element, "keydown", { key });
  expect(activated).toEqual(["pose"]); expect(keys).toEqual(["row:F2", "row:Delete", "row:f"]);
  dispatch(row(), "contextmenu"); expect(menus).toEqual(["pose"]);
  expect(row().getAttribute("aria-current")).toBe("true");
  tree.element.querySelector<HTMLElement>('[data-id="pack"]')!.click();
  expect(tree.element.querySelectorAll(".tree-item")).toHaveLength(1);
  dispatch(tree.element, "keydown", { key: " " }); expect(row()).not.toBeNull();
});
