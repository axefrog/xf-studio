/**
 * One Character-panel row's choices: a listbox of the option's choices loaded so far (UI-67, UI-70).
 *
 * - **Updated in place.** The selection and the roving focus stop change attributes (`aria-selected`, `tabindex`) on the existing items;
 *   a newly loaded page is appended (Off choices go first, as the creator lists them); only another option or another search rebuilds
 *   the items, and then keyboard focus returns to the same choice (by its position) when it is still listed.
 * - **Keyboard: the listbox pattern.** Arrow keys (and Home, End) move focus between choices without choosing, because every choice
 *   prepares the V anew; Enter or Space (or a click) chooses. The chosen choice is marked by identity (its position among the option's
 *   choices), so two same-named choices are never both marked (CORE-70).
 * - **Provenance** (the game, or the mod a choice comes from) is each item's accessible description and its tooltip.
 * - **Prepared ahead** (character-context-actions.ts `prefetch`): a choice not prepared yet carries a small corner mark, one being prepared
 *   a moving one, and one that couldn't be prepared ahead a warning mark; a ready choice has none. The mark sits in the item's corner, so
 *   it never moves the layout, and its state joins the accessible description and the tooltip. Hovering or focusing a choice hints the
 *   host to prepare it next (`onHint`).
 */
import type { CcPanelChoice } from "../../cc-panel";
import type { ChoiceFetch } from "../../character-context-actions";
import { h, setAttr, setText } from "../dom";

export type ChoiceListInput = {
  /** The option shown (its ID) and the search the list is limited to: another of either rebuilds the list. */
  option: string; query: string;
  label: string; grid: boolean;
  /** The choices loaded so far, in the option's order (pages appended). */
  choices: readonly CcPanelChoice[];
  /** The position of the V's current choice, or null. */
  selected: number | null;
  mods: readonly string[];
  loading: boolean; error: string | null;
  /** Each choice's state of being prepared ahead, by position (none: the host doesn't prepare ahead). */
  fetch?: ReadonlyMap<number, ChoiceFetch> | null;
};

/** A choice's prepared-ahead state as the item shows it: `data-fetch` and the words its description adds. */
const FETCH_SHOWN: Partial<Record<ChoiceFetch, { mark: string; words: string }>> = {
  n: { mark: "pending", words: "not prepared yet" }, q: { mark: "pending", words: "not prepared yet" },
  f: { mark: "fetching", words: "being prepared" }, x: { mark: "failed", words: "couldn't be prepared ahead; choosing it tries again" },
};

export class ChoiceList {
  /** The list and its one status line (loading, a failure, nothing matching). */
  readonly element: HTMLElement;
  readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private items: { choice: CcPanelChoice; element: HTMLButtonElement; from: string; fetch: string }[] = [];
  private byPosition = new Map<number, HTMLButtonElement>();
  private shown: { option: string; query: string } | null = null;
  private selected: number | null = null;
  /** The item that takes Tab focus (roving tabindex). */
  private active: HTMLButtonElement | null = null;

  constructor(id: string, private readonly onChoose: (choice: CcPanelChoice) => void, private readonly onHint: (choice: CcPanelChoice) => void = () => {}) {
    this.list = h("div", { class: "cc-choices", id, role: "listbox" });
    this.status = h("p", { class: "note cc-choices-status", hidden: true });
    this.element = h("div", { class: "cc-choice-list" }, this.list, this.status);
    this.list.addEventListener("keydown", event => this.key(event));
  }

  update(input: ChoiceListInput) {
    const same = this.shown?.option === input.option && this.shown.query === input.query;
    if (!same) this.rebuild(input);
    this.list.classList.toggle("grid", input.grid);
    setAttr(this.list, "aria-label", `${input.label} choices`);
    // Newly loaded choices are appended; an Off choice joins the Off ones at the front.
    for (const choice of input.choices.slice(this.items.length)) this.add(choice, input);
    if (input.selected !== this.selected) {
      const previous = this.selected === null ? undefined : this.byPosition.get(this.selected);
      if (previous) setAttr(previous, "aria-selected", "false");
      this.selected = input.selected;
      const item = input.selected === null ? undefined : this.byPosition.get(input.selected);
      if (item) setAttr(item, "aria-selected", "true");
      if (!this.focused()) this.rove(item ?? this.active);
    } else if (!this.active && this.items.length) this.rove(this.selected !== null ? this.byPosition.get(this.selected) : undefined);
    for (const entry of this.items) this.showFetch(entry, input.fetch?.get(entry.choice.position));
    const line = input.error ?? (input.loading && !this.items.length ? "Loading choices…" : !input.loading && !this.items.length ? "No choice matches." : "");
    setText(this.status, line);
    this.status.hidden = !line;
    this.status.classList.toggle("warning", !!input.error);
  }

