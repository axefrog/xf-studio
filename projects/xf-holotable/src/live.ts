// Headless live-source policy. Polls only retained bridge data; no view or game-thread work.
import { randomUUID } from "node:crypto";
import type { ContentLevel, Gap, Session } from "./model.ts";
import { atLevel } from "./query.ts";
import { channelCoverage, ingest, TIME_GAP_S } from "./recording.ts";
import type { Discovery, LiveBridge, RecorderStatus } from "./live-bridge.ts";

export const LIVE_BOUNDS = {
  intervalMs: 1000, statusMs: 5000, reconnectMs: 5000, leaseMs: 15000,
  bytesPerSecond: 8 * 1024 * 1024, rowsPerSecond: 3072,
  pollBytes: 256 * 1024, pollRows: 256, retainedBytes: 64 * 1024 * 1024,
} as const;
type Json = Record<string, any>;
// A client must receive every known break before any samples it could draw across it.
const tracks = ["gaps", "v", "camera", "actors", "events"] as const;
export interface LiveCursor { epoch: number; v: number; camera: number; actors?: number; events: number; gaps: number }
export interface LiveState {
  available: boolean; recording: boolean; watching: boolean;
  phase: "idle" | "watching" | "waiting" | "disconnected" | "ended";
  behindS: number; more: boolean; droppedBatches: number; message: string;
}
export interface LiveUpdate {
  since: LiveCursor; reset: boolean; more: boolean; state: LiveState;
  meta: Session["meta"] | null;
  actors: NonNullable<Session["actors"]>; v: Session["v"]; camera: Session["camera"]; events: Session["events"]; gaps: Session["gaps"];
}
export interface LiveClock {
  now(): number;
  later(ms: number, fn: () => void): () => void;
}
const clock: LiveClock = { now: () => performance.now(), later(ms, fn) { const t = setTimeout(fn, ms); t.unref?.(); return () => clearTimeout(t); } };
const lostMessage = "The game stopped sending. Showing what arrived; Holotable reconnects when the game is back.";
const coded = (message: string) => Object.assign(new Error(message), { code: "bad_request" });

