// Regression cases for the session runner review. All game and MO2 operations use fakes.
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeApi, fakeHost, go, script, stagedMod } from "./batch-fakes.ts";
import { FakeClock } from "./fake-clock.ts";
import { tempDir } from "./helpers.ts";
import { runPlan } from "../testing/plan.ts";
import { Telemetry } from "../testing/telemetry.ts";
import { createMo2Launcher, JOB_BREAKAWAY_MESSAGE, type Mo2Port } from "../testing/host.ts";
import { preflight } from "../testing/preflight.ts";

const row = (id = "r") => ({ id, title: id, steps: [{ do: "wait", ms: 10 }] });

test("candidate replacement close failure stops the prelude before any row", async () => {
  const clock = new FakeClock(), dir = tempDir("xfb-review-");
  const mod = stagedMod(dir);
  writeFileSync(join(mod, "red4ext", "plugins", "XFRuntimeBridge", "manifest.json"), JSON.stringify({ version: "0.8.22", commit: "a".repeat(40), source_tree_clean: true }));
  const api = fakeApi(clock, { "bridge.info": () => ({ ok: true, result: { sid: "s", plugin_version: "0.8.22", build_commit: "b".repeat(40), build_dirty: false, bridge: { allow_writes: true, write_classes: ["photo", "world", "save"] } } }) });
  const host = fakeHost({ running: true });
  host.requestClose = async () => { host.log.push("close-refused"); return false; };
  const result = await go(script([row()]), api, host, clock, dir, { fixtures: { staged_mod: mod, mo2: { exe: "mo2", profile: "p", executable: "game" } } });
  expect(result.rows[0].prelude?.status).not.toBe("done");
  expect(result.rows[0].verdict).not.toBe("PASS");
  expect(result.rows[0].reports.some((r) => r.kind === "step" && r.label === "wait" && r.status === "ok")).toBe(false);
});

test("teardown retries every action after handed_over refusals and records each", async () => {
  const clock = new FakeClock(), dir = tempDir("xfb-review-");
  const api = fakeApi(clock, { "photo.open": () => ({ ok: false, code: "handed_over" }), "supervisor.clear": () => ({ ok: false, code: "handed_over" }), "test.record.stop": () => ({ ok: false, code: "handed_over" }), "npc.status": () => ({ ok: false, code: "handed_over" }) });
  const host = fakeHost();
  const result = await go(script([{ ...row(), steps: [{ do: "run", command: "photo.open", input: {} }] }], { teardown: [
    { do: "run", command: "supervisor.clear", input: {} }, { do: "host.close" },
  ] }), api, host, clock, dir);
  const names = api.calls.map((c) => c.name);
  expect(names).toContain("test.record.stop");
  expect(names).toContain("npc.status");
  expect(names).toContain("ui.hud");
  expect(result.cleanupErrors.join(" ")).toContain("teardown recorder");
  expect(result.cleanupErrors.join(" ")).toContain("teardown actors");
  expect(host.log).toContain("close");
});

test("a replacement that still reports the wrong candidate cannot run a row", async () => {
  const clock = new FakeClock(), dir = tempDir("xfb-review-");
  const host = fakeHost();
  const api = fakeApi(clock, { "bridge.info": () => ({ ok: true, result: { sid: "s", plugin_version: "0.8.22", build_commit: "b".repeat(40), build_dirty: false } }) });
  const result = await go(script([row()]), api, host, clock, dir, { fixtures: { mo2: { exe: "mo2", profile: "p", executable: "game" } } });
  expect(host.log).toContain("launch");
  expect(result.rows[0].prelude?.status).toBe("failed");
  expect(result.rows[0].reports.some((r) => r.kind === "step" && r.label === "wait" && r.status === "ok")).toBe(false);
});

test("candidate comparison refuses absent build evidence", async () => {
  const clock = new FakeClock();
  const result = await go(script([row()]), fakeApi(clock, { "bridge.info": () => ({ ok: true, result: { sid: "s", build_commit: "a".repeat(40) } }) }), fakeHost(), clock, tempDir("xfb-review-"));
  expect(result.rows[0].prelude?.status).not.toBe("done");
});

