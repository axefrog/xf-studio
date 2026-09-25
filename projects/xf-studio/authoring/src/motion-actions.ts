import type { PreviewState } from "./workspace-state";
import { refusal, type Capability } from "./platform/api";

export type MotionState = Pick<PreviewState,
  "idle" | "idleTime" | "idlePaused" | "idleBody" | "idleFace" | "blink" | "blinkPlaying"> &
  { available: boolean; error?: string };
export type MotionAction =
  | { kind: "motion.setIdle"; enabled: boolean }
  | { kind: "motion.setPaused"; paused: boolean }
  | { kind: "motion.setContributions"; body: boolean; face: boolean }
  | { kind: "motion.setBlink"; value: number }
  | { kind: "motion.playBlink"; playing: boolean };
export type MotionPort = {
  available: boolean; error?: string;
  idle?: { enabled: boolean; time: number; paused: boolean; bodyEnabled: boolean; faceEnabled: boolean; seek(time: number): void };
  setIdle(enabled: boolean): void; setIdlePaused(paused: boolean): void;
  setIdleContributions(body: boolean, face: boolean): void;
  setBlink(value: number): void; animateBlink(playing: boolean): void;
};

/** Preview motion commands and persistence state without markup or Three objects. */
export class MotionActions {
  private blink: number;
  private blinkPlaying: boolean;
  private listeners = new Set<() => void>();
  constructor(private initial: PreviewState, private port: MotionPort) {
    this.blink = initial.blink; this.blinkPlaying = initial.blinkPlaying;
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify() { for (const listener of this.listeners) listener(); }
  snapshot(): Readonly<MotionState> {
    const idle = this.port.idle;
    return { available: this.port.available, error: this.port.error,
      idle: idle?.enabled ?? false, idleTime: idle?.time ?? this.initial.idleTime,
      idlePaused: idle?.paused ?? this.initial.idlePaused,
      idleBody: idle?.bodyEnabled ?? this.initial.idleBody,
      idleFace: idle?.faceEnabled ?? this.initial.idleFace,
      blink: this.blink, blinkPlaying: this.blinkPlaying };
  }
  capability(action: MotionAction): Capability {
    if (action.kind === "motion.setBlink" && (!Number.isFinite(action.value) || action.value < 0 || action.value > 1))
      return refusal("invalid_value", "Eyelid closure must be between 0 and 1.");
    if ((action.kind === "motion.setIdle" && action.enabled || action.kind === "motion.setPaused" ||
      action.kind === "motion.setContributions") && !this.port.available)
      return refusal("asset_unavailable", this.port.error ?? "Game idle is unavailable.");
    if (action.kind === "motion.setPaused" && !this.snapshot().idle)
      return refusal("invalid_value", "Enable the game idle before pausing it.");
    // Kept as the code the facade gave this refusal before codes were structured (see the code-health ledger).
    if ((action.kind === "motion.setBlink" || action.kind === "motion.playBlink") && this.snapshot().idle)
      return refusal("asset_unavailable", "Blink study is unavailable while the game idle is active.");
    return { available: true };
  }
  /** Restore composition before clock and camera; pause never passes through the reset path. */
  restore() {
    this.port.setIdleContributions(this.initial.idleBody, this.initial.idleFace);
    this.port.setIdle(this.initial.idle && this.port.available);
    if (this.port.idle?.enabled) {
      this.port.idle.seek(this.initial.idleTime);
      this.port.setIdlePaused(this.initial.idlePaused);
      this.blink = 0; this.blinkPlaying = false;
    } else {
      this.port.setBlink(this.initial.blink);
      this.port.animateBlink(this.initial.blinkPlaying);
    }
    this.notify();
  }
  dispatch(action: MotionAction) {
    const capability = this.capability(action);
    if (!capability.available) throw Error(capability.reason);
    switch (action.kind) {
      case "motion.setIdle":
        this.port.setIdle(action.enabled); this.blink = 0; this.blinkPlaying = false; break;
      case "motion.setPaused": this.port.setIdlePaused(action.paused); break;
      case "motion.setContributions": this.port.setIdleContributions(action.body, action.face); break;
      case "motion.setBlink": this.port.setBlink(action.value); this.blink = action.value; this.blinkPlaying = false; break;
      case "motion.playBlink": this.port.animateBlink(action.playing); this.blinkPlaying = action.playing; break;
    }
    this.notify();
  }
}
