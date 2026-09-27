/**
 * The Expressions Studio module (view-graph-design.md §3.9, §4): the manifest the Modules menu lists. It contributes one panel (its
 * view, features/expressions/view/) and no view tools yet (phase 2's region handles will add an on-face tool). Data only.
 */
import type { StudioModule } from "../../platform/api";

export const EXPRESSIONS_MODULE: StudioModule = Object.freeze({
  id: "expressions", label: "Expressions", icon: "face", group: "character", stage: "preview", feature: "expressions", shownByDefault: false,
  description: "Pose V's face with the game's own face controls, or start from a photo-mode expression.",
});
