// The plan module (tools/testing/plan.ts): retry, alternatives, branches, guards, deadlines, the failure ladder,
// the report stream, cancellation and restart, with a fake executor and a deterministic clock. Plus the Story
// Engine's scene A (a market pickpocket with a declared theft) on stub primitives.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkPlan, describePlan, matches, runPlan, type Action, type ExecContext, type Outcome, type Plan, type RunPlanOptions } from "../testing/plan.ts";
import { FakeClock } from "./fake-clock.ts";

type Script = (action: Action, context: ExecContext, n: number) => Outcome | Promise<Outcome> | "hang";

/** A fake executor: a script per action kind; records every call. */
function fake(scripts: Record<string, Script>, clock: FakeClock) {
  const calls: { action: Action; at: number; step: string }[] = [];
  const counts = new Map<string, number>();
  return {
    calls,
    executor: {
      async run(action: Action, context: ExecContext): Promise<Outcome> {
        const n = (counts.get(action.do) ?? 0) + 1;
        counts.set(action.do, n);
        calls.push({ action, at: clock.now(), step: context.step });
        const script = scripts[action.do];
        if (!script) return { ok: true };
        const answer = await script(action, context, n);
        if (answer === "hang") return new Promise<Outcome>(() => {});
        return answer;
      },
    },
  };
}

const run = (plan: Plan, options: Partial<RunPlanOptions> & Pick<RunPlanOptions, "executor">, clock: FakeClock) => runPlan(plan, { clock, ...options });

