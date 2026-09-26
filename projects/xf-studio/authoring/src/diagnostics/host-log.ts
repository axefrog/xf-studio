/**
 * The host's one structured log (docs/diagnostics.md): JSON Lines in the host's own data folder (the dev server's ignored `data/`,
 * the desktop app's user-data folder), rotated at a size bound so it never grows past two files. Every entry is redacted as it
 * is written, string by string, with the host's known folders (`host-roots.ts`) and the shared personal-data rules, so the file
 * itself is safe to attach. Writing never throws: diagnostics must never stop the app.
 *
 * Host services report a failure with one line, `hostFailure(area, code, message, error)`, without holding a logger: the server
 * runs each request inside its log's context (`withDiagnostics`), and work a request starts (a preparation's promise chain) keeps
 * that context. Outside any context the process default applies (`setProcessDiagnostics`), else the console.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { diagnosticEntry, entryLine, errorCode, errorText, newErrorRef, type DiagnosticDetails, type DiagnosticEntry,
  type DiagnosticLevel, type DiagnosticTrace, NO_TRACE } from "./model";
import { redactValue, type Redactor } from "./redact";
import { RedactionRoots } from "./host-roots";
import { TraceWindow } from "./trace-window";

/** The diagnostics folder inside a host's data folder: the log, the rolling window (`trace/`) and the mode. */
export const DIAGNOSTICS_FOLDER = "diagnostics";
export const DIAGNOSTIC_LOG_NAME = "log.jsonl";
export const DIAGNOSTIC_LOG_PREVIOUS = "log.1.jsonl";
/** One file's bound; with the one rotated file the log holds at most twice this. */
export const DIAGNOSTIC_LOG_BYTES = 512 * 1024;

/** The shape host services already take as `log` (a plain line), which the log also provides per area. */
export type HostLogger = (message: string) => void;
export type DiagnosticLogOptions = {
  maxBytes?: number;
  /** Mirror each entry somewhere (the dev server's console). */
  echo?: (entry: DiagnosticEntry) => void;
  now?: () => Date;
  /** The redactor in effect (the host's roots); by default the person's own folders and the shared rules. */
  redactor?: () => Redactor;
};
/** Host failures kept in memory apart from the log's own recent entries, so a flood of page entries can't push them out. */
const FAILURES_KEPT = 50;

export class DiagnosticLog {
  readonly path: string;
  readonly previous: string;
  private readonly recent: DiagnosticEntry[] = [];
  private readonly failures: DiagnosticEntry[] = [];
  private readonly maxBytes: number;
  private readonly redactor: () => Redactor;
  constructor(readonly directory: string, private readonly options: DiagnosticLogOptions = {}) {
    this.path = resolve(directory, DIAGNOSTIC_LOG_NAME);
    this.previous = resolve(directory, DIAGNOSTIC_LOG_PREVIOUS);
    this.maxBytes = options.maxBytes ?? DIAGNOSTIC_LOG_BYTES;
    const fallback = new RedactionRoots();
    this.redactor = options.redactor ?? (() => fallback.redactor());
  }

  /** Append one entry (redacted); returns what was written. Never throws: a failure hook runs inside other code's catch blocks. */
  write(entry: DiagnosticEntry): DiagnosticEntry {
    let clean: DiagnosticEntry;
    try { clean = redactValue(entry, this.redactor()); }
    catch { clean = { t: new Date().toISOString(), level: "warn", area: "diagnostics", code: "unrecordable", message: "An entry couldn't be recorded.", origin: "host" }; }
    try {
      this.recent.push(clean);
      if (this.recent.length > 200) this.recent.splice(0, this.recent.length - 200);
      if (clean.origin === "host" && clean.level !== "info" && clean.ref) {
        this.failures.push(clean);
        if (this.failures.length > FAILURES_KEPT) this.failures.shift();
      }
    } catch { /* Memory only. */ }
    try { this.options.echo?.(clean); } catch { /* A mirror must not stop the log. */ }
    try {
      const line = JSON.stringify(clean) + "\n";
      mkdirSync(this.directory, { recursive: true });
      let size = 0;
      try { size = statSync(this.path).size; } catch { /* No log yet. */ }
      if (size > 0 && size + line.length > this.maxBytes) renameSync(this.path, this.previous);
      appendFileSync(this.path, line);
    } catch { /* Diagnostics must never stop the app. */ }
    return clean;
  }
  private entry(level: DiagnosticLevel, area: string, code: string, message: string, details?: DiagnosticDetails, ref?: string) {
    return this.write(diagnosticEntry({ level, area, code, message, origin: "host", details, ref,
      t: (this.options.now?.() ?? new Date()).toISOString() }));
  }
  info(area: string, code: string, message: string, details?: DiagnosticDetails) { return this.entry("info", area, code, message, details); }
  warn(area: string, code: string, message: string, details?: DiagnosticDetails) { return this.entry("warn", area, code, message, details); }
  /** A failure a person may see: logged with its stack and a new reference, which is returned. */
  failure(area: string, code: string, message: string, error?: unknown, options: { level?: DiagnosticLevel; details?: DiagnosticDetails } = {}): string {
    const ref = newErrorRef();
    let details: DiagnosticDetails = { ...options.details };
    try {
      const own = errorCode(error);
      details = { ...details, stack: options.details?.stack ?? errorText(error),
        codes: [...(options.details?.codes ?? []), ...(own && own !== code ? [own] : [])] };
    } catch { /* An error whose stack or code can't be read: logged without them. */ }
    try { this.entry(options.level ?? "error", area, code, message, details, ref); } catch { /* Never throws. */ }
    return ref;
  }
  /** A logger for one area, in the shape host services take as `log`. */
  logger(area: string): HostLogger { return message => { this.info(area, "event", message); }; }
  /** Page entries, forwarded through the diagnostics endpoint. */
  forwarded(entries: readonly DiagnosticEntry[]) { for (const entry of entries) this.write(entry); }
  /** References of host failures logged in the last `withinMs` (to link a page notice to the host failure behind it). */
  recentFailures(withinMs: number, now = Date.now()): string[] {
    return this.failures.filter(entry => now - Date.parse(entry.t) <= withinMs).map(entry => entry.ref!);
  }
  /** The host failures this process logged (at most `FAILURES_KEPT`), oldest first, whatever came after them. */
  hostFailures(): DiagnosticEntry[] { return [...this.failures]; }
  /** The newest `count` entries on disk (all by default), oldest first (reads at most the two files' last megabyte). */
  tail(count = Number.POSITIVE_INFINITY): DiagnosticEntry[] {
    const lines = [...readTail(this.previous, this.maxBytes), ...readTail(this.path, this.maxBytes)];
    const entries: DiagnosticEntry[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try { const value = JSON.parse(line); if (value && typeof value === "object" && typeof value.message === "string") entries.push(value); }
      catch { /* A torn or foreign line. */ }
    }
    return Number.isFinite(count) ? entries.slice(-count) : entries;
  }
  /** Size of the log files, for the report. */
  bytes(): number {
    let total = 0;
    for (const file of [this.path, this.previous]) try { total += statSync(file).size; } catch { /* Absent. */ }
    return total;
  }
}