export function createLiveSource(bridge: LiveBridge, options: { clock?: LiveClock; changed?: (session: Session) => void; idle?: () => void } = {}) {
  const time = options.clock ?? clock;
  const clients = new Map<string, number>();
  let ctl = new AbortController(), cancelTimer: (() => void) | undefined, disposed = false;
  let cursor: unknown, epoch = 0, session: Session | null = null, lastSeq = 0, lastEvent = 0;
  let pendingGap: Gap["reason"] | undefined, lines = new Map<string, Json>(), retained = 0;
  let pendingActorGap: Gap["reason"] | undefined, lastActor: { t: number; seq: number } | undefined;
  let discovery: Discovery = { available: false, reason: "not_checked" }, statusAt = -Infinity;
  let statusJob: Promise<Discovery> | undefined, sourceJob: Promise<void> | undefined;
  let sourceAt = -Infinity, emptyReads = 0, lastPageAt = 0, sourceNow = 0;
  let stoppedDrained = false;
  let state: LiveState = { available: false, recording: false, watching: false, phase: "idle", behindS: 0, more: false, droppedBatches: 0, message: "" };
  const status = (): LiveState => ({ ...state, watching: clients.size > 0,
    behindS: session?.v.length ? Math.max(state.behindS, sourceNow - session.meta.to + (time.now() - lastPageAt) / 1000, 0) : state.behindS });
  function stopWork() {
    cancelTimer?.(); cancelTimer = undefined; ctl.abort(); ctl = new AbortController(); bridge.close();
    options.idle?.();
  }
  function expire() {
    for (const [id, deadline] of clients) if (time.now() >= deadline) clients.delete(id);
    if (!clients.size) { stopWork(); state = { ...state, watching: false }; return true; }
    return false;
  }
  async function discover(signal: AbortSignal): Promise<Discovery> {
    signal.throwIfAborted();
    if (time.now() - statusAt >= LIVE_BOUNDS.statusMs) {
      const statusSignal = AbortSignal.any([signal, ctl.signal]);
      statusJob ??= bridge.discover(statusSignal).then(d => {
        statusSignal.throwIfAborted();
        discovery = d; statusAt = time.now();
        state = { ...state, available: d.available, recording: d.available && d.recorder.active };
        return d;
      }).finally(() => { statusJob = undefined; });
      await statusJob;
    }
    signal.throwIfAborted(); return discovery;
  }
  function reset(r: RecorderStatus) {
    epoch++; cursor = undefined; lastSeq = lastEvent = 0; pendingGap = undefined; lines = new Map(); retained = 0;
    pendingActorGap = undefined; lastActor = undefined;
    stoppedDrained = false;
    session = { meta: { schema: "xfh/session-1", session: r.session!, run: r.run!, worldGeneration: r.world!, pluginVersion: "",
      start: r.start!, wallStart: r.wallStart, end: r.start!, from: r.start!, to: r.start!, channels: channelCoverage(r.channels), complete: false,
      dropped: 0, missedDeadlines: 0, largestGapS: 0, coverage: "Live recorder observations; runtime cadence uncommissioned.", problems: [] },
      v: [], camera: [], events: [], gaps: [] };
    state = { ...state, phase: "watching", more: false, droppedBatches: 0, behindS: 0, message: "" };
    // Withdraw the previous world's geometry even before the new run has its first V sample.
    options.changed?.(session);
  }
  function appendPage(page: Json): boolean {
    const s = session!, before = s.v.at(-1);
    const c = page.cursor;
    if (!c || c.sid !== s.meta.session || c.run !== s.meta.run || c.world !== s.meta.worldGeneration || !Array.isArray(page.records) || !Array.isArray(page.events)) throw Error("Live recorder identity changed");
    if (!Number.isFinite(page.calibration?.source_s)) throw Error("No source clock in live page");
    const receivedAt = time.now(), calibratedAt = page.calibration.host_after_ms;
    const sampledAt = Number.isFinite(calibratedAt) && calibratedAt <= receivedAt ? calibratedAt : receivedAt;
    const bytes = Buffer.byteLength(JSON.stringify(page)), rows = page.records.length + page.events.length;
    state = { ...state, more: page.more === true, behindS: page.backlog?.seconds_behind ?? 0, recording: page.source?.active === true };
    emptyReads = rows || page.more ? 0 : Math.min(emptyReads + 1, 3);
    // Advance the exact cursor even when a whole over-budget batch is dropped. Its loss remains visible.
    const oversized = bytes > LIVE_BOUNDS.bytesPerSecond || rows > LIVE_BOUNDS.rowsPerSecond;
    if (oversized) {
      for (const row of page.records as Json[]) {
        const coverage = s.meta.channels.find(c => c.name === row.channel);
        if (coverage) { coverage.read++; coverage.dropped++; coverage.reasons["batch budget"] = (coverage.reasons["batch budget"] ?? 0) + 1; }
      }
      cursor = c; sourceNow = page.calibration.source_s; lastPageAt = sampledAt;
      pendingGap = pendingActorGap = "missing"; state.droppedBatches++; s.meta.dropped += rows;
      const problem = "A live batch exceeded the byte or row budget and was dropped.";
      if (!s.meta.problems.includes(problem)) s.meta.problems.push(problem);
      return true;
    }
    // Validate the complete envelope before publishing anything or committing its cursor.
    let recordSeq = lastSeq, eventSeq = lastEvent, vTime = s.v.at(-1)?.t ?? -Infinity;
    if (!Number.isSafeInteger(c.record) || !Number.isSafeInteger(c.event)) throw Error("Invalid live cursor");
    for (const row of page.records as Json[]) {
      if (row.session !== s.meta.session || row.run !== s.meta.run || row.world_generation !== s.meta.worldGeneration || !Number.isSafeInteger(row.seq) || row.seq <= recordSeq || row.seq > c.record || !Number.isFinite(row.source_s) || Buffer.byteLength(JSON.stringify(row)) > 16384) throw Error("Invalid live recorder row");
      recordSeq = row.seq;
      if (row.channel === "v") { if (row.source_s < vTime) throw Error("Live source clock went backwards"); vTime = row.source_s; }
    }
    for (const e of page.events as Json[]) {
      if (!Number.isSafeInteger(e.seq) || e.seq <= eventSeq || e.seq > c.event) throw Error("Invalid live event sequence");
      eventSeq = e.seq;
    }
    if (retained + bytes > LIVE_BOUNDS.retainedBytes) {
      state = { ...state, phase: "ended", message: "The live session reached its memory budget. Open a recording to continue." };
      s.meta.problems.push("Live retention stopped at its 64 MiB input budget."); return false;
    }
    retained += bytes;
    cursor = c; sourceNow = page.calibration.source_s; lastPageAt = sampledAt;
    if (page.gaps?.length) pendingGap = pendingActorGap = "missing";
    for (const row of page.records as Json[]) {
      if (row.session !== s.meta.session || row.run !== s.meta.run || row.world_generation !== s.meta.worldGeneration || !Number.isSafeInteger(row.seq) || row.seq <= lastSeq || !Number.isFinite(row.source_s)) throw Error("Invalid live recorder row");
      if (lastSeq && row.seq !== lastSeq + 1) { pendingGap ??= "sequence"; pendingActorGap ??= "sequence"; }
      lastSeq = row.seq;
      // Actors can arrive without a valid V sample. Publish their loss independently,
      // before ingesting that delta; poll's gap-first ordering also holds across budgets.
      if (row.channel === "actors") {
        if (pendingActorGap) s.gaps.push({ from: lastActor?.t ?? row.source_s, to: row.source_s,
          fromSeq: lastActor?.seq ?? row.seq, toSeq: row.seq, reason: pendingActorGap, channel: "actors" });
        pendingActorGap = undefined; lastActor = { t: row.source_s, seq: row.seq };
      }
      const vec = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
      const d = row.data;
      const valid = (row.valid === true || row.channel === "actors") && d && (d.event === undefined || typeof d.event === "string") &&
        (row.channel !== "v" || vec(d.position) && Number.isFinite(d.yaw) && (!d.velocity || vec(d.velocity))) &&
        (row.channel !== "camera" || vec(d.camera?.position) && vec(d.camera?.forward) && vec(d.camera?.up) && Number.isFinite(d.camera?.fov) && Number.isFinite(d.camera?.aspect));
      if (!valid) {
        ingest({ ...row, valid: false }, s, seq => `recorder:${s.meta.session}:${s.meta.run}:${seq}`, lines);
        if (row.channel !== "actors") pendingGap = "invalid";
        continue;
      }
      const previous = s.v.at(-1);
      if (row.channel === "v" && previous) {
        if (row.source_s < previous.t) throw Error("Live source clock went backwards");
        s.meta.largestGapS = Math.max(s.meta.largestGapS, row.source_s - previous.t);
        const reason = pendingGap ?? (row.source_s - previous.t > TIME_GAP_S ? "time" : undefined);
        if (reason) {
          s.gaps.push({ from: previous.t, to: row.source_s, fromSeq: previous.seq, toSeq: row.seq, reason });
        }
        pendingGap = undefined;
      }
      ingest(row, s, seq => `recorder:${s.meta.session}:${s.meta.run}:${seq}`, lines);
    }
    // Session-feed events are separate evidence, scoped to the current world and recorder interval.
    for (const e of page.events as Json[]) {
      if (!Number.isSafeInteger(e.seq) || e.seq <= lastEvent) throw Error("Invalid live event sequence");
      lastEvent = e.seq;
      // Session events have source_s, but no top-level world id. Scope by this run's start;
      // honour the world when a particular receipt carries it in data.
      const eventWorld = e.data?.world_generation;
      if (eventWorld !== undefined && eventWorld !== s.meta.worldGeneration || !Number.isFinite(e.source_s) || e.source_s < s.meta.start) continue;
      s.events.push({ id: `session-${e.seq}`, kind: "session", t: e.source_s, seq: e.seq, summary: "Session event", level: "full",
        detail: JSON.stringify({ kind: e.kind, text: e.text, data: e.data }).slice(0, 4096), cite: `event:${s.meta.session}:${e.seq}` });
    }
    s.meta.dropped = Math.max(s.meta.dropped, page.source?.dropped ?? 0);
    s.meta.missedDeadlines = Math.max(s.meta.missedDeadlines, page.source?.missed_deadlines ?? 0);
    s.meta.end = sourceNow;
    if (s.v.length) s.meta.to = s.v.at(-1)!.t;
    if (s.v.at(-1) !== before || rows) options.changed?.(s);
    return true;
  }
  async function step() {
    if (disposed || expire() || sourceJob) return;
    const signal = ctl.signal;
    sourceJob = (async () => {
      try {
        const found = await discover(signal);
        if (!found.available) throw Error("Bridge unavailable");
        const r = found.recorder;
        const sameRun = session?.meta.session === r.session && session?.meta.run === r.run && session?.meta.worldGeneration === r.world;
        // An inactive recorder still owns a retained tail. Read it through more:false once;
        // never start observing a different stopped run merely because it was discovered.
        if (!r.run || !r.active && (!sameRun || stoppedDrained)) {
          state = { ...state, phase: "waiting", recording: false, message: "The recorder is off. It runs during XF test sessions." };
          return;
        }
        if (!sameRun) reset(r);
        if (r.active) stoppedDrained = false;
        if (state.phase === "ended") return;
        if (time.now() - sourceAt < LIVE_BOUNDS.intervalMs) return;
        sourceAt = time.now();
        const page = await bridge.catchup({ ...(cursor ? { cursor } : { run: r.run }), now: false, detail: true }, signal);
        signal.throwIfAborted();
        if (appendPage(page)) {
          stoppedDrained = !r.active && page.more !== true;
          state = { ...state, recording: r.active && state.recording, phase: stoppedDrained ? "waiting" : "watching", message: stoppedDrained ? "The recorder is off. It runs during XF test sessions." : "" };
        }
      } catch {
        if (!signal.aborted) {
          state = { ...state, phase: "disconnected", message: lostMessage, available: false };
          statusAt = -Infinity; bridge.close(); pendingGap = pendingActorGap = "missing";
        }
      }
    })();
    try { await sourceJob; } finally {
      sourceJob = undefined;
      if (!disposed && !expire()) {
        const wait = signal.aborted ? 0 : state.phase === "ended" ? LIVE_BOUNDS.leaseMs : state.phase === "disconnected" || state.phase === "waiting" ? LIVE_BOUNDS.reconnectMs : Math.min(5000, LIVE_BOUNDS.intervalMs * 2 ** emptyReads);
        cancelTimer = time.later(wait, () => { void step(); });
      }
    }
  }
  function renew(id: string) {
    if ((clients.get(id) ?? -Infinity) <= time.now()) { clients.delete(id); expire(); }
    if (!clients.has(id)) throw coded("That live watch expired. Watch again.");
    clients.set(id, time.now() + LIVE_BOUNDS.leaseMs);
  }
  function poll(id: string, since: LiveCursor | undefined, level: ContentLevel): LiveUpdate {
    renew(id);
    const lengths = Object.fromEntries(tracks.map(k => [k, session?.[k]?.length ?? 0]));
    const reset = !since || since.epoch !== epoch;
    const next: Required<LiveCursor> = reset ? { epoch, v: 0, camera: 0, actors: 0, events: 0, gaps: 0 } : { ...since, actors: since.actors ?? 0 };
    if (tracks.some(k => !Number.isSafeInteger(next[k]) || next[k] < 0 || next[k] > lengths[k])) throw coded("Invalid live update cursor");
    const result: LiveUpdate = { since: next, reset, more: false, meta: session ? structuredClone(session.meta) : null, state: status(), v: [], camera: [], actors: [], events: [], gaps: [] };
    let bytes = 0, rows = 0;
    for (const k of tracks) {
      const source = session?.[k] ?? [];
      while (next[k] < source.length && rows < LIVE_BOUNDS.pollRows) {
        const raw = source[next[k]], row = k === "events" ? atLevel(raw as Session["events"][number], level) : raw;
        const size = Buffer.byteLength(JSON.stringify(row));
        if (bytes + size > LIVE_BOUNDS.pollBytes) break;
        (result[k] as unknown[]).push(structuredClone(row)); next[k]++; rows++; bytes += size;
      }
      // In particular, byte pressure must not let samples bypass an undelivered gap.
      if (next[k] < source.length) break;
    }
    result.more = tracks.some(k => next[k] < lengths[k]);
    return result;
  }
  return {
    async status(signal: AbortSignal) { await discover(signal); return status(); },
    watch() {
      if (disposed) throw Error("Live source closed");
      const id = randomUUID(); clients.set(id, time.now() + LIVE_BOUNDS.leaseMs);
      if (!sourceJob) { cancelTimer?.(); void step(); }
      return { watch: id };
    },
    poll,
    renew,
    stop(id: string) { clients.delete(id); expire(); },
    session: () => session,
    close() { disposed = true; clients.clear(); stopWork(); },
  };
}
