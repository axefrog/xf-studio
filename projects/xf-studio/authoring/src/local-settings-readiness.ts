import { accessSync, constants, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FrameworkVersionCheck } from "./framework-versions";
import type { LocalSettings } from "./local-settings";

export type LocalCapability = "author" | "check" | "sourceDiscovery" | "sourceCache" | "previewStorage" | "build" |
  "frameworks" | "install" | "updates";
export type ReadinessIssue = { code: string; reason: string };
export type CapabilityReadiness = { ready: boolean; issues: ReadinessIssue[]; limits: string[] };
export type LocalReadiness = Record<LocalCapability, CapabilityReadiness>;
/** Last recorded built-in eye plate outcome for this game folder (see `eyePlateReadiness`). */
export type EyePlateHostReadiness = { issue: ReadinessIssue | null; limit: string };
export type HostFeatures = { updater: boolean; installer: boolean; packageCheck?: boolean; packageBuild?: boolean;
  eyePlate?: EyePlateHostReadiness; frameworks?: FrameworkVersionCheck };
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

/** Advisory host readiness. Operations must revalidate paths and versions immediately before acting. */
export function evaluateLocalReadiness(settings: LocalSettings, host: HostFeatures = { updater: false, installer: false }): LocalReadiness {
  const game = settings.gameRoot;
  const gameIssues: ReadinessIssue[] = [];
  if (!game) gameIssues.push(issue("game_root_unset", "Select the Cyberpunk 2077 game folder."));
  else {
    if (!available(join(game, "bin", "x64", "Cyberpunk2077.exe"), "file"))
      gameIssues.push(issue("game_executable_missing", "The selected game folder has no bin/x64/Cyberpunk2077.exe."));
    if (!available(join(game, "archive", "pc"), "directory"))
      gameIssues.push(issue("game_archives_missing", "The selected game folder has no archive/pc directory."));
  }

  const sourceIssues = [...gameIssues];
  if (settings.launchRoute === "mo2") {
    if (!settings.mo2Root) sourceIssues.push(issue("mo2_root_unset", "Select the Mod Organizer 2 instance folder."));
    else {
      if (!available(join(settings.mo2Root, "mods"), "directory"))
        sourceIssues.push(issue("mo2_mods_missing", "The selected MO2 instance has no mods directory."));
      if (!available(join(settings.mo2Root, "profiles"), "directory"))
        sourceIssues.push(issue("mo2_profiles_missing", "The selected MO2 instance has no profiles directory."));
    }
    if (!settings.mo2ProfileId) sourceIssues.push(issue("mo2_profile_unset", "Select an MO2 profile."));
    else if (settings.mo2Root && !available(join(settings.mo2Root, "profiles", settings.mo2ProfileId, "modlist.txt"), "file"))
      sourceIssues.push(issue("mo2_profile_missing", "The selected MO2 profile has no modlist.txt."));
  } else if (settings.manualModRoot && !available(settings.manualModRoot, "directory")) {
    sourceIssues.push(issue("manual_root_missing", "The optional direct-install mod folder is unavailable."));
  }

  const buildIssues: ReadinessIssue[] = [];
  if (host.packageBuild === false)
    buildIssues.push(issue("package_host_unavailable", "This host does not provide mod package builds."));
  if (!settings.wolvenKitCli) buildIssues.push(issue("wolvenkit_unset", "Select the WolvenKit CLI executable."));
  else if (!available(settings.wolvenKitCli, "file")) buildIssues.push(issue("wolvenkit_missing", "The selected WolvenKit CLI executable is unavailable."));
  if (settings.bunExecutable && !available(settings.bunExecutable, "file"))
    buildIssues.push(issue("bun_missing", "The selected Bun executable is unavailable."));
  buildIssues.push(...gameIssues);
  // The expanded eye plate is built in: Build derives it from the installed game, so it needs no path.
  if (host.eyePlate?.issue && gameIssues.length === 0) buildIssues.push(host.eyePlate.issue);

  const cacheIssues: ReadinessIssue[] = [];
  if (settings.sourceCache.directory && !writableDirectory(settings.sourceCache.directory))
    cacheIssues.push(issue("source_cache_unavailable", "The source cache directory or its parent is unavailable for writing."));
  const previewIssues: ReadinessIssue[] = [];
  if (settings.preview.cacheDirectory && !writableDirectory(settings.preview.cacheDirectory))
    previewIssues.push(issue("preview_cache_unavailable", "The preview cache directory or its parent is unavailable for writing."));
  if (settings.preview.outputDirectory && !writableDirectory(settings.preview.outputDirectory))
    previewIssues.push(issue("preview_output_unavailable", "The preview output directory or its parent is unavailable for writing."));

  const installIssues: ReadinessIssue[] = [];
  if (!host.installer) installIssues.push(issue("install_host_unavailable", "This host does not provide installation."));
  if (settings.installMode === "none") installIssues.push(issue("install_mode_unset", "Choose an installation target."));
  else if (settings.installMode !== settings.launchRoute)
    installIssues.push(issue("install_route_mismatch", "Installation target must match the selected launch route."));
  installIssues.push(...sourceIssues);
  // A verified immutable candidate and collision/receipt check are separate operation-time requirements.
  return {
    author: item(),
    check: item(host.packageCheck === false
      ? [issue("package_check_host_unavailable", "This host does not provide mod export checks.")] : [],
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
    updates: item(host.updater ? [] : [issue("updater_unavailable", "This host does not provide desktop updates.")]),
  };
}

/**
 * Environment overrides remain highest priority for localhost until package-server is migrated.
 * `XFS_PACKAGE_PLATE` is a hidden developer override for the built-in eye plate; it has no setting.
 */
export function packageToolPaths(settings: LocalSettings, env: Record<string, string | undefined> = process.env) {
  return {
    plate: env.XFS_PACKAGE_PLATE || null,
    wolvenkit: env.XFS_PACKAGE_WOLVENKIT || settings.wolvenKitCli,
    gamepath: env.XFS_PACKAGE_GAMEPATH || settings.gameRoot,
    bun: settings.bunExecutable,
  };
}
