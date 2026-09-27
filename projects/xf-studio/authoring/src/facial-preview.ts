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
 * - **Animated changes** (design §5.5, `animate`): with the expression's transition on, the held vector passes through a value-transition
 *   node (platform/core/value-transition.ts) and the face eases from the pose on screen to each new one, solved frame by frame (about
 *   every `FRAME_MS`, as fast as the solver answers) with the blink composed in each frame as for a still face. A change made inside a
 *   form control (a slider drag, a key step, Adjust all) follows at once; every other change animates. Anything the viewer can't see
 *   (no head yet, the solver starting, the idle playing) cuts. Exact at the end: the last frame is the target's own solve.
 */
import { posedLocals, type RigRest, type SolvedPose } from "./engines/facial-rig/pose";
import type { FacialAxisControl, FacialAxisPair, FacialBlink, FacialControl, FacialHostState, FacialPreviewSnapshot, FacialSolveRequest, FacialStartPoints } from "./platform/api/facial";
import { buildAxes, counterpartName, linkedByDefault, linkKey } from "./engines/facial-rig/symmetry";
import { proposeAxes } from "./engines/facial-rig/relations";
import { storedWeight } from "./engines/facial-rig/vector";
import { ValueTransition, weightBlend } from "./platform/core/value-transition";
import type { TransitionSetting } from "./platform/core/transition-settings";

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
  hold(pose: { frames: ReadonlyMap<number, { t: readonly number[]; r: readonly number[] }>[]; rate?: number; repeat?: number; continues?: boolean }): void;
  release(): void;
};
/** The motion the preview composes with (motion-actions.ts `MotionState`). */
export type FacialMotion = { idle: boolean; blink: number; blinkPlaying: boolean; blinkRepeatSeconds: number;
  /** A photo-mode pose is the body source: the expression composes over it (pose-library-design.md decision Q5), so the idle doesn't win. */
  pose?: unknown };
