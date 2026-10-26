// Borg 4 (26 Oct) fixes in 0.8.22's tools: TL3's event-armed captures and the recorder's deadlines, the catch-up's supervisor
// summary across calls, and the commit tripwire's handover reason. Offline: fixtures for the recorder and the session feed.
import { expect, test } from "bun:test";
import { catchUp } from "../testing/timeline.ts";
import { EventCaptures } from "../testing/event-captures.ts";
import { offSwitch, tripReason } from "../commit-tripwire.ts";
import { TIMELINE_COMMANDS } from "../api/catalogueTimeline.ts";
import { validate } from "../api/schema.ts";
import type { Json, TestApi } from "../testing/windows.ts";

const vRow = (i: number): Json => ({ position: [i, 0, 0], vitals: { health: 100, in_combat: false }, heat: { stage: 0 }, vehicle: { mounted: false }, busy: "" });

function recorder(options: { rows?: number; sourceNow?: number } = {}) {
  const rows: Json[] = [];
  const add = (channel: string, valid: boolean, data: Json = {}) => {
    const seq = rows.length + 1;
    rows.push({ seq, run: 1, session: "s", world_generation: 2, valid, source_s: seq / 10, channel, data });
  };
  for (let i = 0; i < (options.rows ?? 0); i++) add("v", true, vRow(i));
  const state = { dropped: 0, invalid: 0, missed: 0, eventsDropped: 0, events: [] as Json[], now: options.sourceNow ?? rows.length / 10, latestExtra: 0 };
  const api: TestApi = { run: async (name, raw = {}) => {
    const input = raw as Json;
    let result: Json;
    if (name === "bridge.info") result = { sid: "s" };
    else if (name === "test.record.read") {
      const records = rows.filter(r => r.seq > (input.since ?? 0)).slice(0, 5);
      result = { run: 1, session: "s", world_generation: 2, active: true, latest: rows.length, next: records.at(-1)?.seq ?? input.since, lost: 0, file_error: "",
        dropped: state.dropped, invalid: state.invalid, missed_deadlines: state.missed, start_s: 0, end_s: null, source_now_s: state.now, records };
    } else if (name === "session.events") {
      const events = state.events.filter(e => e.seq > (input.since ?? 0));
      result = { events, next: state.events.length, latest: state.events.length, dropped: state.eventsDropped };
    } else result = { v: { place: "live" } };
    return { ok: true, command: name, cid: "test", result };
  } };
  return { api, rows, add, state };
}
const catchupApi = (f: ReturnType<typeof recorder>, calls: string[] = []): TestApi => ({ run: async (name, input = {}) => {
  calls.push(name);
  if (name === "game.catchup") {
    const i = input as Json;
    return { ok: true, command: name, cid: "t", result: await catchUp(f.api, { cursor: i.cursor, detail: i.detail, digest: i.now, archive: i.replay_files }) };
  }
  return { ok: true, command: name, cid: "t", result: { path: "private.png" } };
} });
const clock = () => { const c = { t: performance.now(), now: () => c.t, sleep: async (ms: number) => { c.t += ms; } }; return c; };
const lastStatus = (arms: EventCaptures) => String(arms.status().receipts.at(-1)?.status);

test("TL3: an arm on a session event survives the recorder's missed deadlines, drops and invalid samples, fires, and says what the recorder lost", async () => {
  const f = recorder({ rows: 30, sourceNow: 7 });
  const calls: string[] = [];
  const arms = new EventCaptures(catchupApi(f, calls), clock());
  const armed = await arms.arm({ run: 1, event: "dm.quest", match: { quest: "tl3" }, capture: "screenshot" }, f.api);
  expect(armed.trigger).toContain("session feed");
  // Borg 4: memory pressure after arming (25 missed deadlines, 2 drops), and an invalid UI sample.
  f.state.missed = 25; f.state.dropped = 2; f.add("ui", false, { error: "sample_failed" }); f.state.invalid++;
  await arms.poll();
  expect(arms.status().armed).toBe(true);
  f.state.events.push({ seq: 1, kind: "dm.quest", source_s: 7, data: { quest: "tl3" } });
  await arms.poll();
  expect(calls).toContain("capture.screenshot");
  const receipt = arms.status().receipts.at(-1);
  expect(receipt.status).toBe("captured");
  expect(receipt.recorder_loss_while_armed).toEqual({ dropped: 2, invalid: 1, missed_deadlines: 25, file_error: false });
});

