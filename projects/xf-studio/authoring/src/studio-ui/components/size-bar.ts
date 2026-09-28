import { h, setAttr } from "../dom";
import { viewState } from "../view-state";

/**
 * Size bar (style guide "Size bar"): a bar under a list, tree or scroll region that the person drags to make it taller or shorter. The
 * DirectionDial's resize bar is the same pattern for a drawing.
 *
 * - **Drag** the bar down to enlarge, up to shrink. The region's top edge stays where it is and only what is under it moves; while the
 *   bar is held, a shrinking region leaves its lost height as a reserve under the bar, so a panel scrolled to its end never clamps and
 *   pulls what is above down; the reserve goes when the drag ends, so a panel at its scroll end then settles once, as the person's own
 *   resize asked (a key press there does so at once). Escape during a drag goes back to where it started. A lost pointer capture or a
 *   second press ends the drag where it is.
 * - **Bounds:** never under `minHeight`; never over, while resizing, the panel's visible height less the bar (`panelLimit`). What the
 *   region holds (`maxHeight`, a tree's rows; with `fit`, its content) caps only what is shown, never what is chosen: a grow while the
 *   content caps it changes nothing, so enlarging a list with its groups closed or a search filtering never lowers the kept height
 *   (`chooseHeight`). A shrink starts from what is shown.
 * - **Snapping:** with `snap`, a drag stops at whole steps (a tree's rows), as the keys do.
 * - **Fitting:** by default the region is the height; with `fit` it is as tall as its content up to the height (`max-height`).
 * - **Double-click** (or Delete or Backspace on the focused bar) goes back to the default height and forgets the chosen one.
 * - **Keyboard:** one tab stop, `role=separator` named "Resize <label>", with the height as its value. Down and Up enlarge and shrink by
 *   `step` (a row, 28 px, by default); Home and End go to the smallest and the largest. The value text says the height in words
 *   (`valueText`: a tree says rows, "6 rows, default").
 * - **Memory:** the chosen height is remembered under the view key `key` (view-state.ts `size`) when a gesture ends, and survives
 *   reloads; with no key it lasts as long as the bar.
 * - **Applying:** by default the bar sets `target`'s height; an owner that fits its own frame (a TreeView with `maxRows`) passes `apply`
 *   and reads `height` in its layout.
 * - **Placing:** the owner places `region` (the target with the bar right under it, no gap) where it would have placed the target.
 */
export type SizeBarOptions = {
  /** What is resized, for the bar's name ("Resize <label>"). */
  label: string;
  /** The region resized: its height is set unless `apply` is given. */
  target: HTMLElement;
  /** The view key the chosen height is remembered under; absent: not remembered. */
  key?: string;
  minHeight: number | (() => number);
  /** The height with nothing chosen (the owner's own fit, for example six rows). */
  defaultHeight: number | (() => number);
  /** The most the region holds (a tree's full height); absent: no limit but the panel's. */
  maxHeight?: () => number;
  /** The keyboard step in px (default 28, one tree row). */
  step?: number;
  /** Drags snap to whole steps above `offset` (a tree: its rows, above its frame's border). */
  snap?: { step: number; offset?: number };
  /** Fit the region to its content up to the height (`max-height`, a list that may hold few rows) instead of a fixed height. */
  fit?: boolean;
  /** The height in words for assistive technology (a list: "6 rows, default"); default "<n> pixels tall". */
  valueText?(height: number, isDefault: boolean): string;
  /** Lay out the region at the bar's new `height` (default: set `target`'s height). */
  apply?(): void;
  /** The chosen height changed (`undefined`: back to the default); `final` when a gesture ends. */
  onResize?(height: number | undefined, final: boolean): void;
};

export const SIZE_BAR_STEP = 28;
/** The bar's tooltip; the Direction dial's resize bar says the same. */
export const SIZE_BAR_TITLE = "Drag to resize · double-click to reset";
/** The panel room kept free round a region resized to the panel's limit (its padding above and below). */
const PANEL_RESERVE = 32;

/** A height within the bounds; a maximum under the minimum gives way to the minimum. */
export function clampHeight(height: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(min, max), Math.max(min, height)));
}

/** The most a region may take in its panel: the nearest scrolling ancestor's visible height, less `reserve` (the bar and padding). */
export function panelLimit(from: Element, reserve = 0): number {
  if (typeof getComputedStyle === "function") {
    for (let node = from.parentElement; node; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && node.clientHeight > 0) return node.clientHeight - reserve;
    }
  }
  const view = typeof window !== "undefined" ? window.innerHeight : 0;
  return view > 0 ? view - reserve : Number.POSITIVE_INFINITY;
}

