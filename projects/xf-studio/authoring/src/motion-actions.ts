import type { ViewId } from "./platform/api/view-graph";
import type { PreviewState } from "./workspace-state";
import { refusal, type Capability } from "./platform/api";
import { BLINK_REPEAT_SECONDS, GAME_BLINK_MISSING } from "./game-blink-messages";
import { pageFailure } from "./diagnostics/page-sink";
import { DEFAULT_IDLE, type IdleEntry } from "./idle-catalogue";

/**
 * Why the idle is off, in plain words (UI-88). The rig's own error (an exception's text) goes to the diagnostics log once, where a
 * problem report can show it; a person never sees it.
 */
export const IDLE_UNAVAILABLE = "The character creator's idle couldn't be prepared from your game files, so your V holds still. Everything else works.";

/** One of the game's preview idles as the Motion controls offer it. */
export type IdleChoice = Pick<IdleEntry, "id" | "label" | "screen" | "puppet" | "clip">;
export type MotionState = Pick<PreviewState,
  "idle" | "idleTime" | "idlePaused" | "idleBody" | "idleFace" | "blink" | "blinkPlaying"> &
  { available: boolean; error?: string; blinkAvailable: boolean; blinkError?: string;
    /**
     * Which of the game's preview idles plays while the idle is on (idle-catalogue.ts), the idles prepared on this computer, and whether the
     * chosen one is still loading (the previous one keeps playing meanwhile).
     */
    idleClip: string; idles: readonly IdleChoice[]; idleLoading: boolean;
    /** How often Play blink repeats (a Studio choice: the idle's average blink spacing). */
    blinkRepeatSeconds: number };
/** A motion action may name the view whose scene it moves (view-graph-design.md §3.8); without one, the focused view's. */
export type MotionAction = MotionActionBody & { view?: ViewId };
type MotionActionBody =
  | { kind: "motion.setIdle"; enabled: boolean }
  /** Which of the game's preview idles plays (the body source while the idle is on; "Still" is the idle off). */
  | { kind: "motion.setIdleClip"; clip: string }
  | { kind: "motion.setPaused"; paused: boolean }
  | { kind: "motion.setContributions"; body: boolean; face: boolean }
  | { kind: "motion.setBlink"; value: number }
  | { kind: "motion.playBlink"; playing: boolean };
export type MotionPort = {
  available: boolean; error?: string;
  /** The game's blink (game-blink.ts): whether it was prepared on this computer, the plain reason when not, and its repeat. */
  blink: { available: boolean; error?: string; repeatSeconds?: number };
  idle?: { enabled: boolean; time: number; paused: boolean; bodyEnabled: boolean; faceEnabled: boolean; seek(time: number): void };
  /** The game's preview idles prepared on this computer, and how to play one (absent: the close-up idle alone). */
  idles?: readonly IdleEntry[]; selectIdle?(id: string): Promise<void>;
  setIdle(enabled: boolean): void; setIdlePaused(paused: boolean): void;
  setIdleContributions(body: boolean, face: boolean): void;
  setBlink(value: number): void; animateBlink(playing: boolean): void;
};

