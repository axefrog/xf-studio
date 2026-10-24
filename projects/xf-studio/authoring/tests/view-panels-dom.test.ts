// A 3D view panel per view (experiment 044 P2-iii-b) over the light DOM harness: the shown tab's views each get a pane (`head` for the main
// view, `view.<id>` otherwise) that comes and goes with them, a saved arrangement places them, the canvas goes to the pane holding the
// picture and never to a view that isn't drawn, a closed view's panel is the only one withdrawn, and the not-drawn state (U7) draws its
// view from Show here, a press, Enter and Space.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { installLightDom, lightDocument, lightEvent, type LightElement, uninstallLightDom } from "./light-dom";
import type { DrawnViews } from "../src/app/viewport-attachment";
import type { DockTree, GroupNode } from "../src/studio-ui/dock/layout";
import { canvasView, tabViews, viewPaneState, ViewPanels, viewPanelEntries, viewPanelIds, type ShownView, type ViewPaneController } from "../src/studio-ui/panels/view-panels";
import { viewCatalogue } from "../src/studio-ui/views/contribution";
import { SHELL_VIEW } from "../src/studio-ui/views/shell";
import { UIPreferenceActions } from "../src/app/ui-preferences";
import { relayDockSaves } from "../src/app/profiles/profile-window";
import type { ProfileSessions } from "../src/app/profiles/profile-sessions";
import { sessionOfWorkspace } from "../src/app/profiles/profiles-migration-data";
import { openSession, seededRandom } from "./fixtures/profile-sessions";
import { freshWorkspace } from "./fixtures/eye-region";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());

const panelOf = (view: string) => view === "main" ? "head" : `view.${view}`;
const shownOf = (views: string[]): ShownView[] => views.map(view => ({ view, panel: panelOf(view) }));

describe("pane state", () => {
  test("the canvas is in the pane whose picture it holds, the drawn view's while none is on it; the drawn view elsewhere is preparing", () => {
    expect(viewPaneState("a", { drawn: "a", onCanvas: "a" })).toBe("canvas");
    expect(viewPaneState("b", { drawn: "a", onCanvas: "a" })).toBe("not-drawn");
    // B drawn, its head made ready while A keeps its picture.
    expect([viewPaneState("a", { drawn: "b", onCanvas: "a" }), viewPaneState("b", { drawn: "b", onCanvas: "a" })]).toEqual(["canvas", "preparing"]);
    // Nothing on the canvas yet (the first load, or the preview isn't set up): the drawn view's pane shows the head's own state.
    expect([viewPaneState("a", { drawn: "a" }), viewPaneState("b", { drawn: "a" })]).toEqual(["canvas", "not-drawn"]);
    expect([viewPaneState("a", {}), viewPaneState(undefined, { drawn: "a" })]).toEqual(["not-drawn", "not-drawn"]);
    expect(canvasView({ drawn: "b", onCanvas: "a" })).toBe("a");
  });
  test("the shown tab's views, in graph order, with their panels (a view with no tab is the shown tab's)", () => {
    const views = [{ id: "main", tab: "t1", panel: "head" }, { id: "x", tab: "t2", panel: "view.x" }, { id: "y", tab: "t1", panel: "view.y" }];
    expect(tabViews(views, "t1")).toEqual([{ view: "main", panel: "head" }, { view: "y", panel: "view.y" }]);
    expect(tabViews([{ id: "main", panel: "head" }], "t1")).toEqual([{ view: "main", panel: "head" }]);
  });
});

/** A pane: a panel element with its canvas slot. */
function fakePane(id: string): ViewPaneController & { disposed: boolean } {
  const element = document.createElement("div"), slot = document.createElement("div");
  element.append(slot);
  const pane = { slot, disposed: false, spec: { id, title: "3D view", icon: "head" as const, description: "", element }, update() {},
    dispose() { pane.disposed = true; } };
  return pane;
}

