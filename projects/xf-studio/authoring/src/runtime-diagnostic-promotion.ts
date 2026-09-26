/** Explicit, reversible transfer of a reviewed scratch diagnostic into a NEW MO2 profile. The mod keeps the
 * name it was staged under (the candidate's mod name, PIPE-90); stages from before names flowed through are eye makeup's. */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { inspectLocalPackageCandidate, installedDuplicates } from "./mod-install-transport";
import { frameworkModNames } from "./framework-versions";
import { candidateModName, diagnosticModlist, installedPlaces, legacyModFolder, profileFrameworks, type RuntimeDiagnosticOptions,
  type RuntimeDiagnosticPlan } from "./runtime-diagnostic-stage";
import { EYE_MAKEUP_MOD, eyeMakeupModFolders, isEyeMakeupModFolder } from "./mod-branding";

const metadata = ["modlist.txt", "plugins.txt", "loadorder.txt", "settings.ini", "archives.txt",
  "lockedorder.txt", "initweaks.ini", "UserSettings.json"];
type Entry = { path: string; sha256: string; bytes: number };
export type PromotionOptions = RuntimeDiagnosticOptions & { newProfileId: string };
export type PromotionPreview = { schema: "xfs/runtime-promotion-preview-1"; sourceProfile: string;
  newProfile: string; dedicatedMod: string; stageProfile: string; stageMod: string;
  /** The promoted mod's name (its MO2 folder); records from before PIPE-90 lack it and name one of eye makeup's folders. */
  modName?: string;
  candidateId: string; namespace: string; files: { source: string; target: string; sha256: string; bytes: number }[];
  sourceModlistSha256: string; changes: string[]; recovery: string; };
type Record = { schema: "xfs/runtime-promotion-record-1"; preview: PromotionPreview;
  profileFiles: Entry[]; modFiles: Entry[]; transactionId: string };

function requireValue(ok: unknown, message: string): asserts ok { if (!ok) throw Error(message); }
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const within = (child: string, root: string) => {
  const rel = relative(root, child);
  return !rel || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
};
function noLinks(path: string) {
  let at = resolve(path);
  while (!existsSync(at)) { const parent = dirname(at); requireValue(parent !== at, "Missing path root."); at = parent; }
  for (;;) { requireValue(!lstatSync(at).isSymbolicLink(), `Linked path is forbidden: ${at}`);
    const parent = dirname(at); if (parent === at) break; at = parent; }
}
function file(path: string) { noLinks(path); requireValue(lstatSync(path).isFile(), `Expected file: ${path}`); }
function directory(path: string) { noLinks(path); requireValue(lstatSync(path).isDirectory(), `Expected directory: ${path}`); }
function profileName(name: string) {
  requireValue(/^[^\\/.:\x00-\x1f][^\\/:\x00-\x1f]{0,127}$/.test(name) && name !== ".." &&
    name.trim() === name && !name.endsWith("."), "Invalid new MO2 profile name.");
}
function absentCaseInsensitive(parent: string, name: string) {
  directory(parent);
  requireValue(!readdirSync(parent).some(entry => entry.toLowerCase() === name.toLowerCase()),
    `Destination already exists (case-insensitive): ${join(parent, name)}`);
}
function inventory(root: string, names: string[]): Entry[] {
  directory(root);
  requireValue(readdirSync(root).sort().join("\0") === [...names].sort().join("\0"),
    `Directory contents changed or contain unowned files: ${root}`);
  return names.map(name => { const path = join(root, name); file(path);
    return { path: name, sha256: sha(path), bytes: lstatSync(path).size }; });
}
function sameInventory(root: string, entries: Entry[]) {
  const current = inventory(root, entries.map(entry => entry.path));
  requireValue(JSON.stringify(current) === JSON.stringify(entries), `Owned files changed: ${root}`);
}
function sameModTree(root: string, entries: Entry[]) {
  const payload = join(root, "archive", "pc", "mod");
  sameInventory(payload, entries);
  requireValue(readdirSync(root).join() === "archive" && readdirSync(join(root, "archive")).join() === "pc" &&
    readdirSync(join(root, "archive", "pc")).join() === "mod", "Promoted mod has additional content.");
}
function durableJson(path: string, value: unknown) {
  requireValue(!existsSync(path), `Record already exists: ${path}`);
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temp, "wx");
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temp, path);
}
function recordPaths(stage: string) { return { journal: join(stage, "promotion-journal.json"),
  receipt: join(stage, "promotion-receipt.json") }; }
