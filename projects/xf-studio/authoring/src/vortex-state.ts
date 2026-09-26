/**
 * Pure interpretation of Vortex's application state for one game (knowledge/vortex.md §2). Input is either the
 * key/value pairs of its `state.v2` LevelDB (leveldb-read.ts) or one of its full-state JSON backups; both become the same
 * nested object, from which this reads only what attribution needs: the active profile, which mods it enables, each mod's
 * name, version and Nexus ids, the staging folder setting, the deployment method and the game folder Vortex manages.
 *
 * Keys are the Redux state paths joined by `###` and values are `JSON.stringify` of the leaf; arrays and other non-plain
 * objects are stored whole [source: Vortex v2.7.1 `src/main/src/store/LevelPersist.ts` SEPARATOR,
 * `src/renderer/src/store/stateDiff.ts`, `ReduxPersistorIPC.ts`]. Field names: `persistent.mods[game][id]`
 * (`mod_management/types/IMod.ts`), attributes from the download and Nexus extractors (`download_management/index.ts`,
 * `nexus_integration/index.tsx`), `persistent.profiles[id].modState[modId].enabled` (`profile_management/types/IProfile.ts`),
 * `settings.profiles.activeProfileId` / `lastActiveProfile[game]`, `settings.mods.installPath[game]` and
 * `settings.mods.activator[game]`.
 */
import type { VortexModIdentity } from "./vortex-deployment";

export const VORTEX_KEY_SEPARATOR = "###";
type Tree = { [key: string]: unknown };
const isTree = (value: unknown): value is Tree => !!value && typeof value === "object" && !Array.isArray(value);
/**
 * Path segments that would reach an object's prototype instead of a property of its own (VORTEX-01). A mod whose archive is named
 * `__proto__`, or a corrupt database, must never write onto `Object.prototype` for the whole host process, so such a key is skipped.
 */
const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);
/** A tree node of the state's own: no prototype, so no inherited property can be read or written through it. */
const node = (): Tree => Object.create(null) as Tree;
/** `value`'s own entries, skipping the unsafe keys (a JSON backup's objects come from `JSON.parse`, which keeps `__proto__` as data). */
const ownEntries = (value: Tree) => Object.entries(value).filter(([key]) => !UNSAFE_KEYS.has(key));

/** Build the nested state from database pairs. A value that isn't JSON is kept as its text. Unsafe key segments are skipped. */
export function stateFromPairs(pairs: ReadonlyMap<string, string> | Iterable<readonly [string, string]>): { state: Tree; problems: string[] } {
  const state = node(), problems: string[] = [];
  for (const [key, raw] of pairs) {
    const path = key.split(VORTEX_KEY_SEPARATOR);
    if (path.some(part => UNSAFE_KEYS.has(part))) { problems.push(`${key.slice(0, 200)} names an object's prototype; skipped`); continue; }
    let value: unknown;
    try { value = JSON.parse(raw); } catch { value = raw; problems.push(`${key} is not JSON`); }
    let cursor = state;
    for (const part of path.slice(0, -1)) {
      if (!isTree(cursor[part])) cursor[part] = node();
      cursor = cursor[part] as Tree;
    }
    const leaf = path.at(-1)!;
    if (isTree(cursor[leaf]) && isTree(value)) {
      const merged = node();
      for (const [name, item] of [...ownEntries(cursor[leaf] as Tree), ...ownEntries(value)]) merged[name] = item;
      cursor[leaf] = merged;
    } else cursor[leaf] = value;
  }
  return { state, problems };
}

/** The value at `path`, reading own properties only (never an inherited one such as `constructor`). */
const at = (tree: unknown, ...path: string[]): unknown => path.reduce<unknown>((item, part) =>
  isTree(item) && !UNSAFE_KEYS.has(part) && Object.hasOwn(item, part) ? item[part] : undefined, tree);
const str = (value: unknown): string | null => typeof value === "string" && value !== "" ? value : null;
const int = (value: unknown): number | null => {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number > 0 ? number : null;
};

