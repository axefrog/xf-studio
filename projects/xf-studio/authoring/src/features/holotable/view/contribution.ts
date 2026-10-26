/**
 * The Holotable view contribution: three panels over one service. The replay view fills the stage; the recordings sit with the other
 * collections; what to show, story content and the selected mark sit in the inspector. Data only: the experiment's loader reads it
 * without loading the panels.
 */
import { panelMeta, type ViewContribution } from "../../../studio-ui/views/contribution";

export const HOLOTABLE_VIEW = {
  owner: "holotable",
  panels: [
    { id: "holotable.view", context: { kind: "profile" }, title: "Holotable", icon: "layers", order: 300, slot: "stage",
      description: "The replay drawn over a wireframe of Night City: play, scrub, orbit, and pick a mark to see where it came from." },
    { id: "holotable.recordings", context: { kind: "profile" }, title: "Recordings", icon: "history", order: 301, slot: "collection",
      description: "The game sessions the recorder kept on this computer, newest first. Open one to replay it." },
    { id: "holotable.details", context: { kind: "profile" }, title: "Holotable details", icon: "info", order: 302, slot: "inspect",
      description: "What the replay shows, story content, the selected mark and what this recording can't prove." },
  ],
  activity: [{ pattern: /^holo\./, label: "Holotable" }],
} as const satisfies ViewContribution;

export const HOLOTABLE_PANEL_META = panelMeta(HOLOTABLE_VIEW);
