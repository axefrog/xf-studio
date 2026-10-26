// A batch's telemetry, always on: the recorder on every channel from setup to teardown (started again after each
// game restart), and at each row's end its slice of everything, in one telemetry folder per run:
//
//   telemetry/a<attempt>/<row>/catchup.json         game.catchup since the previous row: events, recorder samples, alerts
//   telemetry/a<attempt>/<row>/overlay-state.json   overlay.state (frames, CPU time per frame, motion, the CET overlay)
//   telemetry/a<attempt>/<row>/bridge-info.json     bridge.info
//   telemetry/a<attempt>/<row>/plugin-log.txt       the plugin log's lines written during the row (the CET layer logs there too)
//   telemetry/a<attempt>/<row>/memory.json          free commit, the game's private bytes, working set and handles, the system's handles
//   logs/a<attempt>/xfruntimebridge-<time>.log      every plugin log written during the attempt, whole: kept before each
//                                                   launch and at the attempt's end, so a restart (a new log, the old
//                                                   ones rotated away) never loses evidence (scripted session 1 lost
//                                                   the overlay.fonts line this way)
//
// Collecting never fails a row: what couldn't be read is listed in the row's telemetry summary (missing). The summary
// also carries the plugin log lines that match the halt patterns (a draw call that failed, the overlay stopping), so
// the batch can stop early on a significant bug.
//
// Each row's catch-up is drained to the end (every page, so nothing backs up behind a slow row), and every page is
// added to the batch's summary (summary(): per-channel records and invalid samples, the gaps, the coverage loss and the
// rows they came in), which whole-batch passive rows judge at the end. A game load stops the recorder (its reason:
// load_requested), so the batch marks the run stale after a prelude that loaded, and a catch-up the bridge refuses
// marks it stale too: the next row starts a fresh run instead of reading a dead one.

import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { CommandApi } from "../api/command-api.ts";
import type { Host } from "./host.ts";
import type { PlanClock } from "./plan.ts";

export const ALL_CHANNELS = ["v", "actors", "camera", "subtitles", "voice", "face", "ui", "contacts", "supervisor", "incidents"];
/** Plugin log lines that mean a significant bug (the batch's draw_call halt). Fixtures halt_patterns add more. */
export const DEFAULT_HALT_PATTERNS = ["draw call failed", "evt=overlay\\.stopped", "lvl=fatal"];
/** The recorder's longest lifetime is 1800 s; it is started again a little before that. */
const RECORDER_S = 1800;
const LOG_SLICE_MAX = 4 * 1024 * 1024;

export type RowTelemetry = {
  dir: string;
  files: string[];
  recorder: { run?: number; restarted?: boolean; unavailable?: string; records?: unknown; gaps?: unknown };
  memory?: { free_commit_gb: number | null; game_private_gb?: number; game_working_set_gb?: number; game_handles?: number; system_handles?: number | null };
  frames?: { frames?: number; cpu_ms?: number; cpu_ms_max?: number; drawing_now?: boolean; cet_open?: boolean };
  log_lines: number;
  log_matches: string[];
  missing: string[];
};

export type TelemetryOptions = {
  api: Pick<CommandApi, "run">;
  host: Host;
  outDir: string;
  attempt: number;
  clock: PlanClock;
  /**
   * The folders that may hold the plugin's logs (xfruntimebridge-<time>.log): fixtures logs.plugin_dir, MO2's
   * overwrite/red4ext/logs (under MO2 the game's new files land there) and <game_dir>/red4ext/logs. The newest wins.
   */
  pluginLogDirs?: string[];
  haltPatterns?: string[];
};

/** The newest plugin log across the folders (the live one, not a rotated .1.log), by modification time. */
export function newestPluginLog(dirs: (string | undefined)[] | undefined): string | undefined {
  let best: { path: string; mtime: number } | undefined;
  for (const dir of dirs ?? []) {
    if (!dir || !existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!/^xfruntimebridge-.*\.log$/i.test(name) || /\.\d+\.log$/i.test(name)) continue;
      const path = join(dir, name);
      const mtime = statSync(path).mtimeMs;
      if (!best || mtime > best.mtime) best = { path, mtime };
    }
  }
  return best?.path;
}