describe("plan: anticipation per step", () => {
  test("retry with growing backoff, until success", async () => {
    const clock = new FakeClock();
    const { executor, calls } = fake({ "x.do": (_a, _c, n) => (n < 3 ? { ok: false, code: "busy" } : { ok: true, value: { n } }) }, clock);
    const result = await run({ id: "p", steps: [{ label: "s", do: "x.do", retry: { times: 4, backoff_ms: 500, factor: 2 }, bind: "got" }] }, { executor }, clock);
    expect(result.status).toBe("done");
    expect(result.outcome).toBe("completed");
    expect(calls.map((c) => c.at)).toEqual([0, 500, 1500]);
    expect(result.bindings.got).toEqual({ n: 3 });
    expect(result.reports.filter((r) => r.kind === "attempt").length).toBe(3);
  });

  test("retry.on retries only the anticipated codes", async () => {
    const clock = new FakeClock();
    const { executor, calls } = fake({ "x.do": () => ({ ok: false, code: "refused" }) }, clock);
    const result = await run({ id: "p", steps: [{ do: "x.do", retry: { times: 5, on: { code: "busy" } } }] }, { executor }, clock);
    expect(calls.length).toBe(1);
    expect(result.status).toBe("failed");
    expect(result.outcome).toBe("abandoned");
    expect(result.reason).toContain("refused");
  });

  test("alternatives are tried in order when the route before fails", async () => {
    const clock = new FakeClock();
    const { executor, calls } = fake({ "route.a": () => ({ ok: false, code: "no" }), "route.b": () => ({ ok: false, code: "no" }), "route.c": () => ({ ok: true, value: "c" }) }, clock);
    const result = await run({ id: "p", steps: [{ label: "open", do: "route.a", alternatives: [[{ do: "route.b" }], [{ do: "route.c" }]], bind: "how" }, { do: "after" }] }, { executor }, clock);
    expect(calls.map((c) => c.action.do)).toEqual(["route.a", "route.b", "route.c", "after"]);
    expect(result.status).toBe("done");
    const step = result.reports.find((r) => r.kind === "step" && r.label === "open")!;
    expect(step.route).toBe(3);
  });

  test("outcome branches: run a step list, go to a label, or stop", async () => {
    const clock = new FakeClock();
    const { executor, calls } = fake({
      "key.press": (_a, _c, n) => (n === 1 ? { ok: false, code: "not_foreground" } : { ok: true }),
      "check": () => ({ ok: true, value: { mode: "b" } }),
    }, clock);
    const plan: Plan = {
      id: "p",
      steps: [
        { label: "press", do: "key.press", outcomes: [{ name: "behind", match: { code: "not_foreground" }, run: [{ do: "window.wait_front" }, { do: "key.press" }] }] },
        { label: "look", do: "check", outcomes: [{ match: { path: "mode", equals: "a" }, goto: "a" }, { match: { path: "mode", equals: "b" }, goto: "b" }] },
        { label: "a", do: "route.a" },
        { label: "b", do: "route.b" },
        { do: "stopper", outcomes: [{ match: { ok: true }, result: "stop" }] },
        { do: "never" },
      ],
    };
    const result = await run(plan, { executor }, clock);
    expect(calls.map((c) => c.action.do)).toEqual(["key.press", "window.wait_front", "key.press", "check", "route.b", "stopper"]);
    expect(result.status).toBe("stopped");
    expect(result.reports.find((r) => r.label === "press" && r.kind === "step")!.branch).toBe("behind");
  });

  test("a branch can match an observed state instead of the result", async () => {
    const clock = new FakeClock();
    const { executor, calls } = fake({ "overlay.state": () => ({ ok: true, value: { cet_open: false } }), "open": () => ({ ok: true }) }, clock);
    const plan: Plan = { id: "p", steps: [{ do: "open", outcomes: [{ name: "not_seen", observe: { do: "overlay.state" }, match: { path: "cet_open", equals: false }, run: [{ do: "capture.compare" }] }] }] };
    await run(plan, { executor }, clock);
    expect(calls.map((c) => c.action.do)).toEqual(["open", "overlay.state", "capture.compare"]);
  });

  test("until polls on an interval and fails at its deadline", async () => {
    const clock = new FakeClock();
    const { executor, calls } = fake({ "ping": (_a, _c, n) => ({ ok: n >= 4 }), "never": () => ({ ok: false, code: "no_bridge" }) }, clock);
    const ok = await run({ id: "p", steps: [{ do: "ping", until: { ok: true }, interval_ms: 2000, deadline_ms: 60000 }] }, { executor }, clock);
    expect(ok.status).toBe("done");
    expect(calls.map((c) => c.at)).toEqual([0, 2000, 4000, 6000]);
    const late = await run({ id: "q", steps: [{ do: "never", until: { ok: true }, interval_ms: 1000, deadline_ms: 5000 }] }, { executor }, clock);
    expect(late.status).toBe("failed");
    expect(late.reason).toContain("deadline");
  });

  test("every wait has a deadline: a hanging action fails with deadline, then the fallback runs", async () => {
    const clock = new FakeClock();
    const { executor, calls } = fake({ "hang": () => "hang" }, clock);
    const result = await run({ id: "p", steps: [{ label: "h", do: "hang", deadline_ms: 3000, fallback: [{ do: "rescue" }] }, { do: "after" }] }, { executor }, clock);
    expect(result.status).toBe("done");
    expect(calls.map((c) => [c.action.do, c.at])).toEqual([["hang", 0], ["rescue", 3000], ["after", 3000]]);
    expect(result.reports.find((r) => r.kind === "attempt" && r.label === "h")!.code).toBe("deadline");
  });

  test("the default deadline applies when a step names none", async () => {
    const clock = new FakeClock();
    const { executor } = fake({ "hang": () => "hang" }, clock);
    const result = await run({ id: "p", steps: [{ do: "hang" }] }, { executor, defaultDeadlineMs: 7000 }, clock);
    expect(result.status).toBe("failed");
    expect(clock.now()).toBe(7000);
  });

  test("on_fail: continue goes on (the close says partial), stop ends everything", async () => {
    const clock = new FakeClock();
    const { executor, calls } = fake({ "bad": () => ({ ok: false, code: "x" }) }, clock);
    const partial = await run({ id: "p", steps: [{ do: "bad", on_fail: "continue" }, { do: "good" }] }, { executor }, clock);
    expect(partial.status).toBe("done");
    expect(partial.outcome).toBe("partial");
    const stopped = await run({ id: "q", steps: [{ do: "bad", on_fail: "stop" }, { do: "good" }] }, { executor }, clock);
    expect(stopped.status).toBe("stopped");
    expect(calls.filter((c) => c.action.do === "good").length).toBe(1);
  });

  test("preconditions: skip, wait until met, or fail into the fallback", async () => {
    const clock = new FakeClock();
    const { executor, calls } = fake({ "phase": (_a, _c, n) => ({ ok: true, value: { phase: n >= 3 ? "photo_mode" : "gameplay" } }) }, clock);
    const plan: Plan = {
      id: "p",
      steps: [
        { label: "skipped", do: "skip.me", when: { match: { ref: "$flag", equals: true } } },
        { label: "waits", do: "act", when: { check: { do: "phase" }, match: { path: "phase", equals: "photo_mode" }, wait_ms: 5000, interval_ms: 1000 } },
        { label: "fails", do: "act2", when: { match: { ref: "$flag", equals: true }, otherwise: "fallback" }, fallback: [{ do: "instead" }] },
        { label: "never-started", do: "act3", when: { match: { ref: "$flag", equals: true }, otherwise: "fail" }, fallback: [{ do: "not-this" }], on_fail: "continue" },
      ],
    };
    const result = await run(plan, { executor, bindings: { flag: false } }, clock);
    expect(calls.map((c) => c.action.do)).toEqual(["phase", "phase", "phase", "act", "instead"]);
    expect(result.reports.find((r) => r.label === "skipped" && r.kind === "step")!.status).toBe("skipped");
    expect(result.status).toBe("done");
  });

  test("references resolve from the bindings; an unbound one fails without calling the executor", async () => {
    const clock = new FakeClock();
    const { executor, calls } = fake({ "spawn": () => ({ ok: true, value: { who: "a4" } }) }, clock);
    const result = await run({ id: "p", steps: [{ do: "spawn", bind: "actor" }, { do: "move", who: "$actor.who" }, { do: "move", who: "$nobody.who" }] }, { executor }, clock);
    expect(calls.map((c) => c.action.who ?? null)).toEqual([null, "a4"]);
    expect(result.reason).toContain("unbound");
  });

  test("an executor's halt stops the plan at once; finally still runs", async () => {
    const clock = new FakeClock();
    const { executor, calls } = fake({ "write": () => ({ ok: false, code: "handed_over", halt: "the game was handed to the player" }) }, clock);
    const result = await run({ id: "p", steps: [{ do: "write", on_fail: "continue" }, { do: "more" }], finally: [{ do: "teardown" }] }, { executor }, clock);
    expect(result.status).toBe("stopped");
    expect(result.reason).toBe("the game was handed to the player");
    expect(calls.map((c) => c.action.do)).toEqual(["write", "teardown"]);
  });

  test("exhaustive: an outcome no branch anticipated is reported unanticipated and takes the fallback", async () => {
    const clock = new FakeClock();
    const { executor, calls } = fake({ "lift": () => ({ ok: true, value: { lifted: "maybe" } }) }, clock);
    const result = await run({ id: "p", exhaustive: true, steps: [{ label: "lift", do: "lift", outcomes: [{ name: "lifted", match: { path: "lifted", equals: true } }], fallback: [{ do: "fb" }] }] }, { executor }, clock);
    expect(calls.map((c) => c.action.do)).toEqual(["lift", "fb"]);
    expect(result.reports.find((r) => r.label === "lift" && r.kind === "step")!.unanticipated).toBe(true);
  });

  test("a goto loop is bounded by max_steps", async () => {
    const clock = new FakeClock();
    const { executor } = fake({}, clock);
    const result = await run({ id: "p", max_steps: 20, steps: [{ label: "top", do: "x", outcomes: [{ match: { ok: true }, goto: "top" }] }] }, { executor }, clock);
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("More than 20 steps");
  });
});

