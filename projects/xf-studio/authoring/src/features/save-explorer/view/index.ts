/**
 * The Save Explorer's view (a module without a document part): its contribution and its bound panel, joined with the shell's by the
 * composition (`compose/views.ts`, `compose/view-panels.ts`). The panel receives only a context over the module's facade.
 */
import { moduleView } from "../../../studio-ui/views/feature-view";
import { SAVE_EXPLORER_VIEW } from "./contribution";
import { explorerPanel } from "./panel";

export { SAVE_EXPLORER_PANEL_META, SAVE_EXPLORER_VIEW } from "./contribution";

export const SAVE_EXPLORER_VIEW_BINDING = moduleView(SAVE_EXPLORER_VIEW, { "save-explorer.explorer": explorerPanel });
