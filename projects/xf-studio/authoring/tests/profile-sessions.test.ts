/**
 * Profiles phase 2, chunk P2-i (experiment 044 §4): `ProfileSessions`, the one owner of a profile session's tabs, view graph and focus, and
 * the one View and lighting history over all three (profiles design §3.7, §4.1).
 *
 * - **T1, model-based and seeded.** Random runs of operations (new tab, close, reopen, reset, rename, move, duplicate, add and close a view,
 *   a light change) with Undo and Redo between them are checked after every move against an independent model: a plain-data account of
 *   the tabs, their views in the graph's order and the closed fragments, with its own history of states. The stored session is
 *   byte-identical to the one each state recorded, at every Undo and Redo, at the start and at the end. Runs with navigation interleaved
 *   (showing tabs, focusing views, arranging panels, showing another look) keep every structural invariant and the model's account.
 * - **The phase's gate:** close, then Undo, restores the session byte for byte; close, then Reopen, too (the fragment keeps its views'
 *   focus numbers, D13); an Undo can never put a view into a missing tab.
 * - **Persistence:** the session stores, with its tabs, closed fragments and shown tab, through the workspace's own serialisation and reads
 *   back byte-identical (sessions are workspace data, design §1.2; library documents go through the outbox).
 */
import { describe, expect, test } from "bun:test";
import { profileSessionOf, type ProfileSessionData } from "../src/app/profiles/profile-session";
import { sessionOfWorkspace, workspaceProfiles } from "../src/app/profiles/profiles-migration-data";
import { PROFILES_MIGRATION } from "../src/app/profiles/profile-session";
import { type ProfileSessions, type TabContent } from "../src/app/profiles/profile-sessions";
import type { DockLayout } from "../src/app/ui-preferences";
import { parseWorkspace, serializeWorkspace } from "../src/app/workspace/workspace-state";
import { createTrustedAuthoringCore } from "../src/app/trusted-authoring-core";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { MAIN_VIEW, SLOT_COLLECTIONS, VIEW_SLOTS, type StoredNode, type ViewRecord } from "../src/platform/api/view-graph";
import { createHistoryService, viewScope } from "../src/platform/core/history-service";
import { freshWorkspace } from "./fixtures/eye-region";
import { openSession, seededRandom } from "./fixtures/profile-sessions";

const LOOK = { collection: "11111111-1111-4111-8111-111111111111", look: "22222222-2222-4222-8222-222222222222" };
const OTHER_LOOK = { collection: "11111111-1111-4111-8111-111111111111", look: "33333333-3333-4333-8333-333333333333" };
const json = (s: ProfileSessions) => JSON.stringify(s.session());
const pick = <T>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
/** A dock arrangement holding `panels` (panel IDs) in one group, in both size classes. */
const dockOf = (panels: readonly string[]): DockLayout => ({ format: "xfs-dock", version: 1, state: {
  wide: { root: { kind: "group", id: "g1", panels: [...panels], active: panels[0] ?? null } },
  compact: { root: { kind: "group", id: "g1", panels: [...panels], active: panels[0] ?? null } } } });

/** A session of two tabs: tab 1 holds the main view and a view sharing its scene, tab 2 a duplicate of tab 1; both arranged. */
function startData(seed: number): ProfileSessionData {
  const random = seededRandom(seed);
  const s = openSession(sessionOfWorkspace(freshWorkspace(), { tab: "Layout 1", character: "c-1", look: LOOK }, random), { random });
  const v2 = s.addView(MAIN_VIEW, { scene: true, lights: true }, { title: "Side" });
  s.arrange(s.tabId(), dockOf(["presets", "layers", "head", `view.${v2}`]));
  s.focus.focusView(v2);
  s.duplicate(s.tabId());
  s.rename(s.tabId(), "Second");
  s.show(s.tabList()[0]!.id);
  return profileSessionOf(structuredClone(s.session()))!;
}
/** A window opening that session: a fresh history over it. */
const open = (seed: number) => openSession(startData(seed), { random: seededRandom(seed + 7919) });

