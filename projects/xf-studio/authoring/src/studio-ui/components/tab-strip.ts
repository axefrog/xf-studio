import { h, setAttr, setText } from "../dom";
import { icon, type IconName } from "../icons";
import { openMenu } from "../menu";

/**
 * Tab strip (style guide "Tab strip"): a row of tabs, or a column when its group is folded to a vertical strip, that never overflows
 * its header. When space runs short it condenses in stages, each tried only when the one before doesn't fit:
 *
 * 1. **full**: every tab shows its icon and whole label;
 * 2. **truncated**: the inactive tabs' labels are cut short with an ellipsis (the active tab keeps its whole label);
 * 3. **icons**: the inactive tabs show only their icons; the active tab keeps its (shortened) label, then, if that is still too long,
 *    drops to its icon too (its name stays its tooltip and accessible name);
 * 4. **overflow**: icon-only tabs that still don't fit move into a "more tabs" menu at the strip's end; the active tab always stays
 *    in the strip.
 *
 * Every tab's accessible name is its label (`aria-label`), and its tooltip is its label with what it shows, so an icon-only tab
 * still says what it is. The strip emits intents (select, close, key, context menu, pointer down); its owner decides what they do.
 * `fit` measures and picks the stage; an owner calls it after layout and whenever the header's size changes (PanelHeader does).
 */
export type TabItem = {
  id: string; label: string; icon: IconName;
  /** The tab's tooltip (defaults to its label). */
  tooltip?: string;
  /** Whether the active tab shows a close mark (the keyboard closes with the strip's own key binding). */
  closable?: boolean;
};
export type TabStripStage = "full" | "truncated" | "icons" | "overflow";
export const TAB_STAGES: readonly TabStripStage[] = ["full", "truncated", "icons", "overflow"];
export type TabStripOptions = {
  /** The tablist's accessible name. */
  label: string;
  /** `vertical`: a folded strip (the tabs read top to bottom). */
  orientation?: "horizontal" | "vertical";
  /** The tab element IDs are `<idPrefix><item id>` (the tabpanel's `aria-labelledby` points at the active one). */
  idPrefix?: string;
  /** The tabpanel the tabs control. */
  controls?: string;
  /** Extra attributes on each tab (e.g. the dock's `data-panel`). */
  tabData?: (item: TabItem) => Record<string, string>;
  /** A tab was chosen: clicked, or picked from the overflow menu. */
  onSelect(id: string): void;
  onClose?(id: string): void;
  onKeyDown?(event: KeyboardEvent, id: string, tab: HTMLButtonElement): void;
  onContextMenu?(event: MouseEvent, id: string, tab: HTMLButtonElement): void;
  onPointerDown?(event: PointerEvent, id: string, tab: HTMLButtonElement): void;
  onAuxClick?(event: MouseEvent, id: string): void;
};

/**
 * The staging rule, pure (tested without layout): the first stage whose tabs fit `available`, and for the overflow stage which tabs
 * stay in the strip. `sizes[stage][i]` is tab i's length along the strip at that stage (`icons` also stands for the overflow stage's
 * icon-only tabs); `activeIcon` is the active tab's length as an icon only; `more` the overflow button's length.
 */
export type TabPlanInput = { available: number; sizes: Record<"full" | "truncated" | "icons", readonly number[]>; active: number; activeIcon: number; more: number };
export type TabPlan = { stage: TabStripStage; shown: number[]; activeIconOnly: boolean };
export function planTabs(input: TabPlanInput): TabPlan {
  const all = input.sizes.full.map((_, index) => index), sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
  for (const stage of ["full", "truncated", "icons"] as const) if (sum(input.sizes[stage]) <= input.available) return { stage, shown: all, activeIconOnly: false };
  const icons = input.sizes.icons, active = Math.max(0, Math.min(input.active, icons.length - 1));
  // Every tab an icon, the active one too.
  const others = sum(icons) - (icons[active] ?? 0);
  if (others + input.activeIcon <= input.available) return { stage: "icons", shown: all, activeIconOnly: true };
  // Overflow: the active tab first, then the others in order while they fit beside the "more" button.
  let used = input.more + input.activeIcon;
  const shown = new Set([active]);
  for (const index of all) {
    if (index === active) continue;
    if (used + icons[index]! > input.available) break;
    used += icons[index]!; shown.add(index);
  }
  return { stage: "overflow", shown: all.filter(index => shown.has(index)), activeIconOnly: true };
}

type TabEntry = { item: TabItem; tab: HTMLButtonElement; label: HTMLElement; close: HTMLElement };

export class TabStrip {
  readonly element: HTMLElement;
  readonly tablist: HTMLElement;
  private readonly more: HTMLButtonElement;
  private entries: TabEntry[] = [];
  private active = "";
  private hidden: string[] = [];
  private current: TabStripStage = "full";
  private natural = 0;
  constructor(private readonly options: TabStripOptions) {
    const vertical = options.orientation === "vertical";
    this.tablist = h("div", { class: "dock-tabs", role: "tablist", "aria-label": options.label, "aria-orientation": vertical ? "vertical" : undefined });
    this.more = h("button", { class: "icon-btn tab-strip-more", type: "button", "aria-haspopup": "menu", hidden: true },
      icon(vertical ? "chevronDown" : "chevronRight"));
    this.more.addEventListener("click", () => this.openOverflow());
    this.element = h("div", { class: "tab-strip", "data-stage": "full", "data-orientation": vertical ? "vertical" : "horizontal" }, this.tablist, this.more);
  }
  get stage(): TabStripStage { return this.current; }
  /**
   * The strip's length with every label whole (the full stage), measured by the last `fit`. It doesn't depend on the stage the strip
   * is at, so an owner can size a strip by it without the size following the condensing (UI-120).
   */
  get fullLength(): number { return this.natural; }
  /** The tabs that live in the overflow menu at the current stage. */
  get overflowed(): readonly string[] { return this.hidden; }
  tab(id: string): HTMLButtonElement | undefined { return this.entries.find(entry => entry.item.id === id)?.tab; }
  get tabs(): HTMLButtonElement[] { return this.entries.map(entry => entry.tab); }

