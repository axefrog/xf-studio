/**
 * One Character-panel row's choices: a listbox of the option's choices loaded so far (UI-67, UI-70).
 *
 * - **Updated in place.** The selection and the roving focus stop change attributes (`aria-selected`, `tabindex`) on the existing items;
 *   a newly loaded page is appended (Off choices go first, as the creator lists them); only another option or another search rebuilds
 *   the items, and then keyboard focus returns to the same choice (by its position) when it is still listed.
 * - **At once.** A chosen item is marked chosen as it is clicked, and marked as being prepared while the V is prepared with it; the
 *   character context shows the choice before the host's view of it arrives (character-context-actions.ts `view`).
 * - **Keyboard: the listbox pattern.** Arrow keys (and Home, End) move focus between choices without choosing, because every choice
 *   prepares the V anew; Enter or Space (or a click) chooses. The chosen choice is marked by identity (its position among the option's
 *   choices), so two same-named choices are never both marked (CORE-70).
 * - **Provenance** (the game, or the mod a choice comes from) is each item's accessible description and its tooltip.
 * - **Prepared ahead** (character-context-actions.ts `prefetch`): a choice not prepared yet carries a small corner mark, one being prepared
 *   a moving one, and one that couldn't be prepared ahead a warning mark; a ready choice has none. The mark sits in the item's corner, so
 *   it never moves the layout, and its state joins the accessible description and the tooltip. Hovering or focusing a choice hints the
 *   host to prepare it next (`onHint`).
 * - **Swatches show what you'll get** (cc-swatch.ts): in a colour grid every choice, the game's or a mod's, is a narrow swatch: the game's
 *   own atlas icon where the choice has one (unless a mod replaced the colour's resource, when the icon would show the old colour), else
 *   the colour the host derived from the winning resource (a hair, brow or lash profile as a small root-to-tip gradient), else the
 *   definition's own colour. Swatches arriving later update the items in place; a choice still without one keeps its place, marked as
 *   waiting. The label stays the item's accessible name and tooltip.
 * - **Grouped by who made them** (cc-panel.ts `groups`, cc-controls backlog 4a): when a row's choices come from more than one maker, each
 *   maker's choices sit under a small heading (the base game first, then XF Studio, then every author or mod by name), in the creator's
 *   order within it; Off stays above the groups. A heading is a button that folds its group away and back (Enter, Space or a click;
 *   Left folds and Right unfolds it from the keyboard), remembered per option while the panel is open. A folded group holding the V's
 *   choice says so. Arrow keys move through headings and the choices of unfolded groups in the order they show; in a colour grid Up
 *   and Down move by the group's own columns and step onto the heading next to it at its edges. A row with one maker has no headings.
 *   A heading is the shared expander (expander.ts, level "maker"). Makers with a single choice in the row share one "Other mods" heading,
 *   last, its choices sorted by label (cc-panel.ts `pooled`); each choice's mod is in its tooltip and description as everywhere.
 */
import { type CcChoiceGroup, type CcPanelChoice, choiceGroup, compareGroups, OTHER_MODS_GROUP, OTHER_MODS_INDEX } from "../../cc-panel";
import type { CharacterSwatchState, ChoiceFetch } from "../../character-context-actions";
import { h, setAttr, setText } from "../dom";
import { expander, expanderLabel, setExpanded } from "../expander";
import { choiceItem } from "../components/choice-list";

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
  /** A colour row's swatches and icons by position (grid rows; null until they arrive). */
  swatches?: CharacterSwatchState | null;
  /** The V is being prepared with the current choices: the chosen item shows it is on its way, in place. */
  preparing?: boolean;
  /** Who made each choice (the panel's `groups` and `modGroups`): shown grouped by maker; null or absent for a row with one maker. */
  groups?: { readonly list: readonly CcChoiceGroup[]; readonly modGroups: readonly number[];
    /** The option's groups shown together under "Other mods" (cc-panel.ts `CcPanel.pools` at the option's `pool`). */
    readonly pooled?: readonly number[] } | null;
};
type Group = { index: number; key: string; head: HTMLButtonElement; count: HTMLElement; body: HTMLElement; element: HTMLElement; entries: Entry[]; open: boolean;
  chosen: boolean };
