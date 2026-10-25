import { expect, test } from "bun:test";
import { catchUp } from "../testing/timeline.ts";
import { EventCaptures } from "../testing/event-captures.ts";
import type { TestApi, Json } from "../testing/windows.ts";
import { CommandApi } from "../api/command-api.ts";
import { findCommand } from "../api/catalogue.ts";
import { validate } from "../api/schema.ts";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers.ts";

function fixture() {
  const rows: Json[] = [100, 90, 80].map((health, i) => ({ seq: i + 1, run: 1, session: "s", world_generation: 2, valid: true, source_s: i, channel: "v",
    data: { position: [i * 12, 0, 0], vitals: { health, in_combat: i > 0 }, heat: { stage: i }, vehicle: { mounted: false }, busy: i ? "in_combat" : "" } }));
  rows.push({ seq: 4, run: 1, session: "s", world_generation: 2, valid: true, source_s: 4, channel: "face", data: { event: "face.bridge_submit", actor: "a1" } });
  let lost = 0;
  const events: Json[] = [{ seq: 1, kind: "npc.arrived", source_s: 9, data: { who: "a1" } }];
  const api: TestApi = { run: async (name, raw = {}) => {
    const input = raw as Json;
    const records = rows.filter(r => r.seq > (input.since ?? 0)).slice(0, 5);
    const result = name === "bridge.info" ? { sid: "s" } : name === "test.record.read" ? {
      run: 1, session: "s", world_generation: 2, active: true, latest: rows.length, next: records.at(-1)?.seq ?? input.since,
      lost, start_s: 0, end_s: null, source_now_s: 10, records,
    } : name === "session.events" ? { events: events.filter(e => e.seq > (input.since ?? 0)), next: events.length, latest: events.length, dropped: 0 } : { v: { busy: "" } };
    return { ok: true, command: name, cid: "test", result };
  } };
  return { api, rows, events, lose: () => { lost = 1; } };
}