  /** Show `items` with `active` selected (entries are reused by ID, so focus and listeners survive). */
  update(items: readonly TabItem[], active: string) {
    this.active = active;
    const byId = new Map(this.entries.map(entry => [entry.item.id, entry]));
    this.entries = items.map(item => {
      const entry = byId.get(item.id) ?? this.create(item);
      entry.item = item;
      const selected = item.id === active;
      setAttr(entry.tab, "aria-selected", String(selected));
      entry.tab.tabIndex = selected ? 0 : -1;
      this.describe(entry);
      entry.close.hidden = !item.closable;
      return entry;
    });
    this.tablist.replaceChildren(...this.entries.map(entry => entry.tab));
    this.show(this.entries.map((_, index) => index), false);
  }
  /** Change one tab's label and tooltip in place (nothing is laid out again). */
  retitle(id: string, label: string, tooltip?: string) {
    const entry = this.entries.find(item => item.item.id === id);
    if (!entry) return;
    entry.item = { ...entry.item, label, tooltip };
    this.describe(entry);
  }
  private describe(entry: TabEntry) {
    setText(entry.label, entry.item.label);
    setAttr(entry.tab, "aria-label", entry.item.label);
    entry.tab.title = entry.item.tooltip ?? entry.item.label;
    entry.close.title = `Close ${entry.item.label}`;
  }
  private create(item: TabItem): TabEntry {
    const id = item.id, prefix = this.options.idPrefix;
    const label = h("span", { class: "dock-tab-label" });
    const close = h("span", { class: "dock-tab-close", "aria-hidden": "true" }, icon("close"));
    const tab = h("button", { class: "dock-tab", type: "button", role: "tab", id: prefix ? `${prefix}${id}` : undefined,
      "aria-controls": this.options.controls, ...this.options.tabData?.(item) }, icon(item.icon), label, close);
    close.addEventListener("pointerdown", event => event.stopPropagation());
    close.addEventListener("click", event => { event.stopPropagation(); this.options.onClose?.(id); });
    tab.addEventListener("click", () => this.options.onSelect(id));
    tab.addEventListener("keydown", event => this.options.onKeyDown?.(event, id, tab));
    tab.addEventListener("contextmenu", event => this.options.onContextMenu?.(event, id, tab));
    tab.addEventListener("pointerdown", event => this.options.onPointerDown?.(event, id, tab));
    tab.addEventListener("auxclick", event => this.options.onAuxClick?.(event, id));
    return { item, tab, label, close };
  }
  private setStage(stage: TabStripStage, activeIconOnly = false) {
    this.current = stage;
    setAttr(this.element, "data-stage", stage);
    this.element.classList.toggle("active-icon", activeIconOnly);
  }
  /** Show the tabs at `indices` (the rest move to the overflow menu). */
  private show(indices: readonly number[], overflow: boolean) {
    const keep = new Set(indices);
    this.hidden = [];
    this.entries.forEach((entry, index) => {
      const shown = keep.has(index);
      if (entry.tab.hidden === shown) entry.tab.hidden = !shown;
      if (!shown) this.hidden.push(entry.item.id);
    });
    this.more.hidden = !overflow || !this.hidden.length;
    const count = this.hidden.length, label = `${count} more tab${count === 1 ? "" : "s"}: ${this.hidden.map(id => this.entries.find(e => e.item.id === id)!.item.label).join(", ")}`;
    setAttr(this.more, "aria-label", count ? label : "More tabs");
    this.more.title = count ? label : "More tabs";
  }
  /**
   * Pick the stage that fits `available` (the strip's length along its header: width, or height when vertical). Measures each tab at
   * each stage it tries, so an owner calls it only after layout and on resizes, never per paint.
   */
  fit(available: number) {
    const vertical = this.options.orientation === "vertical";
    const size = (element: HTMLElement) => { const box = element.getBoundingClientRect(); return vertical ? box.height : box.width; };
    this.show(this.entries.map((_, index) => index), false);
    const sizes = {} as Record<"full" | "truncated" | "icons", number[]>;
    for (const stage of ["full", "truncated", "icons"] as const) {
      this.setStage(stage);
      sizes[stage] = this.entries.map(entry => size(entry.tab));
      if (stage === "full") this.natural = sizes.full.reduce((sum, value) => sum + value, 0);
      // Stop measuring once a stage fits: the common case costs one layout.
      if (sizes[stage].reduce((sum, value) => sum + value, 0) <= available) return;
    }
    const active = Math.max(0, this.entries.findIndex(entry => entry.item.id === this.active));
    this.setStage("icons", true);
    const activeIcon = this.entries[active] ? size(this.entries[active]!.tab) : 0;
    this.more.hidden = false;
    const more = size(this.more) || 24;
    const plan = planTabs({ available, sizes, active, activeIcon, more });
    this.setStage(plan.stage, plan.activeIconOnly);
    this.show(plan.shown, plan.stage === "overflow");
  }
  private openOverflow() {
    const items = this.hidden.map(id => this.entries.find(entry => entry.item.id === id)!.item);
    openMenu(items.map(item => ({ kind: "action" as const, label: item.label, icon: item.icon, run: () => this.options.onSelect(item.id) })),
      this.more, { label: "More tabs", invoker: this.more });
  }
}
