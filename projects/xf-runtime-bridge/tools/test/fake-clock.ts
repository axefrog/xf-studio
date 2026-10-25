// A deterministic clock for plan and batch tests: time moves only when every pending piece of work is waiting
// on the clock, and then straight to the earliest wake-up. Sleeps cancelled by their signal never move time.
import type { PlanClock } from "../testing/plan.ts";

export class FakeClock implements PlanClock {
  t = 0;
  private timers: { at: number; seq: number; resolve: () => void }[] = [];
  private seq = 0;
  private pumping = false;
  now() {
    return this.t;
  }
  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const timer = { at: this.t + Math.max(0, ms), seq: this.seq++, resolve };
      this.timers.push(timer);
      signal?.addEventListener("abort", () => {
        this.timers = this.timers.filter((t) => t !== timer);
        resolve();
      }, { once: true });
      this.schedule();
    });
  }
  private schedule() {
    if (this.pumping) return;
    this.pumping = true;
    // A macrotask runs only after every promise chain in flight has settled: then nothing but the clock is waited on.
    setTimeout(() => {
      this.pumping = false;
      if (!this.timers.length) return;
      this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.timers.shift()!;
      this.t = Math.max(this.t, next.at);
      next.resolve();
      if (this.timers.length) this.schedule();
    }, 0);
  }
}
