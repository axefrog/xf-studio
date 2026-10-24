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
 * - **Review P2-1's findings**, one test or more each: every refusal changes nothing (and, since P2-iii, the view the window draws may close:
 *   the drawn view follows the shown tab, `drawnView`); listeners hear a
 *   settled session; replays keep what Undo doesn't hold; the dock relay; tab operations as the editing context; IDs across a restart.
 *   The model's content identities, what it keeps outside Undo and its listener checks extend T1 to the same ground.
 */
import { describe, expect, test } from "bun:test";
import { PANEL_INSTANCE_ID, profileSessionOf, type LayoutTab, type ProfileSessionData } from "../src/app/profiles/profile-session";
import { sessionOfWorkspace, workspaceProfiles } from "../src/app/profiles/profiles-migration-data";
import { PROFILES_MIGRATION } from "../src/app/profiles/profile-session";
import { type ProfileSessions, type TabContent } from "../src/app/profiles/profile-sessions";
import { UIPreferenceActions, type DockLayout } from "../src/app/ui-preferences";
import { drawnView } from "../src/app/profiles/profile-window";
import { parseWorkspace, serializeWorkspace } from "../src/app/workspace/workspace-state";
import { createTrustedAuthoringCore } from "../src/app/trusted-authoring-core";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { MAIN_VIEW, SLOT_COLLECTIONS, VIEW_SLOTS, type StoredNode, type ViewRecord } from "../src/platform/api/view-graph";
import { createHistoryService, lookScope, viewScope, type HistoryService } from "../src/platform/core/history-service";
import { hostRandom } from "../src/platform/core/random";
import { fillOf, fragmentOfTab, instantiateFragment, substitutionOf, type SceneCandidate } from "../src/app/profiles/layout-fragment";
import { STUDIO_LAYOUT_DEFAULTS } from "../src/compose/layout-defaults";
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
const open = (seed: number, history?: HistoryService) => openSession(startData(seed), { random: seededRandom(seed + 7919), ...(history ? { history } : {}) });

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

/**
 * A tab's content made from a default as New tab ▸ makes it (P2-ii): a module's default, or one saved from a random tab of the session,
 * with random substitution choices (each scene shared with a scene showing its V, or new; a random look), instantiated with the session's
 * fresh IDs.
 */
function fromDefault(s: ProfileSessions, random: () => number, name: string): TabContent {
  const tabs = s.tabList(), saved = tabs.length && random() < .4 ? fragmentOfTab(s.session(), pick(random, tabs).id) : undefined;
  const contributed = pick(random, STUDIO_LAYOUT_DEFAULTS), fragment = saved ?? contributed.fragment;
  // A shared scene shares the lights of a view showing it (decision M2).
  const scenes: SceneCandidate[] = [...new Set(s.graph.viewIds().map(view => s.graph.node(view, "scene").id))].map(scene => {
    const view = s.graph.viewIds().find(item => s.graph.node(item, "scene").id === scene)!;
    return { scene, kind: "character", tab: s.viewTab(view), lights: s.graph.node(view, "lights").id, ...s.knownScene(scene) };
  });
  const subjects = [{ kind: "character", id: "c-1" }];
  const choice = { looks: Object.fromEntries(fragment.looks.map(slot => [slot.key, random() < .5 ? LOOK : OTHER_LOOK])),
    scenes: Object.fromEntries(fragment.nodes.filter(node => node.slot === "scene").map((node): [string, string | null] => {
      const shares = scenes.filter(item => item.subject?.id === "c-1");
      return [node.key, random() < .5 || !shares.length ? null : pick(random, shares).scene];
    })) };
  const substitution = substitutionOf(fragment, { subjects, looks: [LOOK, OTHER_LOOK], scenes }, choice);
  if ("issue" in substitution) throw Error(substitution.issue);
  return instantiateFragment(fragment, fillOf(substitution), s, { name, origin: saved ? "d-saved1" : contributed.id });
}

// ----- The independent model -----
/**
 * The model's tabs and fragments carry a content identity (`content`): the arrangement and instances that go with a tab when it closes,
 * reopens or is reset, which the session never names. It is recorded state (Undo restores it with the rest); what that content's
 * arrangement is, and what each scene shows, are not (`Outside`), so Undo and Redo leave them as they are now.
 */
