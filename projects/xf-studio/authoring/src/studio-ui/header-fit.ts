import { setAttr } from "./dom";

/**
 * The application header's fit (style guide s-header, UI-187): the collection and preset names must stay readable, so the header's
 * lower-priority items give way first, one at a time and always in this order, until the names have room. Each stage is a token in
 * the header's `data-fit` attribute; studio.css says what each one does.
 *
 * 1. `commands`: the Commands button shows its icon alone (Ctrl+K opens the palette anywhere).
 * 2. `layout`: the Layouts button shows its icon alone (its tooltip and menu name the layout).
 * 3. `flag`: the verification label shortens to "Verification".
 * 4. `package`: the Package button shows its icon alone.
 * 5. `brand`: the word "Studio" goes; the XF mark and the Beta badge stay.
 * 6. `save`: Save version shows its icon alone (Ctrl+S).
 * 7. `collection`: the collection's name goes; the preset's stays (the Presets panel names the collection).
 *
 * The header fits when nothing runs past its edge and the names show whole (as far as their own maximum width allows), with any of the
 * first six stages given way for that. Where even that leaves no room, each name keeps at least `MIN_CHARACTERS` characters, and only
 * then does the collection's name go. The modules' names (the category) give way before all of this: they shrink to their icon by flex
 * alone.
 */
export const HEADER_STAGES = ["commands", "layout", "flag", "package", "brand", "save", "collection"] as const;
export type HeaderStage = typeof HEADER_STAGES[number];
/** The fewest characters of a name the header keeps before the next stage gives way: about 12, so "Night market…" still reads. */
export const MIN_CHARACTERS = 12;

/**
 * The fewest stages that fit: `fits(n)` applies the first `n` stages and says whether everything fits then; `most` when none below it
 * does (all of them, by default: the collection's name is the last to go).
 */
export function stagesThatFit(fits: (applied: number) => boolean, most: number = HEADER_STAGES.length): number {
  for (let applied = 0; applied < most; applied++) if (fits(applied)) return applied;
  return most;
}

/**
 * The stages for a header: the fewest that show the names whole, if the first six can; else the fewest that keep each name readable.
 * `fits(n, whole)` applies `n` stages and says whether everything fits with the names whole (`whole`) or only readable.
 */
export function headerStages(fits: (applied: number, whole: boolean) => boolean): number {
  const whole = stagesThatFit(applied => fits(applied, true));
  return whole < HEADER_STAGES.length ? whole : stagesThatFit(applied => fits(applied, false));
}

/** A name keeps enough of itself: it shows at least `min` pixels of it, or all of it if it is shorter. */
export const nameFits = (shown: number, whole: number, min: number) => shown + 1 >= Math.min(whole, min);

export class HeaderFit {
  private observer?: ResizeObserver;
  private minimum = 0;
  constructor(private readonly header: HTMLElement, private readonly names: readonly HTMLElement[]) {
    if (typeof ResizeObserver === "function") { this.observer = new ResizeObserver(() => this.refit()); this.observer.observe(header); }
    // The names' widths change once the interface fonts arrive; the header's own size doesn't, so the observer wouldn't hear it.
    if (typeof document !== "undefined") void document.fonts?.ready.then(() => { this.minimum = 0; this.refit(); });
  }

  /** Fit again: after the window resizes (observed) and whenever a name, the chip or a label in the header changes (the owner calls it). */
  refit(): void {
    const header = this.header;
    // Not laid out (a hidden page, the first paint before layout, a test document): nothing to measure, and every label shows.
    if (!header.isConnected || !header.clientWidth) { setAttr(header, "data-fit", undefined); return; }
    const apply = (applied: number) => setAttr(header, "data-fit", applied ? HEADER_STAGES.slice(0, applied).join(" ") : undefined);
    const min = this.minimumWidth();
    // A name is whole when it shows all its text, or as much as its own maximum width (the crumbs' cap) ever shows.
    const caps = this.names.map(name => parseFloat(getComputedStyle(name).maxWidth) || Infinity);
    apply(headerStages((applied, whole) => {
      apply(applied);
      if (header.scrollWidth > header.clientWidth + 1) return false;
      return this.names.every((name, at) => !name.getClientRects().length || nameFits(name.clientWidth, name.scrollWidth, whole ? caps[at]! : min));
    }));
  }

  /** `MIN_CHARACTERS` in the names' own font, measured once. */
  private minimumWidth() {
    if (this.minimum) return this.minimum;
    const sample = this.names.find(name => name.getClientRects().length);
    const context = sample && typeof document !== "undefined" ? document.createElement("canvas").getContext?.("2d") : null;
    if (!sample || !context) return 96;
    context.font = getComputedStyle(sample).font;
    return this.minimum = Math.ceil(context.measureText("0".repeat(MIN_CHARACTERS)).width);
  }

  disconnect() { this.observer?.disconnect(); }
}
