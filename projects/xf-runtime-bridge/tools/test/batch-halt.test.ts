// Schema-3 batches, the follow-up: telemetry always on, the fast exit on a significant bug (crash, a lost bridge, a
// failed draw call in the plugin log, a runner error, the same failure across N rows), resume.json and a second
// attempt into the same folder, and the loop's signal. Fake API, fake host, the deterministic clock.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseHaltOn, planBatch, type Row } from "../testing/batch.ts";
import { nextAttemptArgs, readResume, waitForSignal } from "../testing/loop.ts";
import { fakeApi, fakeHost, go, script, stagedMod } from "./batch-fakes.ts";
import { FakeClock } from "./fake-clock.ts";
import { tempDir } from "./helpers.ts";

const withLog = (dir: string) => {
  const game = join(dir, "game");
  mkdirSync(join(game, "red4ext", "logs"), { recursive: true });
  const file = join(game, "red4ext", "logs", "xfruntimebridge-2026-10-26-10-00-00.log");
  writeFileSync(file, "[10:00:00] boot\n");
  return { game, file, append: (line: string) => writeFileSync(file, readFileSync(file, "utf8") + line + "\n") };
};
const three: Row[] = [
  { id: "a", title: "a", steps: [{ do: "run", command: "ui.state", input: {} }] },
  { id: "b", title: "b", steps: [{ do: "run", command: "ui.state", input: {} }] },
  { id: "c", title: "c", steps: [{ do: "run", command: "ui.state", input: {} }] },
];

describe("batch: telemetry, always on", () => {
  test("the recorder runs on every channel from the first row, again after a restart, and each row gets its slice", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const mod = stagedMod(dir);
    const log = withLog(dir);
    const api = fakeApi(clock, { "overlay.state": () => { log.append("[10:00:05] evt=row.work"); return { ok: true, result: { frames: 100, cpu_ms: 0.4 } }; } });
    const host = fakeHost({ running: true, onLaunch: () => { api.sid = "sid-2"; } });
    const rows: Row[] = [
      { id: "one", title: "one", steps: [{ do: "run", command: "ui.state", input: {} }] },
      { id: "two", title: "after a restart", requires: [{ config: "overlay.enabled", equals: "true" }], steps: [{ do: "run", command: "ui.state", input: {} }] },
    ];
    const result = await go(script(rows), api, host, clock, dir, { fixtures: { staged_mod: mod, game_dir: log.game, mo2: { exe: "mo2.exe", profile: "p", executable: "g" } } });
    const starts = api.calls.filter((c) => c.name === "test.record.start");
    expect(starts.length).toBe(2);
    expect(starts[0].input.channels.length).toBe(10);
    for (const row of result.rows) {
      const t = row.telemetry!;
      expect(t.dir).toContain(join("telemetry", "a1", row.id));
      for (const file of ["catchup.json", "overlay-state.json", "bridge-info.json", "memory.json", "plugin-log.txt"]) expect(existsSync(join(dir, "out", t.dir, file)), `${row.id} ${file}`).toBe(true);
      expect(t.memory).toMatchObject({ free_commit_gb: 40, game_handles: 12_000, system_handles: 500_000 });
      expect(t.frames).toMatchObject({ frames: 100 });
    }
    const slice = readFileSync(join(dir, "out", result.rows[0].telemetry!.dir, "plugin-log.txt"), "utf8");
    expect(slice).toContain("evt=row.work");
    expect(slice).not.toContain("boot");
    expect(api.calls.filter((c) => c.name === "game.catchup").some((c) => c.input.cursor !== undefined)).toBe(true);
    expect(existsSync(join(dir, "out", "telemetry", "a1", "final-catchup.json"))).toBe(true);
    expect(readFileSync(result.reportPath, "utf8")).toContain("telemetry/a1/one");
  });

  test("a recorder the build refuses leaves telemetry partial, never a failed row", async () => {
    const clock = new FakeClock();
    const api = fakeApi(clock, { "test.record.start": () => ({ ok: false, code: "test_hooks_off" }) });
    const result = await go(script(three.slice(0, 1)), api, fakeHost(), clock, tempDir("xfb-batch-"));
    expect(result.rows[0].verdict).toBe("PASS");
    expect(result.rows[0].telemetry!.recorder.unavailable).toContain("test_hooks_off");
  });
});

