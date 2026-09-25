import { group, split, type DockState, type DockTree, type PanelId, type SizeClass } from "./dock/layout";

/** Stable panel IDs. Adding a panel later appends it beside its default siblings on restore. */
export const PANEL_IDS = ["presets", "layers", "history", "library", "package", "head", "uv", "finish", "shape",
  "edge", "warp", "character", "lighting", "motion", "quality", "activity", "help"] as const satisfies readonly PanelId[];
export type StudioPanelId = typeof PANEL_IDS[number];

/**
 * Factory defaults only; saved arrangements restore as saved. The head is a portrait subject and
 * front framing fits its width, so it gets a portrait cell; the UV map's both-eyes view is about
 * 2.3:1, so it gets a full-width cell. Both stay visible together in each size class.
 *
 * Wide workspaces: stack on the left, the head in a full-height centre column, the UV map over the inspectors on the right.
 */
export function defaultWide(): DockTree {
  return { floating: [], root: split("row", [
    split("column", [group(["presets", "library", "package"], "presets", "g-collection"),
      group(["layers", "history"], "layers", "g-layers")], [.4, .6], "s-left"),
    group(["head"], "head", "g-head"),
    split("column", [group(["uv"], "uv", "g-uv"),
      group(["finish", "shape", "edge", "warp", "character", "lighting", "motion", "quality"], "finish", "g-inspect")], [.42, .58], "s-right"),
  ], [.21, .37, .42], "s-root"), closed: ["activity", "help"] };
}
/** Compact workspaces: head and UV map side by side on top; two tab groups share the lower part. */
export function defaultCompact(): DockTree {
  return { floating: [], root: split("column", [
    split("row", [group(["head"], "head", "g-head"), group(["uv"], "uv", "g-uv")], [.38, .62], "s-stage"),
    split("row", [group(["layers", "history", "presets", "library", "package"], "layers", "g-stack"),
      group(["finish", "shape", "edge", "warp", "character", "lighting", "motion", "quality"], "finish", "g-inspect")],
    [.42, .58], "s-lower"),
  ], [.56, .44], "s-root"), closed: ["activity", "help"] };
}
/**
 * Where a panel that is closed by default opens (beside the first of these that is open). Help
 * reads beside the inspectors rather than covering the head or the collection.
 */
export const CLOSED_PANEL_HOMES: Readonly<Partial<Record<StudioPanelId, readonly StudioPanelId[]>>> = { help: ["finish", "layers"] };
export function defaultDockState(): DockState { return { wide: defaultWide(), compact: defaultCompact() }; }
export const COMPACT_BREAKPOINT = 1100;
export const sizeClassFor = (width: number): SizeClass => width >= COMPACT_BREAKPOINT ? "wide" : "compact";
