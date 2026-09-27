import { keyBinding } from "../../input-bindings";
import { h, setAttr, setText } from "../dom";
import { icon } from "../icons";

/**
 * Tree view (style guide "Tree view"): groups of rows (poses by pack, presets by source), one nesting level, virtualised for thousands of
 * rows.
 *
 * - **Groups** expand and collapse on a click, Enter, Space, Right and Left; the owner holds the expanded set (it persists it, e.g. in
 *   `UIPreferences.folded`) and hears `onToggle`. A group with no rows is not shown.
 * - **Rows** activate on one click or Enter (`onActivate`); there is no separate select step. A disabled row stays focusable, shows its
 *   plain reason as its tooltip and description, and does not activate. The current row carries `aria-current`.
 * - **Keyboard** (the WAI tree pattern): one tab stop (roving tabindex); Up and Down move through the visible items, Home and End jump;
 *   Right opens a group or moves to its first row; Left closes a group or moves to a row's group; typing a letter jumps to the next item
 *   starting with it; the focused item scrolls into view. `onKey` sees each key first (a feature's own binding, such as F for a
 *   favourite) and returns true when it handled it.
 * - **Context menu** (`onMenu`): a right-click on an item, Shift+F10 or the Menu key hears the item and where to open the owner's menu
 *   (the pointer, or the focused item). The owner shows only what can be done on that item and opens nothing when there is nothing.
 * - **Scale:** only the items in view (plus a margin, plus the focused one) are in the page; items are reused by ID and updated in
 *   place, so focus and the scroll position survive updates. Every item is one row high (28 px).
 * - **Height:** by default the owner sizes the frame. With `maxRows` the tree is as tall as its visible items, up to that many rows,
 *   then scrolls; `minRows` (default 1) keeps a floor so a search that shrinks the list doesn't pull what follows up and down as the
 *   person types. Opening or closing a group changes the height, which the person asked for.
 * - **States:** current, disabled, loading (an overlaid status that never moves the rows), search-match highlight ranges per label.
 * - **Access:** `role=tree` of `treeitem`s in a flat, virtualised structure: the hierarchy is conveyed by `aria-level`, `aria-setsize`
 *   and `aria-posinset` (the ARIA pattern for trees whose rows are not all in the page; nested `role=group` needs every row present).
 *   Groups carry `aria-expanded`. Each item's name is its label, secondary text and badges as text; a trailing action (a favourite
 *   toggle) is outside the name, reached by the pointer or the owner's key binding, never by Tab.
 */
export type TreeBadge = { text: string; tone?: "neutral" | "accent" | "info" | "success" | "warning" | "error" };
export type TreeRowData = { id: string; label: string; secondary?: string; badges?: readonly TreeBadge[]; disabled?: boolean; reason?: string;
  /** Search-match ranges in `label` ([start, end) pairs), drawn highlighted. */
  highlight?: readonly (readonly [number, number])[];
  /** The owner's state behind the trailing action (e.g. whether it is a favourite): a change rebuilds the row's trailing slot. */
  trailingState?: string | number | boolean };
export type TreeGroupData = { id: string; label: string; secondary?: string; count?: number; badges?: readonly TreeBadge[]; rows: readonly TreeRowData[];
  highlight?: readonly (readonly [number, number])[] };
export type TreeItemRef = { kind: "group" | "row"; id: string; group: string };
export type TreeViewOptions = {
  label: string;
  onActivate(rowId: string): void;
  onToggle(groupId: string, expanded: boolean): void;
  /** Sees every key on an item first; return true when handled. */
  onKey?(event: KeyboardEvent, item: TreeItemRef): boolean | void;
  /** A row's trailing action (e.g. `favouriteToggle`), rebuilt only when the row's data changes; clicks on it never activate the row. */
  trailing?(row: TreeRowData, group: TreeGroupData): HTMLElement | null | undefined;
  /** Shown when there are no groups. */
  emptyText?: string;
  /** An item's context menu: right-click, Shift+F10 or the Menu key (`anchor` is the pointer or the item). */
  onMenu?(item: TreeItemRef, anchor: Element | { x: number; y: number }): void;
  /** Fit the frame to the visible items, at most this many rows tall (then it scrolls). */
  maxRows?: number;
  /** With `maxRows`: never shorter than this many rows (default 1). */
  minRows?: number;
};
export const TREE_ROW_HEIGHT = 28;
const OVERSCAN = 8;
type Flat = { ref: TreeItemRef; group: TreeGroupData; row?: TreeRowData; level: 1 | 2; setsize: number; posinset: number; key: string };

