// The Codex review of 65b8da29..34eb3d9d (5 High, 8 Medium): each finding reproduced first. Fake bridges and hosts;
// nothing reaches a game.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tempDir } from "./helpers.ts";

const fakes = async () => {
  const { FakeClock } = await import("./fake-clock.ts");
  const f = await import("./batch-fakes.ts");
  return { clock: new FakeClock(), ...f };
};

describe("H1: a tripped commit monitor doesn't refuse the teardown", () => {
  test("after a trip in a row, every teardown step still reaches the bridge", async () => {
    const { clock, fakeApi, fakeHost, go, script } = await fakes();
    const api = fakeApi(clock);
    const host = fakeHost({ freeGb: 40 });
    void clock.sleep(3000).then(() => { host.free = 2 * 1024 ** 3; });
    const rows = [{ id: "heavy", title: "heavy", steps: [{ label: "w", do: "wait", ms: 20_000 }] }];
    const result = await go(script(rows as never), api, host, clock, tempDir("xfb-r34-"), { commitEveryMs: 1000 });
    expect(result.halt).toContain("commit tripwire");
    const after = api.calls.slice(api.calls.findIndex((c) => c.name === "session.handover") + 1).map((c) => c.name);
    for (const name of ["supervisor.clear", "test.record.stop", "npc.status", "ui.message", "ui.hud"]) expect(after).toContain(name);
    // The trip's reason is kept for the report.
    expect(result.haltInfo?.kind).toBe("tripwire");
  });
});

describe("H2: whole-batch rows are judged again on every attempt, over every attempt's evidence", () => {
  const b318 = async () => {
    const { readFileSync } = await import("node:fs");
    return JSON.parse(readFileSync(join(import.meta.dir, "..", "sessions", "borg4-smoke.json"), "utf8")).rows.find((r: { id: string }) => r.id === "B318-1");
  };
  const attempt = async (dir: string, tapNotReady: string[], rows?: string[]) => {
    const { clock, fakeApi, fakeHost, go, script } = await fakes();
    const status = { not_ready: 0, tap_not_ready: tapNotReady, complete_coverage: !tapNotReady.length, channel_stats: { subtitles: { ready: true }, voice: { ready: !tapNotReady.includes("voice") } } };
    const api = fakeApi(clock, { "test.record.read": () => ({ ok: true, result: status }), "test.record.stop": () => ({ ok: true, result: status }) });
    const all = [{ id: "a", title: "a", steps: [{ label: "w", do: "wait", ms: 10 }] }, { id: "b", title: "b", steps: [{ label: "w", do: "wait", ms: 10 }] }, await b318()];
    return go(script(all as never), api, fakeHost(), clock, dir, rows ? { rows } : {});
  };
  test("a later attempt that resumes other rows re-judges B318-1, and an earlier attempt's bad evidence still counts", async () => {
    const dir = tempDir("xfb-r34-");
    const first = await attempt(dir, ["voice"]);
    expect(first.rows.find((r) => r.id === "B318-1")!.verdict).not.toBe("PASS");
    const second = await attempt(dir, [], ["b"]);
    const row = second.rows.find((r) => r.id === "B318-1")!;
    expect(row.verdict).not.toBe("PASS");
    expect(JSON.stringify(row.facts)).toContain("attempt 1: run 1: voice");
  });
  test("an earlier PASS doesn't survive a later attempt whose evidence fails", async () => {
    const dir = tempDir("xfb-r34-");
    expect((await attempt(dir, [])).rows.find((r) => r.id === "B318-1")!.verdict).toBe("PASS");
    const second = await attempt(dir, ["subtitles"], ["b"]);
    expect(second.rows.find((r) => r.id === "B318-1")!.verdict).toBe("PARTIAL");
    // The report's row is this attempt's judgement, not the first attempt's PASS.
    const { readFileSync } = await import("node:fs");
    const manifest = JSON.parse(readFileSync(join(dir, "out", "manifest.json"), "utf8"));
    expect(manifest.rows.find((r: { id: string }) => r.id === "B318-1").verdict).toBe("PARTIAL");
  });
});

describe("H3: B318-1 needs readiness evidence for every run, and says when it has none", () => {
  const judge = async (status: (() => { ok: boolean; result?: unknown; code?: string })) => {
    const { readFileSync } = await import("node:fs");
    const { clock, fakeApi, fakeHost, go, script } = await fakes();
    const b318 = JSON.parse(readFileSync(join(import.meta.dir, "..", "sessions", "borg4-smoke.json"), "utf8")).rows.find((r: { id: string }) => r.id === "B318-1");
    const api = fakeApi(clock, { "test.record.read": status as never, "test.record.stop": status as never });
    return (await go(script([{ id: "a", title: "a", steps: [{ label: "w", do: "wait", ms: 10 }] }, b318] as never), api, fakeHost(), clock, tempDir("xfb-r34-"))).rows.find((r) => r.id === "B318-1")!;
  };
  test("status reads that fail are unknown evidence, not a pass", async () => {
    const row = await judge(() => ({ ok: false, code: "recording_changed" }));
    expect(row.verdict).not.toBe("PASS");
    expect(JSON.stringify(row.facts)).toContain("no readiness report");
  });
  test("a report without a tap's ready entry is unknown for that tap", async () => {
    const row = await judge(() => ({ ok: true, result: { not_ready: 0, tap_not_ready: [], complete_coverage: true, channel_stats: { subtitles: { ready: true } } } }));
    expect(row.verdict).not.toBe("PASS");
    expect(JSON.stringify(row.facts)).toContain("voice: no readiness reported");
  });
  test("a full report passes", async () => {
    const row = await judge(() => ({ ok: true, result: { not_ready: 0, tap_not_ready: [], complete_coverage: true, channel_stats: { subtitles: { ready: true }, voice: { ready: true } } } }));
    expect(row.verdict).toBe("PASS");
  });
});

