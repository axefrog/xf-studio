/**
 * The Holotable view: its contribution and its bound panel, joined with the shell's by the experiment's loader. The panel receives only
 * a context over the module's facade.
 */
import { moduleView } from "../../../studio-ui/views/feature-view";
import { HOLOTABLE_VIEW } from "./contribution";
import { holotablePanel } from "./panel";

export { HOLOTABLE_PANEL_META, HOLOTABLE_VIEW } from "./contribution";

export const HOLOTABLE_VIEW_BINDING = moduleView(HOLOTABLE_VIEW, { "holotable.view": holotablePanel });
