/** Read-only framework version check for the eye-makeup mod (pure policy over a narrow host port).
 *
 * Reports which ArchiveXL, TweakXL, Codeware, RED4ext, redscript and Cyber Engine Tweaks the
 * game would see through each route (the direct game folder, and the selected MO2 profile), and
 * turns the pinned minimums below into plain-language guidance. It never installs, updates,
 * disables or duplicates a framework and never edits a mod list: the user updates their own
 * frameworks. Evidence rules and the reasoning behind each minimum:
 * research/authoring/framework-version-check.md.
 */
import { join } from "node:path";
import { describeMo2Instance, parseMo2Modlist, parseQSettingsIni } from "./mo2-instance";
import { EYE_MAKEUP_MOD } from "./mod-branding";
import { readPeFileVersion } from "./pe-version";

export type FrameworkId = "archivexl" | "tweakxl" | "codeware" | "red4ext" | "redscript" | "cet";
export interface FrameworkLink { readonly label: "Nexus Mods" | "GitHub"; readonly url: string }
export interface FrameworkDefinition {
  readonly id: FrameworkId;
  readonly name: string;
  /** A file every install of this framework has, relative to the game folder. */
  readonly marker: string;
  /** Whether the marker carries a Windows version resource that names the release. */
  readonly markerHasVersion: boolean;
  readonly links: readonly FrameworkLink[];
}
const nexus = (id: number): FrameworkLink => ({ label: "Nexus Mods", url: `https://www.nexusmods.com/cyberpunk2077/mods/${id}` });
const github = (repo: string): FrameworkLink => ({ label: "GitHub", url: `https://github.com/${repo}/releases/latest` });

export const FRAMEWORKS: readonly FrameworkDefinition[] = Object.freeze([
  { id: "archivexl", name: "ArchiveXL", marker: "red4ext/plugins/ArchiveXL/ArchiveXL.dll", markerHasVersion: true,
    links: [nexus(4198), github("psiberx/cp2077-archive-xl")] },
  { id: "tweakxl", name: "TweakXL", marker: "red4ext/plugins/TweakXL/TweakXL.dll", markerHasVersion: true,
    links: [nexus(4197), github("psiberx/cp2077-tweak-xl")] },
  { id: "codeware", name: "Codeware", marker: "red4ext/plugins/Codeware/Codeware.dll", markerHasVersion: true,
    links: [nexus(7780), github("psiberx/cp2077-codeware")] },
  { id: "red4ext", name: "RED4ext", marker: "red4ext/RED4ext.dll", markerHasVersion: true,
    links: [nexus(2380), github("wopss/RED4ext")] },
  // The redscript compiler carries no version resource; only mod-manager metadata names its release.
  { id: "redscript", name: "redscript", marker: "engine/tools/scc.exe", markerHasVersion: false,
    links: [nexus(1511), github("jac3km4/redscript")] },
  { id: "cet", name: "Cyber Engine Tweaks", marker: "bin/x64/plugins/cyber_engine_tweaks.asi", markerHasVersion: true,
    links: [nexus(107), github("maximegmd/CyberEngineTweaks")] },
]);

export interface FrameworkRequirement { readonly framework: FrameworkId; readonly minimum: string; readonly reason: string }
/** Pinned minimums for the eye-makeup package. TweakXL, Codeware and CET are not needed by it. */
export const EYE_ARTISTRY_REQUIREMENTS: readonly FrameworkRequirement[] = Object.freeze([
  { framework: "archivexl", minimum: "1.27.3", reason: "The package's selector, appearance and material wiring was designed and verified against the ArchiveXL 1.27.3 source; no earlier release has been checked." },
  { framework: "red4ext", minimum: "1.29.0", reason: "ArchiveXL 1.27.3 lists RED4ext 1.29.0 or newer as its installation requirement." },
  { framework: "redscript", minimum: "0.5.31", reason: "ArchiveXL 1.27.3 lists redscript 0.5.31 or newer for its bundled scripts." },
]);

