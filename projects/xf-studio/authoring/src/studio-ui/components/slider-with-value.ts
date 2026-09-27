import { clamp, h, setAttr, setDisabled, setUnavailable, setValue, uid } from "../dom";
import { bindRangeTransaction, fillRange, NoteLine, type Transaction } from "../controls";
import { helpTip, type HelpText } from "../help-tip";
import { iconButton } from "./icon-button";

/**
 * Slider with value (style guide "Slider with value"): a slider and an exact-entry number box on one line, with an optional reset.
 *
 * - **One transaction.** The slider speaks the Slider's begin/edit/commit/cancel transaction (one Undo step per drag; Escape during a
 *   drag restores the starting value). The number box commits on change or Enter as one step, clamped to the range and snapped to
 *   the step; Escape in it restores the current value. It follows a drag live.
 * - **Reset** (`defaultValue` with `reset`): an icon button, "Reset <label>", that sets the default as one step; unavailable (with its
 *   reason) when the value is already the default.
 * - **States:** default; *set* (not at the default: the label is emphasised); disabled with its reason on the note line, which keeps
 *   its height so nothing moves (`reserveNote`).
 * - **Access:** the range is labelled by the visible label; the number box is named "<label>, exact value"; the range's value text is
 *   the formatted value.
 */
export type SliderWithValueOptions = {
  label: string; min: number; max: number; step: number;
  /** The slider's value text and tooltip (e.g. "40 %"); the number box shows the raw number in `unit` terms. */
  format(value: number): string;
  transaction: Transaction<number>;
  help?: HelpText;
  /** The value "reset" returns to; with it the control shows its set state. */
  defaultValue?: number;
  /** Show the reset button (needs `defaultValue`). */
  reset?: boolean;
  /** Keep the note line from the start (a reason or note that comes and goes). */
  reserveNote?: boolean;
  /** A short unit after the number box ("%", "°"). */
  unit?: string;
  id?: string;
};
const decimals = (step: number) => { const text = String(step); return text.includes(".") ? text.length - text.indexOf(".") - 1 : 0; };

export class SliderWithValue {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  readonly number: HTMLInputElement;
  readonly resetButton?: HTMLButtonElement;
  private readonly note: NoteLine;
  private readonly edit: { active(): boolean };
  private value: number | undefined;
  private min: number;
  private max: number;
  constructor(private readonly options: SliderWithValueOptions) {
    const id = options.id ?? uid("slider");
    this.min = options.min; this.max = options.max;
    this.input = h("input", { id, class: "slider", type: "range", min: String(options.min), max: String(options.max), step: String(options.step) });
    this.number = h("input", { class: "field mono slider-number", type: "number", min: String(options.min), max: String(options.max), step: String(options.step),
      inputmode: "decimal", "aria-label": `${options.label}, exact value` });
    this.note = new NoteLine(options.reserveNote);
    this.resetButton = options.reset && options.defaultValue !== undefined
      ? iconButton({ label: `Reset ${options.label}`, icon: "reset", small: true, className: "slider-reset", onClick: () => this.commitValue(options.defaultValue!) }) : undefined;
    this.element = h("div", { class: "control slider-with-value" },
      h("div", { class: "control-line" }, h("label", { class: "control-label-text", for: id }, h("span", { text: options.label })),
        options.help !== undefined ? helpTip(options.label, options.help) : null),
      h("div", { class: "slider-value-row" }, this.input,
        h("span", { class: "slider-number-wrap" }, this.number, options.unit ? h("span", { class: "slider-unit", "aria-hidden": "true", text: options.unit }) : null),
        this.resetButton),
      this.note.element);
    this.edit = bindRangeTransaction(this.input, options.transaction, value => this.show(value));
    this.number.addEventListener("change", () => this.fromNumber());
    this.number.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); this.fromNumber(); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.number.value = this.text(this.value); this.number.removeAttribute("aria-invalid"); }
    });
  }
  private text(value: number | undefined) { return value === undefined ? "" : Number(value.toFixed(decimals(this.options.step))).toString(); }
  /** Paint a value on the slider, its value text and the number box (unless the person is typing in it). */
  private show(value: number) {
    fillRange(this.input);
    setAttr(this.input, "aria-valuetext", this.options.format(value));
    this.input.title = this.options.format(value);
    setValue(this.number, this.text(value));
  }
  private snap(value: number) {
    const step = this.options.step, snapped = Math.round((value - this.min) / step) * step + this.min;
    return Number(clamp(snapped, this.min, this.max).toFixed(decimals(step)));
  }
  private fromNumber() {
    const raw = this.number.value.trim();
    const parsed = raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(parsed)) { this.number.value = this.text(this.value); return; }
    const value = this.snap(parsed);
    this.number.value = this.text(value);
    if (value !== this.value) this.commitValue(value);
  }
  /** One Undo step: begin, edit, commit. */
  private commitValue(value: number) {
    const t = this.options.transaction;
    t.begin?.(); t.edit(value); t.commit?.();
  }
  update(value: number | undefined, state: { disabled?: boolean; reason?: string; note?: string; min?: number; max?: number } = {}) {
    if (state.min !== undefined) { this.min = state.min; setAttr(this.input, "min", String(state.min)); setAttr(this.number, "min", String(state.min)); }
    if (state.max !== undefined) { this.max = state.max; setAttr(this.input, "max", String(state.max)); setAttr(this.number, "max", String(state.max)); }
    this.value = value;
    const active = this.edit.active();
    if (!active && value !== undefined) setValue(this.input, String(value));
    this.show(active ? Number(this.input.value) : value ?? Number(this.input.value));
    if (value === undefined) setValue(this.number, "");
    const disabled = !!state.disabled;
    setDisabled(this.input, disabled, state.reason);
    setDisabled(this.number, disabled, state.reason);
    const def = this.options.defaultValue;
    const set = def !== undefined && value !== undefined && Math.abs(value - def) > this.options.step / 2;
    this.element.classList.toggle("set", set);
    if (this.resetButton) setUnavailable(this.resetButton, disabled || !set, disabled ? state.reason : `${this.options.label} is at its default.`);
    this.note.update(this.input, disabled, state.reason, state.note);
  }
}
