import { accessSync, constants, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FrameworkVersionCheck } from "./framework-versions";
import type { LocalSettings } from "./local-settings";
import { readConfiguredMo2Instance } from "./install-detection-host";

export type LocalCapability = "author" | "check" | "sourceDiscovery" | "sourceCache" | "previewStorage" | "build" |
  "frameworks" | "install" | "updates";
export type ReadinessIssue = { code: string; reason: string };
export type CapabilityReadiness = { ready: boolean; issues: ReadinessIssue[]; limits: string[] };
export type LocalReadiness = Record<LocalCapability, CapabilityReadiness>;
/** Last recorded built-in eye plate outcome for this game folder (see `eyePlateReadiness`). */
export type EyePlateHostReadiness = { issue: ReadinessIssue | null; limit: string };
export type HostFeatures = { updater: boolean; installer: boolean; packageCheck?: boolean; packageBuild?: boolean;
  /** Why the host's own Build gate refuses, in plain words, when `packageBuild` is false. */
  packageBuildIssue?: string | null;
  eyePlate?: EyePlateHostReadiness; frameworks?: FrameworkVersionCheck;
  /**
   * The host's WolvenKit setup outcome, when it manages WolvenKit (see `WolvenKitSetupHost`): null when a
   * CLI is ready, otherwise the plain reason. It replaces the path-only WolvenKit checks.
   */
  wolvenKit?: ReadinessIssue | null };
const available = (path: string | null, kind: "file" | "directory") => {
  if (!path) return false;
  try { const stat = statSync(path); return kind === "file" ? stat.isFile() : stat.isDirectory(); }
  catch { return false; }
};
const item = (issues: ReadinessIssue[] = [], limits: string[] = []): CapabilityReadiness =>
  ({ ready: issues.length === 0, issues, limits });
const issue = (code: string, reason: string): ReadinessIssue => ({ code, reason });
const writableDirectory = (path: string) => {
  try {
    if (existsSync(path) && !available(path, "directory")) return false;
    const target = available(path, "directory") ? path : dirname(path);
    if (!available(target, "directory")) return false;
    accessSync(target, constants.W_OK);
    return true;
  } catch { return false; }
};

/** Framework guidance for the route the user launches with. Advisory: it never blocks Check or Build. */
function frameworkReadiness(check: FrameworkVersionCheck | undefined): CapabilityReadiness {
  if (!check) return item([issue("framework_check_unavailable", "This host can't check frameworks.")]);
  const route = check.routes.find(row => row.route === check.selectedRoute) ?? check.routes[0];
  if (!route) return item([issue("framework_check_unavailable", "This host can't check frameworks.")]);
  if (!route.available) return item([issue("framework_route_unavailable", route.problem ?? "Frameworks couldn't be checked.")],
    [...check.limitations]);
  return item(route.verdicts.filter(row => row.message).map(row => issue(`framework_${row.status.replace("-", "_")}`, row.message!)),
    [...route.frameworks.flatMap(row => row.notes), ...check.limitations]);
}

/**
 * Advisory host readiness, in plain words a person can act on (UI-83): what is missing or wrong, and the one next step. The
 * reasons are shown as they are in Game & tools, the preview setup and Build's refusals. Operations revalidate paths and
 * versions immediately before acting.
 */