test("TL3: a session-feed arm is cancelled by loss on the session feed, with the reason", async () => {
  const f = recorder({ rows: 10, sourceNow: 2 });
  const arms = new EventCaptures(catchupApi(f), clock());
  await arms.arm({ run: 1, event: "dm.quest", capture: "screenshot" }, f.api);
  f.state.eventsDropped = 3;
  await arms.poll();
  expect(arms.status().armed).toBe(false);
  expect(lastStatus(arms)).toContain("session_history_lost: session events were dropped before they were read");
});

test("TL3: a session-feed arm is not 'behind real time' because the recorder has a backlog", async () => {
  const f = recorder({ rows: 30, sourceNow: 4 });
  const arms = new EventCaptures(catchupApi(f), clock());
  await arms.arm({ run: 1, event: "dm.quest", capture: "screenshot" }, f.api);
  for (let i = 0; i < 600; i++) f.add("v", true, vRow(i)); // more than one catch-up reads in a call
  await arms.poll();
  expect(arms.status().armed).toBe(true);
  arms.cancel();
});

test("TL3: an arm on a tap channel is cancelled by dropped rows, never by missed deadlines; the reason names the channel and the count", async () => {
  const f = recorder({ rows: 20, sourceNow: 3 });
  const arms = new EventCaptures(catchupApi(f), clock());
  const armed = await arms.arm({ run: 1, event: "line.widget_created", channel: "subtitles", capture: "screenshot" }, f.api);
  expect(armed.trigger).toContain("recorder channel subtitles");
  f.state.missed = 40;
  await arms.poll();
  expect(arms.status().armed).toBe(true);
  f.state.dropped = 2;
  await arms.poll();
  expect(arms.status().armed).toBe(false);
  expect(lastStatus(arms)).toContain("2 recorder row(s) dropped since arming, channel not known (the trigger's recorder channel subtitles)");
  expect(lastStatus(arms)).not.toContain("deadline");
});

test("TL3: an arm on a polled channel is cancelled by a missed deadline, and invalid samples elsewhere leave it alone", async () => {
  const f = recorder({ rows: 20, sourceNow: 3 });
  const arms = new EventCaptures(catchupApi(f), clock());
  await arms.arm({ run: 1, event: "ui.consumer", channel: "ui", capture: "screenshot" }, f.api);
  f.add("face", false, { error: "sample_failed" }); f.state.invalid++;
  await arms.poll();
  expect(arms.status().armed).toBe(true);
  f.state.missed = 1;
  await arms.poll();
  expect(arms.status().armed).toBe(false);
  expect(lastStatus(arms)).toContain("1 sample deadline(s) missed on polled the trigger's recorder channel ui");
});

// The supervisor intervening, as Borg 4's session feed had it: a violation, the supervisor's world.pause (a write with its
// micro-action cid), the entry cleared, then the action receipt naming that cid.
const receipt = (seq: number, event: string, extra: Json) => ({ schema: "xfb/supervisor-event-1", actor: { kind: "player", ref: "V" }, world_generation: 2,
  receipt_seq: seq, source_s: 1 + seq / 100, generation: 1, ...extra });
