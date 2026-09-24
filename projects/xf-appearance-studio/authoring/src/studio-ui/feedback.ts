import { h } from "./dom";
import { icon, type IconName } from "./icons";

/** Presentation-only feedback: transient toasts plus a session activity log. Never persisted. */
export type Tone = "info" | "success" | "warning" | "error" | "progress";
export type FeedbackAction = { label: string; run(): void };
export type ActivityEntry = { id: number; time: Date; tone: Tone; source: string; message: string };
const toneIcon: Record<Tone, IconName> = { info: "info", success: "check", warning: "warning", error: "error", progress: "refresh" };

export class Feedback {
  readonly toasts: HTMLElement;
  readonly live: HTMLElement;
  readonly assertive: HTMLElement;
  private entries: ActivityEntry[] = [];
  private listeners = new Set<() => void>();
  private counter = 0;
  constructor() {
    this.toasts = h("div", { class: "toasts", role: "region", "aria-label": "Notifications" });
    this.live = h("div", { class: "sr-only", "aria-live": "polite", "aria-atomic": "true" });
    this.assertive = h("div", { class: "sr-only", "aria-live": "assertive", "aria-atomic": "true" });
  }
  get log(): readonly ActivityEntry[] { return this.entries; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /** Screen-reader announcement without a visible toast (layout changes, selections). */
  announce(message: string) { this.live.textContent = ""; requestAnimationFrame(() => { this.live.textContent = message; }); }
  record(tone: Tone, source: string, message: string) {
    this.entries.push({ id: ++this.counter, time: new Date(), tone, source, message });
    if (this.entries.length > 200) this.entries.splice(0, this.entries.length - 200);
    for (const listener of this.listeners) listener();
  }
  /** Visible, dismissible toast. Errors stay until dismissed; others fade after a while. */
  toast(tone: Tone, source: string, message: string, actions: FeedbackAction[] = [], options: { sticky?: boolean } = {}) {
    this.record(tone, source, message);
    const close = () => { element.classList.add("leaving"); setTimeout(() => element.remove(), 160); };
    const element = h("div", { class: `toast ${tone}`, role: tone === "error" ? "alert" : "status" },
      h("span", { class: "toast-icon" }, icon(toneIcon[tone])),
      h("div", { class: "toast-body" }, h("strong", { text: source }), h("p", { text: message }),
        actions.length ? h("div", { class: "toast-actions" }, actions.map(action =>
          h("button", { class: "btn small", type: "button", text: action.label, onclick: () => { close(); action.run(); } }))) : null),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Dismiss notification", onclick: close }, icon("close")));
    this.toasts.append(element);
    while (this.toasts.children.length > 4) {
      const transient = [...this.toasts.children].find(child => !child.classList.contains("error") && child !== element);
      (transient ?? this.toasts.firstElementChild)?.remove();
    }
    if (!options.sticky && tone !== "error") setTimeout(close, actions.length ? 9000 : 5200);
    return close;
  }
}