export type FacialTimer = { set(callback: () => void, ms: number): unknown; clear(handle: unknown): void; now(): number };
const TIMER: FacialTimer = { set: (callback, ms) => setTimeout(callback, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => performance.now() };

/** How the face's changes animate: the expression's transition setting now, and whether a form control is open (its edits follow at once). */
export type FacialAnimation = { setting(): TransitionSetting | undefined; continuous(): boolean };
/** A moving transition asks for the next frame's solve this soon after the last one began (ms): 60 per second. */
export const FRAME_MS = 1000 / 60;
const REST: Readonly<Record<string, number>> = Object.freeze({});
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
  private animation: FacialAnimation | undefined;
  private readonly blend = weightBlend(storedWeight);
  /** What the face shows between the held vector and the solve (a cut unless the transition is on). */
  private readonly transition = new ValueTransition(this.blend);
  private tick: unknown = null;
  private solveStarted = -Infinity;
  private lastTick = -Infinity;
  /** Whether the pose last handed to the scene was the blink clip (a new one then carries on at the same point of the clip). */
  private heldPlay = false;
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
  /** Animate changes of the held vector by the expression's transition setting (design §5.5); without it every change cuts. */
  animate(animation: FacialAnimation | undefined) { this.animation = animation; this.changed(); }
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
    if (this.tick !== null) this.timer.clear(this.tick);
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
    this.retarget();
    const request = this.desired();
    if (this.transition.moving(this.timer.now())) this.nextFrame();
    if (!request) {
      if (this.shown !== "none" && this.sink) { this.sink.release(); this.shown = "none"; this.heldPlay = false; }
      return;
    }
    if (!this.sink || !this.sinkRigged || this.host?.solver.phase !== "ready") return;
    const key = JSON.stringify(request);
    if (key === this.shown) return;
    if (this.inFlight) { this.dirty = true; return; }
    void this.solve(request, key);
  }
  /**
   * A new held vector: cut, follow or ease to it (design §5.5). Only a change the viewer can see animates, and only with the transition on
   * and a duration; a change inside a form control follows at once. Turning the transition off mid-way cuts to the target.
   */
  private retarget() {
    const now = this.timer.now(), target = this.pose() ?? REST, was = this.transition.target(), setting = this.animation?.setting();
    const animated = !!setting?.enabled && setting.seconds > 0;
    if (was !== undefined && this.blend.same(was, target)) {
      if (!animated && this.transition.moving(now)) this.transition.cut(target);
      return;
    }
    const motion = this.motion();
    const visible = !!this.sink && this.sinkRigged && this.host?.solver.phase === "ready" && !(motion?.idle && !motion.pose);
    if (was === undefined || !visible || !animated) this.transition.cut(target);
    else if (this.animation!.continuous()) this.transition.follow(target, now);
    else this.transition.ease(target, now, { seconds: setting!.seconds, curve: setting!.easing });
  }
  /** While a transition moves, solve its next frame about `FRAME_MS` after the last solve began (or as soon as the solver is free). */
  private nextFrame() {
    if (this.tick !== null || this.disposed) return;
    const since = this.timer.now() - Math.max(this.solveStarted, this.lastTick);
    this.tick = this.timer.set(() => { this.tick = null; this.lastTick = this.timer.now(); this.changed(); }, Math.max(0, Math.min(FRAME_MS, FRAME_MS - since)));
  }
  private desired(): FacialSolveRequest | undefined {
    const controls = this.transition.valueAt(this.timer.now());
    if (!controls || !Object.keys(controls).length) return undefined;
    const motion = this.motion(), blink: FacialBlink | undefined = !motion || (motion.idle && !motion.pose) || !this.host?.blink.available ? undefined
      : motion.blinkPlaying ? { play: true } : motion.blink > 0 ? { closure: motion.blink } : undefined;
    return { controls: { ...controls }, ...(blink ? { blink } : {}) };
  }
  private async solve(request: FacialSolveRequest, key: string) {
    this.inFlight = true; this.dirty = false;
    const started = this.solveStarted = this.timer.now();
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
        const motion = this.motion(), play = !!request.blink && "play" in request.blink;
        // The blink clip over a changed expression carries on where it was (a transition or a drag doesn't restart it).
        this.sink.hold({ frames, ...(answer.rate ? { rate: answer.rate, repeat: motion?.blinkRepeatSeconds ?? 0 } : {}), ...(play && this.heldPlay ? { continues: true } : {}) });
        this.shown = key; this.failure = null; this.heldPlay = play;
        this.latencies.push({ total: this.timer.now() - started, solver: answer.ms });
        if (this.latencies.length > 20) this.latencies.shift();
      } catch (error) { this.failure = (error as Error).message; }
    } else if (!answer.ok && answer.code !== "superseded") this.failure = answer.message;
    this.inFlight = false;
    this.notify();
    // Anything newer than what was just solved goes next; an unchanged state is left alone. A moving transition's next frame waits
    // for its tick (one solve a frame), unless the tick already came while this solve ran.
    const moving = this.transition.moving(this.timer.now());
    if (this.dirty || (answer.ok && !moving && this.desiredKey() !== key)) this.changed();
    else if (moving) this.nextFrame();
  }
  private desiredKey() { const request = this.desired(); return request ? JSON.stringify(request) : "none"; }

  snapshot(): FacialPreviewSnapshot {
    const host = this.host, controls = this.controls(), groups = host?.rig.groups, startPoints = this.startPoints;
    const latency = this.latencies.length ? (() => {
      const totals = this.latencies.map(entry => entry.total).sort((a, b) => a - b), solver = this.latencies.map(entry => entry.solver).sort((a, b) => a - b);
      return { median: round(totals[Math.floor(totals.length / 2)]!), max: round(totals.at(-1)!), solver: round(solver[Math.floor(solver.length / 2)]!), count: totals.length };
    })() : undefined;
    const axes = this.axes();
    const setting = this.animation?.setting();
    const base = { ...(controls ? { controls } : {}), ...(groups ? { groups } : {}), startPoints, samples: host?.samples ?? [],
      ...(setting ? { transition: { ...setting } } : {}),
      ...(axes ? { axes, gazeSameWay: host?.rig.gazeSameWay ?? null } : {}), ...(latency ? { latency } : {}) };
    if (this.hostError) return { ...base, phase: "failed", reason: this.hostError, next: "retry" };
    if (!host || host.rig.phase === "preparing") return { ...base, phase: "preparing", reason: "Reading your V's face from your game files…" };
    if (host.rig.phase !== "ready") return { ...base, phase: "unavailable", reason: host.rig.reason, next: host.rig.phase === "unconfigured" ? "game-setup" : "retry" };
    if (this.sinkError) return { ...base, phase: "unavailable", reason: this.sinkError };
    if (host.solver.phase === "starting") return { ...base, phase: "preparing", reason: "Starting the facial solver…" };
    // No solver on this computer (the desktop app has none yet): the expression still saves and exports, so the step is Expression sets.
    if (host.solver.phase === "missing") return { ...base, phase: "unavailable", reason: host.solver.reason, next: "export" };
    if (host.solver.phase !== "ready") return { ...base, phase: "unavailable", reason: host.solver.reason, next: GUIDE_SOLVER };
    if (this.failure) return { ...base, phase: "failed", reason: this.failure, next: "retry" };
    if (!this.desired()) return { ...base, phase: "idle" };
    if (this.motion()?.idle && !this.motion()?.pose) return { ...base, phase: "ready", reason: "The creator idle is playing, so your V shows it instead of your expression.", next: "stop-idle" };
    if (this.slow) return { ...base, phase: "updating" };
    if (!this.sink) return { ...base, phase: "unavailable", reason: "Your expression shows on the 3D head once it's ready." };
    return { ...base, phase: "ready" };
  }
  /**
   * The rig's controls with their symmetry (`link`), each marked `inert` when the host found it moves nothing (kept until the host's
   * lists change).
   */
  private controls(): readonly FacialControl[] | undefined {
    const rig = this.host?.rig, controls = rig?.controls;
    if (!controls) return controls;
    if (this.marked?.source !== controls || this.marked.inert !== rig.inert) {
      const inert = new Set(rig.inert ?? []);
      this.marked = { source: controls, inert: rig.inert, controls: controls.map(control => {
        const key = linkKey(control.name), counterpart = counterpartName(control.name);
        return { ...control, ...(inert.has(control.name) ? { inert: true } : {}),
          ...(key && counterpart ? { link: { key, counterpart, byDefault: linkedByDefault(control.name) } } : {}) };
      }) };
    }
    return this.marked.controls;
  }
  private marked: { source: readonly FacialControl[]; inert: readonly string[] | undefined; controls: readonly FacialControl[] } | undefined;
  /**
   * The two-way controls: over the host's confirmed pairs once its solver has found them, else over the pairs the control names settle
   * (`proposeAxes`: gaze and world-named pairs, marked `proposed`), so gaze is one two-way control whether or not the solver runs. Kept
   * until the host's lists change. Values live in the part as plain control weights either way, so a proposal the solver later rejects
   * shows again as its two one-way controls with nothing lost.
   */
  private axes(): readonly FacialAxisControl[] | undefined {
    const rig = this.host?.rig, confirmed = rig?.axes;
    const source: readonly FacialAxisPair[] | readonly FacialControl[] | undefined = confirmed ?? rig?.controls;
    if (!source) return undefined;
    if (this.builtAxes?.source !== source) {
      const proposed = !confirmed;
      const pairs = confirmed ?? proposeAxes(rig!.controls!.map(control => control.name));
      const axes = buildAxes(pairs).map(axis => proposed ? { ...axis, proposed: true as const } : axis), byEnds = new Map(axes.map(axis => [`${axis.negative}~${axis.positive}`, axis]));
      this.builtAxes = { source, axes: axes.map(axis => {
        const negative = counterpartName(axis.negative), positive = counterpartName(axis.positive);
        const other = negative && positive ? byEnds.get(`${negative}~${positive}`) : undefined;
        const keys = [linkKey(axis.negative), linkKey(axis.positive)].filter((key, i, all): key is string => !!key && all.indexOf(key) === i);
        return other && keys.length ? { ...axis, link: { keys, counterpart: other.key, byDefault: linkedByDefault(axis.negative) } } : axis;
      }) };
    }
    return this.builtAxes.axes;
  }
  private builtAxes: { source: readonly FacialAxisPair[] | readonly FacialControl[]; axes: readonly FacialAxisControl[] } | undefined;
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