/** Bounded read-only host access. Paths are absolute; `readBytes` returns null for a missing or linked file. */
export interface FrameworkHostPort {
  readText(path: string, maxBytes: number): string | null;
  isFile(path: string): boolean;
  readBytes(path: string, offset: number, length: number): Uint8Array | null;
}
export type FrameworkProvider = { readonly kind: "game" | "mo2-mod" | "mo2-overwrite"; readonly name: string };
export interface InstalledFramework {
  readonly framework: FrameworkId;
  readonly name: string;
  readonly installed: boolean;
  /** Normalised major.minor.patch, or null when absent or unreadable. */
  readonly version: string | null;
  /** `file` = version resource of the loaded binary (authoritative); `mod-manager` = MO2 meta.ini. */
  readonly versionSource: "file" | "mod-manager" | null;
  readonly fileVersion: string | null;
  readonly modManagerVersion: string | null;
  /** The copy the game would see through this route. */
  readonly provider: FrameworkProvider | null;
  /** Other enabled copies that the provider hides (MO2 priority). */
  readonly hiddenCopies: readonly string[];
  readonly notes: readonly string[];
}
export type FrameworkVerdictStatus = "ok" | "outdated" | "missing" | "unknown-version";
export interface FrameworkVerdict {
  readonly framework: FrameworkId;
  readonly name: string;
  readonly minimum: string;
  readonly installed: string | null;
  readonly status: FrameworkVerdictStatus;
  /** Plain-language next step; null when nothing needs doing. */
  readonly message: string | null;
  readonly links: readonly FrameworkLink[];
}
export interface FrameworkRouteReport {
  readonly route: "direct" | "mo2";
  readonly label: string;
  readonly profileId: string | null;
  /** False when this route could not be read; `problem` then says why in plain words. */
  readonly available: boolean;
  readonly problem: string | null;
  readonly frameworks: readonly InstalledFramework[];
  readonly verdicts: readonly FrameworkVerdict[];
  readonly ready: boolean;
}
export interface FrameworkVersionCheck {
  readonly schema: "xfs/framework-version-check-1";
  readonly mod: string;
  readonly requirements: readonly FrameworkRequirement[];
  /** The route the user launches with; its verdicts are the ones that matter. */
  readonly selectedRoute: "direct" | "mo2";
  readonly routes: readonly FrameworkRouteReport[];
  readonly limitations: readonly string[];
}
export interface FrameworkCheckInput {
  readonly gameRoot: string | null;
  readonly launchRoute: "direct" | "mo2";
  readonly mo2Root: string | null;
  readonly mo2ProfileId: string | null;
}

const metaBytes = 256 * 1024, iniBytes = 4 * 1024 * 1024, modlistBytes = 4 * 1024 * 1024;
const LIMITATIONS = Object.freeze([
  "Versions come from the installed files. They show what the game would load next time, not what a past session loaded; the game's own logs confirm that.",
  "RED4ext also needs its loader in the game's bin/x64 folder; this check reads the RED4ext library, not the loader.",
]);

/** Leading major.minor.patch of a version string such as "1.27.3.0", "v1.37.1 [HEAD]" or "1.27.3.17607". */
export function normaliseVersion(text: string | null | undefined): string | null {
  const match = /^\s*v?(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?/i.exec(text ?? "");
  return match ? `${Number(match[1])}.${Number(match[2] ?? 0)}.${Number(match[3] ?? 0)}` : null;
}
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) - (right[i] ?? 0);
  return 0;
}
const shortVersion = (version: string) => version.replace(/\.0$/, "");

function versionAt(port: FrameworkHostPort, path: string): string | null {
  try { return normaliseVersion(readPeFileVersion((offset, length) => port.readBytes(path, offset, length))); }
  catch { return null; }
}
function metaVersion(port: FrameworkHostPort, modFolder: string): string | null {
  const text = port.readText(join(modFolder, "meta.ini"), metaBytes);
  return text === null ? null : normaliseVersion(parseQSettingsIni(text).get("general")?.get("version"));
}

type Provider = FrameworkProvider & { folder: string };
function inspect(port: FrameworkHostPort, definition: FrameworkDefinition, providers: readonly Provider[]): InstalledFramework {
  const found = providers.filter(provider => port.isFile(join(provider.folder, ...definition.marker.split("/"))));
  const winner = found[0] ?? null;
  const fileVersion = winner && definition.markerHasVersion ? versionAt(port, join(winner.folder, ...definition.marker.split("/"))) : null;
  const modManagerVersion = winner?.kind === "mo2-mod" ? metaVersion(port, winner.folder) : null;
  const version = fileVersion ?? modManagerVersion;
  const notes: string[] = [];
  if (fileVersion && modManagerVersion && compareVersions(fileVersion, modManagerVersion) !== 0)
    notes.push(`Mod Organizer lists ${definition.name} ${shortVersion(modManagerVersion)}, but the installed file is ` +
      `${shortVersion(fileVersion)}. The file is what the game loads.`);
  const hidden = found.slice(1).filter(provider => provider.kind !== "game").map(provider => provider.name);
  if (winner && hidden.length)
    notes.push(`${definition.name} is installed more than once in this profile. Mod Organizer uses the copy in ` +
      `"${winner.name}"; ${hidden.map(name => `"${name}"`).join(", ")} ${hidden.length === 1 ? "is" : "are"} not used.`);
  return { framework: definition.id, name: definition.name, installed: !!winner, version,
    versionSource: fileVersion ? "file" : modManagerVersion ? "mod-manager" : null, fileVersion, modManagerVersion,
    provider: winner ? { kind: winner.kind, name: winner.name } : null, hiddenCopies: hidden, notes };
}

