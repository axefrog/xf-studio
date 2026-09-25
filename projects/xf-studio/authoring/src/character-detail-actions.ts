/**
 * Application service for the preview's resolved character details (head skin, face details, eyes, brows, lashes, hair and piercings).
 * DOM-free: it asks the host to prepare the current V (the creator default, or the loaded save), follows the
 * preparation, has the renderer device swap the result in, and publishes a read-only status.
 *
 * Switching V replaces the character completely: the previous V's details leave the scene at once, and
 * a preparation or load for an older V can never land after a newer one was asked for. A slot the new V
 * does not have, or that cannot be resolved, is empty with one plain line.
 *
 * A viewer may try a creator choice on the shown V (a piercing style and colour; `setOverride`): the host resolves the V with that
 * choice in place of its own, exactly as the game would draw it. Trying another choice keeps the V on screen until the new record
 * swaps in; the choices on offer come with each record.
 */
import { characterRequestFor, sameCharacter, type CharacterOverride, type CharacterRequest } from "./character-detail-request";
import type { SavedV } from "./save-reader";
import type { DetailSlot, DetailSlotState, RenderChoices } from "./render-detail";
import { DETAIL_SLOTS } from "./render-detail";
import type { DetailLimit } from "./detail-limits";

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
   * Load a prepared record and swap it into the scene, replacing whatever was there; returns per-slot outcomes,
   * with the limit codes of a shown slot the preview draws only in part.
   */
  show(record: string, signal: AbortSignal): Promise<{ slots: (DetailSlotState & { limits?: DetailLimit[] })[]; choices?: RenderChoices[];
    /** The tried choice the record was resolved with (the host ignores one the installation doesn't offer). */
    override?: CharacterOverride | null }>;
  /** Remove every resolved detail from the scene. */
  clear(): void;
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
  progress: { index: number; total: number; label: string } | null;
  slots: CharacterSlotStatus[];
  /** The creator choices a viewer may try on the shown V (from the last shown record; kept while the next one prepares). */
  choices: RenderChoices[];
  /** The tried choice the shown record was resolved with, if any. */
  override: CharacterOverride | null;
};

const POLL_MS = 600;
const FAILED = "Your V's own skin, face details, eyes, brows, lashes, hair and piercings couldn't be prepared, so they aren't shown. The head still works.";
const pending = (): CharacterSlotStatus[] => DETAIL_SLOTS.map(slot => ({ slot, state: "pending", label: "" }));

export class CharacterDetailActions {
  private status: CharacterDetailStatus = { phase: "idle", source: null, message: "", progress: null, slots: pending(), choices: [], override: null };
  private listeners = new Set<() => void>();
  private current: { key: string; request: CharacterRequest; controller: AbortController } | null = null;
  /** The V asked for (without a tried choice), and the choice being tried on it. */
  private base: CharacterRequest | null = null;
  private tried: CharacterOverride | null = null;
  private disposed = false;
  constructor(private readonly port: CharacterDetailPort) {}

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  snapshot(): Readonly<CharacterDetailStatus> { return structuredClone(this.status); }
  private publish(next: CharacterDetailStatus) { this.status = next; for (const listener of this.listeners) listener(); }

  /**
   * Show the details of `request` (the V; the choice being tried is added). The same character again is a no-op (unless it failed,
   * which retries); a different V clears the previous details first and supersedes any preparation still running for it.
   */
  setCharacter(request: CharacterRequest): Promise<void> {
    const { override: _ignored, ...base } = request;
    this.base = base as CharacterRequest;
    return this.show();
  }

  /** Try a creator choice on the shown V (null: the V's own). Its record replaces the shown one when ready, without clearing it first. */
  setOverride(override: CharacterOverride | null): Promise<void> {
    this.tried = override ? { ...override } : null;
    return this.base ? this.show() : Promise.resolve();
  }
  /** The choice being tried, if any. */
  override(): CharacterOverride | null { return this.tried ? { ...this.tried } : null; }

  private show(): Promise<void> {
    if (this.disposed || !this.base) return Promise.resolve();
    const request: CharacterRequest = this.tried ? { ...this.base, override: { ...this.tried } } : this.base;
    const key = JSON.stringify(request);
    if (this.current?.key === key && this.status.phase !== "failed") return Promise.resolve();
    // Only another V clears the scene: a tried choice on the same V keeps it until the new record swaps in.
    const sameV = !!this.current && sameCharacter(this.current.request, request) && this.status.phase !== "failed";
    this.current?.controller.abort();
    const controller = new AbortController();
    this.current = { key, request, controller };
    // Nothing of the previous V may linger while the new one prepares.
    if (!sameV) this.port.clear();
    this.publish({ phase: "preparing", source: request.source, message: "", progress: null, slots: sameV ? this.status.slots : pending(),
      choices: sameV ? this.status.choices : [], override: sameV ? this.status.override : null });
    return this.follow(request, controller.signal).catch(error => {
      if (controller.signal.aborted || this.disposed) return;
      this.port.clear();
      console.error(error);
      this.publish({ phase: "failed", source: request.source, message: FAILED, progress: null,
        slots: DETAIL_SLOTS.map(slot => ({ slot, state: "unavailable", label: "" })), choices: [], override: null });
    });
  }

  private async follow(request: CharacterRequest, signal: AbortSignal) {
    let state = await this.port.request(request, signal);
    for (let attempts = 0; state.phase === "preparing" || state.phase === "unknown"; attempts++) {
      if (signal.aborted) return;
      if (state.phase === "preparing") this.publish({ ...this.status, progress: state.progress });
      await this.port.wait(POLL_MS, signal);
      if (signal.aborted) return;
      // The host forgets a request it cancelled or never saw (a restart): ask again.
      state = state.phase === "unknown" || attempts % 50 === 49 ? await this.port.request(request, signal) : await this.port.poll(state.key, signal);
    }
    if (signal.aborted) return;
    if (state.phase === "failed" || !state.record) {
      this.port.clear();
      this.publish({ phase: "failed", source: request.source, message: state.message || FAILED, progress: null,
        slots: DETAIL_SLOTS.map(slot => ({ slot, state: "unavailable", label: "" })), choices: [], override: null });
      return;
    }
    const shown = await this.port.show(state.record, signal);
    if (signal.aborted) return;
    const slots = DETAIL_SLOTS.map(slot => shown.slots.find(entry => entry.slot === slot) ?? { slot, state: "none" as const, label: "None" });
    // Unavailable slots first, then shown slots with a line of their own from the record.
    const lines = [...slots.filter(slot => slot.state === "unavailable" && slot.message), ...slots.filter(slot => slot.state === "shown" && slot.message)]
      .map(slot => slot.message!);
    this.publish({ phase: "ready", source: request.source, message: lines.join(" "), progress: null, slots, choices: shown.choices ?? [],
      override: shown.override ?? null });
  }

  /** Stop following and remove the details (the head is being released). */
  dispose() {
    this.disposed = true;
    this.current?.controller.abort();
    this.current = null;
    this.listeners.clear();
  }
}

/**
 * Keep the details on the shown V: the saved-appearance service's current save (restored after a reload,
 * or newly loaded), else the creator's default female V. Returns the unsubscribe.
 */
export function followShownCharacter(details: CharacterDetailActions,
  saved: { snapshot(): { readonly savedV?: SavedV }; subscribe(listener: () => void): () => unknown }): () => void {
  const follow = () => { void details.setCharacter(characterRequestFor(saved.snapshot().savedV)); };
  const stop = saved.subscribe(follow);
  follow();
  return () => { stop(); };
}
