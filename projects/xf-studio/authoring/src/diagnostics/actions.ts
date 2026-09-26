/**
 * The diagnostics application service (docs/diagnostics.md): typed actions for "Report a problem" and diagnostic mode, the error
 * references notices carry, and the page's failures on their way to the host log. DOM-free; the browser device
 * (`browser-device.ts`) does the transport, clipboard, download and page facts behind `DiagnosticsDevice`.
 *
 * Nothing is sent anywhere by these actions: a report is prepared for review, and the person copies its summary, saves its file or
 * opens a pre-filled issue page themselves.
 */
import type { Capability } from "../platform/api";
import { refusal } from "../platform/api";
import { diagnosticEntry, errorCode, errorText, isExpectedFailure, newErrorRef, DIAGNOSTIC_LIMITS, type DiagnosticEntry,
  type DiagnosticLevel } from "./model";
import { DESCRIPTION_LIMIT, formatBytes, issueSummary, reportFileName, reportSummary, reportTitle, REPORT_GROUPS, previewOf,
  type PageFacts, type ReportGroup, type ReportItemView, type ReportManifest } from "./report";
import { redactText, redactValue } from "./redact";

export type DiagnosticsMode = "normal" | "deep";
export type ActivityLine = { time: string; tone: string; source: string; message: string };
export type DiagnosticsAction =
  | { kind: "diagnostics.prepareReport"; ref?: string | null; activity?: readonly ActivityLine[] }
  | { kind: "diagnostics.setIncluded"; item: string; included: boolean }
  | { kind: "diagnostics.confirmSharing"; confirmed: boolean }
  | { kind: "diagnostics.setDescription"; text: string }
  | { kind: "diagnostics.copySummary" }
  | { kind: "diagnostics.saveReport" }
  | { kind: "diagnostics.openIssue" }
  | { kind: "diagnostics.setMode"; mode: DiagnosticsMode }
  | { kind: "diagnostics.closeReport" };
export type DiagnosticsResult = { ok: true; message: string } | { ok: false; code: string; message: string };

type Descriptor = { scope: readonly ["host"]; effect: "read" | "view" | "download" | "clipboard" | "link" | "settings"; async: boolean; undo: "none";
  payload: Record<string, { type: string; required: boolean; from: "input"; min?: number; max?: number; values?: readonly string[] }> };
const descriptor = (effect: Descriptor["effect"], payload: Descriptor["payload"] = {}, async = true): Descriptor => ({ scope: ["host"], effect, async, undo: "none", payload });
/** Every diagnostics action, its effect and payload. None has Undo, touches a recipe or the library, or sends anything by itself. */
export const DIAGNOSTICS_DESCRIPTORS = Object.freeze({
  "diagnostics.prepareReport": descriptor("read", { ref: { type: "string", required: false, from: "input" }, activity: { type: "object", required: false, from: "input" } }),
  "diagnostics.setIncluded": descriptor("view", { item: { type: "string", required: true, from: "input" }, included: { type: "boolean", required: true, from: "input" } }, false),
  "diagnostics.confirmSharing": descriptor("view", { confirmed: { type: "boolean", required: true, from: "input" } }, false),
  "diagnostics.setDescription": descriptor("view", { text: { type: "string", required: true, from: "input", max: DESCRIPTION_LIMIT } }, false),
  "diagnostics.copySummary": descriptor("clipboard"),
  "diagnostics.saveReport": descriptor("download"),
  "diagnostics.openIssue": descriptor("link"),
  "diagnostics.setMode": descriptor("settings", { mode: { type: "enum", required: true, from: "input", values: ["normal", "deep"] } }),
  "diagnostics.closeReport": descriptor("view", {}, false),
} satisfies Record<DiagnosticsAction["kind"], Descriptor>);

