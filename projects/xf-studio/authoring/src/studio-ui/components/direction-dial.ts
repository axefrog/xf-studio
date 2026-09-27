import { h, setAttr, uid } from "../dom";
import { NoteLine, type Transaction } from "../controls";
import { helpTip, type HelpText } from "../help-tip";
import { ReadoutField } from "./readout-field";

/**
 * Direction dial (style guide "Direction dial", feature-specific: lighting setups): where a light sits around V, seen from above, as one
 * handle on a dial. The angle round the dial is the light's azimuth; the distance from the centre is its height: the centre is straight
 * above V's head, the dashed ring is level with it, the outer edge is straight below.
 *
 * - **Orientation.** V stands at the centre facing the bottom edge ("Front", where the camera starts); her right is the dial's left, as
 *   when you face her. Azimuth 0° is the front and rises toward V's right (90°), behind (180°) and V's left (270°).
 * - **Other lights** of the setup show as small faint dots in their own colours, for context; only the handle moves.
 * - **One transaction per gesture.** A drag is begin, edits, commit (Escape during it restores the start and cancels); a burst of key
 *   presses is one transaction until a short pause or focus leaves; a typed value is one begin-edit-commit step.
 * - **Keyboard** (one tab stop, the dial): Left and Right turn the light by 5° (Page Up and Page Down by 15°), Up and Down raise and
 *   lower it by 5°, Home brings it to the front at its height. Enter types the angle exactly.
 * - **Readouts:** the label line carries the angle and the height, each the one readout of its value and typed into in place (checklist
 *   C1). The dial's value text says both in words ("330°, from V's left, 20° up").
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
};
export type DialMark = { azimuth: number; elevation: number; colour: string };

const SIZE = 100, R = 44;
/** Where a direction draws on the dial: centre straight up, the ring (r = R/2) level, the edge straight down. */
export function dialPoint(direction: Direction): { x: number; y: number } {
  const r = R * (90 - direction.elevation) / 180, a = direction.azimuth * Math.PI / 180;
  return { x: SIZE / 2 - Math.sin(a) * r, y: SIZE / 2 + Math.cos(a) * r };
}
/** The direction under a dial point (the inverse of `dialPoint`). */
export function dialDirection(x: number, y: number, range: { min: number; max: number }): Direction {
  const dx = SIZE / 2 - x, dy = y - SIZE / 2;
  const azimuth = ((Math.atan2(dx, dy) * 180 / Math.PI) + 360) % 360;
  const elevation = 90 - Math.min(R, Math.hypot(dx, dy)) / R * 180;
  return { azimuth: Math.round(azimuth) % 360, elevation: Math.round(Math.min(range.max, Math.max(range.min, elevation))) };
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
const SVG = "http://www.w3.org/2000/svg";
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>) => {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
};

