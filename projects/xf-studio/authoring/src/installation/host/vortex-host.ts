/**
 * Host adapter for Vortex-managed games (knowledge/vortex.md). Read-only: it reads the deployment manifests Vortex left
 * in the game folder, the staging folder's marker and Vortex's state (its `state.v2` database files, never its `LOCK`, or
 * a full-state JSON backup), and never starts Vortex, writes to its folders or changes the `nxm://` association.
 *
 * Two entry points:
 * - `readVortexManifests(gameRoot)`: cheap (one folder listing and the manifests), used by source discovery on every
 *   route to attribute game-folder files to the Vortex mods that deployed them.
 * - `inspectVortexSetup(gameRoot, env, options)`: the whole picture for diagnostics and first-run detection: which Vortex
 *   installation deployed, its staging folder, active profile, each mod's name, version and Nexus ids, and whether the
 *   deployment is out of date. Asynchronous and bounded (VORTEX-05): the state files are read without blocking the host, at most
 *   `STATE_TOTAL_BYTES` together, and never past the caller's deadline (a problem report's time budget); a read is kept for the
 *   same files, so preparing a report again doesn't read them again.
 *
 * Paths the game folder's manifest names are only reported, never opened, unless they are on a local drive (VORTEX-06): a
 * `vortex.deployment.json` anyone can write must not make the host open a network share.
 */
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { isLocalDrivePath } from "../../platform/api/path-containment";
import { readLevelDb, type LevelDbFile, type LevelDbRead } from "../../formats/leveldb-read";
import type { WatchedPath } from "../../game/host/source-discovery";
import { combineVortexManifests, parseVortexManifest, vortexManifestModType, vortexManifestName, type VortexDeployment,
  type VortexManifest } from "../vortex-deployment";
import { readVortexGameState, readVortexMultiUser, resolveVortexInstallPath, stateFromPairs, type VortexGameState } from "../vortex-state";
import { resolveVortexDataFolders, type VortexDataCandidate, type VortexDataFacts, type VortexDataFolder } from "../vortex-data";
import { gatherVortexDataFacts, vortexShortcutDiscovery, type VortexShortcutDiscovery } from "./vortex-data-host";

/** Vortex's id for Cyberpunk 2077 [source: cyberpunk2077_ext_redux `src/index.metadata.ts`]. */
export const VORTEX_CYBERPUNK_GAME_ID = "cyberpunk2077";
const MANIFEST_BYTES = 256 * 1024 * 1024;
/** The largest state file read, and the most read from one data folder together (database files or one backup). */
export const STATE_FILE_BYTES = 256 * 1024 * 1024;
export const STATE_TOTAL_BYTES = 512 * 1024 * 1024;

/** How a state read is bounded. */
export type VortexReadOptions = {
  signal?: AbortSignal;
  /** Inject already gathered facts (also keeps fixture tests independent of this computer's Vortex). */
  dataFacts?: VortexDataFacts;
  /** The host session owns the once-only background shortcut scan. Fixtures inject their own owner. */
  shortcutDiscovery?: VortexShortcutDiscovery;
  factsReader?: typeof gatherVortexDataFacts;
  /** Stop reading state files at this time (on `now`'s clock); what isn't read by then is a gap. */
  deadline?: number;
  now?: () => number;
  /** Most bytes read from one data folder's state (default `STATE_TOTAL_BYTES`). */
  maxStateBytes?: number;
};

/**
 * A folder XF Studio may open: an absolute path on a local drive (`C:\…`, or `/…` off Windows). A network share (`\\server\…`,
 * `//server/…`, `/\server\…`) or a device path (`\\?\…`, `\\.\…`, `\??\…`) is never opened for Vortex (VORTEX-06): the
 * separators are normalised before the path is classified (INSTALL-05; platform/api/path-containment.ts `isLocalDrivePath`).
 */
export const isLocalFolder = (path: string) => isLocalDrivePath(path);

const lstatOrNull = (path: string) => { try { return lstatSync(path); } catch { return null; } };

export interface VortexManifestRead {
  /** Null when the game folder holds no deployment manifest. */
  readonly deployment: VortexDeployment | null;
  readonly problems: readonly string[];
  /** The default manifest path (watched even while absent, so a first deployment is noticed) and every manifest read. */
  readonly watched: readonly WatchedPath[];
}

