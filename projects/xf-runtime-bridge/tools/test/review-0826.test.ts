// The runner's review fixes (Sol's review of the plan module and the schema-3 runner, 26 October): each test
// reproduces the failure the review found, and passes only with its fix.

import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runPlan, type Plan } from "../testing/plan.ts";
import { SessionExecutor } from "../testing/batch.ts";
import { windowsHost } from "../testing/host.ts";
import { stagedConfigPath } from "../testing/config-ini.ts";
import { fakeApi, fakeHost, go, script, STAGED_INI, stagedMod } from "./batch-fakes.ts";
import { FakeClock } from "./fake-clock.ts";
import { tempDir } from "./helpers.ts";

describe("H2 and M12: the tripwire can't block the restore, and the restore's outcome is recorded", () => {
  test("a low commit reading during the teardown still lets config.ini go back", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-review-");
    const mod = stagedMod(dir);
    const host = fakeHost({ running: false, freeGb: 40 });
    // Memory falls just as the teardown starts.
    const api = fakeApi(clock, { "supervisor.clear": () => { host.free = 1024 ** 3; return { ok: true, result: {} }; } });
    const rows = [{ id: "r", title: "r", requires: [{ config: "overlay.enabled", equals: "true" }], steps: [{ do: "set", value: 1 }] }];
    const result = await go(script(rows), api, host, clock, dir, { commitEveryMs: 1, fixtures: { staged_mod: mod, mo2: { exe: "m", profile: "p", executable: "g" } } });
    expect(readFileSync(stagedConfigPath(mod), "utf8")).toBe(STAGED_INI);
    expect(result.cleanupErrors).toEqual([]);
    expect(readFileSync(result.reportPath, "utf8")).toContain("config.ini was restored to its state before the run");
  });

  test("a restore that is refused (the file changed since the runner's write) makes the batch not ok and the report says so", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-review-");
    const mod = stagedMod(dir);
    const api = fakeApi(clock, { "ui.state": () => { writeFileSync(stagedConfigPath(mod), readFileSync(stagedConfigPath(mod), "utf8") + "; edited by hand\r\n"); return { ok: true, result: {} }; } });
    const rows = [{ id: "r", title: "r", requires: [{ config: "overlay.enabled", equals: "true" }], steps: [{ do: "run", command: "ui.state", input: {} }] }];
    const result = await go(script(rows), api, fakeHost({ running: false }), clock, dir, { fixtures: { staged_mod: mod, mo2: { exe: "m", profile: "p", executable: "g" } } });
    expect(result.rows[0].verdict).toBe("PASS");
    expect(result.ok).toBe(false);
    expect(result.cleanupErrors.some((e) => e.includes("config.ini wasn't restored"))).toBe(true);
    expect(readFileSync(result.reportPath, "utf8")).toContain("config.ini was NOT restored");
    expect(JSON.parse(readFileSync(result.manifestPath, "utf8")).run.config_restore.restored).toBe(false);
  });
});

describe("M10: the commit monitor interrupts a long action", () => {
  test("free commit falling during a minute-long step stops it within a reading, not at its end", async () => {
    const clock = new FakeClock();
    const host = fakeHost({ freeGb: 40 });
    void clock.sleep(5000).then(() => { host.free = 1024 ** 3; });
    const api = fakeApi(clock);
    const rows = [{ id: "long", title: "long", steps: [{ do: "wait", ms: 60_000, deadline_ms: 70_000 }] }, { id: "next", title: "next", steps: [{ do: "set", value: 1 }] }];
    const result = await go(script(rows), api, host, clock, tempDir("xfb-review-"), { commitEveryMs: 1000 });
    expect(result.haltInfo?.kind).toBe("tripwire");
    expect(clock.now()).toBeLessThan(20_000);
    expect(api.calls.filter((c) => c.name === "session.handover").length).toBe(1);
    expect(result.remaining).toEqual(["long", "next"]);
  });
});

describe("H3: no host side effect after a cancel", () => {
  for (const what of ["launch", "close"] as const) {
    test(`a ${what} whose step was cancelled while the game's process was being read never happens`, async () => {
      const clock = new FakeClock();
      const stop = new AbortController();
      const base = fakeHost({ running: what !== "launch" });
      // The process read takes 5 s; the step is cancelled at 1 s.
      const host = { ...base, gameProcess: async () => { await clock.sleep(5000); return what === "launch" ? null : { pid: 4242 }; } };
      const executor = new SessionExecutor({ api: fakeApi(clock) as never, host, outDir: tempDir("xfb-review-"), fixtures: { mo2: { exe: "m", profile: "p", executable: "g" } }, clock, log: () => {}, echo: false }, script([]));
      void clock.sleep(1000).then(() => stop.abort());
      const result = await runPlan({ id: "p", steps: [{ do: `host.${what}` }] }, { executor, clock, signal: stop.signal });
      await clock.sleep(10_000);
      expect(result.status).toBe("cancelled");
      expect(base.log.filter((l) => l.startsWith(what))).toEqual([]);
    });
  }

  test("the real key sender checks the signal before anything else", async () => {
    const stop = new AbortController();
    stop.abort();
    const sent = await windowsHost.pressKeys([0x75], "F6", stop.signal);
    expect(sent.sent).toBe(false);
    expect(sent.refused).toContain("cancelled");
  });
});

