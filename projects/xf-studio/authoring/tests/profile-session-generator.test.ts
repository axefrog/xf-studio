/** G3 state-machine generator: exact serialization laws, stable identities and atomic refusals under arbitrary history passages. */
import { test } from "bun:test";
import { ProfileSessions, TabRefusal, type TabContent } from "../src/app/profiles/profile-sessions";
import { sessionOfWorkspace } from "../src/app/profiles/profiles-migration-data";
import { createHistoryService, viewScope, type HistoryScope } from "../src/platform/core/history-service";
import { panelDock, dockWith } from "../src/app/profiles/panel-dock";
import { applyDrop, group } from "../src/platform/core/dock-layout";
import { VIEW_SLOTS, SLOT_COLLECTIONS, type ViewRecord, type ViewSlot } from "../src/platform/api/view-graph";
import { defaultViewGraph } from "../src/preview/preview-view-graph";
import { freshWorkspace } from "./fixtures/eye-region";
import { openSession, seededRandom } from "./fixtures/profile-sessions";

const KINDS = ["add", "show", "park", "bind", "drag", "new", "reset", "close", "reopen", "duplicate", "undo", "redo", "start", "end", "point"] as const;
type Command = { op: typeof KINDS[number]; tab: number; panel: number; value: number };
const blueprint = defaultViewGraph(freshWorkspace().preview);
const initial = sessionOfWorkspace(freshWorkspace(), { tab: "Initial", character: "c-1", look: { collection: "crew", look: "initial" } }, seededRandom(123));
class LawFailure extends Error { constructor(readonly law: string, detail: string) { super(`${law}: ${detail}`); } }
function equal(actual: unknown, expected: unknown, law: string) {
  const a = typeof actual === "string" ? actual : JSON.stringify(actual), b = typeof expected === "string" ? expected : JSON.stringify(expected);
  if (a !== b) { let at = 0; while (at < Math.min(a.length, b.length) && a[at] === b[at]) at++;
    throw new LawFailure(law, `byte ${at}; actual ${a.slice(Math.max(0, at - 60), at + 150)}; expected ${b.slice(Math.max(0, at - 60), at + 150)}`); }
}
const serial = (s: ProfileSessions) => JSON.stringify(s.session());
function invariants(s: ProfileSessions) {
  const data = s.session(), instances = [...data.tabs, ...data.closed.map(fragment => fragment.tab)].flatMap(tab => tab.panels.map(panel => panel.id));
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
  const tabs = s.tabList(), tab = tabs[cmd.tab % Math.max(1, tabs.length)]?.id ?? "missing-tab";
  const panels = s.tab(tab)?.panels.filter(panel => panel.type !== "view") ?? [], panel = panels[cmd.panel % Math.max(1, panels.length)]?.id ?? "missing-panel";
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
  invariants(s);
  const before = serial(s), timeline = scope.timeline(), at = timeline.current < 0 ? timeline.startId : timeline.steps[timeline.current]!.id;
  // Check the current checkpoint even if the sequence is on a redo branch, and return there after the complete start/end passage.
  move(scope, timeline.startId); move(scope, timeline.steps.at(-1)?.id ?? timeline.startId); move(scope, at);
  equal(serial(s), before, "start/end exact serialization");
  if (scope.canUndo()) { if (!scope.undo() || !scope.redo()) throw new LawFailure("undo/redo refusal", "available move refused");
    equal(serial(s), before, "undo/redo exact serialization"); }
  equal(scope.timeline(), timeline, "history passage identity"); invariants(s);
}
function run(seed: number, commands: readonly Command[]) {
  const history = createHistoryService(), s = openSession(initial, { history, random: seededRandom(seed + 10000) }), scope = history.scope(viewScope(s.profile))!;
  for (const cmd of commands) {
    const before = serial(s), timeline = scope.timeline();
    try { if (!execute(s, scope, cmd)) { equal(serial(s), before, "refused mutation"); equal(scope.timeline(), timeline, "refused history"); } }
    catch (error) { if (!(error instanceof TabRefusal)) throw error;
      equal(serial(s), before, "refused mutation"); equal(scope.timeline(), timeline, "refused history"); }
    laws(s, scope);
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
test("G3 generator: 2,000 seeds of 20–60 operations, with exact history round trips and atomic refusals", () => {
  let count = 0;
  for (let seed = 1; seed <= 2000; seed++) {
    const random = seededRandom(seed), commands = Array.from({ length: 20 + Math.floor(random() * 41) }, (): Command => ({
      op: KINDS[Math.floor(random() * KINDS.length)]!, tab: Math.floor(random() * 16), panel: Math.floor(random() * 16), value: Math.floor(random() * 10000) }));
    try { run(seed, commands); count += commands.length; }
    catch (error) { const reduced = shrink(seed, commands, error instanceof LawFailure ? error.law : "unexpected");
      try { run(seed, reduced); } catch (shrunk) { error = shrunk; }
      throw Error(`G3 failing seed ${seed}; shrunk sequence ${JSON.stringify(reduced)}\n${error instanceof Error ? error.message : String(error)}`); }
  }
  console.log(`G3 generator: 2000 seeds, ${count} generated operations, every-step start/end and Undo/Redo probes.`);
}, 300_000);
