import { h, setAttr, setUnavailable, uid } from "../dom";
import { NoteLine } from "../controls";
import { helpTip, type HelpText } from "../help-tip";

/**
 * Choice list (style guide "Choice list"): one choice among several, all shown at once (show the options, don't hide them), in the look
 * of the Character panel's creator choices. It is the single-select control for more than about four options or long labels; Segmented
 * stays for two to four short ones.
 *
 * - **Layouts.** `chips` (the Character panel's look: choices wrap as chips, as many a row as fit), `rows` (one full-width row each, for
 *   long labels), `tiles` (an even grid of small tiles, for numbered sets such as eye shapes 1–22). An optional swatch leads a choice.
 * - **Groups.** A choice may name a `group`: groups show in the order they first appear, each under a small heading.
 * - **Keyboard: the listbox pattern.** One Tab stop (the chosen choice, else the first); arrow keys, Home and End move focus without
 *   choosing (in `tiles`, Up and Down move by a row); Enter, Space or a click chooses.
 * - **States.** The chosen choice is marked (`aria-selected`) with the signal border, fill and underline. An unavailable choice stays
 *   focusable with its reason (the reason tip); the whole list can be unavailable with one reason, shown on its reserved note line, which
 *   also carries a passing state ("Loading that idle…") without ever moving the layout.
 * - **Data-driven.** `setOptions` replaces the choices (a no-op when unchanged; focus stays on the same choice), `update` sets the chosen
 *   one and the availability.
 */
export type ChoiceOption<T extends string> = { value: T; label: string; title?: string; group?: string;
  /** The accessible name when the visible label is short (a tile's "3" is "Eye shape 3"). */
  name?: string;
  /** A colour (or any CSS background) shown as a small swatch before the label. */
  swatch?: string };
export type ChoiceListOptions<T extends string> = {
  label: string; onSelect(value: T): void;
  layout?: "chips" | "rows" | "tiles";
  help?: HelpText; showLabel?: boolean;
  /** Keep the note line from the start (a passing state or the list's reason comes and goes there). */
  reserveNote?: boolean;
  options?: readonly ChoiceOption<T>[];
};

/** One choice's element, as every choice list draws it (shared with the Character panel's creator choices). */
export function choiceItem(options: { label: string; selected?: boolean; title?: string; description?: string; off?: boolean; swatch?: boolean;
  className?: string; content?: Node | null }): HTMLButtonElement {
  return h("button", { class: `choice${options.swatch ? " swatch-choice" : ""}${options.off ? " off" : ""}${options.className ? ` ${options.className}` : ""}`,
    type: "button", role: "option", "aria-selected": String(!!options.selected), tabindex: "-1", title: options.title,
    "aria-label": options.label, "aria-description": options.description },
    options.content === undefined ? h("span", { class: "choice-label", text: options.label }) : options.content);
}

