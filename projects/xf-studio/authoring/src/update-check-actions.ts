/**
 * The page's side of the update check (`update-check.ts` holds the policy, run by the host). A presentation dispatches typed actions and
 * reads a snapshot: the check at start (after first paint; the host decides whether it runs), the person's own check, and skipping a
 * version. The person's check pre-empts a check at start still waiting. Cancellation is by `AbortSignal`.
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

export const isUpdateCheckAnswer = (value: unknown): value is UpdateCheckAnswer =>
  !!value && typeof value === "object" && (value as { schema?: unknown }).schema === UPDATE_CHECK_SCHEMA &&
  typeof (value as { installed?: unknown }).installed === "string" &&
  ["newer", "current", "failed", "skipped"].includes((value as { result?: unknown }).result as string);

const UNREACHABLE = "XF Studio couldn't check for updates just now.";

export class UpdateCheckActions {
  private state: UpdateCheckState = { busy: null, answer: null, checkedByPerson: false, unreachable: false };
  private listeners = new Set<() => void>();
  private startup: AbortController | null = null;
  /** @param transport the host's endpoint, or null where no host checks (fixtures). */
  constructor(private readonly transport: UpdateCheckTransport | null) {}
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
    // The person's own check comes first: a check at start still waiting is abandoned.
    if (action.kind === "updates.check") this.startup?.abort();
    const controller = new AbortController();
    const stop = () => controller.abort();
    signal?.addEventListener("abort", stop, { once: true });
    if (action.kind === "updates.startupCheck") this.startup = controller;
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
      if (this.startup === controller) this.startup = null;
      if (action.kind !== "updates.skipVersion" && this.state.busy === action.kind) this.publish({ busy: null });
    }
  }
}
