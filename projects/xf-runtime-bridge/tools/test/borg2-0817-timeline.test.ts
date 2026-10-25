// Borg 2 regressions (0.8.17) in the timeline: stale catch-up "latest", event-armed captures cancelled by
// historical gaps, interval-scoped coverage gaps and the false heat alert.
import { expect, test } from "bun:test";
import { catchUp } from "../testing/timeline.ts";
import { EventCaptures } from "../testing/event-captures.ts";
import type { Json, TestApi } from "../testing/windows.ts";

const vRow = (i: number): Json => ({ position: [i, 0, 0], vitals: { health: 100, in_combat: false }, heat: { stage: 0 }, vehicle: { mounted: false }, busy: "" });

// A recorder fixture: v rows every 0.1 s, with optional invalid rows at the start and loss counters.
function recorder(options: { rows?: number; invalidFirst?: number; sourceNow?: number } = {}) {
  const rows: Json[] = [];
  const add = (channel: string, valid: boolean, data: Json = {}) => {
    const seq = rows.length + 1;
    rows.push({ seq, run: 1, session: "s", world_generation: 2, valid, source_s: seq / 10, channel, data });
  };
  for (let i = 0; i < (options.invalidFirst ?? 0); i++) add("v", false, { reason: "not_v" });
  for (let i = 0; i < (options.rows ?? 0); i++) add("v", true, vRow(i));
  const state = { dropped: 0, invalid: options.invalidFirst ?? 0, missed: 0, now: options.sourceNow ?? rows.length / 10, events: [] as Json[], digestV: { place: "live" } as Json | undefined };
  const api: TestApi = { run: async (name, raw = {}) => {
    const input = raw as Json;
    let result: Json;
    if (name === "bridge.info") result = { sid: "s" };
    else if (name === "test.record.read") {
      const records = rows.filter(r => r.seq > (input.since ?? 0)).slice(0, 5);
      result = { run: 1, session: "s", world_generation: 2, active: true, latest: rows.length, next: records.at(-1)?.seq ?? input.since, lost: 0,
        dropped: state.dropped, invalid: state.invalid, missed_deadlines: state.missed, start_s: 0, end_s: null, source_now_s: state.now, records };
    } else if (name === "session.events") result = { events: state.events.filter(e => e.seq > (input.since ?? 0)), next: state.events.length, latest: state.events.length, dropped: 0 };
    else result = { v: state.digestV };
    return { ok: true, command: name, cid: "test", result };
  } };
  return { api, rows, add, state };
}
// The tools' game.catchup command shape, over a fixture.
const catchupApi = (f: ReturnType<typeof recorder>, calls: string[] = []): TestApi => ({ run: async (name, input = {}) => {
  calls.push(name);
  if (name === "game.catchup") {
    const i = input as Json;
    return { ok: true, command: name, cid: "t", result: await catchUp(f.api, { cursor: i.cursor, detail: i.detail, digest: i.now, archive: i.replay_files }) };
  }
  return { ok: true, command: name, cid: "t", result: { path: "private.png" } };
} });
// The fake clock shares performance.now()'s domain: catch-up calibrates source events against host time.
const clock = () => { const c = { t: performance.now(), now: () => c.t, sleep: async (ms: number) => { c.t += ms; } }; return c; };

test("2. a catch-up page that is behind real time still shows the newest V and says how far behind it is", async () => {
  const f = recorder({ rows: 3000, sourceNow: 400 });
  f.state.digestV = { place: "the crosswalk now" };
  const page = await catchUp(f.api, { run: 1 });
  expect(page.more).toBe(true);
  expect(page.backlog.behind).toBe(true);
  expect(page.backlog.records_behind).toBeGreaterThan(2000);
  expect(page.backlog.seconds_behind).toBeGreaterThan(300);
  expect(page.v.current).toEqual({ source: "digest", sample: { place: "the crosswalk now" } });
  expect(page.v.latest_stale).toBe(true);
  expect(page.v.latest.position[0]).toBeLessThan(600); // the old page, kept for paging
  expect(page.summary).toContain("Behind real time");
  // Paging semantics are unchanged: the cursor moves on and the next call continues.
  const next = await catchUp(f.api, { cursor: page.cursor });
  expect(next.cursor.record).toBeGreaterThan(page.cursor.record);
  // Without the digest the newest recorder sample read is offered, marked stale while behind.
  const bare = await catchUp(f.api, { run: 1, digest: false });
  expect(bare.v.current.source).toBe("recorder");
  expect(bare.v.current.stale).toBe(true);
  // Caught up: nothing behind, nothing stale.
  const caught = recorder({ rows: 20, sourceNow: 2.1 });
  const done = await catchUp(caught.api, { run: 1 });
  expect(done.more).toBe(false);
  expect(done.backlog).toEqual({ behind: false, records_behind: 0, events_behind: 0, seconds_behind: 0 });
  expect(done.v.latest_stale).toBe(false);
  expect(done.summary).toBe("Caught up with the recorder.");
});

