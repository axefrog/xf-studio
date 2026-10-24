// Asset-free replays only. No host, native binary, desktop input or live game connection.
import { describe, expect, test } from "bun:test";
import { readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandApi, CommandOutcome } from "../api/command-api.ts";
import { planScript, runScript, SCRIPT_SCHEMA, SCRIPT_SCHEMA_2, type SessionScript } from "../session.ts";
import { evaluateAssertion, facingTimeline, resolveBindings, select, type AssertionSpec } from "../testing/assertions.ts";
import { TestSession } from "../testing/script.ts";
import { captureCursor, drainEvents, observeActor, observeEvents, observeValues, readLogs, waitForEvent,
  type ActorWindow, type Clock, type Json, type SessionEvent, type TestApi } from "../testing/windows.ts";
import { tempDir } from "./temp-dir.ts";

const candidate = { plugin_version: "0.8.11", build_commit: "8".repeat(40), natives: 27, write_classes: ["npc", "inventory"] };
const info = () => ({ sid: "fixture-session", plugin_version: candidate.plugin_version, build_commit: candidate.build_commit, build_dirty: false,
  bridge: { allow_writes: true, write_classes: [...candidate.write_classes] } });
const cursor = () => ({ schema: "xfb/event-cursor-1" as const, sid: "fixture-session", after: 0, dropped: 0, complete: true, missing: [] });
const predicate = (check: string, input: Json) => evaluateAssertion({ do: "assert", check, label: check, ...input } as AssertionSpec);
const script = (steps: SessionScript["steps"], extra: Partial<SessionScript> = {}): SessionScript => ({ schema: SCRIPT_SCHEMA_2, name: "replay", steps, ...extra });
const fixturePath = join(import.meta.dir, "../testing/fixtures/actor-release.json");
const fixture = (): SessionScript => JSON.parse(readFileSync(fixturePath, "utf8"));

class Replay {
  ms = 0;
  sid = "fixture-session";
  events: SessionEvent[] = [];
  latest = 0;
  calls: { name: string; input: Json; at: number }[] = [];
  onCall?: (name: string, input: Json) => unknown;
  onSleep?: () => void;
  time: Clock = { now: () => this.ms, sleep: async (ms, signal) => { if (!signal?.aborted) this.ms += ms; this.onSleep?.(); } };
  event(kind: string, data: Json = {}) {
    this.events.push({ seq: ++this.latest, kind, t_ms: this.ms, data });
  }
  run: TestApi["run"] = async (name, inputValue = {}, options) => {
    const input = inputValue as Json;
    this.calls.push({ name, input, at: this.ms });
    if (options?.signal?.aborted) return { ok: false, command: name, cid: "fake", error: { code: "aborted", message: "aborted" } };
    const custom = this.onCall?.(name, input);
    let result: unknown;
    if (custom !== undefined) result = await custom;
    else if (name === "bridge.info") result = { ...info(), sid: this.sid };
    else if (name === "game.status") result = { phase: "gameplay" };
    else if (name === "session.events") {
      const since = input.since ?? 0, oldest = this.events[0]?.seq ?? this.latest + 1;
      const events = this.events.filter((e) => e.seq > since).slice(0, input.limit ?? 100);
      result = { events, latest: this.latest, next: events.at(-1)?.seq ?? since, dropped: Math.max(0, oldest - since - 1) };
    } else if (name === "session.wait") { await this.time.sleep(400, options?.signal); result = { events: [], timed_out: true }; }
    else if (name === "npc.status") result = { npcs: [] };
    else if (name === "game.saves") result = { ready: true, names: ["manual-fixture"], metadata: [] };
    else result = {};
    return { ok: true, command: name, cid: "fake", result };
  };
  api(): CommandApi { return { run: this.run, close() {} } as unknown as CommandApi; }
}

