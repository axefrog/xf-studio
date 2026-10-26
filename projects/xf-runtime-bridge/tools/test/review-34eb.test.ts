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
