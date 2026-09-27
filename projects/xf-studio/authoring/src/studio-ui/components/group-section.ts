import { h, setText, uid } from "../dom";
import { expander, expanderLabel, isExpanded, setExpanded, type ExpanderLevel } from "../expander";
import { helpTip, type HelpText } from "../help-tip";
import { iconButton } from "./icon-button";
import { VIEW_KEY } from "../scroll-anchor";
import { viewState } from "../view-state";

/**
 * Group section (style guide "Group section"): a foldable group of controls under the shared expander, for panels with many groups
 * (a face's expression controls, a creator page's sections).
 *
 * - **Heading row:** the expander (chevron and title, at any expander level), an "N set" count in plain muted mono (hidden at 0), an
 *   optional help tip, the group's own actions (`actions`: a region's mirror toggle) and an optional icon-only reset for the whole
 *   group. The reset sits outside the expander button, so pressing it never folds or unfolds the group; it shows only while something
 *   in the group is set (or editing is available), keeping its place otherwise.
 * - **Open state** is remembered under `key` (a view key, view-state.ts: e.g. `expressions.mouth`) across rebuilds and reloads, in the
 *   workspace's view state (never Undo, not part of a layout); with nothing remembered, `expanded` decides. The section also carries
 *   the key as its `data-view-key`, so a remembered scroll position can come back to it (scroll-anchor.ts).
 * - **Search:** `forceOpen` shows the group open while a search matches inside it, without changing the kept state; `hidden` hides
 *   the whole group when the search matches nothing in it. A group the person folds (or opens) during a search stays as they left it
 *   while that search goes on; the next search opens it again.
 * - **Access:** the WAI disclosure pattern (the button's `aria-expanded` and `aria-controls` point at the body); the heading keeps
 *   its level (`h3` to `h5` around the button).
 */
export type GroupSectionOptions = {
  title: string;
  /** The view key its open state is remembered under (`<namespace>.<path>` or `<namespace>:<path>`). */
  key: string;
  level?: ExpanderLevel;
  /** The heading element around the expander (default h4). */
  heading?: 3 | 4 | 5;
  expanded?: boolean;
  help?: HelpText;
  /** Show the group reset; it calls this. It shows only while something in the group is set, keeping its place otherwise. */
  onReset?(): void;
  /** The group's own controls in its heading, before the reset (a mirror toggle for a face region). */
  actions?: readonly HTMLElement[];
  /** Heard after the person folds or unfolds the group. */
  onToggle?(expanded: boolean): void;
  className?: string;
};
export class GroupSection {
  readonly element: HTMLElement;
  readonly body: HTMLElement;
  readonly button: HTMLButtonElement;
  /** How many values are set, as plain muted text (a count, not a status badge). */
  private readonly count = h("span", { class: "group-count", hidden: true });
  private readonly resetButton?: HTMLButtonElement;
  /** A search is showing the group open (`forceOpen`)… */
  private forced = false;
  /** …and the person folded or opened it themselves since, so later updates of that search leave it alone. */
  private overridden = false;
  constructor(private readonly options: GroupSectionOptions) {
    const bodyId = uid("group");
    const open = viewState().expanded(options.key) ?? options.expanded ?? false;
    this.button = expander(options.level ?? "section", { expanded: open, controls: bodyId }, expanderLabel(options.title), this.count);
    this.resetButton = options.onReset ? iconButton({ label: `Reset ${options.title}`, icon: "reset", small: true, className: "group-reset",
      onClick: () => options.onReset!() }) : undefined;
    const tag = (`h${options.heading ?? 4}`) as "h3" | "h4" | "h5";
    this.body = h("div", { class: "group-section-body", id: bodyId });
    this.body.hidden = !open;
    this.element = h("section", { class: `group-section${options.className ? ` ${options.className}` : ""}`, "data-level": options.level ?? "section", [VIEW_KEY]: options.key },
      h("div", { class: "group-section-head" }, h(tag, { class: "group-section-title" }, this.button),
        options.help !== undefined ? helpTip(options.title, options.help) : null, ...(options.actions ?? []), this.resetButton), this.body);
    this.button.addEventListener("click", () => { if (this.forced) this.overridden = true; this.setOpen(!isExpanded(this.button), true); });
  }
  get expanded() { return isExpanded(this.button); }
  /** Open or fold the group; `remember` keeps the choice (the person's own fold, not a search). */
  setOpen(open: boolean, remember = false) {
    if (remember) viewState().setExpanded([this.options.key], open);
    setExpanded(this.button, open);
    this.body.hidden = !open;
    if (remember) this.options.onToggle?.(open);
  }
  /**
   * `set`: how many values in the group are not at their defaults (the badge and the reset follow). `forceOpen`: a search matches inside
   * (shown open, the kept state untouched; the kept state returns when the search ends). `hidden`: the search matches nothing here.
   */
  update(state: { set?: number; forceOpen?: boolean; hidden?: boolean; disabled?: boolean; reason?: string } = {}) {
    const set = state.set ?? 0;
    setText(this.count, `${set} set`);
    this.count.hidden = set === 0;
    // Out of sight (its place kept) when there is nothing to reset or editing is unavailable: no column of faded icons.
    this.resetButton?.classList.toggle("idle", !!state.disabled || set === 0);
    if (state.forceOpen) {
      // Each update of a search re-opens the group only until the person folds it (UI-124).
      if (!this.forced) { this.forced = true; this.overridden = false; }
      if (!this.overridden) this.setOpen(true);
    } else if (this.forced) {
      // The search ended: the kept state returns (what the person last chose, during the search or before it).
      this.forced = this.overridden = false;
      this.setOpen(viewState().expanded(this.options.key) ?? this.options.expanded ?? false);
    }
    this.element.hidden = !!state.hidden;
  }
}
