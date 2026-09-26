/** Trusted, offline transport for an independently verified local package.
 * A host supplies fixed private roots and parsed settings; browser input is only a
 * candidate ID from that root. This module never compiles or changes a recipe.
 */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readdirSync, readFileSync, readSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { LocalSettings } from "./local-settings";
import { EYE_MAKEUP_MOD } from "./mod-branding";
import { readConfiguredMo2Instance } from "./install-detection-host";
import { duplicatedNamespaces, readPackageManifest, type PackageManifestView } from "./platform/export/manifest";
import { EYE_MAKEUP_FEATURE } from "./recipe-schema";
import { modNameIssue } from "./platform/api";

const schema = "xfs/install-receipt-1" as const;
const fileNames = ["archive", "archive.xl"] as const;
type FileEntry = { path: string; sha256: string; bytes: number };
/** A verified candidate's manifest (`xfs/local-package-1` or `-2`), read by the platform's one reader (PIPE-09). */
type PackageManifest = PackageManifestView & { namespace: string; files: FileEntry[] };
export type InstallRoute = "direct" | "mo2";
export type InstallReceipt = { schema: typeof schema; targetId: string; route: InstallRoute; target: string;
  candidateId: string; namespace: string; files: FileEntry[]; installedAt: string;
  /** The feature namespaces the installed archive holds (receipts from before products lack it: then its archive name). */
  features?: { feature: string; namespace: string }[];
  rollback: null | { prior: InstallReceipt; backup: string } };
type Journal = { schema: "xfs/install-journal-1"; targetId: string; target: string;
  names: string[]; next: FileEntry[]; prior: InstallReceipt | null; backup: string | null;
  /** The receipt a completed install writes; with it, recovery finishes an install whose files are all in place (INSTALL-02). */
  pending?: InstallReceipt };
/** What recovery did: finished the interrupted install, undid it, or (its files all gone) only forgot it. */
export type RecoveryResult = { recovered: boolean; conflicts: string[]; direction?: "forward" | "back" | "cleared" };
export type InstallTransportConfig = { candidateStore: string; receiptsRoot: string; settings: LocalSettings;
  /**
   * The mod this transport places (its MO2 folder): the product's mod name as its manifest records it, so a renamed mod
   * can be placed (PIPE-90); defaults to eye makeup's brand. A candidate of another mod is refused.
   */
  modName?: string;
  /** Test seam: runs once the payload is staged, before the journal (a test makes an install fail there). */
  afterStaging?: () => void };
export type InstallPreview = { route: InstallRoute; target: string; candidateId: string;
  files: FileEntry[]; replacingOwned: boolean; activation: string;
  /** An earlier install was recorded but its files are gone (removed in the mod manager or by hand): installed afresh (INSTALL-03). */
  reinstalling: boolean };

const hash = (file: string) => {
  const digest = createHash("sha256"), fd = openSync(file, "r"), chunk = Buffer.allocUnsafe(1024 * 1024);
  try { let bytes: number; while ((bytes = readSync(fd, chunk, 0, chunk.length, null)) > 0)
    digest.update(chunk.subarray(0, bytes)); }
  finally { closeSync(fd); }
  return digest.digest("hex");
};
const flush = (file: string) => { const fd = openSync(file, "r+");
  try { fsyncSync(fd); } finally { closeSync(fd); } };
