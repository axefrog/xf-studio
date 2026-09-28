import { h, setAttr } from "../dom";
import { viewState } from "../view-state";

/**
 * Size bar (style guide "Size bar"): a bar under a list, tree or scroll region that the person drags to make it taller or shorter. The
 * DirectionDial's resize bar is the same pattern for a drawing.
 *
 * - **Drag** the bar down to enlarge, up to shrink. The region's top edge stays where it is and only what is under it moves; while the
 *   bar is held, a shrinking region leaves its lost height as a reserve under the bar, so a panel scrolled to its end never clamps and
 *   pulls what is above down. Escape during a drag goes back to where it started. A lost pointer capture or a second press ends the drag
 *   where it is.
 * - **Bounds:** never under `minHeight`; never over what the region holds (`maxHeight`, a tree's full height) nor, while resizing, the
 *   panel's visible height less the bar (`panelLimit`).
 * - **Double-click** (or Delete on the focused bar) goes back to the default height and forgets the chosen one.
 * - **Keyboard:** one tab stop, `role=separator` named "Resize <label>", with the height as its value. Down and Up enlarge and shrink by
 *   `step` (a row, 28 px, by default); Home and End go to the smallest and the largest.
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
  /** Lay out the region at the bar's new `height` (default: set `target`'s height). */
  apply?(): void;
  /** The chosen height changed (`undefined`: back to the default); `final` when a gesture ends. */
  onResize?(height: number | undefined, final: boolean): void;
};

export const SIZE_BAR_STEP = 28;
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

const value = (v: number | (() => number)) => typeof v === "function" ? v() : v;

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
      title: "Drag to resize · double-click for the default size" });
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
  /** The most the region holds (without the panel's limit). */
  get maxHeight() { return this.options.maxHeight?.() ?? Number.POSITIVE_INFINITY; }
  /** The height to show now: the chosen one or the default, within the minimum and what the region holds. */
  get height() { return clampHeight(this.chosenHeight ?? this.defaultHeight, this.minHeight, this.maxHeight); }
  /** The largest a resize may make it: what the region holds, within the panel's visible height less the bar. */
  private get limit() {
    return Math.max(this.minHeight, Math.min(this.maxHeight, panelLimit(this.element, (this.element.offsetHeight || 12) + PANEL_RESERVE)));
  }
  /** Lay the region out at `height` and say it on the bar (the owner calls this after its content changes, when it passes `apply`). */
  refresh() {
    const shown = this.height, max = this.limit;
    setAttr(this.element, "aria-valuemin", String(this.minHeight));
    setAttr(this.element, "aria-valuemax", String(Number.isFinite(max) ? Math.max(shown, Math.round(max)) : shown));
    setAttr(this.element, "aria-valuenow", String(shown));
    setAttr(this.element, "aria-valuetext", `${shown} pixels tall${this.chosenHeight === undefined ? ", default" : ""}`);
  }
  private apply() {
    if (this.options.apply) this.options.apply();
    else this.options.target.style.height = `${this.height}px`;
    this.refresh();
  }
  /** Resize to a height, within the bounds (`final`: the gesture ended, so it is remembered). */
  resizeTo(height: number, final: boolean) {
    this.chosenHeight = clampHeight(height, this.minHeight, this.limit);
    this.apply();
    if (final && this.options.key) viewState().setSize(this.options.key, this.chosenHeight);
    this.options.onResize?.(this.chosenHeight, final);
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
    const pointer = event.pointerId, from = event.clientY, start = this.height, before = this.chosenHeight;
    try { this.element.setPointerCapture(pointer); } catch { /* Ends on release, a lost capture or a new press. */ }
    this.element.classList.add("dragging");
    const reserve = () => { this.element.style.marginBottom = `${Math.max(0, start - this.height)}px`; };
    const move = (e: PointerEvent) => { if (e.pointerId !== pointer) return; this.resizeTo(start + (e.clientY - from), false); reserve(); };
    const finish = (commit: boolean) => {
      if (this.dragging !== finish) return;
      this.dragging = null;
      this.element.removeEventListener("pointermove", move); this.element.removeEventListener("pointerup", up);
      this.element.removeEventListener("pointercancel", cancel); this.element.removeEventListener("lostpointercapture", up);
      document.removeEventListener("keydown", escape, true);
      this.element.classList.remove("dragging");
      this.element.style.marginBottom = "";
      if (!commit) {
        this.chosenHeight = before;
        this.apply();
        this.options.onResize?.(before, true);
      } else if (this.height !== start) this.resizeTo(this.height, true);
      // A press and release that moved nothing chooses nothing (a double-click's first click leaves the default alone).
      else if (before === undefined && this.chosenHeight !== undefined) { this.chosenHeight = undefined; this.apply(); }
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
