// The runner's review fixes (Sol's review of the plan module and the schema-3 runner, 26 October): each test
// reproduces the failure the review found, and passes only with its fix.

import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runPlan, type Plan } from "../testing/plan.ts";
import { SessionExecutor, type Row } from "../testing/batch.ts";
import { windowsHost } from "../testing/host.ts";
import { stagedConfigPath, stagedDllPath, stagedManifestPath } from "../testing/config-ini.ts";
import { formatPreflight, preflight } from "../testing/preflight.ts";
import { createHash } from "node:crypto";
import { fakeApi, fakeHost, go, script, STAGED_INI, stagedMod } from "./batch-fakes.ts";
import { FakeClock } from "./fake-clock.ts";
import { projectDir, tempDir } from "./helpers.ts";

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

describe("M7: a joint beat passes its children's control results up, and takes the same ladder", () => {
  const ok = { run: async (a: { do: string }) => (a.do === "bad" ? { ok: false, code: "no" } : { ok: true }) };
  test("a child's stop stops the plan, even under the parent's on_fail continue", async () => {
    const clock = new FakeClock();
    const result = await runPlan({ id: "p", steps: [{ on_fail: "continue", together: [{ do: "a", outcomes: [{ match: { ok: true }, result: "stop" }] }, { do: "b" }] }, { do: "after" }] }, { clock, executor: ok });
    expect(result.status).toBe("stopped");
  });

  test("a child's goto is followed", async () => {
    const clock = new FakeClock();
    const done: string[] = [];
    const result = await runPlan({ id: "p", steps: [{ together: [{ do: "a", outcomes: [{ match: { ok: true }, goto: "there" }] }, { do: "b" }] }, { do: "skipped" }, { label: "there", do: "landed" }] },
      { clock, executor: { run: async (a) => { done.push(a.do); return { ok: true }; } } });
    expect(result.status).toBe("done");
    expect(done).not.toContain("skipped");
    expect(done).toContain("landed");
  });

  test("a failed joint beat takes its alternatives", async () => {
    const clock = new FakeClock();
    const done: string[] = [];
    const result = await runPlan({ id: "p", steps: [{ together: [{ do: "bad" }, { do: "b" }], alternatives: [[{ do: "other" }]] }] },
      { clock, executor: { run: async (a) => { done.push(a.do); return ok.run(a); } } });
    expect(result.status).toBe("done");
    expect(done).toContain("other");
  });
});

describe("M8: a launch that can't start says so", () => {
  test("a missing MO2 executable is a failed launch, not a success", async () => {
    const result = await windowsHost.launch({ exe: join(tempDir("xfb-review-"), "no-such-ModOrganizer.exe"), profile: "p", executable: "g" });
    expect(result.started).toBe(false);
    expect(result.error).toContain("ENOENT");
  });
});

describe("M9: handed_over is seen on every API path", () => {
  test("a schema-2 observe step refused handed_over halts the batch as handed_over, not runner_error", async () => {
    const clock = new FakeClock();
    const api = fakeApi(clock, { "npc.move": () => ({ ok: false, code: "handed_over", message: "handed over" }) });
    const rows = [
      { id: "walk", title: "walk", steps: [{ do: "set", value: { who: "a1" }, bind: "actor" }, { do: "observe", command: "npc.move", subject: "$actor.who", input: { who: "$actor.who", to: "v" }, timeout_s: 5, bind: "walk" }] },
      { id: "next", title: "next", steps: [{ do: "set", value: 1 }] },
    ];
    const host = fakeHost({ running: true });
    const result = await go(script(rows), api, host, clock, tempDir("xfb-review-"));
    expect(result.haltInfo?.kind).toBe("handed_over");
    expect(host.log).not.toContain("close");
    expect(result.rows[1].reason).toContain("not reached");
  });
});

