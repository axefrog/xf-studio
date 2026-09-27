import { h, setAttr } from "../dom";
import { icon, type IconName } from "../icons";
import { previewColourMatrix, type PreviewTokens } from "../../choice-preview";

/**
 * Choice preview tile (style guide "Choice preview"; choice-previews-design.md §3): a picture of a choice drawn in the UI's own palette,
 * inside a choice item (components/choice-list.ts `choiceItem`), for rows whose choices differ in shape. Not for colour-only rows (use a
 * swatch) and never a substitute for the 3D view.
 *
 * - **Anatomy.** A frame on the flat preview ground (`--pv-ground`), the picture, and the label under it (hidden visually at size S, where
 *   it stays the accessible name and tooltip). In the list and details layouts (style guide "Choice layouts") the label sits beside the
 *   picture with the choice's source and, in details, its prepared state (`setMeta`). The tile has its final size from the first paint.
 * - **States.** `waiting`: the frame with a faint glyph for the kind (never a spinner: the corner mark already says the choice is being
 *   prepared); `ready`: the picture fades in (at once under reduced motion); `none`: no picture is possible, the glyph stays and the tile
 *   shows no error. Selected, focused and hovered come from the choice item.
 * - **Turntable** (`PreviewSpin`, where the layout allows it: grid L and details): resting the pointer on the picture turns it slowly after
 *   a short dwell, and pressing and dragging across it turns it by hand at once (a drag never chooses; a click still does). The turntable
 *   strip is loaded only while it turns, and the still comes back when the pointer leaves.
 * - **Theming.** Pictures are theme-free channel images; one SVG colour matrix (`installPreviewFilter`) colours every tile from the
 *   tokens `--pv-subject`, `--pv-ink` and `--pv-shade`, rebuilt when the theme changes. Forced colours drop it (the raw channels still
 *   read as shapes).
 */
export type PreviewTileState = "waiting" | "ready" | "none";
export type PreviewTile = {
  readonly element: HTMLElement;
  set(url: string | null, none?: boolean): void;
  /** The turntable strip (`frames` pictures side by side, frame 0 the still), or null while there is none. */
  setSpin(url: string | null, frames: number): void;
  /** Whether the picture turns on hover and drag (the grid's L size and details). */
  spinnable(on: boolean): void;
  /** The text the list and details layouts show beside the label: the choice's source and its prepared state (either may be empty). */
  setMeta(source: string, state: string): void;
  /** The picture's turntable. */
  readonly spin: PreviewSpin;
};

/** A preview tile for a choice item's content: the frame with its glyph, the label, and the list and details text. */
export function previewTile(options: { label: string; glyph: IconName }): PreviewTile {
  installPreviewFilter();
  const image = h("img", { class: "pv-image", alt: "", draggable: "false", decoding: "async", hidden: true });
  const frame = h("span", { class: "pv-frame", "aria-hidden": "true" }, h("span", { class: "pv-glyph" }, icon(options.glyph)), image);
  const source = h("span", { class: "pv-meta" }), state = h("span", { class: "pv-state" });
  const element = h("span", { class: "choice-content pv-tile", "data-state": "waiting" }, frame,
    h("span", { class: "pv-text" }, h("span", { class: "choice-label pv-label", text: options.label }), source, state));
  const spin = new PreviewSpin(frame);
  let shown: string | null = null;
  image.addEventListener("load", () => { if (image.getAttribute("src") === shown) { image.hidden = false; setAttr(element, "data-state", "ready"); } });
  image.addEventListener("error", () => { image.hidden = true; setAttr(element, "data-state", "none"); });
  return {
    element,
    set(url, none = false) {
      if (url === shown && (url || element.dataset.state === (none ? "none" : "waiting"))) return;
      shown = url;
      if (url) { image.src = url; return; }
      image.hidden = true;
      image.removeAttribute("src");
      setAttr(element, "data-state", none ? "none" : "waiting");
    },
    spin,
    setSpin: (url, frames) => spin.setStrip(url, frames),
    spinnable: on => spin.enable(on),
    setMeta(text, words) { if (source.textContent !== text) source.textContent = text; if (state.textContent !== words) state.textContent = words; },
  };
}

