// The ST review packet's findings (scripted session 1, local/sessions/scripted-1/st-review-packet): rows marked PASS
// whose captures didn't show their named state, bursts at the wrong spacing, and plugin logs lost to restarts.
// Fake bridges and hosts; nothing reaches a game.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tempDir } from "./helpers.ts";

describe("bursts keep their spacing", () => {
  test("a burst step's interval_ms reaches capture.burst (it was taken as the plan's polling interval and dropped)", async () => {
    const { FakeClock } = await import("./fake-clock.ts");
    const { fakeApi, fakeHost, go, script } = await import("./batch-fakes.ts");
    const clock = new FakeClock();
    const api = fakeApi(clock);
    const rows = [{ id: "r", title: "r", steps: [
      { label: "b", do: "burst", name: "pulse", frames: 12, interval_ms: 200, clear_overlay: false, rect: { x: 0, y: 0, width: 8, height: 8 } },
      { label: "polled", do: "run", command: "game.status", input: {}, until: { path: "phase", equals: "gameplay" }, interval_ms: 250, deadline_ms: 2000 },
    ] }];
    await go(script(rows as never), api, fakeHost(), clock, tempDir("xfb-str-"));
    expect(api.calls.find((c) => c.name === "capture.burst")!.input.interval_ms).toBe(200);
    // Beside until it is still the polling interval, never sent to the command.
    expect(api.calls.filter((c) => c.name === "game.status").every((c) => c.input.interval_ms === undefined)).toBe(true);
  });

  test("the plan core: interval_ms is the action's own without until", async () => {
    const { actionOf } = await import("../testing/plan.ts");
    expect(actionOf({ do: "burst", interval_ms: 240 } as never)).toEqual({ do: "burst", interval_ms: 240 });
    expect(actionOf({ do: "run", until: { ok: true }, interval_ms: 240 } as never)).toEqual({ do: "run" });
  });
});

describe("a state check that isn't met says what was there", () => {
  test("verifying Paused against a bridge showing Changes allowed fails the row with the chip it saw", async () => {
    const { FakeClock } = await import("./fake-clock.ts");
    const { fakeApi, fakeHost, go, script } = await import("./batch-fakes.ts");
    const clock = new FakeClock();
    const api = fakeApi(clock, { "bridge.info": () => ({ ok: true, result: { sid: "sid-1", status: { chip: "Changes allowed", tone: "write" }, bridge: { writes_paused: false } } }) });
    const rows = [{ id: "r", title: "r", steps: [
      { label: "r-is-paused", do: "run", command: "bridge.info", input: {}, until: { all: [{ path: "status.chip", equals: "Paused" }, { path: "bridge.writes_paused", equals: true }] }, interval_ms: 250, deadline_ms: 2000, on_fail: "fail_row" },
      { label: "shot", do: "capture", name: "paused", clear_overlay: false },
    ] }];
    const row = (await go(script(rows as never), api, fakeHost(), clock, tempDir("xfb-str-"))).rows[0];
    expect(row.verdict).toBe("FAIL");
    expect(row.reason).toContain('status.chip "Changes allowed"');
    expect(row.reason).toContain("bridge.writes_paused false");
    expect(api.calls.some((c) => c.name === "capture.screenshot")).toBe(false);
  });

  test("a refusal is named (a stopped bridge answers killed)", async () => {
    const { observed } = await import("../testing/plan.ts");
    expect(observed({ path: "status.chip", equals: "Stopped" }, { ok: false, code: "killed", message: "bridge stopped by kill switch" })).toContain("refused killed");
  });
});

