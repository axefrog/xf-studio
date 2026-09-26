/**
 * Host adapter for Vortex-managed games (knowledge/vortex.md). Read-only: it reads the deployment manifests Vortex left
 * in the game folder, the staging folder's marker and Vortex's state (its `state.v2` database files, never its `LOCK`, or
 * a full-state JSON backup), and never starts Vortex, writes to its folders or changes the `nxm://` association.
 *
 * Two entry points:
 * - `readVortexManifests(gameRoot)`: cheap (one folder listing and the manifests), used by source discovery on every
 *   route to attribute game-folder files to the Vortex mods that deployed them.
 * - `inspectVortexSetup(gameRoot, env)`: the whole picture for diagnostics and first-run detection: which Vortex
 *   installation deployed, its staging folder, active profile, each mod's name, version and Nexus ids, and whether the
 *   deployment is out of date.
 */
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { readLevelDb, type LevelDbFile, type LevelDbRead } from "./leveldb-read";
import type { WatchedPath } from "./source-discovery";
import { combineVortexManifests, parseVortexManifest, vortexManifestModType, vortexManifestName, type VortexDeployment,
  type VortexManifest } from "./vortex-deployment";
import { readVortexGameState, resolveVortexInstallPath, stateFromPairs, type VortexGameState } from "./vortex-state";

/** Vortex's id for Cyberpunk 2077 [source: cyberpunk2077_ext_redux `src/index.metadata.ts`]. */
export const VORTEX_CYBERPUNK_GAME_ID = "cyberpunk2077";
const MANIFEST_BYTES = 256 * 1024 * 1024;
const STATE_FILE_BYTES = 512 * 1024 * 1024;

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

/** Where Vortex keeps its data: per user, and the shared (multi-user) location [source: Vortex `Application.ts`]. */
export function vortexDataFolders(env: (name: string) => string | undefined): { readonly path: string; readonly kind: "user" | "shared" }[] {
  const folders: { path: string; kind: "user" | "shared" }[] = [];
  const appData = env("APPDATA"), programData = env("ProgramData");
  if (appData) folders.push({ path: join(appData, "Vortex"), kind: "user" });
  if (programData) folders.push({ path: join(programData, "vortex"), kind: "shared" });
  return folders;
}