function walk(backwards = false): ActorWindow {
  const samples = [
    { t_ms: 0, request_ms: 0, actor: { who: "a41", position: [0, 2, 0], yaw: 180 } },
    { t_ms: 250, request_ms: 0, actor: { who: "a41", position: [0, 2, 0], yaw: 90 } },
    { t_ms: 500, request_ms: 0, actor: { who: "a41", position: [0, 2, 0], yaw: 0 } },
    ...Array.from({ length: 12 }, (_, i) => ({ t_ms: 750 + i * 250, request_ms: 0,
      actor: { who: "a41", position: [0, 2.5 + i * 0.5, 0], yaw: backwards && i >= 2 ? 180 : 0, motion: { kind: "walk_away" } } })),
    { t_ms: 3750, request_ms: 0, actor: null },
  ];
  return { cursor: cursor(), events: [{ seq: 1, kind: "npc.released", t_ms: 3750, data: { who: "a41", how: "walk_away" } }],
    subject: "a41", action: "npc.release", result: { who: "a41", how: "walk_away", to: [0, 9.5, 0], turns_first: true },
    started_ms: 0, ended_ms: 3750, samples, complete: true, aborted: false, timed_out: false, missing: [],
    sampling: { requested_hz: 4, achieved_hz: 4, changed_transform_hz: 3.7, source_max_hz: 4, source_timestamps: false, max_gap_ms: 250 } };
}

describe("typed, factual predicates", () => {
  test("equals and restored compare plain data independent of property order", () => {
    expect(predicate("equals", { actual: { a: 1, b: [2] }, expected: { b: [2], a: 1 } }).verdict).toBe("PASS");
    expect(predicate("restored", { actual: [1], baseline: [2] }).verdict).toBe("FAIL");
    expect(predicate("equals", { actual: undefined, expected: undefined }).verdict).toBe("INCONCLUSIVE");
  });
  test("range checks boundaries and refuses non-numeric evidence", () => {
    expect(predicate("range", { actual: 2, min: 1, max: 2 }).verdict).toBe("PASS");
    expect(predicate("range", { actual: 3, min: 1, max: 2 }).verdict).toBe("FAIL");
    expect(predicate("range", { actual: "2", min: 1, max: 2 }).verdict).toBe("INCONCLUSIVE");
  });
  test("rectangle checks use measured bounds and reject missing geometry", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(predicate("rects_disjoint", { rects: [a, { ...a, x: 10 }] }).verdict).toBe("PASS");
    expect(predicate("rects_disjoint", { rects: [a, { ...a, x: 9 }] }).verdict).toBe("FAIL");
    expect(predicate("rects_disjoint", { rects: [a, {}] }).verdict).toBe("INCONCLUSIVE");
  });
  test("eventually and stable_for use sampled values, real duration and gap budgets", () => {
    const window = { started_ms: 0, ended_ms: 1000, complete: true, aborted: false, missing: [], samples: [0, 250, 500, 750, 1000].map((t_ms) => ({ t_ms, value: { ready: true } })) };
    expect(predicate("eventually", { window, path: "ready", expected: true }).verdict).toBe("PASS");
    expect(predicate("stable_for", { window, path: "ready", expected: true, duration_s: 1 }).verdict).toBe("PASS");
    expect(predicate("stable_for", { window: { ...window, samples: [window.samples[0], window.samples[4]] }, path: "ready", expected: true, duration_s: 1, max_gap_ms: 250 }).verdict).toBe("INCONCLUSIVE");
    expect(predicate("stable_for", { window: { ...window, complete: false }, path: "ready", expected: true, duration_s: 1 }).verdict).toBe("INCONCLUSIVE");
    expect(predicate("eventually", { window, path: "absent", expected: false }).verdict).toBe("INCONCLUSIVE");
  });
  test("sequence, no_event and no_loss distinguish matched identities and lost history", () => {
    const window = { ...walk(), events: [{ seq: 1, kind: "npc.spawned", t_ms: 0, data: { who: "a41" } }, { seq: 2, kind: "npc.arrived", t_ms: 1000, data: { who: "a41" } }] };
    expect(predicate("sequence", { window, events: [{ kind: "npc.spawned", subject: "a41" }, { kind: "npc.arrived", subject: "a41" }] }).verdict).toBe("PASS");
    expect(predicate("sequence", { window, events: [{ kind: "npc.arrived", subject: "a99" }] }).verdict).toBe("FAIL");
    expect(predicate("no_event", { window, kind: "npc.move_failed", subject: "a41" }).verdict).toBe("PASS");
    expect(predicate("no_event", { window: { ...window, complete: false }, kind: "npc.move_failed" }).verdict).toBe("INCONCLUSIVE");
    expect(predicate("no_event", { window, kind: "npc.arrived", subject: "a41" }).verdict).toBe("FAIL");
    expect(predicate("no_loss", { window: { ...window, cursor: { ...cursor(), complete: false, dropped: 2 } } }).verdict).toBe("INCONCLUSIVE");
  });
  test("unknown predicates and fields never run an expression", () => {
    expect(predicate("eval", { expression: "process.exit()" }).verdict).toBe("INCONCLUSIVE");
    expect(predicate("equals", { actual: 1, expected: 1, expression: "true" }).verdict).toBe("INCONCLUSIVE");
    expect(select({}, "constructor.constructor")).toBeUndefined();
    expect(() => resolveBindings("$spawn.__proto__", { spawn: {} })).toThrow("Missing bound property");
  });
});

