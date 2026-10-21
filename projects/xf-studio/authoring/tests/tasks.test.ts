import { expect, test } from "bun:test";
import { createTask, type TaskState } from "../src/platform/core/tasks";

/** A run the test finishes by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("a newer run aborts the one before, and a superseded result never publishes", async () => {
  const task = createTask<string>(), states: TaskState<string>[] = [], signals: AbortSignal[] = [];
  task.subscribe(state => states.push(state));
  const first = deferred<string>(), second = deferred<string>();
  const a = task.run(signal => { signals.push(signal); return first.promise; });
  const b = task.run(signal => { signals.push(signal); return second.promise; });
  expect(signals[0].aborted).toBe(true); expect(signals[1].aborted).toBe(false);
  first.resolve("stale");
  expect(await a).toEqual({ status: "superseded" });
  expect(task.state()).toEqual({ phase: "running" });
  second.resolve("fresh");
  expect(await b).toEqual({ status: "done", result: "fresh" });
  expect(task.state()).toEqual({ phase: "done", result: "fresh" });
  expect(states.map(state => state.phase)).toEqual(["running", "running", "done"]);
  // The newest run's signal stays live after it finishes, until something supersedes it.
  expect(signals[1].aborted).toBe(false);
  task.cancel(); expect(signals[1].aborted).toBe(true); expect(task.state()).toEqual({ phase: "idle" });
});

test("errors are surfaced as failed, unless the run was already superseded", async () => {
  const task = createTask<number>(), first = deferred<number>();
  const stale = task.run(() => first.promise);
  const failing = task.run(async () => { throw new Error("broken"); });
  first.reject(new Error("late"));
  expect(await stale).toEqual({ status: "superseded" });
  const outcome = await failing;
  expect(outcome.status).toBe("failed");
  expect(task.state().phase).toBe("failed");
  expect((task.state() as { error: Error }).error.message).toBe("broken");
  // A synchronous throw is a failure too.
  expect((await task.run(() => { throw new Error("now"); })).status).toBe("failed");
});

test("cancel aborts the running work and returns to idle; a cancelled run's result never publishes", async () => {
  const task = createTask<string>(), work = deferred<string>();
  let signal!: AbortSignal;
  const run = task.run(own => { signal = own; return work.promise; });
  task.cancel("stop");
  expect(signal.aborted).toBe(true); expect(signal.reason).toBe("stop"); expect(task.state()).toEqual({ phase: "idle" });
  work.resolve("too late");
  expect(await run).toEqual({ status: "superseded" }); expect(task.state()).toEqual({ phase: "idle" });
});

test("the task's lifetime cancels the current run and refuses later ones", async () => {
  const life = new AbortController(), task = createTask<string>({ signal: life.signal }), work = deferred<string>();
  let signal!: AbortSignal;
  const run = task.run(own => { signal = own; return work.promise; });
  life.abort();
  expect(signal.aborted).toBe(true); expect(task.state()).toEqual({ phase: "idle" });
  work.resolve("after the end");
  expect(await run).toEqual({ status: "superseded" });
  let started = false;
  expect(await task.run(async () => { started = true; return "never"; })).toEqual({ status: "superseded" });
  expect(started).toBe(false);
});

test("unsubscribed listeners hear nothing, and a throwing listener stops neither the others nor the task", async () => {
  const task = createTask<number>(), heard: string[] = [];
  const off = task.subscribe(state => heard.push(`a:${state.phase}`));
  task.subscribe(() => { throw new Error("listener bug"); });
  task.subscribe(state => heard.push(`c:${state.phase}`));
  const thrown: unknown[] = [];
  const original = globalThis.queueMicrotask;
  globalThis.queueMicrotask = (run: () => void) => { try { run(); } catch (error) { thrown.push(error); } };
  try {
    expect(await task.run(() => 1)).toEqual({ status: "done", result: 1 });
    off();
    await task.run(() => 2);
  } finally { globalThis.queueMicrotask = original; }
  expect(heard).toEqual(["a:running", "c:running", "a:done", "c:done", "c:running", "c:done"]);
  expect(thrown.length).toBe(4);
});