describe("a row judged by the UI review is never PASS on a capture's existence", () => {
  test("its checks holding make it CAPTURED, awaiting the review; a row without judged_by stays PASS", async () => {
    const { FakeClock } = await import("./fake-clock.ts");
    const { fakeApi, fakeHost, go, script } = await import("./batch-fakes.ts");
    const clock = new FakeClock();
    const shot = (id: string, judged?: string) => ({ id, title: id, ...(judged ? { judged_by: judged } : {}), steps: [{ label: "s", do: "capture", name: id, clear_overlay: false, bind: `${id}_shot` }],
      pass: [{ label: "captured", ref: `$${id}_shot`, captured: true }] });
    const dir = tempDir("xfb-str-");
    const result = await go(script([shot("judged", "XF · Studio's UI review"), shot("plain")] as never), fakeApi(clock), fakeHost(), clock, dir);
    expect(result.rows.map((r) => r.verdict)).toEqual(["CAPTURED", "PASS"]);
    expect(result.rows[0].reason).toContain("awaiting XF · Studio's UI review");
    expect(result.ok).toBe(true);
    const { readFileSync } = await import("node:fs");
    const manifest = JSON.parse(readFileSync(join(dir, "out", "manifest.json"), "utf8"));
    expect(manifest.run.counts.CAPTURED).toBe(1);
    expect(readFileSync(join(dir, "out", "report.md"), "utf8")).toContain("CAPTURED (awaiting review) 1");
  });
  test("verdictOf: a judged row that fails stays FAIL", async () => {
    const { verdictOf } = await import("../testing/batch.ts");
    const close = { status: "done", outcome: "completed" } as never;
    expect(verdictOf(close, [{ label: "x", result: "fail" } as never], new Set(), "review").verdict).toBe("FAIL");
    expect(verdictOf(close, [{ label: "x", result: "pass" } as never], new Set(), "review").verdict).toBe("CAPTURED");
  });
});

describe("the surface is in frame (capture.surface)", () => {
  const DARK = { plate: [27, 30, 35] as [number, number, number], text: [236, 239, 242] as [number, number, number] };
  // A 40 x 20 picture: the plate over its left half with a line of text, or a noisy scene.
  const picture = (withPlate: boolean, seed = 1) => {
    const rgb = new Uint8Array(40 * 20 * 3);
    let x = seed;
    for (let i = 0; i < 40 * 20; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      const px = i % 40, py = Math.floor(i / 40);
      const colour = withPlate && px < 20 ? (py === 10 && px > 2 && px < 17 ? DARK.text : DARK.plate) : [x % 200, (x >> 8) % 200, (x >> 16) % 200];
      rgb.set(colour, i * 3);
    }
    return { width: 40, height: 20, rgb };
  };
  test("surfaceStats: a plate is present, a scene isn't", async () => {
    const { surfaceStats } = await import("../testing/batch.ts");
    expect(surfaceStats(picture(true), DARK).present).toBe(true);
    expect(surfaceStats(picture(false), DARK).present).toBe(false);
  });

  test("a burst whose first frames show no surface fails with the frames it lacks; a probe waits for the surface", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { encodePng } = await import("../capture/image.ts");
    const { FakeClock } = await import("./fake-clock.ts");
    const { fakeApi, fakeHost, go, script } = await import("./batch-fakes.ts");
    const dir = tempDir("xfb-str-");
    mkdirSync(join(dir, "pics"), { recursive: true });
    const file = (name: string, plate: boolean) => { const path = join(dir, "pics", `${name}.png`); writeFileSync(path, encodePng(picture(plate, name.length))); return path; };
    const clock = new FakeClock();
    let probes = 0;
    const api = fakeApi(clock, {
      "capture.burst": () => ({ ok: true, result: { crop: { region: "rect" }, frames: [false, false, true, true].map((p, i) => ({ index: i, record: { full: { path: file(`f${i}`, p) } } })), contact_sheet: { path: file("sheet", true) }, manifest: file("m", true) } }),
      // The surface shows from the third probe on.
      "capture.screenshot": () => ({ ok: true, result: { crop: { region: "rect" }, full: { path: file(`probe${++probes}`, probes >= 3) }, view: { path: file("v", true) } } }),
    });
    const rows = [{ id: "r", title: "r", steps: [
      { label: "r-visible", do: "capture.surface", name: "r-probe", rect: { x: 0, y: 0, width: 40, height: 20 }, ...DARK, until: { ok: true }, interval_ms: 250, deadline_ms: 3000, on_fail: "fail_row" },
      { label: "r-burst", do: "burst", name: "pulse", frames: 4, interval_ms: 200, clear_overlay: false, rect: { x: 0, y: 0, width: 40, height: 20 }, bind: "b" },
      { label: "r-in-frame", do: "capture.surface", capture: "$b", ...DARK, on_fail: "fail_row" },
    ] }];
    const row = (await go(script(rows as never), api, fakeHost(), clock, dir)).rows[0];
    expect(probes).toBe(3);
    expect(row.verdict).toBe("FAIL");
    expect(row.reason).toContain("in frames 1, 2 of 4");
  });
});