describe("forward walk regression", () => {
  test("turn-then-backwards fails across the whole walk despite a successful turn", () => {
    const report = predicate("moves_forward", { window: walk(true) });
    expect(report.verdict).toBe("FAIL");
    expect((report.actual as Json).turn.reached).toBe(true);
    expect((report.actual as Json).longest_backwards_s).toBeGreaterThanOrEqual(0.5);
    expect(report.evidence_grade).toBe("state");
  });
  test("forward travel and clean release pass with numeric evidence", () => {
    const window = walk();
    expect(predicate("moves_forward", { window }).verdict).toBe("PASS");
    expect(predicate("actor_released", { window }).verdict).toBe("PASS");
    expect((predicate("moves_forward", { window }).actual as Json).sampling.source_timestamps).toBe(false);
  });
  test("a turn alone, missing yaw, zero displacement and early despawn are inconclusive", () => {
    const w = walk();
    expect(predicate("moves_forward", { window: { ...w, samples: w.samples.slice(0, 3) } }).verdict).toBe("INCONCLUSIVE");
    expect(predicate("moves_forward", { window: { ...w, samples: w.samples.map((s) => ({ ...s, actor: s.actor ? { ...s.actor, yaw: undefined } : null })) } }).verdict).toBe("INCONCLUSIVE");
    expect(predicate("moves_forward", { window: { ...w, complete: false, samples: [w.samples[0], { ...w.samples[1], actor: null }] } }).verdict).toBe("INCONCLUSIVE");
  });
  test("sideways travel is reported separately and fails the forward fraction", () => {
    const w = walk();
    const samples = w.samples.map((s) => ({ ...s, actor: s.actor ? { ...s.actor, yaw: 90 } : null }));
    const report = predicate("moves_forward", { window: { ...w, samples } });
    expect(report.verdict).toBe("FAIL"); expect((report.actual as Json).sideways_s).toBeGreaterThan(0);
  });
  test("release is not a pass if removed at timeout/failure far from its destination", () => {
    const w = walk();
    expect(predicate("actor_released", { window: { ...w, result: { to: [0, 50, 0] } } }).verdict).toBe("FAIL");
    expect(predicate("actor_released", { window: { ...w, events: [...w.events, { seq: 2, kind: "npc.auto_released", t_ms: 10, data: { who: "a41", reason: "paused" } }] } }).verdict).toBe("FAIL");
    expect(predicate("actor_released", { window: { ...w, samples: w.samples.slice(0, -1) } }).verdict).toBe("FAIL");
  });
  test("arrival requires its actor's event and measured range", () => {
    const w = walk();
    const window = { ...w, action: "npc.move", samples: w.samples.slice(0, -1).map((s) => ({ ...s, actor: { ...s.actor, motion: undefined } })), events: [{ seq: 1, kind: "npc.arrived", t_ms: 1, data: { who: "a41", distance_v: 2 } }] };
    expect(predicate("actor_arrived", { window, max_range_m: 2.3 }).verdict).toBe("PASS");
    expect(predicate("actor_arrived", { window, max_range_m: 1 }).verdict).toBe("FAIL");
    expect(predicate("actor_arrived", { window: { ...window, events: [] }, max_range_m: 2.3 }).verdict).toBe("INCONCLUSIVE");
  });
  test("facing-clear/send lines diagnose only the exact actor and never create a PASS", () => {
    const text = "[10:00:00] npc a41 command turn sent\n[10:00:01] npc a41 facing target cleared (turn): held an entity before, nothing after\n[10:00:02] npc a41 command move sent\nnpc a410 command move sent";
    const timeline = facingTimeline(text, "a41");
    expect(timeline.map((t) => t.kind)).toEqual(["turn_sent", "facing_clear_turn", "move_sent"]);
    expect(timeline[1].before).toBe("held an entity before");
    expect(timeline[2].clock_ms! - timeline[0].clock_ms!).toBe(2000);
    expect(predicate("moves_forward", { window: { ...walk(), samples: [] } }).verdict).toBe("INCONCLUSIVE");
  });
});

