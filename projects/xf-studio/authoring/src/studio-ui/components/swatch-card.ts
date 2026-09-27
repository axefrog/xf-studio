import { clamp, h, setAttr, setText } from "../dom";
import { icon } from "../icons";

/**
 * Swatch card (style guide "Swatch card"): a larger look at one colour swatch, beside it, while the pointer rests on it or it has keyboard
 * focus. It shows the colour as it is (a root-to-tip chip for a gradient), its name, where it comes from, and, when the list shows the
 * swatches contrast-enhanced, a line saying this is the true colour. It floats (`position: fixed`, no pointer events), so it never moves
 * the layout or takes a click, and it is a tooltip: the anchor is described by it while it shows, Escape hides it.
 *
 * `attach(container, resolve)` delegates to every swatch inside a list: `resolve` maps the element under the pointer or focus to its
 * sample (or null for none). The pointer shows it after a short rest (`delay`), then moving to the next swatch updates it at once; focus
 * shows it at once. `contrastMark()` is the small marker a row shows when its swatches are contrast-enhanced (`setContrastMark`).
 */
export type SwatchSample = {
  /** The true colour: one `#rrggbb`, or a gradient's stops root to tip. */
  readonly colours: readonly string[];
  readonly label: string;
  /** Where it comes from ("From the game", "From Beautiful EYEBROWS II"). */
  readonly source?: string | null;
  /** The list shows this swatch contrast-enhanced (the card then says this is its true colour). */
  readonly enhanced?: boolean;
};
export type SwatchCardOptions = { delay?: number };

/** The words the card and the marker use for contrast enhancement (one wording everywhere). */
export const CONTRAST_WORDS = {
  mark: "Colours spread apart",
  markTip: "These swatches are spread apart in lightness and hue so similar colours are easier to tell apart. They keep their order; rest on one, or focus it, to see its true colour.",
  card: "True colour. The list spreads these apart to tell them apart.",
} as const;

/** CSS background for a sample: a flat colour, or a vertical root-to-tip gradient. */
export const sampleBackground = (colours: readonly string[]) => colours.length > 1 ? `linear-gradient(to bottom, ${colours.join(", ")})` : colours[0] ?? "transparent";

let cards = 0;
export class SwatchCard {
  readonly element: HTMLElement;
  private readonly sample: HTMLElement;
  private readonly name: HTMLElement;
  private readonly source: HTMLElement;
  private readonly note: HTMLElement;
  private anchor: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly delay: number;

  constructor(options: SwatchCardOptions = {}) {
    this.delay = options.delay ?? 120;
    this.sample = h("span", { class: "swatch-card-sample", "aria-hidden": "true" });
    this.name = h("strong", { class: "swatch-card-name" });
    this.source = h("span", { class: "swatch-card-source" });
    this.note = h("span", { class: "swatch-card-note", hidden: true });
    this.element = h("div", { class: "swatch-card", role: "tooltip", id: `xfs-swatch-card-${++cards}`, hidden: true },
      this.sample, h("span", { class: "swatch-card-text" }, this.name, this.source, this.note));
  }

  /** Show the card for `anchor` (placed beside it, inside the viewport). */
  show(anchor: HTMLElement, sample: SwatchSample) {
    clearTimeout(this.timer);
    if (this.anchor && this.anchor !== anchor) this.anchor.removeAttribute("aria-describedby");
    this.anchor = anchor;
    this.sample.style.background = sampleBackground(sample.colours);
    this.sample.classList.toggle("gradient", sample.colours.length > 1);
    setText(this.name, sample.label);
    setText(this.source, sample.source ?? "");
    this.source.hidden = !sample.source;
    setText(this.note, sample.enhanced ? CONTRAST_WORDS.card : "");
    this.note.hidden = !sample.enhanced;
    const host = anchor.closest("dialog") ?? document.body;
    if (this.element.parentElement !== host) host.append(this.element);
    this.element.hidden = false;
    setAttr(anchor, "aria-describedby", this.element.id);
    this.place(anchor);
  }
  hide() {
    clearTimeout(this.timer);
    this.anchor?.removeAttribute("aria-describedby");
    this.anchor = null;
    this.element.hidden = true;
  }
  get shownFor(): HTMLElement | null { return this.anchor; }

