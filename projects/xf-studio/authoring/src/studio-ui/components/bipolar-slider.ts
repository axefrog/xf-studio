import { clamp, h, setAttr, setDisabled, setValue, uid } from "../dom";
import { bindRangeTransaction, NoteLine, type Transaction } from "../controls";
import { helpTip, type HelpText } from "../help-tip";
import { iconButton } from "./icon-button";
import { ReadoutField } from "./readout-field";

/**
 * Bipolar slider (style guide "Bipolar slider"): one value between two opposite directions with a resting centre, for a movement that
 * can go one way or the other but never both at once (look left or right, brow up or down, jaw left or right).
 *
 * - **Anatomy:** the label and its one readout on a line (the readout names the direction: "0", "20 % right"), a range whose fill runs
 *   from the centre mark to the thumb, and the two direction words small at the track's ends. A reset sits after the readout only while
 *   the value is away from the centre; at the centre it keeps its place unseen (no column of faded icons down a list).
 * - **Centre detent:** a pointer drag within `detent` of the centre snaps to exactly 0, so the rest position is easy to hit; keyboard
 *   steps are exact. Delete or Backspace on the slider, a double-click on it, or the reset returns to the centre as one step.
 * - **Exact entry:** Enter on the slider, or a click on the readout, types a value in the readout's place ("-20", "20 left", "+35");
 *   Enter or leaving commits it clamped and snapped as one step, Escape changes nothing.
 * - **Mixed:** `update(value, { mixed: true })` when the stored data sets both directions at once (an installed expression can). The
 *   readout says "Mixed" (its tooltip says what the next change does), the thumb sits at the net value with a dashed edge, and nothing
 *   is changed until the person moves it; the next edit replaces both with one value.
 * - **States:** at the centre; *set* (away from it, or mixed: the label is emphasised with a signal mark, like Slider with value);
 *   dragging; disabled (its reason on the note line when `reserveNote`, else in the tooltip; a list of them says it once).
 * - **Access:** a native range (arrows, Page Up/Down, Home/End) labelled by the visible label, whose value text is the readout's words
 *   ("20 % right", "Mixed: 20 % right"); the direction words are decoration; the reset is "Reset <label>".
 */
export type BipolarSliderOptions = {
  label: string;
  /** The range, with 0 as the centre: min < 0 < max (it needn't be symmetric). */
  min: number; max: number; step: number;
  /** The directions' words, shown at the track's ends and used in the readout ("Left", "Right"). */
  ends: { negative: string; positive: string };
  transaction: Transaction<number>;
  /** A short unit after the number in the readout ("%", "°"). */
  unit?: string;
  /** The readout for a value (default: "0", or "<size> <unit> <direction>"). */
  format?(value: number): string;
  /** How close to the centre a drag snaps to it (default 1.5 % of the range). */
  detent?: number;
  /** The mixed state's tooltip (default: what the next change does). */
  mixedNote?: string;
  help?: HelpText;
  /** Show the reset while the value is away from the centre (default true). */
  reset?: boolean;
  reserveNote?: boolean;
  id?: string;
};
const decimals = (step: number) => { const text = String(step); return text.includes(".") ? text.length - text.indexOf(".") - 1 : 0; };