describe("M4: the release has its own step budget", () => {
  test("a goto loop that exhausts max_steps still releases", async () => {
    const clock = new FakeClock();
    const done: string[] = [];
    const plan: Plan = { id: "p", max_steps: 10, steps: [{ label: "top", do: "spin", outcomes: [{ match: { ok: true }, goto: "top" }] }], finally: [{ do: "release" }, { do: "release2" }] };
    const result = await runPlan(plan, { clock, executor: { run: async (a) => { done.push(a.do); return { ok: true }; } } });
    expect(result.reason).toContain("More than 10 steps");
    expect(done.slice(-2)).toEqual(["release", "release2"]);
  });
});

describe("M5: a hanging blackboard read can't defeat deadlines or a cancel", () => {
  test("the plan's deadline still ends a plan whose snapshot never answers", async () => {
    const clock = new FakeClock();
    const result = await runPlan({ id: "p", deadline_ms: 5000, steps: [{ do: "a" }, { do: "b" }] }, {
      clock, executor: { run: async () => ({ ok: true }), snapshot: () => new Promise(() => {}) },
    });
    expect(result.status).toBe("failed");
    expect(clock.now()).toBeLessThanOrEqual(5000);
  });

  test("a cancel ends it too", async () => {
    const clock = new FakeClock();
    const stop = new AbortController();
    void clock.sleep(1000).then(() => stop.abort());
    const result = await runPlan({ id: "p", steps: [{ do: "a" }] }, { clock, signal: stop.signal, executor: { run: async () => ({ ok: true }), snapshot: () => new Promise(() => {}) } });
    expect(result.status).toBe("cancelled");
    expect(clock.now()).toBe(1000);
  });
});

describe("M6: deadlines bound blocks, polling, guards and backoff", () => {
  const never = { run: async () => ({ ok: false, code: "no" }) };
  test("a block's deadline_ms ends the polling inside it", async () => {
    const clock = new FakeClock();
    const result = await runPlan({ id: "p", steps: [{ deadline_ms: 3000, sequence: [{ do: "ping", until: { ok: true }, interval_ms: 1000, deadline_ms: 60_000 }] }] }, { clock, executor: never });
    expect(result.status).toBe("failed");
    expect(clock.now()).toBeLessThanOrEqual(3000);
  });

  test("a guard's wait inside a block stops at the block's deadline", async () => {
    const clock = new FakeClock();
    const result = await runPlan({ id: "p", steps: [{ deadline_ms: 2000, sequence: [{ do: "x", when: { check: { do: "state" }, match: { ok: true }, wait_ms: 60_000, interval_ms: 500 } }] }] }, { clock, executor: never });
    expect(clock.now()).toBeLessThanOrEqual(2000);
    expect(result.status).toBe("done");
  });

  test("a retry's backoff never sleeps past the plan's deadline", async () => {
    const clock = new FakeClock();
    await runPlan({ id: "p", deadline_ms: 5000, steps: [{ do: "x", retry: { times: 3, backoff_ms: 10_000 } }] }, { clock, executor: never });
    expect(clock.now()).toBeLessThanOrEqual(5000);
  });
});

describe("H1: exceptions never bypass the cleanup", () => {
  test("a report callback that throws doesn't skip the release or the close", async () => {
    const clock = new FakeClock();
    const released: string[] = [];
    const plan: Plan = { id: "p", steps: [{ do: "a" }, { do: "b" }], finally: [{ do: "release" }] };
    const result = await runPlan(plan, {
      clock,
      executor: { run: async (action) => { released.push(action.do); return { ok: true }; } },
      report: () => { throw new Error("the consumer's stream broke"); },
    });
    expect(released).toEqual(["a", "b", "release"]);
    expect(result.reports.at(-1)!.kind).toBe("close");
    expect(result.report_errors!.length).toBeGreaterThan(0);
  });

  test("an executor that throws outside its own guard still ends in one close, after the release", async () => {
    const clock = new FakeClock();
    const done: string[] = [];
    const result = await runPlan({ id: "p", steps: [{ do: "a" }], finally: [{ do: "release" }] }, {
      clock,
      executor: { run: async (action) => { done.push(action.do); return { ok: true }; }, snapshot: async () => { throw new Error("blackboard broke"); } },
    });
    expect(done).toEqual(["a", "release"]);
    expect(result.reports.filter((r) => r.kind === "close").length).toBe(1);
  });

  test("a report that can't be written still lets the teardown restore config.ini and close the connection", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-review-");
    const mod = stagedMod(dir);
    // The manifest's path is taken by a folder, so every report write throws.
    mkdirSync(join(dir, "out", "manifest.json"), { recursive: true });
    const api = fakeApi(clock);
    const rows = [{ id: "r", title: "r", requires: [{ config: "overlay.enabled", equals: "true" }], steps: [{ do: "set", value: 1 }] }];
    const result = await go(script(rows), api, fakeHost({ running: false }), clock, dir, { fixtures: { staged_mod: mod, mo2: { exe: "m", profile: "p", executable: "g" } } });
    expect(readFileSync(stagedConfigPath(mod), "utf8")).toBe(STAGED_INI);
    expect(api.closed).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.cleanupErrors.some((e) => e.includes("report"))).toBe(true);
  });
});
