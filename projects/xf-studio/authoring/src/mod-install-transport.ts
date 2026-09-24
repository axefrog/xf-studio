/** Trusted, offline transport for an independently verified local package.
 * A host supplies fixed private roots and parsed settings; browser input is only a
 * candidate ID from that root. This module never compiles or changes a recipe.
 */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { LocalSettings } from "./local-settings";

const schema = "xfs/install-receipt-1" as const;
const fileNames = ["archive", "archive.xl"] as const;
type FileEntry = { path: string; sha256: string; bytes: number };
type PackageManifest = { schema: "xfs/local-package-1"; namespace: string; verifiedUnpackedFiles: number;
  installed: false; gameRenderingVerified: false; files: FileEntry[] };
export type InstallRoute = "direct" | "mo2";
export type InstallReceipt = { schema: typeof schema; targetId: string; route: InstallRoute; target: string;
  candidateId: string; namespace: string; files: FileEntry[]; installedAt: string;
  rollback: null | { prior: InstallReceipt; backup: string } };
type Journal = { schema: "xfs/install-journal-1"; targetId: string; target: string;
  names: string[]; next: FileEntry[]; prior: InstallReceipt | null; backup: string | null };
export type InstallTransportConfig = { candidateStore: string; receiptsRoot: string; settings: LocalSettings };
export type InstallPreview = { route: InstallRoute; target: string; candidateId: string;
  files: FileEntry[]; replacingOwned: boolean; activation: string };

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
  const value = JSON.parse(readFileSync(file, "utf8")) as PackageManifest;
  assert(value?.schema === "xfs/local-package-1" && safeName(value.namespace) && value.namespace.startsWith("xfs_") &&
    value.installed === false && value.gameRenderingVerified === false &&
    Number.isSafeInteger(value.verifiedUnpackedFiles) && value.verifiedUnpackedFiles > 0 &&
    Array.isArray(value.files) && value.files.length === 2, "Candidate manifest is not a verified two-file package.");
  for (let i = 0; i < 2; i++) {
    const entry = value.files[i];
    assert(entry && entry.path === `archive/pc/mod/${value.namespace}.${fileNames[i]}` &&
      /^[a-f0-9]{64}$/.test(entry.sha256) && Number.isSafeInteger(entry.bytes) && entry.bytes > 0,
    "Candidate manifest contains an unexpected file or hash.");
    const payload = join(root, ...entry.path.split("/"));
    noLinks(payload);
    assert(regular(payload).size === entry.bytes && hash(payload) === entry.sha256,
      "Candidate payload differs from the verified manifest.");
  }
  return value;
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
function targetFor(settings: LocalSettings): { route: InstallRoute; target: string; activation: string } {
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
    return { route, target, activation: "Files are staged in the game's archive/pc/mod folder; game loading is unverified." };
  }
  assert(settings.mo2Root && isAbsolute(settings.mo2Root) && settings.mo2ProfileId && profileSegment(settings.mo2ProfileId),
    "Configured MO2 instance and profile are missing.");
  noLinks(settings.mo2Root);
  directory(join(settings.mo2Root, "mods"));
  noLinks(join(settings.mo2Root, "profiles", settings.mo2ProfileId, "modlist.txt"));
  regular(join(settings.mo2Root, "profiles", settings.mo2ProfileId, "modlist.txt"));
  const target = join(settings.mo2Root, "mods", "XF Studio", "archive", "pc", "mod");
  noLinks(target);
  return { route, target, activation: "Enable the dedicated XF Studio mod in the chosen MO2 profile; activation and game loading are unverified." };
}

