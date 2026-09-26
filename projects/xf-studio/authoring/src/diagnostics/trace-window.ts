/**
 * The always-on rolling detail window (docs/diagnostics.md §Rolling window): a private, local record of what the resolver and the
 * preparations decided in the last half hour, so a problem report already holds the lead-up and nobody has to switch anything on
 * and reproduce it. It keeps references and decisions (paths, hashes, archive names, request parameters, outcomes), never payloads.
 *
 * - **Bounded twice.** Segment files in `<data>/diagnostics/trace/`; segments older than the window's time, and the oldest beyond its
 *   size, are deleted. One event is at most `EVENT_BYTES` (a V's resolution has its own, larger bound); a larger one keeps the
 *   fields it asked to keep, else its keys, and says how big it was.
 * - **Redacted as written**, string by string, with the host's known folders and the shared personal-data rules (the report redacts
 *   again).
 * - **Diagnostic mode** (`deep`) widens the window and turns on the costlier events; it turns itself off after `DEEP_MODE_HOURS`.
 * - **Never sent.** Only a report the person saves carries any of it, and only the parts they leave selected.
 *
 * Writes are buffered and flushed within a second (or at 64 KB, or before a read); a failed write is dropped, never thrown.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { boundJson, LARGE_EVENT_BYTES, TRACE_JSON_BOUNDS, type DiagnosticTrace, type TraceEntry, type TraceEventOptions } from "./model";
import { redactValue, textRedactor, type Redactor } from "./redact";

export type TraceMode = "normal" | "deep";
export const TRACE_BOUNDS: Readonly<Record<TraceMode, { minutes: number; bytes: number }>> = Object.freeze({
  normal: { minutes: 30, bytes: 8 * 1024 * 1024 },
  deep: { minutes: 180, bytes: 64 * 1024 * 1024 },
});
/** Diagnostic mode switches itself off after this long, so a forgotten switch doesn't keep the larger window for good. */
export const DEEP_MODE_HOURS = 24;
/** One event's serialized bound. */
export const EVENT_BYTES = 512 * 1024;
const FLUSH_BYTES = 64 * 1024;
const SEGMENT = /^(\d{13})\.jsonl$/;

export type TraceState = { mode: TraceMode; until: string | null; minutes: number; bytes: number; used: number };

export class TraceWindow implements DiagnosticTrace {
  private readonly folder: string;
  private readonly modeFile: string;
  private buffer: string[] = [];
  private buffered = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private segment: { file: string; started: number; bytes: number } | null = null;
  private modeCache: { mode: TraceMode; until: number | null } | null = null;
  private readonly redactor: () => Redactor;
  constructor(readonly directory: string, private readonly now: () => number = Date.now, redactor?: () => Redactor) {
    const plain = textRedactor();
    this.redactor = redactor ?? (() => plain);
    this.folder = resolve(directory, "trace");
    this.modeFile = resolve(directory, "mode.json");
  }

  private modeState(): { mode: TraceMode; until: number | null } {
    if (!this.modeCache) {
      let mode: TraceMode = "normal", until: number | null = null;
      try {
        const stored = JSON.parse(readFileSync(this.modeFile, "utf8"));
        if (stored?.mode === "deep" && typeof stored.until === "string") { mode = "deep"; until = Date.parse(stored.until); }
      } catch { /* Normal mode. */ }
      this.modeCache = { mode, until };
    }
    // Diagnostic mode lapses by itself.
    if (this.modeCache.mode === "deep" && (this.modeCache.until === null || !(this.modeCache.until > this.now()))) this.setMode("normal");
    return this.modeCache;
  }
  get mode(): TraceMode { return this.modeState().mode; }
  get deep(): boolean { return this.mode === "deep"; }
  /** Switch diagnostic mode on (for `DEEP_MODE_HOURS`) or off; persisted in the data folder. */
  setMode(mode: TraceMode): TraceState {
    const until = mode === "deep" ? this.now() + DEEP_MODE_HOURS * 3_600_000 : null;
    this.modeCache = { mode, until };
    try {
      mkdirSync(this.directory, { recursive: true });
      if (mode === "deep") writeFileSync(this.modeFile, JSON.stringify({ mode, until: new Date(until!).toISOString() }));
      else rmSync(this.modeFile, { force: true });
    } catch { /* The mode still applies for this run. */ }
    return this.state();
  }
  state(): TraceState {
    const { mode, until } = this.modeState(), bounds = TRACE_BOUNDS[mode];
    return { mode, until: until ? new Date(until).toISOString() : null, minutes: bounds.minutes, bytes: bounds.bytes, used: this.bytes() };
  }

