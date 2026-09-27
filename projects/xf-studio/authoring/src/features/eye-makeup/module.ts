/**
 * Eye makeup's Studio module (view-graph-design.md §3.9, §4): the manifest the Modules menu lists, the view tools it contributes
 * to character scenes (Surface controls on the toolbar; Plate wireframe as a research tool, everywhere at once), and its crumb.
 * Data only: the application derives each view's tools from it, and eye makeup's view renders its summary and readiness.
 */
import type { StudioModule, ViewSummaryContribution, ViewToolContribution } from "../../platform/api";

export const EYE_MAKEUP_MODULE: StudioModule = Object.freeze({
  id: "eye-makeup", label: "Eye makeup", icon: "category", group: "character", stage: "stable", feature: "eye-makeup", shownByDefault: true,
  description: "Layered eye makeup: the layer stack, the UV map, four inspectors and two view tools.",
});

export const EYE_MAKEUP_VIEW_TOOLS: readonly ViewToolContribution[] = Object.freeze([
  { id: "eye-makeup.surface", module: "eye-makeup", label: "Surface controls", title: "Show editable controls on the head", icon: "handles",
    order: 30, scenes: ["character"], placement: "toolbar", kind: "toggle", state: "tools", keywords: "handles points edit on head" },
  // A research tool (UI-85): shown in the toolbar, the menus, the palette and Camera & light only with research tools on.
  { id: "eye-makeup.wire", module: "eye-makeup", label: "Plate wireframe", icon: "wire", order: 40, scenes: ["character"],
    placement: "research", kind: "toggle", state: "tools", keywords: "mesh triangles plate research" },
]);

export const EYE_MAKEUP_SUMMARY: ViewSummaryContribution = Object.freeze({ module: "eye-makeup", scenes: ["character"] });
