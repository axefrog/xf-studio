// One process-owned arm; callbacks/cursors and bounded receipts, no copied event history.
import { catchUp, type TimelineCursor } from "./timeline.ts";
import { clock as defaultClock, type Clock, type Json, type TestApi } from "./windows.ts";

export type CaptureArm = { run: number; event: string; channel?: string; match?: Json; capture: "screenshot" | "burst" | "recrop"; args?: Json; delay_ms?: number; count?: number; expires_s?: number };
type Active = { id: number; input: CaptureArm; cursor: TimelineCursor; until: number; remaining: number; stop: AbortController };
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
      const arm: Active = { id: pending.id, input, cursor: initial.cursor, until: this.clock.now() + (input.expires_s ?? 30) * 1000,
        remaining: input.count ?? 1, stop: pending.stop };
      this.active = arm; this.schedule(arm);
      return { id: arm.id, armed: true, cursor: arm.cursor, expires_in_s: input.expires_s ?? 30, count: arm.remaining,
        lifetime: "This tools process; close, kill or handover cancels. Polling/command contention may make captures late." };
    } finally { if (this.pending === pending) this.pending = undefined; }
  }
  status(): Json { return { armed: !!this.active || !!this.pending, id: this.active?.id ?? this.pending?.id, remaining: this.active?.remaining, receipts: [...this.receipts] }; }
  cancel(reason = "cancelled"): Json {
    ++this.generation;
    if (this.pending) { this.pending.stop.abort(); this.note({ id: this.pending.id, status: reason }); this.pending = undefined; }
    const arm = this.active;
    if (arm) { arm.stop.abort(); this.active = undefined; this.note({ id: arm.id, status: reason, remaining: arm.remaining }); }
    if (this.timer) clearTimeout(this.timer);
    return this.status();
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
      if (!page.complete) throw new Error(`Timeline coverage gap: ${page.gaps.join(", ")}`);
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
          outcome: capture });
        if (!--arm.remaining) { this.active = undefined; return; }
      }
    } catch (error) {
      if (this.active === arm) this.cancel(`failed: ${(error as Error).message}`);
      return;
    }
    if (this.active === arm) this.schedule(arm);
  }
}