type ModelTab = { id: string; name: string; origin?: string; content: number };
type ModelClosed = { id: string; name: string; origin?: string; content: number; at: number; views: { id: string; at: number }[] };
type Model = { tabs: ModelTab[]; views: { id: string; tab: string }[]; closed: ModelClosed[] };
type Account = { tabs: Omit<ModelTab, "content">[]; views: Model["views"]; closed: Omit<ModelClosed, "content">[] };
/** The state outside Undo: each content's arrangement and instances (as text), and what each scene shows once the model has seen it. */
type Outside = { contents: Map<number, string>; looks: Map<string, { look?: string; gen: number }>; next: number };
/** What the model accounts for, read from the session: tabs in order, views in the graph's order with their tabs, closed fragments. */
function account(s: ProfileSessions): Account {
  return { tabs: s.tabList().map(tab => ({ id: tab.id, name: tab.name, ...(tab.origin ? { origin: tab.origin } : {}) })),
    views: s.graph.viewIds().map(id => ({ id, tab: s.graph.tabOf(id)! })),
    closed: s.closedTabs().map(item => ({ id: item.tab.id, name: item.tab.name, ...(item.tab.origin ? { origin: item.tab.origin } : {}), at: item.at,
      views: item.views.map(view => ({ id: view.view.id, at: view.at })) })) };
}
const accounted = (m: Model): Account => ({ tabs: m.tabs.map(({ content: _c, ...tab }) => tab), views: m.views,
  closed: m.closed.map(({ content: _c, ...item }) => item) });