export class TreeView {
  readonly element: HTMLElement;
  private readonly spacer: HTMLElement;
  private readonly status: HTMLElement;
  private readonly empty: HTMLElement;
  private groups: readonly TreeGroupData[] = [];
  private expanded: ReadonlySet<string> = new Set();
  private current: string | undefined;
  private flat: Flat[] = [];
  private focusId: string | undefined;
  private readonly rendered = new Map<string, { element: HTMLElement; key: string }>();
  private frame = 0;
  constructor(private readonly options: TreeViewOptions) {
    this.spacer = h("div", { class: "tree-spacer" });
    this.status = h("div", { class: "tree-status", role: "status", hidden: true });
    this.empty = h("p", { class: "tree-empty", hidden: true, text: options.emptyText ?? "Nothing to show." });
    this.element = h("div", { class: "tree-view", role: "tree", "aria-label": options.label }, this.spacer, this.status, this.empty);
    this.element.addEventListener("scroll", () => { cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => this.paint()); });
    this.element.addEventListener("keydown", event => this.key(event));
    this.element.addEventListener("click", event => this.click(event));
    // Focus that arrives by any route (a pointer, a script, assistive technology) moves the roving tab stop with it.
    this.element.addEventListener("focusin", event => {
      const item = this.itemOf(event.target);
      if (item && item.ref.id !== this.focusId) { this.focusId = item.ref.id; for (const [id, entry] of this.rendered) entry.element.tabIndex = id === this.focusId ? 0 : -1; }
    });
    this.element.addEventListener("contextmenu", event => {
      const item = options.onMenu ? this.itemOf(event.target) : undefined;
      if (!item) return;
      event.preventDefault();
      this.focusItem(item.ref.id);
      options.onMenu!(item.ref, { x: event.clientX, y: event.clientY });
    });
  }
  /** Show `groups` with `expanded` open; `current` marks the current row; `loading` shows the status line without moving anything. */
  update(state: { groups: readonly TreeGroupData[]; expanded: ReadonlySet<string>; current?: string; loading?: boolean | string }) {
    this.groups = state.groups; this.expanded = state.expanded; this.current = state.current;
    this.flat = [];
    const shown = state.groups.filter(group => group.rows.length);
    shown.forEach((group, gi) => {
      this.flat.push({ ref: { kind: "group", id: group.id, group: group.id }, group, level: 1, setsize: shown.length, posinset: gi + 1, key: "" });
      if (state.expanded.has(group.id)) group.rows.forEach((row, ri) =>
        this.flat.push({ ref: { kind: "row", id: row.id, group: group.id }, group, row, level: 2, setsize: group.rows.length, posinset: ri + 1, key: "" }));
    });
    for (const item of this.flat) item.key = JSON.stringify([item.row ?? { ...item.group, rows: item.group.rows.length }, item.level === 1 && state.expanded.has(item.group.id),
      item.row && item.row.id === state.current, item.setsize, item.posinset]);
    if (!this.flat.some(item => item.ref.id === this.focusId)) this.focusId = this.flat.find(item => item.row?.id === state.current)?.ref.id ?? this.flat[0]?.ref.id;
    this.spacer.style.height = `${this.flat.length * TREE_ROW_HEIGHT}px`;
    if (this.options.maxRows) {
      const rows = Math.max(this.options.minRows ?? 1, Math.min(this.options.maxRows, this.flat.length));
      // The frame's 1 px border on each side is outside the rows.
      this.element.style.height = `${rows * TREE_ROW_HEIGHT + 2}px`;
    }
    this.empty.hidden = this.flat.length > 0;
    setText(this.status, typeof state.loading === "string" ? state.loading : state.loading ? "Loading…" : "");
    this.status.hidden = !state.loading;
    this.paint();
  }
  /** Move focus into the tree (its focused item, else the first). */
  focus() { this.focusItem(this.focusId ?? this.flat[0]?.ref.id); }
  /** Focus an item by ID, scrolling it into view. */
  focusItem(id: string | undefined) {
    const index = this.flat.findIndex(item => item.ref.id === id);
    if (index < 0) return;
    this.focusId = id;
    this.reveal(index);
    this.paint();
    this.rendered.get(id!)?.element.focus({ preventScroll: true });
  }
  private reveal(index: number) {
    const top = index * TREE_ROW_HEIGHT, view = this.element.clientHeight;
    if (!view) return;
    if (top < this.element.scrollTop) this.element.scrollTop = top;
    else if (top + TREE_ROW_HEIGHT > this.element.scrollTop + view) this.element.scrollTop = top + TREE_ROW_HEIGHT - view;
  }
  /** Render the items in view (and the focused one), reusing elements by ID. */
  private paint() {
    const view = this.element.clientHeight || TREE_ROW_HEIGHT * 30, scroll = this.element.scrollTop || 0;
    const first = Math.max(0, Math.floor(scroll / TREE_ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(this.flat.length, Math.ceil((scroll + view) / TREE_ROW_HEIGHT) + OVERSCAN);
    const want = new Map<string, number>();
    for (let i = first; i < last; i++) want.set(this.flat[i]!.ref.id, i);
    const focused = this.flat.findIndex(item => item.ref.id === this.focusId);
    if (focused >= 0) want.set(this.focusId!, focused);
    for (const [id, entry] of this.rendered) if (!want.has(id)) { entry.element.remove(); this.rendered.delete(id); }
    for (const [id, index] of want) {
      const item = this.flat[index]!;
      let entry = this.rendered.get(id);
      if (!entry || entry.key !== item.key) {
        const element = this.build(item), hadFocus = !!entry && document.activeElement === entry.element;
        if (entry) { this.spacer.insertBefore(element, entry.element); entry.element.remove(); } else this.spacer.append(element);
        entry = { element, key: item.key };
        this.rendered.set(id, entry);
        if (hadFocus) element.focus({ preventScroll: true });
      }
      entry.element.style.transform = `translateY(${index * TREE_ROW_HEIGHT}px)`;
      entry.element.tabIndex = id === this.focusId ? 0 : -1;
    }
  }
  private label(text: string, ranges?: readonly (readonly [number, number])[]) {
    const span = h("span", { class: "tree-label" });
    if (!ranges?.length) { span.textContent = text; return span; }
    let at = 0;
    for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
      if (start > at) span.append(text.slice(at, start));
      span.append(h("mark", { text: text.slice(Math.max(start, at), end) }));
      at = Math.max(at, end);
    }
    if (at < text.length) span.append(text.slice(at));
    return span;
  }
  private build(item: Flat): HTMLElement {
    const badges = (list?: readonly TreeBadge[]) => (list ?? []).map(badge => h("span", { class: `badge ${badge.tone ?? "neutral"}`, text: badge.text }));
    const name = (parts: (string | undefined)[]) => parts.filter(Boolean).join(", ");
    if (item.level === 1) {
      const group = item.group, open = this.expanded.has(group.id), count = group.count ?? group.rows.length;
      return h("div", { class: "tree-item tree-group", role: "treeitem", "data-id": group.id, "aria-level": "1", "aria-setsize": String(item.setsize),
        "aria-posinset": String(item.posinset), "aria-expanded": String(open),
        "aria-label": name([group.label, group.secondary, `${count} item${count === 1 ? "" : "s"}`, ...(group.badges ?? []).map(b => b.text)]) },
        h("span", { class: "tree-chevron", "aria-hidden": "true" }, icon("chevronRight")), this.label(group.label, group.highlight),
        group.secondary ? h("span", { class: "tree-secondary", text: group.secondary }) : null, ...badges(group.badges),
        h("span", { class: "tree-count", text: String(count) }));
    }
    const row = item.row!, trailing = this.options.trailing?.(row, item.group);
    const element = h("div", { class: `tree-item tree-row${row.disabled ? " disabled" : ""}${row.id === this.current ? " current" : ""}`, role: "treeitem",
      "data-id": row.id, "aria-level": "2", "aria-setsize": String(item.setsize), "aria-posinset": String(item.posinset),
      "aria-current": row.id === this.current ? "true" : undefined, "aria-disabled": row.disabled ? "true" : undefined,
      "aria-description": row.disabled ? row.reason : undefined, title: row.disabled ? row.reason : undefined,
      "aria-label": name([row.label, row.secondary, ...(row.badges ?? []).map(b => b.text)]) },
      this.label(row.label, row.highlight), row.secondary ? h("span", { class: "tree-secondary", text: row.secondary }) : null, ...badges(row.badges),
      trailing ? h("span", { class: "tree-trailing" }, trailing) : null);
    // A trailing action is reached by the pointer or the owner's key binding, never by Tab (the tree is one tab stop).
    if (trailing) for (const control of [trailing, ...trailing.querySelectorAll<HTMLElement>("button")]) if (control.tagName.toLowerCase() === "button") control.tabIndex = -1;
    return element;
  }
  private itemOf(target: EventTarget | null) {
    const element = target instanceof Element ? target.closest<HTMLElement>(".tree-item") : null;
    return element ? this.flat.find(item => item.ref.id === element.dataset.id) : undefined;
  }
  private click(event: MouseEvent) {
    if (event.target instanceof Element && event.target.closest(".tree-trailing")) return;
    const item = this.itemOf(event.target);
    if (!item) return;
    this.focusItem(item.ref.id);
    if (item.level === 1) this.options.onToggle(item.group.id, !this.expanded.has(item.group.id));
    else if (!item.row!.disabled) this.options.onActivate(item.row!.id);
  }
  private key(event: KeyboardEvent) {
    const index = this.flat.findIndex(item => item.ref.id === this.focusId), item = this.flat[index];
    if (!item) return;
    if (this.options.onKey?.(event, item.ref)) { event.preventDefault(); return; }
    if (this.options.onMenu && keyBinding("rows", event)?.id === "rows.menu") {
      event.preventDefault();
      this.options.onMenu(item.ref, this.rendered.get(item.ref.id)?.element ?? this.element);
      return;
    }
    const move = (to: number) => { event.preventDefault(); const next = this.flat[Math.max(0, Math.min(this.flat.length - 1, to))]; if (next) this.focusItem(next.ref.id); };
    const open = item.level === 1 && this.expanded.has(item.group.id);
    switch (event.key) {
      case "ArrowDown": move(index + 1); return;
      case "ArrowUp": move(index - 1); return;
      case "Home": move(0); return;
      case "End": move(this.flat.length - 1); return;
      case "ArrowRight":
        event.preventDefault();
        if (item.level === 1) { if (!open) this.options.onToggle(item.group.id, true); else move(index + 1); }
        return;
      case "ArrowLeft":
        event.preventDefault();
        if (item.level === 1) { if (open) this.options.onToggle(item.group.id, false); }
        else this.focusItem(item.group.id);
        return;
      case "Enter": case " ":
        event.preventDefault();
        if (item.level === 1) this.options.onToggle(item.group.id, !open);
        else if (event.key === "Enter" && !item.row!.disabled) this.options.onActivate(item.row!.id);
        return;
    }
    if (event.key.length === 1 && /\S/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const letter = event.key.toLowerCase(), order = [...this.flat.slice(index + 1), ...this.flat.slice(0, index + 1)];
      const hit = order.find(entry => (entry.row?.label ?? entry.group.label).toLowerCase().startsWith(letter));
      if (hit) { event.preventDefault(); this.focusItem(hit.ref.id); }
    }
  }
}

/**
 * Favourite toggle (style guide "Tree view"): a star icon button, outline when off and filled when on, named "Add to favourites" or
 * "Remove from favourites" with `aria-pressed`. Inside a tree row it shows while the row is hovered or focused, and always while on;
 * clicking it never activates the row. Wire the F key through the tree's `onKey` so a focused row toggles it too.
 */
export function favouriteToggle(options: { on: boolean; onToggle(on: boolean): void; what?: string }): HTMLButtonElement {
  const button = h("button", { class: "icon-btn small favourite-toggle", type: "button" });
  let on = options.on;
  const paint = () => {
    setAttr(button, "aria-pressed", String(on));
    const label = on ? `Remove${options.what ? ` ${options.what}` : ""} from favourites` : `Add${options.what ? ` ${options.what}` : ""} to favourites`;
    setAttr(button, "aria-label", label); button.title = label;
    button.replaceChildren(icon(on ? "starFilled" : "star"));
  };
  button.addEventListener("click", event => { event.stopPropagation(); on = !on; paint(); options.onToggle(on); });
  paint();
  return button;
}
