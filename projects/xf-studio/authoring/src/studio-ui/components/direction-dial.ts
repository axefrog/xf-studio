import { h, setAttr, uid } from "../dom";
import { NoteLine, type Transaction } from "../controls";
import { helpTip, type HelpText } from "../help-tip";
import { ReadoutField } from "./readout-field";
import { SizeBar } from "./size-bar";

/**
 * Direction dial (style guide "Direction dial", feature-specific: lighting setups): where a light sits around V, seen from above, as one
 * handle on a dial, with a height scale beside it. The angle round the dial is the light's azimuth; the distance from the centre is its
 * height: the centre is straight above V's head, the dashed ring is level with it, the outer edge is straight below. The scale on the
 * right says the same height as a number, so distance-means-height never has to be guessed.
 *
 * - **Orientation.** V stands at the centre facing the bottom edge ("Front", where the camera starts); her right is the dial's left, as
 *   when you face her. Azimuth 0° is the front and rises toward V's right (90°), behind (180°) and V's left (270°).
 * - **Other lights** of the setup show as small dots in their own colours, for context; only the handle moves. While a light is dragged
 *   the other dots dim and a dashed radius runs from the centre to the edge through it: moving along that line changes only its height.
 * - **Modifiers while dragging:** Shift keeps the angle (height only, along the radius); Alt snaps the angle around V to 15° steps; Shift and Alt together keep
 *   the height (a smooth turn around V at the same height).
 * - **Height scale:** ticks at the range's ends, its quarters and level, each labelled; the current height is marked in the light's
 *   colour, and a labelled tick it would overlap is hidden (`heightTicks`).
 * - **One transaction per gesture.** A drag is begin, edits, commit (Escape during it restores the start and cancels; a lost pointer
 *   capture or a second press ends it where it is, UI-138); a burst of key presses is one transaction until a short pause or focus
 *   leaves; a typed value is one begin-edit-commit step.
 * - **Keyboard** (one tab stop, the dial): Left and Right turn the light by 5° (Page Up and Page Down by 15°), Up and Down raise and
 *   lower it by 5°; Alt with Left or Right turns it to the next 15° step; Home brings it to the front at its height. Enter types the angle exactly.
 * - **Resize.** The bar under the dial is the library's Size bar (UI-154), so it behaves as every other: drag down to enlarge, up to
 *   shrink, Escape during a drag goes back; Up and Down arrows on the focused bar, Home and End for the smallest and largest; a
 *   double-click, Delete or Backspace goes back to the default size. The drawing's height is what the bar sets, its width follows
 *   (the drawing's aspect). The size is clamped between `DIAL_MIN_SIZE` and what the control's width can hold, and drawn smaller when
 *   the panel narrows (`fitDialSize`); the owner keeps the chosen size (`onResize`, the drawing's width).
 * - **Readouts:** the label line carries the angle and the height, each the one readout of its value and typed into in place (checklist
 *   C1). The dial's value text says both in words ("330°, from the front, V's left, 20° up").
 * - **Unavailable:** the dial and readouts stop taking input and the reserved note line says why.
 */
export type Direction = { azimuth: number; elevation: number };
export type DirectionDialOptions = {
  label: string;
  /** The heights the light may take, in degrees (default −89 to 89). */
  elevation?: { min: number; max: number };
  transaction: Transaction<Direction>;
  help?: HelpText;
  /** Keep the note line from the start. */
  reserveNote?: boolean;
  /** The drawing's width the person chose with the resize bar (`final` on release, to be kept as a preference). */
  onResize?(size: number, final: boolean): void;
};
export type DialMark = { azimuth: number; elevation: number; colour: string };

const SIZE = 100, R = 44, C = SIZE / 2;
/** The height scale's x in the drawing, and where its labels start. */
const AXIS_X = 108, LABEL_X = AXIS_X + 5;
/**
 * The drawing's box: the dial, the four direction words outside its edge (the side ones turned upright), and the height scale on the
 * right with room for its labels. The words keep one type size whatever the drawing's size (`--dial-unit` counter-scales them).
 */
