/**
 * The panel factories of the view composition list (`views.ts`): the shell's and each feature's bound view,
 * handed to `mountStudio` by the composition roots. Loads every panel module.
 */
import { SHELL_PANELS, type ViewComposition } from "../studio-ui/views/panels";
import { EYE_MAKEUP_VIEW_BINDING } from "../features/eye-makeup/view";
import { STUDIO_CATALOGUE, type StudioPanelId } from "./views";

/** Every feature's bound view, in the order of `STUDIO_VIEWS`. */
export const FEATURE_VIEWS = [EYE_MAKEUP_VIEW_BINDING] as const;
/** Every contributed panel's factory (the shell's take the runtime; a feature's take only its context). */
export const PANEL_FACTORIES: { readonly [K in StudioPanelId]: unknown } = { ...SHELL_PANELS, ...EYE_MAKEUP_VIEW_BINDING.panels };
/** What the composition roots hand the shell. */
export const STUDIO_VIEW_COMPOSITION: ViewComposition = Object.freeze({ catalogue: STUDIO_CATALOGUE, shell: SHELL_PANELS, features: FEATURE_VIEWS });