/** Turntable timing: the dwell before a resting pointer starts the spin, one slow turn, and how far a drag turns (one turn per 1.5 frame widths). */
export const SPIN = Object.freeze({ dwellMs: 400, turnMs: 8000, dragWidths: 1.5, dragThreshold: 4 });
/** Measurement (tools and `?verify=1` sessions read it from the page as `xfsSpinMeasures`): ms from the pointer arriving to the first turn shown. */
export const spinMeasures: number[] = [];
(globalThis as { xfsSpinMeasures?: number[] }).xfsSpinMeasures = spinMeasures;
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The turntable on a preview frame (`.pv-frame`): two copies of the strip over the still, the frame the angle falls in and the next one
 * blended by how far between them it is, so a 24-frame strip turns smoothly. It turns slowly while the pointer rests on the frame (after
 * `SPIN.dwellMs`; never under reduced motion) or while `setHover` says the picture is being looked at elsewhere (the details stage follows
 * the choice under the pointer), and by hand while dragged. A drag past `SPIN.dragThreshold` pixels swallows the click that ends it, so
 * the choice isn't chosen; a click without a drag passes through untouched and at once. The strip is set as an image source only while
 * it shows, so a row of tiles never holds decoded strips it isn't turning.
 */
export class PreviewSpin {
  private readonly layer: HTMLElement;
  private readonly strips: [HTMLImageElement, HTMLImageElement];
  private url: string | null = null;
  private frames = 1;
  private angle = 0;
  private enabled = false;
  private hovered = false;
  private looked = false;
  private playing = false;
  /** The dwell has passed: the spin plays once the strip has loaded (never a loop turning nothing). */
  private due = false;
  private loaded = false;
  private dwell: ReturnType<typeof setTimeout> | null = null;
  private frame = 0;
  private last = 0;
  private drag: { id: number; x: number; start: number; moved: boolean } | null = null;
  private swallow = false;
  /** When the pointer arrived (0 once the first turn showed): hover-to-first-turn is measured from it (`spinMeasures`). */
  private arrived = 0;

  constructor(private readonly host: HTMLElement, options: { enabled?: boolean } = {}) {
    const strip = () => h("img", { class: "pv-strip", alt: "", draggable: "false", decoding: "async" });
    this.strips = [strip(), strip()];
    this.layer = h("span", { class: "pv-spin", hidden: true }, ...this.strips);
    host.append(this.layer);
    this.strips[0].addEventListener("load", () => { this.loaded = true; if (this.due && this.active() && !this.drag) this.play(); this.paint(); });
    this.strips[0].addEventListener("error", () => { this.loaded = false; this.paint(); });
    host.addEventListener("pointerenter", event => { if (event.pointerType !== "touch") this.pointer(true); });
    host.addEventListener("pointerleave", () => this.pointer(false));
    host.addEventListener("pointerdown", event => this.down(event));
    host.addEventListener("pointermove", event => this.move(event));
    host.addEventListener("pointerup", event => this.up(event));
    host.addEventListener("pointercancel", event => this.up(event));
    // A drag's closing click never reaches the choice (capture: before the choice item's own handler).
    host.addEventListener("click", event => { if (!this.swallow) return; this.swallow = false; event.preventDefault(); event.stopPropagation(); }, true);
    this.enable(options.enabled ?? false);
  }

  /** The turntable strip (frames side by side), or null. */
  setStrip(url: string | null, frames: number) {
    if (url === this.url && frames === this.frames) return;
    this.url = url; this.frames = Math.max(1, frames); this.loaded = false;
    for (const image of this.strips) { image.removeAttribute("src"); image.style.width = `${this.frames * 100}%`; }
    if (this.active()) this.load();
    this.paint();
  }
  /** Allow turning (off: the still only, and any turn in progress ends). */
  enable(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    setAttr(this.host, "data-spinnable", on);
    if (!on) { this.hovered = false; this.drag = null; this.stop(); this.reset(); }
  }
  /** Turn as though the pointer rested on it (the details stage while its choice is hovered in the list). */
  setHover(on: boolean) {
    if (on === this.looked) return;
    this.looked = on;
    if (on) this.arrive(); else if (!this.hovered && !this.drag) { this.stop(); this.reset(); }
  }

