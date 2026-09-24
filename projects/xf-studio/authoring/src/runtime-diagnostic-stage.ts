/** A private MO2 diagnostic clone. This never writes to the source MO2 or game. */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { defaultLocalSettings } from "./local-settings";
import { createModInstallTransport, inspectLocalPackageCandidate } from "./mod-install-transport";

export type RuntimeDiagnosticOptions = {
  candidateStore: string; candidateId: string; gameRoot: string; mo2Root: string;
  profileId: string; stagingRoot: string;
};
export type RuntimeDiagnosticPlan = {
  schema: "xfs/runtime-diagnostic-plan-1"; candidateId: string; namespace: string;
  candidateFiles: { path: string; sha256: string; bytes: number }[];
  verifiedUnpackedFiles: number; presetCount: number; omissions: number;
  sourceProfileModlistSha256: string; sourceProfileEnabledMods: number;
  sourceProfileLegacyEnabled: boolean; sourceProfileXfStudioPresent: boolean;
  sourceDedicatedModExists: boolean;
  frameworkMetadataVersions: Record<string, string | null>;
  exactFilenameConflicts: string[]; stagingRoot: string;
  actions: string[]; cautions: string[];
};

function requireValue(ok: unknown, message: string): asserts ok { if (!ok) throw Error(message); }
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
  requireValue(!names.includes("XF Studio"), "Source profile already enables XF Studio; inspect it before staging.");
  const frameworkMetadataVersions: Record<string, string | null> = {};
  for (const name of ["ArchiveXL", "TweakXL", "Codeware", "redscript"]) {
    const meta = join(paths.mo2, "mods", name, "meta.ini");
    if (names.includes(name) && existsSync(meta)) regular(meta);
    frameworkMetadataVersions[name] = names.includes(name) && existsSync(meta)
      ? (/^version=(.*)$/m.exec(readFileSync(meta, "utf8"))?.[1]?.trim() || null) : null;
  }
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
  const manifest = paths.candidate.manifest as typeof paths.candidate.manifest & {
    verifiedPresetCount?: number; omissions?: unknown[];
  };
  requireValue(Number.isSafeInteger(manifest.verifiedPresetCount) && manifest.verifiedPresetCount! > 0,
    "Diagnostic candidate has no recorded presets.");
  const legacy = names.includes("XF Eye Artistry CCXL - Dev");
  const dedicatedModExists = existsSync(join(paths.mo2, "mods", "XF Studio"));
  const cautions = [
    "This checks paired payload hashes and the manifest claim; it does not rerun the independent archive verifier.",
    "The source profile and old runtime logs do not prove which archives will win in a future session.",
    "The copied profile needs an explicit MO2 launch choice; staging does not activate it in the real instance.",
    "No plate clearance correction has passed every release gate; watch eyelids and idle poses.",
  ];
  if (legacy) cautions.push("The legacy Eye Artistry selector is enabled in the source profile and will be disabled only in the diagnostic clone.");
  if (dedicatedModExists) cautions.push("The source MO2 instance already has an XF Studio mod folder; inspect its ownership before promoting a diagnostic clone.");
  if (exactFilenameConflicts.length) cautions.push("Exact archive filename conflicts require resolution before a diagnostic launch.");
  return {
    schema: "xfs/runtime-diagnostic-plan-1", candidateId: options.candidateId,
    namespace: manifest.namespace, candidateFiles: manifest.files,
    verifiedUnpackedFiles: manifest.verifiedUnpackedFiles,
    presetCount: manifest.verifiedPresetCount!, omissions: Array.isArray(manifest.omissions) ? manifest.omissions.length : 0,
    sourceProfileModlistSha256: sha(paths.modlist), sourceProfileEnabledMods: names.length,
    sourceProfileLegacyEnabled: legacy, sourceProfileXfStudioPresent: lines.some(line => /^[+-]XF Studio$/.test(line)),
    sourceDedicatedModExists: dedicatedModExists,
    frameworkMetadataVersions,
    exactFilenameConflicts, stagingRoot: paths.stage,
    actions: ["Copy selected profile metadata into a new isolated MO2 root.",
      ...(legacy ? ["Disable the legacy Eye Artistry mod only in that copied modlist."] : []),
      "Enable a dedicated XF Studio entry only in that copied modlist.",
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
  const sourceModlist = readFileSync(paths.modlist, "utf8");
  const newline = sourceModlist.includes("\r\n") ? "\r\n" : "\n";
  let lines = sourceModlist.split(/\r?\n/).filter((line, index, all) => index < all.length - 1 || line);
  lines = lines.map(line => line === "+XF Eye Artistry CCXL - Dev" ? "-XF Eye Artistry CCXL - Dev" : line);
  lines = lines.filter(line => line !== "-XF Studio");
  lines.push("+XF Studio");
  writeFileSync(join(stagedProfile, "modlist.txt"), lines.join(newline) + newline);
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