const id = (text: string) => createHash("sha256").update(text.toLowerCase()).digest("hex").slice(0, 24);
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw Error(message); }
const inside = (child: string, root: string) => {
  const rel = relative(root, child);
  return !!rel && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
};
const safeName = (value: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(value);
// MO2 profile directories can contain spaces and parentheses. Mirror the
// settings parser's single-segment rule; package/candidate IDs stay stricter.
const profileSegment = (value: string) => /^[^\\/.:\x00-\x1f][^\\/:\x00-\x1f]{0,127}$/.test(value) &&
  value !== "." && value !== ".." && value.trim() === value && !value.endsWith(".");
const regular = (path: string) => {
  const stat = lstatSync(path);
  assert(stat.isFile() && !stat.isSymbolicLink(), `Expected a regular file: ${path}`);
  return stat;
};
const directory = (path: string) => {
  const stat = lstatSync(path);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `Expected a real directory: ${path}`);
};
/** Reject symlinks/junctions in every existing path component, including roots. */
function noLinks(path: string) {
  let cursor = resolve(path);
  while (true) {
    try { lstatSync(cursor); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(cursor);
      assert(parent !== cursor, "Path root does not exist."); cursor = parent; }
  }
  while (true) {
    const stat = lstatSync(cursor);
    assert(!stat.isSymbolicLink(), `Linked path is not an install destination: ${cursor}`);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}
function parseManifest(root: string): PackageManifest {
  const file = join(root, "manifest.json");
  regular(file);
  // Version 1 was written only by the eye-makeup exporter, whose feature namespace was its archive name.
  const value = readPackageManifest(JSON.parse(readFileSync(file, "utf8")), EYE_MAKEUP_FEATURE);
  assert(safeName(value.archive), "Candidate manifest is not a verified two-file package.");
  for (let i = 0; i < 2; i++) {
    const entry = value.files[i];
    assert(entry.path === `archive/pc/mod/${value.archive}.${fileNames[i]}`, "Candidate manifest contains an unexpected file or hash.");
    const payload = join(root, ...entry.path.split("/"));
    noLinks(payload);
    assert(regular(payload).size === entry.bytes && hash(payload) === entry.sha256,
      "Candidate payload differs from the verified manifest.");
  }
  return { ...value, namespace: value.archive, files: [...value.files] };
}
/** Read-only payload check for a host-owned candidate. This checks the exact
 * paired files and hashes, but does not repeat the independent archive verifier. */
export function inspectLocalPackageCandidate(storePath: string, candidateId: string) {
  assert(isAbsolute(storePath), "Invalid candidate store.");
  assert(safeName(candidateId), "Invalid candidate ID.");
  const store = resolve(storePath), root = resolve(store, candidateId);
  assert(inside(root, store), "Candidate escapes the configured store.");
  noLinks(store); noLinks(root); directory(store); directory(root);
  return { root, manifest: parseManifest(root) };
}
function validEntries(files: FileEntry[], namespace: string): boolean {
  return Array.isArray(files) && files.length === 2 && safeName(namespace) && namespace.startsWith("xfs_") &&
    files.every((entry, index) => entry?.path === `archive/pc/mod/${namespace}.${fileNames[index]}` &&
      /^[a-f0-9]{64}$/.test(entry.sha256) && Number.isSafeInteger(entry.bytes) && entry.bytes > 0);
}
const readJson = <T>(path: string): T | null => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as T : null;
function atomicJson(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temp, "wx");
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temp, path);
}
type Target = { route: InstallRoute; target: string; activation: string; legacyInstall: string | null;
  /** The mod's own MO2 folder (`mods/<mod name>`), or null on the direct route. */
  modFolder: string | null };
function targetFor(settings: LocalSettings, modName: string): Target {
  const route = settings.installMode;
  assert(route !== "none" && route === settings.launchRoute, "Select a matching install and launch route.");
  assert(settings.gameRoot && isAbsolute(settings.gameRoot), "Configured game root is missing.");
  noLinks(settings.gameRoot);
  noLinks(join(settings.gameRoot, "bin", "x64", "Cyberpunk2077.exe"));
  regular(join(settings.gameRoot, "bin", "x64", "Cyberpunk2077.exe"));
  directory(join(settings.gameRoot, "archive", "pc"));
  if (route === "direct") {
    const target = join(settings.gameRoot, "archive", "pc", "mod");
    noLinks(target);
    return { route, target, activation: "Files are staged in the game's archive/pc/mod folder; game loading is unverified.",
      legacyInstall: null, modFolder: null };
  }
  assert(settings.mo2Root && isAbsolute(settings.mo2Root) && settings.mo2ProfileId && profileSegment(settings.mo2ProfileId),
    "Configured MO2 instance and profile are missing.");
  noLinks(settings.mo2Root);
  // Use the instance's configured directories (ModOrganizer.ini [Settings]), not assumed defaults.
  const { paths } = readConfiguredMo2Instance(settings.mo2Root);
  noLinks(paths.mods);
  directory(paths.mods);
  noLinks(join(paths.profiles, settings.mo2ProfileId, "modlist.txt"));
  regular(join(paths.profiles, settings.mo2ProfileId, "modlist.txt"));
  // An earlier diagnostic install of this same mod may sit under a legacy folder name.
  // Install refuses rather than silently creating a second copy beside it (see preflight).
  const legacyInstall = readdirSync(paths.mods).find(entry =>
    EYE_MAKEUP_MOD.legacyModFolders.some(name => name.toLowerCase() === entry.toLowerCase())) ?? null;
  const target = join(paths.mods, modName, "archive", "pc", "mod");
  noLinks(target);
  return { route, target, legacyInstall, modFolder: join(paths.mods, modName),
    activation: `Enable the dedicated ${modName} mod in the chosen MO2 profile; activation and game loading are unverified.` };
}