describe("batch: fast exit on a significant bug", () => {
  test("a draw call that failed in the plugin log halts: teardown, the game closed, resume.json with the rows left and the command", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const log = withLog(dir);
    const api = fakeApi(clock, { "ui.state": (_i, n) => { if (n === 2) log.append("[10:01] CET: the BeginChild draw call failed, so that part draws plain"); return { ok: true, result: {} }; } });
    const host = fakeHost({ running: true });
    const result = await go(script(three), api, host, clock, dir, { fixtures: { game_dir: log.game }, resumeCommand: (left: string[]) => `continue --rows ${left.join(",")}` });
    expect(result.haltInfo).toMatchObject({ kind: "draw_call", row: "b" });
    expect(result.rows.map((r) => r.verdict)).toEqual(["PASS", "PASS", "SKIP"]);
    expect(host.log).toContain("close");
    expect(api.calls.some((c) => c.name === "supervisor.clear")).toBe(true);
    const resume = JSON.parse(readFileSync(result.resumePath, "utf8"));
    expect(resume.rows_remaining).toEqual(["b", "c"]);
    expect(resume.halt.evidence.some((e: string) => e.includes("BeginChild"))).toBe(true);
    expect(resume.command).toBe("continue --rows b,c");
    expect(readFileSync(result.reportPath, "utf8")).toContain("**Halted (draw_call):**");
  });

  test("the same failure across N rows halts (repeated:2), and those rows run again", async () => {
    const clock = new FakeClock();
    const api = fakeApi(clock, { "ui.state": () => ({ ok: false, code: "overlay_off" }) });
    const result = await go(script(three), api, fakeHost(), clock, tempDir("xfb-batch-"), { haltOn: parseHaltOn("repeated:2") });
    expect(result.haltInfo).toMatchObject({ kind: "repeated", rerun: ["a", "b"] });
    expect(result.remaining).toEqual(["a", "b", "c"]);
  });

  test("a crash halts: the game is gone after a row that didn't close it", async () => {
    const clock = new FakeClock();
    const host = fakeHost({ running: true });
    const result = await go(script(three), fakeApi(clock, { "ui.state": () => { host.crash(); return { ok: true, result: {} }; } }), host, clock, tempDir("xfb-batch-"));
    expect(result.haltInfo).toMatchObject({ kind: "crash", row: "a" });
  });

  test("a lost bridge halts, except after a row that stops it on purpose (after: restart)", async () => {
    const clock = new FakeClock();
    let alive = true;
    const api = fakeApi(clock, { "bridge.ping": () => (alive ? { ok: true, result: {} } : { ok: false, code: "no_bridge" }), "ui.state": () => { alive = false; return { ok: true, result: {} }; } });
    const lost = await go(script(three), api, fakeHost({ running: true }), clock, tempDir("xfb-batch-"), { haltOn: parseHaltOn("bridge_lost") });
    expect(lost.haltInfo).toMatchObject({ kind: "bridge_lost", row: "a" });
    alive = true;
    const kill: Row[] = [{ id: "kill", title: "kills on purpose", after: "restart", steps: [{ do: "run", command: "ui.state", input: {} }] }];
    // The bridge answers for the prelude, then the row switches it off on purpose.
    let up = true;
    const fine = await go(script(kill), fakeApi(clock, { "bridge.ping": () => (up ? { ok: true, result: {} } : { ok: false, code: "no_bridge" }), "ui.state": () => { up = false; return { ok: true, result: {} }; } }), fakeHost({ running: true }), clock, tempDir("xfb-batch-"), { haltOn: parseHaltOn("bridge_lost") });
    expect(fine.haltInfo).toBeUndefined();
  });

  test("an exception in the runner halts as runner_error; a row's halt_on [] lets it pass by", async () => {
    const clock = new FakeClock();
    const result = await go(script(three), fakeApi(clock, { "ui.state": () => { throw new Error("boom in a handler"); } }), fakeHost(), clock, tempDir("xfb-batch-"));
    expect(result.haltInfo).toMatchObject({ kind: "runner_error", row: "a" });
    const quiet = await go(script(three.map((r) => ({ ...r, halt_on: [] }))), fakeApi(clock, { "ui.state": () => { throw new Error("boom"); } }), fakeHost(), clock, tempDir("xfb-batch-"));
    expect(quiet.haltInfo).toBeUndefined();
  });

  test("handed_over halts but leaves the game running (the player has it)", async () => {
    const clock = new FakeClock();
    const host = fakeHost({ running: true });
    const result = await go(script(three), fakeApi(clock, { "ui.state": () => ({ ok: false, code: "handed_over" }) }), host, clock, tempDir("xfb-batch-"));
    expect(result.haltInfo?.kind).toBe("handed_over");
    expect(host.log).not.toContain("close");
  });

  test("a second attempt into the same folder continues the rows left, and the report spans both attempts", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const log = withLog(dir);
    let broken = true;
    const handlers = { "ui.state": (_i: unknown, n: number) => { if (broken && n === 2) log.append("CET: the BeginChild draw call failed"); return { ok: true as const, result: {} }; } };
    const first = await go(script(three), fakeApi(clock, handlers), fakeHost({ running: true }), clock, dir, { fixtures: { game_dir: log.game } });
    expect(first.remaining).toEqual(["b", "c"]);
    broken = false;
    const second = await go(script(three), fakeApi(clock, handlers), fakeHost({ running: false }), clock, dir, { fixtures: { game_dir: log.game, mo2: { exe: "m", profile: "p", executable: "g" } }, rows: first.remaining });
    expect(second.attempt).toBe(2);
    expect(second.haltInfo).toBeUndefined();
    const manifest = JSON.parse(readFileSync(second.manifestPath, "utf8"));
    expect(manifest.attempts.map((a: { outcome: string }) => a.outcome)).toEqual(["halted", "complete"]);
    expect(manifest.rows.map((r: { id: string; verdict: string; attempt: number }) => [r.id, r.verdict, r.attempt])).toEqual([["a", "PASS", 1], ["b", "PASS", 2], ["c", "PASS", 2]]);
    expect(manifest.rows[1].earlier.map((e: { verdict: string }) => e.verdict)).toEqual(["PASS"]);
    expect(existsSync(join(dir, "out", "telemetry", "a2", "b"))).toBe(true);
    expect(readFileSync(second.reportPath, "utf8")).toContain("Attempt 1");
    expect(JSON.parse(readFileSync(second.resumePath, "utf8")).rows_remaining).toEqual([]);
  });

  test("parseHaltOn", () => {
    expect([...parseHaltOn(undefined).kinds].sort()).toEqual(["bridge_lost", "crash", "draw_call", "repeated", "runner_error"]);
    expect(parseHaltOn("none").kinds.size).toBe(0);
    expect(parseHaltOn("crash,repeated:4")).toEqual({ kinds: new Set(["crash", "repeated"]), repeated: 4 });
    expect(() => parseHaltOn("explode")).toThrow();
  });
});

