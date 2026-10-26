/**
 * The Holotable view contribution: one panel in the stage slot, the replay view with its controls. Data only: the experiment's loader
 * reads it without loading the panel.
 */
import { panelMeta, type ViewContribution } from "../../../studio-ui/views/contribution";

export const HOLOTABLE_VIEW = {
  owner: "holotable",
  panels: [
    { id: "holotable.view", context: { kind: "profile" }, title: "Holotable", icon: "layers", order: 300, slot: "stage",
      description: "Replay a recorded session over a wireframe of Night City: scrub, play, pick what to show, and see where each mark came from." },
  ],
  activity: [{ pattern: /^holo\./, label: "Holotable" }],
} as const satisfies ViewContribution;

export const HOLOTABLE_PANEL_META = panelMeta(HOLOTABLE_VIEW);
