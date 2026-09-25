import { keyBinding, type KeyEvent } from "../../input-bindings";
import { button } from "../controls";
import { h, reducedMotion, setAttr, setText, uid } from "../dom";
import { icon } from "../icons";
import type { AnchorRect } from "./anchors";
import type { ActiveTour, StepButton, StepTarget } from "./engine";
import { placeCallout } from "./placement";
import { renderHelp } from "./render";
import type { TourNavigation } from "./types";

export type CalloutAction = { id: string; label: string; variant?: "primary" | "quiet"; disabled?: boolean; reason?: string; run(): void };
export type CalloutView = { eyebrow: string; title: string; body: string; note?: string; actions: CalloutAction[];
  progress?: { index: number; count: number } };

/**
 * The guidance callout: an eyebrow, a title, a content area and a row of custom buttons. It is a
 * non-modal dialog; the tour card and the onboarding offer both use it. Buttons are rebuilt only
 * when their labels change, so focus stays on a button while its capability updates.
 */
export class Callout {
  readonly element: HTMLElement;
  readonly title: HTMLElement;
  private readonly eyebrow: HTMLElement;
  private readonly body: HTMLElement;
  private readonly note: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly dots: HTMLElement;
  private bodyKey = "";
  private actionKey = "";
  private runs = new Map<string, () => void>();
  constructor(options: { className: string; closeLabel: string; onClose(): void; onKey?(event: KeyboardEvent): boolean }) {
    const titleId = uid("guidance-title"), bodyId = uid("guidance-body");
    this.eyebrow = h("span", { class: "guidance-eyebrow" });
    this.title = h("h2", { class: "guidance-title", id: titleId, tabindex: "-1" });
    this.body = h("div", { class: "guidance-body", id: bodyId });
    this.note = h("p", { class: "guidance-note", hidden: true });
    this.actions = h("div", { class: "guidance-actions" });
    this.dots = h("div", { class: "guidance-dots", "aria-hidden": "true" });
    const close = h("button", { class: "icon-btn small guidance-close", type: "button", "aria-label": options.closeLabel, title: options.closeLabel,
      onclick: () => options.onClose() }, icon("close"));
    this.element = h("section", { class: `guidance-callout ${options.className}`, role: "dialog", "aria-modal": "false",
      "aria-labelledby": titleId, "aria-describedby": bodyId, hidden: true },
      h("header", { class: "guidance-head" }, this.eyebrow, close), this.title, this.body, this.note, h("footer", { class: "guidance-foot" }, this.dots, this.actions));
    this.element.addEventListener("keydown", event => {
      if (options.onKey?.(event)) { event.preventDefault(); event.stopPropagation(); }
    });
  }
  update(view: CalloutView) {
    setText(this.eyebrow, view.eyebrow);
    setText(this.title, view.title);
    if (view.body !== this.bodyKey) { this.bodyKey = view.body; this.body.replaceChildren(...renderHelp(view.body)); }
    setText(this.note, view.note ?? "");
    this.note.hidden = !view.note;
    const progress = view.progress;
    const dotsKey = progress ? `${progress.index}/${progress.count}` : "";
    if (this.dots.dataset.key !== dotsKey) {
      this.dots.dataset.key = dotsKey;
      this.dots.replaceChildren(...(progress ? Array.from({ length: progress.count }, (_, i) =>
        h("i", { class: i === progress.index ? "current" : i < progress.index ? "done" : "" })) : []));
    }
    const key = view.actions.map(action => `${action.id}:${action.label}:${action.variant ?? ""}`).join("|");
    if (key !== this.actionKey) {
      const hadFocus = this.actions.contains(document.activeElement);
      this.actionKey = key;
      this.actions.replaceChildren(...view.actions.map(action => {
        const control = button({ label: action.label, variant: action.variant, small: true, onClick: () => this.runs.get(action.id)?.() });
        control.dataset.action = action.id;
        return control;
      }));
      if (hadFocus) this.focusPrimary();
    }
    this.runs = new Map(view.actions.map(action => [action.id, action.run]));
    for (const action of view.actions) {
      const control = this.actions.querySelector<HTMLButtonElement>(`[data-action="${action.id}"]`);
      if (!control) continue;
      control.disabled = !!action.disabled;
      control.title = action.disabled ? action.reason ?? "" : "";
    }
  }
  show() { this.element.hidden = false; }
  hide() { this.element.hidden = true; }
  get visible() { return !this.element.hidden; }
  focusTitle() { this.title.focus({ preventScroll: true }); }
  focusPrimary() {
    const primary = this.actions.querySelector<HTMLButtonElement>(".btn.primary:not(:disabled)") ?? this.actions.querySelector<HTMLButtonElement>(".btn:not(:disabled)");
    (primary ?? this.title).focus({ preventScroll: true });
  }
}

/**
 * What a key does inside the tour card, from the `tour` key bindings: Esc skips, → and Enter go on
 * (Done on the last step), ← goes back. Enter on a button presses that button instead; ← on the
 * first step is consumed so it can't move anything behind the card.
 */
