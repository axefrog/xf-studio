import { clamp, h, setAttr, setDisabled, setValue, uid } from "../dom";
import { bindRangeTransaction, fillRange, NoteLine, type Transaction } from "../controls";
import { helpTip, type HelpText } from "../help-tip";
import { iconButton } from "./icon-button";
import { ReadoutField } from "./readout-field";

/**
 * Slider with value (style guide "Slider with value"): a slider whose one readout is also where its exact value is typed, with an
 * optional reset. One readout per value (visual QA checklist C1): there is no second number box.
 *
 * - **Layouts.** Stacked (the default): the label, readout and reset on a line, the range under them, like every slider in the Studio.
 *   Inline (`inline`): one line of short label, range, readout and reset, for the sides of a pair ("L", "R").
 * - **One transaction.** The range speaks the Slider's begin/edit/commit/cancel transaction (one Undo step per drag; Escape during a
 *   drag restores the starting value). Enter on the range, or a click on the readout, types a value in the readout's place; Enter or
 *   leaving commits it clamped and snapped as one step, Escape changes nothing. Delete or Backspace on the range returns to the default.
 * - **Reset** (`defaultValue` with `reset`): an icon button, "Reset <label>", that sets the default as one step. It shows only while the
 *   value is away from its default; otherwise it keeps its place unseen (no column of faded icons down a list).
 * - **States:** default; *set* (away from the default: the label is emphasised with a signal mark); dragging; typing; a readout the
 *   owner words itself (`update(value, { text })`, e.g. "14 / 10 %" for a pair whose sides differ, shown muted); disabled (its reason
 *   on the note line when `reserveNote`, else in the tooltip and description: a list of them says it once).
 * - **Access:** the range is labelled by the visible label, or by `accessibleLabel` when the visible one is short ("L" is "Brow height,
 *   left"); its value text is the formatted value; the typed field is named "<label>, exact value"; the reset is "Reset <label>".
 */
export type SliderWithValueOptions = {
  label: string; min: number; max: number; step: number;
  /** The readout and the slider's value text (e.g. "40 %"). */
  format(value: number): string;
  transaction: Transaction<number>;
  help?: HelpText;
  /** The value "reset" returns to; with it the control shows its set state. */
  defaultValue?: number;
  /** Show the reset while the value is away from its default (needs `defaultValue`). */
  reset?: boolean;
  /** Keep a note line from the start (a reason or note that comes and goes). Off by default: a list says a shared reason once. */
  reserveNote?: boolean;
  /** A short unit, used when a typed value carries it ("%", "°"); the readout's words come from `format`. */
  unit?: string;
  /** One line: short label, range, readout, reset (a pair's sides). */
  inline?: boolean;
  /** The range's accessible name when the visible label is short. */
  accessibleLabel?: string;
  /** Words small under the track's ends, for a scale between two named looks ("Crisp", "Game-like"); stacked layout only. */
  ends?: { min: string; max: string };
  id?: string;
};
const decimals = (step: number) => { const text = String(step); return text.includes(".") ? text.length - text.indexOf(".") - 1 : 0; };

