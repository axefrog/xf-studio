/**
 * The Poses view (a module without a document part): its contribution and its bound panel, joined with the shell's by the composition
 * (`compose/views.ts`, `compose/view-panels.ts`). The panel receives only a context over the module's facade.
 */
import { moduleView } from "../../../studio-ui/views/feature-view";
import { POSES_VIEW } from "./contribution";
import { posesPanel } from "./panel";

export { POSES_PANEL_META, POSES_VIEW } from "./contribution";

export const POSES_VIEW_BINDING = moduleView(POSES_VIEW, { "poses.library": posesPanel });
