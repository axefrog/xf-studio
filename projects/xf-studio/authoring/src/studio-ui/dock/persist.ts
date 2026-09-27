import { recoverDockLayout, type DockLayout, type JsonValue } from "../../ui-preferences";
import { DOCK_FORMAT, DOCK_VERSION, keepDockExpanded, parkPanels, parseTree, recoverWindows, unparkPanels, type DockState, type DockTree, type PanelId,
  type Rect } from "./layout";
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

const MAX_UNKNOWN = 64;
const panelId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 80 && /^[a-z0-9.-]+$/i.test(id);
/** The panels a saved tree names (in its groups, its closed list and its parked places), and the ones it parked. */
function namedPanels(tree: unknown): { named: Set<string>; parked: Set<string> } {
  const named = new Set<string>(), parked = new Set<string>();
  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > 12) return;
    const item = node as Record<string, unknown>;
    if (Array.isArray(item.panels)) for (const id of item.panels) if (panelId(id)) named.add(id);
    if (Array.isArray(item.children)) for (const child of item.children) visit(child, depth + 1);
  };
  if (!tree || typeof tree !== "object") return { named, parked };
  const input = tree as Record<string, unknown>;
  visit(input.root, 0);
  if (Array.isArray(input.floating)) for (const window of input.floating) visit((window as Record<string, unknown> | null)?.node, 0);
  if (Array.isArray(input.closed)) for (const id of input.closed) if (panelId(id)) named.add(id);
  if (input.parked && typeof input.parked === "object" && !Array.isArray(input.parked))
    for (const id of Object.keys(input.parked)) if (panelId(id)) { named.add(id); parked.add(id); }
  return { named, parked };
}

/**
 * Apply a saved preference only through the ui-preferences recovery gate: the
 * engine parses both size classes, re-adds missing panels and pulls floating
 * windows back on screen. Anything else falls back to the defaults. `parked` are
 * the panels of hidden modules (view-graph-design.md §4.3): never re-added, their
 * places kept.
 *
 * Saved layouts outlive builds (§4.5): a panel the catalogue doesn't know (a newer build's, or a view this workspace lacks) is kept
 * parked with its place, never dropped, so saving the arrangement again keeps it; and a panel the saved arrangement parked whose module
 * is shown now comes back at its parked place rather than its factory home.
 */
export function restoreDockPreference(saved: unknown, area: Rect, catalogue: ViewCatalogue, parked: readonly PanelId[] = []): { state: DockState; recovered: boolean } {
  const factory = defaultDockState(catalogue), defaults = defaultDockStateFor(catalogue, parked);
  const layout = recoverDockLayout(saved, {
    workAreas: [{ x: area.x, y: area.y, width: Math.max(1, area.w), height: Math.max(1, area.h) }],
    panelIds: [...catalogue.ids],
  }, (candidate, context) => {
    if (candidate.format !== DOCK_FORMAT || candidate.version !== DOCK_VERSION) return undefined;
    const state = candidate.state as Record<string, unknown>;
    const work = context.workAreas[0], rect = { x: work.x, y: work.y, w: work.width, h: work.height };
    const tree = (value: unknown, fallback: DockTree, defaults: DockTree) => {
      const { named, parked: savedParked } = namedPanels(value);
      const unknown = [...named].filter(id => !catalogue.ids.includes(id)).slice(0, MAX_UNKNOWN);
      const returning = [...savedParked].filter(id => catalogue.ids.includes(id) && !parked.includes(id));
      const withdrawn = [...parked, ...returning];
      const parsed = parseTree(value, catalogue.ids.filter(id => !withdrawn.includes(id)), fallback, [...withdrawn, ...unknown]);
      if (!parsed) return undefined;
      // A parked panel with no remembered place keeps its factory home.
      for (const id of parked) if (!parsed.parked?.[id] && defaults.parked?.[id]) parsed.parked = { ...parsed.parked, [id]: defaults.parked[id] };
      return recoverWindows(returning.length ? unparkPanels(parsed, returning, fallback, rect) : parsed, rect);
    };
    const wide = tree(state?.wide, factory.wide, defaults.wide), compact = tree(state?.compact, factory.compact, defaults.compact);
    if (!wide || !compact) return undefined;
    return { layout: serializeDockState({ wide, compact }), onScreen: true };
  });
  if (!layout) return { state: defaults, recovered: false };
  return { state: layout.state as unknown as DockState, recovered: true };
}

/**
 * Whether two arrangements are the same as the person sees them: every tree, window, collapse, tab and remembered place, with sizes
 * compared to four decimals and key order ignored. Compare states restored through the same gate (`restoreDockPreference`), so a
 * clamped floating window or a panel a newer build added is not a difference.
 */
export function sameDockState(a: DockState, b: DockState): boolean {
  const canonical = (state: DockState) => stable({ wide: keepDockExpanded(state.wide), compact: keepDockExpanded(state.compact) });
  return canonical(a) === canonical(b);
}
function stable(value: unknown): string {
  if (typeof value === "number") return String(Math.round(value * 1e4) / 1e4);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