async function harness(initial: string[], drawn: DrawnViews, saved?: DockTree, session?: ProfileSessions) {
  const { DockView } = await import("../src/studio-ui/dock/dock-view");
  const { restoreDockPreference, serializeDockState } = await import("../src/studio-ui/dock/persist");
  const { defaultDockStateFor } = await import("../src/studio-ui/dock/persist");
  const base = viewCatalogue([SHELL_VIEW]), head = base.panels.find(panel => panel.id === "head")!;
  const catalogue = { ...base, panels: [...base.panels], ids: [...base.ids], meta: { ...base.meta } };
  const setViews = (panels: readonly string[]) => {
    catalogue.panels.splice(0, catalogue.panels.length, ...base.panels.flatMap(panel => panel.id === "head" ? viewPanelEntries(head, panels) : [panel]));
    catalogue.ids.splice(0, catalogue.ids.length, ...catalogue.panels.map(panel => panel.id));
  };
  const state = { views: [...initial], drawn: { ...drawn } };
  const readViews = () => session ? tabViews(session.graph.snapshot().views, session.tabId()) : shownOf(state.views);
  const preferences = new UIPreferenceActions({ ...freshWorkspace().uiPreferences, ...(session?.dock() ? { layout: session.dock()! } : {}) });
  if (session) relayDockSaves(preferences, session, action => session.dispatch(action));
  const attached: string[] = [], made = new Map<string, ReturnType<typeof fakePane>>(), saves: unknown[] = [];
  let dock!: InstanceType<typeof DockView>;
  const panes = new ViewPanels({
    views: readViews, drawn: () => state.drawn,
    arrangement: () => ({ tab: session?.tabId(), layout: preferences.snapshot().layout ?? null }),
    make: panel => { const pane = fakePane(panel); made.set(panel, pane); return pane; },
    catalogue: setViews,
    dock: { addPanels: specs => dock.addPanels(specs), removePanels: (ids, options) => dock.removePanels(ids, options), get dockState() { return dock.dockState; } },
    spec: pane => pane.spec,
    restore: layout => dock.load(restoreDockPreference(layout, area, catalogue, [], session ? viewPanelIds(session.graph.snapshot()) : readViews().map(view => view.panel)).state,
      [...others, ...panes.controllers().map(pane => pane.spec)]),
    attach: slot => attached.push([...made].find(([, pane]) => pane.slot === slot)![0]),
  });
  panes.start();
  const area = { x: 0, y: 0, w: 1600, h: 900 };
  const restored = restoreDockPreference(saved ? serializeDockState({ wide: saved, compact: saved }) : preferences.snapshot().layout, area, catalogue);
  const others = catalogue.panels.filter(panel => !panel.id.startsWith("view.") && panel.id !== "head")
    .map(panel => ({ id: panel.id, title: panel.title, icon: panel.icon, description: panel.description, element: document.createElement("div") }));
  dock = new DockView({ panels: [...others, ...panes.controllers().map(pane => pane.spec)], state: restored.state, sizeClass: () => "wide",
    defaults: size => defaultDockStateFor(catalogue)[size], save: next => { saves.push(next);
      if (session) preferences.dispatch({ kind: "layout.set", layout: serializeDockState(next) }); }, announce: () => {} });
  dock.render();
  panes.sync();
  const group = (panel: string) => { const found = [dock.tree.root, ...dock.tree.floating.map(window => window.node)];
    const visit = (node: unknown): GroupNode | undefined => { const item = node as GroupNode & { children?: unknown[] };
      if (!item) return undefined; if (item.kind === "group") return item.panels.includes(panel) ? item : undefined;
      for (const child of item.children ?? []) { const hit = visit(child); if (hit) return hit; } return undefined; };
    for (const root of found) { const hit = visit(root); if (hit) return hit; } return undefined; };
  return { panes, dock, state, attached, made, group, restored, catalogue, saves, preferences };
}