describe("plugin logs survive restarts", () => {
  test("every log written during the attempt is copied before each launch and at the end, the first even after it is deleted", async () => {
    const { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } = await import("node:fs");
    const { FakeClock } = await import("./fake-clock.ts");
    const { fakeApi, fakeHost, go, script } = await import("./batch-fakes.ts");
    const dir = tempDir("xfb-str-");
    const logs = join(dir, "red4ext-logs");
    mkdirSync(logs, { recursive: true });
    const first = join(logs, "xfruntimebridge-2026-10-26-12-12-00.log");
    writeFileSync(first, "overlay.fonts weights_asked=title=600,eyebrow=600 drawn=400\n");
    writeFileSync(join(logs, "unrelated.log"), "not ours\n");
    const clock = new FakeClock();
    // The launch starts a new log and rotates the old one away, as a restart does.
    const host = fakeHost({ running: false, onLaunch: () => { rmSync(first); writeFileSync(join(logs, "xfruntimebridge-2026-10-26-12-25-00.log"), "second session\n"); } });
    const rows = [{ id: "r", title: "r", steps: [{ label: "launch", do: "host.launch" }, { label: "more", do: "wait", ms: 10 }] }];
    const result = await go(script(rows as never), fakeApi(clock), host, clock, dir, { fixtures: { logs: { plugin_dir: logs }, mo2: { exe: join(dir, "mo2", "ModOrganizer.exe"), profile: "p", executable: "e" } } });
    const kept = join(dir, "out", "logs", "a1");
    expect(readFileSync(join(kept, "xfruntimebridge-2026-10-26-12-12-00.log"), "utf8")).toContain("overlay.fonts");
    expect(existsSync(join(kept, "xfruntimebridge-2026-10-26-12-25-00.log"))).toBe(true);
    expect(existsSync(join(kept, "unrelated.log"))).toBe(false);
    const resume = JSON.parse(readFileSync(result.resumePath, "utf8"));
    expect(resume.plugin_logs.length).toBe(2);
  });
});

