/**
 * The presentation's view composition list (feature-module platform §4, step 5): the shell's view and
 * every feature's view, and the catalogue the shell derives from them. Adding a feature's view adds it
 * here and binds its panel factories in `panels.ts`; nothing else in the shell names its panels.
 *
 * The list sits in `studio-ui/` until the step-5 file moves put eye makeup's view under
 * `features/eye-makeup/view/` and the list with the other composition lists in `compose/`.
 */
import type { IconName } from "../icons";
import type { PanelContribution, ViewContribution } from "./contribution";
import { EYE_MAKEUP_VIEW } from "./eye-makeup";
import { SHELL_VIEW } from "./shell";

export const STUDIO_VIEWS = [SHELL_VIEW, EYE_MAKEUP_VIEW] as const satisfies readonly ViewContribution[];

/** Every contributed panel ID (grandfathered IDs included). */
export type StudioPanelId = (typeof STUDIO_VIEWS)[number]["panels"][number]["id"];
export type PanelMeta = { title: string; icon: IconName; description: string };

/**
 * A composition's panel catalogue: panels in catalogue order, their meta, where closed panels open, the
 * heavy panels and the activity sources. Refuses a panel ID contributed twice.
 */
export function viewCatalogue(views: readonly ViewContribution[]) {
  const panels: (PanelContribution & { owner: string })[] = [];
  const seen = new Set<string>();
  for (const view of views) for (const panel of view.panels) {
    if (seen.has(panel.id)) throw Error(`Panel ${panel.id} is contributed twice.`);
    seen.add(panel.id); panels.push({ ...panel, owner: view.owner });
  }
  panels.sort((a, b) => a.order - b.order);
  return {
    panels,
    ids: panels.map(panel => panel.id),
    meta: Object.fromEntries(panels.map(({ id, title, icon, description }) => [id, { title, icon, description }])) as Record<string, PanelMeta>,
    homes: Object.fromEntries(panels.filter(panel => panel.opensBeside).map(panel => [panel.id, panel.opensBeside!])) as
      Readonly<Record<string, readonly string[]>>,
    heavy: panels.filter(panel => panel.heavy).map(panel => panel.id),
    activity: views.flatMap(view => view.activity),
  };
}
export type ViewCatalogue = ReturnType<typeof viewCatalogue>;

/** The Studio's catalogue. */
export const STUDIO_CATALOGUE = viewCatalogue(STUDIO_VIEWS);
/** Stable panel IDs in catalogue order. Adding a panel later appends it beside its default siblings on restore. */
export const PANEL_IDS = STUDIO_CATALOGUE.ids as readonly StudioPanelId[];
/** Single source for panel titles, icons and purposes (app, menus, palette, guidance and style guide). */
export const PANEL_META = STUDIO_CATALOGUE.meta as Record<StudioPanelId, PanelMeta>;
/** The activity-log source of an action kind ("Studio" when no contribution claims it). */
export function activitySource(kind: string, catalogue: ViewCatalogue = STUDIO_CATALOGUE): string {
  return catalogue.activity.find(source => source.pattern.test(kind))?.label ?? "Studio";
}
