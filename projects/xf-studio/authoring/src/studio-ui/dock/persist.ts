import { recoverDockLayout, type DockLayout, type JsonValue } from "../../ui-preferences";
import { DOCK_FORMAT, DOCK_VERSION, parseTree, recoverWindows, type DockState, type Rect } from "./layout";
import { defaultDockState } from "../layout-defaults";
import type { ViewCatalogue } from "../views/contribution";

/** The dock state is a workspace preference: never part of a recipe, collection or export. */
export function serializeDockState(state: DockState): DockLayout {
  return { format: DOCK_FORMAT, version: DOCK_VERSION, state: structuredClone(state) as unknown as JsonValue };
}

/**
 * Apply a saved preference only through the ui-preferences recovery gate: the
 * engine parses both size classes, re-adds missing panels and pulls floating
 * windows back on screen. Anything else falls back to the defaults.
 */
export function restoreDockPreference(saved: unknown, area: Rect, catalogue: ViewCatalogue): { state: DockState; recovered: boolean } {
  const defaults = defaultDockState(catalogue), panelIds = catalogue.ids;
  const layout = recoverDockLayout(saved, {
    workAreas: [{ x: area.x, y: area.y, width: Math.max(1, area.w), height: Math.max(1, area.h) }],
    panelIds: [...panelIds],
  }, (candidate, context) => {
    if (candidate.format !== DOCK_FORMAT || candidate.version !== DOCK_VERSION) return undefined;
    const state = candidate.state as Record<string, unknown>;
    const wide = parseTree(state?.wide, panelIds, defaults.wide);
    const compact = parseTree(state?.compact, panelIds, defaults.compact);
    if (!wide || !compact) return undefined;
    const work = context.workAreas[0], rect = { x: work.x, y: work.y, w: work.width, h: work.height };
    return { layout: serializeDockState({ wide: recoverWindows(wide, rect), compact: recoverWindows(compact, rect) }),
      onScreen: true };
  });
  if (!layout) return { state: defaults, recovered: false };
  return { state: layout.state as unknown as DockState, recovered: true };
}