const VIEW = Object.freeze({ x: -8, y: -12, width: 150, height: 124 });
/** The smallest the dial is drawn, and the resize bar's keyboard step, in CSS pixels of the drawing's width. */
export const DIAL_MIN_SIZE = 180;
export const DIAL_DEFAULT_SIZE = 280;
const RESIZE_STEP = 16;
/** The drawing's width per unit of its height: the Size bar sets the height, the width follows. */
const ASPECT = VIEW.width / VIEW.height;
/** Angle steps around V that Alt snaps to. */
export const ANGLE_SNAP = 15;

/** Where a direction draws on the dial: centre straight up, the ring (r = R/2) level, the edge straight down. */
export function dialPoint(direction: Direction): { x: number; y: number } {
  const r = R * (90 - direction.elevation) / 180, a = direction.azimuth * Math.PI / 180;
  return { x: C - Math.sin(a) * r, y: C + Math.cos(a) * r };
}
/** The direction under a dial point (the inverse of `dialPoint`). */
export function dialDirection(x: number, y: number, range: { min: number; max: number }): Direction {
  const dx = C - x, dy = y - C;
  const azimuth = ((Math.atan2(dx, dy) * 180 / Math.PI) + 360) % 360;
  const elevation = 90 - Math.min(R, Math.hypot(dx, dy)) / R * 180;
  return { azimuth: Math.round(azimuth) % 360, elevation: Math.round(Math.min(range.max, Math.max(range.min, elevation))) };
}
/**
 * A drag's direction under the pointer, with the modifiers: Shift keeps the angle the drag started with (only the height follows the
 * pointer's distance from the centre), Alt snaps the angle around V to `ANGLE_SNAP` steps (the height stays free), and Shift with
 * Alt keeps the height the drag started with instead (the angle follows the pointer, unsnapped).
 */
export function dragDirection(x: number, y: number, start: Direction, modifiers: { shift?: boolean; alt?: boolean }, range: { min: number; max: number }): Direction {
  const free = dialDirection(x, y, range);
  if (modifiers.shift && modifiers.alt) return { azimuth: free.azimuth, elevation: start.elevation };
  const azimuth = modifiers.shift ? start.azimuth : modifiers.alt ? (Math.round(free.azimuth / ANGLE_SNAP) * ANGLE_SNAP) % 360 : free.azimuth;
  return { azimuth, elevation: free.elevation };
}
/** The next `ANGLE_SNAP` step around V clockwise or anticlockwise from an angle (Alt with Right or Left), in [0, 360). */
export function snapStep(azimuth: number, direction: 1 | -1): number {
  const next = direction > 0 ? Math.floor(azimuth / ANGLE_SNAP + 1e-9) * ANGLE_SNAP + ANGLE_SNAP : Math.ceil(azimuth / ANGLE_SNAP - 1e-9) * ANGLE_SNAP - ANGLE_SNAP;
  return ((next % 360) + 360) % 360;
}
/** Where a height sits on the scale (the drawing's y): +90° level with the dial's top, −90° with its bottom. */
export const heightY = (elevation: number) => C - elevation / 90 * R;
/**
 * The scale's labelled ticks: the range's ends, its quarters toward them and level (0°), each hidden when the current height's marker
 * would sit on it (within `gap` degrees).
 */
