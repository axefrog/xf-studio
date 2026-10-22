import { MAIN_VIEW, type ViewId } from "../platform/api/view-graph";
/** Why a view action naming a view whose scene isn't drawn is refused (phase 1 draws one view). */
export const NOT_DRAWN = "That 3D view isn't drawn now, so this can't change it.";
import type { PreviewState } from "../app/workspace/workspace-state";
import { localMotionScene, withMotion, type MotionScene, type SceneMotion } from "./scene-motion";
import { refusal, type Capability } from "../platform/api";
import { BLINK_REPEAT_SECONDS, GAME_BLINK_MISSING, IDLE_FACE_MISSING, IDLE_MASCULINE } from "./game-blink-messages";
import { pageFailure } from "../diagnostics/page-sink";
import { DEFAULT_IDLE, type IdleEntry } from "./idle-catalogue";
import type { PoseSample } from "./pose-sample";
import type { PosePlacement } from "./pose-sample";

/** A photo-mode pose as the body source (pose-library-design.md §5.2): its record, label and whether it moves. */
export type MotionPose = { readonly id: string; readonly label: string; readonly moves: boolean };

/**
 * Why the idle is off, in plain words (UI-88). The rig's own error (an exception's text) goes to the diagnostics log once, where a
 * problem report can show it; a person never sees it. It doesn't blame the person's game files (DESK-03): the idle is read by XF Studio.
 */
export const IDLE_UNAVAILABLE = "XF Studio couldn't read the character creator's idle, so your V holds still. Everything else works.";
/** Why hair physics can't be turned on, in plain words (hair-physics-plan.md §3.6). */
export const PHYSICS_NO_DANGLES = "This hairstyle has no physics in the game.";
export const PHYSICS_UNSUPPORTED = "This hairstyle's physics can't run here yet.";
/**
 * Hair physics runs on the idle's rig, so without the idle it can't run. Said without claiming a failure: for a masculine V the idle isn't
 * part of this version (`PHYSICS_MASCULINE`), and otherwise the idle simply isn't there to use.
 */
export const PHYSICS_NO_RIG = "Needs the idle, which isn't available.";
export const PHYSICS_MASCULINE = "Needs the idle, which isn't part of this version for a masculine V yet.";
export const PHYSICS_WAITING = "Available once your V's hair has loaded.";
export { IDLE_FACE_MISSING, IDLE_MASCULINE };

/** One of the game's preview idles as the Motion controls offer it. */
export type IdleChoice = Pick<IdleEntry, "id" | "label" | "screen" | "puppet" | "clip">;
export type MotionState = Pick<PreviewState,
  "idle" | "idleTime" | "idlePaused" | "idleBody" | "idleFace" | "blink" | "blinkPlaying"> &
  { available: boolean; error?: string; blinkAvailable: boolean; blinkError?: string;
    /** Whether the idle moves V's face too (a face clip was prepared on this computer), and the plain reason when only her body moves. */
    faceAvailable: boolean; faceError?: string;
    /**
     * Which of the game's preview idles plays while the idle is on (idle-catalogue.ts), the idles prepared on this computer, and whether the
     * chosen one is still loading (the previous one keeps playing meanwhile).
     */
    idleClip: string; idles: readonly IdleChoice[]; idleLoading: boolean;
    /**
     * The photo-mode pose V holds (the body source while set; the idle's rig plays it), and whether it is still loading (the previous body
     * source shows meanwhile). Set by the Poses module (`holdPose`); Still or an idle replaces it.
     */
    pose: MotionPose | null; poseLoading: boolean;
    /** How often Play blink repeats (a Studio choice: the idle's average blink spacing). */
    blinkRepeatSeconds: number;
    /**
     * Hair physics (the scene's dangle simulation): on or off, whether it can be turned on and why not, and how many drawn parts it moves.
     * Off by default until the in-game calibration (hair-physics-plan.md §3.6).
     */
    physics: boolean; physicsAvailable: boolean; physicsReason?: string; physicsParts: number };
/** A motion action names the view whose scene it moves (profiles design §3.6); `motion.setPhysics` names the scene's `gen` too. */
export type MotionAction = MotionActionBody & { view: ViewId; scene?: string; sceneGen?: number };
type MotionActionBody =
  | { kind: "motion.setIdle"; enabled: boolean }
  /** Which of the game's preview idles plays (the body source while the idle is on; "Still" is the idle off). */
  | { kind: "motion.setIdleClip"; clip: string }
  | { kind: "motion.setPaused"; paused: boolean }
  | { kind: "motion.setContributions"; body: boolean; face: boolean }
  | { kind: "motion.setBlink"; value: number }
  | { kind: "motion.playBlink"; playing: boolean }
  /** Simulate the scene's dangles (hair and worn items with physics): a scene-node setting (hair-physics-plan.md §3.6). */
  | { kind: "motion.setPhysics"; enabled: boolean };
