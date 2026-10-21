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

export function createTask<T>(options: TaskOptions = {}): Task<T> {
  let state: TaskState<T> = IDLE;
  let current: AbortController | null = null;
  const listeners = new Set<(state: TaskState<T>) => void>();
  const publish = (next: TaskState<T>) => {
    state = next;
    for (const listener of [...listeners]) {
      try { listener(next); } catch (error) { reportListenerError(error); }
    }
  };
  const cancel = (reason?: unknown) => {
    const run = current;
    current = null;
    run?.abort(reason ?? "cancelled");
    if (state.phase !== "idle") publish(IDLE);
  };
  options.signal?.addEventListener("abort", () => cancel("ended"), { once: true });
  return {
    state: () => state,
    async run(work) {
      if (options.signal?.aborted) return SUPERSEDED;
      current?.abort("superseded");
      const own = new AbortController();
      current = own;
      publish(RUNNING);
      try {
        const result = await work(own.signal);
        if (current !== own || own.signal.aborted) return SUPERSEDED;
        publish(Object.freeze({ phase: "done", result }));
        return { status: "done", result };
      } catch (error) {
        if (current !== own || own.signal.aborted) return SUPERSEDED;
        publish(Object.freeze({ phase: "failed", error }));
        return { status: "failed", error };
      }
    },
    cancel,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/** A listener that throws never stops the others or the task; its error is rethrown on its own, where uncaught errors are reported. */
function reportListenerError(error: unknown): void { queueMicrotask(() => { throw error; }); }
