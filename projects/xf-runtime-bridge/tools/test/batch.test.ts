// Schema-3 batches (testing/batch.ts) against a fake command API and a fake host, on the deterministic clock:
// verdicts, the prelude's config.set and restart, handed_over and the commit tripwire, the teardown, key refusals,
// the preflight's verdicts, config.ini editing, key names and CET bindings, and the shipped scripts.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { CommandApi } from "../api/command-api.ts";
import { encodePng } from "../capture/image.ts";
import { describeBatch, planBatch, runBatch, simulateConfig, verdictOf, type BatchScript, type Row } from "../testing/batch.ts";
import { ConfigEditor, readIni, setIni, stagedConfigPath, stagedDllPath, stagedManifestPath } from "../testing/config-ini.ts";
import { cetWindowRect, decodeCetBinding, keysLabel, parseCetBindings, parseKeys, type Host } from "../testing/host.ts";
import { dllHasString, formatPreflight, preflight } from "../testing/preflight.ts";
import { FakeClock } from "./fake-clock.ts";
import { fakeApi, fakeHost, go, script, STAGED_INI, stagedMod } from "./batch-fakes.ts";
import { projectDir, tempDir } from "./helpers.ts";

describe("batch: verdicts", () => {
  test("PASS, FAIL (fail_row), PARTIAL and SKIP, each with its evidence; one row's failure never stalls the next", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const api = fakeApi(clock, {
      "overlay.state": () => ({ ok: true, result: { motion: { effective: "full" }, theme: "dark" } }),
      "phone.call": () => ({ ok: false, code: "refused" }),
      "photo.open": () => ({ ok: false, code: "not_foreground" }),
    });
    const rows: Row[] = [
      { id: "pass", title: "passes", steps: [{ label: "s", do: "run", command: "overlay.state", input: {}, bind: "ov" }, { label: "shot", do: "capture", name: "pass-shot", clear_overlay: false, bind: "shot" }],
        pass: [{ label: "full", ref: "$ov.motion.effective", match: { equals: "full" } }, { label: "captured", ref: "$shot", captured: true }] },
      { id: "fail", title: "fails", steps: [{ label: "call", do: "run", command: "phone.call", input: { contact: "coach", lines: [{ text: "x" }] }, on_fail: "fail_row" }] },
      { id: "partial", title: "partly", steps: [{ label: "s2", do: "run", command: "overlay.state", input: {}, bind: "ov2" }],
        pass: [{ label: "full", ref: "$ov2.motion.effective", match: { equals: "full" } }, { label: "light", ref: "$ov2.theme", match: { equals: "light" } }] },
      { id: "skip", title: "can't set up", steps: [{ label: "open", do: "run", command: "photo.open", input: {} }, { label: "x", do: "run", command: "overlay.state", input: {}, bind: "ov3" }],
        pass: [{ label: "x", ref: "$ov3.theme", match: { equals: "dark" } }] },
      { id: "after", title: "still runs", steps: [{ label: "s4", do: "run", command: "overlay.state", input: {} }] },
    ];
    const result = await go(script(rows), api, fakeHost(), clock, dir);
    expect(result.rows.map((r) => [r.id, r.verdict])).toEqual([["pass", "PASS"], ["fail", "FAIL"], ["partial", "PARTIAL"], ["skip", "SKIP"], ["after", "PASS"]]);
    expect(result.rows[0].evidence.some((e) => e.endsWith("pass-shot.full.png"))).toBe(true);
    expect(result.rows[3].reason).toContain("not_foreground");
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
    expect(manifest.schema).toBe("xfb/session-report-3");
    expect(manifest.run.counts).toEqual({ PASS: 2, FAIL: 1, PARTIAL: 1, SKIP: 1 });
    const report = readFileSync(result.reportPath, "utf8");
    expect(report).toContain("| fail | fails | FAIL |");
  });

  test("a check on a value an earlier row bound is not evidence for this row", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const api = fakeApi(clock, { "overlay.state": () => ({ ok: true, result: { theme: "dark" } }) });
    const rows: Row[] = [
      { id: "one", title: "binds", steps: [{ do: "run", command: "overlay.state", input: {}, bind: "ov" }] },
      { id: "two", title: "only reads", steps: [{ do: "wait", ms: 10 }], pass: [{ label: "dark", ref: "$ov.theme", match: { equals: "dark" } }] },
    ];
    const result = await go(script(rows), api, fakeHost(), clock, dir);
    expect(result.rows[1].verdict).toBe("SKIP");
    expect(result.rows[1].checks[0].result).toBe("not_evaluated");
  });

  test("verdictOf: the rules in one place", () => {
    const done = { status: "done" as const, outcome: "completed" as const };
    expect(verdictOf(done, [], new Set()).verdict).toBe("PASS");
    expect(verdictOf({ ...done, outcome: "partial" }, [], new Set()).verdict).toBe("PARTIAL");
    expect(verdictOf(done, [{ label: "a", result: "fail" }], new Set()).verdict).toBe("FAIL");
    expect(verdictOf(done, [{ label: "a", result: "pass" }, { label: "b", result: "not_evaluated" }], new Set()).verdict).toBe("PARTIAL");
    expect(verdictOf({ status: "failed", outcome: "abandoned", reason: "x: no", last_step: "x" }, [], new Set(["x"])).verdict).toBe("FAIL");
    expect(verdictOf({ status: "failed", outcome: "abandoned", reason: "y: no", last_step: "y" }, [], new Set(["x"]))).toEqual({ verdict: "SKIP", reason: "could not run: y: no" });
    expect(verdictOf({ status: "stopped", outcome: "abandoned", reason: "handed over" }, [{ label: "a", result: "pass" }], new Set()).verdict).toBe("PARTIAL");
  });
});

