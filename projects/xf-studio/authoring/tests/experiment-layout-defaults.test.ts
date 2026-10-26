/**
 * Experiment-contributed default layouts (compose/layout-defaults.ts `studioLayoutDefaults`): an experiment's module defaults are offered
 * in New tab ▸ while it's on and withdrawn when it's off; an invalid one is refused and logged without touching the built-in set; a tab
 * made from one is the person's and survives the experiment going off and on. Holotable's own default (no 3D view, an empty graph) is the
 * worked case.
 */
import { describe, expect, test } from "bun:test";
import { DocumentOutbox } from "../src/platform/core/document-outbox";
import { contributedDefaultIssues, LayoutDefaults } from "../src/app/profiles/layout-defaults";
import { TabDefaults } from "../src/app/profiles/tab-defaults";
import { substitutionContext } from "../src/app/profiles/profile-window";
import { sessionOfWorkspace } from "../src/app/profiles/profiles-migration-data";
import { keepsStateInDefaults, STUDIO_FRAGMENT_KNOWLEDGE, studioLayoutDefaults, type LayoutExperiment } from "../src/compose/layout-defaults";
import { HOLOTABLE_MODULE } from "../src/features/holotable";
import { HOLOTABLE_VIEW } from "../src/features/holotable/view/contribution";
import type { StudioModule } from "../src/platform/api";
import { freshWorkspace } from "./fixtures/eye-region";
import { memoryOutboxStorage, storeDocuments } from "./fixtures/platform-doubles";
import { openSession, seededRandom } from "./fixtures/profile-sessions";

const HOLO = "holotable/default", EYE = "eye-makeup/default";

function experimentsDouble(entries: LayoutExperiment[]) {
  let on = false;
  const listeners = new Set<() => void>();
  return {
    registrations: () => (on ? entries : []),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(value: boolean) { on = value; for (const listener of listeners) listener(); },
  };
}

function windowWith(experiments: ReturnType<typeof experimentsDouble>, log: string[] = []) {
  const documents = storeDocuments(), outbox = new DocumentOutbox(documents, memoryOutboxStorage(), { retryMs: 5 });
  outbox.open();
  const layouts = studioLayoutDefaults(experiments, message => log.push(message));
  const defaults = new LayoutDefaults({ documents, outbox, contributed: layouts.contributed, known: layouts.known, random: seededRandom(3) });
  const s = openSession(sessionOfWorkspace(freshWorkspace(), { tab: "Layout 1" }, seededRandom(1)), { random: seededRandom(7) });
  const services = { profiles: { profile: () => ({ subjects: [], collections: [] }) }, collections: { collection: () => ({ looks: [] }), look: () => ({ state: "live" }) },
    characters: { document: () => null } };
  const tabs = new TabDefaults({ sessions: s, defaults, candidates: () => substitutionContext(s, services as never), keepsState: keepsStateInDefaults, known: layouts.known });
  return { defaults, tabs, s, layouts, log };
}
const holotable: LayoutExperiment = { module: HOLOTABLE_MODULE, contribution: HOLOTABLE_VIEW };