function validate(options: PromotionOptions) {
  for (const value of [options.candidateStore, options.gameRoot, options.mo2Root, options.stagingRoot])
    requireValue(isAbsolute(value), "All roots must be absolute.");
  profileName(options.profileId); profileName(options.newProfileId);
  requireValue(options.profileId.toLowerCase() !== options.newProfileId.toLowerCase(),
    "Promotion requires a different, new profile name.");
  const stage = resolve(options.stagingRoot), mo2 = resolve(options.mo2Root);
  for (const source of [mo2, resolve(options.candidateStore), resolve(options.gameRoot)])
    requireValue(!within(stage, source) && !within(source, stage),
      "Diagnostic stage must be outside every source root.");
  directory(stage); directory(mo2);
  const { journal, receipt } = recordPaths(stage);
  noLinks(journal); noLinks(receipt);
  requireValue(!existsSync(journal) && !existsSync(receipt),
    "Promotion journal or receipt exists; recover or rollback before another attempt.");
  const stagePlanFile = join(stage, "diagnostic-plan.json"); file(stagePlanFile);
  const saved = JSON.parse(readFileSync(stagePlanFile, "utf8")) as RuntimeDiagnosticPlan & { stageReceipt?: {
    schema: string; route: string; target: string; candidateId: string; namespace: string; files: Entry[] } };
  requireValue(saved.schema === "xfs/runtime-diagnostic-plan-2" && saved.stagingRoot === stage &&
    saved.candidateId === options.candidateId && saved.stageReceipt?.schema === "xfs/install-receipt-1" &&
    saved.stageReceipt.route === "mo2" && saved.stageReceipt.candidateId === options.candidateId,
  "Stage plan or receipt does not match these inputs.");
  const sourceProfile = join(mo2, "profiles", options.profileId);
  const sourceModlist = join(sourceProfile, "modlist.txt"); file(sourceModlist);
  requireValue(sha(sourceModlist) === saved.sourceProfileModlistSha256,
    "Source profile modlist changed since staging.");
  const stageProfile = join(stage, "mo2", "profiles", options.profileId);
  const candidate = inspectLocalPackageCandidate(options.candidateStore, options.candidateId);
  // The mod the stage placed: the candidate's own name, recorded by the stage plan (older plans: eye makeup's brand).
  const modName = saved.modName ?? EYE_MAKEUP_MOD.modName;
  requireValue(modName === candidateModName(candidate.manifest), "Stage plan names another mod than this candidate. Stage it again.");
  const stageMod = join(stage, "mo2", "mods", modName);
  const stagePayload = join(stageMod, "archive", "pc", "mod");
  const legacyStage = EYE_MAKEUP_MOD.legacyModFolders.find(name =>
    saved.stageReceipt!.target === join(stage, "mo2", "mods", name, "archive", "pc", "mod"));
  requireValue(!legacyStage, `This stage used the legacy mod folder "${legacyStage}". ` +
    `Stage again so the promoted mod is named "${modName}".`);
  requireValue(saved.stageReceipt.target === stagePayload, "Stage receipt target mismatch.");
  const receiptsDir = join(stage, "receipts"); directory(receiptsDir);
  const receiptNames = readdirSync(receiptsDir).filter(name => name.endsWith(".json"));
  requireValue(receiptNames.length === 1, "Expected one trusted stage transport receipt.");
  const transportReceipt = join(receiptsDir, receiptNames[0]); file(transportReceipt);
  requireValue(JSON.stringify(JSON.parse(readFileSync(transportReceipt, "utf8"))) ===
    JSON.stringify(saved.stageReceipt), "Stage transport receipt differs from diagnostic record.");
  requireValue(saved.namespace === candidate.manifest.namespace &&
    JSON.stringify(saved.candidateFiles) === JSON.stringify(candidate.manifest.files) &&
    saved.stageReceipt.namespace === candidate.manifest.namespace &&
    JSON.stringify(saved.stageReceipt.files) === JSON.stringify(candidate.manifest.files),
  "Stage and source candidate identities or hashes differ.");
  const present = metadata.filter(name => existsSync(join(sourceProfile, name)));
  requireValue(present.includes("modlist.txt"), "Source modlist missing.");
  const stageProfileFiles = inventory(stageProfile, present);
  const frameworkMods = frameworkModNames(profileFrameworks(resolve(options.gameRoot), mo2, options.profileId));
  for (const name of present) {
    const source = join(sourceProfile, name); file(source);
    if (name === "modlist.txt") requireValue(readFileSync(join(stageProfile, name), "utf8") ===
      diagnosticModlist(readFileSync(source, "utf8"), frameworkMods, modName), "Staged modlist differs from expected isolated changes.");
    else requireValue(sha(source) === sha(join(stageProfile, name)), `Source profile metadata changed: ${name}`);
  }
  const expectedPayloadNames = candidate.manifest.files.map(entry => basename(entry.path));
  const modFiles = inventory(stagePayload, expectedPayloadNames);
  requireValue(readdirSync(stageMod).join() === "archive" &&
    readdirSync(join(stageMod, "archive")).join() === "pc" &&
    readdirSync(join(stageMod, "archive", "pc")).join() === "mod",
  "Staged dedicated mod contains unexpected files.");
  for (let i = 0; i < modFiles.length; i++) requireValue(modFiles[i].sha256 === candidate.manifest.files[i].sha256 &&
    modFiles[i].bytes === candidate.manifest.files[i].bytes, "Staged payload differs from candidate.");
  const game = resolve(options.gameRoot); directory(game);
  file(join(game, "bin", "x64", "Cyberpunk2077.exe"));
  const sourceLines = readFileSync(sourceModlist, "utf8").split(/\r?\n/);
  const enabled = sourceLines.filter(line => line.startsWith("+")).map(line => line.slice(1));
  const enabledMod = enabled.find(name => name.toLowerCase() === modName.toLowerCase() || isEyeMakeupModFolder(name));
  requireValue(!enabledMod, `Source profile already enables ${modName}` +
    (enabledMod?.toLowerCase() === modName.toLowerCase() ? "." : ` under its earlier name "${enabledMod}".`));
  for (const entry of modFiles) {
    const name = entry.path;
    requireValue(!existsSync(join(game, "archive", "pc", "mod", name)), `Direct game archive collision: ${name}`);
    for (const mod of enabled) {
      requireValue(!/[\\/:\x00-\x1f]/.test(mod) && mod !== "..", "Unsafe source mod name.");
      requireValue(!existsSync(join(mo2, "mods", mod, "archive", "pc", "mod", name)),
        `Enabled MO2 archive filename collision: ${mod}/${name}`);
    }
  }
  const profiles = join(mo2, "profiles"), mods = join(mo2, "mods");
  absentCaseInsensitive(profiles, options.newProfileId); absentCaseInsensitive(mods, modName);
  // A feature may be present in only one installed XF mod: refuse when any installed mod, whichever stage or install put
  // it there, already holds part of this build (the stage's own receipts can't see those; PIPE-90).
  const duplicates = installedDuplicates(readFileSync(join(candidate.root, ...candidate.manifest.files[1].path.split("/")), "utf8"),
    installedPlaces(mo2, game));
  requireValue(!duplicates.length, `Part of this build is already installed in ${duplicates.join(", ")}. Remove it first, or build both mods ` +
    "from the same package plan. Nothing was changed.");
  // An earlier diagnostic install under a legacy folder name is the same mod: never create a second copy beside it.
  const legacy = legacyModFolder(mods);
  requireValue(!legacy, `MO2 already has an earlier ${EYE_MAKEUP_MOD.modName} diagnostic install in the legacy ` +
    `folder "${legacy}". Roll back that promotion (or remove the folder in MO2) before promoting another copy.`);
  return { stage, mo2, sourceProfile, sourceModlist, stageProfile, stageMod, modName,
    profileFiles: stageProfileFiles, modFiles, candidate, saved };
}

