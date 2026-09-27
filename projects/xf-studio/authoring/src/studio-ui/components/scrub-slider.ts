import { h, setAttr, setDisabled, setText, uid } from "../dom";
import { NoteLine, Segmented } from "../controls";
import { helpTip, type HelpText } from "../help-tip";
import type { IconName } from "../icons";

/**
 * Scrub slider (style guide "Scrub slider"): a spring-loaded control for an operation on many values at once (the Expression panel's
 * Adjust all › Intensity). It rests at the middle (50 %); moving it previews the operation live, releasing applies it as one step, and
 * it always springs back to the middle.
 *
 * - **Preview and apply.** The first move begins (`onBegin`), every position previews (`onPreview(position)`, 0–100), a release away
 *   from the middle applies (`onCommit`). Releasing at the middle, Escape, or releasing in the bleed area cancels (`onCancel`).
 * - **Bleed area.** While the pointer is more than `bleed` px (default 32) away from the slider, the thumb snaps to the middle and the
 *   preview with it ("Release to cancel" shows under the track); coming back resumes the preview. Releasing out there applies nothing.
 * - **Keyboard.** Arrows, Page Up/Down, Home and End preview; Enter applies; Escape (or leaving the slider) cancels.
 * - **Curves** (optional): a frameless icon-only Segmented on the label line, one segment per easing curve (`curves`, `curve`,
 *   `onCurve`), chosen, focused and named exactly as the standalone curve strip is; the owner passes the position through the chosen
 *   curve. Choosing one is a preference, not an edit.
 * - **Anatomy:** label (help tip) · curves · readout (the position, "50 %") · track with a centre mark, filled from the centre to the
 *   thumb · the ends' words small under the track, where the bleed hint appears in the middle (reserved, so nothing moves).
 * - **Access:** a native range labelled by the visible label, described by what a drag does; its value text is the readout's words;
 *   the curves are a labelled group of toggle buttons (`aria-pressed`) with one Tab stop and arrow keys (Segmented).
 */
export type ScrubCurve<T extends string> = { value: T; label: string; icon: IconName };
export type ScrubSliderOptions<T extends string = string> = {
  label: string; help?: HelpText;
  /** The words under the track's ends ("Rest", "Full"). */
  ends: { negative: string; positive: string };
  /** The readout for a position (default "50 %"). */
  format?(position: number): string;
  onBegin(): void;
  onPreview(position: number): void;
  onCommit(): void;
  onCancel(): void;
  curves?: readonly ScrubCurve<T>[];
  onCurve?(curve: T): void;
  /** How far (px) the pointer may stray from the slider before the preview snaps back to the middle. */
  bleed?: number;
  id?: string;
};
export const SCRUB_REST = 50;
const PREVIEW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