/** New content: a view copied from `from` with fresh IDs (or naming `from`'s scene: a shared scene), and a Presets panel. */
function contentFrom(s: ProfileSessions, from: string, share: boolean, name = "Made"): TabContent {
  const data = s.session().views, view = data.views.find(item => item.id === from) as ViewRecord;
  const nodes: TabContent["nodes"][number][] = [], refs = {} as Record<(typeof VIEW_SLOTS)[number], string>;
  for (const slot of VIEW_SLOTS) {
    if (slot === "scene" && share) { refs.scene = view.scene; continue; }
    const node = (data[SLOT_COLLECTIONS[slot]] as readonly StoredNode[]).find(item => item.id === view[slot])!, id = s.freshId(slot);
    nodes.push({ slot, node: { ...structuredClone(node), id, ...(slot === "scene" ? { look: OTHER_LOOK, gen: 0 } : {}) } });
    refs[slot] = id;
  }
  const id = s.freshId("view"), presets = s.freshInstance("presets");
  return { name, origin: "eye-makeup/default", dock: dockOf([presets]), panels: [{ id: presets, type: "presets" }],
    views: [{ id, kind: "3d", ...refs }], nodes };
}

// ----- The independent model -----
type ModelTab = { id: string; name: string; origin?: string };
type ModelClosed = { id: string; name: string; origin?: string; at: number; views: { id: string; at: number }[] };
type Model = { tabs: ModelTab[]; views: { id: string; tab: string }[]; closed: ModelClosed[] };
/** What the model accounts for, read from the session: tabs in order, views in the graph's order with their tabs, closed fragments. */
function account(s: ProfileSessions): Model {
  return { tabs: s.tabList().map(tab => ({ id: tab.id, name: tab.name, ...(tab.origin ? { origin: tab.origin } : {}) })),
    views: s.graph.viewIds().map(id => ({ id, tab: s.graph.tabOf(id)! })),
    closed: s.closedTabs().map(item => ({ id: item.tab.id, name: item.tab.name, ...(item.tab.origin ? { origin: item.tab.origin } : {}), at: item.at,
      views: item.views.map(view => ({ id: view.view.id, at: view.at })) })) };
}
const copy = (m: Model): Model => structuredClone(m);
const model = {
  rename: (m: Model, tab: string, name: string) => { const next = copy(m); next.tabs.find(item => item.id === tab)!.name = name; return next; },
  move: (m: Model, tab: string, to: number) => {
    const next = copy(m), from = next.tabs.findIndex(item => item.id === tab), [moved] = next.tabs.splice(from, 1);
    next.tabs.splice(to, 0, moved!); return next;
  },
  fragment: (m: Model, tab: string): ModelClosed => {
    const at = m.tabs.findIndex(item => item.id === tab), header = m.tabs[at]!;
    return { ...structuredClone(header), at, views: m.views.flatMap((view, index) => view.tab === tab ? [{ id: view.id, at: index }] : []) };
  },
  close: (m: Model, tab: string) => {
    const next = copy(m), fragment = model.fragment(m, tab);
    next.tabs = next.tabs.filter(item => item.id !== tab); next.views = next.views.filter(view => view.tab !== tab);
    next.closed = [...next.closed, fragment].slice(-5);
    return next;
  },
  /** Reopen the newest fragment of tab `closed` as tab `id`. */
  reopen: (m: Model, closed: string, id: string) => {
    const next = copy(m), index = next.closed.map(item => item.id).lastIndexOf(closed), { at, views, ...header } = next.closed[index]!;
    next.closed.splice(index, 1);
    for (const view of [...views].sort((a, b) => a.at - b.at)) next.views.splice(Math.min(view.at, next.views.length), 0, { id: view.id, tab: id });
    next.tabs.splice(Math.min(at, next.tabs.length), 0, { ...header, id });
    return next;
  },
  insert: (m: Model, tab: ModelTab, at: number, views: readonly string[]) => {
    const next = copy(m);
    next.tabs.splice(at, 0, tab); next.views.push(...views.map(id => ({ id, tab: tab.id })));
    return next;
  },
  reset: (m: Model, tab: string, origin: string, views: readonly string[]) => {
    const next = copy(m), fragment = model.fragment(m, tab);
    next.views = [...next.views.filter(view => view.tab !== tab), ...views.map(id => ({ id, tab }))];
    next.tabs.find(item => item.id === tab)!.origin = origin;
    next.closed = [...next.closed, fragment].slice(-5);
    return next;
  },
  addView: (m: Model, from: string, id: string) => { const next = copy(m); next.views.push({ id, tab: m.views.find(view => view.id === from)!.tab }); return next; },
  closeView: (m: Model, view: string) => { const next = copy(m); next.views = next.views.filter(item => item.id !== view); return next; },
};

