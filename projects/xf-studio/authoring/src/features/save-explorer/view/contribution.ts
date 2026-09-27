/**
 * The Save Explorer's view contribution: one panel beside the flat editor, closed-by-default placement handled by the module being
 * hidden until switched on. Data only: the composition list (`compose/views.ts`) reads it without loading the panel.
 */
import { panelMeta, type ViewContribution } from "../../../studio-ui/views/contribution";

export const SAVE_EXPLORER_VIEW = {
  owner: "save-explorer",
  panels: [
    { id: "save-explorer.explorer", title: "Save Explorer", icon: "folder", order: 75, slot: "canvas",
      description: "A read-only look inside a save: its nodes, the objects in them and the data script mods keep there." },
  ],
  activity: [{ pattern: /^saves\./, label: "Save Explorer" }],
} as const satisfies ViewContribution;

export const SAVE_EXPLORER_PANEL_META = panelMeta(SAVE_EXPLORER_VIEW);
