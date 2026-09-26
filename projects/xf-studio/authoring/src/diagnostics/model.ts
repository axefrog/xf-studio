/**
 * The diagnostics model shared by both hosts and the page (docs/diagnostics.md): one structured log entry, the short error
 * reference a notice shows, the bounds a forwarded page entry must fit, and which failure codes are expected refusals rather than
 * problems worth reporting. DOM-free and host-free: plain data and pure functions only.
 */

export const DIAGNOSTIC_ENTRY_SCHEMA = "xfs/diagnostic-entry-1" as const;
export const DIAGNOSTIC_FORWARD_SCHEMA = "xfs/diagnostic-forward-1" as const;
export const DIAGNOSTIC_HOST_REPORT_SCHEMA = "xfs/diagnostic-host-report-1" as const;

export type DiagnosticLevel = "info" | "warn" | "error";
/** Where an entry was written: by a host service, or by the page and forwarded to the host log. */
export type DiagnosticOrigin = "host" | "page";
/** Optional structured detail. Strings are bounded; nothing here may hold file bytes, collection content or tokens. */
export type DiagnosticDetails = {
  /** A stack trace or tool output tail. */
  stack?: string;
  /** Machine codes involved (an error's code, a tool's exit code). */
  codes?: string[];
  /** Other references this entry belongs with (a page notice and the host failure behind it). */
  related?: string[];
  /** Where a page failure was shown ("Library", "Mod package") or which request failed. */
  source?: string;
  /** An HTTP status, a count of dropped entries. */
  status?: number;
  count?: number;
};
export type DiagnosticEntry = {
  /** ISO time the entry was written. */
  t: string;
  level: DiagnosticLevel;
  /** The subsystem: character, resolver, package, library, lut, eye-plate, preview, wolvenkit, page, webgl, notice… */
  area: string;
  /** A stable machine code for the event (`details_failed`, `unhandled`, `http_500`). */
  code: string;
  /** One plain line. */
  message: string;
  origin: DiagnosticOrigin;
  /** The short reference a notice showed for this entry (`XF-7K3Q`). */
  ref?: string;
  details?: DiagnosticDetails;
};

/** Bounds on what one entry, one forward and one host may hold. */
export const DIAGNOSTIC_LIMITS = Object.freeze({
  message: 600,
  stack: 4_000,
  detailText: 300,
  codes: 8,
  related: 8,
  /** Entries in one forward from the page. */
  batch: 10,
  /** Bytes of one forward request body. */
  body: 32_000,
  /** Page entries a host accepts per minute; the rest are counted and dropped. */
  perMinute: 60,
  /** Entries the page keeps when forwarding fails. */
  ring: 50,
  /** Log entries a report carries. */
  reportEntries: 60,
});

const REF_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Six characters since DIAG-12 (four gave a million values, which collide within a few hundred); older four-character ones still read. */
export const ERROR_REF = /^XF-[0-9A-HJKMNP-TV-Z]{4}(?:[0-9A-HJKMNP-TV-Z]{2})?$/;
const AREA = /^[a-z][a-z0-9-]{0,31}$/;
const CODE = /^[a-z0-9][a-z0-9_.-]{0,47}$/i;

/** A new short error reference: `XF-` and six Crockford base-32 characters (no I, L, O or U), about a billion values. */
export function newErrorRef(random: (bytes: Uint8Array) => Uint8Array = bytes => crypto.getRandomValues(bytes)): string {
  const bytes = random(new Uint8Array(6));
  return "XF-" + [...bytes].map(byte => REF_ALPHABET[byte % 32]).join("");
}
export const isErrorRef = (value: unknown): value is string => typeof value === "string" && ERROR_REF.test(value);

const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
const oneLine = (text: string) => text.replace(/[\r\n\t]+/g, " ").trim();