describe("plan: roles, the blackboard and the report stream", () => {
  test("together runs a joint beat at once and shares one blackboard read", async () => {
    const clock = new FakeClock();
    let reads = 0;
    const { executor, calls } = fake({ "talk": (a) => clock.sleep(a.who === "a1" ? 2000 : 1000).then(() => ({ ok: true, value: a.who })) }, clock);
    const result = await runPlan({ id: "p", cast: ["speaker", "listener"], steps: [{ label: "beat", together: [{ roles: ["speaker"], do: "talk", who: "$cast.speaker" }, { roles: ["listener"], do: "talk", who: "$cast.listener" }] }] },
      { clock, cast: { speaker: "a1", listener: "a2" }, executor: { ...executor, snapshot: async () => ({ v: { watching: true }, read: ++reads }) } });
    expect(result.status).toBe("done");
    expect(reads).toBe(1);
    expect(calls.map((c) => c.at)).toEqual([0, 0]);
    expect(clock.now()).toBe(2000);
  });

  test("a substitute takes a role: the cast binding decides who acts", async () => {
    const clock = new FakeClock();
    const { executor, calls } = fake({}, clock);
    const plan: Plan = { id: "p", cast: ["mark"], steps: [{ roles: ["mark"], do: "npc.face", who: "$cast.mark" }] };
    await runPlan(plan, { clock, executor, cast: { mark: "a2" } });
    await runPlan(plan, { clock, executor, cast: { mark: "crowd:10229306" } });
    expect(calls.map((c) => c.action.who)).toEqual(["a2", "crowd:10229306"]);
  });

  test("report keys are idempotent per plan, step and attempt, with exactly one close", async () => {
    const clock = new FakeClock();
    const { executor } = fake({ "x": (_a, _c, n) => ({ ok: n > 1 }) }, clock);
    const seen: string[] = [];
    const result = await runPlan({ id: "scene-7", steps: [{ label: "s", do: "x", retry: { times: 2, backoff_ms: 10 } }, { do: "y" }] }, { clock, executor, report: (e) => seen.push(e.key) });
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.every((key) => key.startsWith("scene-7#"))).toBe(true);
    expect(result.reports.filter((r) => r.kind === "close").length).toBe(1);
    expect(result.reports.at(-1)).toMatchObject({ kind: "close", outcome: "completed", last_step: "2" });
  });

  test("one signal cancels the plan; the close says abandoned, cancelled; release still runs", async () => {
    const clock = new FakeClock();
    const stop = new AbortController();
    // The load lands 1 s into the walk (on the clock), long before the walk's deadline.
    const { executor, calls } = fake({ "walk": (_a, c) => { void clock.sleep(1000).then(() => stop.abort()); return new Promise((resolve) => c.signal.addEventListener("abort", () => resolve({ ok: false, code: "cancelled" }))); } }, clock);
    const result = await runPlan({ id: "p", steps: [{ do: "walk", deadline_ms: 60000, fallback: [{ do: "not-on-cancel" }] }, { do: "never" }], finally: [{ do: "release" }] }, { clock, executor, signal: stop.signal });
    expect(clock.now()).toBe(1000);
    expect(result.status).toBe("cancelled");
    expect(result.outcome).toBe("abandoned");
    expect(calls.map((c) => c.action.do)).toEqual(["walk", "release"]);
  });

  test("restart at a step: nothing earlier runs, and the deadline counts from the phase's start", async () => {
    const clock = new FakeClock();
    clock.t = 50_000;
    const { executor, calls } = fake({ "hang": () => "hang" }, clock);
    const plan: Plan = { id: "p", deadline_ms: 60_000, steps: [{ label: "one", do: "a" }, { label: "two", do: "hang", deadline_ms: 30_000 }] };
    const result = await runPlan(plan, { clock, executor, start: { step: "two", at_ms: 40_000 } });
    expect(calls.map((c) => c.action.do)).toEqual(["hang"]);
    // 60 s from 40 s is 100 s: the step's own 30 s from 50 s ends first, at 80 s.
    expect(clock.now()).toBe(80_000);
    expect(result.status).toBe("failed");
  });

  test("escalation: the owner's answer is taken; without one, the default is forced", async () => {
    const clock = new FakeClock();
    const { executor, calls } = fake({ "fail": () => ({ ok: false, code: "blocked" }) }, clock);
    const plan: Plan = { id: "p", steps: [{ do: "fail" }], on_abandon: { ask: { question: "drop a rung?", choices: ["residue", "dissolve"], default: "dissolve", deadline_ms: 1000 }, dissolve: [{ do: "dissolve" }] } };
    const answered = await runPlan(plan, { clock, executor, decide: async () => "residue" });
    expect(answered.decision).toBe("residue");
    expect(answered.outcome).toBe("partial");
    expect(calls.map((c) => c.action.do)).toEqual(["fail"]);
    const forced = await runPlan(plan, { clock, executor, decide: () => new Promise(() => {}) });
    expect(forced.decision).toBe("dissolve");
    expect(forced.reports.find((r) => r.kind === "escalate")!.forced).toBe(true);
    expect(calls.map((c) => c.action.do)).toEqual(["fail", "fail", "dissolve"]);
  });
});