test("catch-up reconciles supervisor recorder/session receipts and preserves refused interventions", async () => {
  const f = fixture();
  const violation = { event: "supervisor.violation", receipt_seq: 9, world_generation: 2, source_s: 5, generation: 3, incident: 1, violation: "no_contact", at_s: 5 };
  const action = { event: "supervisor.action", receipt_seq: 10, world_generation: 2, source_s: 5, generation: 3, entry_generation: 3, incident: 1, method: "player.teleport", response: { ok: false, error: { code: "in_combat" } } };
  // Several same-method actions in one withdrawal incident must all survive, even if their
  // results are identical; recorder/session copies of each are still reconciled once.
  for (const data of [violation, action, { ...action, receipt_seq: 11 }]) {
    f.rows.push({ ...f.rows[3], seq: f.rows.length + 1, channel: "supervisor", data });
    f.events.push({ seq: f.events.length + 1, kind: data.event, data });
  }
  // Recording can stop while the independent supervisor still records session receipts.
  f.events.push({ seq: f.events.length + 1, kind: "supervisor.contact", data: { receipt_seq: 12, world_generation: 2, source_s: 5, generation: 3, contact_seq: 1, receipt: { vehicle_hit_observed: true, other_entity: "car1" } } });
  f.events.push({ seq: f.events.length + 1, kind: "supervisor.cleared", data: { receipt_seq: 13, world_generation: 2, source_s: 5, generation: 4, reason: "player_input:MoveX" } });
  const page = await catchUp(f.api, { run: 1, detail: true });
  expect(page.supervisor_summary.counts).toEqual({ violations: 1, actions: 2, refused: 2, cancellations: 1 });
  expect(page.supervisor_summary.message).toContain("while you were away:");
  expect(page.supervisor_summary.receipts).toHaveLength(5);
  expect(page.contact_summary.observed_since_cursor).toBe(true);
  expect(page.contact_summary.vehicle_hit_observed_in_run).toBe(true);
  expect(page.contact_summary.no_contact_proof).toBe(false);
  const again = await catchUp(f.api, { cursor: page.cursor });
  expect(again.supervisor_summary.counts.actions).toBe(0);
});
test("catch-up summarizes path and transitions, keeps tap callbacks and session events", async () => {
  const f = fixture(), page = await catchUp(f.api, { run: 1 });
  expect(page.complete).toBe(true); expect(page.v.path).toEqual([[0, 0, 0], [12, 0, 0], [24, 0, 0]]); expect(page.v.distance_m).toBe(24);
  expect(page.v.health_min).toBe(80); expect(page.v.changes.combat).toBe(1);
  expect(page.channels.face[0].actor).toBe("a1"); expect(page.events[0].kind).toBe("npc.arrived");
  expect(page.alerts.filter((a: Json) => a.kind === "health_drop")).toHaveLength(2);
  expect(page.records).toBeUndefined(); expect(page.now.v).toBeDefined();
  f.rows.push({ ...f.rows[2], seq: 5, data: { ...f.rows[2]!.data, vitals: { health: 70, in_combat: false } } });
  const next = await catchUp(f.api, { cursor: page.cursor, detail: true });
  expect(next.records).toHaveLength(1); expect(next.events).toHaveLength(0);
  expect(next.alerts.some((a: Json) => a.kind === "health_drop" && a.from === 80)).toBe(true);
});
test("history loss and identity mismatches cannot pass coverage", async () => {
  const f = fixture(); f.lose();
  expect((await catchUp(f.api, { run: 1 })).complete).toBe(false);
  await expect(catchUp(f.api, { cursor: { schema: "xfb/timeline-cursor-1", sid: "old", run: 1, world: 2, record: 0, event: 0 } })).rejects.toThrow("session changed");
});
test("compact channel/event tails disclose omitted rows; detail retains them", async () => {
  const f = fixture();
  for (let i = 5; i < 40; i++) f.rows.push({ ...f.rows[3], seq: i });
  const small = await catchUp(f.api, { run: 1 }), full = await catchUp(f.api, { run: 1, detail: true });
  expect(small.channels.face).toHaveLength(24); expect(small.omitted.face).toBe(12);
  expect(full.channels.face).toHaveLength(36); expect(full.records).toHaveLength(39);
});
test("an armed capture matches future events, waits from source time and records latency bounds", async () => {
  let now = 1000; const calls: string[] = [];
  const api: TestApi = { run: async (name) => {
    calls.push(name);
    return { ok: true, command: name, cid: "test", result: name === "game.catchup" ? { cursor: {}, complete: true, gaps: [], source: { active: true },
      calibration: { source_s: 10, host_before_ms: 990, host_after_ms: 1000 }, records: [
        { valid: true, seq: 4, channel: "ui", source_s: 10, data: { event: "toast.created", style: "message" } }], events: [] } : { path: "private.png" } };
  } };
  const arms = new EventCaptures(api, { now: () => now, sleep: async ms => { now += ms; } });
  await arms.arm({ run: 1, event: "toast.created", match: { style: "message" }, capture: "screenshot", delay_ms: 50 }, fixture().api);
  await arms.poll();
  expect(calls).toEqual(["game.catchup", "game.catchup", "capture.screenshot"]); // the second looks again, just before the capture
  expect(now).toBe(1050); expect(arms.status().armed).toBe(false);
  expect(arms.status().receipts[0].event_to_capture_ms).toEqual({ min: 50, max: 60 });
  arms.cancel();
});
test("expiry, disarm and lost coverage prevent captures", async () => {
  for (const mode of ["expired", "cancelled", "gap"]) {
    let now = 0, captures = 0;
    const api: TestApi = { run: async name => { if (name.startsWith("capture.")) captures++; return { ok: true, command: name, cid: "test", result: { complete: false, gaps: ["lost"], cursor: {} } }; } };
    const arms = new EventCaptures(api, { now: () => now, sleep: async ms => { now += ms; } });
    await arms.arm({ run: 1, event: "npc.arrived", capture: "screenshot", expires_s: 1 }, fixture().api);
    if (mode === "expired") now = 1001;
    if (mode === "cancelled") arms.cancel();
    await arms.poll(); expect(captures).toBe(0); expect(arms.status().armed).toBe(false); arms.cancel();
  }
});
test("guard schemas reject executable data and capture arguments validate before arming", async () => {
  const command = findCommand("vehicle.set")!;
  expect(validate(command.input, { when: { combat: false, spawned: [7] } }).some(x => x.includes("when"))).toBe(false);
  expect(validate(command.input, { when: { eval: "code" } }).join()).toContain("not a known option");
  const api = new CommandApi();
  const bad = await api.run("capture.arm", { run: 1, event: "toast.created", capture: "recrop", args: {} });
  expect(bad.ok).toBe(false); if (!bad.ok) expect(bad.error.code).toBe("bad_input");
  api.close();
});
test("mapped native actions retain when, and queued captures refuse after their deadline", async () => {
  const dir = tempDir("xfb-timeline-api-");
  writeFileSync(join(dir, "session.json"), JSON.stringify({ protocol: 1, sid: "test", pid: process.pid, pipe: "fixture", token: "t", started_at: new Date().toISOString(), plugin_version: "test", allow_writes: true }));
  const calls: Json[] = [];
  const api = new CommandApi({ runtimeDir: dir, auditDir: dir, transport: async () => ({ call: async (method, params) => {
    calls.push({ method, params }); return { v: 1, id: 1, cid: "t", ok: true, result: {} };
  }, close: () => {} }) });
  const when = { phase: "gameplay", vehicle: false, combat: false, spawned: [7] };
  const action = await api.run("vehicle.set", { target: "spawn:7", engine: true, when });
  expect(action.ok).toBe(true); expect(calls.at(-1)?.params.when).toEqual(when);
  const local = await api.run("photo.camera.place", { look_at: [0, 0, 1], distance_m: 2, when: { photo_mode: true } });
  expect(local.ok).toBe(true); expect(calls.at(-1)?.params.when).toEqual({ photo_mode: true });
  const expired = await api.run("capture.screenshot", {}, { deadlineMs: performance.now() - 1 });
  expect(expired.ok).toBe(false); if (!expired.ok) expect(expired.error.code).toBe("interrupted");
  expect(calls).toHaveLength(2); api.close();
});
test("catch-up recovers the native writer's history beyond the ring and tolerates its partial tail", async () => {
  const f = fixture(), output = join(tempDir("xfb-timeline-replay-"), "s", "run-1");
  mkdirSync(output, { recursive: true });
  const rows = Array.from({ length: 1100 }, (_, i) => ({ ...f.rows[3], seq: i + 1 }));
  const path = join(output, "chunk-1.jsonl");
  writeFileSync(path, rows.map(row => JSON.stringify(row) + "\n").join(""));
  const api: TestApi = { run: async (name, raw = {}) => {
    if (name !== "test.record.read") return f.api.run(name, raw);
    const input = raw as Json, retained = rows.slice(-5).filter(row => row.seq > input.since);
    return { ok: true, command: name, cid: "test", result: { run: 1, session: "s", world_generation: 2, output, active: true, source_now_s: 12,
      latest: rows.length, records: retained, next: retained.at(-1)?.seq ?? input.since, lost: Math.max(0, rows.length - 5 - input.since) } };
  } };
  const first = await catchUp(api, { run: 1, detail: true });
  expect(first.more).toBe(true); expect(first.records).toHaveLength(1024); expect(first.cursor.record).toBe(1024);
  expect(first.records[0].age_s).toBe(8);
  const second = await catchUp(api, { cursor: first.cursor, detail: true });
  expect(second.complete).toBe(true); expect(second.records).toHaveLength(76);
  const row = { ...rows[0], seq: 1101 }; rows.push(row);
  appendFileSync(path, JSON.stringify(row)); // Writer has not flushed its newline yet; ring supplies this tail.
  const third = await catchUp(api, { cursor: second.cursor, detail: true });
  expect(third.complete).toBe(true); expect(third.records).toHaveLength(1);
  appendFileSync(path, "\n");
  const fourth = await catchUp(api, { cursor: third.cursor, detail: true });
  expect(fourth.complete).toBe(true); expect(fourth.records).toHaveLength(0);
});
test("source ownership survives thinking and local wait releases until stop/duration", async () => {
  const dir = tempDir("xfb-timeline-owner-");
  writeFileSync(join(dir, "session.json"), JSON.stringify({ protocol: 1, sid: "test", pid: process.pid, pipe: "fixture", token: "t", started_at: new Date().toISOString(), plugin_version: "test", allow_writes: true }));
  let closes = 0;
  const api = new CommandApi({ runtimeDir: dir, idleCloseMs: 10, transport: async () => ({ call: async () => ({ v: 1, id: 1, cid: "t", ok: true, result: { run: 1 } }), close: () => { closes++; } }) });
  await api.run("test.record.start", { duration_s: 1 });
  api.release(); await Bun.sleep(40); expect(closes).toBe(0);
  await api.callBridge("test.record.read", { run: 1 }, "t");
  await Bun.sleep(40); expect(closes).toBe(0);
  api.close(); expect(closes).toBe(1);
});
test("disarm overtakes a busy command instead of allowing an earlier queued trigger to capture", async () => {
  const dir = tempDir("xfb-timeline-disarm-");
  writeFileSync(join(dir, "session.json"), JSON.stringify({ protocol: 1, sid: "test", pid: process.pid, pipe: "fixture", token: "t", started_at: new Date().toISOString(), plugin_version: "test", allow_writes: true }));
  let release!: () => void;
  const api = new CommandApi({ runtimeDir: dir, auditDir: dir, transport: async () => ({ call: async () => {
    await new Promise<void>(resolve => { release = resolve; });
    return { v: 1, id: 1, cid: "t", ok: true, result: {} };
  }, close: () => {} }) });
  await api.eventCaptures.arm({ run: 1, event: "npc.arrived", capture: "screenshot" }, fixture().api);
  const busy = api.run("vehicle.set", { target: "spawn:7", engine: true });
  await Bun.sleep(10);
  const cancelled = await Promise.race([api.run("capture.disarm"), Bun.sleep(100).then(() => null)]);
  expect(cancelled?.ok).toBe(true); expect(api.eventCaptures.status().armed).toBe(false);
  release(); await busy; api.close();
});

