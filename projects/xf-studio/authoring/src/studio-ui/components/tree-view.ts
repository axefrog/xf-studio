import { keyBinding } from "../../input-bindings";
import { h, setAttr, setText } from "../dom";
import { icon } from "../icons";
import { ScrollMemory, type RestoreResult } from "../scroll-anchor";
import { rowWords, SizeBar } from "./size-bar";
import type { ScrollAnchor } from "../../ui-preferences";

/**
 * Tree view (style guide "Tree view"): legacy groups of rows, or recursive `nodes`, virtualised for thousands of visible rows.
 * Recursive nodes select on label click/Enter/Space; their chevron and Left/Right disclose children. Owners hold selection/expansion.
 * Child providers are synchronous snapshot projections, called once per expanded node per update, never for collapsed descendants.
 * Hover/focus report item references without selecting. The same row height, states and sizing serve both input forms.
 *
 * - **Groups** expand and collapse on a click, Enter, Space, Right and Left; the owner holds the expanded set (it remembers it: in its
 *   service, or with view-state.ts `RememberedSet`) and hears `onToggle`. A group with no rows is not shown.
 * - **Rows** activate on one click or Enter (`onActivate`); there is no separate select step. A disabled row stays focusable, shows its
 *   plain reason as its tooltip and description, and does not activate. The current row carries `aria-current`.
 * - **Keyboard** (the WAI tree pattern): one tab stop (roving tabindex); Up and Down move through the visible items, Home and End jump;
 *   Right opens a group or moves to its first row; Left closes a group or moves to a row's group; typing a letter jumps to the next item
 *   starting with it; the focused item scrolls into view. `onKey` sees each key first (a feature's own binding, such as F for a
 *   favourite) and returns true when it handled it.
 * - **Context menu** (`onMenu`): a right-click on an item, Shift+F10 or the Menu key hears the item and where to open the owner's menu
 *   (the pointer, or the focused item). The owner shows only what can be done on that item and opens nothing when there is nothing.
 * - **Scale:** only the items in view (plus a margin, plus the focused one) are in the page, and they follow the tree's own size (a
 *   ResizeObserver) as well as scrolling and updates; items are reused by ID and updated in place, so focus and the scroll position
 *   survive updates. Every item is one row high (28 px).
 * - **Remembered scroll** (scroll-anchor.ts): the item at the top edge and how far it is scrolled past are remembered under `remember`
 *   (default `tree:<label>`) and brought back once the items arrive, even when they load later; a missing item falls back to the one
 *   before it. `scrollToItem` puts any item at the top by ID, rendered or not.
 * - **Height:** by default the owner sizes the frame. With `maxRows` the frame fits its content: as tall as its visible items, up to
 *   that many rows, then the tree scrolls; `minRows` (default 1) keeps a floor so a search that shrinks the list doesn't pull what
 *   follows up and down as the person types. An empty tree is as tall as its message (at least the floor). Opening or closing a group
 *   changes the height, which the person asked for.
 * - **Size bar** (`sizeBar`, components/size-bar.ts): a bar under the frame the person drags to make the tree taller or shorter, in
 *   whole rows (a drag snaps to them; the bar's value says rows). With `maxRows`, the chosen height replaces `maxRows` as the most the
 *   frame fits to (it still fits fewer rows, never under the floor, and never shows more than its rows, which never lowers the chosen
 *   height); the default is `maxRows` rows. Without it the frame is the chosen height, `defaultRows` rows by default. The height is remembered under the bar's view key. The owner places
 *   `tree.sizeBar.region` (the frame with the bar under it) instead of `tree.element`.
 * - **Identity:** a group and a row are told apart by their kind, so a row may share its ID with a group; within a kind, IDs are
 *   unique (a row listed in several groups, such as Favourites and its category, carries its group in its ID).
 * - **Focus** stays in the tree when the focused item leaves it (a row unstarred out of Favourites, a search that no longer matches):
 *   it moves to the item that took its place, else the one before.
 * - **States:** current, disabled, loading (a status pinned to the tree's corner that never scrolls or moves the rows), empty (its
 *   message at the top of the tree), search-match highlight ranges per label.
 * - **Access:** explicit `aria-level`, `aria-setsize` and `aria-posinset` support virtualisation. Recursive branches own a `role=group`
 *   owning their rendered children; ancestors remain rendered. Selectable items declare `aria-selected` independently of focus.
 *   Legacy secondary text still hides below 320 px; recursive short metadata stays visible. Full recursive text remains in tooltips
 *   and accessible names. Swatches are decorative; labels must identify the item without colour.
 *   Groups carry `aria-expanded`. Each item's name is its label, secondary text and badges as text; a trailing action (a favourite
 *   toggle) is outside the name, reached by the pointer or the owner's key binding, never by Tab. The loading status and the empty
 *   message sit beside the tree, never inside it, so the tree holds only its items.
 */
