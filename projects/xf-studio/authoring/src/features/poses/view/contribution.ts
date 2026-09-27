/**
 * The Poses view contribution (view-graph-design.md §5.1): one panel, the pose library, in the inspector slot beside Character. Data
 * only: the composition list (`compose/views.ts`) reads it without loading the panel.
 */
import { panelMeta, type ViewContribution } from "../../../studio-ui/views/contribution";

export const POSES_VIEW = {
  owner: "poses",
  panels: [
    { id: "poses.library", title: "Poses", icon: "body", order: 125, slot: "inspect",
      description: "Every photo-mode pose from your game and mods: search, star favourites, one click poses V." },
  ],
  activity: [{ pattern: /^pose\./, label: "Poses" }],
} as const satisfies ViewContribution;

export const POSES_PANEL_META = panelMeta(POSES_VIEW);
