/**
 * The host's clock and randomness as XF Strata sources (profiles and graph design §5.1): the only place graph code gets
 * wall time, monotonic time, timers and random IDs. Works in Bun and in browsers; animation frames come from the page,
 * which passes its frame function in (so this module reads no page global).
 */
import { seededRandom } from "strata";
import type { AbortSignalLike, Clock, Random } from "strata";

/** The host clock. `frame` is the page's animation-frame function, when there is a page. */
export function hostClock(frame?: (run: (time: number) => void) => number, cancelFrame?: (handle: number) => void): Clock {
  return {
    now: () => Date.now(),
    monotonic: () => performance.now(),
    after(ms: number, run: () => void, signal?: AbortSignalLike) {
      if (signal?.aborted) return;
      const timer = setTimeout(run, ms);
      signal?.addEventListener("abort", () => clearTimeout(timer), { once: true });
    },
    frame(run: (time: number) => void, signal?: AbortSignalLike) {
      if (signal?.aborted) return;
      if (!frame) { this.after(16, () => run(performance.now()), signal); return; }
      const handle = frame(run);
      signal?.addEventListener("abort", () => cancelFrame?.(handle), { once: true });
    },
  };
}

/** Named random streams seeded once per session from the platform's cryptographic source. */
export function hostRandom(): Random {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return seededRandom([...bytes].map(byte => byte.toString(16).padStart(2, "0")).join(""));
}