function intervention(f: ReturnType<typeof recorder>) {
  f.state.events.push(
    { seq: 1, kind: "supervisor.violation", source_s: 1.03, data: receipt(3, "supervisor.violation", { violation: "not_in_combat", policy: "pause_world" }) },
    { seq: 2, kind: "write", source_s: 1.04, data: { cid: "m1-1", code: "ok", method: "world.pause", ms: 39 } },
    { seq: 3, kind: "supervisor.cleared", source_s: 1.04, data: receipt(4, "supervisor.cleared", { reason: "world_paused" }) },
    { seq: 4, kind: "supervisor.action", source_s: 1.05, data: receipt(5, "supervisor.action", { action: "pause_world", method: "world.pause",
      response: { cid: "m1-1", id: "m1-1", ok: true, result: { frozen: true } } }) },
    { seq: 5, kind: "write", source_s: 1.06, data: { cid: "cli-1", code: "ok", method: "npc.spawn", ms: 3 } },
  );
}

test("catch-up: the supervisor's receipts and its own write are counted and listed, and the run so far travels in the cursor", async () => {
  const f = recorder({ rows: 10, sourceNow: 2 });
  intervention(f);
  const first = await catchUp(f.api, { run: 1, digest: false });
  const s = first.supervisor_summary;
  expect(s.counts).toEqual({ violations: 1, actions: 1, refused: 0, cancellations: 1 });
  expect(s.writes).toEqual([{ seq: 2, kind: "write", method: "world.pause", code: "ok", cid: "m1-1", source_s: 1.04 }]);
  expect(s.run_totals).toEqual({ violations: 1, actions: 1, refused: 0, cancellations: 1, writes: 1 });
  expect(s.message).toBe("while you were away: 3 new supervisor receipts (1 violation, 1 action, 1 clearing, 1 write); this run so far: 1 violation, 1 action, 1 clearing, 1 write");
  expect(s.recent.map((r: Json) => r.detail)).toEqual(["violation not_in_combat, policy pause_world", "cleared: world_paused", "action pause_world: world.pause ok (cid m1-1)"]);
  // The same receipts come on the recorder's supervisor channel after the session feed was read (Borg 4's catch-up after
  // the one that reported them): nothing new, but the summary says they were reported, and the run so far.
  for (const [seq, event] of [[3, "supervisor.violation"], [4, "supervisor.cleared"], [5, "supervisor.action"]] as const) f.add("supervisor", true, receipt(seq, event, { event }));
  for (let i = 0; i < 3; i++) f.add("v", true, vRow(i));
  const second = await catchUp(f.api, { cursor: first.cursor, digest: false });
  const t = second.supervisor_summary;
  expect(t.counts).toEqual({ violations: 0, actions: 0, refused: 0, cancellations: 0 });
  expect(t.already_reported).toBe(3);
  expect(t.run_totals).toEqual(s.run_totals);
  expect(t.recent).toEqual(s.recent);
  expect(t.message).toBe("while you were away: no new supervisor receipts (3 receipts on these feeds already reported by an earlier catch-up); this run so far: 1 violation, 1 action, 1 clearing, 1 write");
  // A later call with nothing at all on either feed still carries the run so far.
  const third = await catchUp(f.api, { cursor: second.cursor, digest: false });
  expect(third.supervisor_summary.message).toBe("while you were away: no supervisor receipts observed; this run so far: 1 violation, 1 action, 1 clearing, 1 write");
  // The returned cursor is what game_catchup's schema takes back, and a forged total is refused.
  const schema = TIMELINE_COMMANDS.find(c => c.name === "game.catchup")!.input;
  expect(validate(schema, { cursor: third.cursor })).toEqual([]);
  await expect(catchUp(f.api, { cursor: { ...third.cursor, supervisor_totals: { violations: -1 } } as any, digest: false })).rejects.toThrow("Invalid supervisor totals cursor");
  // A run without any supervision keeps the old plain message.
  const quiet = recorder({ rows: 5, sourceNow: 1 });
  expect((await catchUp(quiet.api, { run: 1, digest: false })).supervisor_summary.message).toBe("while you were away: no supervisor receipts observed");
});

test("catch-up: the latest receipts kept in the cursor are bounded", async () => {
  const f = recorder({ rows: 4, sourceNow: 1 });
  for (let i = 0; i < 12; i++) f.state.events.push({ seq: i + 1, kind: "supervisor.violation", source_s: 1, data: receipt(10 + i, "supervisor.violation", { violation: "v" + i, policy: "warn" }) });
  const page = await catchUp(f.api, { run: 1, digest: false });
  expect(page.cursor.supervisor_recent).toHaveLength(8);
  expect(page.cursor.supervisor_recent.at(-1).receipt_seq).toBe(21);
  expect(page.supervisor_summary.run_totals.violations).toBe(12);
});

