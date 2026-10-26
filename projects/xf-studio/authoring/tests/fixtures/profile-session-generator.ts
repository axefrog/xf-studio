/** G3 state machine: independent recorded-state oracle, live navigation invariants and arrangement round trips. */
import { parentPort, workerData } from "node:worker_threads";
import { ProfileSessions, TabRefusal, type TabContent } from "../../src/app/profiles/profile-sessions";
import { PROFILE_SESSION_SCHEMA, type ProfileSessionData } from "../../src/app/profiles/profile-session";
import { createHistoryService, viewScope, type HistoryScope } from "../../src/platform/core/history-service";
import { panelDock, dockWith } from "../../src/app/profiles/panel-dock";
import { applyDrop, group, locate, allGroups, setCollapsed, setSizes, setWindowRect, activate } from "../../src/platform/core/dock-layout";
import { VIEW_GRAPH_1, VIEW_SLOTS, SLOT_COLLECTIONS, type ViewGraphData, type ViewGraphRules, type ViewRecord, type ViewSlot } from "../../src/platform/api/view-graph";
import { ViewGraph } from "../../src/platform/core/view-graph";
import { PanelActions } from "../../src/app/profiles/panel-actions";
import type { Recipe } from "../../src/engines/layered-makeup/recipe";
import { livePart } from "../../src/app/workspace/collection-workspace";
import { AsyncContextModel, EditContextModel, SessionModel, sessionAccount } from "./profile-session-model";
import { seededRandom } from "./profile-sessions";

const KINDS = ["add", "show", "park", "bind", "drag", "new", "reset", "close", "reopen", "duplicate", "undo", "redo", "start", "end", "point", "switch", "focus", "scene", "addView", "closeView", "link", "hide", "collapse", "resize", "split", "activate", "readonly", "withdraw"] as const;
export type Command = { op: typeof KINDS[number]; tab: number; panel: number; value: number };
// Exercise the real graph/history owners with small valid node payloads; Studio codecs and full rendering state have their own model tests.
const rules: ViewGraphRules = { codecs: {
  scene: { kinds: ["character"], parse: state => ({ ...state }) }, camera: { kinds: ["orbit"], parse: state => ({ ...state }) },
  lights: { kinds: ["studio"], parse: state => ({ ...state }) }, display: { parse: state => ({ ...state }) }, tools: { parse: state => ({ ...state }) },
}, scenes: [{ kind: "character", cameras: ["orbit"], rigs: ["studio"] }] };
const blueprint: ViewGraphData = { schema: VIEW_GRAPH_1,
  views: [{ id: "main", kind: "3d", scene: "s1", camera: "c1", lights: "l1", display: "d1", tools: "x1" }],
  scenes: [{ id: "s1", kind: "character" }], cameras: [{ id: "c1", kind: "orbit" }], lights: [{ id: "l1", kind: "studio" }],
  display: [{ id: "d1" }], tools: [{ id: "x1" }] };
const initial: ProfileSessionData = { schema: PROFILE_SESSION_SCHEMA, tabs: [{ id: "t-initial", name: "Initial", dock: null, panels: [] }],
  views: { ...blueprint, views: blueprint.views.map(view => ({ ...view, tab: "t-initial" })),
    scenes: blueprint.scenes.map(scene => ({ ...scene, gen: 0 })) }, focus: { views: {} }, closed: [], seq: 0 };