/** The structural rules every state keeps: tabs unique, each view in a live tab, instance IDs unique, a shown tab while any exists. */
function invariants(s: ProfileSessions) {
  const tabs = s.tabList(), ids = new Set(tabs.map(tab => tab.id));
  expect(ids.size).toBe(tabs.length);
  for (const view of s.graph.viewIds()) expect(ids.has(s.graph.tabOf(view)!)).toBe(true);
  const instances = tabs.flatMap(tab => tab.panels.map(panel => panel.id));
  expect(new Set(instances).size).toBe(instances.length);
  expect(tabs.length ? ids.has(s.tabId()) : s.tabId() === "").toBe(true);
  // The stored session reads back as it is.
  const stored = s.session();
  expect(profileSessionOf(structuredClone(stored))).toEqual(stored);
}

type Run = { s: ProfileSessions; m: Model; states: { model: Model; stored: string }[]; at: number };
/** One random forward operation, applied to the session and the model; false when none applies. */
function step(run: Run, random: () => number, n: number): boolean {
  const { s } = run, tabs = s.tabList(), views = s.graph.viewIds(), kinds: string[] = ["newTab", "light"];
  if (tabs.length) kinds.push("rename", "close", "duplicate", "reset", "newTab");
  if (tabs.length > 1) kinds.push("move");
  if (s.closedTabs().length) kinds.push("reopen", "reopen");
  if (views.length) kinds.push("addView", "light");
  if (views.length > 1) kinds.push("closeView");
  const kind = pick(random, kinds);
  let next: Model;
  if (kind === "rename") { const tab = pick(random, tabs).id, name = `Tab ${n}`; s.rename(tab, name); next = model.rename(run.m, tab, name); }
  else if (kind === "move") {
    const from = Math.floor(random() * tabs.length), to = (from + 1 + Math.floor(random() * (tabs.length - 1))) % tabs.length;
    s.move(tabs[from]!.id, to); next = model.move(run.m, tabs[from]!.id, to);
  } else if (kind === "close") { const tab = pick(random, tabs).id; s.close(tab); next = model.close(run.m, tab); }
  else if (kind === "reopen") {
    const chosen = pick(random, s.closedTabs()).tab.id, id = s.reopen(chosen);
    expect(s.tabId()).toBe(id);
    next = model.reopen(run.m, chosen, id);
  } else if (kind === "duplicate") {
    const source = pick(random, tabs), at = tabs.indexOf(source), id = s.duplicate(source.id);
    next = model.insert(run.m, { id, name: source.name, ...(source.origin ? { origin: source.origin } : {}) }, at + 1,
      s.graph.viewIds().filter(view => s.graph.tabOf(view) === id));
    expect(s.graph.viewIds().filter(view => s.graph.tabOf(view) === id).length).toBe(views.filter(view => s.graph.tabOf(view) === source.id).length);
  } else if (kind === "newTab") {
    const content = views.length ? contentFrom(s, pick(random, views), random() < .5, `New ${n}`)
      : { name: `New ${n}`, dock: null, panels: [], views: [], nodes: [] };
    const id = s.newTab(content);
    next = model.insert(run.m, { id, name: content.name, ...(content.origin ? { origin: content.origin } : {}) }, tabs.length, content.views.map(view => view.id));
  } else if (kind === "reset") {
    const tab = pick(random, tabs).id, content = views.length ? contentFrom(s, pick(random, views), random() < .5, "ignored")
      : { name: "ignored", origin: "eye-makeup/default", dock: null, panels: [], views: [], nodes: [] };
    s.reset(tab, content);
    next = model.reset(run.m, tab, content.origin!, content.views.map(view => view.id));
  } else if (kind === "addView") { const from = pick(random, views), id = s.addView(from, { scene: random() < .5 }); next = model.addView(run.m, from, id); }
  else if (kind === "closeView") { const view = pick(random, views); s.closeView(view); next = model.closeView(run.m, view); }
  else {
    // A graph's own step (a display setting) beside the session's operations.
    const view = pick(random, views), hair = s.graph.state<{ hair?: boolean }>(view, "display").hair !== true;
    s.graph.edit(view, "display", { state: { hair } }, { label: "Hair" });
    next = copy(run.m);
  }
  run.m = next;
  run.states = [...run.states.slice(0, run.at + 1), { model: copy(next), stored: json(s) }];
  run.at = run.states.length - 1;
  return true;
}
/** Undo or Redo, in the session and the model: the session must then be byte-identical to the state the model reached. */
function move(run: Run, direction: "undo" | "redo") {
  const target = direction === "undo" ? run.at - 1 : run.at + 1;
  if (target < 0 || target >= run.states.length) { expect(direction === "undo" ? run.s.graph.undo() : run.s.graph.redo()).toBe(false); return; }
  expect(direction === "undo" ? run.s.graph.undo() : run.s.graph.redo()).toBe(true);
  run.at = target; run.m = copy(run.states[target]!.model);
  expect(json(run.s)).toBe(run.states[target]!.stored);
}