export function heightTicks(current: number, range: { min: number; max: number }, gap = 12): { value: number; hidden: boolean }[] {
  const values = [range.max, Math.round(range.max / 2), 0, Math.round(range.min / 2), range.min];
  return [...new Set(values)].map(value => ({ value, hidden: Math.abs(value - current) < gap }));
}
/** The width the dial is drawn at: the chosen size, no smaller than the minimum, no wider than the control can hold. */
export function fitDialSize(chosen: number, available: number): number {
  const max = Math.max(DIAL_MIN_SIZE, Math.floor(available));
  return Math.round(Math.min(max, Math.max(DIAL_MIN_SIZE, chosen)));
}
/** The side a light shines from, in words. */
export function azimuthWords(azimuth: number): string {
  const a = ((Math.round(azimuth) % 360) + 360) % 360;
  if (a <= 15 || a >= 345) return "from the front";
  if (a >= 165 && a <= 195) return "from behind";
  const side = a < 180 ? "V's right" : "V's left";
  return a < 75 || a > 285 ? `from the front, ${side}` : a > 105 && a < 255 ? `from behind, ${side}` : `from ${side}`;
}
const heightWords = (elevation: number) => { const e = Math.round(elevation); return e === 0 ? "level" : e > 0 ? `${e}° up` : `${-e}° down`; };
const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}°`;
const SVG = "http://www.w3.org/2000/svg";
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>) => {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
};

export class DirectionDial {
  readonly element: HTMLElement;
  readonly dial: HTMLElement;
  /** The resize bar under the dial (the Size bar's element). */
  readonly grip: HTMLElement;
  private readonly bar: SizeBar;
  private readonly art: SVGSVGElement;
  private readonly handle: SVGCircleElement;
  private readonly radius: SVGLineElement;
  private readonly marks: SVGGElement;
  private readonly ticks: SVGGElement;
  private readonly marker: SVGGElement;
  private readonly markerLabel: SVGTextElement;
  private readonly angle: ReadoutField;
  private readonly height: ReadoutField;
  private readonly note: NoteLine;
  private readonly range: { min: number; max: number };
  private value: Direction = { azimuth: 0, elevation: 0 };
  private start: Direction | null = null;
  private disabled = false;
  private burst: ReturnType<typeof setTimeout> | null = null;
  private available = Number.POSITIVE_INFINITY;
  private tickKey = "";
  constructor(private readonly options: DirectionDialOptions) {
    this.range = options.elevation ?? { min: -89, max: 89 };
    const labelId = uid("dial");
    this.art = svg("svg", { viewBox: `${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`, class: "direction-dial-art", "aria-hidden": "true" });
    this.art.append(
      svg("circle", { cx: C, cy: C, r: R, class: "dial-edge" }),
      svg("circle", { cx: C, cy: C, r: R / 2, class: "dial-horizon" }),
      svg("line", { x1: C, y1: C - R, x2: C, y2: C + R, class: "dial-axis" }), svg("line", { x1: C - R, y1: C, x2: C + R, y2: C, class: "dial-axis" }),
      // V at the centre, her nose toward the front (the bottom edge).
      svg("circle", { cx: C, cy: C, r: 4.5, class: "dial-head" }), svg("line", { x1: C, y1: C + 4.5, x2: C, y2: C + 7.5, class: "dial-nose" }));
    const word = (text: string, x: number, y: number, anchor: string, className = "dial-word") => {
      const t = svg("text", { x, y, "text-anchor": anchor, class: className }); t.textContent = text; return t; };
    // The words sit outside the edge, clear of the rings and axes.
    const side = (text: string, x: number, turn: number) => { const t = word(text, x, C, "middle"); t.setAttribute("transform", `rotate(${turn} ${x} ${C})`); return t; };
    this.art.append(word("Front", C, C + R + 3, "middle", "dial-word dial-word-below"), word("Behind", C, C - R - 3, "middle"),
      side("V's right", C - R - 3, -90), side("V's left", C + R + 3, 90));
    // The height scale: its line, the labelled ticks, and the current height's marker.
    this.ticks = svg("g", { class: "dial-ticks" });
    this.markerLabel = word("", LABEL_X, 0, "start", "dial-height-label");
    this.marker = svg("g", { class: "dial-height" });
    this.marker.append(svg("path", { d: `M ${AXIS_X - 4.5} -2.6 L ${AXIS_X - .6} 0 L ${AXIS_X - 4.5} 2.6 Z`, class: "dial-height-mark" }),
      svg("line", { x1: AXIS_X - .6, y1: 0, x2: AXIS_X + 3, y2: 0, class: "dial-height-tick" }), this.markerLabel);
    this.art.append(svg("line", { x1: AXIS_X, y1: heightY(90), x2: AXIS_X, y2: heightY(-90), class: "dial-scale" }), this.ticks, this.marker);
    this.marks = svg("g", { class: "dial-marks" });
    this.radius = svg("line", { x1: C, y1: C, x2: C, y2: C + R, class: "dial-radius" });
    this.handle = svg("circle", { cx: C, cy: C + R / 2, r: 5.5, class: "dial-handle" });
    this.art.append(this.marks, this.radius, this.handle);
    this.dial = h("div", { class: "direction-dial-face", role: "slider", tabindex: "0", "aria-labelledby": labelId, "aria-valuemin": "0",
      "aria-valuemax": "359", "aria-orientation": "horizontal" });
    this.dial.append(this.art);
    // The Size bar sets the drawing's height (its width follows at the drawing's aspect); the owner keeps the width it reports.
    this.bar = new SizeBar({ label: options.label, target: this.dial, minHeight: DIAL_MIN_SIZE / ASPECT, defaultHeight: DIAL_DEFAULT_SIZE / ASPECT,
      maxHeight: () => this.fitted(Number.POSITIVE_INFINITY) / ASPECT, step: RESIZE_STEP / ASPECT, scale: ASPECT,
      valueText: (height, isDefault) => `${this.fitted(height * ASPECT)} pixels wide${isDefault ? ", default" : ""}`,
      apply: () => this.applySize(), onResize: (_height, final) => this.options.onResize?.(this.shownSize, final) });
    this.grip = this.bar.element;
    this.grip.classList.add("dial-grip");
    const readout = (label: string, set: (value: number) => Direction) => new ReadoutField({ label, returnFocus: () => this.dial,
      parse: text => { const n = Number(text.replace(/[°\s+]/g, "").replace("−", "-")); return Number.isFinite(n) ? n : undefined; },
      onCommit: value => this.step(set(value)) });
    this.angle = readout(`${options.label} angle`, azimuth => ({ ...this.value, azimuth: ((Math.round(azimuth) % 360) + 360) % 360 }));
    this.height = readout(`${options.label} height`, elevation => ({ ...this.value, elevation: Math.round(Math.min(this.range.max, Math.max(this.range.min, elevation))) }));
    this.note = new NoteLine(options.reserveNote);
    this.element = h("div", { class: "control direction-dial" },
      h("div", { class: "control-line" }, h("span", { class: "control-label-text", id: labelId }, h("span", { text: options.label })),
        options.help !== undefined ? helpTip(options.label, options.help) : null,
        h("span", { class: "dial-readouts" }, this.angle.element, this.height.element)),
      this.bar.region, this.note.element);
    this.dial.addEventListener("pointerdown", event => this.drag(event));
    this.dial.addEventListener("keydown", event => this.key(event));
    this.dial.addEventListener("blur", () => this.endBurst());
    // The control's width is what the drawing may take: narrowing the panel draws it smaller, widening brings the chosen size back.
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => this.layout(this.element.clientWidth)).observe(this.element);
    this.applySize();
  }
  /** A width as the control's room lets it be drawn. */
  private fitted(size: number) { return fitDialSize(size, this.available); }
  /** The width chosen with the bar (or kept by the owner), or the default. */
  private get chosen() { return this.bar ? (this.bar.chosen ?? DIAL_DEFAULT_SIZE / ASPECT) * ASPECT : DIAL_DEFAULT_SIZE; }
  /** The width the drawing is shown at now. */
  get shownSize() { return this.fitted(this.chosen); }
  /** The control's content width changed (the panel resized): refit the drawing. */
  layout(available: number) {
    if (!(available > 0) || available === this.available) return;
    this.available = available;
    this.bar.refresh();
    this.applySize();
  }
  /** Set the chosen size (the owner's kept preference, or a resize), clamped to what fits. */
  setSize(size: number) {
    if (!Number.isFinite(size)) return;
    this.bar.setChosen(Math.max(DIAL_MIN_SIZE, Math.round(size)) / ASPECT);
  }
  private applySize() {
    // Called by the Size bar while it is being built, before the drawing's own parts are all there.
    if (!this.bar || !this.element) return;
    const shown = this.shownSize;
    this.element.style.setProperty("--dial-size", `${shown}px`);
    // Drawing units per CSS pixel: the words and numbers are sized in px times this, so they stay one type size as the drawing scales.
    this.element.style.setProperty("--dial-unit", (VIEW.width / shown).toFixed(4));
  }
  /** Resize to a width, clamped; `final` tells the owner to keep it. */
  resizeTo(size: number, final: boolean) {
    this.bar.resizeTo(Math.max(DIAL_MIN_SIZE, size) / ASPECT, final);
  }
  /** Close a keyboard burst's transaction. */
  private endBurst() {
    if (!this.burst) return;
    clearTimeout(this.burst); this.burst = null;
    this.focusLine(false);
    this.options.transaction.commit?.();
  }
  /** Begin, edit, commit: one step. */
  private step(next: Direction) {
    if (this.disabled || (next.azimuth === this.value.azimuth && next.elevation === this.value.elevation)) return;
    const t = this.options.transaction;
    t.begin?.(); this.paint(next); t.edit(next); t.commit?.();
  }
  private key(event: KeyboardEvent) {
    if (this.disabled) return;
    if (event.key === "Enter") { event.preventDefault(); this.angle.edit(); return; }
    const turn = { ArrowLeft: -5, ArrowRight: 5, PageDown: -15, PageUp: 15 }[event.key];
    const lift = ({ ArrowUp: 1, ArrowDown: -1 } as const)[event.key as "ArrowUp" | "ArrowDown"];
    if (turn === undefined && lift === undefined && event.key !== "Home") return;
    event.preventDefault();
    const v = this.value;
    const elevation = lift === undefined ? v.elevation : Math.min(this.range.max, Math.max(this.range.min, v.elevation + 5 * lift));
    const snapped = turn !== undefined && event.altKey && Math.abs(turn) === 5 ? snapStep(v.azimuth, turn > 0 ? 1 : -1) : undefined;
    const next = event.key === "Home" ? { ...v, azimuth: 0 } : snapped !== undefined ? { ...v, azimuth: snapped }
      : turn !== undefined ? { ...v, azimuth: (((v.azimuth + turn) % 360) + 360) % 360 } : { ...v, elevation };
    if (next.azimuth === v.azimuth && next.elevation === v.elevation) return;
    // A burst of presses is one transaction, committed after a short pause (or when focus leaves).
    if (this.burst) clearTimeout(this.burst); else { this.options.transaction.begin?.(); this.focusLine(true); }
    this.paint(next); this.options.transaction.edit(next);
    this.burst = setTimeout(() => this.endBurst(), 600);
  }
  /** While a light moves: the other dots dim and the radius through it shows. */
  private focusLine(on: boolean) { this.art.classList.toggle("moving", on); }
  /** The drag under way, ended by its release, a cancel, Escape, a lost pointer capture or a new press (UI-138). */
  private dragging: ((commit: boolean) => void) | null = null;
  private drag(event: PointerEvent) {
    if (this.disabled || event.button !== 0) return;
    event.preventDefault();
    this.endBurst();
    // A press while a drag is under way (another finger, or a release that never arrived) ends that drag where it is: one transaction
    // per gesture, never two open at once.
    this.dragging?.(true);
    // Focus without the keyboard ring: a pointer drag isn't keyboard focus (Shift or Alt held must not bring the ring).
    (this.dial.focus as (options?: { preventScroll?: boolean; focusVisible?: boolean }) => void)({ preventScroll: true, focusVisible: false });
    const pointer = event.pointerId;
    try { this.dial.setPointerCapture(pointer); } catch { /* Not an active pointer: the drag still ends on release or a new press. */ }
    const at = (e: PointerEvent) => { const box = this.art.getBoundingClientRect();
      return dragDirection(VIEW.x + (e.clientX - box.left) / box.width * VIEW.width, VIEW.y + (e.clientY - box.top) / box.height * VIEW.height,
        this.start!, { shift: e.shiftKey, alt: e.altKey }, this.range); };
    this.start = { ...this.value };
    this.focusLine(true);
    const t = this.options.transaction;
    t.begin?.();
    const edit = (e: PointerEvent) => { const next = at(e); this.paint(next); t.edit(next); };
    edit(event);
    const mine = (e: PointerEvent) => e.pointerId === pointer;
    const move = (e: PointerEvent) => { if (mine(e)) edit(e); };
    const finish = (commit: boolean) => {
      if (this.dragging !== finish) return;
      this.dragging = null;
      this.dial.removeEventListener("pointermove", move); this.dial.removeEventListener("pointerup", up);
      this.dial.removeEventListener("pointercancel", cancel); this.dial.removeEventListener("lostpointercapture", lost);
      this.dial.removeEventListener("keydown", escape, true);
      if (commit) t.commit?.();
      else { const back = this.start!; this.paint(back); t.edit(back); t.cancel?.(); }
      this.start = null;
      this.focusLine(false);
    };
    this.dragging = finish;
    const up = (e: PointerEvent) => { if (mine(e)) finish(true); }, cancel = (e: PointerEvent) => { if (mine(e)) finish(false); };
    // The capture went elsewhere (the element was hidden, or another capture took it): the drag ends where it is.
    const lost = (e: PointerEvent) => { if (mine(e)) finish(true); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } };
    this.dial.addEventListener("pointermove", move);
    this.dial.addEventListener("pointerup", up);
    this.dial.addEventListener("pointercancel", cancel);
    this.dial.addEventListener("lostpointercapture", lost);
    this.dial.addEventListener("keydown", escape, true);
  }
  /** Draw a direction on the handle, the radius, the height scale, the readouts and the value text. */
  private paint(direction: Direction) {
    this.value = { ...direction };
    const point = dialPoint(direction), a = direction.azimuth * Math.PI / 180;
    setAttr(this.handle, "cx", point.x.toFixed(2)); setAttr(this.handle, "cy", point.y.toFixed(2));
    setAttr(this.radius, "x2", (C - Math.sin(a) * R).toFixed(2)); setAttr(this.radius, "y2", (C + Math.cos(a) * R).toFixed(2));
    const e = Math.round(direction.elevation), az = Math.round(direction.azimuth);
    this.marker.setAttribute("transform", `translate(0 ${heightY(e).toFixed(2)})`);
    this.markerLabel.textContent = signed(e);
    this.markerLabel.setAttribute("y", "0");
    const ticks = heightTicks(e, this.range), key = JSON.stringify(ticks);
    if (key !== this.tickKey) {
      this.tickKey = key;
      this.ticks.replaceChildren(...ticks.flatMap(tick => {
        const y = heightY(tick.value).toFixed(2), line = svg("line", { x1: AXIS_X, y1: y, x2: AXIS_X + 3, y2: y, class: "dial-scale-tick" });
        if (tick.hidden) return [line];
        const label = svg("text", { x: LABEL_X, y: heightY(tick.value).toFixed(2), class: "dial-scale-label" });
        label.textContent = signed(tick.value);
        return [line, label];
      }));
    }
    setAttr(this.dial, "aria-valuenow", String(az));
    setAttr(this.dial, "aria-valuetext", `${az}°, ${azimuthWords(az)}, ${heightWords(e)}`);
    this.angle.show(`${az}°`, String(az), azimuthWords(az));
    this.height.show(signed(e), String(e), heightWords(e));
  }
  /**
   * Show a direction (kept while the person drags), the light's colour on the handle and marker, the setup's other lights as dots, the
   * chosen size (the owner's kept preference), and whether the dial can be used.
   */
  update(value: Direction | undefined, state: { colour?: string; others?: readonly DialMark[]; disabled?: boolean; reason?: string; note?: string;
    size?: number } = {}) {
    if (value && !this.start && !this.burst) this.paint(value);
    this.art.style.setProperty("--light", state.colour ?? "var(--signal)");
    if (state.size !== undefined && state.size !== this.chosen && !this.grip.classList.contains("dragging")) this.setSize(state.size);
    const signature = JSON.stringify(state.others ?? []);
    if (this.marks.dataset.key !== signature) {
      this.marks.dataset.key = signature;
      this.marks.replaceChildren(...(state.others ?? []).map(mark => { const p = dialPoint(mark);
        return svg("circle", { cx: p.x.toFixed(2), cy: p.y.toFixed(2), r: 2.5, class: "dial-mark", style: `--mark:${mark.colour}` }); }));
    }
    this.disabled = !!state.disabled || !value;
    setAttr(this.dial, "aria-disabled", this.disabled ? "true" : undefined);
    this.dial.classList.toggle("disabled", this.disabled);
    this.angle.setDisabled(this.disabled); this.height.setDisabled(this.disabled);
    this.note.update(this.dial, !!state.disabled, state.reason, state.note);
  }
}
