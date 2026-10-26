/** G3 state-machine generator: exact serialization laws, stable identities and atomic refusals under arbitrary history passages. */
import { parentPort, workerData } from "node:worker_threads";
import { ProfileSessions, TabRefusal, type TabContent } from "../../src/app/profiles/profile-sessions";
import { PROFILE_SESSION_SCHEMA, type ProfileSessionData } from "../../src/app/profiles/profile-session";
import { createHistoryService, viewScope, type HistoryScope } from "../../src/platform/core/history-service";
import { panelDock, dockWith } from "../../src/app/profiles/panel-dock";
import { applyDrop, group } from "../../src/platform/core/dock-layout";
import { VIEW_GRAPH_1, VIEW_SLOTS, SLOT_COLLECTIONS, type ViewGraphData, type ViewGraphRules, type ViewRecord, type ViewSlot } from "../../src/platform/api/view-graph";
import { ViewGraph } from "../../src/platform/core/view-graph";
import { seededRandom } from "./profile-sessions";

const KINDS = ["add", "show", "park", "bind", "drag", "new", "reset", "close", "reopen", "duplicate", "undo", "redo", "start", "end", "point"] as const;
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
  const a = typeof actual === "string" ? actual : JSON.stringify(actual), b = typeof expected === "string" ? expected : JSON.stringify(expected);
  if (a !== b) { let at = 0; while (at < Math.min(a.length, b.length) && a[at] === b[at]) at++;
    throw new LawFailure(law, `byte ${at}; actual ${a.slice(Math.max(0, at - 60), at + 150)}; expected ${b.slice(Math.max(0, at - 60), at + 150)}`); }
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
  return { name: `Made ${n}`, dock: dockWith(null, { wide: tree, compact: tree }), panels: [{ id: panel, type: "presets" }],
    views: [{ ...source, ...refs, id: view }], nodes: VIEW_SLOTS.map(slot => ({ slot,
      node: { ...structuredClone(blueprint[SLOT_COLLECTIONS[slot]].find(node => node.id === source[slot])!), id: refs[slot]! } })) };
}
function execute(s: ProfileSessions, scope: HistoryScope, cmd: Command) {
  const tabs = s.tabList(), selected = tabs[cmd.tab % Math.max(1, tabs.length)], tab = selected?.id ?? "missing-tab";
  const panels = selected?.panels.filter(panel => panel.type !== "view") ?? [], panel = panels[cmd.panel % Math.max(1, panels.length)]?.id ?? "missing-panel";
  switch (cmd.op) {
    case "add": s.addPanel(tab, "presets"); break;
    case "show": s.setPanelsOpen(tab, [panel], true); break;
    case "park": s.setPanelsOpen(tab, [panel], false); break;
    case "bind": s.setPanelBinding(tab, panel, cmd.value % 3 ? { policy: "pinned", target: { look: { collection: "crew", look: `look-${cmd.value % 5}` } } } : { policy: "follow-focus" }); break;
    case "drag": {
      if (!s.panel(panel)) throw new TabRefusal("missing_target", "No panel to drag.");
      const state = panelDock(s.dock(tab));
      for (const size of ["wide", "compact"] as const) state[size] = applyDrop(state[size], { kind: "panel", panelId: panel }, { kind: "float", x: cmd.value % 300, y: cmd.value % 170, w: 320, h: 410 });
      s.arrangeInstances(tab, dockWith(s.dock(tab), state)); break;
    }
    case "new": s.newTab(content(s, cmd.value)); break;
    case "reset": if (!s.tab(tab)) throw new TabRefusal("missing_target", "No tab to reset."); s.reset(tab, content(s, cmd.value)); break;
    case "close": s.close(tab); break;
    case "reopen": { const closed = s.closedTabs(); s.reopen(closed[cmd.tab % Math.max(1, closed.length)]?.id ?? "missing-fragment"); break; }
    case "duplicate": s.duplicate(tab); break;
    case "undo": return scope.undo();
    case "redo": return scope.redo();
    case "start": return scope.jumpTo(scope.timeline().startId);
    case "end": return scope.jumpTo(scope.timeline().steps.at(-1)?.id ?? scope.timeline().startId);
    case "point": { const t = scope.timeline(), at = cmd.value % (t.steps.length + 1); return scope.jumpTo(at ? t.steps[at - 1]!.id : t.startId); }
  }
  return true;
}
function move(scope: HistoryScope, to: string) {
  if (scope.plan(to)?.direction !== "none" && !scope.jumpTo(to)) throw new LawFailure("jump refusal", "valid timeline destination refused");
}
function laws(s: ProfileSessions, scope: HistoryScope) {
  const data = s.session(); invariants(data);
  const before = JSON.stringify(data), timeline = scope.timeline(), at = timeline.current < 0 ? timeline.startId : timeline.steps[timeline.current]!.id;
  // Check the current checkpoint even if the sequence is on a redo branch, and return there after the complete start/end passage.
  const end = timeline.steps.at(-1)?.id ?? timeline.startId;
  let endBefore = before;
  if (at !== end) { move(scope, end); endBefore = serial(s); }
  move(scope, timeline.startId); move(scope, end);
  equal(serial(s), endBefore, "end exact serialization");
  if (at !== end) { move(scope, at); equal(serial(s), before, "start/end exact serialization"); }
  if (scope.canUndo()) { if (!scope.undo() || !scope.redo()) throw new LawFailure("undo/redo refusal", "available move refused");
    equal(serial(s), before, "undo/redo exact serialization"); }
  equal(scope.timeline(), timeline, "history passage identity");
  return { state: before, timeline };
}
export function run(seed: number, commands: readonly Command[]) {
  const history = createHistoryService(), s = new ProfileSessions({ profile: "p-1", data: initial, history, random: seededRandom(seed + 10000),
    graph: (data, owner) => new ViewGraph(data, rules, owner) }), scope = history.scope(viewScope(s.profile))!;
  let previous = { state: serial(s), timeline: scope.timeline() };
  for (const cmd of commands) {
    const { state: before, timeline } = previous;
    try { if (!execute(s, scope, cmd)) { equal(serial(s), before, "refused mutation"); equal(scope.timeline(), timeline, "refused history"); } }
    catch (error) { if (!(error instanceof TabRefusal)) throw error;
      equal(serial(s), before, "refused mutation"); equal(scope.timeline(), timeline, "refused history"); }
    previous = laws(s, scope);
  }
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

if (parentPort) {
  try { parentPort.postMessage({ count: generateSeeds(workerData.first, workerData.last) }); }
  catch (error) { parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
  finally { parentPort.close(); }
}
