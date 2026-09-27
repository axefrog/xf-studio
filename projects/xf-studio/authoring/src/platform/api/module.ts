/**
 * Studio modules (research/authoring/view-graph-design.md §3.9, §4): the unit a person shows or hides from the Modules menu. A
 * module owns panels, view tools, view summaries and (later) scene kinds, all keyed by its ID. Modules are combinable, not
 * exclusive. Hiding one withdraws its panels and tools and parks its layout; its data and exports are untouched. A feature module
 * is presented by the Studio module of the same ID; a module need not present a feature (Poses, World).
 *
 * Types and pure helpers only: data a composition lists (`compose/modules.ts`), which the application derives from.
 */
import type { SceneKind } from "./view-graph";

export type ModuleId = string;
/** The Modules menu's sections. */
export type ModuleGroup = "character" | "world" | "assets" | "tools";
export type StudioModule = {
  readonly id: ModuleId;
  readonly label: string;
  /** An icon name the presentation knows (it falls back to a generic icon for one it doesn't). */
  readonly icon: string;
  readonly group: ModuleGroup;
  readonly stage: "stable" | "preview" | "dev";
  /** The feature module it presents, if any. */
  readonly feature?: string;
  readonly shownByDefault: boolean;
  /** One plain line of what it adds, for the Modules menu. */
  readonly description: string;
};

/**
 * A button, toggle or menu a view shows (design §3.9): derived per view from the platform's tools and the tools of shown modules
 * whose `scenes` include the view's scene kind, never written into the shell.
 *
 * - `placement`: `toolbar` (the view's toolbar and its menu), `menu` (the view's menu and the palette only), `research` (everywhere,
 *   but only with research tools on).
 * - `kind`: `toggle` (on or off), `action` (one command), `menu` (a list of choices).
 * - `state`: which node holds its state: the view's `tools` node (a module's overlay or editing tool), its `camera` (a framing
 *   command) or its `scene` (the subject's motion).
 */
export type ViewToolContribution = {
  readonly id: string;
  readonly module: ModuleId | "platform";
  readonly label: string;
  /** A longer description for the tooltip (absent: the label). */
  readonly title?: string;
  readonly icon: string;
  readonly order: number;
  readonly scenes: readonly SceneKind[];
  readonly placement: "toolbar" | "menu" | "research";
  readonly kind: "toggle" | "action" | "menu";
  readonly state: "tools" | "camera" | "scene";
  /** The key binding whose chord the tool's menu entry shows (an input-binding ID such as `head.front`). */
  readonly binding?: string;
  /** Palette search words. */
  readonly keywords?: string;
};

/** A module's crumb in a view (design §3.9): "Preset › Layer" is the platform's preset then eye makeup's summary. */
export type ViewSummaryContribution = { readonly module: ModuleId; readonly scenes: readonly SceneKind[] };

/** What a composition registers about modules: their manifests and every view tool (the platform's and each module's). */
export type ModuleRegistration = {
  readonly modules: readonly StudioModule[];
  readonly tools: readonly ViewToolContribution[];
  readonly summaries: readonly ViewSummaryContribution[];
  /** The scene kinds views can show (`character`, and module-registered kinds later). */
  readonly scenes: readonly SceneKind[];
};

/** Which modules show, and whether research tools do: presentation state the derivation is given, never reads (design §4.2). */
export type ViewToolFilter = { readonly modules: readonly ModuleId[]; readonly research: boolean };

/**
 * A view's tools (design §3.9): the platform's tools and the shown modules' tools that apply to the view's scene kind, without
 * research placements unless research tools show, in `order`. Pure.
 */
export function deriveViewTools(registration: Pick<ModuleRegistration, "tools">, sceneKind: SceneKind, filter: ViewToolFilter): ViewToolContribution[] {
  const shown = new Set(filter.modules);
  return registration.tools.filter(tool => (tool.module === "platform" || shown.has(tool.module)) && tool.scenes.includes(sceneKind) &&
    (tool.placement !== "research" || filter.research)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
/** The shown modules' summaries for a scene kind, in module order. */
export function deriveViewSummaries(registration: Pick<ModuleRegistration, "summaries" | "modules">, sceneKind: SceneKind, filter: Pick<ViewToolFilter, "modules">) {
  const shown = new Set(filter.modules), order = registration.modules.map(module => module.id);
  return registration.summaries.filter(summary => shown.has(summary.module) && summary.scenes.includes(sceneKind))
    .sort((a, b) => order.indexOf(a.module) - order.indexOf(b.module));
}
/**
 * Registry completeness (design §6.3 rule 7): module IDs are unique; every tool and summary names a registered module (or the
 * platform) and only registered scene kinds; tool IDs are unique and module tools are prefixed with their module's ID. Returns
 * the problems found (empty when complete).
 */
export function moduleRegistrationIssues(registration: ModuleRegistration): string[] {
  const issues: string[] = [], ids = new Set<string>(), tools = new Set<string>(), scenes = new Set(registration.scenes);
  for (const module of registration.modules) {
    if (ids.has(module.id)) issues.push(`module ${module.id} is registered twice`);
    ids.add(module.id);
  }
  for (const tool of registration.tools) {
    if (tools.has(tool.id)) issues.push(`tool ${tool.id} is registered twice`);
    tools.add(tool.id);
    if (tool.module !== "platform" && !ids.has(tool.module)) issues.push(`tool ${tool.id} names unregistered module ${tool.module}`);
    if (tool.module !== "platform" && !tool.id.startsWith(`${tool.module}.`)) issues.push(`tool ${tool.id} is not prefixed with its module ${tool.module}`);
    if (!tool.scenes.length || tool.scenes.some(kind => !scenes.has(kind))) issues.push(`tool ${tool.id} names an unregistered scene kind`);
  }
  for (const summary of registration.summaries) {
    if (!ids.has(summary.module)) issues.push(`summary names unregistered module ${summary.module}`);
    if (summary.scenes.some(kind => !scenes.has(kind))) issues.push(`summary of ${summary.module} names an unregistered scene kind`);
  }
  return issues;
}