describe("the loop's signal and next attempt", () => {
  test("waitForSignal takes go (or stop) from a file in the session folder, removing it, or a typed word", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-loop-");
    void clock.sleep(7000).then(() => writeFileSync(join(dir, "go"), ""));
    expect(await waitForSignal(dir, clock, { pollMs: 2000 })).toBe("go");
    expect(existsSync(join(dir, "go"))).toBe(false);
    writeFileSync(join(dir, "stop"), "");
    expect(await waitForSignal(dir, clock)).toBe("stop");
    async function* typed() { yield "  GO "; }
    expect(await waitForSignal(dir, clock, { lines: typed(), pollMs: 100 })).toBe("go");
  });

  test("nextAttemptArgs keeps the script and options and continues into the same folder", () => {
    expect(nextAttemptArgs(["s.json", "--fixtures", "f.json", "--rows", "a,b", "--out", "old", "--loop", "--force"], "D:/out")).toEqual(["s.json", "--fixtures", "f.json", "--loop", "--out", "D:/out", "--resume"]);
  });

  test("readResume reads the rows still to run", () => {
    const dir = tempDir("xfb-loop-");
    writeFileSync(join(dir, "resume.json"), JSON.stringify({ schema: "xfb/session-resume-1", attempt: 2, rows_remaining: ["x"] }));
    expect(readResume(dir)).toMatchObject({ attempt: 2, rows: ["x"] });
  });
});