/** What the batch's whole recorder history came to: per channel, the gaps, the coverage loss, and where invalid samples fell. */
export type TelemetrySummary = {
  runs: number[];
  pages: number;
  rows: string[];
  gaps: string[];
  channels: Record<string, { records: number; invalid: number; valid: number }>;
  coverage: { dropped: number; invalid: number; missed_deadlines: number; file_error: boolean };
  invalid_in: { row: string; channel: string; invalid: number }[];
  gaps_in: { row: string; gaps: string[] }[];
  unread: string[];
  /**
   * Samples the recorder marked not_ready (0.8.22: a subtitle or voice tap with no controllers yet, in a run's first
   * 2 s): valid records, counted apart from invalid ones. From the recorder's own status, per run and per channel.
   */
  not_ready: { total: number; by_channel: Record<string, number>; runs: Record<string, number> };
  /**
   * Each run's taps as the recorder's status last reported them (channel_stats.<ch>.ready, tap_not_ready,
   * complete_coverage), and every run whose tap never became ready ("run 3: voice"): such a run's coverage isn't complete.
   */
  taps: { runs: Record<string, { ready: Record<string, boolean>; tap_not_ready: string[]; complete_coverage: boolean }>; never_ready: string[];
    /** Readiness that is unknown: a run the batch recorded with no successful report, or a tap a report left out. Never a pass. */
    unknown: string[] };
};

/** The recorder channels with a readiness the recorder reports (0.8.22: the subtitle and voice taps). */
export const TAP_CHANNELS = ["subtitles", "voice"];

