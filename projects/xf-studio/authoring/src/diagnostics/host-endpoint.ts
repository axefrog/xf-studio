/**
 * The host's diagnostics endpoint (docs/diagnostics.md), the same on the dev server and the desktop app:
 *
 * - `POST /api/diagnostics/entries`: the page forwards its failures to the host log. Bounded: one body is at most
 *   `DIAGNOSTIC_LIMITS.body` bytes and `batch` entries, at most `perMinute` entries a minute are kept, and the same page entry
 *   (with the same reference) repeating within a minute is kept once (the rest are counted in one "dropped" line). An entry with a
 *   reference of its own is one the page showed a person, so another reference is never folded into it (DIAG-22). A page failure without a host reference
 *   of its own is linked to the few host failures of the seconds before it (`details.related`). An entry that can't be recorded
 *   is skipped, never answered with an error the page would retry forever.
 * - `GET /api/diagnostics/state`, `POST /api/diagnostics/mode`: the rolling window's size and diagnostic mode, and while a report is
 *   being prepared, one plain line on what it is doing (`preparing`), which the review shows.
 * - `POST /api/diagnostics/report`: prepare a report for review (the manifest the review screen shows).
 * - `POST /api/diagnostics/item`: one prepared item's whole text, for the review's full view.
 * - `POST /api/diagnostics/bundle`: the report file (a ZIP) with only the items the person left ticked, for the page to save. Its
 *   `README.md` and `report.json` are built from those items alone; a mod's own files need `sharingConfirmed`.
 * - `POST /api/diagnostics/open-issue`: the host builds the pre-filled issue link from the title and summary the page sends,
 *   redacting them again with the configured folders, and the desktop opens it in the person's browser; without that (the localhost
 *   dev server), the host answers the redacted link and the page opens it (DIAG-19). The page never builds the link itself.
 *
 * Nothing here sends anything anywhere. `withRequestDiagnostics` wraps a whole server: each request runs in the log's context, an
 * exception becomes a logged failure and a plain 500 with its reference, and any other 5xx API answer is logged with one. Creating
 * the handler names the host's configured folders to its log and window (`HostDiagnostics.roots`), so they are redacted as written.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DIAGNOSTIC_LIMITS, isErrorRef, parseForward, type DiagnosticEntry } from "./model";
import { withDiagnostics, type HostDiagnostics } from "./host-log";
import { buildHostReport, knownRoots, type HostReportSources, type PreparedHostReport } from "./host-report";
import { DESCRIPTION_LIMIT, issueUrl, reportFileName, reportIndex, reportSummary, type PageFacts, type ReportGroup,
  type ReportItemView } from "./report";
import { redactValue, type Redactor } from "./redact";
import { REPORT_LIMIT } from "./mod-identity";
import { zip, type ZipEntry } from "./zip";

export const DIAGNOSTICS_PREFIX = "/api/diagnostics/";
export const ERROR_REF_HEADER = "X-XFS-Error-Ref";
export const DIAGNOSTICS_STATE_SCHEMA = "xfs/diagnostics-state-1" as const;
/** What the page may add to a report file: its own facts and these items only. */
export const PAGE_ITEMS: Readonly<Record<string, ReportGroup>> = Object.freeze({ page: "about", activity: "happened", pending: "happened" });
const PAGE_ITEMS_BYTES = 256 * 1024;
/** A page failure is linked only to host failures this recent, and to at most `RELATED_MAX` of them (DIAG-12). */
const RELATED_MS = 15_000, RELATED_MAX = 3;
/** The same page entry (area, code, message and reference) repeating within this long is kept once and counted after. */
const REPEAT_MS = 60_000;

export type DiagnosticsHandlerOptions = HostReportSources & {
  /** Opens a URL in the person's browser (the desktop host); without it the page opens the issue page itself. */
  openExternal?: (url: string) => boolean;
  /** Development only (`XFS_DIAGNOSTICS_TEST_HOOK=1`): `POST /api/diagnostics/test-failure` throws, to check the failure path. */
  testHook?: boolean;
  now?: () => number;
};

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } });
const refuse = (status: number, code: string, error: string) => json({ code, error }, status);

async function readJson(request: Request, limit: number): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > limit) return { ok: false, response: refuse(413, "too_large", "That is more than the diagnostics endpoint accepts.") };
  let text: string;
  try { text = await request.text(); } catch { return { ok: false, response: refuse(400, "unreadable", "The request couldn't be read.") }; }
  if (text.length > limit) return { ok: false, response: refuse(413, "too_large", "That is more than the diagnostics endpoint accepts.") };
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false, response: refuse(400, "invalid_json", "Expected JSON.") }; }
}