export interface VortexProfile { readonly id: string; readonly name: string | null; readonly lastActivated: number | null }
export interface VortexGameState {
  readonly gameId: string;
  /** Vortex's installation id; a deployment manifest written by this installation carries the same `instance`. */
  readonly instanceId: string | null;
  /** The game folder Vortex manages (a private path), if it has discovered the game. */
  readonly gamePath: string | null;
  /** The staging folder setting: an absolute path or a pattern with `{USERDATA}`, `{GAME}`, `{USERNAME}`; null for the default. */
  readonly installPathSetting: string | null;
  readonly deploymentMethod: string | null;
  /** The profile Vortex would use for this game: the active one when it is this game's, else the game's last active one. */
  readonly profile: VortexProfile | null;
  /** True when `profile` is Vortex's currently active profile (so this game is the one being managed right now). */
  readonly profileActive: boolean;
  readonly profiles: readonly VortexProfile[];
  readonly mods: ReadonlyMap<string, VortexModIdentity>;
  readonly problems: readonly string[];
}

/** Interpret a nested Vortex state (from `stateFromPairs` or a JSON backup) for one game. */
export function readVortexGameState(state: unknown, gameId: string): VortexGameState {
  const problems: string[] = [];
  const profiles: VortexProfile[] = [];
  const profilesTree = at(state, "persistent", "profiles");
  if (isTree(profilesTree)) for (const [id, value] of ownEntries(profilesTree))
    if (str(at(value, "gameId")) === gameId) profiles.push({ id, name: str(at(value, "name")), lastActivated: typeof at(value, "lastActivated") === "number" ? at(value, "lastActivated") as number : null });
  profiles.sort((a, b) => a.id.localeCompare(b.id));
  const activeId = str(at(state, "settings", "profiles", "activeProfileId"));
  const lastId = str(at(state, "settings", "profiles", "lastActiveProfile", gameId));
  const active = profiles.find(profile => profile.id === activeId) ?? null;
  const profile = active ?? profiles.find(profile => profile.id === lastId) ?? null;
  if (!profile && profiles.length) problems.push("No active or last active profile names one of this game's profiles.");
  const modState = profile ? at(state, "persistent", "profiles", profile.id, "modState") : undefined;
  const mods = new Map<string, VortexModIdentity>();
  const modsTree = at(state, "persistent", "mods", gameId);
  if (isTree(modsTree)) for (const [id, value] of ownEntries(modsTree)) {
    const attributes = at(value, "attributes");
    const modId = int(at(attributes, "modId")), fileId = int(at(attributes, "fileId"));
    const source = str(at(attributes, "source"));
    const enabled = profile ? at(modState, id, "enabled") === true : null;
    // The staging folder is `installationPath`, normally equal to the id; the manifest's `source` names the folder.
    const folder = str(at(value, "installationPath")) ?? id;
    mods.set(folder, { id: folder, name: str(at(attributes, "customFileName")) ?? str(at(attributes, "logicalFileName")) ?? str(at(attributes, "modName")) ?? str(at(attributes, "name")),
      version: str(at(attributes, "version")),
      nexus: modId !== null || fileId !== null || source === "nexus" ? { gameDomain: str(at(attributes, "downloadGame")), modId, fileId } : null,
      source, enabled });
  }
  return { gameId, instanceId: str(at(state, "app", "instanceId")), gamePath: str(at(state, "settings", "gameMode", "discovered", gameId, "path")),
    installPathSetting: str(at(state, "settings", "mods", "installPath", gameId)), deploymentMethod: str(at(state, "settings", "mods", "activator", gameId)),
    profile, profileActive: !!active, profiles, mods, problems };
}

/**
 * Resolve the staging folder setting the way Vortex does (`mod_management/util/getInstallPath.ts`): `{USERDATA}`,
 * `{GAME}` and `{USERNAME}` are replaced without regard to case, and a relative result is taken from the user data folder.
 * The default is `{USERDATA}/{GAME}/mods`.
 */
export function resolveVortexInstallPath(setting: string | null, gameId: string, userData: string, userName: string,
  join: (...parts: string[]) => string, isAbsolute: (path: string) => boolean): string {
  const pattern = setting ?? join("{USERDATA}", "{GAME}", "mods");
  const expanded = pattern.replace(/\{(userdata|game|username)\}/gi, (_, token: string) =>
    token.toLowerCase() === "userdata" ? userData : token.toLowerCase() === "game" ? gameId : userName);
  return isAbsolute(expanded) ? expanded : join(userData, expanded);
}
