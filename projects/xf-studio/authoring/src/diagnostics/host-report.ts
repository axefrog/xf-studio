/**
 * What the host contributes to a problem report, built on demand when the person opens "Report a problem" (docs/diagnostics.md
 * §Report). Facts about the app, the system, the game and the tools; the log; the rolling window; and targeted details the window's
 * references point to: the latest V's resolution, the load-order winners of the resources it used, bounded excerpts of those
 * resources' tables from the resolver's own JSON cache, and the installed frameworks and mod list (names and versions). Never an
 * archive, a mesh or a texture. Every string is redacted with the configured folders and the shared personal-data rules.
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
import { redactValue, type KnownRoot } from "./redact";
import type { HostDiagnostics } from "./host-log";
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

function knownRoots(sources: HostReportSources, settings: LocalSettings | null): KnownRoot[] {
  return [
    { label: "<game>", path: settings?.gameRoot }, { label: "<mo2>", path: settings?.mo2Root },
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

/** The winners (and losing alternatives) of the resources the latest resolution used. */
function winners(resolved: TraceEntry | null) {
  if (!resolved) return null;
  return [...provenances(resolved.data).values()].map(item => {
    const ref = item.ref as { hash: string; path?: string };
    return { path: ref.path ?? null, hash: ref.hash, status: item.status, archive: item.archive ?? null, provider: item.provider ?? null,
      group: item.group ?? null, alternatives: item.alternatives ?? [], rule: (item.rule as { rule?: string } | undefined)?.rule ?? null,
      via: item.via ?? [], ambiguities: item.ambiguities ?? [] };
  }).sort((a, b) => String(a.path ?? a.hash).localeCompare(String(b.path ?? b.hash)));
}