describe("experiment-contributed default layouts", () => {
  test("Holotable's default reads: an empty graph (no views, nodes or subjects) passes the fragment validator", () => {
    const own = new Set<string>(HOLOTABLE_VIEW.panels.map(panel => panel.id));
    expect(contributedDefaultIssues([HOLOTABLE_MODULE], { ...STUDIO_FRAGMENT_KNOWLEDGE, panel: type => STUDIO_FRAGMENT_KNOWLEDGE.panel(type) || own.has(type) })).toEqual([]);
  });

  test("offered while the experiment is on, withdrawn when it's off; the built-in defaults stay throughout", () => {
    const experiments = experimentsDouble([holotable]), w = windowWith(experiments);
    let changes = 0; w.defaults.subscribe(() => changes++);
    const ids = () => w.defaults.list().map(item => item.id);
    expect(ids()).toContain(EYE); expect(ids()).not.toContain(HOLO);
    expect(w.layouts.known.panel("holotable.view")).toBe(false);
    experiments.set(true);
    expect(ids()).toContain(HOLO); expect(ids()).toContain(EYE);
    expect(w.defaults.get(HOLO)?.owner).toMatchObject({ kind: "module", module: "holotable", earlyAccess: true });
    expect(w.layouts.known.panel("holotable.view")).toBe(true);
    expect(w.layouts.known.panel("holotable.nonsense")).toBe(false);
    experiments.set(false);
    expect(ids()).not.toContain(HOLO); expect(ids()).toContain(EYE);
    expect(changes).toBe(2);
  });

  test("an invalid experiment default is refused and logged once, never offered, and the built-in set is unharmed", () => {
    const broken: StudioModule = { ...HOLOTABLE_MODULE, id: "broken", label: "Broken", defaults: [{ ...HOLOTABLE_MODULE.defaults![0]!,
      fragment: { ...HOLOTABLE_MODULE.defaults![0]!.fragment, panels: [{ key: "x", type: "no.such.panel" }] } }] };
    const experiments = experimentsDouble([{ module: broken, contribution: { panels: [] } }]), log: string[] = [], w = windowWith(experiments, log);
    experiments.set(true);
    const ids = w.defaults.list().map(item => item.id);
    expect(ids).not.toContain("broken/default"); expect(ids).toContain(EYE);
    w.defaults.list(); experiments.set(false); experiments.set(true); w.defaults.list();
    expect(log).toHaveLength(1);
    expect(log[0]).toContain("Broken");
  });

  test("an experiment whose defaults can't be read or copied is refused alone; the others and the built-in defaults still list", () => {
    const base = HOLOTABLE_MODULE.defaults![0]!;
    // Panel state that can't be cloned (a function): copying it throws, as Sol's review reproduced.
    const uncloneable: StudioModule = { ...HOLOTABLE_MODULE, id: "uncloneable", label: "Uncloneable", defaults: [{ ...base, fragment: { ...base.fragment,
      panels: base.fragment.panels.map(panel => panel.type === "holotable.view" ? { ...panel, state: { draw: () => 1 } } : panel) } }] };
    const unreadable = { ...HOLOTABLE_MODULE, id: "unreadable", label: "Unreadable", get defaults(): never { throw Error("unreadable"); } } as StudioModule;
    const log: string[] = [];
    const experiments = experimentsDouble([{ module: uncloneable, contribution: HOLOTABLE_VIEW }, { module: unreadable, contribution: HOLOTABLE_VIEW }, holotable]);
    const w = windowWith(experiments, log);
    experiments.set(true);
    const ids = w.defaults.list().map(item => item.id);
    expect(ids).toContain(EYE); expect(ids).toContain(HOLO);
    expect(ids).not.toContain("uncloneable/default");
    expect(log.some(line => line.includes("Uncloneable"))).toBe(true);
    expect(log.some(line => line.includes("Unreadable"))).toBe(true);
  });

  test("a module registered again with other defaults is checked afresh, not served from the cache", () => {
    const first: LayoutExperiment = { module: HOLOTABLE_MODULE, contribution: HOLOTABLE_VIEW };
    const renamed: LayoutExperiment = { module: { ...HOLOTABLE_MODULE, defaults: [{ ...HOLOTABLE_MODULE.defaults![0]!, name: "Holotable again" }] }, contribution: HOLOTABLE_VIEW };
    let current = [first];
    const listeners = new Set<() => void>();
    const experiments = { registrations: () => current, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
    const w = windowWith(experiments as never);
    expect(w.defaults.get(HOLO)?.name).toBe("Holotable");
    current = [renamed]; for (const listener of listeners) listener();
    expect(w.defaults.get(HOLO)?.name).toBe("Holotable again");
    expect(w.defaults.list().find(item => item.id === HOLO)?.name).toBe("Holotable again");
  });

  test("a change that arrives while the list is being built is never kept as current", () => {
    let on = true, fired = false;
    const listeners = new Set<() => void>();
    const experiments = { registrations() {
      if (!fired) { fired = true; on = false; for (const listener of listeners) listener(); }
      return on ? [holotable] : [];
    }, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
    const w = windowWith(experiments as never);
    expect(w.defaults.list().map(item => item.id)).not.toContain(HOLO);
    expect(w.defaults.get(HOLO)).toBeUndefined();
  });

  test("the generation moves only when the registration set changes, and the list and knowledge share one snapshot", () => {
    const experiments = experimentsDouble([holotable]), w = windowWith(experiments);
    const g0 = w.layouts.contributed.generation!();
    expect(w.layouts.contributed.generation!()).toBe(g0);
    experiments.set(true);
    const g1 = w.layouts.contributed.generation!();
    expect(g1).toBeGreaterThan(g0);
    expect(w.layouts.known.panel("holotable.view")).toBe(w.layouts.contributed.list().some(item => item.id === HOLO));
    experiments.set(false);
    expect(w.layouts.contributed.generation!()).toBeGreaterThan(g1);
    expect(w.layouts.known.panel("holotable.view")).toBe(false);
  });

  test("§6.6, this side: a tab and an own default made from the experiment survive it going off and on; the own default is unavailable meanwhile", () => {
    const experiments = experimentsDouble([holotable]), w = windowWith(experiments);
    experiments.set(true);
    w.tabs.dispatch({ kind: "tabs.new", default: HOLO });
    const tabId = w.s.tabId(), tab = JSON.stringify(w.s.tab(tabId));
    const saved = w.defaults.dispatch({ kind: "create", name: "My replay", fragment: w.defaults.get(HOLO)!.fragment });
    if (!saved.ok) throw Error(saved.reason);
    expect(w.defaults.get(saved.id)?.unavailable).toBeUndefined();
    experiments.set(false);
    expect(w.defaults.get(saved.id)?.unavailable).toBeDefined();
    expect(w.defaults.list().some(item => item.id === saved.id)).toBe(true);
    expect(w.defaults.capability({ kind: "rename", id: saved.id, name: "Still mine" }).available).toBe(true);
    expect(w.defaults.capability({ kind: "delete", id: saved.id }).available).toBe(true);
    expect(JSON.stringify(w.s.tab(tabId))).toBe(tab);
    experiments.set(true);
    expect(w.defaults.get(saved.id)?.unavailable).toBeUndefined();
    expect(w.tabs.capability({ kind: "tabs.new", default: saved.id }).available).toBe(true);
    expect(JSON.stringify(w.s.tab(tabId))).toBe(tab);
  });

  test("a tab made from an experiment default survives the experiment going off and on", () => {
    const experiments = experimentsDouble([holotable]), w = windowWith(experiments);
    experiments.set(true);
    expect(w.tabs.capability({ kind: "tabs.new", default: HOLO }).available).toBe(true);
    w.tabs.dispatch({ kind: "tabs.new", default: HOLO });
    const id = w.s.tabId(), tab = JSON.stringify(w.s.tab(id));
    expect(w.s.tab(id)!.origin).toBe(HOLO);
    experiments.set(false);
    expect(w.tabs.capability({ kind: "tabs.new", default: HOLO }).available).toBe(false);
    expect(JSON.stringify(w.s.tab(id))).toBe(tab);
    experiments.set(true);
    expect(JSON.stringify(w.s.tab(id))).toBe(tab);
  });
});