export type TreeBadge = { text: string; tone?: "neutral" | "accent" | "info" | "success" | "warning" | "error" };
export type TreeRowData = { id: string; label: string; secondary?: string; badges?: readonly TreeBadge[]; disabled?: boolean; reason?: string;
  /** Optional colour sample, alongside the text label (never the only way to identify an item). */
  swatch?: string;
  /** Search-match ranges in `label` ([start, end) pairs), drawn highlighted. */
  highlight?: readonly (readonly [number, number])[];
  /** The owner's state behind the trailing action (e.g. whether it is a favourite): a change rebuilds the row's trailing slot. */
  trailingState?: string | number | boolean };
export type TreeGroupData = { id: string; label: string; secondary?: string; count?: number; badges?: readonly TreeBadge[]; rows: readonly TreeRowData[];
  highlight?: readonly (readonly [number, number])[] };
export type TreeNodeData = TreeRowData & {
  /** Empty arrays are leaves; a provider declares a branch. Providers perform no I/O and are evaluated only while expanded. */
  children?: readonly TreeNodeData[] | (() => readonly TreeNodeData[]);
  /** Optional count, independent of the child provider, so closed branches need not be evaluated for their label. */
  count?: number;
  /** False: disclosure only, with no selected state or activation. Default true, including branches. */
  selectable?: boolean;
};
export type TreeItemRef = { kind: "group" | "row" | "node"; id: string; group: string; parent?: string };
export type TreeViewState = ({ groups: readonly TreeGroupData[]; nodes?: never; selected?: never }
  | { nodes: readonly TreeNodeData[]; groups?: never; selected?: string }) & {
  expanded: ReadonlySet<string>; current?: string; loading?: boolean | string;
};
export type TreeViewOptions = {
  label: string;
  onActivate(rowId: string): void;
  onToggle(groupId: string, expanded: boolean): void;
  /** Item identity under the pointer; null on leaving, hiding, virtualising away or aborting the tree. Does not select. */
  onHover?(item: TreeItemRef | null): void;
  /** Item identity receiving focus, independently of selection. */
  onFocus?(item: TreeItemRef): void;
  /** Withdraw the component's DOM listeners and observations with its owner. */
  signal?: AbortSignal;
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
  /** The view key its scroll position is remembered under (default `tree:<label>`); false: not remembered. */
  remember?: string | false;
  /**
   * A size bar under the frame, its height remembered under this view key (e.g. `expressions:start-from`). Without `maxRows` the frame
   * is the chosen height, `defaultRows` rows by default (8).
   */
  sizeBar?: { key: string; defaultRows?: number };
};
export const TREE_ROW_HEIGHT = 28;
/** A tree frame's height in rows, to the nearest half row, for its size bar's value text ("6 rows, default", "7 and a half rows"). */
export const treeHeightWords = (height: number, isDefault = false) => rowWords(height, TREE_ROW_HEIGHT, isDefault);
const OVERSCAN = 8;
type Flat = { ref: TreeItemRef; group?: TreeGroupData; row?: TreeRowData; node?: TreeNodeData; parent?: string;
  branch: boolean; open: boolean; level: number; setsize: number; posinset: number; ident: string; key: string };
/** An item's identity: its kind and ID (a group and a row may share an ID). */
const identOf = (kind: TreeItemRef["kind"], id: string) => `${kind === "group" ? "g" : kind === "node" ? "n" : "r"}:${id}`;
let treeSequence = 0;

