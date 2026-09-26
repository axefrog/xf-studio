import { h } from "./dom";
import { icon, type IconName } from "./icons";

/** Presentation-only feedback: transient toasts plus a session activity log. Never persisted. */
export type Tone = "info" | "success" | "warning" | "error" | "progress";
export type FeedbackAction = { label: string; run(): void };
export type ActivityEntry = { id: number; time: Date; tone: Tone; source: string; message: string; ref?: string };
/**
 * Error references for notices (docs/diagnostics.md): `notice` logs an error notice about to be shown and returns its reference
 * (null for an expected refusal); `report` opens "Report a problem" for a reference.
 */
export type FeedbackDiagnostics = { notice(failure: { source: string; message: string; code?: string }): string | null; report(ref: string | null): void;
  /** Whether a failure code is an ordinary refusal (nothing to undo, busy, out of range): shown as a notice that fades, never an error. */
  expected?(code: string | undefined): boolean };
export type ToastOptions = { sticky?: boolean;
  /** The failure's code, when the notice is for a failed action or request (an expected refusal gets no reference). */
  code?: string;
  /** A reference already logged (a background failure); the notice shows it without logging again. */
  ref?: string | null };
const toneIcon: Record<Tone, IconName> = { info: "info", success: "check", warning: "warning", error: "error", progress: "refresh" };

export class Feedback {
  readonly toasts: HTMLElement;
  readonly live: HTMLElement;
  readonly assertive: HTMLElement;
  private entries: ActivityEntry[] = [];
  private listeners = new Set<() => void>();
  private counter = 0;
  constructor(private readonly diagnostics?: FeedbackDiagnostics) {
    this.toasts = h("div", { class: "toasts", role: "region", "aria-label": "Notifications" });
    this.live = h("div", { class: "sr-only", "aria-live": "polite", "aria-atomic": "true" });
    this.assertive = h("div", { class: "sr-only", "aria-live": "assertive", "aria-atomic": "true" });
  }
  get log(): readonly ActivityEntry[] { return this.entries; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /** Screen-reader announcement without a visible toast (layout changes, selections). */
  announce(message: string) { this.live.textContent = ""; requestAnimationFrame(() => { this.live.textContent = message; }); }
  record(tone: Tone, source: string, message: string, ref?: string) {
    this.entries.push({ id: ++this.counter, time: new Date(), tone, source, message, ...(ref ? { ref } : {}) });
    if (this.entries.length > 200) this.entries.splice(0, this.entries.length - 200);
    for (const listener of this.listeners) listener();
  }
  /**
   * Visible, dismissible toast. Errors stay until dismissed; others fade after a while, but not while the pointer or keyboard
   * focus is on them. An error that isn't an expected refusal carries its reference and a "Report this problem" button; an
   * ordinary refusal (UI-80: nothing to undo, busy, out of range) is a warning that fades, whoever raised it.
   */
  toast(tone: Tone, source: string, message: string, actions: FeedbackAction[] = [], options: ToastOptions = {}) {
    if (tone === "error" && options.ref === undefined && options.code !== undefined && this.diagnostics?.expected?.(options.code)) tone = "warning";
    const ref = options.ref !== undefined ? options.ref : tone === "error" ? this.diagnostics?.notice({ source, message, code: options.code }) ?? null : null;
    this.record(tone, source, message, ref ?? undefined);
    const all = ref && this.diagnostics ? [...actions, { label: "Report this problem", run: () => this.diagnostics!.report(ref) }] : actions;
    const close = () => { element.classList.add("leaving"); setTimeout(() => element.remove(), 160); };
    const element = h("div", { class: `toast ${tone}`, role: tone === "error" ? "alert" : "status" },
      h("span", { class: "toast-icon" }, icon(toneIcon[tone])),
      h("div", { class: "toast-body" }, h("strong", { text: source }), h("p", { text: message }),
        ref ? h("p", { class: "toast-ref", text: `Reference ${ref}` }) : null,
        all.length ? h("div", { class: "toast-actions" }, all.map(action =>
          h("button", { class: "btn small", type: "button", text: action.label, onclick: () => { close(); action.run(); } }))) : null),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Dismiss notification", onclick: close }, icon("close")));
    this.toasts.append(element);
    while (this.toasts.children.length > 4) {
      const transient = [...this.toasts.children].find(child => !child.classList.contains("error") && child !== element);
      (transient ?? this.toasts.firstElementChild)?.remove();
    }
    if (!options.sticky && tone !== "error" && !ref) {
      // Fades after a while; reading it (pointer over it, or focus in it) holds it until the reader moves on.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const arm = () => { clearTimeout(timer); timer = setTimeout(close, all.length ? 9000 : 5200); };
      const hold = () => clearTimeout(timer);
      element.addEventListener("pointerenter", hold); element.addEventListener("focusin", hold);
      element.addEventListener("pointerleave", arm); element.addEventListener("focusout", arm);
      arm();
    }
    return close;
  }
}
