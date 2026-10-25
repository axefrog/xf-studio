// A batch's telemetry, always on: the recorder on every channel from setup to teardown (started again after each
// game restart), and at each row's end its slice of everything, in one telemetry folder per run:
//
//   telemetry/a<attempt>/<row>/catchup.json         game.catchup since the previous row: events, recorder samples, alerts
//   telemetry/a<attempt>/<row>/overlay-state.json   overlay.state (frames, CPU time per frame, motion, the CET overlay)
//   telemetry/a<attempt>/<row>/bridge-info.json     bridge.info
//   telemetry/a<attempt>/<row>/plugin-log.txt       the plugin log's lines written during the row (the CET layer logs there too)
//   telemetry/a<attempt>/<row>/memory.json          free commit, the game's private bytes, working set and handles, the system's handles
//
// Collecting never fails a row: what couldn't be read is listed in the row's telemetry summary (missing). The summary
// also carries the plugin log lines that match the halt patterns (a draw call that failed, the overlay stopping), so
// the batch can stop early on a significant bug.

import { existsSync, mkdirSync, openSync, readSync, closeSync, readdirSync, statSync, writeFileSync } from "node:fs";
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
  /** The folder holding the plugin's logs (xfruntimebridge-<time>.log): fixtures logs.plugin_dir, else <game_dir>/red4ext/logs. */
  pluginLogDir?: string;
  haltPatterns?: string[];
};

/** The newest plugin log in a folder (the live one, not a rotated .1.log). */
export function newestPluginLog(dir: string | undefined): string | undefined {
  if (!dir || !existsSync(dir)) return undefined;
  const logs = readdirSync(dir).filter((n) => /^xfruntimebridge-.*\.log$/i.test(n) && !/\.\d+\.log$/i.test(n)).sort();
  return logs.length ? join(dir, logs.at(-1)!) : undefined;
}

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

  constructor(private readonly o: TelemetryOptions) {
    this.dir = join(o.outDir, "telemetry", `a${o.attempt}`);
    mkdirSync(this.dir, { recursive: true });
    this.patterns = (o.haltPatterns ?? DEFAULT_HALT_PATTERNS).map((p) => new RegExp(p, "i"));
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
    const fresh = this.run !== undefined && sid === this.sid && this.o.clock.now() - this.startedMs < (RECORDER_S - 120) * 1000;
    if (fresh) return { run: this.run, restarted: false };
    if (this.run !== undefined && sid === this.sid) await this.read("test.record.stop");
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
    this.sid = sid;
    this.startedMs = this.o.clock.now();
    this.cursor = undefined;
    this.unavailable = undefined;
    return { run: this.run, restarted: true };
  }

  /** Where the plugin log stands now, so the row's slice starts here. */
  markRow() {
    const file = newestPluginLog(this.o.pluginLogDir);
    this.mark = file ? { file, size: statSync(file).size } : undefined;
  }

  /** The plugin log since markRow (a restart's new log from its start, after the old one's tail). */
  private logSlice(): string {
    const now = newestPluginLog(this.o.pluginLogDir);
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
        const page = await this.read("game.catchup", this.cursor ? { cursor: this.cursor } : { run: this.run });
        if (page.ok) {
          const value = page.value as { cursor?: unknown; counts?: unknown; gaps?: unknown };
          this.cursor = value.cursor ?? this.cursor;
          save("catchup.json", value);
          out.recorder = { run: this.run, records: value.counts, gaps: value.gaps };
        } else {
          missing.push(`game.catchup: ${page.code}`);
          out.recorder = { run: this.run, unavailable: page.code };
          if (/invalid_cursor|recording_changed/.test(page.code)) this.cursor = undefined;
        }
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
      if (!this.o.pluginLogDir) missing.push("plugin log: no folder (fixtures game_dir or logs.plugin_dir)");
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

  /** The end of the run: the last page, then the recorder stopped. */
  async finish() {
    if (this.run !== undefined) {
      const page = await this.read("game.catchup", this.cursor ? { cursor: this.cursor } : { run: this.run }).catch(() => null);
      if (page?.ok) writeFileSync(join(this.dir, "final-catchup.json"), JSON.stringify(page.value, null, 2) + "\n");
    }
    await this.read("test.record.stop").catch(() => null);
    this.run = undefined;
  }
}