class LawFailure extends Error { constructor(readonly law: string, detail: string) { super(`${law}: ${detail}`); } }
function equal(actual: unknown, expected: unknown, law: string) {
  if (Bun.deepEquals(actual, expected)) return;
  const a = typeof actual === "string" ? actual : JSON.stringify(actual) ?? "undefined", b = typeof expected === "string" ? expected : JSON.stringify(expected) ?? "undefined";
  let at = 0; while (at < Math.min(a.length, b.length) && a[at] === b[at]) at++;
  throw new LawFailure(law, `byte ${at}; actual ${a.slice(Math.max(0, at - 60), at + 150)}; expected ${b.slice(Math.max(0, at - 60), at + 150)}`);
}
const serial = (s: ProfileSessions) => JSON.stringify(s.session());
function invariants(data: ProfileSessionData) {
  const instances = [...data.tabs, ...data.closed.map(fragment => fragment.tab)].flatMap(tab => tab.panels.map(panel => panel.id));
  if (new Set(instances).size !== instances.length) throw new LawFailure("identities", "duplicate panel instance ID");
  const tabs = new Set(data.tabs.map(tab => tab.id));
  if (data.views.views.some(view => !tabs.has(view.tab))) throw new LawFailure("views", "orphaned view");
}
function content(s: ProfileSessions, n: number): TabContent {
  const panel = s.freshInstance("presets"), view = s.freshId("view"), source = blueprint.views[0]! as ViewRecord, refs = Object.fromEntries(VIEW_SLOTS.map(slot => [slot, s.freshId(slot)])) as Record<ViewSlot, string>;
  const tree = { root: group([panel], panel, `g-${panel}`), floating: [], closed: [] };
  return { name: `Made ${n}`, dock: dockWith(null, { wide: tree, compact: tree }), panels: [{ id: panel, type: "presets", state: { seed: n } }],
    views: [{ ...source, ...refs, id: view }], nodes: VIEW_SLOTS.map(slot => ({ slot,
      node: { ...structuredClone(blueprint[SLOT_COLLECTIONS[slot]].find(node => node.id === source[slot])!), id: refs[slot]! } })) };
}
const clone = <T>(value: T): T => structuredClone(value);
const look = (n: number) => ({ collection: "crew", look: `look-${n % 5}` });
const binding = (n: number): import("../../src/app/profiles/profile-session").PanelBinding => {
  switch (n % 5) {
    case 0: return { policy: "follow-focus" };
    case 1: return { policy: "pinned", target: { look: look(n) } };
    case 2: return { policy: "pinned", target: { view: "main" } };
    case 3: return { policy: "pinned", target: { scene: "s1" } };
    default: return { policy: "pinned", target: { subject: { kind: "location", id: `place-${n % 3}` } } };
  }
};
function check(s: ProfileSessions, m: SessionModel) {
  const data = s.session(); invariants(data);
  equal(sessionAccount(data), m.account(), "reference recorded state");
  const scenes = [...data.views.scenes, ...data.closed.flatMap(fragment => fragment.nodes.flatMap(item => item.slot === "scene" ? [item.node as ProfileSessionData["views"]["scenes"][number]] : []))];
  for (const scene of scenes) equal({ ...(scene.subject ? { subject: scene.subject } : {}), ...(scene.look ? { look: scene.look } : {}), gen: scene.gen }, m.targets.get(scene.id), "scene outside Undo");
  return data;
}
function passage(s: ProfileSessions, scope: HistoryScope, m: SessionModel, to: number, kind?: "undo" | "redo", verify = true, timeline = scope.timeline()) {
  const before = s.focus.snapshot(), old = m.state, at = m.at;
  const result = kind ? scope[kind]() : scope.jumpTo(to ? timeline.steps[to - 1]!.id : timeline.startId);
  equal(result, to !== at, "history result"); m.move(to); const data = verify ? check(s, m) : s.session();
  const after = s.focus.snapshot();
  equal(after.seq, before.seq, "navigation clock"); equal(after.views, before.views, "view focus outside Undo");
  const stillValid = before.panel && s.panel(before.panel) && sessionAccount(data).tabs.some(tab => tab.panels.some(panel => panel.id === before.panel && (panel.open.wide || panel.open.compact)));
  equal(after.panel, stillValid ? before.panel : undefined, "panel focus outside Undo");
  if (before.tab !== after.tab && old.tabs.some(tab => tab.id === after.tab) && m.state.tabs.some(tab => tab.id === before.tab))
    throw new LawFailure("shown tab outside Undo", `${before.tab} -> ${after.tab}`);
}
export function run(seed: number, commands: readonly Command[]) {
  const history = createHistoryService(), s = new ProfileSessions({ profile: "p-1", data: initial, history, random: seededRandom(seed + 10000),
    graph: (data, owner) => new ViewGraph(data, rules, owner) }), scope = history.scope(viewScope(s.profile))!, m = new SessionModel(initial);
  let available = true, readonly = false;
  const actions = new PanelActions(s, { types: () => available ? [{ id: "presets", context: { kind: "look" } }] : [], factory: () => null,
    world: () => ({ views: {}, scenes: {}, focus: {}, subject: () => true, look: () => true }), access: () => readonly ? { available: false, reason: "Read only" } : { available: true } });
  check(s, m);
  for (const cmd of commands) {
    if (["undo", "redo", "start", "end", "point"].includes(cmd.op)) {
      const to = cmd.op === "undo" ? Math.max(0, m.at - 1) : cmd.op === "redo" ? Math.min(m.steps.length, m.at + 1)
        : cmd.op === "start" ? 0 : cmd.op === "end" ? m.steps.length : cmd.value % (m.steps.length + 1);
      passage(s, scope, m, to, cmd.op === "undo" || cmd.op === "redo" ? cmd.op : undefined); probe(s, scope, m); continue;
    }
    // Only panel operations compare content fields. Other steps still snapshot structure for the independent history/refusal oracle.
    const before = serial(s), timeline = scope.timeline(), modelBefore = m.begin(["add", "show", "park", "bind", "hide", "addView"].includes(cmd.op));
    const tab = m.state.tabs[cmd.tab % Math.max(1, m.state.tabs.length)], id = tab?.id ?? "missing-tab";
    const panels = tab ? m.panels(tab).filter(panel => panel.type !== "view") : [], p = panels[cmd.panel % Math.max(1, panels.length)], panel = p?.id ?? "missing-panel";
    const views = m.state.views, view = views[cmd.panel % Math.max(1, views.length)], size = cmd.value % 2 ? "wide" : "compact";
    let recorded = false, panelEdit = false;
    const expectedRefusal = ["add", "close", "duplicate", "reset", "switch", "hide"].includes(cmd.op) && !tab
      || ["bind", "park", "show"].includes(cmd.op) && (!tab || !p)
      || cmd.op === "reopen" && !m.state.closed.length
      || (cmd.op === "readonly" || cmd.op === "withdraw") && !!tab;
    try {
      switch (cmd.op) {
        case "add": {
          const made = s.addPanel(id, "presets"); m.panels(tab!).push({ id: made, type: "presets", open: { wide: true, compact: true } }); recorded = panelEdit = true; break;
        }
        case "show": case "park": case "hide": {
          const selected = cmd.op === "hide" ? panels : p ? [p] : [];
          if (cmd.op === "hide") actions.dispatch({ kind: "panels.setTypeVisible", destination: s.panelTabTarget(id), type: "presets", visible: false, instances: selected.map(panel => s.panelTarget(panel.id)) });
          else s.setPanelsOpen(id, [panel], cmd.op === "show");
          for (const panel of selected) panel.open = { wide: cmd.op === "show", compact: cmd.op === "show" };
          recorded = panelEdit = true; break;
        }
        case "bind": s.setPanelBinding(id, panel, binding(cmd.value)); m.setBinding(tab!, panel, binding(cmd.value)); recorded = panelEdit = true; break;
        case "switch": s.show(id); m.shown = id; break;
        case "focus": if (p && (p.open.wide || p.open.compact)) s.focus.focusPanel(panel); if (view) s.focus.focusView(view.id); break;
        case "scene": if (view) {
          const target = m.targets.get(view.scene)!;
          if (cmd.value % 2) { const next = look(cmd.value); s.setLook(view.scene, next); if (JSON.stringify(target.look) !== JSON.stringify(next)) { target.look = next; target.gen++; } }
          else { const next = cmd.value % 4 ? { kind: "character", id: `V-${cmd.value % 3}` } : undefined;
            s.setSubject(view.scene, next); if (JSON.stringify(target.subject) !== JSON.stringify(next)) { if (next) target.subject = next; else delete target.subject; target.gen++; } }
        } break;
        case "drag": case "split": case "collapse": case "resize": case "activate": {
          if (!p || !p.open[size]) break;
          const dock = s.dock(id), state = panelDock(dock), tree = state[size], at = locate(tree, panel)!;
          if (cmd.op === "drag") state[size] = applyDrop(tree, { kind: "panel", panelId: panel }, { kind: "float", x: cmd.value % 300, y: cmd.value % 170, w: 320, h: 410 });
          if (cmd.op === "split") { const peer = allGroups(tree).find(item => !item.group.panels.includes(panel));
            if (peer) state[size] = applyDrop(tree, { kind: "panel", panelId: panel }, { kind: "split", groupId: peer.group.id, side: cmd.value % 2 ? "left" : "bottom" }); }
          if (cmd.op === "collapse") state[size] = setCollapsed(tree, at.group.id, !at.group.collapsed);
          if (cmd.op === "activate") state[size] = activate(tree, panel);
          if (cmd.op === "resize") {
            if (at.windowId) state[size] = setWindowRect(tree, at.windowId, { w: 300 + cmd.value % 300, h: 400 + cmd.value % 200 });
            else if (tree.root?.kind === "split") state[size] = setSizes(tree, tree.root.id, tree.root.children.map((_, i) => i + 1 + cmd.value % 9));
          }
          s.arrangeInstances(id, dockWith(dock, state));
          equal(panelDock(s.dock(id))[size === "wide" ? "compact" : "wide"], panelDock(dock)[size === "wide" ? "compact" : "wide"], "independent size classes"); break;
        }
        case "new": case "reset": {
          if (cmd.op === "reset" && !tab) { s.reset(id, content(s, cmd.value)); break; }
          const made = content(s, cmd.value), next = m.content(made.panels.map(panel => ({ ...clone(panel), open: { wide: true, compact: true } })));
          if (cmd.op === "new") { const id = s.newTab(made); m.state.tabs.push({ id, name: made.name, content: next }); m.shown = id; m.state.views.push(...made.views.map(view => ({ ...view, tab: id }))); }
          else { s.reset(id, made); m.fragment(id); tab!.content = next; m.state.views.push(...made.views.map(view => ({ ...view, tab: id }))); }
          for (const { slot, node } of made.nodes) if (slot === "scene") m.targets.set(node.id, { gen: 0 });
          recorded = true; break;
        }
        case "close": s.close(id); m.close(id); recorded = true; break;
        case "reopen": {
          const index = cmd.tab % Math.max(1, m.state.closed.length), closed = s.closedTabs()[index];
          const id = s.reopen(closed?.id ?? "missing-fragment"); m.reopen(index, id); recorded = true; break;
        }
        case "duplicate": {
          const madeId = s.duplicate(id), made = s.tab(madeId)!;
          // Allocation witnesses ONLY: expected contents and pins are derived from the source model.
          const sourceViews = views.filter(view => view.tab === tab!.id), freshViews = s.session().views.views.filter(view => view.tab === madeId), ids = new Map<string, string>();
          sourceViews.forEach((source, i) => { const fresh = freshViews[i]! as ViewRecord; ids.set(source.id, fresh.id); for (const slot of VIEW_SLOTS) ids.set(source[slot], fresh[slot]!); });
          const next = m.content(m.panels(tab!).map((source, i) => {
            const result = clone(source); result.id = made.panels[i]!.id;
            if (result.binding?.policy === "pinned") { const target = result.binding.target;
              if ("view" in target) result.binding = { policy: "pinned", target: { view: ids.get(target.view) ?? target.view } };
              if ("scene" in target) result.binding = { policy: "pinned", target: { scene: ids.get(target.scene) ?? target.scene } };
            } return result;
          }));
          m.state.tabs.splice(m.state.tabs.indexOf(tab!) + 1, 0, { id: madeId, name: tab!.name, content: next }); m.shown = madeId;
          for (const source of sourceViews) { m.state.views.push({ ...source, id: ids.get(source.id)!, tab: madeId, ...Object.fromEntries(VIEW_SLOTS.map(slot => [slot, ids.get(source[slot])!])) });
            m.targets.set(ids.get(source.scene)!, { ...clone(m.targets.get(source.scene)!), gen: 0 }); }
          recorded = true; break;
        }
        case "addView": if (view && tab) {
          const share = !!(cmd.value % 2), made = s.addViewPane(id, view.id, { scene: share, lights: share }), fresh = s.session().views.views.find(view => view.id === made)!, pane = s.instances("view", id).at(-1)!;
          const expected = { id: made, kind: "3d", tab: id, ...Object.fromEntries(VIEW_SLOTS.map(slot => [slot, (slot === "scene" || slot === "lights") && share ? view[slot] : fresh[slot]])) } as ViewRecord;
          m.state.views.push(expected); if (!share) m.targets.set(expected.scene, { ...clone(m.targets.get(view.scene)!), gen: 0 });
          m.panels(tab).push({ id: pane.id, type: "view", binding: { policy: "pinned", target: { view: made } }, open: { wide: true, compact: true } }); recorded = panelEdit = true;
        } break;
        case "closeView": if (view) { s.closeView(view.id); m.state.views = views.filter(item => item.id !== view.id); recorded = true; } break;
        case "link": if (view && views.length > 1) { const to = views[cmd.tab % views.length]!, slot = VIEW_SLOTS[cmd.value % VIEW_SLOTS.length]!;
          s.graph.link(view.id, slot, to.id); m.state.views = views.map(item => item.id === view.id ? { ...item, [slot]: to[slot] } : item); recorded = true; } break;
        case "readonly": case "withdraw": if (tab) {
          const action = { kind: "panels.add" as const, destination: s.panelTabTarget(id), type: "presets" };
          if (cmd.op === "readonly") readonly = true; else available = false;
          try { equal(actions.capability(action).available, false, "availability refusal"); actions.dispatch(action); throw new LawFailure("availability refusal", "dispatch succeeded"); }
          finally { readonly = false; if (cmd.op === "withdraw") available = true; }
        } break;
      }
      if (expectedRefusal) throw new LawFailure("expected refusal", cmd.op);
      if (recorded) m.record(modelBefore, panelEdit);
    } catch (error) {
      if (!(error instanceof TabRefusal)) throw error;
      if (!expectedRefusal) throw new LawFailure("unexpected refusal", `${cmd.op}: ${error.message}`);
      equal(serial(s), before, "refused mutation"); equal(scope.timeline(), timeline, "refused history"); equal(m.state, modelBefore.state, "refused model");
    }
    const checked = check(s, m);
    equal(scope.timeline().current + 1, m.at, "reference history position"); equal(scope.timeline().steps.length, m.steps.length, "reference history length");
    if (!recorded) equal(scope.timeline(), timeline, "unrecorded history");
    probe(s, scope, m, checked);
  }
}
function probe(s: ProfileSessions, scope: HistoryScope, m: SessionModel, checked?: ProfileSessionData) {
  // A stable timeline can be shared by all passages; none of these probes records a step.
  if (!m.steps.length) { check(s, m); equal(m.account(), m.initial, "reference history start"); return; }
  const at = m.at, before = arrangementSerial(s, checked), timeline = scope.timeline();
  const move = (to: number, kind?: "undo" | "redo") => { if (to !== m.at) passage(s, scope, m, to, kind, false, timeline); };
  move(m.steps.length); const end = arrangementSerial(s);
  move(0); check(s, m); equal(m.account(), m.initial, "reference history start");
  move(m.steps.length); equal(arrangementSerial(s), end, "end arrangement round trip");
  move(at); equal(arrangementSerial(s), before, "current arrangement round trip");
  if (at) { move(at - 1, "undo"); move(at, "redo"); equal(arrangementSerial(s), before, "Undo/Redo arrangement round trip"); }
  check(s, m); equal(scope.timeline(), timeline, "history passage identity");
}
/** Focus and dock active tabs are navigation, so they cannot be endpoint equality requirements.
 * Everything else (including placements, proportions, remembered places, order and scene targets) still round-trips. */