/**
 * A list's height in rows of `row` px, to the nearest half row, for a size bar's value text ("6 rows, default", "7 and a half rows"):
 * the words a person can act on, never pixels. `border` is the frame's, outside the rows.
 */
export function rowWords(height: number, row: number, isDefault = false, border = 2): string {
  const halves = Math.max(0, Math.round((height - border) / row * 2)), whole = Math.floor(halves / 2), half = halves % 2 === 1;
  const words = half ? (whole ? `${whole} and a half rows` : "half a row") : `${whole} ${whole === 1 ? "row" : "rows"}`;
  return isDefault ? `${words}, default` : words;
}

const value = (v: number | (() => number)) => typeof v === "function" ? v() : v;

/**
 * The height a request chooses. A grow (a request at or above what is shown) never lowers the height chosen before: what the region
 * holds caps only what is shown, so enlarging a list whose groups are closed, or that a search is filtering, changes nothing. A shrink
 * starts from what is shown. Both stay within the minimum and the panel's limit.
 */
export function chooseHeight(requested: number, from: { chosen: number; shown: number }, bounds: { min: number; holds: number; panel: number }): number {
  if (requested >= from.shown) return Math.max(from.chosen, clampHeight(Math.min(requested, bounds.holds), bounds.min, bounds.panel));
  return clampHeight(requested, bounds.min, bounds.panel);
}
/** A height snapped to whole steps above `offset` (a tree's rows plus its frame's border). */
export function snapHeight(height: number, snap: { step: number; offset?: number } | undefined): number {
  if (!snap || !(snap.step > 0) || !Number.isFinite(height)) return height;
  const offset = snap.offset ?? 0;
  return offset + Math.round((height - offset) / snap.step) * snap.step;
}