test("attempt summary persists unknown readiness for the next attempt", async () => {
  const dir = tempDir("xfb-review-");
  const b318 = JSON.parse(readFileSync(join(import.meta.dir, "..", "sessions", "borg4-smoke.json"), "utf8")).rows.find((r: { id: string }) => r.id === "B318-1");
  const firstClock = new FakeClock();
  await go(script([row("a"), b318]), fakeApi(firstClock, { "test.record.read": () => ({ ok: false, code: "unavailable" }), "test.record.stop": () => ({ ok: false, code: "unavailable" }) }), fakeHost(), firstClock, dir);
  const summary = JSON.parse(readFileSync(join(dir, "out", "telemetry", "a1", "summary.json"), "utf8"));
  expect(summary.taps.unknown.length).toBeGreaterThan(0);
  const secondClock = new FakeClock();
  const good = { not_ready: 0, tap_not_ready: [], complete_coverage: true, channel_stats: { subtitles: { ready: true }, voice: { ready: true } } };
  const second = await go(script([row("a"), b318]), fakeApi(secondClock, { "test.record.read": () => ({ ok: true, result: good }), "test.record.stop": () => ({ ok: true, result: good }) }), fakeHost(), secondClock, dir, { rows: ["a"] });
  expect(second.rows.find((r) => r.id === "B318-1")?.verdict).not.toBe("PASS");
});

test("readiness totals keep reused run numbers from different bridge sessions", async () => {
  const clock = new FakeClock();
  let sid = "s1", notReady = 1;
  const telemetry = new Telemetry({ api: fakeApi(clock, { "bridge.info": () => ({ ok: true, result: { sid } }), "test.record.start": () => ({ ok: true, result: { run: 1 } }),
    "test.record.read": () => ({ ok: true, result: { not_ready: notReady, tap_not_ready: notReady ? ["voice"] : [], channel_stats: { voice: { ready: !notReady, not_ready: notReady }, subtitles: { ready: true } } } }) }), host: fakeHost(), outDir: tempDir("xfb-review-"), attempt: 1, clock });
  await telemetry.ensureRecorder(); await telemetry.collect("one");
  sid = "s2"; notReady = 0;
  await telemetry.ensureRecorder(); await telemetry.collect("two");
  expect(telemetry.summary().not_ready.total).toBe(1);
  expect(Object.keys(telemetry.summary().taps.runs)).toHaveLength(2);
  expect(telemetry.summary().taps.never_ready).toHaveLength(1);
});

test("recorder rollover acknowledges the final catchup cursor before restart", async () => {
  const clock = new FakeClock(); let active = false, acknowledged = false, runs = 0;
  const api = fakeApi(clock, {
    "test.record.start": () => !active && (acknowledged || !runs) ? (active = true, { ok: true, result: { run: ++runs } }) : { ok: false, code: "recording_busy" },
    "test.record.stop": () => (active = false, { ok: true, result: {} }),
    "game.catchup": () => ({ ok: true, result: { cursor: { record: 1 }, counts: {}, gaps: [] } }),
    "test.record.read": (input) => { if (!active && input.since === 1) acknowledged = true; return { ok: true, result: {} }; },
  });
  const telemetry = new Telemetry({ api, host: fakeHost(), outDir: tempDir("xfb-review-"), attempt: 1, clock });
  expect((await telemetry.ensureRecorder()).run).toBe(1);
  telemetry.invalidate();
  expect((await telemetry.ensureRecorder()).run).toBe(2);
  expect(acknowledged).toBe(true);
});

test("failed final acknowledgement keeps the old recorder until retry succeeds", async () => {
  const clock = new FakeClock(); let starts = 0, refuseAck = true;
  const api = fakeApi(clock, {
    "test.record.start": () => ({ ok: true, result: { run: ++starts } }),
    "game.catchup": () => ({ ok: true, result: { cursor: { record: 7 }, counts: {}, gaps: [] } }),
    "test.record.read": (input) => input.since === 7 && refuseAck ? { ok: false, code: "unavailable" } : { ok: true, result: {} },
  });
  const telemetry = new Telemetry({ api, host: fakeHost(), outDir: tempDir("xfb-review-"), attempt: 1, clock });
  await telemetry.ensureRecorder(); telemetry.invalidate();
  expect((await telemetry.ensureRecorder()).unavailable).toContain("unavailable");
  expect(starts).toBe(1);
  refuseAck = false;
  expect((await telemetry.ensureRecorder()).run).toBe(2);
});

