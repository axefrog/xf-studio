/**
 * The Holotable Studio module (research/live-world-view/proposal.md §4): a replay of what the game and XF's systems recorded, drawn
 * over offline world data. Early access behind its experiment until the replay is useful; part-less, one panel, no view tools. Data only.
 */
import type { StudioModule } from "../../platform/api";

export const HOLOTABLE_MODULE: StudioModule = Object.freeze({
  id: "holotable", label: "Holotable", icon: "layers", group: "world", stage: "preview", shownByDefault: true,
  description: "Replay what the game recorded: where V went, what the camera saw and what happened, over a wireframe of Night City.",
});