export class BipolarSlider {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  readonly readout: ReadoutField;
  readonly resetButton?: HTMLButtonElement;
  private readonly track: HTMLElement;
  private readonly note: NoteLine;
  private readonly edit: { active(): boolean };
  private value: number | undefined;
  private mixed = false;
  private disabled = false;
  private pointer = false;
  constructor(private readonly options: BipolarSliderOptions) {
    const id = options.id ?? uid("bipolar");
    this.input = h("input", { id, class: "slider bipolar-range", type: "range", min: String(options.min), max: String(options.max), step: String(options.step),
      "aria-keyshortcuts": "Enter Delete" });
    this.track = h("span", { class: "bipolar-track" }, this.input);
    this.note = new NoteLine(options.reserveNote);
    this.readout = new ReadoutField({ label: options.label, parse: text => this.parse(text), onCommit: value => this.commitValue(this.snap(value)),
      returnFocus: () => this.input });
    this.resetButton = options.reset === false ? undefined
      : iconButton({ label: `Reset ${options.label}`, icon: "reset", small: true, className: "bipolar-reset", onClick: () => { this.commitValue(0); this.input.focus(); } });
    this.element = h("div", { class: "control bipolar-slider" },
      h("div", { class: "bipolar-line" },
        h("label", { class: "control-label-text", for: id }, h("span", { text: options.label })),
        options.help !== undefined ? helpTip(options.label, options.help) : null,
        h("span", { class: "grow" }), this.readout.element, this.resetButton),
      this.track,
      h("div", { class: "bipolar-ends", "aria-hidden": "true" }, h("span", { text: options.ends.negative }), h("span", { text: options.ends.positive })),
      this.note.element);
    // The detent runs before the transaction hears the value, so a snapped drag records 0, not the raw position.
    this.input.addEventListener("pointerdown", () => { this.pointer = true; });
    const release = () => { this.pointer = false; };
    this.input.addEventListener("pointerup", release);
    this.input.addEventListener("pointercancel", release);
    this.input.addEventListener("input", () => {
      if (this.pointer && Math.abs(Number(this.input.value)) <= this.detent()) this.input.value = "0";
    });
    this.edit = bindRangeTransaction(this.input, options.transaction, value => { this.mixed = false; this.paint(value); });
    this.input.addEventListener("keydown", event => {
      if (this.disabled) return;
      if (event.key === "Enter") { event.preventDefault(); this.readout.edit(); }
      else if ((event.key === "Delete" || event.key === "Backspace") && (this.value !== 0 || this.mixed)) { event.preventDefault(); this.commitValue(0); }
    });
    this.input.addEventListener("dblclick", () => { if (!this.disabled) this.commitValue(0); });
  }
  private detent() { return this.options.detent ?? (this.options.max - this.options.min) * .015; }
  /** The readout's words for a value. */
  text(value: number) {
    if (this.options.format) return this.options.format(value);
    const size = Number(Math.abs(value).toFixed(decimals(this.options.step)));
    if (size === 0) return "0";
    const word = (value < 0 ? this.options.ends.negative : this.options.ends.positive).toLowerCase();
    return `${size}${this.options.unit ? ` ${this.options.unit}` : ""} ${word}`;
  }
  /** Typed text as a value: a signed number, or a number with a direction word ("20 left"). */
  private parse(text: string): number | undefined {
    const match = text.replace(",", ".").match(/[-+−]?\d*\.?\d+/);
    if (!match) return undefined;
    let value = Number(match[0].replace("−", "-"));
    if (!Number.isFinite(value)) return undefined;
    const lower = text.toLowerCase();
    if (value > 0 && lower.includes(this.options.ends.negative.toLowerCase()) && !/^\s*\+/.test(text)) value = -value;
    return value;
  }
  private snap(value: number) {
    const { step, min, max } = this.options;
    return Number(clamp(Math.round(value / step) * step, min, max).toFixed(decimals(step)));
  }
  /** One Undo step: begin, edit, commit. */
  private commitValue(value: number) {
    if (this.disabled || (value === this.value && !this.mixed)) return;
    const t = this.options.transaction;
    t.begin?.(); t.edit(value); t.commit?.();
  }
  /** Where a value sits along the track, 0–1. */
  private at(value: number) { const { min, max } = this.options; return max > min ? (clamp(value, min, max) - min) / (max - min) : .5; }
  private paint(value: number) {
    const zero = this.at(0), here = this.at(value);
    this.track.style.setProperty("--zero", String(zero));
    this.track.style.setProperty("--lo", String(Math.min(zero, here)));
    this.track.style.setProperty("--hi", String(Math.max(zero, here)));
    const words = this.text(value);
    setAttr(this.input, "aria-valuetext", this.mixed ? `Mixed: ${words}` : words);
    this.readout.show(this.mixed ? "Mixed" : words, String(Number(value.toFixed(decimals(this.options.step)))),
      this.mixed ? this.options.mixedNote ?? `Both directions are set. The next change sets one value (now ${words}).` : undefined);
    const set = this.mixed || Math.abs(value) > this.options.step / 2;
    this.element.classList.toggle("set", set);
    this.element.classList.toggle("mixed", this.mixed);
    this.resetButton?.classList.toggle("idle", !set || this.disabled);
  }
  update(value: number | undefined, state: { mixed?: boolean; disabled?: boolean; reason?: string; note?: string } = {}) {
    this.value = value;
    this.disabled = !!state.disabled;
    const active = this.edit.active();
    if (!active) this.mixed = !!state.mixed && value !== undefined;
    if (!active && value !== undefined) setValue(this.input, String(value));
    this.paint(active ? Number(this.input.value) : value ?? 0);
    if (value === undefined) this.readout.show("—", "");
    setDisabled(this.input, this.disabled, state.reason);
    this.readout.setDisabled(this.disabled);
    this.note.update(this.input, this.disabled, state.reason, state.note);
  }
}
