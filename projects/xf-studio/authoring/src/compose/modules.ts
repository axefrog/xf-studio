/**
 * The module composition list (view-graph-design.md §3.9, §5.3): every Studio module's manifest and view tools, beside the
 * platform's tools, and the scene kinds views can show. Adding a module adds it here (and its panels to `views.ts`); nothing in
 * the shell or the application names it. The composition roots hand the registration to the trusted core.
 */
import { moduleRegistrationIssues, type ModuleRegistration } from "../platform/api";
import { PLATFORM_VIEW_TOOLS } from "../platform/core/view-tools";
import { EYE_MAKEUP_MODULE, EYE_MAKEUP_SUMMARY, EYE_MAKEUP_VIEW_TOOLS } from "../features/eye-makeup";
import { SAVE_EXPLORER_MODULE } from "../features/save-explorer/module";
import { EXPRESSIONS_MODULE } from "../features/expressions";

export const STUDIO_MODULES = [EYE_MAKEUP_MODULE, SAVE_EXPLORER_MODULE, EXPRESSIONS_MODULE] as const;

export const STUDIO_MODULE_REGISTRATION: ModuleRegistration = Object.freeze({
  modules: STUDIO_MODULES,
  tools: [...PLATFORM_VIEW_TOOLS, ...EYE_MAKEUP_VIEW_TOOLS],
  summaries: [EYE_MAKEUP_SUMMARY],
  scenes: ["character"],
});

const issues = moduleRegistrationIssues(STUDIO_MODULE_REGISTRATION);
if (issues.length) throw Error(`The module registration is incomplete: ${issues.join("; ")}.`);
