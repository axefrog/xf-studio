/**
 * The Holotable view: its contribution and its bound panels, joined with the shell's by the experiment's loader. Each panel receives only
 * a context over the module's facade, so the three always show the same recording, moment and selection.
 */
import { moduleView } from "../../../studio-ui/views/feature-view";
import { HOLOTABLE_VIEW } from "./contribution";
import { holotableDetailsPanel } from "./details-panel";
import { holotablePanel } from "./panel";
import { holotableRecordingsPanel } from "./recordings-panel";

export { HOLOTABLE_PANEL_META, HOLOTABLE_VIEW } from "./contribution";

export const HOLOTABLE_VIEW_BINDING = moduleView(HOLOTABLE_VIEW, {
  "holotable.view": holotablePanel, "holotable.recordings": holotableRecordingsPanel, "holotable.details": holotableDetailsPanel,
});
