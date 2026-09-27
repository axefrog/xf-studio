import { h, setAttr, setDisabled, uid } from "../dom";
import { helpTip, type HelpText } from "../help-tip";
import { icon } from "../icons";

/**
 * Combobox (style guide "Combobox"): a select for long, grouped lists (a "Start from" picker with a couple of hundred entries under
 * "Your saved expressions" and "Installed: <mod>") that the person can type into to filter.
 *
 * - **Closed** it shows the chosen option's label. Typing, a click, Alt+Down or Down opens the list below the field (it floats over what
 *   follows, so nothing moves) filtered by what was typed, with the group headings kept over their matches.
 * - **In the list** Up and Down move through the options (skipping unavailable ones), Ctrl+Home and Ctrl+End jump, Enter or a click chooses, and
 *   Escape closes and restores the chosen label. Leaving the field closes it without choosing.
 * - **Access:** the ARIA combobox pattern: the input is `role="combobox"` with `aria-expanded`, `aria-controls` and
 *   `aria-activedescendant`; the popup is a `listbox` whose groups are `role="group"` named by their headings, and options are
 *   `role="option"` with `aria-selected`; an unavailable option has `aria-disabled` and its reason as its description.
 */
export type ComboOption<T extends string> = { value: T; label: string; detail?: string; disabled?: boolean; reason?: string };
export type ComboGroup<T extends string> = { label?: string; options: readonly ComboOption<T>[] };
export type ComboboxOptions<T extends string> = {
  label: string; placeholder?: string; help?: HelpText; id?: string;
  onChange(value: T): void;
  /** No option matches the typed text. */
  emptyText?: string;
};
const matches = (option: ComboOption<string>, needle: string) => !needle || `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(needle);

export class Combobox<T extends string> {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private groups: readonly ComboGroup<T>[] = [];
  private value: T | undefined;
  private shown: { option: ComboOption<T>; element: HTMLElement }[] = [];
  private active = -1;
  private open = false;
  private signature = "";
  constructor(private readonly options: ComboboxOptions<T>) {
    const id = options.id ?? uid("combo"), listId = `${id}-list`;
    this.input = h("input", { id, class: "field combobox-input", type: "text", role: "combobox", "aria-expanded": "false", "aria-controls": listId,
      "aria-autocomplete": "list", placeholder: options.placeholder, spellcheck: "false", autocomplete: "off" });
    this.list = h("div", { class: "combobox-list", id: listId, role: "listbox", "aria-label": options.label, hidden: true });
    this.element = h("div", { class: "control combobox" },
      h("div", { class: "control-line" }, h("label", { class: "control-label", for: id }, h("span", { text: options.label })),
        options.help !== undefined ? helpTip(options.label, options.help) : null),
      h("div", { class: "combobox-wrap" }, this.input, h("span", { class: "combobox-chevron", "aria-hidden": "true" }, icon("chevronDown")), this.list));
    this.input.addEventListener("input", () => { this.show(true); this.render(this.input.value); });
    this.input.addEventListener("click", () => { if (!this.open) { this.show(true); this.render(""); } });
    this.input.addEventListener("keydown", event => this.key(event));
    this.input.addEventListener("blur", () => this.close());
    // A press in the list must not blur the input before the choice lands.
    this.list.addEventListener("pointerdown", event => event.preventDefault());
  }
  private label(value: T | undefined) {
    for (const group of this.groups) for (const option of group.options) if (option.value === value) return option.label;
    return "";
  }
  update(groups: readonly ComboGroup<T>[], value: T | undefined, disabled = false, reason?: string) {
    const signature = JSON.stringify(groups);
    if (signature !== this.signature) { this.signature = signature; this.groups = groups; if (this.open) this.render(this.input.value); }
    this.value = value;
    if (!this.open && document.activeElement !== this.input) this.input.value = this.label(value);
    setDisabled(this.input, disabled, reason);
  }
  private show(open: boolean) {
    this.open = open;
    this.list.hidden = !open;
    setAttr(this.input, "aria-expanded", String(open));
    if (!open) { this.active = -1; setAttr(this.input, "aria-activedescendant", undefined); }
  }
  private close() { this.show(false); this.input.value = this.label(this.value); }
  private render(text: string) {
    const needle = text.trim().toLowerCase();
    this.shown = [];
    const parts: HTMLElement[] = [];
    for (const group of this.groups) {
      const hits = group.options.filter(option => matches(option, needle));
      if (!hits.length) continue;
      const headingId = uid("combo-group");
      const options = hits.map(option => {
        const element = h("div", { class: "combobox-option", role: "option", id: uid("combo-opt"), "aria-selected": String(option.value === this.value),
          "aria-disabled": option.disabled ? "true" : undefined, "aria-description": option.disabled ? option.reason : undefined },
          h("span", { class: "combobox-option-label", text: option.label }), option.detail ? h("small", { text: option.detail }) : null);
        element.addEventListener("click", () => this.choose(option));
        this.shown.push({ option, element });
        return element;
      });
      parts.push(group.label ? h("div", { class: "combobox-group", role: "group", "aria-labelledby": headingId },
        h("div", { class: "combobox-heading", id: headingId, role: "presentation", text: group.label }), ...options) : h("div", { role: "group" }, ...options));
    }
    this.list.replaceChildren(...(parts.length ? parts : [h("div", { class: "combobox-empty", text: this.options.emptyText ?? "Nothing matches." })]));
    const selected = this.shown.findIndex(entry => entry.option.value === this.value);
    this.move(needle ? this.next(-1, 1) : selected >= 0 ? selected : this.next(-1, 1), false);
  }
  private next(from: number, step: 1 | -1) {
    for (let i = from + step; i >= 0 && i < this.shown.length; i += step) if (!this.shown[i]!.option.disabled) return i;
    return from;
  }
  private move(index: number, scroll = true) {
    this.shown[this.active]?.element.classList.remove("active");
    this.active = index;
    const entry = this.shown[index];
    entry?.element.classList.add("active");
    setAttr(this.input, "aria-activedescendant", entry?.element.id);
    if (scroll) entry?.element.scrollIntoView?.({ block: "nearest" });
  }
  private choose(option: ComboOption<T>) {
    if (option.disabled) return;
    this.value = option.value;
    this.show(false);
    this.input.value = option.label;
    this.options.onChange(option.value);
  }
  private key(event: KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!this.open) { this.show(true); this.render(""); return; }
      this.move(this.next(this.active, event.key === "ArrowDown" ? 1 : -1));
    } else if (this.open && (event.key === "Home" || event.key === "End") && event.ctrlKey) {
      event.preventDefault(); this.move(event.key === "Home" ? this.next(-1, 1) : this.next(this.shown.length, -1));
    } else if (event.key === "Enter" && this.open) {
      event.preventDefault();
      const entry = this.shown[this.active];
      if (entry) this.choose(entry.option);
    } else if (event.key === "Escape" && this.open) {
      event.preventDefault(); event.stopPropagation(); this.close();
    }
  }
}
