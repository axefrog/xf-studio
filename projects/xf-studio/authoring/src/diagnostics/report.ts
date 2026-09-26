/**
 * The problem report's shared shapes and wording (docs/diagnostics.md §Report): the review screen's groups and items, the readable
 * summary (the report file's README and "Copy summary"), its index (`report.json`), and the pre-filled issue link. The host builds the
 * items and the report file; the page shows them for review, the summary and index included, from these same functions, so the
 * preview is what the file holds. Both are built from the ticked items only (DIAG-01). Nothing here sends anything, and every text
 * passes through a redactor last. DOM-free.
 */
import { entryLine, type DiagnosticEntry } from "./model";
import { redactValue, remainingPersonalData, textRedactor, type Redactor } from "./redact";
import { PROJECT_LINKS } from "../project-links";

export const REPORT_MANIFEST_SCHEMA = "xfs/problem-report-manifest-1" as const;
export const REPORT_FILE_SCHEMA = "xfs/problem-report-1" as const;

export type ReportGroup = "about" | "happened" | "mods" | "resources" | "optional";
/** The review screen's groups, in order. */
export const REPORT_GROUPS: readonly { id: ReportGroup; label: string; detail: string }[] = Object.freeze([
  { id: "about", label: "About XF Studio and your system", detail: "Versions and settings, so we know what you're running." },
  { id: "happened", label: "What happened", detail: "The problem and what led up to it." },
  { id: "mods", label: "Your mod setup", detail: "Which mods and frameworks are installed, by name, version and source. No mod files." },
  { id: "resources", label: "Resource details", detail: "How your V's details were worked out, and short extracts of the game resources involved." },
  { id: "optional", label: "Optional files", detail: "Larger or private material. Nothing here is included unless you tick it." },
]);

/** One reviewable part of the report. `bytes` is its size in the report file before compression. */
export type ReportItemView = {
  id: string; group: ReportGroup; label: string; detail: string; bytes: number;
  /** Ticked when the review opens. */
  included: boolean;
  /** A mod's own files: ticking needs the sharing confirmation. */
  modFiles?: boolean;
  /** The start of its content, as it will be written (redacted). */
  preview: string;
};
export type ReportFacts = {
  app: { version: string; commit: string | null; channel: string | null; host: "localhost" | "desktop" };
  os: string; runtime: string; webView2: string | null;
  game: { version: string | null; found: boolean }; launchRoute: string;
  frameworks: { name: string; version: string | null; status: string }[] | null;
  wolvenKit: { version: string | null; source: string };
};
export type PageFacts = { browser: string; gpu: string | null; webgl2: boolean; state: Record<string, string> };
/** What the host returns when a report is prepared. */
export type ReportManifest = {
  schema: typeof REPORT_MANIFEST_SCHEMA;
  id: string; ref: string | null; made: string;
  facts: ReportFacts;
  /** The entries of this problem (its reference and the ones it links to), and the newest others, oldest first. */
  problem: DiagnosticEntry[]; recent: DiagnosticEntry[];
  items: ReportItemView[];
  limits: { total: number; modFiles: number };
  /** The rolling window's state when the report was made. */
  window: { mode: "normal" | "deep"; minutes: number; until: string | null };
};

export const PREVIEW_CHARS = 4_000;
export const DESCRIPTION_LIMIT = 4_000;
/** A pre-filled issue link stays well inside what browsers and GitHub accept for one URL. */
export const ISSUE_URL_LIMIT = 6_000;
/** The new-issue page every issue link starts with. */
export const ISSUE_BASE = `${PROJECT_LINKS["project-issues"]}/new`;