function readFrom(path: string, from: number): string {
  const size = statSync(path).size;
  const start = Math.max(from, size - LOG_SLICE_MAX);
  if (size <= start) return "";
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

export class Telemetry {
  readonly dir: string;
  private run?: number;
  private sid?: string;
  private startedMs = -Infinity;
  private cursor?: unknown;
  private unavailable?: string;
  private mark?: { file: string; size: number };
  private readonly patterns: RegExp[];
  private readonly total: TelemetrySummary = { runs: [], pages: 0, rows: [], gaps: [], channels: {}, coverage: { dropped: 0, invalid: 0, missed_deadlines: 0, file_error: false }, invalid_in: [], gaps_in: [], unread: [],
    not_ready: { total: 0, by_channel: {}, runs: {} }, taps: { runs: {}, never_ready: [], unknown: [] } };
  /** A load ended the run: read it to its end before the next starts. */
  private stale = false;
  /** Every recorder run this batch started, whose readiness it must have seen reported. */
  private readonly startedRuns: number[] = [];
  private readonly notReadyByRun: Record<string, Record<string, number>> = {};

  /** When the attempt started (wall clock: log files carry wall-clock times), and the logs kept so far. */
  private readonly since = Date.now();
  readonly keptLogs: string[] = [];

  constructor(private readonly o: TelemetryOptions) {
    this.dir = join(o.outDir, "telemetry", `a${o.attempt}`);
    mkdirSync(this.dir, { recursive: true });
    this.patterns = (o.haltPatterns ?? DEFAULT_HALT_PATTERNS).map((p) => new RegExp(p, "i"));
  }

  /**
   * Copies every plugin log (rotated ones too) written since the attempt started into logs/a<attempt>/, whole; a copy
   * is refreshed when its source has grown. Answers the copies made or refreshed now. Never throws.
   */
  keepLogs(): string[] {
    const dest = join(this.o.outDir, "logs", `a${this.o.attempt}`);
    const copied: string[] = [];
    for (const dir of this.o.pluginLogDirs ?? []) {
      try {
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir)) {
          if (!/^xfruntimebridge-.*\.log$/i.test(name)) continue;
          const from = join(dir, name), to = join(dest, name);
          const stat = statSync(from);
          // A minute's slack: a log the game was writing as the attempt began.
          if (stat.mtimeMs < this.since - 60_000) continue;
          if (existsSync(to) && statSync(to).size === stat.size) continue;
          mkdirSync(dest, { recursive: true });
          copyFileSync(from, to);
          copied.push(to);
          if (!this.keptLogs.includes(to)) this.keptLogs.push(to);
        }
      } catch {
        // A folder that can't be read keeps nothing; the row slices still list what was missing.
      }
    }
    return copied;
  }

  private async read(name: string, input: Record<string, unknown> = {}) {
    const out = await this.o.api.run(name, input, { source: "session-telemetry" });
    return out.ok ? { ok: true as const, value: out.result } : { ok: false as const, code: out.error.code, message: out.error.message };
  }

  /** The recorder on every channel, for this bridge session: started when the game (re)started or its lifetime nears its end. */
  async ensureRecorder(): Promise<{ run?: number; restarted: boolean; unavailable?: string }> {
    const info = await this.read("bridge.info");
    const sid = info.ok ? (info.value as { sid?: string }).sid : undefined;
    if (!sid) return { restarted: false, unavailable: info.ok ? "the bridge reports no session" : `bridge.info: ${info.code}` };
    const fresh = this.run !== undefined && !this.stale && sid === this.sid && this.o.clock.now() - this.startedMs < (RECORDER_S - 120) * 1000;
    if (fresh) return { run: this.run, restarted: false };
    // The run this session still has (it rolls over, or a load ended it): stopped, read to its end and so acknowledged,
    // before the next starts (the bridge refuses a start, recording_busy, while a run's records are unread).
    if (this.run !== undefined && sid === this.sid) {
      this.noteStatus(this.run, await this.read("test.record.stop"));
      await this.drain(`recorder run ${this.run} (to its end)`, (name, value) => writeFileSync(join(this.dir, `run-${this.run}-end-${name}`), JSON.stringify(value, null, 2) + "\n")).catch(() => null);
    }
    this.stale = false;
    let started = await this.read("test.record.start", { channels: ALL_CHANNELS, duration_s: RECORDER_S });
    if (!started.ok && /recording_active|busy/.test(started.code)) {
      await this.read("test.record.stop");
      started = await this.read("test.record.start", { channels: ALL_CHANNELS, duration_s: RECORDER_S });
    }
    if (!started.ok) {
      this.unavailable = `test.record.start: ${started.code}`;
      this.run = undefined;
      return { restarted: false, unavailable: this.unavailable };
    }
    this.run = (started.value as { run?: number }).run;
    if (this.run !== undefined && !this.startedRuns.includes(this.run)) this.startedRuns.push(this.run);
    this.sid = sid;
    this.startedMs = this.o.clock.now();
    this.cursor = undefined;
    this.unavailable = undefined;
    return { run: this.run, restarted: true };
  }

  /** Where the plugin log stands now, so the row's slice starts here. */
  markRow() {
    const file = newestPluginLog(this.o.pluginLogDirs);
    this.mark = file ? { file, size: statSync(file).size } : undefined;
  }

  /** The plugin log since markRow (a restart's new log from its start, after the old one's tail). */
  private logSlice(): string {
    const now = newestPluginLog(this.o.pluginLogDirs);
    if (!now) return "";
    if (!this.mark) return readFrom(now, 0);
    if (this.mark.file === now) return readFrom(now, this.mark.size);
    return (existsSync(this.mark.file) ? readFrom(this.mark.file, this.mark.size) : "") + readFrom(now, 0);
  }

  /** The row's slice of everything, written to its folder; never throws. */
  async collect(rowKey: string): Promise<RowTelemetry> {
    const dir = join(this.dir, rowKey.replace(/[^A-Za-z0-9._-]/g, "-"));
    mkdirSync(dir, { recursive: true });
    const files: string[] = [];
    const missing: string[] = [];
    const save = (name: string, value: unknown) => {
      const path = join(dir, name);
      writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
      files.push(relative(this.o.outDir, path));
    };
    const out: RowTelemetry = { dir: relative(this.o.outDir, dir), files, recorder: {}, log_lines: 0, log_matches: [], missing };
    try {
      if (this.run !== undefined) {
        await this.readStatus();
        const drained = await this.drain(rowKey, (name, value) => save(name, value));
        out.recorder = drained.ok ? { run: drained.run, records: drained.counts, gaps: drained.gaps } : { run: drained.run, unavailable: drained.code };
        if (!drained.ok) missing.push(`game.catchup: ${drained.code}`);
      } else out.recorder = { unavailable: this.unavailable ?? "no recorder" };
      const overlay = await this.read("overlay.state");
      if (overlay.ok) {
        save("overlay-state.json", overlay.value);
        const v = overlay.value as Record<string, unknown>;
        out.frames = { frames: v.frames as number, cpu_ms: v.cpu_ms as number, cpu_ms_max: v.cpu_ms_max as number, drawing_now: v.drawing_now as boolean, cet_open: v.cet_open as boolean };
      } else missing.push(`overlay.state: ${overlay.code}`);
      const info = await this.read("bridge.info");
      if (info.ok) save("bridge-info.json", info.value); else missing.push(`bridge.info: ${info.code}`);
    } catch (error) {
      missing.push(`bridge reads: ${String(error)}`);
    }
    try {
      const text = this.logSlice();
      if (text) save("plugin-log.txt", text);
      const lines = text.split(/\r?\n/).filter(Boolean);
      out.log_lines = lines.length;
      out.log_matches = lines.filter((line) => this.patterns.some((p) => p.test(line))).slice(0, 20);
      if (!this.o.pluginLogDirs?.length) missing.push("plugin log: no folder (fixtures game_dir, mo2.exe or logs.plugin_dir)");
      else if (!newestPluginLog(this.o.pluginLogDirs)) missing.push("plugin log: none found in its folders");
    } catch (error) {
      missing.push(`plugin log: ${String(error)}`);
    }
    try {
      const free = await this.o.host.freeCommitBytes();
      const game = await this.o.host.gameProcess();
      const stats = game ? await this.o.host.processStats(game.pid) : null;
      const gb = (n: number) => Number((n / 1024 ** 3).toFixed(2));
      out.memory = {
        free_commit_gb: free === null ? null : gb(free),
        ...(stats ? { game_private_gb: gb(stats.private_bytes), game_working_set_gb: gb(stats.working_set), game_handles: stats.handles } : {}),
        system_handles: await this.o.host.systemHandles(),
      };
      save("memory.json", out.memory);
    } catch (error) {
      missing.push(`memory: ${String(error)}`);
    }
    this.markRow();
    return out;
  }

  /**
   * The run's catch-up from the cursor to the end (at most 20 pages), each page saved and added to the summary. A
   * refusal marks the run stale (a load stopped it, or another recorder replaced it), so the next row starts afresh.
   */
  private async drain(rowKey: string, save: (name: string, value: unknown) => void): Promise<{ ok: boolean; run?: number; code?: string; counts?: unknown; gaps?: unknown }> {
    const run = this.run!;
    let counts: unknown, gaps: string[] = [];
    for (let page = 1; page <= 20; page++) {
      const read = await this.read("game.catchup", this.cursor ? { cursor: this.cursor } : { run });
      if (!read.ok) {
        this.total.unread.push(`${rowKey}: run ${run}: ${read.code}`);
        this.forget();
        return { ok: false, run, code: read.code };
      }
      const value = read.value as { cursor?: unknown; counts?: unknown; gaps?: string[]; more?: boolean; count_detail?: Record<string, { records?: number; invalid?: number; valid?: number }>;
        coverage_delta?: { dropped?: number; invalid?: number; missed_deadlines?: number; file_error?: boolean } };
      this.cursor = value.cursor ?? this.cursor;
      save(page === 1 ? "catchup.json" : `catchup-${page}.json`, value);
      counts = value.counts;
      gaps = [...new Set([...gaps, ...(value.gaps ?? [])])];
      this.add(rowKey, run, value);
      if (!value.more) break;
    }
    return { ok: true, run, counts, gaps };
  }

  private add(rowKey: string, run: number, page: { gaps?: string[]; count_detail?: Record<string, { records?: number; invalid?: number; valid?: number }>; coverage_delta?: { dropped?: number; invalid?: number; missed_deadlines?: number; file_error?: boolean } }) {
    const t = this.total;
    if (!t.runs.includes(run)) t.runs.push(run);
    if (!t.rows.includes(rowKey)) t.rows.push(rowKey);
    t.pages++;
    if (page.gaps?.length) {
      t.gaps = [...new Set([...t.gaps, ...page.gaps])];
      t.gaps_in.push({ row: rowKey, gaps: page.gaps });
    }
    for (const [channel, d] of Object.entries(page.count_detail ?? {})) {
      const c = (t.channels[channel] ??= { records: 0, invalid: 0, valid: 0 });
      c.records += d.records ?? 0;
      c.invalid += d.invalid ?? 0;
      c.valid += d.valid ?? 0;
      if (d.invalid) t.invalid_in.push({ row: rowKey, channel, invalid: d.invalid });
    }
    const delta = page.coverage_delta ?? {};
    t.coverage.dropped += delta.dropped ?? 0;
    t.coverage.invalid += delta.invalid ?? 0;
    t.coverage.missed_deadlines += delta.missed_deadlines ?? 0;
    t.coverage.file_error ||= delta.file_error === true;
  }

  /**
   * A load stopped the run: the next ensureRecorder reads it to its end (acknowledging it) and starts a fresh one. The
   * run and its cursor are kept for that drain.
   */
  invalidate() {
    this.stale = true;
  }

  /** The bridge refused the run (another recorder replaced it): nothing of it is left to read. */
  private forget() {
    this.run = undefined;
    this.cursor = undefined;
  }

  /** The batch's recorder history so far (whole-batch passive rows read it as $telemetry). */
  /** The recorder's own status for this run (its not_ready counts; a read that acknowledges nothing). */
  private async readStatus() {
    const run = this.run;
    if (run === undefined) return;
    this.noteStatus(run, await this.read("test.record.read", { run, since: 0, limit: 1 }).catch(() => ({ ok: false as const })));
  }

  /** Keeps a run's not_ready counts (the status's counters are the run's totals so far: the latest reading wins). */
  private noteStatus(run: number, read: { ok: boolean; value?: unknown }) {
    const status = read.ok ? (read.value as { not_ready?: number; tap_not_ready?: string[]; complete_coverage?: boolean; channel_stats?: Record<string, { not_ready?: number; ready?: boolean }> } | undefined) : undefined;
    if (status && Array.isArray(status.tap_not_ready)) {
      const taps = this.total.taps;
      const ready = Object.fromEntries(Object.entries(status.channel_stats ?? {}).filter(([, c]) => typeof c?.ready === "boolean").map(([ch, c]) => [ch, c.ready!]));
      taps.runs[String(run)] = { ready, tap_not_ready: [...status.tap_not_ready], complete_coverage: status.complete_coverage !== false };
      taps.never_ready = Object.entries(taps.runs).flatMap(([r, t]) => t.tap_not_ready.map((ch) => `run ${r}: ${ch}`));
    }
    if (typeof status?.not_ready !== "number") return;
    const t = this.total.not_ready;
    t.runs[String(run)] = status.not_ready;
    this.notReadyByRun[String(run)] = Object.fromEntries(Object.entries(status.channel_stats ?? {}).filter(([, c]) => typeof c?.not_ready === "number").map(([ch, c]) => [ch, c.not_ready!]));
    t.total = Object.values(t.runs).reduce((a, b) => a + b, 0);
    t.by_channel = {};
    for (const channels of Object.values(this.notReadyByRun)) for (const [ch, n] of Object.entries(channels)) t.by_channel[ch] = (t.by_channel[ch] ?? 0) + n;
  }

  summary(): TelemetrySummary {
    const out = structuredClone(this.total);
    out.taps.unknown = this.startedRuns.flatMap((run) => {
      const entry = out.taps.runs[String(run)];
      if (!entry) return [`run ${run}: no readiness report (the recorder's status couldn't be read)`];
      return TAP_CHANNELS.filter((ch) => typeof entry.ready[ch] !== "boolean").map((ch) => `run ${run}: ${ch}: no readiness reported`);
    });
    return out;
  }

  /** The end of the run: the rest of the history, then the recorder stopped. */
  async finish() {
    // Stopped first, so the last drain reaches the run's real end (nothing more is recorded after it) and acknowledges it.
    const run = this.run;
    const stopped = await this.read("test.record.stop").catch(() => ({ ok: false as const }));
    if (run !== undefined) this.noteStatus(run, stopped);
    if (run !== undefined) {
      await this.drain("end", (name, value) => writeFileSync(join(this.dir, `final-${name}`), JSON.stringify(value, null, 2) + "\n")).catch(() => null);
    }
    this.run = undefined;
    // This attempt's evidence, for the whole-batch rows of every later attempt (mergeSummaries).
    writeFileSync(join(this.dir, "summary.json"), JSON.stringify(this.total, null, 2) + "\n");
  }
}