test("the commit tripwire's handover carries why, so the refusals and the session event say it", () => {
  expect(tripReason(3.44, 4)).toBe("handed over by the commit tripwire (free commit 3.4 GB under 4 GB)");
  expect(offSwitch("session.handover {}", 3.44, 4)).toEqual({ command: "session.handover", input: JSON.stringify({ note: "handed over by the commit tripwire (free commit 3.4 GB under 4 GB)" }) });
  expect(offSwitch("session.handover", 3.44, 4).input).toContain("commit tripwire");
  expect(offSwitch('session.handover {"lights":"clear"}', 2, 4)).toEqual({ command: "session.handover", input: JSON.stringify({ lights: "clear", note: "handed over by the commit tripwire (free commit 2.0 GB under 4 GB)" }) });
  expect(offSwitch('session.handover {"note":"mine"}', 2, 4).input).toBe(JSON.stringify({ note: "mine" }));
  expect(offSwitch('test.events {"stims":false}', 2, 4)).toEqual({ command: "test.events", input: '{"stims":false}' });
  expect(() => offSwitch("session.handover [1]", 2, 4)).toThrow("JSON object");
});

// Review of 3365edc2..83431583 (Sol): four findings, each reproduced here first.

test("review 1: a supervisor write and its action in different catch-ups are linked once, in either order", async () => {
  const action = (seq: number, cid: string) => ({ seq, kind: "supervisor.action", source_s: 1.05, data: receipt(seq + 10, "supervisor.action", { action: "pause_world", method: "world.pause",
    response: { cid, id: cid, ok: true } }) });
  const write = (seq: number, cid: string) => ({ seq, kind: "write", source_s: 1.04, data: { cid, code: "ok", method: "world.pause", ms: 39 } });
  // The write first; its action arrives in the next call.
  const f = recorder({ rows: 4, sourceNow: 1 });
  f.state.events.push(write(1, "m1-1"));
  const first = await catchUp(f.api, { run: 1, digest: false });
  expect(first.supervisor_summary.writes).toEqual([]);
  f.state.events.push(action(2, "m1-1"));
  const second = await catchUp(f.api, { cursor: first.cursor, digest: false });
  expect(second.supervisor_summary.writes.map((w: Json) => w.cid)).toEqual(["m1-1"]);
  expect(second.supervisor_summary.run_totals.writes).toBe(1);
  const third = await catchUp(f.api, { cursor: second.cursor, digest: false });
  expect(third.supervisor_summary.run_totals.writes).toBe(1);
  expect(third.supervisor_summary.writes).toEqual([]);
  // The action first; its write arrives in the next call.
  const g = recorder({ rows: 4, sourceNow: 1 });
  g.state.events.push(action(1, "m2-1"));
  const a = await catchUp(g.api, { run: 1, digest: false });
  expect(a.supervisor_summary.run_totals.writes).toBe(0);
  g.state.events.push(write(2, "m2-1"), write(3, "cli-9"));
  const b = await catchUp(g.api, { cursor: a.cursor, digest: false });
  expect(b.supervisor_summary.writes.map((w: Json) => w.cid)).toEqual(["m2-1"]);
  expect(b.supervisor_summary.run_totals.writes).toBe(1);
  // The cursor stays what game_catchup takes back, and its unmatched lists stay bounded.
  const schema = TIMELINE_COMMANDS.find(c => c.name === "game.catchup")!.input;
  expect(validate(schema, { cursor: b.cursor })).toEqual([]);
  for (let i = 0; i < 40; i++) g.state.events.push(write(4 + i, `cli-${i}`));
  const c = await catchUp(g.api, { cursor: b.cursor, digest: false });
  expect(c.cursor.supervisor_unmatched_writes.length).toBeLessThanOrEqual(16);
  expect(validate(schema, { cursor: c.cursor })).toEqual([]);
});