describe("a pane per view", () => {
  test("switching A to B keeps B's custom arrangement through the real session, dock and save relay", async () => {
    const session = openSession(sessionOfWorkspace(freshWorkspace(), { tab: "A", character: "c-1" }, seededRandom(41)));
    const a = session.tabId(), b = session.duplicate(a), bPanel = session.graph.snapshot().views.find(view => view.tab === b)!.panel;
    const { panes, dock, group, saves } = await harness([], {}, undefined, session);
    dock.moveTo(bPanel, { kind: "float", x: 100, y: 100, w: 450, h: 350 }, "");
    const customB = structuredClone(session.dock(b)), groupB = group(bPanel)!.id;
    session.show(a); panes.sync();
    const keptA = structuredClone(session.dock(a));
    saves.length = 0;
    session.show(b); panes.sync();
    expect(session.dock(b)).toEqual(customB);
    expect(group(bPanel)?.id).toBe(groupB);
    expect(session.dock(a)).toEqual(keptA);
    expect(saves).toHaveLength(1);
    panes.sync();
    expect(saves).toHaveLength(1);
    // Closing the shown tab and undoing/redoing that close are switches too. Its fragment keeps the custom arrangement.
    session.close(b); panes.sync();
    saves.length = 0;
    expect(session.graph.undo()).toBe(true); panes.sync();
    expect(session.dock(b)).toEqual(customB);
    expect(group(bPanel)?.id).toBe(groupB);
    expect(saves).toHaveLength(1);
    expect(session.graph.redo()).toBe(true); panes.sync();
    expect(session.graph.undo()).toBe(true); panes.sync();
    expect(session.dock(b)).toEqual(customB);
    expect(session.dock(a)).toEqual(keptA);
  });

  test("an external arrangement restore in the same tab loads once; an ordinary dock save does not reload it", async () => {
    const session = openSession(sessionOfWorkspace(freshWorkspace(), { tab: "A", character: "c-1" }, seededRandom(42)));
    const { panes, dock, group, catalogue, saves } = await harness([], {}, undefined, session);
    const { serializeDockState } = await import("../src/studio-ui/dock/persist");
    const tree: DockTree = { root: { kind: "group", id: "restored-by-session", panels: [...catalogue.ids], active: "head" }, floating: [], closed: [] };
    session.arrange(session.tabId(), serializeDockState({ wide: tree, compact: tree }));
    saves.length = 0;
    panes.sync();
    expect(group("head")?.id).toBe("restored-by-session");
    expect(saves).toHaveLength(1);
    panes.sync(); expect(saves).toHaveLength(1);
    dock.close("history");
    const afterSave = saves.length;
    panes.sync();
    expect(dock.tree.closed).toContain("history");
    expect(saves).toHaveLength(afterSave);
  });
  test("panels follow the shown tab's views: added beside the other 3D views, withdrawn, and the catalogue knows them", async () => {
    const { panes, dock, state, made, group, catalogue } = await harness(["main"], { drawn: "main", onCanvas: "main" });
    expect(panes.controllers().map(pane => pane.spec.id)).toEqual(["head"]);
    state.views = ["main", "v2"];
    expect(panes.sync()).toBe(true);
    expect(catalogue.ids).toContain("view.v2");
    expect(dock.panel("view.v2")).toBeDefined();
    // Its home is the 3D views' group (the stage), as a tab beside the main view's.
    expect(group("view.v2")?.panels).toEqual(["head", "view.v2"]);
    expect(panes.sync()).toBe(false);
    state.views = ["v2"];
    panes.sync();
    expect(dock.panel("head")).toBeUndefined();
    expect(made.get("head")!.disposed).toBe(true);
    expect(catalogue.ids.filter(id => id === "head" || id.startsWith("view."))).toEqual(["view.v2"]);
  });

  test("a saved arrangement places a view's panel where it was kept (the catalogue knows view.* IDs), never as an unknown parked panel", async () => {
    const saved: DockTree = { floating: [], closed: ["activity", "settings", "help"], root: { kind: "split", id: "s", axis: "row", sizes: [.5, .5], children: [
      { kind: "group", id: "g-a", panels: ["head", "presets", "history", "library", "package"], active: "head" },
      { kind: "group", id: "g-b", panels: ["view.v2", "character", "lighting", "motion", "quality"], active: "view.v2" }] } };
    const { dock, group, restored } = await harness(["main", "v2"], { drawn: "main", onCanvas: "main" }, saved);
    expect(restored.recovered).toBe(true);
    expect(group("view.v2")?.id).toBe("g-b");
    expect(dock.tree.parked?.["view.v2"]).toBeUndefined();
    // A closed view leaves no place behind when an older arrangement is restored. Unknown features and retained views survive.
    const { restoreDockPreference, serializeDockState } = await import("../src/studio-ui/dock/persist");
    const shellOnly = viewCatalogue([SHELL_VIEW]);
    const stale = structuredClone(saved);
    (stale.root as { children: GroupNode[] }).children[1]!.panels.push("future.panel", "view.future");
    stale.closed.push("view.closed");
    stale.parked = { "view.parked": { group: ["view.parked", "future.panel"], index: 0, active: true }, "future.closed": { closed: true } };
    stale.lastPlace = { "view.v2": { group: ["view.v2", "character"], index: 0, active: true },
      "future.closed": { group: ["view.v2", "future.closed"], index: 1, active: true, anchor: { panel: "view.v2", side: "right", share: .3 } } };
    const unknown = restoreDockPreference(serializeDockState({ wide: stale, compact: stale }), { x: 0, y: 0, w: 1600, h: 900 }, shellOnly, [], ["head", "view.future"]);
    for (const tree of [unknown.state.wide, unknown.state.compact]) {
      expect(tree.parked?.["view.v2"]).toBeUndefined();
      expect(tree.lastPlace?.["view.v2"]).toBeUndefined();
      expect(tree.parked?.["future.panel"]).toBeDefined();
      expect(tree.parked?.["view.future"]).toBeDefined();
      expect(tree.parked?.["future.closed"]).toEqual({ closed: true });
      for (const staleId of ["view.v2", "view.closed", "view.parked"]) expect(JSON.stringify(tree)).not.toContain(staleId);
    }
  });

  test("closing a view withdraws only its panel, leaving no place behind; the others stay where they are", async () => {
    const { panes, dock, state, group } = await harness(["main", "v2", "v3"], { drawn: "main", onCanvas: "main" });
    const before = group("head")!.panels;
    expect(before).toEqual(["head", "view.v2", "view.v3"]);
    state.views = ["main", "v3"];
    panes.sync();
    expect(group("head")!.panels).toEqual(["head", "view.v3"]);
    expect(dock.panel("view.v2")).toBeUndefined();
    expect(dock.tree.parked?.["view.v2"]).toBeUndefined();
    expect(dock.tree.lastPlace?.["view.v2"]).toBeUndefined();
    // A panel closed in the dock stays the view's: only the dock's own state changes, and no pane is withdrawn.
    dock.close("view.v3");
    panes.sync();
    expect(panes.pane("view.v3")).toBeDefined();
    expect(dock.tree.closed).toContain("view.v3");
  });

  test("the canvas moves to the pane holding the picture, and never into a pane whose view isn't drawn", async () => {
    const { panes, state, attached } = await harness(["main", "v2", "v3"], { drawn: "main", onCanvas: "main" });
    expect(attached).toEqual(["head"]);
    // v2 drawn and made ready: the main view keeps the picture, so the canvas stays.
    state.drawn = { drawn: "v2", onCanvas: "main" };
    panes.sync();
    expect(attached).toEqual(["head"]);
    // The takeover: the canvas moves, once.
    state.drawn = { drawn: "v2", onCanvas: "v2" };
    panes.sync(); panes.sync();
    expect(attached).toEqual(["head", "view.v2"]);
    // The pane holding the canvas closed: it goes to the next view drawn, never to v3 (not drawn).
    state.views = ["main", "v3"]; state.drawn = { drawn: "main" };
    panes.sync();
    expect(attached).toEqual(["head", "view.v2", "head"]);
    expect(attached).not.toContain("view.v3");
  });
});