describe("the overlay's look, live (overlay.set)", () => {
  const set = (theme: string) => ({ do: "run", command: "overlay.set", input: { theme, motion: "full" } });
  test("the teardown puts back each key as the first overlay.set of the game session found it", async () => {
    const clock = new FakeClock();
    let theme = "dark";
    let motion = "auto";
    const api = fakeApi(clock, { "overlay.set": (input) => {
      const undo: Record<string, unknown> = {};
      if (input.theme) { undo.theme = theme; theme = input.theme; }
      if (input.motion) { undo.motion = motion; motion = input.motion; }
      return { ok: true, result: { theme, motion: { setting: motion }, undo: { method: "overlay.set", params: undo } } };
    } });
    const rows: Row[] = [{ id: "a", title: "a", steps: [set("light")] }, { id: "b", title: "b", steps: [set("dark"), set("light")] }];
    await go(script(rows), api, fakeHost(), clock, tempDir("xfb-batch-"));
    expect(api.calls.filter((c) => c.name === "overlay.set").at(-1)!.input).toEqual({ theme: "dark", motion: "auto" });
    expect([theme, motion]).toEqual(["dark", "auto"]);
  });

  test("needs_restart (the overlay off at load): config.ini gets it, the game restarts once, and the look is set again", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const mod = stagedMod(dir);
    const api = fakeApi(clock, {
      "overlay.set": (_i, n) => (n === 1 ? { ok: false, code: "needs_restart", message: "off at load" } : { ok: true, result: { theme: "dark", motion: { setting: "auto" } } }),
      "overlay.state": () => ({ ok: true, result: { theme: "dark", motion: { setting: "auto", effective: "reduced", reason: "frame_generation" }, frame_generation_modules: ["nvngx_dlssg.dll"] } }),
    });
    const host = fakeHost({ running: true });
    const st = JSON.parse(readFileSync(join(import.meta.dir, "..", "sessions", "st-styling.json"), "utf8"));
    // ST9a's own steps, with the staged config already as the rows need it (so only the branch restarts).
    const row = { ...st.rows.find((r: Row) => r.id === "ST9a-dark"), requires: [], pass: [] };
    const result = await go(script([row]), api, host, clock, dir, { fixtures: { staged_mod: mod, mo2: { exe: "m", profile: "p", executable: "g" } } });
    expect(result.rows[0].verdict).toBe("PASS");
    expect(host.log.filter((l) => l === "close" || l === "launch")).toEqual(["close", "launch"]);
    expect(api.calls.filter((c) => c.name === "overlay.set").length).toBeGreaterThanOrEqual(2);
    expect(result.rows[0].reports.some((r) => r.branch === "needs_restart")).toBe(true);
  });
});

