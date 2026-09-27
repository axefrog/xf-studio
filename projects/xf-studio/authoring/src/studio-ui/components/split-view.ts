import { clamp, h, setAttr } from "../dom";

/**
 * Split view (style guide "Split view"): a master/detail pair side by side inside a panel, e.g. a tree and its inspector, with a
 * gutter between them that keeps them apart and resizes them. Drag the gutter, or focus it and use the arrow keys (Home and End for
 * the limits); a double-click or Enter shares the width evenly again. Each side keeps at least `min` pixels. The share is kept for
 * the session under `key` (never saved with a recipe or layout). When the view is narrower than 560 px the sides stack, master above
 * detail, a loose gap apart, and the gutter steps aside (a container query, so it follows the panel's width, not the window's).
 */
const shares = new Map<string, number>();
export type SplitViewOptions = {
  /** What the gutter resizes, for its accessible name ("Resize <label>"). */
  label: string;
  start: HTMLElement; end: HTMLElement;
  /** The master's share of the width, 0–1 (default 0.45). */
  initial?: number;
  /** Each side's minimum width in pixels (default 200). */
  min?: number;
  /** Session memory for the share. */
  key?: string;
  className?: string;
};
export class SplitView {
  readonly element: HTMLElement;
  readonly gutter: HTMLElement;
  private share: number;
  constructor(private readonly options: SplitViewOptions) {
    this.share = options.key ? shares.get(options.key) ?? options.initial ?? .45 : options.initial ?? .45;
    this.gutter = h("div", { class: "split-gutter", role: "separator", tabindex: 0, "aria-orientation": "vertical", "aria-label": `Resize ${options.label}`,
      "aria-valuemin": "0", "aria-valuemax": "100", title: "Drag to resize · Arrow keys adjust · Double-click to share evenly" });
    this.element = h("div", { class: `split-view${options.className ? ` ${options.className}` : ""}` }, h("div", { class: "split-grid" },
      h("div", { class: "split-pane split-start" }, options.start), this.gutter, h("div", { class: "split-pane split-end" }, options.end)));
    this.apply(this.share);
    this.gutter.addEventListener("keydown", event => {
      const step = event.shiftKey ? .1 : .03;
      const next = event.key === "ArrowLeft" ? this.share - step : event.key === "ArrowRight" ? this.share + step : event.key === "Home" ? 0 : event.key === "End" ? 1
        : event.key === "Enter" ? .5 : undefined;
      if (next === undefined) return;
      event.preventDefault();
      this.set(next);
    });
    this.gutter.addEventListener("dblclick", () => this.set(.5));
    this.gutter.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.gutter.setPointerCapture?.(event.pointerId);
      this.gutter.classList.add("active");
      const move = (e: PointerEvent) => {
        const box = this.element.getBoundingClientRect();
        if (box.width > 0) this.set((e.clientX - box.left) / box.width);
      };
      const up = () => { this.gutter.classList.remove("active"); this.gutter.removeEventListener("pointermove", move);
        this.gutter.removeEventListener("pointerup", up); this.gutter.removeEventListener("pointercancel", up); };
      this.gutter.addEventListener("pointermove", move); this.gutter.addEventListener("pointerup", up); this.gutter.addEventListener("pointercancel", up);
    });
  }
  /** The master's current share of the width. */
  get value() { return this.share; }
  /** Set the master's share, kept inside both sides' minimums (and remembered for the session). */
  set(value: number) {
    const width = this.element.getBoundingClientRect().width, min = this.options.min ?? 200;
    const low = width > 0 ? Math.min(.5, min / width) : .1;
    this.apply(clamp(value, low, 1 - low));
    if (this.options.key) shares.set(this.options.key, this.share);
  }
  private apply(value: number) {
    this.share = value;
    this.element.style.setProperty("--split", String(Math.round(value * 1000) / 1000));
    setAttr(this.gutter, "aria-valuenow", String(Math.round(value * 100)));
  }
}