type Entry = { choice: CcPanelChoice; element: HTMLButtonElement; from: string; fetch: string; swatch: HTMLElement | null; look: string; group: Group | null };

/** How one grid choice's swatch is drawn: CSS custom properties on its swatch element, and whether it is still waiting. */
export type SwatchLook = { readonly background: string; readonly image: string; readonly size: string; readonly position: string; readonly waiting: boolean;
  readonly kind: "icon" | "gradient" | "colour" | "none" };
/** One choice's swatch look from the row's swatches (see the module note for the order). */
export function swatchLook(choice: Pick<CcPanelChoice, "position" | "color">, swatches: CharacterSwatchState | null | undefined): SwatchLook {
  const text = swatches?.swatches[choice.position] ?? "", replaced = text.startsWith("!");
  const colours = text ? text.replace(/^!/, "").split(">") : [];
  const tint = colours.length === 1 ? colours[0]! : choice.color ?? (colours.length ? colours[Math.floor(colours.length / 2)]! : "");
  const icon = swatches?.icons[choice.position] ?? "";
  const [sheetId, cell] = icon ? icon.split(":").map(Number) as [number, number] : [NaN, NaN];
  const sheet = icon ? swatches?.sheets.get(sheetId) : undefined;
  if (sheet?.url && !replaced) {
    const column = cell % sheet.columns, row = Math.floor(cell / sheet.columns);
    const at = (index: number, count: number) => count > 1 ? `${(index / (count - 1)) * 100}%` : "0%";
    return { background: tint || "transparent", image: `url("${sheet.url}")`, size: `${sheet.columns * 100}% ${sheet.rows * 100}%`,
      position: `${at(column, sheet.columns)} ${at(row, sheet.rows)}`, waiting: false, kind: "icon" };
  }
  if (colours.length > 1) return { background: colours[0]!, image: `linear-gradient(to bottom, ${colours.join(", ")})`, size: "100% 100%", position: "0 0",
    waiting: false, kind: "gradient" };
  if (tint) return { background: tint, image: "none", size: "auto", position: "0 0", waiting: false, kind: "colour" };
  return { background: "", image: "none", size: "auto", position: "0 0", waiting: !!swatches?.pending || !swatches, kind: "none" };
}

/** A choice's prepared-ahead state as the item shows it: `data-fetch` and the words its description adds. */
const FETCH_SHOWN: Partial<Record<ChoiceFetch, { mark: string; words: string }>> = {
  n: { mark: "pending", words: "not prepared yet" }, q: { mark: "pending", words: "not prepared yet" },
  f: { mark: "fetching", words: "being prepared" }, x: { mark: "failed", words: "couldn't be prepared ahead; choosing it tries again" },
};

/** What decides whether a list is grouped, and how: another of it rebuilds the list. */
const groupedKey = (input: ChoiceListInput) => input.groups ? `g:${(input.groups.pooled ?? []).join(",")}` : "";

export class ChoiceList {
  /** The list and its one status line (loading, a failure, nothing matching). */
  readonly element: HTMLElement;
  readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private items: Entry[] = [];
  private byPosition = new Map<number, HTMLButtonElement>();
  private shown: { option: string; query: string; grouped: string } | null = null;
  /** The groups pooled under "Other mods" in the list shown. */
  private pooled = new Set<number>();
  /** The maker groups by group index (null: not grouped), their order, and the Off choices above them. */
  private groups: Map<number, Group> | null = null;
  private order: (a: number, b: number) => number = (a, b) => a - b;
  private lead: HTMLElement | null = null;
  /** Folded groups, by option and group label (kept while the panel is open). */
  private readonly folded = new Set<string>();
  private selected: number | null = null;
  /** The item that takes Tab focus (roving tabindex). */
  private active: HTMLButtonElement | null = null;

  constructor(id: string, private readonly onChoose: (choice: CcPanelChoice) => void, private readonly onHint: (choice: CcPanelChoice) => void = () => {}) {
    this.list = h("div", { class: "choices cc-choices", id, role: "listbox" });
    this.status = h("p", { class: "note cc-choices-status", hidden: true });
    this.element = h("div", { class: "cc-choice-list" }, this.list, this.status);
    this.list.addEventListener("keydown", event => this.key(event));
  }

