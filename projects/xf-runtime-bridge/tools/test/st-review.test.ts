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