describe("FR1: free roam for the replay (free-roam.json)", () => {
  const fr = () => JSON.parse(readFileSync(join(import.meta.dir, "..", "sessions", "free-roam.json"), "utf8"));
  test("its plan: recorder, question, handover, a 10-minute answer, resume, stop, span; passive", () => {
    const script = fr();
    expect(planBatch(script).problems).toEqual([]);
    expect(script.rows.map((r: Row) => r.id)).toEqual(["FR1-free-roam"]);
    const row = script.rows[0] as Row;
    const at = (label: string) => row.steps.findIndex((st) => st.label === `FR1-free-roam-${label}`);
    const order = ["recorder", "cursor", "ask", "handover", "answer", "resume", "stop", "span"].map(at);
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const recorder = row.steps[at("recorder")] as unknown as { input: { channels: string[] }; alternatives: { input: { channels: string[] } }[][]; outcomes: unknown[] };
    expect(recorder.input.channels).toEqual(["v", "actors", "camera", "incidents", "supervisor"]);
    expect(recorder.alternatives[0][0].input.channels).toEqual(["v", "actors", "camera", "incidents"]);
    expect(recorder.outcomes[0]).toMatchObject({ match: { code: "recording_busy" } });
    const ask = row.steps[at("ask")] as { input: { level: string; choices: string[]; text: string } };
    expect(ask.input).toMatchObject({ level: "ask", choices: ["Done", "Skip"] });
    expect(ask.input.text).toContain("walk about a block, then drive across a district");
    const answer = row.steps[at("answer")] as { timeout_s: number; outcomes: { name: string }[]; fallback: { end: string }[] };
    expect(answer.timeout_s).toBe(600);
    expect(answer.outcomes.map((o) => o.name)).toEqual(["done", "skipped"]);
    expect(answer.fallback[0].end).toBe("fail");
    expect(row.cleanup!.some((st) => st.command === "session.resume")).toBe(true);
    // Passive: nothing but the message, the handover, the recorder and reads.
    const commands = JSON.stringify(row).match(/"command":"[a-z.]+"/g)!.map((c) => c.slice(11, -1));
    expect([...new Set(commands)].sort()).toEqual(["game.wait", "photo.exit", "session.handover", "session.resume", "test.record.start", "test.record.stop", "ui.message"]);
  });

  const runFr = async (answer: string, startCode?: string) => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const api = fakeApi(clock, {
      // With startCode, the batch's telemetry recorder starts (run 7) and the row's own start is refused with it.
      ...(startCode ? { "test.record.start": (_i: unknown, n: number) => (n === 1 ? { ok: true as const, result: { run: 7 } } : { ok: false as const, code: startCode }) } : {}),
      "game.catchup": (input) => ({ ok: true, result: { cursor: { after: 1 }, counts: { v: 3 }, gaps: [], more: false, ...(input.run !== undefined || input.cursor ? { v: { distance_m: 812.4, path: [[0, 0, 0]], latest: { position: [800, 120, 0] } } } : {}) } }),
    }, { autoAnswer: answer });
    const result = await go(fr(), api, fakeHost(), clock, dir, { fixtures: { staged_mod: stagedMod(dir) } });
    return { row: result.rows[0], api, report: readFileSync(result.reportPath, "utf8") };
  };

  test("Done after a drive: PASS, with the run id and V's distance in the row's facts and the report", async () => {
    const { row, api, report } = await runFr("Done");
    expect(row.verdict).toBe("PASS");
    // The fake lets the row start its own recorder (run 2) beside the batch's (run 1).
    expect(row.facts).toEqual([{ label: "recorder run", value: 2 }, { label: "V's distance (m)", value: 812.4 }, { label: "catch-up pages", value: 1 }]);
    expect(report).toContain("FR1-free-roam: recorder run 2; V's distance (m) 812.4");
    const names = api.calls.map((c) => c.name);
    expect(names.indexOf("session.handover")).toBeLessThan(names.lastIndexOf("session.resume"));
  });

  test("Skip is a SKIP with its reason, and the game still goes back to the bridge", async () => {
    const { row, api } = await runFr("Skip");
    expect(row.verdict).toBe("SKIP");
    expect(row.reason).toContain("the player chose Skip");
    expect(api.calls.filter((c) => c.name === "session.resume").length).toBeGreaterThan(0);
  });

  test("the batch's recorder already running (recording_busy) is reused, and covers the row", async () => {
    const { row } = await runFr("Done", "recording_busy");
    expect(row.verdict).toBe("PASS");
    expect(row.facts![0]).toEqual({ label: "recorder run", value: 7 });
  });
});

