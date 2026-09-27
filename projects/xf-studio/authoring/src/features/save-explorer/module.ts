/**
 * The Save Explorer's Studio module (view-graph-design.md §3.9, §4; research/save/save-editor-design.md decision 5): a module without a
 * document part, listed under Tools as a preview and hidden until switched on from the Modules menu. It contributes one panel and no
 * view tools. Data only.
 */
import type { StudioModule } from "../../platform/api";

export const SAVE_EXPLORER_MODULE: StudioModule = Object.freeze({
  id: "save-explorer", label: "Save Explorer", icon: "folder", group: "tools", stage: "preview", shownByDefault: false,
  description: "Look inside your saves, read-only: their nodes, objects and script mods' data.",
});