  /** Delegate to the swatches inside `container`; returns a function that detaches. */
  attach(container: HTMLElement, resolve: (target: HTMLElement) => { anchor: HTMLElement; sample: SwatchSample } | null): () => void {
    const find = (event: Event) => event.target instanceof Element && container.contains(event.target) ? resolve(event.target as HTMLElement) : null;
    const over = (event: Event) => {
      const found = find(event);
      if (!found) return;
      if (found.anchor === this.anchor) { clearTimeout(this.timer); return; }
      clearTimeout(this.timer);
      // Once a card shows, the next swatch follows at once; the first waits for the pointer to rest.
      if (this.anchor) this.show(found.anchor, found.sample);
      else this.timer = setTimeout(() => this.show(found.anchor, found.sample), this.delay);
    };
    const out = (event: Event) => {
      const next = (event as PointerEvent).relatedTarget;
      if (next instanceof Element && container.contains(next) && resolve(next as HTMLElement)) return;
      clearTimeout(this.timer);
      // Keyboard focus keeps its card when the pointer leaves.
      if (this.anchor && document.activeElement !== this.anchor) this.hide();
    };
    const focus = (event: Event) => {
      const found = find(event);
      if (found && (found.anchor.matches?.(":focus-visible") ?? true)) this.show(found.anchor, found.sample); else if (!found) this.hide();
    };
    const blur = (event: Event) => {
      const next = (event as FocusEvent).relatedTarget;
      if (!(next instanceof Element && container.contains(next))) this.hide();
    };
    const key = (event: Event) => { if ((event as KeyboardEvent).key === "Escape" && this.anchor) this.hide(); };
    const down = () => this.hide();
    const scroll = () => { if (this.anchor) this.hide(); };
    container.addEventListener("pointerover", over);
    container.addEventListener("pointerout", out);
    container.addEventListener("focusin", focus);
    container.addEventListener("focusout", blur);
    container.addEventListener("keydown", key);
    container.addEventListener("pointerdown", down);
    addEventListener("scroll", scroll, true);
    return () => {
      container.removeEventListener("pointerover", over);
      container.removeEventListener("pointerout", out);
      container.removeEventListener("focusin", focus);
      container.removeEventListener("focusout", blur);
      container.removeEventListener("keydown", key);
      container.removeEventListener("pointerdown", down);
      removeEventListener("scroll", scroll, true);
      this.hide();
    };
  }

  private place(anchor: HTMLElement) {
    const box = anchor.getBoundingClientRect(), own = this.element.getBoundingClientRect(), margin = 6;
    const view = { width: globalThis.innerWidth ?? 1024, height: globalThis.innerHeight ?? 768 };
    const above = box.top - margin - own.height >= margin;
    this.element.style.left = `${clamp(box.left + box.width / 2 - own.width / 2, margin, Math.max(margin, view.width - own.width - margin))}px`;
    this.element.style.top = `${above ? box.top - margin - own.height : Math.min(box.bottom + margin, Math.max(margin, view.height - own.height - margin))}px`;
  }
}

/**
 * The small marker a row of swatches shows when its swatches are contrast-enhanced: one 16 px icon with a plain tooltip (its accessible
 * name says the same). `setContrastMark` turns it on and off without moving anything: an off marker keeps its place, invisible.
 */
export function contrastMark(): HTMLElement {
  return h("span", { class: "contrast-mark off", title: CONTRAST_WORDS.markTip, role: "img", "aria-label": `${CONTRAST_WORDS.mark}. ${CONTRAST_WORDS.markTip}`,
    "aria-hidden": "true" }, icon("contrast"));
}
export function setContrastMark(mark: HTMLElement, on: boolean) {
  mark.classList.toggle("off", !on);
  setAttr(mark, "aria-hidden", on ? undefined : "true");
}
