/**
 * Simulated sources for deterministic simulation testing: seeded randomness, a scheduler that owns virtual time and
 * every pending event, and simulated clock, jobs, files, input and request sources. Given a seed (and the same
 * steps), a run is exactly repeatable.
 */
import { JobQueue } from "../sources";
import type { AbortSignalLike } from "../kernel/abort";
import type { Clock, FileSource, InputEvent, InputSource, JobPriority, JobSource, RequestSource } from "../sources";

/** One pending event in the scheduler's queue. */
export type SimEvent = { readonly id: number; readonly due: number; readonly kind: string; readonly label: string; run(): void; cancelled?: boolean };

/**
 * The scheduler: virtual time and every pending source event (timers, store replies, job completions, requests).
 * Nothing happens unless a step delivers it; `deliver(pick)` chooses which pending event runs next (by index into the
 * queue ordered by due time), so a seed-driven policy explores orderings, and a trace replays them exactly.
 */
export class Scheduler {
  now = 0;
  private events: SimEvent[] = [];
  private nextId = 1;
  readonly log: string[] = [];
  /** `epoch`: the wall time at virtual time 0 (1 January 2026, UTC). */
  constructor(readonly epoch = 1_767_225_600_000) {}

  /** Queues an event `delay` ms from now. Returns a cancel function. */
  schedule(delay: number, kind: string, label: string, run: () => void): () => void {
    const event: SimEvent = { id: this.nextId++, due: this.now + Math.max(0, delay), kind, label, run };
    this.events.push(event);
    return () => { event.cancelled = true; };
  }
  /** Pending events, earliest first (ties by queue order). */
  pending(): readonly SimEvent[] {
    this.events = this.events.filter(event => !event.cancelled);
    return [...this.events].sort((a, b) => a.due - b.due || a.id - b.id);
  }
  /** Runs one pending event, chosen by `pick` among the pending (modulo their count); time moves to its due time if later. */
  deliver(pick: number): SimEvent | undefined {
    const pending = this.pending();
    if (!pending.length) return undefined;
    const event = pending[Math.abs(Math.floor(pick)) % pending.length];
    this.events = this.events.filter(item => item !== event);
    if (event.due > this.now) this.now = event.due;
    this.log.push(`${this.now} ${event.kind} ${event.label}`);
    event.run();
    return event;
  }
  /** Advances time by `ms`, running every event that falls due, in order. */
  advance(ms: number): number {
    const until = this.now + Math.max(0, ms);
    let ran = 0;
    for (;;) {
      const next = this.pending()[0];
      if (!next || next.due > until) break;
      this.deliver(0);
      ran++;
    }
    this.now = until;
    return ran;
  }
  /** Drops every pending event (a crash loses in-flight work). */
  drop(kinds?: readonly string[]): void { this.events = this.events.filter(event => kinds && !kinds.includes(event.kind)); }
}

/** A clock on the scheduler's virtual time. */
export function simClock(scheduler: Scheduler): Clock {
  return {
    now: () => scheduler.epoch + scheduler.now,
    monotonic: () => scheduler.now,
    after: (ms, run, signal) => {
      if (signal?.aborted) return;
      const cancel = scheduler.schedule(ms, "timer", `after ${ms}`, run);
      signal?.addEventListener("abort", cancel, { once: true });
    },
    frame: (run, signal) => {
      if (signal?.aborted) return;
      const cancel = scheduler.schedule(16, "frame", "frame", () => run(scheduler.now));
      signal?.addEventListener("abort", cancel, { once: true });
    },
  };
}

/** Lets pending promise reactions run (the harness calls it after every step; the engine's chains are short). */
export async function settle(turns = 24): Promise<void> { for (let i = 0; i < turns; i++) await Promise.resolve(); }

/**
 * Simulated jobs: completions the scheduler orders, delays and fails, with results from a pure function. A job queue
 * with priorities decides what starts: the person's jobs before background jobs queued earlier and not yet running.
 * `starts` records each start and what was waiting, for the pre-emption invariant.
 */
export class SimJobs implements JobSource {
  private queue: JobQueue<{ kind: string; input: unknown; priority: JobPriority; resolve(value: unknown): void; reject(error: unknown): void }>;
  readonly starts: { kind: string; priority: JobPriority; waitingUser: number }[] = [];
  failNext = 0;
  constructor(private scheduler: Scheduler, private compute: (kind: string, input: unknown) => unknown, slots = 1, private delay = 20) {
    this.queue = new JobQueue(slots);
  }
  run<T>(job: { readonly kind: string; readonly input: unknown; readonly priority: JobPriority }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ ...job, resolve: resolve as (value: unknown) => void, reject }, job.priority);
      this.startAll();
    });
  }
  private startAll(): void {
    for (let job = this.queue.take(); job; job = this.queue.take()) {
      const started = job;
      this.starts.push({ kind: started.kind, priority: started.priority, waitingUser: this.queue.waiting.filter(item => item.priority === "user").length });
      this.scheduler.schedule(this.delay, "job", started.kind, () => {
        this.queue.done();
        if (this.failNext > 0) { this.failNext--; started.reject(new Error("The job failed.")); }
        else started.resolve(this.compute(started.kind, started.input));
        this.startAll();
      });
    }
  }
}

/** An in-memory file tree from fixtures, read through the scheduler (latency, failures). */
export class SimFiles implements FileSource {
  failNext = 0;
  constructor(private scheduler: Scheduler, readonly files: Map<string, Uint8Array> = new Map(), private delay = 5) {}
  private later<T>(label: string, value: () => T): Promise<T> {
    return new Promise((resolve, reject) => this.scheduler.schedule(this.delay, "files", label, () => {
      if (this.failNext > 0) { this.failNext--; reject(new Error("The file couldn't be read.")); return; }
      try { resolve(value()); } catch (error) { reject(error); }
    }));
  }
  list(folder: string) {
    const prefix = folder.endsWith("/") ? folder : `${folder}/`;
    return this.later(`list ${folder}`, () => [...this.files.entries()].filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path, bytes]) => ({ name: path.slice(prefix.length), size: bytes.length, modified: 0, folder: false })));
  }
  read(path: string) {
    return this.later(`read ${path}`, () => { const bytes = this.files.get(path); if (!bytes) throw new Error("No such file."); return bytes; });
  }
}

/** Scripted and generated input: `emit` delivers an event through the scheduler, so input interleaves with everything else. */
export class SimInput implements InputSource {
  private listeners = new Set<(event: InputEvent) => void>();
  constructor(private scheduler: Scheduler) {}
  subscribe(listener: (event: InputEvent) => void, signal: AbortSignalLike) {
    if (signal.aborted) return;
    this.listeners.add(listener);
    signal.addEventListener("abort", () => this.listeners.delete(listener), { once: true });
  }
  emit(event: InputEvent, delay = 0): void {
    this.scheduler.schedule(delay, "input", event.kind, () => { for (const listener of [...this.listeners]) listener(event); });
  }
}

/**
 * A scripted responder (the network, or the game bridge as another actor): each request is answered through the
 * scheduler after a delay, so answers can be reordered; `lose` drops the next answers, `stale` answers from before.
 */
export class SimRequests<Q, A> implements RequestSource<Q, A> {
  lose = 0;
  constructor(private scheduler: Scheduler, private respond: (query: Q) => A, private delay = 10) {}
  request(query: Q): Promise<A> {
    return new Promise(resolve => this.scheduler.schedule(this.delay, "request", "request", () => {
      if (this.lose > 0) { this.lose--; return; }
      resolve(this.respond(query));
    }));
  }
}
