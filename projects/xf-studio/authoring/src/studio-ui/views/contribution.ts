/**
 * View contributions (feature-module platform §1, §4; migration step 5): what the shell and each
 * feature's view add to the Studio's presentation. The shell derives its panel catalogue (IDs, titles,
 * icons, purposes), its factory layouts, where closed panels open, which panels repaint lazily and its
 * activity-log sources from these records; it keeps no hand-made list of them.
 *
 * Data only: the panels themselves are built by the factories bound in `panels.ts`, so the catalogue can
 * be read (by guidance, the style guide and tests) without loading any panel.
 */
import type { IconName } from "../icons";

/**
 * Where a panel sits in the shell's factory layouts. The shell maps slots to tab groups per size class
 * (`layout-defaults.ts`): `collection` and `stack` are the left column (one tab group in compact),
 * `stage` the 3D head, `canvas` the flat editor beside it and `inspect` the inspectors. `closed` panels
 * start closed and open beside `opensBeside`.
 */
export type ShellSlot = "collection" | "stack" | "stage" | "canvas" | "inspect";

export type PanelContribution = {
  /**
   * Stable, persisted in saved dock layouts. New features use `<feature>.<panel>`; the panels of the
   * shell and of eye makeup (module #1) keep the IDs they had before contributions existed.
   */
  readonly id: string;
  readonly title: string;
  readonly icon: IconName;
  readonly description: string;
  /**
   * Catalogue position across every contribution: the order of the panel menu, the command palette and
   * the style guide, and the tab order inside a slot.
   */
  readonly order: number;
  readonly slot: ShellSlot | "closed";
  /** A closed-by-default panel opens beside the first of these that is open. */
  readonly opensBeside?: readonly string[];
  /**
   * Repainted at most every 400 ms and never during a gesture: its reads re-validate the whole draft
   * (library and package capabilities).
   */
  readonly heavy?: boolean;
};

/** Which activity-log source an action kind reports under (first matching pattern wins within a contribution). */
export type ActivitySource = { readonly pattern: RegExp; readonly label: string };

export type ViewContribution = {
  /** `shell` for the platform's own panels, else the feature ID whose view this is. */
  readonly owner: string;
  readonly panels: readonly PanelContribution[];
  readonly activity: readonly ActivitySource[];
};

export type PanelMeta = { title: string; icon: IconName; description: string };

/**
 * A composition's panel catalogue: panels in catalogue order, their meta, where closed panels open, the
 * heavy panels and the activity sources. Refuses a panel ID contributed twice. The composition roots build
 * the Studio's catalogue from their view list (`compose/views.ts`) and hand it to the shell.
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

/** One view's own panel meta, keyed by exactly its panel IDs: what its panel modules put in their specs. */
export function panelMeta<V extends ViewContribution>(view: V): { readonly [K in V["panels"][number]["id"]]: PanelMeta } {
  return Object.fromEntries(view.panels.map(({ id, title, icon, description }) => [id, { title, icon, description }])) as
    { [K in V["panels"][number]["id"]]: PanelMeta };
}
/** The activity-log source of an action kind in a catalogue ("Studio" when no contribution claims it). */
export function activitySource(kind: string, catalogue: ViewCatalogue): string {
  return catalogue.activity.find(source => source.pattern.test(kind))?.label ?? "Studio";
}