  update(input: ChoiceListInput) {
    const same = this.shown?.option === input.option && this.shown.query === input.query && this.shown.grouped === groupedKey(input);
    if (!same) this.rebuild(input);
    this.list.classList.toggle("grid", input.grid);
    setAttr(this.list, "aria-label", `${input.label} choices`);
    // Newly loaded choices are appended; an Off choice joins the Off ones at the front.
    for (const choice of input.choices.slice(this.items.length)) this.add(choice, input);
    if (input.selected !== this.selected) {
      const item = this.select(input.selected);
      if (!this.focused()) this.rove(item ?? this.active);
    } else if (!this.active && this.items.length) this.rove(this.selected !== null ? this.byPosition.get(this.selected) : undefined);
    for (const entry of this.items) {
      this.showFetch(entry, input.preparing && entry.choice.position === input.selected ? "f" : input.fetch?.get(entry.choice.position));
      this.paintSwatch(entry, input.swatches);
    }
    this.markChosen();
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
    this.shown = { option: input.option, query: input.query, grouped: groupedKey(input) };
    this.groups = input.groups ? new Map() : null;
    this.pooled = new Set(input.groups?.pooled ?? []);
    this.order = input.groups ? compareGroups(input.groups.list) : (a, b) => a - b;
    this.lead = input.groups ? h("div", { class: "cc-maker-items cc-maker-lead" }) : null;
    this.list.classList.toggle("grouped", !!input.groups);
    if (this.lead) this.list.appendChild(this.lead);
    for (const choice of input.choices) this.add(choice, input);
    this.selected = input.selected;
    const selected = input.selected === null ? undefined : this.byPosition.get(input.selected);
    if (selected) setAttr(selected, "aria-selected", "true");
    const restore = focusedAt === undefined ? undefined : this.byPosition.get(focusedAt);
    this.rove(restore ?? selected);
    restore?.focus();
  }

  /** Draw a grid item's swatch (only when its look changes: swatches arrive after the items). */
  private paintSwatch(entry: ChoiceList["items"][number], swatches: CharacterSwatchState | null | undefined) {
    if (!entry.swatch) return;
    const look = swatchLook(entry.choice, swatches), key = JSON.stringify(look);
    if (entry.look === key) return;
    entry.look = key;
    const style = entry.swatch.style;
    style.setProperty("--swatch", look.background || "transparent");
    style.setProperty("--swatch-image", look.image);
    style.setProperty("--swatch-size", look.size);
    style.setProperty("--swatch-position", look.position);
    setAttr(entry.swatch, "data-look", look.kind);
    if (look.kind === "none") setAttr(entry.swatch, "data-empty", look.waiting ? "waiting" : "true"); else entry.swatch.removeAttribute("data-empty");
  }

  /** Mark the item at `position` as the chosen one (and no other); returns it. */
  private select(position: number | null): HTMLButtonElement | undefined {
    const previous = this.selected === null ? undefined : this.byPosition.get(this.selected);
    if (previous) setAttr(previous, "aria-selected", "false");
    this.selected = position;
    const item = position === null ? undefined : this.byPosition.get(position);
    if (item) setAttr(item, "aria-selected", "true");
    this.markChosen();
    return item;
  }

  /** A folded group holding the V's choice says so on its heading. */
  private markChosen() {
    for (const group of this.groups?.values() ?? []) {
      const chosen = group.entries.some(entry => entry.choice.position === this.selected);
      if (chosen === group.chosen) continue;
      group.chosen = chosen;
      if (chosen) setAttr(group.head, "data-chosen", ""); else group.head.removeAttribute("data-chosen");
      this.describeGroup(group);
    }
  }
  private describeGroup(group: Group) {
    const words = group.chosen && !group.open ? "Your choice is in this group" : "";
    if (words) setAttr(group.head, "aria-description", words); else group.head.removeAttribute("aria-description");
  }