/** Preview motion commands and persistence state without markup or Three objects. */
export class MotionActions {
  private blink: number;
  private blinkPlaying: boolean;
  private listeners = new Set<() => void>();
  /** The idle shown (optimistic while its clip loads) and the load in flight, if any. */
  private clip: string;
  private loading: Promise<void> | null = null;
  constructor(private initial: PreviewState, private port: MotionPort) {
    this.blink = initial.blink; this.blinkPlaying = initial.blinkPlaying;
    this.clip = this.known(initial.idleClip) ? initial.idleClip! : this.defaultClip();
    if (!port.available && port.error) pageFailure("preview", "idle_unavailable", IDLE_UNAVAILABLE, Error(port.error), { level: "warn" });
  }
  private idleEntries(): readonly IdleEntry[] { return this.port.idles ?? []; }
  private known(id: string | undefined): boolean { return !!id && this.idleEntries().some(entry => entry.id === id); }
  private defaultClip(): string { return this.known(DEFAULT_IDLE) ? DEFAULT_IDLE : this.idleEntries()[0]?.id ?? DEFAULT_IDLE; }
  /** The chosen idle's catalogue entry (undefined without a catalogue). */
  idleEntry(): IdleEntry | undefined { return this.idleEntries().find(entry => entry.id === this.clip); }
  /** Play an idle: shown at once, loaded behind; a load that fails puts the previous one back and says why once. */
  private select(id: string, rollbackTo: string | null) {
    this.clip = id;
    const load = this.port.selectIdle ? this.port.selectIdle(id) : Promise.resolve();
    const pending = this.loading = load.then(() => { if (this.loading === pending) this.loading = null; this.notify(); }, error => {
      if (this.loading === pending) this.loading = null;
      if (rollbackTo !== null && this.clip === id) this.clip = rollbackTo;
      pageFailure("preview", "idle_clip_unavailable", "That idle couldn't be played from its prepared files, so the previous one stays.", error, { level: "warn" });
      this.notify();
    });
  }
  /** The plain reason the idle is off, or undefined while it is available. */
  private idleError() { return this.port.available ? undefined : IDLE_UNAVAILABLE; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify() { for (const listener of this.listeners) listener(); }
  snapshot(): Readonly<MotionState> {
    const idle = this.port.idle;
    return { available: this.port.available, error: this.idleError(),
      idle: idle?.enabled ?? false, idleTime: idle?.time ?? this.initial.idleTime,
      idlePaused: idle?.paused ?? this.initial.idlePaused,
      idleBody: idle?.bodyEnabled ?? this.initial.idleBody,
      idleFace: idle?.faceEnabled ?? this.initial.idleFace,
      blink: this.blink, blinkPlaying: this.blinkPlaying,
      blinkAvailable: this.port.blink.available, blinkError: this.blinkError(),
      idleClip: this.clip, idleLoading: !!this.loading,
      idles: this.idleEntries().map(({ id, label, screen, puppet, clip }) => ({ id, label, screen, puppet, clip })),
      blinkRepeatSeconds: this.port.blink.repeatSeconds ?? BLINK_REPEAT_SECONDS };
  }
  private blinkError() {
    return this.port.blink.available ? undefined : this.port.blink.error || GAME_BLINK_MISSING;
  }
  capability(action: MotionAction): Capability {
    if (action.kind === "motion.setBlink" && (!Number.isFinite(action.value) || action.value < 0 || action.value > 1))
      return refusal("invalid_value", "Eyelid closure must be between 0 and 1.");
    if ((action.kind === "motion.setIdle" && action.enabled || action.kind === "motion.setPaused" ||
      action.kind === "motion.setContributions") && !this.port.available)
      return refusal("asset_unavailable", IDLE_UNAVAILABLE);
    if (action.kind === "motion.setIdleClip" && !this.port.available) return refusal("asset_unavailable", IDLE_UNAVAILABLE);
    if (action.kind === "motion.setIdleClip" && !this.known(action.clip))
      return refusal("invalid_value", "That idle isn't one of the game's idles prepared on this computer.");
    if (action.kind === "motion.setPaused" && !this.snapshot().idle)
      return refusal("invalid_value", "Enable the game idle before pausing it.");
    const blinking = action.kind === "motion.setBlink" || action.kind === "motion.playBlink";
    if (blinking && !this.port.blink.available)
      return refusal("asset_unavailable", this.blinkError()!);
    // Kept as the code the facade gave this refusal before codes were structured (see the code-health ledger).
    if (blinking && this.snapshot().idle)
      return refusal("asset_unavailable", "Blink is off while the game idle plays: the idle blinks on its own.");
    return { available: true };
  }
  /** Restore composition before clock and camera; pause never passes through the reset path. */
  restore() {
    this.port.setIdleContributions(this.initial.idleBody, this.initial.idleFace);
    // The workspace's idle first (its clip loads behind; the default plays until it arrives).
    if (this.port.available && this.clip !== this.defaultClip()) this.select(this.clip, this.defaultClip());
    this.port.setIdle(this.initial.idle && this.port.available);
    if (this.port.idle?.enabled) {
      this.port.idle.seek(this.initial.idleTime);
      this.port.setIdlePaused(this.initial.idlePaused);
      this.blink = 0; this.blinkPlaying = false;
    } else if (this.port.blink.available) {
      this.port.setBlink(this.initial.blink);
      this.port.animateBlink(this.initial.blinkPlaying);
    } else { this.blink = 0; this.blinkPlaying = false; }
    this.notify();
  }
  dispatch(action: MotionAction) {
    const capability = this.capability(action);
    if (!capability.available) throw Error(capability.reason);
    switch (action.kind) {
      case "motion.setIdle":
        this.port.setIdle(action.enabled); this.blink = 0; this.blinkPlaying = false; break;
      case "motion.setIdleClip": if (action.clip !== this.clip) this.select(action.clip, this.clip); break;
      case "motion.setPaused": this.port.setIdlePaused(action.paused); break;
      case "motion.setContributions": this.port.setIdleContributions(action.body, action.face); break;
      case "motion.setBlink": this.port.setBlink(action.value); this.blink = action.value; this.blinkPlaying = false; break;
      case "motion.playBlink": this.port.animateBlink(action.playing); this.blinkPlaying = action.playing; break;
    }
    this.notify();
  }
}
