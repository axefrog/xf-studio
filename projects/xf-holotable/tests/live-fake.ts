import { mapRecorderStatus, type Discovery, type LiveBridge, type RecorderStatus } from "../src/live-bridge.ts";
import type { LiveClock } from "../src/live.ts";

export class ManualClock implements LiveClock {
  ms = 0;
  jobs: { at: number; fn: () => void }[] = [];
  now = () => this.ms;
  later = (ms: number, fn: () => void) => {
    const job = { at: this.ms + ms, fn }; this.jobs.push(job);
    return () => { this.jobs = this.jobs.filter(j => j !== job); };
  };
  async advance(ms: number) {
    const end = this.ms + ms;
    for (let i = 0; i < 1000; i++) {
      this.jobs.sort((a, b) => a.at - b.at);
      if (!this.jobs.length || this.jobs[0].at > end) break;
      const job = this.jobs.shift()!; this.ms = job.at; job.fn(); await settle();
      if (i === 999) throw Error("Fake clock exceeded its job budget");
    }
    this.ms = end; await settle();
  }
}
export async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }

/** Native 0.8.23 payload, before a run; session is already established. */
export function emptyRecorderStatus(session = "abc123") {
  return { active: false, run: null, session, world: null, channels: [], start: null, latest: null,
    stop_reason: null, requested_hz: null, duration_s: null, byte_cap: null, ack: null };
}

export class FakeBridge implements LiveBridge {
  recorder: RecorderStatus = mapRecorderStatus({ active: true, run: 1, session: "abc123", world: 1,
    channels: ["v", "camera", "subtitles", "supervisor"], start: { s: 1000, at: "2026-10-27T00:00:00Z" },
    latest: 0, stop_reason: null, requested_hz: 10, duration_s: 60, byte_cap: 8388608, ack: null });
  beforeFirstRun() { this.recorder = mapRecorderStatus(emptyRecorderStatus()); }
  pages: (Record<string, any> | Error)[] = [];
  inputs: { input: unknown; at: number }[] = [];
  discoveryCalls: number[] = [];
  connected = true;
  closed = 0;
  constructor(readonly clock = new ManualClock()) {}
  async discover(signal: AbortSignal): Promise<Discovery> {
    signal.throwIfAborted(); this.discoveryCalls.push(this.clock.ms);
    return this.connected ? { available: true, recorder: { ...this.recorder } } : { available: false, reason: "disconnected" };
  }
  async catchup(input: { run?: number; cursor?: unknown; now: false; detail: true }, signal: AbortSignal) {
    signal.throwIfAborted(); this.inputs.push({ input: structuredClone(input), at: this.clock.ms });
    const page = this.pages.shift();
    if (page instanceof Error) throw page;
    return page ?? this.page([], { record: (input.cursor as any)?.record ?? 0 });
  }
  page(records: Record<string, any>[], options: { record?: number; more?: boolean; gaps?: string[]; events?: Record<string, any>[]; now?: number } = {}) {
    return { schema: "xfb/catchup-1", cursor: { schema: "xfb/timeline-cursor-1", sid: this.recorder.session, run: this.recorder.run, world: this.recorder.world,
      record: options.record ?? records.at(-1)?.seq ?? 0, event: options.events?.at(-1)?.seq ?? 0, opaque_extra: { keep: [1, 2, 3] } },
      records, events: options.events ?? [], more: options.more ?? false, gaps: options.gaps ?? [],
      calibration: { source_s: options.now ?? records.at(-1)?.source_s ?? 1000 }, source: { active: true, dropped: 0, missed_deadlines: 0 },
      backlog: { seconds_behind: options.more ? 4 : 0 } };
  }
  close() { this.closed++; }
}