describe("durable event cursors", () => {
  test("an event before the wait is found without polling again from now", async () => {
    const r = new Replay(), saved = await captureCursor(r);
    r.event("npc.spawned", { who: "a88" });
    const result = await waitForEvent(r, saved, { kind: "npc.spawned", subject: "a88" }, 2, undefined, r.time);
    expect(result.complete).toBe(true); expect(result.events[0].data?.who).toBe("a88");
    expect(r.calls.some((c) => c.name === "session.wait")).toBe(false);
  });
  test("a stale answer ID cannot satisfy a later question", async () => {
    const r = new Replay(), saved = await captureCursor(r);
    r.event("answer", { message_id: 7, label: "Ready" });
    r.onCall = (name, input) => { if (name === "session.wait") { expect(input.message_id).toBe(42); expect(input.after).toBe(1); r.event("answer", { message_id: 42, label: "Ready" }); return { answer: { message_id: 7 } }; } };
    const result = await waitForEvent(r, saved, { kind: "answer", message_id: 42 }, 2, undefined, r.time);
    expect(result.complete).toBe(true); expect(result.events.at(-1)?.data?.message_id).toBe(42);
  });
  test("a stale answer alone times out without a PASS", async () => {
    const r = new Replay(); r.event("answer", { message_id: 7 });
    const result = await waitForEvent(r, cursor(), { kind: "answer", message_id: 42 }, 1, undefined, r.time);
    expect(result.complete).toBe(false); expect(result.timed_out).toBe(true);
  });
  test("ring loss is retained and blocks no_event/no_loss", async () => {
    const r = new Replay(); r.event("comment"); r.event("comment"); r.events.shift();
    const result = await observeEvents(r, cursor(), 1, undefined, r.time);
    expect(result.cursor.dropped).toBe(1); expect(result.complete).toBe(false);
    expect(predicate("no_event", { window: result, kind: "npc.move_failed" }).verdict).toBe("INCONCLUSIVE");
    expect(predicate("no_loss", { window: result }).verdict).toBe("INCONCLUSIVE");
  });
  test("sequence gaps are caught even when dropped was falsely zero", async () => {
    const r = new Replay();
    r.onCall = (name) => name === "session.events" ? { events: [{ seq: 2, kind: "comment", t_ms: 0 }], next: 2, latest: 2, dropped: 0 } : undefined;
    expect((await drainEvents(r, cursor())).cursor.complete).toBe(false);
  });
  test("drains multiple pages without advancing to latest and skipping data", async () => {
    const r = new Replay(); for (let i = 0; i < 550; i++) r.event("comment");
    const result = await drainEvents(r, cursor());
    expect(result.events.length).toBe(550); expect(result.cursor.after).toBe(550); expect(result.cursor.complete).toBe(true);
  });
  test("a reconnect invalidates old cursors even if the new counter is larger", async () => {
    const r = new Replay(); r.sid = "other";
    const result = await drainEvents(r, cursor());
    expect(result.cursor.complete).toBe(false); expect(result.events).toEqual([]);
  });
  test("abort ends a wait and a negative interval without claiming absence", async () => {
    const r = new Replay(), stop = new AbortController();
    r.onSleep = () => stop.abort();
    const waited = await waitForEvent(r, cursor(), { kind: "answer", message_id: 42 }, 10, stop.signal, r.time);
    expect(waited.aborted).toBe(true); expect(waited.complete).toBe(false);
    const interval = await observeEvents(r, cursor(), 10, stop.signal, r.time);
    expect(interval.aborted).toBe(true); expect(interval.complete).toBe(false);
  });
});

