import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { listRuns, readRun } from "../src/recording.ts";
import { snapshotAt, sessionAtLevel, trailUntil } from "../src/query.ts";
import { headingDeg, report } from "../src/report.ts";
import { createService } from "../src/service.ts";
import { districtAt } from "../src/world.ts";
import { emptySolids } from "../src/solid-source.ts";
import { writeFixture, type Fixture } from "./fixture.ts";

let fx: Fixture | undefined;
afterEach(() => { fx?.dispose(); fx = undefined; });

describe("recording adapter", () => {
  test("reads tracks and events with citations", () => {
    fx = writeFixture();
    const s = readRun(fx.dir);
    expect(s.v.length).toBe(50);
    expect(s.camera.length).toBe(50);
    expect(s.events.map(e => e.kind)).toEqual(["line", "supervisor.safe_position"]);
    expect(s.events[1].at).toEqual([20, 0, 10]);
    expect(s.events[0].cite).toMatch(/^recorder:abc123:1:\d+$/);
    expect(s.gaps).toEqual([]);
  });

  test("a sequence jump and a pause both become gaps, and the trail breaks there", () => {
    fx = writeFixture({ skipSeq: 41, pauseAt: 30 });
    const s = readRun(fx.dir);
    expect(s.gaps.map(g => g.reason).sort()).toEqual(["sequence", "time"]);
    expect(trailUntil(s, Infinity).length).toBe(3);
  });

  test("refuses rows from another session", () => {
    fx = writeFixture();
    writeFileSync(join(fx.dir, "chunk-1.jsonl"), JSON.stringify({ channel: "v", data: {}, run: 1, seq: 1, session: "other", source_s: 1, world_generation: 1 }) + "\n");
    expect(() => readRun(fx!.dir)).toThrow(/identity/);
  });

  test("lists runs under a root", () => {
    fx = writeFixture();
    expect(listRuns(fx.root).map(r => r.session)).toEqual(["abc123"]);
  });
});

describe("content levels fail closed", () => {
  test("structure never carries a line's words, full does", () => {
    fx = writeFixture();
    const s = readRun(fx.dir);
    const hidden = JSON.stringify(sessionAtLevel(s, "structure"));
    expect(hidden).not.toContain("A secret line");
    expect(hidden).not.toContain("Someone");
    expect(JSON.stringify(sessionAtLevel(s, "full"))).toContain("A secret line");
    expect(report(s, 1003, "structure")).not.toContain("A secret line");
  });
});

describe("snapshots", () => {
  test("evaluates V, staleness and recent events at a moment", () => {
    fx = writeFixture();
    const s = readRun(fx.dir);
    const snap = snapshotAt(s, 1002.05, "structure");
    expect(snap.v?.position[0]).toBe(20);
    expect(snap.v?.stale).toBe(false);
    expect(snap.placed.length).toBe(1);
    expect(snapshotAt(s, 1010, "structure").v?.stale).toBe(true);
  });

  test("compass heading from the game's yaw", () => {
    expect(headingDeg(0)).toBe(0);
    expect(headingDeg(90)).toBe(270);
    expect(headingDeg(173.7)).toBe(186);
  });
});

describe("world", () => {
  test("the smallest district holding the point wins", () => {
    const big = { id: "A", name: "Big", kind: "district" as const, poly: [[0, 0], [100, 0], [100, 100], [0, 100]] as [number, number][], zlo: 0, zhi: 100 };
    const small = { ...big, id: "B", name: "Small", poly: [[10, 10], [20, 10], [20, 20], [10, 20]] as [number, number][] };
    expect(districtAt([big, small], [15, 15, 5])?.name).toBe("Small");
    expect(districtAt([big, small], [50, 50, 5])?.name).toBe("Big");
    expect(districtAt([big, small], [50, 50, 500])).toBeUndefined();
  });
});

describe("service", () => {
  test("opens only runs inside its recordings folder", async () => {
    const f = fx = writeFixture();
    const { handlers } = createService({ recordingsRoot: f.root, worldPackPath: join(f.root, "missing.json"), solidSource: { around: async () => emptySolids() } });
    const signal = new AbortController().signal;
    expect((await handlers["session.open"]({ dir: f.dir }, signal) as any).meta.session).toBe("abc123");
    await expect(handlers["session.open"]({ dir: join(f.root, "elsewhere") }, signal)).rejects.toThrow(/recordings folder/);
    expect((await handlers["world.around"]({ dir: f.dir }, signal) as any).areas).toEqual([]);
  });

  test("a cancelled open rejects without publishing, and a later open still loads", async () => {
    const f = fx = writeFixture();
    const { handlers, sessions } = createService({ recordingsRoot: f.root, worldPackPath: join(f.root, "missing.json"), solidSource: { around: async () => emptySolids() } });
    const ctl = new AbortController(); ctl.abort();
    await expect(handlers["session.open"]({ dir: f.dir }, ctl.signal)).rejects.toThrow(/Cancelled/);
    expect((await handlers["session.open"]({ dir: f.dir }, new AbortController().signal) as any).v.length).toBe(50);
    expect(sessions.size).toBe(1);
  });
});

describe("damage and invalid samples are disclosed", () => {
  test("an invalid V sample splits the trail", () => {
    const f = fx = writeFixture({ invalidAt: 25 });
    expect(trailUntil(readRun(f.dir), Infinity).length).toBe(2);
  });
  test("a missing chunk makes the run incomplete and says so", () => {
    const f = fx = writeFixture({ missingChunk: true });
    const s = readRun(f.dir);
    expect(s.meta.complete).toBe(false);
    expect(s.meta.problems.join(" ")).toMatch(/missing/);
    expect(s.gaps.some(g => g.reason === "missing")).toBe(true);
  });
  test("an unfinished last row is disclosed, never parsed", () => {
    const f = fx = writeFixture({ unfinishedTail: true });
    const s = readRun(f.dir);
    expect(s.meta.problems.join(" ")).toMatch(/unfinished/);
    expect(s.v.length).toBe(50);
  });
});
