/**
 * The task primitive (`platform/api/tasks.ts`): newest request wins, a superseded run never publishes, errors surface as
 * `failed`, and every run is cancellable through its `AbortSignal`.
 */
import type { RunOutcome, Task, TaskState } from "../api/tasks";
export type { RunOutcome, Task, TaskState } from "../api/tasks";

export type TaskOptions = {
  /** The task's lifetime: when it aborts, the current run is cancelled and later runs end at once as superseded. */
  readonly signal?: AbortSignal;
};

const IDLE = Object.freeze({ phase: "idle" as const });
const RUNNING = Object.freeze({ phase: "running" as const });
const SUPERSEDED = Object.freeze({ status: "superseded" as const });

/** One run: its signal, and how it ends for its caller (settled once). */
type Run<T> = { readonly controller: AbortController; settle(outcome: RunOutcome<T>): void };

export function createTask<T>(options: TaskOptions = {}): Task<T> {
  const lifetime = options.signal;
  let state: TaskState<T> = IDLE;
  let current: Run<T> | null = null;
  const listeners = new Set<(state: TaskState<T>) => void>();
  /** Counts publications: a transition a listener makes ends the publication the others were still hearing. */
  let publication = 0;
  const publish = (next: TaskState<T>) => {
    state = next;
    const own = ++publication;
    for (const listener of [...listeners]) {
      if (publication !== own) return;
      try { listener(next); } catch (error) { reportListenerError(error); }
    }
  };
  /** The lifetime's listener is attached only while there is a current run, so a task nobody uses holds nothing. */
  const ended = () => cancel("ended");
  const own = (run: Run<T> | null) => {
    const had = current !== null;
    current = run;
    if (lifetime && had !== (run !== null)) {
      if (run) lifetime.addEventListener("abort", ended, { once: true }); else lifetime.removeEventListener("abort", ended);
    }
  };
  /** Ends `run` as superseded: its caller hears at once, then its signal aborts (abort listeners may start other runs). */
  const supersede = (run: Run<T>, reason: unknown) => { run.settle(SUPERSEDED); run.controller.abort(reason); };
  const cancel = (reason?: unknown) => {
    const run = current;
    if (!run) { if (state.phase !== "idle") publish(IDLE); return; }
    own(null);
    supersede(run, reason ?? "cancelled");
    // An abort listener may have started a newer run; it owns the state now.
    if (current === null && state.phase !== "idle") publish(IDLE);
  };
  return {
    state: () => state,
    run(work) {
      if (lifetime?.aborted) return Promise.resolve(SUPERSEDED);
      let settle!: (outcome: RunOutcome<T>) => void;
      const outcome = new Promise<RunOutcome<T>>(resolve => { settle = resolve; });
      let settled = false;
      const run: Run<T> = { controller: new AbortController(), settle: value => { if (!settled) { settled = true; settle(value); } } };
      // Ownership first, so a run started while the previous one aborts (or while subscribers hear of this one) supersedes this.
      const previous = current;
      own(run);
      if (previous) supersede(previous, "superseded");
      if (current !== run) return outcome;
      publish(RUNNING);
      if (current !== run) return outcome;
      const finish = (next: TaskState<T>, result: RunOutcome<T>) => {
        // A late completion of a superseded or cancelled run publishes nothing: its caller already heard.
        if (current !== run || run.controller.signal.aborted) return;
        run.settle(result);
        publish(next);
      };
      let pending: Promise<T> | T;
      try { pending = work(run.controller.signal); } catch (error) { pending = Promise.reject(error); }
      Promise.resolve(pending).then(
        result => finish(Object.freeze({ phase: "done", result }), { status: "done", result }),
        error => finish(Object.freeze({ phase: "failed", error }), { status: "failed", error }));
      return outcome;
    },
    cancel,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/** A listener that throws never stops the others or the task; its error is rethrown on its own, where uncaught errors are reported. */
function reportListenerError(error: unknown): void { queueMicrotask(() => { throw error; }); }
