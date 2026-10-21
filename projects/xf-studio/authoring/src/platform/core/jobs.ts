/**
 * The job scheduler (`platform/api/jobs.ts`): one owner of when the host's work runs. Pure: an injected clock, no Node API.
 *
 * Rules (research/backlog/performance.md, scheduling):
 * - **One run at a time.** The host's preparations share one on-disk cache and one thread, so a job starts only once the run before it
 *   returned. The person lane runs in the order asked (PIPE-103); below it, `shown` before `ahead`, each by `order`, then the order asked.
 * - **A person comes first.** The lanes below start only when no person work waits or runs, no `hold` is open and the person lane has
 *   been quiet for `quietMs` (and `ahead` waits the same for `shown`). Wanting person work stops a running lower job at once unless it
 *   committed, and starts once that run returned (a committed one finishes first; its result is kept).
 * - **Work lets go before the next lower job.** What a run hands to `afterwards` keeps settling after it returned; the next job below the
 *   person lane, and every exclusive job, wait for it (PREV-102, PREV-120). Person work doesn't: a stopped batch never holds a person up.
 * - **Demand.** A job runs only while a want holds it: a requester's new want replaces its previous one, and a job no want holds is
 *   stopped (a waiting one is dropped) unless it committed.
 * - **Never unhandled.** `settled` never rejects, and a failure is reported once (PREV-101).
 */
import type { Clock } from "./clock";
import type { JobContext, JobLane, JobProgress, JobScheduler, JobSpec, JobState, RunOutcome, Want } from "../api/jobs";
export type { JobContext, JobLane, JobProgress, JobScheduler, JobSpec, JobState, RunOutcome, Want } from "../api/jobs";
export { JOB_LANES } from "../api/jobs";

export type JobSchedulerOptions = {
  readonly clock: Clock;
  /** How long a lane must have been quiet before the lanes below it start (default 400 ms). */
  readonly quietMs?: number;
  /** How long a lower job's `turn()` runs before it yields (default 8 ms). */
  readonly sliceMs?: number;
  /** Lets the event loop answer what is waiting (default: a zero-delay timer of the clock). */
  readonly yieldTurn?: () => Promise<void>;
  /** Runs `run` soon, after the current task (default: a zero-delay timer of the clock). The next job starts through it. */
  readonly defer?: (run: () => void) => void;
  /** Wraps every run (the host follows the job through its async work with it, host-jobs.ts). */
  readonly enter?: <T>(context: JobContext, run: () => Promise<T>) => Promise<T>;
  /** A job's failure, once (never a stop). */
  readonly report?: (error: unknown, key: string) => void;
};

export const DEFAULT_QUIET_MS = 400;
const RANK: Record<JobLane, number> = { person: 0, shown: 1, ahead: 2 };
const SUPERSEDED = Object.freeze({ status: "superseded" as const });

type Phase = "waiting" | "running" | "done" | "failed" | "stopped";
type Job = {
  readonly key: string; lane: JobLane; readonly order: number; readonly exclusive: boolean; readonly quietMs: number;
  readonly run: (context: JobContext) => Promise<unknown>;
  seq: number; phase: Phase; progress: JobProgress | null; result?: unknown; error?: unknown;
  readonly controller: AbortController; committed: boolean;
  readonly wants: Set<Held>;
  readonly settled: Promise<RunOutcome<unknown>>; settle(outcome: RunOutcome<unknown>): void;
};
type Held = { readonly requester: string; readonly job: Job; readonly want: Want<unknown> };

/** An `AbortError` for a stopped job's `turn()`. */
function stoppedError(signal: AbortSignal): Error {
  const error = new Error(typeof signal.reason === "string" ? `Stopped: ${signal.reason}.` : "Stopped.");
  error.name = "AbortError";
  return error;
}