  /** The heading and body for a maker's choices, made when its first choice arrives and placed in the groups' order. */
  private groupFor(groupIndex: number, input: ChoiceListInput): Group {
    const index = this.pooled.has(groupIndex) ? OTHER_MODS_INDEX : groupIndex;
    const known = this.groups!.get(index);
    if (known) return known;
    const maker = index === OTHER_MODS_INDEX ? OTHER_MODS_GROUP : input.groups!.list[index] ?? { label: "Mods", kind: "mod" as const };
    const id = `${this.list.id}-g${index < 0 ? "other" : index}`;
    const key = `${input.option}\n${index === OTHER_MODS_INDEX ? "\u0000other" : maker.label.toLocaleLowerCase()}`, open = !this.folded.has(key);
    const count = h("span", { class: "cc-maker-count expander-count" });
    const head = expander("maker", { expanded: open, controls: `${id}-items`, id: `${id}-head`, tabindex: "-1" }, expanderLabel(maker.label, "cc-maker-label"), count);
    head.classList.add("cc-maker-head");
    const body = h("div", { class: "cc-maker-items", id: `${id}-items`, hidden: !open });
    const element = h("div", { class: "cc-maker", role: "group", "aria-labelledby": `${id}-head`, "data-kind": maker.kind }, head, body);
    const group: Group = { index, key, head, count, body, element, entries: [], open, chosen: false };
    head.addEventListener("click", () => { this.rove(head); this.fold(group, group.open); });
    head.addEventListener("focus", () => this.rove(head));
    const after = [...this.groups!.values()].filter(other => this.order(other.index, index) > 0).sort((a, b) => this.order(a.index, b.index))[0];
    this.list.insertBefore(element, after?.element ?? null);
    this.groups!.set(index, group);
    return group;
  }
  /** Fold a group away (or back); keyboard focus inside a folded group moves to its heading. */
  private fold(group: Group, folded: boolean) {
    group.open = !folded;
    group.body.hidden = folded;
    setExpanded(group.head, !folded);
    if (folded) this.folded.add(group.key); else this.folded.delete(group.key);
    this.describeGroup(group);
    if (folded && this.active && group.body.contains(this.active)) {
      const refocus = document.activeElement === this.active;
      this.rove(group.head);
      if (refocus) group.head.focus();
    }
  }