/** What the page's device does for the service. */
export type DiagnosticsDevice = {
  /** Send entries to the host log; entries that can't be sent stay in the page's ring buffer. */
  forward(entries: DiagnosticEntry[]): void;
  /** Entries the page couldn't forward (its ring buffer), oldest first. */
  pending(): DiagnosticEntry[];
  /** The reference of a failed host request the page saw in the last few seconds and no notice has shown yet. */
  claimHostRef(): string | null;
  pageFacts(): PageFacts;
  state(): Promise<{ mode: DiagnosticsMode; until: string | null; minutes: number } | null>;
  setMode(mode: DiagnosticsMode): Promise<{ mode: DiagnosticsMode; until: string | null; minutes: number }>;
  prepare(ref: string | null): Promise<ReportManifest>;
  /** The report file's bytes from the host (the ticked items only). */
  bundle(request: { id: string; include: string[]; description: string; page: { facts: PageFacts; items: { id: string; label: string; detail: string; content: unknown }[] } }): Promise<Uint8Array>;
  save(name: string, bytes: Uint8Array, type: string): void;
  copy(text: string): Promise<void>;
  openIssue(title: string, body: string): Promise<void>;
};

export type ReportItemState = ReportItemView & { size: string; unavailable?: string };
export type ReportState = {
  phase: "preparing" | "ready" | "failed";
  ref: string | null;
  /** One plain line: why preparing failed, or what the last step did. */
  message: string | null;
  title: string;
  description: string;
  sharingConfirmed: boolean;
  groups: { id: ReportGroup; label: string; detail: string; bytes: number; size: string; items: ReportItemState[] }[];
  total: number;
  limit: number;
  /** The ticked total and the limit, in words ("1.2 MB of 20 MB"). */
  totalSize: string;
  fileName: string | null;
  busy: "saving" | "copying" | "opening" | null;
  /** The file name of the last save, so the issue summary can name it. */
  saved: string | null;
  window: ReportManifest["window"] | null;
};
export type DiagnosticsSnapshot = {
  mode: { mode: DiagnosticsMode; until: string | null; minutes: number } | null;
  report: ReportState | null;
  /** Increments each time a report is asked for, so a view opens the review exactly then. */
  opens: number;
  /** The newest failure an app service asked to be shown (the shell shows it once, with its reference). */
  notice: { id: number; ref: string | null; area: string; source: string; message: string } | null;
};

const PAGE_ITEM_TEXT: Record<string, { label: string; detail: string }> = {
  page: { label: "This window", detail: "Browser, graphics card and a few view settings." },
  activity: { label: "Recent messages", detail: "The notices and messages XF Studio showed you recently." },
  pending: { label: "Problems not yet in the log", detail: "Problems this window noticed but couldn't write to the app's log." },
};
/** Uncaught errors that browsers raise for harmless reasons, never shown or logged as problems. */
const BENIGN = /ResizeObserver loop|Script error\.?$/i;
const UNCAUGHT_NOTICE = "Something unexpected went wrong in XF Studio's window. If anything now looks or works wrong, report it so it can be fixed.";

export class DiagnosticsActions {
  private listeners = new Set<() => void>();
  private state: DiagnosticsSnapshot = { mode: null, report: null, opens: 0, notice: null };
  private manifest: ReportManifest | null = null;
  private pageItems: { id: string; label: string; detail: string; content: unknown; text: string }[] = [];
  private included = new Set<string>();
  private noticeId = 0;
  private lastUncaught = 0;
  private recent = new Map<string, number>();
  constructor(private readonly device: DiagnosticsDevice, private readonly now: () => number = Date.now) {}

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  snapshot(): DiagnosticsSnapshot { return structuredClone(this.state); }
  descriptors() { return structuredClone(DIAGNOSTICS_DESCRIPTORS); }
  private publish(next: Partial<DiagnosticsSnapshot>) { this.state = { ...this.state, ...next }; for (const listener of this.listeners) listener(); }
  private publishReport(next: Partial<ReportState>) { if (this.state.report) this.publish({ report: { ...this.state.report, ...next } }); }