function readTail(path: string, maxBytes: number): string[] {
  let handle: number | null = null;
  try {
    const size = statSync(path).size, start = Math.max(0, size - maxBytes);
    if (start === 0) return readFileSync(path, "utf8").split("\n");
    handle = openSync(path, "r");
    const bytes = Buffer.alloc(size - start);
    readSync(handle, bytes, 0, bytes.length, start);
    // The first line may be cut; drop it.
    return bytes.toString("utf8").split("\n").slice(1);
  } catch { return []; }
  finally { if (handle !== null) try { closeSync(handle); } catch { /* Closed. */ } }
}

/** A host's diagnostics: its log and its rolling detail window, both in `<data>/diagnostics/`. */
export type HostDiagnostics = { readonly log: DiagnosticLog; readonly trace: TraceWindow;
  /** What both redact with: the person's folders, plus the configured ones the diagnostics endpoint names. */
  readonly roots: RedactionRoots };
const hosts = new Map<string, HostDiagnostics>();
/**
 * The one diagnostics pair for a data folder, shared by everything in the process that writes there (the desktop's main and its
 * server). `options` apply when it is first created.
 */
export function hostDiagnosticsAt(dataRoot: string, options: DiagnosticLogOptions = {}): HostDiagnostics {
  const directory = resolve(dataRoot, DIAGNOSTICS_FOLDER), key = directory.toLowerCase();
  let found = hosts.get(key);
  if (!found) {
    const roots = new RedactionRoots(), redactor = () => roots.redactor();
    found = { log: new DiagnosticLog(directory, { redactor, ...options }), trace: new TraceWindow(directory, Date.now, redactor), roots };
    hosts.set(key, found);
  }
  return found;
}

const context = new AsyncLocalStorage<HostDiagnostics>();
let processDefault: HostDiagnostics | null = null;
/** Run `work` (a request) with `diagnostics` as what `hostFailure` and `hostTrace` use, including the async work it starts. */
export function withDiagnostics<T>(diagnostics: HostDiagnostics, work: () => T): T { return context.run(diagnostics, work); }
/** What `hostFailure` uses outside any request (a composition root sets it once). */
export function setProcessDiagnostics(diagnostics: HostDiagnostics | null) { processDefault = diagnostics; }
export const currentDiagnostics = (): HostDiagnostics | null => context.getStore() ?? processDefault;
/** The current rolling window, or one that keeps nothing. */
export const hostTrace = (): DiagnosticTrace => currentDiagnostics()?.trace ?? NO_TRACE;

/**
 * Report a host failure that turns into something a person sees (a preparation that failed, a Build that stopped). One line at
 * the catch site; returns the error reference, or null when no log is set up (then the console gets it, as before). The rolling
 * window records it too, beside the decisions that led to it.
 */
export function hostFailure(area: string, code: string, message: string, error?: unknown, level: DiagnosticLevel = "error"): string | null {
  try {
    const diagnostics = currentDiagnostics();
    if (!diagnostics) { console.error(`${area}/${code}: ${message}`, error ?? ""); return null; }
    const ref = diagnostics.log.failure(area, code, message, error, { level });
    diagnostics.trace.event(area, "failure", { code, ref, message, level });
    return ref;
  } catch { return null; }
}
/** Terminal control characters (escape sequences, bells, backspaces) a forwarded page text could carry; newlines and tabs stay. */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const printable = (text: string) => text.replace(CONTROL, "?");
/** The dev server's console mirror: routine events as their plain line, problems with their reference and stack, control characters shown as `?`. */
export function consoleEcho(entry: DiagnosticEntry) {
  if (entry.level === "info") { console.log(printable(entry.message)); return; }
  console.error(printable(entryLine(entry) + (entry.details?.stack ? `\n${entry.details.stack}` : "")));
}
