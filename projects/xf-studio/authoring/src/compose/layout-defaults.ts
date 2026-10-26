/**
 * The modules' default layouts (profiles design §4.2; experiment 044 chunk P2-ii): each module's `defaults`, listed in module order and
 * checked here, at composition, like the rest of the registration: a default naming a panel type or view tool no module has, or node
 * state the graph's codecs refuse, stops the build from starting. `STUDIO_FRAGMENT_KNOWLEDGE` is what the build has, so an own default
 * from a newer build is listed as unavailable rather than made into a broken tab.
 */
import { contributedDefaultIssues, contributedDefaults, type ContributedDefaultsSource, type ContributedLayoutDefault } from "../app/profiles/layout-defaults";
import type { StudioModule } from "../platform/api";
import { dispatchIsolated } from "../platform/core/listeners";
import type { FragmentKnowledge } from "../app/profiles/layout-fragment";
import { STUDIO_VIEW_GRAPH_RULES } from "../preview/preview-view-graph";
import { STUDIO_MODULE_REGISTRATION, STUDIO_MODULES } from "./modules";
import { STUDIO_CATALOGUE, STUDIO_VIEWS } from "./views";
import { viewCatalogue, type ViewCatalogue, type ViewContribution } from "../studio-ui/views/contribution";
import { legacyEnabledModules, type DockLayout, type UIPreferences } from "../app/ui-preferences";
import { dockPanels, rewriteDock, type InitialProfileLayout } from "../app/profiles/profiles-migration-data";
import { defaultDockState } from "../studio-ui/layout-defaults";
import { DOCK_FORMAT, DOCK_VERSION, parseTree, unparkPanels, type DockState, type DockTree } from "../studio-ui/dock/layout";

const panels = new Set<string>(STUDIO_CATALOGUE.ids), tools = new Set(STUDIO_MODULE_REGISTRATION.tools.map(tool => tool.id));
export const STUDIO_FRAGMENT_KNOWLEDGE: FragmentKnowledge = Object.freeze({ panel: (type: string) => panels.has(type), tool: (id: string) => tools.has(id),
  rules: STUDIO_VIEW_GRAPH_RULES });

const issues = contributedDefaultIssues(STUDIO_MODULES, STUDIO_FRAGMENT_KNOWLEDGE);
if (issues.length) throw Error(`The modules' default layouts are incomplete: ${issues.join("; ")}.`);

export const STUDIO_LAYOUT_DEFAULTS = contributedDefaults(STUDIO_MODULES);

/** An experiment as the layouts see it: its module (with any defaults) and the panels its view contributes while it's on. */
export type LayoutExperiment = { readonly module: StudioModule; readonly contribution: ViewContribution };
/** What the layouts need of the experiments: their registrations, and the owner's signal that the set of them changed. */
export type LayoutExperiments<T extends LayoutExperiment = LayoutExperiment> = {
  registrations(): readonly T[];
  registrationGeneration(): number;
  onRegistrationsChanged(listener: () => void): () => void;
};

/**
 * The one source of default layouts and fragment knowledge the startup hands over: the built-in modules' (checked above, at
 * composition), plus the defaults of the experiments switched on now. An experiment's defaults are checked when it switches on, against
 * the build's knowledge plus that experiment's own panels; an invalid one is refused, logged once and never offered, and it never stops
 * the build. Switching the experiment off withdraws its defaults and its panel types; tabs made from them are the person's and stay.
 */
