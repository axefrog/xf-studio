/**
 * Application service for the preview's resolved character details (head skin, face details, eyes, brows, lashes, hair and piercings).
 * DOM-free: it asks the host to prepare the V the character context describes (character-context-actions.ts: the default V or a save,
 * with the creator choices set on it), follows the preparation, has the renderer device swap the result in, and publishes a read-only
 * status. The context owns every creator choice (CORE-58); this service only shows the V it is given.
 *
 * Switching V replaces the character completely: the previous V's details leave the scene at once, and a preparation or load for an
 * older V can never land after a newer one was asked for. A changed choice on the same V keeps the V fully on screen and interactive:
 * the status stays `ready` with `updating` (the presentation shows a small inline indicator), and the device swaps in only what changed
 * (PREV-68). When a change can't be prepared, the V stays as it was shown and `updateError` says so in one plain line, until the next
 * change (CORE-63). The full "preparing" status is for a V's first preparation only.
 *
 * The same request asked again is never prepared again, even after a failure (PREV-86): trying again is the explicit `retry`.
 */
import { sameCharacter, type CharacterRequest } from "./character-detail-request";
import type { DetailSlot, DetailSlotState } from "./render-detail";
import { DETAIL_SLOTS } from "./render-detail";
import { withSlotLimits, type DetailLimit, type DetailNotice, type SlotLimits } from "./detail-limits";
import { pageFailure } from "./diagnostics/page-sink";

/** The host's preparation state (character-detail-host.ts), as the transport returns it. */
export type HostCharacterState = {
  key: string; phase: "preparing" | "ready" | "failed" | "unknown"; message: string;
  progress: { index: number; total: number; label: string } | null; record: string | null;
};
export type CharacterDetailPort = {
  /** Ask the host to prepare a character; returns its current state. */
  request(request: CharacterRequest, signal: AbortSignal): Promise<HostCharacterState>;
  /** Poll one request's state. */
  poll(key: string, signal: AbortSignal): Promise<HostCharacterState>;
  /**
   * Load a prepared record and swap it into the scene, replacing whatever was there (parts whose content is unchanged are kept as they
   * are); returns per-slot outcomes, with the limit codes of a shown slot the preview draws only in part.
   */
  show(record: string, signal: AbortSignal): Promise<{ slots: (DetailSlotState & { limits?: DetailLimit[] })[];
    /** The head options whose parts the shown record draws. */
    drawn?: string[] }>;
  /** Remove every resolved detail from the scene. */
  clear(): void;
  /** Shown slots' limit codes when the renderer's change after `show` (a slot shown later, a re-bake after a restore; PREV-74). */
  onLimits?(listener: (update: SlotLimits) => void): () => void;
  wait(ms: number, signal: AbortSignal): Promise<void>;
};
export type CharacterSlotStatus = { slot: DetailSlot; state: "pending" | DetailSlotState["state"]; label: string; message?: string;
  /** Why a shown slot is drawn only in part, as codes the presentation words. */
  limits?: DetailLimit[] };
export type CharacterDetailStatus = {
  phase: "idle" | "preparing" | "ready" | "failed";
  source: CharacterRequest["source"] | null;
  /** One plain line; empty when there is nothing to say. Partial-drawing limits are codes on the slots. */
  message: string;
  /** Why nothing is shown, as a code the presentation words (a host of another version); null otherwise. */
  notice: DetailNotice | null;
  progress: { index: number; total: number; label: string } | null;
  slots: CharacterSlotStatus[];
  /** A changed choice on the shown V is being prepared, while the V stays on screen. */
  updating: boolean;
  /** The last change on the shown V couldn't be prepared: the V is shown as it was before it (one plain line). */
  updateError: string | null;
  /** How many choices the shown record was prepared with (its request's `choices`). */
  choices: number;
  /** The head options whose parts the shown V draws (settles a `conditional` coverage: drawn, or not shown yet). */
  drawn: string[];
};

const POLL_MS = 600;
const FAILED = "Your V's own skin, face details, eyes, brows, lashes, hair and piercings couldn't be prepared, so they aren't shown. The head still works.";
const UPDATE_FAILED = "That change couldn't be shown in the 3D view, so your V is shown as before it.";
const pending = (): CharacterSlotStatus[] => DETAIL_SLOTS.map(slot => ({ slot, state: "pending", label: "" }));

export class CharacterDetailActions {
  private status: CharacterDetailStatus = { phase: "idle", source: null, message: "", notice: null, progress: null, slots: pending(),
    updating: false, updateError: null, choices: 0, drawn: [] };
  private listeners = new Set<() => void>();
  private current: { key: string; request: CharacterRequest; controller: AbortController } | null = null;
  /** The last request asked for (kept after a failure, so asking for it again changes nothing until `retry`). */
  private asked: { key: string; request: CharacterRequest } | null = null;
  /** The request whose record is shown now (a failed change on the same V falls back to it). */
  private shown: CharacterRequest | null = null;
  private disposed = false;
  constructor(private readonly port: CharacterDetailPort) {
    port.onLimits?.(update => { if (this.status.phase === "ready") this.publish({ ...this.status, slots: withSlotLimits(this.status.slots, update) }); });
  }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  snapshot(): Readonly<CharacterDetailStatus> { return structuredClone(this.status); }
  private publish(next: CharacterDetailStatus) {
    this.status = next;
    for (const listener of this.listeners) listener();
  }

