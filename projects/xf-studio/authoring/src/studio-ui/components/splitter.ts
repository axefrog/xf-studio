import { h, setAttr } from "../dom";

/**
 * Splitter (style guide "Split view"): the focusable bar between two resizable sides (a split view's gutter, the dock's splitters).
 * It is a `separator` with an orientation, a name ("Resize …"), its first side's share as `aria-valuenow` (0–100) and one tab stop.
 * The arrow keys across the bar step the share (Shift for a bigger step), Home and End jump to the limits where the owner has them,
 * and Enter or a double-click shares the space evenly. It emits intents; the owner resizes, and its pointer handling (which knows the
 * layout) gets each press through `onPointerDown`.
 */
export type SplitterOptions = {
  /** How the two sides sit: `row` side by side (a vertical bar, Left and Right step), `column` one above the other (Up and Down). */
  axis: "row" | "column";
  /** The accessible name, e.g. "Resize columns". */
  label: string;
  title?: string;
  className?: string;
  /** Step the first side's share: `direction` 1 grows it, -1 shrinks it; `big` while Shift is held. */
  onStep(direction: 1 | -1, big: boolean): void;
  /** Share the space evenly (Enter or a double-click). */
  onEqualize(): void;
  /** Home and End: the first side at its smallest or largest. Without it, Home and End do nothing here. */
  onLimit?(end: "start" | "end"): void;
  onPointerDown?(event: PointerEvent): void;
};
export class Splitter {
  readonly element: HTMLElement;
  constructor(options: SplitterOptions) {
    this.element = h("div", { class: options.className, role: "separator", tabindex: "0", "aria-orientation": options.axis === "row" ? "vertical" : "horizontal",
      "aria-label": options.label, "aria-valuemin": "0", "aria-valuemax": "100", title: options.title });
    const [back, forward] = options.axis === "row" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    this.element.addEventListener("keydown", event => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === back || event.key === forward) options.onStep(event.key === forward ? 1 : -1, event.shiftKey);
      else if (event.key === "Enter") options.onEqualize();
      else if ((event.key === "Home" || event.key === "End") && options.onLimit) options.onLimit(event.key === "Home" ? "start" : "end");
      else return;
      event.preventDefault();
    });
    this.element.addEventListener("dblclick", () => options.onEqualize());
    if (options.onPointerDown) this.element.addEventListener("pointerdown", event => options.onPointerDown!(event));
  }
  /** Show the first side's share, 0–1. */
  setValue(share: number) { setAttr(this.element, "aria-valuenow", String(Math.round(share * 100))); }
}
