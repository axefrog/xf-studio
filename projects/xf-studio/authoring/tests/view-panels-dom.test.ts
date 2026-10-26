// A 3D view panel per view (experiment 044 P2-iii-b) over the light DOM harness: the shown tab's views each get a pane (`head` for the main
// view, `view.<id>` otherwise) that comes and goes with them, a saved arrangement places them, the canvas goes to the pane holding the
// picture and never to a view that isn't drawn, a closed view's panel is the only one withdrawn, and the not-drawn state (U7) draws its
// view from Show here, a press, Enter and Space.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { installLightDom, lightDocument, lightEvent, type LightElement, uninstallLightDom } from "./light-dom";
import type { DrawnViews } from "../src/app/viewport-attachment";
import { allGroups, applyDrop, setSizes, group, split, locate, MIN_GROUP, type DockState, type SplitNode, type DockNode, type DockTree, type GroupNode } from "../src/studio-ui/dock/layout";
import { restoreDockPreference, serializeDockState } from "../src/studio-ui/dock/persist";
import { DockView, type PanelSpec } from "../src/studio-ui/dock/dock-view";
import { canvasView, tabViews, viewPaneState, ViewPanels, viewPanelEntries, viewPanelIds, type ShownView, type ViewPaneController } from "../src/studio-ui/panels/view-panels";
import { viewCatalogue, type ViewContribution } from "../src/studio-ui/views/contribution";
import { SHELL_VIEW } from "../src/studio-ui/views/shell";
import { UIPreferenceActions } from "../src/app/ui-preferences";
import { layoutTabsPort } from "../src/app/profiles/tab-presentation";
import type { ProfileSessions } from "../src/app/profiles/profile-sessions";
import { sessionOfWorkspace } from "../src/app/profiles/profiles-migration-data";
import { openSession, seededRandom } from "./fixtures/profile-sessions";
import { freshWorkspace } from "./fixtures/eye-region";
import { viewTitles } from "../src/platform/api/view-graph";
import { previewSetupCard } from "../src/studio-ui/preview-setup-card";
import { statusActivity, panelMenuItems } from "../src/studio-ui/app";
import { STUDIO_CATALOGUE } from "../src/compose/views";
import { defaultViewGraph } from "../src/preview/preview-view-graph";
import { drawnView } from "../src/app/profiles/profile-window";
import { Feedback } from "../src/studio-ui/feedback";
import type { PreviewSetupSnapshot } from "../src/preview/preview-setup";
import { HOLOTABLE_MODULE } from "../src/features/holotable";
import { HOLOTABLE_VIEW } from "../src/features/holotable/view/contribution";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());

const panelOf = (view: string) => view === "main" ? "head" : `view.${view}`;
const shownOf = (views: string[]): ShownView[] => views.map(view => ({ view, panel: panelOf(view) }));

test.each(["wide", "compact"] as const)("registered experiment panels resume in the real %s dock and Panels picker after an early restore", async size => {
  const { DockView } = await import("../src/studio-ui/dock/dock-view");
  const { restoreDockPreference } = await import("../src/studio-ui/dock/persist");
  const life = new AbortController(), area = { x: 0, y: 0, w: 800, h: 600 };
  const saved = HOLOTABLE_MODULE.defaults![0]!.fragment.tab.dock;
  const off = viewCatalogue([SHELL_VIEW]), on = viewCatalogue([SHELL_VIEW, HOLOTABLE_VIEW]);
  const specs = (catalogue: typeof on) => catalogue.panels.map(({ id, title, icon, description }) => ({ id, title, icon, description, element: document.createElement("div") }));
  const early = restoreDockPreference(saved, area, off, [], [], true).state;
  const dock = new DockView({ signal: life.signal, panels: specs(off), state: early, sizeClass: () => size,
    defaults: () => early[size], save() {}, announce() {} });
  lightDocument.body.append(dock.element as unknown as LightElement);
  try {
    dock.render();
    expect(dock.tree.root).toBeNull();
    dock.load(restoreDockPreference(serializeDockState(early), area, on, [], [], true).state, specs(on));
    for (const panel of HOLOTABLE_VIEW.panels) {
      expect(dock.panelState(panel.id)).toBe("open");
      expect((dock.element as unknown as LightElement).querySelector(`[data-panel="${panel.id}"]`)).not.toBeNull();
    }
    const rt = { dock, views: on, port: { views: { titles: () => [], modules: () => [HOLOTABLE_MODULE], plannedModules: () => [] } } };
    const rows = panelMenuItems(rt as never, false).filter(item => item.kind === "action");
    for (const panel of HOLOTABLE_VIEW.panels) expect(rows.some(row => row.label === panel.title && row.checked)).toBe(true);
  } finally { life.abort(); }
});

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