/**
 * Whether a folder holds any file below it (links are not followed), leaving out `ignored` (lower-case absolute paths). MO2
 * writes its own `meta.ini` into every mod folder it lists, including an empty one an interrupted first install left.
 */
function holdsFiles(folder: string, ignored: ReadonlySet<string> = new Set(), top = true): boolean {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (ignored.has(path.toLowerCase()) || (top && entry.isFile() && entry.name.toLowerCase() === "meta.ini")) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink()) return true;
    if (holdsFiles(path, ignored, false)) return true;
  }
  return false;
}

/** The folders `mkdirSync(path, { recursive: true })` would create, outermost first. */
function missingFolders(path: string): string[] {
  const missing: string[] = [];
  let cursor = resolve(path);
  while (!existsSync(cursor)) {
    missing.unshift(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return missing;
}

/**
 * The resources an ArchiveXL declaration registers (its customization files and resource-scope members), as
 * normalised depot paths. A feature's namespace is its resources: two archives declaring one of them hold the same
 * feature of the same collection. Text that isn't a declaration registers nothing.
 */
export function declaredResources(text: string): string[] {
  let value: unknown;
  try { value = Bun.YAML.parse(text.replace(/^\uFEFF/, "")); } catch { return []; }
  const list = (item: unknown): unknown[] => item === undefined || item === null ? [] : Array.isArray(item) ? item : [item];
  const root = value as { customizations?: { female?: unknown; male?: unknown }; resource?: { scope?: Record<string, unknown> } } | null;
  if (!root || typeof root !== "object") return [];
  const entries = [...list(root.customizations?.female), ...list(root.customizations?.male),
    ...Object.values(root.resource?.scope && typeof root.resource.scope === "object" ? root.resource.scope : {}).flatMap(list)];
  return [...new Set(entries.filter((entry): entry is string => typeof entry === "string").map(entry => entry.replaceAll("\\", "/").toLowerCase()))];
}

/**
 * Installed mods already holding part of a candidate (PIPE-90): each folder of `places` (an `archive/pc/mod` folder,
 * with a plain label such as the MO2 mod's name) whose `.archive.xl` files declare a resource the candidate's own
 * declaration declares. This sees every installed copy, however and from whichever stage it was installed, where the
 * receipts of one stage see only that stage.
 */
export function installedDuplicates(candidateXl: string, places: readonly { label: string; folder: string }[]): string[] {
  return findInstalledDuplicates(candidateXl, places).map(found => found.place.label);
}

/** The most `.xl` files read in one place, and the largest read: the scan stays bounded however many mods there are (INSTALL-10). */
const XL_FILES_PER_PLACE = 64, XL_BYTES = 1_000_000;

/** `installedDuplicates` with the `.archive.xl` file that holds part of the candidate in each place. */
export function findInstalledDuplicates<P extends { label: string; folder: string }>(candidateXl: string, places: readonly P[],
  skip: (file: string) => boolean = () => false): { place: P; file: string }[] {
  const ours = new Set(declaredResources(candidateXl));
  if (!ours.size) return [];
  const found: { place: P; file: string }[] = [];
  for (const place of places) {
    let names: string[];
    try { names = readdirSync(place.folder).filter(name => name.toLowerCase().endsWith(".xl")).sort().slice(0, XL_FILES_PER_PLACE); } catch { continue; }
    for (const name of names) {
      const file = join(place.folder, name);
      if (skip(file)) continue;
      try {
        const stat = lstatSync(file);
        if (!stat.isFile() || stat.size > XL_BYTES) continue;
        if (declaredResources(readFileSync(file, "utf8")).some(entry => ours.has(entry))) { found.push({ place, file }); break; }
      } catch { /* An unreadable file of another mod is not ours to judge. */ }
    }
  }
  return found;
}

/** The host owns this object; never expose its root paths as renderer-editable options. */
export function createModInstallTransport(config: InstallTransportConfig) {
  const store = resolve(config.candidateStore), receipts = resolve(config.receiptsRoot);
  assert(isAbsolute(config.candidateStore) && isAbsolute(config.receiptsRoot) && store !== receipts,
    "Candidate and receipt roots must be distinct absolute directories.");
  directory(store);
  noLinks(store); noLinks(receipts);
  mkdirSync(receipts, { recursive: true });
  const modName = config.modName ?? EYE_MAKEUP_MOD.modName;
  // The name becomes a folder in the mod manager: it must be one Windows can hold, and never a path (PIPE-90).
  assert(modName === modName.trim() && modNameIssue(modName) === undefined, "This mod's name can't be used as a mod folder. Rename it in Mod package, then try again.");
  const target = targetFor(config.settings, modName);
  assert(target.target !== store && target.target !== receipts &&
    !inside(target.target, store) && !inside(target.target, receipts) &&
    !inside(store, target.target) && !inside(receipts, target.target),
    "Install target and private stores must be separate.");
  const targetId = id(`${target.route}\0${resolve(target.target)}`);
  const receiptFile = join(receipts, `${targetId}.json`);
  const journalFile = join(receipts, `${targetId}.journal.json`);
  const lockFile = join(receipts, `${targetId}.lock`);
  const validReceipt = (value: unknown, allowRollback = true): value is InstallReceipt => {
    if (!value || typeof value !== "object") return false;
    const receipt = value as InstallReceipt;
    if (receipt.schema !== schema || receipt.targetId !== targetId || receipt.target !== target.target ||
      receipt.route !== target.route || !safeName(receipt.candidateId) ||
      typeof receipt.installedAt !== "string" || !Number.isFinite(Date.parse(receipt.installedAt)) ||
      !validEntries(receipt.files, receipt.namespace)) return false;
    if (receipt.rollback === null) return true;
    return allowRollback && !!receipt.rollback && typeof receipt.rollback.backup === "string" &&
      isAbsolute(receipt.rollback.backup) && inside(resolve(receipt.rollback.backup), receipts) &&
      validReceipt(receipt.rollback.prior, false);
  };
  const candidate = (candidateId: string) => {
    return inspectLocalPackageCandidate(store, candidateId);
  };
  /** What every other target's receipt says is installed there (their feature namespaces). */
  const otherReceipts = () => readdirSync(receipts).filter(name => /^[a-f0-9]{24}\.json$/.test(name) && name !== `${targetId}.json`)
    .flatMap(name => {
      try {
        const receipt = JSON.parse(readFileSync(join(receipts, name), "utf8")) as InstallReceipt;
        if (receipt?.schema !== schema || !safeName(receipt.namespace)) return [];
        return [{ features: Array.isArray(receipt.features) ? receipt.features : [{ feature: EYE_MAKEUP_FEATURE, namespace: receipt.namespace }] }];
      } catch { return []; }
    });
  const owned = (): InstallReceipt | null => {
    noLinks(receiptFile);
    const receipt = readJson<InstallReceipt>(receiptFile);
    if (receipt) assert(validReceipt(receipt), "Install receipt target or files mismatch.");
    return receipt;
  };
  /**
   * The recorded install: `live` while every file it names is present (checked by hash before any change), `gone` once one
   * is missing, as after removing the mod in MO2 or deleting its files. A gone install is treated as uninstalled: the next
   * install is a fresh one, and a file of it still present is replaced only while it is exactly the one recorded (INSTALL-03).
   */
  const recorded = (): { live: InstallReceipt | null; gone: InstallReceipt | null } => {
    const receipt = owned();
    if (!receipt) return { live: null, gone: null };
    return receipt.files.every(entry => existsSync(destination(entry))) ? { live: receipt, gone: null } : { live: null, gone: receipt };
  };
  const lockedByLiveProcess = () => {
    let owner: { pid?: number; started?: number };
    try { owner = JSON.parse(readFileSync(lockFile, "utf8")); }
    catch { return Date.now() - lstatSync(lockFile).mtimeMs < 120_000; }
    if (!Number.isSafeInteger(owner.pid) || !Number.isFinite(owner.started)) return true;
    try { process.kill(owner.pid!, 0); return true; }
    catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
  };
  const withLock = <T>(work: () => T): T => {
    noLinks(lockFile);
    let fd: number;
    try { fd = openSync(lockFile, "wx"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || lockedByLiveProcess())
        throw Error("An install operation is already active or its lock needs review.");
      rmSync(lockFile);
      fd = openSync(lockFile, "wx");
    }
    writeFileSync(fd, JSON.stringify({ pid: process.pid, started: Date.now() })); fsyncSync(fd);
    try { return work(); } finally { closeSync(fd); rmSync(lockFile); }
  };
  const destination = (entry: FileEntry) => join(target.target, basename(entry.path));
  /**
   * Every file of `files` present at its destination must be the one `receipt` (the live install) or `gone` (a recorded install
   * whose files are partly gone) says XF Studio put there; a live install's files must all be present.
   */
  const checkCurrent = (receipt: InstallReceipt | null, files: FileEntry[], gone: InstallReceipt | null = null) => {
    const previous = new Map(receipt?.files.map(file => [basename(file.path), file]));
    const forgotten = new Map(gone?.files.map(file => [basename(file.path), file]));
    if (receipt && receipt.namespace !== basename(files[0].path, ".archive"))
      throw Error("Changing the installed namespace requires uninstalling the owned pair first.");
    for (const entry of files) {
      const file = destination(entry), old = previous.get(basename(entry.path)) ?? forgotten.get(basename(entry.path));
      noLinks(file);
      if (existsSync(file)) {
        assert(old && regular(file).size === old.bytes && hash(file) === old.sha256,
          `Existing file is unowned or changed: ${file}`);
      } else assert(!previous.get(basename(entry.path)), `Owned installed file is missing: ${file}`);
    }
  };
  /**
   * An MO2 folder of this name that XF Studio didn't create (no live install of ours, and files in it): never written into,
   * whatever it holds (PIPE-90). An empty tree an interrupted first install left (with MO2's `meta.ini`) is ours to reuse, and
   * so are the files of a recorded install that is partly gone (checked by hash).
   */
  const foreignFolder = (live: InstallReceipt | null, gone: InstallReceipt | null) => !!target.modFolder && existsSync(target.modFolder) &&
    !live && !existsSync(journalFile) &&
    holdsFiles(target.modFolder, new Set((gone?.files ?? []).map(entry => destination(entry).toLowerCase())));
  const preflight = (candidateId: string): InstallPreview => {
    noLinks(journalFile);
    assert(!existsSync(journalFile), "An interrupted install needs recovery before another action.");
    const { live: prior, gone } = recorded();
    assert(!foreignFolder(prior, gone), `Mod Organizer 2 already has a mod called “${modName}” that XF Studio didn't put there, so nothing was ` +
      "installed. Rename your mod in Mod package, or rename that mod in Mod Organizer 2, then try again.");
    assert(!target.legacyInstall, `MO2 already has an earlier ${EYE_MAKEUP_MOD.modName} install under the legacy ` +
      `folder "${target.legacyInstall}". Roll back or remove that diagnostic mod before installing "${EYE_MAKEUP_MOD.modName}".`);
    const { manifest } = candidate(candidateId);
    // A product of another mod belongs in that mod's own folder.
    assert(manifest.schema === "xfs/local-package-1" || manifest.modName === modName,
      `This build is the mod “${manifest.modName}”, but this transfer places “${modName}”. Nothing was installed.`);
    // A feature namespace may be present in only one installed XF mod (feature-module platform §6).
    const elsewhere = otherReceipts();
    const duplicated = duplicatedNamespaces(manifest, elsewhere);
    assert(!duplicated.length, `Part of this build is already installed in another XF mod (${duplicated.join(", ")}). ` +
      "Uninstall that mod first, or build both mods from the same package plan and install them together. Nothing was installed.");
    checkCurrent(prior, manifest.files, gone);
    const { legacyInstall: _legacy, ...route } = target;
    return { ...route, candidateId, files: manifest.files, replacingOwned: !!prior, reinstalling: !!gone };
  };
  const readJournal = (): Journal | null => {
    noLinks(journalFile);
    const journal = readJson<Journal>(journalFile);
    if (!journal) return null;
    assert(journal.schema === "xfs/install-journal-1" && journal.targetId === targetId &&
      journal.target === target.target && validEntries(journal.next,
        basename(journal.next?.[0]?.path ?? "", ".archive")) &&
      Array.isArray(journal.names) && journal.names.length === 2 &&
      journal.names.every((name, index) => name === basename(journal.next[index].path)) &&
      ((journal.prior === null && journal.backup === null) ||
        (validReceipt(journal.prior) && typeof journal.backup === "string" &&
        isAbsolute(journal.backup) && inside(resolve(journal.backup), receipts))) &&
      (journal.pending === undefined || (validReceipt(journal.pending) &&
        JSON.stringify(journal.pending.files) === JSON.stringify(journal.next))),
      "Install journal target or files mismatch.");
    return journal;
  };
  /**
   * Finish or undo an interrupted install, following its journal (INSTALL-02):
   * - **forward** when every new file is already in place and the journal holds the receipt it was about to write;
   * - **cleared** when none of its files is there any more (removed in the mod manager or by hand): the record is forgotten;
   * - **back** otherwise: the earlier files come back from their verified backup, and new ones XF Studio added are removed.
   * A file that is neither the new nor the earlier one is a conflict: nothing is changed and it is named.
   */
  const recover = (): RecoveryResult => withLock(() => {
    const journal = readJournal();
    if (!journal) return { recovered: false, conflicts: [] };
    if (journal.backup) {
      assert(inside(resolve(journal.backup), receipts), "Journal backup escapes the private receipt root.");
      noLinks(journal.backup); directory(journal.backup);
    }
    const conflicts: string[] = [];
    const present = new Map<string, string>();
    for (const entry of journal.next) {
      const file = destination(entry), previous = journal.prior?.files.find(p => basename(p.path) === basename(entry.path));
      noLinks(file);
      if (!existsSync(file)) continue;
      const current = hash(file);
      present.set(file, current);
      if (current !== entry.sha256 && current !== previous?.sha256) conflicts.push(file);
    }
    if (conflicts.length) return { recovered: false, conflicts };
    if (journal.pending && journal.next.every(entry => present.get(destination(entry)) === entry.sha256)) {
      atomicJson(receiptFile, journal.pending);
      rmSync(journalFile);
      return { recovered: true, conflicts: [], direction: "forward" };
    }
    if (!present.size) {
      if (existsSync(receiptFile)) rmSync(receiptFile);
      rmSync(journalFile);
      return { recovered: true, conflicts: [], direction: "cleared" };
    }
    if (journal.prior && journal.backup) for (const entry of journal.prior.files) {
      const saved = join(journal.backup, basename(entry.path));
      noLinks(saved);
      assert(regular(saved).size === entry.bytes && hash(saved) === entry.sha256,
        "Rollback backup differs from its receipt.");
    }
    for (const entry of journal.next) {
      const file = destination(entry), previous = journal.prior?.files.find(p => basename(p.path) === basename(entry.path));
      if (previous && journal.backup) {
        const backup = join(journal.backup, basename(previous.path));
        assert(regular(backup).size === previous.bytes && hash(backup) === previous.sha256,
          "Rollback backup differs from its receipt.");
        const temp = `${file}.${randomUUID()}.recover`;
        copyFileSync(backup, temp);
        flush(temp);
        renameSync(temp, file);
      } else if (existsSync(file)) rmSync(file);
    }
    if (journal.prior) atomicJson(receiptFile, journal.prior);
    else if (existsSync(receiptFile)) rmSync(receiptFile);
    rmSync(journalFile);
    return { recovered: true, conflicts: [], direction: "back" };
  });
  const install = (candidateId: string): InstallReceipt => withLock(() => {
    const plan = preflight(candidateId);
    const { root, manifest } = candidate(candidateId);
    const { live: prior, gone } = recorded();
    // The folders this install creates are removed again if it fails before any file is in place, so MO2 never lists an
    // empty mod (INSTALL-09).
    const created = missingFolders(target.target);
    mkdirSync(target.target, { recursive: true });
    noLinks(target.target);
    const backup = prior ? join(receipts, `${targetId}-${randomUUID()}`) : null;
    if (backup) mkdirSync(backup);
    const staged: string[] = [];
    try {
      for (const entry of manifest.files) {
        const file = destination(entry);
        if (backup) {
          const saved = join(backup, basename(entry.path));
          copyFileSync(file, saved, constants.COPYFILE_EXCL);
          const previous = prior!.files.find(p => basename(p.path) === basename(entry.path))!;
          assert(regular(saved).size === previous.bytes && hash(saved) === previous.sha256,
            "Backup differs from the installed receipt.");
          flush(saved);
        }
        const temp = `${file}.${randomUUID()}.stage`;
        staged.push(temp);
        copyFileSync(join(root, ...entry.path.split("/")), temp, constants.COPYFILE_EXCL);
        assert(regular(temp).size === entry.bytes && hash(temp) === entry.sha256, "Staged payload changed.");
        flush(temp);
      }
      config.afterStaging?.();
      checkCurrent(prior, manifest.files, gone);
      const receipt: InstallReceipt = { schema, targetId, route: target.route, target: target.target,
        candidateId: plan.candidateId, namespace: manifest.namespace, files: manifest.files,
        installedAt: new Date().toISOString(), features: manifest.features.map(({ feature, namespace }) => ({ feature, namespace })),
        rollback: prior && backup ? { prior: { ...prior, rollback: null }, backup } : null };
      atomicJson(journalFile, { schema: "xfs/install-journal-1", targetId, target: target.target,
        names: manifest.files.map(f => basename(f.path)), next: manifest.files, prior, backup, pending: receipt } satisfies Journal);
      for (let i = 0; i < manifest.files.length; i++) renameSync(staged[i], destination(manifest.files[i]));
      for (const entry of manifest.files) assert(hash(destination(entry)) === entry.sha256, "Installed payload changed.");
      atomicJson(receiptFile, receipt);
      rmSync(journalFile);
      return receipt;
    } catch (error) {
      for (const temp of staged) if (existsSync(temp)) rmSync(temp);
      if (existsSync(journalFile)) {
        // Recovery (on the next plan) finishes or undoes it; a locked or edited file is never forced.
        throw Error(`Install failed; recover the pending transaction before retrying: ${(error as Error).message}`);
      }
      if (backup) rmSync(backup, { recursive: true, force: true });
      for (const folder of created.reverse()) {
        try { rmdirSync(folder); } catch { break; /* Not empty (or gone): leave it and its parents. */ }
      }
      throw error;
    } finally { for (const temp of staged) if (existsSync(temp)) rmSync(temp); }
  });
  /**
   * Take over a receipt another store recorded for this same target (an earlier per-host receipts folder, INSTALL-04). Only
   * when this store has no record or journal of its own; the adopted receipt keeps no rollback (its backup stays where it was).
   */
  const adopt = (receipt: InstallReceipt): boolean => withLock(() => {
    noLinks(receiptFile); noLinks(journalFile);
    if (existsSync(receiptFile) || existsSync(journalFile)) return false;
    const adopted: InstallReceipt = { ...receipt, rollback: null };
    if (!validReceipt(adopted)) return false;
    atomicJson(receiptFile, adopted);
    return true;
  });
  /** Set a receipt this store no longer answers for aside (kept, renamed), after another store adopted it. */
  const retire = (): void => withLock(() => {
    noLinks(receiptFile);
    if (existsSync(receiptFile)) renameSync(receiptFile, `${receiptFile}.adopted-${Date.now()}`);
  });
  const uninstall = (): void => withLock(() => {
    assert(!existsSync(journalFile), "Recover the pending transaction first.");
    const prior = owned();
    assert(prior, "No owned installation exists.");
    checkCurrent(prior, prior.files);
    const backup = join(receipts, `${targetId}-${randomUUID()}`);
    mkdirSync(backup);
    for (const entry of prior.files) {
      copyFileSync(destination(entry), join(backup, basename(entry.path)));
      assert(hash(join(backup, basename(entry.path))) === entry.sha256, "Uninstall backup changed.");
      flush(join(backup, basename(entry.path)));
    }
    atomicJson(journalFile, { schema: "xfs/install-journal-1", targetId, target: target.target,
      names: prior.files.map(f => basename(f.path)), next: prior.files, prior, backup } satisfies Journal);
    for (const entry of prior.files) rmSync(destination(entry));
    rmSync(receiptFile);
    rmSync(journalFile);
  });
  const rollback = (): InstallReceipt => withLock(() => {
    assert(!existsSync(journalFile), "Recover the pending transaction first.");
    const current = owned();
    assert(current?.rollback, "No prior owned installation is available to restore.");
    checkCurrent(current, current.files);
    const { prior, backup: source } = current.rollback;
    assert(prior.namespace === current.namespace, "Rollback namespace changed.");
    assert(inside(resolve(source), receipts), "Rollback backup escapes the private receipt root.");
    noLinks(source); directory(source);
    const backup = join(receipts, `${targetId}-${randomUUID()}`);
    mkdirSync(backup);
    const staged: string[] = [];
    for (const entry of current.files) {
      copyFileSync(destination(entry), join(backup, basename(entry.path)));
      assert(hash(join(backup, basename(entry.path))) === entry.sha256, "Current backup changed.");
      flush(join(backup, basename(entry.path)));
    }
    for (const entry of prior.files) {
      const original = join(source, basename(entry.path));
      noLinks(original);
      assert(regular(original).size === entry.bytes && hash(original) === entry.sha256,
        "Prior backup differs from its receipt.");
      const temp = `${destination(entry)}.${randomUUID()}.stage`;
      staged.push(temp);
      copyFileSync(original, temp, constants.COPYFILE_EXCL);
      assert(hash(temp) === entry.sha256, "Staged rollback changed.");
      flush(temp);
    }
    try {
      atomicJson(journalFile, { schema: "xfs/install-journal-1", targetId, target: target.target,
        names: prior.files.map(f => basename(f.path)), next: prior.files, prior: current, backup } satisfies Journal);
      for (let i = 0; i < prior.files.length; i++) renameSync(staged[i], destination(prior.files[i]));
      atomicJson(receiptFile, prior);
      rmSync(journalFile);
      return prior;
    } finally { for (const temp of staged) if (existsSync(temp)) rmSync(temp); }
  });
  const receipt = () => {
    const current = owned();
    if (current) checkCurrent(current, current.files);
    return current;
  };
  /** The recorded receipt as it is, without looking at the installed files (its validity is still checked). */
  const record = () => owned();
  /** Whether an interrupted install's journal is waiting for `recover`. */
  const pending = () => { noLinks(journalFile); return existsSync(journalFile); };
  return { preflight, install, recover, uninstall, rollback, receipt, record, pending, adopt, retire };
}