describe("batch: anticipation through the session executor", () => {
  test("a refused key press is recorded, retried, and the alternative route (a capture-based check) is taken", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const api = fakeApi(clock, { "overlay.state": () => ({ ok: true, result: { cet_open: false } }) });
    const host = fakeHost({ foreground: false });
    const rows: Row[] = [{ id: "cet", title: "open CET", steps: [
      { label: "win", do: "host.window", bind: "win" },
      { label: "before", do: "capture", name: "cet-before", clear_overlay: false, bind: "before" },
      { label: "key", do: "host.key", keys: "Ctrl+`", retry: { times: 2, backoff_ms: 100, on: { code: "not_foreground" } }, on_fail: "continue" },
      { label: "seen", do: "run", command: "overlay.state", input: {}, until: { path: "cet_open", equals: true }, interval_ms: 250, deadline_ms: 1000,
        alternatives: [[{ do: "capture", name: "cet-after", clear_overlay: false, bind: "after" }, { do: "capture.compare", a: "$before", b: "$after", rect: "$win.regions.cet_window", min_changed: 0.15, bind: "seen" }]] },
    ], pass: [{ label: "seen by capture", ref: "$seen.changed", match: { equals: true } }] }];
    const result = await go(script(rows), api, host, clock, dir);
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
    expect(manifest.attempts[0].key_refusals.length).toBe(3);
    expect(manifest.attempts[0].key_refusals[0]).toMatchObject({ keys: "Ctrl+`" });
    expect(manifest.attempts[0].detours.some((d: string) => d.includes("seen") && d.includes("route 2"))).toBe(true);
    expect(result.rows[0].verdict).toBe("PASS");
  });

  test("an in-game question: the answer's label is the value", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const api = fakeApi(clock, {}, { autoAnswer: "Fully visible" });
    const rows: Row[] = [{ id: "ask", title: "asks", steps: [{ label: "q", do: "ask", text: "Visible?", choices: ["Fully visible", "Partly cut off"], deadline_ms: 30_000, bind: "answer" }],
      pass: [{ label: "whole", ref: "$answer.label", match: { equals: "Fully visible" } }] }];
    const result = await go(script(rows), api, fakeHost(), clock, dir);
    expect(result.rows[0].verdict).toBe("PASS");
  });

  test("schema-2 steps inside a row: a cursor before the question, then await its answer by the returned id", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const api = fakeApi(clock, {}, { autoAnswer: "First" });
    const rows: Row[] = [{ id: "q", title: "await", steps: [
      { label: "cursor", do: "cursor", bind: "cur" },
      { label: "ask", do: "run", command: "ui.message", input: { level: "ask", text: "Pick", choices: ["First", "Second"], seconds: 60 }, bind: "q" },
      { label: "answer", do: "await", cursor: "$cur", kind: "answer", message_id: "$q.id", timeout_s: 8, bind: "answer" },
    ], pass: [{ label: "answered", ref: "$answer.complete", match: { equals: true } }] }];
    const result = await go(script(rows), api, fakeHost(), clock, dir);
    expect(result.rows[0].verdict).toBe("PASS");
  });

  test("an unanswered question times out at its deadline and the row skips", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const api = fakeApi(clock);
    const rows: Row[] = [{ id: "ask", title: "asks", steps: [{ label: "q", do: "ask", text: "Anyone?", deadline_ms: 20_000 }] }];
    const result = await go(script(rows), api, fakeHost(), clock, dir);
    expect(result.rows[0].verdict).toBe("SKIP");
    expect(clock.now()).toBeLessThan(25_000);
    expect(api.calls.some((c) => c.name === "ui.message" && c.input.withdraw)).toBe(true);
  });
});