/**
 * Read the deployment manifests in the game folder. Manifests in other folders belong to mod types Cyberpunk doesn't
 * register. `stampOf` stamps the watched paths the way the caller's change check reads them (source-discovery.ts `pathStamp`).
 */
export function readVortexManifests(gameRoot: string, stampOf: (path: string) => string = () => ""): VortexManifestRead {
  const watched: WatchedPath[] = [];
  const problems: string[] = [];
  const defaultPath = join(gameRoot, vortexManifestName());
  watched.push({ path: defaultPath, stamp: stampOf(defaultPath) });
  let names: string[] = [];
  try { names = readdirSync(gameRoot).filter(name => vortexManifestModType(name) !== null); }
  catch { return { deployment: null, problems: ["The game folder could not be listed."], watched }; }
  const manifests: { fileName: string; manifest: VortexManifest }[] = [];
  for (const fileName of names.sort()) {
    const path = join(gameRoot, fileName), stat = lstatOrNull(path);
    if (path.toLowerCase() !== defaultPath.toLowerCase()) watched.push({ path, stamp: stampOf(path) });
    if (!stat?.isFile() || stat.size > MANIFEST_BYTES) { problems.push(`${fileName} is not a readable file.`); continue; }
    try { manifests.push({ fileName, manifest: parseVortexManifest(readFileSync(path, "utf8")) }); }
    catch (error) { problems.push(`${fileName}: ${(error as Error).message}`); }
  }
  return { deployment: manifests.length ? combineVortexManifests(manifests) : null, problems, watched };
}

/** Base and shared marker locations; these are not the resolved order of active data folders. */
export function vortexDataFolders(env: (name: string) => string | undefined): { readonly path: string; readonly kind: "user" | "shared" }[] {
  const folders: { path: string; kind: "user" | "shared" }[] = [];
  const appData = env("APPDATA"), programData = env("ProgramData");
  if (appData) folders.push({ path: join(appData, "Vortex"), kind: "user" });
  if (programData) folders.push({ path: join(programData, "vortex"), kind: "shared" });
  return folders;
}

export interface VortexStateRead {
  readonly folder: string;
  readonly kind: VortexDataFolder["kind"];
  readonly multiUser?: boolean;
  /** At least one database file could be read, even if a newer backup was selected. */
  readonly databaseReadable?: boolean;
  /** `database`: the state.v2 files. `backup`: a full-state JSON backup (up to an hour old, or older). */
  readonly source: "database" | "backup";
  readonly databaseMode: LevelDbRead["mode"] | null;
  /** Files that could not be read (Vortex holds some open while it runs) and format problems: recent changes may be missing. */
  readonly gaps: readonly string[];
  readonly backupTimeMs: number | null;
  /** The whole current state was read (the database, with no gaps). Only then does a mod's absence mean it isn't installed. */
  readonly current: boolean;
  readonly game: VortexGameState;
}

/** Observed in experiment 023: while Vortex runs, its MANIFEST and newest log can't be opened by another program. */
const RUNNING_NOTE = "Vortex appears to be running: it keeps its newest changes in files no other program can open until it closes, so mods installed or enabled since it started may be missing.";
const LARGE_NOTE = "Vortex's state is larger than XF Studio reads, so some of it was left out.";
const TIME_NOTE = "Vortex's state couldn't all be read in the time a problem report allows, so some of it was left out.";

/** Reads kept by folder and the files' names, sizes and times, so the same files are not read and decoded again. */
const stateReads = new Map<string, { stamp: string; read: VortexStateRead | null }>();
const STATE_READS_KEPT = 4;

/**
 * Read one Vortex data folder's state for a game: the database files when they read cleanly, else the newest JSON backup when it
 * is more complete: when the database lists no mods, or when the backup was written after the newest database file read (VORTEX-08).
 * Asynchronous and bounded by `options` (VORTEX-05).
 */