test("review 2: a cursor from before run totals is read as incomplete totals, never as a complete zero", async () => {
  const f = recorder({ rows: 8, sourceNow: 1 });
  // The shape of Borg 4's saved cursor (catchup-last.json): supervisor_seen, but no supervisor_totals or supervisor_recent.
  const old = { schema: "xfb/timeline-cursor-1" as const, sid: "s", run: 1, world: 2, record: 8, event: 0, file_chunk: 1, file_offset: 0,
    supervisor_seen: [1, 2, 3, 4, 5], supervisor_retired_through: 0, contact_observed: false, vehicle_hit_observed: false,
    last_v: { position: [7, 0, 0], vitals: { health: 100, in_combat: false }, heat: JSON.stringify({ stage: 0 }), vehicle: { mounted: false }, busy: "" },
    source_counters: { dropped: 0, invalid: 0, missed_deadlines: 0, file_error: false }, last_v_seq: 8, last_v_source_s: 0.8 };
  const page = await catchUp(f.api, { cursor: old, digest: false });
  expect(page.supervisor_summary.run_totals_complete).toBe(false);
  expect(page.supervisor_summary.history_complete).toBe(false);
  expect(page.supervisor_summary.message).toContain("incomplete");
  // It stays incomplete on every later call with that cursor's descendants, and a fresh cursor is complete.
  const next = await catchUp(f.api, { cursor: page.cursor, digest: false });
  expect(next.supervisor_summary.run_totals_complete).toBe(false);
  const schema = TIMELINE_COMMANDS.find(c => c.name === "game.catchup")!.input;
  expect(validate(schema, { cursor: next.cursor })).toEqual([]);
  const fresh = await catchUp(f.api, { run: 1, digest: false });
  expect(fresh.supervisor_summary.run_totals_complete).toBe(true);
});

test("review 3: a lost witness report cancels an arm on an incident event, and leaves other session arms alone", async () => {
  for (const arm of [{ event: "witness.report" }, { event: "witness.report", channel: "incidents" }, { event: "incident.declared" }]) {
    const f = recorder({ rows: 10, sourceNow: 2 });
    const arms = new EventCaptures(catchupApi(f), clock());
    await arms.arm({ run: 1, ...arm, capture: "screenshot" }, f.api);
    f.state.events.push({ seq: 1, kind: "witness.gap", source_s: 2, data: { event: "witness.gap", incident: 7 } });
    await arms.poll();
    expect(arms.status().armed, arm.event).toBe(false);
    expect(lastStatus(arms), arm.event).toContain("incident_report_gap");
  }
  const f = recorder({ rows: 10, sourceNow: 2 });
  const arms = new EventCaptures(catchupApi(f), clock());
  await arms.arm({ run: 1, event: "dm.quest", capture: "screenshot" }, f.api);
  f.state.events.push({ seq: 1, kind: "witness.gap", source_s: 2, data: { event: "witness.gap", incident: 7 } });
  await arms.poll();
  expect(arms.status().armed).toBe(true);
  arms.cancel();
});

test("review 4: recorder loss found by the recheck after the delay is in the capture's receipt", async () => {
  const f = recorder({ rows: 30, sourceNow: 7 });
  const calls: string[] = [], c = clock();
  const arms = new EventCaptures(catchupApi(f, calls), { now: c.now, sleep: async ms => { c.t += ms; f.state.dropped = 2; } });
  await arms.arm({ run: 1, event: "dm.quest", capture: "screenshot", delay_ms: 400 }, f.api);
  f.state.events.push({ seq: 1, kind: "dm.quest", source_s: 7, data: { quest: "tl3" } });
  await arms.poll();
  expect(calls).toContain("capture.screenshot");
  expect(arms.status().receipts.at(-1).recorder_loss_while_armed).toEqual({ dropped: 2, invalid: 0, missed_deadlines: 0, file_error: false });
});
