/**
 * The Expressions view (feature-module platform §1 `features/<id>/view/`): its contribution and the drawer's factory, which the
 * composition roots join with the shell's (`compose/views.ts`, `compose/view-panels.ts`). The drawer reaches the feature only through
 * its view context: its generic facade (part, actions, form-control transactions), the facial preview and its part presets.
 */
import { featureView } from "../../../studio-ui/views/feature-view";
import { EXPRESSIONS_VIEW } from "./contribution";
import { expressionDrawer } from "./drawer";
import { expressionSets } from "./sets";

export { EXPRESSIONS_VIEW, EXPRESSIONS_PANEL_META } from "./contribution";

export const EXPRESSIONS_VIEW_BINDING = featureView(EXPRESSIONS_VIEW, { panels: { "expressions.controls": expressionDrawer, "expressions.sets": expressionSets } });