export class SliderWithValue {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  readonly readout: ReadoutField;
  readonly resetButton?: HTMLButtonElement;
  private readonly note: NoteLine;
  private readonly edit: { active(): boolean };
  private value: number | undefined;
  private min: number;
  private max: number;
  private disabled = false;
  private text: string | undefined;
  constructor(private readonly options: SliderWithValueOptions) {
    const id = options.id ?? uid("slider");
    this.min = options.min; this.max = options.max;
    const name = options.accessibleLabel ?? options.label;
    this.input = h("input", { id, class: "slider", type: "range", min: String(options.min), max: String(options.max), step: String(options.step),
      "aria-label": options.accessibleLabel, "aria-keyshortcuts": "Enter Delete" });
    this.note = new NoteLine(options.reserveNote);
    this.readout = new ReadoutField({ label: name, parse: text => this.parse(text), onCommit: value => this.commitValue(this.snap(value)), returnFocus: () => this.input });
    this.resetButton = options.reset && options.defaultValue !== undefined
      ? iconButton({ label: `Reset ${name}`, icon: "reset", small: true, className: "slider-reset", onClick: () => { this.commitValue(options.defaultValue!); this.input.focus(); } })
      : undefined;
    const label = h("label", { class: "control-label-text", for: id }, h("span", { text: options.label }));
    const tip = options.help !== undefined ? helpTip(name, options.help) : null;
    this.element = options.inline
      ? h("div", { class: "control slider-with-value inline" }, h("div", { class: "slider-inline-row" }, label, this.input, this.readout.element, this.resetButton), this.note.element)
      : h("div", { class: "control slider-with-value" },
        h("div", { class: "slider-value-line" }, label, tip, h("span", { class: "grow" }), this.readout.element, this.resetButton), this.input,
        options.ends ? h("div", { class: "slider-ends", "aria-hidden": "true" }, h("span", { text: options.ends.min }), h("span", { text: options.ends.max })) : null,
        this.note.element);
    this.edit = bindRangeTransaction(this.input, options.transaction, value => { this.text = undefined; this.show(value); });
    this.input.addEventListener("keydown", event => {
      if (this.disabled) return;
      if (event.key === "Enter") { event.preventDefault(); this.readout.edit(); }
      else if ((event.key === "Delete" || event.key === "Backspace") && options.defaultValue !== undefined) { event.preventDefault(); this.commitValue(options.defaultValue); }
    });
  }
  private raw(value: number | undefined) { return value === undefined ? "" : Number(value.toFixed(decimals(this.options.step))).toString(); }
  private parse(text: string) {
    const match = text.replace(",", ".").replace("−", "-").match(/[-+]?\d*\.?\d+/);
    const value = match ? Number(match[0]) : NaN;
    return Number.isFinite(value) ? value : undefined;
  }
  /** Paint a value on the range, its value text and the readout. */
  private show(value: number) {
    fillRange(this.input);
    const words = this.options.format(value);
    setAttr(this.input, "aria-valuetext", this.text ? `${this.text}` : words);
    this.readout.show(this.text ?? words, this.raw(value));
    this.element.classList.toggle("owner-text", !!this.text);
  }
  private snap(value: number) {
    const step = this.options.step, snapped = Math.round((value - this.min) / step) * step + this.min;
    return Number(clamp(snapped, this.min, this.max).toFixed(decimals(step)));
  }
  /** One Undo step: begin, edit, commit. */
  private commitValue(value: number) {
    if (this.disabled || (value === this.value && !this.text)) return;
    const t = this.options.transaction;
    t.begin?.(); t.edit(value); t.commit?.();
  }
  update(value: number | undefined, state: { disabled?: boolean; reason?: string; note?: string; min?: number; max?: number;
    /** The readout's words when the owner says it better (a pair's "14 / 10 %"); cleared by the next edit. */
    text?: string } = {}) {
    if (state.min !== undefined) { this.min = state.min; setAttr(this.input, "min", String(state.min)); }
    if (state.max !== undefined) { this.max = state.max; setAttr(this.input, "max", String(state.max)); }
    this.value = value;
    this.disabled = !!state.disabled;
    const active = this.edit.active();
    if (!active) this.text = state.text;
    if (!active && value !== undefined) setValue(this.input, String(value));
    this.show(active ? Number(this.input.value) : value ?? Number(this.input.value));
    if (value === undefined) this.readout.show("—", "");
    setDisabled(this.input, this.disabled, state.reason);
    this.readout.setDisabled(this.disabled);
    const def = this.options.defaultValue;
    const set = def !== undefined && value !== undefined && (Math.abs(value - def) > this.options.step / 2 || !!this.text);
    this.element.classList.toggle("set", set);
    this.resetButton?.classList.toggle("idle", !set || this.disabled);
    this.note.update(this.input, this.disabled, state.reason, state.note);
  }
}
