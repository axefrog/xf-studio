/**
 * STAND-IN ADAPTER, to be replaced by the component library's TreeView and FavouriteToggle (requested from `claude/ui-components`,
 * 27 September; tracked in the UI architecture boundary). It is kept small and feature-neutral in shape so the swap touches only this file
 * and the panel's `update` call:
 *
 * - groups (expandable, one level) with child rows; the owner holds the open set and hears `onToggle`;
 * - one click (or Enter) on a row activates it; a disabled row is focusable, carries its reason as a tooltip and doesn't activate;
 * - the WAI tree pattern: one tab stop with a roving tabindex, Up/Down/Home/End move, Right opens a group or enters it, Left closes a group
 *   or returns to it, Enter activates, F toggles the focused row's star (input-bindings.ts `rows.*`);
 * - a star button per row (`aria-pressed`), outside the row's activation; a current row (`aria-current`) and an in-place loading label that
 *   never shifts layout.
 * Only open groups' rows are built.
 */
import { keyBinding } from "../../../input-bindings";
import { badge } from "../../../studio-ui/controls";
import { h, setAttr, setText } from "../../../studio-ui/dom";
import { icon } from "../../../studio-ui/icons";

export type TreeBadge = { readonly text: string; readonly title: string };
export type TreeRowData = { readonly id: string; readonly label: string; readonly secondary?: string; readonly badges: readonly TreeBadge[];
  readonly disabled?: string | null; readonly current?: boolean; readonly loading?: boolean; readonly favourite?: boolean };
export type TreeGroupData = { readonly id: string; readonly label: string; readonly secondary?: string | null; readonly rows: readonly TreeRowData[] };
export type TreeAdapterOptions = {
  label: string;
  onToggle(group: string, open: boolean): void;
  onActivate(row: string): void;
  onFavourite(row: string, on: boolean): void;
};

const SEP = "\u001f";
export class PoseTreeAdapter {
  readonly element: HTMLUListElement;
  private focusKey: string | null = null;
  private groups: readonly TreeGroupData[] = [];
  private open = new Set<string>();
  constructor(private readonly options: TreeAdapterOptions) {
    this.element = h("ul", { class: "pose-tree", role: "tree", "aria-label": options.label });
    this.element.addEventListener("keydown", event => this.key(event));
    this.element.addEventListener("focusin", event => {
      const item = (event.target as HTMLElement).closest<HTMLElement>("[data-key]");
      if (item) this.setFocus(item.dataset.key!, false);
    });
  }
  /** Put focus on the first item (Down from the search field). */
  focusFirst() { const first = this.items()[0]; if (first) this.setFocus(first.dataset.key!, true); }

  update(groups: readonly TreeGroupData[], open: ReadonlySet<string>) {
    this.groups = groups; this.open = new Set(open);
    const hadFocus = this.element.contains(document.activeElement);
    const items: HTMLElement[] = [];
    for (const group of groups) {
      const expanded = open.has(group.id), key = `g${SEP}${group.id}`;
      const header = h("div", { class: "pose-tree-group-head" },
        h("span", { class: "expander-chevron", "aria-hidden": "true" }, icon("chevronRight")),
        h("span", { class: "pose-tree-label", text: group.label }),
        group.secondary ? h("span", { class: "pose-tree-secondary", text: group.secondary }) : null,
        h("span", { class: "count", text: String(group.rows.length) }));
      const item = h("li", { class: "pose-tree-group", role: "treeitem", "aria-level": 1, "aria-expanded": String(expanded), "data-key": key, tabindex: -1,
        "aria-label": `${group.label}${group.secondary ? `, from ${group.secondary}` : ""}, ${group.rows.length} poses` }, header);
      header.addEventListener("click", () => { this.setFocus(key, true); this.options.onToggle(group.id, !expanded); });
      if (expanded) {
        const list = h("ul", { role: "group" });
        for (const row of group.rows) list.append(this.row(group.id, row));
        item.append(list);
      }
      items.push(item);
    }
    this.element.replaceChildren(...items);
    const all = this.items();
    if (!all.some(item => item.dataset.key === this.focusKey)) this.focusKey = all[0]?.dataset.key ?? null;
    for (const item of all) item.tabIndex = item.dataset.key === this.focusKey ? 0 : -1;
    if (hadFocus && this.focusKey) this.item(this.focusKey)?.focus();
  }

