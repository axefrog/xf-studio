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
import { describeMo2Instance, mo2ProviderFolders, parseMo2Modlist, parseQSettingsIni } from "./mo2-instance";
import { EYE_MAKEUP_MOD } from "../legacy/eye-makeup/mod-branding";
import { readPeFileVersion } from "../formats/pe-version";
import { describeInstalled, EYE_ARTISTRY_REQUIREMENTS, FRAMEWORKS, frameworkRouteReport, normaliseVersion, unavailableRouteReport, type FrameworkDefinition,
  type FrameworkProvider, type FrameworkRouteReport, type FrameworkVersionCheck, type InstalledFramework } from "./framework-catalogue";
// The catalogue is this module's public face too (the page imports the catalogue directly).
export * from "./framework-catalogue";

/** Bounded read-only host access. Paths are absolute; `readBytes` returns null for a missing or linked file. */
export interface FrameworkHostPort {
  readText(path: string, maxBytes: number): string | null;
  isFile(path: string): boolean;
  readBytes(path: string, offset: number, length: number): Uint8Array | null;
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
  const hidden = found.slice(1).filter(provider => provider.kind !== "game").map(provider => provider.name);
  return describeInstalled(definition, winner, fileVersion, modManagerVersion, hidden);
}

function report(port: FrameworkHostPort, route: "direct" | "mo2", label: string, profileId: string | null,
  providers: readonly Provider[] | string): FrameworkRouteReport {
  if (typeof providers === "string") return unavailableRouteReport(route, label, profileId, providers);
  return frameworkRouteReport(route, label, profileId, FRAMEWORKS.map(definition => inspect(port, definition, providers)));
}
/** MO2 providers for the profile, highest priority first: overwrite, enabled mods, then the game folder. */
function mo2Providers(port: FrameworkHostPort, input: FrameworkCheckInput, game: Provider): Provider[] | string {
  if (!input.mo2Root || !input.mo2ProfileId) return "Choose your Mod Organizer 2 folder and profile in Settings › Game.";
  const instance = describeMo2Instance(port.readText(join(input.mo2Root, "ModOrganizer.ini"), iniBytes),
    input.mo2Root, "configured", input.mo2Root);
  const text = port.readText(join(instance.paths.profiles, input.mo2ProfileId, "modlist.txt"), modlistBytes);
  if (text === null) return `We couldn't read the Mod Organizer 2 profile "${input.mo2ProfileId}". Check it still exists.`;
  // The same order as every other virtual file (PIPE-06): overwrite, enabled mods by priority, then the game folder.
  return [...mo2ProviderFolders(parseMo2Modlist(text), instance.paths).map(folder =>
    ({ kind: folder.provider as "mo2-overwrite" | "mo2-mod", name: folder.providerName, folder: folder.folder })), game];
}

/** Report both routes; nothing is written, launched or changed. */
export function checkFrameworkVersions(port: FrameworkHostPort, input: FrameworkCheckInput): FrameworkVersionCheck {
  const gameReady = !!input.gameRoot && port.isFile(join(input.gameRoot, "bin", "x64", "Cyberpunk2077.exe"));
  const game: Provider = { kind: "game", name: "Game folder", folder: input.gameRoot ?? "" };
  const noGame = input.gameRoot ? "We couldn't find Cyberpunk 2077 in the selected game folder. Check the folder in Settings › Game."
    : "Choose your Cyberpunk 2077 game folder in Settings › Game so we can check your frameworks.";
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