export function studioLayoutDefaults<T extends LayoutExperiment>(experiments: LayoutExperiments<T>, log: (message: string) => void = () => {}) {
  const refused = new WeakSet<StudioModule>();
  const refuse = (item: LayoutExperiment, reason: string) => {
    if (refused.has(item.module)) return;
    refused.add(item.module);
    log(`The ${item.module.label} experiment's default layouts can't be offered: ${reason}.`);
  };
  // One snapshot per registration set: the defaults and the panel types come from the same `registrations()` read, so the list and the
  // knowledge can never disagree. The experiments own the fact that the set changed: every read compares the snapshot's generation with
  // their `registrationGeneration()` (cheap and authoritative) and rebuilds when it is behind, so no listener, in whatever order it
  // subscribed, can read a withdrawn set. The signal only tells this source's subscribers.
  type Snapshot = { generation: number; list: readonly ContributedLayoutDefault[]; panels: ReadonlySet<string>; registrations: readonly T[]; catalogue?: ViewCatalogue };
  const build = (): Snapshot => {
    const at = experiments.registrationGeneration(), on = [...experiments.registrations()];
    const added = on.flatMap(item => {
      // One experiment's broken defaults never take the others, or the built-in ones, with them.
      try {
        if (!item.module.defaults?.length) return [];
        const own = new Set(item.contribution.panels.map(panel => panel.id));
        const issues = contributedDefaultIssues([item.module], { ...STUDIO_FRAGMENT_KNOWLEDGE, panel: type => panels.has(type) || own.has(type) });
        if (!issues.length) return contributedDefaults([item.module]);
        refuse(item, issues.join("; "));
      } catch (error) { refuse(item, String((error as Error)?.message ?? error)); }
      return [];
    });
    return { generation: at, list: Object.freeze([...STUDIO_LAYOUT_DEFAULTS, ...added]), registrations: Object.freeze(on),
      panels: new Set(on.flatMap(item => item.contribution.panels.map(panel => panel.id))) };
  };
  /**
   * The current snapshot. Behind the experiments' generation, it is rebuilt now; a build that the set changes under (an experiment
   * switched off from inside its own `defaults`) is built again, a few rounds at most. If the set is still changing, the built-in defaults
   * and knowledge stand in, cached for that generation; a withdrawn set is never returned. A read made from inside a build (a listener
   * reached during it) gets the built-ins too.
   */
  const builtIns = (generation: number): Snapshot => ({ generation, list: STUDIO_LAYOUT_DEFAULTS, panels: new Set(), registrations: [] });
  let snap: Snapshot = builtIns(-1), building = false;
  const snapshot = (): Snapshot => {
    const current = experiments.registrationGeneration();
    if (snap.generation === current) return snap;
    if (building) return builtIns(current);
    building = true;
    try {
      for (let rounds = 0; rounds < 4; rounds++) {
        const built = build();
        if (built.generation === experiments.registrationGeneration()) return (snap = built);
      }
      return (snap = builtIns(experiments.registrationGeneration()));
    } finally { building = false; }
  };
  const listeners = new Set<() => void>();
  experiments.onRegistrationsChanged(() => dispatchIsolated(listeners, error =>
    log(`A default layouts listener failed: ${String((error as Error)?.message ?? error)}.`)));
  const known: FragmentKnowledge = Object.freeze({ rules: STUDIO_VIEW_GRAPH_RULES, tool: STUDIO_FRAGMENT_KNOWLEDGE.tool,
    panel: (type: string) => panels.has(type) || snapshot().panels.has(type) });
  const contributed: ContributedDefaultsSource = { list: () => snapshot().list, generation: () => snapshot().generation,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  // Defaults, command metadata, target contexts and the shell's factories all read this same generation-checked registration set.
  return { contributed, known, registrations: () => snapshot().registrations, registrationGeneration: () => snapshot().generation,
    catalogue: () => { const current = snapshot(); return current.catalogue ??= viewCatalogue([...STUDIO_VIEWS, ...current.registrations.map(item => item.contribution)]); } };
}
// A first workspace keeps its legacy view graph, and starts with Eye makeup's contributed panel arrangement in both size classes.
const first = STUDIO_LAYOUT_DEFAULTS.find(item => item.id === "eye-makeup/default")!;
export const STUDIO_INITIAL_LAYOUT: InitialProfileLayout = { origin: first.id, dock: rewriteDock(first.fragment.tab.dock as DockLayout,
  key => key === `view:${first.fragment.views[0]!.key}` ? "head" : first.fragment.panels.find(panel => panel.key === key)?.type ?? key)!, legacyDock };

/** Dock mechanics stay in the adapter: enabled legacy modules return at remembered places, or join their factory siblings. */
function legacyDock(dock: DockLayout, preferences: UIPreferences): DockLayout {
  const on = legacyEnabledModules(preferences);
  const enabled = STUDIO_CATALOGUE.panels.filter(panel => STUDIO_MODULES.some(module => (module.feature ?? module.id) === panel.owner
    && on.has(module.id))).map(panel => panel.id);
  if (!enabled.length || dock.format !== DOCK_FORMAT || dock.version !== DOCK_VERSION || !dock.state || typeof dock.state !== "object") return dock;
  const state = dock.state as unknown as DockState, defaults = defaultDockState(STUDIO_CATALOGUE);
  const tree = (size: "wide" | "compact"): DockTree => {
    const current = state[size], known = dockPanels({ ...dock, state: { [size]: current } as unknown as DockLayout["state"] });
    // Validate without replacing the stored tree: retain its exact split shares, rectangles and unknown fields.
    if (!parseTree(current, known, defaults[size], Object.keys(current?.parked ?? {}))) return current;
    return unparkPanels(current, enabled, defaults[size], { x: 0, y: 0, w: 1280, h: 800 });
  };
  return { ...dock, state: { ...dock.state as object, wide: tree("wide"), compact: tree("compact") } as unknown as DockLayout["state"] };
}
/** Panel types whose state a default keeps (`stateInDefaults`). */
export const keepsStateInDefaults = (type: string) => STUDIO_CATALOGUE.panels.some(panel => panel.id === type && panel.stateInDefaults === true);