/**
 * The whole-batch evidence over several attempts, each attempt's summary in order. Counts add up, lists join, and
 * what names a run is prefixed with its attempt ("attempt 1: run 3: voice"; not_ready and taps runs as "a1:3"), since
 * run numbers start again with each game session. An attempt with no summary (it never finished) is listed in
 * missing_attempts: its evidence is unknown, never read as clean.
 */
export function mergeSummaries(attempts: { attempt: number; summary?: TelemetrySummary }[]): TelemetrySummary & { attempts: number[]; missing_attempts: number[] } {
  const out: TelemetrySummary & { attempts: number[]; missing_attempts: number[] } = { runs: [], pages: 0, rows: [], gaps: [], channels: {}, coverage: { dropped: 0, invalid: 0, missed_deadlines: 0, file_error: false },
    invalid_in: [], gaps_in: [], unread: [], not_ready: { total: 0, by_channel: {}, runs: {} }, taps: { runs: {}, never_ready: [], unknown: [] }, attempts: [], missing_attempts: [] };
  for (const { attempt, summary: s } of attempts) {
    out.attempts.push(attempt);
    if (!s) { out.missing_attempts.push(attempt); continue; }
    const tag = (text: string) => `attempt ${attempt}: ${text}`;
    out.runs.push(...(s.runs ?? []));
    out.pages += s.pages ?? 0;
    out.rows.push(...(s.rows ?? []).map(tag));
    out.gaps = [...new Set([...out.gaps, ...(s.gaps ?? [])])];
    for (const [ch, c] of Object.entries(s.channels ?? {})) {
      const t = (out.channels[ch] ??= { records: 0, invalid: 0, valid: 0 });
      t.records += c.records; t.invalid += c.invalid; t.valid += c.valid;
    }
    const cov = s.coverage ?? { dropped: 0, invalid: 0, missed_deadlines: 0, file_error: false };
    out.coverage = { dropped: out.coverage.dropped + cov.dropped, invalid: out.coverage.invalid + cov.invalid, missed_deadlines: out.coverage.missed_deadlines + cov.missed_deadlines, file_error: out.coverage.file_error || cov.file_error };
    out.invalid_in.push(...(s.invalid_in ?? []).map((e) => ({ ...e, row: tag(e.row) })));
    out.gaps_in.push(...(s.gaps_in ?? []).map((e) => ({ ...e, row: tag(e.row) })));
    out.unread.push(...(s.unread ?? []).map(tag));
    const nr = s.not_ready ?? { total: 0, by_channel: {}, runs: {} };
    out.not_ready.total += nr.total;
    for (const [ch, n] of Object.entries(nr.by_channel)) out.not_ready.by_channel[ch] = (out.not_ready.by_channel[ch] ?? 0) + n;
    for (const [run, n] of Object.entries(nr.runs)) out.not_ready.runs[`a${attempt}:${run}`] = n;
    const taps = s.taps ?? { runs: {}, never_ready: [], unknown: [] };
    for (const [run, t] of Object.entries(taps.runs)) out.taps.runs[`a${attempt}:${run}`] = t;
    out.taps.never_ready.push(...taps.never_ready.map(tag));
    out.taps.unknown.push(...(taps.unknown ?? []).map(tag));
  }
  return out;
}

/** Each earlier attempt's summary (telemetry/a<n>/summary.json), or none where that attempt didn't finish. */
export function earlierSummaries(outDir: string, attempt: number): { attempt: number; summary?: TelemetrySummary }[] {
  const out: { attempt: number; summary?: TelemetrySummary }[] = [];
  for (let a = 1; a < attempt; a++) {
    const path = join(outDir, "telemetry", `a${a}`, "summary.json");
    try { out.push({ attempt: a, summary: existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined }); }
    catch { out.push({ attempt: a }); }
  }
  return out;
}
