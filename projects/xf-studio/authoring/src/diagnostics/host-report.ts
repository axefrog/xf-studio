/**
 * What the host contributes to a problem report, built on demand when the person opens "Report a problem" (docs/diagnostics.md
 * §Report). Facts about the app, the system, the game and the tools; the log; the rolling window; and targeted details the window's
 * references point to: the latest V's resolution, the load-order winners of the resources it used, bounded excerpts of those
 * resources' tables from the resolver's own JSON cache, and the installed frameworks and mod list (names and versions). Never an
 * archive, a mesh or a texture. Every string is redacted with the person's own folders, the configured folders and the shared
 * personal-data rules. The full mod list and anything taken from mods' own files start unticked.
 */
import { existsSync, openSync, readdirSync, readFileSync, readSync, closeSync, statSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { join } from "node:path";
import { depotHash } from "../depot-path";
import { hostFrameworkCheck } from "../install-detection-server";
import type { LocalSettings } from "../local-settings";
import { describeMo2Instance, parseMo2Modlist, parseQSettingsIni } from "../mo2-instance";
import { readPeFileVersion } from "../pe-version";
import { boundJson, DIAGNOSTIC_LIMITS, type DiagnosticEntry, type TraceEntry } from "./model";
import { redactValue, textRedactor, type KnownRoot } from "./redact";
import type { HostDiagnostics } from "./host-log";
import { processPersonalRoots } from "./host-roots";
import { involvedMods, MOD_FILE_LIMIT, REPORT_LIMIT } from "./mod-identity";
import { formatBytes, previewOf, REPORT_MANIFEST_SCHEMA, type ReportFacts, type ReportGroup, type ReportItemView, type ReportManifest } from "./report";

export type HostAppFacts = { version: string; commit: string | null; channel: string | null; host: "localhost" | "desktop" };
export type HostReportSources = {
  app: () => HostAppFacts;
  settings: () => LocalSettings | null;
  /** The WolvenKit CLI in effect and where it came from. */
  wolvenKit?: () => { version: string | null; source: "custom" | "managed" | null; phase?: string } | null;
  /** The desktop host's detected WebView2 Runtime version. */
  webView2?: string | null;
  /** Folders to name instead of print: the data folder, tools, caches. */
  roots?: () => KnownRoot[];
  /** The resolver's JSON cache (excerpts come from it, never from archives). */
  resolverCache?: string | null;
  /** Time a report spends hashing mod files before using their size and date (`HASH_BUDGET_MS`; tests set it). */
  hashBudgetMs?: number;
};
/** The rolling window's share of a report file; its newest events are kept. */
export const TRACE_REPORT_BYTES = 4 * 1024 * 1024;
const EXCERPT_BYTES = 48 * 1024, EXCERPT_TOTAL = 480 * 1024, EXCERPT_COUNT = 24;
const EXCERPT_KINDS = /\.(?:app|ent|mesh|morphtarget|mi|mt|inkcharcustomization)$/i;
/** Keys whose values are geometry, texture or raw bytes: never in an excerpt. */
const PAYLOAD_KEYS = /^(?:renderResourceBlob|baseBlob|blob|Bytes|rawData|bufferData|textureData|compiledData|mipsData|renderBuffer|indexBuffer|vertexBuffer|geometry|parameterBuffers?)$/i;

const osName = () => {
  const name = platform() === "win32" ? "Windows" : platform() === "darwin" ? "macOS" : platform() === "linux" ? "Linux" : platform();
  return `${name} ${release()} (${arch()})`;
};

function peVersionOf(path: string): string | null {
  let handle: number | null = null;
  try {
    handle = openSync(path, "r");
    const fd = handle;
    return readPeFileVersion((offset, length) => {
      const bytes = new Uint8Array(length);
      return readSync(fd, bytes, 0, length, offset) === length ? bytes : null;
    });
  } catch { return null; }
  finally { if (handle !== null) try { closeSync(handle); } catch { /* Closed. */ } }
}

const isSet = (value: string | null | undefined) => value ? existsSync(value) ? "set" : "set, not found" : "not set";
function settingsSummary(settings: LocalSettings | null): Record<string, string> {
  if (!settings) return { settings: "unreadable" };
  return {
    "game folder": isSet(settings.gameRoot), "launch route": settings.launchRoute, "MO2 folder": isSet(settings.mo2Root),
    "MO2 profile": settings.mo2ProfileId ? "chosen" : "not chosen", "manual mod folder": isSet(settings.manualModRoot),
    "WolvenKit CLI (own choice)": isSet(settings.wolvenKitCli), "install mode": settings.installMode,
    "eye plate head": settings.eyePlateHead, "update channel": settings.updates.channel,
    "source cache folder": isSet(settings.sourceCache.directory), "preview cache folder": isSet(settings.preview.cacheDirectory),
  };
}

/** An MO2 instance's own folders, which ModOrganizer.ini may put anywhere (another drive, a profile folder). */
function mo2InstanceRoots(settings: LocalSettings | null): KnownRoot[] {
  if (!settings?.mo2Root) return [];
  try {
    let ini: string | null = null;
    try { ini = readFileSync(join(settings.mo2Root, "ModOrganizer.ini"), "utf8"); } catch { /* The default layout. */ }
    const { paths, gamePath } = describeMo2Instance(ini, settings.mo2Root, "configured", "instance");
    return [{ label: "<mo2-mods>", path: paths.mods }, { label: "<mo2-profiles>", path: paths.profiles },
      { label: "<mo2-overwrite>", path: paths.overwrite }, { label: "<mo2-downloads>", path: paths.downloads },
      { label: "<mo2-base>", path: paths.base }, { label: "<game>", path: gamePath }];
  } catch { return []; }
}

/**
 * Everything a report (and, through the endpoint, the log and the window) names instead of printing: the person's own folders, the
 * configured folders, the MO2 instance's folders wherever they are, and the host's own (data, tools, caches).
 */
export function knownRoots(sources: HostReportSources, settings: LocalSettings | null): KnownRoot[] {
  return [
    ...processPersonalRoots(),
    { label: "<game>", path: settings?.gameRoot }, { label: "<mo2>", path: settings?.mo2Root }, ...mo2InstanceRoots(settings),
    { label: "<manual-mods>", path: settings?.manualModRoot }, { label: "<wolvenkit>", path: settings?.wolvenKitCli },
    { label: "<source-cache>", path: settings?.sourceCache.directory }, { label: "<preview-cache>", path: settings?.preview.cacheDirectory },
    { label: "<preview-output>", path: settings?.preview.outputDirectory }, { label: "<resolver-cache>", path: sources.resolverCache },
    ...(sources.roots?.() ?? []),
  ];
}

/** The newest event of a kind in the window, or null. */
const latest = (trace: readonly TraceEntry[], area: string, event: string) =>
  [...trace].reverse().find(entry => entry.area === area && entry.event === event) ?? null;

/** Every resolved resource in a value: objects with a depot `ref` and a resolution `status` (the resolver's `Provenance`). */
function provenances(value: unknown, out = new Map<string, Record<string, unknown>>(), depth = 0): Map<string, Record<string, unknown>> {
  if (!value || typeof value !== "object" || depth > 24) return out;
  if (Array.isArray(value)) { for (const item of value) provenances(item, out, depth + 1); return out; }
  const record = value as Record<string, unknown>, ref = record.ref as { hash?: unknown; path?: unknown } | undefined;
  if (ref && typeof ref === "object" && typeof ref.hash === "string" && (record.status === "archive" || record.status === "missing")) {
    const key = ref.hash;
    if (!out.has(key)) out.set(key, record);
  }
  for (const item of Object.values(record)) provenances(item, out, depth + 1);
  return out;
}

/**
 * The resources the latest preparation used, as the resolver's provenance records. From the resolution's table (or its inline
 * records, in an older window), else, when the resolution was too large to keep, from the preparation's parts and their winning
 * archives (fewer details: no losing archives or rules).
 */
export function resolutionResources(resolved: TraceEntry | null, prepared: TraceEntry | null): Record<string, unknown>[] | null {
  const data = resolved?.data as Record<string, unknown> | undefined;
  if (data && (!data.truncated || Array.isArray(data.resources))) {
    const found = [...provenances(Array.isArray(data.resources) ? data.resources : data).values()];
    if (found.length) return found;
  }
  const parts = (prepared?.data as { components?: unknown } | undefined)?.components;
  if (!Array.isArray(parts)) return null;
  const out = new Map<string, Record<string, unknown>>();
  for (const part of parts) for (const source of Array.isArray(part?.sources) ? part.sources : []) {
    if (typeof source?.path !== "string" || !source.path) continue;
    const hash = depotHash(source.path);
    if (!out.has(hash)) out.set(hash, { ref: { hash, path: source.path }, status: source.archive ? "archive" : "missing",
      archive: source.archive ?? null, provider: source.provider ?? null, group: null, alternatives: [], rule: { rule: "from the preparation's parts" } });
  }
  return out.size ? [...out.values()] : null;
}

/** The winners (and losing alternatives) of the resources the latest resolution used. */
function winners(resources: Record<string, unknown>[] | null) {
  if (!resources) return null;
  return resources.map(item => {
    const ref = item.ref as { hash: string; path?: string };
    return { path: ref.path ?? null, hash: ref.hash, status: item.status, archive: item.archive ?? null, provider: item.provider ?? null,
      group: item.group ?? null, alternatives: item.alternatives ?? [], rule: (item.rule as { rule?: string } | undefined)?.rule ?? null,
      via: item.via ?? [], ambiguities: item.ambiguities ?? [] };
  }).sort((a, b) => String(a.path ?? a.hash).localeCompare(String(b.path ?? b.hash)));
}

/** Bounded excerpts of the resources the latest resolution used, from the resolver's JSON cache (no archive is read). */
function excerpts(resources: Record<string, unknown>[] | null, cacheDir: string | null | undefined) {
  if (!resources || !cacheDir) return null;
  const folder = join(cacheDir, "json");
  let names: string[] = [];
  try { names = readdirSync(folder); } catch { return { note: "The resolver cache has no resources yet." }; }
  const out: { path: string; archive: unknown; excerpt: unknown }[] = [];
  let total = 0;
  for (const item of resources) {
    const ref = item.ref as { hash: string; path?: string };
    if (!ref.path || !EXCERPT_KINDS.test(ref.path) || out.length >= EXCERPT_COUNT) continue;
    const hash = /^\d+$/.test(ref.hash) ? ref.hash : depotHash(ref.path);
    const files = names.filter(name => name.startsWith(`${hash}-`) && name.endsWith(".json"))
      .map(name => { try { return { name, time: statSync(join(folder, name)).mtimeMs }; } catch { return { name, time: 0 }; } })
      .sort((a, b) => b.time - a.time);
    if (!files.length) continue;
    let root: unknown;
    try { root = (JSON.parse(readFileSync(join(folder, files[0]!.name), "utf8")).document as { Data?: { RootChunk?: unknown } })?.Data?.RootChunk; }
    catch { continue; }
    if (!root) continue;
    let excerpt = boundJson(root, { depth: 12, items: 64, text: 300, drop: PAYLOAD_KEYS });
    if (JSON.stringify(excerpt).length > EXCERPT_BYTES) excerpt = boundJson(root, { depth: 7, items: 24, text: 160, drop: PAYLOAD_KEYS });
    const size = JSON.stringify(excerpt).length;
    if (size > EXCERPT_BYTES) excerpt = { note: `Left out: ${Math.round(size / 1024)} KB even when shortened.` };
    if (total + Math.min(size, EXCERPT_BYTES) > EXCERPT_TOTAL) break;
    total += Math.min(size, EXCERPT_BYTES);
    out.push({ path: ref.path, archive: item.archive ?? null, excerpt });
  }
  return out;
}

const MAX_MODS = 2_000;
/** Installed mods by name (and version, where the mod manager records one): the launch route's list, never file contents. */
function modList(settings: LocalSettings | null) {
  if (!settings?.gameRoot) return null;
  const list = (folder: string, pattern: RegExp) => {
    try { return readdirSync(folder).filter(name => pattern.test(name)).sort().slice(0, MAX_MODS); } catch { return null; }
  };
  const game = { archives: list(join(settings.gameRoot, "archive", "pc", "mod"), /\.(?:archive|xl)$/i),
    redmods: list(join(settings.gameRoot, "mods"), /./), tweaks: list(join(settings.gameRoot, "r6", "tweaks"), /./),
    red4ext: list(join(settings.gameRoot, "red4ext", "plugins"), /./) };
  const manual = settings.manualModRoot ? list(join(settings.manualModRoot), /./) : null;
  let mo2: unknown = null;
  if (settings.mo2Root && settings.mo2ProfileId) {
    try {
      let ini: string | null = null;
      try { ini = readFileSync(join(settings.mo2Root, "ModOrganizer.ini"), "utf8"); } catch { /* A bare default layout. */ }
      const instance = describeMo2Instance(ini, settings.mo2Root, "configured", "instance");
      const modlist = parseMo2Modlist(readFileSync(join(instance.paths.profiles, settings.mo2ProfileId, "modlist.txt"), "utf8"));
      mo2 = { profileMods: modlist.entries.length, mods: modlist.entries.slice(0, MAX_MODS).map(entry => {
        let version: string | null = null;
        if (entry.kind === "mod") try {
          version = parseQSettingsIni(readFileSync(join(instance.paths.mods, entry.name, "meta.ini"), "utf8")).get("general")?.get("version") ?? null;
        } catch { /* No meta.ini. */ }
        return { name: entry.name, enabled: entry.enabled, kind: entry.kind, priority: entry.priority, version };
      }) };
    } catch { mo2 = { note: "The MO2 profile's mod list couldn't be read." }; }
  }
  return { route: settings.launchRoute, game, manual, mo2 };
}

export type PreparedHostReport = {
  manifest: ReportManifest;
  /** Each JSON item's text as the report file will hold it (redacted). */
  contents: Map<string, string>;
  /** Each mod-file item's archives (private paths; only read when the person ticks the item and saves). */
  files: Map<string, { name: string; path: string; mod: string }[]>;
};

const FULL_RESOURCES_BYTES = 6 * 1024 * 1024;
/** Full JSON of the resources the latest resolution used (payload fields left out), for the optional item. */
function fullResources(resources: Record<string, unknown>[] | null, cacheDir: string | null | undefined) {
  if (!resources || !cacheDir) return null;
  const folder = join(cacheDir, "json");
  let names: string[] = [];
  try { names = readdirSync(folder); } catch { return null; }
  const out: { path: string; archive: unknown; document: unknown }[] = [];
  let total = 0;
  for (const item of resources) {
    const ref = item.ref as { hash: string; path?: string };
    if (!ref.path || !EXCERPT_KINDS.test(ref.path)) continue;
    const hash = /^\d+$/.test(ref.hash) ? ref.hash : depotHash(ref.path);
    const file = names.find(name => name.startsWith(`${hash}-`) && name.endsWith(".json"));
    if (!file) continue;
    try {
      const document = boundJson((JSON.parse(readFileSync(join(folder, file), "utf8")) as { document?: unknown }).document,
        { depth: 40, items: 4_000, text: 4_000, drop: PAYLOAD_KEYS });
      const size = JSON.stringify(document).length;
      if (total + size > FULL_RESOURCES_BYTES) break;
      total += size;
      out.push({ path: ref.path, archive: item.archive ?? null, document });
    } catch { /* Skipped. */ }
  }
  return out.length ? out : null;
}

const jsonText = (value: unknown) => JSON.stringify(value, null, 1);

/**
 * The MO2 profile's name where the framework check's wording carries it: quoted (`profile "Default"`) or as a folder in a path
 * (`profiles\Default\modlist.txt`). Never a plain substring replace, which would rewrite every word containing it (DIAG-21).
 */
export function hideProfileName(text: string, profile: string | null | undefined): string {
  if (!profile) return text;
  const name = profile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(String.raw`(?<=["“'‘])${name}(?=["”'’])|(?<=[\\/])${name}(?=[\\/]|$)`, "gi"), "<profile>");
}

