import { h, setAttr, setText } from "../dom";
import { icon } from "../icons";
import type { HelpText } from "../help-tip";
import { SliderWithValue, type SliderWithValueOptions } from "./slider-with-value";

/**
 * Pair control (style guide "Pair control"): a left/right pair of values (a brow's two sides, two eyelids) with a link toggle.
 *
 * - **Linked:** one row, "<label>, both sides", whose edits set both sides.
 * - **Separate:** two rows, "<label>, left" and "<label>, right", each editing its own side.
 * - **Uneven:** linked while the sides differ (they were set separately, or came from a save that way). The linked row shows the left
 *   side's value with a small "Sides differ" note, and its next edit sets both sides to the new value.
 * - **The link toggle** is a small button with `aria-pressed` that reads "Linked" or "Separate" and has a tooltip saying what a press
 *   does. Every row is a SliderWithValue, so each has the exact-entry box, reset and the same transaction rules; the note line is
 *   reserved, so switching states never moves what follows.
 */
export type Side = "left" | "right";
export type PairEdit = { sides: "both" | Side; value: number };
export type PairControlOptions = Omit<SliderWithValueOptions, "transaction" | "label" | "id" | "reserveNote" | "help"> & {
  label: string; help?: HelpText;
  /** Side names (default "left", "right"): what the separate rows are called. */
  sideLabels?: Record<Side, string>;
  transaction: { begin?(sides: PairEdit["sides"]): void; edit(edit: PairEdit): void; commit?(): void; cancel?(): void };
  onLinkChange(linked: boolean): void;
};

export class PairControl {
  readonly element: HTMLElement;
  readonly link: HTMLButtonElement;
  private readonly both: SliderWithValue;
  private readonly rows: Record<Side, SliderWithValue>;
  private readonly bothRow: HTMLElement;
  private readonly sideRows: HTMLElement;
  private readonly linkText = h("span");
  private linked = true;
  constructor(private readonly options: PairControlOptions) {
    const names = options.sideLabels ?? { left: "left", right: "right" };
    const row = (sides: PairEdit["sides"], label: string) => new SliderWithValue({ ...options, label, reserveNote: true, help: sides === "both" ? options.help : undefined,
      transaction: { begin: () => options.transaction.begin?.(sides), edit: value => options.transaction.edit({ sides, value }),
        commit: () => options.transaction.commit?.(), cancel: () => options.transaction.cancel?.() } });
    this.both = row("both", `${options.label}, both sides`);
    this.rows = { left: row("left", `${options.label}, ${names.left}`), right: row("right", `${options.label}, ${names.right}`) };
    this.link = h("button", { class: "btn ghost small pair-link", type: "button", "aria-pressed": "true" },
      icon("link"), this.linkText);
    this.link.addEventListener("click", () => { if (this.link.getAttribute("aria-disabled") !== "true") options.onLinkChange(!this.linked); });
    this.bothRow = h("div", { class: "pair-both" }, this.both.element);
    this.sideRows = h("div", { class: "pair-sides" }, this.rows.left.element, this.rows.right.element);
    this.element = h("div", { class: "pair-control", role: "group", "aria-label": options.label },
      h("div", { class: "pair-head" }, h("span", { class: "pair-label", text: options.label }), this.link), this.bothRow, this.sideRows);
  }
  update(values: Record<Side, number | undefined>, state: { linked: boolean; disabled?: boolean; reason?: string } = { linked: true }) {
    this.linked = state.linked;
    setAttr(this.link, "aria-pressed", String(state.linked));
    setText(this.linkText, state.linked ? "Linked" : "Separate");
    this.link.title = state.linked ? "Linked: one value sets both sides. Press to set each side separately."
      : "Separate: each side has its own value. Press to link them (the next edit sets both).";
    this.link.disabled = !!state.disabled;
    this.bothRow.hidden = !state.linked;
    this.sideRows.hidden = state.linked;
    const uneven = state.linked && values.left !== undefined && values.right !== undefined && Math.abs(values.left - values.right) > this.options.step / 2;
    this.element.classList.toggle("uneven", uneven);
    this.both.update(values.left, { disabled: state.disabled, reason: state.reason, note: uneven ? "Sides differ: the next change sets both." : undefined });
    this.rows.left.update(values.left, { disabled: state.disabled, reason: state.reason });
    this.rows.right.update(values.right, { disabled: state.disabled, reason: state.reason });
  }
}