describe("the ST batch shows its named states", () => {
  type Step = Record<string, unknown> & { label?: string; do?: string; together?: Step[]; sequence?: Step[] };
  const flat = (steps: Step[] = []): Step[] => steps.flatMap((s) => [s, ...flat(s.together), ...flat(s.sequence)]);
  const build = async (hooks: { panel: boolean; cpu: boolean }, rerun = false) => {
    const { stScript } = await import("../sessions/make-batches.ts");
    return stScript(rerun, hooks) as { rows: { id: string; judged_by?: string; steps: Step[]; cleanup?: Step[] }[] };
  };

  test("with the hooks, every judged row verifies its state before each capture, finds its surface after, and probes before each burst", async () => {
    for (const hooks of [{ panel: true, cpu: true }, { panel: false, cpu: false }]) {
      const script = await build(hooks);
      for (const row of script.rows.filter((r) => r.judged_by)) {
        const steps = flat(row.steps);
        const shots = steps.filter((s) => (s.do === "capture" || s.do === "burst") && !/cet-before|cet-check/.test(String(s.name)));
        expect(shots.length).toBeGreaterThan(0);
        const first = steps.indexOf(shots[0]);
        expect(steps.slice(0, first).some((s) => String(s.label).includes("-is-"))).toBe(true);
        // The ink panel isn't a themed plate: ST11 checks its state only.
        if (row.id.startsWith("ST11")) continue;
        for (const shot of shots) {
          const bind = String(shot.bind);
          expect(steps.some((s) => s.do === "capture.surface" && s.capture === `$${bind}`)).toBe(true);
          if (shot.do === "burst") expect(steps.slice(0, steps.indexOf(shot)).some((s) => s.do === "capture.surface" && s.name !== undefined)).toBe(true);
        }
      }
    }
  });

  test("Paused is the CET window's own Pause changes, never a handover; Diagnostics opens through cet.panel", async () => {
    const script = await build({ panel: true, cpu: true });
    const text = JSON.stringify(script.rows);
    expect(text).not.toContain("session.handover");
    for (const id of ["ST6-dark-paused", "ST8-light-paused", "ST5-dark", "ST3-light-settle"]) {
      const row = script.rows.find((r) => r.id === id)!;
      expect(flat(row.steps).some((s) => s.command === "cet.panel" && (s.input as { press?: string }).press === "pause_changes")).toBe(true);
      // However it ends, changes are resumed.
      expect(flat(row.cleanup).some((s) => s.command === "cet.panel" && (s.input as { press?: string }).press === "resume_changes")).toBe(true);
    }
    const diag = script.rows.find((r) => r.id === "ST7-light-diagnostics")!;
    expect(flat(diag.steps).some((s) => String(s.label).endsWith("-is-open"))).toBe(true);
  });

  test("the re-run: only the rows the packet sent back, planned clean now; with the hooks every one, short only of the hooks themselves", async () => {
    const { planBatch } = await import("../testing/batch.ts");
    const { RERUN } = await import("../sessions/make-batches.ts");
    const now = await build({ panel: false, cpu: false }, true);
    expect(now.rows.every((r) => RERUN.includes(r.id))).toBe(true);
    expect(now.rows.map((r) => r.id)).toEqual(expect.arrayContaining(["ST2-light", "ST3-dark", "ST4-light-changes", "ST8-dark-connected", "ST8-dark-auto", "ST13-dark"]));
    expect(planBatch(now as never).problems).toEqual([]);
    const later = await build({ panel: true, cpu: true }, true);
    expect(later.rows.map((r) => r.id).sort()).toEqual([...RERUN].sort());
    expect(planBatch(later as never).problems.filter((p) => !/no command "cet.panel"|diagnostics_cpu_ms: unknown field/.test(p))).toEqual([]);
    // No read-only row: the re-run needs no restart.
    expect(JSON.stringify(later.rows)).not.toContain('"bridge.allow_writes","equals":"false"');
  });

  test("the generated files are current", async () => {
    const { readFileSync } = await import("node:fs");
    const { stScript } = await import("../sessions/make-batches.ts");
    const dir = join(import.meta.dir, "..", "sessions");
    expect(JSON.parse(readFileSync(join(dir, "st-rerun.json"), "utf8"))).toEqual(JSON.parse(JSON.stringify(stScript(true))));
    expect(JSON.parse(readFileSync(join(dir, "st-styling.json"), "utf8"))).toEqual(JSON.parse(JSON.stringify(stScript(false))));
  });
});

