/**
 * The shell's own panel titles, icons and purposes (its panel modules' specs), from its view contribution
 * (`views/shell.ts`). Every contributed panel's meta, features' included, is in the catalogue the
 * composition root hands the shell (`rt.views`).
 */
import { panelMeta, type PanelMeta } from "./views/contribution";
import { SHELL_VIEW } from "./views/shell";

export type { PanelMeta };
export const PANEL_META = panelMeta(SHELL_VIEW);