  /**
   * Show the details of `request`. The same request again is a no-op, also after it failed (`retry` tries again); the same V with other
   * choices is updated in place; a different V clears the previous details first and supersedes any preparation still running for it.
   */
  setCharacter(request: CharacterRequest): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const key = JSON.stringify(request);
    if (this.asked?.key === key) return Promise.resolve();
    this.asked = { key, request };
    return this.prepare(key, request);
  }
  /** The last request failed (the V, or a change on it): `retry` can try it again. */
  failed(): boolean { return !!this.asked && (this.status.phase === "failed" || !!this.status.updateError); }
  /** Try the last request again after it failed. */
  retry(): Promise<void> {
    if (this.disposed || !this.asked || !this.failed()) return Promise.resolve();
    return this.prepare(this.asked.key, this.asked.request);
  }

  private prepare(key: string, request: CharacterRequest): Promise<void> {
    // Only another V clears the scene: a changed choice on the same V keeps it, fully interactive, until the new record swaps in.
    const sameV = !!this.shown && sameCharacter(this.shown, request) && this.status.phase === "ready";
    this.current?.controller.abort();
    const controller = new AbortController();
    this.current = { key, request, controller };
    if (sameV) this.publish({ ...this.status, updating: true, updateError: null });
    else {
      // Nothing of the previous V may linger while the new one prepares.
      this.port.clear();
      this.shown = null;
      this.publish({ phase: "preparing", source: request.source, message: "", notice: null, progress: null, slots: pending(),
        updating: false, updateError: null, choices: request.choices?.length ?? 0, drawn: [] });
    }
    return this.follow(request, controller.signal, sameV).catch(error => {
      if (controller.signal.aborted || this.disposed) return;
      const notice = (error as { notice?: DetailNotice })?.notice ?? null;
      // Logged with a reference; shown with "Report this problem" unless it's a known notice (a host of another version).
      pageFailure("character", sameV ? "change_failed" : "details_failed", sameV ? UPDATE_FAILED : FAILED, error, { notify: !notice, source: "Your V" });
      if (sameV && !notice) {
        // The shown V stays as it was; the change is explained, not silently reverted (CORE-63). `retry` tries it again.
        if (this.current?.controller === controller) this.current = null;
        this.publish({ ...this.status, updating: false, updateError: (error as { plain?: string })?.plain ?? UPDATE_FAILED });
        return;
      }
      this.port.clear();
      this.shown = null;
      this.publish({ phase: "failed", source: request.source, message: notice ? "" : FAILED, notice, progress: null,
        slots: DETAIL_SLOTS.map(slot => ({ slot, state: "unavailable", label: "" })), updating: false, updateError: null, choices: 0, drawn: [] });
    });
  }

  private async follow(request: CharacterRequest, signal: AbortSignal, updating: boolean) {
    let state = await this.port.request(request, signal);
    for (let attempts = 0; state.phase === "preparing" || state.phase === "unknown"; attempts++) {
      if (signal.aborted) return;
      if (state.phase === "preparing" && !updating) this.publish({ ...this.status, progress: state.progress });
      await this.port.wait(POLL_MS, signal);
      if (signal.aborted) return;
      // The host forgets a request it cancelled or never saw (a restart): ask again.
      state = state.phase === "unknown" || attempts % 50 === 49 ? await this.port.request(request, signal) : await this.port.poll(state.key, signal);
    }
    if (signal.aborted) return;
    if (state.phase === "failed" || !state.record) {
      // The host logged its failure with the details; this links the notice to it (docs/diagnostics.md).
      if (!updating) pageFailure("character", "details_not_prepared", state.message || FAILED, undefined, { notify: true, source: "Your V" });
      if (updating) throw Object.assign(Error(state.message || "The change could not be prepared."), { plain: state.message ? `${UPDATE_FAILED} ${state.message}` : UPDATE_FAILED });
      this.port.clear();
      this.shown = null;
      this.publish({ phase: "failed", source: request.source, message: state.message || FAILED, notice: null, progress: null,
        slots: DETAIL_SLOTS.map(slot => ({ slot, state: "unavailable", label: "" })), updating: false, updateError: null, choices: 0, drawn: [] });
      return;
    }
    const shown = await this.port.show(state.record, signal);
    if (signal.aborted) return;
    this.shown = request;
    const slots = DETAIL_SLOTS.map(slot => shown.slots.find(entry => entry.slot === slot) ?? { slot, state: "none" as const, label: "None" });
    // The host's own line first (what the V is shown without), then unavailable slots, then shown slots with a line of their own.
    const lines = [...(state.message ? [state.message] : []), ...[...slots.filter(slot => slot.state === "unavailable" && slot.message),
      ...slots.filter(slot => slot.state === "shown" && slot.message)].map(slot => slot.message!)];
    this.publish({ phase: "ready", source: request.source, message: lines.join(" "), notice: null, progress: null, slots,
      updating: false, updateError: null, choices: request.choices?.length ?? 0, drawn: shown.drawn ?? [] });
  }

  /** Stop following and remove the details (the head is being released). */
  dispose() {
    this.disposed = true;
    this.current?.controller.abort();
    this.current = null;
    this.asked = null;
    this.listeners.clear();
  }
}