describe("not_ready samples (bridge 0.8.22) are counted apart, never invalid", () => {
  test("the telemetry summary keeps the recorder's not_ready counts by channel, and B318-1 passes over them", async () => {
    const { FakeClock } = await import("./fake-clock.ts");
    const { fakeApi, fakeHost, go, script } = await import("./batch-fakes.ts");
    const { readFileSync } = await import("node:fs");
    const clock = new FakeClock();
    const status = { not_ready: 3, tap_not_ready: [], complete_coverage: true, channel_stats: { subtitles: { attempts: 9, not_ready: 2, ready: true }, voice: { attempts: 9, not_ready: 1, ready: true }, v: { attempts: 9 } } };
    const api = fakeApi(clock, { "test.record.read": () => ({ ok: true, result: status }), "test.record.stop": () => ({ ok: true, result: status }) });
    const smoke = JSON.parse(readFileSync(join(import.meta.dir, "..", "sessions", "borg4-smoke.json"), "utf8"));
    const b318 = smoke.rows.find((r: { id: string }) => r.id === "B318-1");
    const rows = [{ id: "plain", title: "plain", steps: [{ label: "w", do: "wait", ms: 10 }] }, b318];
    const result = await go(script(rows as never), api, fakeHost(), clock, tempDir("xfb-str-"));
    const row = result.rows.find((r) => r.id === "B318-1")!;
    expect(row.verdict).toBe("PASS");
    const fact = row.facts!.find((f) => f.label.startsWith("not ready"))!.value as { total: number; by_channel: Record<string, number> };
    expect(fact.total).toBe(3);
    expect(fact.by_channel).toEqual({ subtitles: 2, voice: 1 });
  });

  test("B318-1 fails when another channel reports not_ready", async () => {
    const { readFileSync } = await import("node:fs");
    const { matches } = await import("../testing/plan.ts");
    const smoke = JSON.parse(readFileSync(join(import.meta.dir, "..", "sessions", "borg4-smoke.json"), "utf8"));
    const check = smoke.rows.find((r: { id: string }) => r.id === "B318-1").pass.find((c: { label: string }) => c.label.startsWith("not_ready only"));
    expect(matches(check.match, { ok: true, value: { subtitles: 4, voice: 2 } })).toBe(true);
    expect(matches(check.match, { ok: true, value: { face: 1 } })).toBe(false);
  });
});

describe("cet.panel's press refusals, anticipated", () => {
  const run = async (press: (input: Record<string, unknown>) => { ok: boolean; code?: string; result?: unknown }) => {
    const { stScript } = await import("../sessions/make-batches.ts");
    const { FakeClock } = await import("./fake-clock.ts");
    const { fakeApi, fakeHost, go, script } = await import("./batch-fakes.ts");
    // Its config and CET binding requirements are the prelude's (other tests): here the row's own steps.
    const row = { ...(stScript(false, { panel: true, cpu: true }) as { rows: { id: string }[] }).rows.find((r) => r.id === "ST6-dark-paused")!, requires: [] };
    const clock = new FakeClock();
    const api = fakeApi(clock, {
      "overlay.state": () => ({ ok: true, result: { theme: "dark", motion: { setting: "full", effective: "full" }, cet_open: true } }),
      "bridge.info": () => ({ ok: true, result: { sid: "sid-1", status: { chip: "Paused" }, bridge: { writes_paused: true }, cet_panel: { chip: "Paused" } } }),
      "cet.panel": (input) => press(input) as never,
    });
    const result = await go(script([row] as never), api, fakeHost(), clock, tempDir("xfb-str-"), { fixtures: { cet_overlay_key: "Ctrl+Grave" } });
    return { row: result.rows[0], api, result };
  };
  test("no test hooks: the row fails saying to stage the autonomous package", async () => {
    const { row } = await run(() => ({ ok: false, code: "test_hooks_off" }));
    expect(row.verdict).toBe("FAIL");
    expect(row.reason).toContain("test hook");
  });
  test("the player paused: the cleanup's Resume is refused, the runner leaves it paused without a cleanup failure", async () => {
    const { api, result } = await run((input) => input.press === "resume_changes" ? { ok: false, code: "paused_by_player" } : { ok: true, result: { request: { id: 1 } } });
    expect(api.calls.filter((c) => c.name === "cet.panel").map((c) => c.input.press)).toEqual(["pause_changes", "resume_changes"]);
    expect(result.cleanupErrors).toEqual([]);
    // The refusal took the anticipated branch, and nothing then waited for a resume that can't come.
    const reports = JSON.stringify(result.rows[0].reports);
    expect(reports).toContain("paused_by_player");
    expect(result.rows[0].reports.some((r) => (r as { label?: string; kind?: string }).label === "ST6-dark-paused-resumed" && (r as { kind?: string }).kind === "attempt")).toBe(false);
    expect(result.rows[0].reports.some((r) => (r as { label?: string; status?: string }).label === "ST6-dark-paused-resumed" && (r as { status?: string }).status === "skipped")).toBe(true);
  });
});

