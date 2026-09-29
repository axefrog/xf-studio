/**
 * The page's side of the update check (`update-check.ts` holds the policy, run by the host). A presentation dispatches typed actions and
 * reads a snapshot: the check at start (after first paint; the host decides whether it runs), the person's own check, and skipping a
 * version. The check at start waits for first paint and a moment more (time from the clock source), so it never competes with the Studio's
 * own start; the person's check pre-empts a check at start still in that wait (once sent, the host joins the two). Cancellation is by `AbortSignal`.
 */
import { UPDATE_CHECK_DESCRIPTORS } from "./studio-action-descriptors";
import { UPDATE_CHECK_SCHEMA, type UpdateCheckAnswer } from "./update-check";

export type UpdateCheckAction = { kind: "updates.startupCheck" } | { kind: "updates.check" } | { kind: "updates.skipVersion"; version: string };
export type UpdateCheckOutcome = { ok: true; answer: UpdateCheckAnswer } | { ok: false; code: string; message: string };
export type UpdateCheckState = {
  busy: UpdateCheckAction["kind"] | null;
  /** The last answer from the host. */
  answer: UpdateCheckAnswer | null;
  /** Whether the person's own check has run this session (Help shows its result in place only then). */
  checkedByPerson: boolean;
  /** The person's last check couldn't reach XF Studio's host (the answer is then older). */
  unreachable: boolean;
};
export type UpdateCheckTransport = (body: { action: "startup" | "check" } | { action: "skip"; version: string }, signal: AbortSignal) =>
  Promise<{ ok: boolean; status: number; data: unknown }>;
type Capability = { available: boolean; code?: string; reason?: string };
/** The clock source's timers (`Clock.after`, `Clock.frame`); the page passes its own. */
export type UpdateCheckClock = { after(ms: number, run: () => void, signal?: AbortSignal): void; frame?(run: (time: number) => void, signal?: AbortSignal): void };
/** How long after first paint the check at start waits. */
export const STARTUP_CHECK_DELAY_MS = 2000;

export const isUpdateCheckAnswer = (value: unknown): value is UpdateCheckAnswer =>
  !!value && typeof value === "object" && (value as { schema?: unknown }).schema === UPDATE_CHECK_SCHEMA &&
  typeof (value as { installed?: unknown }).installed === "string" &&
  ["newer", "current", "failed", "skipped"].includes((value as { result?: unknown }).result as string);

const UNREACHABLE = "XF Studio couldn't check for updates just now.";

export class UpdateCheckActions {
  private state: UpdateCheckState = { busy: null, answer: null, checkedByPerson: false, unreachable: false };
  private listeners = new Set<() => void>();
  /** The check at start while it is still in its quiet wait (the person's own check sets it aside only then). */
  private waiting: AbortController | null = null;
  /**
   * @param transport the host's endpoint, or null where no host checks (fixtures).
   * @param clock the clock source's timers; without one the check at start asks at once.
   */
  constructor(private readonly transport: UpdateCheckTransport | null, private readonly clock: UpdateCheckClock | null = null) {}
  /** After first paint and a moment more; resolves early (and the check is abandoned) when the signal aborts. */
  private quietMoment(signal: AbortSignal) {
    const clock = this.clock;
    if (!clock) return Promise.resolve();
    return new Promise<void>(resolve => {
      signal.addEventListener("abort", () => resolve(), { once: true });
      const later = () => clock.after(STARTUP_CHECK_DELAY_MS, resolve, signal);
      if (clock.frame) clock.frame(later, signal); else later();
    });
  }
  descriptors() { return structuredClone(UPDATE_CHECK_DESCRIPTORS); }
  snapshot(): Readonly<UpdateCheckState> { return structuredClone(this.state); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(next: Partial<UpdateCheckState>) { this.state = { ...this.state, ...next }; for (const listener of this.listeners) listener(); }

  capability(action: UpdateCheckAction): Capability {
    if (!(action?.kind in UPDATE_CHECK_DESCRIPTORS)) return { available: false, code: "invalid_value", reason: "Unknown command." };
    if (!this.transport) return { available: false, code: "unavailable", reason: "This copy of XF Studio can't check for updates." };
    if (action.kind === "updates.check" && this.state.busy === "updates.check") return { available: false, code: "busy", reason: "Checking for updates…" };
    if (action.kind === "updates.startupCheck" && this.state.busy) return { available: false, code: "busy", reason: "Checking for updates…" };
    if (action.kind === "updates.skipVersion" && (typeof action.version !== "string" || !action.version))
      return { available: false, code: "invalid_value", reason: "No version to skip." };
    return { available: true };
  }

  async dispatch(action: UpdateCheckAction, signal?: AbortSignal): Promise<UpdateCheckOutcome> {
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, code: allowed.code ?? "unavailable", message: allowed.reason ?? "Not available right now." };
    // The person's own check comes first: a check at start still in its quiet wait is abandoned. Once sent, it is left to finish
    // (the host joins both to one request, so aborting it here would only fail the person's check).
    if (action.kind === "updates.check") this.waiting?.abort();
    const controller = new AbortController();
    const stop = () => controller.abort();
    signal?.addEventListener("abort", stop, { once: true });
    if (action.kind === "updates.startupCheck") {
      this.waiting = controller;
      if (this.clock) await this.quietMoment(controller.signal);
      if (this.waiting === controller) this.waiting = null;
      if (controller.signal.aborted) { signal?.removeEventListener("abort", stop);
        return { ok: false, code: "cancelled", message: "The check at start was set aside." }; }
    }
    const body = action.kind === "updates.skipVersion" ? { action: "skip" as const, version: action.version }
      : { action: action.kind === "updates.check" ? "check" as const : "startup" as const };
    this.publish({ busy: action.kind === "updates.skipVersion" ? this.state.busy : action.kind });
    try {
      const response = await this.transport!(body, controller.signal);
      if (!response.ok || !isUpdateCheckAnswer(response.data)) throw Error("unexpected");
      this.publish({ answer: response.data, ...(action.kind === "updates.check" ? { checkedByPerson: true, unreachable: false } : {}) });
      return { ok: true, answer: response.data };
    } catch {
      if (action.kind === "updates.check") this.publish({ checkedByPerson: true, unreachable: true });
      return { ok: false, code: controller.signal.aborted ? "cancelled" : "transport", message: UNREACHABLE };
    } finally {
      signal?.removeEventListener("abort", stop);
      if (action.kind !== "updates.skipVersion" && this.state.busy === action.kind) this.publish({ busy: null });
    }
  }
}