function arrangementSerial(s: ProfileSessions, snapshot = s.session()) {
  const { focus: _focus, seq: _seq, ...data } = snapshot;
  return JSON.stringify(data, (key, value) => key === "active" ? undefined : value);
}
function shrink(seed: number, commands: Command[], law: string): Command[] {
  let result = commands, chunk = Math.ceil(result.length / 2), attempts = 0;
  while (chunk >= 1 && attempts < 300) {
    let reduced = false;
    for (let at = 0; at < result.length && attempts++ < 300; at += chunk) {
      const candidate = [...result.slice(0, at), ...result.slice(at + chunk)];
      try { run(seed, candidate); } catch (error) { if ((error instanceof LawFailure ? error.law : "unexpected") === law) { result = candidate; reduced = true; break; } }
    }
    if (!reduced) chunk = Math.floor(chunk / 2);
  }
  return result;
}
export function generateSeeds(first: number, last: number) {
  let count = 0;
  for (let seed = first; seed <= last; seed++) {
    const random = seededRandom(seed), commands = Array.from({ length: 20 + Math.floor(random() * 41) }, (): Command => ({
      op: KINDS[Math.floor(random() * KINDS.length)]!, tab: Math.floor(random() * 16), panel: Math.floor(random() * 16), value: Math.floor(random() * 10000) }));
    try { run(seed, commands); count += commands.length; }
    catch (error) { console.error(`G3 failing seed ${seed}: ${error instanceof Error ? error.message : String(error)}`);
      const reduced = shrink(seed, commands, error instanceof LawFailure ? error.law : "unexpected");
      try { run(seed, reduced); } catch (shrunk) { error = shrunk; }
      throw Error(`G3 failing seed ${seed}; shrunk sequence ${JSON.stringify(reduced)}\n${error instanceof Error ? error.message : String(error)}`); }
  }
  return count;
}