/** Bounded excerpts of the resources the latest resolution used, from the resolver's JSON cache (no archive is read). */
function excerpts(resolved: TraceEntry | null, cacheDir: string | null | undefined) {
  if (!resolved || !cacheDir) return null;
  const folder = join(cacheDir, "json");
  let names: string[] = [];
  try { names = readdirSync(folder); } catch { return { note: "The resolver cache has no resources yet." }; }
  const out: { path: string; archive: unknown; excerpt: unknown }[] = [];
  let total = 0;
  for (const item of provenances(resolved.data).values()) {
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
function fullResources(resolved: TraceEntry | null, cacheDir: string | null | undefined) {
  if (!resolved || !cacheDir) return null;
  const folder = join(cacheDir, "json");
  let names: string[] = [];
  try { names = readdirSync(folder); } catch { return null; }
  const out: { path: string; archive: unknown; document: unknown }[] = [];
  let total = 0;
  for (const item of provenances(resolved.data).values()) {
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
const utf8Bytes = (text: string) => Buffer.byteLength(text, "utf8");

/** Build the host's share of a report: the manifest the review screen shows and the contents behind it. Never throws for a part. */
export async function buildHostReport(diagnostics: HostDiagnostics, sources: HostReportSources, ref: string | null, id: string): Promise<PreparedHostReport> {
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
  const entries = diagnostics.log.tail(200);
  const problem = matchingEntries(entries, ref);
  const state = diagnostics.trace.state();
  const winnerList = winners(resolved);
  const mods = await involvedMods(winnerList, settings);
  const full = fullResources(resolved, sources.resolverCache);
  type Built = { id: string; group: ReportGroup; label: string; detail: string; content: unknown; included?: boolean };
  const built: Built[] = [
    { id: "environment", group: "about", label: "Versions", detail: "XF Studio, system, game, WolvenKit and framework versions.", content: facts },
    { id: "settings", group: "about", label: "Setup choices", detail: "Your setup choices. Folders show only whether they're set.", content: settingsSummary(settings) },
    ...(ref ? [{ id: "problem", group: "happened" as const, label: "This problem", detail: `The log entries for ${ref}, with their technical details.`, content: problem }] : []),
    { id: "log", group: "happened", label: "App log", detail: `XF Studio's recent log: ${entries.length} entries.`, content: entries },
    { id: "trace", group: "happened", label: "Recent activity detail", detail: `What XF Studio worked out in the last ${state.minutes} minutes (${trace.length} events): which files won, what was prepared. Names and references only.`, content: trace },
    { id: "involved-mods", group: "mods", label: "Mods involved", detail: mods.length ? `${mods.length} mods supplied or lost resources your V used: names, versions, download sources and file fingerprints.` : "No mods were involved in the recent window.",
      content: mods.map(({ archives, ...mod }) => ({ ...mod, archives: archives.map(({ path: _path, ...archive }) => archive) })) },
    { id: "mods", group: "mods", label: "Frameworks and mod list", detail: "Installed frameworks and your mod list, by name and version.", content: { frameworks: frameworkCheck?.routes.map(item => ({ ...item, label: item.route === "mo2" ? "Mod Organizer 2" : item.label, profileId: item.profileId ? "chosen" : null })) ?? null, mods: modList(settings) } },
    { id: "resolution", group: "resources", label: "Your V's latest preparation", detail: "The creator options, apps, meshes and materials your V used, and which mod supplied each.",
      content: resolved ? { resolved: resolved.data, prepared: prepared?.data ?? null, at: resolved.t } : null },
    { id: "winners", group: "resources", label: "Load-order winners", detail: "For each resource: the archive that won, the ones it beat and the rule that decided.", content: winnerList },
    { id: "excerpts", group: "resources", label: "Resource tables", detail: "Short extracts of those apps, meshes and materials (appearance and material tables). No geometry or textures.", content: excerpts(resolved, sources.resolverCache) },
    ...(full ? [{ id: "resources-full", group: "optional" as const, label: `Full JSON of these ${full.length} resources`, detail: "Every field of the resources above, for a closer look. Structured data only; no geometry or textures.", content: full, included: false }] : []),
  ];
  const contents = new Map<string, string>(), files: PreparedHostReport["files"] = new Map();
  const items: ReportItemView[] = [];
  for (const item of built) {
    if (item.content === null || item.content === undefined || (Array.isArray(item.content) && !item.content.length && item.id !== "problem")) continue;
    const text = jsonText(redactValue(item.content, roots));
    contents.set(item.id, text);
    items.push({ id: item.id, group: item.group, label: item.label, detail: item.detail, bytes: utf8Bytes(text), included: item.included ?? true, preview: previewOf(text) });
  }
  // A mod's own files: only when nothing can fetch it again, only when it is small, and never ticked by default.
  mods.forEach((mod, index) => {
    if (mod.status !== "local-only") return;
    const archives = mod.archives.filter(archive => archive.path && archive.bytes !== null);
    const bytes = archives.reduce((sum, archive) => sum + archive.bytes!, 0);
    if (!archives.length || bytes > MOD_FILE_LIMIT) return;
    const id = `mod-file:${index}`;
    files.set(id, archives.map(archive => ({ name: archive.name, path: archive.path!, mod: mod.name })));
    items.push({ id, group: "optional", label: redactValue(`Files of “${mod.name}”`, roots), modFiles: true, bytes, included: false,
      detail: `${archives.length === 1 ? "Its archive" : `Its ${archives.length} archives`}. XF Studio found no download source for this mod, so it can't be fetched again elsewhere.`,
      preview: redactValue(archives.map(archive => `${archive.name} · ${formatBytes(archive.bytes!)} · SHA-256 ${archive.sha256 ?? "not computed"}`).join("\n"), roots) });
  });
  const made = new Date().toISOString();
  const manifest: ReportManifest = { schema: REPORT_MANIFEST_SCHEMA, id, ref, made, facts: redactValue(facts, roots),
    problem: redactValue(problem, roots), recent: redactValue(entries.slice(-DIAGNOSTIC_LIMITS.reportEntries), roots), items,
    limits: { total: REPORT_LIMIT, modFiles: MOD_FILE_LIMIT }, window: { mode: state.mode, minutes: state.minutes, until: state.until } };
  return { manifest, contents, files };
}

/** The entries a reference names, and those they link to, oldest first. */
export function matchingEntries(entries: readonly DiagnosticEntry[], ref: string | null): DiagnosticEntry[] {
  if (!ref) return [];
  const direct = entries.filter(entry => entry.ref === ref);
  const related = new Set(direct.flatMap(entry => entry.details?.related ?? []));
  return entries.filter(entry => entry.ref === ref || (!!entry.ref && related.has(entry.ref)));
}
