/**
 * The Studio's clock: wall time, monotonic time, timers and animation frames behind one small interface, so code that waits
 * or schedules takes a clock as a parameter and a test can drive time itself. Works in Bun and in browsers; animation
 * frames come from the page, which passes its frame function in (so this module reads no page global).
 */

export interface Clock {
  /** Wall time, in milliseconds since the Unix epoch. */
  now(): number;
  /** Monotonic time in milliseconds, for measuring intervals. */
  monotonic(): number;
  /** Runs `run` after `ms` milliseconds, unless `signal` aborts first. */
  after(ms: number, run: () => void, signal?: AbortSignal): void;
  /** Runs `run` at the next animation frame (about 16 ms later where there is no page), unless `signal` aborts first. */
  frame(run: (time: number) => void, signal?: AbortSignal): void;
}

/** The host clock. `frame` is the page's animation-frame function, when there is a page. */
export function hostClock(frame?: (run: (time: number) => void) => number, cancelFrame?: (handle: number) => void): Clock {
  const after = (ms: number, run: () => void, signal?: AbortSignal) => {
    if (signal?.aborted) return;
    const timer = setTimeout(run, ms);
    signal?.addEventListener("abort", () => clearTimeout(timer), { once: true });
  };
  return {
    now: () => Date.now(),
    monotonic: () => performance.now(),
    after,
    frame(run, signal) {
      if (signal?.aborted) return;
      if (!frame) { after(16, () => run(performance.now()), signal); return; }
      const handle = frame(run);
      signal?.addEventListener("abort", () => cancelFrame?.(handle), { once: true });
    },
  };
}
