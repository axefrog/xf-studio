import { h, setText } from "../dom";
import { button } from "../controls";
import { icon } from "../icons";
import { iconButton } from "./icon-button";

/**
 * Search field (style guide "Search field"): filters a list as the person types.
 *
 * - **Filtering:** `onFilter` hears the trimmed query after a short pause in typing (`debounce`, default 120 ms); Enter filters at
 *   once. An owner whose filter is expensive raises the pause rather than filtering on change only, so every search in the app
 *   behaves the same.
 * - **Clearing:** the clear button (shown only while there is a query; it keeps its place, so the field never changes width) and
 *   Escape clear the query and filter at once; Escape on an empty field is left to the page (it closes a menu or a sheet).
 * - **No matches:** `noMatches` gives the list's empty state for a query with no results: what was searched and a Clear search action.
 * - **Access:** `type="search"` in a `role="search"` landmark named by `label`; the input's name is `label` too.
 */
export type SearchFieldOptions = {
  label: string;
  placeholder?: string;
  onFilter(query: string): void;
  /** Pause after typing before filtering, in ms (default 120). */
  debounce?: number;
  value?: string;
  className?: string;
};
export class SearchField {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly clearButton: HTMLButtonElement;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private last: string;
  constructor(private readonly options: SearchFieldOptions) {
    this.last = (options.value ?? "").trim();
    this.input = h("input", { type: "search", class: "field search-input", placeholder: options.placeholder, "aria-label": options.label,
      value: options.value ?? "", spellcheck: "false", autocomplete: "off" });
    this.clearButton = iconButton({ label: "Clear search", icon: "close", small: true, className: "search-clear", onClick: () => { this.clear(); this.input.focus(); } });
    this.element = h("div", { class: `search-field${options.className ? ` ${options.className}` : ""}`, role: "search", "aria-label": options.label },
      h("span", { class: "search-icon", "aria-hidden": "true" }, icon("search")), this.input, this.clearButton);
    this.input.addEventListener("input", () => { this.paint(); this.schedule(); });
    this.input.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); this.flush(); }
      else if (event.key === "Escape" && this.input.value) { event.preventDefault(); event.stopPropagation(); this.clear(); }
    });
    this.paint();
  }
  /** The current (trimmed) query. */
  get value() { return this.input.value.trim(); }
  /** Set the query without filtering (an owner restoring state). */
  set(value: string) { this.input.value = value; this.last = value.trim(); this.paint(); }
  clear() { this.input.value = ""; this.paint(); this.flush(); }
  focus() { this.input.focus(); }
  private paint() { this.clearButton.classList.toggle("empty", !this.input.value); this.clearButton.tabIndex = this.input.value ? 0 : -1; }
  private schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), this.options.debounce ?? 120); }
  private flush() {
    clearTimeout(this.timer);
    const query = this.value;
    if (query === this.last) return;
    this.last = query;
    this.options.onFilter(query);
  }
  /** The empty state for a list this field filtered to nothing: what was searched, and Clear search. */
  noMatches(what = "items"): HTMLElement {
    const body = h("p", { class: "empty-body" });
    setText(body, `No ${what} match “${this.value}”.`);
    return h("div", { class: "empty search-empty", role: "status" }, h("p", { class: "empty-title", text: "No matches" }), body,
      h("div", { class: "empty-actions" }, button({ label: "Clear search", small: true, onClick: () => { this.clear(); this.input.focus(); } })));
  }
}