/** The host owns this object; never expose its root paths as renderer-editable options. */
export function createModInstallTransport(config: InstallTransportConfig) {
  const store = resolve(config.candidateStore), receipts = resolve(config.receiptsRoot);
  assert(isAbsolute(config.candidateStore) && isAbsolute(config.receiptsRoot) && store !== receipts,
    "Candidate and receipt roots must be distinct absolute directories.");
  directory(store);
  noLinks(store); noLinks(receipts);
  mkdirSync(receipts, { recursive: true });
  const target = targetFor(config.settings);
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
    assert(safeName(candidateId), "Invalid candidate ID.");
    const root = resolve(store, candidateId);
    assert(inside(root, store), "Candidate escapes the configured store.");
    noLinks(root); directory(root);
    return { root, manifest: parseManifest(root) };
  };
  const owned = (): InstallReceipt | null => {
    noLinks(receiptFile);
    const receipt = readJson<InstallReceipt>(receiptFile);
    if (receipt) assert(validReceipt(receipt), "Install receipt target or files mismatch.");
    return receipt;
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
  const checkCurrent = (receipt: InstallReceipt | null, files: FileEntry[]) => {
    const previous = new Map(receipt?.files.map(file => [basename(file.path), file]));
    if (receipt && receipt.namespace !== basename(files[0].path, ".archive"))
      throw Error("Changing the installed namespace requires uninstalling the owned pair first.");
    for (const entry of files) {
      const file = destination(entry), old = previous.get(basename(entry.path));
      noLinks(file);
      if (existsSync(file)) {
        assert(old && regular(file).size === old.bytes && hash(file) === old.sha256,
          `Existing file is unowned or changed: ${file}`);
      } else assert(!old, `Owned installed file is missing: ${file}`);
    }
  };
  const preflight = (candidateId: string): InstallPreview => {
    noLinks(journalFile);
    assert(!existsSync(journalFile), "An interrupted install needs recovery before another action.");
    const { manifest } = candidate(candidateId), prior = owned();
    checkCurrent(prior, manifest.files);
    return { ...target, candidateId, files: manifest.files, replacingOwned: !!prior };
  };
  const recover = (): { recovered: boolean; conflicts: string[] } => withLock(() => {
    noLinks(journalFile);
    const journal = readJson<Journal>(journalFile);
    if (!journal) return { recovered: false, conflicts: [] };
    assert(journal.schema === "xfs/install-journal-1" && journal.targetId === targetId &&
      journal.target === target.target && validEntries(journal.next,
        basename(journal.next?.[0]?.path ?? "", ".archive")) &&
      Array.isArray(journal.names) && journal.names.length === 2 &&
      journal.names.every((name, index) => name === basename(journal.next[index].path)) &&
      ((journal.prior === null && journal.backup === null) ||
        (validReceipt(journal.prior) && typeof journal.backup === "string" &&
        isAbsolute(journal.backup) && inside(resolve(journal.backup), receipts))),
      "Install journal target or files mismatch.");
    if (journal.backup) {
      assert(inside(resolve(journal.backup), receipts), "Journal backup escapes the private receipt root.");
      noLinks(journal.backup); directory(journal.backup);
    }
    const conflicts: string[] = [];
    for (const entry of journal.next) {
      const file = destination(entry), previous = journal.prior?.files.find(p => basename(p.path) === basename(entry.path));
      noLinks(file);
      if (!existsSync(file)) continue;
      const current = hash(file);
      if (current !== entry.sha256 && current !== previous?.sha256) conflicts.push(file);
    }
    if (conflicts.length) return { recovered: false, conflicts };
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
    return { recovered: true, conflicts: [] };
  });
  const install = (candidateId: string): InstallReceipt => withLock(() => {
    const plan = preflight(candidateId);
    const { root, manifest } = candidate(candidateId);
    const prior = owned();
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
      checkCurrent(prior, manifest.files);
      atomicJson(journalFile, { schema: "xfs/install-journal-1", targetId, target: target.target,
        names: manifest.files.map(f => basename(f.path)), next: manifest.files, prior, backup } satisfies Journal);
      for (let i = 0; i < manifest.files.length; i++) renameSync(staged[i], destination(manifest.files[i]));
      for (const entry of manifest.files) assert(hash(destination(entry)) === entry.sha256, "Installed payload changed.");
      const receipt: InstallReceipt = { schema, targetId, route: target.route, target: target.target,
        candidateId: plan.candidateId, namespace: manifest.namespace, files: manifest.files,
        installedAt: new Date().toISOString(), rollback: prior && backup ? { prior: { ...prior, rollback: null }, backup } : null };
      atomicJson(receiptFile, receipt);
      rmSync(journalFile);
      return receipt;
    } catch (error) {
      if (existsSync(journalFile)) {
        // Recovery remains explicit if an external edit or locked file prevents rollback.
        for (const temp of staged) if (existsSync(temp)) rmSync(temp);
        throw Error(`Install failed; recover the pending transaction before retrying: ${(error as Error).message}`);
      }
      throw error;
    } finally { for (const temp of staged) if (existsSync(temp)) rmSync(temp); }
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
  return { preflight, install, recover, uninstall, rollback, receipt };
}