export function createDiagnosticsHandler(diagnostics: HostDiagnostics, options: DiagnosticsHandlerOptions) {
  const now = options.now ?? Date.now;
  // The log and the window redact the configured folders as they write, not only the report (DIAG-06).
  diagnostics.roots.setProvider(() => { let settings = null; try { settings = options.settings(); } catch { /* None. */ } return knownRoots(options, settings); });
  const redactor = (): Redactor => diagnostics.roots.redactor();
  let minute = { start: 0, kept: 0, dropped: 0 };
  const repeats = new Map<string, number>();
  /** What the report being prepared is doing now (null when none is). */
  let preparing: string | null = null;
  const prepared = new Map<string, { report: PreparedHostReport; at: number }>();
  const remember = (id: string, report: PreparedHostReport) => {
    prepared.set(id, { report, at: now() });
    for (const [key, value] of prepared) if (now() - value.at > 3_600_000) prepared.delete(key);
    while (prepared.size > 3) prepared.delete(prepared.keys().next().value!);
  };

  function forward(entries: DiagnosticEntry[]) {
    const at = now();
    if (at - minute.start >= 60_000) {
      if (minute.dropped) diagnostics.log.warn("diagnostics", "page_entries_dropped", "The window sent more problems than the log keeps in a minute, or the same one again and again; the rest were counted, not kept.", { count: minute.dropped });
      minute = { start: at, kept: 0, dropped: 0 };
      for (const [key, seen] of repeats) if (at - seen >= REPEAT_MS) repeats.delete(key);
    }
    const recent = diagnostics.log.recentFailures(RELATED_MS, at);
    for (const entry of entries) {
      try {
        // The reference is part of the key: the page records a failure once per ten seconds and shows that reference, which a
        // report must then find (DIAG-22).
        const key = `${entry.area}|${entry.code}|${entry.message}|${entry.ref ?? ""}`;
        if (minute.kept >= DIAGNOSTIC_LIMITS.perMinute || at - (repeats.get(key) ?? -Infinity) < REPEAT_MS) { minute.dropped++; continue; }
        repeats.set(key, at);
        if (repeats.size > 500) repeats.delete(repeats.keys().next().value!);
        minute.kept++;
        // A notice that already carries a host failure's reference is that failure; only a page-made reference gets links.
        const own = !!entry.ref && recent.includes(entry.ref);
        const links = entry.level === "error" && !own ? recent.slice(-RELATED_MAX) : [];
        diagnostics.log.write(links.length ? { ...entry, details: { ...entry.details, related: [...new Set([...(entry.details?.related ?? []), ...links])].slice(0, DIAGNOSTIC_LIMITS.related) } } : entry);
        if (entry.level !== "info") diagnostics.trace.event("page", "failure", { area: entry.area, code: entry.code, ref: entry.ref ?? null, message: entry.message });
      } catch { /* A poison entry is skipped, never retried. */ }
    }
  }

  async function bundle(value: unknown): Promise<Response> {
    const body = value as { id?: unknown; include?: unknown; description?: unknown; sharingConfirmed?: unknown; page?: { facts?: unknown; items?: unknown } } | null;
    if (!body || typeof body.id !== "string" || !Array.isArray(body.include) || body.include.some(item => typeof item !== "string"))
      return refuse(400, "invalid_request", "Expected a report and the items to include.");
    const found = prepared.get(body.id);
    if (!found) return refuse(409, "report_expired", "That report was prepared a while ago. Prepare it again, then save.");
    const { manifest, contents, files } = found.report;
    const redact = redactor();
    const description = typeof body.description === "string" ? redact(body.description.slice(0, DESCRIPTION_LIMIT)) : "";
    const pageFacts = validPageFacts(body.page?.facts, redact);
    const pageItems = validPageItems(body.page?.items, redact);
    if (pageItems === null) return refuse(400, "invalid_request", "The window's part of the report is too large or malformed.");
    const include = new Set(body.include as string[]);
    const hostIncluded = manifest.items.filter(item => include.has(item.id));
    // A mod's own files go in only when the person confirmed they may share them; the page asks, and the host checks (DIAG-09).
    if (hostIncluded.some(item => item.modFiles) && body.sharingConfirmed !== true)
      return refuse(409, "sharing_not_confirmed", "Confirm that you may share these mods' files before including them, or untick them.");
    const included: ReportItemView[] = [...hostIncluded, ...pageItems.filter(item => include.has(item.id)).map(item => item.view)];
    const total = included.reduce((sum, item) => sum + item.bytes, 0);
    if (total > REPORT_LIMIT) return refuse(413, "report_too_large", `The ticked items add up to more than ${Math.round(REPORT_LIMIT / 1024 / 1024)} MB. Untick something large, then save again.`);
    // The summary and the index come from the ticked items only (DIAG-01), by the same functions the review previews them with.
    const input = { manifest, description, page: pageFacts, included, offered: [...manifest.items, ...pageItems.map(item => item.view)] };
    const entries: ZipEntry[] = [
      { name: "README.md", data: reportSummary(input, redact) },
      { name: "report.json", data: reportIndex(input, redact) },
    ];
    for (const item of hostIncluded) {
      const content = contents.get(item.id);
      if (content !== undefined) entries.push({ name: `${item.group}/${item.id}.json`, data: content });
      for (const file of files.get(item.id) ?? []) {
        let bytes: Uint8Array;
        try { bytes = readFileSync(file.path); }
        catch { return refuse(409, "file_unreadable", `“${file.name}” couldn't be read any more. Untick it, or prepare the report again.`); }
        entries.push({ name: modFileEntryName(file.mod, file.name, redact), data: bytes });
      }
    }
    for (const item of pageItems) if (include.has(item.id)) entries.push({ name: `${item.view.group}/${item.id}.json`, data: item.text });
    const archive = zip(entries);
    diagnostics.log.info("diagnostics", "report_saved", `A problem report was made for saving (${included.length} items, ${Math.round(archive.length / 1024)} KB).`);
    return new Response(archive as BodyInit, { headers: { "Content-Type": "application/zip", "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${reportFileName(manifest)}"` } });
  }

  return async function diagnosticsRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1" || (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin))
      return refuse(403, "forbidden", "Local studio requests only.");
    const route = url.pathname.slice(DIAGNOSTICS_PREFIX.length);
    if (request.method === "GET") {
      if (route === "state") return json({ schema: DIAGNOSTICS_STATE_SCHEMA, ...diagnostics.trace.state(), logBytes: diagnostics.log.bytes(), preparing });
      return refuse(404, "not_found", "Not found.");
    }
    if (request.method !== "POST") return refuse(405, "method", "Method not allowed.");
    // Writes come from the Studio page only: same origin, JSON.
    if (request.headers.get("Origin") !== url.origin || request.headers.get("Content-Type")?.split(";")[0]?.trim() !== "application/json")
      return refuse(403, "forbidden", "Use the local studio for diagnostics.");
    if (route === "test-failure" && options.testHook) throw Error("Diagnostics test hook: a deliberate host failure.");
    const read = await readJson(request, route === "bundle" ? PAGE_ITEMS_BYTES + DESCRIPTION_LIMIT * 4 + 16_384 : DIAGNOSTIC_LIMITS.body);
    if (!read.ok) return read.response;
    const value = read.value as Record<string, unknown> | null;
    if (route === "entries") {
      const parsed = parseForward(value);
      if (!parsed.ok) return refuse(400, "invalid_forward", parsed.message);
      forward(parsed.entries);
      return new Response(null, { status: 204 });
    }
    if (route === "mode") {
      if (!value || (value.mode !== "normal" && value.mode !== "deep") || Object.keys(value).length !== 1) return refuse(400, "invalid_mode", "Choose normal or deep.");
      const state = diagnostics.trace.setMode(value.mode);
      diagnostics.log.info("diagnostics", "mode", value.mode === "deep" ? "Diagnostic mode is on." : "Diagnostic mode is off.");
      return json({ schema: DIAGNOSTICS_STATE_SCHEMA, ...state, logBytes: diagnostics.log.bytes() });
    }
    if (route === "report") {
      const ref = value?.ref ?? null;
      if (ref !== null && !isErrorRef(ref)) return refuse(400, "invalid_ref", "That isn't an XF Studio error reference.");
      const id = randomUUID();
      let report: PreparedHostReport;
      try { report = await buildHostReport(diagnostics, options, ref as string | null, id, message => { preparing = message; }); }
      finally { preparing = null; }
      remember(id, report);
      return json(report.manifest);
    }
    if (route === "item") {
      const found = typeof value?.id === "string" ? prepared.get(value.id) : undefined;
      if (!found) return refuse(409, "report_expired", "That report was prepared a while ago. Prepare it again.");
      const text = typeof value?.item === "string" ? found.report.contents.get(value.item) : undefined;
      if (text === undefined) return refuse(404, "not_found", "That part isn't in this report.");
      return json({ text });
    }
    if (route === "bundle") return bundle(value);
    if (route === "open-issue") {
      if (!value || typeof value.title !== "string" || typeof value.body !== "string" || value.title.length > 300 || value.body.length > 8_000)
        return refuse(400, "invalid_issue", "Expected a short title and summary.");
      // Redacted here with the configured folders on every host, before the link reaches a browser (DIAG-19).
      const redact = redactor();
      const link = issueUrl(redact(value.title), redact(value.body));
      if (!options.openExternal) return json({ code: "open_in_page", url: link });
      const opened = options.openExternal(link);
      return new Response(null, { status: opened === false ? 502 : 204 });
    }
    return refuse(404, "not_found", "Not found.");
  };
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/^\.+/, "_").slice(0, 120) || "file";
/**
 * A mod file's name in the report's ZIP. Redacted with the report's folders like every other part (DIAG-23): the names come from the
 * rolling window, redacted with the folders known when it was written, and a mod or archive may be named after a folder or the account.
 */
export const modFileEntryName = (mod: string, file: string, redact: Redactor) =>
  `optional/mod-files/${safeName(redact(mod))}/${safeName(redact(file))}`;

function validPageFacts(value: unknown, redact: Redactor): PageFacts | null {
  if (!value || typeof value !== "object") return null;
  const facts = value as Record<string, unknown>;
  const text = (item: unknown, max = 300) => typeof item === "string" ? item.slice(0, max) : null;
  const state: Record<string, string> = {};
  if (facts.state && typeof facts.state === "object")
    for (const [key, item] of Object.entries(facts.state as Record<string, unknown>).slice(0, 24)) if (typeof item === "string") state[key.slice(0, 60)] = item.slice(0, 200);
  return redactValue({ browser: text(facts.browser) ?? "unknown", gpu: text(facts.gpu), webgl2: facts.webgl2 === true, state }, redact);
}
/** The page's own items (its facts, its activity log, entries it couldn't forward): fixed IDs, bounded, redacted with the host's folders. */
function validPageItems(value: unknown, redact: Redactor): { id: string; text: string; view: ReportItemView }[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > Object.keys(PAGE_ITEMS).length) return null;
  const out: { id: string; text: string; view: ReportItemView }[] = [];
  let total = 0;
  for (const raw of value) {
    const item = raw as { id?: unknown; label?: unknown; detail?: unknown; content?: unknown } | null;
    if (!item || typeof item.id !== "string" || !(item.id in PAGE_ITEMS) || out.some(other => other.id === item.id)) return null;
    const text = JSON.stringify(redactValue(item.content ?? null, redact), null, 1);
    total += text.length;
    if (total > PAGE_ITEMS_BYTES) return null;
    out.push({ id: item.id, text, view: { id: item.id, group: PAGE_ITEMS[item.id]!, label: typeof item.label === "string" ? redact(item.label.slice(0, 80)) : item.id,
      detail: typeof item.detail === "string" ? redact(item.detail.slice(0, 300)) : "", bytes: Buffer.byteLength(text, "utf8"), included: true, preview: "" } });
  }
  return out;
}

/**
 * Wrap a host's whole request handler: each request runs in the diagnostics context (so `hostFailure` and `hostTrace` reach this
 * host's log and window), an exception becomes a logged failure and a plain 500 carrying its reference, and any other 5xx answer
 * from an API route is logged with a reference, which the response carries in `X-XFS-Error-Ref`.
 */
export function withRequestDiagnostics(diagnostics: HostDiagnostics, handler: (request: Request) => Response | Promise<Response>) {
  return (request: Request): Promise<Response> => withDiagnostics(diagnostics, async () => {
    const url = new URL(request.url), where = `${request.method} ${url.pathname}`;
    try {
      const response = await handler(request);
      if (response.status < 500 || !url.pathname.startsWith("/api/") || response.headers.has(ERROR_REF_HEADER)) return response;
      let said = "", code: string | undefined;
      try {
        if ((response.headers.get("Content-Type") ?? "").includes("json")) {
          const body = await response.clone().json() as { error?: unknown; message?: unknown; code?: unknown };
          said = String(body.error ?? body.message ?? ""); code = typeof body.code === "string" ? body.code : undefined;
        } else said = (await response.clone().text()).slice(0, 300);
      } catch { /* No readable body. */ }
      const ref = diagnostics.log.failure("server", `http_${response.status}`, `${where} answered ${response.status}${said ? `: ${said}` : ""}`, undefined,
        { details: { status: response.status, source: url.pathname, ...(code ? { codes: [code] } : {}) } });
      diagnostics.trace.event("server", "failure", { ref, status: response.status, path: url.pathname });
      const headers = new Headers(response.headers);
      headers.set(ERROR_REF_HEADER, ref);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      const ref = diagnostics.log.failure("server", "unhandled", `${where} failed unexpectedly.`, error, { details: { source: url.pathname } });
      diagnostics.trace.event("server", "failure", { ref, path: url.pathname, code: "unhandled" });
      return json({ code: "internal", ref, error: `Something went wrong in XF Studio (reference ${ref}). Try again; if it keeps happening, report the problem from Help.` },
        500, { [ERROR_REF_HEADER]: ref });
    }
  });
}
