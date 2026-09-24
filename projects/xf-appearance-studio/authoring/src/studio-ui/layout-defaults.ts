import { group, split, type DockState, type DockTree, type PanelId, type SizeClass } from "./dock/layout";

/** Stable panel IDs. Adding a panel later appends it beside its default siblings on restore. */
export const PANEL_IDS = ["presets", "layers", "library", "package", "head", "uv", "finish", "shape",
  "edge", "warp", "character", "lighting", "motion", "quality", "activity"] as const satisfies readonly PanelId[];
export type StudioPanelId = typeof PANEL_IDS[number];

/** Wide workspaces: stack on the left, stage in the centre, the active layer's inspector on the right. */
export function defaultWide(): DockTree {
  return { floating: [], root: split("row", [
    split("column", [group(["presets", "library", "package"], "presets", "g-collection"),
      group(["layers"], "layers", "g-layers")], [.4, .6], "s-left"),
    split("column", [group(["head"], "head", "g-head"), group(["uv"], "uv", "g-uv")], [.62, .38], "s-stage"),
    split("column", [group(["finish"], "finish", "g-finish"),
      group(["shape", "edge", "warp"], "shape", "g-inspect"),
      group(["character", "lighting", "motion", "quality"], "character", "g-preview")], [.37, .35, .28], "s-right"),
  ], [.2, .54, .26], "s-root"), closed: ["activity"] };
}
/** Compact workspaces: the stage on top; two tab groups share the lower half. */
export function defaultCompact(): DockTree {
  return { floating: [], root: split("column", [
    group(["head", "uv"], "head", "g-stage"),
    split("row", [group(["layers", "presets", "library", "package"], "layers", "g-stack"),
      group(["finish", "shape", "edge", "warp", "character", "lighting", "motion", "quality"], "finish", "g-inspect")],
    [.42, .58], "s-lower"),
  ], [.5, .5], "s-root"), closed: ["activity"] };
}
export function defaultDockState(): DockState { return { wide: defaultWide(), compact: defaultCompact() }; }
export const COMPACT_BREAKPOINT = 1100;
export const sizeClassFor = (width: number): SizeClass => width >= COMPACT_BREAKPOINT ? "wide" : "compact";
