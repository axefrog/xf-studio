// The job scheduler (platform/core/jobs.ts) on simulated time: every scheduling rule, without the host.
import { describe, expect, test } from "bun:test";
import type { Clock } from "../src/platform/core/clock";
import { createJobScheduler, lease, type JobContext, type JobLane, type JobScheduler } from "../src/platform/core/jobs";

/** A clock whose time moves only when the test says so; zero-delay timers run on `flush`. */
function simulatedClock() {
  let time = 0, serial = 0;
  const timers: { at: number; serial: number; run: () => void }[] = [];
  const clock: Clock = {
    now: () => time, monotonic: () => time,
    after(ms, run, signal) {
      if (signal?.aborted) return;
      const timer = { at: time + ms, serial: ++serial, run };
      timers.push(timer);
      signal?.addEventListener("abort", () => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); }, { once: true });
    },
    frame(run, signal) { clock.after(16, () => run(time), signal); },
  };
  const microtasks = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  /** Runs every timer due now (and those they start), with the microtasks between them. */
  async function flush() {
    for (let guard = 0; guard < 10_000; guard++) {
      await microtasks();
      timers.sort((a, b) => a.at - b.at || a.serial - b.serial);
      const due = timers[0];
      if (!due || due.at > time) return;
      timers.shift();
      due.run();
    }
    throw Error("timers never settle");
  }
  async function advance(ms: number) {
    const target = time + ms;
    for (;;) {
      await flush();
      timers.sort((a, b) => a.at - b.at || a.serial - b.serial);
      const next = timers[0];
      if (!next || next.at > target) break;
      time = next.at;
    }
    time = target;
    await flush();
  }
  return { clock, flush, advance, now: () => time };
}

/** A job the test ends by hand, logging its start, stop and end. */
function manual(log: string[], name: string) {
  let resolve!: (value: string) => void, reject!: (error: unknown) => void, context!: JobContext;
  const done = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return {
    run: (own: JobContext) => {
      context = own;
      log.push(`start ${name}`);
      own.signal.addEventListener("abort", () => log.push(`stop ${name}`), { once: true });
      return done.then(value => { log.push(`end ${name}`); return value; });
    },
    finish: (value = name) => resolve(value), fail: (error: unknown) => reject(error), context: () => context,
  };
}

function setup(quietMs = 400) {
  const time = simulatedClock(), reported: unknown[] = [];
  const jobs = createJobScheduler({ clock: time.clock, quietMs, report: error => { reported.push(error); } });
  return { ...time, jobs, reported };
}
const want = (jobs: JobScheduler, requester: string, key: string, lane: JobLane, run: (context: JobContext) => Promise<unknown>, extra: object = {}) =>
  jobs.want(requester, { key, lane, run, ...extra });