/** Pure filesystem read: no directory, receipt, or profile is created. */
export function planRuntimePromotion(options: PromotionOptions): PromotionPreview {
  const v = validate(options);
  const newProfile = join(v.mo2, "profiles", options.newProfileId);
  const dedicatedMod = join(v.mo2, "mods", v.modName);
  return { schema: "xfs/runtime-promotion-preview-1", sourceProfile: v.sourceProfile,
    newProfile, dedicatedMod, stageProfile: v.stageProfile, stageMod: v.stageMod, modName: v.modName,
    candidateId: options.candidateId, namespace: v.candidate.manifest.namespace,
    files: [...v.profileFiles.map(entry => ({ source: join(v.stageProfile, entry.path),
      target: join(newProfile, entry.path), sha256: entry.sha256, bytes: entry.bytes })),
      ...v.modFiles.map(entry => ({ source: join(v.stageMod, "archive", "pc", "mod", entry.path),
        target: join(dedicatedMod, "archive", "pc", "mod", entry.path), sha256: entry.sha256, bytes: entry.bytes }))],
    sourceModlistSha256: v.saved.sourceProfileModlistSha256,
    changes: ["Create only the named new profile from staged metadata.",
      `Create only the dedicated ${v.modName} mod from the staged pair.`,
      "Leave the original profile, other mods, and MO2 global selected-profile setting unchanged."],
    recovery: `Private journal and receipt in ${v.stage}; recovery removes only matching newly created paths.`,
  };
}

