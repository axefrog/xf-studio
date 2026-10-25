// Schema-3 batches, the follow-up: telemetry always on, the fast exit on a significant bug (crash, a lost bridge, a
// failed draw call in the plugin log, a runner error, the same failure across N rows), resume.json and a second
// attempt into the same folder, and the loop's signal. Fake API, fake host, the deterministic clock.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseHaltOn, type Row } from "../testing/batch.ts";
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
    const fine = await go(script(kill), fakeApi(clock, { "bridge.ping": () => ({ ok: false, code: "no_bridge" }) }), fakeHost({ running: true }), clock, tempDir("xfb-batch-"), { haltOn: parseHaltOn("bridge_lost") });
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