describe("batch: safety and stop handling", () => {
  test("handed_over stops the batch cleanly: later rows are SKIP(not reached), the teardown runs and config.ini is restored", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const mod = stagedMod(dir);
    const api = fakeApi(clock, { "photo.open": () => ({ ok: false, code: "handed_over", message: "handed over" }) });
    const rows: Row[] = [
      { id: "first", title: "sets config", requires: [{ config: "overlay.enabled", equals: "true" }], steps: [{ label: "open", do: "run", command: "photo.open", input: {}, on_fail: "continue" }, { label: "more", do: "run", command: "ui.state", input: {} }] },
      { id: "second", title: "never reached", steps: [{ do: "run", command: "overlay.state", input: {} }] },
    ];
    const result = await go(script(rows), api, fakeHost({ running: true }), clock, dir, { fixtures: { staged_mod: mod, mo2: { exe: "mo2.exe", profile: "test", executable: "game" } } });
    expect(result.outcome).toBe("stopped");
    expect(result.halt).toContain("handed to the player");
    expect(result.rows[1]).toMatchObject({ verdict: "SKIP" });
    expect(result.rows[1].reason).toContain("not reached");
    expect(api.calls.filter((c) => c.name === "ui.state").length).toBe(0);
    for (const name of ["supervisor.clear", "test.record.stop", "npc.status", "ui.hud"]) expect(api.calls.some((c) => c.name === name)).toBe(true);
    expect(readFileSync(stagedConfigPath(mod), "utf8")).toBe(STAGED_INI);
    expect(readFileSync(result.reportPath, "utf8")).toContain("**Halted (handed_over):**");
  });

  test("the commit tripwire hands the game over once and stops the batch", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const api = fakeApi(clock);
    const host = fakeHost({ freeGb: 40 });
    const rows: Row[] = [
      { id: "heavy", title: "heavy", steps: [{ do: "wait", ms: 1000 }, { do: "set", value: 1 }, { do: "wait", ms: 20_000 }, { do: "set", value: 2 }, { do: "set", value: 3 }] },
      { id: "next", title: "next", steps: [{ do: "set", value: 4 }] },
    ];
    // Free commit falls under the floor during the row.
    void clock.sleep(5000).then(() => { host.free = 2 * 1024 ** 3; });
    const result = await go(script(rows), api, host, clock, dir, { commitEveryMs: 1000 });
    expect(result.halt).toContain("commit tripwire");
    expect(api.calls.filter((c) => c.name === "session.handover").length).toBe(1);
    expect(result.rows[1].reason).toContain("not reached");
  });

  test("Ctrl+C (the signal) ends the row at once; the rest are SKIP(interrupted) and the teardown still runs", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const api = fakeApi(clock);
    const stop = new AbortController();
    void clock.sleep(1000).then(() => stop.abort());
    const rows: Row[] = [{ id: "long", title: "long", steps: [{ do: "wait", ms: 60_000 }] }, { id: "later", title: "later", steps: [{ do: "set", value: 1 }] }];
    const result = await go(script(rows), api, fakeHost(), clock, dir, { signal: stop.signal });
    expect(result.outcome).toBe("interrupted");
    expect(result.rows.map((r) => r.verdict)).toEqual(["SKIP", "SKIP"]);
    expect(api.calls.some((c) => c.name === "supervisor.clear")).toBe(true);
  });
});