/** The framework check as a report shows it: the MO2 profile's name left out wherever the check's wording carries it (DIAG-08). */
function frameworkRoutes(check: ReturnType<typeof hostFrameworkCheck> | undefined, profile: string | null | undefined) {
  if (!check) return null;
  const hide = (text: string) => hideProfileName(text, profile);
  return check.routes.map(item => ({ ...redactValue({ ...item, label: "" }, hide),
    label: item.route === "mo2" ? "Mod Organizer 2" : item.label, profileId: item.profileId ? "chosen" : null }));
}
/** Mod files are offered only for a mod that is itself a folder the person installed (an MO2 mod, a manual folder), never game files. */
const OFFERS_FILES: ReadonlySet<string> = new Set(["mo2-mod", "manual"]);
/** A note for anything taken from mods' own files (DIAG-18). */
const MOD_CONTENT_NOTE = "Parts of these come from the mods' own files, so include them only when they help explain this problem.";
const utf8Bytes = (text: string) => Buffer.byteLength(text, "utf8");

/** Build the host's share of a report: the manifest the review screen shows and the contents behind it. Never throws for a part. */
export async function buildHostReport(diagnostics: HostDiagnostics, sources: HostReportSources, ref: string | null, id: string,
  /** One plain line on what it is doing now, for the review's status (DIAG-11). */
  progress: (message: string) => void = () => {}): Promise<PreparedHostReport> {
  progress("Reading your setup…");
  let settings: LocalSettings | null = null;
  try { settings = sources.settings(); } catch { /* Unreadable settings are reported as such. */ }
  const exe = settings?.gameRoot ? join(settings.gameRoot, "bin", "x64", "Cyberpunk2077.exe") : null;
  const gameFound = !!exe && existsSync(exe);
  const frameworkCheck = settings ? hostFrameworkCheck(settings) : undefined;
  const route = frameworkCheck?.routes.find(item => item.route === frameworkCheck.selectedRoute);
  let wolvenKit: ReturnType<NonNullable<HostReportSources["wolvenKit"]>> = null;
  try { wolvenKit = sources.wolvenKit?.() ?? null; } catch { /* Reported as unknown. */ }
  const facts: ReportFacts = {
    app: sources.app(), os: osName(), runtime: `Bun ${Bun.version}`, webView2: sources.webView2 ?? null,
    game: { version: gameFound ? peVersionOf(exe!) : null, found: gameFound },
    launchRoute: settings?.launchRoute === "mo2" ? "Mod Organizer 2" : settings ? settings.manualModRoot ? "game folder with a manual mod folder" : "game folder" : "unknown",
    frameworks: route ? route.frameworks.map(item => ({ name: item.name, version: item.version,
      status: route.verdicts.find(verdict => verdict.framework === item.framework)?.status ?? (item.installed ? "installed" : "missing") })) : null,
    wolvenKit: { version: wolvenKit?.version ?? null,
      source: wolvenKit?.source === "managed" ? "XF Studio's own copy" : wolvenKit?.source === "custom" ? "a copy you chose" : `not ready${wolvenKit?.phase ? ` (${wolvenKit.phase})` : ""}` },
  };
  const roots = knownRoots(sources, settings);
  const trace = diagnostics.trace.read(TRACE_REPORT_BYTES);
  const resolved = latest(trace, "character", "resolved"), prepared = latest(trace, "character", "prepared");
  // "This problem" searches the whole log and the host failures kept apart from it, so a flood of later entries can't hide it (DIAG-07).
  const everything = diagnostics.log.tail();
  const entries = everything.slice(-200);
  const problem = matchingEntries(mergeEntries(everything, diagnostics.log.hostFailures()), ref);
  const state = diagnostics.trace.state();
  const resources = resolutionResources(resolved, prepared);
  const winnerList = winners(resources);
  const mods = await involvedMods(winnerList, settings, undefined, { hashBudgetMs: sources.hashBudgetMs,
    progress: (done, total) => { if (total) progress(`Fingerprinting the mod files involved (${done} of ${total})…`); } });
  progress("Putting the report together…");
  const full = fullResources(resources, sources.resolverCache);
  type Built = { id: string; group: ReportGroup; label: string; detail: string; content: unknown; included?: boolean };
  const built: Built[] = [
    { id: "environment", group: "about", label: "Versions", detail: "XF Studio, system, game, WolvenKit and framework versions.", content: facts },
    { id: "settings", group: "about", label: "Setup choices", detail: "Your setup choices. Folders show only whether they're set.", content: settingsSummary(settings) },
    ...(ref ? [{ id: "problem", group: "happened" as const, label: "This problem", detail: `The log entries for ${ref}, with their technical details.`, content: problem }] : []),
    { id: "log", group: "happened", label: "App log", detail: `XF Studio's recent log: ${entries.length} entries.`, content: entries },
    { id: "trace", group: "happened", label: "Recent activity detail", detail: `What XF Studio worked out in the last ${state.minutes} minutes (${trace.length} events): which files won, what was prepared. Names and references only.`, content: trace },
    { id: "involved-mods", group: "mods", label: "Mods involved", detail: mods.length ? `${mods.length} mods supplied or lost resources your V used: names, versions, download sources and file fingerprints.` : "No mods were involved in the recent window.",
      content: mods.map(({ archives, ...mod }) => ({ ...mod, archives: archives.map(({ path: _path, ...archive }) => archive) })) },
    // The whole mod list is personal and not needed to reproduce a problem (the involved mods are): unticked by default (DIAG-08).
    { id: "mods", group: "mods", label: "Frameworks and full mod list", detail: "Installed frameworks and every mod you have, enabled or not, by name and version. Only tick this if you're asked for it.",
      content: { frameworks: frameworkRoutes(frameworkCheck, settings?.mo2ProfileId), mods: modList(settings) }, included: false },
    { id: "resolution", group: "resources", label: "Your V's latest preparation", detail: "The creator options, apps, meshes and materials your V used, and which mod supplied each.",
      content: resolved || prepared ? { resolved: resolved?.data ?? null, prepared: prepared?.data ?? null, at: (resolved ?? prepared)!.t } : null },
    { id: "winners", group: "resources", label: "Load-order winners", detail: "For each resource: the archive that won, the ones it beat and the rule that decided.", content: winnerList },
    { id: "excerpts", group: "resources", label: "Resource tables", detail: `Short extracts of those apps, meshes and materials (appearance and material tables). No geometry or textures. ${MOD_CONTENT_NOTE}`, content: excerpts(resources, sources.resolverCache) },
    ...(full ? [{ id: "resources-full", group: "optional" as const, label: `Every detail of these ${full.length} resources`, detail: `Everything in the resources above, for a closer look. No geometry or textures. ${MOD_CONTENT_NOTE}`, content: full, included: false }] : []),
  ];
  const contents = new Map<string, string>(), files: PreparedHostReport["files"] = new Map();
  const items: ReportItemView[] = [];
  const redact = textRedactor(roots);
  for (const item of built) {
    if (item.content === null || item.content === undefined || (Array.isArray(item.content) && !item.content.length && item.id !== "problem")) continue;
    const text = jsonText(redactValue(item.content, redact));
    contents.set(item.id, text);
    items.push({ id: item.id, group: item.group, label: item.label, detail: item.detail, bytes: utf8Bytes(text), included: item.included ?? true, preview: previewOf(text) });
  }
  // A mod's own files: only for a mod folder the person installed that nothing can fetch again, only when it is small, and never
  // ticked by default. Saving them needs the sharing confirmation, which the host checks too (DIAG-09).
  mods.forEach((mod, index) => {
    if (mod.status !== "local-only" || !OFFERS_FILES.has(mod.kind)) return;
    const archives = mod.archives.filter(archive => archive.path && archive.bytes !== null);
    const bytes = archives.reduce((sum, archive) => sum + archive.bytes!, 0);
    if (!archives.length || bytes > MOD_FILE_LIMIT) return;
    const id = `mod-file:${index}`;
    files.set(id, archives.map(archive => ({ name: archive.name, path: archive.path!, mod: mod.name })));
    items.push({ id, group: "optional", label: redact(`Files of “${mod.name}”`), modFiles: true, bytes, included: false,
      detail: `${archives.length === 1 ? "Its archive" : `Its ${archives.length} archives`}. XF Studio couldn't tell where this mod came from. ` +
        "Usually the details above are enough; only include its files if you made this mod or its permissions allow sharing.",
      preview: redact(archives.map(archive => `${archive.name} · ${formatBytes(archive.bytes!)} · SHA-256 ${archive.sha256 ?? "not computed"}`).join("\n")) });
  });
  const made = new Date().toISOString();
  const manifest: ReportManifest = { schema: REPORT_MANIFEST_SCHEMA, id, ref, made, facts: redactValue(facts, redact),
    problem: redactValue(problem, redact), recent: redactValue(entries.slice(-DIAGNOSTIC_LIMITS.reportEntries), redact), items,
    limits: { total: REPORT_LIMIT, modFiles: MOD_FILE_LIMIT }, window: { mode: state.mode, minutes: state.minutes, until: state.until } };
  return { manifest, contents, files };
}

/** Log entries and the kept host failures together, each once, oldest first. */
function mergeEntries(log: readonly DiagnosticEntry[], failures: readonly DiagnosticEntry[]): DiagnosticEntry[] {
  const key = (entry: DiagnosticEntry) => `${entry.t}|${entry.ref ?? ""}|${entry.code}`;
  const seen = new Set(log.map(key));
  return [...log, ...failures.filter(entry => !seen.has(key(entry)))].sort((a, b) => a.t.localeCompare(b.t));
}

/** The entries a reference names, and those they link to, oldest first. */
export function matchingEntries(entries: readonly DiagnosticEntry[], ref: string | null): DiagnosticEntry[] {
  if (!ref) return [];
  const direct = entries.filter(entry => entry.ref === ref);
  const related = new Set(direct.flatMap(entry => entry.details?.related ?? []));
  return entries.filter(entry => entry.ref === ref || (!!entry.ref && related.has(entry.ref)));
}