describe("M11: the preflight certifies only a binary its manifest describes, with the test gates", () => {
  const staged = (dir: string, manifest: Record<string, unknown>, ini = STAGED_INI) => {
    const mod = stagedMod(dir);
    writeFileSync(stagedConfigPath(mod), ini);
    const dll = "\0\0overlay.state\0";
    writeFileSync(stagedDllPath(mod), dll);
    const sha256 = createHash("sha256").update(Buffer.from(dll, "latin1")).digest("hex");
    writeFileSync(stagedManifestPath(mod), JSON.stringify({ version: "0.8.22", variant: "writes", commit: "abc", source_tree_clean: true, allow_test_hooks: true, autonomous_test_hooks: true,
      files: [{ path: "red4ext/plugins/XFRuntimeBridge/XFRuntimeBridge.dll", sha256 }], ...manifest }));
    return { staged_mod: mod };
  };
  const check = (fixtures: Record<string, unknown>, rows: Row[] = [{ id: "r", title: "r", steps: [{ do: "run", command: "ui.hud", input: { show: false } }] }]) =>
    preflight({ script: script(rows), fixtures, projectDir, runtimeDir: tempDir("xfb-rt-"), freeCommitBytes: async () => 40 * 1024 ** 3, gameRunning: async () => false,
      // The staged commit's source "registers" everything: only a tied manifest may use that.
      git: (args) => (args[0] === "grep" || args[0] === "cat-file" ? "" : null) });

  test("a DLL replaced after packaging is a blocker, and the commit's source no longer vouches for its methods", async () => {
    const result = await check(staged(tempDir("xfb-review-"), { files: [{ path: "red4ext/plugins/XFRuntimeBridge/XFRuntimeBridge.dll", sha256: "0".repeat(64) }] }));
    const text = formatPreflight(result, "t");
    expect(text).toContain("isn't the one its manifest lists");
    expect(text).toContain("doesn't answer ui.hud");
    expect(result.ready).toBe(false);
  });

  test("a build from a dirty tree can't lean on its commit either", async () => {
    const result = await check(staged(tempDir("xfb-review-"), { source_tree_clean: false }));
    expect(formatPreflight(result, "t")).toContain("dirty tree");
    expect(result.ready).toBe(false);
  });

  test("a script that needs the test hooks is refused on a build or config without them", async () => {
    const rows = [{ id: "r", title: "r", steps: [{ do: "run", command: "test.record.start", input: {} }] }];
    const noBuild = await check(staged(tempDir("xfb-review-"), { autonomous_test_hooks: false }), rows);
    expect(formatPreflight(noBuild, "t")).toContain("isn't the autonomous -writes package");
    expect(noBuild.ready).toBe(false);
    const noConfig = await check(staged(tempDir("xfb-review-"), {}), rows);
    expect(formatPreflight(noConfig, "t")).toContain("allow_test_hooks isn't true");
    const ready = await check(staged(tempDir("xfb-review-"), {}, STAGED_INI.replace("allow_writes = true", "allow_writes = true\r\nallow_test_hooks = true")), rows);
    expect(ready.items.filter((i) => i.check === "test hooks")[0].status).toBe("ok");
  });
});

describe("M13: a settle burst survives the handover it records", () => {
  test("a burst that keeps the overlay runs on the observer, so session.handover's supersede can't cancel it", async () => {
    const clock = new FakeClock();
    let epoch = new AbortController();
    // The writer's API as CommandApi behaves: session.handover supersedes (aborts) whatever the writer has in flight.
    const writer = fakeApi(clock, {
      "session.handover": () => { epoch.abort(); epoch = new AbortController(); return { ok: true, result: { handed_over: true } }; },
      "capture.burst": async () => {
        const mine = epoch.signal;
        await clock.sleep(2000, mine);
        return mine.aborted ? { ok: false, code: "interrupted", message: "superseded by session.handover" } : { ok: true, result: { contact_sheet: { path: "x" } } };
      },
    });
    const observer = fakeApi(clock);
    const rows: Row[] = [{ id: "ST5", title: "settle", steps: [
      { label: "change", together: [
        { do: "burst", name: "ST5-xfbox-settle-dark", frames: 20, interval_ms: 100, clear_overlay: false, bind: "burst" },
        { sequence: [{ do: "wait", ms: 300 }, { do: "run", command: "session.handover", input: {} }, { do: "wait", ms: 700 }, { do: "run", command: "session.resume", input: {} }] },
      ] },
    ], pass: [{ label: "the burst", ref: "$burst", captured: true }] }];
    const result = await go(script(rows), writer, fakeHost(), clock, tempDir("xfb-review-"), { observer });
    expect(result.rows[0].verdict).toBe("PASS");
    expect(observer.calls.some((c) => c.name === "capture.burst")).toBe(true);
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

describe("M14: B318-3 needs the call answered and ended, for its own call", () => {
  const smoke = () => JSON.parse(readFileSync(join(projectDir, "tools", "sessions", "borg4-smoke.json"), "utf8"));
  const run = async (phases: string[]) => {
    const clock = new FakeClock();
    const api = fakeApi(clock, {});
    const call = 7;
    const handlers: Record<string, () => { ok: true; result: unknown }> = {
      "phone.call": () => { for (const what of phases) api.push("dm.phone", { what, call, contact: "coach" }); api.push("dm.phone", { what: "ringing", call: 99, contact: "other" }); return { ok: true, result: { call, state: "ringing" } }; },
    };
    const wrapped = { ...api, run: (name: string, input: Record<string, unknown> = {}, opts = {}) => (handlers[name] ? Promise.resolve({ ok: true, command: name, cid: "c", result: handlers[name]().result }) : api.run(name, input as never, opts)) };
    const dir = tempDir("xfb-review-");
    const result = await go(smoke(), wrapped as never, fakeHost(), clock, dir, { rows: ["B318-3"], fixtures: { staged_mod: stagedMod(dir) } });
    const row = result.rows.find((r) => r.id === "B318-3")!;
    // The row ran: its verdict comes from the checks, not a skipped set-up.
    expect(row.close?.status).toBe("done");
    return row;
  };
  test("ringing alone is not a pass", async () => {
    expect((await run(["ringing"])).verdict).toBe("FAIL");
  });
  test("answered by the bridge and ended by itself, for this call, passes", async () => {
    expect((await run(["ringing", "auto_answer", "answered", "ended"])).verdict).toBe("PASS");
  });
});