describe("plan: data", () => {
  test("checkPlan names every problem", () => {
    const problems = checkPlan({
      id: "bad id!",
      cast: ["thief"],
      steps: [
        { label: "a", do: "x", retry: { times: 99 }, roles: ["mark"] },
        { label: "a", do: "x", who: "$cast.mark", outcomes: [{ match: { ok: true }, goto: "nowhere" }] },
        { do: "x", end: "ok" },
        { do: "x", when: { match: { colour: "red" } as never } },
        { do: "x", on_fail: "explode" as never, deadline_ms: 0 },
      ],
    });
    const text = problems.join("\n");
    for (const expected of ["plan id", 'label "a" is used more than once', "retry.times", "role mark is not in the plan's cast", "$cast.mark name no role", 'goto "nowhere"', "exactly one of do, end, together or sequence", "unknown match field colour", "on_fail is", "deadline_ms must be"]) expect(text).toContain(expected);
  });

  test("matches covers its predicates", () => {
    const o: Outcome = { ok: true, value: { motion: { effective: "reduced" }, n: 3, list: ["a", "b"], text: "hello world" } };
    expect(matches({ path: "motion.effective", equals: "reduced" }, o)).toBe(true);
    expect(matches({ path: "n", min: 2, max: 3 }, o)).toBe(true);
    expect(matches({ path: "list", contains: "b" }, o)).toBe(true);
    expect(matches({ path: "text", contains: "world" }, o)).toBe(true);
    expect(matches({ path: "missing", exists: false }, o)).toBe(true);
    expect(matches({ any: [{ code: "x" }, { ok: true }] }, o)).toBe(true);
    expect(matches({ not: { ok: true } }, o)).toBe(false);
    expect(matches({ path: "n", equals: "$want" }, o, { want: 3 })).toBe(true);
    expect(matches({ ref: "$board.v.in_view", equals: true }, { ok: true }, { board: { v: { in_view: true } } })).toBe(true);
    expect(matches({ code: ["a", "b"] }, { ok: false, code: "b" })).toBe(true);
  });
});

