import { h } from "../dom";
import type { HelpText } from "../help-tip";
import { SliderWithValue, type SliderWithValueOptions } from "./slider-with-value";

/**
 * Pair control (style guide "Pair control"): a left/right pair of values (a brow's two sides, two eyelids), edited together or apart.
 * Whether a pair is linked is its owner's state, set where the person decides it: a group heading's mirror toggle or a whole-panel
 * switch, never a toggle on every pair.
 *
 * - **Linked:** one Slider with value under the pair's name, whose edits set both sides (its accessible name says "both sides").
 * - **Uneven:** linked while the sides differ (set separately, or read that way). The one readout says both values, muted
 *   ("14 / 10 %"), the slider sits at the left side's value, and the next edit sets both sides to the new value.
 * - **Separate:** the pair's name, then one compact line per side (short side label, slider, readout, reset), named "<label>, left"
 *   and "<label>, right".
 * - Only one layout shows at a time; both are built once, so switching never rebuilds what someone may be focusing.
 */
export type Side = "left" | "right";
export type PairEdit = { sides: "both" | Side; value: number };
export type PairControlOptions = Omit<SliderWithValueOptions, "transaction" | "label" | "id" | "reserveNote" | "help" | "inline" | "accessibleLabel"> & {
  label: string; help?: HelpText;
  /** The sides' short visible labels (default "L", "R") and their names (default "left", "right"). */
  sideLabels?: Record<Side, string>;
  sideNames?: Record<Side, string>;
  transaction: { begin?(sides: PairEdit["sides"]): void; edit(edit: PairEdit): void; commit?(): void; cancel?(): void };
};

export class PairControl {
  readonly element: HTMLElement;
  private readonly both: SliderWithValue;
  private readonly rows: Record<Side, SliderWithValue>;
  private readonly separate: HTMLElement;
  constructor(private readonly options: PairControlOptions) {
    const labels = options.sideLabels ?? { left: "L", right: "R" }, names = options.sideNames ?? { left: "left", right: "right" };
    const tx = (sides: PairEdit["sides"]) => ({ begin: () => options.transaction.begin?.(sides), edit: (value: number) => options.transaction.edit({ sides, value }),
      commit: () => options.transaction.commit?.(), cancel: () => options.transaction.cancel?.() });
    const { sideLabels: _l, sideNames: _n, ...slider } = options;
    this.both = new SliderWithValue({ ...slider, label: options.label, accessibleLabel: `${options.label}, both sides`, transaction: tx("both") });
    const side = (s: Side) => new SliderWithValue({ ...slider, help: undefined, label: labels[s], accessibleLabel: `${options.label}, ${names[s]}`, inline: true, transaction: tx(s) });
    this.rows = { left: side("left"), right: side("right") };
    this.separate = h("div", { class: "pair-sides", role: "group", "aria-label": options.label },
      h("p", { class: "pair-label", text: options.label }), this.rows.left.element, this.rows.right.element);
    this.element = h("div", { class: "pair-control" }, this.both.element, this.separate);
  }
  update(values: Record<Side, number | undefined>, state: { linked: boolean; disabled?: boolean; reason?: string } = { linked: true }) {
    this.both.element.hidden = !state.linked;
    this.separate.hidden = state.linked;
    const { left, right } = values, format = this.options.format;
    const uneven = state.linked && left !== undefined && right !== undefined && Math.abs(left - right) > this.options.step / 2;
    this.element.classList.toggle("uneven", uneven);
    // "14 / 10 %": both numbers, the unit once (the formatted right side carries it).
    const text = uneven ? `${format(left!).replace(/[^\d.,−-]+$/, "").trim()} / ${format(right!)}` : undefined;
    this.both.update(left, { disabled: state.disabled, reason: state.reason, ...(text ? { text } : {}) });
    this.rows.left.update(left, { disabled: state.disabled, reason: state.reason });
    this.rows.right.update(right, { disabled: state.disabled, reason: state.reason });
  }
}