export class ChoiceList<T extends string> {
  readonly element: HTMLElement;
  readonly list: HTMLElement;
  private readonly note: NoteLine;
  private items: { value: T; element: HTMLButtonElement }[] = [];
  private signature = "";
  private selected: T | undefined;
  constructor(private readonly options: ChoiceListOptions<T>) {
    const labelId = uid("choices");
    this.list = h("div", { class: `choices ${options.layout ?? "chips"}`, role: "listbox",
      "aria-label": options.showLabel === false ? options.label : undefined, "aria-labelledby": options.showLabel === false ? undefined : labelId });
    this.note = new NoteLine(options.reserveNote);
    this.element = h("div", { class: "control choice-list" },
      options.showLabel === false ? null : h("div", { class: "control-line" }, h("span", { class: "control-label", id: labelId, text: options.label }),
        options.help !== undefined ? helpTip(options.label, options.help) : null),
      this.list, this.note.element);
    this.list.addEventListener("keydown", event => this.key(event));
    this.setOptions(options.options ?? []);
  }
  /** Replace the choices (a no-op when they are the same); focus stays on the same choice when it is still offered. */
  setOptions(choices: readonly ChoiceOption<T>[]) {
    const signature = JSON.stringify(choices);
    if (signature === this.signature) return;
    this.signature = signature;
    const focused = this.items.find(item => item.element === document.activeElement)?.value;
    this.items = choices.map(choice => {
      const element = choiceItem({ label: choice.name ?? choice.label, title: choice.title ?? choice.name, swatch: false, selected: choice.value === this.selected,
        content: h("span", { class: "choice-content" }, choice.swatch ? h("span", { class: "swatch", "aria-hidden": "true", style: `--swatch:${choice.swatch}` }) : null,
          h("span", { class: "choice-label", text: choice.label })) });
      element.addEventListener("click", () => { if (element.getAttribute("aria-disabled") === "true") return; this.rove(element); this.options.onSelect(choice.value); });
      element.addEventListener("focus", () => this.rove(element));
      return { value: choice.value, element };
    });
    const groups = [...new Set(choices.map(choice => choice.group).filter((group): group is string => !!group))];
    if (groups.length) {
      this.list.classList.add("grouped");
      this.list.replaceChildren(...groups.map(group => h("div", { class: "choice-group", role: "group", "aria-label": group },
        h("span", { class: "choice-group-title", "aria-hidden": "true", text: group }),
        h("div", { class: "choice-group-items" }, ...this.items.filter((_, index) => choices[index]!.group === group).map(item => item.element)))),
        ...this.items.filter((_, index) => !choices[index]!.group).map(item => item.element));
    } else {
      this.list.classList.remove("grouped");
      this.list.replaceChildren(...this.items.map(item => item.element));
    }
    this.rove(this.items.find(item => item.value === (focused ?? this.selected))?.element);
    if (focused !== undefined) this.items.find(item => item.value === focused)?.element.focus();
  }
  /** The chosen value, each choice's capability, and the whole list's state (unavailable with its reason, or a passing note). */
  update(selected: T | undefined, capability: (value: T) => { available: boolean; reason?: string } = () => ({ available: true }),
    state: { disabled?: boolean; reason?: string; note?: string } = {}) {
    this.selected = selected;
    for (const { value, element } of this.items) {
      setAttr(element, "aria-selected", String(value === selected));
      const allowed = state.disabled ? { available: false, reason: state.reason } : capability(value);
      setUnavailable(element, !allowed.available && (!!state.disabled || value !== selected), allowed.reason);
    }
    if (!this.items.some(item => item.element === document.activeElement)) this.rove(this.items.find(item => item.value === selected)?.element);
    this.note.update(this.list, !!state.disabled, state.reason, state.note);
  }
  /** Make `element` the one Tab stop (the first choice when none). */
  private rove(element: HTMLButtonElement | undefined) {
    const target = element ?? this.items[0]?.element;
    for (const item of this.items) item.element.tabIndex = item.element === target ? 0 : -1;
  }
  private key(event: KeyboardEvent) {
    const elements = this.items.map(item => item.element), at = elements.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    let next = at;
    const columns = this.options.layout === "tiles" ? this.columns() : 1;
    if (event.key === "ArrowRight" || (event.key === "ArrowDown" && columns === 1)) next = at + 1;
    else if (event.key === "ArrowLeft" || (event.key === "ArrowUp" && columns === 1)) next = at - 1;
    else if (event.key === "ArrowDown") next = at + columns;
    else if (event.key === "ArrowUp") next = at - columns;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = elements.length - 1;
    else return;
    event.preventDefault();
    const target = elements[Math.max(0, Math.min(elements.length - 1, next))]!;
    this.rove(target);
    target.focus();
  }
  /** How many tiles a row holds (from the laid-out positions; 1 without layout). */
  private columns() {
    const tops = this.items.map(item => typeof item.element.getBoundingClientRect === "function" ? item.element.getBoundingClientRect().top : 0);
    const first = tops[0];
    const count = tops.findIndex(top => top !== first);
    return count > 0 ? count : Math.max(1, tops.length);
  }
  /** The choice labels, in order. */
  labels() { return this.items.map(item => item.element.getAttribute("aria-label") ?? ""); }
}