describe("the job scheduler", () => {
  test("cooperative shown reads pause ahead reads and jobs without occupying the person preparation slot", async () => {
    const { jobs, advance, flush } = setup();
    const life = new AbortController(), shownDone = Promise.withResolvers<void>(), personDone = Promise.withResolvers<void>();
    const log: string[] = [];
    const shown = jobs.cooperate("shown", async context => { log.push("shown start"); await shownDone.promise; await context.turn(); log.push("shown end"); }, life.signal);
    await flush();
    const ahead = jobs.cooperate("ahead", async () => { log.push("ahead read"); }, life.signal);
    const background = want(jobs, "background", "background", "ahead", async () => { log.push("ahead job"); });
    const person = want(jobs, "page", "V", "person", async () => { log.push("person"); await personDone.promise; });
    shownDone.resolve(); await flush();
    expect(log).toEqual(["shown start", "person"]);
    personDone.resolve(); await person.settled; await advance(399);
    expect(log).toEqual(["shown start", "person"]);
    await advance(1); await shown; await advance(400); await ahead; await background.settled;
    expect(log).toEqual(["shown start", "person", "shown end", "ahead read", "ahead job"]);
    life.abort();
  });

  test("aborting a cooperative read waiting for priority releases its lane and listener", async () => {
    const { jobs, flush } = setup(0), life = new AbortController(), release = jobs.hold();
    let calls = 0;
    const stopped = jobs.cooperate("shown", async () => { calls++; }, life.signal).catch(error => error.name);
    life.abort(); expect(await stopped).toBe("AbortError"); expect(calls).toBe(0);
    release();
    await jobs.cooperate("ahead", async () => { calls++; }); await flush();
    expect(calls).toBe(1);
  });

  test("one run at a time; the person lane runs in the order asked (PIPE-103)", async () => {
    const { jobs, flush } = setup(), log: string[] = [];
    const a = manual(log, "a"), b = manual(log, "b");
    want(jobs, "page-1/character", "a", "person", a.run);
    want(jobs, "page-2/character", "b", "person", b.run);
    await flush();
    expect(log).toEqual(["start a"]);
    a.finish();
    await flush();
    expect(log).toEqual(["start a", "end a", "start b"]);
  });

  test("the same key from several requesters is one run, and a requester's new want replaces its previous one", async () => {
    const { jobs, flush } = setup(), log: string[] = [];
    const v = manual(log, "v"), w = manual(log, "w");
    const one = want(jobs, "page-1/character", "v", "person", v.run);
    const two = want(jobs, "page-2/character", "v", "person", () => { log.push("second run"); return Promise.resolve("never"); });
    await flush();
    expect(log).toEqual(["start v"]);
    // Page 1 moves on; page 2 still wants v, so it isn't stopped.
    want(jobs, "page-1/character", "w", "person", w.run);
    await flush();
    expect(log).toEqual(["start v"]);
    v.finish("v done");
    expect(await one.settled).toEqual({ status: "done", result: "v done" });
    expect(await two.settled).toEqual({ status: "done", result: "v done" });
    await flush();
    expect(log).toEqual(["start v", "end v", "start w"]);
  });

  test("a job no want holds is stopped; a waiting one is dropped without running; a committed one runs to its end", async () => {
    const { jobs, flush } = setup(), log: string[] = [];
    const a = manual(log, "a"), b = manual(log, "b"), c = manual(log, "c");
    const first = want(jobs, "page/character", "a", "person", a.run);
    const waiting = want(jobs, "other/character", "b", "person", b.run);
    await flush();
    jobs.release("other/character");
    expect(waiting.state()).toEqual({ phase: "stopped" });
    expect(await waiting.settled).toEqual({ status: "superseded" });
    // Replaced: stopped at once; the next starts only once its run returned.
    want(jobs, "page/character", "c", "person", c.run);
    await flush();
    expect(log).toEqual(["start a", "stop a"]);
    expect(first.state()).toEqual({ phase: "stopped" });
    a.finish();
    expect(await first.settled).toEqual({ status: "superseded" });
    await flush();
    expect(log).toEqual(["start a", "stop a", "end a", "start c"]);
    c.context().commit();
    jobs.release("page/character");
    await flush();
    expect(log).not.toContain("stop c");
    c.finish();
    await flush();
    expect(log.at(-1)).toBe("end c");
  });

  test("V1 -> V2 -> V1 starts V1 again rather than joining the stopped run", async () => {
    const { jobs, flush } = setup(), log: string[] = [];
    const v1 = manual(log, "v1"), v2 = manual(log, "v2"), again = manual(log, "v1 again");
    want(jobs, "page/character", "v1", "person", v1.run);
    await flush();
    want(jobs, "page/character", "v2", "person", v2.run);
    const third = want(jobs, "page/character", "v1", "person", again.run);
    v1.finish();
    await flush();
    expect(log).toEqual(["start v1", "stop v1", "end v1", "start v1 again"]);
    again.finish("fresh");
    expect(await third.settled).toEqual({ status: "done", result: "fresh" });
  });

  test("the lanes below wait while person work waits or runs, and until the person lane has been quiet", async () => {
    const { jobs, flush, advance } = setup(400), log: string[] = [];
    const person = manual(log, "person"), ahead = manual(log, "ahead");
    want(jobs, "page/character", "p", "person", person.run);
    want(jobs, "prefetch", "batch", "ahead", ahead.run);
    await flush();
    expect(log).toEqual(["start person"]);
    person.finish();
    await advance(399);
    expect(log).toEqual(["start person", "end person"]);
    // A file of the V read meanwhile: quiet again from now.
    jobs.touch();
    await advance(399);
    expect(log).toEqual(["start person", "end person"]);
    await advance(1);
    expect(log.at(-1)).toBe("start ahead");
  });

  test("a hold (a person's request being answered outside any job) keeps the lanes below waiting until it ends and the moment after", async () => {
    const { jobs, flush, advance } = setup(400), log: string[] = [];
    const release = jobs.hold();
    const shown = manual(log, "shown");
    want(jobs, "preview-source:k", "derive", "shown", shown.run);
    await advance(5000);
    expect(log).toEqual([]);
    release();
    await advance(399);
    expect(log).toEqual([]);
    await advance(1);
    expect(log).toEqual(["start shown"]);
    void flush;
  });

  test("shown goes before ahead, never stops a running ahead job, and ahead waits until shown has been quiet", async () => {
    const { jobs, flush, advance } = setup(400), log: string[] = [];
    const batch = manual(log, "batch"), derive = manual(log, "derive"), next = manual(log, "next batch");
    want(jobs, "prefetch", "batch", "ahead", batch.run);
    await advance(400);
    expect(log).toEqual(["start batch"]);
    want(jobs, "preview-source:k", "derive", "shown", derive.run);
    want(jobs, "prefetch-2", "next", "ahead", next.run);
    await advance(400);
    expect(log).toEqual(["start batch"]);
    batch.finish();
    await advance(400);
    expect(log).toEqual(["start batch", "end batch", "start derive"]);
    derive.finish();
    await advance(399);
    expect(log.at(-1)).toBe("end derive");
    await advance(1);
    expect(log.at(-1)).toBe("start next batch");
  });

  test("a person's work stops an uncommitted lower run and starts once it returned, not once its tail settled (PREV-102)", async () => {
    const { jobs, flush, advance } = setup(0), log: string[] = [];
    let letGo!: () => void;
    const tail = new Promise<void>(resolve => { letGo = resolve; });
    const batch = want(jobs, "prefetch", "batch", "ahead", async context => {
      log.push("start batch");
      context.afterwards(tail);
      await new Promise(resolve => context.signal.addEventListener("abort", resolve, { once: true }));
      log.push("batch returned");
      return "unused";
    });
    await advance(1);
    const person = manual(log, "person");
    want(jobs, "page/character", "v", "person", person.run);
    await flush();
    expect(log).toEqual(["start batch", "batch returned", "start person"]);
    expect(await batch.settled).toEqual({ status: "superseded" });
    // The next lower job waits for the stopped batch's tail; so does an exclusive job (Clear).
    person.finish();
    const lower = manual(log, "next batch"), clear = manual(log, "clear");
    want(jobs, "prefetch", "next", "ahead", lower.run);
    await advance(10);
    expect(log.at(-1)).toBe("end person");
    want(jobs, "host/clear", "clear", "person", clear.run, { exclusive: true });
    await advance(10);
    expect(log.at(-1)).toBe("end person");
    letGo();
    await flush();
    expect(log.at(-1)).toBe("start clear");
    clear.finish();
    await advance(10);
    expect(log.at(-1)).toBe("start next batch");
  });

  test("a person's change during a committed derivation waits for it, and its result is kept", async () => {
    const { jobs, flush, advance } = setup(0), log: string[] = [];
    const derive = manual(log, "derive"), person = manual(log, "person");
    const derived = want(jobs, "preview-source:k", "derive", "shown", derive.run);
    await advance(1);
    derive.context().commit();
    want(jobs, "page/character", "v", "person", person.run);
    await flush();
    expect(log).toEqual(["start derive"]);
    derive.finish("source");
    await flush();
    expect(log).toEqual(["start derive", "end derive", "start person"]);
    expect(await derived.settled).toEqual({ status: "done", result: "source" });
  });

  test("turn() slices, waits while a person is being answered, and throws once the job is stopped", async () => {
    const time = simulatedClock();
    let busyUntil = 0;
    const jobs = createJobScheduler({ clock: time.clock, quietMs: 100, sliceMs: 8 });
    const steps: number[] = [];
    let release: (() => void) | null = null;
    const work = jobs.want("prefetch", { key: "check", lane: "ahead", run: async context => {
      for (let step = 0; step < 6; step++) {
        busyUntil = time.now() + 5;
        steps.push(time.now());
        if (step === 2) release = jobs.hold();
        await context.turn();
      }
      return "checked";
    } });
    await time.advance(100);
    // Step 2 opened a hold: the turn after it waits.
    expect(steps).toHaveLength(3);
    await time.advance(1000);
    expect(steps).toHaveLength(3);
    release!();
    await time.advance(100);
    expect(await work.settled).toEqual({ status: "done", result: "checked" });
    void busyUntil;

    const stopped = jobs.want("prefetch", { key: "again", lane: "ahead", run: async context => { for (;;) await context.turn(); } });
    await time.advance(200);
    jobs.release("prefetch");
    await time.advance(10);
    expect(await stopped.settled).toEqual({ status: "superseded" });
  });

  test("a failure is reported once and settles as failed; nothing is unhandled (PREV-101)", async () => {
    const { jobs, flush, reported } = setup();
    const seen: unknown[] = [];
    const listener = (reason: unknown) => { seen.push(reason); };
    process.on("unhandledRejection", listener);
    try {
      const failing = want(jobs, "page/character", "f", "person", async () => { throw Error("broken"); });
      const sync = want(jobs, "other/character", "s", "person", () => { throw Error("at once"); });
      await flush();
      expect((await failing.settled).status).toBe("failed");
      expect((await sync.settled).status).toBe("failed");
      expect(failing.state().phase).toBe("failed");
      expect(reported.map(error => (error as Error).message)).toEqual(["broken", "at once"]);
      // A stopped job's error is a stop, not a failure.
      const stopped = want(jobs, "page/character", "x", "person", context => new Promise((_, reject) => context.signal.addEventListener("abort", () => reject(Error("stopped")))));
      await flush();
      jobs.release("page/character");
      expect(await stopped.settled).toEqual({ status: "superseded" });
      expect(reported).toHaveLength(2);
      await flush();
    } finally { process.off("unhandledRejection", listener); }
    expect(seen).toEqual([]);
  });

  test("a want's signal releases it; a higher lane wanting the same key raises it", async () => {
    const { jobs, flush, advance } = setup(0), log: string[] = [];
    const controller = new AbortController();
    const a = manual(log, "a");
    const held = jobs.want("page/character", { key: "a", lane: "person", run: a.run }, controller.signal);
    await flush();
    controller.abort();
    expect(held.state()).toEqual({ phase: "stopped" });
    a.finish();
    await flush();
    // An ahead job a person now wants runs in the person lane, before other lower work.
    const shared = manual(log, "shared"), other = manual(log, "other");
    want(jobs, "prefetch", "shared", "ahead", shared.run, { quietMs: 10_000 });
    want(jobs, "preview-source:k", "other", "shown", other.run, { quietMs: 10_000 });
    want(jobs, "page/character", "shared", "person", shared.run);
    await advance(1);
    expect(log.at(-1)).toBe("start shared");
    expect(shared.context().lane()).toBe("person");
  });

  test("busy and idle follow the lanes; idle without a lane waits for tails too", async () => {
    const { jobs, flush, advance } = setup(0);
    let letGo!: () => void, finish!: () => void;
    want(jobs, "prefetch", "batch", "ahead", context => { context.afterwards(new Promise<void>(resolve => { letGo = resolve; })); return new Promise<void>(resolve => { finish = resolve; }); });
    await advance(1);
    expect(jobs.busy("ahead")).toBe(true);
    expect(jobs.busy("person")).toBe(false);
    let personIdle = false, allIdle = false;
    void jobs.idle("person").then(() => { personIdle = true; });
    void jobs.idle().then(() => { allIdle = true; });
    await flush();
    expect(personIdle).toBe(true);
    finish();
    await flush();
    expect(jobs.busy("ahead")).toBe(false);
    expect(allIdle).toBe(false);
    letGo();
    await flush();
    expect(allIdle).toBe(true);
  });

  test("a lease stops what a page wanted once the page stops asking, and renewing keeps it (a closed page's work stops)", async () => {
    const { jobs, clock, flush, advance } = setup(0), log: string[] = [];
    const held = lease(clock, 90_000);
    const v = manual(log, "v");
    const wanted = jobs.want("page/character", { key: "v", lane: "person", run: v.run }, held.signal);
    await flush();
    await advance(60_000);
    held.renew();
    await advance(60_000);
    expect(log).toEqual(["start v"]);
    await advance(30_000);
    expect(log).toEqual(["start v", "stop v"]);
    v.finish();
    expect(await wanted.settled).toEqual({ status: "superseded" });
    // A lease that ends with its owner sets no further timers.
    const owner = new AbortController(), ended = lease(clock, 1000, owner.signal);
    owner.abort();
    await advance(5000);
    expect(ended.signal.aborted).toBe(false);
  });
});

