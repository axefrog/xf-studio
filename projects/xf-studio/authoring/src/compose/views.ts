/**
 * The presentation's view composition list (feature-module platform §4, step 5): the shell's view and
 * every feature's view, and the catalogue the shell derives from them. Adding a feature's view adds its
 * contribution to `STUDIO_VIEWS` and its panel factories to `PANEL_FACTORIES` (`view-panels.ts`); nothing in
 * the shell names its panels. The composition roots hand `STUDIO_VIEW_COMPOSITION` to `mountStudio`, so
 * studio-ui never imports this list or a feature's view.
 *
 * Data only: the style guide and tests read the catalogue here without loading any panel module.
 */
import { viewCatalogue, type PanelMeta, type ViewContribution } from "../studio-ui/views/contribution";
import { SHELL_VIEW } from "../studio-ui/views/shell";
import { EYE_MAKEUP_VIEW } from "../features/eye-makeup/view/contribution";

export const STUDIO_VIEWS = [SHELL_VIEW, EYE_MAKEUP_VIEW] as const satisfies readonly ViewContribution[];

/** Every contributed panel ID (grandfathered IDs included). */
export type StudioPanelId = (typeof STUDIO_VIEWS)[number]["panels"][number]["id"];

/** The Studio's catalogue. */
export const STUDIO_CATALOGUE = viewCatalogue(STUDIO_VIEWS);
/** Stable panel IDs in catalogue order. Adding a panel later appends it beside its default siblings on restore. */
export const PANEL_IDS = STUDIO_CATALOGUE.ids as readonly StudioPanelId[];
/** Every contributed panel's title, icon and purpose (menus, palette, guidance and style guide). */
export const PANEL_META = STUDIO_CATALOGUE.meta as Record<StudioPanelId, PanelMeta>;