test("0.8.19: catch-up names the supervised actor on every receipt and counts per actor", async () => {
  const f = fixture();
  const base = { world_generation: 2, source_s: 5, generation: 3 };
  const a2 = { kind: "npc", ref: "a2" }, a3 = { kind: "npc", ref: "a3" };
  const receipts = [
    { event: "supervisor.violation", receipt_seq: 21, incident: 1, violation: "not_lost", actor: a2, ...base },
    { event: "supervisor.action", receipt_seq: 22, incident: 1, method: "npc.release", actor: a2, response: { ok: true }, ...base },
    { event: "supervisor.violation", receipt_seq: 23, incident: 2, violation: "alive", actor: a3, ...base },
    { event: "supervisor.action", receipt_seq: 24, incident: 2, method: "npc.place", actor: a3, response: { ok: false, error: { code: "too_far" } }, ...base },
    { event: "supervisor.cleared", receipt_seq: 25, actor: a3, reason: "actor_lost", ...base },
  ];
  for (const data of receipts) f.events.push({ seq: f.events.length + 1, kind: data.event, data });
  const page = await catchUp(f.api, { run: 1, detail: true });
  expect(page.supervisor_summary.by_actor).toEqual({
    "npc:a2": { violations: 1, actions: 1, refused: 0, cancellations: 0 },
    "npc:a3": { violations: 1, actions: 1, refused: 1, cancellations: 1 },
  });
  expect(page.supervisor_summary.counts).toEqual({ violations: 2, actions: 2, refused: 1, cancellations: 1 });
  expect(page.supervisor_summary.receipts.every((r: Json) => r.actor.kind === "npc")).toBe(true);
});