test("3. an armed capture survives invalid samples and counters from before it was armed", async () => {
  const f = recorder({ rows: 30, invalidFirst: 35, sourceNow: 7 });
  const calls: string[] = [], c = clock();
  const arms = new EventCaptures(catchupApi(f, calls), c);
  await arms.arm({ run: 1, event: "dm.quest", match: { quest: "tl3" }, capture: "screenshot" }, f.api);
  await arms.poll();
  expect(arms.status().armed).toBe(true); // 35 early invalid samples are history
  // The event arrives after the arm; the capture fires instead of the arm having been cancelled.
  f.state.events.push({ seq: 1, kind: "dm.quest", source_s: 7, data: { quest: "tl3" } });
  await arms.poll();
  expect(calls).toContain("capture.screenshot");
  expect(arms.status().receipts.at(-1).status).toBe("captured");
  arms.cancel();
});

test("3. an armed capture is still cancelled by loss or invalid event data after the arm", async () => {
  for (const mode of ["dropped", "missed", "invalid_event_channel"]) {
    const f = recorder({ rows: 30, invalidFirst: 5, sourceNow: 4 });
    const arms = new EventCaptures(catchupApi(f), clock());
    await arms.arm({ run: 1, event: "toast.created", capture: "screenshot" }, f.api);
    await arms.poll(); expect(arms.status().armed, mode).toBe(true);
    if (mode === "dropped") f.state.dropped = 2;
    if (mode === "missed") f.state.missed = 1;
    if (mode === "invalid_event_channel") { f.add("ui", false, { error: "sample_failed" }); f.state.invalid++; }
    await arms.poll();
    expect(arms.status().armed, mode).toBe(false);
    expect(String(arms.status().receipts.at(-1).status), mode).toContain("Timeline coverage gap");
  }
  // Invalid polled-state samples after the arm cannot hide a named event and do not cancel it.
  const f = recorder({ rows: 30, sourceNow: 4 });
  const arms = new EventCaptures(catchupApi(f), clock());
  await arms.arm({ run: 1, event: "toast.created", capture: "screenshot" }, f.api);
  f.add("v", false, { reason: "not_v" }); f.state.invalid++;
  await arms.poll();
  expect(arms.status().armed).toBe(true);
  arms.cancel();
});

test("3. catch-up gaps describe the queried interval, not the whole run forever", async () => {
  const f = recorder({ rows: 20, invalidFirst: 35, sourceNow: 6 });
  const first = await catchUp(f.api, { run: 1, digest: false });
  expect(first.gaps).toContain("invalid_source");
  expect(first.gaps).toContain("source_coverage_incomplete");
  expect(first.complete).toBe(false);
  for (let i = 0; i < 10; i++) f.add("v", true, vRow(i));
  const second = await catchUp(f.api, { cursor: first.cursor, digest: false });
  expect(second.gaps).toEqual([]);
  expect(second.complete).toBe(true);
  // Loss in a later interval is still reported once, then cleared again.
  f.state.dropped = 3; f.add("v", true, vRow(0));
  const third = await catchUp(f.api, { cursor: second.cursor, digest: false });
  expect(third.gaps).toContain("source_coverage_incomplete");
  const fourth = await catchUp(f.api, { cursor: third.cursor, digest: false });
  expect(fourth.gaps).toEqual([]);
});

test("5. a cursor without a heat baseline establishes it instead of alerting a change", async () => {
  const f = recorder({ rows: 4, sourceNow: 1 });
  const cursor = { schema: "xfb/timeline-cursor-1" as const, sid: "s", run: 1, world: 2, record: 0, event: 0,
    last_v: { position: [0, 0, 0], vitals: { health: 100, in_combat: false }, vehicle: { mounted: false }, busy: "" } };
  const page = await catchUp(f.api, { cursor, digest: false });
  expect(page.alerts.filter((a: Json) => a.kind === "heat_changed")).toEqual([]);
  expect(page.v.changes.heat).toBe(0);
  expect(page.cursor.last_v.heat).toBe(JSON.stringify({ stage: 0 }));
  // With a baseline a real change still alerts.
  f.add("v", true, { ...vRow(5), heat: { stage: 2 } });
  const next = await catchUp(f.api, { cursor: page.cursor, digest: false });
  expect(next.alerts.filter((a: Json) => a.kind === "heat_changed")).toHaveLength(1);
});