export function createJobScheduler(options: JobSchedulerOptions): JobScheduler {
  const { clock } = options;
  const quietMs = options.quietMs ?? DEFAULT_QUIET_MS, sliceMs = options.sliceMs ?? 8;
  const defer = options.defer ?? ((run: () => void) => clock.after(0, run));
  const yieldTurn = options.yieldTurn ?? (() => new Promise<void>(resolve => clock.after(0, resolve)));
  /** Live jobs by key: waiting or running and not stopped. */
  const live = new Map<string, Job>();
  const queue: Job[] = [];
  let running: Job | null = null;
  const tails = new Set<Promise<void>>();
  const holders = new Map<string, Held>();
  let holds = 0, seq = 0;
  /** When each lane last had activity (a want, a run ending; a touch or a hold for the person lane). */
  const lastAt: Record<JobLane, number> = { person: -Infinity, shown: -Infinity, ahead: -Infinity };
  /** Things waiting for the scheduler's state to change: turns waiting for quiet, idle callers. */
  const listeners = new Set<() => void>();
  let wakeTimer: AbortController | null = null, wakeAt = Infinity, pumping = false;

  const now = () => clock.monotonic();
  const notify = () => { for (const listener of [...listeners]) listener(); };
  /** Runs `check` on every change until it answers true; resolves then. */
  const until = (check: () => boolean): Promise<void> => {
    if (check()) return Promise.resolve();
    return new Promise(resolve => {
      const listener = () => { if (check()) { listeners.delete(listener); resolve(); } };
      listeners.add(listener);
    });
  };
  /** Pump again at `at` (monotonic), keeping only the earliest wake. */
  const wakeAtTime = (at: number) => {
    if (at >= wakeAt) return;
    wakeTimer?.abort();
    const controller = wakeTimer = new AbortController();
    wakeAt = at;
    clock.after(Math.max(0, at - now()), () => { if (wakeTimer === controller) { wakeTimer = null; wakeAt = Infinity; } schedule(); notify(); }, controller.signal);
  };
  const schedule = () => { if (pumping) return; pumping = true; defer(() => { pumping = false; pump(); }); };

  /** When the lanes above `lane` will have been quiet long enough for `need` ms (monotonic), or now if they are; Infinity while held. */
  const quietFrom = (lane: JobLane, need: number): number => {
    if (RANK[lane] === 0) return -Infinity;
    if (holds > 0) return Infinity;
    let at = lastAt.person + need;
    if (RANK[lane] > 1) at = Math.max(at, lastAt.shown + quietMs);
    return at;
  };
  /** The person job asked first, if any waits. */
  const firstPerson = () => {
    let found: Job | null = null;
    for (const job of queue) if (job.lane === "person" && (!found || job.seq < found.seq)) found = job;
    return found;
  };

  function pump(): void {
    if (running) { notify(); return; }
    const person = firstPerson();
    if (person) {
      if (person.exclusive && tails.size) return; // A tail settling pumps again.
      start(person);
      return;
    }
    if (queue.length) {
      if (tails.size) return;
      let earliest = Infinity;
      for (const lane of ["shown", "ahead"] as const) {
        const candidates = queue.filter(job => job.lane === lane).sort((a, b) => a.order - b.order || a.seq - b.seq);
        if (!candidates.length) continue;
        for (const job of candidates) {
          const at = quietFrom(lane, Math.max(quietMs, job.quietMs));
          if (at <= now()) { start(job); return; }
          earliest = Math.min(earliest, at);
        }
        // `ahead` never starts while `shown` work waits.
        break;
      }
      if (Number.isFinite(earliest)) wakeAtTime(earliest);
    }
    notify();
  }

  function start(job: Job): void {
    queue.splice(queue.indexOf(job), 1);
    running = job;
    job.phase = "running";
    let lastYield = now();
    const context: JobContext = {
      signal: job.controller.signal,
      lane: () => job.lane,
      progress(progress) { if (job.phase === "running") job.progress = progress; },
      commit() { if (!job.controller.signal.aborted) job.committed = true; },
      async turn() {
        if (now() - lastYield >= sliceMs) { await yieldTurn(); lastYield = now(); }
        const signal = job.controller.signal;
        if (signal.aborted) throw stoppedError(signal);
        if (job.committed || RANK[job.lane] === 0) return;
        for (;;) {
          const at = quietFrom(job.lane, quietMs);
          if (at <= now()) return;
          if (Number.isFinite(at)) wakeAtTime(at);
          // Any change (a hold ended, the wake timer, a stop) checks again.
          await new Promise<void>(resolve => {
            const listener = () => { listeners.delete(listener); resolve(); };
            listeners.add(listener);
          });
          if (signal.aborted) throw stoppedError(signal);
          lastYield = now();
        }
      },
      afterwards(tail) {
        const settled: Promise<void> = Promise.resolve(tail).then(() => {}, () => {}).finally(() => { tails.delete(settled); schedule(); notify(); });
        tails.add(settled);
      },
    };
    let pending: Promise<unknown>;
    try { pending = options.enter ? options.enter(context, () => job.run(context)) : job.run(context); }
    catch (error) { pending = Promise.reject(error); }
    Promise.resolve(pending).then(result => finish(job, { status: "done", result }), error => finish(job, { status: "failed", error }));
  }

  function finish(job: Job, ending: RunOutcome<unknown>): void {
    if (running === job) running = null;
    lastAt[job.lane] = Math.max(lastAt[job.lane], now());
    if (live.get(job.key) === job) live.delete(job.key);
    let outcome: RunOutcome<unknown> = ending;
    if (job.phase === "stopped" || job.controller.signal.aborted) { job.phase = "stopped"; outcome = SUPERSEDED; }
    else if (ending.status === "failed") {
      job.phase = "failed"; job.error = ending.error;
      try { options.report?.(ending.error, job.key); } catch { /* Reporting must not end the host either. */ }
    } else if (ending.status === "done") { job.phase = "done"; job.result = ending.result; }
    job.progress = null;
    for (const held of job.wants) if (holders.get(held.requester) === held) holders.delete(held.requester);
    job.wants.clear();
    job.settle(outcome);
    schedule();
    notify();
  }

  /** Stops a job: a waiting one leaves the queue at once; a running one is aborted, and the next starts once its run returned. */
  function stop(job: Job, reason: string): void {
    if (job.phase !== "waiting" && job.phase !== "running") return;
    if (live.get(job.key) === job) live.delete(job.key);
    const wasWaiting = job.phase === "waiting";
    job.phase = "stopped";
    job.controller.abort(reason);
    if (wasWaiting) {
      queue.splice(queue.indexOf(job), 1);
      for (const held of job.wants) if (holders.get(held.requester) === held) holders.delete(held.requester);
      job.wants.clear();
      job.settle(SUPERSEDED);
    }
    schedule();
    notify();
  }

  function drop(held: Held): void {
    if (holders.get(held.requester) === held) holders.delete(held.requester);
    const job = held.job;
    if (!job.wants.delete(held)) return;
    if (!job.wants.size && !job.committed) stop(job, "released");
  }

  function create(spec: JobSpec<unknown>): Job {
    let settle!: (outcome: RunOutcome<unknown>) => void;
    const settled = new Promise<RunOutcome<unknown>>(resolve => { settle = resolve; });
    let done = false;
    const job: Job = { key: spec.key, lane: spec.lane, order: spec.order ?? 0, exclusive: !!spec.exclusive, quietMs: spec.quietMs ?? 0,
      run: spec.run, seq: ++seq, phase: "waiting", progress: null, controller: new AbortController(), committed: false, wants: new Set(),
      settled, settle: outcome => { if (!done) { done = true; settle(outcome); } } };
    live.set(job.key, job);
    queue.push(job);
    return job;
  }

  const stateOf = (job: Job): JobState<unknown> => job.phase === "done" ? { phase: "done", result: job.result }
    : job.phase === "failed" ? { phase: "failed", error: job.error }
    : job.phase === "stopped" ? { phase: "stopped" }
    : { phase: job.phase, lane: job.lane, progress: job.progress };

  return {
    want<T>(requester: string, spec: JobSpec<T>, signal?: AbortSignal): Want<T> {
      if (signal?.aborted) {
        const previous = holders.get(requester);
        if (previous) drop(previous);
        return { key: spec.key, state: () => ({ phase: "stopped" }), settled: Promise.resolve(SUPERSEDED) };
      }
      lastAt[spec.lane] = Math.max(lastAt[spec.lane], now());
      const previous = holders.get(requester);
      const existing = live.get(spec.key);
      if (previous && previous.job === existing && existing) {
        raise(existing, spec.lane);
        listen(previous, signal);
        schedule();
        return previous.want as Want<T>;
      }
      if (previous) drop(previous);
      const job = existing ?? create(spec as JobSpec<unknown>);
      raise(job, spec.lane);
      const want: Want<unknown> = { key: job.key, state: () => stateOf(job), settled: job.settled };
      const held: Held = { requester, job, want };
      job.wants.add(held);
      holders.set(requester, held);
      listen(held, signal);
      // A person's work stops a running lower job that hasn't committed; it starts once that run returned.
      if (RANK[spec.lane] === 0 && running && RANK[running.lane] > 0 && !running.committed && running !== job) stop(running, "pre-empted");
      schedule();
      notify();
      return want as Want<T>;
    },
    release(requester) {
      const held = holders.get(requester);
      if (held) drop(held);
    },
    touch() { lastAt.person = Math.max(lastAt.person, now()); notify(); },
    hold() {
      holds++;
      let open = true;
      notify();
      return () => {
        if (!open) return;
        open = false;
        holds--;
        lastAt.person = Math.max(lastAt.person, now());
        schedule();
        notify();
      };
    },
    busy: lane => running?.lane === lane || queue.some(job => job.lane === lane),
    idle: lane => until(() => lane ? running?.lane !== lane && !queue.some(job => job.lane === lane) : !running && !queue.length && !tails.size),
  };

  /** A higher lane wanting the same key raises the job (it takes its place in the order asked of that lane). */
  function raise(job: Job, lane: JobLane): void {
    if (RANK[lane] >= RANK[job.lane]) return;
    job.lane = lane;
    job.seq = ++seq;
  }
  function listen(held: Held, signal: AbortSignal | undefined): void {
    signal?.addEventListener("abort", () => { if (holders.get(held.requester) === held) drop(held); }, { once: true });
  }
}

/** A want's lifetime for an HTTP requester: aborts unless renewed within `ms` (a page that stopped asking went away), or ends with `until`. */
export function lease(clock: Clock, ms: number, until?: AbortSignal): { readonly signal: AbortSignal; renew(): void } {
  const controller = new AbortController();
  let deadline = clock.monotonic() + ms;
  const arm = () => clock.after(Math.max(0, deadline - clock.monotonic()), () => {
    if (controller.signal.aborted || until?.aborted) return;
    if (clock.monotonic() >= deadline) controller.abort("unpolled"); else arm();
  }, until);
  arm();
  return { signal: controller.signal, renew() { deadline = clock.monotonic() + ms; } };
}
