/**
 * A task's contract (`platform/core/tasks.ts` implements it): one piece of asynchronous work whose newest request wins.
 * Each `run` aborts the run before it, only the newest run may publish, and the task publishes its state to subscribers:
 *
 * - `idle`: nothing has run yet, or the last run was cancelled;
 * - `running`: the newest run is under way;
 * - `done` with its result, or `failed` with its error: how the newest run ended.
 *
 * A run's signal stays live after the run finishes, until a newer run, `cancel` or the task's own lifetime aborts it, so
 * a result can hold resources (a loaded module, a worker) for exactly as long as it is current. Types only.
 */

export type TaskState<T> =
  | { readonly phase: "idle" }
  | { readonly phase: "running" }
  | { readonly phase: "done"; readonly result: T }
  | { readonly phase: "failed"; readonly error: unknown };

/** How one run ended for its caller: with its result or error, or `superseded` when a newer run or cancel replaced it. */
export type RunOutcome<T> =
  | { readonly status: "done"; readonly result: T }
  | { readonly status: "failed"; readonly error: unknown }
  | { readonly status: "superseded" };

export interface Task<T> {
  state(): TaskState<T>;
  /** Starts `work`, aborting the previous run. Resolves when this run ends or is superseded; never rejects. */
  run(work: (signal: AbortSignal) => Promise<T> | T): Promise<RunOutcome<T>>;
  /** Aborts the current run (if any) and returns to `idle`. */
  cancel(reason?: unknown): void;
  /** Calls `listener` with every new state; returns the unsubscribe. */
  subscribe(listener: (state: TaskState<T>) => void): () => void;
}
