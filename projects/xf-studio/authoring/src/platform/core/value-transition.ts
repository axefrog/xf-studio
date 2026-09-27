/**
 * The value-transition node (research/animation/expression-editor-design.md §5.5): between a source of target values and whatever shows
 * them, it eases what is shown from the value on screen to each new target over a duration, through a curve from the Studio's easing
 * catalogue (platform/api/easing.ts). Pure and clock-driven: the owner passes the time, asks for the value at a time, and draws frames
 * while `moving`. It knows nothing of faces: the held expression feeds it control weights today, and a pose (or anything else with a
 * blend rule) can feed it through its own `Blend`.
 *
 * - **Cut** (`cut`): the target shows at once. A duration of 0 is a cut.
 * - **Ease** (`ease`): from the value shown now (a transition still running included, so a change mid-way never jumps) to the target.
 * - **Follow** (`follow`): a continuous edit (a slider under the pointer). What the edit changed follows at once; anything still easing
 *   keeps easing toward its own target, so the hand is never behind the pointer and nothing else jumps.
 */
import { ease, type EasingCurve } from "../api/easing";

/** How a kind of value blends: `mix` at amount `k` (0 `from`, 1 `to`); `snap` gives `from` the parts that differ between two targets. */
export interface Blend<T> {
  mix(from: T, to: T, k: number): T;
  same(a: T, b: T): boolean;
  /** `from` with every part where `was` and `now` differ taken from `now` (what a continuous edit changed follows at once). */
  snap(from: T, was: T, now: T): T;
}
/** How long a transition takes and how it moves. */
export type TransitionTiming = { readonly seconds: number; readonly curve: EasingCurve };

export class ValueTransition<T> {
  private from: T | undefined;
  private to: T | undefined;
  private start = 0;
  private timing: TransitionTiming = { seconds: 0, curve: "linear" };
  constructor(private readonly blend: Blend<T>) {}

  /** The latest target (undefined before the first). */
  target(): T | undefined { return this.to; }
  /** Progress through the running transition at `now` (1 when there is none or it has ended). */
  progress(now: number): number {
    const seconds = this.timing.seconds;
    if (this.from === undefined || !(seconds > 0)) return 1;
    return Math.max(0, Math.min(1, (now - this.start) / (seconds * 1000)));
  }
  /** Whether what shows still changes by itself at `now`. */
  moving(now: number): boolean { return this.progress(now) < 1; }
  /** The value to show at `now` (ms): the target once the transition ends, exactly. */
  valueAt(now: number): T | undefined {
    const p = this.progress(now);
    if (p >= 1 || this.from === undefined || this.to === undefined) return this.to;
    return this.blend.mix(this.from, this.to, ease(this.timing.curve, p));
  }
  /** Show `target` at once. */
  cut(target: T) { this.to = target; this.from = undefined; }
  /** Ease from the value shown at `now` to `target`; a zero duration (or nothing shown yet) cuts. */
  ease(target: T, now: number, timing: TransitionTiming) {
    const shown = this.valueAt(now);
    if (shown === undefined || !(timing.seconds > 0) || !Number.isFinite(timing.seconds)) { this.cut(target); return; }
    this.from = shown; this.to = target; this.start = now; this.timing = timing;
  }
  /** A continuous edit: what changed between the last target and `target` shows at once; the rest keeps easing. */
  follow(target: T, now: number) {
    const was = this.to;
    if (was === undefined || !this.moving(now) || this.from === undefined) { this.cut(target); return; }
    this.from = this.blend.snap(this.from, was, target); this.to = target;
  }
}

/** Named weights (absent is 0), as control vectors hold them: blended per name, each result passed through `clamp` and zeros dropped. */
export function weightBlend(clamp: (value: number) => number = value => value): Blend<Readonly<Record<string, number>>> {
  return {
    mix(from, to, k) {
      const out: Record<string, number> = {};
      for (const name of [...new Set([...Object.keys(from), ...Object.keys(to)])].sort()) {
        // Exact at the ends; beyond them (a curve's overshoot) it goes on along the line, and `clamp` decides what may show (CORE-117).
        const a = from[name] ?? 0, b = to[name] ?? 0, value = clamp(k === 1 ? b : k === 0 ? a : a + (b - a) * k);
        if (value !== 0) out[name] = value;
      }
      return out;
    },
    same(a, b) {
      const keys = Object.keys(a);
      return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
    },
    snap(from, was, now) {
      const out: Record<string, number> = { ...from };
      for (const name of new Set([...Object.keys(was), ...Object.keys(now)])) {
        if ((was[name] ?? 0) === (now[name] ?? 0)) continue;
        if (now[name]) out[name] = now[name]!; else delete out[name];
      }
      return out;
    },
  };
}
