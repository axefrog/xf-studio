/**
 * Application service for the preview's resolved character details (head skin, face details, eyes, brows, lashes, hair and piercings).
 * DOM-free: it asks the host to prepare the current V (the creator default, or the loaded save), follows the
 * preparation, has the renderer device swap the result in, and publishes a read-only status.
 *
 * Switching V replaces the character completely: the previous V's details leave the scene at once, and
 * a preparation or load for an older V can never land after a newer one was asked for. A slot the new V
 * does not have, or that cannot be resolved, is empty with one plain line.
 *
 * It owns the creator choice a viewer tries on the shown V (a piercing style and colour; UI-48): the typed `character.tryChoice`
 * action (`check`, `dispatch`), its validation against the choices the shown V's record offers, and its persisted value (UI-51). The
 * persisted choice is read with the host's own rules (`validOverride`), re-validated when the V's choices arrive (a choice this
 * installation no longer offers is cleared, never sent again), and cleared when another V is loaded: a tried style belongs to the V it
 * was tried on. The host resolves the V with that choice exactly as the game would draw it. A try keeps the V fully on screen and
 * interactive: the status stays `ready` with a `trying` entry the presentation shows beside the control, and the device swaps in only
 * what changed (PREV-68). The full "preparing" status is for a V's first preparation only.
 */
import { characterRequestFor, sameCharacter, validOverride, type CharacterOverride, type CharacterRequest } from "./character-detail-request";
import type { SavedV } from "./save-reader";
import type { ChoiceSlot, DetailSlot, DetailSlotState, RenderChoices } from "./render-detail";
import { CHOICE_SLOTS, DETAIL_SLOTS, isChoiceName } from "./render-detail";
import type { DetailLimit, DetailNotice } from "./detail-limits";
import { refusal, type Capability, type ReasonCode } from "./platform/api";

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
  /** Why nothing is shown, as a code the presentation words (a host of another version); null otherwise. */
  notice: DetailNotice | null;
  progress: { index: number; total: number; label: string } | null;
  slots: CharacterSlotStatus[];
  /** The creator choices a viewer may try on the shown V (from the last shown record; kept while the next one prepares). */
  choices: RenderChoices[];
  /** The tried choice the shown record was resolved with, if any. */
  override: CharacterOverride | null;
  /** The choice the viewer is trying (persisted with the workspace), whether or not its record is shown yet. */
  tried: CharacterOverride | null;
  /** A tried choice whose record is still being prepared, while the V stays on screen. */
  trying: CharacterOverride | null;
};
/** Try a creator choice on the shown V: `choice` is a switcher choice's `localizedName` from the V's choices, or "" for the V's own. */
export type CharacterAction = { kind: "character.tryChoice"; slot: ChoiceSlot; choice: string; definition: string };
export type CharacterCapability = Capability & { code?: ReasonCode };

const POLL_MS = 600;
const FAILED = "Your V's own skin, face details, eyes, brows, lashes, hair and piercings couldn't be prepared, so they aren't shown. The head still works.";
const TRY_FAILED = "That piercing style couldn't be prepared, so your V's own piercings are shown.";
const pending = (): CharacterSlotStatus[] => DETAIL_SLOTS.map(slot => ({ slot, state: "pending", label: "" }));
const sameChoice = (a: CharacterOverride | null, b: CharacterOverride | null) =>
  a === b || (!!a && !!b && a.slot === b.slot && a.choice === b.choice && a.definition === b.definition);
const offers = (choices: readonly RenderChoices[], choice: CharacterOverride) =>
  !!choices.find(entry => entry.slot === choice.slot)?.options.find(option => option.choice === choice.choice)
    ?.definitions.some(definition => definition.name === choice.definition);

export class CharacterDetailActions {
  private status: CharacterDetailStatus = { phase: "idle", source: null, message: "", notice: null, progress: null, slots: pending(), choices: [],
    override: null, tried: null, trying: null };
  private listeners = new Set<() => void>();
  private current: { key: string; request: CharacterRequest; controller: AbortController } | null = null;
  /** The V asked for (without a tried choice), and the choice being tried on it. */
  private base: CharacterRequest | null = null;
  private tried: CharacterOverride | null;
  private disposed = false;
  /** `initialTried` is the persisted choice (the workspace's), read with the host's rules; anything else is dropped. */
  constructor(private readonly port: CharacterDetailPort, initialTried?: unknown) {
    this.tried = validOverride(initialTried);
    this.status.tried = this.tried ? { ...this.tried } : null;
  }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  snapshot(): Readonly<CharacterDetailStatus> { return structuredClone(this.status); }
  private publish(next: Omit<CharacterDetailStatus, "tried">) {
    this.status = { ...next, tried: this.tried ? { ...this.tried } : null };
    for (const listener of this.listeners) listener();
  }

  /**
   * Show the details of `request` (the V; the choice being tried is added). The same character again is a no-op (unless it failed,
   * which retries); a different V clears the previous details first, supersedes any preparation still running for it and drops the
   * choice tried on the previous V.
   */
  setCharacter(request: CharacterRequest): Promise<void> {
    const { override: _ignored, ...base } = request;
    if (this.base && !sameCharacter(this.base, base as CharacterRequest)) this.tried = null;
    this.base = base as CharacterRequest;
    return this.show();
  }

