// The tab strip condenses instead of overflowing its header (UI-111): full labels, then the inactive labels cut short, then icon-only
// tabs (the active one last), then an overflow menu; the active tab always stays in the strip, and every tab is named by its label.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { installLightDom, uninstallLightDom, type LightElement } from "./light-dom";
import { planTabs, type TabItem } from "../src/studio-ui/components/tab-strip";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());

const sizes = { full: [120, 110, 100, 130], truncated: [120, 80, 80, 80], icons: [120, 34, 34, 34] };
const plan = (available: number, active = 0) => planTabs({ available, sizes, active, activeIcon: 34, more: 24 });

test("each stage is tried only when the one before doesn't fit", () => {
  expect(plan(460)).toEqual({ stage: "full", shown: [0, 1, 2, 3], activeIconOnly: false });
  expect(plan(400)).toEqual({ stage: "truncated", shown: [0, 1, 2, 3], activeIconOnly: false });
  expect(plan(222)).toEqual({ stage: "icons", shown: [0, 1, 2, 3], activeIconOnly: false });
  // The active tab drops its label before any tab moves into the menu.
  expect(plan(140)).toEqual({ stage: "icons", shown: [0, 1, 2, 3], activeIconOnly: true });
});

test("overflow keeps the active tab and the others in order while they fit beside the menu button", () => {
  expect(plan(126)).toEqual({ stage: "overflow", shown: [0, 1, 2], activeIconOnly: true });
  // The last tab active: it stays, and the first ones fill the rest in order.
  const last = { full: [110, 100, 130, 120], truncated: [80, 80, 80, 120], icons: [34, 34, 34, 120] };
  expect(planTabs({ available: 126, sizes: last, active: 3, activeIcon: 34, more: 24 })).toEqual({ stage: "overflow", shown: [0, 1, 3], activeIconOnly: true });
  // Even with no room at all the active tab stays.
  expect(plan(10, 2)).toEqual({ stage: "overflow", shown: [2], activeIconOnly: true });
});

const items: TabItem[] = ["Colour & finish", "Shape", "Pigment & edge", "Warp"].map((label, index) =>
  ({ id: `p${index}`, label, icon: "layers", tooltip: `${label} · drag to move`, closable: index === 0 }));

async function strip(onSelect: (id: string) => void = () => {}) {
  const { TabStrip } = await import("../src/studio-ui/components/tab-strip");
  const view = new TabStrip({ label: "Inspector panels", idPrefix: "tab-", controls: "body", onSelect });
  view.update(items, "p0");
  // Stub each tab's length by the strip's stage, as the browser would lay it out.
  const root = view.element as unknown as LightElement;
  for (const [index, tab] of view.tabs.entries()) (tab as unknown as { getBoundingClientRect(): unknown }).getBoundingClientRect = () => {
    const stage = root.dataset.stage!, activeIcon = root.classList.contains("active-icon");
    const width = index === 0 ? (activeIcon ? 34 : 120) : stage === "full" ? 110 : stage === "truncated" ? 80 : 34;
    return { width, height: 32, left: 0, top: 0, right: width, bottom: 32, x: 0, y: 0 };
  };
  return view;
}

test("a tab's accessible name is its label and its tooltip says more; only the active tab is in the tab order", async () => {
  const view = await strip();
  expect(view.tabs.map(tab => [tab.id, tab.getAttribute("role"), tab.getAttribute("aria-label"), tab.title, tab.getAttribute("aria-selected"), tab.tabIndex]))
    .toEqual(items.map((item, index) => [`tab-${item.id}`, "tab", item.label, item.tooltip ?? "", String(index === 0), index === 0 ? 0 : -1]));
  expect(view.tablist.getAttribute("role")).toBe("tablist");
});

test("fit picks the stage from measured tabs, hides what overflows and names the menu button by what it holds", async () => {
  const view = await strip();
  view.fit(480);
  expect([view.stage, view.overflowed]).toEqual(["full", []]);
  view.fit(362);
  expect(view.stage).toBe("truncated");
  view.fit(230);
  expect(view.stage).toBe("icons");
  view.fit(126);
  expect([view.stage, view.overflowed]).toEqual(["overflow", ["p3"]]);
  const more = (view.element as unknown as LightElement).querySelector(".tab-strip-more")!;
  expect([more.hidden, more.getAttribute("aria-label"), more.getAttribute("aria-haspopup")]).toEqual([false, "1 more tab: Warp", "menu"]);
  expect(view.tabs.map(tab => tab.hidden)).toEqual([false, false, false, true]);
  // Room again: everything comes back.
  view.fit(480);
  expect([view.stage, view.tabs.some(tab => tab.hidden), more.hidden]).toEqual(["full", false, true]);
});

test("update reuses tabs by ID and retitle changes a label in place", async () => {
  const chosen: string[] = [];
  const view = await strip(id => chosen.push(id));
  const first = view.tab("p1");
  view.update([...items].reverse(), "p1");
  expect(view.tab("p1")).toBe(first!);
  expect(view.tabs.map(tab => tab.getAttribute("aria-selected"))).toEqual(["false", "false", "true", "false"]);
  view.retitle("p1", "Shape 2", "Shape 2 · the second view");
  expect([first!.getAttribute("aria-label"), first!.title, first!.textContent]).toEqual(["Shape 2", "Shape 2 · the second view", "Shape 2"]);
  first!.click();
  expect(chosen).toEqual(["p1"]);
});