describe("H4: a change claimed inside a burst is timed against its frames", () => {
  const runSt5 = async (burstStartOffsetMs: number) => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { encodePng } = await import("../capture/image.ts");
    const { stScript } = await import("../sessions/make-batches.ts");
    const { clock, fakeApi, fakeHost, go, script } = await fakes();
    const row = { ...(stScript(false, { panel: true, cpu: true }) as { rows: { id: string; steps: { do?: string; plate?: number[] }[] }[] }).rows.find((r) => r.id === "ST5-dark")!, requires: [] };
    const plate = row.steps.find((s) => s.do === "capture.surface")!.plate!;
    const dir = tempDir("xfb-r34-");
    mkdirSync(join(dir, "pics"), { recursive: true });
    const pic = join(dir, "pics", "plate.png");
    writeFileSync(pic, encodePng({ width: 8, height: 8, rgb: new Uint8Array(8 * 8 * 3).map((_, i) => plate[i % 3]) }));
    let paused = false, id = 0;
    const requests: { id: number; press: string; press_status: string }[] = [];
    const api = fakeApi(clock, {
      "overlay.state": () => ({ ok: true, result: { theme: "dark", motion: { setting: "full", effective: "full" }, cet_open: false, drawing_now: true } }),
      "bridge.info": () => ({ ok: true, result: { sid: "sid-1", status_surface: "xf_box", status: { chip: paused ? "Paused" : "Changes allowed" }, bridge: { writes_paused: paused }, cet_panel: { requests } } }),
      "cet.panel": (input) => { paused = input.press === "pause_changes"; requests.push({ id: ++id, press: input.press, press_status: "done" }); return { ok: true, result: { queued: true, id } }; },
      "capture.screenshot": () => ({ ok: true, result: { crop: { region: "pixels" }, full: { path: pic }, view: { path: pic } } }),
      "capture.burst": () => ({ ok: true, result: { started_at: new Date(Date.now() + burstStartOffsetMs).toISOString(), crop: { region: "pixels" }, timing: { first_to_last_ms: 2300 },
        frames: Array.from({ length: 24 }, (_, i) => ({ index: i + 1, at_ms: i * 100, record: { full: { path: pic } } })), contact_sheet: { path: pic }, manifest: pic } }),
    });
    return (await go(script([row] as never), api, fakeHost(), clock, dir)).rows[0];
  };
  test("both changes stamped between the first and last frame: CAPTURED", async () => {
    const row = await runSt5(-20);
    expect(row.verdict).toBe("CAPTURED");
  });
  test("a burst whose frames don't span the changes: PARTIAL, naming the check", async () => {
    const row = await runSt5(-60_000);
    expect(row.verdict).toBe("PARTIAL");
    expect(row.reason).toContain("both changes inside the burst");
  });
});

describe("H5: a running game is adopted only when its bridge is the staged candidate", () => {
  const adopt = async (live: Record<string, unknown>) => {
    const { writeFileSync } = await import("node:fs");
    const { clock, fakeApi, fakeHost, go, script, stagedMod } = await fakes();
    const dir = tempDir("xfb-r34-");
    const mod = stagedMod(dir);
    writeFileSync(join(mod, "red4ext", "plugins", "XFRuntimeBridge", "manifest.json"), JSON.stringify({ version: "0.8.22", variant: "writes", commit: "65b8da29".padEnd(40, "0"), source_tree_clean: true }));
    const api = fakeApi(clock, { "bridge.info": () => ({ ok: true, result: { sid: "sid-1", plugin_version: "0.8.22", build_dirty: false, bridge: { allow_writes: true, write_classes: ["photo", "world", "save"] }, ...live } }) });
    const host = fakeHost({ running: true });
    const rows = [{ id: "r", title: "r", steps: [{ label: "w", do: "wait", ms: 10 }] }];
    await go(script(rows as never), api, host, clock, dir, { fixtures: { staged_mod: mod, mo2: { exe: join(dir, "mo2", "ModOrganizer.exe"), profile: "p", executable: "e" } } });
    return host.log;
  };
  test("the previous build still running (a restage since): closed and the staged one launched", async () => {
    const log = await adopt({ build_commit: "6085d8e4".padEnd(40, "0") });
    expect(log.indexOf("close")).toBeGreaterThanOrEqual(0);
    expect(log.indexOf("launch")).toBeGreaterThan(log.indexOf("close"));
  });
  test("settings the game loaded that config.ini no longer says (allow_writes): restarted", async () => {
    const log = await adopt({ build_commit: "65b8da29".padEnd(40, "0"), bridge: { allow_writes: false, write_classes: ["photo", "world", "save"] } });
    expect(log).toContain("close");
  });
  test("the staged candidate running: adopted, no restart", async () => {
    const log = await adopt({ build_commit: "65b8da29".padEnd(40, "0") });
    expect(log).not.toContain("close");
    expect(log).not.toContain("launch");
  });
});