export function evaluateLocalReadiness(settings: LocalSettings, host: HostFeatures = { updater: false, installer: false }): LocalReadiness {
  const game = settings.gameRoot;
  const gameIssues: ReadinessIssue[] = [];
  if (!game) gameIssues.push(issue("game_root_unset", "Choose your Cyberpunk 2077 folder."));
  else {
    if (!available(join(game, "bin", "x64", "Cyberpunk2077.exe"), "file"))
      gameIssues.push(issue("game_executable_missing", "That folder isn't your Cyberpunk 2077 folder (it has no bin\\x64\\Cyberpunk2077.exe). Choose the folder the game is installed in."));
    else if (!available(join(game, "archive", "pc"), "directory"))
      gameIssues.push(issue("game_archives_missing", "Your Cyberpunk 2077 folder is missing its archive\\pc folder. Repair the game in its launcher, then check again."));
  }

  const sourceIssues = [...gameIssues];
  if (settings.launchRoute === "mo2") {
    // The instance's own folders (ModOrganizer.ini can move mods and profiles elsewhere).
    let paths: { mods: string; profiles: string } | null = null;
    if (settings.mo2Root) try { paths = readConfiguredMo2Instance(settings.mo2Root).paths; } catch { paths = null; }
    if (!settings.mo2Root) sourceIssues.push(issue("mo2_root_unset", "Choose your Mod Organizer 2 instance."));
    else if (!paths || !available(paths.mods, "directory") || !available(paths.profiles, "directory"))
      sourceIssues.push(issue(!paths || !available(paths.mods, "directory") ? "mo2_mods_missing" : "mo2_profiles_missing",
        "That folder isn't a Mod Organizer 2 instance. Choose the folder that has ModOrganizer.ini in it."));
    if (!settings.mo2ProfileId) sourceIssues.push(issue("mo2_profile_unset", "Choose the Mod Organizer 2 profile you play with."));
    else if (paths && available(paths.profiles, "directory") && !available(join(paths.profiles, settings.mo2ProfileId, "modlist.txt"), "file"))
      sourceIssues.push(issue("mo2_profile_missing", "That profile isn't in this Mod Organizer 2 instance any more. Choose the profile you play with."));
  } else if (settings.manualModRoot && !available(settings.manualModRoot, "directory")) {
    sourceIssues.push(issue("manual_root_missing", "The extra mod folder can't be found. Choose it again, or leave it empty."));
  }

  const buildIssues: ReadinessIssue[] = [];
  if (host.wolvenKit !== undefined) { if (host.wolvenKit) buildIssues.push(host.wolvenKit); }
  else if (!settings.wolvenKitCli) buildIssues.push(issue("wolvenkit_unset", WOLVENKIT_UNSET));
  else if (!available(settings.wolvenKitCli, "file")) buildIssues.push(issue("wolvenkit_missing", "The WolvenKit you chose can't be found. Choose it again, or leave it empty and XF Studio sets it up for you."));
  buildIssues.push(...gameIssues);
  // The expanded eye plate is built in: Build derives it from the installed game, so it needs no path.
  if (host.eyePlate?.issue && gameIssues.length === 0) buildIssues.push(host.eyePlate.issue);
  // The host's own Build gate (tool probes, bundled builder, storage) has the last word.
  if (host.packageBuild === false && buildIssues.length === 0)
    buildIssues.push(issue("package_host_unavailable", host.packageBuildIssue ?? "This version of XF Studio can't build mod files."));

  const cacheIssues: ReadinessIssue[] = [];
  if (settings.sourceCache.directory && !writableDirectory(settings.sourceCache.directory))
    cacheIssues.push(issue("source_cache_unavailable", "XF Studio can't write to the folder chosen for its game-file cache. Choose another folder."));
  const previewIssues: ReadinessIssue[] = [];
  if (settings.preview.cacheDirectory && !writableDirectory(settings.preview.cacheDirectory))
    previewIssues.push(issue("preview_cache_unavailable", "XF Studio can't write to the folder chosen for its 3D preview files. Choose another folder."));
  if (settings.preview.outputDirectory && !writableDirectory(settings.preview.outputDirectory))
    previewIssues.push(issue("preview_output_unavailable", "XF Studio can't write to the folder chosen for its 3D preview output. Choose another folder."));

  // "Add to my mod manager" installs on the route the person launches with (UI-82), with their consent to each plan.
  const installIssues: ReadinessIssue[] = [];
  if (!host.installer) installIssues.push(issue("install_host_unavailable", "This version of XF Studio can't add mods for you. Show the mod's folder and copy it by hand."));
  installIssues.push(...sourceIssues);
  // A verified immutable candidate and collision/receipt check are separate operation-time requirements.
  return {
    author: item(),
    check: item(host.packageCheck === false
      ? [issue("package_check_host_unavailable", "This version of XF Studio can't check mod exports.")] : [],
      ["Collection eligibility checks require no game or build tool path when the host provides them."]),
    sourceDiscovery: item(sourceIssues, [settings.launchRoute === "mo2"
      ? "MO2 modlist '+' is activation evidence only; physical candidates do not prove a runtime winner."
      : "Direct archive/pc candidates do not prove a runtime winner."]),
    sourceCache: item(cacheIssues, ["An unset location uses the host's private default once a cache adapter is connected."]),
    previewStorage: item(previewIssues, ["An unset location uses the host's private default once preview storage is connected."]),
    build: item(buildIssues, ["Path presence does not prove tool-version compatibility or game rendering.",
      ...(host.eyePlate ? [host.eyePlate.limit] : [])]),
    frameworks: frameworkReadiness(host.frameworks),
    install: item(installIssues, ["A verified package and conflict/receipt validation are still required."]),
    updates: item(host.updater ? [] : [issue("updater_unavailable", "This version of XF Studio can't update itself.")]),
  };
}

/** Shown when no WolvenKit is set up yet; XF Studio can download its own copy. */
export const WOLVENKIT_UNSET = "WolvenKit isn't set up yet. XF Studio can download it for you, or you can enter your own WolvenKit CLI here.";

/**
 * Environment overrides remain highest priority for localhost until package-server is migrated.
 * `XFS_PACKAGE_PLATE` is a hidden developer override for the built-in eye plate, and `XFS_PACKAGE_BUN`
 * for the Bun that runs the builder (the running Bun otherwise); neither has a setting.
 * WolvenKit resolves as: developer override, then the path in settings, then XF Studio's own
 * downloaded copy (`managedWolvenKit`).
 */
export function packageToolPaths(settings: LocalSettings, env: Record<string, string | undefined> = process.env,
  managedWolvenKit: string | null = null) {
  return {
    plate: env.XFS_PACKAGE_PLATE || null,
    wolvenkit: env.XFS_PACKAGE_WOLVENKIT || settings.wolvenKitCli || managedWolvenKit,
    gamepath: env.XFS_PACKAGE_GAMEPATH || settings.gameRoot,
    bun: env.XFS_PACKAGE_BUN || null,
  };
}