export type MotionPort = {
  available: boolean; error?: string;
  /** Whether the idle moves the face, and the plain reason when it doesn't (absent: it does whenever the idle is available). */
  face?: { available: boolean; error?: string };
  /** Listen for the idle's face arriving after the scene started (`face` and `idles` change); returns the unsubscribe. */
  onFaceChange?(listener: () => void): () => void;
  /** The game's blink (game-blink.ts): whether it was prepared on this computer, the plain reason when not, and its repeat. */
  blink: { available: boolean; error?: string; repeatSeconds?: number };
  idle?: { enabled: boolean; time: number; paused: boolean; bodyEnabled: boolean; faceEnabled: boolean; seek(time: number): void };
  /** The game's preview idles prepared on this computer, and how to play one (absent: the close-up idle alone). */
  idles?: readonly IdleEntry[]; selectIdle?(id: string): Promise<void>;
  setIdle(enabled: boolean): void; setIdlePaused(paused: boolean): void;
  setIdleContributions(body: boolean, face: boolean): void;
  setBlink(value: number): void; animateBlink(playing: boolean): void;
  /** Hold a pose on the idle's rig, or stop holding one (scene-host.ts `setPose`); absent: poses can't play on this host. */
  setPose?(pose: { sample: PoseSample; placement?: PosePlacement } | null): Promise<void>;
  /** The drawn parts' dangle components (idle-animation.ts): how many, and whether any of them simulates. Absent: no idle rig. */
  dangles?(): { parts: number; simulated: boolean; loaded?: boolean };
};
/** Why a released motion service refuses (its head is being replaced; the next one takes the actions). */
export const RELEASED = "The 3D view is loading again; try again in a moment.";
/** Why a pose can't be held, in plain words. */
export const POSE_UNAVAILABLE = "Poses play on V's idle, which XF Studio couldn't read, so she holds still.";
export type { MotionScene } from "./scene-motion";

/**
 * Preview motion commands without markup or Three objects. The settings (idle on or off, its phase, pause and contributions, the idle
 * played, the blink and the pose) are the drawn scene's, kept in its view-graph node through `scene` (scene-motion.ts): this service
 * reads them there, applies them to the device on `restore`, and stores each change back, recording no Undo step. What it keeps itself is
 * only what the device is doing now: an idle still loading, a pose still loading or playing.
 */