describe("T1: seeded random runs against an independent model", () => {
  test("every operation matches the model; every Undo and Redo is byte-identical to the state it reaches; Undo to the start and Redo to the end are too", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const random = seededRandom(seed * 31), s = open(seed);
      const run: Run = { s, m: account(s), states: [{ model: account(s), stored: json(s) }], at: 0 };
      for (let n = 0; n < 40; n++) {
        const roll = random();
        if (roll < .2) move(run, "undo");
        else if (roll < .3) move(run, "redo");
        else step(run, random, n);
        expect(account(s)).toEqual(run.m);
        invariants(s);
      }
      // Undo to the start, then Redo to the end.
      const end = run.states.length - 1;
      while (run.at > 0) move(run, "undo");
      expect(json(s)).toBe(run.states[0]!.stored);
      expect(s.graph.undo()).toBe(false);
      while (run.at < end) move(run, "redo");
      expect(json(s)).toBe(run.states[end]!.stored);
      invariants(s);
    }
  });

  test("with navigation between the operations (show, focus, arrange, another look), the model's account and every invariant hold", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const random = seededRandom(seed * 131), s = open(seed);
      const run: Run = { s, m: account(s), states: [{ model: account(s), stored: json(s) }], at: 0 };
      for (let n = 0; n < 45; n++) {
        const roll = random(), tabs = s.tabList(), views = s.graph.viewIds();
        if (roll < .15 && run.at > 0) { expect(s.graph.undo()).toBe(true); run.at--; run.m = copy(run.states[run.at]!.model); }
        else if (roll < .22 && run.at < run.states.length - 1) { expect(s.graph.redo()).toBe(true); run.at++; run.m = copy(run.states[run.at]!.model); }
        else if (roll < .3 && tabs.length) s.show(pick(random, tabs).id);
        else if (roll < .38 && views.length) s.focus.focusView(pick(random, views));
        else if (roll < .46 && tabs.length) {
          const tab = pick(random, tabs).id, own = views.filter(view => s.graph.tabOf(view) === tab).map(view => view === MAIN_VIEW ? "head" : `view.${view}`);
          s.arrange(tab, dockOf([...own, pick(random, ["presets", "layers", "history"])]));
        } else if (roll < .5 && views.length) s.setLook(s.graph.node(pick(random, views), "scene").id, random() < .5 ? OTHER_LOOK : LOOK);
        else step(run, random, n);
        expect(account(s)).toEqual(run.m);
        invariants(s);
      }
    }
  });
});

