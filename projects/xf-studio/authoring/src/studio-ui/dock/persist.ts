import { recoverDockLayout, type DockLayout, type JsonValue } from "../../ui-preferences";
import { DOCK_FORMAT, DOCK_VERSION, parkPanels, parseTree, recoverWindows, type DockState, type PanelId, type Rect } from "./layout";
import { defaultDockState } from "../layout-defaults";
import type { ViewCatalogue } from "../views/contribution";

/** The dock state is a workspace preference: never part of a recipe, collection or export. */
export function serializeDockState(state: DockState): DockLayout {
  return { format: DOCK_FORMAT, version: DOCK_VERSION, state: structuredClone(state) as unknown as JsonValue };
}

/**
 * The factory layouts with the panels of hidden modules withdrawn (their factory homes remembered, so showing the module puts
 * them there).
 */
export function defaultDockStateFor(catalogue: ViewCatalogue, parked: readonly PanelId[] = []): DockState {
  const defaults = defaultDockState(catalogue);
  return parked.length ? { wide: parkPanels(defaults.wide, parked), compact: parkPanels(defaults.compact, parked) } : defaults;
}

/**
 * Apply a saved preference only through the ui-preferences recovery gate: the
 * engine parses both size classes, re-adds missing panels and pulls floating
 * windows back on screen. Anything else falls back to the defaults. `parked` are
 * the panels of hidden modules (view-graph-design.md §4.3): never re-added, their
 * places kept.
 */
export function restoreDockPreference(saved: unknown, area: Rect, catalogue: ViewCatalogue, parked: readonly PanelId[] = []): { state: DockState; recovered: boolean } {
  const factory = defaultDockState(catalogue), defaults = defaultDockStateFor(catalogue, parked);
  const panelIds = catalogue.ids.filter(id => !parked.includes(id));
  const layout = recoverDockLayout(saved, {
    workAreas: [{ x: area.x, y: area.y, width: Math.max(1, area.w), height: Math.max(1, area.h) }],
    panelIds: [...catalogue.ids],
  }, (candidate, context) => {
    if (candidate.format !== DOCK_FORMAT || candidate.version !== DOCK_VERSION) return undefined;
    const state = candidate.state as Record<string, unknown>;
    const wide = parseTree(state?.wide, panelIds, factory.wide, parked);
    const compact = parseTree(state?.compact, panelIds, factory.compact, parked);
    if (!wide || !compact) return undefined;
    // A parked panel with no remembered place keeps its factory home.
    for (const [tree, fallback] of [[wide, defaults.wide], [compact, defaults.compact]] as const)
      for (const id of parked) if (!tree.parked?.[id] && fallback.parked?.[id]) tree.parked = { ...tree.parked, [id]: fallback.parked[id] };
    const work = context.workAreas[0], rect = { x: work.x, y: work.y, w: work.width, h: work.height };
    return { layout: serializeDockState({ wide: recoverWindows(wide, rect), compact: recoverWindows(compact, rect) }),
      onScreen: true };
  });
  if (!layout) return { state: defaults, recovered: false };
  return { state: layout.state as unknown as DockState, recovered: true };
}