describe("review fixes", () => {
  test("a requester promoting its queued job to the person lane stops a running uncommitted lower job (review 2)", async () => {
    const { jobs, flush, advance } = setup(0), log: string[] = [];
    const running = manual(log, "running"), promoted = manual(log, "promoted");
    want(jobs, "prefetch", "a", "ahead", running.run);
    await advance(1);
    want(jobs, "warm-up", "b", "ahead", promoted.run);
    await flush();
    expect(log).toEqual(["start running"]);
    // The same requester wants the same run again, now as a person's.
    want(jobs, "warm-up", "b", "person", promoted.run);
    await flush();
    expect(log).toEqual(["start running", "stop running"]);
    running.finish();
    await flush();
    expect(log).toEqual(["start running", "stop running", "end running", "start promoted"]);
  });

  test("a requester's earlier signal no longer releases the run it wants again with a newer signal (review 4)", async () => {
    const { jobs, flush } = setup(0), log: string[] = [];
    const v = manual(log, "v");
    const first = new AbortController(), second = new AbortController();
    jobs.want("page/character", { key: "v", lane: "person", run: v.run }, first.signal);
    const again = jobs.want("page/character", { key: "v", lane: "person", run: v.run }, second.signal);
    await flush();
    first.abort();
    await flush();
    expect(log).toEqual(["start v"]);
    expect(again.state().phase).toBe("running");
    second.abort();
    await flush();
    expect(log).toEqual(["start v", "stop v"]);
  });
});