export class TreeView {
  /** The tree's frame: the owner sizes it (a height, or a place in a flex layout). */
  readonly element: HTMLElement;
  /** The scrolling `role=tree` inside the frame. */
  private readonly tree: HTMLElement;
  private readonly spacer: HTMLElement;
  private readonly status: HTMLElement;
  private readonly empty: HTMLElement;
  private recursive = false;
  private selected: string | undefined;
  private current: string | undefined;
  private flat: Flat[] = [];
  /** The focused item's identity (`identOf`). */
  private focusId: string | undefined;
  private readonly rendered = new Map<string, { element: HTMLElement; key: string }>();
  private frame = 0;
  private readonly lifetime = new AbortController();
  private readonly domId = `ui-tree-${++treeSequence}`;
  private readonly ownedGroups = new Map<string, HTMLElement>();
  private hovered: string | undefined;
  private notifiedFocus: string | undefined;
  private readonly resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => { this.paint(); this.memory?.contentChanged(); }) : undefined;
  private readonly memory?: ScrollMemory;
  /** The bar under the frame that resizes it (`sizeBar`); the owner places its `region` (the frame and the bar) instead of `element`. */
  readonly sizeBar?: SizeBar;
  constructor(private readonly options: TreeViewOptions) {
    this.spacer = h("div", { class: "tree-spacer" });
    this.tree = h("div", { class: "tree-scroll", role: "tree", "aria-label": options.label }, this.spacer);
    this.status = h("div", { class: "tree-status", role: "status", hidden: true });
    this.empty = h("p", { class: "tree-empty", hidden: true, text: options.emptyText ?? "Nothing to show." });
    this.element = h("div", { class: "tree-view" }, this.empty, this.tree, this.status);
    const listen = { signal: this.lifetime.signal };
    this.tree.addEventListener("scroll", () => { cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => this.paint()); }, listen);
    this.element.addEventListener("keydown", event => this.key(event), listen);
    this.element.addEventListener("click", event => this.click(event), listen);
    this.element.addEventListener("pointerover", event => this.hover(this.itemOf(event.target)), listen);
    this.element.addEventListener("pointerout", event => this.hover(this.itemOf(event.relatedTarget)), listen);
    // A taller tree shows more rows at once (UI-118): paint whenever its size changes, not only on updates and scrolling.
    this.resize?.observe(this.tree);
    if (options.remember !== false) this.memory = new ScrollMemory(this.tree, options.remember ?? `tree:${options.label}`, { observe: false,
      source: { capture: () => this.captureAnchor(), restore: anchor => this.restoreAnchor(anchor) } });
    // Focus that arrives by any route (a pointer, a script, assistive technology) moves the roving tab stop with it.
    this.element.addEventListener("focusin", event => {
      const item = this.itemOf(event.target);
      if (item && item.ident !== this.focusId) { this.focusId = item.ident; for (const [ident, entry] of this.rendered) entry.element.tabIndex = ident === this.focusId ? 0 : -1; }
      if (item) this.notifyFocus(item);
    }, listen);
    this.element.addEventListener("focusout", () => queueMicrotask(() => {
      if (!this.tree.contains(document.activeElement)) this.notifiedFocus = undefined;
    }), listen);
    this.element.addEventListener("contextmenu", event => {
      const item = options.onMenu ? this.itemOf(event.target) : undefined;
      if (!item) return;
      event.preventDefault();
      this.focusIdent(item.ident);
      options.onMenu!(item.ref, { x: event.clientX, y: event.clientY });
    }, listen);
    if (options.sizeBar) {
      const floor = () => (options.minRows ?? 1) * TREE_ROW_HEIGHT + 2;
      this.sizeBar = new SizeBar({ label: options.label, target: this.element, key: options.sizeBar.key, step: TREE_ROW_HEIGHT,
        snap: { step: TREE_ROW_HEIGHT, offset: 2 }, valueText: treeHeightWords,
        minHeight: floor, defaultHeight: () => (options.maxRows ?? options.sizeBar!.defaultRows ?? 8) * TREE_ROW_HEIGHT + 2,
        // Fitting its rows (`maxRows`), it never shows more than its rows (an empty tree: its message, at least the floor); that caps
        // only what shows, never the chosen height. Otherwise the frame is the chosen height.
        ...(options.maxRows ? { maxHeight: () => Math.max(floor(), this.flat.length * TREE_ROW_HEIGHT + 2) } : {}),
        apply: () => this.fit() });
    }
    options.signal?.addEventListener("abort", () => this.dispose(), { once: true, signal: this.lifetime.signal });
    if (options.signal?.aborted) this.dispose();
  }
  /** Controlled snapshot: legacy `groups/current`, or recursive `nodes/selected`; `expanded` opens branches in either form. */
  update(state: TreeViewState) {
    if (this.lifetime.signal.aborted) return;
    const previous = this.flat;
    const focusIndex = this.flat.findIndex(item => item.ident === this.focusId);
    const hadFocus = this.tree.contains(document.activeElement);
    const recursive = !!state.nodes, flat: Flat[] = [];
    if (state.nodes) {
      const seen = new Set<string>();
      const visit = (nodes: readonly TreeNodeData[], level: number, parent?: Flat) => nodes.forEach((node, index) => {
        if (seen.has(node.id)) throw Error(`Tree node IDs must be unique: ${node.id}`);
        seen.add(node.id);
        const branch = typeof node.children === "function" || !!node.children?.length, open = branch && state.expanded.has(node.id);
        const item: Flat = { ref: { kind: "node", id: node.id, group: parent?.ref.id ?? node.id, ...(parent ? { parent: parent.ref.id } : {}) },
          node, parent: parent?.ident, branch, open, level, setsize: nodes.length, posinset: index + 1, ident: identOf("node", node.id), key: "" };
        flat.push(item);
        if (open) visit(typeof node.children === "function" ? node.children() : node.children!, level + 1, item);
      });
      visit(state.nodes, 1);
    } else {
      const shown = state.groups!.filter(group => group.rows.length);
      shown.forEach((group, gi) => {
        const open = state.expanded.has(group.id), ident = identOf("group", group.id);
        flat.push({ ref: { kind: "group", id: group.id, group: group.id }, group, branch: true, open, level: 1, setsize: shown.length, posinset: gi + 1, ident, key: "" });
        if (open) group.rows.forEach((row, ri) => flat.push({ ref: { kind: "row", id: row.id, group: group.id }, group, row, parent: ident, branch: false, open: false, level: 2,
          setsize: group.rows.length, posinset: ri + 1, ident: identOf("row", row.id), key: "" }));
      });
    }
    this.recursive = recursive; this.current = state.current; this.selected = recursive ? state.selected ?? state.current : undefined;
    this.flat = flat;
    for (const item of flat) {
      // Children/providers are intentionally excluded: collapsed data is never serialised or traversed.
      const data = item.node ? (({ children, ...row }) => row)(item.node) : item.row ?? { ...item.group, rows: item.group!.rows.length };
      item.key = JSON.stringify([data, item.branch, item.open, item.node ? item.ref.id === this.selected : item.row?.id === state.current,
        item.level, item.setsize, item.posinset]);
    }
    if (this.hovered && !flat.some(item => item.ident === this.hovered)) this.hover();
    let refocus = false;
    if (!this.flat.some(item => item.ident === this.focusId)) {
      // The focused item left. While the tree has focus, the item that took its place (else the one before) takes it, so focus stays
      // in the tree (UI-119); otherwise the current row, else the first item, is where Tab comes back in.
      let ancestor = recursive && hadFocus ? previous[focusIndex]?.parent : undefined;
      while (ancestor && !flat.some(item => item.ident === ancestor)) ancestor = previous.find(item => item.ident === ancestor)?.parent;
      this.focusId = ancestor ?? (hadFocus && focusIndex >= 0 && flat.length ? flat[Math.min(focusIndex, flat.length - 1)]!.ident
        : flat.find(item => recursive ? item.ref.id === this.selected : item.row?.id === state.current)?.ident ?? flat[0]?.ident);
      refocus = hadFocus;
    }
    this.spacer.style.height = `${this.flat.length * TREE_ROW_HEIGHT}px`;
    if (this.sizeBar) this.sizeBar.refresh();
    this.fit();
    this.empty.hidden = this.flat.length > 0;
    setText(this.status, typeof state.loading === "string" ? state.loading : state.loading ? "Loading…" : "");
    this.status.hidden = !state.loading;
    if (refocus && this.focusId) this.focusIdent(this.focusId);
    else this.paint();
    this.memory?.contentChanged();
  }
  /**
   * The frame's height. With `maxRows` the frame fits its content: as tall as its items up to maxRows (or the height chosen with the
   * size bar), then the tree scrolls; never under the floor; empty, as tall as its message (at least the floor). With a size bar alone
   * it is the chosen height. The frame's 1 px border on each side is outside the rows. Otherwise the owner sizes it.
   */
  private fit() {
    if (!this.options.maxRows && !this.sizeBar) return;
    const floor = (this.options.minRows ?? 1) * TREE_ROW_HEIGHT + 2, content = this.flat.length * TREE_ROW_HEIGHT + 2;
    this.element.style.minHeight = `${floor}px`;
    // A size bar without maxRows: the frame is the chosen height (the Poses tree), whatever it holds.
    if (!this.options.maxRows) { this.element.style.height = `${this.sizeBar!.height}px`; return; }
    const most = this.sizeBar ? this.sizeBar.height : this.options.maxRows * TREE_ROW_HEIGHT + 2;
    this.element.style.height = this.flat.length ? `${Math.max(floor, Math.min(most, content))}px` : "";
  }
  /**
   * Scroll so the item (the row with that ID, else the group; `kind` picks one) sits at the top, `offset` px of it scrolled past the
   * edge; false when it isn't in the tree (a folded group's row, or not loaded yet).
   */
  scrollToItem(id: string, kind?: TreeItemRef["kind"], offset = 0): boolean {
    const index = this.flat.findIndex(item => item.ref.id === id && (kind ? item.ref.kind === kind : true));
    if (index < 0) return false;
    this.tree.scrollTop = index * TREE_ROW_HEIGHT + offset;
    this.paint();
    return true;
  }
  /** Adapter compatibility; new owners may pass an AbortSignal instead. */
  dispose() {
    if (this.lifetime.signal.aborted) return;
    this.hover(); this.lifetime.abort(); cancelAnimationFrame(this.frame);
    this.memory?.dispose(); this.resize?.disconnect();
  }
  private hover(item?: Flat) {
    if (this.lifetime.signal.aborted || this.hovered === item?.ident) return;
    this.hovered = item?.ident;
    this.options.onHover?.(item?.ref ?? null);
  }
  private notifyFocus(item: Flat) {
    if (this.notifiedFocus === item.ident || this.lifetime.signal.aborted) return;
    this.notifiedFocus = item.ident; this.options.onFocus?.(item.ref);
  }
  private captureAnchor(): ScrollAnchor | undefined {
    if (!this.tree.clientHeight) return undefined;
    const top = Math.round(this.tree.scrollTop || 0), index = Math.floor(top / TREE_ROW_HEIGHT), item = this.flat[index];
    if (top <= 0 || !item) return { top: Math.max(0, top) };
    // The items before it, nearest first: a fallback puts one at the top edge.
    const offset = top - index * TREE_ROW_HEIGHT, near: { key: string; offset: number }[] = [];
    for (let at = index - 1; at >= 0 && near.length < 3; at--) near.push({ key: this.flat[at]!.ident, offset: 0 });
    // The item's group last, so a row that left still finds its group.
    if (item.parent && !near.some(entry => entry.key === item.parent)) near.push({ key: item.parent, offset: 0 });
    return { key: item.ident, offset, ...(near.length ? { near } : {}), top };
  }
  private restoreAnchor(anchor: ScrollAnchor): RestoreResult {
    if (!this.tree.clientHeight || !this.flat.length) return "wait";
    const go = (ident: string, offset: number) => {
      const index = this.flat.findIndex(item => item.ident === ident);
      if (index < 0) return undefined;
      const target = index * TREE_ROW_HEIGHT + offset;
      this.tree.scrollTop = target;
      this.paint();
      return Math.abs((this.tree.scrollTop || 0) - target) < 1;
    };
    if (anchor.key) {
      const exact = go(anchor.key, anchor.offset ?? 0);
      if (exact !== undefined) return exact ? "exact" : "near";
      for (const near of anchor.near ?? []) if (go(near.key, Math.max(0, Math.min(near.offset, TREE_ROW_HEIGHT - 1))) !== undefined) return "near";
    }
    this.tree.scrollTop = anchor.top;
    this.paint();
    return anchor.key ? "wait" : "exact";
  }
  /** Move focus into the tree (its focused item, else the first). */
  focus() { const ident = this.focusId ?? this.flat[0]?.ident; if (ident) this.focusIdent(ident); }
  /** Focus an item by ID, scrolling it into view: the row with that ID, else the group (`kind` picks one). */
  focusItem(id: string | undefined, kind?: TreeItemRef["kind"]) {
    if (id === undefined) return;
    const ident = (kind ? [kind] : ["node", "row", "group"] as const).map(k => identOf(k, id)).find(candidate => this.flat.some(item => item.ident === candidate));
    if (ident) this.focusIdent(ident);
  }
  private focusIdent(ident: string) {
    if (this.lifetime.signal.aborted) return;
    const index = this.flat.findIndex(item => item.ident === ident);
    if (index < 0) return;
    this.focusId = ident;
    this.reveal(index);
    this.paint();
    this.rendered.get(ident)?.element.focus({ preventScroll: true });
    if (this.rendered.get(ident)?.element.contains(document.activeElement)) this.notifyFocus(this.flat[index]!);
  }
  private reveal(index: number) {
    const top = index * TREE_ROW_HEIGHT, view = this.tree.clientHeight;
    if (!view) return;
    if (top < this.tree.scrollTop) this.tree.scrollTop = top;
    else if (top + TREE_ROW_HEIGHT > this.tree.scrollTop + view) this.tree.scrollTop = top + TREE_ROW_HEIGHT - view;
  }
  /** Render the items in view (and the focused one), reusing elements by identity. */
  private paint() {
    if (this.lifetime.signal.aborted) return;
    const view = this.tree.clientHeight || TREE_ROW_HEIGHT * 30, scroll = this.tree.scrollTop || 0;
    const first = Math.max(0, Math.floor(scroll / TREE_ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(this.flat.length, Math.ceil((scroll + view) / TREE_ROW_HEIGHT) + OVERSCAN);
    const want = new Map<string, number>();
    for (let i = first; i < last; i++) want.set(this.flat[i]!.ident, i);
    const focused = this.flat.findIndex(item => item.ident === this.focusId);
    if (focused >= 0) want.set(this.focusId!, focused);
    // Keep the semantic path to virtualised descendants in the accessibility tree. Children remain flat in the visual spacer.
    if (this.recursive) for (const ident of want.keys()) {
      const parent = this.flat.find(item => item.ident === ident)?.parent;
      if (parent && !want.has(parent)) want.set(parent, this.flat.findIndex(item => item.ident === parent));
    }
    if (this.hovered && !want.has(this.hovered)) this.hover();
    for (const [ident, entry] of this.rendered) if (!want.has(ident)) { entry.element.remove(); this.rendered.delete(ident); }
    for (const [ident, index] of want) {
      const item = this.flat[index]!;
      let entry = this.rendered.get(ident);
      if (!entry || entry.key !== item.key) {
        // Focus on the item or inside it (its trailing star, after a click) moves to the rebuilt item.
        const element = this.build(item), hadFocus = !!entry && entry.element.contains(document.activeElement);
        if (entry) { this.spacer.insertBefore(element, entry.element); entry.element.remove(); } else this.spacer.append(element);
        entry = { element, key: item.key };
        this.rendered.set(ident, entry);
        if (hadFocus) element.focus({ preventScroll: true });
      }
      entry.element.style.transform = `translateY(${index * TREE_ROW_HEIGHT}px)`;
      entry.element.tabIndex = ident === this.focusId ? 0 : -1;
    }
    this.ownHierarchy(want);
  }
  private idOf(ident: string) { return `${this.domId}-${encodeURIComponent(ident)}`; }
  private ownHierarchy(want: ReadonlyMap<string, number>) {
    const ordered = [...want.values()].sort((a, b) => a - b).map(index => this.flat[index]!);
    const branches = new Set(this.recursive ? ordered.filter(item => item.open).map(item => item.ident) : []);
    for (const [ident, group] of this.ownedGroups) if (!branches.has(ident)) { group.remove(); this.ownedGroups.delete(ident); }
    for (const item of this.recursive ? ordered : []) {
      const element = this.rendered.get(item.ident)!.element;
      if (!item.open) { setAttr(element, "aria-owns", undefined); continue; }
      let group = this.ownedGroups.get(item.ident);
      if (!group) { group = h("div", { role: "group", id: `${this.idOf(item.ident)}-children` }); this.ownedGroups.set(item.ident, group); this.spacer.append(group); }
      setAttr(group, "aria-owns", ordered.filter(child => child.parent === item.ident).map(child => this.idOf(child.ident)).join(" ") || undefined);
      setAttr(element, "aria-owns", group.id);
    }
    setAttr(this.tree, "aria-owns", this.recursive ? ordered.filter(item => !item.parent).map(item => this.idOf(item.ident)).join(" ") || undefined : undefined);
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
    const swatch = (colour?: string) => {
      if (!colour) return null;
      const sample = h("span", { class: "swatch tree-swatch", "aria-hidden": "true" }); sample.style.setProperty("--swatch", colour); return sample;
    };
    if (item.node) {
      const node = item.node, selected = node.id === this.selected && node.selectable !== false;
      const disclosure = h("span", { class: "tree-chevron", "aria-hidden": "true", ...(item.branch ? { "data-tree-disclosure": "true", title: `${item.open ? "Collapse" : "Expand"} ${node.label}` } : {}) },
        item.branch ? icon("chevronRight") : null);
      const element = h("div", { class: `tree-item tree-node${item.branch ? " tree-branch" : ""}${node.disabled ? " disabled" : ""}${selected ? " current" : ""}`,
        id: this.idOf(item.ident), role: "treeitem", "data-id": node.id, "data-kind": "node", "aria-level": String(item.level),
        "aria-setsize": String(item.setsize), "aria-posinset": String(item.posinset), "aria-expanded": item.branch ? String(item.open) : undefined,
        "aria-selected": node.selectable !== false ? String(selected) : undefined, "aria-disabled": node.disabled ? "true" : undefined,
        "aria-description": node.disabled ? node.reason : undefined, title: node.disabled ? node.reason : name([node.label, node.secondary]),
        "aria-label": name([node.label, node.secondary, ...(node.badges ?? []).map(b => b.text), node.count === undefined ? undefined : `${node.count} items`]) },
        disclosure, swatch(node.swatch), this.label(node.label, node.highlight), node.secondary ? h("span", { class: "tree-secondary", text: node.secondary }) : null,
        ...badges(node.badges), node.count === undefined ? null : h("span", { class: "tree-count", text: String(node.count) }));
      element.style.setProperty("--tree-depth", String(item.level - 1));
      return element;
    }
    if (item.ref.kind === "group") {
      const group = item.group!, open = item.open, count = group.count ?? group.rows.length;
      return h("div", { class: "tree-item tree-group", role: "treeitem", "data-id": group.id, "data-kind": "group", "aria-level": "1", "aria-setsize": String(item.setsize),
        "aria-posinset": String(item.posinset), "aria-expanded": String(open), title: group.secondary ? `${group.label} · ${group.secondary}` : undefined,
        "aria-label": name([group.label, group.secondary, `${count} item${count === 1 ? "" : "s"}`, ...(group.badges ?? []).map(b => b.text)]) },
        h("span", { class: "tree-chevron", "aria-hidden": "true" }, icon("chevronRight")), this.label(group.label, group.highlight),
        group.secondary ? h("span", { class: "tree-secondary", text: group.secondary }) : null, ...badges(group.badges),
        h("span", { class: "tree-count", text: String(count) }));
    }
    const row = item.row!, trailing = this.options.trailing?.(row, item.group!);
    const element = h("div", { class: `tree-item tree-row${row.disabled ? " disabled" : ""}${row.id === this.current ? " current" : ""}`, role: "treeitem",
      "data-id": row.id, "data-kind": "row", "aria-level": "2", "aria-setsize": String(item.setsize), "aria-posinset": String(item.posinset),
      "aria-current": row.id === this.current ? "true" : undefined, "aria-disabled": row.disabled ? "true" : undefined,
      "aria-selected": String(row.id === this.current),
      "aria-description": row.disabled ? row.reason : undefined,
      // The full text in the tooltip: the secondary text is the first to shrink, and hides in a narrow tree (studio.css `.tree-view`).
      title: row.disabled ? row.reason : row.secondary ? `${row.label} · ${row.secondary}` : undefined,
      "aria-label": name([row.label, row.secondary, ...(row.badges ?? []).map(b => b.text)]) },
      swatch(row.swatch), this.label(row.label, row.highlight), row.secondary ? h("span", { class: "tree-secondary", text: row.secondary }) : null, ...badges(row.badges),
      trailing ? h("span", { class: "tree-trailing" }, trailing) : null);
    // A trailing action is reached by the pointer or the owner's key binding, never by Tab (the tree is one tab stop).
    if (trailing) for (const control of [trailing, ...trailing.querySelectorAll<HTMLElement>("button")]) if (control.tagName.toLowerCase() === "button") control.tabIndex = -1;
    return element;
  }
  private itemOf(target: EventTarget | null) {
    const element = target instanceof Element ? target.closest<HTMLElement>(".tree-item") : null;
    if (element?.dataset.id === undefined || !this.tree.contains(element)) return undefined;
    const ident = identOf(element.dataset.kind === "node" ? "node" : element.dataset.kind === "group" ? "group" : "row", element.dataset.id);
    return this.flat.find(item => item.ident === ident);
  }
  private click(event: MouseEvent) {
    if (this.lifetime.signal.aborted) return;
    if (event.target instanceof Element && event.target.closest(".tree-trailing")) return;
    const item = this.itemOf(event.target);
    if (!item) return;
    this.focusIdent(item.ident);
    if (item.node) {
      if ((event.target instanceof Element && event.target.closest("[data-tree-disclosure]")) || item.node.selectable === false) {
        if (item.branch) this.options.onToggle(item.ref.id, !item.open);
      } else if (!item.node.disabled) this.options.onActivate(item.ref.id);
    } else if (item.branch) this.options.onToggle(item.ref.id, !item.open);
    else if (!item.row!.disabled) this.options.onActivate(item.ref.id);
  }
  private key(event: KeyboardEvent) {
    if (this.lifetime.signal.aborted) return;
    const index = this.flat.findIndex(item => item.ident === this.focusId), item = this.flat[index];
    if (!item) return;
    if (this.options.onKey?.(event, item.ref)) { event.preventDefault(); return; }
    if (this.options.onMenu && keyBinding("rows", event)?.id === "rows.menu") {
      event.preventDefault();
      this.options.onMenu(item.ref, this.rendered.get(item.ident)?.element ?? this.element);
      return;
    }
    const move = (to: number) => { event.preventDefault(); const next = this.flat[Math.max(0, Math.min(this.flat.length - 1, to))]; if (next) this.focusIdent(next.ident); };
    const open = item.open;
    switch (event.key) {
      case "ArrowDown": move(index + 1); return;
      case "ArrowUp": move(index - 1); return;
      case "Home": move(0); return;
      case "End": move(this.flat.length - 1); return;
      case "ArrowRight":
        event.preventDefault();
        if (item.branch) { if (!open) this.options.onToggle(item.ref.id, true); else if (this.flat[index + 1]?.parent === item.ident) move(index + 1); }
        return;
      case "ArrowLeft":
        event.preventDefault();
        if (open) this.options.onToggle(item.ref.id, false);
        else if (item.parent) this.focusIdent(item.parent);
        return;
      case "Enter": case " ":
        event.preventDefault();
        if (item.node) {
          if (item.node.selectable === false) { if (item.branch) this.options.onToggle(item.ref.id, !open); }
          else if (!item.node.disabled) this.options.onActivate(item.ref.id);
        } else if (item.branch) this.options.onToggle(item.ref.id, !open);
        else if (event.key === "Enter" && !item.row!.disabled) this.options.onActivate(item.ref.id);
        return;
    }
    if (event.key.length === 1 && /\S/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const letter = event.key.toLowerCase(), order = [...this.flat.slice(index + 1), ...this.flat.slice(0, index + 1)];
      const hit = order.find(entry => (entry.node?.label ?? entry.row?.label ?? entry.group!.label).toLowerCase().startsWith(letter));
      if (hit) { event.preventDefault(); this.focusIdent(hit.ident); }
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
