// One process-owned arm; callbacks/cursors and bounded receipts, no copied event history.
import { catchUp, type TimelineCursor } from "./timeline.ts";
import { clock as defaultClock, type Clock, type Json, type TestApi } from "./windows.ts";

// 0.8.22 (Borg 4, TL3): what can cancel an arm depends on the feed its trigger arrives on. An arm that names a recorder channel
// is a recorder arm: loss on the recorder after arming (dropped rows, a writer error, lost history, invalid samples on that
// channel, and late samples on a polled channel) cancels it, with the reason said exactly. An arm without a channel is a
// session-feed arm (dm.quest, npc.arrived, supervisor.*): it still fires on a matching recorder row, but only loss on the session
// feed cancels it; recorder loss while it is armed is reported with its receipt, never a reason to cancel. Missed sample
// deadlines under memory pressure used to cancel every arm with source_coverage_incomplete.
// Channels the recorder samples on a deadline (a late sample can miss a state); the others are written by taps as things happen.
const POLLED_CHANNELS = new Set(["v", "actors", "camera", "ui"]);
export type CaptureArm = { run: number; event: string; channel?: string; match?: Json; capture: "screenshot" | "burst" | "recrop"; args?: Json; delay_ms?: number; count?: number; expires_s?: number };
type RecorderLoss = { dropped: number; invalid: number; missed_deadlines: number; file_error: boolean };
type Active = { id: number; input: CaptureArm; cursor: TimelineCursor; until: number; remaining: number; stop: AbortController; atArm: RecorderLoss; recorderLoss: RecorderLoss };
export class EventCaptures {
  private active?: Active;
  private pending?: { id: number; stop: AbortController };
  private generation = 0;
  private receipts: Json[] = [];
  private nextId = 1;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private api: TestApi, private clock: Clock = defaultClock) {}
  async arm(input: CaptureArm, initialApi: TestApi): Promise<Json> {
    if (this.active || this.pending) throw new Error("A capture is already armed; cancel it first");
    const pending = { id: this.nextId++, stop: new AbortController() }, generation = this.generation;
    this.pending = pending;
    try {
      const initial = await catchUp(initialApi, { run: input.run, digest: false, archive: false, signal: pending.stop.signal });
      if (generation !== this.generation || pending.stop.signal.aborted) throw new Error("Capture arm was cancelled");
      if (!initial.source.active) throw new Error("Start a live recorder before arming a capture");
      initial.cursor.record = Math.max(initial.cursor.record, initial.source.latest);
      // Coverage is judged from here on: loss or invalid data before the arm is history, not a reason to cancel it.
      initial.cursor.source_counters = { dropped: initial.source.dropped ?? 0, invalid: initial.source.invalid ?? 0,
        missed_deadlines: initial.source.missed_deadlines ?? 0, file_error: !!initial.source.file_error };
      const arm: Active = { id: pending.id, input, cursor: initial.cursor, until: this.clock.now() + (input.expires_s ?? 30) * 1000,
        remaining: input.count ?? 1, stop: pending.stop, atArm: { ...initial.cursor.source_counters },
        recorderLoss: { dropped: 0, invalid: 0, missed_deadlines: 0, file_error: false } };
      this.active = arm; this.schedule(arm);
      return { id: arm.id, armed: true, cursor: arm.cursor, expires_in_s: input.expires_s ?? 30, count: arm.remaining,
        trigger: input.channel ? `recorder channel ${input.channel}: recorder loss after arming cancels it` : "session feed (or any recorder row): only session-feed loss cancels it; recorder loss is reported, never a cancellation",
        lifetime: "This tools process; close, kill or handover cancels. Polling/command contention may make captures late." };
    } finally { if (this.pending === pending) this.pending = undefined; }
  }
  status(): Json { return { armed: !!this.active || !!this.pending, id: this.active?.id ?? this.pending?.id, remaining: this.active?.remaining, receipts: [...this.receipts] }; }
  cancel(reason = "cancelled"): Json {
    ++this.generation;
    if (this.pending) { this.pending.stop.abort(); this.note({ id: this.pending.id, status: reason }); this.pending = undefined; }
    const arm = this.active;
    if (arm) { arm.stop.abort(); this.active = undefined; this.note({ id: arm.id, status: reason, remaining: arm.remaining, ...this.lossNote(arm) }); }
    if (this.timer) clearTimeout(this.timer);
    return this.status();
  }
  /**
   * Loss that could hide this arm's trigger in the interval this poll read (which began where the arm, or the previous poll,
   * ended), each as a precise reason. Empty when nothing on the trigger's feed was lost.
   */
  private lossSinceArm(arm: Active, page: Json): string[] {
    const lost: string[] = [];
    const gaps: string[] = page.gaps ?? [];
    const channel = arm.input.channel;
    if (gaps.includes("session_history_lost") && !channel) lost.push("session_history_lost: session events were dropped before they were read");
    if (gaps.includes("supervisor_history_lost") && arm.input.event.startsWith("supervisor.")) lost.push("supervisor_history_lost: the supervisor dropped receipts");
    if (!channel) return lost;
    const on = `the trigger's recorder channel ${channel}`;
    if (gaps.includes("recorder_history_lost")) lost.push(`recorder_history_lost: recorder rows were overwritten before they were read (${on})`);
    if (gaps.includes("native_file_history_lost")) lost.push(`native_file_history_lost: rows are missing from the recorder's files (${on})`);
    const delta: Json | undefined = page.coverage_delta;
    if (gaps.includes("source_coverage_incomplete")) {
      // An unknown composition cannot be excused; a known one is loss on this channel only when rows (any channel: a drop
      // names none), the writer or, for a polled channel, a sample deadline were lost.
      if (!delta) lost.push(`source_coverage_incomplete: the recorder lost data of an unknown kind (${on})`);
      else {
        if (delta.dropped) lost.push(`source_coverage_incomplete: ${delta.dropped} recorder row(s) dropped since arming, channel not known (${on})`);
        if (delta.file_error) lost.push(`source_coverage_incomplete: the recorder's file writer failed (${on})`);
        if (delta.missed_deadlines && POLLED_CHANNELS.has(channel)) lost.push(`source_coverage_incomplete: ${delta.missed_deadlines} sample deadline(s) missed on polled ${on}`);
      }
    }
    if (gaps.includes("invalid_source")) {
      const channels: string[] | undefined = page.invalid_channels;
      if (!channels || channels.includes(channel)) lost.push(`invalid_source: invalid samples on ${on}`);
    }
    return lost;
  }
  /** Recorder loss a session-feed arm has seen since arming (the recorder's totals less those at arming): said with its receipts. */
  private noteRecorderLoss(arm: Active, page: Json) {
    const s: Json | undefined = page.source;
    if (!s) return;
    const a = arm.atArm;
    arm.recorderLoss = { dropped: Math.max(0, (s.dropped ?? 0) - a.dropped), invalid: Math.max(0, (s.invalid ?? 0) - a.invalid),
      missed_deadlines: Math.max(0, (s.missed_deadlines ?? 0) - a.missed_deadlines), file_error: !!s.file_error && !a.file_error };
  }
  private lossNote(arm: Active): Json {
    const l = arm.recorderLoss;
    return l.dropped || l.invalid || l.missed_deadlines || l.file_error ? { recorder_loss_while_armed: { ...l } } : {};
  }
  private note(receipt: Json) { this.receipts.push(receipt); if (this.receipts.length > 32) this.receipts.shift(); }
  private schedule(arm: Active) {
    this.timer = setTimeout(() => { void this.poll(arm); }, 250);
    this.timer.unref?.();
  }
  async poll(arm = this.active): Promise<void> {
    if (!arm || this.active !== arm) return;
    if (this.clock.now() >= arm.until) { this.cancel("expired"); return; }
    try {
      const result = await this.api.run("game.catchup", { cursor: arm.cursor, detail: true, now: false, replay_files: false }, { signal: arm.stop.signal });
      if (!result.ok) throw new Error(result.error.message);
      const page = result.result as Json;
      if (this.active !== arm) return;
      if (!page.source.active) { this.cancel("recorder_stopped"); return; }
      arm.cursor = page.cursor;
      const lost = this.lossSinceArm(arm, page);
      if (lost.length) throw new Error(`Timeline coverage gap: ${lost.join("; ")}`);
      if (!arm.input.channel) this.noteRecorderLoss(arm, page);
      // A session-feed arm is late only when the session feed is behind; a recorder backlog is the recorder's.
      const behind = arm.input.channel ? page.more : (page.backlog ? page.backlog.events_behind > 0 : page.more);
      if (behind) throw new Error("Timeline fell behind real time; the event could no longer be captured on time");
      const sources = [
        ...(page.records as Json[]).filter(r => r.valid).map(r => ({ ...r.data, channel: r.channel, event: r.data?.event, seq: r.seq, source_s: r.source_s })),
        ...(page.events as Json[]).map(e => ({ ...e.data, event: e.kind, seq: e.seq, source_s: e.source_s })),
      ];
      for (const event of sources) {
        if (event.event !== arm.input.event || (arm.input.channel && event.channel !== arm.input.channel) ||
            Object.entries(arm.input.match ?? {}).some(([key, value]) => event[key] !== value)) continue;
        if (!Number.isFinite(event.source_s) || !Number.isFinite(page.calibration.source_s)) throw new Error("Event has no comparable source clock");
        const c = page.calibration;
        // Conservative host interval for the event, from QPC calibration. Never sleep relative to poll receipt.
        const earliest = c.host_before_ms + (event.source_s - c.source_s) * 1000;
        const latest = c.host_after_ms + (event.source_s - c.source_s) * 1000;
        const due = latest + (arm.input.delay_ms ?? 50);
        await this.clock.sleep(Math.max(0, Math.min(due - this.clock.now(), arm.until - this.clock.now())), arm.stop.signal);
        if (this.active !== arm || arm.stop.signal.aborted) return;
        if (this.clock.now() >= arm.until) { this.cancel("expired"); return; }
        // The source-timed delay is time the recorder can stop, restart, change world or lose data in. Look again at the
        // interval after this page, without consuming it, immediately before the capture.
        const recheck = await this.api.run("game.catchup", { cursor: structuredClone(arm.cursor), detail: true, now: false, replay_files: false }, { signal: arm.stop.signal });
        if (this.active !== arm || arm.stop.signal.aborted) return;
        if (!recheck.ok) throw new Error(recheck.error.message);
        const after = recheck.result as Json;
        if (!after.source.active) { this.cancel("recorder_stopped"); return; }
        const lost = this.lossSinceArm(arm, after);
        if (lost.length) throw new Error(`Timeline coverage gap before the capture: ${lost.join("; ")}`);
        const began = this.clock.now();
        const args = { ...(arm.input.capture === "recrop" ? {} : { clear_overlay: false }), ...arm.input.args };
        // Serialised with every other command on the existing API/connection. No second bridge client.
        const capture = await this.api.run(`capture.${arm.input.capture}`, args, { signal: arm.stop.signal, deadlineMs: arm.until });
        const ended = this.clock.now();
        if (this.active !== arm) return;
        this.note({ id: arm.id, status: capture.ok ? "captured" : "capture_failed", event,
          capture_started_ms: began, capture_returned_ms: ended,
          event_to_capture_ms: { min: began - latest, max: ended - earliest },
          latency_basis: arm.input.capture === "recrop" ? "Processing saved image; no new exposure" : "Source event to tools capture invocation/return; exposure lies within this interval",
          outcome: capture, ...this.lossNote(arm) });
        if (!--arm.remaining) { this.active = undefined; return; }
      }
    } catch (error) {
      if (this.active === arm) this.cancel(`failed: ${(error as Error).message}`);
      return;
    }
    if (this.active === arm) this.schedule(arm);
  }
}
