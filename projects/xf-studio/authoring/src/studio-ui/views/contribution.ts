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
