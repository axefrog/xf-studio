import { h, setAttr } from "./dom";
import { icon } from "./icons";

/**
 * One expander for everything that folds (style guide "Expanders"): the parts of V (group), their sections, a panel's rows and the
 * author groups inside a row all use the same disclosure button: the same chevron (pointing right when folded, down when open), the same
 * gap between chevron and text, the same focus and hover rules. What differs is only the level's type, in one hierarchy:
 *
 * - **group**: display face, uppercase, the largest heading;
 * - **section**: display face, uppercase, smaller;
 * - **subsection** (a section inside another, e.g. Eyes in Face): display face, uppercase, muted, set in from its parent;
 * - **row**: the UI face, sentence case (a row is content, not a heading);
 * - **maker** (an author group inside a row): the UI face, sentence case, the smallest and muted, with its count.
 *
 * The button carries `aria-expanded` and `aria-controls` (the WAI disclosure pattern); a group or section heading wraps it in its h3–h5,
 * so the heading keeps its level. Folding never moves anything above the button.
 */
export type ExpanderLevel = "group" | "section" | "subsection" | "row" | "maker";

export function expander(level: ExpanderLevel, options: { expanded: boolean; controls?: string; id?: string; tabindex?: string; title?: string },
  ...content: (Node | string | null | undefined | false)[]): HTMLButtonElement {
  return h("button", { class: "expander", type: "button", "data-level": level, "aria-expanded": String(options.expanded), "aria-controls": options.controls,
    id: options.id, tabindex: options.tabindex, title: options.title },
    h("span", { class: "expander-chevron", "aria-hidden": "true" }, icon("chevronRight")), ...content);
}
/** The text part of an expander (clamped to one line). */
export const expanderLabel = (text = "", extraClass = "") => h("span", { class: `expander-label${extraClass ? ` ${extraClass}` : ""}`, text });
export function setExpanded(button: HTMLElement, expanded: boolean) { setAttr(button, "aria-expanded", String(expanded)); }
export const isExpanded = (button: HTMLElement) => button.getAttribute("aria-expanded") === "true";

/**
 * "Expand all" / "Collapse all" for one section, at the far right of its heading: an icon-only button whose name and icon say what a
 * press does now (collapse when everything in it is open, else expand).
 */
export class ExpandAll {
  readonly element: HTMLButtonElement;
  private state: boolean | null = null;
  constructor(private readonly what: string, onPress: (expand: boolean) => void) {
    // Both icons are there; the button's `data-expand` shows one (style guide), so a press never rebuilds it.
    this.element = h("button", { class: "icon-btn small expand-all", type: "button" }, icon("expandAll"), icon("collapseAll"));
    this.element.addEventListener("click", () => onPress(this.state !== false));
    this.update(true);
  }
  /** `expand`: a press expands everything (something is folded); else it collapses everything. */
  update(expand: boolean) {
    if (this.state === expand) return;
    this.state = expand;
    const label = `${expand ? "Expand" : "Collapse"} everything in ${this.what}`;
    setAttr(this.element, "aria-label", label);
    this.element.title = label;
    setAttr(this.element, "data-expand", String(expand));
  }
}