describe("schema-2 planning and binding safety", () => {
  test("the committed two-case fixture plans without guessed actor or question IDs", () => {
    const s = fixture(); expect(planScript(s).problems).toEqual([]);
    const observations = s.steps.filter((s) => s.do === "observe" && s.command === "npc.move");
    expect(observations[0].input?.face_v).toBeUndefined(); expect(observations[1].input?.face_v).toBe(true);
    expect(s.steps.filter((s) => s.do === "await" && s.kind === "answer").map((s) => s.message_id)).toEqual(["$ready1.id", "$ready2.id"]);
  });
  test("schema 1 remains compatible and refuses schema-2 bindings", () => {
    expect(planScript({ schema: SCRIPT_SCHEMA, name: "v1", steps: [{ do: "run", command: "npc.status" }] }).problems).toEqual([]);
    expect(planScript({ schema: SCRIPT_SCHEMA, name: "v1", steps: [{ do: "run", command: "npc.status", bind: "npcs" }] }).problems.join()).toContain("require schema 2");
  });
  test("rejects unknown fields, commands, arguments, expressions and forward bindings", () => {
    for (const step of [
      { do: "assert", check: "eval", expression: "true" },
      { do: "assert", check: "range", actual: 1, min: 0, max: 2, extra: true },
      { do: "run", command: "system.exec", input: { code: "oops" } },
      { do: "run", command: "npc.status", input: { who: "$missing.who" } },
      { do: "run", command: "npc.move", input: { who: "a1", to: "v" } },
      { do: "run", command: "session.wait", input: { kinds: ["answer"] } },
      { do: "observe", command: "npc.release", subject: "$later.who", input: { who: "$later.who", how: "walk_away" }, timeout_s: 5, bind: "release" },
      { do: "await", cursor: "$fixture.cursor", kind: "answer", timeout_s: 1, bind: "answer" },
      { do: "await", cursor: "$fixture.cursor", kind: "invented", timeout_s: 1, bind: "event" },
      { do: "observe", command: "npc.status", interval_ms: 50, duration_s: 1, bind: "npcs" },
    ]) expect(planScript(script([step])).problems.length, JSON.stringify(step)).toBeGreaterThan(0);
  });
  test("binding selection is plain-data-only and runtime command types are checked", async () => {
    expect(resolveBindings({ who: "$spawn.who", id: "$question.id" }, { spawn: { who: "a41" }, question: { id: 42 } })).toEqual({ who: "a41", id: 42 });
    expect(() => resolveBindings("$absent.who", {})).toThrow("Unbound");
    const r = new Replay(), out = tempDir("xfb-assertions-");
    const s = script([{ do: "run", command: "npc.move", input: { who: "$fixture.who", max_s: "$fixture.bad" } }], { fixtures: { who: "a41", bad: "too long" } });
    // Use the real catalogue validator via CommandApi for commands; observe validates the resolved input itself.
    const runner = new TestSession(r, s, out, false, r.time);
    await expect(runner.execute({ do: "observe", command: "npc.move", subject: "a41", input: { who: "a41", max_s: "too long" }, timeout_s: 5, bind: "a" })).rejects.toThrow("must be a number");
  });
  test("checkpoint persists cursor advances and refuses a different session or script", async () => {
    const out = tempDir("xfb-assertions-"), r = new Replay();
    const s = script([]), first = new TestSession(r, s, out, false, r.time); await first.verifyIdentity();
    first.bind("before", cursor()); r.event("npc.spawned", { who: "a88" });
    await first.execute({ do: "await", cursor: "$before", kind: "npc.spawned", subject: "a88", timeout_s: 1, bind: "event" });
    const second = new TestSession(r, s, out, true, r.time); expect(second.resolve("$before.after")).toBe(1);
    r.sid = "new"; await expect(second.verifyIdentity()).rejects.toThrow("Session changed");
    expect(() => new TestSession(r, script([], { name: "changed" }), out, true, r.time)).toThrow("different script");
  });
});

