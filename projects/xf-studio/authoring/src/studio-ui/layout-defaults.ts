import { group, split, type DockNode, type DockState, type DockTree, type SizeClass } from "./dock/layout";
import type { ShellSlot } from "./views/contribution";
import { PANEL_IDS, STUDIO_CATALOGUE, type StudioPanelId, type ViewCatalogue } from "./views";

/** Stable panel IDs and their union, from the view contributions (`views/`). */
export { PANEL_IDS, type StudioPanelId };

/** The panels of one slot, in catalogue order. */
const slot = (catalogue: ViewCatalogue, name: ShellSlot | "closed") => catalogue.panels.filter(panel => panel.slot === name).map(panel => panel.id);
/** A tab group of `panels` (its first panel shown), or nothing when no contribution fills it. */
const tabs = (panels: string[], id: string): DockNode | undefined => panels.length ? group(panels, panels[0], id) : undefined;
/** A split of the children that exist; with one left it stands alone, with none the split is dropped. */
function columns(axis: "row" | "column", children: (DockNode | undefined)[], sizes: number[], id: string): DockNode | undefined {
  const kept = children.flatMap((child, i) => child ? [{ child, size: sizes[i] }] : []);
  if (kept.length <= 1) return kept[0]?.child;
  return split(axis, kept.map(item => item.child), kept.map(item => item.size), id);
}

/**
 * Factory defaults only; saved arrangements restore as saved. The shell owns the arrangement of slots
 * and the contributions fill them (`views/`). The head is a portrait subject and front framing fits its
 * width, so it gets a portrait cell; the UV map's both-eyes view is about 2.3:1, so it gets a full-width
 * cell. Both stay visible together in each size class.
 *
 * Wide workspaces: stack on the left, the head in a full-height centre column, the UV map over the inspectors on the right.
 */
export function defaultWide(catalogue: ViewCatalogue = STUDIO_CATALOGUE): DockTree {
  return { floating: [], root: columns("row", [
    columns("column", [tabs(slot(catalogue, "collection"), "g-collection"), tabs(slot(catalogue, "stack"), "g-layers")], [.4, .6], "s-left"),
    tabs(slot(catalogue, "stage"), "g-head"),
    columns("column", [tabs(slot(catalogue, "canvas"), "g-uv"), tabs(slot(catalogue, "inspect"), "g-inspect")], [.42, .58], "s-right"),
  ], [.21, .37, .42], "s-root") ?? null, closed: slot(catalogue, "closed") };
}
/** Compact workspaces: head and UV map side by side on top; two tab groups share the lower part. */
export function defaultCompact(catalogue: ViewCatalogue = STUDIO_CATALOGUE): DockTree {
  return { floating: [], root: columns("column", [
    columns("row", [tabs(slot(catalogue, "stage"), "g-head"), tabs(slot(catalogue, "canvas"), "g-uv")], [.38, .62], "s-stage"),
    columns("row", [tabs([...slot(catalogue, "stack"), ...slot(catalogue, "collection")], "g-stack"),
      tabs(slot(catalogue, "inspect"), "g-inspect")], [.42, .58], "s-lower"),
  ], [.56, .44], "s-root") ?? null, closed: slot(catalogue, "closed") };
}
/** Where a panel that is closed by default opens (beside the first of these that is open), from the contributions. */
export const CLOSED_PANEL_HOMES = STUDIO_CATALOGUE.homes as Readonly<Partial<Record<StudioPanelId, readonly StudioPanelId[]>>>;
export function defaultDockState(catalogue: ViewCatalogue = STUDIO_CATALOGUE): DockState {
  return { wide: defaultWide(catalogue), compact: defaultCompact(catalogue) };
}
export const COMPACT_BREAKPOINT = 1100;
export const sizeClassFor = (width: number): SizeClass => width >= COMPACT_BREAKPOINT ? "wide" : "compact";