export function tourKey(event: KeyEvent, context: { onButton: boolean; first: boolean; last: boolean }): TourNavigation | "consume" | undefined {
  const binding = keyBinding("tour", event);
  if (!binding) return undefined;
  if (event.key === "Enter" && context.onButton) return undefined;
  if (binding.id === "tour.skip") return "skip";
  if (binding.id === "tour.back") return context.first ? "consume" : "back";
  return context.last ? "finish" : "next";
}

const PAD = 6;

/**
 * The tour's spotlight and callout. The spotlight is one fixed rectangle whose outer shadow dims
 * (dark theme) or lightens (light theme) everything else; it follows the anchor's rectangle every
 * frame while a tour runs, so resizing, docking and floating panels keep it in place. Both are
 * fixed overlays that never take layout space, and the dimmed UI stays usable.
 */
export class TourOverlay {
  readonly element: HTMLElement;
  readonly callout: Callout;
  private readonly spotlight: HTMLElement;
  private active: ActiveTour | null = null;
  private frameRequest = 0;
  private frames = 0;
  private placed = "";
  constructor(private deps: {
    rect(target: StepTarget): AnchorRect | undefined;
    press(button: StepButton): void;
    nav(action: TourNavigation): void;
    /** Called about four times a second while a tour runs. */
    refresh?(): void;
  }) {
    this.spotlight = h("div", { class: "guidance-spotlight", "aria-hidden": "true" });
    this.callout = new Callout({ className: "guidance-tour", closeLabel: "Skip tour", onClose: () => deps.nav("skip"),
      onKey: event => this.key(event) });
    this.element = h("div", { class: "guidance-layer", hidden: true }, this.spotlight, this.callout.element);
  }
  private key(event: KeyboardEvent) {
    if (!this.active) return false;
    const result = tourKey(event, { onButton: event.target instanceof HTMLButtonElement, first: this.active.first, last: this.active.last });
    if (result && result !== "consume") this.deps.nav(result);
    return !!result;
  }
  render(active: ActiveTour | null) {
    this.active = active;
    if (!active) {
      this.element.hidden = true; this.callout.hide();
      cancelAnimationFrame(this.frameRequest); this.frameRequest = 0; this.placed = "";
      return;
    }
    const target = active.target;
    const offer = target.kind === "offer" ? `This is in the ${target.panelTitle} panel, which isn't showing right now.` : undefined;
    const blocked = active.buttons.filter(item => item.role === "command" && !item.capability.available && item.capability.reason);
    const note = [offer, ...blocked.map(item => `${item.label}: ${item.capability.reason}`)].filter(Boolean).join(" ");
    this.callout.update({
      eyebrow: `${active.tour.title} · ${active.index + 1} of ${active.count}`,
      title: active.content.title, body: active.content.body, note: note || undefined,
      progress: { index: active.index, count: active.count },
      actions: active.buttons.map(item => ({ id: item.id, label: item.label, variant: item.primary ? "primary" : item.role === "nav" && item.action === "back" ? "quiet" : undefined,
        disabled: !item.capability.available, reason: item.capability.reason, run: () => this.deps.press(item) })),
    });
    this.element.hidden = false; this.callout.show();
    this.element.dataset.target = target.kind;
    if (!this.frameRequest) this.frameRequest = requestAnimationFrame(() => this.frame());
    this.position();
  }
  /** Follow the anchor while the tour runs (window resize, dock changes, floating windows, scrolling). */
  private frame() {
    this.frameRequest = 0;
    if (!this.active) return;
    if (++this.frames % 15 === 0) { this.deps.refresh?.(); if (!this.active) return; }
    this.position();
    if (!this.frameRequest) this.frameRequest = requestAnimationFrame(() => this.frame());
  }
  private position() {
    const active = this.active!;
    const lit = active.target.kind === "anchor" || active.target.kind === "panel" ? this.deps.rect(active.target) : undefined;
    const viewport = { w: window.innerWidth, h: window.innerHeight };
    const box = this.callout.element.getBoundingClientRect();
    const size = { w: box.width || 360, h: box.height || 200 };
    const key = JSON.stringify([lit, size, viewport, active.placement]);
    if (key === this.placed) return;
    const first = !this.placed;
    this.placed = key;
    this.element.classList.toggle("instant", first || reducedMotion());
    const spot = lit ? { x: lit.x - PAD, y: lit.y - PAD, w: lit.w + PAD * 2, h: lit.h + PAD * 2 } : { x: viewport.w / 2, y: viewport.h / 2, w: 0, h: 0 };
    Object.assign(this.spotlight.style, { left: `${spot.x}px`, top: `${spot.y}px`, width: `${spot.w}px`, height: `${spot.h}px` });
    this.spotlight.classList.toggle("empty", !lit);
    const place = placeCallout(lit && { x: spot.x, y: spot.y, w: spot.w, h: spot.h }, size, viewport, active.placement);
    Object.assign(this.callout.element.style, { left: `${Math.round(place.x)}px`, top: `${Math.round(place.y)}px` });
    setAttr(this.callout.element, "data-side", place.side);
  }
}