export interface VortexStateRead {
  readonly folder: string;
  readonly kind: "user" | "shared";
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

/** Read one Vortex data folder's state for a game: the database files when they read cleanly, else the newest JSON backup. */
export function readVortexStateFolder(folder: { path: string; kind: "user" | "shared" }, gameId: string): VortexStateRead | null {
  const dbDir = join(folder.path, "state.v2");
  let database: { read: LevelDbRead; game: VortexGameState } | null = null;
  let names: string[] = [];
  try { names = readdirSync(dbDir); } catch { /* no database here */ }
  if (names.length) {
    const files: LevelDbFile[] = names.filter(name => name.toUpperCase() !== "LOCK" && !/^LOG(\.old)?$/i.test(name)).map(name => {
      try {
        const path = join(dbDir, name), stat = statSync(path);
        return { name, bytes: stat.isFile() && stat.size <= STATE_FILE_BYTES ? new Uint8Array(readFileSync(path)) : null };
      } catch { return { name, bytes: null }; }
    });
    const read = readLevelDb(files);
    const { state, problems } = stateFromPairs(read.entries);
    const notes = files.some(file => !file.bytes) ? [RUNNING_NOTE] : [];
    database = { read: { ...read, gaps: [...notes, ...read.gaps, ...problems.slice(0, 5)] }, game: readVortexGameState(state, gameId) };
    if (!database.read.gaps.length) return { folder: folder.path, kind: folder.kind, source: "database", databaseMode: read.mode, gaps: [], backupTimeMs: null, current: true, game: database.game };
  }
  // Vortex keeps the database's newest writes in files it holds open while running; a backup may then be more complete.
  const backups = join(folder.path, "temp", "state_backups_full");
  let newest: { path: string; time: number } | null = null;
  try {
    for (const name of readdirSync(backups).filter(name => name.toLowerCase().endsWith(".json"))) {
      const time = statSync(join(backups, name)).mtimeMs;
      if (!newest || time > newest.time) newest = { path: join(backups, name), time };
    }
  } catch { /* no backups */ }
  if (newest && (!database || !database.game.mods.size)) {
    try {
      const game = readVortexGameState(JSON.parse(readFileSync(newest.path, "utf8")), gameId);
      return { folder: folder.path, kind: folder.kind, source: "backup", databaseMode: null,
        gaps: database ? [...database.read.gaps, "The database could not be read completely; this is Vortex's last state backup."] : [], backupTimeMs: newest.time, current: false, game };
    } catch { /* fall through */ }
  }
  return database ? { folder: folder.path, kind: folder.kind, source: "database", databaseMode: database.read.mode, gaps: database.read.gaps, backupTimeMs: null, current: false, game: database.game } : null;
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
  /** True when the state's instance id matches the manifest's; false when they differ; null when either is unknown. */
  readonly instanceMatches: boolean | null;
  /** Vortex manages this very folder (its discovered game path equals it); null when unknown. */
  readonly managesThisFolder: boolean | null;
  readonly problems: readonly string[];
}

const sameFolder = (a: string | null, b: string | null) => !!a && !!b && a.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase() === b.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();

/** The whole read-only picture of a Vortex-managed game folder. */
export function inspectVortexSetup(gameRoot: string, env: (name: string) => string | undefined, gameId = VORTEX_CYBERPUNK_GAME_ID): VortexSetup {
  const manifestRead = readVortexManifests(gameRoot);
  const problems = [...manifestRead.problems];
  const deployment = manifestRead.deployment;
  const primary = deployment?.manifests.find(row => row.modType === "")?.manifest ?? deployment?.manifests[0]?.manifest ?? null;
  const states = vortexDataFolders(env).map(folder => readVortexStateFolder(folder, gameId)).filter((row): row is VortexStateRead => !!row);
  // The installation that deployed is the one whose instance id the manifest carries; otherwise the one managing this folder.
  const state = states.find(row => primary?.instance && row.game.instanceId === primary.instance)
    ?? states.find(row => sameFolder(row.game.gamePath, gameRoot)) ?? null;
  const userData = state?.folder ?? vortexDataFolders(env)[0]?.path ?? null;
  const stagingPath = primary?.stagingPath ?? (state && userData
    ? resolveVortexInstallPath(state.game.installPathSetting, gameId, userData, env("USERNAME") ?? "", join, isAbsolute) : null);
  let stagingMarker: VortexSetup["stagingMarker"] = null;
  if (stagingPath) try {
    const marker = JSON.parse(readFileSync(join(stagingPath, "__vortex_staging_folder"), "utf8"));
    stagingMarker = { instance: typeof marker?.instance === "string" ? marker.instance : null, game: typeof marker?.game === "string" ? marker.game : null };
  } catch { /* absent or unreadable */ }
  if (primary?.gameId && primary.gameId !== gameId) problems.push(`The deployment manifest belongs to Vortex game "${primary.gameId}".`);
  return { schema: "xfs/vortex-setup-1", deployed: !!deployment,
    manifests: deployment?.manifests.map(row => ({ fileName: row.fileName, modType: row.modType, deploymentMethod: row.manifest.deploymentMethod,
      deploymentTimeMs: row.manifest.deploymentTime, files: row.manifest.files.length, instance: row.manifest.instance })) ?? [],
    deployment, stagingPath, stagingMarker, state,
    instanceMatches: primary?.instance && state?.game.instanceId ? primary.instance === state.game.instanceId : null,
    managesThisFolder: state?.game.gamePath ? sameFolder(state.game.gamePath, gameRoot) : null, problems };
}