export async function readVortexStateFolder(folder: VortexDataFolder, gameId: string,
  options: VortexReadOptions = {}): Promise<VortexStateRead | null> {
  options.signal?.throwIfAborted();
  const now = options.now ?? Date.now, limit = options.maxStateBytes ?? STATE_TOTAL_BYTES;
  const late = () => options.deadline !== undefined && now() >= options.deadline;
  const dbDir = join(folder.path, "state.v2");
  const backups = join(folder.path, "temp", "state_backups_full");
  const listing = async (dir: string, keep: (name: string) => boolean) => {
    let names: string[] = [];
    try { names = (await readdir(dir)).filter(keep).sort(); } catch { options.signal?.throwIfAborted(); }
    options.signal?.throwIfAborted();
    return Promise.all(names.map(async name => {
      try { const info = await stat(join(dir, name)); return { name, path: join(dir, name), file: info.isFile(), size: info.size, time: info.mtimeMs }; }
      catch { return { name, path: join(dir, name), file: false, size: 0, time: 0 }; }
    }));
  };
  const dbListing = await listing(dbDir, name => name.toUpperCase() !== "LOCK" && !/^LOG(\.old)?$/i.test(name));
  const backupListing = (await listing(backups, name => name.toLowerCase().endsWith(".json"))).filter(entry => entry.file);
  options.signal?.throwIfAborted();
  const stamp = JSON.stringify([gameId, limit, dbListing.map(entry => [entry.name, entry.file, entry.size, entry.time]),
    backupListing.map(entry => [entry.name, entry.size, entry.time])]);
  const kept = stateReads.get(folder.path);
  if (kept?.stamp === stamp) return kept.read && kept.read.kind !== folder.kind ? { ...kept.read, kind: folder.kind } : kept.read;
  let complete = true;
  const read = await (async (): Promise<VortexStateRead | null> => {
    let database: { read: LevelDbRead; game: VortexGameState; multiUser?: boolean; readable: boolean; time: number } | null = null;
    if (dbListing.length) {
      const notes = new Set<string>();
      let total = 0, time = 0;
      const files: LevelDbFile[] = [];
      for (const entry of dbListing) {
        options.signal?.throwIfAborted();
        if (!entry.file) { notes.add(RUNNING_NOTE); files.push({ name: entry.name, bytes: null }); continue; }
        if (entry.size > STATE_FILE_BYTES || total + entry.size > limit) { notes.add(LARGE_NOTE); files.push({ name: entry.name, bytes: null }); continue; }
        if (late()) { notes.add(TIME_NOTE); complete = false; files.push({ name: entry.name, bytes: null }); continue; }
        try { files.push({ name: entry.name, bytes: new Uint8Array(await readFile(entry.path, { signal: options.signal })) }); total += entry.size; time = Math.max(time, entry.time); }
        catch { options.signal?.throwIfAborted(); notes.add(RUNNING_NOTE); files.push({ name: entry.name, bytes: null }); }
      }
      const levelDb = readLevelDb(files);
      const { state, problems } = stateFromPairs(levelDb.entries);
      // A file listed but left unread shows as a gap of its own; the notes say why.
      database = { read: { ...levelDb, gaps: [...notes, ...levelDb.gaps, ...problems.slice(0, 5)] }, game: readVortexGameState(state, gameId), multiUser: readVortexMultiUser(state), readable: files.some(file => file.bytes !== null), time };
      if (!database.read.gaps.length) return { folder: folder.path, kind: folder.kind, multiUser: database.multiUser, databaseReadable: database.readable, source: "database", databaseMode: levelDb.mode, gaps: [], backupTimeMs: null, current: true, game: database.game };
    }
    // Vortex keeps the database's newest writes in files it holds open while running; a backup may then be more complete: when the
    // database lists no mods, or when the backup is newer than every database file that could be read (VORTEX-08).
    const newest = backupListing.reduce<(typeof backupListing)[number] | null>((best, entry) => !best || entry.time > best.time ? entry : best, null);
    if (newest && (!database || !database.game.mods.size || newest.time > database.time) && newest.size <= Math.min(STATE_FILE_BYTES, limit)) {
      if (late()) complete = false;
      else try {
        const state = JSON.parse(await readFile(newest.path, { encoding: "utf8", signal: options.signal }));
        const game = readVortexGameState(state, gameId);
        return { folder: folder.path, kind: folder.kind, multiUser: readVortexMultiUser(state), databaseReadable: database?.readable ?? false, source: "backup", databaseMode: null,
          gaps: database ? [...database.read.gaps, "The database could not be read completely; this is Vortex's last state backup."] : [], backupTimeMs: newest.time, current: false, game };
      } catch { options.signal?.throwIfAborted(); }
    }
    return database ? { folder: folder.path, kind: folder.kind, multiUser: database.multiUser, databaseReadable: database.readable, source: "database", databaseMode: database.read.mode, gaps: database.read.gaps, backupTimeMs: null, current: false, game: database.game } : null;
  })();
  // A read cut short by the deadline is not kept: the next report, with time to spare, reads the rest.
  if (complete) {
    stateReads.delete(folder.path);
    stateReads.set(folder.path, { stamp, read });
    while (stateReads.size > STATE_READS_KEPT) stateReads.delete(stateReads.keys().next().value!);
  }
  return read;
}