export class SizeBar {
  /** The bar. */
  readonly element: HTMLElement;
  /** The target with the bar under it: what the owner places. */
  readonly region: HTMLElement;
  private chosenHeight: number | undefined;
  private dragging: ((commit: boolean) => void) | null = null;
  constructor(private readonly options: SizeBarOptions) {
    const stored = options.key ? viewState().size(options.key) : undefined;
    this.chosenHeight = stored !== undefined && Number.isFinite(stored) ? stored : undefined;
    this.element = h("div", { class: "size-bar", role: "separator", tabindex: "0", "aria-orientation": "horizontal", "aria-label": `Resize ${options.label}`,
      title: SIZE_BAR_TITLE });
    this.region = h("div", { class: "size-region" }, options.target, this.element);
    this.element.addEventListener("pointerdown", event => this.drag(event));
    this.element.addEventListener("keydown", event => this.key(event));
    this.element.addEventListener("dblclick", event => { event.preventDefault(); this.reset(); });
    this.apply();
  }
  /** The height the person chose, or undefined for the default. */
  get chosen() { return this.chosenHeight; }
  get minHeight() { return Math.max(0, value(this.options.minHeight)); }
  get defaultHeight() { return value(this.options.defaultHeight); }
  /** The most the region holds (without the panel's limit): `maxHeight`, else with `fit` its content's height. */
  get maxHeight() {
    if (this.options.maxHeight) return this.options.maxHeight();
    const target = this.options.target;
    if (this.options.fit && target.scrollHeight > 0) return target.scrollHeight + Math.max(0, (target.offsetHeight || 0) - (target.clientHeight || 0));
    return Number.POSITIVE_INFINITY;
  }
  /** The chosen height, or the default: what the region grows to when it holds enough. */
  private get wanted() { return Math.max(this.minHeight, this.chosenHeight ?? this.defaultHeight); }
  /** The height shown now: the chosen one or the default, within the minimum and what the region holds. */
  get height() { return clampHeight(this.wanted, this.minHeight, this.maxHeight); }
  /** The panel's visible height less the bar: the most a resize reaches. */
  private get panel() { return Math.max(this.minHeight, panelLimit(this.element, (this.element.offsetHeight || 12) + PANEL_RESERVE)); }
  /** Lay the region out at `height` and say it on the bar (the owner calls this after its content changes, when it passes `apply`). */
  refresh() {
    const shown = this.height, max = Math.min(this.maxHeight, this.panel);
    setAttr(this.element, "aria-valuemin", String(this.minHeight));
    setAttr(this.element, "aria-valuemax", String(Number.isFinite(max) ? Math.max(shown, Math.round(max)) : shown));
    setAttr(this.element, "aria-valuenow", String(shown));
    const isDefault = this.chosenHeight === undefined;
    setAttr(this.element, "aria-valuetext", this.options.valueText ? this.options.valueText(shown, isDefault) : `${shown} pixels tall${isDefault ? ", default" : ""}`);
  }
  private apply() {
    if (this.options.apply) this.options.apply();
    // Fitting: the region is as tall as its content up to the height, so rows that open later fill it without a new choice.
    else if (this.options.fit) this.options.target.style.maxHeight = `${this.wanted}px`;
    else this.options.target.style.height = `${this.height}px`;
    this.refresh();
  }
  /**
   * Ask for a height (`chooseHeight` from `from`, by default what is chosen and shown now); `final`: the gesture ended, so a change is
   * remembered. A grow that the region's content caps changes nothing.
   */
  resizeTo(requested: number, final: boolean, from: { chosen: number | undefined; shown: number } = { chosen: this.chosenHeight, shown: this.height }) {
    const before = from.chosen ?? Math.max(this.minHeight, this.defaultHeight);
    const next = chooseHeight(requested, { chosen: before, shown: from.shown }, { min: this.minHeight, holds: this.maxHeight, panel: this.panel });
    const chosen = from.chosen === undefined && next === before ? undefined : next;
    const changed = chosen !== this.chosenHeight;
    this.chosenHeight = chosen;
    if (changed) this.apply();
    if (final && this.options.key && chosen !== from.chosen) viewState().setSize(this.options.key, chosen);
    if (changed || final) this.options.onResize?.(chosen, final);
  }
  /** Back to the default height, forgetting the chosen one. */
  reset() {
    this.dragging?.(true);
    if (this.chosenHeight === undefined) return;
    this.chosenHeight = undefined;
    this.apply();
    if (this.options.key) viewState().setSize(this.options.key, undefined);
    this.options.onResize?.(undefined, true);
  }
  private key(event: KeyboardEvent) {
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); this.reset(); return; }
    const step = this.options.step ?? SIZE_BAR_STEP;
    const next = event.key === "ArrowDown" ? this.height + step : event.key === "ArrowUp" ? this.height - step
      : event.key === "Home" ? this.minHeight : event.key === "End" ? Number.POSITIVE_INFINITY : undefined;
    if (next === undefined) return;
    event.preventDefault();
    this.resizeTo(next, true);
  }
  private drag(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    this.dragging?.(true);
    const pointer = event.pointerId, y0 = event.clientY, from = { chosen: this.chosenHeight, shown: this.height };
    try { this.element.setPointerCapture(pointer); } catch { /* Ends on release, a lost capture or a new press. */ }
    this.element.classList.add("dragging");
    const reserve = () => { this.element.style.marginBottom = `${Math.max(0, from.shown - this.height)}px`; };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      this.resizeTo(snapHeight(from.shown + (e.clientY - y0), this.options.snap), false, from);
      reserve();
    };
    const finish = (commit: boolean) => {
      if (this.dragging !== finish) return;
      this.dragging = null;
      this.element.removeEventListener("pointermove", move); this.element.removeEventListener("pointerup", up);
      this.element.removeEventListener("pointercancel", cancel); this.element.removeEventListener("lostpointercapture", up);
      document.removeEventListener("keydown", escape, true);
      this.element.classList.remove("dragging");
      this.element.style.marginBottom = "";
      if (!commit) {
        const changed = this.chosenHeight !== from.chosen;
        this.chosenHeight = from.chosen;
        if (changed) { this.apply(); this.options.onResize?.(from.chosen, true); }
        return;
      }
      // Remembered only when the gesture chose something new (a press that moved nothing, a double-click's first click, keeps the default).
      if (this.chosenHeight === from.chosen) return;
      if (this.options.key) viewState().setSize(this.options.key, this.chosenHeight);
      this.options.onResize?.(this.chosenHeight, true);
    };
    const up = (e: PointerEvent) => { if (e.pointerId === pointer) finish(true); };
    const cancel = (e: PointerEvent) => { if (e.pointerId === pointer) finish(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } };
    this.dragging = finish;
    this.element.addEventListener("pointermove", move);
    this.element.addEventListener("pointerup", up);
    this.element.addEventListener("pointercancel", cancel);
    this.element.addEventListener("lostpointercapture", up);
    document.addEventListener("keydown", escape, true);
  }
}