  /** Read the rolling window's mode once the host is reachable. */
  async refresh(): Promise<void> {
    try { const mode = await this.device.state(); if (mode) this.publish({ mode }); } catch { /* The mode stays unknown; nothing depends on it. */ }
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // Failures and references

  private record(level: DiagnosticLevel, area: string, code: string, message: string, error: unknown, ref: string | null, source?: string) {
    // The same failure repeating (a render loop, a poll) is recorded once every ten seconds.
    const key = `${area}|${code}|${message}`, at = this.now();
    if (!ref && at - (this.recent.get(key) ?? -Infinity) < 10_000) return;
    this.recent.set(key, at);
    if (this.recent.size > 200) this.recent.delete(this.recent.keys().next().value!);
    const own = errorCode(error);
    this.device.forward([diagnosticEntry({ level, area, code, message: redactText(message), origin: "page", ref: ref ?? undefined,
      details: { stack: errorText(error), ...(own && own !== code ? { codes: [own] } : {}), ...(source ? { source } : {}) } })]);
  }

  /**
   * A notice about to be shown for a failed action or request. An expected refusal (busy, out of range, cancelled) gets nothing;
   * any other failure is logged and gets a reference, the host's when a failed host request just gave one, else a new one.
   */
  notice(failure: { source: string; message: string; code?: string }): string | null {
    if (isExpectedFailure(failure.code)) return null;
    const ref = this.device.claimHostRef() ?? newErrorRef();
    this.record("error", "notice", failure.code ?? "failed", failure.message, undefined, ref, failure.source);
    return ref;
  }

  /**
   * A failure an app service met (the page sink routes `pageFailure` here). Logged with a new reference; with `notify` it is also
   * published for the shell to show once, with that reference and "Report this problem".
   */
  failure(area: string, code: string, message: string, error?: unknown, options: { notify?: boolean; level?: DiagnosticLevel; source?: string } = {}): string {
    const ref = this.device.claimHostRef() ?? newErrorRef();
    this.record(options.level ?? "error", area, code, message, error, ref, options.source);
    if (options.notify) this.publish({ notice: { id: ++this.noticeId, ref, area, source: options.source ?? area, message } });
    return ref;
  }

  /** An uncaught error or rejection: logged; shown at most once a minute, since the page may have recovered by itself. */
  uncaught(kind: "error" | "rejection", error: unknown, message: string) {
    if (BENIGN.test(message)) return;
    const ref = newErrorRef();
    this.record("error", "page", kind === "error" ? "uncaught_error" : "unhandled_rejection", message || "Unknown error", error, ref);
    if (this.now() - this.lastUncaught < 60_000) return;
    this.lastUncaught = this.now();
    this.publish({ notice: { id: ++this.noticeId, ref, area: "page", source: "XF Studio", message: UNCAUGHT_NOTICE } });
  }

  /** A lost WebGL context: logged (the preview restores itself when the browser allows). */
  contextLost(what: string) { this.record("warn", "webgl", "context_lost", `The graphics context of the ${what} was lost.`, undefined, null); }
  contextRestored(what: string) { this.record("info", "webgl", "context_restored", `The graphics context of the ${what} came back.`, undefined, null); }

  // ---------------------------------------------------------------------------------------------------------------------------
  // Report actions

  private item(id: string): ReportItemState | undefined {
    return this.state.report?.groups.flatMap(group => group.items).find(item => item.id === id);
  }
  private totalWith(id: string, included: boolean) {
    const report = this.state.report!;
    return report.groups.flatMap(group => group.items).reduce((sum, item) =>
      sum + ((item.id === id ? included : this.included.has(item.id)) ? item.bytes : 0), 0);
  }

  capability(action: DiagnosticsAction): Capability {
    const report = this.state.report;
    const ready = report?.phase === "ready";
    switch (action.kind) {
      case "diagnostics.prepareReport":
        if (report?.phase === "preparing") return refusal("busy", "The report is being prepared.");
        if (action.ref !== undefined && action.ref !== null && !/^XF-[0-9A-HJKMNP-TV-Z]{4}$/.test(action.ref)) return refusal("invalid_value", "That isn't an XF Studio error reference.");
        return { available: true };
      case "diagnostics.setIncluded": {
        if (!ready) return refusal("not_ready", "Prepare the report first.");
        const item = this.item(action.item);
        if (!item) return refusal("missing_target", "That part isn't in this report.");
        if (!action.included) return { available: true };
        if (item.unavailable) return refusal("unavailable", item.unavailable);
        if (item.modFiles && !report!.sharingConfirmed) return refusal("needs_input", "First confirm below that you may share these mods' files.");
        if (this.totalWith(item.id, true) > report!.limit) return refusal("limit", `That would make the report larger than ${formatBytes(report!.limit)}. Untick something large first.`);
        return { available: true };
      }
      case "diagnostics.confirmSharing":
        return ready ? { available: true } : refusal("not_ready", "Prepare the report first.");
      case "diagnostics.setDescription":
        if (!report) return refusal("not_ready", "Open Report a problem first.");
        return action.text.length > DESCRIPTION_LIMIT ? refusal("limit", `Keep the description under ${DESCRIPTION_LIMIT} characters.`) : { available: true };
      case "diagnostics.copySummary": case "diagnostics.saveReport": case "diagnostics.openIssue":
        if (!ready) return refusal(report?.phase === "preparing" ? "busy" : "not_ready", report?.phase === "preparing" ? "The report is being prepared." : "Prepare the report first.");
        if (report!.busy) return refusal("busy", "Wait for the current step to finish.");
        if (action.kind === "diagnostics.saveReport" && this.totalWith("", false) > report!.limit) return refusal("limit", `The ticked items add up to more than ${formatBytes(report!.limit)}. Untick something large first.`);
        return { available: true };
      case "diagnostics.setMode":
        return action.mode === "normal" || action.mode === "deep" ? { available: true } : refusal("invalid_value", "Choose normal or diagnostic mode.");
      case "diagnostics.closeReport":
        return report ? { available: true } : refusal("not_ready", "No report is open.");
    }
  }

  async dispatch(action: DiagnosticsAction): Promise<DiagnosticsResult> {
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, code: allowed.code ?? "invalid_value", message: allowed.reason ?? "That isn't available now." };
    switch (action.kind) {
      case "diagnostics.prepareReport": return this.prepare(action.ref ?? null, action.activity ?? []);
      case "diagnostics.setIncluded": {
        if (action.included) this.included.add(action.item); else this.included.delete(action.item);
        this.regroup();
        return { ok: true, message: action.included ? "Included." : "Left out." };
      }
      case "diagnostics.confirmSharing": {
        if (!action.confirmed) for (const item of this.state.report!.groups.flatMap(group => group.items)) if (item.modFiles) this.included.delete(item.id);
        this.publishReport({ sharingConfirmed: action.confirmed });
        this.regroup();
        return { ok: true, message: action.confirmed ? "You can now tick mod files." : "Mod files left out." };
      }
      case "diagnostics.setDescription": this.publishReport({ description: action.text }); return { ok: true, message: "" };
      case "diagnostics.copySummary": return this.step("copying", async () => {
        await this.device.copy(this.summary());
        return "Summary copied. Paste it into your issue, and attach the saved report file.";
      });
      case "diagnostics.saveReport": return this.step("saving", async () => {
        const manifest = this.manifest!, report = this.state.report!;
        const bytes = await this.device.bundle({ id: manifest.id, include: [...this.included], description: report.description,
          page: { facts: this.device.pageFacts(), items: this.pageItems.map(({ text: _text, ...item }) => item) } });
        const name = reportFileName(manifest);
        this.device.save(name, bytes, "application/zip");
        this.publishReport({ saved: name });
        return `Saved ${name} (${formatBytes(bytes.length)}). Attach it to your issue.`;
      });
      case "diagnostics.openIssue": return this.step("opening", async () => {
        const manifest = this.manifest!, report = this.state.report!;
        await this.device.openIssue(report.title, issueSummary(manifest, report.description, report.saved));
        return report.saved ? "The issue page is open. Attach the saved report file there." : "The issue page is open. Save the report and attach it there.";
      });
      case "diagnostics.setMode": {
        try {
          const mode = await this.device.setMode(action.mode);
          this.publish({ mode });
          return { ok: true, message: action.mode === "deep" ? `Diagnostic mode is on for 24 hours: XF Studio keeps ${mode.minutes} minutes of detail.` : "Diagnostic mode is off." };
        } catch { return { ok: false, code: "unavailable", message: "XF Studio couldn't change diagnostic mode. Try again." }; }
      }
      case "diagnostics.closeReport":
        this.manifest = null; this.pageItems = []; this.included.clear();
        this.publish({ report: null });
        return { ok: true, message: "" };
    }
  }