function copyChecked(source: string, target: string, entries: Entry[]) {
  mkdirSync(target, { recursive: true });
  for (const entry of entries) copyFileSync(join(source, entry.path), join(target, entry.path), constants.COPYFILE_EXCL);
  sameInventory(target, entries);
}
function ownedRecord(path: string): Record {
  file(path);
  const value = JSON.parse(readFileSync(path, "utf8")) as Record;
  requireValue(value.schema === "xfs/runtime-promotion-record-1" &&
    value.preview.schema === "xfs/runtime-promotion-preview-1" && /^[a-f0-9-]{36}$/.test(value.transactionId) &&
    Array.isArray(value.profileFiles) && Array.isArray(value.modFiles), "Invalid promotion record.");
  requireValue(value.profileFiles.length > 0 && value.profileFiles.every(entry => metadata.includes(entry.path) &&
      /^[a-f0-9]{64}$/.test(entry.sha256) && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0) &&
    value.modFiles.length === 2 &&
    value.modFiles[0].path === `${value.preview.namespace}.archive` &&
    value.modFiles[1].path === `${value.preview.namespace}.archive.xl` &&
    value.modFiles.every(entry => /^[a-f0-9]{64}$/.test(entry.sha256) &&
      Number.isSafeInteger(entry.bytes) && entry.bytes > 0), "Invalid promotion inventory.");
  return value;
}
function removeOwned(record: Record, options: PromotionOptions) {
  const mo2 = resolve(options.mo2Root), stage = resolve(options.stagingRoot);
  // Records from before mod branding name the legacy folder, and records from before PIPE-90 the brand's; recovery and
  // rollback still accept them. A newer record names its mod.
  const folders = [...(record.preview.modName !== undefined ? [record.preview.modName] : []), ...eyeMakeupModFolders];
  const folder = folders.find(name => record.preview.dedicatedMod === join(mo2, "mods", name));
  requireValue(folder !== undefined && record.preview.newProfile === join(mo2, "profiles", options.newProfileId) &&
    record.preview.stageProfile === join(stage, "mo2", "profiles", options.profileId) &&
    record.preview.stageMod === join(stage, "mo2", "mods", folder) &&
    record.preview.candidateId === options.candidateId, "Promotion record target mismatch.");
  const profile = record.preview.newProfile, mod = record.preview.dedicatedMod;
  const tempProfile = join(mo2, "profiles", `.xfs-promotion-${record.transactionId}`);
  const tempMod = join(mo2, "mods", `.xfs-promotion-${record.transactionId}`);
  // Precheck every possible destination before removing any one of them.
  for (const path of [profile, tempProfile]) if (existsSync(path)) sameInventory(path, record.profileFiles);
  for (const path of [mod, tempMod]) if (existsSync(path)) sameModTree(path, record.modFiles);
  for (const path of [profile, mod, tempProfile, tempMod]) if (existsSync(path)) rmSync(path, { recursive: true });
}

