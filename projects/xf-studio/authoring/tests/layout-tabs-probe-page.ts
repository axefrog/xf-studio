/** P2-iv: the real tab strip, session, pane reconciliation and dock, with cheap synthetic panel bodies. No game or GPU work. */
import { layoutTabs } from "../src/studio-ui/layout-tabs";
import { ViewPanels, tabViews, viewPanelEntries, viewPanelIds, type ViewPaneController } from "../src/studio-ui/panels/view-panels";
import { DockView, type PanelSpec } from "../src/studio-ui/dock/dock-view";
import { defaultDockStateFor, restoreDockPreference, serializeDockState } from "../src/studio-ui/dock/persist";
import { viewCatalogue } from "../src/studio-ui/views/contribution";
import { SHELL_VIEW } from "../src/studio-ui/views/shell";
import { sessionOfWorkspace } from "../src/app/profiles/profiles-migration-data";
import { drawnView } from "../src/app/profiles/profile-window";
import { openSession, seededRandom } from "./fixtures/profile-sessions";
import { freshWorkspace } from "./fixtures/eye-region";

declare const STUDIO_CSS: string;
export type TabSwitchProbe = { supported: boolean; switches: { size: string; dispatchMs: number; paintTaskMs: number; firstPaintMs: number;
  rebound: boolean; loaded: boolean; reused: boolean; loads: number }[]; longTasks: number[]; failure?: string };
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
/** The same arrangement whatever order its keys were written in (a load may write `floating` after `root`). */
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
const sameArrangement = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
async function measureTabSwitches(): Promise<TabSwitchProbe> {
  const style = document.createElement("style"); style.textContent = STUDIO_CSS + "\nbody{margin:0} #tab-probe-root{width:1200px;height:800px} .dock{height:740px}";
  document.head.append(style);
  const root = document.createElement("div"); root.id = "tab-probe-root"; document.body.append(root);
  const base = viewCatalogue([SHELL_VIEW]), head = base.panels.find(panel => panel.id === "head")!;
  const workspace = freshWorkspace(); workspace.uiPreferences.layout = serializeDockState(defaultDockStateFor(base));
  const session = openSession(sessionOfWorkspace(workspace, { tab: "A" }, seededRandom(89)));
  const a = session.tabId(), b = session.duplicate(a); session.show(a);
  const catalogue = { ...base, panels: [...base.panels], ids: [...base.ids], meta: { ...base.meta } };
  let size: "wide" | "compact" = "wide", dock!: DockView, loads = 0;
  const area = () => ({ x: 0, y: 0, w: size === "wide" ? 1200 : 700, h: 740 });
  const body = (id: string): PanelSpec => {
    const element = document.createElement("div");
    for (let n = 0; n < 32; n++) { const line = document.createElement("p"); line.textContent = `${id}: synthetic field ${n}`; element.append(line); }
    return { id, element, title: id, description: "Synthetic panel", icon: "head" };
  };
  // 044 D2 / P3-i D1: this probe keeps the explicit legacy output/input adapters.
  // Controllers are kept per type; each paint reads its instance in the shown tab, as the shell's contexts do.
  const others = base.panels.filter(panel => panel.id !== "head").map(panel => body(panel.id));
  const identities = others.map(panel => panel.element);
  const canvas = document.createElement("div"); canvas.textContent = "Synthetic view";
  const panes = new ViewPanels({
    arrangement: () => ({ tab: session.tabId(), layout: session.legacyDock() }),
    views: () => tabViews(session.graph.snapshot().views, session.tabId()), drawn: () => ({ drawn: drawnView(session) }),
    catalogue: ids => { catalogue.panels = base.panels.flatMap(panel => panel.id === "head" ? viewPanelEntries(head, ids) : [panel]); catalogue.ids = catalogue.panels.map(panel => panel.id); },
    make: id => { const spec = body(id), slot = document.createElement("div"); spec.element.append(slot);
      return { spec, slot, update() {} } satisfies ViewPaneController; },
    spec: pane => pane.spec, attach: slot => slot.append(canvas),
    save: (tab, state) => { if (tab) session.arrange(tab, serializeDockState(state)); },
    restore: layout => { loads++; dock.load(restoreDockPreference(layout, area(), catalogue, [], viewPanelIds(session.graph.snapshot()), true).state,
      [...others, ...panes.controllers().map(pane => pane.spec)]); },
    dock: { addPanels: specs => dock.addPanels(specs), removePanels: (ids, options) => dock.removePanels(ids, options), get dockState() { return dock.dockState; } },
  });
  panes.start();
  const initial = restoreDockPreference(session.legacyDock(), area(), catalogue, [], viewPanelIds(session.graph.snapshot()), true).state;
  dock = new DockView({ panels: [...others, ...panes.controllers().map(pane => pane.spec)], state: initial, sizeClass: () => size,
    defaults: next => initial[next], save: state => panes.save(state), announce() {} });
  const tabs = layoutTabs({ tabs: { snapshot: () => ({ tabs: session.tabList(), shown: session.tabId(), closed: session.closedTabs() }),
    dock: () => session.legacyDock(), defaults: () => [], substitution: () => ({ available: false, reason: "No defaults in this probe" }),
    subject: ref => ref.id, look: ref => ref.look, collection: id => id, subscribe: listener => session.subscribe(listener) },
    capability: action => action.kind === "tabs.show" ? session.capability(action) : { available: false },
    dispatch: action => { if (action.kind !== "tabs.show") return { ok: false, message: "Switch only" }; session.dispatch(action); return { ok: true }; },
    feedback: { announce() {}, toast: () => () => {} }, dock: dock.element, changed() {}, moduleIcon: () => "head" });
  root.append(tabs.element, dock.element); dock.render();
  const bind = () => { for (const panel of others) {
    const instance = session.inputInstance(panel.id); panel.element.dataset.instance = instance;
    panel.element.firstElementChild!.textContent = `${session.tabId()} · ${instance}`;
  } };
  bind();
  const instances = Object.fromEntries([a, b].map(tab => [tab, others.map(panel => session.instance(panel.id, tab))]));
  await frame(); await frame();
  const tasks: PerformanceEntry[] = [], supported = PerformanceObserver.supportedEntryTypes.includes("longtask");
  const observer = new PerformanceObserver(list => tasks.push(...list.getEntries()));
  if (supported) observer.observe({ type: "longtask" });
  const switches: TabSwitchProbe["switches"] = [];
  const start = performance.now();
  for (const nextSize of ["wide", "compact"] as const) {
    size = nextSize; root.style.width = `${area().w}px`;
    for (let n = 0; n < 8; n++) {
      const target = n % 2 === 0 ? b : a, before = performance.now(), beforeLoads = loads;
      tabs.strip.tab(target)!.click(); const dispatchMs = performance.now() - before;
      // P3-i D1 / 044 D2: compare the captured destination in the same alias currency
      // this phase-2 dock loads. Raw session.dock() uses instance IDs, even after a correct load.
      const saved = session.legacyDock();
      let paintTaskMs = 0;
      await new Promise<void>(resolve => requestAnimationFrame(() => {
        const began = performance.now(); panes.sync(); bind();
        // Force the same layout/measurement the dock's first visible frame needs, inside the measured task.
        dock.element.getBoundingClientRect(); paintTaskMs = performance.now() - began; resolve();
      }));
      // The next frame callback follows the destination's first paint opportunity; it does not prove GPU presentation.
      await frame();
      switches.push({ size, dispatchMs, paintTaskMs, firstPaintMs: performance.now() - before, loads: loads - beforeLoads,
        rebound: others.every((panel, i) => panel.element.dataset.instance === instances[target]![i]),
        loaded: sameArrangement(saved, serializeDockState(dock.dockState)), reused: others.every((panel, i) => panel.element === identities[i]) });
    }
  }
  const end = performance.now();
  await new Promise(resolve => setTimeout(resolve, 100));
  tasks.push(...observer.takeRecords()); observer.disconnect();
  return { supported, switches, longTasks: tasks.filter(task => task.startTime < end && task.startTime + task.duration > start).map(task => task.duration) };
}
measureTabSwitches().then(value => { (window as unknown as { probe: TabSwitchProbe }).probe = value; })
  .catch(error => { (window as unknown as { probe: Partial<TabSwitchProbe> }).probe = { failure: String(error) }; });