describe("scene A: a pickpocketing at the market (stub primitives)", () => {
  const scene = JSON.parse(readFileSync(join(import.meta.dir, "..", "testing", "fixtures", "scene-a-pickpocket.plan.json"), "utf8")) as Plan;
  const board = (v: Record<string, unknown>) => async () => ({ v: { distance_m: 12, line_of_sight: true, following: false, attacking: false, ...v }, incident: null });
  const primitives = (overrides: Record<string, Script> = {}): Record<string, Script> => ({
    "incident.declare": () => ({ ok: true, value: { id: "theft-1" } }),
    "primitive.approach": () => ({ ok: true, value: { arrived: true } }),
    "primitive.lift": () => ({ ok: true, value: { lifted: true } }),
    "primitive.walk_off": () => ({ ok: true }),
    "primitive.notice": () => ({ ok: true }),
    "incident.close": () => ({ ok: true, value: { closed: true } }),
    ...overrides,
  });

  test("the fixture is a valid plan and describes itself", () => {
    expect(checkPlan(scene)).toEqual([]);
    const tree = describePlan(scene);
    expect(tree.some((line) => line.includes("(blocked)"))).toBe(true);
    expect(tree.some((line) => line.startsWith("finally"))).toBe(true);
    // It survives a JSON round trip unchanged: plain data.
    expect(JSON.parse(JSON.stringify(scene))).toEqual(scene);
  });

  test("performed: completed, every branch named, the incident closed once, both roles released", async () => {
    const clock = new FakeClock();
    const { executor, calls } = fake(primitives(), clock);
    const result = await runPlan(scene, { clock, cast: { thief: "a1", mark: "a2" }, executor: { ...executor, snapshot: board({}) } });
    expect(result.outcome).toBe("completed");
    expect(calls.filter((c) => c.action.do === "incident.close").length).toBe(1);
    expect(calls.filter((c) => c.action.do === "primitive.release").map((c) => c.action.who)).toEqual(["a1", "a2"]);
    const branches = result.reports.filter((r) => r.kind === "step" && r.branch).map((r) => r.branch);
    expect(branches).toEqual(expect.arrayContaining(["declared", "arrived", "lifted", "clear", "noticed", "done", "closed"]));
  });

  test("V follows: the thief speeds up and takes another way", async () => {
    const clock = new FakeClock();
    const { executor, calls } = fake(primitives(), clock);
    await runPlan(scene, { clock, cast: { thief: "a1", mark: "a2" }, executor: { ...executor, snapshot: board({ following: true }) } });
    expect(calls.filter((c) => c.action.do === "primitive.walk_off").map((c) => c.action.pace)).toEqual(["normal", "brisk"]);
  });

  test("blocked twice: abandoned and dissolved (the default, forced), the incident closed, released", async () => {
    const clock = new FakeClock();
    const { executor, calls } = fake(primitives({ "primitive.approach": () => ({ ok: false, code: "blocked_by_v" }) }), clock);
    const result = await runPlan(scene, { clock, cast: { thief: "a1", mark: "a2" }, executor: { ...executor, snapshot: board({}) } });
    expect(result.outcome).toBe("abandoned");
    expect(result.reason).toBe("the thief was blocked twice");
    expect(calls.filter((c) => c.action.do === "primitive.tell").length).toBe(1);
    expect(calls.filter((c) => c.action.do === "primitive.dissolve").length).toBe(2);
    expect(calls.filter((c) => c.action.do === "incident.close").length).toBe(1);
    expect(calls.at(-1)!.action).toMatchObject({ do: "primitive.release", who: "a2" });
  });

  test("the lift never played: the close says so and where it stopped", async () => {
    const clock = new FakeClock();
    const { executor } = fake(primitives({ "primitive.lift": () => ({ ok: true, value: { lifted: false } }) }), clock);
    const result = await runPlan(scene, { clock, cast: { thief: "a1", mark: "a2" }, executor: { ...executor, snapshot: board({}) } });
    expect(result.outcome).toBe("abandoned");
    expect(result.reason).toBe("the lift never played");
    expect(result.reports.at(-1)).toMatchObject({ kind: "close", reason: "the lift never played" });
    expect(result.reports.some((r) => r.kind === "step" && r.label === "lift" && r.branch === "fumbled")).toBe(true);
  });

  test("V too far: the precondition fails and the engine drops a rung (its answer, not the plan's)", async () => {
    const clock = new FakeClock();
    const { executor, calls } = fake(primitives(), clock);
    const result = await runPlan(scene, { clock, cast: { thief: "a1", mark: "a2" }, executor: { ...executor, snapshot: board({ distance_m: 40 }) }, decide: async (request) => (request.reason?.includes("precondition") ? "residue" : undefined) });
    expect(result.decision).toBe("residue");
    expect(result.outcome).toBe("partial");
    expect(calls.some((c) => c.action.do === "primitive.dissolve")).toBe(false);
    expect(calls.some((c) => c.action.do === "primitive.approach")).toBe(false);
  });

  test("the mark streams out: goes to its own end", async () => {
    const clock = new FakeClock();
    const { executor } = fake(primitives({ "primitive.approach": () => ({ ok: false, code: "target_streamed_out" }) }), clock);
    const result = await runPlan(scene, { clock, cast: { thief: "a1", mark: "a2" }, executor: { ...executor, snapshot: board({}) } });
    expect(result.reason).toBe("the mark streamed out");
  });

  test("a save load cancels the scene: abandoned, and release still runs", async () => {
    const clock = new FakeClock();
    const load = new AbortController();
    const { executor, calls } = fake(primitives({ "primitive.lift": (_a, c) => { void clock.sleep(500).then(() => load.abort()); return new Promise((resolve) => c.signal.addEventListener("abort", () => resolve({ ok: false, code: "cancelled" }), { once: true })); } }), clock);
    const result = await runPlan(scene, { clock, signal: load.signal, cast: { thief: "a1", mark: "a2" }, executor: { ...executor, snapshot: board({}) } });
    expect(result.status).toBe("cancelled");
    expect(calls.filter((c) => c.action.do === "primitive.release").length).toBe(2);
  });
});
