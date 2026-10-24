// Bounded observations over the existing CommandApi. No second pipe, input injector or native recorder.
import type { CommandApi } from "../api/command-api.ts";
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";

export type TestApi = Pick<CommandApi, "run">;
export type Json = Record<string, any>;
export type FileEvidence = { kind: string; path: string; bytes: number; sha256: string; modified_at: string };
export type LogSnapshot = { complete: boolean; missing: string[]; errors: { kind: string; line: number; text: string }[]; natives?: number; evidence: FileEvidence[]; plugin_text: string };
export type Clock = { now(): number; sleep(ms: number, signal?: AbortSignal): Promise<void> };
export const clock: Clock = {
  now: () => performance.now(),
  sleep: (ms, signal) => new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  }),
};
export async function read(api: TestApi, name: string, input: Json = {}, signal?: AbortSignal): Promise<Json> {
  if (signal?.aborted) throw new Error("Observation aborted");
  const result = await api.run(name, input, { source: "session", signal });
  if (!result.ok) throw new Error(`${name}: ${result.error.code}: ${result.error.message}`);
  if (!result.result || typeof result.result !== "object") throw new Error(`${name}: missing observation`);
  return result.result as Json;
}

export type SessionEvent = { seq: number; kind: string; t_ms: number; level?: string; text?: string; data?: Json; source?: string };
export type EventCursor = { schema: "xfb/event-cursor-1"; sid: string; after: number; dropped: number; complete: boolean; missing: string[] };
const sequence = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
export async function captureCursor(api: TestApi, signal?: AbortSignal): Promise<EventCursor> {
  const info = await read(api, "bridge.info", {}, signal);
  const page = await read(api, "session.events", { since: 0, limit: 1 }, signal);
  if (typeof info.sid !== "string" || !info.sid || !sequence(page.latest)) throw new Error("Missing session identity/event head");
  return { schema: "xfb/event-cursor-1", sid: info.sid, after: page.latest, dropped: 0, complete: true, missing: [] };
}

/** Drain unfiltered pages: filtered waits do not expose loss, and their `next` may skip unrelated events. */
export async function drainEvents(api: TestApi, saved: EventCursor, signal?: AbortSignal): Promise<{ cursor: EventCursor; events: SessionEvent[] }> {
  if (saved?.schema !== "xfb/event-cursor-1" || !sequence(saved.after) || typeof saved.sid !== "string") throw new Error("Invalid event cursor");
  const cursor: EventCursor = { ...saved, missing: [...saved.missing] };
  const missing = (why: string) => { cursor.complete = false; if (!cursor.missing.includes(why)) cursor.missing.push(why); };
  const info = await read(api, "bridge.info", {}, signal);
  if (info.sid !== cursor.sid) {
    missing("Session changed; old handles and event sequences cannot be reused");
    return { cursor, events: [] };
  }
  const events: SessionEvent[] = [];
  for (let pageNumber = 0; pageNumber < 16; pageNumber++) {
    const page = await read(api, "session.events", { since: cursor.after, limit: 500 }, signal);
    if (!Array.isArray(page.events) || !sequence(page.next) || !sequence(page.latest) || !sequence(page.dropped)) {
      missing("Malformed event page"); break;
    }
    if (page.latest < cursor.after || page.next < cursor.after || page.next > page.latest) { missing("Event stream reset"); break; }
    if (page.dropped) { cursor.dropped += page.dropped; missing("Event ring lost history"); }
    let previous = cursor.after;
    for (const event of page.events as SessionEvent[]) {
      if (!sequence(event.seq) || event.seq <= previous || event.seq !== previous + 1 || typeof event.kind !== "string" || !Number.isFinite(event.t_ms)) missing("Event sequence gap or invalid event");
      previous = event.seq;
      events.push(event);
    }
    if (previous !== page.next) missing("Unaccounted event cursor advance");
    if (page.next === cursor.after && page.latest > cursor.after) { missing("Event stream made no progress"); break; }
    cursor.after = page.next;
    if (cursor.after >= page.latest) return { cursor, events };
  }
  missing("Event drain incomplete");
  return { cursor, events };
}

