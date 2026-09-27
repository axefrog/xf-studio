/**
 * The module composition list (view-graph-design.md §3.9, §5.3): every Studio module's manifest and view tools, beside the
 * platform's tools, and the scene kinds views can show. Adding a module adds it here (and its panels to `views.ts`); nothing in
 * the shell or the application names it. The composition roots hand the registration to the trusted core.
 */
import { moduleRegistrationIssues, type ModuleRegistration, type PlannedModule } from "../platform/api";
import { PLATFORM_VIEW_TOOLS } from "../platform/core/view-tools";
import { EYE_MAKEUP_MODULE, EYE_MAKEUP_SUMMARY, EYE_MAKEUP_VIEW_TOOLS } from "../features/eye-makeup";
import { SAVE_EXPLORER_MODULE } from "../features/save-explorer/module";
import { EXPRESSIONS_MODULE } from "../features/expressions";
import { POSES_MODULE } from "../features/poses/module";

export const STUDIO_MODULES = [EYE_MAKEUP_MODULE, SAVE_EXPLORER_MODULE, EXPRESSIONS_MODULE, POSES_MODULE] as const;

/**
 * Modules on the roadmap with an agreed design (ui-copy-and-layout-review.md §6), listed as Planned in the Modules menu. The module
 * that lands with one of these IDs deletes its entry here in the same change (tests/coming-soon.test.ts fails while both exist).
 */
export const PLANNED_MODULES: readonly PlannedModule[] = Object.freeze([
  { id: "nails", label: "Nail Salon", icon: "character", group: "character", comingSoon: "design your V's nails, with shapes, text and polish finishes.",
    design: "research/nails/nail-salon-design.md" },
  { id: "hair-colours", label: "Hair colours", icon: "character", group: "character", comingSoon: "make your own hair colours as new creator choices.",
    design: "research/hair/hair-colour-authoring-feasibility.md" },
  { id: "brows", label: "Brows", icon: "character", group: "character", comingSoon: "design your V's eyebrows.",
    design: "research/brows/brow-editor-design.md" },
  { id: "cheeks", label: "Cheeks", icon: "character", group: "character", comingSoon: "design cheek makeup for your V.",
    design: "research/backlog/brows-and-cheeks-brief.md" },
  { id: "tattoos", label: "Tattoos", icon: "character", group: "character", comingSoon: "design tattoos for your V's face and body.",
    design: "research/character-customization/tattoos-brief.md" },
]);

export const STUDIO_MODULE_REGISTRATION: ModuleRegistration = Object.freeze({
  modules: STUDIO_MODULES,
  tools: [...PLATFORM_VIEW_TOOLS, ...EYE_MAKEUP_VIEW_TOOLS],
  summaries: [EYE_MAKEUP_SUMMARY],
  scenes: ["character"],
  planned: PLANNED_MODULES,
});

const issues = moduleRegistrationIssues(STUDIO_MODULE_REGISTRATION);
if (issues.length) throw Error(`The module registration is incomplete: ${issues.join("; ")}.`);
