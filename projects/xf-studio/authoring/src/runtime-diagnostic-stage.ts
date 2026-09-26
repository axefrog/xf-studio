/** A private MO2 diagnostic clone. This never writes to the source MO2 or game, and never installs,
 * replaces, disables or duplicates a framework: it only reports framework versions and adds the one
 * eye-makeup mod entry to the copied profile, placed by the MO2 placement rule. */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { defaultLocalSettings } from "./local-settings";
import { checkFrameworkVersions, frameworkModNames, type FrameworkRouteReport } from "./framework-versions";
import { createWindowsDetectionHost } from "./install-detection-host";
import { applyMo2Placement, planMo2Placement, type Mo2Placement } from "./mo2-placement";
import { createModInstallTransport, inspectLocalPackageCandidate } from "./mod-install-transport";
import { EYE_MAKEUP_MOD, eyeMakeupRelatedEntries, isEyeMakeupModFolder } from "./mod-branding";

export type RuntimeDiagnosticOptions = {
  candidateStore: string; candidateId: string; gameRoot: string; mo2Root: string;
  profileId: string; stagingRoot: string;
};
export type RuntimeDiagnosticPlan = {
  schema: "xfs/runtime-diagnostic-plan-2"; candidateId: string; namespace: string;
  candidateFiles: { path: string; sha256: string; bytes: number }[];
  verifiedUnpackedFiles: number; presetCount: number; omissions: number;
  sourceProfileModlistSha256: string; sourceProfileEnabledMods: number;
  sourceProfileLegacyEnabled: boolean;
  /** The profile lists the dedicated mod (enabled or disabled) under its current name. */
  sourceProfileModEntryPresent: boolean;
  /** The profile lists a legacy folder name of this mod, e.g. the 25 September "XF Studio" diagnostic. */
  sourceProfileLegacyModEntryPresent: boolean;
  sourceDedicatedModExists: boolean;
  /** An existing MO2 folder holding an earlier install of this mod under a legacy name. */
  sourceLegacyModFolder: string | null;
  /** Read-only framework versions the source profile would load, with update guidance. */
  frameworks: FrameworkRouteReport;
  /** Where the copied modlist gets the eye-makeup mod entry. */
  placement: Mo2Placement;
  exactFilenameConflicts: string[]; stagingRoot: string;
  actions: string[]; cautions: string[];
};

function requireValue(ok: unknown, message: string): asserts ok { if (!ok) throw Error(message); }
/** Frameworks the profile would load, read-only; its mod folders mark framework sections for placement. */
export function profileFrameworks(gameRoot: string, mo2Root: string, profileId: string): FrameworkRouteReport {
  const report = checkFrameworkVersions(createWindowsDetectionHost(), { gameRoot, launchRoute: "mo2", mo2Root,
    mo2ProfileId: profileId }).routes.find(route => route.route === "mo2");
  requireValue(report, "MO2 framework report is missing.");
  return report;
}
export function diagnosticPlacement(source: string, frameworkMods: Iterable<string> = []): Mo2Placement {
  return planMo2Placement(source, EYE_MAKEUP_MOD.modName, { related: eyeMakeupRelatedEntries, frameworkMods });
}
/** The isolated modlist a diagnostic clone uses; shared with promotion so both agree exactly. It adds
 * (or enables) only the eye-makeup mod row and switches off an enabled predecessor of the same mod. */