describe("batch: the prelude (config.set and the game's lifecycle)", () => {
  test("a row's config is set with a backup; a change restarts a running game (close, launch, bridge, load); the file is restored at the end", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const mod = stagedMod(dir);
    const api = fakeApi(clock, { "bridge.ping": (_i, n) => (n < 3 ? { ok: false, code: "no_bridge" } : { ok: true, result: {} }) });
    const host = fakeHost({ running: true });
    let seen: Record<string, string> = {};
    const rows: Row[] = [
      { id: "dark", title: "dark, overlay on", requires: [{ config: "overlay.enabled", equals: "true" }, { config: "overlay.motion", equals: "full" }], steps: [{ do: "config.read", bind: "cfg" }],
        pass: [{ label: "on", ref: "$cfg", match: { path: "overlay.enabled", equals: "true" } }] },
      { id: "same", title: "same config: no restart", requires: [{ config: "overlay.enabled", equals: "true" }], steps: [{ do: "set", value: 1 }] },
    ];
    const result = await go(script(rows), api, host, clock, dir, { fixtures: { staged_mod: mod, mo2: { exe: "mo2.exe", profile: "test", executable: "game" } } });
    seen = readIni(readFileSync(join(dir, "out", "config-backup-a1", "config.ini.before-session"), "utf8"));
    expect(result.rows.map((r) => [r.verdict, r.reason ?? ""])).toEqual([["PASS", ""], ["PASS", ""]]);
    expect(host.log.filter((l) => l === "close" || l === "launch")).toEqual(["close", "launch"]);
    expect(api.calls.filter((c) => c.name === "game.load").length).toBe(1);
    expect(seen["overlay.enabled"]).toBe("false");
    expect(readFileSync(stagedConfigPath(mod), "utf8")).toBe(STAGED_INI);
  });

  test("not running: the config is set before the launch, with no restart; read-only rows wait for the menu instead of loading", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const mod = stagedMod(dir);
    const api = fakeApi(clock);
    const host = fakeHost({ running: false });
    const rows: Row[] = [{ id: "ro", title: "read-only", requires: [{ config: "bridge.allow_writes", equals: "false" }], steps: [{ do: "set", value: 1 }] }];
    await go(script(rows), api, host, clock, dir, { fixtures: { staged_mod: mod, mo2: { exe: "mo2.exe", profile: "test", executable: "game" } } });
    expect(host.log).toEqual(["launch"]);
    expect(api.calls.some((c) => c.name === "game.load")).toBe(false);
    expect(api.calls.some((c) => c.name === "game.wait" && Array.isArray(c.input.phase) && c.input.phase.includes("main_menu"))).toBe(true);
  });

  test("after: restart restarts before the next row even when its config is the same", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const mod = stagedMod(dir);
    const host = fakeHost({ running: true });
    const rows: Row[] = [{ id: "kill", title: "kills", after: "restart", steps: [{ do: "set", value: 1 }] }, { id: "next", title: "next", steps: [{ do: "set", value: 2 }] }];
    await go(script(rows), fakeApi(clock), host, clock, dir, { fixtures: { staged_mod: mod, mo2: { exe: "mo2.exe", profile: "test", executable: "game" } } });
    expect(host.log).toEqual(["close", "launch"]);
  });

  test("a restart that can't launch (no MO2 in the fixtures) stops the batch with a plain reason", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-batch-");
    const rows: Row[] = [{ id: "a", title: "a", steps: [{ do: "set", value: 1 }] }, { id: "b", title: "b", steps: [{ do: "set", value: 2 }] }];
    const result = await go(script(rows), fakeApi(clock), fakeHost({ running: false }), clock, dir);
    expect(result.rows[0].reason).toContain("mo2.exe");
    expect(result.rows[1].reason).toContain("not reached");
  });

  test("simulateConfig: the order's restarts", () => {
    const rows = [
      { id: "a", title: "", steps: [], requires: [{ config: "overlay.theme", equals: "dark" }] },
      { id: "b", title: "", steps: [], requires: [{ config: "overlay.motion", equals: "full" }], after: "restart" as const },
      { id: "c", title: "", steps: [], requires: [{ config: "overlay.motion", equals: "full" }] },
    ];
    expect(simulateConfig(rows, readIni(STAGED_INI))).toEqual([{ row: "a", needs: {}, restart: false }, { row: "b", needs: { "overlay.motion": "full" }, restart: true }, { row: "c", needs: {}, restart: true }]);
  });
});