  private active() { return this.enabled && (this.hovered || this.looked || !!this.drag); }
  private load() { if (this.url && !this.strips[0].getAttribute("src")) for (const image of this.strips) image.src = this.url; }
  private pointer(inside: boolean) {
    if (!this.enabled) return;
    this.hovered = inside;
    if (inside) { this.arrive(); return; }
    if (!this.drag && !this.looked) { this.stop(); this.reset(); }
  }
  private arrive() {
    if (!this.enabled) return;
    this.arrived = performance.now();
    this.load();
    if (this.dwell) clearTimeout(this.dwell);
    this.dwell = setTimeout(() => {
      this.dwell = null;
      if (!this.active() || this.drag || reducedMotion()) return;
      this.due = true;
      if (this.loaded) this.play();
    }, SPIN.dwellMs);
  }
  private down(event: PointerEvent) {
    if (!this.enabled || event.button !== 0) return;
    this.drag = { id: event.pointerId, x: event.clientX, start: this.angle, moved: false };
    this.load();
  }
  private move(event: PointerEvent) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    if (!drag.moved) {
      if (Math.abs(dx) < SPIN.dragThreshold) return;
      drag.moved = true;
      this.stop();
      try { this.host.setPointerCapture(drag.id); } catch { /* A pointer already gone. */ }
    }
    const width = this.host.clientWidth || 1;
    this.angle = drag.start + (dx * 360) / (width * SPIN.dragWidths);
    this.paint();
  }
  private up(event: PointerEvent) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.id) return;
    this.drag = null;
    if (drag.moved) {
      this.swallow = true;
      // The click that ends a drag follows at once; if none comes (released outside), nothing waits for it.
      setTimeout(() => { this.swallow = false; }, 0);
      try { this.host.releasePointerCapture(drag.id); } catch { /* Released already. */ }
    }
    // A dragged picture holds its angle while the pointer stays; it goes back to the still when the pointer leaves.
    if (!this.hovered && !this.looked) { this.stop(); this.reset(); }
  }
  private play() {
    if (this.playing) return;
    this.playing = true;
    this.last = performance.now();
    const step = (now: number) => {
      if (!this.playing) return;
      if (!this.host.isConnected || !this.active()) { this.stop(); return; }
      this.angle += ((now - this.last) * 360) / SPIN.turnMs;
      this.last = now;
      this.paint();
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }
  private stop() {
    this.playing = false;
    this.due = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.dwell) { clearTimeout(this.dwell); this.dwell = null; }
  }
  /** Back to the still: the strip is dropped (its decoded image freed) and the angle forgotten. */
  private reset() {
    this.angle = 0;
    this.loaded = false;
    for (const image of this.strips) image.removeAttribute("src");
    this.paint();
  }
  private paint() {
    const showing = this.enabled && !!this.url && this.loaded && this.active() && (this.playing || !!this.drag?.moved || this.angle !== 0);
    if (this.layer.hidden === showing) this.layer.hidden = !showing;
    setAttr(this.host, "data-spin", showing);
    if (!showing) return;
    if (this.arrived) { if (spinMeasures.length < 200) spinMeasures.push(performance.now() - this.arrived); this.arrived = 0; }
    const step = 360 / this.frames, turn = ((this.angle % 360) + 360) % 360, at = turn / step;
    const k = Math.floor(at) % this.frames, next = (k + 1) % this.frames, blend = at - Math.floor(at);
    this.strips[0].style.transform = `translateX(${(-k * 100) / this.frames}%)`;
    this.strips[1].style.transform = `translateX(${(-next * 100) / this.frames}%)`;
    this.strips[1].style.opacity = blend.toFixed(3);
  }
}

/**
 * The details layout's large picture (style guide "Choice layouts"): the choice under the pointer, else the focused one, else the chosen
 * one, at up to 256 px with its label and source, turning like a tile (always allowed here). Beside the list when the row is wide enough,
 * above it otherwise. Outside the listbox: it shows, it is not a choice.
 */