export class ScrubSlider<T extends string = string> {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly readout: HTMLOutputElement;
  private readonly hint: HTMLElement;
  private readonly track: HTMLElement;
  private readonly note = new NoteLine(false);
  private readonly curves: Segmented<T> | null;
  /** A preview is open (begun and not yet applied or cancelled). */
  private active = false;
  private pointer = false;
  private bled = false;
  /** Escape or a cancel during a drag: ignore the rest of that drag. */
  private cancelled = false;
  private disabled = false;
  constructor(private readonly options: ScrubSliderOptions<T>) {
    const id = options.id ?? uid("scrub");
    this.input = h("input", { id, class: "slider scrub-range", type: "range", min: "0", max: "100", step: "1", value: String(SCRUB_REST),
      "aria-keyshortcuts": "Enter Escape", "aria-description": "Drag to preview, release to apply. Release at the middle, press Escape or drag away to cancel." });
    this.readout = h("output", { class: "readout", for: id });
    this.hint = h("span", { class: "scrub-hint", "aria-hidden": "true", text: "Release to cancel" });
    this.track = h("span", { class: "scrub-track" }, this.input);
    this.curves = options.curves?.length ? new Segmented<T>({ label: `${options.label} curve`, showLabel: false, compact: true, iconOnly: true, frameless: true,
      options: options.curves.map(curve => ({ value: curve.value, label: curve.label, icon: curve.icon })), onSelect: value => options.onCurve?.(value) }) : null;
    const curves = this.curves?.element ?? null;
    this.element = h("div", { class: "control scrub-slider" },
      h("div", { class: "scrub-line" }, h("label", { class: "control-label-text", for: id }, h("span", { text: options.label })),
        options.help !== undefined ? helpTip(options.label, options.help) : null, h("span", { class: "grow" }), curves, this.readout),
      this.track,
      h("div", { class: "scrub-ends", "aria-hidden": "true" }, h("span", { text: options.ends.negative }), this.hint, h("span", { text: options.ends.positive })),
      this.note.element);
    this.input.addEventListener("pointerdown", () => {
      if (this.disabled) return;
      this.pointer = true; this.cancelled = false; this.setBled(false);
      globalThis.addEventListener("pointermove", this.move);
      globalThis.addEventListener("pointerup", this.release);
      globalThis.addEventListener("pointercancel", this.release);
    });
    this.input.addEventListener("input", () => {
      if (this.disabled) return;
      if (this.cancelled || this.bled) { this.input.value = String(SCRUB_REST); this.paint(); return; }
      const position = Number(this.input.value);
      if (!this.active && position !== SCRUB_REST) { this.active = true; options.onBegin(); }
      this.paint();
      if (this.active) options.onPreview(position);
    });
    this.input.addEventListener("keydown", event => {
      if (this.disabled) return;
      if (PREVIEW_KEYS.has(event.key)) { this.cancelled = false; return; }
      if (event.key === "Enter") { event.preventDefault(); this.finish(true); }
      else if (event.key === "Escape" && this.active) { event.preventDefault(); event.stopPropagation(); this.finish(false); if (this.pointer) this.cancelled = true; }
    });
    this.input.addEventListener("blur", () => { if (!this.pointer) this.finish(false); });
    this.input.value = String(SCRUB_REST);
    this.paint();
  }
  private readonly move = (event: PointerEvent) => {
    const box = this.input.getBoundingClientRect(), margin = this.options.bleed ?? 32;
    const dx = Math.max(box.left - event.clientX, event.clientX - box.right, 0), dy = Math.max(box.top - event.clientY, event.clientY - box.bottom, 0);
    const out = dx > margin || dy > margin;
    if (out === this.bled) return;
    this.setBled(out);
    if (out) { this.input.value = String(SCRUB_REST); this.paint(); if (this.active) this.options.onPreview(SCRUB_REST); }
  };
  private readonly release = () => {
    globalThis.removeEventListener("pointermove", this.move);
    globalThis.removeEventListener("pointerup", this.release);
    globalThis.removeEventListener("pointercancel", this.release);
    this.pointer = false;
    this.finish(!this.bled && !this.cancelled);
    this.cancelled = false; this.setBled(false);
  };
  private setBled(bled: boolean) {
    this.bled = bled;
    this.element.classList.toggle("bleed", bled);
  }
  /** Apply (away from the middle) or cancel the open preview, then spring back to the middle. */
  private finish(apply: boolean) {
    if (this.active) {
      this.active = false;
      if (apply && Number(this.input.value) !== SCRUB_REST) this.options.onCommit(); else this.options.onCancel();
    }
    this.input.value = String(SCRUB_REST);
    this.paint();
  }
  private paint() {
    const position = Number(this.input.value), low = Math.min(position, SCRUB_REST) / 100, high = Math.max(position, SCRUB_REST) / 100;
    this.track.style.setProperty("--lo", String(low));
    this.track.style.setProperty("--hi", String(high));
    const words = this.options.format?.(position) ?? `${Math.round(position)} %`;
    setText(this.readout, words);
    setAttr(this.input, "aria-valuetext", words);
    this.element.classList.toggle("moving", position !== SCRUB_REST);
  }
  update(state: { curve?: T; disabled?: boolean; reason?: string } = {}) {
    if (state.disabled && this.active) this.finish(false);
    this.disabled = !!state.disabled;
    setDisabled(this.input, this.disabled, state.reason);
    this.curves?.update(state.curve, undefined, { disabled: this.disabled });
    this.element.classList.toggle("disabled", this.disabled);
    this.note.update(this.input, this.disabled, state.reason, undefined);
  }
}
