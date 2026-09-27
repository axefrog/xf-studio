/**
 * The Poses Studio module (view-graph-design.md §5.1; pose-library-design.md §6): a module without a document part, listed under
 * Character as a preview and hidden until switched on from the Modules menu. It contributes one panel and no view tools. Data only.
 */
import type { StudioModule } from "../../platform/api";

export const POSES_MODULE: StudioModule = Object.freeze({
  id: "poses", label: "Poses", icon: "body", group: "character", stage: "preview", shownByDefault: false,
  description: "Every photo-mode pose from your game and mods, in one searchable tree.",
});