export class DirectionDial {
  readonly element: HTMLElement;
  readonly dial: HTMLElement;
  private readonly handle: SVGCircleElement;
  private readonly marks: SVGGElement;
  private readonly angle: ReadoutField;
  private readonly height: ReadoutField;
  private readonly note: NoteLine;
  private readonly range: { min: number; max: number };
  private value: Direction = { azimuth: 0, elevation: 0 };
  private start: Direction | null = null;
  private disabled = false;
  private burst: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly options: DirectionDialOptions) {
    this.range = options.elevation ?? { min: -89, max: 89 };
    const labelId = uid("dial");
    const drawing = svg("svg", { viewBox: `0 0 ${SIZE} ${SIZE}`, class: "direction-dial-art", "aria-hidden": "true" });
    const c = SIZE / 2;
    drawing.append(
      svg("circle", { cx: c, cy: c, r: R, class: "dial-edge" }),
      svg("circle", { cx: c, cy: c, r: R / 2, class: "dial-horizon" }),
      svg("line", { x1: c, y1: c - R, x2: c, y2: c + R, class: "dial-axis" }), svg("line", { x1: c - R, y1: c, x2: c + R, y2: c, class: "dial-axis" }),
      // V at the centre, her nose toward the front (the bottom edge).
      svg("circle", { cx: c, cy: c, r: 4.5, class: "dial-head" }), svg("line", { x1: c, y1: c + 4.5, x2: c, y2: c + 7.5, class: "dial-nose" }));
    const word = (text: string, x: number, y: number, anchor: string) => { const t = svg("text", { x, y, "text-anchor": anchor, class: "dial-word" }); t.textContent = text; return t; };
    drawing.append(word("Front", c, SIZE - 1, "middle"), word("Behind", c, 6, "middle"), word("V's right", 1, c - 2, "start"), word("V's left", SIZE - 1, c - 2, "end"));
    this.marks = svg("g", { class: "dial-marks" });
    this.handle = svg("circle", { cx: c, cy: c + R / 2, r: 5.5, class: "dial-handle" });
    drawing.append(this.marks, this.handle);
    this.dial = h("div", { class: "direction-dial-face", role: "slider", tabindex: "0", "aria-labelledby": labelId, "aria-valuemin": "0",
      "aria-valuemax": "359", "aria-orientation": "horizontal" });
    this.dial.append(drawing);
    const readout = (label: string, set: (value: number) => Direction) => new ReadoutField({ label, returnFocus: () => this.dial,
      parse: text => { const n = Number(text.replace(/[°\s]/g, "")); return Number.isFinite(n) ? n : undefined; },
      onCommit: value => this.step(set(value)) });
    this.angle = readout(`${options.label} angle`, azimuth => ({ ...this.value, azimuth: ((Math.round(azimuth) % 360) + 360) % 360 }));
    this.height = readout(`${options.label} height`, elevation => ({ ...this.value, elevation: Math.round(Math.min(this.range.max, Math.max(this.range.min, elevation))) }));
    this.note = new NoteLine(options.reserveNote);
    this.element = h("div", { class: "control direction-dial" },
      h("div", { class: "control-line" }, h("span", { class: "control-label-text", id: labelId }, h("span", { text: options.label })),
        options.help !== undefined ? helpTip(options.label, options.help) : null,
        h("span", { class: "dial-readouts" }, this.angle.element, this.height.element)),
      this.dial, this.note.element);
    this.dial.addEventListener("pointerdown", event => this.drag(event));
    this.dial.addEventListener("keydown", event => this.key(event));
    this.dial.addEventListener("blur", () => this.endBurst());
  }
  /** Close a keyboard burst's transaction. */
  private endBurst() {
    if (!this.burst) return;
    clearTimeout(this.burst); this.burst = null;
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
    const lift = { ArrowUp: 5, ArrowDown: -5 }[event.key];
    if (turn === undefined && lift === undefined && event.key !== "Home") return;
    event.preventDefault();
    const v = this.value;
    const next = event.key === "Home" ? { ...v, azimuth: 0 } : turn !== undefined ? { ...v, azimuth: (((v.azimuth + turn) % 360) + 360) % 360 }
      : { ...v, elevation: Math.min(this.range.max, Math.max(this.range.min, v.elevation + lift!)) };
    if (next.azimuth === v.azimuth && next.elevation === v.elevation) return;
    // A burst of presses is one transaction, committed after a short pause (or when focus leaves).
    if (this.burst) clearTimeout(this.burst); else this.options.transaction.begin?.();
    this.paint(next); this.options.transaction.edit(next);
    this.burst = setTimeout(() => this.endBurst(), 600);
  }
  private drag(event: PointerEvent) {
    if (this.disabled || event.button !== 0) return;
    event.preventDefault();
    this.endBurst();
    this.dial.focus();
    this.dial.setPointerCapture(event.pointerId);
    const art = this.dial.querySelector("svg")!;
    const at = (e: PointerEvent) => { const box = art.getBoundingClientRect(); return dialDirection((e.clientX - box.left) / box.width * SIZE,
      (e.clientY - box.top) / box.height * SIZE, this.range); };
    this.start = { ...this.value };
    const t = this.options.transaction;
    t.begin?.();
    const edit = (e: PointerEvent) => { const next = at(e); this.paint(next); t.edit(next); };
    edit(event);
    const move = (e: PointerEvent) => edit(e);
    const finish = (commit: boolean) => {
      this.dial.removeEventListener("pointermove", move); this.dial.removeEventListener("pointerup", up);
      this.dial.removeEventListener("pointercancel", cancel); this.dial.removeEventListener("keydown", escape, true);
      if (commit) t.commit?.();
      else { const back = this.start!; this.paint(back); t.edit(back); t.cancel?.(); }
      this.start = null;
    };
    const up = () => finish(true), cancel = () => finish(false);
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } };
    this.dial.addEventListener("pointermove", move);
    this.dial.addEventListener("pointerup", up);
    this.dial.addEventListener("pointercancel", cancel);
    this.dial.addEventListener("keydown", escape, true);
  }
  /** Draw a direction on the handle, the readouts and the value text. */
  private paint(direction: Direction) {
    this.value = { ...direction };
    const point = dialPoint(direction);
    setAttr(this.handle, "cx", point.x.toFixed(2)); setAttr(this.handle, "cy", point.y.toFixed(2));
    const a = Math.round(direction.azimuth), e = Math.round(direction.elevation);
    setAttr(this.dial, "aria-valuenow", String(a));
    setAttr(this.dial, "aria-valuetext", `${a}°, ${azimuthWords(a)}, ${heightWords(e)}`);
    this.angle.show(`${a}°`, String(a), azimuthWords(a));
    this.height.show(`${e > 0 ? "+" : e < 0 ? "−" : ""}${Math.abs(e)}°`, String(e), heightWords(e));
  }
  /**
   * Show a direction (kept while the person drags), the light's colour on the handle, the setup's other lights as dots, and whether the
   * dial can be used.
   */
  update(value: Direction | undefined, state: { colour?: string; others?: readonly DialMark[]; disabled?: boolean; reason?: string; note?: string } = {}) {
    if (value && !this.start) this.paint(value);
    this.handle.style.setProperty("--light", state.colour ?? "var(--signal)");
    const marks = (state.others ?? []).map(mark => { const p = dialPoint(mark); return svg("circle", { cx: p.x.toFixed(2), cy: p.y.toFixed(2), r: 2.5, class: "dial-mark",
      style: `--light:${mark.colour}` }); });
    const signature = JSON.stringify(state.others ?? []);
    if (this.marks.dataset.key !== signature) { this.marks.dataset.key = signature; this.marks.replaceChildren(...marks); }
    this.disabled = !!state.disabled || !value;
    setAttr(this.dial, "aria-disabled", this.disabled ? "true" : undefined);
    this.dial.classList.toggle("disabled", this.disabled);
    this.angle.setDisabled(this.disabled); this.height.setDisabled(this.disabled);
    this.note.update(this.dial, !!state.disabled, state.reason, state.note);
  }
}