export function diagnosticModlist(source: string, frameworkMods: Iterable<string> = []): string {
  const placed = applyMo2Placement(source, diagnosticPlacement(source, frameworkMods), true);
  const newline = placed.includes("\r\n") ? "\r\n" : "\n";
  const predecessors = EYE_MAKEUP_MOD.predecessorMods.map(name => `+${name}`);
  return placed.split(newline).map(line => predecessors.includes(line) ? `-${line.slice(1)}` : line).join(newline);
}
/** An existing MO2 mod folder that holds an earlier install of this mod under a legacy name. */
export function legacyModFolder(modsRoot: string): string | null {
  return readdirSync(modsRoot).find(entry =>
    EYE_MAKEUP_MOD.legacyModFolders.some(name => name.toLowerCase() === entry.toLowerCase())) ?? null;
}
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const within = (child: string, root: string) => {
  const rel = relative(root, child);
  return !rel || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
};
function noLinks(path: string) {
  let at = resolve(path);
  while (!existsSync(at)) {
    const parent = dirname(at);
    requireValue(parent !== at, "Path root does not exist."); at = parent;
  }
  for (;;) {
    requireValue(!lstatSync(at).isSymbolicLink(), `Linked path is not allowed: ${at}`);
    const parent = dirname(at);
    if (parent === at) break;
    at = parent;
  }
}
function regular(path: string) {
  noLinks(path);
  const info = lstatSync(path);
  requireValue(info.isFile(), `Expected a regular file: ${path}`);
}
function profileName(value: string) {
  requireValue(/^[^\\/.:\x00-\x1f][^\\/:\x00-\x1f]{0,127}$/.test(value) &&
    value !== ".." && value.trim() === value && !value.endsWith("."), "Invalid MO2 profile name.");
}
function modName(value: string) {
  requireValue(value.length > 0 && value.length <= 255 && !/[\\/:\x00-\x1f]/.test(value) &&
    value !== "." && value !== ".." && value.trim() === value && !value.endsWith("."),
  "Unsafe enabled MO2 mod name.");
}
function checked(options: RuntimeDiagnosticOptions) {
  const { candidateStore, gameRoot, mo2Root, stagingRoot } = options;
  for (const [label, value] of Object.entries({ candidateStore, gameRoot, mo2Root, stagingRoot }))
    requireValue(isAbsolute(value), `${label} must be absolute.`);
  profileName(options.profileId);
  const store = resolve(candidateStore), game = resolve(gameRoot), mo2 = resolve(mo2Root), stage = resolve(stagingRoot);
  for (const source of [store, game, mo2]) {
    requireValue(!within(stage, source) && !within(source, stage), "Diagnostic staging must be outside every source root.");
    noLinks(source);
  }
  noLinks(stage);
  requireValue(!existsSync(stage), "Diagnostic staging root must not already exist.");
  const profile = join(mo2, "profiles", options.profileId), modlist = join(profile, "modlist.txt");
  regular(modlist);
  regular(join(game, "bin", "x64", "Cyberpunk2077.exe"));
  requireValue(statSync(join(game, "archive", "pc")).isDirectory(), "Game archive/pc is missing.");
  requireValue(statSync(join(mo2, "mods")).isDirectory(), "MO2 mods directory is missing.");
  const candidate = inspectLocalPackageCandidate(store, options.candidateId);
  return { store, game, mo2, stage, profile, modlist, candidate };
}

export function planRuntimeDiagnostic(options: RuntimeDiagnosticOptions): RuntimeDiagnosticPlan {
  const paths = checked(options);
  const text = readFileSync(paths.modlist, "utf8");
  const lines = text.split(/\r?\n/);
  const names = lines.filter(line => line.startsWith("+")).map(line => line.slice(1));
  for (const name of names) modName(name);
  const enabledMod = names.find(isEyeMakeupModFolder);
  requireValue(!enabledMod, `Source profile already enables ${EYE_MAKEUP_MOD.modName}` +
    (enabledMod?.toLowerCase() === EYE_MAKEUP_MOD.modName.toLowerCase() ? "" :` under its earlier name "${enabledMod}"`) + "; inspect it before staging.");
  const frameworks = profileFrameworks(paths.game, paths.mo2, options.profileId);
  const placement = diagnosticPlacement(text, frameworkModNames(frameworks));
  const exactFilenameConflicts: string[] = [];
  for (const entry of paths.candidate.manifest.files) {
    const file = basename(entry.path);
    if (existsSync(join(paths.game, "archive", "pc", "mod", file)))
      exactFilenameConflicts.push(`Direct game archive already has ${file}`);
    for (const name of names) {
      const target = join(paths.mo2, "mods", name, "archive", "pc", "mod", file);
      if (existsSync(target)) exactFilenameConflicts.push(`Enabled MO2 mod ${name} has ${file}`);
    }
  }
  // Either manifest version: the looks its verifiers checked (PIPE-09).
  requireValue(paths.candidate.manifest.presetCount > 0, "Diagnostic candidate has no recorded presets.");
  const legacy = EYE_MAKEUP_MOD.predecessorMods.some(name => names.includes(name));
  const dedicatedModExists = existsSync(join(paths.mo2, "mods", EYE_MAKEUP_MOD.modName));
  const legacyFolder = legacyModFolder(join(paths.mo2, "mods"));
  const listed = (name: string) => lines.some(line => /^[+-]/.test(line) && line.slice(1).toLowerCase() === name.toLowerCase());
  const cautions = [
    "This checks paired payload hashes and the manifest claim; it does not rerun the independent archive verifier.",
    "The source profile and old runtime logs do not prove which archives will win in a future session.",
    "The copied profile needs an explicit MO2 launch choice; staging does not activate it in the real instance.",
    "No plate clearance correction has passed every release gate; watch eyelids and idle poses.",
  ];
  if (legacy) cautions.push("The legacy Eye Artistry selector is enabled in the source profile and will be disabled only in the diagnostic clone.");
  for (const verdict of frameworks.verdicts) if (verdict.message) cautions.push(verdict.message);
  if (!frameworks.available && frameworks.problem) cautions.push(frameworks.problem);
  cautions.push(...frameworks.frameworks.flatMap(row => row.notes));
  if (dedicatedModExists) cautions.push(`The source MO2 instance already has an ${EYE_MAKEUP_MOD.modName} mod folder; inspect its ownership before promoting a diagnostic clone.`);
  if (legacyFolder) cautions.push(`The source MO2 instance already has an earlier ${EYE_MAKEUP_MOD.modName} diagnostic install in the legacy folder "${legacyFolder}". Promotion refuses to create a second copy until that install is rolled back or removed.`);
  if (exactFilenameConflicts.length) cautions.push("Exact archive filename conflicts require resolution before a diagnostic launch.");
  return {
    schema: "xfs/runtime-diagnostic-plan-2", candidateId: options.candidateId,
    namespace: paths.candidate.manifest.namespace, candidateFiles: paths.candidate.manifest.files,
    verifiedUnpackedFiles: paths.candidate.manifest.verifiedUnpackedFiles,
    presetCount: paths.candidate.manifest.presetCount, omissions: paths.candidate.manifest.omissionCount,
    sourceProfileModlistSha256: sha(paths.modlist), sourceProfileEnabledMods: names.length,
    sourceProfileLegacyEnabled: legacy, sourceProfileModEntryPresent: listed(EYE_MAKEUP_MOD.modName),
    sourceProfileLegacyModEntryPresent: EYE_MAKEUP_MOD.legacyModFolders.some(listed),
    sourceDedicatedModExists: dedicatedModExists, sourceLegacyModFolder: legacyFolder,
    frameworks, placement,
    exactFilenameConflicts, stagingRoot: paths.stage,
    actions: ["Copy selected profile metadata into a new isolated MO2 root.",
      ...(legacy ? ["Disable the legacy Eye Artistry mod only in that copied modlist."] : []),
      placement.rule === "existing" ? `Enable the listed ${EYE_MAKEUP_MOD.modName} entry only in that copied modlist.`
        : `Add one ${EYE_MAKEUP_MOD.modName} entry only to that copied modlist: ${placement.description}`,
      "Leave every framework and every other mod entry as it is; report framework versions only.",
      "Use the trusted transport to copy the verified candidate pair into that isolated MO2 root."],
    cautions,
  };
}