export class MotionActions {
  private listeners = new Set<() => void>();
  /** The idle load in flight, if any (the chosen idle is shown at once, from the scene's settings). */
  private loading: Promise<void> | null = null;
  /** The pose held (shown at once while its sample loads) and a counter that supersedes. A stored pose not held yet waits for the Poses module. */
  private pose: MotionPose | null = null;
  private poseBusy = false;
  private poseGeneration = 0;
  /** Whether the scene plays a pose now (so leaving it must give the idle's own clips back). */
  private posePlaying = false;
  /**
   * Set once the device is released (`release`): the scene's next runtime owns its motion from then on, so nothing this service still has
   * under way (an idle load, a pose) may reach the device or the scene any more.
   */
  private released = false;
  /** `scene`: where the settings live (the drawn view's scene node); without one, a private store at the default motion. */
  constructor(private port: MotionPort, private scene: MotionScene = localMotionScene()) {
    port.onFaceChange?.(() => this.notify());
    if (!port.available && port.error && port.error !== IDLE_MASCULINE)
      pageFailure("preview", "idle_unavailable", IDLE_UNAVAILABLE, Error(port.error), { level: "warn" });
  }
  private idleEntries(): readonly IdleEntry[] { return this.port.idles ?? []; }
  private known(id: string | undefined): boolean { return !!id && this.idleEntries().some(entry => entry.id === id); }
  private defaultClip(): string { return this.known(DEFAULT_IDLE) ? DEFAULT_IDLE : this.idleEntries()[0]?.id ?? DEFAULT_IDLE; }
  /** The scene's stored motion settings. */
  private stored(): SceneMotion { return this.scene.motion(); }
  /** Store changed settings in the scene (normalised; the device already shows them). */
  private store(changes: Partial<SceneMotion>, seed = false) {
    if (!this.released) this.scene.setMotion(withMotion(this.stored(), changes), { seed });
  }
  /** The device's idle state now, as the scene stores it (its phase too, so a runtime built later starts where this one is). */
  private live(): Partial<SceneMotion> {
    const idle = this.port.idle;
    if (!idle) return { idle: false };
    return { idle: idle.enabled, ...(Number.isFinite(idle.time) && idle.time >= 0 ? { idleTime: idle.time } : {}), idlePaused: idle.paused,
      idleBody: idle.bodyEnabled, idleFace: idle.faceEnabled };
  }
  /** The idle shown: the scene's choice when it is prepared here, else the default. */
  private get clip(): string {
    const chosen = this.stored().idleClip ?? DEFAULT_IDLE;
    return this.known(chosen) ? chosen : this.defaultClip();
  }
  /** A pose stored in the scene that this device doesn't hold yet: it waits for the Poses module to supply its sample. */
  private waiting(): { id: string; label: string } | null {
    const pose = this.stored().pose;
    return !this.pose && pose ? { ...pose } : null;
  }
  /** The chosen idle's catalogue entry (undefined without a catalogue). */
  idleEntry(): IdleEntry | undefined { return this.idleEntries().find(entry => entry.id === this.clip); }
  /** Play an idle: shown at once, loaded behind; a load that fails puts the previous one back and says why once. */
  private select(id: string, rollbackTo: string | null, seed = false) {
    this.store({ idleClip: id }, seed);
    const load = this.port.selectIdle ? this.port.selectIdle(id) : Promise.resolve();
    const pending = this.loading = load.then(() => { if (this.released) return; if (this.loading === pending) this.loading = null; this.notify(); }, error => {
      // A load the released device still had under way: the scene's next runtime decides what plays now.
      if (this.released) return;
      if (this.loading === pending) this.loading = null;
      if (rollbackTo !== null && this.clip === id) this.store({ idleClip: rollbackTo });
      pageFailure("preview", "idle_clip_unavailable", "That idle couldn't be played from its prepared files, so the previous one stays.", error, { level: "warn" });
      this.notify();
    });
  }
  /** The plain reason the idle is off, or undefined while it is available. */
  private idleError() { return this.port.available ? undefined : this.port.error === IDLE_MASCULINE ? IDLE_MASCULINE : IDLE_UNAVAILABLE; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify() { for (const listener of this.listeners) listener(); }
  /** The motion as shown: the device's idle state now (its clock live), and the scene's other settings. */
  snapshot(): Readonly<MotionState> {
    const idle = this.port.idle, stored = this.stored(), waiting = this.waiting();
    return { available: this.port.available, error: this.idleError(), ...this.faceStatus(),
      idle: idle?.enabled ?? false, idleTime: idle?.time ?? stored.idleTime,
      idlePaused: idle?.paused ?? stored.idlePaused,
      idleBody: idle?.bodyEnabled ?? stored.idleBody,
      idleFace: idle?.faceEnabled ?? stored.idleFace,
      blink: stored.blink, blinkPlaying: stored.blinkPlaying,
      blinkAvailable: this.port.blink.available, blinkError: this.blinkError(),
      idleClip: this.clip, idleLoading: !!this.loading,
      pose: this.pose ? { ...this.pose } : waiting ? { ...waiting, moves: false } : null, poseLoading: this.poseBusy || !!waiting,
      idles: this.idleEntries().map(({ id, label, screen, puppet, clip }) => ({ id, label, screen, puppet, clip })),
      blinkRepeatSeconds: this.port.blink.repeatSeconds ?? BLINK_REPEAT_SECONDS,
      physics: this.scene.physics(), ...this.physicsStatus() };
  }
  /** Whether hair physics can be turned on, and the plain reason when not. */
  private physicsStatus(): { physicsAvailable: boolean; physicsReason?: string; physicsParts: number } {
    const dangles = this.port.dangles?.();
    if (!this.port.available) return { physicsAvailable: false, physicsReason: this.port.error === IDLE_MASCULINE ? PHYSICS_MASCULINE : PHYSICS_NO_RIG, physicsParts: 0 };
    // The idle is there but the drawn parts haven't reported their dangles yet: a wait, not a failure.
    if (!dangles) return { physicsAvailable: false, physicsReason: PHYSICS_WAITING, physicsParts: 0 };
    if (dangles.loaded === false) return { physicsAvailable: false, physicsReason: PHYSICS_WAITING, physicsParts: 0 };
    if (!dangles.parts) return { physicsAvailable: false, physicsReason: PHYSICS_NO_DANGLES, physicsParts: 0 };
    if (!dangles.simulated) return { physicsAvailable: false, physicsReason: PHYSICS_UNSUPPORTED, physicsParts: dangles.parts };
    return { physicsAvailable: true, physicsParts: dangles.parts };
  }
  /** Whether the idle moves the face (only while the idle itself is available), and why not. */
  private faceStatus(): { faceAvailable: boolean; faceError?: string } {
    if (!this.port.available) return { faceAvailable: false };
    const face = this.port.face;
    return !face || face.available ? { faceAvailable: true } : { faceAvailable: false, faceError: face.error || IDLE_FACE_MISSING };
  }
  private blinkError() {
    return this.port.blink.available ? undefined : this.port.blink.error || GAME_BLINK_MISSING;
  }
  capability(action: MotionAction): Capability {
    if (this.released) return refusal("not_ready", RELEASED);
    // The idle, pause, contributions and blink are the drawn scene's device's (profiles design §3.6): they act only for a view showing it.
    // Physics is a scene-node setting, edited on the named view's scene.
    if (action.kind !== "motion.setPhysics" && !(this.scene.draws ? this.scene.draws(action.view) : action.view === MAIN_VIEW))
      return refusal("missing_target", typeof action.view === "string" ? NOT_DRAWN : "Open a 3D view to use this.");
    if (action.kind === "motion.setBlink" && (!Number.isFinite(action.value) || action.value < 0 || action.value > 1))
      return refusal("invalid_value", "Eyelid closure must be between 0 and 1.");
    if ((action.kind === "motion.setIdle" && action.enabled || action.kind === "motion.setPaused" ||
      action.kind === "motion.setContributions") && !this.port.available)
      return refusal("asset_unavailable", this.idleError()!);
    if (action.kind === "motion.setIdleClip" && !this.port.available) return refusal("asset_unavailable", this.idleError()!);
    if (action.kind === "motion.setPhysics") {
      if (typeof action.enabled !== "boolean") return refusal("invalid_value", "Choose on or off.");
      // Turning it off always works; on needs a drawn part whose physics the solver runs.
      const status = this.physicsStatus();
      if (action.enabled && !status.physicsAvailable) return refusal("asset_unavailable", status.physicsReason!);
      return { available: true };
    }
    if (action.kind === "motion.setIdleClip" && !this.known(action.clip))
      return refusal("invalid_value", "That idle isn't one of the game's idles prepared on this computer.");
    if (action.kind === "motion.setPaused" && !this.snapshot().idle)
      return refusal("invalid_value", "Play the game idle before pausing it.");
    const blinking = action.kind === "motion.setBlink" || action.kind === "motion.playBlink";
    if (blinking && !this.port.blink.available)
      return refusal("asset_unavailable", this.blinkError()!);
    // Kept as the code the facade gave this refusal before codes were structured (see the code-health ledger).
    if (blinking && this.pose) return refusal("asset_unavailable", "Blink is off while V holds a pose: her face follows the pose's idle or your expression.");
    if (blinking && this.snapshot().idle)
      return refusal("asset_unavailable", this.faceStatus().faceAvailable ? "Blink is off while the game idle plays: the idle blinks on its own."
        : "Blink is off while the game idle plays; choose Still to use it.");
    return { available: true };
  }
  /**
   * Apply the scene's motion to the device (a runtime built for the scene): composition before clock and camera; pause never passes through
   * the reset path. What the device couldn't take (an idle or a blink not prepared here, an idle it doesn't have) is stored back as the
   * scene now shows it, as restore-time state.
   */
  restore() {
    const initial = this.stored();
    this.port.setIdleContributions(initial.idleBody, initial.idleFace);
    // The scene's idle first (its clip loads behind; the default plays until it arrives).
    if (this.port.available && this.clip !== this.defaultClip()) this.select(this.clip, this.defaultClip(), true);
    this.port.setIdle(initial.idle && this.port.available);
    let blink: Partial<SceneMotion> = { blink: 0, blinkPlaying: false };
    if (this.port.idle?.enabled) {
      this.port.idle.seek(initial.idleTime);
      this.port.setIdlePaused(initial.idlePaused);
    } else if (this.port.blink.available) {
      this.port.setBlink(initial.blink);
      this.port.animateBlink(initial.blinkPlaying);
      blink = {};
    }
    this.store({ ...this.live(), idleClip: this.clip, ...blink }, true);
    this.notify();
  }
  /**
   * The device is about to be released: the idle's phase now is stored in the scene, so the scene's next runtime starts there. From then on
   * nothing this service still has under way (an idle load, its rollback, a pose) reaches the device or the scene, and it refuses actions.
   */
  release() {
    if (this.released) return;
    this.store(this.live());
    this.released = true; this.loading = null; this.poseGeneration++; this.poseBusy = false;
  }
  /**
   * The idle's phase now, read into the scene for a save in progress (the workspace session calls it before it captures): the clock moves
   * without any change, so a reload starts the idle where it was. Records nothing and publishes no change.
   */
  sample() {
    const idleTime = this.live().idleTime;
    if (!this.released && idleTime !== undefined) this.scene.setMotion(withMotion(this.stored(), { idleTime }), { sample: true });
  }
  /** Whether a pose can be held now (V's motion rig is prepared on this host), with the plain reason when not. */
  poseCapability(): Capability {
    if (this.released) return refusal("not_ready", RELEASED);
    if (!this.port.setPose || !this.port.available) return refusal("asset_unavailable", this.port.error === IDLE_MASCULINE ? IDLE_MASCULINE : POSE_UNAVAILABLE);
    return { available: true };
  }
  /** The pose the scene stored, waiting for the Poses module to supply its sample (null once held, dropped or replaced). */
  pendingPose(): { id: string; label: string } | null { return this.waiting(); }
  /** Forget a stored pose that can't be held (not installed now, or poses can't be read): the body source stays as restored. */
  dropPendingPose() { if (!this.waiting()) return; this.store({ pose: undefined }); this.notify(); }
  /**
   * Hold a photo-mode pose (the Poses module's `pose.select`, with the sample it reads from the pose library): shown at once, played when
   * the sample arrives. A newer choice (another pose, Still, an idle) supersedes one still loading; a failure puts the previous body source
   * back and rejects with the error. Resolves false when superseded.
   */
  async holdPose(pose: MotionPose, sample: Promise<PoseSample>, placement?: PosePlacement): Promise<boolean> {
    const allowed = this.poseCapability();
    if (!allowed.available) throw Error(allowed.reason);
    const generation = ++this.poseGeneration, previous = this.posePlaying ? this.pose : null;
    this.pose = { ...pose }; this.poseBusy = true;
    this.store({ pose: { id: pose.id, label: pose.label } }); this.notify();
    try {
      const value = await sample;
      if (generation !== this.poseGeneration) return false;
      await this.port.setPose!({ sample: value, ...(placement ? { placement } : {}) });
      if (generation !== this.poseGeneration) return false;
      this.posePlaying = true;
      this.store({ ...this.live(), blink: 0, blinkPlaying: false });
      return true;
    } catch (error) {
      if (generation === this.poseGeneration) { this.pose = previous; this.store({ pose: previous ? { id: previous.id, label: previous.label } : undefined }); }
      throw error;
    } finally {
      if (generation === this.poseGeneration) { this.poseBusy = false; this.notify(); }
    }
  }
  /** Stop holding a pose (Still or an idle was chosen): a pose still loading is superseded, a playing one gives the idle its clips back. */
  private leavePose() {
    if (!this.pose && !this.stored().pose) return;
    this.poseGeneration++; this.pose = null; this.poseBusy = false;
    this.store({ pose: undefined });
    if (this.posePlaying) { this.posePlaying = false; void this.port.setPose?.(null).catch(error => pageFailure("preview", "pose_release_failed", "V couldn't return from her pose.", error, { level: "warn" })); }
  }
  dispatch(action: MotionAction) {
    const capability = this.capability(action);
    if (!capability.available) throw Error(capability.reason);
    switch (action.kind) {
      case "motion.setIdle":
        // Still turns the idle off first, so the pose's clip never shows unposed; an idle takes its own clips back.
        this.port.setIdle(action.enabled); this.leavePose(); this.store({ ...this.live(), blink: 0, blinkPlaying: false }); break;
      case "motion.setIdleClip": {
        const posing = !!this.pose;
        this.leavePose();
        if (action.clip !== this.clip) this.select(action.clip, this.clip);
        else if (posing) this.notify();
        break;
      }
      case "motion.setPaused": this.port.setIdlePaused(action.paused); this.store(this.live()); break;
      case "motion.setContributions": this.port.setIdleContributions(action.body, action.face); this.store(this.live()); break;
      case "motion.setBlink": this.port.setBlink(action.value); this.store({ blink: action.value, blinkPlaying: false }); break;
      case "motion.playBlink": this.port.animateBlink(action.playing); this.store({ blinkPlaying: action.playing }); break;
      case "motion.setPhysics": this.scene.setPhysics(action.enabled, action.view); break;
    }
    this.notify();
  }
}