const contentOf = (tab: Pick<LayoutTab, "dock" | "panels">) => JSON.stringify({ dock: tab.dock, panels: tab.panels });
const lookOf = (target: { look?: { look: string }; gen: number } | undefined) => ({ ...(target?.look ? { look: target.look.look } : {}), gen: target?.gen ?? 0 });
/** The model of a session as it opens: each tab and fragment its own content. */
function modelOf(s: ProfileSessions): { m: Model; outside: Outside } {
  const outside: Outside = { contents: new Map(), looks: new Map(), next: 1 }, a = account(s), tabs = s.tabList(), closed = s.closedTabs();
  const content = (tab: Pick<LayoutTab, "dock" | "panels">) => { const id = outside.next++; outside.contents.set(id, contentOf(tab)); return id; };
  return { m: { tabs: a.tabs.map((tab, i) => ({ ...tab, content: content(tabs[i]!) })), views: a.views,
    closed: a.closed.map((item, i) => ({ ...item, content: content(closed[i]!.tab) })) }, outside };
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
  /** Reopen the newest fragment of tab `closed` as tab `id`, with its content. */
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
  /** Reset tab `tab` to new content `content`: the content before it goes into a fragment. */
  reset: (m: Model, tab: string, origin: string, views: readonly string[], content: number) => {
    const next = copy(m), fragment = model.fragment(m, tab);
    next.views = [...next.views.filter(view => view.tab !== tab), ...views.map(id => ({ id, tab }))];
    Object.assign(next.tabs.find(item => item.id === tab)!, { origin, content });
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
/**
 * Listeners of the graph, focus and the session, each checking what it reads when it hears: every view in a live tab, a live shown tab.
 * Returns what they found wrong (finding 2 of review P2-1: they heard while an operation or a replay was half done).
 */
function watch(s: ProfileSessions): string[] {
  const issues: string[] = [];
  const check = (who: string) => () => {
    const tabs = new Set(s.tabList().map(tab => tab.id));
    for (const view of s.graph.viewIds()) if (!tabs.has(s.graph.tabOf(view)!)) issues.push(`${who} heard view ${view} in missing tab ${s.graph.tabOf(view)}`);
    if (tabs.size ? !tabs.has(s.tabId()) : s.tabId() !== "") issues.push(`${who} heard missing shown tab ${s.tabId()}`);
  };
  s.graph.subscribe(check("graph")); s.focus.subscribe(check("focus")); s.subscribe(check("session"));
  return issues;
}

type Run = { s: ProfileSessions; m: Model; outside: Outside; states: { model: Model; stored: string }[]; at: number; issues: string[] };
function startRun(s: ProfileSessions): Run {
  const { m, outside } = modelOf(s);
  return { s, m, outside, states: [{ model: copy(m), stored: json(s) }], at: 0, issues: watch(s) };
}
/** The model's account and the state outside Undo (each tab's and fragment's arrangement, what each shown scene shows) hold. */
function holds(run: Run) {
  const { s, m, outside } = run;
  expect(account(s)).toEqual(accounted(m));
  s.tabList().forEach((tab, i) => expect(contentOf(tab)).toBe(outside.contents.get(m.tabs[i]!.content)!));
  s.closedTabs().forEach((item, i) => expect(contentOf(item.tab)).toBe(outside.contents.get(m.closed[i]!.content)!));
  for (const view of s.graph.viewIds()) {
    const scene = s.graph.node(view, "scene").id, known = outside.looks.get(scene);
    if (known) expect(lookOf(s.knownScene(scene))).toEqual(known);
  }
  expect(run.issues).toEqual([]);
}
/** A new content identity for what tab `tab` holds now. */
function made(run: Run, tab: string): number {
  const id = run.outside.next++;
  run.outside.contents.set(id, contentOf(run.s.tab(tab)!));
  return id;
}
/** One random forward operation, applied to the session and the model; false when none applies. */
function step(run: Run, random: () => number, n: number): boolean {
  const { s } = run, tabs = s.tabList(), views = s.graph.viewIds(), kinds: string[] = ["newTab"];
  if (tabs.length) kinds.push("rename", "close", "duplicate", "reset", "newTab", "emptyTab", "emptyTab", "resetFromDefault");
  kinds.push("fromDefault");
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
    next = model.insert(run.m, { id, name: source.name, ...(source.origin ? { origin: source.origin } : {}), content: made(run, id) }, at + 1,
      s.graph.viewIds().filter(view => s.graph.tabOf(view) === id));
    expect(s.graph.viewIds().filter(view => s.graph.tabOf(view) === id).length).toBe(views.filter(view => s.graph.tabOf(view) === source.id).length);
  } else if (kind === "newTab" || kind === "emptyTab") {
    const content = views.length && kind === "newTab" ? contentFrom(s, pick(random, views), random() < .5, `New ${n}`)
      : { name: `New ${n}`, dock: null, panels: [], views: [], nodes: [] };
    const id = s.newTab(content);
    next = model.insert(run.m, { id, name: content.name, ...(content.origin ? { origin: content.origin } : {}), content: made(run, id) }, tabs.length,
      content.views.map(view => view.id));
  } else if (kind === "fromDefault") {
    const content = fromDefault(s, random, `Default ${n}`), id = s.newTab(content);
    next = model.insert(run.m, { id, name: content.name, origin: content.origin!, content: made(run, id) }, tabs.length, content.views.map(view => view.id));
  } else if (kind === "resetFromDefault") {
    const tab = pick(random, tabs).id, content = fromDefault(s, random, "ignored");
    s.reset(tab, content);
    next = model.reset(run.m, tab, content.origin!, content.views.map(view => view.id), made(run, tab));
  } else if (kind === "reset") {
    const tab = pick(random, tabs).id, content = views.length && random() < .75 ? contentFrom(s, pick(random, views), random() < .5, "ignored")
      : { name: "ignored", origin: "eye-makeup/default", dock: null, panels: [], views: [], nodes: [] };
    s.reset(tab, content);
    next = model.reset(run.m, tab, content.origin!, content.views.map(view => view.id), made(run, tab));
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
/** Navigation, never a step: arranging a tab (its content's arrangement changes) or showing another look in a view's scene. */
function navigate(run: Run, random: () => number, kind: "arrange" | "look", place?: number) {
  const { s } = run, tabs = s.tabList(), views = s.graph.viewIds();
  if (kind === "arrange") {
    const at = place ?? Math.floor(random() * tabs.length), tab = tabs[at]!.id;
    const own = views.filter(view => s.graph.tabOf(view) === tab).map(view => view === MAIN_VIEW ? "head" : `view.${view}`);
    s.arrange(tab, dockOf([...own, pick(random, ["presets", "layers", "history"])]));
    run.outside.contents.set(run.m.tabs[at]!.content, contentOf(s.tab(tab)!));
  } else {
    const scene = s.graph.node(pick(random, views), "scene").id, look = random() < .5 ? OTHER_LOOK : LOOK;
    const before = run.outside.looks.get(scene) ?? lookOf(s.knownScene(scene));
    s.setLook(scene, look);
    run.outside.looks.set(scene, before.look === look.look ? before : { look: look.look, gen: before.gen + 1 });
  }
}
/**
 * An Undo (or Redo) during which a history listener asks for another (finding 2 of review P2-1-2): the second waits until the first has
 * settled, so two steps move, each whole. Only when two steps are there to move.
 */
function nested(run: Run, history: HistoryService, direction: "undo" | "redo") {
  const target = direction === "undo" ? run.at - 2 : run.at + 2;
  if (target < 0 || target >= run.states.length) return;
  let again = true;
  const stop = history.subscribe(() => {
    if (!again) return;
    again = false;
    expect(direction === "undo" ? run.s.graph.undo() : run.s.graph.redo()).toBe(true);
  });
  try { expect(direction === "undo" ? run.s.graph.undo() : run.s.graph.redo()).toBe(true); } finally { stop(); }
  expect(again).toBe(false);
  run.at = target; run.m = copy(run.states[target]!.model);
  expect(json(run.s)).toBe(run.states[target]!.stored);
}
/**
 * A replay around navigation: close a tab (empty ones too), Undo, arrange it again, Redo. The fragment the Redo brings back must hold the
 * new arrangement (review P2-1 finding 3, and P2-1-2's empty content), which `holds` checks.
 */
function replayAround(run: Run, random: () => number) {
  const { s } = run, tabs = s.tabList(), at = Math.floor(random() * tabs.length), tab = tabs[at]!.id;
  s.close(tab);
  run.m = model.close(run.m, tab);
  run.states = [...run.states.slice(0, run.at + 1), { model: copy(run.m), stored: json(s) }];
  run.at = run.states.length - 1;
  // Navigation came before, so the states' stored bytes no longer apply: the model's account and `holds` check instead.
  expect(s.graph.undo()).toBe(true);
  run.at--; run.m = copy(run.states[run.at]!.model);
  navigate(run, random, "arrange", at);
  expect(s.graph.redo()).toBe(true);
  run.at++; run.m = copy(run.states[run.at]!.model);
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
      const random = seededRandom(seed * 31), history = createHistoryService(), s = open(seed, history), run = startRun(s);
      for (let n = 0; n < 40; n++) {
        const roll = random();
        if (roll < .04) nested(run, history, "undo");
        else if (roll < .06) nested(run, history, "redo");
        else if (roll < .2) move(run, "undo");
        else if (roll < .3) move(run, "redo");
        else step(run, random, n);
        holds(run);
        invariants(s);
      }
      // Undo to the start, then Redo to the end.
      const end = run.states.length - 1;
      while (run.at > 0) move(run, "undo");
      expect(json(s)).toBe(run.states[0]!.stored);
      expect(s.graph.undo()).toBe(false);
      while (run.at < end) move(run, "redo");
      expect(json(s)).toBe(run.states[end]!.stored);
      holds(run);
      invariants(s);
    }
  });

  test("with navigation between the operations (show, focus, arrange, another look), the model's account, what stays outside Undo and every invariant hold", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const random = seededRandom(seed * 131), s = open(seed), run = startRun(s);
      for (let n = 0; n < 45; n++) {
        const roll = random(), tabs = s.tabList(), views = s.graph.viewIds();
        if (roll < .15 && run.at > 0) { expect(s.graph.undo()).toBe(true); run.at--; run.m = copy(run.states[run.at]!.model); }
        else if (roll < .22 && run.at < run.states.length - 1) { expect(s.graph.redo()).toBe(true); run.at++; run.m = copy(run.states[run.at]!.model); }
        else if (roll < .3 && tabs.length) s.show(pick(random, tabs).id);
        else if (roll < .38 && views.length) s.focus.focusView(pick(random, views));
        else if (roll < .46 && tabs.length) navigate(run, random, "arrange");
        else if (roll < .52 && views.length) navigate(run, random, "look");
        else if (roll < .56 && tabs.length) replayAround(run, random);
        else step(run, random, n);
        holds(run);
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

  test("IDs are never used twice within a run, even from a source of randomness that repeats: the session never gives out one it holds, keeps or gave out", () => {
    // A random source that repeats every 997 draws: fresh IDs still never collide.
    let n = 0;
    const cyclic = () => ((n++ * 7919) % 997) / 997, s = openSession(startData(23), { random: cyclic });
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

  test("IDs are never used twice across a restart (finding 6): a session stored with retired IDs, reopened, gives out none of them", () => {
    const s = open(83), given: string[] = [];
    // Views made and closed, and tabs made and closed until their fragments fall out of the last 5: retired, named nowhere.
    for (let i = 0; i < 4; i++) { const view = s.addView(MAIN_VIEW, { scene: i % 2 === 0 }); given.push(view); s.closeView(view); }
    for (let i = 0; i < 7; i++) {
      const tab = s.duplicate(s.tabList()[1]!.id);
      given.push(tab, ...s.graph.viewIds().filter(view => s.graph.tabOf(view) === tab), ...s.tab(tab)!.panels.map(panel => panel.id));
      s.close(tab);
    }
    const stored = json(s), retired = given.filter(id => !stored.includes(`"${id}"`));
    expect(retired.length).toBeGreaterThan(10);
    // A real restart: a new window, with the platform's source of randomness (a seeded source given the same seed repeats by design).
    const restarted = openSession(profileSessionOf(JSON.parse(stored))!, { random: hostRandom().next });
    expect(json(restarted)).toBe(stored);
    const view = restarted.addView(MAIN_VIEW, { scene: true }), tab = restarted.duplicate(restarted.tabList()[1]!.id);
    const fresh = [view, tab, ...restarted.graph.viewIds().filter(item => restarted.graph.tabOf(item) === tab), ...restarted.tab(tab)!.panels.map(panel => panel.id),
      restarted.freshId("tab"), restarted.freshId("view"), restarted.freshId("scene"), restarted.freshInstance("presets")];
    expect(fresh.filter(id => given.includes(id) || stored.includes(`"${id}"`))).toEqual([]);
    // Over 128 bits of randomness each (a panel instance: the stored format's 12 characters), so none recurs in practice.
    for (const id of fresh) expect(id).toMatch(id.includes("--") ? PANEL_INSTANCE_ID : /^[tvscldx]-[0-9a-z]{25}$/);
    // The session with them stores and reads back as itself.
    expect(profileSessionOf(structuredClone(restarted.session()))).toEqual(restarted.session());
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

describe("refusals change nothing (review P2-1, finding 1)", () => {
  test("P2-iii: the view the window draws may close; the drawn view follows the shown tab to another of its views, or to none", () => {
    const s = openSession(startData(41), { random: seededRandom(41) }), [first, second] = s.tabList();
    // The window draws the shown tab's most recently focused view (`drawnView`); a listener reading it on every change, as the window's
    // does, always finds a view of the shown tab, or none.
    const drawn: (string | undefined)[] = [];
    const follow = () => { const view = drawnView(s); expect(view === undefined || s.graph.tabOf(view) === s.tabId()).toBe(true); drawn.push(view); };
    s.subscribe(follow);
    const beside = s.graph.viewIds().find(view => view !== MAIN_VIEW && s.graph.tabOf(view) === first!.id)!;
    expect(drawnView(s)).toBe(beside);
    expect(s.capability({ kind: "tabs.close", tab: first!.id })).toEqual({ available: true });
    // The drawn view closes: the tab's other view is drawn.
    s.closeView(beside);
    expect(drawnView(s)).toBe(MAIN_VIEW);
    // The tab holding it resets: the tab's new view is drawn.
    s.reset(first!.id, contentFrom(s, MAIN_VIEW, false));
    const made = drawnView(s)!;
    expect([made !== MAIN_VIEW, s.graph.tabOf(made)]).toEqual([true, first!.id]);
    // The tab closes: the other tab is shown, and its most recently focused view drawn.
    s.close(first!.id);
    expect(s.tabList().map(tab => tab.id)).toEqual([second!.id]);
    expect(s.graph.tabOf(drawnView(s)!)).toBe(second!.id);
    // A tab without a view draws none.
    for (const view of s.graph.viewIds()) s.closeView(view);
    expect(drawnView(s)).toBeUndefined();
    expect(drawn.at(-1)).toBeUndefined();
    invariants(s);
  });

  test("every refused operation leaves the session, its history and every listener untouched", () => {
    const history = createHistoryService(), s = openSession(startData(43), { history, random: seededRandom(43) });
    const [first, second] = s.tabList();
    s.rename(second!.id, "Renamed");
    let heard = 0;
    s.subscribe(() => heard++); s.graph.subscribe(() => heard++); s.focus.subscribe(() => heard++); history.subscribe(() => heard++);
    const content = () => contentFrom(s, MAIN_VIEW, false), main = s.graph.data().views.find(view => view.id === MAIN_VIEW) as ViewRecord;
    const refusals: [string, () => unknown][] = [
      ["close a closed tab", () => s.close("t-gone")],
      ["reset a closed tab", () => s.reset("t-gone", content())],
      ["reset with IDs taken", () => s.reset(second!.id, { ...content(), views: [{ ...main, id: MAIN_VIEW }] })],
      ["rename to nothing", () => s.rename(first!.id, "  ")],
      ["rename with a control character", () => s.rename(first!.id, "a\u0007")],
      ["rename a closed tab", () => s.rename("t-gone", "Name")],
      ["move a closed tab", () => s.move("t-gone", 0)],
      ["reopen with nothing closed", () => s.reopen()],
      ["reopen a fragment no longer kept", () => s.reopen("t-gone")],
      ["a new tab whose IDs are taken", () => s.newTab({ ...content(), views: [{ ...main, id: MAIN_VIEW }] })],
      ["a new tab without a name", () => s.newTab({ ...content(), name: " " })],
      // Checked by the graph inside the operation: refused there before anything changes.
      ["a new tab whose view names a missing node", () => s.newTab({ ...content(), views: [{ ...content().views[0]!, scene: "s-missing" }] })],
      ["duplicate a closed tab", () => s.duplicate("t-gone")],
      ["a view in a closed tab", () => s.addView(MAIN_VIEW, { scene: true }, { tab: "t-gone" })],
      ["a view copied from a closed view", () => s.addView("v-gone", { scene: true })],
      ["close a closed view", () => s.closeView("v-gone")],
      ["show a closed tab", () => s.show("t-gone")],
      ["arrange a closed tab", () => s.arrange("t-gone", null)],
    ];
    for (const [what, run] of refusals) {
      const before = json(s), steps = s.graph.history(), timeline = history.scope(viewScope("p-1"))!.timeline(), editing = history.focus.recent();
      heard = 0;
      let threw = false;
      try { run(); } catch { threw = true; }
      expect([what, threw, heard]).toEqual([what, true, 0]);
      expect(json(s)).toBe(before);
      expect(s.graph.history()).toEqual(steps);
      expect(history.scope(viewScope("p-1"))!.timeline()).toEqual(timeline);
      expect(history.focus.recent()).toEqual(editing);
    }
    // The step recorded before them is still there to undo.
    expect(s.graph.undo()).toBe(true);
    expect(s.tab(second!.id)!.name).not.toBe("Renamed");
  });

  test("P2-iii: an Undo or Redo that closes the drawn view runs, and the drawn view moves to another view of the shown tab", () => {
    const history = createHistoryService(), s = openSession(startData(47), { history, random: seededRandom(47) });
    const core = createTrustedAuthoringCore({ ...freshWorkspace() }, { history, views: s.graph, resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
    // Undo of a new view that is drawn now (focused, as a press in its pane focuses it).
    const added = s.addView(MAIN_VIEW, { scene: true });
    s.focus.focusView(added);
    expect(drawnView(s)).toBe(added);
    expect(core.app.capability({ kind: "view.undo" })).toEqual({ available: true });
    expect(s.graph.undo()).toBe(true);
    expect(s.graph.has(added)).toBe(false);
    expect([drawnView(s) !== undefined, s.graph.tabOf(drawnView(s)!)]).toEqual([true, s.tabId()]);
    // Redo of closing a view that is drawn now.
    const other = s.addView(MAIN_VIEW, { scene: true });
    s.closeView(other);
    expect(s.graph.undo()).toBe(true);
    s.focus.focusView(other);
    expect(drawnView(s)).toBe(other);
    expect(s.graph.redo()).toBe(true);
    expect(s.graph.has(other)).toBe(false);
    expect(drawnView(s)).not.toBe(other);
    invariants(s);
  });
});

describe("listeners hear a settled session (review P2-1, finding 2)", () => {
  test("graph, focus and session listeners hear once an operation, Undo or Redo has settled: never a view in a missing tab, a missing shown tab or a step not yet recorded", () => {
    const s = open(53), issues = watch(s), [first, second] = s.tabList();
    let depth = -1, sessions = 0;
    s.graph.subscribe(() => { depth = s.graph.history().depth; });
    s.subscribe(() => sessions++);
    const id = s.duplicate(first!.id);
    expect(depth).toBe(s.graph.history().depth);
    expect(sessions).toBe(1);
    // Undo of the duplicate takes away the shown tab; Redo brings it back.
    expect(s.graph.undo()).toBe(true);
    expect(s.graph.redo()).toBe(true);
    expect(s.tabId()).toBe(id);
    s.close(id); s.close(first!.id);
    expect(s.graph.undo()).toBe(true); expect(s.graph.undo()).toBe(true);
    s.close(second!.id);
    s.reopen(second!.id);
    expect(s.graph.undo()).toBe(true); expect(s.graph.redo()).toBe(true);
    expect(issues).toEqual([]);
  });

  test("a listener that throws can't leave the session invalid: the operation has settled with its step, the others hear, and nothing stays held", () => {
    const s = open(59), [first] = s.tabList(), depth = s.graph.history().depth;
    let others = 0;
    s.graph.subscribe(() => { throw Error("A broken listener"); });
    s.subscribe(() => others++);
    expect(() => s.duplicate(first!.id)).toThrow("A broken listener");
    expect(s.tabList()).toHaveLength(3);
    expect(s.tabId()).toBe(s.tabList()[1]!.id);
    expect(s.graph.history().depth).toBe(depth + 1);
    expect(others).toBe(1);
    invariants(s);
    expect(() => s.graph.undo()).toThrow("A broken listener");
    expect(s.tabList()).toHaveLength(2);
    expect(s.tabId()).toBe(first!.id);
    expect(others).toBe(2);
    invariants(s);
    s.rename(first!.id, "After");
    expect(others).toBe(3);
  });
});

describe("replays keep what Undo doesn't hold (review P2-1, finding 3)", () => {
  test("close, Undo, arrange the tab again, Redo, Reopen: it comes back as last arranged, after a restart too", () => {
    const s = open(61), [, second] = s.tabList();
    s.close(second!.id);
    expect(s.graph.undo()).toBe(true);
    s.arrange(second!.id, dockOf(["layers", "presets"]));
    const arranged = s.tab(second!.id)!;
    expect(s.graph.redo()).toBe(true);
    expect(s.closedTabs().at(-1)!.tab).toMatchObject({ dock: arranged.dock, panels: arranged.panels });
    const restarted = openSession(profileSessionOf(JSON.parse(json(s)))!);
    for (const session of [s, restarted]) {
      session.reopen(second!.id);
      expect(session.dock(second!.id)).toEqual(dockOf(["layers", "presets"]));
    }
  });

  test("close, Undo, show another look in its scene, Redo, Reopen: the scene shows that look with its generation, after a restart too", () => {
    const s = open(67), [, second] = s.tabList(), view = s.graph.viewIds().find(item => s.graph.tabOf(item) === second!.id)!;
    const scene = s.graph.node(view, "scene").id;
    s.close(second!.id);
    expect(s.graph.undo()).toBe(true);
    s.setLook(scene, OTHER_LOOK);
    const shown = s.knownScene(scene)!;
    expect(shown).toMatchObject({ look: OTHER_LOOK, gen: 1 });
    expect(s.graph.redo()).toBe(true);
    expect(s.closedTabs().at(-1)!.nodes.find(item => item.node.id === scene)!.node).toMatchObject({ look: OTHER_LOOK, gen: 1 });
    const restarted = openSession(profileSessionOf(JSON.parse(json(s)))!);
    for (const session of [s, restarted]) {
      session.reopen(second!.id);
      expect(session.knownScene(scene)).toEqual(shown);
    }
  });

  test("close, Reopen, arrange, then Undo twice: the tab comes back as last arranged; Redo twice keeps it", () => {
    const s = open(71), [, second] = s.tabList();
    s.close(second!.id);
    s.reopen(second!.id);
    s.arrange(second!.id, dockOf(["history"]));
    const arranged = s.tab(second!.id)!;
    expect(s.graph.undo()).toBe(true);
    expect(s.closedTabs().at(-1)!.tab).toMatchObject({ dock: arranged.dock, panels: arranged.panels });
    expect(s.graph.undo()).toBe(true);
    expect(s.dock(second!.id)).toEqual(dockOf(["history"]));
    expect(s.graph.redo()).toBe(true); expect(s.graph.redo()).toBe(true);
    expect(s.dock(second!.id)).toEqual(dockOf(["history"]));
  });

  test("reset, Undo, arrange the tab, Redo, Reopen the fragment: the content before the reset comes back as last arranged", () => {
    const s = open(73), tab = s.tabId();
    s.reset(tab, contentFrom(s, MAIN_VIEW, false));
    expect(s.graph.undo()).toBe(true);
    s.arrange(tab, dockOf(["head", "layers"]));
    expect(s.graph.redo()).toBe(true);
    const id = s.reopen();
    expect(s.dock(id)).toEqual(dockOf(["head", "layers"]));
  });
});

test("legacy preferences never relay into the tab arrangement", () => {
  const s = open(77), before = s.dock();
  const preferences = new UIPreferenceActions(freshWorkspace().uiPreferences);
  preferences.dispatch({ kind: "layout.set", layout: dockOf(["layers"]) });
  preferences.dispatch({ kind: "theme.set", theme: "dark" });
  expect(s.dock()).toEqual(before);
});

describe("the editing context (review P2-1, finding 5)", () => {
  test("a recorded tab operation becomes the editing context: after a look edit and Rename tab, global Undo undoes the rename; showing, focusing and arranging don't change it", () => {
    const history = createHistoryService(), s = openSession(startData(79), { history }), tab = s.tabId();
    let value = 1;
    const look = history.open(lookScope(LOOK), { read: () => value, apply: values => { value = values.x as number; return true; } });
    look.checkpoint(["x"], { label: "Layer change", actionKind: "layer.edit" });
    value = 2;
    expect(history.focus.editing()).toBe(lookScope(LOOK));
    s.rename(tab, "Renamed");
    expect(history.focus.editing()).toBe(viewScope("p-1"));
    s.show(s.tabList()[1]!.id); s.focus.focusView(MAIN_VIEW); s.arrange(tab, dockOf(["layers"]));
    expect(history.focus.editing()).toBe(viewScope("p-1"));
    // Global Undo acts on the editing context (the input layer's `acting`): the rename, not the look.
    const acting = history.acting(history.focus.recent())!;
    expect(acting.id).toBe(viewScope("p-1"));
    expect(acting.command({ kind: "history.undo" })).toBe(true);
    expect(s.tab(tab)!.name).not.toBe("Renamed");
    expect(value).toBe(2);
    // The look's history is next once the session's has nothing left of it.
    expect(history.focus.recent()).toEqual([viewScope("p-1"), lookScope(LOOK)]);
  });
});

describe("review P2-1-2: committed changes are always heard, one move at a time, empty content keeps its identity", () => {
  test("a history listener that throws while an operation's step is published: the operation stands, recorded, and the session's listeners still hear", () => {
    const history = createHistoryService(), s = open(89, history), tab = s.tabId();
    s.rename(tab, "Once");
    let heard = 0;
    s.subscribe(() => heard++);
    const depth = s.graph.history().depth;
    const stop = history.subscribe(() => { throw Error("A broken history listener"); });
    expect(() => s.rename(tab, "Twice")).toThrow("A broken history listener");
    stop();
    expect(s.tab(tab)!.name).toBe("Twice");
    expect(s.graph.history()).toMatchObject({ depth: depth + 1, undo: "Rename tab" });
    expect(heard).toBe(1);
    invariants(s);
  });

  test("an Undo asked for by a history listener during an Undo waits until the first has settled: listeners never hear a view in a missing tab, and each move publishes its graph change", () => {
    const history = createHistoryService(), s = open(97, history), issues = watch(s), [first, second] = s.tabList();
    const before = json(s);
    s.close(second!.id); s.close(first!.id);
    const structures: string[][] = [];
    s.graph.subscribe(change => { if (change.structure) structures.push([...change.views]); });
    let again = true;
    const stop = history.subscribe(() => { if (again) { again = false; expect(s.graph.undo()).toBe(true); } });
    expect(s.graph.undo()).toBe(true);
    stop();
    expect(again).toBe(false);
    expect(json(s)).toBe(before);
    expect(structures).toHaveLength(2);
    expect(issues).toEqual([]);
    // Redo too: a listener's Redo waits for the Redo in progress.
    again = true;
    const redo = history.subscribe(() => { if (again) { again = false; expect(s.graph.redo()).toBe(true); } });
    expect(s.graph.redo()).toBe(true);
    redo();
    expect(s.tabList()).toEqual([]);
    expect(structures).toHaveLength(4);
    expect(issues).toEqual([]);
  });

  test("a tab with no instances: close, Undo, arrange its first panel, Redo, Reopen brings it back as arranged, after a restart too", () => {
    const s = open(101), tab = s.newTab({ name: "Empty", dock: null, panels: [], views: [], nodes: [] });
    s.close(tab);
    expect(s.graph.undo()).toBe(true);
    s.arrange(tab, dockOf(["presets"]));
    expect(s.tab(tab)!.panels).toHaveLength(1);
    expect(s.graph.redo()).toBe(true);
    expect(s.closedTabs().at(-1)!.tab.dock).not.toBeNull();
    const restarted = openSession(profileSessionOf(JSON.parse(json(s)))!);
    for (const session of [s, restarted]) {
      session.reopen(tab);
      expect(session.dock(tab)).toEqual(dockOf(["presets"]));
    }
    // Its identity is the session's own: nothing of it is stored or read out.
    expect(json(s)).not.toContain("@content");
    expect(JSON.stringify(s.tabList())).not.toContain("@content");
  });
});