describe("the phase's gates", () => {
  test("close, then Undo, restores the session byte for byte; so does close, then Reopen (the views' focus numbers come back)", () => {
    const s = open(3), [first, second] = s.tabList();
    s.focus.focusView(MAIN_VIEW);
    const before = json(s);
    // The shown tab, whose views share a scene: closed, the neighbour is shown; Undo shows it again.
    s.close(first!.id);
    expect(s.tabId()).toBe(second!.id);
    expect(s.session().focus.views).not.toHaveProperty(MAIN_VIEW);
    expect(s.graph.undo()).toBe(true);
    expect(json(s)).toBe(before);
    s.close(first!.id);
    expect(s.reopen()).toBe(first!.id);
    expect(json(s)).toBe(before);
    // A tab not shown: Undo leaves the shown tab; Reopen shows the reopened tab (and only that differs).
    s.close(second!.id);
    expect(s.tabId()).toBe(first!.id);
    expect(s.graph.undo()).toBe(true);
    expect(json(s)).toBe(before);
    s.close(second!.id);
    s.reopen(second!.id);
    expect(s.tabId()).toBe(second!.id);
    s.show(first!.id);
    expect(json(s)).toBe(before);
    // Closed fragments survive a restart, with their views' focus numbers, and a reopen there is byte-identical too.
    s.close(first!.id);
    const restarted = openSession(profileSessionOf(JSON.parse(json(s)))!);
    expect(json(restarted)).toBe(json(s));
    expect(restarted.focus.viewOrder()).not.toHaveProperty(MAIN_VIEW);
    restarted.reopen(first!.id);
    expect(json(restarted)).toBe(before);
  });

  test("a tab that shares a scene with another tab: closing keeps the scene for the other, and Reopen links it again", () => {
    const s = open(5), tab = s.tabId(), scene = s.graph.node(MAIN_VIEW, "scene").id;
    const id = s.newTab(contentFrom(s, MAIN_VIEW, true));
    const made = s.graph.viewIds().find(view => s.graph.tabOf(view) === id)!;
    expect(s.graph.node(made, "scene").id).toBe(scene);
    const before = json(s);
    s.close(tab);
    expect(s.graph.node(made, "scene").id).toBe(scene);
    s.reopen(tab);
    expect(s.graph.node(MAIN_VIEW, "scene").id).toBe(scene);
    s.show(id);
    expect(json(s)).toBe(before);
  });

  test("an Undo can never put a view into a missing tab: such a step is refused whole, and an unrecorded change clears the steps", () => {
    const s = open(9), [first, second] = s.tabList();
    // Hand the history a step that would bring back a view of a tab that is gone: refused, nothing changes.
    const target = (s as unknown as { historyTarget(): { apply(values: Record<string, unknown>, cause: string): boolean } }).historyTarget();
    const structure = s.graph.data().views.map(view => ({ ...view }));
    const before = json(s);
    expect(target.apply({ "@structure": { views: [...structure, { ...structure[0], id: "v-stray", tab: "t-gone" }] } }, "undo")).toBe(false);
    expect(target.apply({ "@tabs": { order: [first!.id], closed: [] }, [`@tab:${second!.id}`]: undefined, [`@content:${second!.id}`]: undefined }, "undo")).toBe(false);
    expect(json(s)).toBe(before);
    // A tab closed outside the history (restore-time state) leaves no step behind that could bring its views back.
    s.rename(first!.id, "Renamed");
    expect(s.graph.history().depth).toBe(1);
    s.graph.withoutHistory(() => s.close(second!.id));
    expect(s.graph.history().depth).toBe(0);
  });
});

