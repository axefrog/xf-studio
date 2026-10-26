/** Reproductions from the independent P3-i review of 94664e06. */
import { expect, test } from "bun:test";
import { sessionOfWorkspace } from "../src/app/profiles/profiles-migration-data";
import { PanelActions } from "../src/app/profiles/panel-actions";
import { panelDock, dockWith } from "../src/app/profiles/panel-dock";
import { MAIN_VIEW } from "../src/platform/api/view-graph";
import { createHistoryService, viewScope } from "../src/platform/core/history-service";
import { applyDrop, group, locate, split } from "../src/platform/core/dock-layout";
import { freshWorkspace } from "./fixtures/eye-region";
import { openSession, seededRandom } from "./fixtures/profile-sessions";

const look = (n: number) => ({ collection: "crew", look: `look-${n}` });
function fixture() {
  const history = createHistoryService(), s = openSession(sessionOfWorkspace(freshWorkspace(), { tab: "A", character: "c-1", look: look(1) }, seededRandom(81)), { history });
  return { s, scope: history.scope(viewScope(s.profile))!, tab: s.tabId() };
}

test("review H1: panels.add with New scene copies source B's V/look, including an explicitly empty target", () => {
  const { s, tab, scope } = fixture(), a = s.graph.node(MAIN_VIEW, "scene").id, b = s.addView(MAIN_VIEW, {}), sourceScene = s.graph.node(b, "scene").id;
  s.setSubject(sourceScene, { kind: "character", id: "c-2" }); s.setLook(sourceScene, look(2));
  const actions = new PanelActions(s, { types: () => [{ id: "view" }], factory: () => null, world: () => ({
    views: Object.fromEntries(s.graph.viewIds().map(id => [id, { tab, scene: s.graph.node(id, "scene").id }])),
    scenes: Object.fromEntries([a, sourceScene].map(id => [id, { kind: "character", ...s.scene(id) }])), focus: {}, subject: () => true, look: () => true }) });
  for (const empty of [false, true]) {
    if (empty) { s.setSubject(sourceScene, undefined); s.setLook(sourceScene, undefined); }
    const source = s.scene(sourceScene), first = s.scene(a), depth = scope.state().depth;
    actions.dispatch({ kind: "panels.add", destination: s.panelTabTarget(tab), type: "view", source: { view: b, scene: sourceScene, sceneGen: source.gen, shareScene: false } });
    const view = s.graph.viewIds().at(-1)!, scene = s.graph.node(view, "scene").id;
    expect(scope.state().depth).toBe(depth + 1); expect(scene).not.toBe(sourceScene);
    expect(s.scene(scene)).toEqual({ ...source, gen: 0 }); expect(s.scene(a)).toEqual(first);
    expect(scope.undo()).toBe(true); expect(s.graph.has(view)).toBe(false);
    expect(scope.redo()).toBe(true); expect(s.scene(scene)).toEqual({ ...source, gen: 0 });
    expect(openSession(s.session()).knownScene(scene)).toEqual({ ...source, gen: 0 });
  }
});

test.each(["add", "binding"] as const)("review H2: duplicate then %s, jump to start and forward preserves history and exact instances", kind => {
  const { s, tab, scope } = fixture();
  s.addPanel(tab, "presets"); scope.clear();
  const initial = s.tabList(), duplicate = s.duplicate(tab), panel = kind === "add" ? s.addPanel(duplicate, "presets") : s.instances("presets", duplicate)[0]!.id;
  if (kind === "binding") s.setPanelBinding(duplicate, panel, { policy: "pinned", target: { look: look(2) } });
  const final = s.tabList(), end = scope.timeline().steps.at(-1)!.id;
  expect(scope.jumpTo(scope.timeline().startId)).toBe(true); expect(s.tabList()).toEqual(initial);
  expect(scope.state()).toMatchObject({ depth: 0, redoDepth: 2 });
  expect(scope.jumpTo(end)).toBe(true); expect(s.tabList()).toEqual(final);
  expect(scope.state()).toMatchObject({ depth: 2, redoDepth: 0 });
});

test("review H2: combined jumps across reset apply fields only to the content they belong to", () => {
  const { s, tab, scope } = fixture(), original = s.addPanel(tab, "presets"); scope.clear();
  const initial = s.tabList();
  s.setPanelBinding(tab, original, { policy: "pinned", target: { look: look(2) } });
  s.reset(tab, { name: "Reset", dock: null, panels: [], views: [], nodes: [] });
  const added = s.addPanel(tab, "presets"); s.setPanelBinding(tab, added, { policy: "pinned", target: { look: look(3) } });
  const final = s.tabList(), end = scope.timeline().steps.at(-1)!.id;
  expect(scope.jumpTo(scope.timeline().startId)).toBe(true); expect(s.tabList()).toEqual(initial); expect(s.panel(added)).toBeUndefined();
  expect(scope.jumpTo(end)).toBe(true); expect(s.tabList()).toEqual(final); expect(s.panel(original)).toBeUndefined();
});

test.each(["add", "binding"] as const)("review of 08f1e01f: %s follows pre-reset content reopened in a different tab", kind => {
  const { s, tab, scope } = fixture(), existing = s.addPanel(tab, "presets"); scope.clear();
  const panel = kind === "add" ? s.addPanel(tab, "presets") : existing;
  if (kind === "binding") s.setPanelBinding(tab, panel, { policy: "pinned", target: { look: look(2) } });
  s.reset(tab, { name: "Replacement", dock: null, panels: [], views: [], nodes: [] });
  const reopened = s.reopen(), before = JSON.stringify(s.session()), end = scope.timeline().steps.at(-1)!.id;
  expect(reopened).not.toBe(tab);
  expect(scope.jumpTo(scope.timeline().startId)).toBe(true); expect(scope.jumpTo(end)).toBe(true);
  expect(JSON.stringify(s.session())).toBe(before);
  expect(s.panel(panel)?.tab).toBe(reopened);
  if (kind === "binding") expect(s.panel(panel)?.binding).toEqual({ policy: "pinned", target: { look: look(2) } });
});

