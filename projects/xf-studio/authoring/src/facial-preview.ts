/**
 * The facial preview service (research/animation/expression-editor-design.md §5): the platform's live face. It follows the held
 * expression (the composition's face posers read it from the selected look's parts), asks the host's warm solver for its exact pose
 * with the blink composed in, and hands the solved pose to the scene's face driver. DOM-free: the host is reached through a device port
 * and the scene through a pose sink, both given by the composition root.
 *
 * - **Newest wins, never stale.** At most one solve is in flight. Changes while it runs mark the preview dirty; when it answers, the
 *   newest state is solved next, and an answer for an older state is still shown only if nothing newer is ready (the viewport keeps the
 *   last exact pose meanwhile). There is no approximate pose: the rig's correctives make it non-linear.
 * - **Plain, in place, never frozen.** A solve slower than `SLOW_SOLVE_MS` shows "updating" in the drawer; nothing blocks the page.
 * - **Blink** composes before the solve, as the game adds blink tracks before its facial solve: a held closure is one solve, Play blink
 *   is the game's clip solved at 60 Hz and played by the face driver every `blinkRepeatSeconds`.
 * - **Idle.** The idle's facial solve isn't additive, so while it plays the head shows the idle and the drawer says so, with one click to
 *   stop it (design §5.3); the held expression comes back when it stops. A photo-mode pose is not the idle: the expression composes over
 *   the posed body (pose-library-design.md decision Q5; preview-motion.ts).
 */
import { posedLocals, type RigRest, type SolvedPose } from "./engines/facial-rig/pose";
import type { FacialBlink, FacialHostState, FacialPreviewSnapshot, FacialSolveRequest, FacialStartPoints } from "./platform/api/facial";

/** A solve's answer with its buffers decoded (the device does the transport). */
export type FacialSolved = { ok: true; frames: number; rate?: number; pose: SolvedPose; ms: number; skipped: readonly string[] } |
  { ok: false; code: "superseded" | "unavailable" | "invalid" | "failed"; message: string };
export interface FacialDevicePort {
  state(): Promise<FacialHostState>;
  expressions(): Promise<FacialStartPoints>;
  solve(request: FacialSolveRequest): Promise<FacialSolved>;
}
/** The scene's face driver as the service sees it (head-rig.ts `face`). */
export type FacePoseSink = {
  setRig(joints: FacialHostState["rig"]["joints"] & object): void;
  hold(pose: { frames: ReadonlyMap<number, { t: readonly number[]; r: readonly number[] }>[]; rate?: number; repeat?: number }): void;
  release(): void;
};
/** The motion the preview composes with (motion-actions.ts `MotionState`). */
export type FacialMotion = { idle: boolean; blink: number; blinkPlaying: boolean; blinkRepeatSeconds: number;
  /** A photo-mode pose is the body source: the expression composes over it (pose-library-design.md decision Q5), so the idle doesn't win. */
  pose?: unknown };