/** An explicit action. A private journal is durable before the first live rename. */
export function promoteRuntimeDiagnostic(options: PromotionOptions): PromotionPreview {
  const preview = planRuntimePromotion(options);
  const v = validate(options), { journal, receipt } = recordPaths(v.stage);
  const transactionId = randomUUID();
  const record: Record = { schema: "xfs/runtime-promotion-record-1", preview,
    profileFiles: v.profileFiles, modFiles: v.modFiles, transactionId };
  const temporaryProfile = join(v.mo2, "profiles", `.xfs-promotion-${transactionId}`);
  const temporaryMod = join(v.mo2, "mods", `.xfs-promotion-${transactionId}`);
  requireValue(!existsSync(temporaryProfile) && !existsSync(temporaryMod), "Temporary destination exists.");
  try {
    copyChecked(v.stageProfile, temporaryProfile, v.profileFiles);
    copyChecked(join(v.stageMod, "archive", "pc", "mod"), join(temporaryMod, "archive", "pc", "mod"), v.modFiles);
    // Recheck source/stage and destination after copies, immediately before the first mutation.
    validate(options);
    sameInventory(temporaryProfile, v.profileFiles);
    sameInventory(join(temporaryMod, "archive", "pc", "mod"), v.modFiles);
    durableJson(journal, record);
    renameSync(temporaryMod, preview.dedicatedMod);
    renameSync(temporaryProfile, preview.newProfile);
    sameInventory(preview.newProfile, v.profileFiles);
    sameInventory(join(preview.dedicatedMod, "archive", "pc", "mod"), v.modFiles);
    durableJson(receipt, record);
    rmSync(journal);
    return preview;
  } finally {
    // Once journaled, leave any partial live state for explicit, conflict-aware recovery.
    if (!existsSync(journal)) {
      if (existsSync(temporaryProfile)) rmSync(temporaryProfile, { recursive: true });
      if (existsSync(temporaryMod)) rmSync(temporaryMod, { recursive: true });
    }
  }
}

/** Refuses a changed target; safe to repeat after an interrupted first promotion. */
export function recoverRuntimePromotion(options: PromotionOptions) {
  const stage = resolve(options.stagingRoot); directory(stage);
  const { journal, receipt } = recordPaths(stage);
  requireValue(existsSync(journal), "No pending promotion journal.");
  const record = ownedRecord(journal);
  // A completed receipt followed by a leftover journal means the commit finished.
  if (existsSync(receipt)) {
    requireValue(readFileSync(receipt, "utf8") === readFileSync(journal, "utf8"), "Receipt and journal differ.");
    sameInventory(record.preview.newProfile, record.profileFiles);
    sameModTree(record.preview.dedicatedMod, record.modFiles);
    rmSync(journal); return "completed" as const;
  }
  removeOwned(record, options);
  rmSync(journal);
  return "reverted" as const;
}

/** Reverts only a complete, still-identical promotion. */
export function rollbackRuntimePromotion(options: PromotionOptions) {
  const stage = resolve(options.stagingRoot); directory(stage);
  const { journal, receipt } = recordPaths(stage);
  requireValue(!existsSync(journal), "Recover pending promotion first.");
  const record = ownedRecord(receipt);
  requireValue(existsSync(record.preview.newProfile) && existsSync(record.preview.dedicatedMod),
    "Promoted profile or mod is missing.");
  removeOwned(record, options);
  rmSync(receipt);
}