describe("the prelude starts a game patiently and adopts a healthy one", () => {
  const loadRow: Row[] = [{ id: "r", title: "r", requires: [{ config: "bridge.allow_writes", equals: "true" }], steps: [{ do: "set", value: 1 }] }];
  const booting = (clock: FakeClock, opts: { startingFor: number; loadRefusals: number }) => {
    let phase = "starting";
    const api = fakeApi(clock, {
      // The bridge answers early, but the game keeps saying it hasn't finished starting for a while.
      "game.status": (_i, n) => (n <= opts.startingFor ? { ok: false, code: "game_not_running", message: "The game hasn't finished starting. Wait for the main menu, then try again." } : { ok: true, result: { phase } }),
      "game.load": (_i, n) => {
        if (n <= opts.loadRefusals) return { ok: false, code: "game_not_running", message: "The game hasn't finished starting. Wait for the main menu, then try again." };
        phase = "gameplay";
        return { ok: true, result: { reached: "gameplay" } };
      },
    });
    return { api, setPhase: (p: string) => { phase = p; } };
  };

  test("1 and 2: after the launch it waits for the main menu, and a load refused game_not_running is retried, never a halt", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const { api, setPhase } = booting(clock, { startingFor: 6, loadRefusals: 3 });
    setPhase("main_menu");
    const host = fakeHost({ running: false });
    const result = await go(script(loadRow), api, host, clock, dir, { fixtures: { staged_mod: stagedMod(dir), mo2: { exe: "m", profile: "p", executable: "g" } } });
    expect(result.haltInfo).toBeUndefined();
    expect(result.rows[0].verdict).toBe("PASS");
    expect(api.calls.filter((c) => c.name === "game.load").length).toBe(4);
    expect(host.log).toEqual(["launch"]);
  });

  test("4: a prelude that fails with a healthy game keeps it, and the next attempt adopts it instead of relaunching", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const mod = stagedMod(dir);
    const host = fakeHost({ running: false });
    // Attempt 1: the save can't be loaded (a missing save), so the prelude stops; the game itself is healthy.
    const first = await go(script(loadRow), fakeApi(clock, { "game.status": () => ({ ok: true, result: { phase: "main_menu" } }), "game.load": () => ({ ok: false, code: "save_unknown", message: "no such save" }) }), host, clock, dir,
      { fixtures: { staged_mod: mod, mo2: { exe: "m", profile: "p", executable: "g" } } });
    expect(first.haltInfo?.kind).toBe("prelude");
    expect(host.log).toEqual(["launch"]);
    // Attempt 2 (the same game still running, at the main menu): adopted, the save loaded, no second launch.
    const { api } = booting(clock, { startingFor: 0, loadRefusals: 0 });
    const statusAtMenu = { ...api, run: (name: string, input: Record<string, unknown> = {}, o = {}) => (name === "game.status" && !api.calls.some((c) => c.name === "game.load") ? Promise.resolve({ ok: true, command: name, cid: "c", result: { phase: "main_menu" } }) : api.run(name, input as never, o)) };
    const second = await go(script(loadRow), statusAtMenu as never, host, clock, dir, { fixtures: { staged_mod: mod, mo2: { exe: "m", profile: "p", executable: "g" } }, rows: first.remaining });
    expect(second.rows[0].verdict).toBe("PASS");
    expect(host.log).toEqual(["launch"]);
    expect(api.calls.some((c) => c.name === "game.load")).toBe(true);
  });

  test("5: MO2's Cannot launch program dialog fails at once, with what to do", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const host = fakeHost({ running: false, noProcessAfterLaunch: true, launchBlocked: "Cannot launch program" });
    const result = await go(script(loadRow), fakeApi(clock), host, clock, dir, { fixtures: { staged_mod: stagedMod(dir), mo2: { exe: "m", profile: "p", executable: "g" } } });
    expect(result.rows[0].reason).toContain("Windows Defender (or another antivirus) blocked MO2");
    expect(clock.now()).toBeLessThan(60_000);
  });
});