export type FacialTimer = { set(callback: () => void, ms: number): unknown; clear(handle: unknown): void; now(): number };
const TIMER: FacialTimer = { set: (callback, ms) => setTimeout(callback, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => performance.now() };

/** A solve slower than this shows "updating" in place. */
export const SLOW_SOLVE_MS = 150;
/** How often the host's state is asked for while it prepares (ms), growing to the maximum. */
export const POLL_MS = [500, 1000, 2000, 4000] as const;
const GUIDE_SOLVER = "guide" as const;

export class FacialPreview {
  private host: FacialHostState | null = null;
  private hostError: string | null = null;
  private rest: RigRest | null = null;
  private startPoints: FacialStartPoints = { phase: "preparing", items: [] };
  private sink: FacePoseSink | undefined;
  private sinkRigged = false;
  private sinkError: string | null = null;
  private pose: () => Readonly<Record<string, number>> | undefined = () => undefined;
  private motion: () => FacialMotion | undefined = () => undefined;
  private shown = "none";
  private inFlight = false;
  private dirty = false;
  private slow = false;
  private slowTimer: unknown = null;
  private failure: string | null = null;
  private poll: unknown = null;
  private polls = 0;
  private disposed = false;
  private readonly latencies: { total: number; solver: number }[] = [];
  private readonly listeners = new Set<() => void>();
  constructor(private readonly device: FacialDevicePort, private readonly timer: FacialTimer = TIMER) {}

  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify() { for (const listener of this.listeners) listener(); }

  /** Ask the host for its state now (and again while it prepares). */
  start() { void this.refresh(); }
  /** What the face should show: the held vector (undefined: nothing held) and the motion it composes with. */
  follow(pose: () => Readonly<Record<string, number>> | undefined, motion: () => FacialMotion | undefined) {
    this.pose = pose; this.motion = motion; this.changed();
  }
  /** The scene's face driver (undefined while no head is loaded). */
  attachScene(sink: FacePoseSink | undefined) {
    this.sink = sink; this.sinkRigged = false; this.sinkError = null; this.shown = "none";
    this.rigSink();
    this.changed();
  }
  dispose() {
    this.disposed = true;
    if (this.poll !== null) this.timer.clear(this.poll);
    if (this.slowTimer !== null) this.timer.clear(this.slowTimer);
    this.listeners.clear();
  }

  private async refresh() {
    if (this.disposed) return;
    this.poll = null;
    try { this.host = await this.device.state(); this.hostError = null; }
    catch { this.hostError = "XF Studio couldn't reach its face data. Reload the page to try again."; }
    if (this.disposed) return;
    const rig = this.host?.rig;
    if (rig?.phase === "ready" && rig.joints && !this.rest) { this.rest = { joints: rig.joints.map(joint => ({ ...joint, t: [...joint.t], r: [...joint.r], s: [...joint.s] })) as unknown as RigRest["joints"] }; this.rigSink(); }
    if (this.host?.expressions.phase === "ready" && this.startPoints.phase !== "ready") {
      try { this.startPoints = await this.device.expressions(); } catch { /* asked again on the next poll */ }
    } else if (this.host && this.host.expressions.phase !== "preparing" && this.host.expressions.phase !== "ready")
      this.startPoints = { phase: this.host.expressions.phase, ...(this.host.expressions.reason ? { reason: this.host.expressions.reason } : {}), items: [] };
    const preparing = !this.host || this.host.rig.phase === "preparing" || this.host.solver.phase === "starting" || this.host.expressions.phase === "preparing" ||
      (this.host.expressions.phase === "ready" && this.startPoints.phase !== "ready");
    if (preparing && !this.disposed) this.poll = this.timer.set(() => void this.refresh(), POLL_MS[Math.min(this.polls++, POLL_MS.length - 1)]!);
    this.notify();
    this.changed();
  }
  private rigSink() {
    if (!this.sink || !this.rest || this.sinkRigged) return;
    try { this.sink.setRig(this.rest.joints as never); this.sinkRigged = true; this.sinkError = null; }
    catch (error) { this.sinkError = (error as Error).message; }
  }

  /** The held expression, the motion or the host changed: solve what the face should show now (newest wins). */
  changed() {
    if (this.disposed) return;
    const request = this.desired();
    if (!request) {
      if (this.shown !== "none" && this.sink) { this.sink.release(); this.shown = "none"; }
      return;
    }
    if (!this.sink || !this.sinkRigged || this.host?.solver.phase !== "ready") return;
    const key = JSON.stringify(request);
    if (key === this.shown) return;
    if (this.inFlight) { this.dirty = true; return; }
    void this.solve(request, key);
  }
  private desired(): FacialSolveRequest | undefined {
    const controls = this.pose();
    if (!controls || !Object.keys(controls).length) return undefined;
    const motion = this.motion(), blink: FacialBlink | undefined = !motion || (motion.idle && !motion.pose) || !this.host?.blink.available ? undefined
      : motion.blinkPlaying ? { play: true } : motion.blink > 0 ? { closure: motion.blink } : undefined;
    return { controls: { ...controls }, ...(blink ? { blink } : {}) };
  }
  private async solve(request: FacialSolveRequest, key: string) {
    this.inFlight = true; this.dirty = false;
    const started = this.timer.now();
    this.slowTimer = this.timer.set(() => { this.slowTimer = null; this.slow = true; this.notify(); }, SLOW_SOLVE_MS);
    let answer: FacialSolved;
    try { answer = await this.device.solve(request); }
    catch { answer = { ok: false, code: "failed", message: "XF Studio couldn't reach the facial solver." }; }
    if (this.slowTimer !== null) { this.timer.clear(this.slowTimer); this.slowTimer = null; }
    this.slow = false;
    if (this.disposed) return;
    if (answer.ok && this.sink && this.rest) {
      try {
        const frames = Array.from({ length: answer.frames }, (_, frame) => posedLocals(this.rest!, answer.pose, frame));
        const motion = this.motion();
        this.sink.hold({ frames, ...(answer.rate ? { rate: answer.rate, repeat: motion?.blinkRepeatSeconds ?? 0 } : {}) });
        this.shown = key; this.failure = null;
        this.latencies.push({ total: this.timer.now() - started, solver: answer.ms });
        if (this.latencies.length > 20) this.latencies.shift();
      } catch (error) { this.failure = (error as Error).message; }
    } else if (!answer.ok && answer.code !== "superseded") this.failure = answer.message;
    this.inFlight = false;
    this.notify();
    // Anything newer than what was just solved goes next; an unchanged state is left alone.
    if (this.dirty || (answer.ok && this.desiredKey() !== key)) this.changed();
  }
  private desiredKey() { const request = this.desired(); return request ? JSON.stringify(request) : "none"; }

  snapshot(): FacialPreviewSnapshot {
    const host = this.host, controls = host?.rig.controls, groups = host?.rig.groups, startPoints = this.startPoints;
    const latency = this.latencies.length ? (() => {
      const totals = this.latencies.map(entry => entry.total).sort((a, b) => a - b), solver = this.latencies.map(entry => entry.solver).sort((a, b) => a - b);
      return { median: round(totals[Math.floor(totals.length / 2)]!), max: round(totals.at(-1)!), solver: round(solver[Math.floor(solver.length / 2)]!), count: totals.length };
    })() : undefined;
    const base = { ...(controls ? { controls } : {}), ...(groups ? { groups } : {}), startPoints, ...(latency ? { latency } : {}) };
    if (this.hostError) return { ...base, phase: "failed", reason: this.hostError, next: "retry" };
    if (!host || host.rig.phase === "preparing") return { ...base, phase: "preparing", reason: "Reading your V's face from your game files…" };
    if (host.rig.phase !== "ready") return { ...base, phase: "unavailable", reason: host.rig.reason, next: host.rig.phase === "unconfigured" ? "game-setup" : "retry" };
    if (this.sinkError) return { ...base, phase: "unavailable", reason: this.sinkError };
    if (host.solver.phase === "starting") return { ...base, phase: "preparing", reason: "Starting the facial solver…" };
    if (host.solver.phase !== "ready") return { ...base, phase: "unavailable", reason: host.solver.reason, next: GUIDE_SOLVER };
    if (this.failure) return { ...base, phase: "failed", reason: this.failure, next: "retry" };
    if (!this.desired()) return { ...base, phase: "idle" };
    if (this.motion()?.idle && !this.motion()?.pose) return { ...base, phase: "ready", reason: "The creator idle is playing, so your V shows it instead of your expression.", next: "stop-idle" };
    if (this.slow) return { ...base, phase: "updating" };
    if (!this.sink) return { ...base, phase: "unavailable", reason: "Your expression shows on the 3D head once it's ready." };
    return { ...base, phase: "ready" };
  }
  /** Solve again after a failure (the drawer's Try again). */
  retry() {
    // The host's state is asked for again: a solver that stopped or was stuck is started again there (CORE-101), and the solve follows.
    this.failure = null; this.shown = ""; this.polls = 0;
    if (this.poll !== null) { this.timer.clear(this.poll); this.poll = null; }
    void this.refresh(); this.notify();
  }
}
const round = (value: number) => Math.round(value * 10) / 10;

/**
 * The face every poser holds together (design §4 `FacialPosePort.hold(owner, vector)`): the weights summed per control and clamped to
 * 0–1 as the solver clamps them; undefined when nobody holds anything.
 */
export function combineFacePoses(poses: readonly (Readonly<Record<string, number>> | undefined)[]): Readonly<Record<string, number>> | undefined {
  const held = poses.filter((pose): pose is Readonly<Record<string, number>> => !!pose && Object.keys(pose).length > 0);
  if (!held.length) return undefined;
  if (held.length === 1) return held[0];
  const out: Record<string, number> = {};
  for (const pose of held) for (const [name, weight] of Object.entries(pose)) out[name] = Math.min(1, (out[name] ?? 0) + weight);
  return out;
}
