import { h, setText, setUnavailable, uid } from "../dom";
import { expander, expanderLabel, isExpanded, setExpanded, type ExpanderLevel } from "../expander";
import { helpTip, type HelpText } from "../help-tip";
import { iconButton } from "./icon-button";

/**
 * Group section (style guide "Group section"): a foldable group of controls under the shared expander, for panels with many groups
 * (a face's expression controls, a creator page's sections).
 *
 * - **Heading row:** the expander (chevron and title, at any expander level), an "N set" count that is hidden at 0, an optional help
 *   tip, and an optional icon-only reset for the whole group. The reset sits outside the expander button, so pressing it never folds
 *   or unfolds the group; it is unavailable (with its reason) when nothing in the group is set.
 * - **Open state** is kept per session under `key` (a module-level map, never saved), so a group stays as the person left it while
 *   the panel is rebuilt.
 * - **Search:** `forceOpen` shows the group open while a search matches inside it, without changing the kept state; `hidden` hides
 *   the whole group when the search matches nothing in it. A group the person folds (or opens) during a search stays as they left it
 *   while that search goes on; the next search opens it again.
 * - **Access:** the WAI disclosure pattern (the button's `aria-expanded` and `aria-controls` point at the body); the heading keeps
 *   its level (`h3` to `h5` around the button).
 */
const openState = new Map<string, boolean>();
/** Forget every kept open state (tests; a workspace reset). */
export const resetGroupSections = () => openState.clear();
export type GroupSectionOptions = {
  title: string;
  /** Session memory of the open state. */
  key: string;
  level?: ExpanderLevel;
  /** The heading element around the expander (default h4). */
  heading?: 3 | 4 | 5;
  expanded?: boolean;
  help?: HelpText;
  /** Show the group reset; it calls this. */
  onReset?(): void;
  /** Heard after the person folds or unfolds the group. */
  onToggle?(expanded: boolean): void;
  className?: string;
};
export class GroupSection {
  readonly element: HTMLElement;
  readonly body: HTMLElement;
  readonly button: HTMLButtonElement;
  private readonly count = h("span", { class: "badge info group-count", hidden: true });
  private readonly resetButton?: HTMLButtonElement;
  /** A search is showing the group open (`forceOpen`)… */
  private forced = false;
  /** …and the person folded or opened it themselves since, so later updates of that search leave it alone. */
  private overridden = false;
  constructor(private readonly options: GroupSectionOptions) {
    const bodyId = uid("group");
    const open = openState.get(options.key) ?? options.expanded ?? false;
    this.button = expander(options.level ?? "section", { expanded: open, controls: bodyId }, expanderLabel(options.title), this.count);
    this.resetButton = options.onReset ? iconButton({ label: `Reset ${options.title}`, icon: "reset", small: true, className: "group-reset",
      onClick: () => options.onReset!() }) : undefined;
    const tag = (`h${options.heading ?? 4}`) as "h3" | "h4" | "h5";
    this.body = h("div", { class: "group-section-body", id: bodyId });
    this.body.hidden = !open;
    this.element = h("section", { class: `group-section${options.className ? ` ${options.className}` : ""}`, "data-level": options.level ?? "section" },
      h("div", { class: "group-section-head" }, h(tag, { class: "group-section-title" }, this.button),
        options.help !== undefined ? helpTip(options.title, options.help) : null, this.resetButton), this.body);
    this.button.addEventListener("click", () => { if (this.forced) this.overridden = true; this.setOpen(!isExpanded(this.button), true); });
  }
  get expanded() { return isExpanded(this.button); }
  /** Open or fold the group; `remember` keeps the choice for the session (the person's own fold, not a search). */
  setOpen(open: boolean, remember = false) {
    if (remember) openState.set(this.options.key, open);
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
    if (this.resetButton) setUnavailable(this.resetButton, !!state.disabled || set === 0,
      state.disabled ? state.reason : `Nothing in ${this.options.title} is changed.`);
    if (state.forceOpen) {
      // Each update of a search re-opens the group only until the person folds it (UI-124).
      if (!this.forced) { this.forced = true; this.overridden = false; }
      if (!this.overridden) this.setOpen(true);
    } else if (this.forced) {
      // The search ended: the kept state returns (what the person last chose, during the search or before it).
      this.forced = this.overridden = false;
      this.setOpen(openState.get(this.options.key) ?? this.options.expanded ?? false);
    }
    this.element.hidden = !!state.hidden;
  }
}