describe("Z18 gate and session restore", () => {
  function logs() {
    const out = tempDir("xfb-assertions-"), plugin = join(out, "plugin.log"), redscript = join(out, "redscript.log");
    writeFileSync(plugin, `sid=fixture-session evt=plugin.build XFB_BUILD=${candidate.build_commit};dirty=0\nsid=fixture-session evt=rtti.register_types phase=post_register natives=27\n`);
    writeFileSync(redscript, "Compilation complete\n"); return { plugin, redscript };
  }
  test("current complete clean logs and the manifest candidate pass", () => {
    const snapshot = readLogs(logs(), info());
    expect(snapshot.complete).toBe(true);
    expect(predicate("bridge_ready", { actual: info(), candidate, logs: snapshot }).verdict).toBe("PASS");
  });
  test("wrong build, dirty build, class set, natives and callback errors fail", () => {
    const snapshot = readLogs(logs(), info());
    for (const actual of [
      { ...info(), build_commit: "9".repeat(40) }, { ...info(), plugin_version: "old" }, { ...info(), build_dirty: true },
      { ...info(), bridge: { allow_writes: true, write_classes: ["npc"] } }, { ...info(), bridge: { allow_writes: false, write_classes: candidate.write_classes } },
    ]) expect(predicate("bridge_ready", { actual, candidate, logs: snapshot }).verdict).toBe("FAIL");
    expect(predicate("bridge_ready", { actual: info(), candidate, logs: { ...snapshot, natives: 28 } }).verdict).toBe("FAIL");
    expect(predicate("bridge_ready", { actual: info(), candidate, logs: { ...snapshot, errors: [{ text: "script.callback_failed" }] } }).verdict).toBe("FAIL");
  });
  test("stale, missing or truncated logs cannot pass, and compiler errors stop", () => {
    const paths = logs(); writeFileSync(paths.plugin, "old log\n");
    expect(predicate("bridge_ready", { actual: info(), candidate, logs: readLogs(paths, info()) }).verdict).toBe("INCONCLUSIVE");
    writeFileSync(paths.redscript, "ERROR XFNpc cannot compile\nCompilation complete\n");
    expect(predicate("bridge_ready", { actual: info(), candidate, logs: readLogs(paths, info()) }).verdict).toBe("FAIL");
    const stale = logs(); const yesterday = new Date(Date.now() - 86400000); utimesSync(stale.redscript, yesterday, yesterday);
    expect(predicate("bridge_ready", { actual: info(), candidate, logs: readLogs(stale, info()) }).verdict).toBe("INCONCLUSIVE");
  });
  test("Z18 stops later writes automatically and conditional restore skips unborn resources", async () => {
    for (const reason of ["build", "classes", "log"]) {
    const r = new Replay(), paths = logs(), s = script([
      { do: "run", command: "bridge.info", bind: "bridge" },
      { do: "assert", label: "Z18", check: "bridge_ready", actual: "$bridge", candidate: "$fixture.candidate", logs: "$fixture.logs" },
      { do: "run", command: "npc.spawn", input: { cast: "woman_corpo" }, bind: "spawn" },
    ], { fixtures: { candidate: reason === "build" ? { ...candidate, build_commit: "9".repeat(40) } : candidate, logs: paths },
      restore: [{ do: "run", command: "npc.release", input: { who: "$spawn.who", how: "despawn" }, if_bound: "spawn" }] });
    if (reason === "classes") r.onCall = (name) => name === "bridge.info" ? { ...info(), bridge: { allow_writes: true, write_classes: ["npc"] } } : undefined;
    if (reason === "log") writeFileSync(paths.redscript, "ERROR XFNpc failed\nCompilation complete\n");
    const result = await runScript(s, { api: r.api(), outDir: tempDir("xfb-assertions-"), clock: r.time, echo: false, log() {} });
    expect(result.outcome).toBe("failed"); expect(r.calls.some((c) => c.name === "npc.spawn" || c.name === "npc.release")).toBe(false);
    expect((result.records[1].result as Json).verdict).toBe("FAIL");
    }
  });
  test("a non-passing gate cannot opt into continue_on_error", () => {
    expect(planScript(script([{ do: "assert", check: "bridge_ready", actual: "$fixture.info", candidate: "$fixture.candidate", logs: "$fixture.logs", continue_on_error: true }])).problems.join()).toContain("stop gate");
  });
  test("abort runs restore once with the returned handle and no aborted signal", async () => {
    const r = new Replay(), stop = new AbortController();
    r.onCall = (name) => { if (name === "npc.spawn") return { who: "a88" }; };
    r.onSleep = () => stop.abort();
    const s = script([{ do: "run", command: "npc.spawn", input: { cast: "woman_corpo" }, bind: "spawn" },
      { do: "cursor", bind: "before" }, { do: "await", cursor: "$before", kind: "answer", message_id: "$fixture.id", timeout_s: 20, bind: "answer" }],
      { fixtures: { id: 42 }, restore: [{ do: "run", command: "npc.release", input: { who: "$spawn.who", how: "despawn" } }] });
    const result = await runScript(s, { api: r.api(), outDir: tempDir("xfb-assertions-"), clock: r.time, signal: stop.signal, echo: false, log() {} });
    expect(result.outcome).toBe("interrupted");
    expect(r.calls.filter((c) => c.name === "npc.release").map((c) => c.input)).toEqual([{ who: "a88", how: "despawn" }]);
  });
  test("the entire N1/N2 fixture replays both cases with returned IDs and factual reports", async () => {
    const r = new Replay(), s = fixture();
    s.fixtures = { candidate, logs: logs() };
    let actor: Json | null = null, stage = "idle", start = 0, spawns = 0, question = 700;
    r.onCall = (name, input) => {
      if (name === "ui.message" && input.level === "ask") {
        const id = ++question; r.event("answer", { message_id: 2, label: "Old" }); r.event("answer", { message_id: id, label: "Ready" });
        return { id };
      }
      if (name === "npc.spawn") {
        actor = { who: `a${++spawns * 41}`, position: [0, 8, 0], yaw: 180 }; stage = "idle";
        r.event("npc.spawned", { who: actor.who }); return { who: actor.who };
      }
      if (name === "npc.move") {
        expect(input.who).toBe(actor!.who); expect(input.face_v).toBe(spawns === 2 ? true : undefined);
        stage = "approach"; start = r.ms; return { who: actor!.who, to: "v" };
      }
      if (name === "npc.release" && input.how === "walk_away") {
        expect(input.who).toBe(actor!.who); stage = "release"; start = r.ms;
        return { who: actor!.who, how: "walk_away", to: [0, 17, 0], turns_first: true };
      }
      if (name === "npc.status") {
        if (!actor) return { npcs: [] };
        if (stage === "approach") {
          const y = Math.max(2, 8 - (r.ms - start) / 500);
          actor = { ...actor, position: [0, y, 0], yaw: 180, motion: y > 2 ? { kind: "move" } : undefined };
          if (y === 2) { stage = "idle"; r.event("npc.arrived", { who: actor.who, distance_v: 2 }); }
        } else if (stage === "release") {
          const elapsed = r.ms - start, y = 2 + Math.max(0, elapsed - 500) / 500;
          if (y >= 16) { r.event("npc.released", { who: actor.who, how: "walk_away" }); actor = null; return { npcs: [] }; }
          actor = { ...actor, position: [0, y, 0], yaw: elapsed < 500 ? 90 : 0, motion: { kind: "walk_away" } };
        }
        return { npcs: [actor] };
      }
    };
    const outDir = tempDir("xfb-assertions-");
    const result = await runScript(s, { api: r.api(), outDir, clock: r.time, echo: false, log() {} });
    expect(result.outcome).toBe("complete"); expect(result.ok).toBe(true);
    expect(result.records.filter((r) => r.kind === "assert").length).toBe(12);
    expect(result.records.filter((r) => r.kind === "assert").every((r) => (r.result as Json).verdict === "PASS")).toBe(true);
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
    expect(manifest.runs[0].bindings.release1.sampling.source_max_hz).toBe(4);
    expect(manifest.runs[0].bindings.spawn2.who).toBe("a82");
    expect(manifest.runs[0].steps.find((s: Json) => s.label === "N1-whole-departure-forward").result.evidence).toEqual(["bindings.release1"]);
    expect(r.calls.filter((c) => c.name === "npc.status").length).toBeGreaterThan(20);
  });
});