  /** Whether `character.tryChoice` may run now, with a coded reason when not. Revalidated at dispatch. */
  check(action: CharacterAction): CharacterCapability {
    if (action.kind !== "character.tryChoice" || !CHOICE_SLOTS.includes(action.slot)) return refusal("invalid_value", "That creator choice can't be tried.");
    if (this.disposed || !this.base) return refusal("not_ready", "Your V's details are still loading.");
    if (action.choice === "") return { available: true };
    if (!isChoiceName(action.choice) || !isChoiceName(action.definition)) return refusal("invalid_value", "That piercing style or colour name isn't valid.");
    if (!offers(this.status.choices, { slot: action.slot, choice: action.choice, definition: action.definition }))
      return refusal("unavailable", "That piercing style or colour isn't offered by your installed game and mods.");
    return { available: true };
  }
  /** Try a creator choice on the shown V ("" for the V's own). Its record replaces the shown one when ready, keeping the V on screen. */
  dispatch(action: CharacterAction): Record<string, never> {
    const allowed = this.check(action);
    if (!allowed.available) throw Error(allowed.reason);
    void this.setOverride(action.choice ? { slot: action.slot, choice: action.choice, definition: action.definition } : null);
    return {};
  }

  /** Try a creator choice on the shown V (null: the V's own). Prefer `dispatch`, which validates it against the V's choices. */
  setOverride(override: CharacterOverride | null): Promise<void> {
    this.tried = override ? validOverride(override) : null;
    if (!this.base) { this.publish({ ...this.status }); return Promise.resolve(); }
    return this.show();
  }
  /** The choice being tried, if any. */
  override(): CharacterOverride | null { return this.tried ? { ...this.tried } : null; }

  private request(): CharacterRequest {
    return this.tried ? { ...this.base!, override: { ...this.tried } } : this.base!;
  }

  private show(): Promise<void> {
    if (this.disposed || !this.base) return Promise.resolve();
    const request = this.request();
    const key = JSON.stringify(request);
    if (this.current?.key === key && this.status.phase !== "failed") { this.publish({ ...this.status }); return Promise.resolve(); }
    // Only another V clears the scene: a tried choice on the same V keeps it, fully interactive, until the new record swaps in.
    const sameV = !!this.current && sameCharacter(this.current.request, request) && this.status.phase === "ready";
    this.current?.controller.abort();
    const controller = new AbortController();
    this.current = { key, request, controller };
    if (sameV) this.publish({ ...this.status, trying: request.override ? { ...request.override } : null });
    else {
      // Nothing of the previous V may linger while the new one prepares.
      this.port.clear();
      this.publish({ phase: "preparing", source: request.source, message: "", notice: null, progress: null, slots: pending(), choices: [],
        override: null, trying: null });
    }
    return this.follow(request, controller.signal, sameV).catch(error => {
      if (controller.signal.aborted || this.disposed) return;
      console.error(error);
      const notice = (error as { notice?: DetailNotice })?.notice ?? null;
      if (sameV && !notice && request.override) {
        // A try that can't be prepared falls back to the V's own, which is already known to the host.
        this.tried = null;
        this.publish({ ...this.status, message: TRY_FAILED, trying: null });
        void this.show();
        return;
      }
      this.port.clear();
      this.publish({ phase: "failed", source: request.source, message: notice ? "" : FAILED, notice, progress: null,
        slots: DETAIL_SLOTS.map(slot => ({ slot, state: "unavailable", label: "" })), choices: [], override: null, trying: null });
    });
  }

  private async follow(request: CharacterRequest, signal: AbortSignal, trying: boolean) {
    let state = await this.port.request(request, signal);
    for (let attempts = 0; state.phase === "preparing" || state.phase === "unknown"; attempts++) {
      if (signal.aborted) return;
      if (state.phase === "preparing" && !trying) this.publish({ ...this.status, progress: state.progress });
      await this.port.wait(POLL_MS, signal);
      if (signal.aborted) return;
      // The host forgets a request it cancelled or never saw (a restart): ask again.
      state = state.phase === "unknown" || attempts % 50 === 49 ? await this.port.request(request, signal) : await this.port.poll(state.key, signal);
    }
    if (signal.aborted) return;
    if (state.phase === "failed" || !state.record) {
      if (trying) throw Error(state.message || "The tried choice could not be prepared.");
      this.port.clear();
      this.publish({ phase: "failed", source: request.source, message: state.message || FAILED, notice: null, progress: null,
        slots: DETAIL_SLOTS.map(slot => ({ slot, state: "unavailable", label: "" })), choices: [], override: null, trying: null });
      return;
    }
    const shown = await this.port.show(state.record, signal);
    if (signal.aborted) return;
    const slots = DETAIL_SLOTS.map(slot => shown.slots.find(entry => entry.slot === slot) ?? { slot, state: "none" as const, label: "None" });
    // Unavailable slots first, then shown slots with a line of their own from the record.
    const lines = [...slots.filter(slot => slot.state === "unavailable" && slot.message), ...slots.filter(slot => slot.state === "shown" && slot.message)]
      .map(slot => slot.message!);
    const choices = shown.choices ?? [], applied = shown.override ?? null;
    // The persisted choice is checked against what this installation offers now: one it no longer offers (or the host ignored) is
    // cleared, and the shown record (the V's own) is kept as the answer for the plain V.
    if (this.tried && (!sameChoice(applied, this.tried) || !offers(choices, this.tried))) {
      this.tried = null;
      const base = this.base && sameCharacter(this.base, request) ? this.base : null;
      if (base && !applied && this.current?.request === request) this.current = { ...this.current, key: JSON.stringify(base), request: base };
    }
    this.publish({ phase: "ready", source: request.source, message: lines.join(" "), notice: null, progress: null, slots, choices,
      override: applied, trying: null });
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
