import { h, setAttr, setText } from "../dom";

/**
 * Readout field: a control's one monospaced readout, which is also where its exact value is typed (checklist C1: one readout per
 * value, never a second box beside it). Part of the library's value controls (BipolarSlider now; Slider with value next), not a
 * component panels compose on their own.
 *
 * - **At rest** it is the readout text. A click on it, or `edit()` (the owning slider calls it on Enter), turns it into a small field
 *   in the same place on the line, holding the raw number, selected.
 * - **Enter or leaving the field** commits what was typed through `onCommit` (the owner clamps and snaps it and records one Undo step);
 *   text that doesn't parse is dropped. **Escape** restores the readout and changes nothing. Either way focus goes back to `returnFocus`
 *   (the slider), so the keyboard never loses its place.
 * - **Access:** the readout is not a tab stop of its own (one tab stop per control: the slider, with Enter to type a value); the field
 *   is named "<label>, exact value".
 */
export type ReadoutFieldOptions = {
  label: string;
  /** The typed text as a value, or undefined when it can't be read. */
  parse(text: string): number | undefined;
  onCommit(value: number): void;
  /** Where focus goes after the field closes. */
  returnFocus(): HTMLElement | undefined;
};
export class ReadoutField {
  readonly element: HTMLElement;
  private readonly output: HTMLOutputElement;
  private readonly field: HTMLInputElement;
  private raw = "";
  private disabled = false;
  constructor(private readonly options: ReadoutFieldOptions) {
    this.output = h("output", { class: "readout readout-value", title: "Click to type an exact value" });
    this.field = h("input", { class: "field mono readout-input", type: "text", inputmode: "decimal", spellcheck: "false", autocomplete: "off",
      "aria-label": `${options.label}, exact value`, hidden: true });
    this.element = h("span", { class: "readout-field" }, this.output, this.field);
    this.output.addEventListener("click", () => this.edit());
    this.field.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); this.close(true); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.close(false); }
    });
    this.field.addEventListener("blur", () => { if (this.editing) this.close(true); });
  }
  get editing() { return !this.field.hidden; }
  /** Name the typed field after a new label (its owner was relabelled). */
  relabel(label: string) { this.field.setAttribute("aria-label", `${label}, exact value`); }
  /** Show `text` as the readout; `raw` is what the field starts with when editing. */
  show(text: string, raw: string, title?: string) {
    setText(this.output, text);
    this.raw = raw;
    setAttr(this.output, "title", this.disabled ? undefined : title ?? "Click to type an exact value");
  }
  setDisabled(disabled: boolean) {
    this.disabled = disabled;
    this.element.classList.toggle("disabled", disabled);
    if (disabled && this.editing) this.close(false);
  }
  /** Open the field in place of the readout. */
  edit() {
    if (this.disabled || this.editing) return;
    this.field.value = this.raw;
    this.output.hidden = true;
    this.field.hidden = false;
    this.field.focus();
    this.field.select?.();
  }
  private close(commit: boolean) {
    const text = this.field.value;
    this.field.hidden = true;
    this.output.hidden = false;
    if (commit) {
      const value = this.options.parse(text);
      if (value !== undefined) this.options.onCommit(value);
    }
    this.options.returnFocus()?.focus();
  }
}
