import { h, isUnavailable } from "../dom";
import { icon, type IconName } from "../icons";

/**
 * Icon button (style guide "Buttons"): a borderless square button for a surface's chrome: a panel header's actions, a sheet's or
 * toast's close, a row's visibility or more-actions mark. Its accessible name is `label`, and so is its tooltip unless `title` says
 * more (an icon alone never explains itself). A button that opens a menu says so (`menu`: `aria-haspopup`); a toggle carries
 * `pressed`; a disclosure carries `expanded`. An unavailable one uses the main-action pattern (`applyCapability`): it stays focusable,
 * shows its reason in the page's reason tip, and a click on it runs nothing. A mode toggle (`mode`: mirror sides, snapping) also shows
 * its on state as a tinted square, so the mode reads at a glance; per-row marks that are on by default (layer visibility) leave it off.
 *
 * Use `button({ iconOnly })` (controls.ts) instead for an icon-only action among bordered buttons in a panel's content, so it matches them.
 */
export type IconButtonOptions = {
  label: string; icon: IconName;
  onClick?(event: MouseEvent): void;
  /** Tooltip, when it says more than the label (a shortcut, what happens). */
  title?: string;
  small?: boolean;
  /** Opens a menu (`aria-haspopup="menu"`). */
  menu?: boolean;
  /** A toggle's state (`aria-pressed`). */
  pressed?: boolean;
  /** A mode toggle: when pressed it is tinted as well as coloured (with `pressed`). */
  mode?: boolean;
  /** A disclosure's state (`aria-expanded`). */
  expanded?: boolean;
  /** Extra classes (the owner's hook for placement, e.g. `dock-menu-btn`). */
  className?: string;
};
export function iconButton(options: IconButtonOptions): HTMLButtonElement {
  const title = options.title ?? options.label;
  const element = h("button", { class: `icon-btn${options.small ? " small" : ""}${options.mode ? " mode" : ""}${options.className ? ` ${options.className}` : ""}`, type: "button",
    "aria-label": options.label, title, "data-title": title, "aria-haspopup": options.menu ? "menu" : undefined,
    "aria-pressed": options.pressed === undefined ? undefined : String(options.pressed),
    "aria-expanded": options.expanded === undefined ? undefined : String(options.expanded),
    onclick: (event: MouseEvent) => { if (!isUnavailable(element)) options.onClick?.(event); } }, icon(options.icon));
  return element;
}
