/**
 * Pre-phase-2 workspace shapes from 3d0dabfc: profiles-migration-data.ts `sessionOfWorkspace` and
 * profile-session-state.ts `stored`. Phase 1 already stored one tab, but null meant the factory arrangement,
 * and its focus had no `tab`. Preferences were frozen migration input (studio-startup.ts `legacyLayout`).
 * Keep this builder independent of the current session/migration builders: it is an older writer fixture.
 */
import type { DockLayout } from "../../src/app/ui-preferences";
import type { ProfileSessionData } from "../../src/app/profiles/profile-session";
import { dockPanels, rewriteDock, viewOfPanel } from "../../src/app/profiles/profiles-migration-data";
import { serializeWorkspace } from "../../src/app/workspace/workspace-state";
import { createStudioViewGraph, sessionViewGraph } from "../../src/preview/preview-view-graph";
import { STUDIO_DOCUMENTS } from "../../src/compose/studio-registry";
import { freshWorkspace } from "./eye-region";

export const PHASE_ONE_PROFILE = "p-upgrade", PHASE_ONE_TAB = "t-oldtab01";
export function phaseOneWorkspace(options: { layout?: DockLayout | null; sessionDock?: DockLayout | null; explorer?: boolean; instance?: boolean } = {}) {
  // The phase-1 writer also stored the graph through sessionViewGraph (calibration tokens, not expanded defaults).
  const state = freshWorkspace(), graph = sessionViewGraph(createStudioViewGraph(state.preview));
  const live = options.sessionDock === undefined ? options.layout : options.sessionDock;
  let count = 0;
  const panels = dockPanels(live).map(panel => {
    const view = viewOfPanel(panel), id = `${view ? "view" : panel}--old${++count}abcd`;
    return view ? { id, type: "view", binding: { policy: "pinned" as const, target: { view } } } : { id, type: panel };
  });
  const session: ProfileSessionData = {
    schema: "xfs/profile-session-1",
    tabs: [{ id: PHASE_ONE_TAB, name: "Layout 1", dock: rewriteDock(live, panel => {
      const view = viewOfPanel(panel);
      return panels.find(item => view ? item.binding?.target.view === view : item.type === panel)!.id;
    }), panels: [...panels, ...(options.instance && !panels.some(panel => panel.type === "save-explorer.explorer")
      ? [{ id: "save-explorer.explorer--oldsave1", type: "save-explorer.explorer", state: { selected: "remembered" } }] : [])] }],
    views: { ...graph, views: graph.views.map(view => ({ ...view, tab: PHASE_ONE_TAB })),
      scenes: graph.scenes.map(scene => ({ ...scene, subject: { kind: "character", id: "c-upgrade" },
        look: { collection: "collection-upgrade", look: "look-upgrade" }, gen: 7 })) },
    focus: { views: { main: 4 }, editing: "look:collection-upgrade/look-upgrade" }, seq: 4, closed: [],
  };
  state.migration = { id: "profiles-1", token: "00000000-0000-4000-8000-000000000001", state: "done" };
  state.profiles = { schema: "xfs/workspace-profiles-1", sessions: { [PHASE_ONE_PROFILE]: session } };
  // A factory preference was normally absent. Also exercise an explicit null from older browser storage.
  const stored = serializeWorkspace(state, STUDIO_DOCUMENTS);
  return { ...stored, uiPreferences: { schema: "xfs/ui-preferences-1", theme: "dark", inputHints: true,
    ...(options.layout !== undefined ? { layout: options.layout } : {}),
    ...(options.explorer !== undefined ? { modules: { "save-explorer": options.explorer } } : {}) } };
}