export type PreviewStage = {
  readonly element: HTMLElement;
  show(input: { label: string; source: string; url: string | null; none: boolean; spin: string | null; frames: number; looking: boolean }): void;
  /** The stage's turntable (measurement hooks). */
  readonly spin: PreviewSpin;
};
export function previewStage(options: { glyph: IconName }): PreviewStage {
  installPreviewFilter();
  const tile = previewTile({ label: "", glyph: options.glyph });
  tile.spinnable(true);
  const label = tile.element.querySelector<HTMLElement>(".pv-label")!;
  const element = h("div", { class: "pv-stage", "aria-hidden": "true" }, tile.element);
  const spin = tile.spin;
  let looking = false;
  return {
    element, spin,
    show(input) {
      if (label.textContent !== input.label) label.textContent = input.label;
      tile.setMeta(input.source, "");
      tile.set(input.url, input.none);
      tile.setSpin(input.spin, input.frames);
      if (input.looking !== looking) { looking = input.looking; spin.setHover(looking); }
    },
  };
}

/** The SVG filters the tiles' pictures use (studio.css `.pv-image`): one per theme, so a pane with its own colour scheme is right too. */
export const PREVIEW_FILTER_IDS = { light: "xfs-pv-light", dark: "xfs-pv-dark" } as const;
let installed: { matrices: Record<"light" | "dark", SVGFEColorMatrixElement>; key: string } | null = null;

/** Read a CSS colour as sRGB 0–1 (any syntax the browser knows, `oklch()` included), through a 1 × 1 canvas. */
function srgb(colour: string, context: CanvasRenderingContext2D): [number, number, number] {
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = "#000";
  context.fillStyle = colour;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return [r! / 255, g! / 255, b! / 255];
}
/**
 * The preview tokens of a colour scheme. The colours are `light-dark()` values, which only an element resolves (by its colour scheme),
 * so each is read as a probe element's used colour; the shade is the scheme's own token.
 */
export function previewTokens(scheme: "light" | "dark"): PreviewTokens {
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const probe = h("span", { "aria-hidden": "true", style: `position:absolute;width:0;height:0;overflow:hidden;color-scheme:${scheme}` });
  document.body.append(probe);
  try {
    const colour = (name: string, fallback: string) => { probe.style.color = `var(${name}, ${fallback})`; return srgb(getComputedStyle(probe).color, context); };
    const shade = Number.parseFloat(getComputedStyle(probe).getPropertyValue(`--pv-shade-${scheme}`));
    return { subject: colour("--pv-subject", "#c8c9cc"), ink: colour("--pv-ink", "#35383e"), shade: Number.isFinite(shade) ? shade : scheme === "dark" ? .62 : .72 };
  } finally { probe.remove(); }
}
/** Install the page's preview filters (idempotent), and rebuild them if the tokens change (the root's theme or style attributes). */
export function installPreviewFilter(): void {
  if (installed || typeof document === "undefined" || typeof getComputedStyle !== "function" || !document.body) return;
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("aria-hidden", "true"); svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
  svg.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
  const matrix = (scheme: "light" | "dark") => {
    const filter = document.createElementNS(ns, "filter"), element = document.createElementNS(ns, "feColorMatrix");
    filter.id = PREVIEW_FILTER_IDS[scheme];
    filter.setAttribute("color-interpolation-filters", "sRGB");
    element.setAttribute("type", "matrix");
    filter.append(element); svg.append(filter);
    return element;
  };
  installed = { matrices: { light: matrix("light"), dark: matrix("dark") }, key: "" };
  document.body.append(svg);
  const refresh = () => {
    try {
      const values = (["light", "dark"] as const).map(scheme => previewColourMatrix(previewTokens(scheme)).map(value => Number(value.toFixed(5))).join(" "));
      if (values.join("|") === installed!.key) return;
      installed!.key = values.join("|");
      installed!.matrices.light.setAttribute("values", values[0]!);
      installed!.matrices.dark.setAttribute("values", values[1]!);
    } catch { /* Without tokens the pictures show their raw channels, still recognisable as shapes. */ }
  };
  refresh();
  new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
}