describe("the not-drawn state (U7)", () => {
  const press = (target: LightElement, type: string, init: Record<string, unknown> = {}) => target.dispatchEvent(lightEvent(type, init));
  test("Show here, a press in the pane, Enter and Space each draw the view; nothing does while it is drawn", async () => {
    const { notDrawnState } = await import("../src/studio-ui/components");
    const pane = lightDocument.createElement("div") as unknown as HTMLElement;
    let drawn = 0;
    const idle = notDrawnState(pane, () => drawn++);
    (pane as unknown as LightElement).append(idle.element as unknown as LightElement);
    const name = idle.update({ shown: true, title: "3D view 2", shows: "Valerie · Smoky" });
    expect(name).toBe("3D view 2, not shown. Press Enter to show it here.");
    expect(idle.element.hidden).toBe(false);
    const root = idle.element as unknown as LightElement;
    expect(root.querySelector(".viewport-idle-title")!.textContent).toBe("3D view 2");
    expect(root.querySelector(".viewport-idle-shows")!.textContent).toBe("Valerie · Smoky");
    (idle.button as unknown as LightElement).click();
    expect(drawn).toBe(1);
    press(root.querySelector(".viewport-idle-title")!, "click");
    expect(drawn).toBe(2);
    press(pane as unknown as LightElement, "keydown", { key: "Enter" });
    press(pane as unknown as LightElement, "keydown", { key: " " });
    expect(drawn).toBe(4);
    // A key from inside (a control) or another key does nothing.
    press(pane as unknown as LightElement, "keydown", { key: "f" });
    expect(drawn).toBe(4);
    expect(idle.update({ shown: false })).toBeUndefined();
    expect(idle.element.hidden).toBe(true);
    press(pane as unknown as LightElement, "keydown", { key: "Enter" });
    press(root, "click");
    expect(drawn).toBe(4);
  });

  test("a pane whose view isn't drawn shows U7, hides the picture's overlays and names itself; the drawn one shows the picture", async () => {
    const { headPanel, viewShowsLine } = await import("../src/studio-ui/panels/viewports");
    const { AnchorRegistry } = await import("../src/studio-ui/guidance/anchors");
    const focused: string[] = [];
    const rt = { anchors: new AnchorRegistry(), feedback: { toast() {} }, toolFilter: () => ({ modules: [], research: false }), changed() {},
      port: { viewport: { input: () => ({ modifiers: { ctrl: false, alt: false, shift: false }, head: { editable: false }, uv: { editable: false } }),
        subscribeInput: () => () => {}, resize() {} },
        previewSetup: { dispatch: async () => ({ ok: true }), capability: () => ({ available: true }) },
        views: { tools: () => [], shows: (view: string) => view === "v2" ? { v: "Valerie", look: "Smoky" } : { v: "Valerie" } },
        focus: { view: (view: string) => focused.push(view) } } };
    const context = { view: { summaries: () => [], badge: () => undefined } };
    const frame = (head: DrawnViews) => ({
      viewport: { head: { phase: "ready", width: 300, height: 200, captured: false, ...head } },
      views: { views: [{ id: "main", panel: "head" }, { id: "v2", panel: "view.v2" }] },
      viewTitles: [{ view: "main", panel: "head", title: "3D view 1", subject: "" }, { view: "v2", panel: "view.v2", title: "3D view 2", subject: "" }],
      previewSetup: { head: { next: null }, wolvenKitStep: null }, preferences: { inputHints: true }, layer: undefined, viewTools: [], locked: undefined,
      status: { assets: {} }, library: { draft: null } });
    const main = headPanel(rt as never, context as never, "head"), side = headPanel(rt as never, context as never, "view.v2");
    for (const pane of [main, side]) pane.update(frame({ drawn: "main", onCanvas: "main" }) as never);
    const el = (pane: typeof main) => pane.spec.element as unknown as LightElement;
    expect(el(side).dataset.drawn).toBe("false");
    expect(el(side).querySelector('[data-tone="idle"]')!.hidden).toBe(false);
    expect(el(side).querySelector(".viewport-idle-shows")!.textContent).toBe("Valerie · Smoky");
    expect(el(side).getAttribute("aria-label")).toBe("3D view 2, not shown. Press Enter to show it here.");
    expect([el(side).querySelector(".viewport-top")!.hidden, el(side).querySelector(".viewport-bottom")!.hidden]).toEqual([true, true]);
    expect(el(main).dataset.drawn).toBe("true");
    expect(el(main).querySelector('[data-tone="idle"]')!.hidden).toBe(true);
    expect(el(main).getAttribute("aria-label")).toMatch(/^3D view 1\. Keys: /);
    expect(rt.anchors.element("head.view")).toBe(main.spec.element);
    // Show here draws the side view (the person's focus); while it is made ready its pane shows progress, then it takes the picture.
    (el(side).querySelector('[data-tone="idle"]')!.querySelector(".btn") as unknown as LightElement).click();
    expect(focused).toEqual(["v2"]);
    for (const pane of [main, side]) pane.update(frame({ drawn: "v2", onCanvas: "main" }) as never);
    expect(el(side).querySelector('[data-tone="idle"]')!.hidden).toBe(true);
    expect(el(side).querySelector('.viewport-state[data-tone="progress"]')!.hidden).toBe(false);
    expect(el(main).dataset.drawn).toBe("true");
    for (const pane of [main, side]) pane.update(frame({ drawn: "v2", onCanvas: "v2" }) as never);
    expect(el(main).querySelector('[data-tone="idle"]')!.hidden).toBe(false);
    expect(el(main).querySelector(".viewport-idle-shows")!.textContent).toBe("Valerie · No look");
    expect(rt.anchors.element("head.view")).toBe(side.spec.element);
    expect(viewShowsLine({})).toBe("No look");
    side.dispose?.(); main.dispose?.();
  });
});