async function harness(initial: string[], drawn: DrawnViews, saved?: DockTree, session?: ProfileSessions, base = viewCatalogue([SHELL_VIEW])) {
  const { DockView } = await import("../src/studio-ui/dock/dock-view");
  const { restoreDockPreference, serializeDockState } = await import("../src/studio-ui/dock/persist");
  const { defaultDockStateFor } = await import("../src/studio-ui/dock/persist");
  const head = base.panels.find(panel => panel.id === "head")!;
  const catalogue = { ...base, panels: [...base.panels], ids: [...base.ids], meta: { ...base.meta } };
  const setViews = (panels: readonly string[]) => {
    catalogue.panels.splice(0, catalogue.panels.length, ...base.panels.flatMap(panel => panel.id === "head" ? viewPanelEntries(head, panels) : [panel]));
    catalogue.ids.splice(0, catalogue.ids.length, ...catalogue.panels.map(panel => panel.id));
  };
  // P3-i D1 / 044 D2: this still mounts the phase-2 dock. Exercise its real presentation
  // projection rather than feeding raw instance IDs to controllers keyed by type/view aliases.
  // Only snapshot/dock are used; the defaults/library methods are outside this harness.
  const tabs = session && layoutTabsPort(session, undefined as never, {} as never);
  const state = { views: [...initial], drawn: { ...drawn } };
  const readViews = () => session ? tabViews(session.graph.snapshot().views, session.tabId()) : shownOf(state.views);
  const preferences = new UIPreferenceActions({ ...freshWorkspace().uiPreferences, ...(tabs?.dock() ? { layout: tabs.dock()! } : {}) });
  const attached: string[] = [], made = new Map<string, ReturnType<typeof fakePane>>(), saves: unknown[] = [];
  let dock!: InstanceType<typeof DockView>;
  const panes = new ViewPanels({
    views: readViews, drawn: () => state.drawn,
    arrangement: () => ({ tab: session?.tabId(), layout: tabs ? tabs.dock() : preferences.snapshot().layout ?? null }),
    opening: () => tabs?.snapshot().opening, openView: (panel, arrangement, focus) => dock.openView(panel, arrangement, focus),
    save: (tab, next) => { saves.push(next);
      if (session && tab !== undefined) session.dispatch({ kind: "tabs.arrange", tab, layout: serializeDockState(next) }); },
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
    defaults: size => defaultDockStateFor(catalogue)[size], save: next => panes.save(next), announce: () => {} });
  dock.element.getBoundingClientRect = () => ({ x: 0, y: 0, width: 1600, height: 900 }) as DOMRect;
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
  for (const slot of ["missing", "no-head", "tight-left", "narrow", "collapsed", "wide"] as const) test(`a first view's history restores its ${slot} head slot and drawing while preserving live focus through the real session and dock`, async () => {
    const workspace = freshWorkspace(), session = openSession(sessionOfWorkspace(workspace, { tab: "A", character: "c-1" }, seededRandom(57)));
    const tab = session.tabId(); session.closeView("main");
    const tree: DockTree = { root: split("row", [{ ...group(["presets"], "presets", "g-collection"), collapsed: true },
      group(["lighting"], "lighting", "g-inspect")]), floating: [], closed: [] };
    if (slot !== "missing" && slot !== "no-head" && slot !== "tight-left") tree.root = split("row", [group(["presets"], "presets", "g-collection"),
      { ...group(["head", "lighting"], "lighting", "custom-head"), collapsed: slot === "collapsed" },
      group(["history"], "history", "g-layers")], [.2, slot === "narrow" ? .12 : .4, slot === "narrow" ? .68 : .4]);
    if (slot === "no-head" || slot === "tight-left") tree.root = split("row", [
      split("column", [group(["presets"], "presets", "g-collection"), group(["layers"], "layers", "g-layers")], [.4, .6], "s-left"),
      split("column", [group(["uv"], "uv", "g-uv"), group(["finish", "lighting"], "finish", "g-inspect")], [.42, .58], "s-right"),
    ], slot === "tight-left" ? [.08, .92] : [.21, .79], "s-root");
    session.arrange(tab, serializeDockState({ wide: tree, compact: tree }));
    const h = await harness([], {}, tree, session, STUDIO_CATALOGUE), depth = session.graph.history().depth;
    lightDocument.body.append(h.dock.element as unknown as LightElement);
    const view = session.openView(tab, defaultViewGraph(workspace.preview), { kind: "character", id: "c-1" }), panel = panelOf(view);
    const paint = () => { h.state.drawn = { drawn: drawnView(session) }; h.panes.sync(); };
    const check = async (focused = panel) => {
      expect(session.tabId()).toBe(tab); expect(drawnView(session)).toBe(view);
      expect(session.graph.history().depth).toBe(depth + 1);
      expect(session.focus.focusedPanel()).toBe(session.instance(focused, tab));
      for (const size of ["wide", "compact"] as const) {
        const at = locate(h.dock.dockState[size], panel)!;
        expect(at?.group.id).toBe(slot === "missing" || slot === "no-head" || slot === "tight-left" ? "g-head" : "custom-head"); expect(at.windowId).toBeUndefined();
        if (slot !== "missing" && slot !== "no-head" && slot !== "tight-left") {
          const root = h.dock.dockState[size].root!;
          expect(root.kind).toBe("split");
          if (root.kind === "split") expect(root.sizes[1]).toBeCloseTo(slot === "wide" ? .4 : size === "wide" ? .37 : .38);
        }
        if (slot === "no-head" || slot === "tight-left") {
          const root = h.dock.dockState[size].root!;
          if (size === "wide") {
            expect(root.kind).toBe("split");
            if (root.kind === "split") {
              expect(root.axis).toBe("row"); expect(root.children.map(child => child.id)).toEqual(["s-left", "g-head", "s-right"]);
              expect(root.sizes[1]).toBeCloseTo(.37);
            }
          }
          const checkWidths = (node: DockNode, width: number) => {
            if (node.kind === "group") expect(width).toBeGreaterThanOrEqual((node.panels.includes(panel) ? 320 : MIN_GROUP.w) - 1e-6);
            else {
              const usable = node.axis === "row" ? width - (node.children.length - 1) * 8 : width;
              node.children.forEach((child, i) => checkWidths(child, node.axis === "row" ? usable * node.sizes[i] : usable));
            }
          };
          checkWidths(root, 1600);
        }
        expect(at.group.active).toBe(panel); expect(at.group.collapsed).not.toBe(true);
      }
      expect(h.panes.canvasPanel()).toBe(panel); expect(h.attached.at(-1)).toBe(panel);
      await Bun.sleep(5);
      expect(lightDocument.activeElement).toBe((h.dock.element as unknown as LightElement).querySelector(`[id="dock-tab-${focused}"]`));
      expect(lightDocument.activeElement?.isConnected).toBe(true);
    };
    paint(); await check();
    for (let replay = 0; replay < 2; replay++) {
      expect(session.graph.undo()).toBe(true); paint();
      expect(session.graph.has(view)).toBe(false); expect(locate(h.dock.tree, panel)).toBeUndefined();
      // P3-i D11 / 044 D15: restoring the pane restores its slot, never the old focus.
      session.focus.focusPanel(session.instance("presets", tab));
      h.dock.element.querySelector<HTMLElement>('[id="dock-tab-presets"]')!.focus();
      expect(session.graph.redo()).toBe(true); paint(); await check("presets");
    }
  });
  for (const slot of ["arranged", "factory", "empty"] as const) test(`a first 3D view opens active, expanded and focused in its ${slot} slot`, async () => {
    const arranged = { ...group(["head", "lighting"], "lighting", "custom-head"), collapsed: true };
    const tree: DockTree = { root: slot === "empty" ? null : split("row", [group(["package"], "package", "collection"),
      slot === "arranged" ? arranged : group(["lighting"], "lighting", "inspect"), group(["history"], "history", "stack")]),
      floating: [], closed: [], ...(slot === "arranged" ? { maximized: "collection" } : {}) };
    const layout = serializeDockState({ wide: tree, compact: tree }), h = await harness([], {}, tree);
    h.state.views.push("created"); h.state.drawn = { drawn: "created", onCanvas: "created" };
    h.panes.sync(); h.dock.openView("view.created", layout);
    for (const size of ["wide", "compact"] as const) {
      const state = h.dock.dockState[size], at = locate(state, "view.created")!;
      expect(at).toBeDefined(); expect(at.windowId).toBeUndefined();
      expect(at.group.id).toBe(slot === "arranged" ? "custom-head" : "g-head");
      expect(at.group.active).toBe("view.created"); expect(at.group.collapsed).not.toBe(true);
      expect(at.group.panels).not.toContain("package"); expect(state.maximized).toBeUndefined();
    }
    expect(h.panes.canvasPanel()).toBe("view.created"); expect(h.attached.at(-1)).toBe("view.created");
    await Bun.sleep(5);
    expect(lightDocument.activeElement?.getAttribute("id")).toBe("dock-tab-view.created");
  });
  test("a ready head, a tab switch and a pane change never dismiss a closed setup card or leave a status refusal", async () => {
    const session = openSession(sessionOfWorkspace(freshWorkspace(), { tab: "A", character: "c-1" }, seededRandom(51)));
    const a = session.tabId(), b = session.duplicate(a), current = session.graph.snapshot().views.find(view => view.tab === b)!;
    const side = session.addView(current.id, {}, { tab: b });
    const h = await harness([], { drawn: current.id, onCanvas: current.id }, undefined, session);
    const feedback = new Feedback(), actions: string[] = [];
    const setup: PreviewSetupSnapshot = { card: { open: false, canDismiss: true, title: "", body: "", progress: null, step: null,
      notice: null, primary: null, secondary: null, links: [], busy: false, route: null }, consent: null,
      head: { phase: "ready", code: null, message: "", progress: null, next: null }, setupRequests: 0, showRequests: 0, autostart: true, wolvenKitStep: null };
    const rt = { feedback, changed() {}, port: { previewSetup: { snapshot: () => setup, capability: () => ({ available: false }),
      dispatch: async (action: { kind: string }) => {
        actions.push(action.kind);
        if (!setup.card.open) return { ok: false, message: "The 3D view setup isn't showing." };
        setup.card.open = false; return { ok: true };
      } } } };
    const card = previewSetupCard(rt as never), later = (card.element as unknown as LightElement).querySelectorAll("button").find(button => button.textContent === "Not now")!;
    const frame = { previewSetup: setup, viewport: { head: { phase: "ready" } }, library: { busy: false }, status: {} };
    const paint = async () => {
      card.update(frame as never);
      // The old capture startup clicked this button through its hidden ancestor.
      later.click(); await Promise.resolve(); await Promise.resolve();
      expect(later.hidden).toBe(true);
      expect(actions).toEqual([]); expect(feedback.log).toEqual([]);
      expect(statusActivity(frame as never, feedback.log.at(-1))).toMatchObject({ text: "Ready", tone: "info" });
    };
    await paint();
    session.show(a); h.panes.sync(); await paint();
    session.show(b); h.panes.sync();
    h.state.drawn = { drawn: side, onCanvas: side }; h.panes.sync();
    h.panes.pane(session.graph.snapshot().views.find(view => view.id === side)!.panel)!.spec.element.append(card.element);
    await paint();
    // A stale event after readiness changes, before the next paint, is quiet too.
    setup.card.open = true; card.update(frame as never); setup.card.open = false;
    later.click(); await Promise.resolve(); await Promise.resolve();
    expect(actions).toEqual([]); expect(feedback.log).toEqual([]);
    setup.card.open = true; setup.card.canDismiss = false; card.update(frame as never);
    later.click(); expect(actions).toEqual([]);
    // When setup really is open and dismissible, Not now still works.
    setup.card.canDismiss = true; card.update(frame as never); later.click();
    await Promise.resolve(); await Promise.resolve();
    expect(actions).toEqual(["previewSetup.dismiss"]); expect(setup.card.open).toBe(false); expect(feedback.log).toEqual([]);
  });

  test("pane tabs and Panels use each tab's local view names, including renamed views", async () => {
    const session = openSession(sessionOfWorkspace(freshWorkspace(), { tab: "A", character: "c-1" }, seededRandom(53)));
    const a = session.tabId(), b = session.duplicate(a);
    const h = await harness([], {}, undefined, session);
    const paint = () => {
      h.panes.sync();
      const views = session.graph.snapshot().views, titles = viewTitles(views);
      const entries = views.map((view, index) => ({ panel: view.panel, title: titles[index]! }));
      for (const entry of entries) h.dock.retitle(entry.panel, entry.title, "");
      const rt = { dock: h.dock, views: h.catalogue, port: { views: { titles: () => entries, modules: () => [], plannedModules: () => [] } } };
      return { entries, rows: panelMenuItems(rt as never, false).filter(item => item.kind === "action" && (item.label.startsWith("3D view") || item.label === "Side view")) };
    };
    expect(paint().rows.map(row => "label" in row ? row.label : "")).toEqual(["3D view"]);
    expect((h.dock.element as unknown as LightElement).querySelectorAll(".dock-tab").some(tab => tab.textContent === "3D view")).toBe(true);
    session.show(a); expect(paint().rows.map(row => "label" in row ? row.label : "")).toEqual(["3D view"]);
    const first = session.graph.snapshot().views.find(view => view.tab === a)!;
    session.addView(first.id, {}, { tab: a, title: "Side view" });
    expect(paint().rows.map(row => "label" in row ? row.label : "")).toEqual(["3D view", "Side view"]);
    const paneTabs = (h.dock.element as unknown as LightElement).querySelectorAll(".dock-tab").map(tab => tab.textContent);
    expect(paneTabs).toContain("3D view"); expect(paneTabs).toContain("Side view");
    session.show(b); expect(paint().rows.map(row => "label" in row ? row.label : "")).toEqual(["3D view"]);
  });
  test("a dock save between showing B and syncing belongs to rendered A and keeps B's floating pane", async () => {
    const session = openSession(sessionOfWorkspace(freshWorkspace(), { tab: "A", character: "c-1" }, seededRandom(43)));
    const a = session.tabId(), b = session.duplicate(a), bPanel = session.graph.snapshot().views.find(view => view.tab === b)!.panel;
    const { panes, dock, group, saves } = await harness([], {}, undefined, session);
    dock.moveTo(bPanel, { kind: "float", x: 100, y: 100, w: 450, h: 350 }, "");
    const customB = structuredClone(session.dock(b)), groupB = group(bPanel)!.id;
    session.show(a); panes.sync();
    saves.length = 0;

    session.show(b); dock.close("history"); panes.sync();

    expect(session.dock(b)).toEqual(customB);
    expect(group(bPanel)?.id).toBe(groupB);
    expect(dock.tree.floating).toHaveLength(1);
    expect(session.dock(a)!.state).toMatchObject({ wide: { closed: expect.arrayContaining([session.instance("history", a)]) } });
    expect(saves).toHaveLength(2); // A's close, then B's whole arrangement; no intermediate destination save.
    panes.sync(); expect(saves).toHaveLength(2);
    // A real edit after the switch still saves once, and is never mistaken for an external restore.
    dock.close("history");
    const editedB = structuredClone(session.dock(b));
    expect(editedB!.state).toMatchObject({ wide: { closed: expect.arrayContaining([session.instance("history", b)]) } });
    expect(saves).toHaveLength(3);
    panes.sync(); expect(saves).toHaveLength(3);
    session.show(a); panes.sync();
    expect(dock.tree.closed).toContain("history");
    session.show(b); panes.sync();
    expect(session.dock(b)).toEqual(editedB);
    expect(group(bPanel)?.id).toBe(groupB);
  });

  test("switching A to B keeps B's custom arrangement through the real session, dock and save relay", async () => {
    const session = openSession(sessionOfWorkspace(freshWorkspace(), { tab: "A", character: "c-1" }, seededRandom(41)));
    const a = session.tabId(), b = session.duplicate(a), bPanel = session.graph.snapshot().views.find(view => view.tab === b)!.panel;
    const { panes, dock, group, saves } = await harness([], {}, undefined, session);
    dock.moveTo(bPanel, { kind: "float", x: 100, y: 100, w: 450, h: 350 }, "");
    const customB = structuredClone(session.dock(b)), groupB = group(bPanel)!.id;
    session.show(a); panes.sync();
    const keptA = structuredClone(session.dock(a));
    saves.length = 0;
    session.show(b);
    // The timing probe's `loaded` checkpoint must capture the destination before loading,
    // in the phase-2 dock's alias currency (047 D1 / 044 D2), while storage keeps instance IDs.
    const projectedB = session.legacyDock()!;
    expect(projectedB).not.toEqual(customB);
    expect(serializeDockState(dock.dockState)).not.toEqual(projectedB);
    panes.sync();
    expect(serializeDockState(dock.dockState)).toEqual(projectedB);
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
    let records: { id: string; panel: string; tab?: string; title?: string }[] = [{ id: "main", panel: "head", tab: "a" }, { id: "v2", panel: "view.v2", tab: "a" }];
    const frame = (head: DrawnViews) => ({
      viewport: { head: { phase: "ready", width: 300, height: 200, captured: false, ...head } },
      views: { views: records },
      viewTitles: viewTitles(records).map((title, index) => ({ view: records[index]!.id, panel: records[index]!.panel, title, subject: "" })),
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
    records = [{ id: "main", panel: "head", tab: "a" }, { id: "v2", panel: "view.v2", tab: "b" }];
    side.update(frame({ drawn: "main", onCanvas: "main" }) as never);
    expect(el(side).querySelector(".viewport-idle-title")!.textContent).toBe("3D view");
    expect(el(side).getAttribute("aria-label")).toBe("3D view, not shown. Press Enter to show it here.");
    records[1]!.title = "Portrait";
    side.update(frame({ drawn: "main", onCanvas: "main" }) as never);
    expect(el(side).querySelector(".viewport-idle-title")!.textContent).toBe("Portrait");
    expect(el(side).getAttribute("aria-label")).toBe("Portrait, not shown. Press Enter to show it here.");
    side.dispose?.(); main.dispose?.();
  });
});

// Contribution registration shares the view/session owner and its save relay.
const registrationContribution = (ids: string[]): ViewContribution => ({ owner: "test", activity: [], panels: ids.map((id, order) => ({ id, title: id,
  icon: "layers", description: id, slot: "stage", order })) });
const registrationArea = { x: 0, y: 0, w: 800, h: 600 };
const registrationInitial = (ratio: number): DockTree => ({ root: split("row", [group(["experiment.panel"], "experiment.panel", "ga"),
  group(["b"], "b", "gb"), group(["c"], "c", "gc")], [.2, .8 * ratio, .8 * (1 - ratio)], "row"), floating: [], closed: [] });

function registrationHarness(writable = true) {
  const life = new AbortController(), s = openSession(sessionOfWorkspace(freshWorkspace(), { tab: "A" }, seededRandom(91)));
  const a = s.tabId(); s.arrange(a, serializeDockState({ wide: registrationInitial(.375), compact: registrationInitial(.375) }));
  const b = s.duplicate(a); s.arrange(b, serializeDockState({ wide: registrationInitial(.8), compact: registrationInitial(.8) })); s.show(a);
  let generation = 0, applied = 0, enabled = true, serial = 0;
  let catalogue = viewCatalogue([registrationContribution(["experiment.panel", "b", "c"])]);
  const disposed: number[] = [], replacements: { serial: number; spec: PanelSpec; instance?: string }[] = [];
  const make = (id: string) => {
    const item = { serial: serial++, spec: { id, title: `${id} ${serial}`, icon: "layers" as const, description: id, element: document.createElement("div") },
      instance: undefined as string | undefined, update() {}, bind(instance: string | undefined) { item.instance = instance; } };
    item.spec.element.textContent = item.spec.title; return item;
  };
  let controllers = [make("experiment.panel"), make("b"), make("c")];
  const saves: string[] = [], destinations: (string | undefined)[] = [];
  let dock!: DockView;
  const owner = new ViewPanels({
    arrangement: () => ({ tab: s.tabId(), layout: s.legacyDock(s.tabId()) }),
    instances: { controllers: () => controllers, instance: (panel, tab) => s.inputInstance(panel, tab) },
    contributions: { pending: () => generation !== applied, reconcile: tab => {
      destinations.push(tab);
      const old = controllers.filter(controller => controller.spec.id === "experiment.panel");
      controllers = controllers.filter(controller => controller.spec.id !== "experiment.panel");
      if (enabled) { const made = make("experiment.panel"); controllers.push(made); replacements.push(made); }
      catalogue = viewCatalogue([registrationContribution(enabled ? ["experiment.panel", "b", "c"] : ["b", "c"])]);
      applied = generation;
      return () => { for (const item of old) {
        expect(dock.panel(item.spec.id)?.element).not.toBe(item.spec.element);
        expect(item.spec.element.isConnected).toBe(false); disposed.push(item.serial);
      } };
    } },
    views: () => [], drawn: () => ({}), make: () => { throw Error("No 3D pane in this fixture"); }, catalogue() {}, attach() {}, spec: panel => panel.spec,
    restore: (layout, tab) => {
      destinations.push(tab);
      dock.load(restoreDockPreference(layout, registrationArea, catalogue, [], [], true).state, controllers.map(controller => controller.spec));
    },
    save: (tab, state) => { if (!tab) throw Error("Save must name its destination"); if (writable) { saves.push(tab); s.arrange(tab, serializeDockState(state)); } },
    dock: { addPanels: specs => dock.addPanels(specs), removePanels: (ids, options) => dock.removePanels(ids, options),
      cancelDrag: () => dock.cancelDrag(), get dockState() { return dock.dockState; } },
  });
  owner.start();
  const state = restoreDockPreference(s.legacyDock(a), registrationArea, catalogue, [], [], true).state;
  dock = new DockView({ signal: life.signal, panels: controllers.map(controller => controller.spec), state, sizeClass: () => "wide", defaults: () => registrationInitial(.375),
    save: state => owner.save(state), announce() {} });
  dock.element.getBoundingClientRect = () => ({ ...registrationArea, width: registrationArea.w, height: registrationArea.h, left: 0, top: 0, right: registrationArea.w, bottom: registrationArea.h, toJSON() {} });
  lightDocument.body.append(dock.element as unknown as LightElement); dock.render();
  return { s, a, b, dock, owner, saves, destinations, disposed, replacements, initialController: controllers[0]!,
    flag(on: boolean) { enabled = on; generation++; }, stop: () => life.abort() };
}

test("review H1: queued registration and A→B share one destination transaction; A is never overwritten", () => {
  const h = registrationHarness();
  try {
    const a = h.s.dock(h.a), b = h.s.dock(h.b), history = h.s.graph.history(), instances = h.s.tab(h.b)!.panels;
    h.s.show(h.b); h.flag(false); h.owner.sync();
    expect(h.destinations).toEqual([h.b, h.b]); expect(h.saves).toEqual([h.b]);
    expect(h.s.dock(h.a)).toEqual(a);
    expect(h.s.tab(h.b)!.panels).toEqual(instances);
    expect(h.s.dock(h.b)).not.toEqual(b); expect(h.s.graph.history()).toEqual(history);
    expect(h.dock.panel("experiment.panel")).toBeUndefined();
  } finally { h.stop(); }
});

test("review M2: off/on before a paint replaces the spec and controller together, before old-controller disposal", () => {
  const h = registrationHarness();
  try {
    const old = h.initialController, instance = h.s.instance("experiment.panel"), history = h.s.graph.history();
    h.flag(false); h.flag(true); h.owner.sync();
    const next = h.replacements.at(-1)!;
    expect(h.disposed).toEqual([old.serial]); expect(next.instance).toBe(instance);
    expect(h.dock.panel("experiment.panel")).toBe(next.spec);
    expect(next.spec.element.isConnected).toBe(true); expect(old.spec.element.isConnected).toBe(false);
    expect(h.dock.element.textContent).toContain(next.spec.title); expect(h.s.graph.history()).toEqual(history);
  } finally { h.stop(); }
});

test("a retained module context reads instances from the rendered owner before and after tab synchronization", async () => {
  const { moduleViewContext } = await import("../src/studio-ui/views/feature-context");
  const h = registrationHarness();
  try {
    const context = moduleViewContext({ port: { module: () => ({}),
      panels: { instance: (panel: string, tab?: string) => h.s.inputInstance(panel, tab) } } } as never, "test", () => h.owner.tabId());
    const a = h.s.inputInstance("experiment.panel", h.a), b = h.s.inputInstance("experiment.panel", h.b);
    expect(a).not.toBe(b);
    h.s.show(h.b); expect(context.instance("experiment.panel")).toBe(a);
    h.owner.sync(); expect(context.instance("experiment.panel")).toBe(b);
    h.s.show(h.a); h.owner.sync(); expect(context.instance("experiment.panel")).toBe(a);
    expect(h.disposed).toEqual([]);
  } finally { h.stop(); }
});

test("registration-only reconciliation keeps read-only local resizes while leaving the stored session unchanged", () => {
  const h = registrationHarness(false);
  try {
    const before = h.s.session(); h.flag(false); h.owner.sync();
    const root = h.dock.tree.root as SplitNode;
    h.dock.update(setSizes(h.dock.tree, root.id, [.8, .2]));
    h.flag(true); h.owner.sync();
    expect((h.dock.tree.root as SplitNode).sizes).toEqual([.2, .64, .16]);
    expect(h.s.session()).toEqual(before); expect(h.saves).toEqual([]);
  } finally { h.stop(); }
});

function withWindow(run: () => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: lightDocument });
  try { run(); } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor); else Reflect.deleteProperty(globalThis, "window");
  }
}
function startDrag(dock: DockView) {
  const tab = (dock.element as unknown as LightElement).querySelector('[data-panel="experiment.panel"]')!;
  tab.dispatchEvent(lightEvent("pointerdown", { button: 0, pointerId: 1, clientX: 50, clientY: 50 }));
  lightDocument.dispatchEvent(lightEvent("pointermove", { pointerId: 1, clientX: 70, clientY: 70 }));
  expect(dock.dragging()).toBe(true);
}
test.each([false, true])("review M3: withdrawal cancels a pending/active drag before replacing specs; active=%s", active => withWindow(() => {
  const h = registrationHarness();
  try {
    if (active) startDrag(h.dock);
    else (h.dock.element as unknown as LightElement).querySelector('[data-panel="experiment.panel"]')!
      .dispatchEvent(lightEvent("pointerdown", { button: 0, pointerId: 1, clientX: 50, clientY: 50 }));
    h.flag(false); h.owner.sync();
    expect(h.dock.dragging()).toBe(false);
    const after = h.dock.dockState, saves = h.saves.length;
    lightDocument.dispatchEvent(lightEvent("pointermove", { pointerId: 1, clientX: 90, clientY: 90 }));
    expect(() => lightDocument.dispatchEvent(lightEvent("pointerup", { pointerId: 1, clientX: 160, clientY: 100 }))).not.toThrow();
    expect(h.dock.dockState).toEqual(after); expect(h.saves).toHaveLength(saves);
    expect(locate(h.dock.tree, "experiment.panel")).toBeUndefined(); expect(h.dock.tree.parked?.["experiment.panel"]).toBeDefined();
    expect(h.dock.panel("experiment.panel")).toBeUndefined();
  } finally { h.stop(); }
}));