/** Extend the same seeded harness through the production bound application path. Persistence restarts use a new outbox/history/core. */
export async function generateContextSeeds(first: number, last: number) {
  const { profileContextStudio } = await import("./profile-context-studio");
  let count = 0, restarts = 0;
  for (let seed = first; seed <= last; seed++) {
    let w = await profileContextStudio();
    const random = seededRandom(seed + 33000), models = [new EditContextModel(), new EditContextModel(), new EditContextModel()];
    let panels = [0, 1, 2].map(i => w.bind(`presets--scene${i}`).context);
    const commands: { look: number; op: string; value: number }[] = [];
    const verify = () => {
      for (let i = 0; i < 3; i++) {
        const port = panels[i]!.current(), doc = port.authoring.snapshot().document, timeline = port.authoring.historyTimeline();
        equal({ opacity: doc.recipe.layers[0]!.opacity, selected: doc.selected, depth: timeline.current + 1,
          redoDepth: timeline.redoCount, trimmed: timeline.trimmed }, models[i]!.account(), "independent editable context");
      }
    };
    try {
      // Every seed crosses 80 real steps on every look; this is not left to the random distribution.
      for (let n = 0; n < 90; n++) for (let i = 0; i < 3; i++) {
        const opacity = ((n * 37 + seed * 11 + i * 3) % 99 + 1) / 100, port = panels[i]!.current();
        const command = { kind: "layer.setOpacity" as const, layerId: port.feature("eye-makeup").view().recipe().layers[0]!.id, opacity };
        commands.push({ look: i, op: "edit", value: opacity });
        const result = port.feature("eye-makeup").dispatch(command);
        equal(result.ok, true, "valid context command"); models[i]!.edit(opacity); verify(); count++;
      }
      for (let n = 0; n < 60; n++) {
        const i = Math.floor(random() * 3), value = Math.floor(random() * 100), model = models[i]!, port = panels[i]!.current(), op = value % 4;
        commands.push({ look: i, op: ["edit", "select", "undo", "redo"][op]!, value });
        if (op === 0) { const opacity = (value % 98 + 1) / 100; equal(port.feature("eye-makeup").dispatch({ kind: "layer.setOpacity", layerId: "layer-1", opacity }).ok, true, "valid generated edit"); model.edit(opacity); }
        if (op === 1) { const selected = value % 6; equal(port.feature("eye-makeup").dispatch({ kind: "point.select", layerId: "layer-1", index: selected }).ok, true, "valid generated selection"); model.selected = selected; }
        if (op === 2 || op === 3) { const moved = op === 2 ? model.undo() : model.redo(); equal(port.authoring.dispatch({ kind: op === 2 ? "history.undo" : "history.redo" }).ok, moved, "generated history availability"); }
        verify(); count++;
        if (n === 19 || n === 39 || n === 59) {
          await w.settle(); const persisted = w.stored(), before = JSON.stringify(persisted.session);
          await w.dispose(); w = await profileContextStudio({ restart: persisted });
          equal(JSON.stringify(w.stored().session), before, "persisted session restart");
          for (const model of models) model.restart();
          panels = [0, 1, 2].map(i => w.bind(`presets--scene${i}`).context); verify(); restarts++;
        }
      }
    } catch (error) { throw Error(`P3-ii context seed ${seed}; commands ${JSON.stringify(commands)}\n${error instanceof Error ? error.message : String(error)}`); }
    finally { await w.dispose(); }
  }
  return { seeds: last - first + 1, count, restarts };
}