test("review M1: ambiguous legacy projection/input refuses before any mutation or identity allocation", () => {
  const { s, tab, scope } = fixture(), a = s.addPanel(tab, "presets"), b = s.addPanel(tab, "presets");
  const state = panelDock(s.dock(tab));
  state.wide = applyDrop(state.wide, { kind: "panel", panelId: b }, { kind: "float", x: 310, y: 91, w: 400, h: 410 });
  s.arrangeInstances(tab, dockWith(s.dock(tab), state));
  const before = s.session(), history = scope.timeline(); let notifications = 0; s.subscribe(() => notifications++);
  expect(() => s.arrange(tab, s.legacyDock(tab))).toThrow(/instance|ambiguous/i);
  const ambiguous = dockWith(null, { wide: { root: group(["new-type", "presets"], undefined, "g-wide"), floating: [], closed: [] },
    compact: { root: group(["presets"], undefined, "g-compact"), floating: [], closed: [] } });
  expect(() => s.arrange(tab, ambiguous)).toThrow(/instance|ambiguous/i);
  expect(s.capability({ kind: "tabs.arrange", tab, layout: ambiguous })).toMatchObject({ available: false, code: "incompatible_mode" });
  expect(() => s.inputInstance("presets", tab)).toThrow(/instance|ambiguous/i);
  expect(s.session()).toEqual(before); expect(scope.timeline()).toEqual(history); expect(notifications).toBe(0);
  expect(s.instances("presets", tab).map(panel => panel.id)).toEqual([a, b]);
});

test("review M2: type Hide and repeated Undo/Redo restore a shared Presets group beside Layers in both sizes", () => {
  const { s, tab, scope } = fixture(), a = s.addPanel(tab, "presets"), b = s.addPanel(tab, "presets"), layers = s.addPanel(tab, "layers");
  const layout = (size: string) => ({ root: split("row", [group(size === "wide" ? [a, b] : [b, a], size === "wide" ? b : a, `presets-${size}`), group([layers], layers, `layers-${size}`)], [.4, .6], `split-${size}`), floating: [], closed: [] });
  s.arrangeInstances(tab, dockWith(null, { wide: layout("wide"), compact: layout("compact") }));
  const depth = scope.state().depth; s.setPanelsOpen(tab, [a, b], false); expect(scope.state().depth).toBe(depth + 1);
  for (let round = 0; round < 3; round++) {
    expect(scope.undo()).toBe(true);
    for (const size of ["wide", "compact"] as const) {
      const tree = panelDock(s.dock(tab))[size], first = locate(tree, a)!, second = locate(tree, b)!;
      expect(first.windowId).toBeUndefined(); expect(second.windowId).toBeUndefined();
      expect(first.group.panels).toEqual(size === "wide" ? [a, b] : [b, a]); expect(first.group.id).toBe(second.group.id); expect(first.group.active).toBe(size === "wide" ? b : a);
      expect(locate(tree, layers)?.group.id).toBe(`layers-${size}`);
      expect(tree.root).toMatchObject({ kind: "split", axis: "row", sizes: [.4, .6] });
    }
    expect(scope.redo()).toBe(true);
  }
});


test("review navigation: binding Undo/Redo in A keeps existing B shown and its focus and arrangement", () => {
  const { s, tab: a, scope } = fixture(), panel = s.addPanel(a, "presets"), b = s.duplicate(a);
  const other = s.instances("presets", b)[0]!.id;
  s.show(a); scope.clear();
  s.setPanelBinding(a, panel, { policy: "pinned", target: { look: look(2) } });
  s.show(b); s.focus.focusPanel(other);
  const view = s.graph.viewIds().find(id => s.viewTab(id) === b)!;
  s.focus.focusView(view);
  const focus = s.focus.snapshot(), dock = s.dock(b);
  expect(scope.undo()).toBe(true);
  expect(s.panel(panel)?.binding).toBeUndefined();
  expect(s.focus.snapshot()).toEqual(focus); expect(s.dock(b)).toEqual(dock);
  expect(scope.redo()).toBe(true);
  expect(s.panel(panel)?.binding).toEqual({ policy: "pinned", target: { look: look(2) } });
  expect(s.focus.snapshot()).toEqual(focus); expect(s.dock(b)).toEqual(dock);
});


test("review navigation: first-view Redo in A leaves existing B shown and focused", () => {
  const { s, tab: a, scope } = fixture(), baseline = s.session().views;
  const b = s.newTab({ name: "B", dock: null, panels: [], views: [], nodes: [] }), panel = s.addPanel(b, "presets");
  scope.clear();
  const view = s.openView(a, baseline, { kind: "character", id: "c-1" });
  s.show(b); s.focus.focusPanel(panel);
  const focus = s.focus.snapshot();
  expect(scope.undo()).toBe(true); expect(s.graph.has(view)).toBe(false); expect(s.focus.snapshot()).toEqual(focus);
  expect(scope.redo()).toBe(true); expect(s.graph.has(view)).toBe(true); expect(s.focus.snapshot()).toEqual(focus);
});
