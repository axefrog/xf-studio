/**
 * The panel factories of the view composition list (`views.ts`): the shell's and each feature's, joined
 * and handed to `mountStudio` by the composition roots. Loads every panel module.
 */
import { SHELL_PANELS, type PanelFactory, type ViewComposition } from "../studio-ui/views/panels";
import { EYE_MAKEUP_PANELS } from "../features/eye-makeup/view";
import { STUDIO_CATALOGUE, type StudioPanelId } from "./views";

/** Every contributed panel's factory. */
export const PANEL_FACTORIES: { readonly [K in StudioPanelId]: PanelFactory } = { ...SHELL_PANELS, ...EYE_MAKEUP_PANELS };
/** What the composition roots hand the shell. */
export const STUDIO_VIEW_COMPOSITION: ViewComposition = Object.freeze({ catalogue: STUDIO_CATALOGUE, factories: PANEL_FACTORIES });