describe("the raised hook re-entering the scheduler (review 4, second round)", () => {
  /** A scheduler whose `raised` hook runs `hook` once, with a job running in the ahead lane that a person then wants. */
  async function promoting(hook: (jobs: JobScheduler) => void) {
    const time = simulatedClock(), log: string[] = [];
    let jobs!: JobScheduler, once = true;
    jobs = createJobScheduler({ clock: time.clock, quietMs: 0, raised: () => { if (once) { once = false; hook(jobs); } } });
    const shared = manual(log, "shared");
    jobs.want("page/character", { key: "shared", lane: "ahead", run: shared.run }, old.signal);
    await time.advance(1);
    return { jobs, time, log, shared };
  }
  let old = new AbortController();

  test("the hook aborting the old signal doesn't cancel the replacement", async () => {
    old = new AbortController();
    const fresh = new AbortController();
    const { jobs, time, log } = await promoting(() => old.abort());
    const wanted = jobs.want("page/character", { key: "shared", lane: "person", run: async () => "unused" }, fresh.signal);
    await time.flush();
    expect(log).toEqual(["start shared"]);
    expect(wanted.state().phase).toBe("running");
  });

  test("the hook aborting the new signal releases the want", async () => {
    old = new AbortController();
    const fresh = new AbortController();
    const { jobs, time, log } = await promoting(() => fresh.abort());
    const wanted = jobs.want("page/character", { key: "shared", lane: "person", run: async () => "unused" }, fresh.signal);
    await time.flush();
    expect(log).toEqual(["start shared", "stop shared"]);
    expect(wanted.state().phase).toBe("stopped");
  });

  test("a want the hook makes keeps its own signal", async () => {
    old = new AbortController();
    const fresh = new AbortController(), newest = new AbortController();
    const { jobs, time, log } = await promoting(inner => { inner.want("page/character", { key: "shared", lane: "person", run: async () => "unused" }, newest.signal); });
    jobs.want("page/character", { key: "shared", lane: "person", run: async () => "unused" }, fresh.signal);
    await time.flush();
    // The hook's want is the newest: the outer call's signal doesn't hold the run, the hook's does.
    fresh.abort();
    await time.flush();
    expect(log).toEqual(["start shared"]);
    newest.abort();
    await time.flush();
    expect(log).toEqual(["start shared", "stop shared"]);
  });
});