/** An error's stack (or its message, or its text), bounded; the tail matters least, so the head is kept. */
export function errorText(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  if (error instanceof Error) return clip(error.stack || `${error.name}: ${error.message}`, DIAGNOSTIC_LIMITS.stack);
  if (typeof error === "object") {
    const coded = error as { code?: unknown; message?: unknown; detail?: unknown };
    const parts = [coded.code, coded.message, coded.detail].filter(part => typeof part === "string" && part);
    if (parts.length) return clip(parts.join(": "), DIAGNOSTIC_LIMITS.stack);
    try { return clip(JSON.stringify(error), DIAGNOSTIC_LIMITS.stack); } catch { /* Not serialisable. */ }
  }
  return clip(String(error), DIAGNOSTIC_LIMITS.stack);
}
/** An error's own machine code, when it has one (`CharacterDetailError.code`, a Node `ENOENT`). */
export function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && CODE.test(code) ? code : undefined;
}

/** A well-formed entry from loose parts, every field bounded. */
export function diagnosticEntry(parts: { level: DiagnosticLevel; area: string; code: string; message: string; origin: DiagnosticOrigin;
  ref?: string; details?: DiagnosticDetails; t?: string }): DiagnosticEntry {
  const details = boundDetails(parts.details);
  return {
    t: parts.t ?? new Date().toISOString(), level: parts.level,
    area: AREA.test(parts.area) ? parts.area : "other",
    code: CODE.test(parts.code) ? parts.code : "unknown",
    message: clip(oneLine(parts.message) || "(no message)", DIAGNOSTIC_LIMITS.message),
    origin: parts.origin,
    ...(isErrorRef(parts.ref) ? { ref: parts.ref } : {}),
    ...(details ? { details } : {}),
  };
}

function boundDetails(details: DiagnosticDetails | undefined): DiagnosticDetails | undefined {
  if (!details || typeof details !== "object") return undefined;
  const out: DiagnosticDetails = {};
  if (typeof details.stack === "string" && details.stack) out.stack = clip(details.stack, DIAGNOSTIC_LIMITS.stack);
  if (Array.isArray(details.codes)) {
    const codes = details.codes.filter(code => typeof code === "string" && CODE.test(code)).slice(0, DIAGNOSTIC_LIMITS.codes);
    if (codes.length) out.codes = codes;
  }
  if (Array.isArray(details.related)) {
    const related = [...new Set(details.related.filter(isErrorRef))].slice(0, DIAGNOSTIC_LIMITS.related);
    if (related.length) out.related = related;
  }
  if (typeof details.source === "string" && details.source) out.source = clip(oneLine(details.source), DIAGNOSTIC_LIMITS.detailText);
  for (const key of ["status", "count"] as const)
    if (typeof details[key] === "number" && Number.isFinite(details[key])) out[key] = Math.trunc(details[key]!);
  return Object.keys(out).length ? out : undefined;
}

/**
 * The entries of one forward from the page, or why it is refused. Only the page's own fields are read (level, area, code,
 * message, ref, details); the time and origin are the host's. Unknown fields are ignored, never stored.
 */
export function parseForward(value: unknown): { ok: true; entries: DiagnosticEntry[] } | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, message: "Expected a diagnostics forward." };
  const forward = value as { schema?: unknown; entries?: unknown };
  if (forward.schema !== DIAGNOSTIC_FORWARD_SCHEMA || !Array.isArray(forward.entries)) return { ok: false, message: "Expected a diagnostics forward." };
  if (forward.entries.length > DIAGNOSTIC_LIMITS.batch) return { ok: false, message: `At most ${DIAGNOSTIC_LIMITS.batch} entries per forward.` };
  const entries: DiagnosticEntry[] = [];
  for (const raw of forward.entries) {
    if (!raw || typeof raw !== "object") return { ok: false, message: "Each entry must be an object." };
    const entry = raw as Record<string, unknown>;
    if (!["info", "warn", "error"].includes(entry.level as string) || typeof entry.area !== "string" || typeof entry.code !== "string" ||
      typeof entry.message !== "string") return { ok: false, message: "Each entry needs a level, area, code and message." };
    entries.push(diagnosticEntry({ level: entry.level as DiagnosticLevel, area: entry.area, code: entry.code, message: entry.message,
      origin: "page", ref: entry.ref as string | undefined, details: entry.details as DiagnosticDetails | undefined }));
  }
  return { ok: true, entries };
}

