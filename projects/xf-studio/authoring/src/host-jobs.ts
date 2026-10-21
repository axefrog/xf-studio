/**
 * Host binding of the job scheduler (platform/core/jobs.ts): the host's clock and event loop, and each job followed through its async
 * work (`AsyncLocalStorage`, as `withCacheRun` follows a preparation), so code deep below a job knows the lane it serves without being
 * told:
 * - `currentLane()`: the lane of the job this code runs for (null outside any job). The resolver's WolvenKit batches use it to pick their
 *   chain and priority (resolver-host.ts).
 * - `personWorking()`: whether person work runs now anywhere in this process: background launches decide their priority from it as each
 *   starts (PIPE-96).
 * - A person's job starting raises the WolvenKit runs started below normal priority (`raiseBackgroundWolvenKit`): a stopped batch's reads
 *   may hold a resource the person now waits on.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { yieldToEventLoop } from "./event-loop";
import { hostClock, type Clock } from "./platform/core/clock";
import { createJobScheduler, type JobContext, type JobLane, type JobScheduler } from "./platform/core/jobs";
import { raiseBackgroundWolvenKit } from "./wolvenkit-cli";

const lanes = new AsyncLocalStorage<JobContext>();
let personRuns = 0;

/** The lane of the job the calling code runs for, or null outside any job. */
export const currentLane = (): JobLane | null => lanes.getStore()?.lane() ?? null;
/** Whether the calling code runs for work below the person lane (a choice prepared ahead, the V resolved after a restart). */
export const inLowerLane = (): boolean => { const lane = currentLane(); return lane === "shown" || lane === "ahead"; };
/** Whether a person's job runs now in this process. */
export const personWorking = (): boolean => personRuns > 0;
/** A launch's `lowPriority` for work below the person lane: below normal only while no person's job runs (decided as each launch starts). */
export const lowPriorityNow = (): boolean => !personWorking();

/** Runs `work` as part of a job (the scheduler's `enter`); a test can run code in a lane with it too. */
export async function inLane<T>(context: JobContext | JobLane, work: () => Promise<T>): Promise<T> {
  const job: JobContext = typeof context === "string" ? laneOnly(context) : context;
  running.add(job);
  countPerson(job);
  try { return await lanes.run(job, work); }
  finally {
    running.delete(job);
    if (counted.delete(job)) personRuns--;
  }
}
/** Jobs running now, and those counted as person work (from their start, or from when a person raised them). */
const running = new Set<JobContext>();
const counted = new Set<JobContext>();
function countPerson(job: JobContext): void {
  if (job.lane() !== "person" || counted.has(job)) return;
  counted.add(job);
  personRuns++;
  raiseBackgroundWolvenKit();
}
/**
 * A running job a person now wants (the scheduler's `raised`): from now on it is person work, so background launches run at normal
 * priority and WolvenKit runs already started below normal are raised.
 */
export function raisedToPerson(job: JobContext): void { if (running.has(job)) countPerson(job); }
function laneOnly(lane: JobLane): JobContext {
  return { signal: new AbortController().signal, lane: () => lane, progress() {}, commit() {}, turn: async () => {}, afterwards() {} };
}

/** The host's scheduler: its clock, a turn that lets waiting requests in (event-loop.ts), and every job in its lane. */
export function hostJobs(options: { clock?: Clock; quietMs?: number; report?: (error: unknown, key: string) => void } = {}): JobScheduler {
  return createJobScheduler({ clock: options.clock ?? hostClock(), quietMs: options.quietMs, report: options.report, yieldTurn: yieldToEventLoop,
    defer: run => { setImmediate(run); }, enter: inLane, raised: raisedToPerson });
}