export type EventWindow = { cursor: EventCursor; events: SessionEvent[]; complete: boolean; aborted: boolean; timed_out: boolean; started_ms?: number; ended_ms?: number };
/** Exact answer/actor identity, captured before the action. session.wait supplies the cheap interruptible wait. */
export async function waitForEvent(api: TestApi, saved: EventCursor, match: { kind: string; subject?: string; message_id?: number }, timeout_s: number,
  signal?: AbortSignal, time: Clock = clock): Promise<EventWindow> {
  const started_ms = time.now(), deadline = started_ms + timeout_s * 1000;
  let cursor = saved;
  const events: SessionEvent[] = [];
  try { while (!signal?.aborted && time.now() < deadline) {
    const drained = await drainEvents(api, cursor, signal);
    cursor = drained.cursor; events.push(...drained.events);
    const hits = events.filter((e) => e.kind === match.kind && (match.subject === undefined || e.data?.who === match.subject) &&
      (match.message_id === undefined || e.data?.message_id === match.message_id));
    if (hits.length || !cursor.complete) return { cursor, events, complete: cursor.complete, aborted: false, timed_out: false, started_ms, ended_ms: time.now() };
    // Never accept session.wait's own success as proof of history completeness. Drain from our durable cursor again.
    const input: Json = { after: cursor.after, kinds: [match.kind], timeout_s: Math.max(1, Math.min(2, (deadline - time.now()) / 1000)), poll_ms: 400 };
    if (match.message_id !== undefined) input.message_id = match.message_id;
    const waited = await read(api, "session.wait", input, signal);
    if (waited.question_gone) return { cursor, events, complete: false, aborted: false, timed_out: false, started_ms, ended_ms: time.now() };
  } } catch (error) { if (!signal?.aborted) throw error; }
  return { cursor, events, complete: false, aborted: signal?.aborted === true, timed_out: !signal?.aborted, started_ms, ended_ms: time.now() };
}

export async function observeEvents(api: TestApi, saved: EventCursor, duration_s: number, signal?: AbortSignal, time: Clock = clock): Promise<EventWindow> {
  const started_ms = time.now(), deadline = started_ms + duration_s * 1000;
  let cursor = saved;
  const events: SessionEvent[] = [];
  try { while (!signal?.aborted) {
    const page = await drainEvents(api, cursor, signal);
    cursor = page.cursor; events.push(...page.events);
    if (!cursor.complete || time.now() >= deadline) break;
    await time.sleep(Math.min(400, deadline - time.now()), signal);
  } } catch (error) { if (!signal?.aborted) throw error; }
  return { cursor, events, complete: cursor.complete && !signal?.aborted && time.now() >= deadline, aborted: signal?.aborted === true, timed_out: false, started_ms, ended_ms: time.now() };
}

/** Full bounded files, never a tail advertised as error-free history. Paths stay in private reports. */
export function readLogs(paths: { plugin: string; redscript: string }, info: Json): LogSnapshot {
  const missing: string[] = [], errors: LogSnapshot["errors"] = [], evidence: FileEvidence[] = [];
  let plugin = "", redscript = "", natives: number | undefined;
  let pluginCreated = 0, compilerModified = 0;
  for (const [kind, path] of Object.entries(paths)) {
    try {
      const stat = statSync(path);
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error("Expected a log file at most 16 MiB");
      const bytes = readFileSync(path), text = bytes.toString("utf8");
      evidence.push({ kind, path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), modified_at: stat.mtime.toISOString() });
      if (kind === "plugin") { plugin = text; pluginCreated = stat.birthtimeMs; }
      else { redscript = text; compilerModified = stat.mtimeMs; }
      const lines = text.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (/script\.(?:callback_failed|bad_json)|\blvl=(?:error|fatal)\b/i.test(line) || (kind === "redscript" && /\b(error|failed)\b/i.test(line))) errors.push({ kind, line: i + 1, text: line });
      });
    } catch (error) { missing.push(`${kind} log unavailable: ${String(error)}`); }
  }
  if (!plugin.includes(`XFB_BUILD=${info.build_commit};dirty=0`)) missing.push("Plugin log does not identify the running clean build");
  if (!info.sid || !plugin.includes(`sid=${info.sid}`)) missing.push("Plugin log does not identify the current bridge session");
  if (!/Compilation complete/i.test(redscript)) missing.push("No completed redscript compilation in the supplied log");
  if (compilerModified && pluginCreated && compilerModified + 5000 < pluginCreated) missing.push("Compiler log predates this plugin launch");
  const counts = [...plugin.matchAll(/evt=rtti\.register_types[^\r\n]*\bnatives=(\d+)/g)];
  if (counts.length) natives = Number(counts.at(-1)![1]);
  return { complete: missing.length === 0, missing, errors, natives, evidence, plugin_text: plugin };
}

export type ActorSample = { t_ms: number; request_ms: number; actor: Json | null };
export type ActorWindow = EventWindow & {
  subject: string; action: string; result: Json; started_ms: number; ended_ms: number; samples: ActorSample[];
  sampling: { requested_hz: number; achieved_hz: number; changed_transform_hz: number; source_max_hz: 4; source_timestamps: false; max_gap_ms: number };
  missing: string[];
};