describe("whole-batch passive rows, and the telemetry they judge", () => {
  const pageWith = (invalid: number, gaps: string[] = []) => ({ ok: true as const, result: { cursor: { after: 1 }, counts: {}, gaps, more: false,
    count_detail: { subtitles: { records: 10, invalid, valid: 10 - invalid }, v: { records: 50, invalid: 0, valid: 50 } }, coverage_delta: { dropped: 0, invalid, missed_deadlines: 0, file_error: false } } });
  const passive: Row = { id: "B318-1", title: "passive", passive: "whole-batch", steps: [{ do: "set", value: "$telemetry", bind: "all" }],
    pass: [{ label: "no invalid", ref: "$all.coverage.invalid", match: { equals: 0 } }, { label: "subtitles", ref: "$all.channels.subtitles.invalid", match: { equals: 0 } }],
    facts: [{ label: "invalid by row", ref: "$all.invalid_in" }] };
  const two: Row[] = [passive, { id: "a", title: "a", steps: [{ do: "run", command: "ui.state", input: {} }] }, { id: "b", title: "b", steps: [{ do: "run", command: "ui.state", input: {} }] }];

  test("judged at the end over every row's catch-up, with no session time of its own", async () => {
    const clock = new FakeClock();
    let n = 0;
    const api = fakeApi(clock, { "game.catchup": () => pageWith(++n === 2 ? 2 : 0, n === 2 ? ["invalid_source"] : []) });
    const result = await go(script(two), api, fakeHost(), clock, tempDir("xfb-batch-"));
    const row = result.rows.find((r) => r.id === "B318-1")!;
    expect(row.verdict).toBe("FAIL");
    expect(row.facts![0].value).toEqual([{ row: "b", channel: "subtitles", invalid: 2 }]);
    // It ran no prelude, held no session time and collected no telemetry of its own.
    expect(row.prelude).toBeUndefined();
    expect(row.telemetry).toBeUndefined();
    expect(clock.now()).toBeLessThan(20_000);
  });

  test("a clean batch passes it", async () => {
    const clock = new FakeClock();
    const result = await go(script(two), fakeApi(clock, { "game.catchup": () => pageWith(0) }), fakeHost(), clock, tempDir("xfb-batch-"));
    expect(result.rows.find((r) => r.id === "B318-1")!.verdict).toBe("PASS");
  });

  test("a passive row that would act is refused at planning", () => {
    const problems = planBatch(script([{ ...passive, steps: [{ do: "wait", ms: 1 }, { do: "run", command: "ui.state", input: {} }] }])).problems;
    expect(problems.join("\n")).toContain("only reads and computes");
  });

  test("a load in the prelude marks the batch's recorder stale, so the row gets a fresh run (the load stopped it)", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    let phase = "main_menu";
    const api = fakeApi(clock, { "game.status": () => ({ ok: true, result: { phase } }), "game.load": () => { phase = "gameplay"; return { ok: true, result: { reached: "gameplay" } }; } });
    const rows: Row[] = [{ id: "r", title: "r", requires: [{ config: "bridge.allow_writes", equals: "true" }], steps: [{ do: "set", value: 1 }] }];
    await go(script(rows), api, fakeHost({ running: true }), clock, dir, { fixtures: { staged_mod: stagedMod(dir) } });
    expect(api.calls.filter((c) => c.name === "test.record.start").length).toBe(2);
  });

  test("the plugin log is found in MO2's overwrite folder, where the game's new files land under MO2", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const logs = join(dir, "MO2", "overwrite", "red4ext", "logs");
    mkdirSync(logs, { recursive: true });
    const file = join(logs, "xfruntimebridge-2026-10-26-12-12-29.log");
    writeFileSync(file, "boot\n");
    const api = fakeApi(clock, { "ui.state": () => { writeFileSync(file, "boot\nevt=row.work\n"); return { ok: true, result: {} }; } });
    const result = await go(script([{ id: "a", title: "a", steps: [{ do: "run", command: "ui.state", input: {} }] }]), api, fakeHost(), clock, dir, { fixtures: { mo2: { exe: join(dir, "MO2", "ModOrganizer.exe"), profile: "p", executable: "g" } } });
    expect(result.rows[0].telemetry!.log_lines).toBe(1);
  });
});