export interface VortexSetup {
  readonly schema: "xfs/vortex-setup-1";
  /** Vortex has files deployed in this game folder (a deployment manifest is present). */
  readonly deployed: boolean;
  readonly manifests: readonly { readonly fileName: string; readonly modType: string; readonly deploymentMethod: string | null;
    readonly deploymentTimeMs: number | null; readonly files: number; readonly instance: string }[];
  readonly deployment: VortexDeployment | null;
  /** The staging folder (private path): from the manifest, else from Vortex's settings. */
  readonly stagingPath: string | null;
  /** The staging folder's `__vortex_staging_folder` marker. */
  readonly stagingMarker: { readonly instance: string | null; readonly game: string | null } | null;
  /** The Vortex state that belongs to the installation that deployed (matched by instance id), when readable. */
  readonly state: VortexStateRead | null;
  /** Local/private discovery evidence; portable reports must omit the folder path. */
  readonly stateSelection?: { readonly candidate: VortexDataCandidate; readonly matchedBy: "instance" | "game-path" } | null;
  /** True when the state's instance id matches the manifest's; false when they differ; null when either is unknown. */
  readonly instanceMatches: boolean | null;
  /** Vortex manages this very folder (its discovered game path equals it); null when unknown. */
  readonly managesThisFolder: boolean | null;
  readonly problems: readonly string[];
}

const sameFolder = (a: string | null, b: string | null) => !!a && !!b && a.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase() === b.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();

