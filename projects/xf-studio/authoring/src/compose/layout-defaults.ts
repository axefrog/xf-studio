/**
 * The modules' default layouts (profiles design §4.2; experiment 044 chunk P2-ii): each module's `defaults`, listed in module order and
 * checked here, at composition, like the rest of the registration: a default naming a panel type or view tool no module has, or node
 * state the graph's codecs refuse, stops the build from starting. `STUDIO_FRAGMENT_KNOWLEDGE` is what the build has, so an own default
 * from a newer build is listed as unavailable rather than made into a broken tab.
 */
import { contributedDefaultIssues, contributedDefaults } from "../app/profiles/layout-defaults";
import type { FragmentKnowledge } from "../app/profiles/layout-fragment";
import { STUDIO_VIEW_GRAPH_RULES } from "../preview/preview-view-graph";
import { STUDIO_MODULE_REGISTRATION, STUDIO_MODULES } from "./modules";
import { STUDIO_CATALOGUE } from "./views";
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