test("registration model: withdrawal/return interleaved with tab switches, drags and resizes preserves authored geometry and identities", () => withWindow(() => {
  const deadline = performance.now() + 15_000;
  for (let seed = 1; seed <= 24; seed++) {
    const random = seededRandom(seed), h = registrationHarness();
    // This account is independent of dock restoration: commands update authored ratio, float coordinates and visibility directly.
    const model = new Map([h.a, h.b].map((tab, index) => [tab, { ratio: index ? .8 : .375, share: .2, floating: false, x: 40, y: 50, available: true }]));
    const identities = h.s.tabList().map(tab => tab.panels.filter(panel => panel.type === "experiment.panel").map(panel => panel.id));
    const timeline = h.s.graph.history();
    let shown = h.a, enabled = true;
    try {
      for (let step = 0; step < 60; step++) {
        if (performance.now() > deadline) throw Error("Registration model exceeded 15-second deadline");
        const op = step < 7 ? step : Math.floor(random() * 7);
        if (op === 0) { shown = shown === h.a ? h.b : h.a; h.s.show(shown); }
        if (op === 1 || op === 5) { enabled = !enabled; h.flag(enabled); }
        if (op === 2) { h.flag(false); h.flag(true); enabled = true; }
        h.owner.sync(); model.get(shown)!.available = enabled;
        const current = model.get(shown)!;
        if (op === 3) {
          current.ratio = .1 + random() * .8;
          const root = h.dock.tree.root as SplitNode;
          const sizes = root.children.map(child => allGroups({ root: child, floating: [], closed: [] }).some(({ group }) => group.panels.includes("experiment.panel")) ? current.share
            : (allGroups({ root: child, floating: [], closed: [] }).some(({ group }) => group.panels.includes("b")) ? current.ratio : 1 - current.ratio)
              * (enabled && !current.floating ? 1 - current.share : 1));
          h.dock.update(setSizes(h.dock.tree, root.id, sizes));
        }
        if (op === 4 && enabled) {
          if (current.floating) { h.dock.update(applyDrop(h.dock.tree, { kind: "panel", panelId: "experiment.panel" }, { kind: "edge", side: "left" })); current.share = .24; }
          else { current.x = 40 + seed; current.y = 50 + seed; h.dock.update(applyDrop(h.dock.tree, { kind: "panel", panelId: "experiment.panel" },
            { kind: "float", x: current.x, y: current.y, w: 320, h: 360 })); }
          current.floating = !current.floating;
        }
        if (op === 6 && enabled) {
          startDrag(h.dock);
          if (random() < .5) { shown = shown === h.a ? h.b : h.a; h.s.show(shown); }
          enabled = false; h.flag(false); h.owner.sync(); model.get(shown)!.available = false;
          lightDocument.dispatchEvent(lightEvent("pointerup", { clientX: 200, clientY: 100, pointerId: 1 }));
        }
        expect(h.s.tabId()).toBe(shown);
        expect(h.s.graph.history()).toEqual(timeline);
        expect(h.s.tabList().map(tab => tab.panels.filter(panel => panel.type === "experiment.panel").map(panel => panel.id))).toEqual(identities);
        for (const [tab, expected] of model) {
          const tree = (h.s.legacyDock(tab)!.state as unknown as DockState).wide;
          const a = locate(tree, "experiment.panel");
          expect(!!a).toBe(expected.available);
          if (a) {
            expect(!!a.windowId).toBe(expected.floating);
            if (expected.floating) expect(tree.floating.find(window => window.id === a.windowId)).toMatchObject({ x: expected.x, y: expected.y });
          }
          const root = tree.root as SplitNode;
          const shares = root.children.map(child => ({ id: allGroups({ root: child, floating: [], closed: [] })[0]!.group.panels[0]!, share: root.sizes[root.children.indexOf(child)]! }));
          const b = shares.find(item => item.id === "b")!.share, c = shares.find(item => item.id === "c")!.share;
          expect(b / (b + c)).toBeCloseTo(expected.ratio, 9);
          if (a && !expected.floating) expect(shares.find(item => item.id === "experiment.panel")!.share).toBeCloseTo(expected.share, 9);
        }
      }
    } catch (error) { throw Error(`Registration model seed ${seed}`, { cause: error }); }
    finally { h.stop(); }
  }
}), 20_000);