/** The whole read-only picture of a Vortex-managed game folder, bounded by `options` (VORTEX-05). */
export async function inspectVortexSetup(gameRoot: string, env: (name: string) => string | undefined, options: VortexReadOptions = {},
  gameId = VORTEX_CYBERPUNK_GAME_ID): Promise<VortexSetup> {
  options.signal?.throwIfAborted();
  const manifestRead = readVortexManifests(gameRoot);
  const problems = [...manifestRead.problems];
  const deployment = manifestRead.deployment;
  const primary = deployment?.manifests.find(row => row.modType === "")?.manifest ?? deployment?.manifests[0]?.manifest ?? null;
  const signal = options.signal ?? new AbortController().signal;
  const now = options.now ?? Date.now;
  const remaining = options.deadline === undefined ? 5000 : Math.max(0, options.deadline - now());
  let facts = options.dataFacts;
  if (!facts) {
    // Fast metadata has a small slice; keep at least 250 ms for validating cold state files.
    const budget = Math.min(100, Math.max(0, remaining - 250));
    const fastSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, budget))]);
    try { facts = budget > 0 ? await (options.factsReader ?? gatherVortexDataFacts)(env, fastSignal) : undefined; }
    catch { signal.throwIfAborted(); facts = { platform: process.platform === "win32" ? "win32" : "posix", appData: env("APPDATA"), programData: env("ProgramData") }; }
  }
  facts ??= { platform: process.platform === "win32" ? "win32" : "posix", appData: env("APPDATA"), programData: env("ProgramData") };
  const shortcuts = options.shortcutDiscovery ?? (options.dataFacts ? undefined : vortexShortcutDiscovery);
  facts = { ...facts, shortcuts: [...(facts.shortcuts ?? []), ...(shortcuts?.snapshot() ?? [])] };
  const reads = new Map<string, VortexStateRead | null>();
  let instanceFound = false;
  const read = async (folder: VortexDataFolder) => {
    signal.throwIfAborted();
    if (!isLocalFolder(folder.path)) { problems.push("A Vortex data-folder lead isn't on a local drive and was skipped."); return null; }
    if (!reads.has(folder.path)) reads.set(folder.path, await readVortexStateFolder(folder, gameId, options));
    return reads.get(folder.path) ?? null;
  };
  // Validate explicit cheap leads immediately, before spending any time on base/shared markers.
  let earlierModeLead = false;
  for (const candidate of resolveVortexDataFolders(facts, { join, resolve, isAbsolute })) {
    if (!["process", "startup", "shortcut"].includes(candidate.source)) continue;
    if (candidate.kind === "custom") {
      const row = await read(candidate);
      if (!earlierModeLead && row?.databaseReadable && primary?.instance && row.game.instanceId === primary.instance) { instanceFound = true; break; }
    } else earlierModeLead = true; // Resolve an earlier launch's base/shared choice before accepting a later lead.
  }
  const markers = new Map<string, VortexStateRead | null>();
  for (const folder of vortexDataFolders(env)) {
    if (instanceFound) break;
    if (folder.kind === "shared" && !(facts.userMultiUser ?? markers.get("user")?.multiUser)) continue;
    markers.set(folder.kind, await read(folder));
  }
  const candidates = resolveVortexDataFolders({ ...facts, userMultiUser: facts.userMultiUser ?? markers.get("user")?.multiUser,
    sharedMultiUser: facts.sharedMultiUser ?? markers.get("shared")?.multiUser }, { join, resolve, isAbsolute });
  const states: { read: VortexStateRead; candidate: VortexDataCandidate }[] = [];
  for (const candidate of candidates) {
    if (instanceFound && !reads.has(candidate.path)) continue;
    const row = await read(candidate);
    // Every discovery source requires a readable state.v2. A backup can enrich a readable,
    // incomplete DB, but a leftover backup alone never validates a data-folder lead.
    if (row?.databaseReadable) {
      states.push({ read: row.kind === candidate.kind ? row : { ...row, kind: candidate.kind }, candidate });
      if (primary?.instance && row.game.instanceId === primary.instance) instanceFound = true;
    }
  }
  // The installation that deployed is the one whose instance id the manifest carries; otherwise the one managing this folder.
  const instance = states.find(row => primary?.instance && row.read.game.instanceId === primary.instance);
  const selected = instance ?? states.find(row => sameFolder(row.read.game.gamePath, gameRoot));
  const state = selected?.read ?? null;
  const userData = state?.folder ?? candidates[0]?.path ?? null;
  const stagingPath = primary?.stagingPath ?? (state && userData
    ? resolveVortexInstallPath(state.game.installPathSetting, gameId, userData, env("USERNAME") ?? "", join, isAbsolute) : null);
  let stagingMarker: VortexSetup["stagingMarker"] = null;
  // The staging folder may come from the game folder's manifest, which anyone can write: only a local folder is opened (VORTEX-06).
  if (stagingPath && !isLocalFolder(stagingPath)) problems.push("The staging folder isn't on a local drive, so XF Studio didn't look inside it.");
  else if (stagingPath) try {
    const marker = JSON.parse(await readFile(join(stagingPath, "__vortex_staging_folder"), { encoding: "utf8", signal: options.signal }));
    stagingMarker = { instance: typeof marker?.instance === "string" ? marker.instance : null, game: typeof marker?.game === "string" ? marker.game : null };
  } catch { options.signal?.throwIfAborted(); }
  options.signal?.throwIfAborted();
  shortcuts?.start(env);
  if (primary?.gameId && primary.gameId !== gameId) problems.push(`The deployment manifest belongs to Vortex game "${primary.gameId}".`);
  return { schema: "xfs/vortex-setup-1", deployed: !!deployment,
    manifests: deployment?.manifests.map(row => ({ fileName: row.fileName, modType: row.modType, deploymentMethod: row.manifest.deploymentMethod,
      deploymentTimeMs: row.manifest.deploymentTime, files: row.manifest.files.length, instance: row.manifest.instance })) ?? [],
    deployment, stagingPath, stagingMarker, state,
    stateSelection: selected ? { candidate: selected.candidate, matchedBy: instance ? "instance" : "game-path" } : null,
    instanceMatches: primary?.instance && state?.game.instanceId ? primary.instance === state.game.instanceId : null,
    managesThisFolder: state?.game.gamePath ? sameFolder(state.game.gamePath, gameRoot) : null, problems };
}