describe("batch: planning", () => {
  test("planBatch names every problem", () => {
    const { problems } = planBatch({ schema: "xfb/session-script-3", name: "t", rows: [
      { id: "a", title: "a", steps: [{ do: "dance" }, { do: "capture" }, { do: "run", command: "no.such" }, { do: "host.key" }, { do: "wait", ms: 10, on_fail: "explode" }, { do: "run", command: "overlay.state", input: {}, on_fail: "fail_row" }],
        pass: [{ label: "x", ref: "$nothing", match: { equals: 1 } }] },
      { id: "a", title: "dup", steps: [] },
    ] } as BatchScript);
    const text = problems.join("\n");
    for (const expected of ['unknown action "dance"', "names its files", 'no command "no.such"', "host.key takes keys or binding", "on_fail is skip_row", "a fail_row step needs a label", "which no step binds", "id is used more than once"]) expect(text).toContain(expected);
  });

  test("the shipped scripts are valid, follow their card, and name every ST capture ST<n>-<surface>-<state>-<theme>", () => {
    for (const file of ["st-styling.json", "borg4-smoke.json"]) {
      const s = JSON.parse(readFileSync(join(projectDir, "tools", "sessions", file), "utf8")) as BatchScript;
      expect(planBatch(s).problems, file).toEqual([]);
      expect(existsSync(join(projectDir, "..", "..", s.card!.split("#")[0])), file).toBe(true);
    }
    const st = JSON.parse(readFileSync(join(projectDir, "tools", "sessions", "st-styling.json"), "utf8")) as BatchScript;
    const names: string[] = [];
    const walk = (v: unknown) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") { const o = v as Record<string, unknown>; if ((o.do === "capture" || o.do === "burst") && typeof o.name === "string" && /^ST\d/.test(o.name) && !/-cet-(before|check)/.test(o.name)) names.push(o.name); Object.values(o).forEach(walk); } };
    walk(st.rows);
    expect(names.length).toBeGreaterThan(40);
    for (const name of names) expect(name).toMatch(/^ST\d+-[a-z]+-[a-z0-9-]+-(dark|light)$/);
    // Every row sets its own look live first; the writes rows' dark ones come before their light ones.
    const lookOf = (r: Row) => (r.steps.find((st) => st.command === "overlay.set")?.input as { theme?: string } | undefined)?.theme;
    expect(st.rows.every((r) => lookOf(r) !== undefined)).toBe(true);
    // (The dark stopped row, which kills the bridge, closes the writes rows: its restart is the read-only one.)
    const writes = st.rows.filter((r) => r.after !== "restart" && (r.requires ?? []).some((n) => n.config === "bridge.allow_writes" && n.equals === "true")).map(lookOf);
    expect(writes.lastIndexOf("dark")).toBeLessThan(writes.indexOf("light"));
    // One restart: the config goes in before the launch, and read-only is the only value read at load that changes.
    const plan = simulateConfig(st.rows, readIni(STAGED_INI.replace("[overlay]", "[overlay]\r\nscale_percent = 100\r\ndiagnostics = false")));
    expect(plan.slice(1).filter((s) => s.restart).length).toBe(1);
    expect(st.rows.at(-1)!.id).toBe("ST7-light-stopped");
    const tree = describeBatch(st, readIni(STAGED_INI));
    expect(tree.some((line) => line.includes("prelude (from the staged config)") && line.includes("overlay.enabled = true"))).toBe(true);
    expect(tree.length).toBeGreaterThan(500);
  });
});

