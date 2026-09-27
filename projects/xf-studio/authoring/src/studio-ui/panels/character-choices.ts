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
 * - **Every choice shows** (no "Show more"): the row loads its pages one after another and appends them; the V's choice is scrolled into
 *   view when the row opens, and the maker group holding it opens.
 * - **Grouped by who made them** (cc-panel.ts `groups`, cc-controls backlog 4a): when a row's choices come from more than one maker, each
 *   maker's choices sit under a small heading (the base game first, then XF Studio, then every author or mod by name), in the creator's
 *   order within it; Off stays above the groups. A heading is a button that folds its group away and back (Enter, Space or a click;
 *   Left folds and Right unfolds it from the keyboard), remembered per option across reloads (view-state.ts, `character:maker:<option>/<maker>`). A folded group holding the V's
 *   choice says so. Arrow keys move through headings and the choices of unfolded groups in the order they show; in a colour grid Up
 *   and Down move by the group's own columns and step onto the heading next to it at its edges. A row with one maker has no headings.
 *   A heading is the shared expander (expander.ts, level "maker"). Makers with a single choice in the row share one "Other mods" heading,
 *   last, its choices sorted by label (cc-panel.ts `pooled`); each choice's mod is in its tooltip and description as everywhere.
 * - **Pictures of shape choices** (choice-previews-design.md): a row whose option has a picture kind (a hairstyle) shows its choices as
 *   preview tiles (components/choice-preview.ts) in one of three layouts (`previews.layout`, §7.1): a **grid** of three sizes
 *   (`previews.size`), a **list** of 32 px rows (thumbnail, label, and the source where its heading doesn't say it: "Other mods") or
 *   **details** (64 px rows with the prepared state, and the large picture of the choice under the pointer, else the focused one, else
 *   the V's, which never scrolls away: beside the list from a 440 px row, a compact block kept under the row's top edge below that). A picture arriving fills its tile in place and never moves the layout; the label stays the tile's accessible name,
 *   tooltip and (except at size S) visible caption. Switching layout keeps focus on the same choice and brings it into view.
 * - **Turntables** (grid L and details): the picture under the pointer turns slowly after a dwell and turns by hand when dragged (a drag
 *   never chooses). The list says which choice it wants turning (`onSpin`: the hovered tile in L; in details the one the large picture
 *   shows), so only that choice's strip is drawn.
 * - **PageUp and PageDown** move focus by a screenful, and **typing** a label's first letters moves to it (components/listbox-keys.ts).
 */
import { type CcChoiceGroup, type CcPanelChoice, choiceGroup, compareGroups, OTHER_MODS_GROUP, OTHER_MODS_INDEX } from "../../cc-panel";
import type { CharacterSwatchState, ChoiceFetch } from "../../character-context-actions";
import { h, setAttr, setText } from "../dom";
import { expander, expanderLabel, setExpanded } from "../expander";
import { viewState } from "../view-state";
import { holdScroll, revealInView } from "../scroll-anchor";
import { choiceItem } from "../components/choice-list";
import { previewStage, previewTile, type PreviewStage, type PreviewTile } from "../components/choice-preview";
import { pageStep, TypeAhead } from "../components/listbox-keys";
import type { ChoicePreviewRow } from "../../choice-preview-service";
import type { ChoiceLayout, ChoiceSize } from "../../ui-preferences";

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
  /** Pictures of the choices (a shape row): the layout, the grid size and the pictures so far; null or absent for text or swatch choices. */
  previews?: { readonly size: ChoiceSize; readonly layout?: ChoiceLayout; readonly row: ChoicePreviewRow | null } | null;
  /** Who made each choice (the panel's `groups` and `modGroups`): shown grouped by maker; null or absent for a row with one maker. */
  groups?: { readonly list: readonly CcChoiceGroup[]; readonly modGroups: readonly number[];
    /** The option's groups shown together under "Other mods" (cc-panel.ts `CcPanel.pools` at the option's `pool`). */
    readonly pooled?: readonly number[] } | null;
};
type Group = { index: number; key: string; head: HTMLButtonElement; count: HTMLElement; body: HTMLElement; element: HTMLElement; entries: Entry[]; open: boolean;
  chosen: boolean };