  /** Fold every maker group away, or unfold them all (the section's Expand all / Collapse all). */
  setAllFolded(folded: boolean) {
    // Unfolding also forgets folds of groups not shown yet (their choices on a later page).
    if (!folded) this.folded.clear();
    for (const group of this.groups?.values() ?? []) if (group.open === folded) this.fold(group, folded);
  }
  /** Whether a maker group is folded (none when the list is not grouped). */
  anyFolded() { return [...this.groups?.values() ?? []].some(group => !group.open); }

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
    // In a colour grid every choice but Off is a narrow swatch; its label is the accessible name and tooltip.
    const swatch = input.grid && !choice.off ? h("span", { class: "swatch", "aria-hidden": "true" }) : null;
    // One look with every choice list (the library's `choiceItem`); the creator's own marks (prepared ahead) ride on `cc-choice`.
    const label = choice.off ? "Off" : choice.label;
    const item = choiceItem({ label, selected: choice.position === input.selected, title: `${label} · ${from}`, description: from, off: choice.off,
      swatch: input.grid, className: "cc-choice", content: swatch ?? h("span", { class: "choice-label cc-choice-label", text: label }) });
    item.dataset.position = String(choice.position);
    // The choice shows as chosen at once, before anything is prepared; the next update puts back the V's own if the change was refused.
    item.addEventListener("click", () => { this.rove(item); this.select(choice.position); this.onChoose(choice); });
    item.addEventListener("focus", () => { this.rove(item); this.onHint(choice); });
    item.addEventListener("pointerenter", () => this.onHint(choice));
    const group = this.groups && !choice.off ? this.groupFor(choiceGroup(choice, input.groups!), input) : null;
    const entry: Entry = { choice, element: item, from, fetch: "", swatch, look: "", group };
    if (group?.index === OTHER_MODS_INDEX) {
      // "Other mods" is sorted by label, whatever order its choices arrive in.
      const at = group.entries.findIndex(other => other.choice.label.localeCompare(choice.label, undefined, { sensitivity: "base" }) > 0);
      group.body.insertBefore(item, at < 0 ? null : group.entries[at]!.element);
      group.entries.splice(at < 0 ? group.entries.length : at, 0, entry);
      setText(group.count, String(group.entries.length));
      this.items.push(entry);
    } else if (group) {
      group.body.appendChild(item);
      group.entries.push(entry);
      setText(group.count, String(group.entries.length));
      this.items.push(entry);
    } else if (this.lead) {
      this.lead.appendChild(item);
      this.items.push(entry);
    } else {
      const firstPlain = choice.off ? this.items.find(entry => !entry.choice.off)?.element : undefined;
      if (firstPlain) this.list.insertBefore(item, firstPlain); else this.list.appendChild(item);
      this.items.splice(firstPlain ? this.items.findIndex(entry => entry.element === firstPlain) : this.items.length, 0, entry);
    }
    this.paintSwatch(entry, input.swatches);
    this.byPosition.set(choice.position, item);
  }

  private focused() { return !!document.activeElement && this.items.some(entry => entry.element === document.activeElement); }
  /** What the arrow keys move through, in the order it shows: Off, then each group's heading and, when unfolded, its choices. */
  private navigation(): HTMLButtonElement[] {
    if (!this.groups) return this.items.map(entry => entry.element);
    const groups = [...this.groups.values()].sort((a, b) => this.order(a.index, b.index));
    return [...this.items.filter(entry => !entry.group).map(entry => entry.element),
      ...groups.flatMap(group => [group.head, ...(group.open ? group.entries.map(entry => entry.element) : [])])];
  }
  /** Make `item` the one Tab stop of the list (the first item when none). */
  private rove(item: HTMLButtonElement | null | undefined) {
    let target = item ?? this.navigation()[0] ?? null;
    // A choice in a folded group can't take focus: its heading does.
    const folded = target && this.groups ? [...this.groups.values()].find(group => !group.open && group.body.contains(target)) : undefined;
    if (folded) target = folded.head;
    if (target === this.active) return;
    if (this.active) this.active.tabIndex = -1;
    this.active = target;
    if (target) target.tabIndex = 0;
  }

  /**
   * Arrow keys, Home and End move focus (never the choice); Enter and Space choose, as the buttons do. On a group's heading, Left folds
   * and Right unfolds it (then move on).
   */
  private key(event: KeyboardEvent) {
    const items = this.navigation(), current = document.activeElement as HTMLButtonElement;
    const at = items.indexOf(current);
    if (at < 0) return;
    const head = [...this.groups?.values() ?? []].find(group => group.head === current);
    if (head && ((event.key === "ArrowLeft" && head.open) || (event.key === "ArrowRight" && !head.open))) {
      event.preventDefault();
      this.fold(head, head.open);
      return;
    }
    // Up and Down move by columns within the block of choices the focus is in (the whole list, Off, or one group), and past its edge
    // to what is next to it (a heading).
    const entry = head ? undefined : this.items.find(item => item.element === current);
    const block = !this.groups ? items : entry?.group ? entry.group.entries.map(item => item.element)
      : this.items.filter(item => !item.group).map(item => item.element);
    const inBlock = block.indexOf(current), container = entry?.group?.body ?? this.lead ?? this.list;
    const columns = !head && this.list.classList.contains("grid")
      ? Math.max(1, Math.round(container.clientWidth / Math.max(1, (block[0] ?? current).offsetWidth + 4))) : 1;
    const vertical = (step: number) => {
      if (head) return at + Math.sign(step);
      const there = inBlock + step;
      if (there >= 0 && there < block.length) return items.indexOf(block[there]!);
      return step > 0 ? items.indexOf(block[block.length - 1]!) + 1 : items.indexOf(block[0]!) - 1;
    };
    const next = event.key === "ArrowRight" ? at + 1 : event.key === "ArrowLeft" ? at - 1 : event.key === "ArrowDown" ? vertical(columns)
      : event.key === "ArrowUp" ? vertical(-columns) : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = items[Math.max(0, Math.min(items.length - 1, next))]!;
    this.rove(target);
    target.focus();
  }
}
