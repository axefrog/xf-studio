/**
 * The job scheduler's contract (`platform/core/jobs.ts` implements it): the host's one owner of when work runs. Types only.
 *
 * - **Lanes.** `person`: what a person asked for and waits on (their V, Clear). `shown`: what the page shows now and asked for (a choice
 *   preview's source). `ahead`: work done before anyone asks (choices prepared ahead, the V resolved after a restart, the disk budget).
 * - **Wants.** A requester (a page's slot, `<page>/character`; a host's own, `host/warm-up`) wants one job at a time: a new want replaces
 *   its previous one, and the same key wanted by several requesters is one run. A job no want holds any more is stopped, unless it
 *   committed (passed the point where stopping would throw finished work away).
 * - **Leases.** An HTTP requester holds its want with a `lease`, renewed by each poll or file read, so a page that went away stops its work.
 * - **Never unhandled.** `settled` never rejects; a failure is reported once.
 */
import type { RunOutcome } from "./tasks";
export type { RunOutcome } from "./tasks";

export type JobLane = "person" | "shown" | "ahead";
/** The lanes, highest first. */
export const JOB_LANES: readonly JobLane[] = ["person", "shown", "ahead"];
export type JobProgress = { readonly index: number; readonly total: number; readonly label: string };
/** `stopped`: no want held it any more, or a person's work pre-empted it before it committed (its `settled` is `superseded`). */
export type JobState<T> =
  | { readonly phase: "waiting" | "running"; readonly lane: JobLane; readonly progress: JobProgress | null }
  | { readonly phase: "done"; readonly result: T }
  | { readonly phase: "failed"; readonly error: unknown }
  | { readonly phase: "stopped" };

export interface JobContext {
  /** Aborted when no want holds the job, or a person's work pre-empts it before `commit()`. */
  readonly signal: AbortSignal;
  /** The lane it runs in now (a person wanting the same key raises it). */
  lane(): JobLane;
  progress(progress: JobProgress): void;
  /** Past its threshold: from now on nothing stops it, and a person's work waits for it to finish. */
  commit(): void;
  /**
   * Between units of work: lets the event loop answer what is waiting once the slice is used, and, below the person lane, waits while
   * a person is being answered or the host has not been quiet for a moment. Throws an `AbortError` once the job was stopped.
   */
  turn(): Promise<void>;
  /**
   * Work still letting go after `run` returned (reads already in WolvenKit finishing for everyone, PREV-120): the next job below the
   * person lane, and every exclusive job, start only once it settled.
   */
  afterwards(tail: Promise<unknown>): void;
}

export type JobSpec<T> = {
  /** Same key, same work: one run however many requesters want it. */
  readonly key: string;
  readonly lane: JobLane;
  /** Within its lane, lower first (then the order asked). The person lane always runs in the order asked. */
  readonly order?: number;
  /** Starts only once every earlier job's work has let go (`afterwards`), not only their runs (Clear). */
  readonly exclusive?: true;
  /** How long the lanes above must have been quiet before it starts, when longer than the scheduler's own. */
  readonly quietMs?: number;
  run(context: JobContext): Promise<T>;
};

export interface Want<T> {
  readonly key: string;
  state(): JobState<T>;
  /** How the run ended for this want; never rejects. `superseded`: it was stopped (released, replaced or pre-empted). */
  readonly settled: Promise<RunOutcome<T>>;
}

export interface JobScheduler {
  /**
   * Cooperative reads outside the single preparation slot (shared rig/catalogue dependencies must not occupy that slot). Their lane
   * holds back lower work, and `turn()` yields to higher jobs/reads and their quiet period. The caller owns cancellation; no restart or
   * commit policy is added. Use the same lanes as scheduled jobs, not a separate startup order.
   */
  cooperate<T>(lane: JobLane, run: (context: Pick<JobContext, "signal" | "turn">) => Promise<T>, signal?: AbortSignal): Promise<T>;
  /** Wants a job for `requester`, replacing its previous want. `signal` aborting releases it (a lease's, a request's). */
  want<T>(requester: string, spec: JobSpec<T>, signal?: AbortSignal): Want<T>;
  release(requester: string): void;
  /** A person is waiting on the host right now (a poll, a file of their V read): the lanes below wait until it has been quiet a moment. */
  touch(): void;
  /** A person's request is being answered outside any job (the installation check before it): the lanes below wait until it ends. */
  hold(): () => void;
  /** Whether a job of `lane` is waiting or running. */
  busy(lane: JobLane): boolean;
  /** Resolves once no job of `lane` waits or runs; without a lane, once nothing does and every job's work has let go. */
  idle(lane?: JobLane): Promise<void>;
}