/** Async operations retain the acceptance-time writer through picker/read/library waits, focus changes and drawn A/B/A changes. */
export async function generateAsyncContextSeeds(first: number, last: number) {
  const { profileContextStudio } = await import("./profile-context-studio");
  const { recipeFile } = await import("../../src/legacy/eye-makeup/recipe-schema");
  const defer = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
  const waitFor = async (ready: () => boolean) => {
    const deadline = Date.now() + 4000;
    while (!ready() && Date.now() < deadline) await Bun.sleep(1);
    equal(ready(), true, "async boundary reached");
  };
  let operations = 0, switches = 0, restarts = 0;
  for (let seed = first; seed <= last; seed++) {
    let w = await profileContextStudio(), pending: Promise<unknown> | undefined, release = () => {};
    const random = seededRandom(seed + 47000), views = w.session.session().views.views as readonly ViewRecord[];
    const model = new AsyncContextModel(w.session.session().views.scenes);
    const trace: unknown[] = [];
    let panel = w.bind("presets--follow").context;
    const account = () => w.session.session().views.scenes.map(scene => [scene.id, scene.look]).sort(([a], [b]) => String(a).localeCompare(String(b)));
    const content = (look: { id: string; name: string; parts: Readonly<Record<string, unknown>> }) => {
      const parsed = w.core.documents.parts.readPreset({ ...look, revision: 1 }, "xfs/collection-2", "keep");
      return { name: look.name, parts: Object.fromEntries(w.core.documents.parts.features().map(feature => [feature, w.core.documents.parts.part(parsed, feature)])) };
    };
    try {
      for (let round = 0; round < 6; round++) {
        await w.settle();
        const index = Math.floor(random() * 3), view = views[index]!, target = model.target(view.scene);
        w.history.focus.focusView(view.id); w.draw(view.id);
        const old = round % 2 ? panel.current() : w.port, kind = round % 3;
        const oldLooks = w.services.collections.list().flatMap(collection => w.services.collections.looksOf(collection.id)).map(look =>
          ({ ref: { collection: look.collection, look: look.id }, name: look.name, parts: structuredClone(look.parts), memory: structuredClone(look.memory) }));
        const switchAway = () => { const other = views[(index + 1 + Math.floor(random() * 2)) % 3]!;
          w.history.focus.focusView(other.id); w.draw(other.id); switches++; };
        trace.push({ round, kind: ["collection.import", "saveCopy", "recipe.import"][kind], scene: view.scene, target });
        if (kind === 1) {
          const source = w.services.collections.looksOf(target.collection).map(look => structuredClone(content(look)));
          const at = w.services.collections.collection(target.collection)!.looks.indexOf(target.look), list = w.collectionTransport.list;
          const gate = defer<void>(); let waiting = false;
          w.collectionTransport.list = async () => { waiting = true; await gate.promise; return list(); };
          release = () => { w.collectionTransport.list = list; gate.resolve(); };
          const saving = old.library.execute({ kind: "saveCopy" }); pending = saving;
          await waitFor(() => waiting); switchAway(); equal(w.targets.held() > 0, true, "saveCopy retains its capture"); release();
          const result = await saving;
          if (!result.ok || result.result.kind !== "saved") throw Error(`saveCopy refused: ${JSON.stringify(result)}`);
          const copy = result.result.collection.collection;
          equal(copy.id === target.collection, false, "copy has its own identity");
          equal(copy.presets.map(content), source, "copy uses captured source content");
          model.complete(view.scene, { collection: copy.id, look: copy.presets[at]!.id });
        } else {
          const pick = defer<import("../../src/app/studio-file-operations").StudioPickedFile | undefined>(), text = defer<string>();
          let reading = false;
          const collection = crypto.randomUUID(), look = crypto.randomUUID(), name = `Async ${seed}-${round}`;
          const recipe = structuredClone(old.feature("eye-makeup").view().recipe()) as Recipe; recipe.layers[0]!.opacity = (seed % 10 + 1) / 20;
          const payload = kind === 0 ? { schema: "xfs/collection-2", id: collection, name, presets: [
            { id: look, name, revision: 1, parts: w.services.collections.look(target)!.parts }] } : recipeFile(recipe);
          const serialized = JSON.stringify(payload), file = { name: `${name}.json`, size: serialized.length,
            text: async () => { reading = true; return text.promise; }, bytes: async () => new TextEncoder().encode(serialized) };
          w.fileDevice.pick = () => pick.promise;
          release = () => { pick.resolve(file); text.resolve(serialized); };
          const importing = old.files.execute({ kind: kind === 0 ? "collection.import" : "recipe.import" }); pending = importing;
          switchAway(); equal(w.targets.held() > 0, true, "picker retains its capture"); pick.resolve(file);
          await waitFor(() => reading); switchAway(); text.resolve(serialized);
          const result = await importing;
          equal(result.ok, true, "async import accepted destination");
          if (kind === 0) {
            model.complete(view.scene, { collection, look });
            equal(w.services.collections.collection(collection)!.name, name, "imported collection content");
          } else {
            // Fresh ID is the allocation witness; target collection and authored opacity come from the command account.
            const added = w.services.collections.looksOf(target.collection).find(item => item.name === name);
            if (!added) throw Error("Recipe never reached its captured collection.");
            model.complete(view.scene, { collection: target.collection, look: added.id });
            const content = w.core.documents.parts.readPreset({ id: added.id, name, revision: 1, parts: added.parts }, "xfs/collection-2", "keep");
            equal(livePart(content, w.core.documents)!.layers[0]!.opacity, recipe.layers[0]!.opacity, "imported recipe content");
          }
        }
        pending = undefined; release = () => {};
        equal(account(), model.account(), "async completion changes only captured scene");
        equal(w.targets.held(), 0, "completed operation releases capture");
        for (const before of oldLooks) { const now = w.services.collections.look(before.ref)!;
          equal({ name: now.name, parts: now.parts, memory: now.memory }, { name: before.name, parts: before.parts, memory: before.memory }, "existing looks unchanged by async create"); }
        operations++;
      }
      await w.settle(); const saved = w.stored(), session = JSON.stringify(saved.session); await w.dispose();
      w = await profileContextStudio({ restart: saved }); panel = w.bind("presets--follow").context;
      equal(JSON.stringify(w.stored().session), session, "async persisted session round trip");
      equal(account(), model.account(), "async destinations survive restart"); restarts++;
    } catch (error) { throw Error(`P3-ii async seed ${seed}; ${JSON.stringify(trace)}\n${error instanceof Error ? error.message : String(error)}`); }
    finally { release(); await pending?.catch(() => {}); await w.dispose(); w.library.close(); }
  }
  return { seeds: last - first + 1, operations, switches, restarts };
}

if (parentPort) {
  try { parentPort.postMessage({ count: generateSeeds(workerData.first, workerData.last) }); }
  catch (error) { parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
  finally { parentPort.close(); }
}

/** P3-iii controller commands. The expected open/available set is maintained by the caller's independent account. */
export function generateInstanceCommands(seed: number, length = 48) {
  const random = seededRandom(seed), operations = ["show", "park", "withdraw", "resume", "focus", "capture", "abort"] as const;
  return Array.from({ length }, () => ({ op: operations[Math.floor(random() * operations.length)]!, panel: Math.floor(random() * 3) }));
}