  private async step(busy: NonNullable<ReportState["busy"]>, work: () => Promise<string>): Promise<DiagnosticsResult> {
    this.publishReport({ busy, message: null });
    try {
      const message = await work();
      this.publishReport({ busy: null, message });
      return { ok: true, message };
    } catch (error) {
      const message = (error as Error)?.message || "That didn't work. Try again.";
      this.publishReport({ busy: null, message });
      return { ok: false, code: "unavailable", message };
    }
  }

  private async prepare(ref: string | null, activity: readonly ActivityLine[]): Promise<DiagnosticsResult> {
    this.manifest = null; this.included.clear();
    const pending = this.device.pending();
    this.pageItems = [
      { id: "page", ...PAGE_ITEM_TEXT.page!, content: this.device.pageFacts() },
      ...(activity.length ? [{ id: "activity", ...PAGE_ITEM_TEXT.activity!, content: activity.slice(-100) }] : []),
      ...(pending.length ? [{ id: "pending", ...PAGE_ITEM_TEXT.pending!, content: pending }] : []),
    ].map(item => ({ ...item, text: JSON.stringify(redactValue(item.content), null, 1) }));
    this.publish({ opens: this.state.opens + 1, report: { phase: "preparing", ref, message: null, title: reportTitle(ref, []), description: this.state.report?.description ?? "",
      sharingConfirmed: false, groups: [], total: 0, limit: 0, totalSize: "", fileName: null, busy: null, saved: null, window: null } });
    try {
      const manifest = await this.device.prepare(ref);
      this.manifest = manifest;
      for (const item of manifest.items) if (item.included) this.included.add(item.id);
      for (const item of this.pageItems) this.included.add(item.id);
      this.publishReport({ phase: "ready", title: reportTitle(ref, manifest.problem), limit: manifest.limits.total, fileName: reportFileName(manifest), window: manifest.window });
      this.regroup();
      return { ok: true, message: "Report ready for review." };
    } catch (error) {
      this.publishReport({ phase: "failed", message: (error as Error)?.message || "XF Studio couldn't prepare the report." });
      return { ok: false, code: "unavailable", message: this.state.report!.message! };
    }
  }