describe("config.ini, keys and CET bindings", () => {
  test("setIni replaces in place, adds to a section or a new section, and keeps CRLF", () => {
    let text = setIni(STAGED_INI, "overlay.enabled", "true");
    expect(text).toContain("[overlay]\r\nenabled = true\r\n");
    text = setIni(text, "overlay.diagnostics", "true");
    expect(readIni(text)["overlay.diagnostics"]).toBe("true");
    text = setIni(text, "log.level", "debug");
    expect(readIni(text)["log.level"]).toBe("debug");
    expect(text.includes("\n") && !/[^\r]\n/.test(text)).toBe(true);
    expect(readIni(text)["bridge.enabled"]).toBe("true");
  });

  test("ConfigEditor backs up once, restores the original bytes, and leaves a file someone else changed", () => {
    const dir = tempDir("xfb-ini-");
    const path = join(dir, "config.ini");
    writeFileSync(path, STAGED_INI);
    const editor = new ConfigEditor(path, join(dir, "backup"));
    expect(editor.set({ "overlay.theme": "dark" }).changed).toEqual([]);
    expect(editor.restore().restored).toBe(false);
    expect(editor.set({ "overlay.theme": "light", "overlay.motion": "full" }).changed.map((c) => c.key)).toEqual(["overlay.theme", "overlay.motion"]);
    editor.set({ "overlay.enabled": "true" });
    expect(readFileSync(editor.backupPath(), "utf8")).toBe(STAGED_INI);
    expect(editor.restore().restored).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(STAGED_INI);
    editor.set({ "overlay.theme": "light" });
    writeFileSync(path, readFileSync(path, "utf8") + "; edited by hand\r\n");
    expect(editor.restore()).toMatchObject({ restored: false });
  });

  test("keys: names, chords and CET's packed bindings (first key in the high bits, precision kept)", () => {
    expect(parseKeys("Ctrl+`")).toEqual([0x11, 0xc0]);
    expect(parseKeys("F6")).toEqual([0x75]);
    expect(parseKeys("IK_F6")).toEqual([0x75]);
    expect(parseKeys("Alt+Enter")).toEqual([0x12, 0x0d]);
    expect(() => parseKeys("Hyper+Q")).toThrow();
    expect(keysLabel([0x11, 0xc0])).toBe("Ctrl+`");
    expect(decodeCetBinding(4785899237801984n)).toEqual([0x11, 0xc0]);
    expect(decodeCetBinding(0n)).toEqual([]);
    const four = (0x11n << 48n) | (0x10n << 32n) | (0x12n << 16n) | 0x41n;
    const parsed = parseCetBindings(`{ "cet": { "overlay_key": ${four.toString()} }, "XF_Runtime_Bridge": { "xf_bridge_kill": 4785529870614528 } }`);
    expect(decodeCetBinding(parsed.cet.overlay_key)).toEqual([0x11, 0x10, 0x12, 0x41]);
    expect(keysLabel(decodeCetBinding(parsed.XF_Runtime_Bridge.xf_bridge_kill))).toBe("Ctrl+0x6a");
  });

  test("the CET window's area follows the window's height", () => {
    expect(cetWindowRect(3840, 1600)).toEqual({ x: 0, y: 560, width: 820, height: 1040 });
    expect(cetWindowRect(1920, 1080)).toEqual({ x: 0, y: 378, width: 554, height: 702 });
  });
});