  /** Another option or search: new items, and focus back on the same choice when it is still listed. */
  private rebuild(input: ChoiceListInput) {
    const focusedAt = this.focused() ? [...this.byPosition].find(([, item]) => item === document.activeElement)?.[0] : undefined;
    this.list.replaceChildren();
    this.items = []; this.byPosition.clear(); this.active = null; this.selected = null;
    this.shown = { option: input.option, query: input.query };
    for (const choice of input.choices) this.add(choice, input);
    this.selected = input.selected;
    const selected = input.selected === null ? undefined : this.byPosition.get(input.selected);
    if (selected) setAttr(selected, "aria-selected", "true");
    const restore = focusedAt === undefined ? undefined : this.byPosition.get(focusedAt);
    this.rove(restore ?? selected);
    restore?.focus();
  }

  /** Mark an item with its prepared-ahead state (only when it changes). */
  private showFetch(entry: ChoiceList["items"][number], state: ChoiceFetch | undefined) {
    const shown = state ? FETCH_SHOWN[state] : undefined, mark = shown?.mark ?? "";
    if (entry.fetch === mark) return;
    entry.fetch = mark;
    if (mark) setAttr(entry.element, "data-fetch", mark); else entry.element.removeAttribute("data-fetch");
    const description = shown ? `${entry.from}; ${shown.words}` : entry.from;
    setAttr(entry.element, "aria-description", description);
    entry.element.title = `${entry.choice.off ? "Off" : entry.choice.label} · ${description}`;
  }

  /**
   * The loaded choices' positions, the ones in view first (in list order), then the others nearest the view first: the order the host
   * prepares them ahead. Without layout (no view), list order.
   */
  visiblePositions(view: { top: number; bottom: number } | null): number[] {
    if (!view || typeof this.list.getBoundingClientRect !== "function") return this.items.map(entry => entry.choice.position);
    const placed = this.items.map(entry => ({ position: entry.choice.position, rect: entry.element.getBoundingClientRect() }));
    const distance = (rect: DOMRect) => rect.bottom < view.top ? view.top - rect.bottom : rect.top > view.bottom ? rect.top - view.bottom : 0;
    return placed.map((item, order) => ({ ...item, order, far: distance(item.rect) })).sort((a, b) => a.far - b.far || a.order - b.order).map(item => item.position);
  }

  private add(choice: CcPanelChoice, input: ChoiceListInput) {
    const from = choice.mod >= 0 ? `From ${input.mods[choice.mod] ?? "a mod"}` : "From the game";
    const item = h("button", { class: `cc-choice${input.grid ? " swatch-choice" : ""}${choice.off ? " off" : ""}`, type: "button", role: "option",
      "aria-selected": String(choice.position === input.selected), tabindex: "-1", title: `${choice.off ? "Off" : choice.label} · ${from}`,
      "aria-label": choice.off ? "Off" : choice.label, "aria-description": from, "data-position": String(choice.position) },
      input.grid ? h("span", { class: "swatch", style: choice.color ? `--swatch:${choice.color}` : undefined, "data-empty": choice.color ? undefined : "true" }) : null,
      input.grid && !choice.off && choice.color ? null : h("span", { class: "cc-choice-label", text: choice.off ? "Off" : choice.label }));
    item.addEventListener("click", () => { this.rove(item); this.onChoose(choice); });
    item.addEventListener("focus", () => { this.rove(item); this.onHint(choice); });
    item.addEventListener("pointerenter", () => this.onHint(choice));
    const firstPlain = choice.off ? this.items.find(entry => !entry.choice.off)?.element : undefined;
    if (firstPlain) this.list.insertBefore(item, firstPlain); else this.list.appendChild(item);
    const at = firstPlain ? this.items.findIndex(entry => entry.element === firstPlain) : this.items.length;
    this.items.splice(at, 0, { choice, element: item, from, fetch: "" });
    this.byPosition.set(choice.position, item);
  }

  private focused() { return !!document.activeElement && this.items.some(entry => entry.element === document.activeElement); }
  /** Make `item` the one Tab stop of the list (the first item when none). */
  private rove(item: HTMLButtonElement | null | undefined) {
    const target = item ?? this.items[0]?.element ?? null;
    if (target === this.active) return;
    if (this.active) this.active.tabIndex = -1;
    this.active = target;
    if (target) target.tabIndex = 0;
  }

  /** Arrow keys, Home and End move focus (never the choice); Enter and Space choose, as the buttons do. */
  private key(event: KeyboardEvent) {
    const items = this.items.map(entry => entry.element);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const first = items[0]!;
    const columns = this.list.classList.contains("grid") ? Math.max(1, Math.round(this.list.clientWidth / Math.max(1, first.offsetWidth + 4))) : 1;
    const next = event.key === "ArrowRight" ? at + 1 : event.key === "ArrowLeft" ? at - 1 : event.key === "ArrowDown" ? at + columns
      : event.key === "ArrowUp" ? at - columns : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = items[Math.max(0, Math.min(items.length - 1, next))]!;
    this.rove(target);
    target.focus();
  }
}