/**
 * Refusals that explain themselves (a busy library, a value out of range, a cancelled dialog) are part of normal use, so their
 * notices carry no reference and no "Report this problem". Any other failure code, or none, is unexpected: it is logged and
 * offered for reporting.
 */
const EXPECTED_CODES = new Set([
  "missing_target", "busy", "limit", "invalid_value", "incompatible_mode", "asset_unavailable", "not_ready", "unavailable", "needs_input",
  "cancelled", "conflict", "stale_result", "invalid_json", "invalid_collection", "no_exportable_content",
  "required", "range", "format", "mode", "name.blank", "name.too-long",
]);
export const isExpectedFailure = (code: string | undefined): boolean => !!code && EXPECTED_CODES.has(code);

/**
 * The rolling detail window's sink (docs/diagnostics.md §Rolling window), injected into the resolver and preparation services.
 * An event records references and decisions, never payloads: resource paths, hashes, archive names, fingerprints, request
 * parameters and outcomes; never mesh, texture or file bytes. `deep` is on in diagnostic mode: check it before building an
 * event that is only worth its cost then (every resource read, not just a preparation's summary).
 */
export type DiagnosticTrace = {
  readonly deep: boolean;
  event(area: string, event: string, data?: Readonly<Record<string, unknown>>, options?: TraceEventOptions): void;
};
/**
 * An event's own bounds, for the few that are large by nature (a V's whole resolution): `bytes` (at most `LARGE_EVENT_BYTES`)
 * instead of the usual 512 KB, `items` per array or object instead of 200, and which top-level fields to `keep` when it is still
 * too large, before falling back to its keys alone.
 */
export type TraceEventOptions = { bytes?: number; items?: number; keep?: readonly string[] };
export const LARGE_EVENT_BYTES = 2 * 1024 * 1024;
/** The sink that keeps nothing (tests, tools, a host without diagnostics). */
export const NO_TRACE: DiagnosticTrace = Object.freeze({ deep: false, event() {} });
export type TraceEntry = { t: string; area: string; event: string; data?: Record<string, unknown> };

/** Bounds a JSON-able value keeps in a trace event or a report excerpt. */
export type JsonBounds = { depth: number; items: number; text: number; drop?: RegExp };
export const TRACE_JSON_BOUNDS: JsonBounds = { depth: 16, items: 200, text: 600 };
/**
 * A JSON-able copy of `value` within `bounds`: deeper objects become `"…"`, longer arrays keep their first `items` and say how many
 * were left out, longer strings are clipped, keys matching `drop` (buffers, byte blobs) are left out with a note of their kind, and
 * functions, symbols and non-finite numbers disappear. Pure; never throws.
 */
export function boundJson(value: unknown, bounds: JsonBounds = TRACE_JSON_BOUNDS, depth = 0): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value.length > bounds.text ? `${value.slice(0, bounds.text)}… (${value.length} characters)` : value;
  if (typeof value !== "object") return undefined;
  if (depth >= bounds.depth) return "…";
  if (value instanceof Map) return boundJson(Object.fromEntries(value), bounds, depth);
  if (value instanceof Set) return boundJson([...value], bounds, depth);
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return `(binary, ${(value as ArrayBuffer).byteLength} bytes, left out)`;
  if (Array.isArray(value)) {
    const kept = value.slice(0, bounds.items).map(item => boundJson(item, bounds, depth + 1) ?? null);
    return value.length > bounds.items ? [...kept, `… ${value.length - bounds.items} more`] : kept;
  }
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (++count > bounds.items) { out["…"] = `${Object.keys(value as object).length - bounds.items} more keys`; break; }
    if (bounds.drop?.test(key)) { out[key] = "(left out)"; continue; }
    const bounded = boundJson(item, bounds, depth + 1);
    if (bounded !== undefined) out[key] = bounded;
  }
  return out;
}

/** The plain one-line form of an entry for a report or a console. */
export function entryLine(entry: DiagnosticEntry): string {
  return `${entry.t} ${entry.level.toUpperCase().padEnd(5)} ${entry.origin}/${entry.area} ${entry.code}${entry.ref ? ` ${entry.ref}` : ""}: ${entry.message}`;
}
