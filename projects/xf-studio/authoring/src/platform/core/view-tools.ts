/**
 * The platform's own view tools (view-graph-design.md §3.9): the orbit camera's framing commands and the character scene's motion.
 * Front view and Whole body view act on the view's camera; Idle plays and pauses the character's rig motion. Modules add their own
 * (`compose/modules.ts` lists them); every view's toolbar, menu, palette entries and Display toggles derive from the joined list.
 *
 * Front view is an orbit-camera tool: it applies to every scene an orbit camera looks at, named "Reset view" off a character once
 * another scene kind exists (World's `location`, P5); until then it lists the one scene kind there is.
 */
import type { ViewToolContribution } from "../api/module";

export const PLATFORM_VIEW_TOOLS: readonly ViewToolContribution[] = Object.freeze([
  { id: "camera.front", module: "platform", label: "Front view", icon: "front", order: 10, scenes: ["character"], placement: "toolbar",
    kind: "action", state: "camera", dispatches: "camera.front", binding: "head.front", keywords: "camera reset face" },
  { id: "camera.body", module: "platform", label: "Whole body view", title: "Frame your V's whole body", icon: "body", order: 20,
    scenes: ["character"], placement: "toolbar", kind: "action", state: "camera", dispatches: "camera.body",
    keywords: "full body camera frame arms legs feet nails" },
  { id: "motion.idle", module: "platform", label: "Character-creator idle", icon: "play", order: 50, scenes: ["character"],
    placement: "toolbar", kind: "toggle", state: "scene", dispatches: "motion.setIdle", keywords: "idle motion animation play pause" },
]);