  /** The review's groups from the host's items and the page's own, with what is ticked now. */
  private regroup() {
    const report = this.state.report, manifest = this.manifest;
    if (!report || !manifest) return;
    const pageViews: ReportItemView[] = this.pageItems.map(item => ({ id: item.id, group: item.id === "page" ? "about" : "happened", label: item.label,
      detail: item.detail, bytes: new TextEncoder().encode(item.text).length, included: true, preview: previewOf(item.text) }));
    const all: ReportItemState[] = [...manifest.items, ...pageViews].map(item => ({ ...item, size: formatBytes(item.bytes), included: this.included.has(item.id) }));
    const groups = REPORT_GROUPS.map(group => {
      const items = all.filter(item => item.group === group.id);
      const bytes = items.filter(item => item.included).reduce((sum, item) => sum + item.bytes, 0);
      return { ...group, items, bytes, size: formatBytes(bytes) };
    }).filter(group => group.items.length);
    const total = groups.reduce((sum, group) => sum + group.bytes, 0);
    this.publishReport({ groups, total, totalSize: `${formatBytes(total)} of ${formatBytes(report.limit)}` });
  }

  /** The readable summary of what is ticked now (what "Copy summary" copies). */
  summary(): string {
    const manifest = this.manifest, report = this.state.report;
    if (!manifest || !report) return "";
    const included = report.groups.flatMap(group => group.items).filter(item => item.included);
    return reportSummary({ manifest, description: report.description, page: this.device.pageFacts(), included });
  }
}

/** Bounds on what the page keeps of its own entries (for tests and the device). */
export const PAGE_RING = DIAGNOSTIC_LIMITS.ring;