  private row(group: string, row: TreeRowData): HTMLElement {
    const key = `r${SEP}${group}${SEP}${row.id}`;
    const star = h("button", { class: "pose-tree-star", type: "button", tabindex: -1, "aria-pressed": String(!!row.favourite),
      "aria-label": row.favourite ? `Remove ${row.label} from favourites` : `Add ${row.label} to favourites`,
      title: row.favourite ? "Remove from favourites (F)" : "Add to favourites (F)", text: row.favourite ? "★" : "☆" });
    star.addEventListener("click", event => { event.stopPropagation(); this.options.onFavourite(row.id, !row.favourite); });
    const status = h("span", { class: "pose-tree-status", "aria-hidden": row.loading ? "false" : "true" });
    setText(status, row.loading ? "Loading…" : "");
    const item = h("li", { class: `pose-tree-row${row.current ? " is-current" : ""}${row.disabled ? " is-disabled" : ""}${row.favourite ? " is-favourite" : ""}`,
      role: "treeitem", "aria-level": 2, "data-key": key, "data-pose": row.id, tabindex: -1, title: row.disabled ?? undefined,
      "aria-disabled": row.disabled ? "true" : undefined, "aria-current": row.current ? "true" : undefined,
      "aria-label": [row.label, row.secondary, ...row.badges.map(item => item.text), row.disabled, row.loading ? "loading" : ""].filter(Boolean).join(", ") },
    h("span", { class: "pose-tree-label", text: row.label }),
    row.secondary ? h("span", { class: "pose-tree-secondary", text: row.secondary }) : null,
    ...row.badges.map(item => { const chip = badge(item.text, "neutral"); setAttr(chip, "title", item.title); return chip; }),
    status, star);
    item.addEventListener("click", () => { this.setFocus(key, false); if (!row.disabled) this.options.onActivate(row.id); });
    return item;
  }
  private items() { return [...this.element.querySelectorAll<HTMLElement>("[data-key]")]; }
  private item(key: string) { return this.items().find(item => item.dataset.key === key) ?? null; }
  private setFocus(key: string, move: boolean) {
    this.focusKey = key;
    for (const item of this.items()) item.tabIndex = item.dataset.key === key ? 0 : -1;
    if (move) { const item = this.item(key); item?.focus(); item?.scrollIntoView?.({ block: "nearest" }); }
  }
  private key(event: KeyboardEvent) {
    const items = this.items(), index = items.findIndex(item => item.dataset.key === this.focusKey), item = items[index];
    if (!item) return;
    const [kind, group, row] = item.dataset.key!.split(SEP) as [string, string, string | undefined];
    const binding = keyBinding("rows", event)?.id;
    if (binding === "rows.focus") {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)));
      this.setFocus(items[next]!.dataset.key!, true);
    } else if (binding === "rows.expand") {
      event.preventDefault();
      if (kind === "g") {
        if (event.key === "ArrowRight") { if (!this.open.has(group)) this.options.onToggle(group, true); else if (items[index + 1]?.dataset.key?.startsWith(`r${SEP}${group}${SEP}`)) this.setFocus(items[index + 1]!.dataset.key!, true); }
        else if (this.open.has(group)) this.options.onToggle(group, false);
      } else if (event.key === "ArrowLeft") this.setFocus(`g${SEP}${group}`, true);
    } else if (binding === "rows.favourite" && kind === "r") {
      event.preventDefault();
      const data = this.groups.find(entry => entry.id === group)?.rows.find(entry => entry.id === row);
      if (data) this.options.onFavourite(data.id, !data.favourite);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (kind === "g") this.options.onToggle(group, !this.open.has(group));
      else { const data = this.groups.find(entry => entry.id === group)?.rows.find(entry => entry.id === row); if (data && !data.disabled) this.options.onActivate(data.id); }
    }
  }
}