test("block deadline bounds guard, branch and fallback", async () => {
  for (const block of [
    { sequence: [{ do: "x" }], when: { check: { do: "no" }, match: { ok: true }, wait_ms: 10000, otherwise: "fallback" }, fallback: [{ do: "slow" }] },
    { sequence: [{ do: "no" }], outcomes: [{ match: { ok: false }, run: [{ do: "slow" }] }] },
    { sequence: [{ do: "no" }], fallback: [{ do: "slow" }] },
  ]) {
    const clock = new FakeClock();
    await runPlan({ id: "p", steps: [{ deadline_ms: 1000, ...block }] } as never, { clock, executor: { run: async (a, context) => { if (a.do === "slow") await clock.sleep(5000, context.signal); return { ok: a.do !== "no" && !context.signal.aborted }; } } });
    expect(clock.now()).toBeLessThanOrEqual(1000);
  }
});

test("nested continued release failure remains release_failed", async () => {
  const result = await runPlan({ id: "p", steps: [], finally: [{ label: "nested", sequence: [{ label: "bad", do: "bad", on_fail: "continue" }, { do: "good" }] }] } as never,
    { clock: new FakeClock(), executor: { run: async (a) => ({ ok: a.do !== "bad", code: a.do === "bad" ? "refused" : undefined }) } });
  expect(result.release_failed?.join(" ")).toContain("bad");
});

test("nested teardown refusal is listed in cleanupErrors", async () => {
  const clock = new FakeClock();
  const result = await go(script([row()], { teardown: [{ label: "nested", sequence: [{ label: "bad", do: "run", command: "photo.open", input: {}, on_fail: "continue" }, { do: "note", text: "done" }] }] } as never),
    fakeApi(clock, { "photo.open": () => ({ ok: false, code: "refused" }) }), fakeHost(), clock, tempDir("xfb-review-"));
  expect(result.cleanupErrors.join(" ")).toContain("bad");
});

test("row cleanup failure downgrades a passing row to PARTIAL", async () => {
  for (const judged_by of [undefined, "reviewer"]) {
    const clock = new FakeClock();
    const result = await go(script([{ ...row(), judged_by, steps: [{ do: "set", value: true, bind: "proof" }], pass: [{ label: "proof", ref: "$proof", match: { equals: true } }], cleanup: [{ do: "run", command: "photo.open", input: {} }] }]), fakeApi(clock, { "photo.open": () => ({ ok: false, code: "refused" }) }), fakeHost(), clock, tempDir("xfb-review-"));
    expect(result.rows[0].verdict).toBe("PARTIAL");
  }
});

test("game appearing while MO2 opens prevents forwarding", async () => {
  let running = false; let forwards = 0; let polls = 0; let time = 0;
  const port: Mo2Port = { shell: async () => ({ code: 0, out: ++polls > 1 ? "ready" : "starting" }), forward: async () => { forwards++; return null; },
    gameProcess: async () => running ? { pid: 42 } : null, breakawayBlocked: async () => false,
    dialog: () => null, cursor: () => null, appended: () => "", now: () => time, sleep: async (ms) => { time += ms; running = true; } };
  expect((await createMo2Launcher(port).launch({ exe: "mo2", profile: "p", executable: "game" })).error).toContain("already_running");
  expect(forwards).toBe(0);
});

test("restricted Windows job blocks MO2 launch and preflight", async () => {
  let forwards = 0, shells = 0;
  const port: Mo2Port = { shell: async () => { shells++; return { code: 0, out: "ready" }; }, forward: async () => { forwards++; return null; },
    gameProcess: async () => null, breakawayBlocked: async () => true,
    dialog: () => null, cursor: () => null, appended: () => "", now: () => 0, sleep: async () => {} };
  expect((await createMo2Launcher(port).launch({ exe: "mo2", profile: "p", executable: "game" })).error).toBe(JOB_BREAKAWAY_MESSAGE);
  expect((await createMo2Launcher(port).launch({ exe: "mo2", profile: "p", executable: "game", replace: true })).error).toBe(JOB_BREAKAWAY_MESSAGE);
  expect(forwards).toBe(0);
  expect(shells).toBe(0);
  const result = await preflight({ script: script([row()]), fixtures: {}, projectDir: join(import.meta.dir, "..", ".."), runtimeDir: tempDir("xfb-review-"),
    freeCommitBytes: async () => 40 * 1024 ** 3, gameRunning: async () => false, breakawayBlocked: async () => true, git: () => null });
  expect(result.items.some((i) => i.status === "blocker" && i.detail === JOB_BREAKAWAY_MESSAGE)).toBe(true);
});