describe("one history over the session and the graph", () => {
  test("each operation is one step, its graph edits inside it; the graph's own edits are steps beside them; the View and lighting Undo reaches both", () => {
    const history = createHistoryService(), s = openSession(startData(11), { history }), tab = s.tabId();
    const core = createTrustedAuthoringCore({ ...freshWorkspace() }, { history, views: s.graph, resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
    core.app.attach({ tabs: s });
    expect(core.views).toBe(s.graph);
    expect(history.scope(viewScope("p-1"))).toBeDefined();
    s.close(tab);
    expect(s.graph.history()).toMatchObject({ undo: "Close tab", depth: 1 });
    s.graph.edit(s.graph.viewIds()[0]!, "display", { state: { hair: false } }, { label: "Hair" });
    s.reopen();
    expect(s.graph.history()).toMatchObject({ undo: "Reopen tab", depth: 3 });
    expect(core.app.dispatch({ kind: "view.undo" })).toMatchObject({ ok: true });
    expect(core.app.dispatch({ kind: "view.undo" })).toMatchObject({ ok: true });
    expect(core.app.dispatch({ kind: "view.undo" })).toMatchObject({ ok: true });
    expect(s.tab(tab)).toBeDefined();
    expect(s.graph.history()).toMatchObject({ depth: 0, redo: "Close tab" });
    // Focus and navigation never enter it.
    s.show(s.tabList()[1]!.id); s.focus.focusView(MAIN_VIEW); s.arrange(tab, dockOf(["presets"]));
    expect(s.graph.history()).toMatchObject({ depth: 0, redo: "Close tab" });
    // Undo of a rename leaves the arrangement the dock saved since.
    s.rename(tab, "Mine"); s.arrange(tab, dockOf(["layers", "head"]));
    expect(s.graph.undo()).toBe(true);
    expect(s.tab(tab)!.name).not.toBe("Mine");
    expect(s.dock(tab)).toEqual(dockOf(["layers", "head"]));
  });

  test("the tabs.* actions: each names its tab, is refused plainly when it can't run, and acts once allowed", () => {
    const history = createHistoryService(), s = openSession(startData(13), { history }), tab = s.tabId();
    const core = createTrustedAuthoringCore({ ...freshWorkspace() }, { history, views: s.graph, resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
    core.app.attach({ tabs: s });
    expect(core.app.capability({ kind: "tabs.close", tab: "t-missing" })).toMatchObject({ available: false, code: "missing_target" });
    expect(core.app.capability({ kind: "tabs.rename", tab, name: "  " })).toMatchObject({ available: false, code: "invalid_value" });
    expect(s.capability({ kind: "tabs.rename", tab, name: "bell" })).toMatchObject({ available: false, reason: "Use letters, numbers and punctuation in the name." });
    expect(core.app.capability({ kind: "tabs.rename", tab, name: "x".repeat(61) })).toMatchObject({ available: false });
    expect(core.app.capability({ kind: "tabs.reopen" })).toMatchObject({ available: false, reason: "There is no closed tab to reopen." });
    expect(core.app.dispatch({ kind: "tabs.rename", tab, name: " Eyes " })).toMatchObject({ ok: true });
    expect(s.tab(tab)!.name).toBe("Eyes");
    expect(core.app.dispatch({ kind: "tabs.duplicate", tab })).toMatchObject({ ok: true });
    expect(s.tabList().map(item => item.name)).toEqual(["Eyes", "Eyes", "Second"]);
    expect(core.app.dispatch({ kind: "tabs.move", tab, to: 2 })).toMatchObject({ ok: true });
    expect(s.tabList().at(-1)!.id).toBe(tab);
    expect(core.app.dispatch({ kind: "tabs.close", tab })).toMatchObject({ ok: true });
    expect(core.app.dispatch({ kind: "tabs.reopen" })).toMatchObject({ ok: true });
    expect(core.app.dispatch({ kind: "tabs.show", tab })).toMatchObject({ ok: true });
    expect(core.app.dispatch({ kind: "tabs.arrange", tab, layout: dockOf(["presets"]) })).toMatchObject({ ok: true });
    expect(s.dock(tab)).toEqual(dockOf(["presets"]));
    // The dock reset to its default arrangement.
    expect(core.app.dispatch({ kind: "tabs.arrange", tab, layout: null })).toMatchObject({ ok: true });
    expect(s.dock(tab)).toBeNull();
  });
});

describe("operations", () => {
  test("a duplicate shares nothing: fresh IDs everywhere (scenes included), what each scene shows, pins and the arrangement following", () => {
    const s = open(17), tab = s.tabId(), id = s.duplicate(tab);
    const own = (t: string) => s.graph.viewIds().filter(view => s.graph.tabOf(view) === t);
    const nodes = (t: string) => new Set(own(t).flatMap(view => VIEW_SLOTS.map(slot => s.graph.node(view, slot).id)));
    expect([...nodes(id)].filter(node => nodes(tab).has(node))).toEqual([]);
    expect(own(id).map(view => s.knownScene(s.graph.node(view, "scene").id)?.look)).toEqual(own(tab).map(() => LOOK));
    const copy = s.tab(id)!, source = s.tab(tab)!;
    expect(copy.panels.map(panel => panel.type)).toEqual(source.panels.map(panel => panel.type));
    expect(copy.panels.some(panel => source.panels.some(other => other.id === panel.id))).toBe(false);
    const pinned = copy.panels.filter(panel => panel.type === "view").map(panel => (panel.binding as { target: { view: string } }).target.view);
    expect(pinned.every(view => own(id).includes(view))).toBe(true);
    const views = (text: string) => text.replaceAll(/"(head|view\.[a-z0-9-]+)"/g, '"view.*"');
    expect(views(JSON.stringify(s.dock(id)))).toBe(views(JSON.stringify(s.dock(tab))));
  });

  test("reset: the content before it is kept as a fragment beside the tab; Undo restores it all; reopening the fragment makes a tab of its own", () => {
    const s = open(19), tab = s.tabId(), before = json(s), old = s.graph.viewIds().filter(view => s.graph.tabOf(view) === tab);
    const content = contentFrom(s, MAIN_VIEW, false);
    s.reset(tab, content);
    expect(s.tab(tab)).toMatchObject({ origin: "eye-makeup/default", name: "Layout 1" });
    expect(s.graph.viewIds().filter(view => s.graph.tabOf(view) === tab)).toEqual([content.views[0]!.id]);
    expect(s.closedTabs().at(-1)).toMatchObject({ reset: true, tab: { id: tab } });
    expect(s.graph.undo()).toBe(true);
    expect(json(s)).toBe(before);
    expect(s.graph.redo()).toBe(true);
    const again = s.reopen();
    expect(again).not.toBe(tab);
    expect(s.graph.viewIds().filter(view => s.graph.tabOf(view) === again)).toEqual(old);
  });

  test("IDs are never used twice, across a restart too: new IDs avoid what the session holds, held and keeps in closed fragments", () => {
    // A random source that repeats every few draws: fresh IDs still never collide.
    let n = 0;
    const cyclic = () => ((n++ * 7919) % 36) / 36, s = openSession(startData(23), { random: cyclic });
    const seen = new Set(JSON.stringify(s.session()).match(/"(t|v|s|c|l|d|x)-[0-9a-z]{8,}"/g) ?? []);
    for (let i = 0; i < 12; i++) {
      const tab = s.duplicate(s.tabId());
      s.close(tab);
      for (const id of JSON.stringify(s.session()).match(/"(t|v|s|c|l|d|x)-[0-9a-z]{8,}"/g) ?? []) seen.add(id);
    }
    const ids = [s.freshId("tab"), s.freshId("view"), s.freshId("scene"), s.freshInstance("presets")];
    expect(ids.every(id => !seen.has(`"${id}"`))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("an empty session is valid: every tab closed, it stores and reads back, and a new tab fills it", () => {
    const s = open(29);
    for (const tab of s.tabList()) s.close(tab.id);
    expect(s.tabList()).toEqual([]);
    expect(s.graph.viewIds()).toEqual([]);
    expect(s.tabId()).toBe("");
    const stored = s.session(), read = profileSessionOf(structuredClone(stored))!;
    expect(read).toEqual(stored);
    const restarted = openSession(read);
    expect(restarted.tabList()).toEqual([]);
    const id = restarted.newTab({ name: "Fresh", dock: null, panels: [], views: [], nodes: [] });
    expect(restarted.tabId()).toBe(id);
    expect(restarted.reopen()).toBeTruthy();
  });
});

describe("persistence", () => {
  test("the session stores through the workspace with every tab, its closed fragments and the shown tab, and reads back byte-identical", () => {
    const s = open(31), [first, second] = s.tabList();
    s.close(second!.id);
    s.duplicate(first!.id);
    s.focus.focusView(MAIN_VIEW);
    const workspace = { ...freshWorkspace(), migration: { id: PROFILES_MIGRATION, token: "00000000-0000-4000-8000-000000000001", state: "done" } as const,
      profiles: s.stored() };
    const text = JSON.stringify(serializeWorkspace(workspace, STUDIO_DOCUMENTS));
    const read = parseWorkspace(JSON.parse(text), STUDIO_DOCUMENTS);
    const again = openSession(read.profiles!.sessions["p-1"]!);
    expect(json(again)).toBe(json(s));
    expect(again.tabId()).toBe(s.tabId());
    expect(again.closedTabs().map(item => item.tab.id)).toEqual([second!.id]);
    expect(JSON.stringify(serializeWorkspace({ ...read, profiles: workspaceProfiles("p-1", again.session()) }, STUDIO_DOCUMENTS))).toBe(text);
  });

  test("a stored fragment that collides with the session, or isn't one, is dropped on read; the rest of the session reads", () => {
    const s = open(37), [, second] = s.tabList();
    s.close(second!.id);
    const stored = structuredClone(s.session()) as unknown as { closed: unknown[]; tabs: { id: string }[] };
    stored.closed.push({ ...(stored.closed[0] as object) }, { tab: { id: "t-bad" }, at: -1 });
    stored.closed.unshift({ ...(stored.closed[0] as object), tab: { ...(stored.closed[0] as { tab: object }).tab, id: stored.tabs[0]!.id } });
    const read = profileSessionOf(stored)!;
    expect(read.closed.map(item => item.tab.id)).toEqual([second!.id]);
  });
});