/** Explicit stage action; all writes stay beneath a newly created stagingRoot. */
export function stageRuntimeDiagnostic(options: RuntimeDiagnosticOptions) {
  const plan = planRuntimeDiagnostic(options);
  requireValue(plan.exactFilenameConflicts.length === 0, "Exact filename conflicts block staging.");
  const paths = checked(options);
  requireValue(sha(paths.modlist) === plan.sourceProfileModlistSha256,
    "Source MO2 profile changed after diagnostic planning.");
  mkdirSync(dirname(paths.stage), { recursive: true });
  mkdirSync(paths.stage);
  const stagedMo2 = join(paths.stage, "mo2");
  const stagedProfile = join(stagedMo2, "profiles", options.profileId);
  mkdirSync(stagedProfile, { recursive: true });
  mkdirSync(join(stagedMo2, "mods"), { recursive: true });
  const metadataNames = ["modlist.txt", "plugins.txt", "loadorder.txt", "settings.ini", "archives.txt",
    "lockedorder.txt", "initweaks.ini", "UserSettings.json"];
  for (const name of metadataNames) {
    const source = join(paths.profile, name);
    if (existsSync(source)) { regular(source); copyFileSync(source, join(stagedProfile, name)); }
  }
  requireValue(sha(join(stagedProfile, "modlist.txt")) === plan.sourceProfileModlistSha256,
    "Copied MO2 profile changed during diagnostic staging.");
  writeFileSync(join(stagedProfile, "modlist.txt"), diagnosticModlist(readFileSync(paths.modlist, "utf8"),
    frameworkModNames(plan.frameworks)));
  const settings = defaultLocalSettings();
  settings.gameRoot = paths.game; settings.mo2Root = stagedMo2; settings.mo2ProfileId = options.profileId;
  settings.launchRoute = "mo2"; settings.installMode = "mo2";
  const transport = createModInstallTransport({ candidateStore: paths.store,
    receiptsRoot: join(paths.stage, "receipts"), settings });
  const preflight = transport.preflight(options.candidateId);
  requireValue(preflight.route === "mo2" && within(preflight.target, paths.stage),
    "Transport target escaped the diagnostic root.");
  const receipt = transport.install(options.candidateId);
  requireValue(within(receipt.target, paths.stage), "Install receipt escaped the diagnostic root.");
  writeFileSync(join(paths.stage, "diagnostic-plan.json"), JSON.stringify({ ...plan, stageReceipt: receipt }, null, 2) + "\n");
  return { plan, stagedMo2, stagedProfile, receipt };
}
