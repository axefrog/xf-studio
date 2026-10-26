/**
 * Experiment-contributed default layouts (compose/layout-defaults.ts `studioLayoutDefaults`): an experiment's module defaults are offered
 * in New tab ▸ while it's on and withdrawn when it's off; an invalid one is refused and logged without touching the built-in set; a tab
 * made from one is the person's and survives the experiment going off and on. The experiments own the fact that their registration set
 * changed (`registrationGeneration`, `onRegistrationsChanged`); the layouts rebuild eagerly on that signal and never on a read.
 * Holotable's own default (no 3D view, an empty graph) is the worked case.
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
const holotable: LayoutExperiment = { module: HOLOTABLE_MODULE, contribution: HOLOTABLE_VIEW };

/**
 * The experiments owner as the layouts see it: a registration set with its own generation and signal (bumped, then signalled, then the
 * general `subscribe` listeners), and `noise()` for the general changes (playback, services, history) that leave the set alone.
 */
function experimentsDouble(entries: LayoutExperiment[] = [holotable]) {
  let current: readonly LayoutExperiment[] = [], generation = 0;
  const registrationListeners = new Set<() => void>(), listeners = new Set<() => void>();
  const double = {
    registrations: () => current,
    registrationGeneration: () => generation,
    onRegistrationsChanged(listener: () => void) { registrationListeners.add(listener); return () => { registrationListeners.delete(listener); }; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Replace the registration set: the owner's commit point. */
    commit(next: readonly LayoutExperiment[]) {
      current = next; generation++;
      for (const listener of [...registrationListeners]) listener();
      for (const listener of [...listeners]) listener();
    },
    set(on: boolean) { double.commit(on ? entries : []); },
    noise() { for (const listener of [...listeners]) listener(); },
  };
  return double;
}
type Double = ReturnType<typeof experimentsDouble>;

function windowWith(experiments: Double, log: string[] = []) {
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

describe("experiment-contributed default layouts", () => {
  test("Holotable's default reads: an empty graph (no views, nodes or subjects) passes the fragment validator", () => {
    const own = new Set<string>(HOLOTABLE_VIEW.panels.map(panel => panel.id));
    expect(contributedDefaultIssues([HOLOTABLE_MODULE], { ...STUDIO_FRAGMENT_KNOWLEDGE, panel: type => STUDIO_FRAGMENT_KNOWLEDGE.panel(type) || own.has(type) })).toEqual([]);
  });

  test("offered while the experiment is on, withdrawn when it's off; the built-in defaults stay throughout", () => {
    const experiments = experimentsDouble(), w = windowWith(experiments);
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
    const log: string[] = [], experiments = experimentsDouble([{ module: broken, contribution: { panels: [] } }]), w = windowWith(experiments, log);
    experiments.set(true);
    const ids = w.defaults.list().map(item => item.id);
    expect(ids).not.toContain("broken/default"); expect(ids).toContain(EYE);
    w.defaults.list(); experiments.set(false); experiments.set(true); w.defaults.list();
    expect(log).toHaveLength(1);
    expect(log[0]).toContain("Broken");
  });

  test("an experiment whose defaults can't be read or copied is refused alone; the others and the built-in defaults still list", () => {
    const base = HOLOTABLE_MODULE.defaults![0]!;
    // Panel state that can't be cloned (a function): copying it throws.
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

  test("a module registered again with other defaults is checked afresh", () => {
    const renamed: LayoutExperiment = { module: { ...HOLOTABLE_MODULE, defaults: [{ ...HOLOTABLE_MODULE.defaults![0]!, name: "Holotable again" }] }, contribution: HOLOTABLE_VIEW };
    const experiments = experimentsDouble(), w = windowWith(experiments);
    experiments.commit([holotable]);
    expect(w.defaults.get(HOLO)?.name).toBe("Holotable");
    experiments.commit([renamed]);
    expect(w.defaults.get(HOLO)?.name).toBe("Holotable again");
    expect(w.defaults.list().find(item => item.id === HOLO)?.name).toBe("Holotable again");
  });

  test("an experiment withdrawn while its defaults are being read is never offered, and no tab can be made from it", () => {
    const experiments = experimentsDouble();
    let withdrawn = false;
    const module = { ...HOLOTABLE_MODULE, get defaults() {
      // Reading the defaults switches the experiment off (a flag flipped synchronously mid-validation).
      if (!withdrawn) { withdrawn = true; experiments.commit([]); }
      return HOLOTABLE_MODULE.defaults;
    } } as StudioModule;
    const w = windowWith(experiments);
    experiments.commit([{ module, contribution: HOLOTABLE_VIEW }]);
    expect(w.tabs.capability({ kind: "tabs.new", default: HOLO }).available).toBe(false);
    expect(w.defaults.get(HOLO)).toBeUndefined();
    expect(w.layouts.known.panel("holotable.view")).toBe(false);
    expect(w.defaults.list().map(item => item.id)).not.toContain(HOLO);
    expect(w.layouts.contributed.generation!()).toBe(experiments.registrationGeneration());
  });

  test("(a) a listener that subscribed to the experiments before the layouts existed already reads the current set", () => {
    const experiments = experimentsDouble(), seen: { known: boolean; listed: boolean; generation: number; current: number }[] = [];
    let w: ReturnType<typeof windowWith> | undefined;
    experiments.subscribe(() => { if (w) seen.push({ known: w.layouts.known.panel("holotable.view"), listed: w.layouts.contributed.list().some(item => item.id === HOLO),
      generation: w.layouts.contributed.generation!(), current: experiments.registrationGeneration() }); });
    w = windowWith(experiments);
    experiments.set(true); experiments.set(false);
    expect(seen).toEqual([{ known: true, listed: true, generation: 1, current: 1 }, { known: false, listed: false, generation: 2, current: 2 }]);
  });

  test("(b) a set that won't settle publishes the built-in defaults, and they stay put on later reads until the next signal", () => {
    const experiments = experimentsDouble();
    const churning = { ...HOLOTABLE_MODULE, get defaults() { experiments.commit(experiments.registrations()); return HOLOTABLE_MODULE.defaults; } } as StudioModule;
    const w = windowWith(experiments);
    experiments.commit([{ module: churning, contribution: HOLOTABLE_VIEW }]);
    const first = w.layouts.contributed.list();
    expect(first.map(item => item.id)).not.toContain(HOLO);
    expect(w.layouts.known.panel("holotable.view")).toBe(false);
    for (let i = 0; i < 5; i++) { expect(w.layouts.contributed.list()).toBe(first); expect(w.layouts.known.panel("holotable.view")).toBe(false); }
    experiments.commit([holotable]);
    expect(w.layouts.contributed.list().map(item => item.id)).toContain(HOLO);
  });

  test("(c) general experiment changes (playback, services, history) neither move the generation nor rebuild", () => {
    const experiments = experimentsDouble(), w = windowWith(experiments);
    experiments.set(true);
    const generation = w.layouts.contributed.generation!(), list = w.layouts.contributed.list();
    let notified = 0; w.layouts.contributed.subscribe(() => notified++);
    for (let i = 0; i < 5; i++) experiments.noise();
    expect(w.layouts.contributed.generation!()).toBe(generation);
    expect(w.layouts.contributed.list()).toBe(list);
    expect(notified).toBe(0);
  });

  test("withdraw then reinstate with the very same registration objects, unread in between, still moves the generation", () => {
    const experiments = experimentsDouble(), w = windowWith(experiments);
    experiments.set(true);
    const g1 = w.layouts.contributed.generation!();
    experiments.set(false); experiments.set(true);
    expect(w.layouts.contributed.generation!()).toBeGreaterThan(g1);
    expect(w.defaults.get(HOLO)).toBeDefined();
  });

  test("§6.6, this side: a tab and an own default made from the experiment survive it going off and on; the own default is unavailable meanwhile", () => {
    const experiments = experimentsDouble(), w = windowWith(experiments);
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
    const experiments = experimentsDouble(), w = windowWith(experiments);
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

describe("order-proof reads", () => {
  test("a registration listener registered before the layouts never reads a withdrawn set", () => {
    const experiments = experimentsDouble(), seen: boolean[] = [];
    let w: ReturnType<typeof windowWith> | undefined;
    experiments.onRegistrationsChanged(() => { if (w) seen.push(w.layouts.contributed.list().some(item => item.id === HOLO) || w.layouts.known.panel("holotable.view")); });
    w = windowWith(experiments);
    experiments.set(true); experiments.set(false);
    expect(seen).toEqual([true, false]);
    expect(w.layouts.contributed.generation!()).toBe(experiments.registrationGeneration());
  });
});