/** Cache is refreshed every 250 ms (Npc.hpp). Count read cadence and transform changes, never claim fresh source ticks. */
export async function observeActor(api: TestApi, subject: string, action: "npc.move" | "npc.release", input: Json, timeout_s: number,
  signal?: AbortSignal, time: Clock = clock, interval_ms = 250, checkpoint?: (cursor: EventCursor) => void): Promise<ActorWindow> {
  if (interval_ms < 250 || interval_ms > 2000 || timeout_s < 1 || timeout_s > 120) throw new Error("Actor window outside observation budget");
  if (input.who !== subject || (action === "npc.release" && input.how !== "walk_away")) throw new Error("Actor window requires the bound actor and walk_away release");
  let cursor = await captureCursor(api, signal);
  checkpoint?.(cursor); // Durable before issuing the action, even if the tools process later exits unexpectedly.
  const samples: ActorSample[] = [], events: SessionEvent[] = [], missing: string[] = [];
  const sample = async () => {
    const start = time.now(), status = await read(api, "npc.status", {}, signal);
    if (!Array.isArray(status.npcs)) throw new Error("npc.status omitted its NPC list");
    samples.push({ t_ms: time.now(), request_ms: time.now() - start, actor: status.npcs.find((a: Json) => a.who === subject) ?? null });
  };
  await sample();
  const started_ms = time.now();
  const result = await read(api, action, input, signal);
  const deadline = started_ms + timeout_s * 1000;
  let terminal = false;
  try {
    while (!signal?.aborted && time.now() < deadline) {
      await time.sleep(Math.max(0, interval_ms - (time.now() - samples.at(-1)!.t_ms)), signal);
      if (signal?.aborted) break;
      await sample();
      const drained = await drainEvents(api, cursor, signal);
      cursor = drained.cursor; events.push(...drained.events);
      const own = events.filter((e) => e.data?.who === subject);
      terminal = own.some((e) => e.kind === (action === "npc.move" ? "npc.arrived" : "npc.released"));
      if (terminal) {
        // The status read can precede the event's terminal tick. Verify removal once after seeing release.
        if (samples.at(-1)!.actor) {
          await time.sleep(interval_ms, signal); await sample();
        }
        break;
      }
      if (!cursor.complete || own.some((e) => ["npc.move_failed", "npc.auto_released", "npc.dissolved", "npc.handed_back"].includes(e.kind))) break;
    }
  } catch (error) {
    missing.push(signal?.aborted ? "Observation aborted" : String(error));
  }
  const ended_ms = time.now();
  const gaps = samples.slice(1).map((s, i) => s.t_ms - samples[i].t_ms);
  const elapsed = samples.at(-1)!.t_ms - samples[0].t_ms;
  const changed = samples.slice(1).filter((s, i) => s.actor && samples[i].actor &&
    (JSON.stringify(s.actor.position) !== JSON.stringify(samples[i].actor!.position) || s.actor.yaw !== samples[i].actor!.yaw)).length;
  const max_gap_ms = Math.max(0, ...gaps);
  if (max_gap_ms > 750) missing.push("Sampling gap exceeds the declared 750 ms budget");
  if (!terminal) missing.push("No matching terminal event within the observation window");
  return { cursor, events, subject, action, result, started_ms, ended_ms, samples, missing,
    complete: terminal && cursor.complete && !signal?.aborted && missing.length === 0,
    aborted: signal?.aborted === true, timed_out: !terminal && !signal?.aborted && ended_ms >= deadline,
    sampling: { requested_hz: 1000 / interval_ms, achieved_hz: elapsed > 0 ? (samples.length - 1) * 1000 / elapsed : 0,
      changed_transform_hz: elapsed > 0 ? changed * 1000 / elapsed : 0, source_max_hz: 4, source_timestamps: false, max_gap_ms } };
}

export type TimedValue = { t_ms: number; value: unknown };
export type ValueWindow = { started_ms: number; ended_ms: number; samples: TimedValue[]; complete: boolean; aborted: boolean; missing: string[] };
/** Only the existing inexpensive read endpoints may be sampled. */
export const WINDOW_READS = ["bridge.info", "npc.status", "game.saves", "test.input.state", "player.choice.state"] as const;
export async function observeValues(api: TestApi, command: string, input: Json, duration_s: number, interval_ms: number,
  signal?: AbortSignal, time: Clock = clock): Promise<ValueWindow> {
  if (!(WINDOW_READS as readonly string[]).includes(command) || duration_s < 0.25 || duration_s > 120 || interval_ms < (command === "game.saves" ? 3500 : 250) || interval_ms > 10000) throw new Error("Read window outside observation budget");
  const started_ms = time.now(), samples: TimedValue[] = [], missing: string[] = [];
  try {
    while (!signal?.aborted) {
      samples.push({ t_ms: time.now(), value: await read(api, command, input, signal) });
      if (time.now() - started_ms >= duration_s * 1000) break;
      await time.sleep(interval_ms, signal);
    }
  } catch (error) { missing.push(String(error)); }
  return { started_ms, ended_ms: time.now(), samples, missing, complete: !signal?.aborted && missing.length === 0, aborted: signal?.aborted === true };
}
