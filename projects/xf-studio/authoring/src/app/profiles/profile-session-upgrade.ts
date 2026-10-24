/** Phase 1's single tab used null for the factory dock; phase 2 uses null for an intentionally empty tab (§8). */
import type { UIPreferences } from "../ui-preferences";
import type { PanelInstance, ProfileSessionData } from "./profile-session";
import { MAIN_VIEW } from "../../platform/api/view-graph";
import { dockPanels, rewriteDock, viewOfPanel, type InitialProfileLayout } from "./profiles-migration-data";

/**
 * Phase 1 never stored a shown-tab focus; phase 2 always does. Convert only the old first tab, before the session/dock can save it.
 * Keep its live arrangement ahead of frozen migration preferences, and never infer that an already-converted empty tab is damaged.
 * The graph, scene targets, identities, bindings, focus numbers and unknown fields survive unchanged.
 */
export function upgradePhaseOneSession(data: ProfileSessionData, preferences: UIPreferences, random: () => number,
  initial?: InitialProfileLayout): ProfileSessionData {
  if (data.focus.tab !== undefined || data.tabs.length !== 1 || data.closed.length) return data;
  const tab = data.tabs[0]!, panels: PanelInstance[] = [...tab.panels];
  const panelKey = (panel: PanelInstance) => {
    const target = panel.binding?.policy === "pinned" ? panel.binding.target : undefined;
    return panel.type === "view" && target && "view" in target ? target.view === MAIN_VIEW ? "head" : `view.${target.view}` : panel.type;
  };
  const byId = new Map(panels.map(panel => [panel.id, panel]));
  const live = tab.dock ? rewriteDock(tab.dock, id => { const panel = byId.get(id); return panel ? panelKey(panel) : id; })
    : preferences.layout ?? null;
  const base = live ?? initial?.dock;
  if (!base) return data;
  const dock = initial?.legacyDock ? initial.legacyDock(base, preferences) : base;
  const byKey = new Map(panels.map(panel => [panelKey(panel), panel]));
  const used = new Set(panels.map(panel => panel.id));
  for (const key of dockPanels(dock)) {
    if (byKey.has(key)) continue;
    const view = viewOfPanel(key), type = view ? "view" : key;
    let id = "";
    // Keep the old instances' IDs, and don't collide with one that is already stored.
    for (let tries = 0; tries < 64; tries++) {
      id = `${type}--${Array.from({ length: 12 }, () => Math.floor(random() * 36).toString(36)).join("")}`;
      if (!used.has(id)) break;
    }
    if (used.has(id)) throw Error("A panel ID couldn't be made: the source of randomness keeps repeating itself.");
    used.add(id);
    const panel: PanelInstance = { id, type, ...(view ? { binding: { policy: "pinned" as const, target: { view } } } : {}) };
    panels.push(panel); byKey.set(key, panel);
  }
  return { ...data, tabs: [{ ...tab, ...(!live && !tab.origin && initial ? { origin: initial.origin } : {}),
    dock: rewriteDock(dock, key => byKey.get(key)?.id ?? key), panels }] };
}