export const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 102.4) / 10} KB`
  : `${Math.round(bytes / (1024 * 102.4)) / 10} MB`;
const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
const fence = (text: string) => "```text\n" + text.replace(/```/g, "ʼʼʼ") + "\n```";

export function versionLine(app: ReportFacts["app"]) {
  return `${app.version}${app.channel ? ` (${app.channel})` : ""}, ${app.host === "desktop" ? "desktop app" : "localhost server"}${app.commit ? `, commit ${app.commit}` : ""}`;
}
/** A report's title: its reference and the first line of what happened. */
export function reportTitle(ref: string | null, problem: readonly DiagnosticEntry[], redact: Redactor = PLAIN) {
  const first = problem[0];
  return redact(ref ? `Problem report ${ref}${first ? `: ${clip(first.message, 70)}` : ""}` : "Problem report");
}
const PLAIN = textRedactor();

/** What the summary and the index are built from: the report, the person's description, and the items they left ticked. */
export type ReportFileInput = { manifest: ReportManifest; description: string; page: PageFacts | null; included: readonly ReportItemView[];
  /** Every item the review offered (the page's own included), to count what was left out. */
  offered: readonly Pick<ReportItemView, "id">[] };

/**
 * The readable summary: the person's own description first, then only what they left ticked: the versions ("Versions"), the
 * window's browser and graphics card ("This window"), the problem's entries ("This problem") and the last log lines ("App log"),
 * and the list of what the report file holds. It is the report file's README and what "Copy summary" copies.
 */
export function reportSummary(input: ReportFileInput, redact: Redactor = PLAIN): string {
  const { manifest, page } = input, facts = manifest.facts;
  const ticked = new Set(input.included.map(item => item.id));
  const environment = ticked.has("environment"), shown = ticked.has("page") && page;
  const lines = [
    `## XF Studio problem report${manifest.ref ? ` ${manifest.ref}` : ""}`,
    "",
    `Made ${manifest.made}. Personal folder names, e-mail addresses and save names are replaced with placeholders such as \`<user>\`, and your configured folders with \`<game>\` or \`<mo2>\`.`,
    "",
    "### What I was doing",
    "",
    input.description.trim() || "(No description given.)",
    "",
    ...(environment || shown ? ["### Environment", "",
      ...(environment ? [`- **XF Studio:** ${versionLine(facts.app)}`, `- **System:** ${facts.os}; host runtime ${facts.runtime}`] : []),
      ...(shown ? [`- **Browser:** ${page.browser}${environment && facts.webView2 ? ` (WebView2 Runtime ${facts.webView2})` : ""}`,
        `- **GPU:** ${page.gpu ?? "unknown"}; WebGL2 ${page.webgl2 ? "available" : "unavailable"}`] : []),
      ...(environment ? [
        `- **Game:** ${facts.game.found ? facts.game.version ?? "found (version unreadable)" : "not set up"}`,
        `- **Launch route:** ${facts.launchRoute}`,
        `- **WolvenKit:** ${facts.wolvenKit.version ?? "no version"} (${facts.wolvenKit.source})`,
        `- **Frameworks:** ${facts.frameworks ? facts.frameworks.length ? facts.frameworks.map(item => `${item.name} ${item.version ?? "—"} (${item.status})`).join("; ") : "none found" : "not checked"}`] : []),
      ""] : []),
    "### What happened",
    "",
    !ticked.has("problem") ? manifest.ref ? `Reference ${manifest.ref}; its log entries weren't included.` : "Reported from Help, without a specific error."
      : manifest.problem.length ? fence(manifest.problem.map(entry => entryLine(entry) + (entry.details?.stack ? `\n${entry.details.stack.split("\n").slice(0, 12).map(line => `  ${line}`).join("\n")}` : "")).join("\n"))
      : manifest.ref ? `No log entry carries ${manifest.ref} yet.` : "Reported from Help, without a specific error.",
    "",
    ...(ticked.has("log") && manifest.recent.length ? ["Most recent log lines:", "", fence(manifest.recent.slice(-15).map(entryLine).join("\n")), ""] : []),
    "### In the report file",
    "",
    ...(input.included.length ? input.included.map(item => `- ${item.label} (${formatBytes(item.bytes)})`) : ["- Nothing else was selected."]),
    "",
  ];
  return redact(lines.join("\n"));
}

/**
 * The report file's index (`report.json`): when and what, the versions and the window's facts only when ticked, the ticked items,
 * and how many were left out, by their fixed IDs only (an unticked mod's name never appears).
 */
export function reportIndex(input: ReportFileInput, redact: Redactor = PLAIN): string {
  const { manifest } = input, ticked = new Set(input.included.map(item => item.id));
  const leftOut = input.offered.filter(item => !ticked.has(item.id)).map(item => item.id);
  return JSON.stringify(redactValue({ schema: REPORT_FILE_SCHEMA, made: manifest.made, ref: manifest.ref,
    app: ticked.has("environment") ? manifest.facts.app : null, description: input.description,
    page: ticked.has("page") ? input.page : null, window: manifest.window,
    included: input.included.map(item => ({ id: item.id, group: item.group, label: item.label, bytes: item.bytes })),
    leftOut: { count: leftOut.length, items: leftOut },
  }, redact), null, 1);
}

/** The short body a pre-filled issue link carries; the person attaches the saved report file for the rest. */
export function issueSummary(manifest: ReportManifest, description: string, fileName: string | null,
  included: ReadonlySet<string> = new Set(["problem"]), redact: Redactor = PLAIN): string {
  const first = included.has("problem") ? manifest.problem[0] : undefined;
  return redact([
    `**Reference:** ${manifest.ref ?? "none"}`,
    `**XF Studio:** ${versionLine(manifest.facts.app)}`,
    `**System:** ${manifest.facts.os}`,
    ...(first ? [`**What happened:** ${first.area}/${first.code}: ${clip(first.message, 240)}`] : []),
    "",
    "**What I was doing:**",
    "",
    clip(description.trim(), 1_200) || "",
    "",
    fileName ? `**Report file:** please attach \`${fileName}\`, which XF Studio saved for you (drag it into this box).` :
      "**Report file:** please save the report in XF Studio (Report a problem → Save report) and attach it here.",
    "",
    "_Attachments on GitHub are public. The report file only holds what you left ticked when you saved it._",
  ].join("\n"));
}

/** The pre-filled "new issue" link; the body is shortened until the link fits `limit`. */
export function issueUrl(title: string, body: string, limit = ISSUE_URL_LIMIT): string {
  const url = (text: string) => `${ISSUE_BASE}?${new URLSearchParams({ title, body: text }).toString()}`;
  let text = body;
  while (url(text).length > limit && text.length > 40) text = `${text.slice(0, Math.floor(text.length * 0.8))}…`;
  return url(text);
}

/** The report file's name. */
export const reportFileName = (manifest: Pick<ReportManifest, "ref" | "made">) =>
  `xf-studio-report-${manifest.ref ?? "help"}-${manifest.made.replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z")}.zip`;

/** The start of an item's content as it will be written. */
export function previewOf(text: string): string {
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}\n… (${formatBytes(text.length - PREVIEW_CHARS)} more in the report file)` : text;
}

/** True when a text still holds personal data by the shared rules (a defect; tests assert it never is). */
export const reportLeaks = (text: string) => remainingPersonalData(text) !== null;