describe("preflight", () => {
  const files = (dir: string, overrides: { ini?: string; manifest?: Record<string, unknown>; dll?: string; bindings?: string } = {}) => {
    const mod = stagedMod(dir);
    if (overrides.ini) writeFileSync(stagedConfigPath(mod), overrides.ini);
    const dll = `\0\0${overrides.dll ?? "overlay.state\0ui.hud\0native.ping\0game.status\0photo.open\0supervisor.clear\0test.record.stop\0ui.message\0photo.exit"}\0\0`;
    writeFileSync(stagedDllPath(mod), dll);
    // A manifest tied to this binary, as the packager writes it.
    const sha256 = createHash("sha256").update(Buffer.from(dll, "latin1")).digest("hex");
    writeFileSync(stagedManifestPath(mod), JSON.stringify({ version: "0.8.22", variant: "writes", commit: "abc", source_tree_clean: true, allow_test_hooks: true, autonomous_test_hooks: true,
      files: [{ path: "red4ext/plugins/XFRuntimeBridge/XFRuntimeBridge.dll", sha256 }], ...overrides.manifest }));
    const game = join(dir, "game");
    mkdirSync(join(game, "bin", "x64", "plugins", "cyber_engine_tweaks"), { recursive: true });
    writeFileSync(join(game, "bin", "x64", "plugins", "cyber_engine_tweaks", "bindings.json"), overrides.bindings ?? '{ "cet": { "overlay_key": 4785899237801984 } }');
    writeFileSync(join(game, "bin", "x64", "nvngx_dlssg.dll"), "");
    return { staged_mod: mod, game_dir: game, cet_overlay_key: "Ctrl+`", mo2: { exe: join(dir, "mo2.exe"), profile: "p", executable: "game" } };
  };
  const st: BatchScript = script([
    { id: "r1", title: "r1", requires: [{ config: "overlay.enabled", equals: "true" }, { config: "overlay.motion", equals: "full" }, { binding: "cet.overlay_key", equals: "$fixture.cet_overlay_key" }],
      steps: [{ do: "run", command: "overlay.state", input: {} }, { do: "run", command: "ui.hud", input: { show: false } }, { do: "host.key", keys: "$fixture.cet_overlay_key" }] },
    { id: "r2", title: "r2", requires: [{ config: "overlay.theme", equals: "light" }], steps: [{ do: "run", command: "photo.open", input: {} }] },
  ]);
  const run = (fixtures: Record<string, unknown>, extra: Partial<Parameters<typeof preflight>[0]> = {}) => preflight({
    script: st, fixtures, projectDir, runtimeDir: tempDir("xfb-rt-"), freeCommitBytes: async () => 30 * 1024 ** 3, gameRunning: async () => false, git: () => null, ...extra,
  });

  test("ready: planned fixes with their restarts, keys decoded, frame generation named", async () => {
    const dir = tempDir("xfb-pre-");
    writeFileSync(join(dir, "mo2.exe"), "");
    const result = await run(files(dir));
    const text = formatPreflight(result, "t");
    expect(result.items.filter((i) => i.status === "blocker")).toEqual([]);
    expect(result.fixes).toBe(2);
    expect(result.restarts).toBe(1);
    expect(text).toContain("overlay.enabled = true, overlay.motion = full before the launch");
    expect(text).toContain("overlay.theme = light, then a restart");
    expect(text).toContain("Ctrl+` (0x001100c000000000)");
    expect(text).toContain("nvngx_dlssg.dll");
  });

  test("blockers, named plainly: a method the DLL lacks, a binding that differs, a write class not allowed, low memory, a busy writer, the wrong package", async () => {
    const dir = tempDir("xfb-pre-");
    const fixtures = files(dir, { dll: "overlay.state\0", bindings: '{ "cet": { "overlay_key": 4785529870614528 } }', manifest: { variant: "diagnostic" },
      ini: STAGED_INI.replace("allow_write_classes = photo, world, save", "allow_write_classes = world") });
    const result = await run(fixtures, { freeCommitBytes: async () => 2 * 1024 ** 3, gameRunning: async () => true, writerBusy: async () => ({ busy: true, detail: "bridge_busy" }) });
    const text = formatPreflight(result, "t");
    for (const expected of ["doesn't answer ui.hud", "photo.open", "but the fixtures say Ctrl+`", "lacks photo (photo.open)", "2.0 GB of commit free", "writer seat (bridge_busy)", "the diagnostic package"]) expect(text).toContain(expected);
    expect(result.ready).toBe(false);
  });

  test("dllHasString finds whole, merged and compiled-in names", () => {
    const dll = Buffer.from("\0bridge.info\0native.ping\0xxui.statexx", "latin1");
    expect(dllHasString(dll, "bridge.info")).toBe("whole");
    expect(dllHasString(dll, "ping")).toBe("tail");
    expect(dllHasString(dll, "ui.state")).toBe("embedded");
    expect(dllHasString(dll, "ui.hud")).toBe(false);
  });
});