type Entry = { choice: CcPanelChoice; element: HTMLButtonElement; from: string; fetch: string; swatch: HTMLElement | null; look: string; group: Group | null;
  tile: PreviewTile | null };

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
/** The prepared state as the details layout writes it beside a choice. */
const FETCH_STATE: Partial<Record<ChoiceFetch, string>> = { r: "Ready", n: "Not prepared yet", q: "Not prepared yet", f: "Being prepared",
  x: "Couldn't be prepared ahead" };

/** What decides whether a list is grouped, and how: another of it rebuilds the list. */
const groupedKey = (input: ChoiceListInput) => `${input.groups ? `g:${(input.groups.pooled ?? []).join(",")}` : ""}${input.previews ? "|pictures" : ""}`;

/** A maker group's view key: its option, then the maker (lower case, bounded; `null`: the pooled "Other mods"; "": the option's prefix). */
const makerKey = (option: string, maker: string | null) =>
  `character:maker:${option.slice(0, 80)}/${maker === null ? "(other mods)" : maker.toLocaleLowerCase().slice(0, 100)}`;
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
  private selected: number | null = null;
  /** The V's choice is still to be brought into view (a row just opened, or another search). */
  /** What the V's choice still needs once it is listed: its group opened (the row shown anew), and brought into view (the person opened the row). */
  private reveal: "none" | "unfold" | "scroll" = "none";
  /** The item that takes Tab focus (roving tabindex). */
  private active: HTMLButtonElement | null = null;
  private readonly body: HTMLElement;
  private readonly typeAhead = new TypeAhead();
  /** The pictures' layout shown, the details layout's large picture, the choice under the pointer, and the turntable asked for last. */
  private layout: ChoiceLayout | null = null;
  private stage: PreviewStage | null = null;
  private hovered: number | null = null;
  private spinning: number | null = null;
  private pictures: ChoiceListInput["previews"] = null;
  private fetchStates: ReadonlyMap<number, ChoiceFetch> | null = null;

  constructor(id: string, private readonly onChoose: (choice: CcPanelChoice) => void, private readonly onHint: (choice: CcPanelChoice) => void = () => {},
    private readonly onSpin: (position: number | null) => void = () => {}) {
    this.list = h("div", { class: "choices cc-choices", id, role: "listbox" });
    this.status = h("p", { class: "note cc-choices-status", hidden: true });
    this.body = h("div", { class: "cc-choice-body" }, this.list);
    this.element = h("div", { class: "cc-choice-list" }, this.body, this.status);
    this.list.addEventListener("keydown", event => this.key(event));
    // The choice under the pointer (the large picture shows it; its turntable is wanted).
    this.list.addEventListener("pointerover", event => {
      const item = (event.target as HTMLElement | null)?.closest?.<HTMLElement>(".choice[data-position]");
      if (item && this.list.contains(item)) this.hover(Number(item.dataset.position));
    });
    this.list.addEventListener("pointerleave", () => this.hover(null));
  }

  update(input: ChoiceListInput) {
    const same = this.shown?.option === input.option && this.shown.query === input.query && this.shown.grouped === groupedKey(input);
    if (!same) this.rebuild(input);
    this.list.classList.toggle("grid", input.grid && !input.previews);
    this.list.classList.toggle("previews", !!input.previews);
    const layout = input.previews ? input.previews.layout ?? "grid" : null;
    if (input.previews && layout === "grid") setAttr(this.list, "data-size", input.previews.size); else this.list.removeAttribute("data-size");
    if (layout) setAttr(this.list, "data-layout", layout); else this.list.removeAttribute("data-layout");
    setAttr(this.element, "data-layout", layout ?? undefined);
    this.pictures = input.previews ?? null;
    this.fetchStates = input.fetch ?? null;
    if (layout !== this.layout) this.relayout(layout, input);
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
      this.paintTile(entry, input);
    }
    this.paintStage();
    this.markChosen();
    this.revealChosen();
    const line = input.error ?? (input.loading && !this.items.length ? "Loading choices…" : !input.loading && !this.items.length ? "No choice matches." : "");
    setText(this.status, line);
    this.status.hidden = !line;
    this.status.classList.toggle("warning", !!input.error);
  }

  /**
   * The V's choice is never hidden (show the options, don't hide them): once it has loaded after the person opens the row, the maker group
   * holding it opens (even one folded earlier), and it is brought into view within the panel (scroll-anchor.ts `revealInView`: as little
   * as needed, never while a remembered position is being restored). Choosing never moves the view (`holdScroll`), and nothing else
   * (a rebuild, a search, focus coming back) scrolls it.
   */
  /** A tile's picture, its turntable (where the layout turns pictures) and its list and details text. */
  private paintTile(entry: Entry, input: ChoiceListInput) {
    if (!entry.tile) return;
    const row = input.previews?.row, position = entry.choice.position;
    entry.tile.set(row?.urls.get(position) ?? null, entry.choice.off || !!row?.none.has(position));
    entry.tile.spinnable(!entry.choice.off && this.turns());
    entry.tile.setSpin(row?.spins.get(position) ?? null, row?.frames ?? 1);
    const state = this.layout === "details" ? FETCH_STATE[input.preparing && position === input.selected ? "f" : input.fetch?.get(position) ?? "r"] ?? "" : "";
    // A choice's source only where its heading doesn't already say it (the pooled "Other mods"; a row with one maker has its source in the row).
    const source = this.layout !== "grid" && entry.group?.index === OTHER_MODS_INDEX ? entry.from : "";
    entry.tile.setMeta(source, entry.choice.off ? "" : state);
  }
  /** Whether pictures turn in this layout (the large grid and details). */
  private turns() { return this.layout === "details" || (this.layout === "grid" && this.pictures?.size === "l"); }
  /** Another layout: the large picture comes or goes, and a focused choice stays focused and in view. */
  private relayout(layout: ChoiceLayout | null, input: ChoiceListInput) {
    this.layout = layout;
    if (layout === "details" && !this.stage) this.stage = previewStage({ glyph: "head" });
    if (this.stage) {
      if (layout === "details") { if (this.stage.element.parentNode !== this.body) this.body.insertBefore(this.stage.element, this.list); }
      else this.stage.element.remove();
    }
    for (const entry of this.items) this.paintTile(entry, input);
    const focused = this.focused() ? document.activeElement as HTMLElement : null;
    if (focused) revealInView(focused);
    this.wantSpin();
  }
  /** The choice the large picture shows: the one under the pointer, else the focused one, else the V's. */
  private staged(): number | null {
    const active = this.active?.dataset.position;
    return this.hovered ?? (active !== undefined ? Number(active) : this.selected);
  }
  private paintStage() {
    if (!this.stage || this.layout !== "details") return;
    const position = this.staged(), entry = position === null ? undefined : this.items.find(item => item.choice.position === position);
    const row = this.pictures?.row;
    if (!entry) { this.stage.show({ label: "", source: "", url: null, none: false, spin: null, frames: 1, looking: false }); return; }
    this.stage.show({ label: entry.choice.off ? "Off" : entry.choice.label, source: entry.from, url: row?.urls.get(entry.choice.position) ?? null,
      none: entry.choice.off || !!row?.none.has(entry.choice.position), spin: entry.choice.off ? null : row?.spins.get(entry.choice.position) ?? null,
      frames: row?.frames ?? 1, looking: this.hovered === entry.choice.position });
  }
  private hover(position: number | null) {
    if (position === this.hovered) return;
    this.hovered = position;
    this.paintStage();
    this.wantSpin();
  }
  /** Tell the row which choice's turntable is wanted now (only when it changes). */
  private wantSpin() {
    const want = !this.turns() ? null : this.layout === "details" ? this.staged() : this.hovered;
    const entry = want === null ? undefined : this.items.find(item => item.choice.position === want);
    const position = entry && !entry.choice.off ? want : null;
    if (position === this.spinning) return;
    this.spinning = position;
    this.onSpin(position);
  }

  /** Bring the V's choice into view at the next update where it is listed (the person just opened the row). */
  revealChosenNext() { this.reveal = "scroll"; }
  private revealChosen() {
    if (this.reveal === "none" || this.selected === null) return;
    const entry = this.items.find(item => item.choice.position === this.selected);
    if (!entry) return;
    const scroll = this.reveal === "scroll";
    this.reveal = "none";
    if (entry.group && !entry.group.open) this.fold(entry.group, false);
    if (scroll) revealInView(entry.element);
  }

  /** Another option or search: new items, and focus back on the same choice when it is still listed. */
  private rebuild(input: ChoiceListInput) {
    const focusedAt = this.focused() ? [...this.byPosition].find(([, item]) => item === document.activeElement)?.[0] : undefined;
    this.list.replaceChildren();
    this.items = []; this.byPosition.clear(); this.active = null; this.selected = null;
    this.shown = { option: input.option, query: input.query, grouped: groupedKey(input) };
    // Shown anew: the V's choice is never in a folded group, but nothing scrolls (the person's view stays).
    if (this.reveal === "none") this.reveal = "unfold";
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
    // Focus comes back where it was without scrolling: the person's view stays put.
    restore?.focus({ preventScroll: true });
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
    const key = makerKey(input.option, index === OTHER_MODS_INDEX ? null : maker.label), open = viewState().expanded(key) ?? true;
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
    viewState().setExpanded([group.key], !folded);
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
    if (!folded && this.shown) { const kept = viewState().folded(makerKey(this.shown.option, "")); if (kept.length) viewState().setExpanded(kept, true); }
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
    // A swatch's name, source and state are in the swatch card (components/choice-list.ts `attachSwatchCard`), not a tooltip.
    if (!entry.swatch) entry.element.title = `${entry.choice.off ? "Off" : entry.choice.label} · ${description}`;
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
    // In a colour grid every choice but Off is a narrow swatch; its label is the accessible name, and the swatch card shows it.
    const tile = input.previews ? previewTile({ label: choice.off ? "Off" : choice.label, glyph: choice.off ? "close" : "head" }) : null;
    const swatch = input.grid && !choice.off && !tile ? h("span", { class: "swatch", "aria-hidden": "true" }) : null;
    // One look with every choice list (the library's `choiceItem`); the creator's own marks (prepared ahead) ride on `cc-choice`.
    const label = choice.off ? "Off" : choice.label;
    const item = choiceItem({ label, selected: choice.position === input.selected, title: `${label} · ${from}`, description: from, off: choice.off,
      swatch: input.grid && !tile, className: tile ? "cc-choice preview-choice" : "cc-choice",
      content: tile?.element ?? swatch ?? h("span", { class: "choice-label cc-choice-label", text: label }) });
    item.dataset.position = String(choice.position);
    // The choice shows as chosen at once, before anything is prepared; the next update puts back the V's own if the change was refused.
    // The person's choice never moves their view, whatever it rebuilds or shows (scroll-anchor.ts `holdScroll`).
    item.addEventListener("click", () => { holdScroll(this.list); this.rove(item); this.select(choice.position); this.onChoose(choice); });
    item.addEventListener("focus", () => { this.rove(item); this.onHint(choice); if (this.layout === "details") { this.paintStage(); this.wantSpin(); } });
    item.addEventListener("pointerenter", () => this.onHint(choice));
    const group = this.groups && !choice.off ? this.groupFor(choiceGroup(choice, input.groups!), input) : null;
    const entry: Entry = { choice, element: item, from, fetch: "", swatch, look: "", group, tile };
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
    const columns = !head && (this.list.classList.contains("grid") || this.list.classList.contains("previews"))
      ? Math.max(1, Math.round(container.clientWidth / Math.max(1, (block[0] ?? current).offsetWidth + 4))) : 1;
    const vertical = (step: number) => {
      if (head) return at + Math.sign(step);
      const there = inBlock + step;
      if (there >= 0 && there < block.length) return items.indexOf(block[there]!);
      return step > 0 ? items.indexOf(block[block.length - 1]!) + 1 : items.indexOf(block[0]!) - 1;
    };
    // Type-ahead goes by the choices' labels (headings are skipped); PageUp and PageDown by a screenful of the block's rows.
    if (this.typeAhead.accepts(event)) {
      event.preventDefault();
      const choices = items.filter(item => !item.classList.contains("expander"));
      const found = this.typeAhead.find(event.key, choices.map(item => item.getAttribute("aria-label") ?? ""), choices.indexOf(current));
      if (found < 0) return;
      this.rove(choices[found]!);
      choices[found]!.focus();
      return;
    }
    const page = event.key === "PageDown" || event.key === "PageUp" ? (event.key === "PageDown" ? 1 : -1) * pageStep(current, head ? 1 : columns) : 0;
    const next = event.key === "ArrowRight" ? at + 1 : event.key === "ArrowLeft" ? at - 1 : event.key === "ArrowDown" ? vertical(columns)
      : event.key === "ArrowUp" ? vertical(-columns) : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : page ? at + page : null;
    if (next === null) return;

    event.preventDefault();
    const target = items[Math.max(0, Math.min(items.length - 1, next))]!;
    this.rove(target);
    target.focus();
  }
}
