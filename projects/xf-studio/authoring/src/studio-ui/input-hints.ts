import { cursorFor, targetTip, viewportHints, type BlockReason, type HintItem, type ViewportHints,
  type ViewportInputContext, type ViewportScope } from "../input-bindings";
import { h } from "./dom";
import type { Frame, StudioRuntime } from "./runtime";

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const item = (hint: HintItem) => `<span class="hint">${hint.input ? `<kbd class="hint-key">${esc(hint.input)}</kbd>` : ""}<span class="hint-label">${esc(hint.label)}</span></span>`;

/**
 * The one renderer for viewport hint strips, used by the app and the style guide, so the guide's
 * specimens are the strips the Studio shows. Content comes only from `viewportHints()`.
 */
export function hintStripMarkup(hints: ViewportHints): string {
  const lead = hints.tone === "gesture" ? `<span class="hint-state">${esc(hints.heading)}</span>`
    : hints.held ? `<span class="hint-state held"><kbd class="hint-key">${esc(hints.held)}</kbd>held</span>` : "";
  const hold = hints.hold.length ? `<span class="hint-group hint-more"><span class="hint-hold">Hold</span>${hints.hold.map(item).join("")}</span>` : "";
  const more = hints.more.length ? `<span class="hint-group hint-more">${hints.more.map(item).join("")}</span>` : "";
  const note = hints.note ? `<span class="hint-note">${esc(hints.note)}</span>` : "";
  return `${lead}${note}<span class="hint-group">${hints.items.map(item).join("")}</span>${hold}${more}`;
}
/** Tooltip body for a hovered makeup target. */
export function targetTipMarkup(tip: NonNullable<ReturnType<typeof targetTip>>): string {
  return `<strong class="target-tip-title">${esc(tip.title)}</strong>${tip.lines.map(item).join("")}`;
}

/**
 * Viewport input feedback: the hint strip, the hovered-target tooltip and the cursor. Reads the
 * read-only `viewport.input()` snapshot (held modifiers plus each adapter's hover/gesture report)
 * on its own subscription, so hover and modifier changes never repaint other panels.
 */
export class ViewportInputHints {
  readonly strip: HTMLElement;
  readonly tip: HTMLElement;
  private enabled = true;
  private blocked: BlockReason | undefined;
  private stripKey = "";
  private tipKey = "";
  private pointer: { x: number; y: number } | undefined;
  private dwell: ReturnType<typeof setTimeout> | undefined;
  private tipReady = false;
  constructor(private rt: StudioRuntime, private scope: ViewportScope, private slot: HTMLElement, private host: HTMLElement) {
    this.strip = h("div", { class: "input-hints", "data-scope": scope });
    this.tip = h("div", { class: "target-tip", role: "tooltip", hidden: true });
    rt.port.viewport.subscribeInput(() => this.render());
    // Presentation-only pointer tracking: where to place the tooltip and when it has dwelt long enough.
    slot.addEventListener("pointermove", event => {
      this.pointer = { x: event.clientX, y: event.clientY };
      if (!this.tipReady) { clearTimeout(this.dwell); this.dwell = setTimeout(() => { this.tipReady = true; this.render(); }, 450); }
      this.place();
    });
    const reset = () => { clearTimeout(this.dwell); this.tipReady = false; this.pointer = undefined; this.render(); };
    slot.addEventListener("pointerleave", reset);
    slot.addEventListener("pointerdown", () => { clearTimeout(this.dwell); this.tipReady = false; this.render(); });
  }
  context(): ViewportInputContext {
    const input = this.rt.port.viewport.input(), own = input[this.scope];
    return { scope: this.scope, target: own.target, gesture: own.gesture, modifiers: input.modifiers, blocked: this.blocked };
  }
  update(frame: Frame) {
    this.enabled = frame.preferences.inputHints;
    const layer = frame.layer;
    this.blocked = !layer ? "no-layer" : this.scope === "head" && !frame.preview.preview?.surface ? "surface-off"
      : this.scope === "head" && !layer.enabled ? "layer-hidden" : undefined;
    this.render();
  }
  render() {
    const context = this.context(), cursor = cursorFor(context);
    if (cursor === "default") delete this.slot.dataset.cursor; else this.slot.dataset.cursor = cursor;
    this.strip.hidden = !this.enabled;
    const hints = viewportHints(context), key = JSON.stringify(hints);
    if (this.enabled && key !== this.stripKey) {
      this.stripKey = key;
      this.strip.dataset.tone = hints.tone;
      this.strip.innerHTML = hintStripMarkup(hints);
    }
    const tip = this.enabled && this.tipReady && this.pointer ? targetTip(context) : undefined;
    this.tip.hidden = !tip;
    if (tip) {
      const tipKey = JSON.stringify(tip);
      if (tipKey !== this.tipKey) { this.tipKey = tipKey; this.tip.innerHTML = targetTipMarkup(tip); }
      this.place();
    }
  }
  private place() {
    if (this.tip.hidden || !this.pointer) return;
    const box = this.host.getBoundingClientRect(), width = this.tip.offsetWidth, height = this.tip.offsetHeight;
    let x = this.pointer.x - box.left + 16, y = this.pointer.y - box.top + 20;
    if (x + width > box.width - 8) x = Math.max(8, this.pointer.x - box.left - width - 12);
    if (y + height > box.height - 8) y = Math.max(8, this.pointer.y - box.top - height - 12);
    this.tip.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
  }
}