function verdicts(frameworks: readonly InstalledFramework[], route: "direct" | "mo2"): FrameworkVerdict[] {
  const where = route === "mo2" ? "Update it in Mod Organizer 2 with the latest release from Nexus Mods or GitHub."
    : "Update it with the latest release from Nexus Mods or GitHub.";
  return EYE_ARTISTRY_REQUIREMENTS.map(requirement => {
    const definition = FRAMEWORKS.find(row => row.id === requirement.framework)!;
    const found = frameworks.find(row => row.framework === requirement.framework)!;
    const needs = `${EYE_MAKEUP_MOD.modName} needs ${definition.name} ${shortVersion(requirement.minimum)} or newer`;
    const base = { framework: definition.id, name: definition.name, minimum: requirement.minimum,
      installed: found.version, links: definition.links };
    if (!found.installed) return { ...base, status: "missing" as const,
      message: `${needs}, and it isn't installed ${route === "mo2" ? "in this profile" : "in the game folder"}. ` +
        `Install it${route === "mo2" ? " in Mod Organizer 2" : ""} from Nexus Mods or GitHub.` };
    if (!found.version) return { ...base, status: "unknown-version" as const,
      message: `We found ${definition.name} but couldn't tell which version it is. ${needs}; if you're not sure, ` +
        "reinstall the latest release from Nexus Mods or GitHub." };
    if (compareVersions(found.version, requirement.minimum) < 0) return { ...base, status: "outdated" as const,
      message: `${needs}; you have ${shortVersion(found.version)}. ${where}` };
    return { ...base, status: "ok" as const, message: null };
  });
}

function report(port: FrameworkHostPort, route: "direct" | "mo2", label: string, profileId: string | null,
  providers: readonly Provider[] | string): FrameworkRouteReport {
  if (typeof providers === "string") return { route, label, profileId, available: false, problem: providers,
    frameworks: [], verdicts: [], ready: false };
  const frameworks = FRAMEWORKS.map(definition => inspect(port, definition, providers));
  const rows = verdicts(frameworks, route);
  return { route, label, profileId, available: true, problem: null, frameworks, verdicts: rows,
    ready: rows.every(row => row.status === "ok") };
}
/** MO2 providers for the profile, highest priority first: overwrite, enabled mods, then the game folder. */
function mo2Providers(port: FrameworkHostPort, input: FrameworkCheckInput, game: Provider): Provider[] | string {
  if (!input.mo2Root || !input.mo2ProfileId) return "Choose your Mod Organizer 2 folder and profile in Local setup.";
  const instance = describeMo2Instance(port.readText(join(input.mo2Root, "ModOrganizer.ini"), iniBytes),
    input.mo2Root, "configured", input.mo2Root);
  const text = port.readText(join(instance.paths.profiles, input.mo2ProfileId, "modlist.txt"), modlistBytes);
  if (text === null) return `We couldn't read the Mod Organizer 2 profile "${input.mo2ProfileId}". Check it still exists.`;
  const enabled = parseMo2Modlist(text).entries.filter(entry => entry.kind === "mod" && entry.enabled &&
    !/[\\/:\x00-\x1f]/.test(entry.name) && entry.name !== "." && entry.name !== "..");
  return [{ kind: "mo2-overwrite", name: "Overwrite", folder: instance.paths.overwrite },
    ...enabled.map(entry => ({ kind: "mo2-mod" as const, name: entry.name, folder: join(instance.paths.mods, entry.name) })),
    game];
}

/** Report both routes; nothing is written, launched or changed. */
export function checkFrameworkVersions(port: FrameworkHostPort, input: FrameworkCheckInput): FrameworkVersionCheck {
  const gameReady = !!input.gameRoot && port.isFile(join(input.gameRoot, "bin", "x64", "Cyberpunk2077.exe"));
  const game: Provider = { kind: "game", name: "Game folder", folder: input.gameRoot ?? "" };
  const noGame = input.gameRoot ? "We couldn't find Cyberpunk 2077 in the selected game folder. Check the folder in Local setup."
    : "Choose your Cyberpunk 2077 game folder in Local setup so we can check your frameworks.";
  const routes = [report(port, "direct", "Game folder", null, gameReady ? [game] : noGame)];
  if (input.launchRoute === "mo2" || (input.mo2Root && input.mo2ProfileId))
    routes.push(report(port, "mo2", input.mo2ProfileId ? `Mod Organizer 2 profile "${input.mo2ProfileId}"` : "Mod Organizer 2",
      input.mo2ProfileId, gameReady ? mo2Providers(port, input, game) : noGame));
  return { schema: "xfs/framework-version-check-1", mod: EYE_MAKEUP_MOD.modName, requirements: EYE_ARTISTRY_REQUIREMENTS,
    selectedRoute: input.launchRoute, routes, limitations: LIMITATIONS };
}

/** Mod folders that provide any framework in a report (including hidden copies), for MO2 placement. */
export function frameworkModNames(route: FrameworkRouteReport): string[] {
  return [...new Set(route.frameworks.flatMap(row => [
    ...(row.provider?.kind === "mo2-mod" ? [row.provider.name] : []), ...row.hiddenCopies]))];
}