describe("bridge 65b8da29: cet.panel requests and tap readiness", () => {
  const pausedRow = async (requests: unknown[]) => {
    const { stScript } = await import("../sessions/make-batches.ts");
    const { FakeClock } = await import("./fake-clock.ts");
    const { fakeApi, fakeHost, go, script } = await import("./batch-fakes.ts");
    const row = { ...(stScript(false, { panel: true, cpu: true }) as { rows: { id: string }[] }).rows.find((r) => r.id === "ST8-light-paused")!, requires: [] };
    const clock = new FakeClock();
    const api = fakeApi(clock, {
      "overlay.state": () => ({ ok: true, result: { theme: "light", motion: { setting: "full", effective: "full" }, cet_open: false } }),
      "bridge.info": () => ({ ok: true, result: { sid: "sid-1", status_surface: "cet_line", status: { chip: "Changes allowed" }, bridge: { writes_paused: false }, cet_panel: { requests, pending: 0, reported: true } } }),
      "cet.panel": () => ({ ok: true, result: { queued: true, id: 7, request: { id: 7, press: "pause_changes" } } }),
    });
    return (await go(script([row] as never), api, fakeHost(), clock, tempDir("xfb-str-"))).rows[0];
  };
  test("a press refused when it ran fails the row naming its press_status, before any state check", async () => {
    const row = await pausedRow([{ id: 7, press: "pause_changes", press_status: "refused", why: "paused_by_player" }]);
    expect(row.verdict).toBe("FAIL");
    expect(row.reason).toContain("ST8-light-paused-pause-done");
    expect(row.reason).toContain('"press_status":"refused"');
  });
  test("a press done goes on to the state check, which names what the bridge shows", async () => {
    const row = await pausedRow([{ id: 7, press: "pause_changes", press_status: "done", paused_before: false }]);
    expect(row.verdict).toBe("FAIL");
    expect(row.reason).toContain("ST8-light-paused-is-paused");
    expect(row.reason).toContain('status.chip "Changes allowed"');
  });
  test("the Diagnostics row waits for its request applied and undoes exactly that request", async () => {
    const { stScript } = await import("../sessions/make-batches.ts");
    const row = (stScript(false, { panel: true, cpu: true }) as { rows: { id: string; steps: Record<string, unknown>[]; cleanup: Record<string, unknown>[] }[] }).rows.find((r) => r.id === "ST7-dark-diagnostics")!;
    expect(JSON.stringify(row.steps.find((s) => s.label === "ST7-dark-diagnostics-is-open"))).toContain('"header","equals":"applied"');
    expect(row.cleanup[0].input).toEqual({ undo: "$ST7_dark_diagnostics_open_req.id" });
  });
  test("B318-1 fails when a run's tap never became ready, and names it", async () => {
    const { FakeClock } = await import("./fake-clock.ts");
    const { fakeApi, fakeHost, go, script } = await import("./batch-fakes.ts");
    const { readFileSync } = await import("node:fs");
    const smoke = JSON.parse(readFileSync(join(import.meta.dir, "..", "sessions", "borg4-smoke.json"), "utf8"));
    const b318 = smoke.rows.find((r: { id: string }) => r.id === "B318-1");
    const judge = async (tapNotReady: string[]) => {
      const clock = new FakeClock();
      const status = { not_ready: 0, tap_not_ready: tapNotReady, complete_coverage: !tapNotReady.length, channel_stats: { subtitles: { ready: true }, voice: { ready: !tapNotReady.includes("voice") } } };
      const api = fakeApi(clock, { "test.record.read": () => ({ ok: true, result: status }), "test.record.stop": () => ({ ok: true, result: status }) });
      return (await go(script([{ id: "plain", title: "plain", steps: [{ label: "w", do: "wait", ms: 10 }] }, b318] as never), api, fakeHost(), clock, tempDir("xfb-str-"))).rows.find((r) => r.id === "B318-1")!;
    };
    expect((await judge([])).verdict).toBe("PASS");
    const failed = await judge(["voice"]);
    expect(failed.verdict).not.toBe("PASS");
    expect(JSON.stringify(failed.facts)).toContain("run 1: voice");
  });
});