  event(area: string, event: string, data?: Readonly<Record<string, unknown>>, options: TraceEventOptions = {}): void {
    try {
      const redact = this.redactor();
      const bounds = options.items ? { ...TRACE_JSON_BOUNDS, items: options.items } : TRACE_JSON_BOUNDS;
      // Redacted as a value tree, never as serialised text, so a pattern can't break a JSON escape (DIAG-03).
      const clean = data ? redactValue(boundJson(data, bounds) as Record<string, unknown>, redact) : undefined;
      const entry: TraceEntry = { t: new Date(this.now()).toISOString(), area: redact(area), event: redact(event), ...(clean ? { data: clean } : {}) };
      const limit = Math.min(Math.max(options.bytes ?? EVENT_BYTES, EVENT_BYTES), LARGE_EVENT_BYTES);
      let line = JSON.stringify(entry);
      if (line.length > limit && clean) {
        const bytes = line.length;
        const kept = Object.fromEntries((options.keep ?? []).filter(key => key in clean).map(key => [key, clean[key]]));
        const keys = Object.keys(clean).slice(0, 40);
        line = JSON.stringify({ ...entry, data: { truncated: true, bytes, keys, ...kept } });
        if (line.length > limit) line = JSON.stringify({ ...entry, data: { truncated: true, bytes, keys } });
      }
      line += "\n";
      this.buffer.push(line);
      this.buffered += line.length;
      if (this.buffered >= FLUSH_BYTES) this.flush();
      else if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), 1_000);
        (this.timer as { unref?: () => void }).unref?.();
      }
    } catch { /* The window must never stop the work it watches. */ }
  }

  /** Write buffered events, rotating and pruning segments. */
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.buffer.length) return;
    const text = this.buffer.join("");
    this.buffer = []; this.buffered = 0;
    try {
      mkdirSync(this.folder, { recursive: true });
      const bounds = TRACE_BOUNDS[this.mode], now = this.now();
      // Eight segments per window, so pruning by time or size drops an eighth at a time.
      if (!this.segment || this.segment.bytes > bounds.bytes / 8 || now - this.segment.started > bounds.minutes * 60_000 / 8) {
        const started = Math.max(now, (this.segment?.started ?? 0) + 1);
        this.segment = { file: join(this.folder, `${String(started).padStart(13, "0")}.jsonl`), started, bytes: 0 };
      }
      appendFileSync(this.segment.file, text);
      this.segment.bytes += text.length;
      this.prune();
    } catch { /* Dropped: the window is best effort. */ }
  }

  private segments(): { file: string; started: number; bytes: number }[] {
    let names: string[] = [];
    try { names = readdirSync(this.folder); } catch { return []; }
    return names.flatMap(name => {
      const match = SEGMENT.exec(name);
      if (!match) return [];
      const file = join(this.folder, name);
      try { return [{ file, started: Number(match[1]), bytes: statSync(file).size }]; } catch { return []; }
    }).sort((a, b) => a.started - b.started);
  }
  /** Delete segments that ended before the window, then the oldest while over its size. */
  prune(): void {
    const bounds = TRACE_BOUNDS[this.mode], cutoff = this.now() - bounds.minutes * 60_000;
    const segments = this.segments();
    let total = segments.reduce((sum, item) => sum + item.bytes, 0);
    segments.forEach((segment, index) => {
      const next = segments[index + 1];
      const ended = next ? next.started : Number.POSITIVE_INFINITY;
      const current = this.segment?.file === segment.file;
      if (!current && (ended < cutoff || total > bounds.bytes)) {
        try { rmSync(segment.file, { force: true }); total -= segment.bytes; } catch { /* Next time. */ }
      }
    });
  }
  bytes(): number { return this.segments().reduce((sum, item) => sum + item.bytes, 0) + this.buffered; }

  /** The window's events, oldest first, within its time and at most `maxBytes` of the newest. */
  read(maxBytes = TRACE_BOUNDS[this.mode].bytes): TraceEntry[] {
    this.flush();
    const cutoff = this.now() - TRACE_BOUNDS[this.mode].minutes * 60_000;
    const lines: string[] = [];
    let total = 0;
    for (const segment of this.segments().reverse()) {
      let text = "";
      try { text = readFileSync(segment.file, "utf8"); } catch { continue; }
      const rows = text.split("\n").filter(Boolean).reverse();
      for (const row of rows) {
        if (total + row.length > maxBytes) break;
        lines.push(row); total += row.length;
      }
      if (total >= maxBytes) break;
    }
    return lines.reverse().flatMap(line => {
      try {
        const entry = JSON.parse(line) as TraceEntry;
        return Date.parse(entry.t) >= cutoff ? [entry] : [];
      } catch { return []; }
    });
  }
  /** Forget the window (and nothing else). */
  clear(): void {
    this.buffer = []; this.buffered = 0; this.segment = null;
    try { if (existsSync(this.folder)) rmSync(this.folder, { recursive: true, force: true }); } catch { /* Next prune. */ }
  }
}