describe("refusals that say to wait are waited through (DI2's npc_not_spawned)", () => {
  const notYet = { ok: false as const, code: "npc_not_spawned", message: "That actor hasn't appeared yet. Wait for its npc.spawned event and try again." };
  test("a wait-for refusal is retried until it clears, within its bound", async () => {
    const clock = new FakeClock();
    const api = fakeApi(clock, { "npc.move": (_i, n) => (n <= 2 ? notYet : { ok: true, result: { moving: true } }) });
    const result = await go(script([{ id: "r", title: "r", steps: [{ do: "run", command: "npc.move", input: { who: "a1", to: "v" } }] }]), api, fakeHost(), clock, tempDir("xfb-batch-"));
    expect(result.rows[0].verdict).toBe("PASS");
    expect(api.calls.filter((c) => c.name === "npc.move").length).toBe(3);
  });

  test("one that never clears fails after at most 15 s, saying it waited", async () => {
    const clock = new FakeClock();
    const api = fakeApi(clock, { "npc.move": () => notYet });
    const result = await go(script([{ id: "r", title: "r", steps: [{ do: "run", command: "npc.move", input: { who: "a1", to: "v" } }] }]), api, fakeHost(), clock, tempDir("xfb-batch-"));
    expect(result.rows[0].verdict).toBe("SKIP");
    expect(result.rows[0].reason).toContain("still so after waiting");
    expect(clock.now()).toBeLessThan(40_000);
  });

  test("a refusal that doesn't say to wait isn't retried", async () => {
    const clock = new FakeClock();
    const api = fakeApi(clock, { "npc.move": () => ({ ok: false, code: "too_far", message: "That place is too far." }) });
    await go(script([{ id: "r", title: "r", steps: [{ do: "run", command: "npc.move", input: { who: "a1", to: "v" } }] }]), api, fakeHost(), clock, tempDir("xfb-batch-"));
    expect(api.calls.filter((c) => c.name === "npc.move").length).toBe(1);
  });

  test("the DI fixtures wait for both actors' npc.spawned, each on its own cursor, before declaring or moving anyone", () => {
    const smoke = JSON.parse(readFileSync(join(import.meta.dir, "..", "sessions", "borg4-smoke.json"), "utf8"));
    for (const id of ["DI2", "DI3"]) {
      const steps = smoke.rows.find((r: Row) => r.id === id).steps as { label?: string; do: string; kind?: string; cursor?: string; command?: string }[];
      const spawnedWaits = steps.filter((st) => st.do === "await" && st.kind === "npc.spawned");
      expect(spawnedWaits.length).toBe(2);
      expect(new Set(spawnedWaits.map((st) => st.cursor)).size).toBe(2);
      const lastWait = Math.max(...spawnedWaits.map((st) => steps.indexOf(st as never)));
      expect(steps.findIndex((st) => st.command === "incidents.declare")).toBeGreaterThan(lastWait);
      expect(steps.findIndex((st) => st.command === "npc.move")).toBeGreaterThan(lastWait);
    }
  });
});

describe("CRS re-picks a fresh walker when the one it chose has moved on", () => {
  test("npc_not_found: up to three fresh picks of different eligible walkers, then the swap", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const walkers = [
      { id: "w-protected", crowd: true, dead: false, protected: true, distance: 12 },
      { id: "w1", crowd: true, dead: false, protected: false, distance: 14 },
      { id: "w-busy", crowd: true, dead: false, protected: false, busy: "workspot", distance: 15 },
      { id: "w2", crowd: true, dead: false, protected: false, distance: 18 },
      { id: "w-near", crowd: true, dead: false, protected: false, distance: 3 },
    ];
    const tried: unknown[] = [];
    const api = fakeApi(clock, {
      "npc.list": () => ({ ok: true, result: { npcs: walkers } }),
      "npc.substitute": (input) => {
        tried.push(input.id ?? "look_at");
        if (input.id !== "w2") return { ok: false, code: "npc_not_found", message: "That NPC isn't near V any more. Run npc_list again." };
        api.push("npc.substituted", { who: "a5" });
        return { ok: true, result: { who: "a5" } };
      },
    });
    const smoke = JSON.parse(readFileSync(join(import.meta.dir, "..", "sessions", "borg4-smoke.json"), "utf8"));
    const result = await go(smoke, api, fakeHost(), clock, dir, { rows: ["CRS"], fixtures: { staged_mod: stagedMod(dir) } });
    const row = result.rows.find((r) => r.id === "CRS")!;
    expect(row.verdict).toBe("PASS");
    // look_at, look_at after a turn, then the first and second eligible walkers (protected, busy and too-near ones skipped).
    expect(tried).toEqual(["look_at", "look_at", "w1", "w2"]);
  });
});