describe("pipe sampler budgets", () => {
  test("actor observations measure achieved read cadence and a complete release", async () => {
    const r = new Replay(); let released = false;
    r.onCall = (name) => {
      if (name === "npc.release") return { who: "a41", how: "walk_away", to: [0, 3, 0] };
      if (name === "npc.status") {
        const y = r.ms / 500;
        if (y >= 3) { if (!released) { r.event("npc.released", { who: "a41", how: "walk_away" }); released = true; } return { npcs: [] }; }
        return { npcs: [{ who: "a41", position: [0, y, 0], yaw: 0, motion: { kind: "walk_away" } }] };
      }
    };
    const result = await observeActor(r, "a41", "npc.release", { who: "a41", how: "walk_away" }, 5, undefined, r.time);
    expect(result.complete).toBe(true); expect(result.sampling.achieved_hz).toBe(4); expect(result.sampling.source_max_hz).toBe(4);
    expect(result.samples.at(-1)?.actor).toBeNull();
    const times = r.calls.filter((c) => c.name === "npc.status").map((c) => c.at);
    expect(times.slice(1).every((t, i) => t - times[i] >= 250)).toBe(true);
    expect(predicate("actor_released", { window: result }).verdict).toBe("PASS");
  });
  test("slow calls lower the reported rate rather than inventing source ticks", async () => {
    const r = new Replay();
    r.onCall = (name) => { if (name === "npc.status") { r.ms += 200; return { npcs: [{ who: "a41", position: [0, r.ms / 1000, 0], yaw: 0 }] }; } };
    const result = await observeActor(r, "a41", "npc.release", { who: "a41", how: "walk_away" }, 1, undefined, r.time);
    expect(result.sampling.achieved_hz).toBeLessThan(4); expect(result.complete).toBe(false);
  });
  test("long sample gaps make the full-window verdict inconclusive", async () => {
    const r = new Replay();
    r.onCall = (name) => { if (name === "npc.status") { r.ms += 900; return { npcs: [{ who: "a41", position: [0, r.ms / 1000, 0], yaw: 0 }] }; } };
    const result = await observeActor(r, "a41", "npc.release", { who: "a41", how: "walk_away" }, 2, undefined, r.time);
    expect(result.missing.join()).toContain("Sampling gap"); expect(result.complete).toBe(false);
  });
  test("abort stops an actor sampler promptly and does not pretend release completed", async () => {
    const r = new Replay(), stop = new AbortController(); r.onSleep = () => stop.abort();
    const result = await observeActor(r, "a41", "npc.release", { who: "a41", how: "walk_away" }, 10, stop.signal, r.time);
    expect(result.aborted).toBe(true); expect(result.complete).toBe(false);
  });
  test("rejects over-polling and arbitrary sampled commands", async () => {
    const r = new Replay();
    await expect(observeActor(r, "a41", "npc.release", { who: "a41", how: "walk_away" }, 1, undefined, r.time, 50)).rejects.toThrow("budget");
    await expect(observeValues(r, "game.saves", {}, 1, 100, undefined, r.time)).rejects.toThrow("budget");
    await expect(observeValues(r, "system.exec", {}, 1, 250, undefined, r.time)).rejects.toThrow("budget");
  });
});
